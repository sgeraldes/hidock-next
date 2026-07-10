import { useEffect, useRef, useState, useCallback, type ReactNode } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { ArrowLeft, Clock, MapPin, Users, Mic, FileText, Play, X, Edit, Check, Loader2, Link, Unlink, ChevronDown, ChevronUp, AlertCircle, Plus, Video } from 'lucide-react'
import { Button, buttonVariants } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { parseDescriptionBlocks, extractMeetingUrl, type DescToken } from '@/lib/description-format'
import {
  toDateInputValue,
  toTimeInputValue,
  combineDateTimeToISO,
  diffMeetingTimes
} from '@/lib/meeting-edit'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
  DialogClose
} from '@/components/ui/dialog'
import { formatDateTime, formatDuration, cn } from '@/lib/utils'
import { pageContent } from '@/lib/pageLayout'
import { parseAttendees, parseJsonArray } from '@/types'
import type { Contact } from '@/types'
import { AudioPlayer } from '@/components/AudioPlayer'
import { TranscriptViewer, type StoredSegment } from '@/features/library/components/TranscriptViewer'
import { MeetingActionables } from '@/components/MeetingActionables'
import { useAudioControls } from '@/components/OperationController'
import { useUIStore } from '@/store/useUIStore'
import { toast } from '@/components/ui/toaster'
import { EntityMention } from '@/components/entity'
import type { MeetingDetails } from '@/types'

const ATTENDEES_COLLAPSED_LIMIT = 8

// Grace window after a meeting ends during which "Join" is still offered (people
// run over). Past this, a meeting is history and the Join button is hidden.
const JOIN_GRACE_MS = 15 * 60 * 1000

// The recording row badge shows the recording's processing/transcription
// lifecycle `status`. Device captures default to the literal string 'none',
// which is meaningless to a user — map every value to a plain-language label
// (and a title tooltip that names what the badge represents).
const RECORDING_STATUS_LABELS: Record<string, string> = {
  none: 'Not transcribed',
  pending: 'Queued',
  transcribing: 'Transcribing',
  transcribed: 'Transcribed',
  error: 'Failed'
}

/** Parse a transcript's stored `speakers` JSON into timestamped turns for the
 * TranscriptViewer (same shape the Library reader uses). */
function parseStoredSegments(speakers: string | null | undefined): StoredSegment[] | undefined {
  if (!speakers) return undefined
  try {
    const parsed = JSON.parse(speakers)
    return Array.isArray(parsed) && parsed.length > 0 ? (parsed as StoredSegment[]) : undefined
  } catch {
    return undefined
  }
}

/**
 * C-MTG-005: Safe date formatting that returns a fallback for invalid dates.
 * Prevents RangeError from Intl.DateTimeFormat when date strings are malformed.
 */
function safeFormatTime(date: Date, options: Intl.DateTimeFormatOptions): string {
  try {
    if (isNaN(date.getTime())) return '--:--'
    return date.toLocaleTimeString('en-US', options)
  } catch {
    return '--:--'
  }
}

function safeFormatDate(date: Date, options: Intl.DateTimeFormatOptions): string {
  try {
    if (isNaN(date.getTime())) return 'Unknown date'
    return date.toLocaleDateString('en-US', options)
  } catch {
    return 'Unknown date'
  }
}

function safeGetTimezoneName(date: Date): string {
  try {
    if (isNaN(date.getTime())) return ''
    return Intl.DateTimeFormat('en-US', { timeZoneName: 'short' })
      .formatToParts(date)
      .find(p => p.type === 'timeZoneName')?.value || ''
  } catch {
    return ''
  }
}

/** Render a formatted description line's tokens, linkifying embedded URLs. */
function renderTokens(tokens: DescToken[]): ReactNode {
  return tokens.map((token, i) =>
    token.kind === 'link' ? (
      <a
        key={i}
        href={token.href}
        target="_blank"
        rel="noopener noreferrer"
        className="text-primary hover:underline [overflow-wrap:anywhere]"
      >
        {token.value}
      </a>
    ) : (
      <span key={i}>{token.value}</span>
    )
  )
}

