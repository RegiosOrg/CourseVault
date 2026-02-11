#!/usr/bin/env python3
"""
Webinar Transcriber - Extract audio from videos and transcribe to text.

Pipeline: MP4 -> Audio (WAV) -> Whisper.cpp -> Text
"""

import argparse
import hashlib
import json
import logging
import subprocess
import sys
from dataclasses import dataclass, field
from datetime import datetime
from pathlib import Path
from typing import Optional

# Configuration
DEFAULT_INPUT_DIR = Path("W:/")
DEFAULT_OUTPUT_DIR = Path("W:/transcripts")
DEFAULT_WHISPER_MODEL = "base.en"  # Options: tiny, base, small, medium, large
SUPPORTED_EXTENSIONS = {".mp4", ".mkv", ".avi", ".mov", ".webm", ".m4v"}


@dataclass
class GlobalProgress:
    """Global progress tracking across all courses."""

    progress_file: Path = field(default_factory=lambda: DEFAULT_OUTPUT_DIR / "progress.json")
    courses: dict = field(default_factory=dict)

    def load(self) -> None:
        if self.progress_file.exists():
            with open(self.progress_file, "r", encoding="utf-8") as f:
                data = json.load(f)
                self.courses = data.get("courses", {})

    def save(self) -> None:
        self.progress_file.parent.mkdir(parents=True, exist_ok=True)
        with open(self.progress_file, "w", encoding="utf-8") as f:
            json.dump({
                "courses": self.courses,
                "last_updated": datetime.now().isoformat(),
                "total_courses": len(self.courses),
                "completed_courses": sum(1 for c in self.courses.values() if c.get("status") == "completed")
            }, f, indent=2)

    def is_course_completed(self, course_name: str) -> bool:
        return self.courses.get(course_name, {}).get("status") == "completed"

    def mark_course_started(self, course_name: str, video_count: int) -> None:
        self.courses[course_name] = {
            "status": "in_progress",
            "started_at": datetime.now().isoformat(),
            "total_videos": video_count,
            "processed_videos": 0
        }
        self.save()

    def update_course_progress(self, course_name: str, processed: int, failed: int, current_video: str = None) -> None:
        if course_name in self.courses:
            self.courses[course_name]["processed_videos"] = processed
            self.courses[course_name]["failed_videos"] = failed
            if current_video:
                self.courses[course_name]["current_video"] = current_video
                self.courses[course_name]["last_activity"] = datetime.now().isoformat()
            self.save()

    def mark_course_completed(self, course_name: str, processed: int, failed: int) -> None:
        if course_name not in self.courses:
            self.courses[course_name] = {}
        self.courses[course_name].update({
            "status": "completed",
            "completed_at": datetime.now().isoformat(),
            "processed_videos": processed,
            "failed_videos": failed
        })
        self.save()

    def print_summary(self) -> None:
        print("\n" + "=" * 60)
        print("GLOBAL PROGRESS SUMMARY")
        print("=" * 60)
        completed = [n for n, c in self.courses.items() if c.get("status") == "completed"]
        in_progress = [n for n, c in self.courses.items() if c.get("status") == "in_progress"]
        print(f"Completed courses: {len(completed)}")
        for name in completed:
            c = self.courses[name]
            print(f"  [DONE] {name} ({c.get('processed_videos', 0)} videos)")
        if in_progress:
            print(f"In progress: {len(in_progress)}")
            for name in in_progress:
                c = self.courses[name]
                print(f"  [WIP]  {name} ({c.get('processed_videos', 0)}/{c.get('total_videos', '?')} videos)")
        print("=" * 60 + "\n")


@dataclass
class ProcessingState:
    """Tracks processing state for resume capability."""

    state_file: Path
    processed: dict = field(default_factory=dict)
    failed: dict = field(default_factory=dict)

    def load(self) -> None:
        if self.state_file.exists():
            with open(self.state_file, "r", encoding="utf-8") as f:
                data = json.load(f)
                self.processed = data.get("processed", {})
                self.failed = data.get("failed", {})

    def save(self) -> None:
        self.state_file.parent.mkdir(parents=True, exist_ok=True)
        with open(self.state_file, "w", encoding="utf-8") as f:
            json.dump({
                "processed": self.processed,
                "failed": self.failed,
                "last_updated": datetime.now().isoformat()
            }, f, indent=2)

    def is_processed(self, file_path: Path) -> bool:
        file_key = self._get_file_key(file_path)
        return file_key in self.processed

    def mark_processed(self, file_path: Path, output_path: Path) -> None:
        file_key = self._get_file_key(file_path)
        self.processed[file_key] = {
            "source": str(file_path),
            "output": str(output_path),
            "processed_at": datetime.now().isoformat(),
            "size_bytes": file_path.stat().st_size
        }
        self.save()

    def mark_failed(self, file_path: Path, error: str) -> None:
        file_key = self._get_file_key(file_path)
        self.failed[file_key] = {
            "source": str(file_path),
            "error": error,
            "failed_at": datetime.now().isoformat()
        }
        self.save()

    def _get_file_key(self, file_path: Path) -> str:
        """Generate unique key based on path and modification time."""
        stat = file_path.stat()
        key_string = f"{file_path}:{stat.st_size}:{stat.st_mtime}"
        return hashlib.md5(key_string.encode()).hexdigest()


