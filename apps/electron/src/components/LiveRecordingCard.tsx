/**
 * LiveRecordingCard — the "Recording now" card shown at the top of the Today page
 * while the HiDock is actively capturing.
 *
 * It answers a question the user can only answer WELL in advance: which meeting
 * will this recording be attributed to? Attribution is computed from the calendar
 * meetings currently in progress:
 *   - exactly 1 in-progress → auto-attributed to it, with the option to change or
 *     mark it "not a calendar meeting" (standalone)
 *   - 2+ in-progress → the user picks which one
 *   - 0 in-progress → standalone (no calendar meeting right now)
 *
 * The choice is persisted via the `recordings:preassign` IPC keyed by the LIVE
 * device filename; when the file is later downloaded, autoLinkRecordingsToMeetings
 * honours it over time-overlap. Hidden entirely when the device is not recording.
 */

import { useCallback, useEffect, useState } from 'react'
import { Mic, CalendarClock, CircleSlash, Check, Pencil, X } from 'lucide-react'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { useAppStore } from '@/store'

export interface LiveMeeting {
  id: string
  subject: string
  start_time: string
  end_time: string
}

interface LiveRecordingCardProps {
  /** Calendar meetings currently in progress — the attribution candidates. */
  inProgressMeetings: LiveMeeting[]
  /** All of today's meetings — offered when the user explicitly reassigns. */
  allMeetings: LiveMeeting[]
}

const MONTHS: Record<string, number> = {
  jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5,
  jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11
}

/**
 * Best-effort parse of a HiDock recording start time from its filename. Supports
 * the month-name form (2025May13-160405-…) and the numeric form (20250513160405…).
 * Returns null when unrecognised (the card then omits the elapsed timer).
 */
export function parseRecordingStart(filename: string): Date | null {
  const named = filename.match(/^(\d{4})([A-Za-z]{3})(\d{2})-(\d{2})(\d{2})(\d{2})/)
  if (named) {
    const month = MONTHS[named[2].toLowerCase()]
    if (month !== undefined) {
      return new Date(+named[1], month, +named[3], +named[4], +named[5], +named[6])
    }
  }
  const numeric = filename.match(/(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})/)
  if (numeric) {
    return new Date(+numeric[1], +numeric[2] - 1, +numeric[3], +numeric[4], +numeric[5], +numeric[6])
  }
  return null
}

