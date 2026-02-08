#!/usr/bin/env python3
"""
Setup helper - Check and install dependencies.
"""

import os
import shutil
import subprocess
import sys
import urllib.request
from pathlib import Path


def check_ffmpeg() -> bool:
    """Check if ffmpeg is installed."""
    return shutil.which("ffmpeg") is not None


def check_whisper_cpp() -> Path | None:
    """Check if whisper.cpp is installed. Prefers GPU/CUDA version."""
    common_paths = [
        # Prefer StarWhisper CUDA11 (GPU accelerated - FAST)
        Path.home() / "AppData/Local/Programs/StarWhisper/resources/bin/cuda11/whisper-cli-cuda.exe",
        # Fallback to StarWhisper CPU
        Path.home() / "AppData/Local/Programs/StarWhisper/resources/bin/whisper-cli.exe",
        # Fallback to standalone whisper.cpp
        Path("C:/whisper.cpp/Release/whisper-cli.exe"),
        Path("C:/whisper.cpp/whisper-cli.exe"),
        Path("C:/whisper.cpp/Release/main.exe"),
        Path("C:/whisper.cpp/main.exe"),
    ]

    for path in common_paths:
        if path.exists():
            return path

    return None


def check_ollama() -> bool:
    """Check if Ollama is running."""
    try:
        urllib.request.urlopen("http://127.0.0.1:11434/api/tags", timeout=2)
        return True
    except Exception:
        return False


def check_lm_studio() -> bool:
    """Check if LM Studio is running."""
    urls_to_try = ["http://192.168.56.1:80", "http://localhost:1234"]
    for url in urls_to_try:
        try:
            urllib.request.urlopen(f"{url}/v1/models", timeout=2)
            return True
        except Exception:
            continue
    return False


def print_status(name: str, ok: bool, detail: str = ""):
    """Print status line."""
    status = "\033[92m[OK]\033[0m" if ok else "\033[91m[MISSING]\033[0m"
    detail_str = f" - {detail}" if detail else ""
    print(f"  {status} {name}{detail_str}")


def main():
    # Enable ANSI colors on Windows
    if sys.platform == "win32":
        os.system("")

    print("\n" + "=" * 60)
    print("Webinar Transcriber - Dependency Check")
    print("=" * 60)

    all_ok = True

    # Check Python version
    py_ok = sys.version_info >= (3, 10)
    print_status(f"Python {sys.version_info.major}.{sys.version_info.minor}", py_ok,
                 "3.10+ required")
    all_ok &= py_ok

    # Check ffmpeg
    ffmpeg_ok = check_ffmpeg()
    print_status("ffmpeg", ffmpeg_ok,
                 "Install from https://ffmpeg.org/download.html" if not ffmpeg_ok else "")
    all_ok &= ffmpeg_ok

    # Check whisper.cpp
    whisper_path = check_whisper_cpp()
    whisper_ok = whisper_path is not None
    print_status("whisper.cpp", whisper_ok,
                 str(whisper_path) if whisper_ok else "See instructions below")
    all_ok &= whisper_ok

    # Check LLM (optional)
    print("\nOptional (for summaries and Q&A):")
    ollama_ok = check_ollama()
    lm_studio_ok = check_lm_studio()
    print_status("Ollama", ollama_ok,
                 "Running" if ollama_ok else "Not running (optional)")
    print_status("LM Studio", lm_studio_ok,
                 "Running" if lm_studio_ok else "Not running (optional)")

    # Print instructions for missing components
    if not all_ok:
        print("\n" + "-" * 60)
        print("Installation Instructions")
        print("-" * 60)

        if not ffmpeg_ok:
            print("""
FFmpeg:
  1. Download from https://github.com/BtbN/FFmpeg-Builds/releases
     (ffmpeg-master-latest-win64-gpl.zip)
  2. Extract to C:\\ffmpeg
  3. Add C:\\ffmpeg\\bin to your PATH

  Or use winget:
    winget install ffmpeg
""")

        if not whisper_ok:
            print("""
Whisper.cpp:
  Option A - Download pre-built (easiest):
    1. Go to https://github.com/ggerganov/whisper.cpp/releases
    2. Download whisper-bin-x64.zip
    3. Extract to C:\\whisper.cpp
    4. Download a model:
       curl -L -o C:\\whisper.cpp\\models\\ggml-base.en.bin ^
         https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-base.en.bin

  Option B - Build from source:
    git clone https://github.com/ggerganov/whisper.cpp
    cd whisper.cpp
    cmake -B build
    cmake --build build --config Release
""")

        if not ollama_ok and not lm_studio_ok:
            print("""
For AI Summaries (choose one):

  Ollama (recommended):
    1. Download from https://ollama.com/download
    2. Install and run
    3. Pull a model: ollama pull llama3.2

  LM Studio:
    1. Download from https://lmstudio.ai
    2. Download a model (e.g., Llama 3.2)
    3. Start local server in LM Studio
""")

    else:
        print("\n" + "\033[92m" + "All required dependencies are installed!" + "\033[0m")

    print("\n" + "=" * 60)
    print("Usage")
    print("=" * 60)
    print("""
  # Preview files to process (dry run)
  python main.py transcribe --dry-run

  # Transcribe all videos
  python main.py transcribe

  # Generate AI summaries
  python main.py summarize

  # Interactive query interface
  python main.py query

  # Run complete pipeline
  python main.py full
""")

    return 0 if all_ok else 1


if __name__ == "__main__":
    sys.exit(main())
