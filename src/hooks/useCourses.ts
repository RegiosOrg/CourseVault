import { useCallback } from 'react'
import { useAppStore, Course } from '@/stores/appStore'
import { api } from '@/api/client'

export function useCourses() {
  const {
    courseData,
    selectedCourse,
    selectedVideo,
    expandedCourses,
    readCourses,
    searchQuery,
    sortOrder,
    showUnreadOnly,
    generatingCourses,
    setCourseData,
    selectCourse,
    selectVideo,
    toggleCourseExpanded,
    toggleCourseRead,
    setSearchQuery,
    setSortOrder,
    setShowUnreadOnly,
    startGeneration,
    deleteCourse: deleteCourseFromStore,
    setIsLoading,
    setError
  } = useAppStore()

  // Load courses on mount
  const loadCourses = useCallback(async () => {
    setIsLoading(true)
    setError(null)
    try {
      const data = await api.fetchCourseData()
      setCourseData(data)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load courses')
    } finally {
      setIsLoading(false)
    }
  }, [setCourseData, setIsLoading, setError])

  // Filter and sort courses
  const getFilteredCourses = useCallback((): Course[] => {
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

  // Delete a course
  const deleteCourse = useCallback(async (courseName: string): Promise<boolean> => {
    try {
      const result = await api.deleteCourse(courseName)
      if (result.success) {
        deleteCourseFromStore(courseName)
        return true
      }
      return false
    } catch (err) {
      throw err
    }
  }, [deleteCourseFromStore])

  // Generate summaries for a course
  const generateSummaries = useCallback(async (courseName: string): Promise<void> => {
    try {
      await api.generateSummary(courseName)
      startGeneration(courseName)
    } catch (err) {
      throw err
    }
  }, [startGeneration])

  // Generate summaries for all courses that need them
  const generateAllSummaries = useCallback(async (): Promise<number> => {
    if (!courseData) return 0

    const needsSummary = courseData.courses.filter(c =>
      c.videos.some(v => !v.has_summary)
    )

    for (const course of needsSummary) {
      try {
        await api.generateSummary(course.name)
        startGeneration(course.name)
      } catch (err) {
        console.error(`Failed to queue ${course.name}:`, err)
      }
    }

    return needsSummary.length
  }, [courseData, startGeneration])

  // Get stats
  const getStats = useCallback(() => {
    if (!courseData) return { totalCourses: 0, totalVideos: 0, readCount: 0 }

    return {
      totalCourses: courseData.courses.length,
      totalVideos: courseData.total_videos,
      readCount: readCourses.size
    }
  }, [courseData, readCourses])

  // Check if a course is expanded
  const isCourseExpanded = useCallback((courseName: string) => {
    return expandedCourses.has(courseName)
  }, [expandedCourses])

  // Check if a course is read
  const isCourseRead = useCallback((courseName: string) => {
    return readCourses.has(courseName)
  }, [readCourses])

  // Check if a course is generating
  const isCourseGenerating = useCallback((courseName: string) => {
    return generatingCourses.has(courseName)
  }, [generatingCourses])

  return {
    // Data
    courseData,
    selectedCourse,
    selectedVideo,
    filteredCourses: getFilteredCourses(),
    stats: getStats(),

    // Filters
    searchQuery,
    sortOrder,
    showUnreadOnly,
    setSearchQuery,
    setSortOrder,
    setShowUnreadOnly,

    // Actions
    loadCourses,
    selectCourse,
    selectVideo,
    toggleCourseExpanded,
    toggleCourseRead,
    deleteCourse,
    generateSummaries,
    generateAllSummaries,

    // Helpers
    isCourseExpanded,
    isCourseRead,
    isCourseGenerating
  }
}
