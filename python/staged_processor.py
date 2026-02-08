#!/usr/bin/env python3
"""
Staged processor - copies courses to fast SSD, processes there, then cleans up.
This optimizes throughput when source is on a slow USB drive.

Pipeline:
1. Copy course from slow USB to fast SSD staging area
2. Process from SSD (transcribe + summarize) - much faster!
3. Clean up staging to make room for next course
4. Repeat

This keeps the USB doing sequential reads (efficient) while SSD handles
all the random I/O from ffmpeg/whisper/ollama.
"""

import argparse
import json
import os
import shutil
import subprocess
import sys
import time
import uuid
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime
from pathlib import Path
from queue import Queue, Empty
from threading import Thread, Lock
import threading

# Configuration - default transcripts directory (can be overridden via CLI args)
TRANSCRIPTS_DIR = Path(os.environ.get("COURSEVAULT_TRANSCRIPTS_DIR", str(Path.home() / "Documents" / "CourseVault" / "transcripts")))
PROGRESS_FILE = TRANSCRIPTS_DIR / "progress.json"
LOCK_FILE = TRANSCRIPTS_DIR / "progress.lock"

# Import supported extensions from transcriber
try:
    from transcriber import SUPPORTED_EXTENSIONS
except ImportError:
    # Fallback if transcriber module not available
    SUPPORTED_EXTENSIONS = {".mp4", ".mkv", ".avi", ".mov", ".webm", ".m4v"}


class FileLock:
    """Simple file-based lock."""
    def __init__(self, lock_path: Path, timeout: float = 30.0):
        self.lock_path = lock_path
        self.timeout = timeout
        self.acquired = False

    def __enter__(self):
        start = time.time()
        while time.time() - start < self.timeout:
            try:
                fd = os.open(str(self.lock_path), os.O_CREAT | os.O_EXCL | os.O_WRONLY)
                os.write(fd, str(os.getpid()).encode())
                os.close(fd)
                self.acquired = True
                return self
            except FileExistsError:
                try:
                    if self.lock_path.exists():
                        age = time.time() - self.lock_path.stat().st_mtime
                        if age > 60:
                            self.lock_path.unlink()
                            continue
                except Exception:
                    pass
                time.sleep(0.1)
        raise TimeoutError(f"Could not acquire lock: {self.lock_path}")

    def __exit__(self, *args):
        if self.acquired:
            try:
                self.lock_path.unlink()
            except Exception:
                pass


def load_progress() -> dict:
    if not PROGRESS_FILE.exists():
        return {"courses": {}}
    try:
        with open(PROGRESS_FILE, "r", encoding="utf-8") as f:
            return json.load(f)
    except Exception:
        return {"courses": {}}


def save_progress(data: dict) -> None:
    PROGRESS_FILE.parent.mkdir(parents=True, exist_ok=True)
    data["last_updated"] = datetime.now().isoformat()
    with open(PROGRESS_FILE, "w", encoding="utf-8") as f:
        json.dump(data, f, indent=2)


def get_pending_courses(source_dir: Path) -> list[Path]:
    """Get courses that haven't been completed yet."""
    progress = load_progress()
    completed = {n for n, c in progress.get("courses", {}).items()
                 if c.get("status") == "completed"}

    # System folders to skip
    skip_folders = {"$RECYCLE.BIN", "System Volume Information", ".Trash", "transcripts"}

    courses = []
    for item in sorted(source_dir.iterdir(), key=lambda p: p.name):
        if not item.is_dir():
            continue
        if item.name.startswith(".") or item.name.startswith("$"):
            continue
        if item.name in skip_folders or "[" in item.name:
            continue
        if item.name in completed:
            continue
        has_videos = any(f.suffix.lower() in SUPPORTED_EXTENSIONS for f in item.rglob("*"))
        if has_videos:
            courses.append(item)
    return courses


def get_course_size(course_path: Path) -> int:
    """Get total size of course in bytes."""
    return sum(f.stat().st_size for f in course_path.rglob("*") if f.is_file())


def count_videos(course_path: Path) -> int:
    return sum(1 for f in course_path.rglob("*") if f.suffix.lower() in SUPPORTED_EXTENSIONS)


def copy_course_to_staging(source: Path, staging_dir: Path) -> Path:
    """Copy course to staging area. Returns path to staged course."""
    dest = staging_dir / source.name
    if dest.exists():
        shutil.rmtree(dest)

    print(f"    Copying to SSD staging: {source.name}")
    start = time.time()
    shutil.copytree(source, dest)
    elapsed = time.time() - start
    size_mb = get_course_size(dest) / (1024 * 1024)
    speed = size_mb / elapsed if elapsed > 0 else 0
    print(f"    Copied {size_mb:.0f} MB in {elapsed:.1f}s ({speed:.1f} MB/s)")
    return dest


