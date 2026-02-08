import { useEffect, useState } from 'react'
import { useAppStore } from '@/stores/appStore'
import { api } from '@/api/client'
import Dashboard from '@/screens/Dashboard'
import Settings from '@/screens/Settings'
import SetupWizard from '@/screens/SetupWizard'

function App() {
  const {
    screen,
    isFirstRun,
    isLoading,
    error,
    theme,
    setCourseData,
    setIsLoading,
    setError,
    setScreen
  } = useAppStore()

  const [loadingMessage, setLoadingMessage] = useState('Loading CourseVault...')

  // Initialize app
  useEffect(() => {
    const init = async () => {
      // Apply theme
      document.documentElement.classList.toggle('light', theme === 'light')

      // Check if first run - show setup wizard
      if (isFirstRun) {
        setScreen('setup')
        setIsLoading(false)
        return
      }

      // Load course data with retry logic
      // Server may take time to start when building search index
      const maxRetries = 30
      const retryDelay = 2000 // 2 seconds

      for (let attempt = 1; attempt <= maxRetries; attempt++) {
        try {
          // Update loading message based on attempt
          if (attempt === 1) {
            setLoadingMessage('Connecting to server...')
          } else if (attempt < 5) {
            setLoadingMessage('Waiting for server to start...')
          } else if (attempt < 15) {
            setLoadingMessage('Server is initializing...')
          } else {
            setLoadingMessage(`Still waiting... (attempt ${attempt}/${maxRetries})`)
          }

          // First check if server is up
          const isHealthy = await api.checkHealth()
          if (!isHealthy) {
            throw new Error('Server not responding')
          }

          // Now fetch course data
          const data = await api.fetchCourseData()
          setCourseData(data)
          return // Success - exit the retry loop
        } catch (err) {
          const errMsg = err instanceof Error ? err.message : 'Unknown error'
          console.log(`Attempt ${attempt}/${maxRetries} failed: ${errMsg}`)

          if (attempt === maxRetries) {
            // Final attempt failed
            setError(`Failed to load courses: ${errMsg}`)
            setIsLoading(false)
            return
          }

          // Wait before retrying
          await new Promise(resolve => setTimeout(resolve, retryDelay))
        }
      }
    }

    init()
  }, [])

  // Loading state
  if (isLoading && screen !== 'setup') {
    return (
      <div className="flex items-center justify-center h-screen bg-[var(--bg-primary)]">
        <div className="text-center">
          <div className="w-12 h-12 border-4 border-accent border-t-transparent rounded-full animate-spin mx-auto mb-4" />
          <p className="text-[var(--text-muted)]">{loadingMessage}</p>
          <p className="text-xs text-[var(--text-muted)] mt-2 opacity-60">
            First launch may take longer while building the search index
          </p>
        </div>
      </div>
    )
  }

  // Error state
  if (error && screen !== 'setup') {
    return (
      <div className="flex items-center justify-center h-screen bg-[var(--bg-primary)]">
        <div className="text-center max-w-md mx-auto p-6">
          <div className="text-6xl mb-4">⚠️</div>
          <h1 className="text-xl font-semibold text-error mb-2">Connection Error</h1>
          <p className="text-[var(--text-muted)] mb-6">{error}</p>
          <div className="space-y-3">
            <button
              onClick={() => window.location.reload()}
              className="btn-primary w-full"
            >
              Retry
            </button>
            <p className="text-sm text-[var(--text-muted)]">
              Make sure the server is running:<br />
              <code className="bg-[var(--bg-tertiary)] px-2 py-1 rounded text-accent">
                python main.py server
              </code>
            </p>
          </div>
        </div>
      </div>
    )
  }

  // Render screen
  switch (screen) {
    case 'setup':
      return <SetupWizard />
    case 'settings':
      return <Settings />
    case 'dashboard':
    default:
      return <Dashboard />
  }
}

export default App
