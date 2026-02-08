import { useMemo } from 'react'
import { useAppStore, Course } from '@/stores/appStore'
import { api } from '@/api/client'
import { useToast } from '@/components/ui/Toast'
import { SearchInput } from '@/components/ui/Input'
import CourseCard from '@/components/CourseCard'

interface SidebarProps {
  courses: Course[]
}

export default function Sidebar({ courses }: SidebarProps) {
  const {
    courseData,
    searchQuery,
    sortOrder,
    showUnreadOnly,
    readCourses,
    setSearchQuery,
    setSortOrder,
    setShowUnreadOnly,
    startGeneration
  } = useAppStore()

  const toast = useToast()

  // Stats
  const stats = useMemo(() => {
    if (!courseData) return { courses: 0, videos: 0, unread: 0 }
    const unread = courseData.courses.filter(c => !readCourses.has(c.name)).length
    return {
      courses: courseData.courses.length,
      videos: courseData.total_videos,
      unread
    }
  }, [courseData, readCourses])

  // Generate all summaries
  const handleGenerateAll = async () => {
    const needsSummary = courses.filter(c =>
      c.videos.some(v => !v.has_summary)
    )

    if (needsSummary.length === 0) {
      toast.success('All courses already have summaries!')
      return
    }

    toast.info(`Queuing ${needsSummary.length} courses for summary generation...`)

    for (const course of needsSummary) {
      try {
        await api.generateSummary(course.name)
        startGeneration(course.name)
      } catch (err) {
        toast.error(`Failed to queue ${course.name}`)
      }
    }
  }

  return (
    <div className="w-full flex flex-col border-r border-[var(--border)] h-screen">
      {/* Header */}
      <header className="flex-shrink-0 bg-[var(--bg-secondary)] p-4 border-b border-[var(--border)]">
        {/* Logo */}
        <h1
          className="text-xl font-semibold text-accent mb-3 cursor-pointer hover:opacity-80"
          onClick={() => {
            setSearchQuery('')
            useAppStore.getState().selectCourse(null)
          }}
        >
          📚 Course Library
        </h1>

        {/* Search */}
        <SearchInput
          id="search-input"
          placeholder="Search courses... (Ctrl+K)"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          onClear={() => setSearchQuery('')}
          autoFocus
        />

        {/* Stats */}
        <p className="text-xs text-[var(--text-muted)] mt-2">
          {searchQuery
            ? `Showing ${courses.length} of ${stats.courses} courses`
            : `${stats.courses} courses · ${stats.unread} unread · ${stats.videos} videos`
          }
        </p>

        {/* Controls - all on one row */}
        <div className="flex items-center gap-2 mt-3">
          {/* Sort dropdown - compact */}
          <select
            value={sortOrder}
            onChange={(e) => setSortOrder(e.target.value as any)}
            className="px-2 py-1.5 text-xs bg-[var(--bg-primary)] border border-[var(--border)] rounded text-[var(--text-primary)] focus:outline-none focus:border-accent cursor-pointer"
          >
            <option value="alpha">A-Z</option>
            <option value="newest">Newest</option>
            <option value="oldest">Oldest</option>
          </select>

          {/* Unread only checkbox - compact inline */}
          <label className="flex items-center gap-1.5 text-xs text-[var(--text-muted)] cursor-pointer hover:text-[var(--text-primary)]">
            <input
              type="checkbox"
              checked={showUnreadOnly}
              onChange={(e) => setShowUnreadOnly(e.target.checked)}
              className="w-3.5 h-3.5 rounded border-[var(--border)] text-accent focus:ring-accent focus:ring-offset-0 cursor-pointer"
            />
            <span>Unread</span>
          </label>

          {/* Generate All button - compact */}
          <button
            onClick={handleGenerateAll}
            className="ml-auto px-2.5 py-1.5 text-xs font-medium bg-accent text-white rounded hover:bg-[var(--accent-hover)] transition-colors flex items-center gap-1"
            title="Generate AI summaries for all courses"
          >
            <span>🤖</span>
            <span>Generate</span>
          </button>
        </div>
      </header>

      {/* Course list */}
      <div className="flex-1 overflow-y-auto p-2.5">
        {courses.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-center p-6">
            <div className="text-4xl mb-3">🔍</div>
            <p className="text-[var(--text-muted)]">No courses found</p>
            {searchQuery && (
              <button
                onClick={() => setSearchQuery('')}
                className="text-accent text-sm mt-2 hover:underline"
              >
                Clear search
              </button>
            )}
          </div>
        ) : (
          <div className="space-y-2.5">
            {courses.map((course) => (
              <CourseCard key={course.name} course={course} />
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
