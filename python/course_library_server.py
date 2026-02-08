#!/usr/bin/env python3
"""
Web server for course library with integrated chat.
Serves index.html and provides RAG chat API endpoint.
"""

import argparse
import itertools
import json
import os
import re
import subprocess
import sys
import threading
import time
import urllib.request
from dataclasses import dataclass, field
from http.server import HTTPServer, SimpleHTTPRequestHandler
from socketserver import ThreadingMixIn
from pathlib import Path
from typing import Optional, List, Dict
from urllib.parse import urlparse, parse_qs
from datetime import datetime

TRANSCRIPTS_DIR = Path("W:/transcripts")
INDEX_FILE = TRANSCRIPTS_DIR / "index.html"
DEFAULT_PORT = 8080
DEFAULT_HOST = "127.0.0.1"  # Use IPv4 explicitly to avoid IPv6 issues on Windows

OLLAMA_URL = "http://127.0.0.1:11434"
LM_STUDIO_URL = "http://localhost:1234"
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
class GenerationTask:
    """Tracks a summary generation task."""
    course: str
    status: str  # "pending", "running", "completed", "failed"
    progress: int = 0
    total: int = 0
    current_video: str = ""
    started_at: str = ""
    completed_at: str = ""
    error: str = ""


class GenerationManager:
    """Manages background summary generation tasks."""

    def __init__(self, transcripts_dir: Path):
        self.transcripts_dir = transcripts_dir
        self.current_task: Optional[GenerationTask] = None
        self.queue: List[str] = []
        self.lock = threading.Lock()
        self.worker_thread: Optional[threading.Thread] = None

    def start_generation(self, course_name: str) -> dict:
        """Queue a course for summary generation."""
        with self.lock:
            # Check if already processing this course
            if self.current_task and self.current_task.course == course_name and self.current_task.status == "running":
                return {"status": "already_running", "course": course_name}

            # Check if in queue
            if course_name in self.queue:
                return {"status": "queued", "course": course_name, "position": self.queue.index(course_name) + 1}

            # Add to queue
            self.queue.append(course_name)

            # Start worker if not running
            if self.worker_thread is None or not self.worker_thread.is_alive():
                self.worker_thread = threading.Thread(target=self._worker_loop, daemon=True)
                self.worker_thread.start()

            return {"status": "queued", "course": course_name, "position": len(self.queue)}

    def get_status(self) -> dict:
        """Get current generation status."""
        with self.lock:
            result = {
                "queue": list(self.queue),
                "current": None
            }
            if self.current_task:
                result["current"] = {
                    "course": self.current_task.course,
                    "status": self.current_task.status,
                    "progress": self.current_task.progress,
                    "total": self.current_task.total,
                    "current_video": self.current_task.current_video,
                    "started_at": self.current_task.started_at,
                    "completed_at": self.current_task.completed_at,
                    "error": self.current_task.error
                }
            return result

    def _worker_loop(self):
        """Background worker that processes the generation queue."""
        while True:
            # Get next course from queue
            with self.lock:
                if not self.queue:
                    self.current_task = None
                    return
                course_name = self.queue.pop(0)
                self.current_task = GenerationTask(
                    course=course_name,
                    status="running",
                    started_at=datetime.now().isoformat()
                )

            try:
                self._generate_summaries(course_name)
                with self.lock:
                    if self.current_task:
                        self.current_task.status = "completed"
                        self.current_task.completed_at = datetime.now().isoformat()
            except Exception as e:
                with self.lock:
                    if self.current_task:
                        self.current_task.status = "failed"
                        self.current_task.error = str(e)
                        self.current_task.completed_at = datetime.now().isoformat()

    def _generate_summaries(self, course_name: str):
        """Generate summaries for a course."""
        course_dir = self.transcripts_dir / course_name

        if not course_dir.exists():
            raise ValueError(f"Course not found: {course_name}")

        # Find videos without summaries
        transcripts = list(course_dir.rglob("*.txt"))
        transcripts = [t for t in transcripts
                      if not t.name.endswith(".summary.md")
                      and t.name != "transcriber.log"]

        # Filter to only those without summaries
        need_summary = [t for t in transcripts if not t.with_suffix(".summary.md").exists()]

        with self.lock:
            if self.current_task:
                self.current_task.total = len(need_summary)
                self.current_task.progress = 0

        if not need_summary:
            # All videos already have summaries, generate course summary if needed
            course_summary_path = course_dir / "COURSE_SUMMARY.md"
            if not course_summary_path.exists():
                with self.lock:
                    if self.current_task:
                        self.current_task.current_video = "Course Summary"
                        self.current_task.total = 1
                self._run_course_summary(course_dir)
            return

        # Generate video summaries
        script_dir = Path(__file__).parent

        for i, transcript in enumerate(need_summary):
            with self.lock:
                if self.current_task:
                    self.current_task.current_video = transcript.stem
                    self.current_task.progress = i

            # Run video_summaries.py for this specific file
            cmd = [
                sys.executable,
                str(script_dir / "video_summaries.py"),
                str(transcript)
            ]
            subprocess.run(cmd, capture_output=True)

        with self.lock:
            if self.current_task:
                self.current_task.progress = len(need_summary)
                self.current_task.current_video = "Course Summary"

        # Generate course summary
        self._run_course_summary(course_dir)

        # Regenerate index
        subprocess.run([sys.executable, str(script_dir / "generate_index.py")], capture_output=True)

    def _run_course_summary(self, course_dir: Path):
        """Generate course summary."""
        script_dir = Path(__file__).parent
        cmd = [
            sys.executable,
            str(script_dir / "course_summary.py"),
            str(course_dir)
        ]
        subprocess.run(cmd, capture_output=True)