export function MeetingDetail() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const [details, setDetails] = useState<MeetingDetails | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // Edit meeting state (B-MTG-001)
  const [isEditing, setIsEditing] = useState(false)
  const [editForm, setEditForm] = useState({
    subject: '',
    start_time: '',
    end_time: '',
    location: '',
    description: '',
    organizer_name: '',
    organizer_email: ''
  })

  // R1b: attendee ↔ contact resolution + editing
  const [meetingContacts, setMeetingContacts] = useState<Contact[]>([])
  const [newAttendee, setNewAttendee] = useState({ name: '', email: '' })
  const [attendeeBusy, setAttendeeBusy] = useState(false)

  // Recording link dialog state (B-MTG-002)
  const [linkDialogOpen, setLinkDialogOpen] = useState(false)
  const [linkRecordingId, setLinkRecordingId] = useState<string | null>(null)
  const [availableMeetings, setAvailableMeetings] = useState<any[]>([])
  const [linkLoading, setLinkLoading] = useState(false)

  // Playback loading state (B-MTG-003)
  const [playbackLoading, setPlaybackLoading] = useState<string | null>(null)

  // Actionables error state (AUD2-009)
  const [actionablesError, setActionablesError] = useState<string | null>(null)

  // Attendee overflow state (B-MTG-005)
  const [showAllAttendees, setShowAllAttendees] = useState(false)

  // C-MTG-006: Ref to track playback loading timeout for cleanup on unmount
  const playbackTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Global playback state. playbackCurrentTime (seconds) drives the embedded
  // transcript's auto-scroll for whichever recording is currently playing.
  const currentlyPlayingId = useUIStore((state) => state.currentlyPlayingId)
  const playbackCurrentTime = useUIStore((state) => state.playbackCurrentTime)
  const audioControls = useAudioControls()

  // C-MTG-006: Clean up playback timeout on unmount
  useEffect(() => {
    return () => {
      if (playbackTimeoutRef.current) {
        clearTimeout(playbackTimeoutRef.current)
      }
    }
  }, [])

  // B-MTG-004: Memoized loadMeetingDetails
  const loadMeetingDetails = useCallback(async (meetingId: string) => {
    setLoading(true)
    setError(null)
    try {
      const data = await window.electronAPI.meetings.getDetails(meetingId)
      if (!data) {
        throw new Error('Meeting not found')
      }

      // Load actionables separately with error handling (AUD2-009)
      setActionablesError(null)
      try {
        const actionables = await window.electronAPI.actionables.getByMeeting(meetingId)
        data.actionables = actionables
      } catch (actErr) {
        console.error('Failed to load actionables:', actErr)
        data.actionables = []
        setActionablesError('Failed to load actionables')
      }

      setDetails(data)

      // Initialize edit form
      setEditForm({
        subject: data.meeting.subject || '',
        start_time: data.meeting.start_time || '',
        end_time: data.meeting.end_time || '',
        location: data.meeting.location || '',
        description: data.meeting.description || '',
        organizer_name: data.meeting.organizer_name || '',
        organizer_email: data.meeting.organizer_email || ''
      })

      // R1b: load the meeting's canonical contacts so attendee chips can resolve
      // to /person/:id and expose a remove (X) action with the contact id.
      try {
        const contactsResult = await window.electronAPI.contacts.getForMeeting(meetingId)
        setMeetingContacts(contactsResult.success ? contactsResult.data : [])
      } catch (contactsErr) {
        console.error('Failed to load meeting contacts:', contactsErr)
        setMeetingContacts([])
      }
    } catch (error) {
      console.error('Failed to load meeting details:', error)
      setError((error as Error).message || 'Failed to load meeting')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    if (id) {
      // C-MTG-004: Reset attendee overflow state when navigating to a different meeting
      setShowAllAttendees(false)
      loadMeetingDetails(id)
    }
  }, [id, loadMeetingDetails])

  // Clear playback loading when audio starts playing
  useEffect(() => {
    if (currentlyPlayingId && playbackLoading === currentlyPlayingId) {
      setPlaybackLoading(null)
    }
  }, [currentlyPlayingId, playbackLoading])

  // B-MTG-001: Save edited meeting
  const handleSaveEdit = async () => {
    if (!id || !details) return
    try {
      const updates: Record<string, string | null | undefined> = {}
      if (editForm.subject !== details.meeting.subject) updates.subject = editForm.subject
      if (editForm.location !== (details.meeting.location || '')) updates.location = editForm.location || null
      if (editForm.description !== (details.meeting.description || '')) updates.description = editForm.description || null
      // R1b: organizer name/email editable
      if (editForm.organizer_name !== (details.meeting.organizer_name || '')) {
        updates.organizer_name = editForm.organizer_name || null
      }
      if (editForm.organizer_email !== (details.meeting.organizer_email || '')) {
        updates.organizer_email = editForm.organizer_email || null
      }

      // Date / start / end editing — diff by instant and validate end > start.
      const timeDiff = diffMeetingTimes(
        { start_time: details.meeting.start_time, end_time: details.meeting.end_time },
        { start_time: editForm.start_time, end_time: editForm.end_time }
      )
      if (!timeDiff.ok) {
        toast.error('Invalid time', timeDiff.error)
        return
      }
      Object.assign(updates, timeDiff.updates)

      if (Object.keys(updates).length === 0) {
        setIsEditing(false)
        return
      }

      const result = await window.electronAPI.meetings.update({ id, ...updates })
      if (result.success) {
        toast.success('Meeting updated', 'Meeting details have been saved.')
        setIsEditing(false)
        await loadMeetingDetails(id)
      } else {
        toast.error('Failed to update meeting', (result as any).error?.message || 'Unknown error')
      }
    } catch (err) {
      console.error('Failed to update meeting:', err)
      toast.error('Failed to update meeting', err instanceof Error ? err.message : 'Unknown error')
    }
  }

  const handleCancelEdit = () => {
    if (details) {
      setEditForm({
        subject: details.meeting.subject || '',
        start_time: details.meeting.start_time || '',
        end_time: details.meeting.end_time || '',
        location: details.meeting.location || '',
        description: details.meeting.description || '',
        organizer_name: details.meeting.organizer_name || '',
        organizer_email: details.meeting.organizer_email || ''
      })
    }
    setNewAttendee({ name: '', email: '' })
    setIsEditing(false)
  }

  // B-MTG-003: Handle play with loading spinner
  const handlePlay = (recordingId: string, filePath: string) => {
    setPlaybackLoading(recordingId)
    audioControls.play(recordingId, filePath)
    // Loading state will be cleared by the useEffect when currentlyPlayingId changes
    // C-MTG-006: Track timeout in ref so it can be cleaned up on unmount
    if (playbackTimeoutRef.current) {
      clearTimeout(playbackTimeoutRef.current)
    }
    playbackTimeoutRef.current = setTimeout(() => {
      setPlaybackLoading(prev => prev === recordingId ? null : prev)
      playbackTimeoutRef.current = null
    }, 5000)
  }

  // B-MTG-002: Handle recording link/unlink
  const handleUnlinkRecording = async (recordingId: string) => {
    try {
      await window.electronAPI.recordings.selectMeeting(recordingId, null)
      toast.success('Recording unlinked', 'Recording has been unlinked from this meeting.')
      if (id) await loadMeetingDetails(id)
    } catch (err) {
      console.error('Failed to unlink recording:', err)
      toast.error('Failed to unlink recording', err instanceof Error ? err.message : 'Unknown error')
    }
  }

  const handleOpenLinkDialog = async (recordingId: string) => {
    setLinkRecordingId(recordingId)
    setLinkDialogOpen(true)
    setLinkLoading(true)
    try {
      const result = await window.electronAPI.recordings.getCandidates(recordingId)
      if (result.success) {
        setAvailableMeetings(result.data)
      }
    } catch (err) {
      console.error('Failed to load meeting candidates:', err)
    } finally {
      setLinkLoading(false)
    }
  }

  const handleLinkToMeeting = async (meetingId: string) => {
    if (!linkRecordingId) return
    try {
      const result = await window.electronAPI.recordings.selectMeeting(linkRecordingId, meetingId)
      if (result.success) {
        toast.success('Recording linked', 'Recording has been linked to the meeting.')
        setLinkDialogOpen(false)
        if (id) await loadMeetingDetails(id)
      } else {
        toast.error('Failed to link recording', result.error || 'Unknown error')
      }
    } catch (err) {
      console.error('Failed to link recording:', err)
      toast.error('Failed to link recording', err instanceof Error ? err.message : 'Unknown error')
    }
  }

  // R1b: resolve an attendee (from the attendees JSON projection) to a canonical
  // contact by email first, then by name — both case-insensitive.
  const resolveAttendee = (attendee: { name?: string; email?: string }): Contact | undefined => {
    const email = attendee.email?.trim().toLowerCase()
    const name = attendee.name?.trim().toLowerCase()
    return meetingContacts.find((c) => {
      if (email && c.email && c.email.toLowerCase() === email) return true
      if (name && c.name.toLowerCase() === name) return true
      return false
    })
  }

  const handleAddAttendee = async () => {
    if (!id) return
    const name = newAttendee.name.trim()
    const email = newAttendee.email.trim()
    if (!name && !email) {
      toast.error('Add attendee', 'Provide a name or an email.')
      return
    }
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      toast.error('Add attendee', 'Please enter a valid email address.')
      return
    }
    setAttendeeBusy(true)
    try {
      const result = await window.electronAPI.meetings.addAttendee({
        meetingId: id,
        name: name || undefined,
        email: email || undefined
      })
      if (result.success) {
        toast.success('Attendee added')
        setNewAttendee({ name: '', email: '' })
        await loadMeetingDetails(id)
      } else {
        toast.error('Failed to add attendee', (result as any).error?.message || 'Unknown error')
      }
    } catch (err) {
      console.error('Failed to add attendee:', err)
      toast.error('Failed to add attendee', err instanceof Error ? err.message : 'Unknown error')
    } finally {
      setAttendeeBusy(false)
    }
  }

  const handleRemoveAttendee = async (contactId: string) => {
    if (!id) return
    setAttendeeBusy(true)
    try {
      const result = await window.electronAPI.meetings.removeAttendee({ meetingId: id, contactId })
      if (result.success) {
        toast.success('Attendee removed')
        await loadMeetingDetails(id)
      } else {
        toast.error('Failed to remove attendee', (result as any).error?.message || 'Unknown error')
      }
    } catch (err) {
      console.error('Failed to remove attendee:', err)
      toast.error('Failed to remove attendee', err instanceof Error ? err.message : 'Unknown error')
    } finally {
      setAttendeeBusy(false)
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <p className="text-muted-foreground">Loading meeting details...</p>
      </div>
    )
  }

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-4">
        <p className="text-destructive">{error}</p>
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => id && loadMeetingDetails(id)}>
            Retry
          </Button>
          <Button variant="outline" onClick={() => navigate('/calendar')}>
            <ArrowLeft className="h-4 w-4 mr-2" />
            Back to Calendar
          </Button>
        </div>
      </div>
    )
  }

  if (!details) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-4">
        <p className="text-muted-foreground">Meeting not found</p>
        <Button variant="outline" onClick={() => navigate('/calendar')}>
          <ArrowLeft className="h-4 w-4 mr-2" />
          Back to Calendar
        </Button>
      </div>
    )
  }

  const { meeting, recordings } = details
  const attendees = parseAttendees(meeting.attendees)

  // Join link: the dedicated field, else the first Teams/Zoom/Meet URL that a
  // Teams invite embeds inside the description body.
  const joinUrl = meeting.meeting_url || extractMeetingUrl(meeting.description)

  // Parsed description blocks (bullets normalized, URLs linkified) for display.
  const descriptionBlocks = parseDescriptionBlocks(meeting.description)

  // Native date/time input values derived from the edit form's ISO strings.
  const startDateValue = toDateInputValue(editForm.start_time)
  const startTimeValue = toTimeInputValue(editForm.start_time)
  const endTimeValue = toTimeInputValue(editForm.end_time)

  // Apply a changed date to both start and end (meetings are same-day here).
  const handleDateChange = (value: string) => {
    setEditForm((prev) => ({
      ...prev,
      start_time: combineDateTimeToISO(value, toTimeInputValue(prev.start_time)) || prev.start_time,
      end_time: combineDateTimeToISO(value, toTimeInputValue(prev.end_time)) || prev.end_time
    }))
  }
  const handleStartTimeChange = (value: string) => {
    setEditForm((prev) => ({
      ...prev,
      start_time: combineDateTimeToISO(toDateInputValue(prev.start_time), value) || prev.start_time
    }))
  }
  const handleEndTimeChange = (value: string) => {
    setEditForm((prev) => ({
      ...prev,
      end_time:
        combineDateTimeToISO(toDateInputValue(prev.end_time) || toDateInputValue(prev.start_time), value) ||
        prev.end_time
    }))
  }

  // Live duration from the edit form so the user sees it update as they type.
  const editStartMs = new Date(editForm.start_time).getTime()
  const editEndMs = new Date(editForm.end_time).getTime()
  const editDurationMins =
    Number.isFinite(editStartMs) && Number.isFinite(editEndMs)
      ? Math.round((editEndMs - editStartMs) / 60000)
      : 0

  const startDate = new Date(meeting.start_time)
  const endDate = new Date(meeting.end_time)
  // C-MTG-005: Guard against invalid dates producing NaN
  const rawDuration = (endDate.getTime() - startDate.getTime()) / 60000
  const durationMins = Number.isFinite(rawDuration) ? Math.round(rawDuration) : 0
  const isValidDate = !isNaN(startDate.getTime()) && !isNaN(endDate.getTime())

  // A meeting is "past" once it ended more than the grace window ago. Join is
  // only useful for current/upcoming meetings, so we hide it for past ones.
  const isPastMeeting = isValidDate && endDate.getTime() < Date.now() - JOIN_GRACE_MS

  // B-MTG-005: Control visible attendees
  const visibleAttendees = showAllAttendees ? attendees : attendees.slice(0, ATTENDEES_COLLAPSED_LIMIT)
  const hasMoreAttendees = attendees.length > ATTENDEES_COLLAPSED_LIMIT

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <header className="flex items-center gap-4 border-b px-6 py-4">
        <Button variant="ghost" size="icon" onClick={() => navigate('/calendar', { state: { date: meeting.start_time } })}>
          <ArrowLeft className="h-5 w-5" />
        </Button>
        <div className="flex-1">
          {isEditing ? (
            <Input
              value={editForm.subject}
              onChange={(e) => setEditForm(prev => ({ ...prev, subject: e.target.value }))}
              className="text-xl font-bold h-auto py-1"
            />
          ) : (
            <h1 className="text-xl font-bold">{meeting.subject}</h1>
          )}
          <p className="text-sm text-muted-foreground">{formatDateTime(meeting.start_time)}</p>
        </div>
        <div className="flex items-center gap-2">
          {!isEditing && joinUrl && !isPastMeeting && (
            <a
              href={joinUrl}
              target="_blank"
              rel="noopener noreferrer"
              className={cn(buttonVariants({ size: 'sm', variant: 'default' }))}
            >
              <Video className="h-4 w-4 mr-2" />
              Join meeting
            </a>
          )}
          {isEditing ? (
            <>
              <Button size="sm" variant="default" onClick={handleSaveEdit}>
                <Check className="h-4 w-4 mr-2" />
                Save
              </Button>
              <Button size="sm" variant="ghost" onClick={handleCancelEdit}>
                <X className="h-4 w-4 mr-2" />
                Cancel
              </Button>
            </>
          ) : (
            <Button size="sm" variant="outline" onClick={() => setIsEditing(true)}>
              <Edit className="h-4 w-4 mr-2" />
              Edit
            </Button>
          )}
        </div>
      </header>

      {/* Content */}
      <div className="flex-1 overflow-auto p-6">
        <div className={cn(pageContent, 'space-y-6')}>
          {/* Meeting Info */}
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Meeting Details</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex items-start gap-3">
                <Clock className="h-5 w-5 text-muted-foreground mt-0.5" />
                {isEditing ? (
                  <div className="flex-1 space-y-2">
                    <div className="flex flex-wrap items-center gap-2">
                      <label className="flex flex-col gap-1 text-xs text-muted-foreground">
                        Date
                        <Input
                          type="date"
                          value={startDateValue}
                          onChange={(e) => handleDateChange(e.target.value)}
                          aria-label="Meeting date"
                          className="w-40 h-8"
                        />
                      </label>
                      <label className="flex flex-col gap-1 text-xs text-muted-foreground">
                        Start
                        <Input
                          type="time"
                          value={startTimeValue}
                          onChange={(e) => handleStartTimeChange(e.target.value)}
                          aria-label="Start time"
                          className="w-28 h-8"
                        />
                      </label>
                      <label className="flex flex-col gap-1 text-xs text-muted-foreground">
                        End
                        <Input
                          type="time"
                          value={endTimeValue}
                          onChange={(e) => handleEndTimeChange(e.target.value)}
                          aria-label="End time"
                          className="w-28 h-8"
                        />
                      </label>
                    </div>
                    <p className={cn('text-xs', editDurationMins > 0 ? 'text-muted-foreground' : 'text-destructive')}>
                      {editDurationMins > 0 ? `${editDurationMins} minutes` : 'End time must be after start time'}
                    </p>
                  </div>
                ) : (
                  <div>
                    {/* C-MTG-003: Timezone-aware time display using safe formatters */}
                    <p className="font-medium">
                      {safeFormatTime(startDate, { hour: '2-digit', minute: '2-digit' })} -{' '}
                      {safeFormatTime(endDate, { hour: '2-digit', minute: '2-digit' })}
                      {isValidDate && (
                        <span className="ml-1.5 text-xs font-normal text-muted-foreground">
                          {safeGetTimezoneName(startDate)}
                        </span>
                      )}
                    </p>
                    <p className="text-sm text-muted-foreground flex items-center gap-1.5 flex-wrap">
                      <span>{durationMins} minutes</span>
                      {isValidDate && (
                        <>
                          <span aria-hidden>{'\u00b7'}</span>
                          <EntityMention
                            type="date"
                            date={meeting.start_time}
                            name={safeFormatDate(startDate, { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })}
                          />
                        </>
                      )}
                    </p>
                  </div>
                )}
              </div>

              {(meeting.location || isEditing) && (
                <div className="flex items-center gap-3">
                  <MapPin className="h-5 w-5 text-muted-foreground" />
                  {isEditing ? (
                    <Input
                      value={editForm.location}
                      onChange={(e) => setEditForm(prev => ({ ...prev, location: e.target.value }))}
                      placeholder="Location..."
                      className="flex-1"
                    />
                  ) : (
                    <p>{meeting.location}</p>
                  )}
                </div>
              )}

              {(meeting.organizer_name || isEditing) && (
                <div className="flex items-start gap-3">
                  <Users className="h-5 w-5 text-muted-foreground mt-0.5" />
                  {isEditing ? (
                    <div className="flex-1 space-y-2">
                      <p className="text-xs text-muted-foreground">Organizer</p>
                      <Input
                        value={editForm.organizer_name}
                        onChange={(e) => setEditForm(prev => ({ ...prev, organizer_name: e.target.value }))}
                        placeholder="Organizer name..."
                        aria-label="Organizer name"
                      />
                      <Input
                        value={editForm.organizer_email}
                        onChange={(e) => setEditForm(prev => ({ ...prev, organizer_email: e.target.value }))}
                        placeholder="Organizer email..."
                        aria-label="Organizer email"
                      />
                    </div>
                  ) : (
                    <div>
                      <p className="font-medium">Organizer: {meeting.organizer_name}</p>
                      {meeting.organizer_email && (
                        <p className="text-sm text-muted-foreground">{meeting.organizer_email}</p>
                      )}
                    </div>
                  )}
                </div>
              )}

              {/* B-MTG-005: Attendees with overflow and "Show all" toggle.
                  R1b: chips resolve to contacts (clickable → /person/:id) and, in
                  edit mode, expose remove (X) + an inline add form. */}
              {(attendees.length > 0 || isEditing) && (
                <div>
                  <p className="font-medium mb-2">Attendees ({attendees.length})</p>
                  <div className="max-h-40 overflow-auto">
                    <div className="flex flex-wrap gap-2">
                      {visibleAttendees.map((attendee, i) => {
                        const contact = resolveAttendee(attendee)
                        const labelText = attendee.name || attendee.email
                        return (
                          <span
                            key={i}
                            className="inline-flex items-center gap-1 px-2 py-1 bg-secondary text-secondary-foreground rounded-full text-xs"
                          >
                            {contact ? (
                              <button
                                type="button"
                                onClick={() => navigate(`/person/${contact.id}`)}
                                className="hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50 rounded"
                                title={`View ${contact.name}`}
                              >
                                {labelText}
                              </button>
                            ) : (
                              <span>{labelText}</span>
                            )}
                            {isEditing && contact && (
                              <button
                                type="button"
                                onClick={() => handleRemoveAttendee(contact.id)}
                                disabled={attendeeBusy}
                                className="text-muted-foreground hover:text-destructive disabled:opacity-50"
                                aria-label={`Remove ${labelText}`}
                              >
                                <X className="h-3 w-3" />
                              </button>
                            )}
                          </span>
                        )
                      })}
                    </div>
                  </div>
                  {hasMoreAttendees && (
                    <Button
                      variant="ghost"
                      size="sm"
                      className="mt-2 text-xs"
                      onClick={() => setShowAllAttendees(!showAllAttendees)}
                    >
                      {showAllAttendees ? (
                        <>
                          <ChevronUp className="h-3 w-3 mr-1" />
                          Show less
                        </>
                      ) : (
                        <>
                          <ChevronDown className="h-3 w-3 mr-1" />
                          Show all {attendees.length} attendees
                        </>
                      )}
                    </Button>
                  )}
                  {isEditing && (
                    <div className="mt-3 flex flex-wrap items-center gap-2">
                      <Input
                        value={newAttendee.name}
                        onChange={(e) => setNewAttendee(prev => ({ ...prev, name: e.target.value }))}
                        placeholder="Name"
                        aria-label="New attendee name"
                        className="w-32 h-8 text-sm"
                      />
                      <Input
                        value={newAttendee.email}
                        onChange={(e) => setNewAttendee(prev => ({ ...prev, email: e.target.value }))}
                        placeholder="Email"
                        aria-label="New attendee email"
                        className="w-48 h-8 text-sm"
                      />
                      <Button size="sm" variant="outline" onClick={handleAddAttendee} disabled={attendeeBusy}>
                        <Plus className="h-3.5 w-3.5 mr-1" />
                        Add
                      </Button>
                    </div>
                  )}
                </div>
              )}

              {/* R1b: when the ICS feed stripped attendees but we know participants
                  from transcripts / speaker assignments, surface them here.
                  These ARE canonical contacts, so chips resolve to /person/:id. */}
              {attendees.length === 0 && !isEditing && meetingContacts.length > 0 && (
                <div>
                  <p className="font-medium mb-2">
                    Participants ({meetingContacts.length})
                    <span className="ml-2 text-xs font-normal text-muted-foreground">From transcripts</span>
                  </p>
                  <div className="max-h-40 overflow-auto">
                    <div className="flex flex-wrap gap-2">
                      {meetingContacts.map((contact) => (
                        <button
                          key={contact.id}
                          type="button"
                          onClick={() => navigate(`/person/${contact.id}`)}
                          className="inline-flex items-center gap-1 px-2 py-1 bg-secondary text-secondary-foreground rounded-full text-xs hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50"
                          title={`View ${contact.name}`}
                        >
                          {contact.name || contact.email}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
              )}

              {/* Description (editable) — ICS pseudo-markdown normalized on display */}
              {(meeting.description || isEditing) && (
                <div>
                  <p className="font-medium mb-1">Description</p>
                  {isEditing ? (
                    <textarea
                      value={editForm.description}
                      onChange={(e) => setEditForm(prev => ({ ...prev, description: e.target.value }))}
                      className="text-sm w-full border rounded px-3 py-2 bg-background min-h-[80px]"
                      placeholder="Meeting description..."
                    />
                  ) : descriptionBlocks.length > 0 ? (
                    <div className="text-sm text-muted-foreground [overflow-wrap:anywhere] max-h-64 overflow-y-auto space-y-2">
                      {descriptionBlocks.map((block, bi) =>
                        block.type === 'list' ? (
                          <ul key={bi} className="list-disc pl-5 space-y-1">
                            {block.lines.map((tokens, li) => (
                              <li key={li}>{renderTokens(tokens)}</li>
                            ))}
                          </ul>
                        ) : (
                          <p key={bi}>
                            {block.lines.map((tokens, li) => (
                              <span key={li} className="block">
                                {renderTokens(tokens)}
                              </span>
                            ))}
                          </p>
                        )
                      )}
                    </div>
                  ) : null}
                </div>
              )}
            </CardContent>
          </Card>

          {/* Recordings */}
          <Card>
            <CardHeader>
              <CardTitle className="text-lg flex items-center gap-2">
                <Mic className="h-5 w-5" />
                Recordings ({recordings.length})
              </CardTitle>
            </CardHeader>
            <CardContent>
              {recordings.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-12 text-center">
                  <Mic className="h-10 w-10 text-muted-foreground/40 mb-3" />
                  <p className="text-muted-foreground font-medium mb-1">No recordings linked</p>
                  <p className="text-sm text-muted-foreground/70 max-w-sm">
                    Recordings are automatically linked when they overlap with the meeting time.
                    You can also manually link recordings from the Calendar view.
                  </p>
                  <Button
                    variant="outline"
                    size="sm"
                    className="mt-4"
                    onClick={() => navigate('/calendar', { state: { date: meeting.start_time } })}
                  >
                    Go to Calendar
                  </Button>
                </div>
              ) : (
                <div className="space-y-4">
                  {recordings.map((recording) => (
                    <div key={recording.id} className="border rounded-lg p-4">
                      <div className="flex items-center justify-between mb-2">
                        <div className="flex items-center gap-2">
                          <Mic className="h-4 w-4 text-green-600" />
                          <span className="font-medium">{recording.filename}</span>
                        </div>
                        <div className="flex items-center gap-2">
                          {(() => {
                            const statusLabel = RECORDING_STATUS_LABELS[recording.status] ?? recording.status
                            return (
                              <span
                                className="text-xs px-2 py-1 rounded-full bg-secondary text-secondary-foreground"
                                title={`Transcription status: ${statusLabel}`}
                              >
                                {statusLabel}
                              </span>
                            )
                          })()}
                          {/* B-MTG-002: Unlink recording button */}
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => handleUnlinkRecording(recording.id)}
                            title="Unlink recording from meeting"
                          >
                            <Unlink className="h-4 w-4" />
                          </Button>
                          {/* C-MTG-001: Re-link recording to a different meeting */}
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => handleOpenLinkDialog(recording.id)}
                            title="Link to a different meeting"
                          >
                            <Link className="h-4 w-4" />
                          </Button>
                          {/* B-MTG-003: Play with loading spinner */}
                          {playbackLoading === recording.id ? (
                            <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                          ) : currentlyPlayingId === recording.id ? (
                            <Button
                              variant="ghost"
                              size="icon"
                              onClick={() => audioControls.stop()}
                            >
                              <X className="h-4 w-4" />
                            </Button>
                          ) : (
                            <Button
                              variant="ghost"
                              size="icon"
                              onClick={() => recording.file_path && handlePlay(recording.id, recording.file_path)}
                              disabled={!recording.file_path}
                              title={recording.file_path ? 'Play recording' : 'Recording not available locally'}
                            >
                              <Play className="h-4 w-4" />
                            </Button>
                          )}
                        </div>
                      </div>

                      {/* Audio Player */}
                      {currentlyPlayingId === recording.id && recording.file_path && (
                        <div className="my-3">
                          <AudioPlayer
                            filename={recording.filename}
                            onClose={() => audioControls.stop()}
                          />
                        </div>
                      )}

                      {recording.duration_seconds && (
                        <p className="text-sm text-muted-foreground">
                          Duration: {formatDuration(recording.duration_seconds)}
                        </p>
                      )}

                      {/* Transcript — same interactive component the Library reader
                          uses, so speaker labels are clickable→assignable, per-turn
                          timestamps show, and the view auto-scrolls with playback. */}
                      {recording.transcript && (
                        <div className="mt-4 pt-4 border-t">
                          <div className="flex items-center gap-2 mb-2">
                            <FileText className="h-4 w-4" />
                            <span className="font-medium text-sm">Transcript</span>
                          </div>
                          <TranscriptViewer
                            transcript={recording.transcript.full_text}
                            segments={parseStoredSegments(recording.transcript.speakers)}
                            recordingId={recording.id}
                            currentTimeMs={
                              currentlyPlayingId === recording.id
                                ? Math.round(playbackCurrentTime * 1000)
                                : undefined
                            }
                            onSeek={(startMs) => audioControls.seek(startMs / 1000)}
                            showSummary={true}
                            showActionItems={true}
                            summary={recording.transcript.summary ?? undefined}
                            actionItems={parseJsonArray<string>(recording.transcript.action_items)}
                          />
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

          {/* AUD2-002: Actionables Section */}
          {actionablesError ? (
            <Card>
              <CardContent className="py-6">
                <div className="flex items-center justify-center gap-3 text-sm text-muted-foreground">
                  <AlertCircle className="h-4 w-4 text-destructive" />
                  <span>{actionablesError}</span>
                  <Button variant="ghost" size="sm" onClick={() => id && loadMeetingDetails(id)}>
                    Retry
                  </Button>
                </div>
              </CardContent>
            </Card>
          ) : details.actionables && details.actionables.length > 0 ? (
            <MeetingActionables actionables={details.actionables} />
          ) : null}
        </div>
      </div>

      {/* B-MTG-002: Recording Link Dialog */}
      <Dialog open={linkDialogOpen} onOpenChange={setLinkDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Link Recording to Meeting</DialogTitle>
            <DialogDescription>
              Select a meeting to link this recording to.
            </DialogDescription>
          </DialogHeader>
          {linkLoading ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : availableMeetings.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-8">
              No candidate meetings found.
            </p>
          ) : (
            <div className="max-h-64 overflow-auto space-y-2">
              {availableMeetings.map((m: any) => (
                <button
                  key={m.meetingId || m.id}
                  className="w-full text-left p-3 border rounded-lg hover:bg-muted transition-colors"
                  onClick={() => handleLinkToMeeting(m.meetingId || m.id)}
                >
                  <p className="font-medium text-sm">{m.subject}</p>
                  <p className="text-xs text-muted-foreground">
                    {formatDateTime(m.startTime || m.start_time)}
                  </p>
                  {m.confidenceScore !== undefined && (
                    <p className="text-xs text-primary">
                      Confidence: {Math.round(m.confidenceScore * 100)}%
                    </p>
                  )}
                </button>
              ))}
            </div>
          )}
          <DialogFooter>
            <DialogClose asChild>
              <Button variant="outline">Cancel</Button>
            </DialogClose>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

export default MeetingDetail
