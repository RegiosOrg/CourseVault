#!/usr/bin/env python3
"""
Webinar Summarizer - Generate AI summaries from transcripts.

Supports:
- Ollama (local, free)
- LM Studio (local, free)
- OpenAI API (cloud, paid)
"""

import argparse
import json
import logging
import re
import sys
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path
from typing import Optional
import urllib.request
import urllib.error

DEFAULT_OLLAMA_URL = "http://127.0.0.1:11434"
DEFAULT_LM_STUDIO_URL = "http://192.168.56.1:80"
DEFAULT_MODEL = "deepseek-r1-distill-qwen-7b"

SUMMARY_PROMPT = """You are analyzing a webinar transcript. Create a comprehensive summary document.

TRANSCRIPT:
{transcript}

---

Please provide a summary in the following format:

# {title}

## Overview
A 2-3 sentence summary of what this webinar is about.

## Key Topics Covered
- Topic 1: Brief description
- Topic 2: Brief description
- (continue for all major topics)

## Main Ideas & Takeaways
1. First key insight or idea
2. Second key insight or idea
3. (continue for all important points)

## Notable Quotes or Examples
- Any memorable quotes or concrete examples mentioned

## Action Items / Recommendations
- Any actionable advice or recommendations from the webinar

## Keywords
[comma-separated list of relevant keywords for searching]

---
Be concise but comprehensive. Focus on extractable value for the viewer.
"""

CHUNK_SIZE = 6000  # Characters per chunk for long transcripts


@dataclass
class LLMConfig:
    """Configuration for LLM backend."""

    backend: str  # "ollama", "lm_studio", "openai"
    base_url: str
    model: str
    api_key: Optional[str] = None


class LLMClient:
    """Unified client for different LLM backends."""

    def __init__(self, config: LLMConfig):
        self.config = config
        self.logger = logging.getLogger("summarizer")

    def generate(self, prompt: str, max_tokens: int = 2000) -> str:
        """Generate text from prompt."""
        if self.config.backend == "ollama":
            return self._ollama_generate(prompt, max_tokens)
        elif self.config.backend == "lm_studio":
            return self._lm_studio_generate(prompt, max_tokens)
        elif self.config.backend == "openai":
            return self._openai_generate(prompt, max_tokens)
        else:
            raise ValueError(f"Unknown backend: {self.config.backend}")

    def _ollama_generate(self, prompt: str, max_tokens: int) -> str:
        """Generate using Ollama API."""
        url = f"{self.config.base_url}/api/generate"
        data = {
            "model": self.config.model,
            "prompt": prompt,
            "stream": False,
            "options": {
                "num_predict": max_tokens
            }
        }

        response = self._http_post(url, data)
        return response.get("response", "")

    def _lm_studio_generate(self, prompt: str, max_tokens: int) -> str:
        """Generate using LM Studio OpenAI-compatible API."""
        url = f"{self.config.base_url}/v1/chat/completions"
        data = {
            "model": self.config.model,
            "messages": [{"role": "user", "content": prompt}],
            "max_tokens": max_tokens,
            "temperature": 0.3
        }

        response = self._http_post(url, data)
        return response.get("choices", [{}])[0].get("message", {}).get("content", "")

    def _openai_generate(self, prompt: str, max_tokens: int) -> str:
        """Generate using OpenAI API."""
        url = "https://api.openai.com/v1/chat/completions"
        data = {
            "model": self.config.model,
            "messages": [{"role": "user", "content": prompt}],
            "max_tokens": max_tokens,
            "temperature": 0.3
        }

        headers = {"Authorization": f"Bearer {self.config.api_key}"}
        response = self._http_post(url, data, headers)
        return response.get("choices", [{}])[0].get("message", {}).get("content", "")

    def _http_post(self, url: str, data: dict, extra_headers: dict = None) -> dict:
        """Make HTTP POST request."""
        headers = {"Content-Type": "application/json"}
        if extra_headers:
            headers.update(extra_headers)

        req = urllib.request.Request(
            url,
            data=json.dumps(data).encode("utf-8"),
            headers=headers,
            method="POST"
        )

        try:
            with urllib.request.urlopen(req, timeout=300) as response:
                return json.loads(response.read().decode("utf-8"))
        except urllib.error.URLError as e:
            self.logger.error(f"HTTP error: {e}")
            raise


