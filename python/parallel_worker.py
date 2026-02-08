#!/usr/bin/env python3
"""
Parallel worker for processing courses concurrently.
Uses file-based locking to safely claim and process courses without conflicts.
"""

import argparse
import json
import os
import subprocess
import sys
import time
import uuid
from datetime import datetime
from pathlib import Path
from typing import Optional

# Constants
TRANSCRIPTS_DIR = Path("W:/transcripts")
PROGRESS_FILE = TRANSCRIPTS_DIR / "progress.json"
LOCK_FILE = TRANSCRIPTS_DIR / "progress.lock"
SUPPORTED_EXTENSIONS = {".mp4", ".mkv", ".avi", ".mov", ".webm", ".m4v"}

# ANSI Color codes for Windows 10+ (native ANSI support)
class Colors:
    RESET = "\033[0m"
    BOLD = "\033[1m"
    DIM = "\033[2m"
    RED = "\033[31m"
    GREEN = "\033[32m"
    YELLOW = "\033[33m"
    BLUE = "\033[34m"
    MAGENTA = "\033[35m"
    CYAN = "\033[36m"
    WHITE = "\033[37m"
    BRIGHT_GREEN = "\033[92m"
    BRIGHT_YELLOW = "\033[93m"
    BRIGHT_CYAN = "\033[96m"

# Enable ANSI colors on Windows
if sys.platform == "win32":
    import ctypes
    kernel32 = ctypes.windll.kernel32
    # Enable virtual terminal processing for ANSI colors
    STD_OUTPUT_HANDLE = -11
    ENABLE_VIRTUAL_TERMINAL_PROCESSING = 0x0004
    mode = ctypes.c_ulong()
    kernel32.GetConsoleMode(kernel32.GetStdHandle(STD_OUTPUT_HANDLE), ctypes.byref(mode))
    kernel32.SetConsoleMode(kernel32.GetStdHandle(STD_OUTPUT_HANDLE), mode.value | ENABLE_VIRTUAL_TERMINAL_PROCESSING)


class FileLock:
    """Simple file-based lock for cross-process synchronization."""

    def __init__(self, lock_path: Path, timeout: float = 30.0):
        self.lock_path = lock_path
        self.timeout = timeout
        self.acquired = False

    def __enter__(self):
        start = time.time()
        while time.time() - start < self.timeout:
            try:
                # Exclusive create - fails if file exists
                fd = os.open(str(self.lock_path), os.O_CREAT | os.O_EXCL | os.O_WRONLY)
                os.write(fd, str(os.getpid()).encode())
                os.close(fd)
                self.acquired = True
                return self
            except FileExistsError:
                # Check if lock is stale (older than 60 seconds)
                try:
                    if self.lock_path.exists():
                        age = time.time() - self.lock_path.stat().st_mtime
                        if age > 60:  # Stale lock
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
    """Load progress file with locking."""
    if not PROGRESS_FILE.exists():
        return {"courses": {}, "last_updated": None}
    try:
        with open(PROGRESS_FILE, "r", encoding="utf-8") as f:
            return json.load(f)
    except Exception:
        return {"courses": {}, "last_updated": None}


def save_progress(data: dict) -> None:
    """Save progress file."""
    PROGRESS_FILE.parent.mkdir(parents=True, exist_ok=True)
    data["last_updated"] = datetime.now().isoformat()
    with open(PROGRESS_FILE, "w", encoding="utf-8") as f:
        json.dump(data, f, indent=2)


def get_global_progress(input_dir: Path) -> tuple[int, int, int]:
    """Get global progress: (completed_count, total_count, percentage)"""
    progress = load_progress()
    courses = progress.get("courses", {})
    
    # Count total courses
    all_courses = get_all_courses(input_dir)
    total_count = len(all_courses)
    
    # Count completed courses
    completed_count = sum(1 for name, data in courses.items() 
                          if data.get("status") == "completed")
    
    # Calculate percentage
    percentage = int((completed_count / total_count * 100) if total_count > 0 else 0)
    
    return completed_count, total_count, percentage


