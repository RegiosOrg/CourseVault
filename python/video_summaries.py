#!/usr/bin/env python3
"""
Generate individual summaries for each video transcript.
"""

import argparse
import json
import logging
import urllib.request
from datetime import datetime
from pathlib import Path

DEFAULT_OLLAMA_URL = "http://127.0.0.1:11434"
DEFAULT_MODEL = "llama3.2"

VIDEO_SUMMARY_PROMPT = """Summarize this video transcript concisely.

TITLE: {title}

TRANSCRIPT:
{transcript}

---

Provide a summary in this format:

## Summary
2-3 sentences describing what this video covers.

## Key Points
- Point 1
- Point 2
- Point 3
(3-5 bullet points)

## Actionable Takeaways
What the viewer should do or remember after watching.

Keep it concise - max 200 words total.
"""


class VideoSummarizer:
    """Generate summaries for individual videos."""

    def __init__(self, llm_url: str, model: str):
        self.llm_url = llm_url
        self.model = model
        self.logger = self._setup_logging()

    def _setup_logging(self) -> logging.Logger:
        logger = logging.getLogger("video_summary")
        if not logger.handlers:
            console = logging.StreamHandler()
            console.setFormatter(logging.Formatter(
                "%(asctime)s | %(levelname)-8s | %(message)s",
                datefmt="%H:%M:%S"
            ))
            logger.addHandler(console)
            logger.setLevel(logging.INFO)
        return logger

    def _llm_generate(self, prompt: str) -> str:
        """Generate text from Ollama."""
        url = f"{self.llm_url}/api/generate"
        data = {
            "model": self.model,
            "prompt": prompt,
            "stream": False,
            "options": {"num_predict": 500}
        }

        req = urllib.request.Request(
            url,
            data=json.dumps(data).encode("utf-8"),
            headers={"Content-Type": "application/json"},
            method="POST"
        )

        with urllib.request.urlopen(req, timeout=120) as response:
            result = json.loads(response.read().decode("utf-8"))
            return result.get("response", "")

    def summarize_video(self, transcript_path: Path) -> Path:
        """Generate summary for a single video transcript."""
        summary_path = transcript_path.with_suffix(".summary.md")

        # Skip if already exists
        if summary_path.exists():
            return summary_path

        self.logger.info(f"Summarizing: {transcript_path.name}")

        try:
            content = transcript_path.read_text(encoding="utf-8")
        except Exception as e:
            self.logger.error(f"Could not read {transcript_path}: {e}")
            return None

        # Truncate if too long
        if len(content) > 4000:
            content = content[:4000] + "\n[... truncated ...]"

        title = transcript_path.stem

        prompt = VIDEO_SUMMARY_PROMPT.format(
            title=title,
            transcript=content
        )

        try:
            summary = self._llm_generate(prompt)
        except Exception as e:
            self.logger.error(f"LLM error: {e}")
            return None

        # Save summary
        full_content = f"""---
video: {title}
source: {transcript_path.name}
generated: {datetime.now().isoformat()}
---

# {title}

{summary}
"""
        summary_path.write_text(full_content, encoding="utf-8")
        return summary_path

    def summarize_course(self, course_dir: Path) -> int:
        """Summarize all videos in a course."""
        transcripts = sorted(course_dir.rglob("*.txt"))
        transcripts = [t for t in transcripts
                       if not t.name.endswith(".summary.md")
                       and t.name != "transcriber.log"]

        self.logger.info(f"Found {len(transcripts)} transcripts in {course_dir.name}")

        processed = 0
        skipped = 0

        for t in transcripts:
            summary_path = t.with_suffix(".summary.md")
            if summary_path.exists():
                skipped += 1
                continue

            if self.summarize_video(t):
                processed += 1

        self.logger.info(f"Processed: {processed}, Skipped: {skipped}")
        return processed


def main():
    parser = argparse.ArgumentParser(
        description="Generate per-video summaries"
    )
    parser.add_argument(
        "course_dir",
        type=Path,
        nargs="?",
        help="Course transcript directory"
    )
    parser.add_argument(
        "--all",
        action="store_true",
        help="Summarize all courses in W:/transcripts"
    )
    parser.add_argument(
        "--force",
        action="store_true",
        help="Re-summarize even if summary exists"
    )

    args = parser.parse_args()

    # Check Ollama
    try:
        urllib.request.urlopen(f"{DEFAULT_OLLAMA_URL}/api/tags", timeout=2)
    except Exception:
        print("ERROR: Ollama not running. Start with: ollama serve")
        return 1

    summarizer = VideoSummarizer(DEFAULT_OLLAMA_URL, DEFAULT_MODEL)

    if args.all:
        transcripts_dir = Path("W:/transcripts")
        for course_dir in sorted(transcripts_dir.iterdir()):
            if course_dir.is_dir() and not course_dir.name.startswith("."):
                print(f"\n{'='*60}")
                print(f"Course: {course_dir.name}")
                print("="*60)
                summarizer.summarize_course(course_dir)
    elif args.course_dir:
        summarizer.summarize_course(args.course_dir)
    else:
        parser.print_help()

    return 0


if __name__ == "__main__":
    exit(main())
