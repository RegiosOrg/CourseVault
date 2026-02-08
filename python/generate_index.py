#!/usr/bin/env python3
"""
Generate searchable HTML index for all courses and transcripts.
Creates a single-page app with instant search and split-view reader.
"""

import json
import re
from datetime import datetime
from pathlib import Path

TRANSCRIPTS_DIR = Path("W:/transcripts")
OUTPUT_FILE = Path("W:/transcripts/index.html")

HTML_TEMPLATE = """<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Course Library</title>
    <style>
        * { box-sizing: border-box; margin: 0; padding: 0; }

        :root {
            --bg-primary: #0d1117;
            --bg-secondary: #161b22;
            --bg-tertiary: #21262d;
            --border: #30363d;
            --text-primary: #c9d1d9;
            --text-secondary: #f0f6fc;
            --text-muted: #8b949e;
            --accent: #58a6ff;
            --accent-bg: #1f6feb33;
            --badge-green: #238636;
            --scrollbar-track: #0d1117;
            --scrollbar-thumb: #30363d;
        }

        [data-theme="light"] {
            --bg-primary: #ffffff;
            --bg-secondary: #f6f8fa;
            --bg-tertiary: #eaeef2;
            --border: #d0d7de;
            --text-primary: #24292f;
            --text-secondary: #1f2328;
            --text-muted: #57606a;
            --accent: #0969da;
            --accent-bg: #ddf4ff;
            --badge-green: #1a7f37;
            --scrollbar-track: #f6f8fa;
            --scrollbar-thumb: #d0d7de;
        }

        body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            background: var(--bg-primary);
            color: var(--text-primary);
            line-height: 1.6;
            height: 100vh;
            overflow: hidden;
        }

        .app {
            display: flex;
            height: 100vh;
        }

        /* Left Panel - Course List */
        .left-panel {
            width: 45%;
            min-width: 400px;
            display: flex;
            flex-direction: column;
            border-right: 1px solid var(--border);
            overflow: hidden;
        }

        .left-panel.collapsed {
            width: 50px;
            min-width: 50px;
        }

        header {
            background: var(--bg-secondary);
            padding: 15px 20px;
            border-bottom: 1px solid var(--border);
            flex-shrink: 0;
        }

        h1 {
            color: var(--accent);
            margin-bottom: 12px;
            font-size: 1.5em;
        }

        h1.logo {
            cursor: pointer;
        }

        h1.logo:hover {
            opacity: 0.8;
        }

        .search-box {
            position: relative;
        }

        #search {
            width: 100%;
            padding: 10px 15px 10px 40px;
            font-size: 14px;
            background: var(--bg-primary);
            border: 1px solid var(--border);
            border-radius: 6px;
            color: var(--text-primary);
            outline: none;
        }

        #search:focus {
            border-color: var(--accent);
            box-shadow: 0 0 0 3px rgba(88, 166, 255, 0.3);
        }

        .search-icon {
            position: absolute;
            left: 12px;
            top: 50%;
            transform: translateY(-50%);
            color: var(--text-muted);
        }

        .stats {
            margin-top: 8px;
            color: var(--text-muted);
            font-size: 12px;
        }

        .sort-controls {
            margin-top: 10px;
            display: flex;
            align-items: center;
            gap: 8px;
            font-size: 12px;
            color: var(--text-muted);
        }

        .sort-controls select {
            background: var(--bg-primary);
            border: 1px solid var(--border);
            border-radius: 4px;
            color: var(--text-primary);
            padding: 4px 8px;
            font-size: 12px;
            cursor: pointer;
        }

        .sort-controls select:focus {
            outline: none;
            border-color: var(--accent);
        }

        .filter-toggle {
            display: flex;
            align-items: center;
            gap: 4px;
            cursor: pointer;
            margin-left: 12px;
        }

        .filter-toggle input {
            cursor: pointer;
        }

        .read-toggle {
            width: 18px;
            height: 18px;
            border-radius: 50%;
            border: 2px solid var(--text-muted);
            background: transparent;
            cursor: pointer;
            display: flex;
            align-items: center;
            justify-content: center;
            font-size: 10px;
            transition: all 0.2s;
        }

        .read-toggle:hover {
            border-color: var(--accent);
        }

        .read-toggle.read {
            background: #238636;
            border-color: #238636;
            color: white;
        }
        .delete-toggle {
            width: 18px;
            height: 18px;
            border-radius: 50%;
            border: 2px solid var(--text-muted);
            background: transparent;
            cursor: pointer;
            display: flex;
            align-items: center;
            justify-content: center;
            font-size: 12px;
            transition: all 0.2s;
            color: var(--text-muted);
        }
        .delete-toggle:hover {
            border-color: #da3633;
            color: #da3633;
            background: rgba(217, 54, 51, 0.1);
        }
        .course.read .course-header {
            background: #1a3d2e;
        }

        [data-theme="light"] .course.read .course-header {
            background: #d4edda;
        }

        .courses {
            flex: 1;
            overflow-y: auto;
            padding: 10px;
        }

        .course {
            background: var(--bg-secondary);
            border: 1px solid var(--border);
            border-radius: 8px;
            margin-bottom: 10px;
            overflow: hidden;
        }

        .course.hidden { display: none; }

        .course-header {
            padding: 12px 15px;
            background: var(--bg-tertiary);
            cursor: pointer;
            display: flex;
            justify-content: space-between;
            align-items: center;
        }

        .course-header:hover { background: var(--border); }

        .course-title {
            font-size: 1em;
            color: var(--accent);
            font-weight: 600;
        }

        .course-meta {
            color: var(--text-muted);
            font-size: 12px;
        }

        .course-date {
            color: var(--text-muted);
            font-size: 11px;
            white-space: nowrap;
        }

        .course-content {
            display: none;
            max-height: 300px;
            overflow-y: auto;
        }

        .course.expanded .course-content { display: block; }

        .video-list { list-style: none; }

        .video-item {
            padding: 10px 15px;
            border-bottom: 1px solid var(--bg-tertiary);
            cursor: pointer;
            transition: background 0.15s;
        }

        .video-item:hover { background: var(--bg-tertiary); }
        .video-item.active { background: var(--accent-bg); border-left: 3px solid var(--accent); }

        .video-title-row {
            display: flex;
            justify-content: space-between;
            align-items: center;
        }

        .video-name {
            color: var(--text-primary);
            font-size: 13px;
        }

        .video-summary-preview {
            margin-top: 4px;
            font-size: 11px;
            color: var(--text-muted);
            line-height: 1.4;
        }

        .badge {
            font-size: 9px;
            padding: 2px 5px;
            border-radius: 3px;
            margin-left: 8px;
        }

        .badge-summary { background: var(--badge-green); color: white; }

        .expand-icon {
            transition: transform 0.2s;
            font-size: 12px;
        }

        .course.expanded .expand-icon { transform: rotate(90deg); }

        /* Right Panel - Content Reader */
        .right-panel {
            flex: 1;
            display: flex;
            flex-direction: column;
            background: var(--bg-primary);
            overflow: hidden;
        }

        .reader-header {
            background: var(--bg-secondary);
            padding: 15px 20px;
            border-bottom: 1px solid var(--border);
            display: flex;
            justify-content: space-between;
            align-items: center;
        }

        .reader-title {
            font-size: 1.1em;
            color: var(--text-secondary);
            font-weight: 600;
        }

        .reader-subtitle {
            font-size: 12px;
            color: var(--text-muted);
            margin-top: 4px;
        }

        .reader-close {
            background: none;
            border: none;
            color: var(--text-muted);
            cursor: pointer;
            font-size: 20px;
            padding: 5px 10px;
        }

        .reader-close:hover { color: var(--text-secondary); }

        .reader-content {
            flex: 1;
            overflow-y: auto;
            padding: 25px 30px;
        }

        .reader-empty {
            display: flex;
            align-items: center;
            justify-content: center;
            height: 100%;
            color: var(--text-muted);
            font-size: 14px;
        }

        /* Formatted content styles */
        .content-section {
            margin-bottom: 25px;
        }

        .content-section h2 {
            color: var(--accent);
            font-size: 1.1em;
            margin-bottom: 12px;
            padding-bottom: 8px;
            border-bottom: 1px solid var(--border);
        }

        .content-section h3 {
            color: var(--text-secondary);
            font-size: 1em;
            margin: 15px 0 10px 0;
        }

        .content-section p {
            margin-bottom: 12px;
            color: var(--text-primary);
        }

        .content-section ul, .content-section ol {
            margin-left: 20px;
            margin-bottom: 12px;
        }

        .content-section li {
            margin-bottom: 6px;
            color: var(--text-primary);
        }

        .key-point {
            background: var(--bg-tertiary);
            border-left: 3px solid var(--accent);
            padding: 12px 15px;
            margin: 10px 0;
            border-radius: 0 6px 6px 0;
        }

        .transcript-text {
            font-size: 14px;
            line-height: 1.8;
            white-space: pre-wrap;
            color: var(--text-primary);
        }

        .tabs {
            display: flex;
            border-bottom: 1px solid var(--border);
            padding: 0 20px;
            background: var(--bg-secondary);
        }

        .tab {
            padding: 10px 20px;
            cursor: pointer;
            color: var(--text-muted);
            border-bottom: 2px solid transparent;
            margin-bottom: -1px;
            font-size: 13px;
        }

        .tab:hover { color: var(--text-primary); }
        .tab.active {
            color: var(--accent);
            border-bottom-color: var(--accent);
        }

        .match {
            background: rgba(210, 153, 34, 0.4);
            padding: 1px 3px;
            border-radius: 3px;
        }

        .no-results {
            text-align: center;
            padding: 40px;
            color: var(--text-muted);
        }

        /* Hotkey hint */
        .hotkey-hint {
            position: fixed;
            bottom: 15px;
            left: 15px;
            background: var(--bg-tertiary);
            padding: 8px 12px;
            border-radius: 6px;
            font-size: 11px;
            color: var(--text-muted);
        }

        kbd {
            background: var(--bg-primary);
            border: 1px solid var(--border);
            border-radius: 3px;
            padding: 2px 5px;
            font-size: 10px;
        }

        /* Theme toggle */
        .theme-toggle {
            position: fixed;
            top: 15px;
            right: 15px;
            background: var(--bg-tertiary);
            border: 1px solid var(--border);
            border-radius: 6px;
            padding: 8px 12px;
            cursor: pointer;
            font-size: 14px;
            z-index: 100;
            display: flex;
            align-items: center;
            gap: 6px;
            color: var(--text-primary);
        }

        .theme-toggle:hover {
            background: var(--border);
        }

        /* Scrollbar styling */
        ::-webkit-scrollbar { width: 8px; }
        ::-webkit-scrollbar-track { background: var(--scrollbar-track); }
        ::-webkit-scrollbar-thumb { background: var(--scrollbar-thumb); border-radius: 4px; }
        ::-webkit-scrollbar-thumb:hover { background: var(--border); }

        /* Generate button */
        .gen-btn {
            background: var(--accent);
            color: white;
            border: none;
            border-radius: 4px;
            padding: 4px 10px;
            font-size: 11px;
            cursor: pointer;
            margin-left: auto;
        }
        .gen-btn:hover { opacity: 0.9; }
        .gen-btn-small {
            background: var(--bg-tertiary);
            color: var(--text-muted);
            border: 1px solid var(--border);
            border-radius: 4px;
            padding: 2px 6px;
            font-size: 10px;
            cursor: pointer;
        }
        .gen-btn-small:hover { background: var(--border); color: var(--text-primary); }

        /* Generation progress indicator */
        .gen-progress {
            display: inline-flex;
            align-items: center;
            gap: 6px;
            font-size: 11px;
            color: var(--accent);
            margin-left: 8px;
        }

        .gen-spinner {
            width: 14px;
            height: 14px;
            border: 2px solid var(--border);
            border-top-color: var(--accent);
            border-radius: 50%;
            animation: spin 1s linear infinite;
        }

        @keyframes spin {
            to { transform: rotate(360deg); }
        }

        .gen-progress-text {
            max-width: 120px;
            overflow: hidden;
            text-overflow: ellipsis;
            white-space: nowrap;
        }

        /* Toast notifications */
        .toast-container {
            position: fixed;
            bottom: 80px;
            right: 20px;
            z-index: 300;
            display: flex;
            flex-direction: column;
            gap: 10px;
        }

        .toast {
            background: var(--bg-secondary);
            border: 1px solid var(--border);
            border-radius: 8px;
            padding: 12px 16px;
            box-shadow: 0 4px 12px rgba(0,0,0,0.3);
            display: flex;
            align-items: center;
            gap: 10px;
            animation: slideIn 0.3s ease;
        }

        .toast.success { border-left: 3px solid #238636; }
        .toast.error { border-left: 3px solid #da3633; }
        .toast.info { border-left: 3px solid var(--accent); }

        @keyframes slideIn {
            from { transform: translateX(100%); opacity: 0; }
            to { transform: translateX(0); opacity: 1; }
        }

        /* Chat Toggle Button (floating) */
        .chat-fab {
            position: fixed;
            bottom: 20px;
            right: 20px;
            width: 56px;
            height: 56px;
            border-radius: 50%;
            background: var(--accent);
            color: white;
            border: none;
            cursor: pointer;
            font-size: 24px;
            box-shadow: 0 4px 12px rgba(0,0,0,0.3);
            z-index: 100;
            display: flex;
            align-items: center;
            justify-content: center;
            transition: transform 0.2s, box-shadow 0.2s;
        }

        .chat-fab:hover {
            transform: scale(1.1);
            box-shadow: 0 6px 16px rgba(0,0,0,0.4);
        }

        .chat-fab.hidden {
            display: none;
        }

        /* Chat Panel - Modal style, centered, larger */
        .chat-panel {
            position: fixed;
            top: 50%;
            left: 50%;
            transform: translate(-50%, -50%);
            width: 600px;
            max-width: 90vw;
            height: 70vh;
            max-height: 700px;
            background: var(--bg-secondary);
            border: 1px solid var(--border);
            border-radius: 12px;
            display: none;
            flex-direction: column;
            box-shadow: 0 8px 32px rgba(0,0,0,0.4);
            z-index: 200;
        }

        .chat-panel.open {
            display: flex;
        }

        .chat-overlay {
            position: fixed;
            top: 0;
            left: 0;
            right: 0;
            bottom: 0;
            background: rgba(0,0,0,0.5);
            z-index: 150;
            display: none;
        }

        .chat-overlay.open {
            display: block;
        }

        .chat-header {
            padding: 12px 16px;
            border-bottom: 1px solid var(--border);
            display: flex;
            justify-content: space-between;
            align-items: center;
            background: var(--bg-tertiary);
            border-radius: 12px 12px 0 0;
            cursor: move;
            user-select: none;
        }

        .chat-title {
            color: var(--accent);
            font-weight: 600;
            font-size: 16px;
        }

        .chat-header-btns {
            display: flex;
            gap: 8px;
        }

        .chat-close-btn {
            background: none;
            border: none;
            color: var(--text-muted);
            cursor: pointer;
            font-size: 22px;
            padding: 4px 8px;
            border-radius: 4px;
            line-height: 1;
        }

        .chat-close-btn:hover {
            background: var(--border);
            color: var(--text-primary);
        }

        .chat-messages {
            flex: 1;
            overflow-y: auto;
            padding: 20px;
            display: flex;
            flex-direction: column;
            gap: 14px;
        }

        .message {
            max-width: 80%;
            padding: 12px 16px;
            border-radius: 12px;
            font-size: 14px;
            line-height: 1.6;
        }

        .message.user {
            align-self: flex-end;
            background: var(--accent);
            color: white;
            border-bottom-right-radius: 4px;
        }

        .message.assistant {
            align-self: flex-start;
            background: var(--bg-tertiary);
            color: var(--text-primary);
            border-bottom-left-radius: 4px;
            border: 1px solid var(--border);
        }

        .message.error {
            align-self: flex-start;
            background: rgba(217, 83, 79, 0.2);
            color: #da3633;
            border: 1px solid #da3633;
        }

        .message-content {
            white-space: pre-wrap;
            word-wrap: break-word;
        }

        .message-content strong {
            font-weight: 600;
        }

        .message-content em {
            font-style: italic;
        }

        .sources {
            margin-top: 8px;
            font-size: 11px;
            color: var(--text-muted);
            border-top: 1px solid var(--border);
            padding-top: 8px;
        }

        .source-link {
            color: var(--accent);
            text-decoration: none;
            cursor: pointer;
        }

        .source-link:hover {
            text-decoration: underline;
        }

        .chat-input-area {
            padding: 16px;
            border-top: 1px solid var(--border);
            display: flex;
            gap: 10px;
        }

        .chat-input {
            flex: 1;
            padding: 10px 14px;
            border: 1px solid var(--border);
            border-radius: 6px;
            background: var(--bg-primary);
            color: var(--text-primary);
            font-size: 13px;
            outline: none;
        }

        .chat-input:focus {
            border-color: var(--accent);
            box-shadow: 0 0 0 2px rgba(88, 166, 255, 0.2);
        }

        .chat-send-btn {
            background: var(--accent);
            color: white;
            border: none;
            border-radius: 6px;
            padding: 10px 16px;
            cursor: pointer;
            font-size: 13px;
            font-weight: 600;
        }

        .chat-send-btn:hover {
            opacity: 0.9;
        }

        .chat-send-btn:disabled {
            opacity: 0.5;
            cursor: not-allowed;
        }

        .chat-loading {
            display: flex;
            align-items: center;
            gap: 8px;
            padding: 10px;
            color: var(--text-muted);
            font-size: 12px;
        }

        .chat-loading-dot {
            width: 8px;
            height: 8px;
            background: var(--accent);
            border-radius: 50%;
            animation: bounce 1.4s infinite ease-in-out;
        }

        .chat-loading-dot:nth-child(1) { animation-delay: 0s; }
        .chat-loading-dot:nth-child(2) { animation-delay: 0.2s; }
        .chat-loading-dot:nth-child(3) { animation-delay: 0.4s; }

        @keyframes bounce {
            0%, 80%, 100% { transform: translateY(0); }
            40% { transform: translateY(-6px); }
        }
    </style>
</head>
<body>
    <div class="app">
        <!-- Left Panel: Course List -->
        <div class="left-panel" id="leftPanel">
            <header>
                <h1 class="logo" onclick="goHome()">📚 Course Library</h1>
                <div class="search-box">
                    <span class="search-icon">🔍</span>
                    <input type="text" id="search" placeholder="Search courses and videos... (Ctrl+K)" autofocus>
                </div>
                <div class="stats" id="stats"></div>
                <div class="sort-controls">
                    <label>Sort:</label>
                    <select id="sortSelect" onchange="sortCourses(this.value)">
                        <option value="alpha">A-Z</option>
                        <option value="newest">Newest first</option>
                        <option value="oldest">Oldest first</option>
                    </select>
                    <label class="filter-toggle">
                        <input type="checkbox" id="unreadOnly" onchange="toggleUnreadFilter()">
                        <span>Unread only</span>
                    </label>
                    <button class="gen-btn" onclick="generateAllSummaries()" title="Generate AI summaries for all courses">🤖 Generate All</button>
                </div>
            </header>
            <div class="courses" id="courses"></div>
        </div>

        <!-- Right Panel: Content Reader -->
        <div class="right-panel" id="rightPanel">
            <div class="reader-empty" id="readerEmpty">
                <div style="text-align: center;">
                    <div style="font-size: 48px; margin-bottom: 15px;">📖</div>
                    <div>Select a video to view its content</div>
                    <div style="margin-top: 8px; font-size: 12px;">Click any video in the course list</div>
                </div>
            </div>
            <div id="readerView" style="display: none; height: 100%; display: flex; flex-direction: column;">
                <div class="reader-header">
                    <div>
                        <div class="reader-title" id="readerTitle"></div>
                        <div class="reader-subtitle" id="readerSubtitle"></div>
                    </div>
                    <button class="reader-close" onclick="closeReader()">×</button>
                </div>
                <div class="tabs">
                    <div class="tab active" data-tab="summary" onclick="switchTab('summary')">Summary</div>
                    <div class="tab" data-tab="transcript" onclick="switchTab('transcript')">Transcript</div>
                </div>
                <div class="reader-content" id="readerContent"></div>
            </div>
        </div>
    </div>

    <button class="theme-toggle" onclick="toggleTheme()" title="Toggle theme">
        <span id="themeIcon">🌙</span>
        <span id="themeLabel">Dark</span>
    </button>

    <div class="hotkey-hint">
        <kbd>Ctrl</kbd>+<kbd>K</kbd> search &nbsp;|&nbsp;
        <kbd>Esc</kbd> clear/close
    </div>

    <!-- Toast notifications -->
    <div class="toast-container" id="toastContainer"></div>

    <!-- Chat Toggle Button -->
    <button class="chat-fab" id="chatFab" onclick="openChatPanel()" title="Ask AI about courses">💬</button>

    <!-- Chat Overlay -->
    <div class="chat-overlay" id="chatOverlay" onclick="closeChatPanel()"></div>

    <!-- Chat Panel -->
    <div class="chat-panel" id="chatPanel">
        <div class="chat-header" id="chatHeader">
            <span class="chat-title">💬 AI Course Assistant</span>
            <div class="chat-header-btns">
                <button class="chat-close-btn" onclick="closeChatPanel()" title="Close chat">×</button>
            </div>
        </div>
        <div class="chat-messages" id="chatMessages">
            <div class="message assistant">
                <div class="message-content">Hi! I can answer questions about your courses. What would you like to know?</div>
            </div>
        </div>
        <div class="chat-input-area">
            <input type="text" class="chat-input" id="chatInput" placeholder="Ask about courses..." onkeypress="handleChatKeypress(event)">
            <button class="chat-send-btn" id="chatSendBtn" onclick="sendChatMessage()">Send</button>
        </div>
    </div>

    <script>
        const DATA = __DATA_PLACEHOLDER__;
        let currentVideo = null;
        let currentTab = 'summary';
        let readCourses = new Set();
        let showUnreadOnly = false;

        function init() {
            // Check if opened via file:// protocol
            if (window.location.protocol === 'file:') {
                showFileProtocolWarning();
                return;
            }
            loadTheme();
            loadReadState();
            loadUnreadFilterState();
            renderCourses(DATA.courses);
            updateStats(DATA.courses);
            setupSearch();
            setupHotkeys();
            initDrag();
        }

        function showFileProtocolWarning() {
            document.body.innerHTML = `
                <div style="
                    display: flex;
                    flex-direction: column;
                    align-items: center;
                    justify-content: center;
                    height: 100vh;
                    background: var(--bg-primary);
                    color: var(--text-primary);
                    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
                    padding: 40px;
                    text-align: center;
                ">
                    <div style="font-size: 64px; margin-bottom: 20px;">🖥️</div>
                    <h1 style="color: var(--accent); margin-bottom: 16px; font-size: 28px;">Server Required</h1>
                    <p style="color: var(--text-muted); margin-bottom: 24px; max-width: 500px; line-height: 1.6;">
                        This app requires the local server to be running for features like AI chat,
                        summary generation, and course management to work.
                    </p>
                    <div style="
                        background: var(--bg-secondary);
                        border: 1px solid var(--border);
                        border-radius: 8px;
                        padding: 20px 30px;
                        margin-bottom: 24px;
                    ">
                        <p style="color: var(--text-muted); margin-bottom: 12px;">Run this command:</p>
                        <code style="
                            background: var(--bg-tertiary);
                            padding: 10px 20px;
                            border-radius: 6px;
                            font-size: 16px;
                            color: var(--accent);
                            display: block;
                        ">python main.py server</code>
                    </div>
                    <p style="color: var(--text-muted); margin-bottom: 16px;">Then open:</p>
                    <a href="http://localhost:8080" style="
                        color: var(--accent);
                        font-size: 18px;
                        text-decoration: none;
                        padding: 12px 24px;
                        border: 2px solid var(--accent);
                        border-radius: 8px;
                        transition: all 0.2s;
                    " onmouseover="this.style.background='var(--accent)';this.style.color='white';"
                       onmouseout="this.style.background='transparent';this.style.color='var(--accent)';">
                        http://localhost:8080
                    </a>
                </div>
            `;
        }

        function loadReadState() {
            const saved = localStorage.getItem('readCourses');
            if (saved) {
                readCourses = new Set(JSON.parse(saved));
            }
        }

        function saveReadState() {
            localStorage.setItem('readCourses', JSON.stringify([...readCourses]));
        }

        function toggleRead(courseName) {
            if (readCourses.has(courseName)) {
                readCourses.delete(courseName);
            } else {
                readCourses.add(courseName);
            }
            saveReadState();
            renderCourses(DATA.courses, document.getElementById('search').value.trim());
        }

        function deleteCourse(courseName) {
            if (!confirm(`Delete "${courseName}" from W: drive?\\n\\nThis will delete the source videos but keep all transcripts and summaries.\\n\\nThis action cannot be undone.`)) {
                return;
            }

            fetch('/api/delete-course', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ course: courseName })
            })
            .then(res => {
                if (!res.ok) {
                    return res.json().then(data => { throw new Error(data.error || `HTTP ${res.status}`); });
                }
                return res.json();
            })
            .then(data => {
                if (data.error) {
                    showToast('Error: ' + data.error, 'error');
                } else {
                    const deleted = [];
                    if (data.deleted_source) deleted.push('source videos');
                    if (data.deleted_transcript) deleted.push('transcripts');
                    showToast(`Deleted ${courseName} (${deleted.join(' and ')})`, 'success');
                    // Remove course from DATA array and re-render
                    DATA.courses = DATA.courses.filter(c => c.name !== courseName);
                    // Re-render with current sort and search
                    const sortValue = document.getElementById('sortSelect').value;
                    const searchTerm = document.getElementById('search').value.trim();
                    // Re-sort
                    switch(sortValue) {
                        case 'newest':
                            DATA.courses.sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));
                            break;
                        case 'oldest':
                            DATA.courses.sort((a, b) => (a.timestamp || 0) - (b.timestamp || 0));
                            break;
                        case 'alpha':
                        default:
                            DATA.courses.sort((a, b) => a.name.localeCompare(b.name));
                            break;
                    }
                    renderCourses(DATA.courses, searchTerm);
                    updateStats(DATA.courses, searchTerm, DATA.courses.length);
                }
            })
            .catch(err => {
                showToast('Delete failed: ' + err.message, 'error');
            });
        }

        function toggleUnreadFilter() {
            showUnreadOnly = document.getElementById('unreadOnly').checked;
            localStorage.setItem('showUnreadOnly', showUnreadOnly);
            renderCourses(DATA.courses, document.getElementById('search').value.trim());
        }

        function loadUnreadFilterState() {
            const saved = localStorage.getItem('showUnreadOnly');
            if (saved === 'true') {
                showUnreadOnly = true;
                document.getElementById('unreadOnly').checked = true;
            }
        }

        function loadTheme() {
            const saved = localStorage.getItem('theme') || 'dark';
            applyTheme(saved);
        }

        function toggleTheme() {
            const current = document.documentElement.getAttribute('data-theme') || 'dark';
            const next = current === 'dark' ? 'light' : 'dark';
            applyTheme(next);
            localStorage.setItem('theme', next);
        }

        function applyTheme(theme) {
            document.documentElement.setAttribute('data-theme', theme);
            document.getElementById('themeIcon').textContent = theme === 'dark' ? '🌙' : '☀️';
            document.getElementById('themeLabel').textContent = theme === 'dark' ? 'Dark' : 'Light';
        }

        function escapeHtml(text) {
            const div = document.createElement('div');
            div.textContent = text;
            return div.innerHTML;
        }

        function renderCourses(courses, searchTerm = '') {
            const container = document.getElementById('courses');
            container.innerHTML = '';
            let visibleCount = 0;

            courses.forEach((course, displayIdx) => {
                // Find original index in DATA.courses (important for sorting)
                const originalIdx = DATA.courses.findIndex(c => c.name === course.name);

                const matchingVideos = searchTerm
                    ? course.videos.filter(v =>
                        v.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
                        (v.summary && v.summary.toLowerCase().includes(searchTerm.toLowerCase()))
                      )
                    : course.videos;

                const courseMatches = course.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
                    (course.summary && course.summary.toLowerCase().includes(searchTerm.toLowerCase()));

                const isRead = readCourses.has(course.name);
                const passesReadFilter = !showUnreadOnly || !isRead;

                if (passesReadFilter && (!searchTerm || courseMatches || matchingVideos.length > 0)) {
                    visibleCount++;
                    const div = document.createElement('div');
                    div.className = 'course' + (isRead ? ' read' : '');
                    div.dataset.idx = displayIdx;
                    div.dataset.originalIdx = originalIdx;

                    const videoCount = searchTerm && matchingVideos.length !== course.videos.length
                        ? `${matchingVideos.length}/${course.videos.length}`
                        : course.videos.length;

                    const summaryCount = course.videos.filter(v => v.has_summary).length;
                    const needsSummaries = summaryCount < course.videos.length;

                    div.innerHTML = `
                        <div class="course-header">
                            <div onclick="openCourseSummary(${originalIdx})" style="cursor: pointer; flex: 1;">
                                <div class="course-title">${highlightMatch(course.name, searchTerm)}</div>
                                <div class="course-meta">${videoCount} videos${needsSummaries ? ` · ${summaryCount}/${course.videos.length} summarized` : ''}</div>
                            </div>
                            <div style="display: flex; align-items: center; gap: 12px;">
                                ${needsSummaries ? `<button class="gen-btn-small" onclick="event.stopPropagation(); startGeneration('${course.name.replace(/'/g, "\\\\'")}')" title="Generate summaries for this course">🤖</button>` : ''}
                                <button class="delete-toggle" onclick="event.stopPropagation(); deleteCourse('${course.name.replace(/'/g, "\\\\'")}')" title="Delete course from W: drive (keeps transcripts)">
                                    ×
                                </button>
                                <button class="read-toggle ${isRead ? 'read' : ''}" onclick="event.stopPropagation(); toggleRead('${course.name.replace(/'/g, "\\\\'")}')" title="${isRead ? 'Mark as unread' : 'Mark as read'}">
                                    ${isRead ? '✓' : ''}
                                </button>
                                ${course.date ? `<span class="course-date">${course.date}</span>` : ''}
                                <span class="expand-icon" onclick="toggleCourseByName('${course.name.replace(/'/g, "\\\\'")}')" style="cursor: pointer; padding: 8px;">▶</span>
                            </div>
                        </div>
                        <div class="course-content">
                            <ul class="video-list">
                                ${(searchTerm ? matchingVideos : course.videos).map((v, vidx) => `
                                    <li class="video-item" data-course="${originalIdx}" data-video="${course.videos.indexOf(v)}" onclick="openVideo(${originalIdx}, ${course.videos.indexOf(v)})">
                                        <div class="video-title-row">
                                            <span class="video-name">${highlightMatch(v.name, searchTerm)}</span>
                                            ${v.has_summary ? '<span class="badge badge-summary">Summary</span>' : ''}
                                        </div>
                                        ${v.summary ? `<div class="video-summary-preview">${v.summary.substring(0, 100)}...</div>` : ''}
                                    </li>
                                `).join('')}
                            </ul>
                        </div>
                    `;

                    container.appendChild(div);

                    if (searchTerm && (courseMatches || matchingVideos.length > 0)) {
                        div.classList.add('expanded');
                    }
                }
            });

            document.getElementById('no-results')?.remove();
            if (visibleCount === 0) {
                container.innerHTML = '<div class="no-results">No results found.</div>';
            }
            updateStats(courses, searchTerm, visibleCount);
        }

        function openCourseSummary(courseIdx) {
            const course = DATA.courses[courseIdx];

            // Expand the course (find by original index)
            const courseEl = document.querySelector(`.course[data-original-idx="${courseIdx}"]`);
            if (courseEl && !courseEl.classList.contains('expanded')) {
                courseEl.classList.add('expanded');
            }

            // Clear video selection
            document.querySelectorAll('.video-item').forEach(el => el.classList.remove('active'));
            currentVideo = null;

            // Show course summary in reader
            document.getElementById('readerEmpty').style.display = 'none';
            document.getElementById('readerView').style.display = 'flex';
            document.getElementById('readerTitle').textContent = course.name;
            document.getElementById('readerSubtitle').textContent = 'Course Overview';

            // Hide tabs for course summary (only summary, no transcript)
            document.querySelector('.tabs').style.display = 'none';

            const content = document.getElementById('readerContent');
            if (course.full_summary) {
                content.innerHTML = formatSummary(course.full_summary);
            } else {
                content.innerHTML = '<div class="content-section"><p style="color: var(--text-muted);">No course summary available yet. Run: <code>python main.py course --all</code></p></div>';
            }
        }

        function openVideo(courseIdx, videoIdx) {
            const course = DATA.courses[courseIdx];
            const video = course.videos[videoIdx];
            currentVideo = { course, video, courseIdx, videoIdx };

            // Show tabs for videos
            document.querySelector('.tabs').style.display = 'flex';

            // Update active state
            document.querySelectorAll('.video-item').forEach(el => el.classList.remove('active'));
            const activeEl = document.querySelector(`.video-item[data-course="${courseIdx}"][data-video="${videoIdx}"]`);
            if (activeEl) activeEl.classList.add('active');

            // Show reader
            document.getElementById('readerEmpty').style.display = 'none';
            document.getElementById('readerView').style.display = 'flex';
            document.getElementById('readerTitle').textContent = video.name;
            document.getElementById('readerSubtitle').textContent = course.name;

            renderVideoContent();
        }

        function renderVideoContent() {
            if (!currentVideo) return;
            const { video } = currentVideo;
            const content = document.getElementById('readerContent');

            if (currentTab === 'summary') {
                if (video.has_summary && video.full_summary) {
                    content.innerHTML = formatSummary(video.full_summary);
                } else if (video.summary) {
                    content.innerHTML = `
                        <div class="content-section">
                            <h2>Summary</h2>
                            <p>${video.summary}</p>
                        </div>
                    `;
                } else {
                    content.innerHTML = '<div class="content-section"><p style="color: #8b949e;">No summary available. Run: <code>python main.py summaries --all</code></p></div>';
                }
            } else {
                if (video.transcript) {
                    content.innerHTML = `<div class="transcript-text">${escapeHtml(video.transcript)}</div>`;
                } else {
                    content.innerHTML = '<div class="content-section"><p style="color: var(--text-muted);">Transcript not available.</p></div>';
                }
            }
        }

        function formatSummary(text) {
            // Remove YAML frontmatter
            let html = text.replace(/^---[\\s\\S]*?---\\s*/m, '');

            // Convert markdown to HTML
            html = html
                // Headers
                .replace(/^## (.+)$/gm, '<h2>$1</h2>')
                .replace(/^### (.+)$/gm, '<h3>$1</h3>')
                // Bold text
                .replace(/\\*\\*([^*]+)\\*\\*/g, '<strong>$1</strong>')
                // Italic text
                .replace(/\\*([^*]+)\\*/g, '<em>$1</em>')
                // Numbered lists
                .replace(/^(\\d+)\\. (.+)$/gm, '<li>$2</li>')
                // Bullet points
                .replace(/^- (.+)$/gm, '<li>$1</li>');

            // Wrap consecutive <li> in <ul> or <ol>
            html = html.replace(/(<li>.*?<\\/li>\\s*)+/g, '<ul>$&</ul>');

            // Convert double newlines to paragraphs
            html = html.split(/\\n\\n+/).map(p => {
                p = p.trim();
                if (!p || p.startsWith('<h') || p.startsWith('<ul') || p.startsWith('<ol')) return p;
                return '<p>' + p.replace(/\\n/g, '<br>') + '</p>';
            }).join('\\n');

            return `<div class="content-section">${html}</div>`;
        }

        function switchTab(tab) {
            currentTab = tab;
            document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
            document.querySelector(`.tab[data-tab="${tab}"]`).classList.add('active');
            renderVideoContent();
        }

        function closeReader() {
            document.getElementById('readerEmpty').style.display = 'flex';
            document.getElementById('readerView').style.display = 'none';
            document.querySelectorAll('.video-item').forEach(el => el.classList.remove('active'));
            currentVideo = null;
        }

        function goHome() {
            // Clear search, close reader, collapse all courses
            document.getElementById('search').value = '';
            closeReader();
            document.querySelectorAll('.course').forEach(c => c.classList.remove('expanded'));
            renderCourses(DATA.courses);
            window.scrollTo(0, 0);
        }

        function sortCourses(sortBy) {
            const sorted = [...DATA.courses];
            switch(sortBy) {
                case 'newest':
                    sorted.sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));
                    break;
                case 'oldest':
                    sorted.sort((a, b) => (a.timestamp || 0) - (b.timestamp || 0));
                    break;
                case 'alpha':
                default:
                    sorted.sort((a, b) => a.name.localeCompare(b.name));
                    break;
            }
            renderCourses(sorted, document.getElementById('search').value.trim());
        }

        function highlightMatch(text, term) {
            if (!term || !text) return text || '';
            const regex = new RegExp(`(${escapeRegex(term)})`, 'gi');
            return text.replace(regex, '<span class="match">$1</span>');
        }

        function escapeRegex(str) {
            return str.replace(/[.*+?^${}()|[\\]\\\\]/g, '\\\\$&');
        }

        function toggleCourse(idx) {
            const course = document.querySelector(`.course[data-idx="${idx}"]`);
            if (course) course.classList.toggle('expanded');
        }

        function toggleCourseByName(courseName) {
            // Find the course element by matching the title text (more reliable than index)
            const courses = document.querySelectorAll('.course');
            for (const course of courses) {
                const titleEl = course.querySelector('.course-title');
                if (titleEl && titleEl.textContent === courseName) {
                    course.classList.toggle('expanded');
                    break;
                }
            }
        }

        function updateStats(courses, searchTerm = '', visibleCount = null) {
            const totalCourses = courses.length;
            const totalVideos = courses.reduce((sum, c) => sum + c.videos.length, 0);
            let text = `${totalCourses} courses · ${totalVideos} videos`;
            if (searchTerm) text = `Showing ${visibleCount} of ${totalCourses} courses`;
            document.getElementById('stats').textContent = text;
        }

        function setupSearch() {
            const input = document.getElementById('search');
            let debounceTimer;
            input.addEventListener('input', (e) => {
                clearTimeout(debounceTimer);
                debounceTimer = setTimeout(() => {
                    renderCourses(DATA.courses, e.target.value.trim());
                }, 150);
            });
        }

        function setupHotkeys() {
            document.addEventListener('keydown', (e) => {
                if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
                    e.preventDefault();
                    document.getElementById('search').focus();
                }
                if (e.key === 'Escape') {
                    // Close chat panel first if open
                    if (chatPanelOpen) {
                        closeChatPanel();
                        return;
                    }
                    closeModal();
                    const input = document.getElementById('search');
                    if (input.value) {
                        input.value = '';
                        renderCourses(DATA.courses);
                    } else if (currentVideo) {
                        closeReader();
                    }
                    input.blur();
                }
            });
        }

        /* Generation functionality */
        let generationPolling = null;
        let generatingCourses = new Set();

        function startGeneration(courseName) {
            if (generatingCourses.has(courseName)) {
                showToast('Already generating summaries for this course', 'info');
                return;
            }

            fetch('/api/generate-summary', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ course: courseName })
            })
            .then(res => res.json())
            .then(data => {
                if (data.error) {
                    showToast('Error: ' + data.error, 'error');
                } else {
                    generatingCourses.add(courseName);
                    updateCourseProgress(courseName, 'queued');
                    showToast(`Started generating summaries for ${courseName}`, 'info');
                    startPolling();
                }
            })
            .catch(err => {
                showToast('Failed to start generation. Is the server running?', 'error');
            });
        }

        function generateAllSummaries() {
            const needsSummary = DATA.courses.filter(c =>
                c.videos.some(v => !v.has_summary)
            );

            if (needsSummary.length === 0) {
                showToast('All courses already have summaries!', 'success');
                return;
            }

            // Queue all courses that need summaries
            needsSummary.forEach(c => startGeneration(c.name));
        }

        function startPolling() {
            if (generationPolling) return;
            generationPolling = setInterval(pollGenerationStatus, 2000);
            pollGenerationStatus(); // Immediate first poll
        }

        function stopPolling() {
            if (generationPolling) {
                clearInterval(generationPolling);
                generationPolling = null;
            }
        }

        function pollGenerationStatus() {
            fetch('/api/generation-status')
            .then(res => res.json())
            .then(data => {
                // Update current task progress
                if (data.current && data.current.status === 'running') {
                    updateCourseProgress(
                        data.current.course,
                        'running',
                        data.current.progress,
                        data.current.total,
                        data.current.current_video
                    );
                } else if (data.current && data.current.status === 'completed') {
                    generatingCourses.delete(data.current.course);
                    updateCourseProgress(data.current.course, 'completed');
                    showToast(`Completed: ${data.current.course}`, 'success');
                    // Reload page to get updated data
                    setTimeout(() => location.reload(), 1500);
                } else if (data.current && data.current.status === 'failed') {
                    generatingCourses.delete(data.current.course);
                    updateCourseProgress(data.current.course, 'failed');
                    showToast(`Failed: ${data.current.course} - ${data.current.error}`, 'error');
                }

                // Stop polling if nothing is running or queued
                if (!data.current && data.queue.length === 0) {
                    stopPolling();
                    generatingCourses.clear();
                }
            })
            .catch(err => {
                // Server might not be running, stop polling
                stopPolling();
            });
        }

        function updateCourseProgress(courseName, status, progress = 0, total = 0, currentVideo = '') {
            // Find course element
            const courses = document.querySelectorAll('.course');
            for (const course of courses) {
                const idx = parseInt(course.dataset.originalIdx);
                if (DATA.courses[idx] && DATA.courses[idx].name === courseName) {
                    // Find or create progress indicator
                    let progressEl = course.querySelector('.gen-progress');

                    if (status === 'completed' || status === 'failed') {
                        if (progressEl) progressEl.remove();
                        return;
                    }

                    if (!progressEl) {
                        progressEl = document.createElement('span');
                        progressEl.className = 'gen-progress';
                        const header = course.querySelector('.course-header');
                        const meta = header.querySelector('.course-meta');
                        if (meta) meta.appendChild(progressEl);
                    }

                    if (status === 'queued') {
                        progressEl.innerHTML = '<span class="gen-spinner"></span> Queued...';
                    } else if (status === 'running') {
                        const pct = total > 0 ? Math.round((progress / total) * 100) : 0;
                        progressEl.innerHTML = `<span class="gen-spinner"></span> <span class="gen-progress-text">${pct}% - ${currentVideo}</span>`;
                    }
                    break;
                }
            }
        }

        function showToast(message, type = 'info') {
            const container = document.getElementById('toastContainer');
            const toast = document.createElement('div');
            toast.className = `toast ${type}`;
            toast.innerHTML = `
                <span>${type === 'success' ? '✓' : type === 'error' ? '✕' : 'ℹ'}</span>
                <span>${message}</span>
            `;
            container.appendChild(toast);

            // Auto-remove after 5 seconds
            setTimeout(() => {
                toast.style.opacity = '0';
                setTimeout(() => toast.remove(), 300);
            }, 5000);
        }

        function closeModal() {
            // Legacy - no longer used
        }

        function openCourse(courseName, videoName = null) {
            // Find course index by name
            const courseIdx = DATA.courses.findIndex(c => c.name === courseName);
            if (courseIdx === -1) return;

            if (videoName === -1 || videoName === null) {
                // Open course summary
                openCourseSummary(courseIdx);
            } else {
                // Open specific video
                const course = DATA.courses[courseIdx];
                const videoIdx = course.videos.findIndex(v => v.name === videoName);
                if (videoIdx !== -1) {
                    openVideo(courseIdx, videoIdx);
                } else {
                    openCourseSummary(courseIdx);
                }
            }
        }

        /* Chat Panel Functions */
        let chatPanelOpen = false;
        let isDragging = false;
        let dragOffset = { x: 0, y: 0 };

        function openChatPanel() {
            chatPanelOpen = true;
            document.getElementById('chatPanel').classList.add('open');
            document.getElementById('chatOverlay').classList.add('open');
            document.getElementById('chatFab').classList.add('hidden');
            document.getElementById('chatInput').focus();
        }

        function closeChatPanel() {
            chatPanelOpen = false;
            document.getElementById('chatPanel').classList.remove('open');
            document.getElementById('chatOverlay').classList.remove('open');
            document.getElementById('chatFab').classList.remove('hidden');
        }

        // Dragging functionality
        function initDrag() {
            const panel = document.getElementById('chatPanel');
            const header = document.getElementById('chatHeader');

            header.addEventListener('mousedown', (e) => {
                if (e.target.closest('.chat-close-btn')) return;
                isDragging = true;
                const rect = panel.getBoundingClientRect();
                dragOffset.x = e.clientX - rect.left;
                dragOffset.y = e.clientY - rect.top;
                panel.style.transition = 'none';
            });

            document.addEventListener('mousemove', (e) => {
                if (!isDragging) return;
                const panel = document.getElementById('chatPanel');
                const x = e.clientX - dragOffset.x;
                const y = e.clientY - dragOffset.y;

                // Keep within viewport
                const maxX = window.innerWidth - panel.offsetWidth;
                const maxY = window.innerHeight - panel.offsetHeight;
                const clampedX = Math.max(0, Math.min(x, maxX));
                const clampedY = Math.max(0, Math.min(y, maxY));

                panel.style.left = clampedX + 'px';
                panel.style.top = clampedY + 'px';
                panel.style.transform = 'none';
            });

            document.addEventListener('mouseup', () => {
                isDragging = false;
                document.getElementById('chatPanel').style.transition = '';
            });
        }

        function handleChatKeypress(event) {
            if (event.key === 'Enter' && !event.shiftKey) {
                event.preventDefault();
                sendChatMessage();
            }
        }

        function sendChatMessage() {
            const input = document.getElementById('chatInput');
            const question = input.value.trim();

            if (!question) return;

            // Add user message
            addMessage('user', question);

            // Clear input
            input.value = '';

            // Show loading
            showLoading(true);

            // Call server API
            fetch('/api/chat', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ question: question, top_k: 5 })
            })
            .then(res => res.json())
            .then(data => {
                showLoading(false);
                if (data.error) {
                    addMessage('error', data.error);
                } else {
                    addMessage('assistant', data.answer, data.sources);
                }
            })
            .catch(err => {
                showLoading(false);
                addMessage('error', 'Failed to get response. Make sure server is running with python main.py server');
            });
        }

        function addMessage(type, content, sources = null) {
            const container = document.getElementById('chatMessages');
            const div = document.createElement('div');
            div.className = `message ${type}`;

            let messageHtml = `<div class="message-content">${formatMarkdown(content)}</div>`;

            if (sources && sources.length > 0) {
                messageHtml += '<div class="sources"><strong>Sources:</strong> ';
                messageHtml += sources.map(s => {
                    const icon = s.type === 'course_summary' ? '📚' : '📹';
                    return `<a class="source-link" onclick="openCourse('${s.course.replace(/'/g, "\\'")}', ${s.video === 'COURSE OVERVIEW' ? -1 : `'${s.video.replace(/'/g, "\\'")}'`})">${icon} ${s.course}${s.video !== 'COURSE OVERVIEW' ? ` - ${s.video}` : ''}</a>`;
                }).join(' · ');
                messageHtml += '</div>';
            }

            div.innerHTML = messageHtml;
            container.appendChild(div);
            container.scrollTop = container.scrollHeight;
        }

        function showLoading(show) {
            const container = document.getElementById('chatMessages');
            const existing = document.getElementById('chatLoading');

            if (show && !existing) {
                const div = document.createElement('div');
                div.id = 'chatLoading';
                div.className = 'message assistant';
                div.innerHTML = `
                    <div class="chat-loading">
                        <div class="chat-loading-dot"></div>
                        <div class="chat-loading-dot"></div>
                        <div class="chat-loading-dot"></div>
                        <span>Thinking...</span>
                    </div>
                `;
                container.appendChild(div);
                container.scrollTop = container.scrollHeight;
            } else if (!show && existing) {
                existing.remove();
            }
        }

        function formatMarkdown(text) {
            // Basic markdown formatting
            return text
                // Bold: **text** or __text__
                .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
                .replace(/__(.+?)__/g, '<strong>$1</strong>')
                // Italic: *text*
                .replace(/\*(.+?)\*/g, '<em>$1</em>')
                // Links: [text](url)
                .replace(/\[(.+?)\]\((.+?)\)/g, '<a href="$2" target="_blank" style="color: var(--accent);">$1</a>')
                // Bullet points
                .replace(/^[\-•]\s+(.+)$/gm, '• $1')
                .replace(/^\d+\.\s+(.+)$/gm, '$1');
        }

        init();
    </script>
</body>
</html>
"""


