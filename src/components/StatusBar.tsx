import { useState, useEffect, useCallback, useRef } from 'react'
import { useAppStore } from '@/stores/appStore'
import { api } from '@/api/client'

interface LogEntry {
  id: number
  message: string
  type: 'info' | 'error' | 'success' | 'progress' | 'warning'
  timestamp: Date
  course?: string
  video?: string
}

interface TranscriptionStatus {
  total_courses: number
  completed: number
  in_progress: number
  pending: number
  total_videos_done: number
  completed_courses: string[]
  in_progress_courses: Array<{
    name: string
    processed: number
    total: number | string
    worker: string
    current_video?: string
    last_activity?: string
  }>
  pending_courses: string[]
}

interface GenerationStatus {
  current: {
    course: string
    status: string
    progress: number
    total: number
    current_video: string
    started_at?: string
  } | null
  queue: string[]
}

// Estimate remaining time based on pending courses
function estimateTimeRemaining(pending: number, inProgress: number, parallelWorkers: number = 2): string {
  if (pending === 0 && inProgress === 0) return 'Complete'

  const avgMinutesPerCourse = 5
  const effectiveWorkers = Math.max(1, parallelWorkers)
  const totalPending = pending + inProgress
  const totalMinutes = (totalPending * avgMinutesPerCourse) / effectiveWorkers

  if (totalMinutes < 1) return '< 1 min'
  if (totalMinutes < 60) return `~${Math.round(totalMinutes)} min`
  return `~${(totalMinutes / 60).toFixed(1)} hrs`
}

// Format elapsed time
function formatElapsed(startedAt?: string): string {
  if (!startedAt) return ''
  const start = new Date(startedAt)
  const elapsed = Math.floor((Date.now() - start.getTime()) / 1000)
  if (elapsed < 60) return `${elapsed}s`
  if (elapsed < 3600) return `${Math.floor(elapsed / 60)}m ${elapsed % 60}s`
  return `${Math.floor(elapsed / 3600)}h ${Math.floor((elapsed % 3600) / 60)}m`
}

