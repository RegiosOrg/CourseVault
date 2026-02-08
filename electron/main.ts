import { app, BrowserWindow, ipcMain, shell, Tray, Menu, nativeImage } from 'electron'
import { spawn, ChildProcess } from 'child_process'
import crypto from 'crypto'
import path from 'path'
import fs from 'fs'
import os from 'os'
import Store from 'electron-store'
import { z } from 'zod'
import { autoUpdater } from 'electron-updater'

// Schema for validating settings updates via IPC
const settingsSchema = z.discriminatedUnion('key', [
  z.object({ key: z.literal('transcriptsPath'), value: z.string() }),
  z.object({ key: z.literal('sourceDirectories'), value: z.array(z.string()) }),
  z.object({ key: z.literal('serverPort'), value: z.number().int().min(1024).max(65535) }),
  z.object({ key: z.literal('theme'), value: z.enum(['dark', 'light']) }),
  z.object({ key: z.literal('llmBackend'), value: z.enum(['ollama', 'lmstudio', 'openai']).nullable() }),
  z.object({ key: z.literal('whisperModel'), value: z.string() }),
  z.object({ key: z.literal('gpuAcceleration'), value: z.boolean() }),
  z.object({ key: z.literal('parallelWorkers'), value: z.number().int().min(1).max(8) }),
  z.object({ key: z.literal('windowBounds'), value: z.object({ width: z.number(), height: z.number() }) }),
])

// --- LICENSE VALIDATION (Ed25519) ---

// Ed25519 public key for verifying license signatures
const LICENSE_PUBLIC_KEY = `-----BEGIN PUBLIC KEY-----
MCowBQYDK2VwAyEAmknyDiOKfYcPcKC1jtGlJ8yWnYj8L03sC/QIa1FF5ro=
-----END PUBLIC KEY-----`

interface LicensePayload {
  tier: 'pro' | 'pro_plus'
  email: string
  issued: string
  expires: string | null
  machineLimit: number
  features: string[]
}

interface LicenseValidationResult {
  valid: boolean
  tier: 'free' | 'pro' | 'pro_plus'
  status: 'valid' | 'invalid' | 'expired' | 'none'
  email: string | null
  expiresAt: string | null
  features: string[]
  error?: string
}

function validateLicenseKey(key: string): LicenseValidationResult {
  const FREE_FEATURES = ['transcribe', 'summarize', 'chat']
  const invalidResult: LicenseValidationResult = {
    valid: false,
    tier: 'free',
    status: 'invalid',
    email: null,
    expiresAt: null,
    features: FREE_FEATURES,
    error: 'Invalid license key'
  }

  try {
    if (!key || !key.startsWith('CV-')) {
      return { ...invalidResult, error: 'Invalid key format: must start with CV-' }
    }

    const withoutPrefix = key.substring(3)
    const dashIndex = withoutPrefix.indexOf('-')
    if (dashIndex === -1) {
      return { ...invalidResult, error: 'Invalid key format: missing tier separator' }
    }

    const tierPart = withoutPrefix.substring(0, dashIndex)
    const rest = withoutPrefix.substring(dashIndex + 1)
    const dotIndex = rest.lastIndexOf('.')
    if (dotIndex === -1) {
      return { ...invalidResult, error: 'Invalid key format: missing signature' }
    }

    const payloadBase64 = rest.substring(0, dotIndex)
    const signatureBase64 = rest.substring(dotIndex + 1)

    // Verify Ed25519 signature
    const publicKey = crypto.createPublicKey(LICENSE_PUBLIC_KEY)
    const dataToVerify = `${tierPart}-${payloadBase64}`
    const signature = Buffer.from(signatureBase64, 'base64url')
    const isValid = crypto.verify(null, Buffer.from(dataToVerify), publicKey, signature)

    if (!isValid) {
      return { ...invalidResult, error: 'Invalid license key: signature verification failed' }
    }

    // Decode payload
    const payloadJson = Buffer.from(payloadBase64, 'base64url').toString('utf-8')
    const payload = JSON.parse(payloadJson) as LicensePayload

    // Check expiry
    if (payload.expires) {
      const expiryDate = new Date(payload.expires)
      if (expiryDate < new Date()) {
        return {
          valid: false,
          tier: payload.tier,
          status: 'expired',
          email: payload.email,
          expiresAt: payload.expires,
          features: FREE_FEATURES,
          error: 'License has expired'
        }
      }
    }

    return {
      valid: true,
      tier: payload.tier,
      status: 'valid',
      email: payload.email,
      expiresAt: payload.expires,
      features: payload.features
    }
  } catch (err) {
    return { ...invalidResult, error: `License validation error: ${err}` }
  }
}

