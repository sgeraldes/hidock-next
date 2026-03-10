import { useEffect, useState, useCallback } from 'react'
import { Star, Pencil, Check, X, Link2Off } from 'lucide-react'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group'
import { cn, formatDuration, formatTime, formatDateTime } from '@/lib/utils'
import { toast } from '@/components/ui/toaster'
import type { Recording, Meeting, MeetingCandidate } from '@/types'

interface RecordingLinkDialogProps {
  recording: Pick<Recording, 'id' | 'filename' | 'date_recorded' | 'duration_seconds'> | null
  meeting?: Meeting
  open: boolean
  onClose: () => void
  onResolved: () => void
}

export function RecordingLinkDialog({
  recording,
  meeting,
  open,
  onClose,
  onResolved
}: RecordingLinkDialogProps) {
  // Link section state
  const [candidates, setCandidates] = useState<MeetingCandidate[]>([])
  const [nearbyMeetings, setNearbyMeetings] = useState<Meeting[]>([])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [loading, setLoading] = useState(false)
  const [linkError, setLinkError] = useState<string | null>(null)

  // Meeting edit state
  const [editingSubject, setEditingSubject] = useState(false)
  const [subjectDraft, setSubjectDraft] = useState('')
  const [editingLocation, setEditingLocation] = useState(false)
  const [locationDraft, setLocationDraft] = useState('')
  const [savingMeeting, setSavingMeeting] = useState(false)

  // Other linked recordings state
  const [linkedRecordings, setLinkedRecordings] = useState<Recording[]>([])
  const [unlinkingId, setUnlinkingId] = useState<string | null>(null)

  // Reset state when dialog opens/closes or recording changes
  useEffect(() => {
    if (!recording || !open) {
      setCandidates([])
      setNearbyMeetings([])
      setSelectedId(null)
      setLinkError(null)
      setEditingSubject(false)
      setEditingLocation(false)
      setLinkedRecordings([])
      return
    }

    let cancelled = false

    const loadData = async () => {
      setLoading(true)
      setLinkError(null)

      try {
        const promises: Promise<any>[] = [
          window.electronAPI.recordings.getCandidates(recording.id),
          window.electronAPI.recordings.getMeetingsNearDate(recording.date_recorded)
        ]
        if (meeting) {
          promises.push(window.electronAPI.recordings.getForMeeting(meeting.id))
        }

        const [candidatesResult, nearbyResult, meetingRecordings] = await Promise.all(promises)

        if (cancelled) return

        if (!candidatesResult.success) {
          setLinkError(candidatesResult.error || 'Failed to load candidates')
          return
        }

        setCandidates(candidatesResult.data)
        setNearbyMeetings(nearbyResult.success ? nearbyResult.data : [])

        if (meetingRecordings) {
          setLinkedRecordings((meetingRecordings as Recording[]).filter(r => r.id !== recording.id))
        }

        // Pre-select AI's choice if available, otherwise pre-select current meeting
        const aiPick = candidatesResult.data.find((c: MeetingCandidate) => c.isAiSelected)
        if (aiPick) {
          setSelectedId(aiPick.meetingId)
        } else if (meeting) {
          setSelectedId(meeting.id)
        }
      } catch (err) {
        if (cancelled) return
        setLinkError(err instanceof Error ? err.message : 'Failed to load data')
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    loadData()

    return () => { cancelled = true }
  }, [recording, open, meeting])

  // Sync meeting edit drafts when meeting changes
  useEffect(() => {
    if (meeting) {
      setSubjectDraft(meeting.subject)
      setLocationDraft(meeting.location ?? '')
    }
  }, [meeting])

  const handleSaveMeetingField = useCallback(async (field: 'subject' | 'location') => {
    if (!meeting) return
    const value = field === 'subject' ? subjectDraft.trim() : locationDraft.trim()
    if (field === 'subject' && !value) return

    setSavingMeeting(true)
    try {
      const result = await window.electronAPI.meetings.update({
        id: meeting.id,
        [field]: field === 'location' ? (value || null) : value
      })
      if (!result.success) {
        toast.error(`Failed to update meeting ${field}`)
      } else {
        toast.success(`Meeting ${field} updated`)
        onResolved()
      }
    } catch {
      toast.error(`Failed to update meeting ${field}`)
    } finally {
      setSavingMeeting(false)
      if (field === 'subject') setEditingSubject(false)
      if (field === 'location') setEditingLocation(false)
    }
  }, [meeting, subjectDraft, locationDraft, onResolved])

  const handleUnlinkOther = useCallback(async (recordingId: string) => {
    setUnlinkingId(recordingId)
    try {
      const result = await window.electronAPI.recordings.selectMeeting(recordingId, null)
      if (!result.success) {
        toast.error('Failed to unlink recording')
      } else {
        setLinkedRecordings(prev => prev.filter(r => r.id !== recordingId))
        toast.success('Recording unlinked')
      }
    } catch {
      toast.error('Failed to unlink recording')
    } finally {
      setUnlinkingId(null)
    }
  }, [])

  const handleSaveLink = async () => {
    if (!recording || selectedId === null) return

    setSaving(true)
    setLinkError(null)

    try {
      const meetingId = selectedId === 'none' ? null : selectedId
      const result = await window.electronAPI.recordings.selectMeeting(recording.id, meetingId)

      if (!result.success) {
        setLinkError(result.error || 'Failed to save')
        return
      }

      onResolved()
      onClose()
    } catch (err) {
      setLinkError(err instanceof Error ? err.message : 'Failed to save')
    } finally {
      setSaving(false)
    }
  }

  if (!recording) return null

  const hasCandidates = candidates.length > 0
  const options: MeetingCandidate[] = hasCandidates
    ? candidates
    : nearbyMeetings.map((m) => ({
        id: `nearby_${m.id}`,
        recordingId: recording.id,
        meetingId: m.id,
        subject: m.subject,
        startTime: m.start_time,
        endTime: m.end_time,
        confidenceScore: 0,
        matchReason: null,
        isAiSelected: false,
        isUserConfirmed: false
      }))

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-lg max-h-[85vh] overflow-hidden flex flex-col">
        <DialogHeader>
          <DialogTitle>
            {meeting ? 'Meeting Details' : (hasCandidates ? 'Verify Recording Match' : 'Link Recording to Meeting')}
          </DialogTitle>
          <DialogDescription className="text-sm space-y-1">
            <span className="font-medium block truncate">{recording.filename}</span>
            {recording.duration_seconds && (
              <span className="text-muted-foreground">
                Duration: {formatDuration(recording.duration_seconds)}
              </span>
            )}
          </DialogDescription>
        </DialogHeader>

        <div className="flex-1 overflow-y-auto py-2 space-y-4">
          {/* ── Section 1: Edit meeting details (only when linked) ── */}
          {meeting && (
            <div className="space-y-2">
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground px-1">Meeting Details</p>
              <div className="rounded-lg border p-3 space-y-3">
                {/* Subject */}
                <div className="space-y-1">
                  <p className="text-xs text-muted-foreground">Title</p>
                  {editingSubject ? (
                    <div className="flex items-center gap-2">
                      <Input
                        value={subjectDraft}
                        onChange={e => setSubjectDraft(e.target.value)}
                        onKeyDown={e => {
                          if (e.key === 'Enter') handleSaveMeetingField('subject')
                          if (e.key === 'Escape') { setEditingSubject(false); setSubjectDraft(meeting.subject) }
                        }}
                        className="h-7 text-sm"
                        autoFocus
                        disabled={savingMeeting}
                      />
                      <Button variant="ghost" size="icon" className="h-7 w-7 shrink-0 text-green-600"
                        onClick={() => handleSaveMeetingField('subject')} disabled={savingMeeting}>
                        <Check className="h-3.5 w-3.5" />
                      </Button>
                      <Button variant="ghost" size="icon" className="h-7 w-7 shrink-0"
                        onClick={() => { setEditingSubject(false); setSubjectDraft(meeting.subject) }} disabled={savingMeeting}>
                        <X className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  ) : (
                    <div className="flex items-center gap-2 group">
                      <p className="text-sm font-medium flex-1">{meeting.subject}</p>
                      <Button variant="ghost" size="icon" className="h-6 w-6 opacity-0 group-hover:opacity-100 transition-opacity"
                        onClick={() => { setEditingSubject(true); setSubjectDraft(meeting.subject) }}>
                        <Pencil className="h-3 w-3" />
                      </Button>
                    </div>
                  )}
                </div>

                {/* Location */}
                <div className="space-y-1">
                  <p className="text-xs text-muted-foreground">Location</p>
                  {editingLocation ? (
                    <div className="flex items-center gap-2">
                      <Input
                        value={locationDraft}
                        onChange={e => setLocationDraft(e.target.value)}
                        onKeyDown={e => {
                          if (e.key === 'Enter') handleSaveMeetingField('location')
                          if (e.key === 'Escape') { setEditingLocation(false); setLocationDraft(meeting.location ?? '') }
                        }}
                        className="h-7 text-sm"
                        placeholder="No location"
                        autoFocus
                        disabled={savingMeeting}
                      />
                      <Button variant="ghost" size="icon" className="h-7 w-7 shrink-0 text-green-600"
                        onClick={() => handleSaveMeetingField('location')} disabled={savingMeeting}>
                        <Check className="h-3.5 w-3.5" />
                      </Button>
                      <Button variant="ghost" size="icon" className="h-7 w-7 shrink-0"
                        onClick={() => { setEditingLocation(false); setLocationDraft(meeting.location ?? '') }} disabled={savingMeeting}>
                        <X className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  ) : (
                    <div className="flex items-center gap-2 group">
                      <p className="text-sm flex-1 text-muted-foreground">{meeting.location || '—'}</p>
                      <Button variant="ghost" size="icon" className="h-6 w-6 opacity-0 group-hover:opacity-100 transition-opacity"
                        onClick={() => { setEditingLocation(true); setLocationDraft(meeting.location ?? '') }}>
                        <Pencil className="h-3 w-3" />
                      </Button>
                    </div>
                  )}
                </div>

                {/* Date (display only) */}
                <div className="space-y-1">
                  <p className="text-xs text-muted-foreground">Date</p>
                  <p className="text-sm">{formatDateTime(meeting.start_time)}</p>
                </div>
              </div>
            </div>
          )}

          {/* ── Section 2: Other recordings linked to this meeting ── */}
          {meeting && linkedRecordings.length > 0 && (
            <div className="space-y-2">
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground px-1">
                Other Recordings Linked to This Meeting ({linkedRecordings.length})
              </p>
              <div className="rounded-lg border divide-y">
                {linkedRecordings.map(r => (
                  <div key={r.id} className="flex items-center gap-3 px-3 py-2">
                    <div className="flex-1 min-w-0">
                      <p className="text-sm truncate">{(r as any).title || r.filename}</p>
                      <p className="text-xs text-muted-foreground">{formatDateTime(r.date_recorded)}</p>
                    </div>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7 shrink-0 text-muted-foreground hover:text-destructive"
                      title="Unlink this recording from the meeting"
                      disabled={unlinkingId === r.id}
                      onClick={() => handleUnlinkOther(r.id)}
                    >
                      <Link2Off className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* ── Section 3: Change / remove link ── */}
          <div className="space-y-2">
            {meeting && (
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground px-1">
                Change Meeting Link
              </p>
            )}

            {loading && (
              <div className="py-8 text-center text-muted-foreground">Loading...</div>
            )}

            {linkError && (
              <div className="py-4 px-3 text-sm text-destructive bg-destructive/10 rounded-md">
                {linkError}
              </div>
            )}

            {!loading && !linkError && (
              <RadioGroup
                value={selectedId || ''}
                onValueChange={setSelectedId}
                className="space-y-2"
              >
                {!hasCandidates && options.length === 0 && !meeting && (
                  <p className="text-sm text-muted-foreground italic py-4 text-center">
                    No meetings found near this recording time
                  </p>
                )}

                {!hasCandidates && options.length > 0 && (
                  <p className="text-sm text-muted-foreground mb-2">
                    {meeting ? 'Select a different meeting:' : 'No automatic match found. Select a meeting:'}
                  </p>
                )}

                {options.map((option) => (
                  <label
                    key={option.id}
                    className={cn(
                      'flex items-center gap-3 p-3 rounded-lg border cursor-pointer transition-colors',
                      'hover:bg-muted/50',
                      selectedId === option.meetingId && 'border-primary bg-primary/5'
                    )}
                  >
                    <RadioGroupItem value={option.meetingId} />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        {option.isAiSelected && (
                          <Star className="h-4 w-4 text-yellow-500 flex-shrink-0" />
                        )}
                        <span className="font-medium truncate">{option.subject}</span>
                      </div>
                      <div className="text-xs text-muted-foreground">
                        {formatTime(option.startTime)} - {formatTime(option.endTime)}
                      </div>
                      {option.matchReason && (
                        <div className="text-xs text-muted-foreground mt-1 italic truncate">
                          {option.matchReason}
                        </div>
                      )}
                    </div>
                    {hasCandidates && option.confidenceScore > 0 && (
                      <span
                        className={cn(
                          'text-xs px-2 py-0.5 rounded-full flex-shrink-0',
                          option.confidenceScore > 0.7 && 'bg-green-100 text-green-800',
                          option.confidenceScore > 0.4 &&
                            option.confidenceScore <= 0.7 &&
                            'bg-yellow-100 text-yellow-800',
                          option.confidenceScore <= 0.4 && 'bg-gray-100 text-gray-600'
                        )}
                      >
                        {Math.round(option.confidenceScore * 100)}%
                      </span>
                    )}
                  </label>
                ))}

                {/* Always show "no meeting" option */}
                <label
                  className={cn(
                    'flex items-center gap-3 p-3 rounded-lg border cursor-pointer transition-colors',
                    'hover:bg-muted/50',
                    selectedId === 'none' && 'border-primary bg-primary/5'
                  )}
                >
                  <RadioGroupItem value="none" />
                  <span className="text-muted-foreground">No meeting — standalone recording</span>
                </label>
              </RadioGroup>
            )}
          </div>
        </div>

        <DialogFooter className="flex-shrink-0">
          <Button variant="outline" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button onClick={handleSaveLink} disabled={saving || loading || selectedId === null}>
            {saving ? 'Saving...' : (meeting ? 'Change Link' : 'Confirm')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
