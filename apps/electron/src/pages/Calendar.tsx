import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { ChevronLeft, ChevronRight, Mic, RefreshCw, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Switch } from '@/components/ui/switch'
import { useAppStore } from '@/store/useAppStore'
import { cn, formatTime, getWeekDates, isToday } from '@/lib/utils'
import type { Meeting, Recording } from '@/types'
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip'

// Extended meeting type that includes recording match info
interface CalendarMeeting extends Meeting {
  hasRecording: boolean
  isPlaceholder: boolean // True for auto-generated meetings from orphan recordings
  matchedRecordingId?: string
}

const HOUR_HEIGHT = 60 // pixels per hour
const START_HOUR = 7 // 7 AM
const END_HOUR = 21 // 9 PM
const HOURS = Array.from({ length: END_HOUR - START_HOUR }, (_, i) => START_HOUR + i)

// Calendar view types
type CalendarViewType = 'day' | 'workweek' | 'week' | 'month'

// Get dates for workweek (Mon-Fri)
function getWorkweekDates(date: Date): Date[] {
  const dates = getWeekDates(date)
  // Return Mon-Fri (indices 1-5 from Sunday-based week)
  return dates.slice(1, 6)
}

// Get single day
function getDayDates(date: Date): Date[] {
  return [new Date(date)]
}

// Get all dates for a month view (including padding from prev/next months)
function getMonthDates(date: Date): Date[] {
  const year = date.getFullYear()
  const month = date.getMonth()

  // First day of the month
  const firstDay = new Date(year, month, 1)
  // Last day of the month
  const lastDay = new Date(year, month + 1, 0)

  // Start from the Sunday before (or on) the first day
  const startDate = new Date(firstDay)
  startDate.setDate(startDate.getDate() - startDate.getDay())

  // End on the Saturday after (or on) the last day
  const endDate = new Date(lastDay)
  if (endDate.getDay() !== 6) {
    endDate.setDate(endDate.getDate() + (6 - endDate.getDay()))
  }

  const dates: Date[] = []
  const current = new Date(startDate)
  while (current <= endDate) {
    dates.push(new Date(current))
    current.setDate(current.getDate() + 1)
  }

  return dates
}

// Calculate overlapping positions for meetings in a day
// Returns meetings with their column index and total columns for that overlap group
function calculateMeetingColumns(meetings: CalendarMeeting[]): Array<CalendarMeeting & { column: number; totalColumns: number }> {
  if (meetings.length === 0) return []

  // Sort by start time
  const sorted = [...meetings].sort((a, b) =>
    new Date(a.start_time).getTime() - new Date(b.start_time).getTime()
  )

  const result: Array<CalendarMeeting & { column: number; totalColumns: number }> = []
  const columns: Array<{ end: number; meeting: CalendarMeeting }[]> = []

  for (const meeting of sorted) {
    const start = new Date(meeting.start_time).getTime()
    const end = new Date(meeting.end_time).getTime()

    // Find the first column where this meeting fits (no overlap)
    let columnIndex = 0
    let placed = false

    for (let i = 0; i < columns.length; i++) {
      // Check if all meetings in this column end before this one starts
      const canFit = columns[i].every(m => m.end <= start)
      if (canFit) {
        columnIndex = i
        placed = true
        break
      }
    }

    if (!placed) {
      // Need a new column
      columnIndex = columns.length
      columns.push([])
    }

    columns[columnIndex].push({ end, meeting })
    result.push({ ...meeting, column: columnIndex, totalColumns: 1 }) // totalColumns updated later
  }

  // Now calculate the actual number of overlapping columns for each meeting
  for (const item of result) {
    const itemStart = new Date(item.start_time).getTime()
    const itemEnd = new Date(item.end_time).getTime()

    // Find all meetings that overlap with this one
    let maxColumn = item.column
    for (const other of result) {
      const otherStart = new Date(other.start_time).getTime()
      const otherEnd = new Date(other.end_time).getTime()

      // Check if they overlap
      if (itemStart < otherEnd && itemEnd > otherStart) {
        maxColumn = Math.max(maxColumn, other.column)
      }
    }

    item.totalColumns = maxColumn + 1
  }

  return result
}