function getMachineId(): string {
  const components: string[] = [
    os.hostname(),
    os.cpus()[0]?.model || 'unknown-cpu',
    String(os.totalmem()),
    os.platform()
  ]

  // Platform-specific hardware identifiers
  if (process.platform === 'win32') {
    try {
      const result = require('child_process').execSync(
        'reg query "HKEY_LOCAL_MACHINE\\SOFTWARE\\Microsoft\\Cryptography" /v MachineGuid',
        { encoding: 'utf-8', windowsHide: true }
      )
      const match = result.match(/MachineGuid\s+REG_SZ\s+(.+)/)
      if (match) components.push(match[1].trim())
    } catch {
      // Fallback if registry read fails
    }
  } else if (process.platform === 'linux') {
    try {
      const machineId = fs.readFileSync('/etc/machine-id', 'utf-8').trim()
      components.push(machineId)
    } catch {
      // Fallback if file read fails
    }
  } else if (process.platform === 'darwin') {
    try {
      const result = require('child_process').execSync(
        'ioreg -rd1 -c IOPlatformExpertDevice | grep IOPlatformUUID',
        { encoding: 'utf-8' }
      )
      const match = result.match(/"IOPlatformUUID"\s*=\s*"(.+?)"/)
      if (match) components.push(match[1])
    } catch {
      // Fallback if command fails
    }
  }

  return crypto.createHash('sha256')
    .update(components.join('|'))
    .digest('hex')
    .substring(0, 16)
}

// Handle uncaught exceptions to prevent error dialogs for non-critical errors
process.on('uncaughtException', (error) => {
  // Ignore EPIPE errors (broken pipe) - these occur when writing to closed streams
  if (error.message?.includes('EPIPE')) {
    return
  }
  console.error('Uncaught exception:', error)
})

// Initialize electron store for settings
const store = new Store({
  defaults: {
    transcriptsPath: path.join(os.homedir(), 'Documents', 'CourseVault', 'transcripts'),
    sourceDirectories: [path.join(os.homedir(), 'Documents')],
    serverPort: 8080,
    theme: 'dark',
    llmBackend: null, // 'ollama' | 'lmstudio' | 'openai'
    whisperModel: 'base.en',
    gpuAcceleration: true,
    parallelWorkers: 1,
    windowBounds: { width: 1400, height: 900 }
  }
})

// Separate encrypted store for secrets (API keys, license keys)
const secureStore = new Store({
  name: 'secure-settings',
  encryptionKey: 'coursevault-secure-v1',
  defaults: {
    openaiApiKey: null as string | null
  }
})

// Allowed keys for the secure store
const SECURE_KEYS = ['openaiApiKey'] as const
type SecureKey = typeof SECURE_KEYS[number]

let mainWindow: BrowserWindow | null = null
let pythonProcess: ChildProcess | null = null
let transcriptionWorkers: ChildProcess[] = []
let tray: Tray | null = null
let isQuitting = false

// Find the Ollama executable path (it may not be in PATH on Windows)
function findOllamaPath(): string {
  if (process.platform === 'win32') {
    const candidates = [
      path.join(os.homedir(), 'AppData', 'Local', 'Programs', 'Ollama', 'ollama.exe'),
      'C:\\Program Files\\Ollama\\ollama.exe',
      'C:\\Program Files (x86)\\Ollama\\ollama.exe',
    ]
    for (const p of candidates) {
      if (fs.existsSync(p)) return p
    }
  }
  return 'ollama' // fallback to PATH
}

const isDev = process.env.NODE_ENV === 'development' || !app.isPackaged

// Get the path to Python scripts (dev mode only)
function getPythonScriptsPath(): string {
  return process.env.PYTHON_SCRIPTS_PATH || path.join(__dirname, '../../python')
}

// Get path to a bundled PyInstaller executable (production only)
function getBundledExePath(name: string): string {
  const exeExt = process.platform === 'win32' ? '.exe' : ''
  return path.join(process.resourcesPath, 'python-dist', name, `${name}${exeExt}`)
}

// Find Python executable (dev mode only - production uses bundled executables)
function findPython(): string {
  const pythonCommands = ['python', 'python3', 'py']

  for (const cmd of pythonCommands) {
    try {
      const result = require('child_process').execSync(`${cmd} --version`, {
        encoding: 'utf-8',
        windowsHide: true
      })
      if (result.includes('Python 3')) {
        return cmd
      }
    } catch {
      continue
    }
  }

  throw new Error('Python 3 not found. Please install Python 3.9 or later.')
}