def get_progress_bar(percentage: int, width: int = 20) -> str:
    """Generate a visual progress bar."""
    filled = int(width * percentage / 100)
    bar = "█" * filled + "░" * (width - filled)
    
    # Color based on progress
    if percentage < 30:
        color = Colors.RED
    elif percentage < 70:
        color = Colors.YELLOW
    else:
        color = Colors.GREEN
    
    return f"{color}[{bar}]{Colors.RESET} {percentage:3d}%"


def progress_print(message: str, input_dir: Path, worker_id: str = "") -> None:
    """Print message with global progress indicator on every line."""
    completed, total, percentage = get_global_progress(input_dir)
    
    # Build progress prefix
    progress_str = f"{Colors.BRIGHT_CYAN}[{completed}/{total} {get_progress_bar(percentage)}]{Colors.RESET} "
    if worker_id:
        progress_str += f"{Colors.MAGENTA}[{worker_id[:8]}]{Colors.RESET} "
    
    # Print each line with progress prefix
    for line in message.split('\n'):
        if line.strip():
            print(progress_str + line)


def subprocess_with_progress(cmd: list, input_dir: Path, worker_id: str = "") -> int:
    """Run subprocess and prefix all output with progress indicator."""
    process = subprocess.Popen(
        cmd,
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        text=True,
        encoding='utf-8',
        errors='replace',
        bufsize=1  # Line buffered
    )
    
    for line in process.stdout:
        line = line.rstrip('\n\r')
        if line:
            progress_print(line, input_dir, worker_id)
    
    return process.wait()


def get_all_courses(input_dir: Path) -> list[Path]:
    """Find all course directories with video files."""
    skip_folders = {"$RECYCLE.BIN", "System Volume Information", ".Trash", "transcripts"}

    courses = []
    for item in input_dir.iterdir():
        if not item.is_dir():
            continue
        if item.name.startswith(".") or item.name.startswith("$"):
            continue
        if item.name in skip_folders or "[" in item.name:
            continue
        has_videos = any(
            f.suffix.lower() in SUPPORTED_EXTENSIONS
            for f in item.rglob("*")
        )
        if has_videos:
            courses.append(item)
    return sorted(courses, key=lambda p: p.name)


def count_videos(course_path: Path) -> int:
    """Count video files in a course."""
    return sum(
        1 for f in course_path.rglob("*")
        if f.suffix.lower() in SUPPORTED_EXTENSIONS
    )


def claim_course(worker_id: str, input_dir: Path) -> Optional[Path]:
    """
    Atomically claim an unclaimed course.
    Returns the course path if claimed, None if no courses available.
    """
    with FileLock(LOCK_FILE):
        progress = load_progress()
        courses = progress.get("courses", {})

        # Find all available courses
        all_courses = get_all_courses(input_dir)

        for course in all_courses:
            course_name = course.name
            course_data = courses.get(course_name, {})

            # Skip if completed in progress.json
            if course_data.get("status") == "completed":
                continue

            # Also check if transcripts already exist (might be pre-existing)
            transcript_dir = TRANSCRIPTS_DIR / course_name
            if transcript_dir.exists():
                transcripts = list(transcript_dir.rglob("*.txt"))
                transcripts = [t for t in transcripts
                              if not t.name.endswith(".summary.md")
                              and t.name != "transcriber.log"]
                video_count = count_videos(course)

                # If all videos already transcribed, mark complete and skip
                if len(transcripts) >= video_count and video_count > 0:
                    courses[course_name] = {
                        "status": "completed",
                        "claimed_by": "pre-existing",
                        "claimed_at": datetime.now().isoformat(),
                        "total_videos": video_count,
                        "processed_videos": len(transcripts),
                        "completed_at": datetime.now().isoformat(),
                        "failed_videos": 0
                    }
                    progress["courses"] = courses
                    save_progress(progress)
                    print(f"[{worker_id[:8]}] Skipping {course_name} - already complete ({len(transcripts)}/{video_count})")
                    continue

            # Skip if claimed by another worker (and claim is recent)
            claimed_by = course_data.get("claimed_by")
            claimed_at = course_data.get("claimed_at")
            if claimed_by and claimed_by != worker_id and claimed_at:
                try:
                    claim_time = datetime.fromisoformat(claimed_at)
                    age = (datetime.now() - claim_time).total_seconds()
                    # Stale claim if older than 2 hours
                    if age < 7200:
                        continue
                except Exception:
                    pass

            # Claim this course - preserve existing progress if resuming
            video_count = count_videos(course)
            existing_progress = course_data.get("processed_videos", 0) if course_data else 0

            courses[course_name] = {
                "status": "in_progress",
                "claimed_by": worker_id,
                "claimed_at": datetime.now().isoformat(),
                "total_videos": video_count,
                "processed_videos": existing_progress,  # Preserve progress when resuming
                "worker_started": datetime.now().isoformat()
            }
            progress["courses"] = courses
            save_progress(progress)

            if existing_progress > 0:
                print(f"[{worker_id[:8]}] Resuming {course_name} at {existing_progress}/{video_count} videos")

            return course

    return None