class WebinarSummarizer:
    """Summarize webinar transcripts."""

    def __init__(self, llm: LLMClient, output_dir: Path):
        self.llm = llm
        self.output_dir = output_dir
        self.logger = logging.getLogger("summarizer")
        self._setup_logging()

    def _setup_logging(self) -> None:
        if not self.logger.handlers:
            console = logging.StreamHandler()
            console.setFormatter(logging.Formatter(
                "%(asctime)s | %(levelname)-8s | %(message)s",
                datefmt="%H:%M:%S"
            ))
            self.logger.addHandler(console)
            self.logger.setLevel(logging.INFO)

    def summarize_transcript(self, transcript_path: Path) -> Optional[Path]:
        """Generate summary for a single transcript."""
        self.logger.info(f"Summarizing: {transcript_path.name}")

        # Read transcript
        transcript = transcript_path.read_text(encoding="utf-8")

        if len(transcript) < 100:
            self.logger.warning(f"Transcript too short: {transcript_path}")
            return None

        # Generate title from filename
        title = transcript_path.stem.replace("_", " ").replace("-", " ").title()

        # Handle long transcripts by chunking and summarizing
        if len(transcript) > CHUNK_SIZE * 3:
            summary = self._summarize_long_transcript(transcript, title)
        else:
            prompt = SUMMARY_PROMPT.format(transcript=transcript[:CHUNK_SIZE * 2], title=title)
            summary = self.llm.generate(prompt)

        # Save summary
        summary_path = self._get_summary_path(transcript_path)
        summary_path.parent.mkdir(parents=True, exist_ok=True)

        # Add metadata
        full_content = f"""---
source: {transcript_path}
generated: {datetime.now().isoformat()}
---

{summary}
"""
        summary_path.write_text(full_content, encoding="utf-8")
        self.logger.info(f"Summary saved: {summary_path}")

        return summary_path

    def _summarize_long_transcript(self, transcript: str, title: str) -> str:
        """Handle long transcripts by chunking."""
        self.logger.info("Long transcript detected, processing in chunks...")

        # Split into chunks
        chunks = []
        for i in range(0, len(transcript), CHUNK_SIZE):
            chunks.append(transcript[i:i + CHUNK_SIZE])

        # Summarize each chunk
        chunk_summaries = []
        for i, chunk in enumerate(chunks[:10], 1):  # Limit to first 10 chunks
            self.logger.info(f"  Processing chunk {i}/{min(len(chunks), 10)}")
            prompt = f"Summarize the key points from this section of a webinar:\n\n{chunk}"
            chunk_summary = self.llm.generate(prompt, max_tokens=500)
            chunk_summaries.append(chunk_summary)

        # Combine chunk summaries into final summary
        combined = "\n\n".join(chunk_summaries)
        final_prompt = SUMMARY_PROMPT.format(
            transcript=f"[Combined summaries from {len(chunks)} sections]\n\n{combined}",
            title=title
        )

        return self.llm.generate(final_prompt)

    def _get_summary_path(self, transcript_path: Path) -> Path:
        """Get output path for summary - same location as transcript."""
        # Put summary next to transcript: video.txt -> video.summary.md
        return transcript_path.with_suffix(".summary.md")

    def summarize_all(self, transcript_dir: Path, skip_existing: bool = True) -> None:
        """Summarize all transcripts in directory."""
        transcripts = list(transcript_dir.rglob("*.txt"))
        self.logger.info(f"Found {len(transcripts)} transcripts")

        processed = 0
        skipped = 0
        failed = 0

        for transcript_path in transcripts:
            # Skip summaries
            if ".summary" in transcript_path.name:
                continue

            summary_path = self._get_summary_path(transcript_path)
            if skip_existing and summary_path.exists():
                self.logger.debug(f"Skipping (exists): {transcript_path.name}")
                skipped += 1
                continue

            try:
                if self.summarize_transcript(transcript_path):
                    processed += 1
                else:
                    failed += 1
            except Exception as e:
                self.logger.error(f"Failed to summarize {transcript_path}: {e}")
                failed += 1

        self.logger.info("=" * 50)
        self.logger.info(f"Summarization complete")
        self.logger.info(f"  Processed: {processed}")
        self.logger.info(f"  Skipped:   {skipped}")
        self.logger.info(f"  Failed:    {failed}")