export default function StatusBar() {
  const { generatingCourses, courseData } = useAppStore()
  const [isExpanded, setIsExpanded] = useState(false)
  const [activeTab, setActiveTab] = useState<'console' | 'overview'>('overview')
  // Load persisted logs from localStorage
  const [logs, setLogs] = useState<LogEntry[]>(() => {
    try {
      const saved = localStorage.getItem('coursevault-console-logs')
      if (saved) {
        const parsed = JSON.parse(saved)
        return parsed.map((log: any) => ({
          ...log,
          timestamp: new Date(log.timestamp)
        }))
      }
    } catch {
      // Ignore parse errors
    }
    return []
  })
  const [serverStatus, setServerStatus] = useState<'connected' | 'disconnected' | 'checking'>('checking')
  const [transcriptionStatus, setTranscriptionStatus] = useState<TranscriptionStatus | null>(null)
  const [generationStatus, setGenerationStatus] = useState<GenerationStatus | null>(null)
  const [workerRunning, setWorkerRunning] = useState(false)
  const [workerCount, setWorkerCount] = useState(0)
  const [workerStarting, setWorkerStarting] = useState(false)
  const [llmStatus, setLlmStatus] = useState<{ backend: string | null; running: boolean; starting: boolean }>({
    backend: null,
    running: false,
    starting: false
  })
  const parallelWorkers = useAppStore((s) => s.parallelWorkers)
  const logContainerRef = useRef<HTMLDivElement>(null)
  const prevStatusRef = useRef<string>('')

  // Auto-scroll logs to bottom
  useEffect(() => {
    if (logContainerRef.current && activeTab === 'console') {
      logContainerRef.current.scrollTop = logContainerRef.current.scrollHeight
    }
  }, [logs, activeTab])

  // Persist logs to localStorage
  useEffect(() => {
    try {
      // Keep last 100 logs for persistence (prevent localStorage bloat)
      const toSave = logs.slice(-100).map(log => ({
        ...log,
        timestamp: log.timestamp.toISOString()
      }))
      localStorage.setItem('coursevault-console-logs', JSON.stringify(toSave))
    } catch {
      // Ignore storage errors
    }
  }, [logs])

  // Add log entry helper
  const addLog = useCallback((message: string, type: LogEntry['type'], course?: string, video?: string) => {
    setLogs(prev => {
      // Avoid duplicate consecutive messages
      if (prev.length > 0 && prev[prev.length - 1].message === message) {
        return prev
      }
      return [...prev.slice(-200), {
        id: Date.now() + Math.random(),
        message,
        type,
        timestamp: new Date(),
        course,
        video
      }]
    })
  }, [])

  // Check LLM status on load and periodically
  useEffect(() => {
    const checkLlmStatus = async () => {
      const llmBackend = useAppStore.getState().llmBackend
      setLlmStatus(prev => ({ ...prev, backend: llmBackend }))

      if (!window.electronAPI) return

      if (llmBackend === 'ollama') {
        const running = await window.electronAPI.checkOllama()
        setLlmStatus(prev => ({ ...prev, running }))
      } else if (llmBackend === 'lmstudio') {
        const running = await window.electronAPI.checkLmStudio()
        setLlmStatus(prev => ({ ...prev, running }))
      }
    }

    // Initial check
    checkLlmStatus()

    // Log initial configuration
    const llmBackend = useAppStore.getState().llmBackend
    if (llmBackend) {
      addLog(`LLM backend configured: ${llmBackend}`, 'info')
    } else {
      addLog('No LLM backend configured. Go to Settings → AI Models to enable summarization.', 'warning')
    }

    // Check periodically
    const interval = setInterval(checkLlmStatus, 10000)
    return () => clearInterval(interval)
  }, [addLog])

  // Start Ollama handler
  const handleStartOllama = async () => {
    if (!window.electronAPI) return
    setLlmStatus(prev => ({ ...prev, starting: true }))
    addLog('Starting Ollama...', 'info')
    try {
      const result = await window.electronAPI.startOllama()
      if (result.success) {
        setLlmStatus(prev => ({ ...prev, running: true, starting: false }))
        addLog('Ollama started successfully', 'success')
      } else {
        setLlmStatus(prev => ({ ...prev, starting: false }))
        addLog(`Failed to start Ollama: ${result.error || 'Unknown error'}`, 'error')
      }
    } catch (err) {
      setLlmStatus(prev => ({ ...prev, starting: false }))
      addLog(`Error starting Ollama: ${err}`, 'error')
    }
  }

  // Listen to Python logs from Electron
  useEffect(() => {
    if (typeof window === 'undefined' || !window.electronAPI) {
      return
    }

    const cleanupLog = window.electronAPI.onPythonLog((log: string) => {
      const trimmed = log.trim()
      if (trimmed) {
        const type: LogEntry['type'] =
          trimmed.includes('[DONE]') ? 'success' :
          trimmed.includes('[ERROR]') ? 'error' :
          trimmed.includes('[WARN]') || trimmed.includes('[SKIP]') ? 'warning' :
          'info'
        addLog(trimmed, type)
      }
    })

    const cleanupError = window.electronAPI.onPythonError((error: string) => {
      const trimmed = error.trim()
      // Filter out HTTP 200 logs and empty lines
      if (trimmed && !trimmed.includes('HTTP/1.1" 200') && !trimmed.includes('HTTP/1.1" 304')) {
        addLog(trimmed, trimmed.toLowerCase().includes('error') ? 'error' : 'info')
      }
    })

    return () => {
      cleanupLog()
      cleanupError()
    }
  }, [addLog])

  // Listen to transcription worker logs and status
  useEffect(() => {
    if (typeof window === 'undefined' || !window.electronAPI) {
      return
    }

    // Check initial worker status
    window.electronAPI.getTranscriptionStatus().then((status: any) => {
      setWorkerRunning(status.running)
      setWorkerCount(status.workerCount || (status.running ? 1 : 0))
    })

    const cleanupLog = window.electronAPI.onTranscriberLog((log: string) => {
      const trimmed = log.trim()
      if (trimmed) {
        const type: LogEntry['type'] =
          trimmed.includes('COMPLETED') || trimmed.includes('SUCCESS') ? 'success' :
          trimmed.includes('ERROR') || trimmed.includes('FAILED') ? 'error' :
          trimmed.includes('Processing:') || trimmed.includes('Transcribing') ? 'progress' :
          'info'
        addLog(`[Worker] ${trimmed}`, type)
      }
    })

    const cleanupError = window.electronAPI.onTranscriberError((error: string) => {
      const trimmed = error.trim()
      if (trimmed) {
        addLog(`[Worker Error] ${trimmed}`, 'error')
      }
    })

    const cleanupStatus = window.electronAPI.onTranscriberStatus((status: any) => {
      setWorkerRunning(status.running)
      setWorkerCount(status.workerCount || (status.running ? 1 : 0))
      setWorkerStarting(false)
      if (!status.running && status.exitCode !== undefined) {
        addLog(`Transcription worker stopped (exit code: ${status.exitCode})`, status.exitCode === 0 ? 'info' : 'warning')
      }
    })

    return () => {
      cleanupLog()
      cleanupError()
      cleanupStatus()
    }
  }, [addLog])

  // Start/stop transcription worker
  const handleStartWorker = async () => {
    if (!window.electronAPI) return
    setWorkerStarting(true)
    addLog('Starting transcription worker(s)...', 'info')
    try {
      const result = await window.electronAPI.startTranscription() as any
      setWorkerRunning(result.running)
      setWorkerCount(result.workerCount || (result.running ? 1 : 0))
      if (result.running) {
        addLog(`Started ${result.workerCount || 1} transcription worker(s)`, 'success')
      }
    } catch (err) {
      addLog(`Failed to start worker: ${err}`, 'error')
    }
    setWorkerStarting(false)
  }

  const handleStopWorker = async () => {
    if (!window.electronAPI) return
    addLog(`Stopping ${workerCount} transcription worker(s)...`, 'info')
    try {
      await window.electronAPI.stopTranscription()
      setWorkerRunning(false)
      setWorkerCount(0)
      addLog('Transcription worker(s) stopped', 'info')
    } catch (err) {
      addLog(`Failed to stop worker: ${err}`, 'error')
    }
  }

  // Check server and fetch status
  useEffect(() => {
    const checkStatus = async () => {
      try {
        const response = await fetch('http://127.0.0.1:8080/health', {
          signal: AbortSignal.timeout(15000) // 15 seconds - index building can be slow
        })
        setServerStatus(response.ok ? 'connected' : 'disconnected')

        if (response.ok) {
          // Fetch transcription status
          try {
            const status = await api.getTranscriptionStatus()
            setTranscriptionStatus(status)

            // Log changes in status
            const statusKey = JSON.stringify({
              completed: status.completed,
              in_progress: status.in_progress,
              in_progress_names: status.in_progress_courses.map(c => `${c.name}:${c.processed}`)
            })

            if (prevStatusRef.current !== statusKey) {
              // Status changed - generate log entries
              if (prevStatusRef.current) {
                const prevStatus = JSON.parse(prevStatusRef.current)

                if (status.completed > prevStatus.completed) {
                  const newCompleted = status.completed_courses?.filter(
                    (c: string) => !prevStatusRef.current.includes(c)
                  )
                  newCompleted?.forEach((course: string) => {
                    addLog(`✅ Completed transcription: ${course}`, 'success', course)
                  })
                }

                // Log progress on in-progress courses with current video detail
                status.in_progress_courses.forEach(course => {
                  const total = typeof course.total === 'number' ? course.total : parseInt(course.total) || 0
                  const percent = total > 0 ? Math.round((course.processed / total) * 100) : 0
                  const videoInfo = course.current_video ? ` → ${course.current_video}` : ''
                  addLog(
                    `📝 ${course.name} (${course.processed}/${course.total}, ${percent}%)${videoInfo}`,
                    'progress',
                    course.name,
                    course.current_video
                  )
                })
              } else {
                // Initial status - log all in-progress courses
                status.in_progress_courses.forEach(course => {
                  const total = typeof course.total === 'number' ? course.total : parseInt(course.total) || 0
                  const percent = total > 0 ? Math.round((course.processed / total) * 100) : 0
                  const videoInfo = course.current_video ? ` → ${course.current_video}` : ''
                  addLog(
                    `📝 ${course.name} (${course.processed}/${course.total}, ${percent}%)${videoInfo}`,
                    'progress',
                    course.name,
                    course.current_video
                  )
                })
              }
            }
            prevStatusRef.current = statusKey
          } catch {
            // Endpoint might not exist
          }

          // Fetch generation status
          try {
            const genStatus = await api.getGenerationStatus()
            setGenerationStatus(genStatus)

            if (genStatus.error) {
              addLog(`Generation status error: ${genStatus.error}`, 'error')
            }

            if (genStatus.current) {
              const { course, current_video, progress, total, status: taskStatus, error: taskError, started_at } = genStatus.current
              if (taskStatus === 'processing') {
                // Check if job seems stuck (no progress for > 5 minutes)
                if (started_at) {
                  const elapsed = (Date.now() - new Date(started_at).getTime()) / 1000
                  if (elapsed > 300 && progress === 0) {
                    addLog(`Warning: ${course} may be stuck - no progress for ${Math.round(elapsed / 60)} minutes`, 'warning', course)
                  }
                }
                addLog(
                  `Summarizing ${course}: ${current_video || 'starting...'} (${progress}/${total})`,
                  'progress',
                  course,
                  current_video
                )
              } else if (taskStatus === 'completed') {
                addLog(`Summary generation completed: ${course}`, 'success', course)
              } else if (taskStatus === 'failed') {
                addLog(`Summary generation failed: ${course}${taskError ? ` - ${taskError}` : ''}`, 'error', course)
              } else if (taskStatus === 'queued') {
                addLog(`${course} is queued for summarization`, 'info', course)
              }
            }

            // Log queue status
            if (genStatus.queue && genStatus.queue.length > 0) {
              addLog(`Summary queue: ${genStatus.queue.length} courses waiting`, 'info')
            }
          } catch (err) {
            addLog(`Failed to get generation status: ${err}`, 'error')
          }
        }
      } catch {
        setServerStatus('disconnected')
      }
    }

    checkStatus()
    // Poll every 3 seconds for more responsive updates
    const interval = setInterval(checkStatus, 3000)
    return () => clearInterval(interval)
  }, [addLog])

  // Handle generate all summaries
  const handleGenerateAll = useCallback(async () => {
    try {
      const courseData = useAppStore.getState().courseData
      if (!courseData) return

      const needsSummary = courseData.courses.filter(c =>
        c.videos.some(v => !v.has_summary)
      )

      if (needsSummary.length === 0) {
        addLog('All courses already have summaries!', 'info')
        return
      }

      addLog(`Queuing ${needsSummary.length} courses for summary generation...`, 'info')

      for (const course of needsSummary.slice(0, 10)) {
        await api.generateSummary(course.name)
        useAppStore.getState().startGeneration(course.name)
        addLog(`Queued: ${course.name}`, 'info', course.name)
      }
    } catch (err) {
      addLog(`Failed to start generation: ${err}`, 'error')
    }
  }, [addLog])

  // Refresh index handler
  const [isRefreshing, setIsRefreshing] = useState(false)
  const handleRefreshIndex = useCallback(async () => {
    if (isRefreshing) return
    setIsRefreshing(true)
    addLog('Starting index refresh...', 'info')
    try {
      const result = await api.refreshIndex()
      if (result.status === 'started') {
        addLog('Index refresh started in background. New courses will appear shortly.', 'success')
      } else {
        addLog(`Index refresh failed: ${result.error}`, 'error')
      }
    } catch (err) {
      addLog(`Index refresh error: ${err}`, 'error')
    }
    // Keep button disabled for 5 seconds to prevent spam
    setTimeout(() => setIsRefreshing(false), 5000)
  }, [addLog, isRefreshing])

  // Current task info
  const currentTask = generationStatus?.current
  const queueLength = generationStatus?.queue?.length || 0
  const isProcessing = generatingCourses.size > 0 || !!currentTask || (transcriptionStatus?.in_progress || 0) > 0

  // Calculate overall progress - use indexed count (from courseData) for consistency with sidebar
  const totalCourses = transcriptionStatus?.total_courses || 0
  const indexedCount = courseData?.courses?.length || 0
  const indexedPercent = totalCourses > 0 ? Math.round((indexedCount / totalCourses) * 100) : 0

  return (
    <div className="fixed bottom-0 left-0 right-0 z-40 bg-[var(--bg-secondary)] border-t border-[var(--border)]">
      {/* Collapsed status bar */}
      <div
        className="flex items-center justify-between px-4 py-1.5 cursor-pointer hover:bg-[var(--bg-tertiary)] transition-colors"
        onClick={() => setIsExpanded(!isExpanded)}
      >
        <div className="flex items-center gap-4 text-xs">
          {/* Server status */}
          <div className="flex items-center gap-1.5">
            <div className={`w-2 h-2 rounded-full ${
              serverStatus === 'connected' ? 'bg-green-500' :
              serverStatus === 'disconnected' ? 'bg-red-500' :
              'bg-yellow-500 animate-pulse'
            }`} />
            <span className="text-[var(--text-muted)]">
              {serverStatus === 'connected' ? 'Server running' :
               serverStatus === 'disconnected' ? 'Server offline' :
               'Checking...'}
            </span>
          </div>

          {/* Overall transcription progress - use indexed count for consistency */}
          {transcriptionStatus && totalCourses > 0 && (
            <>
              <div className="w-px h-4 bg-[var(--border)]" />
              <div className="flex items-center gap-2">
                <span className="text-[var(--text-muted)]">
                  Indexed: {indexedCount}/{totalCourses}
                </span>
                <div className="w-20 h-1.5 bg-[var(--bg-tertiary)] rounded-full overflow-hidden">
                  <div
                    className="h-full bg-green-500 transition-all duration-300"
                    style={{ width: `${indexedPercent}%` }}
                  />
                </div>
                <span className="text-[var(--text-muted)]">{indexedPercent}%</span>
              </div>
            </>
          )}

          {/* Current activity indicator */}
          {isProcessing && (
            <>
              <div className="w-px h-4 bg-[var(--border)]" />
              <div className="flex items-center gap-2">
                <div className="w-3 h-3 border-2 border-accent border-t-transparent rounded-full animate-spin" />
                <span className="text-[var(--text-primary)]">
                  {transcriptionStatus && transcriptionStatus.in_progress > 0
                    ? (() => {
                        const courses = transcriptionStatus.in_progress_courses
                        if (courses.length === 0) return 'Transcribing...'
                        if (courses.length === 1) {
                          const c = courses[0]
                          const name = c.name.length > 35 ? c.name.slice(0, 35) + '...' : c.name
                          const percent = typeof c.total === 'number' && c.total > 0
                            ? Math.round((c.processed / c.total) * 100)
                            : 0
                          return `Transcribing: ${name} (${percent}%)`
                        }
                        // Multiple courses - show first one + count
                        const first = courses[0]
                        const name = first.name.length > 25 ? first.name.slice(0, 25) + '...' : first.name
                        return `Transcribing: ${name} +${courses.length - 1} more`
                      })()
                    : currentTask?.status === 'processing'
                      ? `Summarizing: ${currentTask.course}`
                      : `${queueLength || generatingCourses.size} queued`
                  }
                </span>
              </div>
            </>
          )}

          {/* Idle status */}
          {!isProcessing && serverStatus === 'connected' && (
            <>
              <div className="w-px h-4 bg-[var(--border)]" />
              <span className="text-[var(--text-muted)]">Ready</span>
            </>
          )}

          {/* Transcription worker status */}
          <div className="w-px h-4 bg-[var(--border)]" />
          <div className="flex items-center gap-2">
            <div className={`w-2 h-2 rounded-full ${
              workerRunning ? 'bg-green-500' : 'bg-gray-500'
            }`} />
            <span className="text-[var(--text-muted)]">
              {workerRunning
                ? `${workerCount} worker${workerCount !== 1 ? 's' : ''} running`
                : 'Workers: Stopped'}
            </span>
            <button
              onClick={(e) => {
                e.stopPropagation()
                workerRunning ? handleStopWorker() : handleStartWorker()
              }}
              disabled={workerStarting}
              className={`px-2 py-0.5 text-xs rounded transition-colors ${
                workerRunning
                  ? 'bg-red-500/20 text-red-400 hover:bg-red-500/30'
                  : 'bg-green-500/20 text-green-400 hover:bg-green-500/30'
              } ${workerStarting ? 'opacity-50 cursor-not-allowed' : ''}`}
            >
              {workerStarting ? '...' : workerRunning ? 'Stop' : 'Start'}
            </button>
          </div>

          {/* LLM Status */}
          {llmStatus.backend && (
            <>
              <div className="w-px h-4 bg-[var(--border)]" />
              <div className="flex items-center gap-2">
                <div className={`w-2 h-2 rounded-full ${
                  llmStatus.running ? 'bg-green-500' : 'bg-red-500'
                }`} />
                <span className="text-[var(--text-muted)]">
                  {llmStatus.backend === 'ollama' ? 'Ollama' : 'LM Studio'}: {llmStatus.running ? 'Running' : 'Offline'}
                </span>
                {!llmStatus.running && llmStatus.backend === 'ollama' && (
                  <button
                    onClick={(e) => {
                      e.stopPropagation()
                      handleStartOllama()
                    }}
                    disabled={llmStatus.starting}
                    className={`px-2 py-0.5 text-xs rounded transition-colors bg-green-500/20 text-green-400 hover:bg-green-500/30 ${
                      llmStatus.starting ? 'opacity-50 cursor-not-allowed' : ''
                    }`}
                  >
                    {llmStatus.starting ? '...' : 'Start'}
                  </button>
                )}
              </div>
            </>
          )}
        </div>

        {/* Expand/collapse indicator */}
        <div className="flex items-center gap-2 text-xs text-[var(--text-muted)]">
          <span>Console</span>
          <svg
            className={`w-4 h-4 transition-transform ${isExpanded ? 'rotate-180' : ''}`}
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 15l7-7 7 7" />
          </svg>
        </div>
      </div>

      {/* Expanded panel */}
      {isExpanded && (
        <div className="border-t border-[var(--border)]">
          {/* Tabs */}
          <div className="flex items-center gap-1 px-4 py-2 bg-[var(--bg-tertiary)] border-b border-[var(--border)]">
            <button
              onClick={(e) => { e.stopPropagation(); setActiveTab('overview') }}
              className={`px-3 py-1 text-xs rounded transition-colors ${
                activeTab === 'overview'
                  ? 'bg-accent text-white'
                  : 'text-[var(--text-muted)] hover:text-[var(--text-primary)]'
              }`}
            >
              Overview
            </button>
            <button
              onClick={(e) => { e.stopPropagation(); setActiveTab('console') }}
              className={`px-3 py-1 text-xs rounded transition-colors ${
                activeTab === 'console'
                  ? 'bg-accent text-white'
                  : 'text-[var(--text-muted)] hover:text-[var(--text-primary)]'
              }`}
            >
              Console
            </button>

            {/* Controls */}
            <div className="flex-1" />
            <div className="flex items-center gap-2">
              <button
                onClick={(e) => { e.stopPropagation(); handleRefreshIndex() }}
                disabled={isRefreshing}
                className={`px-3 py-1 text-xs bg-blue-500/20 text-blue-400 rounded hover:bg-blue-500/30 transition-colors flex items-center gap-1 ${
                  isRefreshing ? 'opacity-50 cursor-not-allowed' : ''
                }`}
                title="Refresh course index to detect new courses"
              >
                <svg className={`w-3 h-3 ${isRefreshing ? 'animate-spin' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                </svg>
                {isRefreshing ? 'Refreshing...' : 'Refresh Index'}
              </button>
              {!isProcessing && (
                <button
                  onClick={(e) => { e.stopPropagation(); handleGenerateAll() }}
                  className="px-3 py-1 text-xs bg-accent text-white rounded hover:bg-accent/80 transition-colors flex items-center gap-1"
                >
                  <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 20 20">
                    <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM9.555 7.168A1 1 0 008 8v4a1 1 0 001.555.832l3-2a1 1 0 000-1.664l-3-2z" clipRule="evenodd" />
                  </svg>
                  Generate All
                </button>
              )}
            </div>
          </div>

          {/* Overview Tab */}
          {activeTab === 'overview' && (
            <div className="p-4 bg-[var(--bg-primary)] max-h-80 overflow-y-auto">
              {transcriptionStatus ? (
                <>
                  <div className="grid grid-cols-4 gap-4 text-center mb-4">
                    <div className="p-3 bg-[var(--bg-secondary)] rounded-lg">
                      <div className="text-2xl font-bold text-[var(--text-primary)]">{transcriptionStatus.total_courses}</div>
                      <div className="text-xs text-[var(--text-muted)]">Total Courses</div>
                    </div>
                    <div className="p-3 bg-[var(--bg-secondary)] rounded-lg">
                      <div className="text-2xl font-bold text-green-500">{transcriptionStatus.completed}</div>
                      <div className="text-xs text-[var(--text-muted)]">Completed</div>
                    </div>
                    <div className="p-3 bg-[var(--bg-secondary)] rounded-lg">
                      <div className="text-2xl font-bold text-amber-500">{transcriptionStatus.in_progress}</div>
                      <div className="text-xs text-[var(--text-muted)]">In Progress</div>
                    </div>
                    <div className="p-3 bg-[var(--bg-secondary)] rounded-lg">
                      <div className="text-2xl font-bold text-[var(--text-muted)]">{transcriptionStatus.pending}</div>
                      <div className="text-xs text-[var(--text-muted)]">Pending</div>
                    </div>
                  </div>

                  {/* ETA */}
                  {(transcriptionStatus.pending > 0 || transcriptionStatus.in_progress > 0) && (
                    <div className="text-center text-sm text-[var(--text-muted)] mb-4">
                      Estimated time remaining: {estimateTimeRemaining(
                        transcriptionStatus.pending,
                        transcriptionStatus.in_progress,
                        parallelWorkers
                      )}
                    </div>
                  )}

                  {/* In-progress courses with details */}
                  {transcriptionStatus.in_progress_courses.length > 0 && (
                    <div className="mb-4">
                      <h4 className="text-xs font-medium text-[var(--text-muted)] mb-2">Currently Processing:</h4>
                      <div className="space-y-2">
                        {transcriptionStatus.in_progress_courses.map((course, i) => {
                          const total = typeof course.total === 'number' ? course.total : parseInt(course.total) || 0
                          const percent = total > 0 ? Math.round((course.processed / total) * 100) : 0
                          // Check if activity is stale (no update in last 2 minutes)
                          const lastActivity = course.last_activity ? new Date(course.last_activity) : null
                          const isStale = lastActivity && (Date.now() - lastActivity.getTime() > 120000)
                          const timeSinceActivity = lastActivity
                            ? Math.floor((Date.now() - lastActivity.getTime()) / 1000)
                            : null
                          // Consider it potentially stuck if no current_video and 0% progress or no activity info
                          const isPotentiallyStuck = !course.current_video && (course.processed === 0 || !course.last_activity)
                          return (
                            <div key={i} className={`p-3 rounded-lg ${
                              isPotentiallyStuck ? 'bg-amber-500/10 border border-amber-500/30' :
                              isStale ? 'bg-amber-500/10 border border-amber-500/30' :
                              'bg-[var(--bg-secondary)]'
                            }`}>
                              <div className="flex items-center justify-between mb-2">
                                <span className="text-sm text-[var(--text-primary)] font-medium truncate max-w-[300px]">{course.name}</span>
                                <span className="text-xs text-[var(--text-muted)]">
                                  {course.processed}/{course.total} videos ({percent}%)
                                </span>
                              </div>
                              <div className="h-2 bg-[var(--bg-tertiary)] rounded-full overflow-hidden">
                                <div
                                  className="h-full bg-accent transition-all duration-500"
                                  style={{ width: `${percent}%` }}
                                />
                              </div>
                              <div className="flex items-center justify-between mt-2">
                                <div className="text-xs truncate max-w-[400px]">
                                  {course.current_video ? (
                                    <span className="flex items-center gap-1 text-[var(--text-muted)]">
                                      <span className={isStale ? 'text-amber-400' : 'text-green-400'}>▶</span>
                                      {course.current_video}
                                    </span>
                                  ) : workerRunning ? (
                                    <span className="flex items-center gap-1 text-green-400">
                                      <span className="animate-pulse">●</span>
                                      Processing (see Console tab for details)
                                    </span>
                                  ) : isPotentiallyStuck ? (
                                    <span className="text-amber-400">⚠️ No progress - click "Start" above to run the transcription worker</span>
                                  ) : (
                                    <span className="text-amber-400">Waiting for activity...</span>
                                  )}
                                </div>
                                {timeSinceActivity !== null && (
                                  <span className={`text-xs ${isStale ? 'text-amber-400' : 'text-[var(--text-muted)]'}`}>
                                    {isStale ? '⚠️ ' : ''}
                                    {timeSinceActivity < 60
                                      ? `${timeSinceActivity}s ago`
                                      : `${Math.floor(timeSinceActivity / 60)}m ago`
                                    }
                                  </span>
                                )}
                              </div>
                              {course.worker && (
                                <div className="text-xs text-[var(--text-muted)] mt-1">Worker: {course.worker}</div>
                              )}
                            </div>
                          )
                        })}
                      </div>
                    </div>
                  )}

                  {/* Summary generation in progress */}
                  {currentTask && (
                    <div className="mb-4">
                      <h4 className="text-xs font-medium text-[var(--text-muted)] mb-2">Summary Generation:</h4>
                      <div className="p-3 bg-[var(--bg-secondary)] rounded-lg">
                        <div className="flex items-center justify-between mb-2">
                          <span className="text-sm text-[var(--text-primary)] font-medium truncate max-w-[300px]">{currentTask.course}</span>
                          <span className="text-xs text-[var(--text-muted)]">
                            {currentTask.progress}/{currentTask.total} ({Math.round((currentTask.progress / currentTask.total) * 100)}%)
                          </span>
                        </div>
                        <div className="h-2 bg-[var(--bg-tertiary)] rounded-full overflow-hidden mb-2">
                          <div
                            className="h-full bg-green-500 transition-all duration-500"
                            style={{ width: `${(currentTask.progress / currentTask.total) * 100}%` }}
                          />
                        </div>
                        {currentTask.current_video && (
                          <div className="text-xs text-[var(--text-muted)]">
                            Current: {currentTask.current_video}
                          </div>
                        )}
                        {currentTask.started_at && (
                          <div className="text-xs text-[var(--text-muted)]">
                            Elapsed: {formatElapsed(currentTask.started_at)}
                          </div>
                        )}
                      </div>
                    </div>
                  )}

                  {/* Generation queue */}
                  {(queueLength > 0 || generatingCourses.size > 0) && (
                    <div>
                      <h4 className="text-xs font-medium text-[var(--text-muted)] mb-2">
                        Summary Queue ({queueLength || generatingCourses.size} courses):
                      </h4>
                      <div className="grid grid-cols-2 gap-2 max-h-32 overflow-y-auto">
                        {(generationStatus?.queue || Array.from(generatingCourses)).map((name, i) => (
                          <div key={i} className="text-xs p-2 bg-[var(--bg-secondary)] rounded truncate">
                            {i + 1}. {name}
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Show pending courses */}
                  {transcriptionStatus.pending > 0 && transcriptionStatus.pending_courses && (
                    <div className="mt-4">
                      <h4 className="text-xs font-medium text-[var(--text-muted)] mb-2">
                        Pending ({transcriptionStatus.pending} courses):
                      </h4>
                      <div className="text-xs text-[var(--text-muted)] max-h-24 overflow-y-auto">
                        {transcriptionStatus.pending_courses.slice(0, 20).map((name, i) => (
                          <div key={i} className="py-0.5 truncate">{name}</div>
                        ))}
                        {transcriptionStatus.pending_courses.length > 20 && (
                          <div className="py-0.5 text-[var(--text-muted)]">
                            ... and {transcriptionStatus.pending_courses.length - 20} more
                          </div>
                        )}
                      </div>
                    </div>
                  )}
                </>
              ) : (
                <div className="text-center text-[var(--text-muted)] py-4">
                  {serverStatus === 'connected' ? 'Loading status...' : 'Server offline'}
                </div>
              )}
            </div>
          )}

          {/* Console Tab */}
          {activeTab === 'console' && (
            <>
              {/* Log output */}
              <div
                ref={logContainerRef}
                className="h-56 overflow-y-auto p-3 font-mono text-xs bg-[var(--bg-primary)]"
              >
                {logs.length === 0 ? (
                  <div className="text-[var(--text-muted)] text-center py-8">
                    <div className="mb-2">No activity logged yet.</div>
                    <div className="text-xs">Logs will appear here when transcription or summary generation starts.</div>
                  </div>
                ) : (
                  logs.map(log => (
                    <div
                      key={log.id}
                      className={`py-1 px-2 rounded mb-1 flex items-start gap-2 ${
                        log.type === 'error' ? 'bg-red-500/10' :
                        log.type === 'success' ? 'bg-green-500/10' :
                        log.type === 'warning' ? 'bg-amber-500/10' :
                        log.type === 'progress' ? 'bg-blue-500/5' :
                        ''
                      }`}
                    >
                      <span className="text-[var(--text-muted)] opacity-60 shrink-0 w-16">
                        {log.timestamp.toLocaleTimeString('en-US', { hour12: false })}
                      </span>
                      <span className={`shrink-0 w-4 ${
                        log.type === 'error' ? 'text-red-500' :
                        log.type === 'success' ? 'text-green-500' :
                        log.type === 'warning' ? 'text-amber-500' :
                        log.type === 'progress' ? 'text-blue-500' :
                        'text-[var(--text-muted)]'
                      }`}>
                        {log.type === 'error' ? '✕' :
                         log.type === 'success' ? '✓' :
                         log.type === 'warning' ? '!' :
                         log.type === 'progress' ? '⟳' :
                         '•'}
                      </span>
                      <span className={`flex-1 ${
                        log.type === 'error' ? 'text-red-400' :
                        log.type === 'success' ? 'text-green-400' :
                        log.type === 'warning' ? 'text-amber-400' :
                        'text-[var(--text-primary)]'
                      }`}>
                        {log.message}
                      </span>
                    </div>
                  ))
                )}
              </div>

              {/* Actions */}
              <div className="flex items-center justify-between px-4 py-2 border-t border-[var(--border)]">
                <button
                  onClick={(e) => {
                    e.stopPropagation()
                    setLogs([])
                    localStorage.removeItem('coursevault-console-logs')
                  }}
                  className="text-xs text-[var(--text-muted)] hover:text-[var(--text-primary)]"
                >
                  Clear logs
                </button>
                <div className="text-xs text-[var(--text-muted)]">
                  {logs.length} entries
                </div>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  )
}