// Start the Python backend server
async function startPythonServer(): Promise<void> {
  const port = store.get('serverPort') as number

  let command: string
  let args: string[]
  let cwd: string

  if (isDev) {
    // Development: use Python interpreter with source scripts
    const pythonPath = getPythonScriptsPath()
    const serverScript = path.join(pythonPath, 'course_library_server.py')

    if (!fs.existsSync(serverScript)) {
      console.error(`ERROR: Server script not found at: ${serverScript}`)
      return
    }

    command = findPython()
    args = [serverScript, '--port', String(port)]
    cwd = pythonPath
    console.log(`Starting Python server (dev): ${command} ${args.join(' ')}`)
  } else {
    // Production: use bundled PyInstaller executable
    const exePath = getBundledExePath('coursevault-server')

    if (!fs.existsSync(exePath)) {
      console.error(`ERROR: Bundled server not found at: ${exePath}`)
      return
    }

    command = exePath
    args = ['--port', String(port)]
    cwd = path.dirname(exePath)
    console.log(`Starting Python server (bundled): ${exePath}`)
  }

  console.log(`Port: ${port}`)

  pythonProcess = spawn(command, args, {
    cwd,
    env: { ...process.env, PYTHONUNBUFFERED: '1' },
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe']
  })

  if (!pythonProcess.pid) {
    console.error('ERROR: Failed to spawn Python process')
    return
  }
  console.log(`Python process started with PID: ${pythonProcess.pid}`)

  pythonProcess.stdout?.on('data', (data) => {
    try {
      console.log(`[Python] ${data}`)
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('python-log', data.toString())
      }
    } catch {
      // Ignore errors when window is closing
    }
  })

  pythonProcess.stderr?.on('data', (data) => {
    try {
      const message = data.toString()
      // HTTP access logs go to stderr but aren't errors - filter them
      const isAccessLog = message.includes('HTTP/1.1" 200') ||
                          message.includes('HTTP/1.1" 304') ||
                          message.includes('HTTP/1.1" 204')
      if (isAccessLog) {
        // Don't log successful HTTP requests as errors
        return
      }
      console.error(`[Python Error] ${message}`)
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('python-error', message)
      }
    } catch {
      // Ignore errors when window is closing
    }
  })

  pythonProcess.on('close', (code) => {
    console.log(`Python server exited with code ${code}`)
    pythonProcess = null

    if (!isQuitting) {
      // Restart server if it crashed
      setTimeout(() => startPythonServer(), 2000)
    }
  })

  // Wait for server to be ready
  await waitForServer(port)
}