@dataclass
class TranscriberConfig:
    """Configuration for the transcriber."""

    input_dir: Path
    output_dir: Path
    whisper_model: str
    whisper_executable: Path
    ffmpeg_executable: str = ""
    keep_audio: bool = False
    dry_run: bool = False
    retry_failed: bool = False
    
    def __post_init__(self):
        """Set defaults after initialization."""
        if not self.ffmpeg_executable:
            # Try to find bundled ffmpeg first
            bundled = find_bundled_ffmpeg()
            if bundled:
                self.ffmpeg_executable = str(bundled)
            else:
                # Fall back to PATH
                self.ffmpeg_executable = "ffmpeg"


class WebinarTranscriber:
    """Main transcriber class."""

    def __init__(self, config: TranscriberConfig):
        self.config = config
        self.state = ProcessingState(config.output_dir / ".processing_state.json")
        self.global_progress = GlobalProgress()
        self.global_progress.load()
        self.logger = self._setup_logging()
        self.course_name = config.output_dir.name

    def _setup_logging(self) -> logging.Logger:
        logger = logging.getLogger("transcriber")
        logger.setLevel(logging.INFO)

        # Console handler
        console = logging.StreamHandler()
        console.setLevel(logging.INFO)
        console.setFormatter(logging.Formatter(
            "%(asctime)s | %(levelname)-8s | %(message)s",
            datefmt="%H:%M:%S"
        ))
        logger.addHandler(console)

        # File handler
        log_file = self.config.output_dir / "transcriber.log"
        log_file.parent.mkdir(parents=True, exist_ok=True)
        file_handler = logging.FileHandler(log_file, encoding="utf-8")
        file_handler.setLevel(logging.DEBUG)
        file_handler.setFormatter(logging.Formatter(
            "%(asctime)s | %(levelname)-8s | %(message)s"
        ))
        logger.addHandler(file_handler)

        return logger

    def find_videos(self) -> list[Path]:
        """Find all video files in input directory."""
        videos = []
        for ext in SUPPORTED_EXTENSIONS:
            for video in self.config.input_dir.rglob(f"*{ext}"):
                # Skip files in folders with square brackets (e.g., [Archive])
                if "[" in str(video) and "]" in str(video):
                    continue
                videos.append(video)
        return sorted(videos)

    def extract_audio(self, video_path: Path, audio_path: Path) -> bool:
        """Extract audio from video using ffmpeg."""
        self.logger.info(f"Extracting audio: {video_path.name}")

        audio_path.parent.mkdir(parents=True, exist_ok=True)

        # Use WAV format for whisper.cpp (16kHz mono)
        cmd = [
            self.config.ffmpeg_executable,
            "-i", str(video_path),
            "-vn",                    # No video
            "-acodec", "pcm_s16le",   # 16-bit PCM
            "-ar", "16000",           # 16kHz sample rate
            "-ac", "1",               # Mono
            "-y",                     # Overwrite
            str(audio_path)
        ]

        try:
            result = subprocess.run(
                cmd,
                capture_output=True,
                text=True,
                timeout=3600  # 1 hour timeout
            )
            if result.returncode != 0:
                self.logger.error(f"ffmpeg error: {result.stderr}")
                return False
            return True
        except subprocess.TimeoutExpired:
            self.logger.error("ffmpeg timed out")
            return False
        except Exception as e:
            self.logger.error(f"ffmpeg exception: {e}")
            return False

    def transcribe_audio(self, audio_path: Path, text_path: Path) -> bool:
        """Transcribe audio using whisper.cpp."""
        self.logger.info(f"Transcribing: {audio_path.name}")

        text_path.parent.mkdir(parents=True, exist_ok=True)

        # whisper.cpp command
        cmd = [
            str(self.config.whisper_executable),
            "-m", str(self._get_model_path()),
            "-f", str(audio_path),
            "-otxt",                  # Output as text
            "-of", str(text_path.with_suffix("")),  # Output file (without extension)
            "--print-progress"
        ]

        try:
            result = subprocess.run(
                cmd,
                capture_output=True,
                text=True,
                timeout=7200  # 2 hour timeout for long videos
            )
            if result.returncode != 0:
                self.logger.error(f"whisper error: {result.stderr}")
                return False
            return True
        except subprocess.TimeoutExpired:
            self.logger.error("whisper timed out")
            return False
        except Exception as e:
            self.logger.error(f"whisper exception: {e}")
            return False

    def _get_model_path(self) -> Path:
        """Get path to whisper model file."""
        model_name = f"ggml-{self.config.whisper_model}.bin"

        # Check for bundled model first
        bundled_model = find_bundled_model(self.config.whisper_model)
        if bundled_model:
            return bundled_model

        # Check multiple locations for models
        search_paths = [
            # StarWhisper models location
            Path.home() / "AppData/Local/Programs/StarWhisper/resources/models" / model_name,
            # Relative to executable
            self.config.whisper_executable.parent / "models" / model_name,
            self.config.whisper_executable.parent.parent / "models" / model_name,
            # Standalone whisper.cpp
            Path("C:/whisper.cpp/models") / model_name,
        ]

        for path in search_paths:
            if path.exists():
                return path

        # Return first path as fallback (will error if not found)
        return search_paths[0]

    def get_output_path(self, video_path: Path) -> Path:
        """Generate output path preserving directory structure."""
        try:
            relative = video_path.relative_to(self.config.input_dir)
        except ValueError:
            relative = Path(video_path.name)

        return self.config.output_dir / relative.with_suffix(".txt")

    def get_audio_path(self, video_path: Path) -> Path:
        """Generate temporary audio path."""
        try:
            relative = video_path.relative_to(self.config.input_dir)
        except ValueError:
            relative = Path(video_path.name)

        return self.config.output_dir / "audio_temp" / relative.with_suffix(".wav")

    def process_video(self, video_path: Path) -> bool:
        """Process a single video file."""
        audio_path = self.get_audio_path(video_path)
        text_path = self.get_output_path(video_path)

        try:
            # Step 1: Extract audio
            if not self.extract_audio(video_path, audio_path):
                raise RuntimeError("Audio extraction failed")

            # Step 2: Transcribe
            if not self.transcribe_audio(audio_path, text_path):
                raise RuntimeError("Transcription failed")

            # Cleanup audio if not keeping
            if not self.config.keep_audio and audio_path.exists():
                audio_path.unlink()

            return True

        except Exception as e:
            self.logger.error(f"Processing failed: {e}")
            return False

    def run(self) -> None:
        """Run the transcription pipeline."""
        self.logger.info("=" * 60)
        self.logger.info("Webinar Transcriber Starting")
        self.logger.info(f"Input:  {self.config.input_dir}")
        self.logger.info(f"Output: {self.config.output_dir}")
        self.logger.info(f"Course: {self.course_name}")
        self.logger.info("=" * 60)

        # Check if course already completed
        if self.global_progress.is_course_completed(self.course_name):
            self.logger.info(f"Course '{self.course_name}' already fully transcribed - SKIPPING")
            self.logger.info("Use --retry-failed to reprocess")
            return

        # Load state
        self.state.load()

        # Find videos
        videos = self.find_videos()
        self.logger.info(f"Found {len(videos)} video files")

        # Filter already processed
        to_process = []
        for v in videos:
            if self.state.is_processed(v):
                self.logger.debug(f"Skipping (already processed): {v.name}")
            elif not self.config.retry_failed and str(v) in [
                f.get("source") for f in self.state.failed.values()
            ]:
                self.logger.debug(f"Skipping (previously failed): {v.name}")
            else:
                to_process.append(v)

        already_processed = len(videos) - len(to_process)
        self.logger.info(f"To process: {len(to_process)} files")
        self.logger.info(f"Already done: {already_processed} files")

        if self.config.dry_run:
            self.logger.info("DRY RUN - No files will be processed")
            for v in to_process:
                size_mb = v.stat().st_size / (1024 * 1024)
                self.logger.info(f"  Would process: {v.name} ({size_mb:.1f} MB)")
            self.global_progress.print_summary()
            return

        # Mark course as started
        if to_process:
            self.global_progress.mark_course_started(self.course_name, len(videos))

        # Process each video
        success_count = already_processed
        fail_count = 0

        for i, video_path in enumerate(to_process, 1):
            size_mb = video_path.stat().st_size / (1024 * 1024)
            self.logger.info("-" * 60)
            self.logger.info(f"[{i}/{len(to_process)}] {video_path.name} ({size_mb:.1f} MB)")

            # Update progress BEFORE processing to show current video
            self.global_progress.update_course_progress(
                self.course_name, success_count, fail_count,
                current_video=video_path.name
            )

            if self.process_video(video_path):
                output_path = self.get_output_path(video_path)
                self.state.mark_processed(video_path, output_path)
                success_count += 1
                self.logger.info(f"SUCCESS: {output_path}")
            else:
                self.state.mark_failed(video_path, "Processing failed")
                fail_count += 1
                self.logger.error(f"FAILED: {video_path}")

            # Update global progress after completion
            self.global_progress.update_course_progress(self.course_name, success_count, fail_count)

        # Mark course completed if all done
        if len(to_process) == 0 or (success_count + fail_count) >= len(videos):
            self.global_progress.mark_course_completed(self.course_name, success_count, fail_count)

        # Summary
        self.logger.info("=" * 60)
        self.logger.info("COMPLETE")
        self.logger.info(f"  Processed: {success_count}")
        self.logger.info(f"  Failed:    {fail_count}")
        self.logger.info("=" * 60)

        # Print global progress
        self.global_progress.print_summary()