def process_course(staged_path: Path, worker_id: str) -> tuple[int, int]:
    """Process a course from the staging area."""
    course_name = staged_path.name
    transcript_dir = TRANSCRIPTS_DIR / course_name

    print(f"    [{worker_id}] Processing: {course_name}")
    print(f"    [{worker_id}] Staged path: {staged_path}")

    # Check if staged folder has videos
    video_files = [f for f in staged_path.rglob("*") if f.suffix.lower() in SUPPORTED_EXTENSIONS]
    print(f"    [{worker_id}] Found {len(video_files)} video files in staging")

    if not video_files:
        print(f"    [{worker_id}] WARNING: No videos found in staged folder!")
        # Copy course to transcripts anyway (maybe structure is different)
        transcript_dir.mkdir(parents=True, exist_ok=True)
        # Just copy structure to preserve files
        shutil.copytree(staged_path, transcript_dir, dirs_exist_ok=True)
        processed = 0
    else:
        # Transcribe from staged location (fast SSD reads!)
        print(f"    [{worker_id}] Transcribing from SSD...")
        trans_cmd = [
            sys.executable,
            str(Path(__file__).parent / "transcriber.py"),
            "-i", str(staged_path)
        ]
        trans_result = subprocess.run(trans_cmd, capture_output=True, text=True)

        if trans_result.stdout:
            print(f"    [{worker_id}] Transcriber output:\n{trans_result.stdout}")
        if trans_result.stderr:
            print(f"    [{worker_id}] Transcriber errors:\n{trans_result.stderr}")

        # Video summaries
        print(f"    [{worker_id}] Generating video summaries...")
        summ_cmd = [
            sys.executable,
            str(Path(__file__).parent / "video_summaries.py"),
            str(transcript_dir)
        ]
        subprocess.call(summ_cmd)

        # Course summary
        print(f"    [{worker_id}] Generating course summary...")
        course_cmd = [
            sys.executable,
            str(Path(__file__).parent / "course_summary.py"),
            str(transcript_dir)
        ]
        subprocess.call(course_cmd)

        processed = sum(1 for f in transcript_dir.rglob("*.txt")
                        if not f.name.endswith(".summary.md") and f.name != "transcriber.log")
    return processed, 0


def mark_completed(course_name: str, processed: int, failed: int):
    """Mark course as completed in progress file."""
    with FileLock(LOCK_FILE):
        progress = load_progress()
        progress.setdefault("courses", {})[course_name] = {
            "status": "completed",
            "completed_at": datetime.now().isoformat(),
            "processed_videos": processed,
            "failed_videos": failed
        }
        save_progress(progress)


def cleanup_staging(staged_path: Path):
    """Remove course from staging area."""
    if not staged_path.exists():
        return
    try:
        print(f"    [Cleanup] Removing {staged_path.name} from staging...")
        # On Windows, files might be locked, try multiple times
        for attempt in range(3):
            try:
                shutil.rmtree(staged_path)
                break
            except (PermissionError, OSError) as e:
                if attempt < 2:
                    print(f"    [Cleanup] Failed to remove, retrying in 2s... ({e})")
                    time.sleep(2)
                else:
                    print(f"    [Cleanup] ERROR: Could not remove {staged_path}: {e}")
                    # Try to at least delete files
                    try:
                        for f in staged_path.rglob("*"):
                            if f.is_file():
                                f.unlink()
                    except Exception:
                        pass
                    raise
    except Exception as e:
        print(f"    [Cleanup] Unexpected error cleaning {staged_path}: {e}")
        raise


