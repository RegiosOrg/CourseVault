import { useState, useRef } from 'react'
import { useAppStore, Course, Video } from '@/stores/appStore'
import { api } from '@/api/client'
import { useToast } from '@/components/ui/Toast'
import { Badge } from '@/components/ui/Badge'
import { ConfirmDialog } from '@/components/ui/Modal'
import { Spinner } from '@/components/ui/Progress'

interface CourseCardProps {
  course: Course
}

export default function CourseCard({ course }: CourseCardProps) {
  const {
    expandedCourses,
    readCourses,
    selectedCourse,
    selectedVideo,
    generatingCourses,
    generationStatus,
    toggleCourseExpanded,
    toggleCourseRead,
    selectCourse,
    selectVideo,
    startGeneration,
    deleteCourse: deleteCourseFromStore
  } = useAppStore()

  const toast = useToast()
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false)
  const [isDeleting, setIsDeleting] = useState(false)
  const deleteAbortController = useRef<AbortController | null>(null)

  const isExpanded = expandedCourses.has(course.name)
  const isRead = readCourses.has(course.name)
  const isGenerating = generatingCourses.has(course.name)
  const isSelected = selectedCourse?.name === course.name

  const summaryCount = course.videos.filter(v => v.has_summary).length
  const needsSummaries = summaryCount < course.videos.length

  // Get generation progress for this course
  const generationProgress = generationStatus?.current?.course === course.name
    ? generationStatus.current
    : null

  // Handle course click (toggle expand AND load summary)
  const handleCourseClick = () => {
    // If already selected and expanded, collapse
    if (isSelected && isExpanded) {
      toggleCourseExpanded(course.name)
    } else {
      // Select course and expand if not expanded
      selectCourse(course)
      selectVideo(null)
      if (!isExpanded) {
        toggleCourseExpanded(course.name)
      }
    }
  }

  // Handle video click
  const handleVideoClick = (video: Video) => {
    selectCourse(course)
    selectVideo(video)
  }

  // Handle delete
  const handleDelete = async () => {
    setIsDeleting(true)
    deleteAbortController.current = new AbortController()

    try {
      const result = await api.deleteCourse(course.name, deleteAbortController.current.signal)
      const deleted = []
      if (result.deleted_source) deleted.push('source videos')
      if (result.deleted_transcript) deleted.push('transcripts')
      toast.success(`Deleted ${course.name} (${deleted.join(' and ')})`)
      deleteCourseFromStore(course.name)
      setShowDeleteConfirm(false)
    } catch (err) {
      if (err instanceof Error && err.message.includes('cancelled')) {
        toast.info('Delete cancelled')
      } else {
        toast.error(`Delete failed: ${err instanceof Error ? err.message : 'Unknown error'}`)
      }
    } finally {
      setIsDeleting(false)
      deleteAbortController.current = null
    }
  }

  // Handle cancel delete
  const handleCancelDelete = () => {
    if (deleteAbortController.current) {
      deleteAbortController.current.abort()
    }
    setShowDeleteConfirm(false)
    setIsDeleting(false)
  }

  // Handle generate summaries
  const handleGenerate = async () => {
    // Check if LLM backend is configured
    const llmBackend = useAppStore.getState().llmBackend
    if (!llmBackend) {
      toast.error('No LLM backend configured. Go to Settings → AI Models to set one up.')
      return
    }

    try {
      toast.info(`Queuing ${course.name} for summary generation...`)
      const result = await api.generateSummary(course.name)

      if (result.error) {
        toast.error(`Generation error: ${result.error}`)
        return
      }

      startGeneration(course.name)

      if (result.position && result.position > 1) {
        toast.info(`Queued ${course.name} (position ${result.position} in queue)`)
      } else {
        toast.success(`Started generating summaries for ${course.name}`)
      }
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : 'Unknown error'
      toast.error(`Failed to start generation: ${errorMsg}`)
      console.error('Generation error:', err)
    }
  }

  return (
    <>
      <div
        className={`
          bg-[var(--bg-secondary)] border border-[var(--border)] rounded-lg overflow-hidden
          ${isRead ? 'bg-green-900/10 dark:bg-green-900/20' : ''}
        `}
      >
        {/* Course header */}
        <div className="p-3 bg-[var(--bg-tertiary)] flex items-center gap-3">
          {/* Course info - clickable */}
          <div
            className="flex-1 cursor-pointer hover:opacity-80"
            onClick={handleCourseClick}
          >
            <div className="font-medium text-accent">{course.name}</div>
            <div className="text-xs text-[var(--text-muted)] flex items-center gap-2">
              <span>{course.videos.length} videos</span>
              {needsSummaries && (
                <span>· {summaryCount}/{course.videos.length} summarized</span>
              )}
              {isGenerating && (
                <span className="flex items-center gap-1 text-accent">
                  {generationProgress && generationProgress.status !== 'failed' ? (
                    // Actively processing - show spinner
                    <>
                      <Spinner size="sm" />
                      {generationProgress.total > 0
                        ? `${Math.round((generationProgress.progress / generationProgress.total) * 100)}%`
                        : 'Starting...'
                      }
                    </>
                  ) : generationProgress?.status === 'failed' ? (
                    // Failed
                    <span className="text-error">Failed</span>
                  ) : (
                    // Queued - static icon
                    <span className="text-[var(--text-muted)]">⏳ Queued</span>
                  )}
                </span>
              )}
            </div>
          </div>

          {/* Actions */}
          <div className="flex items-center gap-2">
            {/* Generate button */}
            {needsSummaries && !isGenerating && (
              <button
                onClick={(e) => {
                  e.stopPropagation()
                  handleGenerate()
                }}
                className="p-1.5 text-[var(--text-muted)] hover:text-accent hover:bg-[var(--border)] rounded transition-colors"
                title="Generate summaries"
              >
                🤖
              </button>
            )}

            {/* Delete button */}
            <button
              onClick={(e) => {
                e.stopPropagation()
                setShowDeleteConfirm(true)
              }}
              className="p-1.5 text-[var(--text-muted)] hover:text-error hover:bg-error/10 rounded transition-colors"
              title="Delete course"
            >
              ×
            </button>

            {/* Read toggle */}
            <button
              onClick={(e) => {
                e.stopPropagation()
                toggleCourseRead(course.name)
              }}
              className={`
                w-5 h-5 rounded-full border-2 flex items-center justify-center text-xs
                transition-colors
                ${isRead
                  ? 'bg-success border-success text-white'
                  : 'border-[var(--text-muted)] text-transparent hover:border-accent'
                }
              `}
              title={isRead ? 'Mark as unread' : 'Mark as read'}
            >
              ✓
            </button>

            {/* Date */}
            {course.date && (
              <span className="text-xs text-[var(--text-muted)] whitespace-nowrap">
                {course.date}
              </span>
            )}

            {/* Expand toggle */}
            <button
              onClick={(e) => {
                e.stopPropagation()
                toggleCourseExpanded(course.name)
              }}
              className="p-1 text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors"
            >
              <span className={`inline-block transition-transform ${isExpanded ? 'rotate-90' : ''}`}>
                ▶
              </span>
            </button>
          </div>
        </div>

        {/* Video list */}
        {isExpanded && (
          <div className="max-h-[300px] overflow-y-auto">
            {course.videos.map((video, idx) => (
              <div
                key={`${video.name}-${idx}`}
                onClick={() => handleVideoClick(video)}
                className={`
                  px-3 py-2.5 border-b border-[var(--bg-tertiary)] last:border-b-0
                  cursor-pointer transition-colors
                  ${selectedVideo?.name === video.name && selectedCourse?.name === course.name
                    ? 'bg-accent/10 border-l-2 border-l-accent'
                    : 'hover:bg-[var(--bg-tertiary)]'
                  }
                `}
              >
                <div className="flex items-center justify-between">
                  <span className="text-sm text-[var(--text-primary)]">{video.name}</span>
                  {video.has_summary && (
                    <Badge variant="success">Summary</Badge>
                  )}
                </div>
                {video.summary && (
                  <p className="text-xs text-[var(--text-muted)] mt-1 line-clamp-2">
                    {video.summary.substring(0, 100)}...
                  </p>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Delete confirmation dialog */}
      <ConfirmDialog
        isOpen={showDeleteConfirm}
        onClose={handleCancelDelete}
        onConfirm={handleDelete}
        title="Delete Course"
        message={`Delete "${course.name}"? This will remove source videos and transcripts. This action cannot be undone.`}
        confirmText="Delete"
        variant="danger"
        isLoading={isDeleting}
        canCancelWhileLoading={true}
      />
    </>
  )
}