def get_bundled_resources_path() -> Optional[Path]:
    """Get path to bundled resources (when running from packaged app)."""
    # When packaged with PyInstaller, sys._MEIPASS contains the extracted files
    if hasattr(sys, '_MEIPASS'):
        return Path(sys._MEIPASS)
    
    # When running from electron app resources (production)
    # The resources are in the same directory as the executable's parent
    exe_dir = Path(sys.executable).parent if getattr(sys, 'frozen', False) else None
    if exe_dir:
        # Check if resources exist alongside
        resources_path = exe_dir.parent / 'resources'
        if resources_path.exists():
            return resources_path
    
    # Development: check relative to script location
    script_dir = Path(__file__).parent
    dev_resources = script_dir.parent / 'resources'
    if dev_resources.exists():
        return dev_resources
    
    return None


def find_bundled_whisper() -> Optional[Path]:
    """Find whisper.cpp in bundled resources."""
    resources = get_bundled_resources_path()
    if not resources:
        return None
    
    whisper_path = resources / 'bin' / 'whisper' / 'whisper-cli.exe'
    if whisper_path.exists():
        return whisper_path
    
    return None


def find_bundled_ffmpeg() -> Optional[Path]:
    """Find ffmpeg in bundled resources."""
    resources = get_bundled_resources_path()
    if not resources:
        return None
    
    ffmpeg_path = resources / 'bin' / 'ffmpeg' / 'ffmpeg.exe'
    if ffmpeg_path.exists():
        return ffmpeg_path
    
    return None