def check_ollama() -> bool:
    """Check if Ollama is running."""
    try:
        req = urllib.request.Request(f"{DEFAULT_OLLAMA_URL}/api/tags")
        with urllib.request.urlopen(req, timeout=5):
            return True
    except Exception:
        return False


def check_lm_studio() -> bool:
    """Check if LM Studio is running."""
    urls_to_try = [DEFAULT_LM_STUDIO_URL, "http://localhost:1234"]
    for url in urls_to_try:
        try:
            req = urllib.request.Request(f"{url}/v1/models")
            with urllib.request.urlopen(req, timeout=5):
                return True
        except Exception:
            continue
    return False


def main():
    parser = argparse.ArgumentParser(
        description="Generate AI summaries from webinar transcripts",
        formatter_class=argparse.RawDescriptionHelpFormatter
    )

    parser.add_argument(
        "-i", "--input",
        type=Path,
        default=Path("W:/transcripts"),
        help="Directory containing transcripts"
    )
    parser.add_argument(
        "--backend",
        choices=["ollama", "lm_studio", "openai", "auto"],
        default="auto",
        help="LLM backend to use (default: auto-detect)"
    )
    parser.add_argument(
        "--model",
        default=None,
        help="Model name (default: auto based on backend)"
    )
    parser.add_argument(
        "--url",
        help="Override API URL"
    )
    parser.add_argument(
        "--api-key",
        help="API key for OpenAI"
    )
    parser.add_argument(
        "--force",
        action="store_true",
        help="Re-summarize even if summary exists"
    )
    parser.add_argument(
        "file",
        nargs="?",
        type=Path,
        help="Single transcript file to summarize"
    )

    args = parser.parse_args()

    # Auto-detect backend
    backend = args.backend
    if backend == "auto":
        if check_ollama():
            backend = "ollama"
            print("Detected: Ollama")
        elif check_lm_studio():
            backend = "lm_studio"
            print("Detected: LM Studio")
        else:
            print("ERROR: No LLM backend detected.")
            print("Please start Ollama or LM Studio, or use --backend openai with --api-key")
            sys.exit(1)

    # Set defaults based on backend
    model = args.model
    url = args.url
    if backend == "ollama":
        model = model or "llama3.2"
        url = url or DEFAULT_OLLAMA_URL
    elif backend == "lm_studio":
        model = model or "local-model"
        url = url or DEFAULT_LM_STUDIO_URL
    elif backend == "openai":
        model = model or "gpt-4o-mini"
        if not args.api_key:
            import os
            args.api_key = os.environ.get("OPENAI_API_KEY")
            if not args.api_key:
                print("ERROR: OpenAI requires --api-key or OPENAI_API_KEY env var")
                sys.exit(1)

    config = LLMConfig(
        backend=backend,
        base_url=url,
        model=model,
        api_key=args.api_key
    )

    llm = LLMClient(config)
    summarizer = WebinarSummarizer(llm, args.input)

    if args.file:
        # Single file mode
        summarizer.summarize_transcript(args.file)
    else:
        # Batch mode
        summarizer.summarize_all(args.input, skip_existing=not args.force)


if __name__ == "__main__":
    main()