class StagedProcessor:
    """
    Manages staged processing with a copy thread and multiple worker threads.

    Architecture:
    - 1 copy thread: Copies courses from USB to SSD staging
    - N worker threads: Process courses from SSD staging
    - Queue connects them: copy thread adds to queue, workers pull from queue
    """

    def __init__(self, source_dir: Path, staging_dir: Path, num_workers: int,
                 max_staging_gb: float):
        self.source_dir = source_dir
        self.staging_dir = staging_dir
        self.num_workers = num_workers
        self.max_staging_bytes = int(max_staging_gb * 1024 * 1024 * 1024)

        self.staging_dir.mkdir(parents=True, exist_ok=True)

        self.queue = Queue(maxsize=num_workers + 2)  # Buffer a couple ahead
        self.done = False
        self.lock = Lock()
        self.current_staging_size = 0
        self.stats = {
            "copied": 0,
            "processed": 0,
            "failed": 0,
            "total_videos": 0
        }

    def get_staging_usage(self) -> int:
        """Get current staging directory size."""
        if not self.staging_dir.exists():
            return 0
        return sum(f.stat().st_size for f in self.staging_dir.rglob("*") if f.is_file())

    def copy_thread(self):
        """Thread that copies courses from USB to SSD staging."""
        pending = get_pending_courses(self.source_dir)
        print(f"\n[Copier] Found {len(pending)} courses to process")

        for i, course in enumerate(pending, 1):
            course_size = get_course_size(course)
            course_size_mb = course_size / (1024 * 1024)

            # Wait until we have room in staging
            while True:
                current_usage = self.get_staging_usage()
                if current_usage + course_size < self.max_staging_bytes:
                    break
                print(f"[Copier] Staging full ({current_usage/1e9:.1f}GB), waiting...")
                time.sleep(5)

            print(f"\n[Copier] [{i}/{len(pending)}] {course.name} ({course_size_mb:.0f} MB)")

            try:
                staged_path = copy_course_to_staging(course, self.staging_dir)
                self.queue.put((course.name, staged_path, count_videos(course)))
                with self.lock:
                    self.stats["copied"] += 1
            except Exception as e:
                print(f"[Copier] ERROR copying {course.name}: {e}")

        # Signal workers to stop
        self.done = True
        for _ in range(self.num_workers):
            self.queue.put(None)

        print(f"\n[Copier] All courses queued for processing")

    def worker_thread(self, worker_id: str):
        """Worker thread that processes courses from staging."""
        processed_count = 0

        while True:
            try:
                item = self.queue.get(timeout=10)
            except Empty:
                if self.done:
                    break
                continue

            if item is None:
                break

            course_name, staged_path, video_count = item
            print(f"\n[{worker_id}] Processing: {course_name} ({video_count} videos)")

            start = time.time()
            try:
                processed, failed = process_course(staged_path, worker_id)
                elapsed = time.time() - start

                mark_completed(course_name, processed, failed)

                with self.lock:
                    self.stats["processed"] += 1
                    self.stats["total_videos"] += processed

                print(f"[{worker_id}] DONE: {course_name} ({processed} videos in {elapsed/60:.1f}m)")

                # Update index
                subprocess.call([sys.executable, str(Path(__file__).parent / "generate_index.py")],
                              stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)

            except Exception as e:
                print(f"[{worker_id}] ERROR: {course_name}: {e}")
                with self.lock:
                    self.stats["failed"] += 1
            finally:
                # Clean up staging
                cleanup_staging(staged_path)

            processed_count += 1

        print(f"[{worker_id}] Worker finished ({processed_count} courses)")

    def run(self):
        """Run the staged processing pipeline."""
        print("=" * 70)
        print("STAGED PROCESSOR - USB → SSD → Process")
        print("=" * 70)
        print(f"Source:     {self.source_dir}")
        print(f"Staging:    {self.staging_dir}")
        print(f"Max stage:  {self.max_staging_bytes / 1e9:.1f} GB")
        print(f"Workers:    {self.num_workers}")
        print("=" * 70)

        start_time = time.time()

        # Start copy thread
        copy_t = Thread(target=self.copy_thread, name="copier")
        copy_t.start()

        # Start worker threads
        workers = []
        for i in range(self.num_workers):
            worker_id = f"W{i+1}"
            t = Thread(target=self.worker_thread, args=(worker_id,), name=worker_id)
            t.start()
            workers.append(t)

        # Wait for completion
        copy_t.join()
        for t in workers:
            t.join()

        # Final stats
        elapsed = time.time() - start_time
        hours = elapsed // 3600
        mins = (elapsed % 3600) // 60

        print("\n" + "=" * 70)
        print("COMPLETE!")
        print("=" * 70)
        print(f"Courses processed: {self.stats['processed']}")
        print(f"Videos processed:  {self.stats['total_videos']}")
        print(f"Failed:            {self.stats['failed']}")
        print(f"Total time:        {int(hours)}h {int(mins)}m")
        if self.stats['total_videos'] > 0:
            print(f"Avg per video:     {elapsed / self.stats['total_videos']:.1f}s")
        print("=" * 70)


def main():
    parser = argparse.ArgumentParser(
        description="Staged processor - copies to SSD for faster processing",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
This optimizes processing when videos are on a slow USB drive:
1. Copies courses one at a time to fast SSD staging area
2. Multiple workers process from SSD (fast random I/O)
3. Cleans up staging when done to make room for next course

The USB drive only does sequential copies (efficient), while all the
random I/O from ffmpeg/whisper/ollama happens on fast SSD.

Example:
  python staged_processor.py -s C:/temp/staging -w 6 --max-gb 200
        """
    )
    parser.add_argument("-i", "--input", type=Path, default=Path("W:/"),
                        help="Source directory (slow USB drive)")
    parser.add_argument("-s", "--staging", type=Path, required=True,
                        help="Staging directory (fast SSD)")
    parser.add_argument("-w", "--workers", type=int, default=4,
                        help="Number of parallel workers (default: 4)")
    parser.add_argument("--max-gb", type=float, default=100,
                        help="Max staging size in GB (default: 100)")

    args = parser.parse_args()

    if sys.platform == "win32":
        sys.stdout.reconfigure(encoding='utf-8', errors='replace')

    processor = StagedProcessor(
        source_dir=args.input,
        staging_dir=args.staging,
        num_workers=args.workers,
        max_staging_gb=args.max_gb
    )
    processor.run()

    return 0


if __name__ == "__main__":
    sys.exit(main())