// Wait for the server to respond (non-blocking monitoring)
async function waitForServer(port: number): Promise<void> {
  // Just monitor and log - don't block, React app handles retries
  const checkServer = async () => {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/health`, {
        method: 'GET',
        signal: AbortSignal.timeout(2000)
      })
      if (response.ok) {
        console.log('Python server is ready!')
        return true
      }
    } catch {
      return false
    }
    return false
  }

  // Check periodically in background, just for logging
  for (let i = 0; i < 60; i++) {
    if (await checkServer()) return
    if (i % 10 === 0) {
      console.log(`Server still initializing... (${i * 2}s elapsed)`)
    }
    await new Promise(r => setTimeout(r, 2000))
  }

  console.warn('Server taking longer than expected, but React app will keep retrying...')
}

// Stop the Python server
function stopPythonServer(): void {
  if (pythonProcess) {
    console.log('Stopping Python server...')
    try {
      // On Windows, use taskkill to ensure the process tree is killed
      if (process.platform === 'win32') {
        const pid = pythonProcess.pid
        if (pid) {
          require('child_process').execSync(`taskkill /pid ${pid} /T /F`, { windowsHide: true })
        }
      } else {
        pythonProcess.kill('SIGTERM')
      }
    } catch (err) {
      console.error('Error stopping Python server:', err)
      // Fallback to regular kill
      pythonProcess.kill()
    }
    pythonProcess = null
  }
}

// Start the transcription workers (supports multiple parallel workers)
function startTranscriptionWorker(): void {
  if (transcriptionWorkers.length > 0) {
    console.log('Transcription workers already running')
    return
  }

  const sourceDirectories = (store.get('sourceDirectories') as string[]) || [path.join(os.homedir(), 'Documents')]
  const gpuEnabled = store.get('gpuAcceleration') as boolean
  const workerCount = (store.get('parallelWorkers') as number) || 1

  let baseCommand: string
  let cwd: string
  let isScript: boolean

  if (isDev) {
    // Development: use Python interpreter with source scripts
    const pythonPath = getPythonScriptsPath()
    const workerScript = path.join(pythonPath, 'parallel_worker.py')

    if (!fs.existsSync(workerScript)) {
      console.error(`ERROR: Worker script not found at: ${workerScript}`)
      return
    }

    baseCommand = findPython()
    cwd = pythonPath
    isScript = true
    console.log(`Starting ${workerCount} transcription worker(s) (dev): ${workerScript}`)
  } else {
    // Production: use bundled PyInstaller executable
    const exePath = getBundledExePath('coursevault-worker')

    if (!fs.existsSync(exePath)) {
      console.error(`ERROR: Bundled worker not found at: ${exePath}`)
      return
    }

    baseCommand = exePath
    cwd = path.dirname(exePath)
    isScript = false
    console.log(`Starting ${workerCount} transcription worker(s) (bundled): ${exePath}`)
  }

  console.log(`GPU acceleration: ${gpuEnabled ? 'enabled' : 'disabled'}`)

  // Use first source directory (TODO: support multiple directories)
  const inputDir = sourceDirectories[0] || path.join(os.homedir(), 'Documents')
  console.log(`Source directories configured: ${sourceDirectories.join(', ')}`)
  console.log(`Using input directory: ${inputDir}`)

  // Spawn multiple workers
  for (let i = 0; i < workerCount; i++) {
    // Build command args with unique worker ID
    const workerId = `worker-${i + 1}-${Date.now()}`
    const args: string[] = isScript
      ? [path.join(cwd, 'parallel_worker.py'), '-i', inputDir, '--worker-id', workerId]
      : ['-i', inputDir, '--worker-id', workerId]
    if (gpuEnabled) {
      args.push('--gpu')
    }

    const worker = spawn(baseCommand, args, {
      cwd,
      env: { ...process.env, PYTHONUNBUFFERED: '1' },
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe']
    })

    if (!worker.pid) {
      console.error(`ERROR: Failed to spawn transcription worker ${i + 1}`)
      continue
    }
    console.log(`Transcription worker ${i + 1} started with PID: ${worker.pid}`)

    worker.stdout?.on('data', (data) => {
      try {
        const lines = data.toString().split('\n').filter((l: string) => l.trim())
        for (const line of lines) {
          console.log(`[Worker ${i + 1}] ${line}`)
          if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.webContents.send('transcriber-log', line)
          }
        }
      } catch {
        // Ignore errors when window is closing
      }
    })

    worker.stderr?.on('data', (data) => {
      try {
        const message = data.toString()
        // Filter out noisy FFmpeg warnings that aren't actionable
        const isFFmpegNoise =
          message.includes('Error while decoding stream') ||
          message.includes('Invalid data found when processing input') ||
          message.includes('channel element') ||
          message.includes('duplicate') ||
          message.includes('Application provided invalid') ||
          message.includes('Last message repeated')

        if (isFFmpegNoise) {
          // Log to console but don't send to UI
          console.log(`[Worker ${i + 1} FFmpeg] ${message.trim().substring(0, 100)}...`)
          return
        }

        console.error(`[Worker ${i + 1} Error] ${message}`)
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send('transcriber-error', message)
        }
      } catch {
        // Ignore errors when window is closing
      }
    })

    worker.on('close', (code) => {
      console.log(`Transcription worker ${i + 1} exited with code ${code}`)
      // Remove from array
      transcriptionWorkers = transcriptionWorkers.filter(w => w !== worker)

      // Notify renderer if all workers stopped
      if (transcriptionWorkers.length === 0 && mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('transcriber-status', { running: false, exitCode: code })
      }
    })

    transcriptionWorkers.push(worker)
  }

  // Notify renderer that workers started
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('transcriber-status', { running: true, workerCount: transcriptionWorkers.length })
  }
}

// Stop all transcription workers
function stopTranscriptionWorker(): void {
  if (transcriptionWorkers.length === 0) {
    return
  }

  console.log(`Stopping ${transcriptionWorkers.length} transcription worker(s)...`)

  for (const worker of transcriptionWorkers) {
    try {
      if (process.platform === 'win32') {
        const pid = worker.pid
        if (pid) {
          require('child_process').execSync(`taskkill /pid ${pid} /T /F`, { windowsHide: true })
        }
      } else {
        worker.kill('SIGTERM')
      }
    } catch (err) {
      console.error('Error stopping transcription worker:', err)
      try {
        worker.kill()
      } catch {
        // Already dead
      }
    }
  }
  transcriptionWorkers = []
}

// Auto-start Ollama if configured and not running
async function autoStartOllama(): Promise<void> {
  const llmBackend = store.get('llmBackend') as string | null

  // Only auto-start if Ollama is configured
  if (llmBackend !== 'ollama') {
    console.log(`LLM backend is '${llmBackend}', not auto-starting Ollama`)
    return
  }

  try {
    // Check if Ollama is already running
    const http = require('http')
    const isRunning = await new Promise<boolean>((resolve) => {
      const req = http.get('http://127.0.0.1:11434/api/tags', (res: any) => {
        resolve(res.statusCode === 200)
      })
      req.on('error', () => resolve(false))
      req.setTimeout(2000, () => {
        req.destroy()
        resolve(false)
      })
    })

    if (isRunning) {
      console.log('Ollama is already running')
      return
    }

    console.log('Ollama not running, attempting to start...')

    // Try to start Ollama
    const ollamaPath = findOllamaPath()
    console.log('Starting Ollama from:', ollamaPath)
    const ollamaProcess = spawn(ollamaPath, ['serve'], {
      detached: true,
      stdio: 'ignore',
      windowsHide: true,
      env: { ...process.env, OLLAMA_HOST: '0.0.0.0:11434' }
    })
    ollamaProcess.unref()

    // Wait for it to start
    await new Promise(resolve => setTimeout(resolve, 3000))

    // Verify it started
    const started = await new Promise<boolean>((resolve) => {
      const req = http.get('http://127.0.0.1:11434/api/tags', (res: any) => {
        resolve(res.statusCode === 200)
      })
      req.on('error', () => resolve(false))
      req.setTimeout(5000, () => {
        req.destroy()
        resolve(false)
      })
    })

    if (started) {
      console.log('Ollama started successfully')
    } else {
      console.log('Failed to start Ollama - may need to be installed or started manually')
    }
  } catch (err) {
    console.error('Error auto-starting Ollama:', err)
  }
}

// Auto-start transcription worker if there are pending courses
async function autoStartTranscriptionWorker(): Promise<void> {
  const port = store.get('serverPort') as number

  try {
    // Wait a bit for the server to be fully ready
    await new Promise(resolve => setTimeout(resolve, 3000))

    // Check transcription status with longer timeout and retry
    let response: Response | null = null
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        response = await fetch(`http://127.0.0.1:${port}/api/transcription-status`, {
          signal: AbortSignal.timeout(10000)
        })
        if (response.ok) break
      } catch (fetchErr) {
        console.log(`Transcription status check attempt ${attempt}/3 failed:`, fetchErr)
        if (attempt < 3) {
          await new Promise(resolve => setTimeout(resolve, 2000))
        }
      }
    }

    if (!response || !response.ok) {
      console.log('Could not fetch transcription status, starting worker anyway (may have pending work)')
      startTranscriptionWorker()
      return
    }

    const status = await response.json() as { pending?: number; in_progress?: number }
    const pendingCount = status.pending || 0
    const inProgressCount = status.in_progress || 0

    console.log(`Transcription status: ${pendingCount} pending, ${inProgressCount} in progress`)

    // Auto-start if there are courses to process
    if (pendingCount > 0 || inProgressCount > 0) {
      console.log('Auto-starting transcription worker for pending courses...')
      startTranscriptionWorker()
    } else {
      console.log('All courses transcribed, worker not started')
    }
  } catch (err) {
    console.error('Error checking transcription status for auto-start:', err)
    // Start worker anyway on error - better to have workers running than missing pending work
    console.log('Starting transcription worker due to status check failure')
    startTranscriptionWorker()
  }
}

