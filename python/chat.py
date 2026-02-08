#!/usr/bin/env python3
"""
AI Chat interface with RAG - Ask questions across all courses.
Uses local LLM with retrieval from transcripts and summaries.
"""

import json
import os
import re
import sys
import urllib.request
from dataclasses import dataclass
from pathlib import Path

TRANSCRIPTS_DIR = Path("W:/transcripts")
DEFAULT_OLLAMA_URL = "http://127.0.0.1:11434"
DEFAULT_MODEL = "llama3.2"

SYSTEM_PROMPT = """You are a helpful assistant that answers questions based on course content.
You have access to transcripts and summaries from various video courses.

When answering:
1. Base your answers ONLY on the provided context
2. IMPORTANT: The context includes a "COMPLETE LIST OF MATCHING COURSES" - always mention the total count and list the most relevant ones
3. Cite specific courses with their full names
4. Be comprehensive - if many courses cover a topic, acknowledge that breadth
5. Group courses by sub-topic or approach when helpful

Context from courses:
{context}
"""

RAG_PROMPT = """Based on the course content provided above, please answer this question:

Question: {question}

IMPORTANT INSTRUCTIONS:
- Start by mentioning how many courses match this topic (use the "COMPLETE LIST" from the context)
- List the most relevant courses by name
- Group them by focus area if there are many
- Then provide specific details from the detailed excerpts
- If many courses cover this topic, that's valuable information to share!
"""


@dataclass
class SearchResult:
    """A search result with relevance score."""
    path: Path
    content: str
    score: float
    course: str
    video: str


class CourseRAG:
    """RAG system for course content."""

    def __init__(self, transcripts_dir: Path = TRANSCRIPTS_DIR):
        self.transcripts_dir = transcripts_dir
        self.index = []
        self._build_index()

    def _build_index(self):
        """Build search index from all transcripts and summaries."""
        print("Building search index...")

        for course_dir in self.transcripts_dir.iterdir():
            if not course_dir.is_dir() or course_dir.name.startswith("."):
                continue

            course_name = course_dir.name

            # Index course summary
            course_summary = course_dir / "COURSE_SUMMARY.md"
            if course_summary.exists():
                content = course_summary.read_text(encoding="utf-8")
                self.index.append({
                    "path": course_summary,
                    "content": content,
                    "course": course_name,
                    "video": "COURSE OVERVIEW",
                    "type": "course_summary"
                })

            # Index video summaries first (preferred), then transcripts
            for f in sorted(course_dir.rglob("*")):
                if f.suffix == ".md" and f.name.endswith(".summary.md"):
                    try:
                        content = f.read_text(encoding="utf-8")
                        video_name = f.stem.replace(".summary", "")
                        self.index.append({
                            "path": f,
                            "content": content,
                            "course": course_name,
                            "video": video_name,
                            "type": "video_summary"
                        })
                    except Exception:
                        pass

                elif f.suffix == ".txt" and f.name != "transcriber.log":
                    # Only index transcript if no summary exists
                    summary_path = f.with_suffix(".summary.md")
                    if not summary_path.exists():
                        try:
                            content = f.read_text(encoding="utf-8")
                            self.index.append({
                                "path": f,
                                "content": content[:5000],  # Truncate long transcripts
                                "course": course_name,
                                "video": f.stem,
                                "type": "transcript"
                            })
                        except Exception:
                            pass

        print(f"Indexed {len(self.index)} documents from {len(set(d['course'] for d in self.index))} courses")

    def search(self, query: str, top_k: int = 30) -> list[SearchResult]:
        """Search index for relevant documents."""
        query_lower = query.lower()
        query_terms = set(query_lower.split())
        results = []

        for doc in self.index:
            content_lower = doc["content"].lower()
            course_lower = doc["course"].lower()
            video_lower = doc["video"].lower()

            score = 0

            # Check if query matches course name (high priority)
            if query_lower in course_lower:
                score += 100  # Strong boost for course name match
            else:
                # Check individual terms in course name
                for term in query_terms:
                    if len(term) > 2 and term in course_lower:
                        score += 50  # Good boost for partial course name match

            # Check video name
            for term in query_terms:
                if len(term) > 2 and term in video_lower:
                    score += 20

            # TF scoring on content
            for term in query_terms:
                count = content_lower.count(term)
                if count > 0:
                    score += count

            # Boost summaries over raw transcripts
            if doc["type"] == "course_summary":
                score *= 2
            elif doc["type"] == "video_summary":
                score *= 1.5

            if score > 0:
                results.append(SearchResult(
                    path=doc["path"],
                    content=doc["content"],
                    score=score,
                    course=doc["course"],
                    video=doc["video"]
                ))

        # Sort by score
        results.sort(key=lambda r: r.score, reverse=True)
        return results[:top_k]

    def get_matching_courses(self, query: str) -> list[str]:
        """Get all unique courses that match the query, sorted by relevance."""
        results = self.search(query, top_k=500)  # Get many results
        # Group by course and sum scores
        course_scores = {}
        for r in results:
            if r.course not in course_scores:
                course_scores[r.course] = 0
            course_scores[r.course] += r.score
        # Sort by total score
        sorted_courses = sorted(course_scores.items(), key=lambda x: x[1], reverse=True)
        return [c[0] for c in sorted_courses]

    def get_context(self, query: str, max_chars: int = 15000) -> str:
        """Get relevant context for a query."""
        # First, get ALL matching courses for a complete list
        all_courses = self.get_matching_courses(query)

        # Get detailed results for context
        results = self.search(query, top_k=40)

        if not results:
            return "No relevant content found."

        context_parts = []
        total_chars = 0

        # Start with a summary of ALL matching courses
        if len(all_courses) > 0:
            course_list = f"## COMPLETE LIST OF {len(all_courses)} MATCHING COURSES:\n"
            course_list += ", ".join(all_courses[:50])  # Show up to 50 course names
            if len(all_courses) > 50:
                course_list += f", ... and {len(all_courses) - 50} more"
            course_list += "\n\n## DETAILED EXCERPTS FROM TOP MATCHES:\n"
            context_parts.append(course_list)
            total_chars += len(course_list)

        # Track courses we've included excerpts from
        courses_shown = set()

        for r in results:
            # Prioritize showing different courses
            if r.course in courses_shown and len(courses_shown) < 15:
                continue

            # Truncate each result
            excerpt = r.content[:1200]
            if len(r.content) > 1200:
                excerpt += "..."

            part = f"### {r.course} - {r.video}\n{excerpt}\n"

            if total_chars + len(part) > max_chars:
                break

            context_parts.append(part)
            total_chars += len(part)
            courses_shown.add(r.course)

        return "\n".join(context_parts)


