# CourseVault - Project Hand-Off Document

> Last updated: 2026-02-08
> Status: Phase 1 Week 4 of 4 COMPLETE. Phase 1 is DONE. Next: Phase 2 (Website, LemonSqueezy, Beta Testing)

---

## 1. What Is CourseVault?

An Electron desktop app that uses on-device AI to index, transcribe, and search video course libraries. Users point it at folders of video courses (Udemy, Coursera downloads, etc.) and it:
- Transcribes videos using whisper.cpp (local, no cloud)
- Generates AI summaries using Ollama or LM Studio (local LLMs)
- Provides full-text search across all transcripts
- Offers AI chat that understands your entire course library

**Business model:** One-time purchase ($59 Pro), with optional $7.99/mo Pro+ subscription for cloud features later. Free tier has 100-course/200-hour limit.

---

## 2. Tech Stack

| Layer | Technology |
|-------|-----------|
| Desktop shell | Electron 28 |
| Frontend | React 18 + TypeScript + Vite |
| Styling | Tailwind CSS + CSS variables |
| State | Zustand with localStorage persistence |
| Backend | Python 3.10+ (stdlib only, zero pip deps) |
| IPC | contextBridge with typed preload |
| Bundling | PyInstaller (Python) + electron-builder (Electron) |
| License | Ed25519 signature verification |
| External deps | ffmpeg, whisper.cpp, Ollama/LM Studio (NOT bundled) |

---

## 3. Directory Structure

```
C:\Projects\CourseVault\
├── electron/                 # Electron main process
│   ├── main.ts              # Main process (1100+ lines) - IPC, Python spawn, tray, window, license validation
│   ├── preload.ts           # IPC bridge (contextBridge)
│   └── installers/          # Ollama/LM Studio auto-install helpers
├── src/                     # React renderer
│   ├── App.tsx
│   ├── main.tsx
│   ├── api/client.ts        # HTTP client to Python backend
│   ├── components/          # UI components (ChatPanel, ContentViewer, Sidebar, StatusBar, CourseCard, ui/)
│   ├── hooks/               # useChat, useCourses, useSettings
│   ├── lib/                 # license.ts, machineId.ts
│   ├── screens/             # Dashboard, Settings, SetupWizard
│   ├── stores/appStore.ts   # Central Zustand store
│   └── types/global.d.ts   # ElectronAPI type definitions (SOURCE OF TRUTH for renderer types)
├── python/                  # Python backend (12 files, all stdlib)
│   ├── course_library_server.py  # HTTP server (main backend)
│   ├── parallel_worker.py        # Transcription worker
│   ├── transcriber.py            # whisper.cpp wrapper
│   ├── video_summaries.py        # Per-video AI summaries
│   ├── course_summary.py         # Per-course AI summaries
│   ├── summarizer.py             # LLM abstraction (Ollama/LM Studio/OpenAI)
│   ├── chat.py                   # AI chat with RAG
│   ├── query.py                  # Search/query engine
│   ├── generate_index.py         # Course index generator
│   ├── staged_processor.py       # USB-to-SSD staging pipeline
│   ├── main.py                   # CLI entry point
│   ├── setup.py                  # Dependency checker
│   ├── coursevault-server.spec   # PyInstaller spec (server)
│   └── coursevault-worker.spec   # PyInstaller spec (worker)
├── tools/
│   ├── build-python.js      # PyInstaller build orchestrator
│   └── generate-license.js  # Ed25519 license key generator (NOT shipped)
├── website/
│   └── index.html           # Landing page (NEEDS COMPLETE REWRITE - see Phase 2)
├── resources/
│   └── icon.png             # App icon
├── .keys/                   # Ed25519 keypair (gitignored, generated via `node tools/generate-license.js init`)
├── package.json
├── tsconfig.json
├── tsconfig.electron.json
├── vite.config.ts
├── tailwind.config.js
└── .gitignore
```

---

## 4. What Has Been Completed (Phases 1.1 - 1.3)

### Week 1: Security & Cleanup (DONE)

| Task | What Changed |
|------|-------------|
| Remove hardcoded paths | `C:/Stuff/webinar_transcriber` and `W:/transcripts` replaced with env vars / `~/Documents/CourseVault/` defaults |
| Fix XSS | DOMPurify added to `ContentViewer.tsx` and `ChatPanel.tsx` |
| Secure dev backdoor | License dev bypass gated behind `VITE_ENABLE_DEV_LICENSES=true` env var |
| IPC validation | `set-settings` validated with Zod discriminated union; `open-external` restricted to http/https |
| Secure API keys | OpenAI API key moved from localStorage to encrypted `electron-store` (separate `secure-settings` store) |
| License field | `package.json` changed from `"MIT"` to `"UNLICENSED"` |

