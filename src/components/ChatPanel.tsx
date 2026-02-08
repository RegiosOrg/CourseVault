import { useState, useRef, useEffect } from 'react'
import DOMPurify from 'dompurify'
import { useAppStore } from '@/stores/appStore'
import { api } from '@/api/client'
import { Button } from '@/components/ui/Button'

export default function ChatPanel() {
  const {
    isChatOpen,
    setIsChatOpen,
    chatMessages,
    isChatLoading,
    addChatMessage,
    setIsChatLoading,
    clearChat,
    selectCourse,
    selectVideo,
    courseData,
    selectedCourse
  } = useAppStore()

  const [input, setInput] = useState('')
  const [searchScope, setSearchScope] = useState<'all' | 'current'>('all')
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  // Scroll to bottom when messages change
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [chatMessages])

  // Focus input when panel opens
  useEffect(() => {
    if (isChatOpen) {
      inputRef.current?.focus()
    }
  }, [isChatOpen])

  // Send message
  const handleSend = async () => {
    const question = input.trim()
    if (!question || isChatLoading) return

    // Add user message
    addChatMessage({ role: 'user', content: question })
    setInput('')
    setIsChatLoading(true)

    try {
      // Pass course filter if searching in current course only
      const courseFilter = searchScope === 'current' && selectedCourse ? selectedCourse.name : undefined
      const response = await api.chat(question, { course: courseFilter })

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
  }

  // Handle source click - navigate to course/video
  const handleSourceClick = (source: { course: string; video: string; type: string }) => {
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
  }

  // Format message content
  const formatContent = (content: string) => {
    return content
      .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
      .replace(/\*(.+?)\*/g, '<em>$1</em>')
      .replace(/^- (.+)$/gm, '• $1')
  }

  if (!isChatOpen) return null

  return (
    <>
      {/* Overlay */}
      <div
        className="fixed inset-0 bg-black/50 z-[150]"
        onClick={() => setIsChatOpen(false)}
      />

      {/* Panel */}
      <div className="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] max-w-[90vw] h-[70vh] max-h-[700px] bg-[var(--bg-secondary)] border border-[var(--border)] rounded-xl shadow-2xl z-[200] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 bg-[var(--bg-tertiary)] border-b border-[var(--border)] rounded-t-xl">
          <div className="flex items-center gap-3">
            <h3 className="font-semibold text-accent">💬 AI Course Assistant</h3>
            {/* Search scope toggle */}
            <div className="flex items-center bg-[var(--bg-primary)] rounded-lg p-0.5 text-xs">
              <button
                onClick={() => setSearchScope('all')}
                className={`px-2 py-1 rounded transition-colors ${
                  searchScope === 'all'
                    ? 'bg-accent text-white'
                    : 'text-[var(--text-muted)] hover:text-[var(--text-primary)]'
                }`}
              >
                All Courses
              </button>
              <button
                onClick={() => setSearchScope('current')}
                disabled={!selectedCourse}
                className={`px-2 py-1 rounded transition-colors ${
                  searchScope === 'current'
                    ? 'bg-accent text-white'
                    : 'text-[var(--text-muted)] hover:text-[var(--text-primary)]'
                } ${!selectedCourse ? 'opacity-50 cursor-not-allowed' : ''}`}
                title={selectedCourse ? `Search in: ${selectedCourse.name}` : 'Select a course first'}
              >
                Current Course
              </button>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={clearChat}
              className="text-xs text-[var(--text-muted)] hover:text-[var(--text-primary)] px-2 py-1 hover:bg-[var(--border)] rounded transition-colors"
            >
              Clear
            </button>
            <button
              onClick={() => setIsChatOpen(false)}
              className="p-1.5 text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--border)] rounded transition-colors"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        </div>

        {/* Messages */}
        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          {chatMessages.map((msg) => (
            <div
              key={msg.id}
              className={`max-w-[80%] p-3 rounded-xl ${
                msg.role === 'user'
                  ? 'ml-auto bg-accent text-white rounded-br-sm'
                  : msg.role === 'error'
                  ? 'bg-error/20 text-error border border-error rounded-bl-sm'
                  : 'bg-[var(--bg-tertiary)] text-[var(--text-primary)] border border-[var(--border)] rounded-bl-sm'
              }`}
            >
              <div
                className="text-sm leading-relaxed whitespace-pre-wrap"
                dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(formatContent(msg.content)) }}
              />

              {/* Sources */}
              {msg.sources && msg.sources.length > 0 && (
                <div className="mt-3 pt-3 border-t border-[var(--border)] text-xs text-[var(--text-muted)]">
                  <strong>Sources:</strong>{' '}
                  {msg.sources.map((source, i) => (
                    <span key={i}>
                      {i > 0 && ' · '}
                      <button
                        onClick={() => handleSourceClick(source)}
                        className="text-accent hover:underline"
                      >
                        {source.type === 'course_summary' ? '📚' : '📹'}{' '}
                        {source.course}
                        {source.video !== 'COURSE OVERVIEW' && ` - ${source.video}`}
                      </button>
                    </span>
                  ))}
                </div>
              )}
            </div>
          ))}

          {/* Loading indicator */}
          {isChatLoading && (
            <div className="flex items-center gap-2 text-[var(--text-muted)] p-3">
              <div className="flex gap-1">
                <div className="w-2 h-2 bg-accent rounded-full loading-dot" />
                <div className="w-2 h-2 bg-accent rounded-full loading-dot" />
                <div className="w-2 h-2 bg-accent rounded-full loading-dot" />
              </div>
              <span className="text-sm">Thinking...</span>
            </div>
          )}

          <div ref={messagesEndRef} />
        </div>

        {/* Input */}
        <div className="p-4 border-t border-[var(--border)] flex gap-3">
          <input
            ref={inputRef}
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault()
                handleSend()
              }
            }}
            placeholder="Ask about courses..."
            className="flex-1 px-4 py-2.5 bg-[var(--bg-primary)] border border-[var(--border)] rounded-lg text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:outline-none focus:border-accent focus:ring-1 focus:ring-accent"
            disabled={isChatLoading}
          />
          <Button
            variant="primary"
            onClick={handleSend}
            disabled={!input.trim() || isChatLoading}
          >
            Send
          </Button>
        </div>
      </div>
    </>
  )
}
