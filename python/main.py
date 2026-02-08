#!/usr/bin/env python3
"""
Webinar Transcriber - Complete pipeline for video webinars.

Pipeline:
1. Extract audio from videos (ffmpeg)
2. Transcribe audio to text (whisper.cpp)
3. Generate AI summaries (Ollama/LM Studio)
4. Query and search interface
"""

import argparse
import subprocess
import sys
from pathlib import Path


def run_transcriber(args):
    """Run the transcription pipeline."""
    cmd = [sys.executable, str(Path(__file__).parent / "transcriber.py")]

    if hasattr(args, "input") and args.input:
        cmd.extend(["-i", str(args.input)])
    if hasattr(args, "output") and args.output:
        cmd.extend(["-o", str(args.output)])
    if hasattr(args, "model") and args.model:
        cmd.extend(["-m", args.model])
    if hasattr(args, "whisper") and args.whisper:
        cmd.extend(["-w", str(args.whisper)])
    if hasattr(args, "dry_run") and args.dry_run:
        cmd.append("--dry-run")
    if hasattr(args, "retry_failed") and args.retry_failed:
        cmd.append("--retry-failed")
    if hasattr(args, "keep_audio") and args.keep_audio:
        cmd.append("--keep-audio")

    return subprocess.call(cmd)


def run_summarizer(args):
    """Run the summarization pipeline."""
    cmd = [sys.executable, str(Path(__file__).parent / "summarizer.py")]

    if hasattr(args, "input") and args.input:
        cmd.extend(["-i", str(args.input)])
    if hasattr(args, "backend") and args.backend:
        cmd.extend(["--backend", args.backend])
    if hasattr(args, "model") and args.model:
        cmd.extend(["--model", args.model])
    if hasattr(args, "force") and args.force:
        cmd.append("--force")

    return subprocess.call(cmd)


def run_query(args):
    """Run the query interface."""
    cmd = [sys.executable, str(Path(__file__).parent / "query.py")]

    if hasattr(args, "dir") and args.dir:
        cmd.extend(["-d", str(args.dir)])

    return subprocess.call(cmd)


def run_course_summary(args):
    """Generate master course summaries."""
    cmd = [sys.executable, str(Path(__file__).parent / "course_summary.py")]

    if hasattr(args, "all") and args.all:
        cmd.append("--all")
    elif hasattr(args, "course_dir") and args.course_dir:
        cmd.append(str(args.course_dir))

    return subprocess.call(cmd)


def run_video_summaries(args):
    """Generate per-video summaries."""
    cmd = [sys.executable, str(Path(__file__).parent / "video_summaries.py")]

    if hasattr(args, "all") and args.all:
        cmd.append("--all")
    elif hasattr(args, "course_dir") and args.course_dir:
        cmd.append(str(args.course_dir))

    return subprocess.call(cmd)


def run_chat(args):
    """Run AI chat interface."""
    cmd = [sys.executable, str(Path(__file__).parent / "chat.py")]
    return subprocess.call(cmd)


def run_server(args):
    """Start course library web server with chat."""
    cmd = [sys.executable, str(Path(__file__).parent / "course_library_server.py")]
    if hasattr(args, "host") and args.host != "localhost":
        cmd.extend(["--host", args.host])
    if hasattr(args, "port") and args.port != 8080:
        cmd.extend(["--port", str(args.port)])
    return subprocess.call(cmd)