// Match recordings to meetings by time overlap
// A recording matches a meeting if it starts within the meeting's time range
// (with 15 min buffer before and after for flexibility)
function matchRecordingsToMeetings(
  meetings: Meeting[],
  recordings: Recording[]
): { calendarMeetings: CalendarMeeting[]; orphanRecordings: Recording[] } {
  const matchedRecordingIds = new Set<string>()
  const calendarMeetings: CalendarMeeting[] = []

  for (const meeting of meetings) {
    const meetingStart = new Date(meeting.start_time).getTime()
    const meetingEnd = new Date(meeting.end_time).getTime()
    // 15 minute buffer on each side
    const bufferMs = 15 * 60 * 1000

    // Find recordings that overlap with this meeting
    const matchingRecording = recordings.find((rec) => {
      const recTime = new Date(rec.date_recorded).getTime()
      // Recording starts within meeting time (with buffer)
      return recTime >= meetingStart - bufferMs && recTime <= meetingEnd + bufferMs
    })

    if (matchingRecording) {
      matchedRecordingIds.add(matchingRecording.id)
      calendarMeetings.push({
        ...meeting,
        hasRecording: true,
        isPlaceholder: false,
        matchedRecordingId: matchingRecording.id
      })
    } else {
      calendarMeetings.push({
        ...meeting,
        hasRecording: false,
        isPlaceholder: false
      })
    }
  }

  // Find orphan recordings (not matched to any meeting)
  const orphanRecordings = recordings.filter((rec) => !matchedRecordingIds.has(rec.id))

  return { calendarMeetings, orphanRecordings }
}

// Create placeholder meetings from orphan recordings
function createPlaceholderMeetings(orphanRecordings: Recording[]): CalendarMeeting[] {
  return orphanRecordings.map((rec) => {
    const recDate = new Date(rec.date_recorded)
    const durationMs = (rec.duration_seconds || 30 * 60) * 1000 // Default 30 min if no duration
    const endDate = new Date(recDate.getTime() + durationMs)

    return {
      id: `placeholder_${rec.id}`,
      subject: rec.original_filename || rec.filename || 'Recording',
      start_time: recDate.toISOString(),
      end_time: endDate.toISOString(),
      is_recurring: 0,
      created_at: rec.created_at,
      updated_at: rec.created_at,
      hasRecording: true,
      isPlaceholder: true,
      matchedRecordingId: rec.id
    }
  })
}

// Meeting tooltip content component
function MeetingTooltipContent({ meeting }: { meeting: CalendarMeeting }) {
  const startTime = new Date(meeting.start_time)
  const endTime = new Date(meeting.end_time)
  const duration = Math.round((endTime.getTime() - startTime.getTime()) / (1000 * 60))
  const hours = Math.floor(duration / 60)
  const mins = duration % 60
  const durationStr = hours > 0 ? `${hours}h ${mins}m` : `${mins}m`

  return (
    <div className="space-y-2 max-w-[280px]">
      <div className="font-semibold text-foreground">{meeting.subject}</div>
      <div className="text-xs space-y-1">
        <div className="flex items-center gap-2">
          <span className="text-muted-foreground">Time:</span>
          <span>{formatTime(meeting.start_time)} - {formatTime(meeting.end_time)}</span>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-muted-foreground">Duration:</span>
          <span>{durationStr}</span>
        </div>
        {meeting.hasRecording && (
          <div className="flex items-center gap-2 text-green-600 dark:text-green-400">
            <Mic className="h-3 w-3" />
            <span>{meeting.isPlaceholder ? 'Recording (no calendar event)' : 'Has recording'}</span>
          </div>
        )}
        {meeting.location && (
          <div className="flex items-center gap-2">
            <span className="text-muted-foreground">Location:</span>
            <span className="truncate">{meeting.location}</span>
          </div>
        )}
        {meeting.organizer && (
          <div className="flex items-center gap-2">
            <span className="text-muted-foreground">Organizer:</span>
            <span className="truncate">{meeting.organizer}</span>
          </div>
        )}
      </div>
      <div className="text-xs text-muted-foreground pt-1 border-t">
        Click for details
      </div>
    </div>
  )
}