def release_course(course_name: str, worker_id: str, processed: int, failed: int) -> None:
    """Mark a course as completed and release the claim."""
    with FileLock(LOCK_FILE):
        progress = load_progress()
        courses = progress.get("courses", {})

        if course_name in courses:
            courses[course_name].update({
                "status": "completed",
                "claimed_by": None,
                "completed_at": datetime.now().isoformat(),
                "completed_by": worker_id,
                "processed_videos": processed,
                "failed_videos": failed
            })
            progress["courses"] = courses
            save_progress(progress)


def update_course_progress(course_name: str, processed: int) -> None:
    """Update progress for a course (non-blocking, best effort)."""
    try:
        with FileLock(LOCK_FILE, timeout=5.0):
            progress = load_progress()
            if course_name in progress.get("courses", {}):
                progress["courses"][course_name]["processed_videos"] = processed
                save_progress(progress)
    except TimeoutError:
        pass  # Skip update if lock not available


def process_course(course: Path, worker_id: str, input_dir: Path, use_gpu: bool = False) -> tuple[int, int]:
    """Process a single course: transcribe, summarize, generate course summary."""
    course_name = course.name
    transcript_dir = TRANSCRIPTS_DIR / course_name

    progress_print(f"\n{Colors.BOLD}Processing: {course_name}{Colors.RESET}", input_dir, worker_id)
    progress_print(f"Videos: {count_videos(course)}", input_dir, worker_id)

    # Step 1: Transcribe
    gpu_status = f" {Colors.GREEN}(GPU){Colors.RESET}" if use_gpu else ""
    progress_print(f"{Colors.YELLOW}[1/3]{Colors.RESET} Transcribing{gpu_status}...", input_dir, worker_id)
    trans_cmd = [
        sys.executable,
        str(Path(__file__).parent / "transcriber.py"),
        "-i", str(course)
    ]
    if use_gpu:
        trans_cmd.append("--gpu")
    subprocess_with_progress(trans_cmd, input_dir, worker_id)

    # Step 2: Video summaries
    progress_print(f"{Colors.YELLOW}[2/3]{Colors.RESET} Generating video summaries...", input_dir, worker_id)
    summ_cmd = [
        sys.executable,
        str(Path(__file__).parent / "video_summaries.py"),
        str(transcript_dir)
    ]
    subprocess_with_progress(summ_cmd, input_dir, worker_id)

    # Step 3: Course summary
    progress_print(f"{Colors.YELLOW}[3/3]{Colors.RESET} Generating course summary...", input_dir, worker_id)
    course_cmd = [
        sys.executable,
        str(Path(__file__).parent / "course_summary.py"),
        str(transcript_dir)
    ]
    subprocess_with_progress(course_cmd, input_dir, worker_id)

    # Count results
    processed = sum(1 for f in transcript_dir.rglob("*.txt")
                    if not f.name.endswith(".summary.md") and f.name != "transcriber.log")
    failed = 0  # Could parse state file if needed

    return processed, failed


