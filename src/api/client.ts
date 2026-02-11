import { CourseData } from '@/stores/appStore'

const getBaseUrl = () => {
  // Always use direct connection to Python server
  // webSecurity is disabled in dev mode to allow cross-origin requests
  return 'http://127.0.0.1:8080'
}

class APIClient {
  private baseUrl: string

  constructor() {
    this.baseUrl = getBaseUrl()
  }

  setPort(port: number) {
    this.baseUrl = `http://127.0.0.1:${port}`
  }

  async fetchCourseData(): Promise<CourseData> {
    const url = `${this.baseUrl}/api/courses`
    console.log(`[API] Fetching courses from ${url}`)
    const response = await fetch(url, {
      method: 'GET',
      headers: { 'Accept': 'application/json' },
      signal: AbortSignal.timeout(10000) // 10 second timeout
    })

    console.log(`[API] Courses response: ${response.status}`)
    if (!response.ok) {
      throw new Error(`Server returned ${response.status}`)
    }

    return response.json()
  }

  async checkHealth(): Promise<boolean> {
    const url = `${this.baseUrl}/health`
    try {
      console.log(`[API] Checking health at ${url}`)
      const response = await fetch(url, {
        method: 'GET',
        signal: AbortSignal.timeout(5000)
      })
      console.log(`[API] Health check response: ${response.status}`)
      return response.ok
    } catch (err) {
      console.error('[API] Health check failed:', err)
      return false
    }
  }

  async chat(question: string, options?: { topK?: number; course?: string; model?: string }): Promise<{
    answer: string
    sources: Array<{ course: string; video: string; type: string }>
    error?: string
  }> {
    const { topK = 5, course, model } = options || {}

    // Get model from localStorage if not provided
    const effectiveModel = model ||
      localStorage.getItem('lmstudio-model') ||
      localStorage.getItem('openai-model') ||
      null

    const response = await fetch(`${this.baseUrl}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        question,
        top_k: topK,
        course: course || null,
        model: effectiveModel
      })
    })

    const data = await response.json()

    if (!response.ok) {
      throw new Error(data.error || `HTTP ${response.status}`)
    }

    return data
  }

  async deleteCourse(courseName: string, signal?: AbortSignal): Promise<{
    success: boolean
    deleted_source: boolean
    deleted_transcript: boolean
    error?: string
  }> {
    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), 60000) // 60 second timeout

    try {
      const response = await fetch(`${this.baseUrl}/api/delete-course`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ course: courseName }),
        signal: signal || controller.signal
      })

      clearTimeout(timeoutId)
      const data = await response.json()

      if (!response.ok) {
        throw new Error(data.error || `HTTP ${response.status}`)
      }

      return data
    } catch (err) {
      clearTimeout(timeoutId)
      if (err instanceof Error && err.name === 'AbortError') {
        throw new Error('Delete operation timed out or was cancelled')
      }
      throw err
    }
  }

  async generateSummary(courseName: string): Promise<{
    status: string
    course: string
    position?: number
    error?: string
  }> {
    try {
      const response = await fetch(`${this.baseUrl}/api/generate-summary`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ course: courseName }),
        signal: AbortSignal.timeout(30000) // 30 second timeout
      })

      const data = await response.json()

      if (!response.ok) {
        return { status: 'error', course: courseName, error: data.error || `HTTP ${response.status}` }
      }

      return data
    } catch (err) {
      if (err instanceof Error) {
        if (err.name === 'TimeoutError' || err.name === 'AbortError') {
          return { status: 'error', course: courseName, error: 'Request timed out. Server might be busy or unresponsive.' }
        }
        return { status: 'error', course: courseName, error: err.message }
      }
      return { status: 'error', course: courseName, error: 'Unknown error' }
    }
  }

  async getGenerationStatus(): Promise<{
    current: {
      course: string
      status: string
      progress: number
      total: number
      current_video: string
      started_at: string
      completed_at: string
      error: string
    } | null
    queue: string[]
    error?: string
  }> {
    try {
      const response = await fetch(`${this.baseUrl}/api/generation-status`, {
        signal: AbortSignal.timeout(5000)
      })

      if (!response.ok) {
        return { current: null, queue: [], error: `HTTP ${response.status}` }
      }

      return response.json()
    } catch (err) {
      return { current: null, queue: [], error: err instanceof Error ? err.message : 'Failed to get status' }
    }
  }

  async getTranscriptionStatus(): Promise<{
    total_courses: number
    completed: number
    in_progress: number
    pending: number
    total_videos_done: number
    total_videos_processed: number
    total_videos: number
    processing_started_at: string | null
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
  }> {
    const response = await fetch(`${this.baseUrl}/api/transcription-status`)
    return response.json()
  }

  async cancelGeneration(courseName: string): Promise<{ success: boolean }> {
    const response = await fetch(`${this.baseUrl}/api/cancel-generation`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ course: courseName })
    })
    return response.json()
  }

  async refreshIndex(): Promise<{ status: string; message?: string; error?: string }> {
    try {
      const response = await fetch(`${this.baseUrl}/api/refresh-index`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: AbortSignal.timeout(10000)
      })

      const data = await response.json()

      if (!response.ok) {
        return { status: 'error', error: data.error || `HTTP ${response.status}` }
      }

      return data
    } catch (err) {
      if (err instanceof Error) {
        return { status: 'error', error: err.message }
      }
      return { status: 'error', error: 'Unknown error' }
    }
  }
}

export const api = new APIClient()