export function Calendar() {
  const navigate = useNavigate()
  const scrollContainerRef = useRef<HTMLDivElement>(null)
  const {
    meetings,
    recordings,
    currentDate,
    calendarView,
    meetingsLoading,
    navigateWeek,
    navigateMonth,
    goToToday,
    setCalendarView,
    loadMeetings,
    lastCalendarSync: lastSync,
    syncCalendar,
    calendarSyncing,
    config,
    loadConfig,
    updateConfig
  } = useAppStore()

  // Local state for auto-sync toggle
  const [autoSyncEnabled, setAutoSyncEnabled] = useState(true)

  // Load config on mount
  useEffect(() => {
    loadConfig()
  }, [loadConfig])

  // Sync autoSyncEnabled with config
  useEffect(() => {
    if (config?.calendar) {
      setAutoSyncEnabled(config.calendar.syncEnabled)
    }
  }, [config?.calendar?.syncEnabled])

  // Load meetings when date or view changes
  useEffect(() => {
    let startDate: string
    let endDate: string

    if (calendarView === 'month') {
      // For month view, load the full month (including padding dates)
      const dates = getMonthDates(currentDate)
      startDate = dates[0].toISOString()
      const lastDate = new Date(dates[dates.length - 1])
      lastDate.setHours(23, 59, 59, 999)
      endDate = lastDate.toISOString()
    } else if (calendarView === 'day') {
      // For day view
      const dayStart = new Date(currentDate)
      dayStart.setHours(0, 0, 0, 0)
      const dayEnd = new Date(currentDate)
      dayEnd.setHours(23, 59, 59, 999)
      startDate = dayStart.toISOString()
      endDate = dayEnd.toISOString()
    } else if (calendarView === 'workweek') {
      // For workweek view (Mon-Fri)
      const dates = getWorkweekDates(currentDate)
      startDate = dates[0].toISOString()
      const lastDate = new Date(dates[dates.length - 1])
      lastDate.setHours(23, 59, 59, 999)
      endDate = lastDate.toISOString()
    } else {
      // For week view
      const dates = getWeekDates(currentDate)
      startDate = dates[0].toISOString()
      const lastDate = new Date(dates[6])
      lastDate.setHours(23, 59, 59, 999)
      endDate = lastDate.toISOString()
    }

    loadMeetings(startDate, endDate)
  }, [currentDate, calendarView, loadMeetings])

  // Scroll to current hour on mount
  useEffect(() => {
    if (scrollContainerRef.current) {
      const now = new Date()
      const currentHour = now.getHours()
      const scrollPosition = Math.max(0, (currentHour - START_HOUR - 1) * HOUR_HEIGHT)
      scrollContainerRef.current.scrollTop = scrollPosition
    }
  }, [])

  // Get dates for current view
  const viewDates = useMemo(() => {
    switch (calendarView) {
      case 'day':
        return getDayDates(currentDate)
      case 'workweek':
        return getWorkweekDates(currentDate)
      case 'week':
        return getWeekDates(currentDate)
      case 'month':
        return getMonthDates(currentDate)
    }
  }, [currentDate, calendarView])

  const weekDates = useMemo(() => getWeekDates(currentDate), [currentDate])
  const monthDates = useMemo(() => getMonthDates(currentDate), [currentDate])

  // Match recordings to meetings and create placeholders for orphan recordings
  const { calendarMeetings, orphanRecordings } = useMemo(() => {
    return matchRecordingsToMeetings(meetings, recordings)
  }, [meetings, recordings])

  // Create placeholder meetings from orphan recordings
  const placeholderMeetings = useMemo(() => {
    return createPlaceholderMeetings(orphanRecordings)
  }, [orphanRecordings])

  // Combine real meetings with placeholders
  const allMeetings = useMemo(() => {
    return [...calendarMeetings, ...placeholderMeetings]
  }, [calendarMeetings, placeholderMeetings])

  // Group meetings by day (for day/workweek/week views)
  const meetingsByDay = useMemo(() => {
    const grouped: Record<string, CalendarMeeting[]> = {}

    for (const date of viewDates) {
      const key = date.toISOString().split('T')[0]
      grouped[key] = []
    }

    for (const meeting of allMeetings) {
      const meetingDate = new Date(meeting.start_time)
      const key = meetingDate.toISOString().split('T')[0]
      if (grouped[key]) {
        grouped[key].push(meeting)
      }
    }

    // Sort meetings by start time
    for (const key in grouped) {
      grouped[key].sort((a, b) => new Date(a.start_time).getTime() - new Date(b.start_time).getTime())
    }

    return grouped
  }, [allMeetings, viewDates])

  // Group meetings for month view
  const meetingsByMonth = useMemo(() => {
    const grouped: Record<string, CalendarMeeting[]> = {}

    for (const date of monthDates) {
      const key = date.toISOString().split('T')[0]
      grouped[key] = []
    }

    for (const meeting of allMeetings) {
      const meetingDate = new Date(meeting.start_time)
      const key = meetingDate.toISOString().split('T')[0]
      if (grouped[key]) {
        grouped[key].push(meeting)
      }
    }

    // Sort meetings by start time
    for (const key in grouped) {
      grouped[key].sort((a, b) => new Date(a.start_time).getTime() - new Date(b.start_time).getTime())
    }

    return grouped
  }, [allMeetings, monthDates])

  const handleMeetingClick = (meeting: Meeting) => {
    navigate(`/meeting/${meeting.id}`)
  }

  // Calculate meeting position and height
  const getMeetingStyle = (meeting: Meeting) => {
    const start = new Date(meeting.start_time)
    const end = new Date(meeting.end_time)

    const startHour = start.getHours() + start.getMinutes() / 60
    const endHour = end.getHours() + end.getMinutes() / 60

    const top = Math.max(0, (startHour - START_HOUR) * HOUR_HEIGHT)
    const height = Math.max(20, (endHour - startHour) * HOUR_HEIGHT - 2)

    return { top, height }
  }

  const monthYear = currentDate.toLocaleDateString('en-US', { month: 'long', year: 'numeric' })

  // Format last sync time
  const formatLastSync = () => {
    if (!lastSync) return null
    const syncDate = new Date(lastSync)
    return syncDate.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
  }

  // Handle auto-sync toggle
  const handleAutoSyncToggle = async (enabled: boolean) => {
    setAutoSyncEnabled(enabled)
    try {
      await window.electronAPI.calendar.toggleAutoSync(enabled)
      // Reload config to ensure we have the latest state
      loadConfig()
    } catch (error) {
      console.error('Failed to toggle auto-sync:', error)
      // Revert on error
      setAutoSyncEnabled(!enabled)
    }
  }

  return (
    <TooltipProvider delayDuration={300}>
    <div className="flex flex-col h-full">
      {/* Header */}
      <header className="flex items-center justify-between border-b px-6 py-4 flex-shrink-0">
        <div className="flex items-center gap-4">
          <h1 className="text-2xl font-bold">{monthYear}</h1>
          <div className="flex items-center gap-1">
            <Button
              variant="outline"
              size="icon"
              onClick={() => calendarView === 'month' ? navigateMonth('prev') : navigateWeek('prev')}
            >
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <Button variant="outline" size="sm" onClick={goToToday}>
              Today
            </Button>
            <Button
              variant="outline"
              size="icon"
              onClick={() => calendarView === 'month' ? navigateMonth('next') : navigateWeek('next')}
            >
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
        </div>

        <div className="flex items-center gap-4">
          {/* Sync status - consolidated single indicator */}
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            {calendarSyncing ? (
              <span className="flex items-center gap-1">
                <RefreshCw className="h-3 w-3 animate-spin" />
                Syncing...
              </span>
            ) : (
              <>
                {lastSync && <span>Synced {formatLastSync()}</span>}
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => syncCalendar()}
                  className="h-6 px-2"
                >
                  <RefreshCw className="h-3 w-3" />
                </Button>
              </>
            )}
            <Switch
              id="auto-sync-header"
              checked={autoSyncEnabled}
              onCheckedChange={handleAutoSyncToggle}
              className="scale-75"
            />
          </div>

          {/* View mode buttons */}
          <div className="flex items-center border rounded-md overflow-hidden">
            <Button
              variant={calendarView === 'day' ? 'default' : 'ghost'}
              size="sm"
              onClick={() => setCalendarView('day')}
              className="rounded-none border-0"
            >
              Day
            </Button>
            <Button
              variant={calendarView === 'workweek' ? 'default' : 'ghost'}
              size="sm"
              onClick={() => setCalendarView('workweek')}
              className="rounded-none border-0 border-l"
            >
              Work
            </Button>
            <Button
              variant={calendarView === 'week' ? 'default' : 'ghost'}
              size="sm"
              onClick={() => setCalendarView('week')}
              className="rounded-none border-0 border-l"
            >
              Week
            </Button>
            <Button
              variant={calendarView === 'month' ? 'default' : 'ghost'}
              size="sm"
              onClick={() => setCalendarView('month')}
              className="rounded-none border-0 border-l"
            >
              Month
            </Button>
          </div>
        </div>
      </header>

      {/* Calendar View */}
      {meetingsLoading ? (
        <div className="flex-1 flex items-center justify-center">
          <p className="text-muted-foreground">Loading meetings...</p>
        </div>
      ) : calendarView === 'month' ? (
        /* Month View */
        <div className="flex-1 flex flex-col min-h-0">
          {/* Day of Week Headers */}
          <div className="grid grid-cols-7 border-b flex-shrink-0">
            {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((day) => (
              <div key={day} className="text-center py-2 text-xs font-medium text-muted-foreground border-l first:border-l-0">
                {day}
              </div>
            ))}
          </div>

          {/* Month Grid */}
          <div className="flex-1 overflow-auto">
            <div className="grid grid-cols-7 h-full" style={{ gridAutoRows: 'minmax(100px, 1fr)' }}>
              {monthDates.map((date) => {
                const key = date.toISOString().split('T')[0]
                const dayMeetings = meetingsByMonth[key] || []
                const today = isToday(date)
                const isCurrentMonth = date.getMonth() === currentDate.getMonth()

                return (
                  <div
                    key={key}
                    className={cn(
                      'border-l border-b first:border-l-0 p-1 min-h-[100px]',
                      !isCurrentMonth && 'bg-muted/30',
                      today && 'bg-primary/5'
                    )}
                  >
                    {/* Date Number */}
                    <div className={cn(
                      'text-sm font-medium mb-1',
                      !isCurrentMonth && 'text-muted-foreground',
                      today && 'bg-primary text-primary-foreground rounded-full w-6 h-6 flex items-center justify-center'
                    )}>
                      {date.getDate()}
                    </div>

                    {/* Meetings for this day */}
                    <div className="space-y-1">
                      {dayMeetings.slice(0, 3).map((meeting) => (
                        <button
                          key={meeting.id}
                          onClick={() => handleMeetingClick(meeting)}
                          className={cn(
                            'w-full text-left text-xs p-1 rounded truncate transition-colors',
                            'hover:ring-1 hover:ring-ring',
                            // Green for meetings with recordings
                            meeting.hasRecording && !meeting.isPlaceholder && 'bg-green-100 text-green-800 dark:bg-green-900/50 dark:text-green-300',
                            // Placeholder meetings (from orphan recordings)
                            meeting.isPlaceholder && 'bg-amber-100 text-amber-800 dark:bg-amber-900/50 dark:text-amber-300 border-dashed border border-amber-300',
                            // Grey/faint for meetings without recordings
                            !meeting.hasRecording && !meeting.isPlaceholder && 'bg-gray-100 text-gray-500 dark:bg-gray-800/50 dark:text-gray-400 opacity-60'
                          )}
                        >
                          <span className="flex items-center gap-1">
                            {meeting.hasRecording && <Mic className="h-3 w-3 flex-shrink-0" />}
                            <span className="truncate">{meeting.subject}</span>
                          </span>
                        </button>
                      ))}
                      {dayMeetings.length > 3 && (
                        <div className="text-xs text-muted-foreground pl-1">
                          +{dayMeetings.length - 3} more
                        </div>
                      )}
                    </div>
                  </div>
                )
              })}
            </div>
          </div>

        </div>
      ) : (
        /* Day/Workweek/Week View */
        <div className="flex-1 flex flex-col min-h-0">
          {/* Day Headers - properly aligned with time column */}
          <div className="flex border-b flex-shrink-0">
            <div className="w-14 flex-shrink-0 border-r" /> {/* Time column spacer - matches time labels width */}
            {viewDates.map((date) => {
              const key = date.toISOString().split('T')[0]
              const today = isToday(date)

              return (
                <div
                  key={key}
                  className={cn(
                    'flex-1 text-center py-3 border-l first:border-l-0',
                    today && 'bg-primary/5'
                  )}
                >
                  <div className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                    {date.toLocaleDateString('en-US', { weekday: calendarView === 'day' ? 'long' : 'short' })}
                  </div>
                  <div
                    className={cn(
                      'text-xl font-semibold mt-1',
                      today && 'bg-primary text-primary-foreground rounded-full w-8 h-8 flex items-center justify-center mx-auto'
                    )}
                  >
                    {date.getDate()}
                  </div>
                </div>
              )
            })}
          </div>

          {/* Time Grid */}
          <div ref={scrollContainerRef} className="flex-1 overflow-auto">
            <div className="flex min-h-full">
              {/* Time Labels */}
              <div className="w-14 flex-shrink-0 border-r bg-background">
                {HOURS.map((hour) => (
                  <div
                    key={hour}
                    className="relative"
                    style={{ height: HOUR_HEIGHT }}
                  >
                    <span className="absolute -top-2 right-2 text-xs text-muted-foreground font-medium">
                      {hour === 12 ? '12 PM' : hour > 12 ? `${hour - 12} PM` : `${hour} AM`}
                    </span>
                  </div>
                ))}
              </div>

              {/* Day Columns */}
              {viewDates.map((date) => {
                const key = date.toISOString().split('T')[0]
                const dayMeetings = meetingsByDay[key] || []
                const today = isToday(date)

                return (
                  <div
                    key={key}
                    className={cn(
                      'flex-1 border-l first:border-l-0 relative',
                      today && 'bg-primary/5'
                    )}
                  >
                    {/* Hour Lines */}
                    {HOURS.map((hour) => (
                      <div
                        key={hour}
                        className="border-b border-border/30"
                        style={{ height: HOUR_HEIGHT }}
                      />
                    ))}

                    {/* Current Time Indicator */}
                    {today && (
                      <div
                        className="absolute left-0 right-0 border-t-2 border-red-500 z-20 pointer-events-none"
                        style={{
                          top: Math.max(0, (new Date().getHours() + new Date().getMinutes() / 60 - START_HOUR) * HOUR_HEIGHT)
                        }}
                      >
                        <div className="absolute -top-1.5 -left-1.5 w-3 h-3 bg-red-500 rounded-full" />
                      </div>
                    )}

                    {/* Meetings - with column layout for overlapping */}
                    {calculateMeetingColumns(dayMeetings).map((meeting) => {
                      const { top, height } = getMeetingStyle(meeting)

                      // Skip if meeting is outside visible hours
                      const startHour = new Date(meeting.start_time).getHours()
                      if (startHour < START_HOUR || startHour >= END_HOUR) return null

                      // Calculate width and left position based on column
                      const columnWidth = 100 / meeting.totalColumns
                      const leftPercent = meeting.column * columnWidth
                      const widthPercent = columnWidth

                      // Determine how many lines of text we can show
                      const canShowTime = height > 35
                      const canShowMultiline = height > 60

                      return (
                        <Tooltip key={meeting.id}>
                          <TooltipTrigger asChild>
                            <button
                              onClick={() => handleMeetingClick(meeting)}
                              className={cn(
                                'absolute rounded-md px-2 py-1 text-xs overflow-hidden transition-all text-left',
                                'hover:ring-2 hover:ring-ring hover:z-30 hover:shadow-lg',
                                // High contrast colors for better readability
                                // Green for meetings WITH recordings - strong visibility
                                meeting.hasRecording && !meeting.isPlaceholder &&
                                  'bg-emerald-500 text-white border-l-4 border-emerald-700 shadow-sm',
                                // Amber for placeholder meetings (orphan recordings)
                                meeting.isPlaceholder &&
                                  'bg-amber-500 text-white border-l-4 border-amber-700 shadow-sm',
                                // Muted but visible for meetings WITHOUT recordings
                                !meeting.hasRecording && !meeting.isPlaceholder &&
                                  'bg-slate-200 text-slate-700 border-l-4 border-slate-400 dark:bg-slate-700 dark:text-slate-200 dark:border-slate-500'
                              )}
                              style={{
                                top,
                                height,
                                minHeight: 24,
                                left: `calc(${leftPercent}% + 2px)`,
                                width: `calc(${widthPercent}% - 4px)`
                              }}
                            >
                              <div className="flex items-start gap-1 h-full">
                                <div className="flex-1 min-w-0">
                                  <div className={cn(
                                    'font-semibold leading-tight',
                                    canShowMultiline ? 'line-clamp-2' : 'truncate'
                                  )}>
                                    {meeting.subject}
                                  </div>
                                  {canShowTime && (
                                    <div className={cn(
                                      'text-[10px] mt-0.5 opacity-80',
                                      canShowMultiline ? '' : 'truncate'
                                    )}>
                                      {formatTime(meeting.start_time)} - {formatTime(meeting.end_time)}
                                    </div>
                                  )}
                                </div>
                                {meeting.hasRecording && (
                                  <Mic className="h-3 w-3 flex-shrink-0 mt-0.5 opacity-90" />
                                )}
                              </div>
                            </button>
                          </TooltipTrigger>
                          <TooltipContent side="right" align="start">
                            <MeetingTooltipContent meeting={meeting} />
                          </TooltipContent>
                        </Tooltip>
                      )
                    })}
                  </div>
                )
              })}
            </div>
          </div>

        </div>
      )}
    </div>
    </TooltipProvider>
  )
}
