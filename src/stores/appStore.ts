import { create } from 'zustand'
import { persist } from 'zustand/middleware'

// Types
export interface Video {
  name: string
  path: string
  summary: string
  full_summary: string
  transcript: string
  has_summary: boolean
}

export interface Course {
  name: string
  path: string
  summary: string
  full_summary: string
  date: string
  timestamp: number
  videos: Video[]
}

export interface CourseData {
  courses: Course[]
  generated: string
  total_videos: number
}

export interface ChatMessage {
  id: string
  role: 'user' | 'assistant' | 'error'
  content: string
  sources?: Array<{ course: string; video: string; type: string }>
  timestamp: Date
}

export type Screen = 'setup' | 'dashboard' | 'settings'
export type Theme = 'dark' | 'light'
export type LLMBackend = 'ollama' | 'lmstudio' | 'openai' | null
export type SortOrder = 'alpha' | 'newest' | 'oldest'
export type ContentTab = 'summary' | 'transcript'
export type LicenseTier = 'free' | 'pro' | 'pro_plus'
export type LicenseStatus = 'valid' | 'invalid' | 'expired' | 'none'

export interface LicenseInfo {
  key: string | null
  tier: LicenseTier
  status: LicenseStatus
  email: string | null
  expiresAt: string | null
  features: string[]
}

export interface UsageInfo {
  hoursTranscribed: number
  coursesIndexed: number
  lastUpdated: string | null
}

// Tier limits and features
export const TIER_LIMITS = {
  free: { hours: 200, courses: 100 },
  pro: { hours: Infinity, courses: Infinity },
  pro_plus: { hours: Infinity, courses: Infinity }
} as const

export const TIER_FEATURES = {
  free: ['transcribe', 'summarize', 'chat'],
  pro: ['transcribe', 'summarize', 'chat', 'export', 'unlimited_courses'],
  pro_plus: ['transcribe', 'summarize', 'chat', 'export', 'unlimited_courses', 'cloud_backup', 'auto_transcribe']
} as const

interface AppState {
  // App state
  screen: Screen
  isFirstRun: boolean
  isLoading: boolean
  error: string | null

  // Theme
  theme: Theme

  // Course data
  courseData: CourseData | null
  selectedCourse: Course | null
  selectedVideo: Video | null
  expandedCourses: Set<string>
  readCourses: Set<string>

  // UI state
  searchQuery: string
  sortOrder: SortOrder
  showUnreadOnly: boolean
  contentTab: ContentTab
  isChatOpen: boolean
  zoomLevel: number

  // Chat
  chatMessages: ChatMessage[]
  isChatLoading: boolean

  // Settings
  llmBackend: LLMBackend
  transcriptsPath: string
  sourceDirectories: string[]
  serverPort: number
  whisperModel: string
  parallelWorkers: number
  gpuAcceleration: boolean

  // Generation
  generatingCourses: Set<string>
  generationStatus: {
    current: {
      course: string
      status: string
      progress: number
      total: number
      current_video: string
    } | null
    queue: string[]
  } | null

  // License
  license: LicenseInfo
  usage: UsageInfo

  // Actions
  setScreen: (screen: Screen) => void
  setTheme: (theme: Theme) => void
  setCourseData: (data: CourseData) => void
  selectCourse: (course: Course | null) => void
  selectVideo: (video: Video | null) => void
  toggleCourseExpanded: (courseName: string) => void
  toggleCourseRead: (courseName: string) => void
  setSearchQuery: (query: string) => void
  setSortOrder: (order: SortOrder) => void
  setShowUnreadOnly: (show: boolean) => void
  setContentTab: (tab: ContentTab) => void
  setIsChatOpen: (open: boolean) => void
  setZoomLevel: (level: number) => void
  addChatMessage: (message: Omit<ChatMessage, 'id' | 'timestamp'>) => void
  setIsChatLoading: (loading: boolean) => void
  clearChat: () => void
  setLLMBackend: (backend: LLMBackend) => void
  setTranscriptsPath: (path: string) => void
  setSourceDirectories: (dirs: string[]) => void
  addSourceDirectory: (dir: string) => void
  removeSourceDirectory: (dir: string) => void
  setServerPort: (port: number) => void
  setWhisperModel: (model: string) => void
  setParallelWorkers: (workers: number) => void
  setGpuAcceleration: (enabled: boolean) => void
  setIsFirstRun: (isFirst: boolean) => void
  setIsLoading: (loading: boolean) => void
  setError: (error: string | null) => void
  setGenerationStatus: (status: AppState['generationStatus']) => void
  startGeneration: (courseName: string) => void
  completeGeneration: (courseName: string) => void
  deleteCourse: (courseName: string) => void