def run_all(args):
    """Transcribe ALL courses on W: drive."""
    import json
    import time

    # Fix Unicode output on Windows
    if sys.platform == "win32":
        sys.stdout.reconfigure(encoding='utf-8', errors='replace')

    input_dir = Path(args.input) if hasattr(args, "input") and args.input else Path("W:/")
    transcripts_dir = Path("W:/transcripts")
    progress_file = transcripts_dir / "progress.json"

    # Load global progress
    global_progress = {}
    if progress_file.exists():
        try:
            with open(progress_file, "r", encoding="utf-8") as f:
                global_progress = json.load(f).get("courses", {})
        except Exception:
            pass

    # Find all folders (courses) - skip folders with brackets
    courses = []
    for item in input_dir.iterdir():
        if item.is_dir() and not item.name.startswith(".") and "[" not in item.name:
            # Check if it has video files
            has_videos = any(
                f.suffix.lower() in {".mp4", ".mkv", ".avi", ".mov", ".webm"}
                for f in item.rglob("*")
            )
            if has_videos:
                courses.append(item)

    # Separate completed vs pending
    completed = []
    pending = []
    for course in courses:
        if global_progress.get(course.name, {}).get("status") == "completed":
            completed.append(course)
        else:
            pending.append(course)

    print("=" * 60)
    print("GLOBAL PROGRESS")
    print("=" * 60)
    print(f"Total courses found: {len(courses)}")
    print(f"Already completed:   {len(completed)}")
    print(f"Pending:             {len(pending)}")
    print()

    if completed:
        print("Completed courses:")
        for c in completed:
            info = global_progress.get(c.name, {})
            videos = info.get("processed_videos", "?")
            print(f"  [DONE] {c.name} ({videos} videos)")
        print()

    # Count total videos in pending courses
    total_videos = 0
    course_video_counts = {}
    for c in pending:
        video_count = sum(
            1 for f in c.rglob("*")
            if f.suffix.lower() in {".mp4", ".mkv", ".avi", ".mov", ".webm"}
        )
        course_video_counts[c.name] = video_count
        total_videos += video_count

    if pending:
        print("Courses to process:")
        for i, c in enumerate(pending, 1):
            print(f"  {i}. {c.name} ({course_video_counts[c.name]} videos)")
        print()
        print(f"TOTAL: {len(pending)} courses, {total_videos} videos")
        print()

    if hasattr(args, "dry_run") and args.dry_run:
        print("Dry run - no processing")
        return 0

    if not pending:
        print("All courses already transcribed!")
        print(f"Index: {transcripts_dir / 'index.html'}")
        return 0

    # Progress tracking
    start_time = time.time()
    videos_processed = 0
    courses_processed = 0

    # Process each pending course
    for i, course in enumerate(pending, 1):
        course_start = time.time()
        course_videos = course_video_counts[course.name]

        print(f"\n{'='*70}")
        print(f"COURSE [{i}/{len(pending)}] {course.name}")
        print(f"Videos in this course: {course_videos}")
        print(f"Global progress: {videos_processed}/{total_videos} videos ({100*videos_processed//total_videos if total_videos else 0}%)")

        # Time estimate
        if videos_processed > 0:
            elapsed = time.time() - start_time
            avg_per_video = elapsed / videos_processed
            remaining_videos = total_videos - videos_processed
            eta_seconds = remaining_videos * avg_per_video
            eta_hours = eta_seconds // 3600
            eta_mins = (eta_seconds % 3600) // 60
            print(f"Estimated time remaining: {int(eta_hours)}h {int(eta_mins)}m ({remaining_videos} videos left)")

        print("="*70)

        # Transcribe
        trans_cmd = [sys.executable, str(Path(__file__).parent / "transcriber.py"),
                     "-i", str(course)]
        subprocess.call(trans_cmd)

        # Video summaries
        summ_cmd = [sys.executable, str(Path(__file__).parent / "video_summaries.py"),
                    str(transcripts_dir / course.name)]
        subprocess.call(summ_cmd)

        # Course summary
        course_cmd = [sys.executable, str(Path(__file__).parent / "course_summary.py"),
                      str(transcripts_dir / course.name)]
        subprocess.call(course_cmd)

        # Update progress
        videos_processed += course_videos
        courses_processed += 1
        course_elapsed = time.time() - course_start

        print(f"\n[DONE] {course.name} - took {course_elapsed//60:.0f}m {course_elapsed%60:.0f}s")

        # Regenerate index after each course so progress is visible
        print(f"Updating index ({i}/{len(pending)} courses done)...")
        subprocess.call([sys.executable, str(Path(__file__).parent / "generate_index.py")])

    # Final index regeneration
    print("\n" + "="*70)
    print("Final index update...")
    print("="*70)
    subprocess.call([sys.executable, str(Path(__file__).parent / "generate_index.py")])

    # Final summary
    total_elapsed = time.time() - start_time
    hours = total_elapsed // 3600
    mins = (total_elapsed % 3600) // 60
    secs = total_elapsed % 60

    print("\n" + "="*70)
    print("ALL COMPLETE!")
    print("="*70)
    print(f"  Courses processed:  {len(pending)}")
    print(f"  Videos processed:   {total_videos}")
    print(f"  Total time:         {int(hours)}h {int(mins)}m {int(secs)}s")
    if total_videos > 0:
        avg = total_elapsed / total_videos
        print(f"  Avg per video:      {avg:.1f}s")
    print(f"  Previously done:    {len(completed)} courses")
    print(f"  Index:              {transcripts_dir / 'index.html'}")
    print("="*70)

    return 0


def run_generate_index(args):
    """Generate HTML index."""
    cmd = [sys.executable, str(Path(__file__).parent / "generate_index.py")]
    return subprocess.call(cmd)


