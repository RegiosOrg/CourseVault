import { spawn, exec } from 'child_process'
import https from 'https'
import fs from 'fs'
import path from 'path'
import os from 'os'

const OLLAMA_WINDOWS_URL = 'https://ollama.com/download/OllamaSetup.exe'
const OLLAMA_MAC_URL = 'https://ollama.com/download/Ollama-darwin.zip'
const DEFAULT_MODEL = 'llama3.2'

export interface InstallProgress {
  stage: 'downloading' | 'installing' | 'pulling-model' | 'complete' | 'error'
  progress: number
  message: string
}

export type ProgressCallback = (progress: InstallProgress) => void

/**
 * Download a file with progress tracking
 */
async function downloadFile(
  url: string,
  destPath: string,
  onProgress: (percent: number) => void
): Promise<void> {
  return new Promise((resolve, reject) => {
    const file = fs.createWriteStream(destPath)

    https.get(url, (response) => {
      // Handle redirects
      if (response.statusCode === 301 || response.statusCode === 302) {
        const redirectUrl = response.headers.location
        if (redirectUrl) {
          file.close()
          fs.unlinkSync(destPath)
          downloadFile(redirectUrl, destPath, onProgress).then(resolve).catch(reject)
          return
        }
      }

      const totalSize = parseInt(response.headers['content-length'] || '0', 10)
      let downloadedSize = 0

      response.on('data', (chunk) => {
        downloadedSize += chunk.length
        if (totalSize > 0) {
          onProgress(Math.round((downloadedSize / totalSize) * 100))
        }
      })

      response.pipe(file)

      file.on('finish', () => {
        file.close()
        resolve()
      })

      file.on('error', (err) => {
        file.close()
        fs.unlink(destPath, () => {})
        reject(err)
      })
    }).on('error', (err) => {
      file.close()
      fs.unlink(destPath, () => {})
      reject(err)
    })
  })
}

/**
 * Check if Ollama is already installed
 */
export async function isOllamaInstalled(): Promise<boolean> {
  return new Promise((resolve) => {
    const cmd = process.platform === 'win32' ? 'where ollama' : 'which ollama'
    exec(cmd, (error) => {
      resolve(!error)
    })
  })
}

/**
 * Check if Ollama service is running
 */
export async function isOllamaRunning(): Promise<boolean> {
  return new Promise((resolve) => {
    const http = require('http')
    const req = http.get('http://127.0.0.1:11434/api/tags', (res: any) => {
      resolve(res.statusCode === 200)
    })
    req.on('error', () => resolve(false))
    req.setTimeout(2000, () => {
      req.destroy()
      resolve(false)
    })
  })
}

/**
 * Start Ollama service
 */
export async function startOllamaService(): Promise<void> {
  return new Promise((resolve, reject) => {
    if (process.platform === 'win32') {
      // On Windows, Ollama runs as a background service after installation
      exec('ollama serve', { windowsHide: true }, (error) => {
        if (error && !error.message.includes('address already in use')) {
          reject(error)
        } else {
          resolve()
        }
      })
    } else {
      // On macOS/Linux
      spawn('ollama', ['serve'], {
        detached: true,
        stdio: 'ignore'
      }).unref()
      resolve()
    }
  })
}

/**
 * Install Ollama on Windows
 */
async function installOllamaWindows(onProgress: ProgressCallback): Promise<void> {
  const tempDir = os.tmpdir()
  const installerPath = path.join(tempDir, 'OllamaSetup.exe')

  // Download installer
  onProgress({ stage: 'downloading', progress: 0, message: 'Downloading Ollama installer...' })

  await downloadFile(OLLAMA_WINDOWS_URL, installerPath, (percent) => {
    onProgress({ stage: 'downloading', progress: percent, message: `Downloading... ${percent}%` })
  })

  // Run installer silently
  onProgress({ stage: 'installing', progress: 0, message: 'Installing Ollama...' })

  return new Promise((resolve, reject) => {
    const installer = spawn(installerPath, ['/VERYSILENT', '/NORESTART'], {
      windowsHide: true
    })

    installer.on('close', (code) => {
      // Clean up installer
      fs.unlink(installerPath, () => {})

      if (code === 0) {
        onProgress({ stage: 'installing', progress: 100, message: 'Ollama installed successfully' })
        resolve()
      } else {
        reject(new Error(`Installer exited with code ${code}`))
      }
    })

    installer.on('error', reject)
  })
}

