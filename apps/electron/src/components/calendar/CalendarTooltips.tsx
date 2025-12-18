/**
 * Tooltip content components for calendar recordings and meetings
 */

import { memo } from 'react'
import { Mic, Cloud, HardDrive, Check } from 'lucide-react'
import { cn, formatTime } from '@/lib/utils'
import type { CalendarRecording, CalendarMeetingOverlay, CalendarMeeting } from '@/lib/calendar-utils'
import { formatDurationStr as formatDuration } from '@/lib/calendar-utils'

type RecordingLocation = 'device-only' | 'local-only' | 'both'

/**
 * Status icon for recording location
 */
export const StatusIcon = memo(function StatusIcon({ location }: { location: RecordingLocation }) {
  switch (location) {
    case 'device-only':
      return <Cloud className="h-3 w-3 text-orange-500" />
    case 'local-only':
      return <HardDrive className="h-3 w-3 text-blue-500" />
    case 'both':
      return <Check className="h-3 w-3 text-green-500" />
  }
})

/**
 * Recording-centric tooltip (RECORDING INFO FIRST, meeting as metadata)
 */
export const RecordingTooltipContent = memo(function RecordingTooltipContent({ recording }: { recording: CalendarRecording }) {
  return (
    <div className="space-y-2 max-w-[280px]">
      {/* RECORDING INFO - PRIMARY */}
      <div className="space-y-1">
        <div className="font-semibold text-foreground flex items-center gap-2">
          <Mic className="h-4 w-4 text-emerald-500" />
          Recording
        </div>
        <div className="text-xs space-y-1">
          <div className="flex items-center gap-2">
            <span className="text-muted-foreground">File:</span>
            <span className="font-mono text-[11px] truncate">{recording.filename}</span>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-muted-foreground">Recorded:</span>
            <span>
              {formatTime(recording.startTime.toISOString())} - {formatTime(recording.endTime.toISOString())}
            </span>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-muted-foreground">Duration:</span>
            <span className="font-medium">{formatDuration(recording.durationSeconds)}</span>
          </div>
          {/* Location status */}
          <div className="flex items-center gap-2">
            <span className="text-muted-foreground">Status:</span>
            <span
              className={cn(
                'flex items-center gap-1',
                recording.location === 'device-only' && 'text-orange-500',
                recording.location === 'local-only' && 'text-blue-500',
                recording.location === 'both' && 'text-green-500'
              )}
            >
              <StatusIcon location={recording.location} />
              {recording.location === 'device-only' && 'On device only'}
              {recording.location === 'local-only' && 'Downloaded'}
              {recording.location === 'both' && 'Synced'}
            </span>
          </div>
          {/* Transcription status */}
          {recording.transcriptionStatus !== 'none' && (
            <div className="flex items-center gap-2">
              <span className="text-muted-foreground">Transcript:</span>
              <span
                className={cn(
                  recording.transcriptionStatus === 'complete' && 'text-green-500',
                  recording.transcriptionStatus === 'processing' && 'text-yellow-500',
                  recording.transcriptionStatus === 'error' && 'text-red-500'
                )}
              >
                {recording.transcriptionStatus}
              </span>
            </div>
          )}
        </div>
      </div>

      {/* MEETING INFO - SECONDARY/METADATA */}
      {recording.linkedMeeting && (
        <div className="pt-2 border-t border-dashed space-y-1">
          <div className="text-xs text-muted-foreground uppercase tracking-wide">Linked Meeting</div>
          <div className="text-xs space-y-1">
            <div className="font-medium">{recording.linkedMeeting.subject}</div>
            <div className="flex items-center gap-2 text-muted-foreground">
              <span>Scheduled:</span>
              <span>
                {formatTime(recording.linkedMeeting.startTime.toISOString())} -{' '}
                {formatTime(recording.linkedMeeting.endTime.toISOString())}
              </span>
            </div>
            {recording.linkedMeeting.organizer && (
              <div className="text-muted-foreground truncate">By: {recording.linkedMeeting.organizer}</div>
            )}
          </div>
        </div>
      )}

      {!recording.linkedMeeting && (
        <div className="pt-2 border-t border-dashed">
          <div className="text-xs text-muted-foreground italic">No matching meeting found</div>
        </div>
      )}

      <div className="text-xs text-muted-foreground pt-1 border-t">Click for details</div>
    </div>
  )
})

/**
 * Meeting overlay tooltip (for meetings without recordings - dashed display)
 */
export const MeetingOverlayTooltipContent = memo(function MeetingOverlayTooltipContent({ meeting }: { meeting: CalendarMeetingOverlay }) {
  const duration = (meeting.endTime.getTime() - meeting.startTime.getTime()) / 1000
  return (
    <div className="space-y-2 max-w-[280px]">
      <div className="font-semibold text-muted-foreground">{meeting.subject}</div>
      <div className="text-xs space-y-1">
        <div className="flex items-center gap-2">
          <span className="text-muted-foreground">Scheduled:</span>
          <span>
            {formatTime(meeting.startTime.toISOString())} - {formatTime(meeting.endTime.toISOString())}
          </span>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-muted-foreground">Duration:</span>
          <span>{formatDuration(duration)}</span>
        </div>
        {meeting.organizer && (
          <div className="flex items-center gap-2">
            <span className="text-muted-foreground">Organizer:</span>
            <span className="truncate">{meeting.organizer}</span>
          </div>
        )}
        <div className="text-amber-500 italic mt-1">No recording captured</div>
      </div>
    </div>
  )
})

/**
 * Legacy meeting tooltip (for backwards compatibility)
 */
export const MeetingTooltipContent = memo(function MeetingTooltipContent({ meeting }: { meeting: CalendarMeeting }) {
  const startTime = new Date(meeting.start_time)
  const endTime = new Date(meeting.end_time)
  const meetingDurationSeconds = (endTime.getTime() - startTime.getTime()) / 1000

  return (
    <div className="space-y-2 max-w-[280px]">
      <div className="font-semibold text-foreground">{meeting.subject}</div>
      <div className="text-xs space-y-1">
        <div className="flex items-center gap-2">
          <span className="text-muted-foreground">Time:</span>
          <span>
            {formatTime(meeting.start_time)} - {formatTime(meeting.end_time)}
          </span>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-muted-foreground">Scheduled:</span>
          <span>{formatDuration(meetingDurationSeconds)}</span>
        </div>
        {meeting.hasRecording && meeting.recordingDurationSeconds && (
          <div className="flex items-center gap-2">
            <span className="text-muted-foreground">Recorded:</span>
            <span>{formatDuration(meeting.recordingDurationSeconds)}</span>
          </div>
        )}
        {meeting.organizer_name && (
          <div className="flex items-center gap-2">
            <span className="text-muted-foreground">Organizer:</span>
            <span className="truncate">{meeting.organizer_name}</span>
          </div>
        )}
        {meeting.location && (
          <div className="flex items-center gap-2">
            <span className="text-muted-foreground">Location:</span>
            <span className="truncate">{meeting.location}</span>
          </div>
        )}
        {meeting.hasRecording && (
          <div className="flex items-center gap-2 text-green-500">
            <Mic className="h-3 w-3" />
            <span>Recording available</span>
          </div>
        )}
        {!meeting.hasRecording && !meeting.isPlaceholder && (
          <div className="text-amber-500 italic">No recording captured</div>
        )}
      </div>
      <div className="text-xs text-muted-foreground pt-1 border-t">Click for details</div>
    </div>
  )
})