// Create the main window
function createWindow(): void {
  const bounds = store.get('windowBounds') as { width: number; height: number }

  // Determine icon path based on environment
  const iconPath = isDev
    ? path.join(__dirname, '../resources/icon.png')
    : path.join(process.resourcesPath, 'icon.png')

  mainWindow = new BrowserWindow({
    width: bounds.width,
    height: bounds.height,
    minWidth: 1000,
    minHeight: 700,
    title: 'Course Vault',
    show: false, // Don't show until ready
    backgroundColor: '#0d1117', // Match dark theme to prevent white flash
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    },
    icon: fs.existsSync(iconPath) ? iconPath : undefined,
    autoHideMenuBar: true,
    // Frameless window with custom controls
    frame: false,
    transparent: false
  })

  // Remove menu bar on Windows/Linux
  if (process.platform !== 'darwin') {
    mainWindow.setMenuBarVisibility(false)
  }

  // Save window size on resize
  mainWindow.on('resize', () => {
    if (mainWindow) {
      const [width, height] = mainWindow.getSize()
      store.set('windowBounds', { width, height })
    }
  })

  // Show window only when content is ready (prevents white flash)
  mainWindow.once('ready-to-show', () => {
    mainWindow?.show()
    mainWindow?.focus()
  })

  // Fallback: show after 3 seconds even if not ready (prevents stuck loading)
  setTimeout(() => {
    if (mainWindow && !mainWindow.isVisible()) {
      console.log('Showing window after timeout (fallback)')
      mainWindow.show()
    }
  }, 3000)

  // Load the app
  if (isDev) {
    mainWindow.loadURL('http://localhost:5173')
  } else {
    mainWindow.loadFile(path.join(__dirname, '../dist/index.html'))
  }

  // Handle window close - in dev mode quit, in production hide to tray
  mainWindow.on('close', (event) => {
    if (!isQuitting && !isDev) {
      event.preventDefault()
      mainWindow?.hide()
    }
  })

  mainWindow.on('closed', () => {
    mainWindow = null
  })

  // Open external links in browser
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url)
    return { action: 'deny' }
  })
}