def run_parallel(args):
    """Run multiple parallel workers to process courses concurrently."""
    import time

    # Fix Unicode output on Windows
    if sys.platform == "win32":
        sys.stdout.reconfigure(encoding='utf-8', errors='replace')

    num_workers = args.workers if hasattr(args, "workers") and args.workers else 2
    input_dir = args.input if hasattr(args, "input") and args.input else Path("W:/")

    print("=" * 70)
    print(f"STARTING {num_workers} PARALLEL WORKERS")
    print("=" * 70)
    print(f"Input directory: {input_dir}")
    print()
    print("TIP: Open multiple terminals to monitor each worker, or check")
    print("     progress with: python main.py status")
    print()
    print("Starting workers...")
    print("=" * 70)

    # Spawn worker processes
    import uuid
    processes = []
    worker_script = Path(__file__).parent / "parallel_worker.py"

    for i in range(num_workers):
        worker_id = str(uuid.uuid4())
        cmd = [
            sys.executable,
            str(worker_script),
            "-i", str(input_dir),
            "--worker-id", worker_id
        ]
        print(f"  Starting worker {i+1}/{num_workers} (ID: {worker_id[:8]}...)")

        # Start process without waiting
        proc = subprocess.Popen(
            cmd,
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            text=True,
            encoding='utf-8',
            errors='replace'
        )
        processes.append((worker_id[:8], proc))

        # Stagger starts slightly to reduce lock contention
        time.sleep(1)

    print()
    print(f"All {num_workers} workers started!")
    print()
    print("Streaming output from all workers (Ctrl+C to stop):")
    print("-" * 70)

    # Monitor all processes and stream their output
    try:
        active = list(processes)
        while active:
            for worker_id, proc in active[:]:
                line = proc.stdout.readline()
                if line:
                    print(f"[{worker_id}] {line.rstrip()}")
                elif proc.poll() is not None:
                    # Process finished
                    active.remove((worker_id, proc))
                    print(f"[{worker_id}] Worker finished (exit code: {proc.returncode})")
            time.sleep(0.01)
    except KeyboardInterrupt:
        print("\n\nStopping workers...")
        for _, proc in processes:
            proc.terminate()

    print()
    print("=" * 70)
    print("All workers finished!")
    print("Run 'python main.py status' to see progress")
    print("=" * 70)

    return 0


def run_status(args):
    """Show progress status for all courses."""
    import json

    # Fix Unicode output on Windows
    if sys.platform == "win32":
        sys.stdout.reconfigure(encoding='utf-8', errors='replace')

    transcripts_dir = Path("W:/transcripts")
    progress_file = transcripts_dir / "progress.json"
    input_dir = Path("W:/")

    print("=" * 70)
    print("TRANSCRIPTION PROGRESS STATUS")
    print("=" * 70)

    # Count all available courses on W: drive
    all_courses = []
    for item in input_dir.iterdir():
        if item.is_dir() and not item.name.startswith(".") and "[" not in item.name:
            has_videos = any(
                f.suffix.lower() in {".mp4", ".mkv", ".avi", ".mov", ".webm"}
                for f in item.rglob("*")
            )
            if has_videos:
                all_courses.append(item.name)

    # Load progress
    progress_data = {}
    if progress_file.exists():
        with open(progress_file, "r", encoding="utf-8") as f:
            data = json.load(f)
            progress_data = data.get("courses", {})

    completed = [n for n in all_courses if progress_data.get(n, {}).get("status") == "completed"]
    in_progress = [n for n in all_courses if progress_data.get(n, {}).get("status") == "in_progress"]
    pending = [n for n in all_courses if n not in completed and n not in in_progress]

    total_videos_done = sum(progress_data.get(n, {}).get("processed_videos", 0) for n in completed)

    # Estimate total videos (rough)
    print(f"Total courses on W: drive:  {len(all_courses)}")
    print(f"Completed:                  {len(completed)} ({100*len(completed)//len(all_courses) if all_courses else 0}%)")
    print(f"In progress:                {len(in_progress)}")
    print(f"Pending:                    {len(pending)}")
    print(f"Total videos transcribed:   {total_videos_done}")
    print()

    # Progress bar
    if all_courses:
        pct = len(completed) / len(all_courses)
        bar_width = 50
        filled = int(bar_width * pct)
        bar = "█" * filled + "░" * (bar_width - filled)
        print(f"[{bar}] {100*pct:.1f}%")
        print()

    if completed:
        print(f"COMPLETED ({len(completed)}):")
        for name in sorted(completed)[:10]:  # Show first 10
            info = progress_data.get(name, {})
            videos = info.get("processed_videos", "?")
            print(f"  ✓ {name} ({videos} videos)")
        if len(completed) > 10:
            print(f"  ... and {len(completed) - 10} more")
        print()

    if in_progress:
        print(f"IN PROGRESS ({len(in_progress)}):")
        for name in in_progress:
            info = progress_data.get(name, {})
            processed = info.get("processed_videos", 0)
            total = info.get("total_videos", "?")
            worker = info.get("claimed_by", "")[:8] if info.get("claimed_by") else ""
            worker_str = f" [worker {worker}]" if worker else ""
            print(f"  ⏳ {name} ({processed}/{total} videos){worker_str}")
        print()

    if pending:
        print(f"PENDING ({len(pending)}):")
        for name in sorted(pending)[:5]:  # Show first 5
            print(f"  ○ {name}")
        if len(pending) > 5:
            print(f"  ... and {len(pending) - 5} more")
        print()

    print(f"Run 'python main.py parallel -w 3' to process with 3 workers")
    print(f"Run 'python main.py all' to process with single worker")
    return 0