class ChatInterface:
    """Interactive chat interface."""

    def __init__(self, rag: CourseRAG, llm_url: str = DEFAULT_OLLAMA_URL, model: str = DEFAULT_MODEL):
        self.rag = rag
        self.llm_url = llm_url
        self.model = model
        self.history = []

    def _llm_generate(self, prompt: str, system: str = "") -> str:
        """Generate response from Ollama."""
        url = f"{self.llm_url}/api/chat"
        messages = []

        if system:
            messages.append({"role": "system", "content": system})

        messages.append({"role": "user", "content": prompt})

        data = {
            "model": self.model,
            "messages": messages,
            "stream": False,
            "options": {"num_predict": 1000}
        }

        req = urllib.request.Request(
            url,
            data=json.dumps(data).encode("utf-8"),
            headers={"Content-Type": "application/json"},
            method="POST"
        )

        with urllib.request.urlopen(req, timeout=120) as response:
            result = json.loads(response.read().decode("utf-8"))
            return result.get("message", {}).get("content", "")

    def ask(self, question: str) -> str:
        """Ask a question and get an answer based on course content."""
        # Get relevant context
        context = self.rag.get_context(question)

        # Build prompt
        system = SYSTEM_PROMPT.format(context=context)
        prompt = RAG_PROMPT.format(question=question)

        # Generate response
        response = self._llm_generate(prompt, system)

        # Store in history
        self.history.append({"question": question, "answer": response})

        return response

    def run(self):
        """Run interactive chat loop."""
        print_colored("\n" + "="*60, "cyan")
        print_colored("  Course AI Chat", "cyan")
        print_colored("="*60, "cyan")
        print("\nAsk questions about your courses. Type 'quit' to exit.")
        print("Type 'search <term>' to search without AI.\n")

        while True:
            try:
                question = input("\033[94mYou:\033[0m ").strip()
            except (EOFError, KeyboardInterrupt):
                print("\nGoodbye!")
                break

            if not question:
                continue

            if question.lower() in ("quit", "exit", "q"):
                print("Goodbye!")
                break

            if question.lower().startswith("search "):
                # Direct search mode
                term = question[7:].strip()
                results = self.rag.search(term, top_k=5)
                print_colored(f"\nFound {len(results)} results:", "yellow")
                for r in results:
                    print(f"  [{r.course}] {r.video} (score: {r.score:.0f})")
                print()
                continue

            # AI-powered answer
            print_colored("\nThinking...", "yellow")
            try:
                answer = self.ask(question)
                print_colored("\nAssistant:", "green")
                print(answer)
                print()
            except Exception as e:
                print_colored(f"\nError: {e}", "red")
                print()


def print_colored(text: str, color: str = None):
    """Print with color."""
    colors = {
        "green": "\033[92m",
        "yellow": "\033[93m",
        "blue": "\033[94m",
        "cyan": "\033[96m",
        "red": "\033[91m",
        "reset": "\033[0m"
    }

    if sys.platform == "win32":
        os.system("")

    if color and color in colors:
        print(f"{colors[color]}{text}{colors['reset']}")
    else:
        print(text)


def main():
    # Check Ollama
    try:
        urllib.request.urlopen(f"{DEFAULT_OLLAMA_URL}/api/tags", timeout=2)
    except Exception:
        print("ERROR: Ollama not running. Start with: ollama serve")
        return 1

    # Build RAG index
    rag = CourseRAG()

    # Start chat
    chat = ChatInterface(rag)
    chat.run()

    return 0


if __name__ == "__main__":
    exit(main())