// Create system tray
function createTray(): void {
  const iconPath = isDev
    ? path.join(__dirname, '../resources/icon.png')
    : path.join(process.resourcesPath, 'icon.png')

  // Create a simple icon if none exists
  let icon: Electron.NativeImage
  if (fs.existsSync(iconPath)) {
    icon = nativeImage.createFromPath(iconPath)
  } else {
    // Create a placeholder icon
    icon = nativeImage.createEmpty()
  }

  tray = new Tray(icon.resize({ width: 16, height: 16 }))

  const contextMenu = Menu.buildFromTemplate([
    {
      label: 'Show CourseVault',
      click: () => {
        mainWindow?.show()
      }
    },
    {
      label: 'Restart Server',
      click: async () => {
        stopPythonServer()
        await startPythonServer()
      }
    },
    { type: 'separator' },
    {
      label: 'Quit',
      click: () => {
        isQuitting = true
        app.quit()
      }
    }
  ])

  tray.setToolTip('CourseVault')
  tray.setContextMenu(contextMenu)

  tray.on('click', () => {
    mainWindow?.show()
  })
}

// IPC Handlers
function setupIPC(): void {
  // Get settings
  ipcMain.handle('get-settings', () => {
    return store.store
  })

  // Update settings (validated)
  ipcMain.handle('set-settings', (_, key: string, value: unknown) => {
    const result = settingsSchema.safeParse({ key, value })
    if (!result.success) {
      console.warn(`Rejected invalid setting: ${key}`, result.error.format())
      return false
    }
    store.set(result.data.key, result.data.value)
    return true
  })

  // Get server status
  ipcMain.handle('get-server-status', () => {
    return {
      running: pythonProcess !== null,
      port: store.get('serverPort')
    }
  })

  // Restart server
  ipcMain.handle('restart-server', async () => {
    stopPythonServer()
    await startPythonServer()
    return true
  })

  // Transcription worker controls
  ipcMain.handle('start-transcription', () => {
    startTranscriptionWorker()
    return { running: transcriptionWorkers.length > 0, workerCount: transcriptionWorkers.length }
  })

  ipcMain.handle('stop-transcription', () => {
    stopTranscriptionWorker()
    return { running: false }
  })

  ipcMain.handle('get-transcription-status', () => {
    return {
      running: transcriptionWorkers.length > 0,
      workerCount: transcriptionWorkers.length,
      pids: transcriptionWorkers.map(w => w.pid).filter(Boolean)
    }
  })

  // Open folder dialog
  ipcMain.handle('select-folder', async () => {
    const { dialog } = require('electron')
    const result = await dialog.showOpenDialog(mainWindow!, {
      properties: ['openDirectory']
    })
    return result.filePaths[0] || null
  })

  // Check if Ollama is running
  ipcMain.handle('check-ollama', async () => {
    try {
      const http = require('http')
      return new Promise((resolve) => {
        const req = http.get('http://127.0.0.1:11434/api/tags', (res: any) => {
          resolve(res.statusCode === 200)
        })
        req.on('error', () => resolve(false))
        req.setTimeout(2000, () => {
          req.destroy()
          resolve(false)
        })
      })
    } catch {
      return false
    }
  })

  // Start Ollama service
  ipcMain.handle('start-ollama', async () => {
    try {
      // On Windows, try to start Ollama
      if (process.platform === 'win32') {
        // Try starting via 'ollama serve' in background
        const ollamaPath = findOllamaPath()
        console.log('Starting Ollama from:', ollamaPath)
        const ollamaProcess = spawn(ollamaPath, ['serve'], {
          detached: true,
          stdio: 'ignore',
          windowsHide: true,
          env: { ...process.env, OLLAMA_HOST: '0.0.0.0:11434' }
        })
        ollamaProcess.unref()
        console.log('Started Ollama serve process')

        // Wait a moment for it to start
        await new Promise(resolve => setTimeout(resolve, 3000))

        // Check if it's running now
        const http = require('http')
        return new Promise((resolve) => {
          const req = http.get('http://127.0.0.1:11434/api/tags', (res: any) => {
            resolve({ success: res.statusCode === 200 })
          })
          req.on('error', () => resolve({ success: false, error: 'Ollama not responding' }))
          req.setTimeout(5000, () => {
            req.destroy()
            resolve({ success: false, error: 'Timeout' })
          })
        })
      } else {
        // On macOS/Linux
        const ollamaProcess = spawn(findOllamaPath(), ['serve'], {
          detached: true,
          stdio: 'ignore',
          env: { ...process.env, OLLAMA_HOST: '0.0.0.0:11434' }
        })
        ollamaProcess.unref()
        await new Promise(resolve => setTimeout(resolve, 3000))
        return { success: true }
      }
    } catch (err) {
      console.error('Failed to start Ollama:', err)
      return { success: false, error: String(err) }
    }
  })

  // Get list of installed Ollama models
  ipcMain.handle('get-ollama-models', async () => {
    try {
      const http = require('http')
      return new Promise((resolve) => {
        const req = http.get('http://127.0.0.1:11434/api/tags', (res: any) => {
          if (res.statusCode !== 200) {
            resolve({ success: false, models: [], error: 'Ollama not responding' })
            return
          }
          let data = ''
          res.on('data', (chunk: string) => { data += chunk })
          res.on('end', () => {
            try {
              const parsed = JSON.parse(data)
              const models = (parsed.models || []).map((m: any) => ({
                name: m.name,
                size: m.size,
                modified: m.modified_at
              }))
              resolve({ success: true, models })
            } catch {
              resolve({ success: false, models: [], error: 'Failed to parse response' })
            }
          })
        })
        req.on('error', () => resolve({ success: false, models: [], error: 'Ollama not running' }))
        req.setTimeout(5000, () => {
          req.destroy()
          resolve({ success: false, models: [], error: 'Timeout' })
        })
      })
    } catch (err) {
      return { success: false, models: [], error: String(err) }
    }
  })

  // Check if LM Studio is running
  ipcMain.handle('check-lmstudio', async () => {
    try {
      const http = require('http')
      return new Promise((resolve) => {
        const req = http.get('http://localhost:1234/v1/models', (res: any) => {
          resolve(res.statusCode === 200)
        })
        req.on('error', () => resolve(false))
        req.setTimeout(2000, () => {
          req.destroy()
          resolve(false)
        })
      })
    } catch {
      return false
    }
  })

  // Secure settings (encrypted store for API keys)
  ipcMain.handle('get-secure-setting', (_, key: string) => {
    if (!SECURE_KEYS.includes(key as SecureKey)) {
      console.warn(`Rejected get-secure-setting for unknown key: ${key}`)
      return null
    }
    return secureStore.get(key)
  })

  ipcMain.handle('set-secure-setting', (_, key: string, value: string | null) => {
    if (!SECURE_KEYS.includes(key as SecureKey)) {
      console.warn(`Rejected set-secure-setting for unknown key: ${key}`)
      return false
    }
    secureStore.set(key, value)
    return true
  })

  // License validation (Ed25519 signature verification in main process)
  ipcMain.handle('validate-license', (_, key: string) => {
    return validateLicenseKey(key)
  })

  // Machine identification
  ipcMain.handle('get-machine-id', () => {
    return getMachineId()
  })

  // Open external URL (restricted to safe protocols)
  ipcMain.handle('open-external', (_, url: string) => {
    try {
      const parsed = new URL(url)
      if (parsed.protocol === 'https:' || parsed.protocol === 'http:') {
        shell.openExternal(url)
      } else {
        console.warn(`Blocked open-external with unsafe protocol: ${parsed.protocol}`)
      }
    } catch {
      console.warn(`Blocked open-external with invalid URL: ${url}`)
    }
  })

  // Quit the application completely
  ipcMain.handle('quit-app', () => {
    console.log('Quit requested from renderer')
    isQuitting = true
    app.quit()
  })

  // Window control handlers for frameless window
  ipcMain.handle('window-minimize', () => {
    mainWindow?.minimize()
  })

  ipcMain.handle('window-maximize', () => {
    if (mainWindow?.isMaximized()) {
      mainWindow.unmaximize()
    } else {
      mainWindow?.maximize()
    }
  })

  ipcMain.handle('window-close', () => {
    mainWindow?.close()
  })

  ipcMain.handle('window-is-maximized', () => {
    return mainWindow?.isMaximized() || false
  })
}