def run_full_pipeline(args):
    """Run complete pipeline: transcribe -> summaries -> index."""
    print("=" * 60)
    print("STEP 1: Transcribing videos")
    print("=" * 60)

    result = run_transcriber(args)
    if result != 0:
        print("Transcription failed!")
        return result

    # Compute the transcript output directory
    input_path = Path(args.input) if hasattr(args, "input") and args.input else Path("W:/")
    transcript_dir = Path("W:/transcripts") / input_path.name

    print("\n" + "=" * 60)
    print("STEP 2: Generating per-video summaries")
    print("=" * 60)

    # Run video summaries with correct path
    summ_cmd = [sys.executable, str(Path(__file__).parent / "video_summaries.py"), str(transcript_dir)]
    subprocess.call(summ_cmd)

    print("\n" + "=" * 60)
    print("STEP 3: Generating master course summary")
    print("=" * 60)

    # Run course summary with correct path
    course_cmd = [sys.executable, str(Path(__file__).parent / "course_summary.py"), str(transcript_dir)]
    subprocess.call(course_cmd)

    print("\n" + "=" * 60)
    print("STEP 4: Generating HTML index")
    print("=" * 60)

    run_generate_index(args)

    print("\n" + "=" * 60)
    print("COMPLETE!")
    print("  - Per-video summaries: *.summary.md files")
    print("  - Course summary: COURSE_SUMMARY.md in each folder")
    print("  - Searchable index: W:/transcripts/index.html")
    print("  - AI Chat: python main.py chat")
    print("=" * 60)

    return 0