/**
 * Pull a model
 */
export async function pullModel(
  modelName: string,
  onProgress: ProgressCallback
): Promise<void> {
  onProgress({ stage: 'pulling-model', progress: 0, message: `Downloading ${modelName} model...` })

  return new Promise((resolve, reject) => {
    const pull = spawn('ollama', ['pull', modelName], {
      windowsHide: true
    })

    let lastProgress = 0

    pull.stdout?.on('data', (data) => {
      const output = data.toString()
      // Parse progress from output like "pulling manifest... 50%"
      const match = output.match(/(\d+)%/)
      if (match) {
        lastProgress = parseInt(match[1], 10)
        onProgress({
          stage: 'pulling-model',
          progress: lastProgress,
          message: `Downloading ${modelName}... ${lastProgress}%`
        })
      }
    })

    pull.stderr?.on('data', (data) => {
      const output = data.toString()
      // Ollama outputs progress to stderr
      const match = output.match(/(\d+)%/)
      if (match) {
        lastProgress = parseInt(match[1], 10)
        onProgress({
          stage: 'pulling-model',
          progress: lastProgress,
          message: `Downloading ${modelName}... ${lastProgress}%`
        })
      }
    })

    pull.on('close', (code) => {
      if (code === 0) {
        onProgress({ stage: 'pulling-model', progress: 100, message: `${modelName} downloaded` })
        resolve()
      } else {
        reject(new Error(`Failed to pull model: exit code ${code}`))
      }
    })

    pull.on('error', reject)
  })
}

/**
 * Main installation function
 */
export async function installOllama(
  onProgress: ProgressCallback,
  modelName: string = DEFAULT_MODEL
): Promise<void> {
  try {
    // Check if already installed
    const installed = await isOllamaInstalled()

    if (!installed) {
      if (process.platform === 'win32') {
        await installOllamaWindows(onProgress)
      } else if (process.platform === 'darwin') {
        onProgress({
          stage: 'error',
          progress: 0,
          message: 'Please download Ollama manually from ollama.com'
        })
        throw new Error('macOS auto-install not yet supported. Please download from ollama.com')
      } else {
        onProgress({
          stage: 'error',
          progress: 0,
          message: 'Please install Ollama using: curl -fsSL https://ollama.com/install.sh | sh'
        })
        throw new Error('Linux auto-install not yet supported')
      }
    }

    // Wait a moment for installation to complete
    await new Promise(r => setTimeout(r, 2000))

    // Start service if not running
    const running = await isOllamaRunning()
    if (!running) {
      onProgress({ stage: 'installing', progress: 50, message: 'Starting Ollama service...' })
      await startOllamaService()
      // Wait for service to start
      await new Promise(r => setTimeout(r, 3000))
    }

    // Pull default model
    await pullModel(modelName, onProgress)

    onProgress({ stage: 'complete', progress: 100, message: 'Ollama setup complete!' })
  } catch (error) {
    onProgress({
      stage: 'error',
      progress: 0,
      message: error instanceof Error ? error.message : 'Installation failed'
    })
    throw error
  }
}

/**
 * Get list of installed models
 */
export async function getInstalledModels(): Promise<string[]> {
  return new Promise((resolve) => {
    exec('ollama list', (error, stdout) => {
      if (error) {
        resolve([])
        return
      }

      const lines = stdout.trim().split('\n').slice(1) // Skip header
      const models = lines
        .map(line => line.split(/\s+/)[0])
        .filter(Boolean)

      resolve(models)
    })
  })
}