// Auto-updater event handlers
function setupAutoUpdater(): void {
  // Only check for updates in production builds
  if (isDev) {
    console.log('Auto-updater disabled in development')
    return
  }

  // Configure auto-updater
  autoUpdater.autoDownload = true
  autoUpdater.autoInstallOnAppQuit = true

  // Check for updates on startup
  autoUpdater.checkForUpdatesAndNotify().catch(err => {
    console.error('Auto-updater initial check failed:', err)
  })

  // Check periodically (every 4 hours)
  setInterval(() => {
    autoUpdater.checkForUpdatesAndNotify().catch(err => {
      console.error('Auto-updater periodic check failed:', err)
    })
  }, 4 * 60 * 60 * 1000)

  // Forward events to renderer
  autoUpdater.on('update-available', (info) => {
    console.log('Update available:', info.version)
    mainWindow?.webContents.send('update-available', {
      version: info.version,
      releaseDate: info.releaseDate,
      releaseNotes: info.releaseNotes
    })
  })

  autoUpdater.on('update-downloaded', (info) => {
    console.log('Update downloaded:', info.version)
    mainWindow?.webContents.send('update-downloaded', {
      version: info.version,
      releaseDate: info.releaseDate
    })
  })

  autoUpdater.on('download-progress', (progress) => {
    mainWindow?.webContents.send('update-progress', {
      percent: progress.percent,
      bytesPerSecond: progress.bytesPerSecond,
      transferred: progress.transferred,
      total: progress.total
    })
  })

  autoUpdater.on('error', (err) => {
    console.error('Auto-updater error:', err)
    mainWindow?.webContents.send('update-error', err.message)
  })

  // IPC handler for manual update check
  ipcMain.handle('check-for-updates', async () => {
    try {
      const result = await autoUpdater.checkForUpdates()
      return {
        checking: true,
        updateInfo: result?.updateInfo || null
      }
    } catch (err) {
      console.error('Manual update check failed:', err)
      return {
        checking: false,
        error: err instanceof Error ? err.message : String(err)
      }
    }
  })

  // IPC handler to install update and restart
  ipcMain.handle('install-update', () => {
    autoUpdater.quitAndInstall()
  })
}