def main():
    parser = argparse.ArgumentParser(
        description="Webinar Transcriber - Video to searchable text",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Commands:
  transcribe    Extract audio and transcribe videos
  summaries     Generate per-video AI summaries
  course        Generate master course summary (1 doc per course)
  index         Generate searchable HTML index
  query         Interactive search and Q&A interface
  chat          AI chat - ask questions across all courses
  server        Start web server with integrated chat (recommended)
  all           Process ALL courses (transcribe + summaries + index)
  parallel      Run multiple workers in parallel
  staged        FASTEST: Copy to SSD, process, repeat (best for USB drives!)
  status        Show progress - which courses are done
  full          Run complete pipeline for one course

Examples:
  %(prog)s status                        # Check what's been processed
  %(prog)s server                         # Start web server with chat
  %(prog)s staged -s C:/temp/staging -w 6  # FASTEST for USB drives
  %(prog)s parallel -w 3                 # Run 3 workers (if on fast drive)
  %(prog)s all --dry-run                 # Preview ALL courses
  %(prog)s transcribe -i "W:/MyCourse"   # Transcribe single course
  %(prog)s index                         # Regenerate HTML index
        """
    )

    subparsers = parser.add_subparsers(dest="command", help="Command to run")

    # Transcribe command
    trans = subparsers.add_parser("transcribe", help="Transcribe videos")
    trans.add_argument("-i", "--input", type=Path, help="Input directory")
    trans.add_argument("-o", "--output", type=Path, help="Output directory")
    trans.add_argument("-m", "--model", help="Whisper model")
    trans.add_argument("-w", "--whisper", type=Path, help="Whisper executable")
    trans.add_argument("--dry-run", action="store_true")
    trans.add_argument("--retry-failed", action="store_true")
    trans.add_argument("--keep-audio", action="store_true")

    # Summarize command
    summ = subparsers.add_parser("summarize", help="Generate summaries")
    summ.add_argument("-i", "--input", type=Path, help="Transcripts directory")
    summ.add_argument("--backend", choices=["ollama", "lm_studio", "openai", "auto"])
    summ.add_argument("--model", help="LLM model name")
    summ.add_argument("--force", action="store_true")

    # Query command
    query = subparsers.add_parser("query", help="Query interface")
    query.add_argument("-d", "--dir", type=Path, help="Transcripts directory")

    # Video summaries command
    vidsumm = subparsers.add_parser("summaries", help="Generate per-video summaries")
    vidsumm.add_argument("course_dir", type=Path, nargs="?", help="Course transcript directory")
    vidsumm.add_argument("--all", action="store_true", help="Summarize all courses")

    # Course summary command
    course = subparsers.add_parser("course", help="Generate master course summary")
    course.add_argument("course_dir", type=Path, nargs="?", help="Course transcript directory")
    course.add_argument("--all", action="store_true", help="Summarize all courses")

    # Index command
    subparsers.add_parser("index", help="Generate searchable HTML index")

    # Chat command
    subparsers.add_parser("chat", help="AI chat - ask questions across all courses")

    # Server command - Start web server with chat
    server = subparsers.add_parser("server", help="Start course library web server with chat")
    server.add_argument("--host", default="localhost", help="Host to bind to")
    server.add_argument("--port", type=int, default=8080, help="Port to listen on")

    # All command - process everything
    all_cmd = subparsers.add_parser("all", help="Transcribe ALL courses on W: drive")
    all_cmd.add_argument("-i", "--input", type=Path, default=Path("W:/"), help="Root directory")
    all_cmd.add_argument("--dry-run", action="store_true", help="List courses without processing")

    # Status command
    subparsers.add_parser("status", help="Show progress status for all courses")

    # Parallel processing command
    parallel = subparsers.add_parser("parallel", help="Run multiple workers in parallel")
    parallel.add_argument("-w", "--workers", type=int, default=2,
                          help="Number of parallel workers (default: 2)")
    parallel.add_argument("-i", "--input", type=Path, default=Path("W:/"),
                          help="Root directory containing courses")

    # Staged processing (USB → SSD → process)
    staged = subparsers.add_parser("staged", help="Copy to SSD staging then process (fastest for USB)")
    staged.add_argument("-s", "--staging", type=Path, required=True,
                        help="Staging directory on fast SSD (e.g., C:/temp/staging)")
    staged.add_argument("-w", "--workers", type=int, default=6,
                        help="Number of parallel workers (default: 6)")
    staged.add_argument("-i", "--input", type=Path, default=Path("W:/"),
                        help="Source directory (slow USB drive)")
    staged.add_argument("--max-gb", type=float, default=200,
                        help="Max staging size in GB (default: 200)")

    # Full pipeline
    full = subparsers.add_parser("full", help="Run complete pipeline")
    full.add_argument("-i", "--input", type=Path, help="Input directory")
    full.add_argument("-o", "--output", type=Path, help="Output directory")
    full.add_argument("-m", "--model", help="Whisper model")
    full.add_argument("-w", "--whisper", type=Path, help="Whisper executable")
    full.add_argument("--backend", choices=["ollama", "lm_studio", "openai", "auto"])

    args = parser.parse_args()

    if args.command == "transcribe":
        sys.exit(run_transcriber(args))
    elif args.command == "summarize":
        sys.exit(run_summarizer(args))
    elif args.command == "summaries":
        sys.exit(run_video_summaries(args))
    elif args.command == "query":
        sys.exit(run_query(args))
    elif args.command == "course":
        sys.exit(run_course_summary(args))
    elif args.command == "index":
        sys.exit(run_generate_index(args))
    elif args.command == "chat":
        sys.exit(run_chat(args))
    elif args.command == "all":
        sys.exit(run_all(args))
    elif args.command == "status":
        sys.exit(run_status(args))
    elif args.command == "parallel":
        sys.exit(run_parallel(args))
    elif args.command == "server":
        sys.exit(run_server(args))
    elif args.command == "staged":
        # Run staged processor
        cmd = [
            sys.executable,
            str(Path(__file__).parent / "staged_processor.py"),
            "-i", str(args.input),
            "-s", str(args.staging),
            "-w", str(args.workers),
            "--max-gb", str(args.max_gb)
        ]
        sys.exit(subprocess.call(cmd))
    elif args.command == "full":
        sys.exit(run_full_pipeline(args))
    else:
        parser.print_help()
        sys.exit(0)


if __name__ == "__main__":
    main()