### Week 2: License System (DONE)

| Task | What Changed |
|------|-------------|
| Ed25519 keypair | Generated via `node tools/generate-license.js init`, stored in `.keys/` (gitignored) |
| Main process validation | `validateLicenseKey()` in `electron/main.ts` verifies Ed25519 signature, checks expiry |
| Machine ID | `getMachineId()` using SHA-256 of hostname + CPU + RAM + platform GUID |
| IPC handlers | `validate-license` and `get-machine-id` in main process |
| Renderer wired up | `appStore.ts` calls `window.electronAPI.validateLicense()` instead of regex matching |
| License key CLI | `tools/generate-license.js` with commands: `init`, `pro <email>`, `pro_plus <email>`, `verify <key>`, `show-public` |
| License format | `CV-{PRO|PROPLUS}-{base64url_json_payload}.{base64url_ed25519_signature}` |
| Public key embedded | In both `electron/main.ts` (main process) and `src/lib/license.ts` (renderer, for display only) |

### Week 3: Python Bundling (DONE)

| Task | What Changed |
|------|-------------|
| PyInstaller specs | `python/coursevault-server.spec` and `python/coursevault-worker.spec` (--onedir mode) |
| Build script | `tools/build-python.js` orchestrates PyInstaller builds |
| Dual-mode spawn | `electron/main.ts`: dev uses `findPython()` + `.py` scripts, production uses `getBundledExePath()` for `.exe` |
| npm scripts | `build:python`, `build:python:server`, `build:python:worker`, `build:python:clean` |
| Build chain | `npm run build` = `build:python` → `tsc` → `vite` → `electron-builder` |
| extraResources | Changed from raw `.py` files to `python-dist/coursevault-server/` and `python-dist/coursevault-worker/` |
| Remaining hardcoded path | `staged_processor.py` `W:/transcripts` replaced with env-var-based default |

### Week 4: Build Pipeline & Installer (DONE)

| Task | What Changed |
|------|-------------|
| GitHub repo | Created at https://github.com/RegiosOrg/CourseVault |
| CI/CD workflow | `.github/workflows/build.yml` - tag-triggered builds for Windows/macOS/Linux |
| NSIS installer | Per-user install, shortcuts, EULA, custom icons |
| EULA | Created `resources/EULA.txt` |
| Icons | Generated via `npm run generate-icons` |
| electron-updater | Wired in main.ts, preload.ts, global.d.ts; checks every 4 hours |
| Publish config | Added GitHub release provider to package.json |

---

## 5. Known Gotchas (READ THESE FIRST)

### Type System
- **`global.d.ts` is the SOURCE OF TRUTH** for renderer types. Both `preload.ts` and `global.d.ts` declare `Window.electronAPI` - they MUST stay in sync. If you add an IPC handler in `main.ts` + expose it in `preload.ts`, you MUST also update `global.d.ts`.
- **`TIER_FEATURES` uses `as const`** - you must spread `[...TIER_FEATURES.free]` when assigning to `string[]` (readonly tuple vs mutable array).
- **`LLMBackend` type** is `'ollama' | 'lmstudio' | 'openai' | null` - the `'openai'` was missing before and caused unreachable code branches.

### Python Backend
- **Zero third-party dependencies.** All 12 Python files use only stdlib. This is why the bundle is small (~50-80MB).
- **External binary dependencies** (ffmpeg, whisper.cpp, Ollama) are NOT bundled. Users must install these separately. The `SetupWizard` helps with this.
- The Python server (`course_library_server.py`) runs as an HTTP server on localhost. The Electron renderer talks to it via `src/api/client.ts`.

### Build
- **PyInstaller must be installed** to build: `pip install pyinstaller`
- The `python-dist/` directory is a build output (gitignored). It's created by `npm run build:python`.
- `npm run build` will FAIL if PyInstaller isn't installed (it runs `build:python` first).
- For dev mode, just use `npm run electron:dev` - no PyInstaller needed.

### Git Repository
GitHub repo is set up at https://github.com/RegiosOrg/CourseVault with CI/CD workflow.

---

## 6. Completed: Phase 1 Week 4 - Build Pipeline & Installer

### 6.1 GitHub Setup ✅

- GitHub repo created: https://github.com/RegiosOrg/CourseVault
- Source code pushed to main branch

### 6.2 GitHub Actions CI/CD ✅

Created `.github/workflows/build.yml` with:
- Tag-triggered builds (`v*`)
- Windows build job (production-ready)
- macOS and Linux jobs (disabled until code signing is set up)
- Artifact upload to GitHub Releases

