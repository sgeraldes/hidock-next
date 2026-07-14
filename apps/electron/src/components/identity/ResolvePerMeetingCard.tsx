import { useCallback, useEffect, useState } from 'react'
import { ChevronDown, ChevronRight, Users, Check, HelpCircle, Mic, CalendarCheck, MessageSquare, Link2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { cn, formatDate } from '@/lib/utils'
import { RecordingLinkDialog } from '@/components/RecordingLinkDialog'
import type { AmbiguousBucketSummary, BucketRecording, BucketResolution } from './useAmbiguousBuckets'
import { groupBucketRecordings, assignedCandidateId } from './bucketGrouping'

const UNCLEAR_VALUE = '__unclear__'

/** One-line description of a bucket's real candidates: "Sergio Hurtado or Sergio Reyes (or others)". */
function candidateSummary(candidates: Array<{ name: string }>): string {
  const names = candidates.map((c) => c.name)
  if (names.length === 0) return 'several people'
  if (names.length === 1) return names[0]
  if (names.length === 2) return `${names[0]} or ${names[1]}`
  return `${names[0]}, ${names[1]} (or others)`
}

/** Icon for the signal behind a best guess (mirrors the signal-tier hierarchy). */
function SignalIcon({ method }: { method: BucketRecording['method'] }) {
  if (method === 'speaker-map') return <Mic className="h-3 w-3 flex-shrink-0" aria-hidden />
  if (method === 'attendee-email') return <CalendarCheck className="h-3 w-3 flex-shrink-0" aria-hidden />
  if (method === 'attendee-context') return <MessageSquare className="h-3 w-3 flex-shrink-0" aria-hidden />
  return <HelpCircle className="h-3 w-3 flex-shrink-0" aria-hidden />
}

/** A single recording row: signal, and either a per-recording assignment select or,
 *  when the recording isn't linked to a meeting, a "Link to meeting" action first. */
function RecordingRow({
  rec,
  candidates,
  onAssign,
  onOpenRecording,
  onLink,
  busy
}: {
  rec: BucketRecording
  candidates: Array<{ id: string; name: string }>
  onAssign: (rec: BucketRecording, contactId: string | null) => void
  onOpenRecording: (recordingId: string) => void
  onLink: (rec: BucketRecording) => void
  busy: boolean
}) {
  const current = assignedCandidateId(rec) ?? UNCLEAR_VALUE
  return (
    <div className="flex items-center gap-2 py-1.5">
      <button
        type="button"
        onClick={() => onOpenRecording(rec.recordingId)}
        className="min-w-0 flex-1 text-left group"
        aria-label={`Open recording: ${rec.title}`}
      >
        <div className="truncate text-xs font-medium group-hover:underline">{rec.title}</div>
        <div className="flex items-center gap-1 text-[10px] text-muted-foreground">
          <SignalIcon method={rec.method} />
          <span className="truncate">
            {rec.signal}
            {rec.date ? ` · ${formatDate(rec.date)}` : ''}
          </span>
        </div>
      </button>
      {!rec.meetingLinked ? (
        // Linkage is upstream of identity — offer to link the recording to its meeting first.
        <Button
          size="sm"
          variant="outline"
          className="h-7 text-[11px]"
          disabled={busy}
          onClick={() => onLink(rec)}
          aria-label={`Link '${rec.title}' to its meeting`}
        >
          <Link2 className="h-3 w-3 mr-1" />
          Link to meeting
        </Button>
      ) : (
        <select
          value={current}
          disabled={busy}
          onChange={(e) => onAssign(rec, e.target.value === UNCLEAR_VALUE ? null : e.target.value)}
          aria-label={`Assign '${rec.title}' to a person`}
          className="h-7 max-w-[9rem] rounded-md border bg-background px-1.5 text-xs outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          {candidates.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
          <option value={UNCLEAR_VALUE}>Unclear</option>
        </select>
      )}
      {rec.resolved && rec.resolvedContactId && (
        <Check className="h-3.5 w-3.5 flex-shrink-0 text-emerald-500" aria-label="Resolved" />
      )}
    </div>
  )
}

/**
 * "Resolve per meeting" card for an ambiguous mention bucket. A bare first name that
 * denotes several real people is NOT merged; instead each recording's mention is
 * pinned to the person it means. Recordings are grouped by the system's best guess
 * (with the signal shown) so the common case is one click: "Assign all N to <person>".
 */
export function ResolvePerMeetingCard({
  bucket,
  fetchResolution,
  resolve,
  onOpenRecording,
  onResolved
}: {
  bucket: AmbiguousBucketSummary
  fetchResolution: (contactId: string) => Promise<BucketResolution | null>
  resolve: (recordingId: string, sourceName: string, contactId: string | null, method?: string) => Promise<boolean>
  onOpenRecording: (recordingId: string) => void
  onResolved: () => void
}) {
  const [expanded, setExpanded] = useState(false)
  const [resolution, setResolution] = useState<BucketResolution | null>(null)
  const [loading, setLoading] = useState(false)
  const [busy, setBusy] = useState(false)
  const [linkTarget, setLinkTarget] = useState<BucketRecording | null>(null)

  const refresh = useCallback(async () => {
    setLoading(true)
    const r = await fetchResolution(bucket.contactId)
    setResolution(r)
    setLoading(false)
  }, [bucket.contactId, fetchResolution])

  useEffect(() => {
    if (expanded && !resolution) void refresh()
  }, [expanded, resolution, refresh])

  const assignOne = useCallback(
    async (rec: BucketRecording, contactId: string | null) => {
      if (!resolution) return
      setBusy(true)
      const ok = await resolve(rec.recordingId, resolution.name, contactId, 'manual')
      setBusy(false)
      if (ok) {
        await refresh()
        onResolved()
      }
    },
    [resolution, resolve, refresh, onResolved]
  )

  const assignGroup = useCallback(
    async (recordings: BucketRecording[], contactId: string) => {
      if (!resolution) return
      setBusy(true)
      for (const rec of recordings) {
        await resolve(rec.recordingId, resolution.name, contactId, 'manual')
      }
      setBusy(false)
      await refresh()
      onResolved()
    },
    [resolution, resolve, refresh, onResolved]
  )

  const groups = resolution ? groupBucketRecordings(resolution) : []
  const candidates = resolution?.candidates ?? bucket.candidates
  // Honest state: with no calendar attendee data anywhere, the guesses are transcript-
  // derived. Say so and point at the M365 connector instead of implying certainty.
  const anyCalendarAttendees = !!resolution?.recordings.some((r) => r.meetingHasCalendarAttendees)
  const showNoCalendarNote = !!resolution && resolution.recordings.length > 0 && !anyCalendarAttendees

  return (
    <Card className="border-blue-500/20 bg-blue-500/[0.03]">
      <CardContent className="p-4 space-y-3">
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="flex w-full items-start gap-2 text-left"
          aria-expanded={expanded}
        >
          {expanded ? (
            <ChevronDown className="h-4 w-4 mt-0.5 flex-shrink-0 text-muted-foreground" />
          ) : (
            <ChevronRight className="h-4 w-4 mt-0.5 flex-shrink-0 text-muted-foreground" />
          )}
          <Users className="h-4 w-4 mt-0.5 flex-shrink-0 text-blue-500" />
          <div className="min-w-0 flex-1">
            <p className="text-sm leading-snug">
              <span className="font-semibold">&lsquo;{bucket.name}&rsquo;</span> appears in {bucket.recordingCount}{' '}
              recording{bucket.recordingCount === 1 ? '' : 's'} and may be{' '}
              <span className="font-medium">{candidateSummary(bucket.candidates)}</span>.
            </p>
            <p className="text-xs text-muted-foreground">
              {bucket.resolvedCount} resolved · {bucket.pendingCount} pending — resolve per meeting, not by merging.
            </p>
          </div>
        </button>

        {expanded && (
          <div className="space-y-3 pl-1">
            {loading && <p className="text-xs text-muted-foreground">Loading recordings…</p>}
            {!loading && groups.length === 0 && (
              <p className="text-xs text-muted-foreground">No linked recordings to resolve.</p>
            )}
            {showNoCalendarNote && (
              <div className="flex items-start gap-2 rounded-md border border-amber-500/30 bg-amber-500/[0.06] px-2.5 py-1.5 text-[11px] text-amber-700 dark:text-amber-300">
                <CalendarCheck className="h-3.5 w-3.5 flex-shrink-0 mt-0.5" aria-hidden />
                <span>
                  No calendar attendee lists yet — guesses below are from transcript context. Connect Microsoft 365 for
                  automatic, attendee-based resolution.
                </span>
              </div>
            )}
            {!loading &&
              groups.map((group) => {
                const isUnclear = group.candidateId === null
                const unresolvedInGroup = group.recordings.filter((r) => !r.resolved)
                return (
                  <div
                    key={group.candidateId ?? '__unclear__'}
                    className={cn(
                      'rounded-lg border p-2.5',
                      isUnclear ? 'border-border bg-muted/30' : 'border-emerald-500/25 bg-emerald-500/[0.04]'
                    )}
                  >
                    <div className="mb-1.5 flex items-center justify-between gap-2">
                      <span className="text-xs font-semibold">
                        {isUnclear ? 'Unclear' : `Likely ${group.candidateName}`}
                        <span className="ml-1 font-normal text-muted-foreground">
                          ({group.recordings.length})
                        </span>
                      </span>
                      {!isUnclear && group.candidateId && unresolvedInGroup.length > 0 && (
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-6 text-[11px]"
                          disabled={busy}
                          onClick={() => assignGroup(unresolvedInGroup, group.candidateId as string)}
                          aria-label={`Assign all ${unresolvedInGroup.length} to ${group.candidateName}`}
                        >
                          <Check className="h-3 w-3 mr-1" />
                          Assign all {unresolvedInGroup.length} to {group.candidateName}
                        </Button>
                      )}
                    </div>
                    <div className="divide-y divide-border/60">
                      {group.recordings.map((rec) => (
                        <RecordingRow
                          key={rec.recordingId}
                          rec={rec}
                          candidates={candidates}
                          onAssign={assignOne}
                          onOpenRecording={onOpenRecording}
                          onLink={setLinkTarget}
                          busy={busy}
                        />
                      ))}
                    </div>
                  </div>
                )
              })}
          </div>
        )}
      </CardContent>

      <RecordingLinkDialog
        recording={
          linkTarget
            ? { id: linkTarget.recordingId, filename: linkTarget.title, date_recorded: linkTarget.date ?? '', duration_seconds: 0 }
            : null
        }
        open={!!linkTarget}
        onClose={() => setLinkTarget(null)}
        onResolved={() => {
          setLinkTarget(null)
          void refresh()
          onResolved()
        }}
      />
    </Card>
  )
}

export default ResolvePerMeetingCard