@dataclass
class SearchResult:
    """A search result with relevance score."""
    path: Path
    content: str
    score: float
    course: str
    video: str
    doc_type: str  # "course_summary", "video_summary", "transcript"


class CourseRAG:
    """RAG system for course content."""

    def __init__(self, transcripts_dir: Path = TRANSCRIPTS_DIR, build_async: bool = False):
        self.transcripts_dir = transcripts_dir
        self.index: List[dict] = []
        self.is_ready = False
        self.is_building = False

        if build_async:
            # Build index in background thread
            self.is_building = True
            thread = threading.Thread(target=self._build_index_async, daemon=True)
            thread.start()
        else:
            self._build_index()

    def _build_index_async(self):
        """Build index in background and mark ready when done."""
        try:
            self._build_index()
        finally:
            self.is_building = False
            self.is_ready = True

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
                try:
                    content = course_summary.read_text(encoding="utf-8")
                    self.index.append({
                        "path": course_summary,
                        "content": content,
                        "course": course_name,
                        "video": "COURSE OVERVIEW",
                        "type": "course_summary"
                    })
                except Exception:
                    pass

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
        self.is_ready = True

    def search(self, query: str, top_k: int = 30, course_filter: str = None) -> List[SearchResult]:
        """Search index for relevant documents. Optionally filter to a specific course."""
        query_lower = query.lower()
        query_terms = set(query_lower.split())
        results = []

        for doc in self.index:
            # Filter by course if specified
            if course_filter and doc["course"] != course_filter:
                continue
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
                    video=doc["video"],
                    doc_type=doc["type"]
                ))

        # Sort by score
        results.sort(key=lambda r: r.score, reverse=True)
        return results[:top_k]

    def get_matching_courses(self, query: str, course_filter: str = None) -> List[str]:
        """Get all unique courses that match the query, sorted by relevance."""
        results = self.search(query, top_k=500, course_filter=course_filter)
        # Group by course and sum scores
        course_scores = {}
        for r in results:
            if r.course not in course_scores:
                course_scores[r.course] = 0
            course_scores[r.course] += r.score
        # Sort by total score
        sorted_courses = sorted(course_scores.items(), key=lambda x: x[1], reverse=True)
        return [c[0] for c in sorted_courses]

    def get_context(self, query: str, max_chars: int = 15000, course_filter: str = None) -> str:
        """Get relevant context for a query. Optionally filter to a specific course."""
        # First, get ALL matching courses for a complete list
        all_courses = self.get_matching_courses(query, course_filter)

        # Get detailed results for context
        results = self.search(query, top_k=40, course_filter=course_filter)

        if not results:
            return "No relevant content found."

        context_parts = []
        total_chars = 0

        # Start with a summary of ALL matching courses (unless filtering to single course)
        if not course_filter and len(all_courses) > 0:
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
            # Prioritize showing different courses (unless course filter is active)
            if not course_filter and r.course in courses_shown and len(courses_shown) < 15:
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


