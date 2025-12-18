import { useEffect, useState } from 'react'
import { Star } from 'lucide-react'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group'
import { cn, formatDuration, formatTime } from '@/lib/utils'
import type { Recording, Meeting, MeetingCandidate } from '@/types'

interface RecordingLinkDialogProps {
  recording: Pick<Recording, 'id' | 'filename' | 'date_recorded' | 'duration_seconds'> | null
  open: boolean
  onClose: () => void
  onResolved: () => void
}

export function RecordingLinkDialog({
  recording,
  open,
  onClose,
  onResolved
}: RecordingLinkDialogProps) {
  const [candidates, setCandidates] = useState<MeetingCandidate[]>([])
  const [nearbyMeetings, setNearbyMeetings] = useState<Meeting[]>([])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Reset state when dialog opens/closes or recording changes
  useEffect(() => {
    if (!recording || !open) {
      setCandidates([])
      setNearbyMeetings([])
      setSelectedId(null)
      setError(null)
      return
    }

    let cancelled = false

    const loadData = async () => {
      setLoading(true)
      setError(null)

      try {
        const [candidatesResult, nearbyResult] = await Promise.all([
          window.electronAPI.recordings.getCandidates(recording.id),
          window.electronAPI.recordings.getMeetingsNearDate(recording.date_recorded)
        ])

        if (cancelled) return

        if (!candidatesResult.success) {
          setError(candidatesResult.error || 'Failed to load candidates')
          return
        }

        setCandidates(candidatesResult.data)
        setNearbyMeetings(nearbyResult.success ? nearbyResult.data : [])

        // Pre-select AI's choice if available
        const aiPick = candidatesResult.data.find((c: MeetingCandidate) => c.isAiSelected)
        if (aiPick) {
          setSelectedId(aiPick.meetingId)
        }
      } catch (err) {
        if (cancelled) return
        setError(err instanceof Error ? err.message : 'Failed to load data')
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    loadData()

    return () => {
      cancelled = true
    }
  }, [recording, open])

  const handleSave = async () => {
    if (!recording || selectedId === null) return

    setSaving(true)
    setError(null)

    try {
      const meetingId = selectedId === 'none' ? null : selectedId
      const result = await window.electronAPI.recordings.selectMeeting(recording.id, meetingId)

      if (!result.success) {
        setError(result.error || 'Failed to save')
        return
      }

      onResolved()
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save')
    } finally {
      setSaving(false)
    }
  }

  // Don't render if no recording
  if (!recording) return null

  // Unified options list: AI candidates first, then nearby meetings if orphan
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
      <DialogContent className="max-w-md max-h-[80vh] overflow-hidden flex flex-col">
        <DialogHeader>
          <DialogTitle>
            {hasCandidates ? 'Verify Recording Match' : 'Link Recording to Meeting'}
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

        <div className="flex-1 overflow-y-auto py-2">
          {loading && (
            <div className="py-8 text-center text-muted-foreground">Loading...</div>
          )}

          {error && (
            <div className="py-4 px-3 text-sm text-destructive bg-destructive/10 rounded-md">
              {error}
            </div>
          )}

          {!loading && !error && (
            <RadioGroup
              value={selectedId || ''}
              onValueChange={setSelectedId}
              className="space-y-2"
            >
              {!hasCandidates && options.length === 0 && (
                <p className="text-sm text-muted-foreground italic py-4 text-center">
                  No meetings found near this recording time
                </p>
              )}

              {!hasCandidates && options.length > 0 && (
                <p className="text-sm text-muted-foreground mb-2">
                  No automatic match found. Select a meeting:
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
                <span className="text-muted-foreground">No meeting - standalone recording</span>
              </label>
            </RadioGroup>
          )}
        </div>

        <DialogFooter className="flex-shrink-0">
          <Button variant="outline" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button onClick={handleSave} disabled={saving || loading || selectedId === null}>
            {saving ? 'Saving...' : 'Confirm'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