  // License actions
  setLicense: (license: Partial<LicenseInfo>) => void
  activateLicense: (key: string) => Promise<boolean>
  clearLicense: () => void
  incrementUsage: (type: 'hours' | 'courses', amount?: number) => void
  canUseFeature: (feature: 'transcribe' | 'summarize' | 'chat' | 'export' | 'cloud_backup' | 'auto_transcribe' | 'unlimited_courses') => boolean
  isWithinLimits: () => boolean
  getRemainingUsage: () => { courses: number; hours: number }
}

export const useAppStore = create<AppState>()(
  persist(
    (set, get) => ({
      // Initial state
      screen: 'dashboard',
      isFirstRun: true,
      isLoading: true,
      error: null,
      theme: 'dark',
      courseData: null,
      selectedCourse: null,
      selectedVideo: null,
      expandedCourses: new Set(),
      readCourses: new Set(),
      searchQuery: '',
      sortOrder: 'alpha',
      showUnreadOnly: false,
      contentTab: 'summary',
      isChatOpen: false,
      zoomLevel: 100,
      chatMessages: [],
      isChatLoading: false,
      llmBackend: null,
      transcriptsPath: '',
      sourceDirectories: [],
      serverPort: 8080,
      whisperModel: 'base.en',
      parallelWorkers: 2,
      gpuAcceleration: true,
      generatingCourses: new Set(),
      generationStatus: null,

      // License - only grant dev-mode pro when explicitly enabled
      license: {
        key: (import.meta.env.DEV && import.meta.env.VITE_ENABLE_DEV_LICENSES === 'true') ? 'DEV-MODE-PRO' : null,
        tier: (import.meta.env.DEV && import.meta.env.VITE_ENABLE_DEV_LICENSES === 'true') ? 'pro' : 'free',
        status: (import.meta.env.DEV && import.meta.env.VITE_ENABLE_DEV_LICENSES === 'true') ? 'valid' : 'none',
        email: (import.meta.env.DEV && import.meta.env.VITE_ENABLE_DEV_LICENSES === 'true') ? 'dev@localhost' : null,
        expiresAt: null,
        features: (import.meta.env.DEV && import.meta.env.VITE_ENABLE_DEV_LICENSES === 'true') ? TIER_FEATURES.pro as unknown as string[] : TIER_FEATURES.free as unknown as string[]
      },
      usage: {
        hoursTranscribed: 0,
        coursesIndexed: 0,
        lastUpdated: null
      },

      // Actions
      setScreen: (screen) => set({ screen }),
      setTheme: (theme) => {
        document.documentElement.classList.toggle('light', theme === 'light')
        set({ theme })
      },
      setCourseData: (courseData) => set((state) => {
        // Only clean up readCourses if we have a substantial course list
        // This prevents wiping read marks during loading/errors
        const courses = courseData?.courses || []
        let newReadCourses = state.readCourses

        // Only clean if we have at least 10 courses (not an error/loading state)
        if (courses.length >= 10) {
          const validCourseNames = new Set(courses.map(c => c.name))
          newReadCourses = new Set(
            Array.from(state.readCourses).filter(name => validCourseNames.has(name))
          )
        }

        return {
          courseData,
          isLoading: false,
          readCourses: newReadCourses
        }
      }),
      selectCourse: (selectedCourse) => set({ selectedCourse, selectedVideo: null }),
      selectVideo: (selectedVideo) => set({ selectedVideo }),
      toggleCourseExpanded: (courseName) => set((state) => {
        const expanded = new Set(state.expandedCourses)
        if (expanded.has(courseName)) {
          expanded.delete(courseName)
        } else {
          expanded.add(courseName)
        }
        return { expandedCourses: expanded }
      }),
      toggleCourseRead: (courseName) => set((state) => {
        const read = new Set(state.readCourses)
        if (read.has(courseName)) {
          read.delete(courseName)
        } else {
          read.add(courseName)
        }
        return { readCourses: read }
      }),
      setSearchQuery: (searchQuery) => set({ searchQuery }),
      setSortOrder: (sortOrder) => set({ sortOrder }),
      setShowUnreadOnly: (showUnreadOnly) => set({ showUnreadOnly }),
      setContentTab: (contentTab) => set({ contentTab }),
      setIsChatOpen: (isChatOpen) => set({ isChatOpen }),
      setZoomLevel: (zoomLevel) => {
        // Clamp zoom level between 50% and 200%
        const clamped = Math.min(200, Math.max(50, zoomLevel))
        document.documentElement.style.fontSize = `${clamped}%`
        set({ zoomLevel: clamped })
      },
      addChatMessage: (message) => set((state) => ({
        chatMessages: [...state.chatMessages, {
          ...message,
          id: crypto.randomUUID(),
          timestamp: new Date()
        }]
      })),
      setIsChatLoading: (isChatLoading) => set({ isChatLoading }),
      clearChat: () => set({
        chatMessages: [{
          id: crypto.randomUUID(),
          role: 'assistant',
          content: 'Hi! I can answer questions about your courses. What would you like to know?',
          timestamp: new Date()
        }]
      }),
      setLLMBackend: (llmBackend) => {
        set({ llmBackend })
        // Sync to electron store so main process can read it
        if (window.electronAPI) {
          window.electronAPI.setSettings('llmBackend', llmBackend)
        }
      },
      setTranscriptsPath: (transcriptsPath) => set({ transcriptsPath }),
      setSourceDirectories: (sourceDirectories) => {
        set({ sourceDirectories })
        if (window.electronAPI) {
          window.electronAPI.setSettings('sourceDirectories', sourceDirectories)
        }
      },
      addSourceDirectory: (dir) => set((state) => {
        if (state.sourceDirectories.includes(dir)) return {}
        const newDirs = [...state.sourceDirectories, dir]
        if (window.electronAPI) {
          window.electronAPI.setSettings('sourceDirectories', newDirs)
        }
        return { sourceDirectories: newDirs }
      }),
      removeSourceDirectory: (dir) => set((state) => {
        const newDirs = state.sourceDirectories.filter(d => d !== dir)
        if (window.electronAPI) {
          window.electronAPI.setSettings('sourceDirectories', newDirs)
        }
        return { sourceDirectories: newDirs }
      }),
      setServerPort: (serverPort) => set({ serverPort }),
      setWhisperModel: (whisperModel) => set({ whisperModel }),
      setParallelWorkers: (parallelWorkers) => set({ parallelWorkers }),
      setGpuAcceleration: (gpuAcceleration) => {
        set({ gpuAcceleration })
        // Sync to electron store so the transcription worker can read it
        if (window.electronAPI) {
          window.electronAPI.setSettings('gpuAcceleration', gpuAcceleration)
        }
      },
      setIsFirstRun: (isFirstRun) => set({ isFirstRun }),
      setIsLoading: (isLoading) => set({ isLoading }),
      setError: (error) => set({ error }),
      setGenerationStatus: (generationStatus) => set({ generationStatus }),
      startGeneration: (courseName) => set((state) => {
        const generating = new Set(state.generatingCourses)
        generating.add(courseName)
        return { generatingCourses: generating }
      }),
      completeGeneration: (courseName) => set((state) => {
        const generating = new Set(state.generatingCourses)
        generating.delete(courseName)
        return { generatingCourses: generating }
      }),
      deleteCourse: (courseName) => set((state) => {
        if (!state.courseData) return {}
        const courses = state.courseData.courses.filter(c => c.name !== courseName)
        return {
          courseData: { ...state.courseData, courses },
          selectedCourse: state.selectedCourse?.name === courseName ? null : state.selectedCourse,
          selectedVideo: state.selectedCourse?.name === courseName ? null : state.selectedVideo
        }
      }),

      // License actions
      setLicense: (license) => set((state) => ({
        license: { ...state.license, ...license }
      })),

      activateLicense: async (key) => {
        const trimmedKey = key.trim()

        // Validate via Electron main process (Ed25519 signature verification)
        if (window.electronAPI?.validateLicense) {
          const result = await window.electronAPI.validateLicense(trimmedKey)

          if (result.valid) {
            set({
              license: {
                key: trimmedKey,
                tier: result.tier as LicenseTier,
                status: 'valid',
                email: result.email,
                expiresAt: result.expiresAt,
                features: result.features
              }
            })
            return true
          }

          // Invalid or expired
          set((state) => ({
            license: {
              ...state.license,
              status: result.status as LicenseStatus,
              key: null,
              features: [...TIER_FEATURES.free]
            }
          }))
          return false
        }

        // Fallback for browser/dev mode without Electron
        set((state) => ({
          license: { ...state.license, status: 'invalid', key: null, features: [...TIER_FEATURES.free] }
        }))
        return false
      },

      clearLicense: () => set({
        license: {
          key: null,
          tier: 'free',
          status: 'none',
          email: null,
          expiresAt: null,
          features: TIER_FEATURES.free as unknown as string[]
        }
      }),

      incrementUsage: (type, amount = 1) => set((state) => {
        const usage = { ...state.usage }
        switch (type) {
          case 'hours':
            usage.hoursTranscribed += amount
            break
          case 'courses':
            usage.coursesIndexed += amount
            break
        }
        usage.lastUpdated = new Date().toISOString()
        return { usage }
      }),

      canUseFeature: (feature): boolean => {
        const { license, usage } = get()
        const limits = TIER_LIMITS[license.tier]
        const features = TIER_FEATURES[license.tier]

        // Check if feature is available for this tier
        if (!(features as readonly string[]).includes(feature)) {
          return false
        }

        // For free tier, also check usage limits
        if (license.tier === 'free') {
          switch (feature) {
            case 'transcribe':
              return usage.hoursTranscribed < limits.hours
            case 'summarize':
            case 'chat':
              return usage.coursesIndexed < limits.courses
            default:
              return true
          }
        }

        // Pro and Pro+ have unlimited access to their features
        return true
      },

      isWithinLimits: (): boolean => {
        const { license, usage } = get()
        if (license.tier !== 'free') return true
        const limits = TIER_LIMITS.free
        return usage.coursesIndexed < limits.courses && usage.hoursTranscribed < limits.hours
      },

      getRemainingUsage: () => {
        const { usage } = get()
        return {
          courses: Math.max(0, TIER_LIMITS.free.courses - usage.coursesIndexed),
          hours: Math.max(0, TIER_LIMITS.free.hours - usage.hoursTranscribed)
        }
      }
    }),
    {
      name: 'coursevault-storage',
      partialize: (state) => ({
        theme: state.theme,
        readCourses: Array.from(state.readCourses),
        sortOrder: state.sortOrder,
        showUnreadOnly: state.showUnreadOnly,
        zoomLevel: state.zoomLevel,
        llmBackend: state.llmBackend,
        transcriptsPath: state.transcriptsPath,
        sourceDirectories: state.sourceDirectories,
        serverPort: state.serverPort,
        whisperModel: state.whisperModel,
        parallelWorkers: state.parallelWorkers,
        gpuAcceleration: state.gpuAcceleration,
        isFirstRun: state.isFirstRun,
        license: state.license,
        usage: state.usage,
        chatMessages: state.chatMessages.map(msg => ({
          ...msg,
          timestamp: msg.timestamp.toISOString()
        }))
      }),
      onRehydrateStorage: () => (state) => {
        if (state) {
          // Convert readCourses array back to Set
          if (Array.isArray(state.readCourses)) {
            state.readCourses = new Set(state.readCourses)
          }
          // Convert chat message timestamps back to Date objects
          if (Array.isArray(state.chatMessages)) {
            state.chatMessages = state.chatMessages.map((msg: any) => ({
              ...msg,
              timestamp: new Date(msg.timestamp)
            }))
          }
          // Add welcome message if chat is empty
          if (!state.chatMessages || state.chatMessages.length === 0) {
            state.chatMessages = [{
              id: crypto.randomUUID(),
              role: 'assistant',
              content: 'Hi! I can answer questions about your courses. What would you like to know?',
              timestamp: new Date()
            }]
          }
          // Apply theme
          document.documentElement.classList.toggle('light', state.theme === 'light')
          // Sync critical settings to electron-store on startup
          if (window.electronAPI) {
            window.electronAPI.setSettings('llmBackend', state.llmBackend)
            window.electronAPI.setSettings('gpuAcceleration', state.gpuAcceleration)
            window.electronAPI.setSettings('parallelWorkers', state.parallelWorkers)
            window.electronAPI.setSettings('sourceDirectories', state.sourceDirectories)
          }
          // Apply zoom level
          if (state.zoomLevel) {
            document.documentElement.style.fontSize = `${state.zoomLevel}%`
          }
        }
      }
    }
  )
)