/** "12:04" / "1:02:04" elapsed label. */
function formatElapsed(seconds: number): string {
  if (seconds < 0) seconds = 0
  const h = Math.floor(seconds / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  const s = Math.floor(seconds % 60)
  const mm = String(m).padStart(2, '0')
  const ss = String(s).padStart(2, '0')
  return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`
}

function meetingTimeLabel(m: LiveMeeting): string {
  const fmt = (iso: string) => {
    const d = new Date(iso)
    return isNaN(d.getTime()) ? '' : d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
  }
  return `${fmt(m.start_time)}–${fmt(m.end_time)}`
}

export function LiveRecordingCard({ inProgressMeetings, allMeetings }: LiveRecordingCardProps) {
  const deviceRecording = useAppStore((s) => s.deviceRecording)
  const filename = useAppStore((s) => s.activeRecordingFilename)

  // Explicit attribution choice for this filename:
  //   undefined = none yet (fall back to the auto rule)
  //   null      = explicitly standalone
  //   string    = explicitly assigned to this meeting id
  const [selected, setSelected] = useState<string | null | undefined>(undefined)
  const [picking, setPicking] = useState(false)
  const [now, setNow] = useState(() => Date.now())

  // Live elapsed timer — the card only mounts while recording, so a 1s tick here
  // is cheap and gives an accurate "recording for" readout.
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(id)
  }, [])

  // Load any previously-saved choice whenever the active filename changes.
  useEffect(() => {
    let cancelled = false
    setPicking(false)
    setSelected(undefined)
    const api = window.electronAPI?.recordings?.getPreassignment
    if (!filename || !api) return
    ;(async () => {
      try {
        const res = await api(filename)
        if (cancelled) return
        if (res?.success && res.data) {
          setSelected(res.data.meeting_id) // string or null
        }
      } catch {
        /* leave as undefined (auto) */
      }
    })()
    return () => {
      cancelled = true
    }
  }, [filename])

  const persist = useCallback(
    (meetingId: string | null) => {
      if (!filename) return
      window.electronAPI?.recordings?.preassign?.(filename, meetingId)
    },
    [filename]
  )

  const chooseMeeting = useCallback(
    (meetingId: string) => {
      setSelected(meetingId)
      setPicking(false)
      persist(meetingId)
    },
    [persist]
  )

  const markStandalone = useCallback(() => {
    setSelected(null)
    setPicking(false)
    persist(null)
  }, [persist])

  if (!deviceRecording || !filename) return null

  const start = parseRecordingStart(filename)
  const elapsed = start ? formatElapsed((now - start.getTime()) / 1000) : null

  const findMeeting = (id: string): LiveMeeting | undefined =>
    allMeetings.find((m) => m.id === id) ?? inProgressMeetings.find((m) => m.id === id)

  // Resolve the effective attribution to render.
  const explicitMeeting = typeof selected === 'string' ? findMeeting(selected) : undefined
  const isStandalone = selected === null
  const autoSingle = selected === undefined && inProgressMeetings.length === 1 ? inProgressMeetings[0] : undefined
  const undecided = selected === undefined && inProgressMeetings.length >= 2
  const autoStandalone = selected === undefined && inProgressMeetings.length === 0

  // The candidate set to offer: while picking, every meeting today; otherwise the
  // in-progress meetings (the natural candidates for a live capture).
  const options = picking ? allMeetings : inProgressMeetings

  const renderOptions = () => (
    <div className="space-y-1.5">
      {options.map((m) => {
        const active = selected === m.id
        return (
          <button
            key={m.id}
            onClick={() => chooseMeeting(m.id)}
            className={cn(
              'w-full flex items-center gap-2 rounded-md border px-3 py-2 text-left text-sm transition-colors',
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
              active
                ? 'border-primary bg-primary/10 text-foreground'
                : 'border-border hover:bg-muted/60'
            )}
            aria-pressed={active}
          >
            <span
              className={cn(
                'flex h-4 w-4 flex-shrink-0 items-center justify-center rounded-full border',
                active ? 'border-primary bg-primary text-primary-foreground' : 'border-muted-foreground/40'
              )}
            >
              {active && <Check className="h-3 w-3" />}
            </span>
            <span className="min-w-0 flex-1 truncate font-medium">{m.subject || 'Untitled meeting'}</span>
            <span className="flex-shrink-0 text-xs text-muted-foreground">{meetingTimeLabel(m)}</span>
          </button>
        )
      })}
      <button
        onClick={markStandalone}
        className={cn(
          'w-full flex items-center gap-2 rounded-md border px-3 py-2 text-left text-sm transition-colors',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
          isStandalone ? 'border-primary bg-primary/10 text-foreground' : 'border-dashed border-border hover:bg-muted/60'
        )}
        aria-pressed={isStandalone}
      >
        <span
          className={cn(
            'flex h-4 w-4 flex-shrink-0 items-center justify-center rounded-full border',
            isStandalone ? 'border-primary bg-primary text-primary-foreground' : 'border-muted-foreground/40'
          )}
        >
          {isStandalone && <Check className="h-3 w-3" />}
        </span>
        <CircleSlash className="h-3.5 w-3.5 flex-shrink-0 text-muted-foreground" />
        <span className="min-w-0 flex-1">Not a calendar meeting (standalone)</span>
      </button>
    </div>
  )

  return (
    <Card className="border-red-500/40 bg-red-500/[0.04]" data-testid="live-recording-card">
      <CardContent className="py-4 space-y-3">
        {/* Header: live status + elapsed */}
        <div className="flex items-center gap-3">
          <span className="relative flex h-3 w-3 flex-shrink-0">
            <span className="absolute inline-flex h-full w-full rounded-full bg-red-500 opacity-75 animate-ping motion-reduce:hidden" />
            <span className="relative inline-flex h-3 w-3 rounded-full bg-red-500" />
          </span>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <Mic className="h-4 w-4 text-red-600 dark:text-red-500 flex-shrink-0" />
              <span className="text-sm font-semibold uppercase tracking-wide text-red-600 dark:text-red-500">
                Recording now
              </span>
              {elapsed && (
                <span className="text-xs font-mono text-foreground/60" aria-label="Elapsed recording time">
                  {elapsed}
                </span>
              )}
            </div>
            <div className="text-xs text-foreground/60 truncate">{filename}</div>
          </div>
        </div>

        {/* Attribution */}
        <div className="rounded-lg border bg-background/60 p-3">
          {/* Decided: explicit meeting */}
          {explicitMeeting && !picking && (
            <div className="flex items-center gap-2">
              <CalendarClock className="h-4 w-4 flex-shrink-0 text-primary" />
              <div className="min-w-0 flex-1 text-sm">
                <span className="text-muted-foreground">Will be attributed to </span>
                <span className="font-medium text-foreground">{explicitMeeting.subject || 'Untitled meeting'}</span>
              </div>
              <Button size="sm" variant="ghost" className="flex-shrink-0" onClick={() => setPicking(true)}>
                <Pencil className="h-3.5 w-3.5 mr-1" />
                Change
              </Button>
            </div>
          )}

          {/* Decided: explicit standalone */}
          {isStandalone && !picking && (
            <div className="flex items-center gap-2">
              <CircleSlash className="h-4 w-4 flex-shrink-0 text-muted-foreground" />
              <div className="min-w-0 flex-1 text-sm text-muted-foreground">
                Standalone — won&apos;t be linked to any meeting.
              </div>
              <Button size="sm" variant="ghost" className="flex-shrink-0" onClick={() => setPicking(true)}>
                <Pencil className="h-3.5 w-3.5 mr-1" />
                Change
              </Button>
            </div>
          )}

          {/* Auto: exactly one in-progress meeting */}
          {autoSingle && !picking && (
            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <CalendarClock className="h-4 w-4 flex-shrink-0 text-primary" />
                <div className="min-w-0 flex-1 text-sm">
                  <span className="text-muted-foreground">Will be attributed to </span>
                  <span className="font-medium text-foreground">{autoSingle.subject || 'Untitled meeting'}</span>
                </div>
              </div>
              <div className="flex flex-wrap gap-2 pl-6">
                <Button size="sm" variant="outline" onClick={() => setPicking(true)}>
                  <Pencil className="h-3.5 w-3.5 mr-1" />
                  Change
                </Button>
                <Button size="sm" variant="ghost" onClick={markStandalone}>
                  <CircleSlash className="h-3.5 w-3.5 mr-1" />
                  Not a calendar meeting
                </Button>
              </div>
            </div>
          )}

          {/* Undecided: two or more in-progress meetings */}
          {undecided && !picking && (
            <div className="space-y-2">
              <div className="text-sm font-medium">Which meeting is this?</div>
              {renderOptions()}
            </div>
          )}

          {/* Auto: no calendar meeting right now */}
          {autoStandalone && !picking && (
            <div className="flex items-center gap-2">
              <CircleSlash className="h-4 w-4 flex-shrink-0 text-muted-foreground" />
              <div className="min-w-0 flex-1 text-sm text-muted-foreground">
                No calendar meeting right now — will be standalone.
              </div>
              {allMeetings.length > 0 && (
                <Button size="sm" variant="ghost" className="flex-shrink-0" onClick={() => setPicking(true)}>
                  <Pencil className="h-3.5 w-3.5 mr-1" />
                  Assign
                </Button>
              )}
            </div>
          )}

          {/* Picker mode */}
          {picking && (
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <div className="text-sm font-medium">Attribute this recording to…</div>
                <Button size="sm" variant="ghost" onClick={() => setPicking(false)}>
                  <X className="h-3.5 w-3.5" />
                </Button>
              </div>
              {options.length === 0 ? (
                <div className="text-xs text-muted-foreground">No meetings today. It will be standalone.</div>
              ) : (
                renderOptions()
              )}
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  )
}

export default LiveRecordingCard