def extract_summary_excerpt(summary_path: Path) -> str:
    """Extract key parts from course summary."""
    if not summary_path.exists():
        return ""
    try:
        content = summary_path.read_text(encoding="utf-8")
        match = re.search(r"## Course Overview\s*\n(.+?)(?=\n##|\n---|\Z)", content, re.DOTALL)
        if match:
            return match.group(1).strip()[:500]
        return content[:500]
    except Exception:
        return ""


def extract_video_summary(summary_path: Path) -> tuple[str, str]:
    """Extract summary from video summary file. Returns (short, full)."""
    if not summary_path.exists():
        return "", ""
    try:
        content = summary_path.read_text(encoding="utf-8")
        # Remove YAML frontmatter
        content = re.sub(r"^---\n.*?\n---\n", "", content, flags=re.DOTALL)

        # Find the Summary section for short version
        match = re.search(r"## Summary\s*\n(.+?)(?=\n##|\n---|\Z)", content, re.DOTALL)
        short = match.group(1).strip()[:300] if match else ""

        return short, content
    except Exception:
        return "", ""


def get_course_date(course_name: str) -> tuple[str, float]:
    """Get creation date of course folder. Returns (formatted_date, timestamp)."""
    # Try source folder on W: first
    source_path = Path("W:/") / course_name
    if source_path.exists():
        try:
            mtime = source_path.stat().st_mtime
            return datetime.fromtimestamp(mtime).strftime("%d %b %Y"), mtime
        except Exception:
            pass

    # Fall back to transcripts folder
    transcripts_path = TRANSCRIPTS_DIR / course_name
    if transcripts_path.exists():
        try:
            mtime = transcripts_path.stat().st_mtime
            return datetime.fromtimestamp(mtime).strftime("%d %b %Y"), mtime
        except Exception:
            pass
    return "", 0


