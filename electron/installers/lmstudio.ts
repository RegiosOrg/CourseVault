import { exec, spawn } from 'child_process'
import https from 'https'
import fs from 'fs'
import path from 'path'
import os from 'os'

const LM_STUDIO_WINDOWS_URL = 'https://releases.lmstudio.ai/windows/x64/latest'
const LM_STUDIO_MAC_URL = 'https://releases.lmstudio.ai/mac/arm64/latest'

export interface InstallProgress {
  stage: 'downloading' | 'installing' | 'configuring' | 'complete' | 'error'
  progress: number
  message: string
}

export type ProgressCallback = (progress: InstallProgress) => void

/**
 * Download a file with progress tracking and redirect handling
 */
async function downloadFile(
  url: string,
  destPath: string,
  onProgress: (percent: number) => void
): Promise<void> {
  return new Promise((resolve, reject) => {
    const makeRequest = (requestUrl: string, redirectCount = 0) => {
      if (redirectCount > 5) {
        reject(new Error('Too many redirects'))
        return
      }

      const protocol = requestUrl.startsWith('https') ? https : require('http')

      protocol.get(requestUrl, (response: any) => {
        // Handle redirects
        if (response.statusCode === 301 || response.statusCode === 302 || response.statusCode === 307) {
          const redirectUrl = response.headers.location
          if (redirectUrl) {
            makeRequest(redirectUrl, redirectCount + 1)
            return
          }
        }

        if (response.statusCode !== 200) {
          reject(new Error(`HTTP ${response.statusCode}`))
          return
        }

        const file = fs.createWriteStream(destPath)
        const totalSize = parseInt(response.headers['content-length'] || '0', 10)
        let downloadedSize = 0

        response.on('data', (chunk: Buffer) => {
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

        file.on('error', (err: Error) => {
          fs.unlink(destPath, () => {})
          reject(err)
        })
      }).on('error', (err: Error) => {
        reject(err)
      })
    }

    makeRequest(url)
  })
}

/**
 * Check if LM Studio is installed
 */
export async function isLmStudioInstalled(): Promise<boolean> {
  const possiblePaths = process.platform === 'win32'
    ? [
        path.join(os.homedir(), 'AppData', 'Local', 'LM-Studio', 'LM Studio.exe'),
        path.join(process.env['PROGRAMFILES'] || '', 'LM Studio', 'LM Studio.exe'),
        path.join(process.env['LOCALAPPDATA'] || '', 'Programs', 'LM Studio', 'LM Studio.exe')
      ]
    : [
        '/Applications/LM Studio.app',
        path.join(os.homedir(), 'Applications', 'LM Studio.app')
      ]

  for (const p of possiblePaths) {
    if (fs.existsSync(p)) {
      return true
    }
  }

  return false
}

/**
 * Check if LM Studio server is running
 */
export async function isLmStudioRunning(): Promise<boolean> {
  return new Promise((resolve) => {
    const http = require('http')
    const req = http.get('http://localhost:1234/v1/models', (res: any) => {
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
 * Find LM Studio executable path
 */
export function findLmStudioPath(): string | null {
  const possiblePaths = process.platform === 'win32'
    ? [
        path.join(os.homedir(), 'AppData', 'Local', 'LM-Studio', 'LM Studio.exe'),
        path.join(process.env['PROGRAMFILES'] || '', 'LM Studio', 'LM Studio.exe'),
        path.join(process.env['LOCALAPPDATA'] || '', 'Programs', 'LM Studio', 'LM Studio.exe')
      ]
    : [
        '/Applications/LM Studio.app/Contents/MacOS/LM Studio',
        path.join(os.homedir(), 'Applications', 'LM Studio.app', 'Contents', 'MacOS', 'LM Studio')
      ]

  for (const p of possiblePaths) {
    if (fs.existsSync(p)) {
      return p
    }
  }

  return null
}

/**
 * Launch LM Studio
 */
export async function launchLmStudio(): Promise<void> {
  const exePath = findLmStudioPath()

  if (!exePath) {
    throw new Error('LM Studio not found')
  }

  if (process.platform === 'win32') {
    spawn(exePath, [], {
      detached: true,
      stdio: 'ignore'
    }).unref()
  } else if (process.platform === 'darwin') {
    exec(`open -a "LM Studio"`)
  }
}

/**
 * Install LM Studio on Windows
 */
async function installLmStudioWindows(onProgress: ProgressCallback): Promise<void> {
  const tempDir = os.tmpdir()
  const installerPath = path.join(tempDir, 'LMStudioSetup.exe')

  // Download installer
  onProgress({ stage: 'downloading', progress: 0, message: 'Downloading LM Studio...' })

  try {
    await downloadFile(LM_STUDIO_WINDOWS_URL, installerPath, (percent) => {
      onProgress({ stage: 'downloading', progress: percent, message: `Downloading... ${percent}%` })
    })
  } catch (err) {
    // LM Studio download URLs may require browser download
    onProgress({
      stage: 'error',
      progress: 0,
      message: 'Please download LM Studio manually from lmstudio.ai'
    })
    throw new Error('Auto-download not available. Please download from lmstudio.ai')
  }

  // Run installer
  onProgress({ stage: 'installing', progress: 0, message: 'Installing LM Studio...' })

  return new Promise((resolve, reject) => {
    const installer = spawn(installerPath, ['/S'], { // /S for silent install (NSIS)
      windowsHide: true
    })

    installer.on('close', (code) => {
      fs.unlink(installerPath, () => {})

      if (code === 0) {
        onProgress({ stage: 'installing', progress: 100, message: 'LM Studio installed' })
        resolve()
      } else {
        // Some installers don't support silent mode
        reject(new Error(`Installer exited with code ${code}. Manual installation may be required.`))
      }
    })

    installer.on('error', reject)
  })
}

/**
 * Main installation function
 */
export async function installLmStudio(onProgress: ProgressCallback): Promise<void> {
  try {
    // Check if already installed
    const installed = await isLmStudioInstalled()

    if (!installed) {
      if (process.platform === 'win32') {
        await installLmStudioWindows(onProgress)
      } else {
        onProgress({
          stage: 'error',
          progress: 0,
          message: 'Please download LM Studio manually from lmstudio.ai'
        })
        throw new Error('Auto-install not supported on this platform. Please download from lmstudio.ai')
      }
    }

    // Configuration instructions
    onProgress({
      stage: 'configuring',
      progress: 50,
      message: 'LM Studio installed. Please launch it and enable the local server.'
    })

    // Wait a moment
    await new Promise(r => setTimeout(r, 2000))

    onProgress({
      stage: 'complete',
      progress: 100,
      message: 'LM Studio setup complete! Remember to enable the local server in LM Studio settings.'
    })
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
 * Instructions for setting up LM Studio server
 */
export const LM_STUDIO_SETUP_INSTRUCTIONS = `
To use LM Studio with CourseVault:

1. Open LM Studio
2. Download a model (recommended: llama-3.2-3b or mistral-7b)
3. Go to the "Local Server" tab (left sidebar)
4. Click "Start Server"
5. The server will run on http://localhost:1234

CourseVault will automatically detect LM Studio when the server is running.
`