def worker_loop(worker_id: str, input_dir: Path, max_courses: int = 0, use_gpu: bool = False) -> None:
    """Main worker loop - claim and process courses until none left."""
    courses_done = 0

    # Initial header (without progress prefix)
    print(f"\n{'='*60}")
    print(f"PARALLEL WORKER STARTED")
    print(f"{'='*60}")
    print(f"Worker ID: {worker_id[:8]}...")
    print(f"Input dir: {input_dir}")
    print(f"Max courses: {max_courses if max_courses else 'unlimited'}")
    print(f"GPU acceleration: {'ENABLED' if use_gpu else 'disabled'}")
    print(f"{'='*60}")

    while True:
        # Check if we've hit max courses
        if max_courses and courses_done >= max_courses:
            progress_print(f"{Colors.RED}Reached max courses limit ({max_courses}){Colors.RESET}", input_dir, worker_id)
            break

        # Try to claim a course
        course = claim_course(worker_id, input_dir)
        if not course:
            progress_print(f"{Colors.YELLOW}No more courses to process{Colors.RESET}", input_dir, worker_id)
            break

        # Process the course
        start_time = time.time()
        try:
            processed, failed = process_course(course, worker_id, input_dir, use_gpu)
            elapsed = time.time() - start_time

            # Mark as completed
            release_course(course.name, worker_id, processed, failed)
            courses_done += 1

            progress_print(f"\n{Colors.GREEN}COMPLETED: {course.name}{Colors.RESET}", input_dir, worker_id)
            progress_print(f"Videos: {processed}, Failed: {failed}", input_dir, worker_id)
            progress_print(f"Time: {elapsed/60:.1f} minutes", input_dir, worker_id)
            progress_print(f"Total courses done by this worker: {courses_done}", input_dir, worker_id)

            # Regenerate index
            progress_print(f"{Colors.DIM}Updating index...{Colors.RESET}", input_dir, worker_id)
            subprocess_with_progress([sys.executable, str(Path(__file__).parent / "generate_index.py")], input_dir, worker_id)

        except Exception as e:
            progress_print(f"\n{Colors.RED}ERROR processing {course.name}: {e}{Colors.RESET}", input_dir, worker_id)
            # Release with error state
            release_course(course.name, worker_id, 0, 1)

    # Final header (without progress prefix)
    print(f"\n{'='*60}")
    print(f"WORKER {worker_id[:8]} FINISHED")
    print(f"Courses processed: {courses_done}")
    print(f"{'='*60}")


def show_status() -> None:
    """Show current parallel processing status."""
    progress = load_progress()
    courses = progress.get("courses", {})

    completed = [(n, c) for n, c in courses.items() if c.get("status") == "completed"]
    in_progress = [(n, c) for n, c in courses.items() if c.get("status") == "in_progress"]

    print(f"\n{'='*60}")
    print(f"PARALLEL PROCESSING STATUS")
    print(f"{'='*60}")
    print(f"Completed: {len(completed)}")
    print(f"In progress: {len(in_progress)}")

    if in_progress:
        print(f"\nACTIVE WORKERS:")
        for name, data in in_progress:
            worker = data.get("claimed_by", "unknown")[:8]
            videos = data.get("processed_videos", 0)
            total = data.get("total_videos", "?")
            started = data.get("claimed_at", "")[:19]
            print(f"  [{worker}] {name} ({videos}/{total} videos) - started {started}")

    print(f"{'='*60}")


def main():
    parser = argparse.ArgumentParser(description="Parallel course processing worker")
    parser.add_argument("-i", "--input", type=Path, default=Path("W:/"),
                        help="Input directory containing courses")
    parser.add_argument("-n", "--max-courses", type=int, default=0,
                        help="Max courses to process (0 = unlimited)")
    parser.add_argument("--status", action="store_true",
                        help="Show current processing status")
    parser.add_argument("--worker-id", type=str, default=None,
                        help="Worker ID (auto-generated if not specified)")
    parser.add_argument("--gpu", action="store_true",
                        help="Force GPU/CUDA acceleration for transcription")

    args = parser.parse_args()

    # Fix Unicode on Windows
    if sys.platform == "win32":
        sys.stdout.reconfigure(encoding='utf-8', errors='replace')

    if args.status:
        show_status()
        return 0

    # Generate unique worker ID
    worker_id = args.worker_id or str(uuid.uuid4())

    worker_loop(worker_id, args.input, args.max_courses, args.gpu)
    return 0


if __name__ == "__main__":
    sys.exit(main())
