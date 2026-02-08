#!/usr/bin/env python3
"""
Generate master course summary from all transcripts in a course folder.
Creates a single comprehensive document instead of per-video summaries.
"""

import argparse
import json
import logging
import urllib.request
from datetime import datetime
from pathlib import Path

DEFAULT_LM_STUDIO_URL = "http://192.168.56.1:80"
DEFAULT_OLLAMA_URL = "http://127.0.0.1:11434"
DEFAULT_MODEL = "deepseek-r1-distill-qwen-7b"

COURSE_SUMMARY_PROMPT = """You are analyzing transcripts from a video course. Create a comprehensive master summary.

COURSE: {course_name}
NUMBER OF VIDEOS: {video_count}

TRANSCRIPT EXCERPTS:
{transcripts}

---

Create a master summary document in this format:

# {course_name}

## Course Overview
A 3-5 sentence overview of what this course teaches and who it's for.

## Key Learning Objectives
What students will learn by completing this course (5-10 bullet points).

## Module Breakdown
Organize the content into logical modules/sections with brief descriptions.

## Core Concepts & Frameworks
The main ideas, frameworks, or methodologies taught in the course.

## Actionable Takeaways
Practical steps or actions students can implement immediately (numbered list).

## Notable Quotes & Insights
Memorable quotes or unique insights from the instructor.

## Who Should Take This Course
Describe the ideal student for this course.

## Prerequisites
What students should know before starting.

---
Be comprehensive but concise. Focus on extractable, actionable value.
"""


class CourseSummarizer:
    """Generate master summary for entire course."""

    def __init__(self, llm_url: str, model: str):
        self.llm_url = llm_url
        self.model = model
        self.logger = self._setup_logging()

    def _setup_logging(self) -> logging.Logger:
        logger = logging.getLogger("course_summary")
        if not logger.handlers:
            console = logging.StreamHandler()
            console.setFormatter(logging.Formatter(
                "%(asctime)s | %(levelname)-8s | %(message)s",
                datefmt="%H:%M:%S"
            ))
            logger.addHandler(console)
            logger.setLevel(logging.INFO)
        return logger

    def _llm_generate(self, prompt: str, max_tokens: int = 4000) -> str:
        """Generate text from LLM."""
        # Try LM Studio first (OpenAI compatible)
        if "11434" not in self.llm_url:
            url = f"{self.llm_url}/v1/chat/completions"
            data = {
                "model": self.model,
                "messages": [{"role": "user", "content": prompt}],
                "max_tokens": max_tokens,
                "temperature": 0.3
            }
        else:
            # Ollama
            url = f"{self.llm_url}/api/generate"
            data = {
                "model": self.model,
                "prompt": prompt,
                "stream": False,
                "options": {"num_predict": max_tokens}
            }

        req = urllib.request.Request(
            url,
            data=json.dumps(data).encode("utf-8"),
            headers={"Content-Type": "application/json"},
            method="POST"
        )

        with urllib.request.urlopen(req, timeout=300) as response:
            result = json.loads(response.read().decode("utf-8"))

            if "response" in result:  # Ollama
                return result["response"]
            else:  # OpenAI format
                return result["choices"][0]["message"]["content"]

    def summarize_course(self, course_dir: Path) -> Path:
        """Generate master summary for a course directory."""
        course_name = course_dir.name
        self.logger.info(f"Summarizing course: {course_name}")

        # Find all transcripts
        transcripts = sorted(course_dir.rglob("*.txt"))
        transcripts = [t for t in transcripts if not t.name.endswith(".summary.md")]

        if not transcripts:
            self.logger.error(f"No transcripts found in {course_dir}")
            return None

        self.logger.info(f"Found {len(transcripts)} transcripts")

        # Read and combine transcripts (with truncation for context limits)
        combined_text = []
        chars_per_file = 800  # Reduced limit per file to fit context
        max_videos = 20  # Limit number of videos to sample

        for t in transcripts[:max_videos]:
            try:
                content = t.read_text(encoding="utf-8")
                # Take beginning of each transcript
                excerpt = content[:chars_per_file]
                if len(content) > chars_per_file:
                    excerpt += "..."
                combined_text.append(f"### {t.stem}\n{excerpt}\n")
            except Exception as e:
                self.logger.warning(f"Could not read {t}: {e}")

        # Generate summary
        self.logger.info("Generating master summary with LLM...")
        prompt = COURSE_SUMMARY_PROMPT.format(
            course_name=course_name,
            video_count=len(transcripts),
            transcripts="\n".join(combined_text)
        )

        summary = self._llm_generate(prompt)

        # Save master summary
        output_path = course_dir / "COURSE_SUMMARY.md"

        full_content = f"""---
course: {course_name}
videos: {len(transcripts)}
generated: {datetime.now().isoformat()}
---

{summary}

---

## Video Index

"""
        # Add video list
        for i, t in enumerate(transcripts, 1):
            full_content += f"{i}. {t.stem}\n"

        output_path.write_text(full_content, encoding="utf-8")
        self.logger.info(f"Master summary saved: {output_path}")

        return output_path


def detect_llm() -> tuple[str, str]:
    """Detect available LLM backend."""
    # Try Ollama first (more reliable for long prompts)
    try:
        urllib.request.urlopen(f"{DEFAULT_OLLAMA_URL}/api/tags", timeout=2)
        return DEFAULT_OLLAMA_URL, "llama3.2"
    except Exception:
        pass

    # Try LM Studio
    try:
        urllib.request.urlopen(f"{DEFAULT_LM_STUDIO_URL}/v1/models", timeout=2)
        return DEFAULT_LM_STUDIO_URL, DEFAULT_MODEL
    except Exception:
        pass

    return None, None


def main():
    parser = argparse.ArgumentParser(
        description="Generate master course summary from transcripts"
    )
    parser.add_argument(
        "course_dir",
        type=Path,
        nargs="?",
        help="Course transcript directory (or auto-detect from W:/transcripts)"
    )
    parser.add_argument(
        "--all",
        action="store_true",
        help="Summarize all courses in W:/transcripts"
    )

    args = parser.parse_args()

    llm_url, model = detect_llm()
    if not llm_url:
        print("ERROR: No LLM backend detected. Start LM Studio or Ollama.")
        return 1

    print(f"Using LLM: {llm_url} ({model})")

    summarizer = CourseSummarizer(llm_url, model)

    if args.all:
        # Summarize all courses
        transcripts_dir = Path("W:/transcripts")
        for course_dir in sorted(transcripts_dir.iterdir()):
            if course_dir.is_dir() and not course_dir.name.startswith("."):
                summary_file = course_dir / "COURSE_SUMMARY.md"
                if not summary_file.exists():
                    summarizer.summarize_course(course_dir)
                else:
                    print(f"Skipping (already has summary): {course_dir.name}")
    elif args.course_dir:
        summarizer.summarize_course(args.course_dir)
    else:
        parser.print_help()

    return 0


if __name__ == "__main__":
    exit(main())