def find_bundled_model(model_name: str) -> Optional[Path]:
    """Find whisper model in bundled resources."""
    resources = get_bundled_resources_path()
    if not resources:
        return None
    
    model_file = f"ggml-{model_name}.bin"
    model_path = resources / 'models' / model_file
    if model_path.exists():
        return model_path
    
    return None


def find_whisper_executable(require_gpu: bool = False) -> Optional[Path]:
    """Try to find whisper.cpp executable. Prefers GPU/CUDA version."""
    
    # First, check for bundled version (always prefer bundled for consistency)
    bundled = find_bundled_whisper()
    if bundled:
        print(f"[BUNDLED] Using whisper: {bundled}")
        return bundled

    # GPU/CUDA paths - these run on GPU
    cuda_paths = [
        Path.home() / "AppData/Local/Programs/StarWhisper/resources/bin/cuda11/whisper-cli-cuda.exe",
        Path.home() / "AppData/Local/Programs/StarWhisper/resources/bin/cuda12/whisper-cli-cuda.exe",
        Path("C:/whisper.cpp/build/bin/Release/whisper-cli-cuda.exe"),
        Path("C:/whisper.cpp/Release/whisper-cli-cuda.exe"),
    ]

    # CPU-only paths
    cpu_paths = [
        Path.home() / "AppData/Local/Programs/StarWhisper/resources/bin/whisper-cli.exe",
        Path("C:/whisper.cpp/Release/whisper-cli.exe"),
        Path("C:/whisper.cpp/whisper-cli.exe"),
        Path("C:/whisper.cpp/Release/main.exe"),
        Path("C:/whisper.cpp/main.exe"),
    ]

    # If GPU is required, only check CUDA paths first
    if require_gpu:
        for path in cuda_paths:
            if path.exists():
                print(f"[GPU] Using CUDA whisper: {path}")
                return path
        print("[GPU] WARNING: GPU requested but no CUDA whisper executable found!")
        print("[GPU] Checked paths:")
        for path in cuda_paths:
            print(f"  - {path} (not found)")

    # Check all paths (CUDA first, then CPU)
    all_paths = cuda_paths + cpu_paths
    for path in all_paths:
        if path.exists():
            is_cuda = "cuda" in path.name.lower() or "cuda" in str(path).lower()
            print(f"[{'GPU' if is_cuda else 'CPU'}] Using whisper: {path}")
            return path

    # Try PATH
    try:
        result = subprocess.run(
            ["where", "main.exe"],
            capture_output=True,
            text=True
        )
        if result.returncode == 0:
            return Path(result.stdout.strip().split("\n")[0])
    except Exception:
        pass

    return None


