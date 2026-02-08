import { useMemo, useRef, useEffect } from 'react'
import DOMPurify from 'dompurify'
import { useAppStore } from '@/stores/appStore'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/Tabs'

export default function ContentViewer() {
  const {
    selectedCourse,
    selectedVideo,
    contentTab,
    setContentTab
  } = useAppStore()

  const scrollContainerRef = useRef<HTMLDivElement>(null)

  // Reset scroll position when course or video changes
  useEffect(() => {
    if (scrollContainerRef.current) {
      scrollContainerRef.current.scrollTop = 0
    }
  }, [selectedCourse?.name, selectedVideo?.name])

  // Format markdown to HTML with proper styling
  const formatMarkdown = (text: string) => {
    if (!text) return ''

    let html = text
      // Remove YAML frontmatter
      .replace(/^---[\s\S]*?---\s*/m, '')
      // Headers - h1
      .replace(/^# (.+)$/gm, '<h1>$1</h1>')
      // Headers - h2
      .replace(/^## (.+)$/gm, '<h2>$1</h2>')
      // Headers - h3
      .replace(/^### (.+)$/gm, '<h3>$1</h3>')
      // Bold
      .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
      // Italic
      .replace(/\*([^*]+)\*/g, '<em>$1</em>')
      // Code inline
      .replace(/`([^`]+)`/g, '<code>$1</code>')
      // Horizontal rules
      .replace(/^---$/gm, '<hr>')
      // Lists - unordered
      .replace(/^- (.+)$/gm, '<li class="ul-item">$1</li>')
      // Lists - ordered
      .replace(/^\d+\. (.+)$/gm, '<li class="ol-item">$1</li>')

    // Wrap consecutive ul li elements
    html = html.replace(/(<li class="ul-item">.*?<\/li>\s*)+/g, (match) => {
      return `<ul>${match}</ul>`
    })

    // Wrap consecutive ol li elements
    html = html.replace(/(<li class="ol-item">.*?<\/li>\s*)+/g, (match) => {
      return `<ol>${match}</ol>`
    })

    // Clean up li classes
    html = html.replace(/class="ul-item"/g, '')
    html = html.replace(/class="ol-item"/g, '')

    // Paragraphs - wrap text that's not already in a block element
    html = html.split(/\n\n+/).map(p => {
      p = p.trim()
      if (!p) return ''
      if (p.startsWith('<h') || p.startsWith('<ul') || p.startsWith('<ol') || p.startsWith('<hr') || p.startsWith('<blockquote')) {
        return p
      }
      return `<p>${p.replace(/\n/g, '<br>')}</p>`
    }).join('\n')

    return html
  }

  // Rendered content (sanitized to prevent XSS)
  const summaryHtml = useMemo(() => {
    let raw = ''
    if (selectedVideo?.full_summary) {
      raw = formatMarkdown(selectedVideo.full_summary)
    } else if (selectedVideo?.summary) {
      raw = `<p>${selectedVideo.summary}</p>`
    } else if (!selectedVideo && selectedCourse?.full_summary) {
      raw = formatMarkdown(selectedCourse.full_summary)
    }
    return raw ? DOMPurify.sanitize(raw) : ''
  }, [selectedCourse, selectedVideo])

  // Empty state - centered in the content area
  if (!selectedCourse) {
    return (
      <div className="h-full flex items-center justify-center bg-[var(--bg-primary)]">
        <div className="text-center">
          <div className="text-6xl mb-6 opacity-60">📖</div>
          <h3 className="text-lg font-medium text-[var(--text-primary)] mb-2">Select a course</h3>
          <p className="text-[var(--text-muted)]">Click any course in the sidebar to view its content</p>
        </div>
      </div>
    )
  }

  return (
    <div className="h-full flex flex-col bg-[var(--bg-primary)] overflow-hidden">
      {/* Header */}
      <div className="flex-shrink-0 bg-[var(--bg-secondary)] px-6 py-4 border-b border-[var(--border)]">
        <h2 className="text-lg font-semibold text-[var(--text-primary)]">
          {selectedVideo?.name || selectedCourse.name}
        </h2>
        <p className="text-sm text-[var(--text-muted)] mt-0.5">
          {selectedVideo ? selectedCourse.name : 'Course Overview'}
        </p>
      </div>

      {/* Tabs (only for videos) */}
      {selectedVideo && (
        <Tabs
          value={contentTab}
          onValueChange={(v) => setContentTab(v as any)}
          className="flex-shrink-0"
        >
          <TabsList className="px-6">
            <TabsTrigger value="summary">Summary</TabsTrigger>
            <TabsTrigger value="transcript">Transcript</TabsTrigger>
          </TabsList>
        </Tabs>
      )}

      {/* Content */}
      <div ref={scrollContainerRef} className="flex-1 overflow-y-auto min-h-0">
        <div className="p-8 pb-16 max-w-4xl">
          {selectedVideo ? (
            // Video content
            contentTab === 'summary' ? (
              summaryHtml ? (
                <article
                  className="content-prose animate-in"
                  dangerouslySetInnerHTML={{ __html: summaryHtml }}
                />
              ) : (
                <div className="text-center py-12">
                  <div className="text-4xl mb-4 opacity-50">📝</div>
                  <p className="text-[var(--text-muted)] mb-3">No summary available</p>
                  <p className="text-sm text-[var(--text-muted)]">
                    Generate summaries with: <code className="bg-[var(--bg-tertiary)] px-2 py-1 rounded text-[var(--text-primary)]">python main.py summaries --all</code>
                  </p>
                </div>
              )
            ) : (
              // Transcript
              selectedVideo.transcript ? (
                <div className="content-prose animate-in">
                  <pre className="whitespace-pre-wrap text-[var(--text-body)] leading-[1.8] font-[inherit] text-[0.95rem]">
                    {selectedVideo.transcript}
                  </pre>
                </div>
              ) : (
                <div className="text-center py-12">
                  <div className="text-4xl mb-4 opacity-50">📄</div>
                  <p className="text-[var(--text-muted)]">Transcript not available</p>
                </div>
              )
            )
          ) : (
            // Course summary
            summaryHtml ? (
              <article
                className="content-prose animate-in"
                dangerouslySetInnerHTML={{ __html: summaryHtml }}
              />
            ) : (
              <div className="text-center py-12">
                <div className="text-4xl mb-4 opacity-50">📚</div>
                <p className="text-[var(--text-muted)] mb-3">No course summary available yet</p>
                <p className="text-sm text-[var(--text-muted)]">
                  Generate course summaries with: <code className="bg-[var(--bg-tertiary)] px-2 py-1 rounded text-[var(--text-primary)]">python main.py course --all</code>
                </p>
              </div>
            )
          )}
        </div>
      </div>
    </div>
  )
}