class ChatHandler(SimpleHTTPRequestHandler):
    """HTTP handler for chat requests."""

    def __init__(self, *args, rag: CourseRAG, llm_url: str, model: str,
                 generation_manager: GenerationManager, **kwargs):
        self.rag = rag
        self.llm_url = llm_url
        self.model = model
        self.generation_manager = generation_manager
        super().__init__(*args, **kwargs)

    def handle(self):
        """Handle request with error suppression for connection aborts."""
        try:
            super().handle()
        except (ConnectionAbortedError, ConnectionResetError, BrokenPipeError):
            # Client disconnected - this is normal and can be ignored
            pass
        except Exception as e:
            if "10053" in str(e) or "10054" in str(e):
                # Windows connection errors - client disconnected
                pass
            else:
                raise

    def do_GET(self):
        """Handle GET requests."""
        if self.path == '/health':
            self.send_response(200)
            self.send_header('Content-type', 'application/json')
            self.send_header('Access-Control-Allow-Origin', '*')
            self.end_headers()
            response = {
                "status": "ok",
                "llm": self.llm_url,
                "search_index_ready": self.rag.is_ready if self.rag else False,
                "search_index_building": self.rag.is_building if self.rag else False
            }
            self.wfile.write(json.dumps(response).encode('utf-8'))
        elif self.path == '/api/courses':
            # Return course data as JSON (more reliable than parsing HTML)
            self.send_response(200)
            self.send_header('Content-type', 'application/json')
            self.send_header('Access-Control-Allow-Origin', '*')
            self.end_headers()
            try:
                if INDEX_FILE.exists():
                    content = INDEX_FILE.read_text(encoding='utf-8')
                    match = re.search(r'const DATA = ({.*?});', content, re.DOTALL)
                    if match:
                        self.wfile.write(match.group(1).encode('utf-8'))
                    else:
                        self.wfile.write(json.dumps({"courses": [], "error": "No data found"}).encode('utf-8'))
                else:
                    self.wfile.write(json.dumps({"courses": [], "error": "Index not found"}).encode('utf-8'))
            except Exception as e:
                self.wfile.write(json.dumps({"courses": [], "error": str(e)}).encode('utf-8'))
        elif self.path == '/api/transcription-status':
            # Get overall transcription progress from progress.json
            try:
                progress_file = TRANSCRIPTS_DIR / "progress.json"
                input_dir = Path("W:/")

                # Count courses on W: drive
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

                status = {
                    "total_courses": len(all_courses),
                    "completed": len(completed),
                    "in_progress": len(in_progress),
                    "pending": len(pending),
                    "total_videos_done": total_videos_done,
                    "completed_courses": completed[:10],  # First 10
                    "in_progress_courses": [
                        {
                            "name": n,
                            "processed": progress_data.get(n, {}).get("processed_videos", 0),
                            "total": progress_data.get(n, {}).get("total_videos", "?"),
                            "worker": progress_data.get(n, {}).get("claimed_by", "")[:8] if progress_data.get(n, {}).get("claimed_by") else "",
                            "current_video": progress_data.get(n, {}).get("current_video", ""),
                            "last_activity": progress_data.get(n, {}).get("last_activity", "")
                        }
                        for n in in_progress
                    ],
                    "pending_courses": pending[:10]  # First 10
                }

                self.send_response(200)
                self.send_header('Content-type', 'application/json')
                self.send_header('Access-Control-Allow-Origin', '*')
                self.end_headers()
                self.wfile.write(json.dumps(status).encode('utf-8'))
            except Exception as e:
                self.send_response(500)
                self.send_header('Content-type', 'application/json')
                self.send_header('Access-Control-Allow-Origin', '*')
                self.end_headers()
                self.wfile.write(json.dumps({"error": str(e)}).encode('utf-8'))
        elif self.path == '/api/generation-status':
            self.send_response(200)
            self.send_header('Content-type', 'application/json')
            self.send_header('Access-Control-Allow-Origin', '*')
            self.end_headers()
            status = self.generation_manager.get_status()
            self.wfile.write(json.dumps(status).encode('utf-8'))
        else:
            # Serve index.html
            if INDEX_FILE.exists():
                self.send_response(200)
                self.send_header('Content-type', 'text/html')
                self.send_header('Access-Control-Allow-Origin', '*')
                self.end_headers()
                self.wfile.write(INDEX_FILE.read_bytes())
            else:
                self.send_response(404)
                self.send_header('Access-Control-Allow-Origin', '*')
                self.end_headers()
                self.wfile.write(b'index.html not found. Run: python generate_index.py')

    def do_OPTIONS(self):
        """Handle CORS preflight."""
        self.send_response(200)
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
        self.send_header('Access-Control-Allow-Headers', 'Content-Type')
        self.end_headers()

    def _send_json_error(self, status_code: int, message: str):
        """Send a JSON error response with CORS headers."""
        try:
            # Sanitize message for JSON encoding
            safe_message = str(message).encode('utf-8', errors='replace').decode('utf-8')
            self.send_response(status_code)
            self.send_header('Content-type', 'application/json')
            self.send_header('Access-Control-Allow-Origin', '*')
            self.end_headers()
            self.wfile.write(json.dumps({"error": safe_message}).encode('utf-8'))
        except Exception as e:
            print(f"[Error] Failed to send error response: {e}")
            try:
                self.send_response(500)
                self.send_header('Content-type', 'application/json')
                self.send_header('Access-Control-Allow-Origin', '*')
                self.end_headers()
                self.wfile.write(b'{"error": "Internal server error"}')
            except Exception:
                pass  # Last resort - can't send any response

    def do_POST(self):
        """Handle POST requests."""
        if self.path == '/api/refresh-index':
            # Manually trigger index regeneration (runs in background)
            try:
                def do_refresh():
                    _regenerate_index()
                    print("Index refresh complete!")

                # Start in background thread so API responds immediately
                thread = threading.Thread(target=do_refresh, daemon=True)
                thread.start()

                self.send_response(200)
                self.send_header('Content-type', 'application/json')
                self.send_header('Access-Control-Allow-Origin', '*')
                self.end_headers()
                self.wfile.write(json.dumps({
                    "status": "started",
                    "message": "Index refresh started in background"
                }).encode('utf-8'))

            except Exception as e:
                self.send_response(500)
                self.send_header('Content-type', 'application/json')
                self.send_header('Access-Control-Allow-Origin', '*')
                self.end_headers()
                self.wfile.write(json.dumps({"error": str(e)}).encode('utf-8'))

        elif self.path == '/api/generate-summary':
            try:
                content_length = int(self.headers.get('Content-Length', 0))
                post_data = self.rfile.read(content_length)
                data = json.loads(post_data.decode('utf-8'))

                course = data.get('course', '').strip()
                if not course:
                    self.send_error(400, "Course name required")
                    return

                result = self.generation_manager.start_generation(course)

                self.send_response(200)
                self.send_header('Content-type', 'application/json')
                self.send_header('Access-Control-Allow-Origin', '*')
                self.end_headers()
                self.wfile.write(json.dumps(result).encode('utf-8'))

            except Exception as e:
                self.send_response(500)
                self.send_header('Content-type', 'application/json')
                self.send_header('Access-Control-Allow-Origin', '*')
                self.end_headers()
                self.wfile.write(json.dumps({"error": str(e)}).encode('utf-8'))

        elif self.path == '/api/delete-course':
            import shutil
            import traceback
            import stat

            def handle_remove_readonly(func, path, exc_info):
                """Handle errors during rmtree by removing read-only flag and retrying."""
                # If it's a permission error, try to fix it
                if exc_info[0] == PermissionError:
                    try:
                        os.chmod(path, stat.S_IWRITE)
                        func(path)
                    except Exception as e:
                        print(f"[Delete] Still failed after chmod: {path} - {e}")

            try:
                content_length = int(self.headers.get('Content-Length', 0))
                post_data = self.rfile.read(content_length)
                print(f"[Delete] Received request: {post_data[:200]}")  # Log first 200 chars
                data = json.loads(post_data.decode('utf-8'))

                course = data.get('course', '').strip()
                print(f"[Delete] Course name: {repr(course)}")  # Log with repr to see special chars

                if not course:
                    self._send_json_error(400, "Course name required")
                    return

                # Verify this isn't trying to delete protected paths
                if course.lower() in ('transcripts', '$recycle.bin', 'system volume information'):
                    self._send_json_error(400, f"Cannot delete protected directory: {course}")
                    return

                # Validate path: prevent path traversal and invalid characters
                if '..' in course or '/' in course or '\\' in course:
                    self._send_json_error(400, "Invalid course name: contains path separators")
                    return

                # Try to delete from W: drive (source videos) first
                source_path = Path("W:/") / course
                transcript_path = TRANSCRIPTS_DIR / course

                # Verify resolved paths are still within expected directories
                try:
                    source_resolved = source_path.resolve()
                    transcript_resolved = transcript_path.resolve()
                    if not str(source_resolved).startswith("W:\\"):
                        self._send_json_error(400, "Invalid course path")
                        return
                    if not str(transcript_resolved).startswith(str(TRANSCRIPTS_DIR.resolve())):
                        self._send_json_error(400, "Invalid transcript path")
                        return
                except Exception as path_err:
                    print(f"[Delete] Path validation error: {path_err}")
                    self._send_json_error(400, f"Invalid course name: {path_err}")
                    return

                print(f"[Delete] Source path: {source_path}")
                print(f"[Delete] Transcript path: {transcript_path}")

                deleted_source = False
                deleted_transcript = False

                # Delete source videos if they exist
                if source_path.exists() and source_path.is_dir():
                    print(f"[Delete] Removing source videos: {source_path}")
                    shutil.rmtree(source_path, onerror=handle_remove_readonly)
                    deleted_source = True
                else:
                    print(f"[Delete] Source path does not exist or not a dir: {source_path.exists()}")

                # Also delete transcripts if they exist
                if transcript_path.exists() and transcript_path.is_dir():
                    print(f"[Delete] Removing transcripts: {transcript_path}")
                    shutil.rmtree(transcript_path, onerror=handle_remove_readonly)
                    deleted_transcript = True
                else:
                    print(f"[Delete] Transcript path does not exist or not a dir: {transcript_path.exists()}")

                if not deleted_source and not deleted_transcript:
                    self._send_json_error(404, f"Course not found: {course}")
                    return

                result_msg = []
                if deleted_source:
                    result_msg.append("source videos")
                if deleted_transcript:
                    result_msg.append("transcripts")

                print(f"[Delete] Successfully deleted {course} ({', '.join(result_msg)})")

                self.send_response(200)
                self.send_header('Content-type', 'application/json')
                self.send_header('Access-Control-Allow-Origin', '*')
                self.end_headers()
                self.wfile.write(json.dumps({
                    "success": True,
                    "course": course,
                    "deleted_source": deleted_source,
                    "deleted_transcript": deleted_transcript
                }).encode('utf-8'))

            except PermissionError as e:
                print(f"[Delete] Permission denied: {e}")
                traceback.print_exc()
                self._send_json_error(403, f"Permission denied. Files may be in use: {e}")
            except Exception as e:
                print(f"[Delete] Error deleting course: {e}")
                traceback.print_exc()
                self._send_json_error(500, str(e))

        elif self.path == '/api/chat':
            try:
                # Check if LLM is available
                if not self.llm_url:
                    self.send_response(200)
                    self.send_header('Content-type', 'application/json')
                    self.send_header('Access-Control-Allow-Origin', '*')
                    self.end_headers()
                    self.wfile.write(json.dumps({
                        "answer": "AI chat is not available. Please start Ollama or LM Studio to enable AI features.",
                        "sources": [],
                        "error": "no_llm"
                    }).encode('utf-8'))
                    return

                content_length = int(self.headers.get('Content-Length', 0))
                post_data = self.rfile.read(content_length)
                data = json.loads(post_data.decode('utf-8'))

                question = data.get('question', '').strip()
                top_k = data.get('top_k', 5)
                course_filter = data.get('course')  # Optional: filter to specific course
                model_override = data.get('model')  # Optional: override model

                if not question:
                    self.send_error(400, "Question required")
                    return

                # Get RAG context (optionally filtered to a course)
                context = self.rag.get_context(question, course_filter=course_filter)
                sources = self.rag.search(question, top_k=top_k, course_filter=course_filter)

                # Generate response (with optional model override)
                answer = self._llm_generate(question, context, model_override=model_override)

                # Format sources for response
                source_list = []
                seen = set()
                for s in sources:
                    key = f"{s.course}|{s.video}"
                    if key not in seen:
                        source_list.append({
                            "course": s.course,
                            "video": s.video,
                            "type": s.doc_type
                        })
                        seen.add(key)

                response_data = {
                    "answer": answer,
                    "sources": source_list
                }

                self.send_response(200)
                self.send_header('Content-type', 'application/json')
                self.send_header('Access-Control-Allow-Origin', '*')
                self.end_headers()
                self.wfile.write(json.dumps(response_data, ensure_ascii=False).encode('utf-8'))

            except Exception as e:
                print(f"Error: {e}")
                self.send_response(500)
                self.send_header('Content-type', 'application/json')
                self.send_header('Access-Control-Allow-Origin', '*')
                self.end_headers()
                error_response = {"error": str(e)}
                self.wfile.write(json.dumps(error_response).encode('utf-8'))
        else:
            self.send_error(404, "Not found")

    def _llm_generate(self, question: str, context: str, model_override: str = None) -> str:
        """Generate response from LLM."""
        system = SYSTEM_PROMPT.format(context=context)
        prompt = RAG_PROMPT.format(question=question)

        # Use model override if provided, otherwise use default
        model = model_override if model_override and model_override != 'default' else self.model

        # Try Ollama first
        if "11434" in self.llm_url:
            url = f"{self.llm_url}/api/chat"
            data = {
                "model": model,
                "messages": [
                    {"role": "system", "content": system},
                    {"role": "user", "content": prompt}
                ],
                "stream": False,
                "options": {"num_predict": 2000}
            }
        else:
            # LM Studio / OpenAI compatible
            url = f"{self.llm_url}/v1/chat/completions"
            data = {
                "model": model,
                "messages": [
                    {"role": "system", "content": system},
                    {"role": "user", "content": prompt}
                ],
                "max_tokens": 2000,
                "temperature": 0.3
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

                if "message" in result:  # Ollama
                    return result.get("message", {}).get("content", "")
                else:  # OpenAI format
                    return result.get("choices", [{}])[0].get("message", {}).get("content", "")

        except Exception as e:
            return f"Error generating response: {e}"


def detect_llm() -> tuple[str, str]:
    """Detect available LLM backend."""
    # Try Ollama first
    try:
        urllib.request.urlopen(f"{OLLAMA_URL}/api/tags", timeout=2)
        return OLLAMA_URL, DEFAULT_MODEL
    except Exception:
        pass

    # Try LM Studio
    try:
        urllib.request.urlopen(f"{LM_STUDIO_URL}/v1/models", timeout=2)
        return LM_STUDIO_URL, "local-model"
    except Exception:
        pass

    return None, None


def sync_progress_with_transcripts():
    """Sync progress.json with actual transcript state on disk.

    This ensures:
    1. Courses with transcripts are marked as completed
    2. Stale in_progress entries are fixed
    3. New transcribed courses are tracked
    """
    from datetime import datetime

    progress_file = TRANSCRIPTS_DIR / "progress.json"

    # Load or create progress
    progress = {"courses": {}}
    if progress_file.exists():
        try:
            with open(progress_file, 'r', encoding='utf-8') as f:
                progress = json.load(f)
        except Exception as e:
            print(f"Could not load progress.json: {e}")

    # System folders to skip
    skip_folders = {"$RECYCLE.BIN", "System Volume Information", ".Trash", "transcripts"}

    changes = 0

    # Scan all transcript directories
    for course_dir in TRANSCRIPTS_DIR.iterdir():
        if not course_dir.is_dir():
            continue
        if course_dir.name.startswith(('.', '$')) or course_dir.name in skip_folders:
            continue

        # Count transcripts
        transcripts = list(course_dir.rglob("*.txt"))
        transcripts = [t for t in transcripts
                      if not t.name.endswith(".summary.md")
                      and t.name != "transcriber.log"]

        if not transcripts:
            continue

        course_name = course_dir.name
        current_data = progress.get("courses", {}).get(course_name, {})
        current_status = current_data.get("status", "")
        total_videos = current_data.get("total_videos", len(transcripts))

        # If not tracked or in_progress but actually complete, fix it
        if not current_status or (current_status == "in_progress" and len(transcripts) >= total_videos):
            progress.setdefault("courses", {})[course_name] = {
                "status": "completed",
                "claimed_by": current_data.get("claimed_by", "pre-existing"),
                "claimed_at": current_data.get("claimed_at", datetime.now().isoformat()),
                "total_videos": len(transcripts),
                "processed_videos": len(transcripts),
                "completed_at": datetime.now().isoformat(),
                "failed_videos": 0
            }
            changes += 1

    # Save if changed
    if changes > 0:
        try:
            with open(progress_file, 'w', encoding='utf-8') as f:
                json.dump(progress, f, indent=2)
            print(f"Synced progress.json: {changes} courses updated")
        except Exception as e:
            print(f"Could not save progress.json: {e}")
    else:
        print("Progress.json is in sync with transcripts")


def check_and_regenerate_index():
    """Check if index needs regeneration and regenerate if needed.

    IMPORTANT: To avoid slow startup, only regenerate if index is MISSING.
    New courses are detected and can be added with a manual refresh.
    """
    # Only regenerate if index file doesn't exist at all
    if not INDEX_FILE.exists():
        print("Index file not found, generating...")
        _regenerate_index()
        return True

    # Index exists - just log the status and skip regeneration
    # This keeps startup fast (< 2 seconds instead of minutes)
    try:
        content = INDEX_FILE.read_text(encoding="utf-8")
        match = re.search(r'const DATA = ({.*?});', content, re.DOTALL)
        if match:
            data = json.loads(match.group(1))
            indexed_count = len(data.get("courses", []))
            print(f"Index loaded ({indexed_count} courses). Use refresh to update if needed.")
        else:
            print("Index loaded (could not parse course count)")
    except Exception as e:
        print(f"Index exists but could not be parsed: {e}")

    return False


def _regenerate_index():
    """Run generate_index.py to regenerate HTML index with progress."""
    script_dir = Path(__file__).parent

    print("[ 0%] Scanning transcripts directory...")

    output_buffer = []

    def read_output(proc):
        for line in iter(proc.stdout.readline, ''):
            if line:
                output_buffer.append(line.strip())

    proc = subprocess.Popen(
        [sys.executable, str(script_dir / "generate_index.py")],
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        text=True,
        bufsize=1,
        universal_newlines=True
    )

    # Start thread to read output
    reader_thread = threading.Thread(target=read_output, args=(proc,))
    reader_thread.daemon = True
    reader_thread.start()

    # Show progress spinner while processing
    spinner = itertools.cycle(['|', '/', '-', '\\'])
    last_output = ""

    while proc.poll() is None:
        if output_buffer:
            new_output = output_buffer[-1]
            if new_output != last_output:
                # Show ALL output from generate_index.py (not just filtered)
                print(f"[{next(spinner)}] {new_output}")
                last_output = new_output
        sys.stdout.flush()
        time.sleep(0.1)

    # Wait for thread to finish
    reader_thread.join(timeout=0.5)

    if proc.returncode == 0:
        print("[100%] Index regenerated successfully")
    else:
        print(f"[ERROR] Index regeneration failed (exit code {proc.returncode})")
        if output_buffer:
            for line in output_buffer[-10:]:  # Show last 10 lines of error
                print(f"  {line}")


def run_server(host: str, port: int):
    """Run the HTTP server."""
    # Create empty placeholder objects first so server can start immediately
    rag = None
    gen_manager = GenerationManager(TRANSCRIPTS_DIR)
    llm_url = ""
    model = ""

    # Mutable container for async initialization results
    init_state = {"rag": None, "llm_url": "", "model": "", "ready": False}

    def do_initialization():
        """Run slow initialization in background."""
        nonlocal rag, llm_url, model

        # Create RAG instance immediately (builds index in background)
        print("Starting RAG index build in background...")
        init_state["rag"] = CourseRAG(build_async=True)

        # Detect LLM (fast)
        detected_url, detected_model = detect_llm()
        if not detected_url:
            print("WARNING: No LLM backend detected.")
            print("AI chat and summary features will be disabled.")
            init_state["llm_url"] = ""
            init_state["model"] = ""
        else:
            print(f"Using LLM: {detected_url} ({detected_model})")
            init_state["llm_url"] = detected_url
            init_state["model"] = detected_model

        # Mark server ready immediately - RAG will build in background
        init_state["ready"] = True
        print("Server ready! (RAG index building in background)")

        # Do slower tasks after server is ready
        print("Syncing progress tracking in background...")
        sync_progress_with_transcripts()

        # Check index (usually fast since we skip regeneration if exists)
        check_and_regenerate_index()
        print("Background initialization complete!")

    # Start initialization in background thread
    init_thread = threading.Thread(target=do_initialization, daemon=True)
    init_thread.start()

    # Create handler that uses the init_state container
    def handler_factory(*args, **kwargs):
        return ChatHandler(
            *args,
            rag=init_state["rag"],
            llm_url=init_state["llm_url"],
            model=init_state["model"],
            generation_manager=gen_manager,
            **kwargs
        )

    # Threaded server so it can respond during index building
    class ThreadedHTTPServer(ThreadingMixIn, HTTPServer):
        daemon_threads = True

    # Start server IMMEDIATELY
    server = ThreadedHTTPServer((host, port), handler_factory)

    print()
    print("=" * 60)
    print("COURSE LIBRARY SERVER")
    print("=" * 60)
    print(f"Server running at: http://{host}:{port}")
    print("(Initializing AI features in background...)")
    print()
    print("Press Ctrl+C to stop the server")
    print("=" * 60)
    print()
    sys.stdout.flush()

    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\n\nShutting down server...")
        server.shutdown()


def main():
    parser = argparse.ArgumentParser(description="Start course library web server with chat")
    parser.add_argument("--host", default=DEFAULT_HOST, help="Host to bind to")
    parser.add_argument("--port", type=int, default=DEFAULT_PORT, help="Port to listen on")

    args = parser.parse_args()

    run_server(args.host, args.port)


if __name__ == "__main__":
    main()