def build_index_data() -> dict:
    """Build the data structure for the HTML index."""
    courses = []

    # System folders to skip
    skip_folders = {"$RECYCLE.BIN", "System Volume Information", ".Trash", "transcripts"}

    for course_dir in sorted(TRANSCRIPTS_DIR.iterdir()):
        if not course_dir.is_dir() or course_dir.name.startswith("."):
            continue
        if course_dir.name.startswith("$") or course_dir.name in skip_folders:
            continue

        transcripts = sorted(course_dir.rglob("*.txt"))
        transcripts = [t for t in transcripts if not t.name.endswith(".summary.md")
                       and t.name != "transcriber.log"]

        if not transcripts:
            continue

        summary_path = course_dir / "COURSE_SUMMARY.md"
        summary_excerpt = extract_summary_excerpt(summary_path)
        # Load full course summary for display
        full_course_summary = ""
        if summary_path.exists():
            try:
                full_course_summary = summary_path.read_text(encoding="utf-8")
            except Exception:
                pass
        course_date, course_timestamp = get_course_date(course_dir.name)

        videos = []
        for t in transcripts:
            video_summary_path = t.with_suffix(".summary.md")
            short_summary, full_summary = extract_video_summary(video_summary_path)

            # Read full transcript
            try:
                transcript_full = t.read_text(encoding="utf-8")
            except Exception:
                transcript_full = ""

            videos.append({
                "name": t.stem,
                "path": str(t),
                "summary": short_summary or transcript_full[:150] + "...",
                "full_summary": full_summary,
                "transcript": transcript_full,
                "has_summary": video_summary_path.exists()
            })

        courses.append({
            "name": course_dir.name,
            "path": str(course_dir),
            "summary": summary_excerpt,
            "full_summary": full_course_summary,
            "date": course_date,
            "timestamp": course_timestamp,
            "videos": videos
        })

    return {
        "courses": courses,
        "generated": datetime.now().isoformat(),
        "total_videos": sum(len(c["videos"]) for c in courses)
    }


def generate_html():
    """Generate the HTML index file."""
    print(f"Scanning {TRANSCRIPTS_DIR}...")
    data = build_index_data()
    print(f"Found {len(data['courses'])} courses, {data['total_videos']} videos")

    html = HTML_TEMPLATE.replace("__DATA_PLACEHOLDER__", json.dumps(data, ensure_ascii=False))
    OUTPUT_FILE.write_text(html, encoding="utf-8")
    print(f"Index generated: {OUTPUT_FILE}")
    return OUTPUT_FILE


if __name__ == "__main__":
    generate_html()