def main():
    parser = argparse.ArgumentParser(
        description="Transcribe video webinars to text",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Examples:
  %(prog)s                          # Process W:/ with defaults
  %(prog)s -i "D:/Videos" -o "D:/Transcripts"
  %(prog)s --dry-run                # Preview without processing
  %(prog)s --retry-failed           # Retry previously failed files
  %(prog)s --model medium           # Use larger model for better accuracy
        """
    )

    parser.add_argument(
        "-i", "--input",
        type=Path,
        default=DEFAULT_INPUT_DIR,
        help=f"Input directory (default: {DEFAULT_INPUT_DIR})"
    )
    parser.add_argument(
        "-o", "--output",
        type=Path,
        default=DEFAULT_OUTPUT_DIR,
        help=f"Output directory (default: {DEFAULT_OUTPUT_DIR})"
    )
    parser.add_argument(
        "-m", "--model",
        default=DEFAULT_WHISPER_MODEL,
        choices=["tiny", "tiny.en", "base", "base.en", "small", "small.en",
                 "medium", "medium.en", "large", "large-v2", "large-v3"],
        help=f"Whisper model (default: {DEFAULT_WHISPER_MODEL})"
    )
    parser.add_argument(
        "-w", "--whisper",
        type=Path,
        help="Path to whisper.cpp executable (main.exe)"
    )
    parser.add_argument(
        "--keep-audio",
        action="store_true",
        help="Keep extracted audio files"
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="List files without processing"
    )
    parser.add_argument(
        "--retry-failed",
        action="store_true",
        help="Retry previously failed files"
    )
    parser.add_argument(
        "--gpu",
        action="store_true",
        help="Require GPU/CUDA acceleration (fail if not available)"
    )

    args = parser.parse_args()

    # Find whisper executable
    whisper_exe = args.whisper or find_whisper_executable(require_gpu=args.gpu)
    if not whisper_exe:
        print("ERROR: Could not find whisper.cpp executable.")
        print("Please specify with --whisper or install whisper.cpp")
        print("Download: https://github.com/ggerganov/whisper.cpp")
        sys.exit(1)

    if not whisper_exe.exists():
        print(f"ERROR: Whisper executable not found: {whisper_exe}")
        sys.exit(1)

    # Check ffmpeg
    try:
        subprocess.run(["ffmpeg", "-version"], capture_output=True)
    except FileNotFoundError:
        print("ERROR: ffmpeg not found in PATH")
        print("Please install ffmpeg: https://ffmpeg.org/download.html")
        sys.exit(1)

    # Validate input directory
    if not args.input.exists():
        print(f"ERROR: Input directory not found: {args.input}")
        sys.exit(1)

    # Auto-create course subfolder in output directory
    # e.g., input "W:/ADmission - TikTok Playbook" -> output "W:/transcripts/ADmission - TikTok Playbook"
    course_name = args.input.name
    output_dir = args.output / course_name

    config = TranscriberConfig(
        input_dir=args.input,
        output_dir=output_dir,
        whisper_model=args.model,
        whisper_executable=whisper_exe,
        keep_audio=args.keep_audio,
        dry_run=args.dry_run,
        retry_failed=args.retry_failed
    )

    transcriber = WebinarTranscriber(config)
    transcriber.run()


if __name__ == "__main__":
    main()