### 6.3 Code Signing ⏸️ (Waiting on user)

**Windows - Azure Trusted Signing (~$10/mo):**
- Workflow commented out, ready to enable
- Placeholder for `@anthropic/trusted-signing-action`

**macOS - Apple Developer Program ($99/yr):**
- Job disabled with `if: false`
- Ready to enable when credentials added

**Required user action:**
1. Create Azure Trusted Signing account
2. Enroll in Apple Developer Program (if targeting macOS)
3. Add secrets to GitHub repo settings

### 6.4 NSIS Installer Improvements ✅

Updated `package.json` `build.nsis` section:
- `perMachine: false` = per-user install (no admin required)
- Desktop and Start Menu shortcuts
- EULA displayed during install
- Custom icons for installer/uninstaller

Created `resources/EULA.txt` with license terms.
Generated icon files via `npm run generate-icons`.

### 6.5 electron-updater ✅

Wired up in `electron/main.ts`:
- `autoUpdater.checkForUpdatesAndNotify()` on startup
- Periodic check every 4 hours
- IPC handlers: `check-for-updates`, `install-update`
- Events forwarded to renderer: `update-available`, `update-downloaded`, `update-progress`, `update-error`

Exposed in `electron/preload.ts`:
- `checkForUpdates()`, `installUpdate()`
- Event listeners: `onUpdateAvailable`, `onUpdateDownloaded`, `onUpdateProgress`, `onUpdateError`

Added types to `src/types/global.d.ts`.

Added to `package.json` build config:
```json
"publish": [{
  "provider": "github",
  "owner": "RegiosOrg",
  "repo": "CourseVault"
}]
```

---

## 7. Key Files Quick Reference

When making changes, these are the files you'll most likely touch:

| File | Purpose | Notes |
|------|---------|-------|
| `electron/main.ts` | Main process logic | ~1100 lines. IPC handlers, Python spawn, license, window management |
| `electron/preload.ts` | IPC bridge | Must expose every handler registered in main.ts |
| `src/types/global.d.ts` | ElectronAPI types | **SOURCE OF TRUTH** for renderer. Must match preload.ts exactly |
| `src/stores/appStore.ts` | Zustand store | Central state. License, settings, courses |
| `src/hooks/useSettings.ts` | Settings hook | API keys via encrypted IPC, settings read/write |
| `package.json` | Build config | electron-builder config, scripts, deps |
| `tools/build-python.js` | PyInstaller build | `node tools/build-python.js [server|worker|clean]` |
| `tools/generate-license.js` | License key gen | `node tools/generate-license.js [init|pro|pro_plus|verify|show-public]` |

---

## 8. How to Run in Development

```bash
# Install dependencies
npm install

# Start dev mode (Vite + Electron)
npm run electron:dev

# TypeScript check only
npx tsc -p tsconfig.electron.json --noEmit

# Build production (requires PyInstaller: pip install pyinstaller)
npm run build
```

**Dev mode does NOT need PyInstaller.** It uses the Python interpreter directly with source `.py` files.

---

## 9. Full Plan Reference

The complete 4-phase plan (Weeks 1-12 + Months 4-12) is at:
`C:\Users\layfon\.claude\plans\effervescent-sparking-pond.md`

**Phase summary:**
- Phase 1 (Weeks 1-4): Pre-release technical fixes - Weeks 1-3 DONE, Week 4 TODO
- Phase 2 (Weeks 5-8): Website overhaul, LemonSqueezy payment, beta testing, content
- Phase 3 (Weeks 9-12): Product Hunt launch, HN, Reddit, post-launch growth
- Phase 4 (Months 4-12): macOS/Linux, cloud sync, enterprise features

---

## 10. Verification Checklist (Phase 1 Exit)

Phase 1 is complete. Manual verification steps:

- [ ] Clean install on fresh Windows 10 VM (no Python installed) - app launches and works
- [ ] License activation with Ed25519-signed key succeeds
- [ ] Regex-format fake keys (e.g. `PRO-12345`) are rejected
- [ ] No XSS when transcript contains `<script>alert(1)</script>`
- [ ] electron-updater detects a newer GitHub Release
- [ ] Installer is code-signed (no SmartScreen warning) ⏸️ (requires Azure Trusted Signing setup)
- [ ] `npm run build` produces a working installer end-to-end

**Code signing status:** Windows and macOS code signing workflows are ready but disabled until you set up:
- Azure Trusted Signing (~$10/mo) for Windows
- Apple Developer Program ($99/yr) for macOS
