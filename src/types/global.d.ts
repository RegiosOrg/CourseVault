// Global type declarations

interface ElectronAPI {
  // Settings
  getSettings: () => Promise<Record<string, any>>
  setSettings: (key: string, value: any) => Promise<boolean>

  // Secure settings (encrypted API keys)
  getSecureSetting: (key: string) => Promise<string | null>
  setSecureSetting: (key: string, value: string | null) => Promise<boolean>

  // Server management
  getServerStatus: () => Promise<{ running: boolean; port: number }>
  restartServer: () => Promise<boolean>

  // Transcription worker management
  startTranscription: () => Promise<{ running: boolean; workerCount: number }>
  stopTranscription: () => Promise<{ running: boolean }>
  getTranscriptionStatus: () => Promise<{ running: boolean; workerCount: number; pids: number[] }>

  // System dialogs
  selectFolder: () => Promise<string | null>

  // LLM backend checks and control
  checkOllama: () => Promise<boolean>
  getOllamaModels: () => Promise<{ success: boolean; models: Array<{ name: string; size: number; modified: string }>; error?: string }>
  checkLmStudio: () => Promise<boolean>
  startOllama: () => Promise<{ success: boolean; error?: string }>

  // External links
  openExternal: (url: string) => Promise<void>

  // App control
  quitApp: () => Promise<void>

  // Window controls for frameless window
  windowMinimize: () => Promise<void>
  windowMaximize: () => Promise<void>
  windowClose: () => Promise<void>
  windowIsMaximized: () => Promise<boolean>

  // Event listeners (return cleanup function)
  onPythonLog: (callback: (log: string) => void) => () => void
  onPythonError: (callback: (error: string) => void) => () => void
  onTranscriberLog: (callback: (log: string) => void) => () => void
  onTranscriberError: (callback: (error: string) => void) => () => void
  onTranscriberStatus: (callback: (status: { running: boolean; exitCode?: number }) => void) => () => void

  // License validation (Ed25519 in main process)
  validateLicense: (key: string) => Promise<{
    valid: boolean
    tier: string
    status: string
    email: string | null
    expiresAt: string | null
    features: string[]
    error?: string
  }>

  // Machine identification
  getMachineId: () => Promise<string>

  // Platform info
  platform: NodeJS.Platform
  isDev: boolean

  // Auto-updater
  checkForUpdates: () => Promise<{ checking: boolean; updateInfo: any; error?: string }>
  installUpdate: () => Promise<void>
  onUpdateAvailable: (callback: (info: { version: string; releaseDate: string; releaseNotes?: string }) => void) => () => void
  onUpdateDownloaded: (callback: (info: { version: string; releaseDate: string }) => void) => () => void
  onUpdateProgress: (callback: (progress: { percent: number; bytesPerSecond: number; transferred: number; total: number }) => void) => () => void
  onUpdateError: (callback: (error: string) => void) => () => void
}

declare global {
  interface Window {
    electronAPI?: ElectronAPI
  }
}

export {}
