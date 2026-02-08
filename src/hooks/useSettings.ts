import { useCallback, useState, useEffect } from 'react'
import { useAppStore } from '@/stores/appStore'

export function useSettings() {
  const {
    theme,
    llmBackend,
    transcriptsPath,
    serverPort,
    whisperModel,
    isFirstRun,
    setTheme,
    setLLMBackend,
    setTranscriptsPath,
    setServerPort,
    setWhisperModel,
    setIsFirstRun,
    setScreen
  } = useAppStore()

  // API key state managed via encrypted IPC store
  const [openaiApiKey, setOpenaiApiKeyState] = useState<string | null>(null)

  // Load API key from secure store on mount
  useEffect(() => {
    if (window.electronAPI) {
      window.electronAPI.getSecureSetting('openaiApiKey').then(setOpenaiApiKeyState)
    }
  }, [])

  // Save API key to secure store
  const setOpenAIApiKey = useCallback(async (key: string | null) => {
    setOpenaiApiKeyState(key)
    if (window.electronAPI) {
      await window.electronAPI.setSecureSetting('openaiApiKey', key)
    }
  }, [])

  // Toggle theme
  const toggleTheme = useCallback(() => {
    setTheme(theme === 'dark' ? 'light' : 'dark')
  }, [theme, setTheme])

  // Check if LLM is configured
  const isLLMConfigured = useCallback(() => {
    if (llmBackend === 'openai') {
      return !!openaiApiKey
    }
    return !!llmBackend
  }, [llmBackend, openaiApiKey])

  // Reset to first run (restart setup wizard)
  const resetSetup = useCallback(() => {
    setIsFirstRun(true)
    setScreen('setup')
  }, [setIsFirstRun, setScreen])

  // Open settings
  const openSettings = useCallback(() => {
    setScreen('settings')
  }, [setScreen])

  // Close settings (go to dashboard)
  const closeSettings = useCallback(() => {
    setScreen('dashboard')
  }, [setScreen])

  // Select folder (Electron only)
  const selectFolder = useCallback(async (): Promise<string | null> => {
    if (typeof window !== 'undefined' && window.electronAPI) {
      return window.electronAPI.selectFolder()
    }
    return null
  }, [])

  // Check Ollama status
  const checkOllamaStatus = useCallback(async (): Promise<boolean> => {
    if (typeof window !== 'undefined' && window.electronAPI) {
      return window.electronAPI.checkOllama()
    }
    // Fallback: try to fetch from Ollama API
    try {
      const response = await fetch('http://127.0.0.1:11434/api/tags', {
        signal: AbortSignal.timeout(2000)
      })
      return response.ok
    } catch {
      return false
    }
  }, [])

  // Check LM Studio status
  const checkLmStudioStatus = useCallback(async (): Promise<boolean> => {
    if (typeof window !== 'undefined' && window.electronAPI) {
      return window.electronAPI.checkLmStudio()
    }
    // Fallback: try to fetch from LM Studio API
    try {
      const response = await fetch('http://localhost:1234/v1/models', {
        signal: AbortSignal.timeout(2000)
      })
      return response.ok
    } catch {
      return false
    }
  }, [])

  // Restart server (Electron only)
  const restartServer = useCallback(async (): Promise<boolean> => {
    if (typeof window !== 'undefined' && window.electronAPI) {
      return window.electronAPI.restartServer()
    }
    return false
  }, [])

  // Get server status (Electron only)
  const getServerStatus = useCallback(async (): Promise<{ running: boolean; port: number } | null> => {
    if (typeof window !== 'undefined' && window.electronAPI) {
      return window.electronAPI.getServerStatus()
    }
    return null
  }, [])

  return {
    // State
    theme,
    llmBackend,
    openaiApiKey,
    transcriptsPath,
    serverPort,
    whisperModel,
    isFirstRun,

    // Setters
    setTheme,
    setLLMBackend,
    setOpenAIApiKey,
    setTranscriptsPath,
    setServerPort,
    setWhisperModel,

    // Actions
    toggleTheme,
    resetSetup,
    openSettings,
    closeSettings,
    selectFolder,
    restartServer,

    // Status checks
    isLLMConfigured,
    checkOllamaStatus,
    checkLmStudioStatus,
    getServerStatus
  }
}
