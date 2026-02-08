import { useCallback } from 'react'
import { useAppStore } from '@/stores/appStore'
import { api } from '@/api/client'

export function useChat() {
  const {
    chatMessages,
    isChatOpen,
    isChatLoading,
    setIsChatOpen,
    addChatMessage,
    setIsChatLoading,
    clearChat,
    courseData,
    selectCourse,
    selectVideo
  } = useAppStore()

  // Send a message
  const sendMessage = useCallback(async (question: string): Promise<void> => {
    if (!question.trim() || isChatLoading) return

    // Add user message
    addChatMessage({ role: 'user', content: question.trim() })
    setIsChatLoading(true)

    try {
      const response = await api.chat(question.trim())

      if (response.error) {
        addChatMessage({ role: 'error', content: response.error })
      } else {
        addChatMessage({
          role: 'assistant',
          content: response.answer,
          sources: response.sources
        })
      }
    } catch (err) {
      addChatMessage({
        role: 'error',
        content: `Failed to get response: ${err instanceof Error ? err.message : 'Unknown error'}`
      })
    } finally {
      setIsChatLoading(false)
    }
  }, [isChatLoading, addChatMessage, setIsChatLoading])

  // Navigate to a source
  const navigateToSource = useCallback((source: { course: string; video: string; type: string }) => {
    if (!courseData) return

    const course = courseData.courses.find(c => c.name === source.course)
    if (!course) return

    selectCourse(course)

    if (source.video !== 'COURSE OVERVIEW') {
      const video = course.videos.find(v => v.name === source.video)
      if (video) selectVideo(video)
    } else {
      selectVideo(null)
    }

    // Close chat panel
    setIsChatOpen(false)
  }, [courseData, selectCourse, selectVideo, setIsChatOpen])

  // Open chat
  const openChat = useCallback(() => {
    setIsChatOpen(true)
  }, [setIsChatOpen])

  // Close chat
  const closeChat = useCallback(() => {
    setIsChatOpen(false)
  }, [setIsChatOpen])

  // Toggle chat
  const toggleChat = useCallback(() => {
    setIsChatOpen(!isChatOpen)
  }, [isChatOpen, setIsChatOpen])

  return {
    // State
    messages: chatMessages,
    isOpen: isChatOpen,
    isLoading: isChatLoading,

    // Actions
    sendMessage,
    navigateToSource,
    openChat,
    closeChat,
    toggleChat,
    clearChat
  }
}
