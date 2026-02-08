#!/usr/bin/env python3
"""
Webinar Query Interface - Search and ask questions about your webinars.

Features:
- Full-text search across all transcripts
- AI-powered Q&A about specific webinars
- Browse summaries
"""

import argparse
import json
import os
import re
import sys
import urllib.request
from dataclasses import dataclass
from pathlib import Path
from typing import Optional

DEFAULT_TRANSCRIPTS_DIR = Path("W:/transcripts")
DEFAULT_OLLAMA_URL = "http://127.0.0.1:11434"
DEFAULT_LM_STUDIO_URL = "http://192.168.56.1:80"


@dataclass
class SearchResult:
    """A search result."""

    file: Path
    matches: list[str]
    score: float

    def __str__(self):
        return f"{self.file.name} ({len(self.matches)} matches)"


class WebinarQuery:
    """Query interface for webinar transcripts."""

    def __init__(self, transcripts_dir: Path, llm_url: str = None, model: str = None):
        self.transcripts_dir = transcripts_dir
        self.llm_url = llm_url
        self.model = model

    def search(self, query: str, limit: int = 10) -> list[SearchResult]:
        """Search transcripts for query terms."""
        results = []
        terms = query.lower().split()

        for txt_file in self.transcripts_dir.rglob("*.txt"):
            if ".summary" in txt_file.name:
                continue

            try:
                content = txt_file.read_text(encoding="utf-8").lower()
            except Exception:
                continue

            # Score based on term frequency
            score = 0
            matches = []

            for term in terms:
                count = content.count(term)
                if count > 0:
                    score += count
                    # Find context around matches
                    for match in re.finditer(re.escape(term), content):
                        start = max(0, match.start() - 50)
                        end = min(len(content), match.end() + 50)
                        context = content[start:end].replace("\n", " ")
                        matches.append(f"...{context}...")

            if score > 0:
                results.append(SearchResult(
                    file=txt_file,
                    matches=matches[:5],  # Limit context snippets
                    score=score
                ))

        # Sort by score
        results.sort(key=lambda r: r.score, reverse=True)
        return results[:limit]

    def list_webinars(self) -> list[dict]:
        """List all webinars with their summaries."""
        webinars = []

        for txt_file in sorted(self.transcripts_dir.rglob("*.txt")):
            if ".summary" in txt_file.name:
                continue

            summary_file = txt_file.with_suffix(".summary.md")
            if not summary_file.exists():
                # Check in summaries subdirectory
                summary_dir = self.transcripts_dir / "summaries"
                relative = txt_file.relative_to(self.transcripts_dir)
                summary_file = summary_dir / relative.with_suffix(".summary.md")

            webinar = {
                "name": txt_file.stem.replace("_", " ").replace("-", " ").title(),
                "transcript": txt_file,
                "summary": summary_file if summary_file.exists() else None,
                "size_kb": txt_file.stat().st_size // 1024
            }
            webinars.append(webinar)

        return webinars

    def ask(self, webinar_path: Path, question: str) -> str:
        """Ask a question about a specific webinar."""
        if not self.llm_url:
            return "ERROR: LLM not configured. Start Ollama or LM Studio."

        # Read transcript
        content = webinar_path.read_text(encoding="utf-8")

        # Truncate if too long
        if len(content) > 8000:
            content = content[:8000] + "\n\n[Transcript truncated...]"

        prompt = f"""Based on the following webinar transcript, please answer this question:

QUESTION: {question}

TRANSCRIPT:
{content}

---

Please provide a clear, concise answer based only on what's in the transcript. If the answer isn't in the transcript, say so.
"""

        return self._llm_generate(prompt)

    def _llm_generate(self, prompt: str) -> str:
        """Generate response from LLM."""
        # Try Ollama first
        if "11434" in (self.llm_url or DEFAULT_OLLAMA_URL):
            url = f"{self.llm_url or DEFAULT_OLLAMA_URL}/api/generate"
            data = {
                "model": self.model or "llama3.2",
                "prompt": prompt,
                "stream": False
            }
        else:
            # LM Studio / OpenAI compatible
            url = f"{self.llm_url or DEFAULT_LM_STUDIO_URL}/v1/chat/completions"
            data = {
                "model": self.model or "local-model",
                "messages": [{"role": "user", "content": prompt}],
                "max_tokens": 1000
            }

        req = urllib.request.Request(
            url,
            data=json.dumps(data).encode("utf-8"),
            headers={"Content-Type": "application/json"},
            method="POST"
        )

        try:
            with urllib.request.urlopen(req, timeout=120) as response:
                result = json.loads(response.read().decode("utf-8"))

                if "response" in result:  # Ollama
                    return result["response"]
                else:  # OpenAI format
                    return result["choices"][0]["message"]["content"]

        except Exception as e:
            return f"ERROR: {e}"


def print_colored(text: str, color: str = None):
    """Print with optional color (Windows compatible)."""
    colors = {
        "green": "\033[92m",
        "yellow": "\033[93m",
        "blue": "\033[94m",
        "cyan": "\033[96m",
        "reset": "\033[0m"
    }

    # Enable ANSI on Windows
    if sys.platform == "win32":
        os.system("")

    if color and color in colors:
        print(f"{colors[color]}{text}{colors['reset']}")
    else:
        print(text)


