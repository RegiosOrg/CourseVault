# CourseVault - Project Hand-Off Document

> Last updated: 2026-02-08
> Status: Phase 1 Week 3 of 4 COMPLETE. Next: Week 4 (CI/CD, Code Signing, Auto-Update)

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

### Not a Git Repo Yet
The project does NOT have git initialized. You'll need to `git init` and set up the remote as part of Week 4.

---

## 6. Next Task: Phase 1 Week 4 - Build Pipeline & Installer

This is the final week of Phase 1. Four sub-tasks:

### 6.1 GitHub Setup

1. Initialize git repo: `git init`
2. Create private GitHub repo for source code
3. Create initial commit with all current files
4. Consider a separate public repo for releases (or use the same repo with private source + public releases)

### 6.2 GitHub Actions CI/CD

Create `.github/workflows/build.yml` - a tag-triggered workflow (`v*`) that:

1. **Builds Python** (PyInstaller) on each target OS:
   - Windows: `windows-latest` runner
   - macOS: `macos-latest` runner (future)
   - Linux: `ubuntu-latest` runner (future)

2. **Builds Electron** (electron-builder) on each OS:
   - Uses PyInstaller output from step 1
   - Runs `tsc`, `vite build`, `electron-builder`

3. **Code signs** the output (see 6.3)

4. **Uploads** to GitHub Releases

**Key workflow steps:**
```yaml
# Pseudo-structure:
on:
  push:
    tags: ['v*']

jobs:
  build-windows:
    runs-on: windows-latest
    steps:
      - Checkout
      - Setup Node.js 20
      - Setup Python 3.10
      - pip install pyinstaller
      - npm ci
      - npm run build:python
      - npm run build:win  (but separated: tsc + vite + electron-builder --win)
      - Code sign (Azure Trusted Signing)
      - Upload artifacts to GitHub Release
```

### 6.3 Code Signing

**Windows - Azure Trusted Signing (~$10/mo):**
- Gives immediate SmartScreen trust (no reputation building needed)
- Sign the NSIS installer `.exe` and the app `.exe`
- Store Azure credentials as GitHub Actions secrets
- Use `@anthropic/trusted-signing-action` or equivalent in CI

**macOS - Apple Developer Program ($99/yr):**
- Required for notarization (Gatekeeper)
- Store cert + notarization credentials as GitHub secrets
- electron-builder handles notarization when `CSC_LINK` and `APPLE_ID` etc. are set

**The user needs to:**
1. Create an Azure Trusted Signing account
2. Enroll in Apple Developer Program (if targeting macOS)
3. Add signing secrets to GitHub repo settings

### 6.4 NSIS Installer Improvements

Update `package.json` `build.nsis` section:

```json
"nsis": {
  "oneClick": false,
  "allowToChangeInstallationDirectory": true,
  "perMachine": false,
  "createDesktopShortcut": true,
  "createStartMenuShortcut": true,
  "shortcutName": "CourseVault",
  "license": "resources/EULA.txt",
  "installerIcon": "resources/icon.ico",
  "uninstallerIcon": "resources/icon.ico",
  "installerHeaderIcon": "resources/icon.ico"
}
```

- `perMachine: false` = per-user install (no admin required)
- Need to create `resources/EULA.txt`
- Need to generate `resources/icon.ico` from `resources/icon.png` (script exists: `scripts/generate-icons.js`)

### 6.5 Wire Up electron-updater

The `electron-updater` package is already in `package.json` dependencies but NOT wired up in code.

**In `electron/main.ts`:**

```typescript
import { autoUpdater } from 'electron-updater'

// In app.whenReady():
autoUpdater.checkForUpdatesAndNotify()

// Check periodically (every 4 hours):
setInterval(() => {
  autoUpdater.checkForUpdatesAndNotify()
}, 4 * 60 * 60 * 1000)

// IPC handlers for manual check from Settings UI:
ipcMain.handle('check-for-updates', () => {
  return autoUpdater.checkForUpdates()
})

// Events to forward to renderer:
autoUpdater.on('update-available', (info) => {
  mainWindow?.webContents.send('update-available', info)
})
autoUpdater.on('update-downloaded', (info) => {
  mainWindow?.webContents.send('update-downloaded', info)
})
autoUpdater.on('error', (err) => {
  console.error('Auto-updater error:', err)
})
```

**In `package.json` build config, add publish:**
```json
"build": {
  "publish": [
    {
      "provider": "github",
      "owner": "YOUR_GITHUB_USERNAME",
      "repo": "coursevault-releases"
    }
  ]
}
```

**In `electron/preload.ts`:**
- Expose `checkForUpdates` IPC call

**In `src/types/global.d.ts`:**
- Add `checkForUpdates` to ElectronAPI interface

**In renderer (Settings screen):**
- Add "Check for Updates" button
- Listen for `update-available` and `update-downloaded` events
- Show "Update available - restart to install" banner

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

After completing Week 4, verify:

- [ ] Clean install on fresh Windows 10 VM (no Python installed) - app launches and works
- [ ] License activation with Ed25519-signed key succeeds
- [ ] Regex-format fake keys (e.g. `PRO-12345`) are rejected
- [ ] No XSS when transcript contains `<script>alert(1)</script>`
- [ ] electron-updater detects a newer GitHub Release
- [ ] Installer is code-signed (no SmartScreen warning)
- [ ] `npm run build` produces a working installer end-to-end
