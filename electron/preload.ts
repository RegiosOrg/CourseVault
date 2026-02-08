import { contextBridge, ipcRenderer } from 'electron'

// Expose protected methods that allow the renderer process to use
// ipcRenderer without exposing the entire object
contextBridge.exposeInMainWorld('electronAPI', {
  // Settings
  getSettings: () => ipcRenderer.invoke('get-settings'),
  setSettings: (key: string, value: any) => ipcRenderer.invoke('set-settings', key, value),

  // Server management
  getServerStatus: () => ipcRenderer.invoke('get-server-status'),
  restartServer: () => ipcRenderer.invoke('restart-server'),

  // Transcription worker management
  startTranscription: () => ipcRenderer.invoke('start-transcription'),
  stopTranscription: () => ipcRenderer.invoke('stop-transcription'),
  getTranscriptionStatus: () => ipcRenderer.invoke('get-transcription-status'),

  // System dialogs
  selectFolder: () => ipcRenderer.invoke('select-folder'),

  // LLM backend checks and control
  checkOllama: () => ipcRenderer.invoke('check-ollama'),
  getOllamaModels: () => ipcRenderer.invoke('get-ollama-models'),
  checkLmStudio: () => ipcRenderer.invoke('check-lmstudio'),
  startOllama: () => ipcRenderer.invoke('start-ollama'),

  // Secure settings (encrypted API keys)
  getSecureSetting: (key: string) => ipcRenderer.invoke('get-secure-setting', key),
  setSecureSetting: (key: string, value: string | null) => ipcRenderer.invoke('set-secure-setting', key, value),

  // License validation (Ed25519 in main process)
  validateLicense: (key: string) => ipcRenderer.invoke('validate-license', key),
  getMachineId: () => ipcRenderer.invoke('get-machine-id'),

  // External links
  openExternal: (url: string) => ipcRenderer.invoke('open-external', url),

  // App control
  quitApp: () => ipcRenderer.invoke('quit-app'),

  // Window controls for frameless window
  windowMinimize: () => ipcRenderer.invoke('window-minimize'),
  windowMaximize: () => ipcRenderer.invoke('window-maximize'),
  windowClose: () => ipcRenderer.invoke('window-close'),
  windowIsMaximized: () => ipcRenderer.invoke('window-is-maximized'),

  // Event listeners for Python logs (returns cleanup function)
  onPythonLog: (callback: (log: string) => void) => {
    const handler = (_: any, log: string) => callback(log)
    ipcRenderer.on('python-log', handler)
    return () => ipcRenderer.removeListener('python-log', handler)
  },
  onPythonError: (callback: (error: string) => void) => {
    const handler = (_: any, error: string) => callback(error)
    ipcRenderer.on('python-error', handler)
    return () => ipcRenderer.removeListener('python-error', handler)
  },

  // Transcription worker event listeners
  onTranscriberLog: (callback: (log: string) => void) => {
    const handler = (_: any, log: string) => callback(log)
    ipcRenderer.on('transcriber-log', handler)
    return () => ipcRenderer.removeListener('transcriber-log', handler)
  },
  onTranscriberError: (callback: (error: string) => void) => {
    const handler = (_: any, error: string) => callback(error)
    ipcRenderer.on('transcriber-error', handler)
    return () => ipcRenderer.removeListener('transcriber-error', handler)
  },
  onTranscriberStatus: (callback: (status: { running: boolean; exitCode?: number }) => void) => {
    const handler = (_: any, status: { running: boolean; exitCode?: number }) => callback(status)
    ipcRenderer.on('transcriber-status', handler)
    return () => ipcRenderer.removeListener('transcriber-status', handler)
  },

  // Platform info
  platform: process.platform,
  isDev: process.env.NODE_ENV === 'development'
})

// Type definitions for the exposed API
declare global {
  interface Window {
    electronAPI: {
      getSettings: () => Promise<Record<string, any>>
      setSettings: (key: string, value: any) => Promise<boolean>
      getServerStatus: () => Promise<{ running: boolean; port: number }>
      restartServer: () => Promise<boolean>
      startTranscription: () => Promise<{ running: boolean }>
      stopTranscription: () => Promise<{ running: boolean }>
      getTranscriptionStatus: () => Promise<{ running: boolean; pid: number | null }>
      selectFolder: () => Promise<string | null>
      checkOllama: () => Promise<boolean>
      getOllamaModels: () => Promise<{ success: boolean; models: Array<{ name: string; size: number; modified: string }>; error?: string }>
      checkLmStudio: () => Promise<boolean>
      startOllama: () => Promise<{ success: boolean; error?: string }>
      getSecureSetting: (key: string) => Promise<string | null>
      setSecureSetting: (key: string, value: string | null) => Promise<boolean>
      validateLicense: (key: string) => Promise<{ valid: boolean; tier: string; status: string; email: string | null; expiresAt: string | null; features: string[]; error?: string }>
      getMachineId: () => Promise<string>
      openExternal: (url: string) => Promise<void>
      quitApp: () => Promise<void>
      windowMinimize: () => Promise<void>
      windowMaximize: () => Promise<void>
      windowClose: () => Promise<void>
      windowIsMaximized: () => Promise<boolean>
      onPythonLog: (callback: (log: string) => void) => () => void
      onPythonError: (callback: (error: string) => void) => () => void
      onTranscriberLog: (callback: (log: string) => void) => () => void
      onTranscriberError: (callback: (error: string) => void) => () => void
      onTranscriberStatus: (callback: (status: { running: boolean; exitCode?: number }) => void) => () => void
      platform: NodeJS.Platform
      isDev: boolean
    }
  }
}