def interactive_mode(query_engine: WebinarQuery):
    """Run interactive query interface."""
    print_colored("\n=== Webinar Query Interface ===", "cyan")
    print("Commands:")
    print("  list              - List all webinars")
    print("  search <query>    - Search transcripts")
    print("  ask <n> <question>- Ask about webinar #n")
    print("  read <n>          - Show webinar #n summary")
    print("  quit              - Exit")
    print()

    webinars = query_engine.list_webinars()
    print_colored(f"Loaded {len(webinars)} webinars", "green")

    while True:
        try:
            cmd = input("\n> ").strip()
        except (EOFError, KeyboardInterrupt):
            print("\nGoodbye!")
            break

        if not cmd:
            continue

        parts = cmd.split(maxsplit=2)
        command = parts[0].lower()

        if command in ("quit", "exit", "q"):
            print("Goodbye!")
            break

        elif command == "list":
            print_colored(f"\n{'#':<4} {'Name':<50} {'Size':>8}", "cyan")
            print("-" * 70)
            for i, w in enumerate(webinars, 1):
                summary_marker = "*" if w["summary"] else " "
                print(f"{i:<4} {w['name'][:48]:<50} {w['size_kb']:>6} KB {summary_marker}")
            print("\n* = has summary")

        elif command == "search" and len(parts) > 1:
            search_query = " ".join(parts[1:])
            print_colored(f"\nSearching for: {search_query}", "yellow")

            results = query_engine.search(search_query)
            if results:
                for i, result in enumerate(results, 1):
                    print_colored(f"\n{i}. {result.file.name} (score: {result.score})", "green")
                    for match in result.matches[:2]:
                        print(f"   {match[:100]}")
            else:
                print("No results found.")

        elif command == "ask" and len(parts) > 2:
            try:
                idx = int(parts[1]) - 1
                question = parts[2]

                if 0 <= idx < len(webinars):
                    webinar = webinars[idx]
                    print_colored(f"\nAsking about: {webinar['name']}", "yellow")
                    print("Thinking...\n")

                    answer = query_engine.ask(webinar["transcript"], question)
                    print_colored("Answer:", "green")
                    print(answer)
                else:
                    print(f"Invalid webinar number. Use 1-{len(webinars)}")
            except ValueError:
                print("Usage: ask <number> <question>")

        elif command == "read" and len(parts) > 1:
            try:
                idx = int(parts[1]) - 1
                if 0 <= idx < len(webinars):
                    webinar = webinars[idx]
                    if webinar["summary"]:
                        print_colored(f"\n=== {webinar['name']} ===\n", "cyan")
                        print(webinar["summary"].read_text(encoding="utf-8"))
                    else:
                        print("No summary available. Run summarizer first.")
                else:
                    print(f"Invalid webinar number. Use 1-{len(webinars)}")
            except ValueError:
                print("Usage: read <number>")

        else:
            print("Unknown command. Type 'list', 'search', 'ask', 'read', or 'quit'")


def main():
    parser = argparse.ArgumentParser(
        description="Search and query your webinar transcripts"
    )

    parser.add_argument(
        "-d", "--dir",
        type=Path,
        default=DEFAULT_TRANSCRIPTS_DIR,
        help="Transcripts directory"
    )
    parser.add_argument(
        "--llm-url",
        help="LLM API URL (Ollama or LM Studio)"
    )
    parser.add_argument(
        "--model",
        help="Model name for Q&A"
    )

    subparsers = parser.add_subparsers(dest="command")

    # Search command
    search_parser = subparsers.add_parser("search", help="Search transcripts")
    search_parser.add_argument("query", nargs="+", help="Search terms")

    # List command
    subparsers.add_parser("list", help="List webinars")

    # Ask command
    ask_parser = subparsers.add_parser("ask", help="Ask about a webinar")
    ask_parser.add_argument("file", type=Path, help="Transcript file")
    ask_parser.add_argument("question", help="Question to ask")

    args = parser.parse_args()

    # Detect LLM
    llm_url = args.llm_url
    if not llm_url:
        try:
            urllib.request.urlopen(f"{DEFAULT_OLLAMA_URL}/api/tags", timeout=2)
            llm_url = DEFAULT_OLLAMA_URL
        except Exception:
            try:
                urllib.request.urlopen(f"{DEFAULT_LM_STUDIO_URL}/v1/models", timeout=2)
                llm_url = DEFAULT_LM_STUDIO_URL
            except Exception:
                pass

    query_engine = WebinarQuery(
        transcripts_dir=args.dir,
        llm_url=llm_url,
        model=args.model
    )

    if args.command == "search":
        results = query_engine.search(" ".join(args.query))
        for r in results:
            print(f"\n{r.file.name} (score: {r.score})")
            for m in r.matches[:2]:
                print(f"  {m[:80]}...")

    elif args.command == "list":
        webinars = query_engine.list_webinars()
        for i, w in enumerate(webinars, 1):
            marker = "[S]" if w["summary"] else "   "
            print(f"{i:3}. {marker} {w['name']}")

    elif args.command == "ask":
        answer = query_engine.ask(args.file, args.question)
        print(answer)

    else:
        # Interactive mode
        interactive_mode(query_engine)


if __name__ == "__main__":
    main()