// App lifecycle
app.whenReady().then(async () => {
  setupIPC()
  createTray()

  // Create window FIRST so user sees something immediately
  createWindow()

  // Setup auto-updater
  setupAutoUpdater()

  // Auto-start Ollama if configured
  autoStartOllama()

  // Start Python server in the background - don't block the window
  // The React app will handle retrying connections
  startPythonServer().then(() => {
    // After server is ready, check if we should auto-start transcription worker
    autoStartTranscriptionWorker()
  }).catch(error => {
    console.error('Failed to start Python server:', error)
  })

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow()
    } else {
      mainWindow?.show()
    }
  })
})

app.on('window-all-closed', () => {
  // In development, quit the app entirely
  if (isDev) {
    app.quit()
  }
  // In production on macOS, keep running
  // On Windows/Linux production, the tray handles it
})

app.on('before-quit', () => {
  isQuitting = true
  stopTranscriptionWorker()
  stopPythonServer()
})

app.on('quit', () => {
  // Ensure all processes are terminated
  stopTranscriptionWorker()
  stopPythonServer()
  // Force exit in development to kill Vite and other processes
  if (isDev) {
    process.exit(0)
  }
})

// Handle second instance - focus existing window
const gotTheLock = app.requestSingleInstanceLock()
if (!gotTheLock) {
  app.quit()
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore()
      mainWindow.show()
      mainWindow.focus()
    }
  })
}
