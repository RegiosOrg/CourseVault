import { useEffect, useMemo, useCallback, useState, useRef } from 'react'
import { useAppStore } from '@/stores/appStore'
import { api } from '@/api/client'
import { ToastProvider, useToast } from '@/components/ui/Toast'
import Sidebar from '@/components/Sidebar'
import ContentViewer from '@/components/ContentViewer'
import ChatPanel from '@/components/ChatPanel'
import StatusBar from '@/components/StatusBar'

function DashboardContent() {
  const {
    courseData,
    setCourseData,
    searchQuery,
    sortOrder,
    showUnreadOnly,
    readCourses,
    isChatOpen,
    setIsChatOpen,
    theme,
    setTheme,
    setScreen,
    generatingCourses,
    setGenerationStatus,
    completeGeneration,
    zoomLevel,
    setZoomLevel
  } = useAppStore()

  const toast = useToast()

  // Resizable sidebar - load saved width from localStorage
  const [sidebarWidth, setSidebarWidth] = useState(() => {
    const saved = localStorage.getItem('coursevault-sidebar-width')
    return saved ? parseInt(saved, 10) : 450
  })
  const containerRef = useRef<HTMLDivElement>(null)
  const isResizing = useRef(false)
  const minWidth = 300
  // maxWidth will be calculated dynamically (50% of container)

  // Save sidebar width to localStorage when it changes
  useEffect(() => {
    localStorage.setItem('coursevault-sidebar-width', String(sidebarWidth))
  }, [sidebarWidth])

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()
    isResizing.current = true
    document.body.style.cursor = 'col-resize'
    document.body.style.userSelect = 'none'
  }, [])

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (!isResizing.current) return

      // Prevent text selection during drag
      e.preventDefault()

      const container = containerRef.current
      if (!container) return

      const containerLeft = container.getBoundingClientRect().left
      const containerWidth = container.getBoundingClientRect().width
      const newWidth = e.clientX - containerLeft
      // Allow up to 50% of container width
      const maxWidth = Math.floor(containerWidth * 0.5)
      setSidebarWidth(Math.min(maxWidth, Math.max(minWidth, newWidth)))
    }

    const handleMouseUp = () => {
      if (isResizing.current) {
        isResizing.current = false
        document.body.style.cursor = ''
        document.body.style.userSelect = ''
      }
    }

    // Use capture phase to ensure we get the events
    document.addEventListener('mousemove', handleMouseMove, { capture: true })
    document.addEventListener('mouseup', handleMouseUp, { capture: true })

    return () => {
      document.removeEventListener('mousemove', handleMouseMove, { capture: true })
      document.removeEventListener('mouseup', handleMouseUp, { capture: true })
    }
  }, [])

  // Filter and sort courses
  const filteredCourses = useMemo(() => {
    if (!courseData) return []

    let courses = [...courseData.courses]

    // Search filter
    if (searchQuery) {
      const query = searchQuery.toLowerCase()
      courses = courses.filter(course => {
        const courseMatch = course.name.toLowerCase().includes(query) ||
          course.summary?.toLowerCase().includes(query)
        const videoMatch = course.videos.some(v =>
          v.name.toLowerCase().includes(query) ||
          v.summary?.toLowerCase().includes(query)
        )
        return courseMatch || videoMatch
      })
    }

    // Unread filter
    if (showUnreadOnly) {
      courses = courses.filter(c => !readCourses.has(c.name))
    }

    // Sort
    switch (sortOrder) {
      case 'newest':
        courses.sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0))
        break
      case 'oldest':
        courses.sort((a, b) => (a.timestamp || 0) - (b.timestamp || 0))
        break
      case 'alpha':
      default:
        courses.sort((a, b) => a.name.localeCompare(b.name))
    }

    return courses
  }, [courseData, searchQuery, sortOrder, showUnreadOnly, readCourses])

  // Poll generation status
  useEffect(() => {
    if (generatingCourses.size === 0) return

    const interval = setInterval(async () => {
      try {
        const status = await api.getGenerationStatus()
        setGenerationStatus(status)

        if (status.current?.status === 'completed') {
          toast.success(`Completed: ${status.current.course}`)
          completeGeneration(status.current.course)
          // Reload to get new data
          setTimeout(() => window.location.reload(), 1500)
        } else if (status.current?.status === 'failed') {
          toast.error(`Failed: ${status.current.course}`)
          completeGeneration(status.current.course)
        }
      } catch (err) {
        // Server might be restarting
      }
    }, 2000)

    return () => clearInterval(interval)
  }, [generatingCourses.size])

  // Poll for course data updates (check every 10 seconds)
  useEffect(() => {
    const checkForUpdates = async () => {
      try {
        const freshData = await api.fetchCourseData()
        // Only update if the generated timestamp has changed
        if (freshData.generated !== courseData?.generated) {
          console.log('Course data updated, refreshing...')
          setCourseData(freshData)
        }
      } catch (err) {
        // Server might be unavailable, ignore
      }
    }

    // Initial check after 5 seconds (give time for any pending index regeneration)
    const initialTimeout = setTimeout(checkForUpdates, 5000)

    // Then poll every 10 seconds
    const interval = setInterval(checkForUpdates, 10000)

    return () => {
      clearTimeout(initialTimeout)
      clearInterval(interval)
    }
  }, [courseData?.generated, setCourseData])

  // Keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Cmd/Ctrl + K for search focus
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault()
        document.getElementById('search-input')?.focus()
      }

      // Escape to close chat or clear search
      if (e.key === 'Escape') {
        if (isChatOpen) {
          setIsChatOpen(false)
        }
      }

      // Cmd/Ctrl + 0 to reset zoom
      if ((e.metaKey || e.ctrlKey) && e.key === '0') {
        e.preventDefault()
        setZoomLevel(100)
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [isChatOpen, setZoomLevel])

  // Ctrl+scroll to zoom
  useEffect(() => {
    const handleWheel = (e: WheelEvent) => {
      if (e.ctrlKey) {
        e.preventDefault()
        const delta = e.deltaY > 0 ? -5 : 5
        setZoomLevel(zoomLevel + delta)
      }
    }

    window.addEventListener('wheel', handleWheel, { passive: false })
    return () => window.removeEventListener('wheel', handleWheel)
  }, [zoomLevel, setZoomLevel])

  const toggleTheme = useCallback(() => {
    setTheme(theme === 'dark' ? 'light' : 'dark')
  }, [theme, setTheme])

  // Window control handlers
  const handleMinimize = () => window.electronAPI?.windowMinimize?.()
  const handleMaximize = () => window.electronAPI?.windowMaximize?.()
  const handleClose = () => window.electronAPI?.windowClose?.()

  return (
    <div className="flex flex-col h-screen bg-[var(--bg-primary)]">
      {/* Custom title bar */}
      <div
        className="h-10 flex items-center justify-between bg-[var(--bg-secondary)] border-b border-[var(--border)] flex-shrink-0 select-none"
        style={{ WebkitAppRegion: 'drag' } as React.CSSProperties}
      >
        {/* Left: App title */}
        <div className="flex items-center gap-2 px-4">
          <span className="text-sm font-medium text-[var(--text-primary)]">Course Vault</span>
        </div>

        {/* Right: Controls */}
        <div className="flex items-center h-full" style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}>
          {/* Settings button */}
          <button
            onClick={() => setScreen('settings')}
            className="h-full px-3 flex items-center justify-center text-[var(--text-muted)] hover:bg-[var(--bg-tertiary)] transition-colors"
            title="Settings"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
            </svg>
          </button>

          {/* Theme toggle */}
          <button
            onClick={toggleTheme}
            className="h-full px-3 flex items-center justify-center text-[var(--text-muted)] hover:bg-[var(--bg-tertiary)] transition-colors"
            title={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
          >
            <span className="text-sm">{theme === 'dark' ? '🌙' : '☀️'}</span>
          </button>

          {/* Divider */}
          <div className="w-px h-4 bg-[var(--border)] mx-1" />

          {/* Minimize */}
          <button
            onClick={handleMinimize}
            className="h-full px-3 flex items-center justify-center text-[var(--text-muted)] hover:bg-[var(--bg-tertiary)] transition-colors"
            title="Minimize"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeWidth={2} d="M5 12h14" />
            </svg>
          </button>

          {/* Maximize */}
          <button
            onClick={handleMaximize}
            className="h-full px-3 flex items-center justify-center text-[var(--text-muted)] hover:bg-[var(--bg-tertiary)] transition-colors"
            title="Maximize"
          >
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <rect x="4" y="4" width="16" height="16" rx="1" strokeWidth={2} />
            </svg>
          </button>

          {/* Close */}
          <button
            onClick={handleClose}
            className="h-full px-3 flex items-center justify-center text-[var(--text-muted)] hover:bg-red-500 hover:text-white transition-colors"
            title="Close"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
      </div>

      {/* Main content area */}
      <div ref={containerRef} className="flex flex-1 min-h-0">
        {/* Sidebar */}
        <div
          className="flex-shrink-0 h-full"
          style={{ width: `${sidebarWidth}px` }}
        >
          <Sidebar courses={filteredCourses} />
        </div>

        {/* Resizable divider - wider hit area, thin visual */}
        <div
          className="w-3 flex-shrink-0 flex items-center justify-center cursor-col-resize group"
          onMouseDown={handleMouseDown}
        >
          <div className="w-px h-full bg-[var(--border)] group-hover:bg-accent group-hover:w-1 group-active:bg-accent transition-all" />
        </div>

        {/* Content viewer - takes remaining space */}
        <div className="flex-1 min-w-0 h-full">
          <ContentViewer />
        </div>
      </div>

      {/* Status bar */}
      <StatusBar />

      {/* Keyboard shortcuts hint - moved up to avoid status bar */}
      <div className="fixed bottom-10 left-4 z-30 text-xs text-[var(--text-muted)] bg-[var(--bg-tertiary)] px-3 py-2 rounded-lg flex items-center gap-3">
        <span>
          <kbd className="px-1.5 py-0.5 bg-[var(--bg-primary)] border border-[var(--border)] rounded text-2xs">Ctrl</kbd>
          +
          <kbd className="px-1.5 py-0.5 bg-[var(--bg-primary)] border border-[var(--border)] rounded text-2xs mx-1">K</kbd>
          search
        </span>
        <span className="text-[var(--border)]">|</span>
        <span>
          <kbd className="px-1.5 py-0.5 bg-[var(--bg-primary)] border border-[var(--border)] rounded text-2xs">Ctrl</kbd>
          +
          <kbd className="px-1.5 py-0.5 bg-[var(--bg-primary)] border border-[var(--border)] rounded text-2xs mx-1">Scroll</kbd>
          zoom ({zoomLevel}%)
        </span>
      </div>

      {/* Chat FAB - moved up to avoid status bar */}
      {!isChatOpen && (
        <button
          onClick={() => setIsChatOpen(true)}
          className="fixed bottom-12 right-5 z-50 w-14 h-14 rounded-full bg-accent text-white shadow-lg hover:scale-110 transition-transform flex items-center justify-center"
          title="Ask AI about courses"
        >
          <svg className="w-7 h-7" fill="currentColor" viewBox="0 0 24 24">
            <path d="M20 2H4c-1.1 0-2 .9-2 2v18l4-4h14c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2zm0 14H6l-2 2V4h16v12z"/>
          </svg>
        </button>
      )}

      {/* Chat Panel */}
      <ChatPanel />
    </div>
  )
}

export default function Dashboard() {
  return (
    <ToastProvider>
      <DashboardContent />
    </ToastProvider>
  )
}
