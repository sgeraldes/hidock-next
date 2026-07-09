import { Fragment, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  Sun,
  Sparkles,
  ListTodo,
  Bot,
  FileText,
  ArrowRight,
  RefreshCw,
  Terminal,
  Clock,
  BookOpen,
  Video,
  Mic,
  ChevronRight,
  CheckCircle2,
  Info,
  Settings as SettingsIcon
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { EntityMention, MeetingHoverCard, meetingHoverWillHaveContent } from '@/components/entity'
import { HoverCard, HoverCardTrigger, HoverCardContent } from '@/components/ui/hover-card'
import { TodayIdentitySuggestions } from '@/components/identity/TodayIdentitySuggestions'
import { LiveRecordingCard, parseRecordingStart } from '@/components/LiveRecordingCard'
import { cn } from '@/lib/utils'
import { firstMeaningfulLine } from '@/lib/description-format'
import { useAppStore } from '@/store'
import { fetchMeetingParticipants, participantFirstName } from '@/lib/meeting-participants'
import {
  classifyMeetingTimings,
  formatMinutesLeft,
  formatMinutesUntil,
  formatMinutesSinceEnd,
  recordingOverlapsMeeting,
  allDayMeetingOnLocalDate,
  meetingZone,
  groupEarlierMeetings,
  categorizeMeeting,
  MEETING_CATEGORY_LABELS,
  type MeetingTiming,
  type MeetingCategory,
  type RecordingSpan
} from '@/lib/meeting-timing'
import type { Contact } from '@/types'

const TODAY_PARTICIPANT_LIMIT = 4

interface BriefingMeeting {
  id: string
  subject: string
  start_time: string
  end_time: string
  location?: string
  description?: string
  meeting_url?: string
  organizer_name?: string
  is_all_day?: number
  all_day_date?: string | null
}

/** A meeting is "online" when it carries a join URL or a Teams/Zoom-style location. */
function isOnlineMeeting(m: BriefingMeeting): boolean {
  if (m.meeting_url) return true
  const loc = m.location?.toLowerCase() ?? ''
  return /teams|zoom|meet\.google|webex|http/.test(loc)
}

interface BriefingRecentItem {
  recordingId: string
  title: string
  filename?: string
  dateRecorded?: string
  summary?: string
  actionItems: string[]
  wordCount?: number
}

interface BriefingActionable {
  id: string
  type: string
  title: string
  description?: string
  suggestedTemplate?: string
  sourceKnowledgeId: string
  confidence?: number
  createdAt?: string
}

interface BriefingData {
  todayMeetings: BriefingMeeting[]
  recentKnowledge: BriefingRecentItem[]
  pendingActionables: BriefingActionable[]
  calendar: { configured: boolean; syncEnabled: boolean; lastSyncAt: string | null }
  stats: { transcribedCount: number; indexedChunks: number; pendingActionables: number }
}

/** Semantic category → dot color (a data dimension the eye can read). */
const CATEGORY_DOT: Record<MeetingCategory, string> = {
  recurring: 'bg-sky-500',
  one_on_one: 'bg-violet-500',
  external: 'bg-amber-500',
  personal: 'bg-emerald-500',
  general: 'bg-slate-400 dark:bg-slate-500'
}
/** Category → tinted time-chip (carries the color without a thick side border). */
const CATEGORY_CHIP: Record<MeetingCategory, string> = {
  recurring: 'bg-sky-500/10 text-sky-700 dark:text-sky-300',
  one_on_one: 'bg-violet-500/10 text-violet-700 dark:text-violet-300',
  external: 'bg-amber-500/10 text-amber-700 dark:text-amber-300',
  personal: 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300',
  general: 'bg-slate-500/10 text-slate-600 dark:text-slate-300'
}
const CATEGORY_ORDER: MeetingCategory[] = ['recurring', 'one_on_one', 'external', 'personal', 'general']

function greeting(): string {
  const h = new Date().getHours()
  if (h < 12) return 'Good morning'
  if (h < 19) return 'Good afternoon'
  return 'Good evening'
}

function formatTime(iso?: string): string {
  if (!iso) return ''
  const d = new Date(iso)
  return isNaN(d.getTime()) ? '' : d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}

function formatClock(d: Date): string {
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}

function formatDay(iso?: string): string {
  if (!iso) return ''
  const d = new Date(iso)
  return isNaN(d.getTime()) ? '' : d.toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' })
}

// ── Shared, stateless ribbon primitives (module scope: stable identity) ───────

const RelativeBadge = ({ vm, subtle }: { vm: MeetingVM; subtle?: boolean }) => {
  if (vm.cancelled) return null
  if (!(vm.inProgress || vm.ranOver || vm.timing.state === 'upcoming')) return null
  return (
    <span
      className={cn(
        'flex items-center gap-1.5 text-xs whitespace-nowrap rounded-full px-2 py-0.5 flex-shrink-0',
        vm.runningOver
          ? 'bg-red-500/10 text-red-600 dark:text-red-400 font-medium'
          : vm.inProgress || vm.isHero || vm.timing.isNextUp
            ? 'bg-primary/10 text-primary font-medium'
            : subtle
              ? 'text-foreground/45'
              : 'text-foreground/55'
      )}
    >
      {(vm.inProgress || vm.runningOver) && (
        <span
          className={cn(
            'h-1.5 w-1.5 rounded-full flex-shrink-0 animate-pulse motion-reduce:animate-none',
            vm.recording || vm.runningOver ? 'bg-red-500' : 'bg-primary'
          )}
        />
      )}
      <span key={vm.badgeLabel} className="animate-in fade-in duration-300 motion-reduce:animate-none">
        {vm.badgeLabel}
      </span>
    </span>
  )
}

const RecordingMic = ({ vm }: { vm: MeetingVM }) =>
  vm.hasRecording ? (
    <Mic className="h-3.5 w-3.5 text-emerald-600 dark:text-emerald-500 flex-shrink-0" aria-label="Recording linked" />
  ) : vm.recordedOnDevice ? (
    <span
      className="flex items-center gap-1 flex-shrink-0 text-amber-600 dark:text-amber-500"
      aria-label="Recorded — on device, not yet downloaded"
    >
      <Mic className="h-3.5 w-3.5" />
      <span className="text-[10px] font-medium whitespace-nowrap">recorded · on device</span>
    </span>
  ) : null

const RecordingChip = ({ vm }: { vm: MeetingVM }) =>
  vm.recording || vm.runningOver ? (
    <span
      className="flex items-center gap-1 flex-shrink-0 rounded-full bg-red-500/10 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-red-600 dark:text-red-400"
      aria-label="Recording in progress"
    >
      <span className="h-1.5 w-1.5 rounded-full bg-red-500 animate-pulse motion-reduce:animate-none" />
      Recording
    </span>
  ) : null

/**
 * Inline node dot carrying the meeting's semantic category color — the leading
 * element of every ribbon item, forming a vertical "spine" of colored dots that
 * reads as a timeline without fragile absolute positioning.
 */
const CategoryDot = ({ vm, className }: { vm: MeetingVM; className?: string }) => (
  <span
    className={cn(
      'flex-shrink-0 rounded-full',
      CATEGORY_DOT[vm.category],
      vm.dimmed && 'opacity-50',
      className
    )}
    aria-hidden="true"
  />
)

/** Everything the ribbon needs to render one meeting, derived once. */
interface MeetingVM {
  m: BriefingMeeting
  timing: MeetingTiming
  category: MeetingCategory
  names: string[]
  extra: number
  secondary: string
  online: boolean
  hasRecording: boolean
  recordedOnDevice: boolean
  recording: boolean
  runningOver: boolean
  cancelled: boolean
  inProgress: boolean
  ranOver: boolean
  dimmed: boolean
  badgeLabel: string
  isHero: boolean
}

export function Today() {
  const navigate = useNavigate()
  const [data, setData] = useState<BriefingData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [participantsByMeeting, setParticipantsByMeeting] = useState<Record<string, Contact[]>>({})
  const [recordingByMeeting, setRecordingByMeeting] = useState<Record<string, boolean>>({})
  const [recordedOnDeviceByMeeting, setRecordedOnDeviceByMeeting] = useState<Record<string, boolean>>({})
  // Which earlier-group capsules the user has expanded (keyed by block start ms).
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set())

  const deviceRecording = useAppStore((s) => s.deviceRecording)
  const activeRecordingFilename = useAppStore((s) => s.activeRecordingFilename)

  // Live clock so relative badges, zone classification, and the now-line stay
  // accurate; ticks every 15s. Chromium throttles setInterval in a backgrounded
  // renderer, so we also refresh on visibilitychange/focus — which additionally
  // re-anchors the ribbon on the now-line when the user returns to the page.
  const [now, setNow] = useState(() => new Date())

  const scrollRef = useRef<HTMLDivElement>(null)
  const nowLineRef = useRef<HTMLDivElement>(null)

  /** Bring the now-line to ~30% from the top of the scroll viewport. */
  const anchorToNow = useCallback((smooth: boolean) => {
    const sc = scrollRef.current
    const nl = nowLineRef.current
    if (!sc || !nl || typeof sc.scrollTo !== 'function') return
    try {
      const scRect = sc.getBoundingClientRect()
      const nlRect = nl.getBoundingClientRect()
      const target = sc.scrollTop + (nlRect.top - scRect.top) - sc.clientHeight * 0.3
      const prefersReduced =
        typeof window !== 'undefined' &&
        typeof window.matchMedia === 'function' &&
        window.matchMedia('(prefers-reduced-motion: reduce)').matches
      sc.scrollTo({ top: Math.max(0, target), behavior: smooth && !prefersReduced ? 'smooth' : 'auto' })
    } catch {
      /* jsdom / unsupported — no-op */
    }
  }, [])

  useEffect(() => {
    const tick = () => setNow(new Date())
    const id = setInterval(tick, 15_000)
    const onVisible = () => {
      if (!document.hidden) {
        tick()
        // Returning to the page re-anchors on NOW (don't yank while reading).
        requestAnimationFrame(() => anchorToNow(true))
      }
    }
    const onFocus = () => {
      tick()
      requestAnimationFrame(() => anchorToNow(true))
    }
    document.addEventListener('visibilitychange', onVisible)
    window.addEventListener('focus', onFocus)
    return () => {
      clearInterval(id)
      document.removeEventListener('visibilitychange', onVisible)
      window.removeEventListener('focus', onFocus)
    }
  }, [anchorToNow])

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await window.electronAPI.briefing.get()
      if (res.success && res.data) {
        setData(res.data as BriefingData)
      } else {
        setError(res.error || 'Failed to load briefing')
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load briefing')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    load()
  }, [load])

  // Refetch when a calendar sync completes (debounced).
  useEffect(() => {
    const onDomainEvent = window.electronAPI?.onDomainEvent
    if (!onDomainEvent) return
    let timer: ReturnType<typeof setTimeout> | null = null
    const unsubscribe = onDomainEvent((event: { type?: string }) => {
      if (event?.type !== 'calendar:synced') return
      if (timer) clearTimeout(timer)
      timer = setTimeout(() => {
        timer = null
        load()
      }, 300)
    })
    return () => {
      if (timer) clearTimeout(timer)
      unsubscribe?.()
    }
  }, [load])

  const todayMeetings = data?.todayMeetings

  // Participants for today's meetings (parallel, failure-tolerant).
  useEffect(() => {
    if (!todayMeetings || todayMeetings.length === 0) {
      setParticipantsByMeeting({})
      return
    }
    let cancelled = false
    ;(async () => {
      const entries = await Promise.all(
        todayMeetings.map(async (m) => [m.id, await fetchMeetingParticipants(m.id)] as const)
      )
      if (!cancelled) setParticipantsByMeeting(Object.fromEntries(entries))
    })()
    return () => {
      cancelled = true
    }
  }, [todayMeetings])

  // Which meetings already have a linked recording (green mic).
  useEffect(() => {
    if (!todayMeetings || todayMeetings.length === 0) {
      setRecordingByMeeting({})
      return
    }
    const getForMeeting = window.electronAPI?.recordings?.getForMeeting
    if (!getForMeeting) {
      setRecordingByMeeting({})
      return
    }
    let cancelled = false
    ;(async () => {
      const entries = await Promise.all(
        todayMeetings.map(async (m) => {
          try {
            const recs = await getForMeeting(m.id)
            return [m.id, Array.isArray(recs) && recs.length > 0] as const
          } catch {
            return [m.id, false] as const
          }
        })
      )
      if (!cancelled) setRecordingByMeeting(Object.fromEntries(entries))
    })()
    return () => {
      cancelled = true
    }
  }, [todayMeetings])

  // Which meetings were recorded on-device but not yet downloaded (amber mic).
  useEffect(() => {
    if (!todayMeetings || todayMeetings.length === 0) {
      setRecordedOnDeviceByMeeting({})
      return
    }
    const getAll = window.electronAPI?.deviceCache?.getAll
    if (!getAll) {
      setRecordedOnDeviceByMeeting({})
      return
    }
    let cancelled = false
    ;(async () => {
      try {
        const cached = await getAll()
        if (cancelled) return
        const spans: RecordingSpan[] = (Array.isArray(cached) ? cached : [])
          .map((c: { filename?: string; duration?: number }) => {
            const start = parseRecordingStart(String(c?.filename ?? ''))
            if (!start) return null
            const startMs = start.getTime()
            const durationSec = Number(c?.duration) || 0
            return { startMs, endMs: startMs + durationSec * 1000 }
          })
          .filter((s): s is RecordingSpan => s !== null)
        const map: Record<string, boolean> = {}
        for (const meeting of todayMeetings) {
          map[meeting.id] = spans.some((s) => recordingOverlapsMeeting(s, meeting))
        }
        if (!cancelled) setRecordedOnDeviceByMeeting(map)
      } catch {
        if (!cancelled) setRecordedOnDeviceByMeeting({})
      }
    })()
    return () => {
      cancelled = true
    }
  }, [todayMeetings])

  const timings = useMemo(
    () => classifyMeetingTimings(data?.todayMeetings ?? [], now),
    [data?.todayMeetings, now]
  )

  // All-day / holiday events render as a slim banner, never as timed rows.
  const allDayMeetings = (data?.todayMeetings ?? []).filter(
    (m) => timings.get(m.id)?.state === 'all_day' && allDayMeetingOnLocalDate(m, now)
  )
  const timedMeetings = (data?.todayMeetings ?? []).filter((m) => timings.get(m.id)?.state !== 'all_day')

  const recordingStart =
    deviceRecording && activeRecordingFilename ? parseRecordingStart(activeRecordingFilename) : null

  const recordingStartedDuring = useCallback(
    (m: BriefingMeeting): boolean => {
      if (!recordingStart) return false
      const start = new Date(m.start_time).getTime()
      const end = new Date(m.end_time).getTime()
      if (!Number.isFinite(start) || !Number.isFinite(end)) return false
      const t = recordingStart.getTime()
      return t >= start && t <= end
    },
    [recordingStart]
  )

  // Attribution candidates for the live "Recording now" card.
  const attributionCandidates = [
    ...(data?.todayMeetings ?? []).filter((m) => timings.get(m.id)?.state === 'in_progress'),
    ...(data?.todayMeetings ?? []).filter(
      (m) => timings.get(m.id)?.state === 'ran_over' && recordingStartedDuring(m)
    )
  ]

  // Build a view-model per timed meeting, then split into ribbon zones.
  const buildVM = useCallback(
    (m: BriefingMeeting): MeetingVM => {
      const timing = timings.get(m.id)!
      const people = participantsByMeeting[m.id] ?? []
      const names = people.slice(0, TODAY_PARTICIPANT_LIMIT).map(participantFirstName)
      const extra = people.length - names.length
      const cancelled = timing.state === 'cancelled'
      const inProgress = timing.state === 'in_progress'
      const ranOver = timing.state === 'ran_over'
      const isFocus = timing.isFocus ?? false
      const online = isOnlineMeeting(m)
      const hasRecording = !!recordingByMeeting[m.id]
      const recordedOnDevice = !hasRecording && !!recordedOnDeviceByMeeting[m.id]
      const recording = inProgress && isFocus && deviceRecording
      const runningOver = ranOver && deviceRecording && recordingStartedDuring(m)
      const secondary =
        names.length > 0
          ? `${names.join(', ')}${extra > 0 ? ` +${extra}` : ''}`
          : firstMeaningfulLine(m.description) || m.location || ''
      const badgeLabel = inProgress
        ? formatMinutesLeft(timing.minutes ?? 0)
        : ranOver
          ? runningOver
            ? 'Running over · recording continues'
            : formatMinutesSinceEnd(timing.minutes ?? 0)
          : formatMinutesUntil(timing.minutes ?? 0)
      const category = categorizeMeeting({ subject: m.subject, attendeeCount: people.length || undefined })
      return {
        m,
        timing,
        category,
        names,
        extra,
        secondary,
        online,
        hasRecording,
        recordedOnDevice,
        recording,
        runningOver,
        cancelled,
        inProgress,
        ranOver,
        dimmed: timing.state === 'past' || cancelled,
        badgeLabel,
        isHero: isFocus
      }
    },
    [
      timings,
      participantsByMeeting,
      recordingByMeeting,
      recordedOnDeviceByMeeting,
      deviceRecording,
      recordingStartedDuring
    ]
  )

  const byStart = (a: BriefingMeeting, b: BriefingMeeting) =>
    new Date(a.start_time).getTime() - new Date(b.start_time).getTime()

  const zoned = useMemo(() => {
    const sorted = [...timedMeetings].sort(byStart)
    const earlier: BriefingMeeting[] = []
    const recent: BriefingMeeting[] = []
    const focus: BriefingMeeting[] = []
    const later: BriefingMeeting[] = []
    for (const m of sorted) {
      switch (meetingZone(m, now)) {
        case 'earlier':
          earlier.push(m)
          break
        case 'recent':
          recent.push(m)
          break
        case 'later':
          later.push(m)
          break
        default:
          focus.push(m)
      }
    }
    return { earlier, recent, focus, later }
  }, [timedMeetings, now])

  const earlierGroups = useMemo(() => groupEarlierMeetings(zoned.earlier), [zoned.earlier])

  const recordedSet = useMemo(() => {
    const s = new Set<string>()
    for (const m of timedMeetings) {
      if (recordingByMeeting[m.id] || recordedOnDeviceByMeeting[m.id]) s.add(m.id)
    }
    return s
  }, [timedMeetings, recordingByMeeting, recordedOnDeviceByMeeting])

  // Re-anchor on the now-line once meetings are laid out (and whenever the set
  // of visible meetings changes materially).
  const ribbonSignature = `${zoned.earlier.length}:${zoned.recent.length}:${zoned.focus.length}:${zoned.later.length}`
  useEffect(() => {
    if (!data?.calendar.configured) return
    const id = requestAnimationFrame(() => anchorToNow(false))
    return () => cancelAnimationFrame(id)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ribbonSignature, data?.calendar.configured])

  const latest = data?.recentKnowledge[0]

  const generateFor = (sourceId: string, templateId: string) => {
    navigate('/actionables', { state: { sourceId, action: 'generate', templateId } })
  }

  const toggleGroup = (key: string) =>
    setExpandedGroups((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })

  // ── Row builders (close over navigate + ribbon state) ─────────────────────

  const withHover = (m: BriefingMeeting, node: ReactNode) =>
    meetingHoverWillHaveContent(m, ['title', 'time']) ? (
      <HoverCard key={m.id}>
        <HoverCardTrigger asChild>{node}</HoverCardTrigger>
        <HoverCardContent align="start">
          <MeetingHoverCard id={m.id} name={m.subject} visibleFields={['title', 'time']} />
        </HoverCardContent>
      </HoverCard>
    ) : (
      <Fragment key={m.id}>{node}</Fragment>
    )

  // ── Focus card (full richness; hero = current/next) ───────────────────────
  const FocusCard = (vm: MeetingVM, index: number) => {
    const { m } = vm
    const node = (
      <button
        onClick={() => navigate(`/meeting/${m.id}`)}
        data-testid="focus-card"
        data-hero={vm.isHero ? 'true' : 'false'}
        style={{ animationDelay: `${Math.min(index, 6) * 45}ms` }}
        className={cn(
          'group animate-rise-in lift w-full rounded-xl border bg-card p-4 text-left',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
          vm.isHero
            ? 'border-primary/40 shadow-lg ring-1 ring-primary/15'
            : 'border-border/70 shadow-sm dark:border-white/[0.06]',
          vm.runningOver && 'border-red-500/40 ring-1 ring-red-500/15',
          vm.dimmed && 'opacity-70'
        )}
      >
        <div className="flex items-start gap-3">
          <CategoryDot vm={vm} className={cn('mt-2', vm.isHero ? 'h-3 w-3' : 'h-2.5 w-2.5')} />
          {/* Time chip carries the category tint. */}
          <span
            className={cn(
              'mt-0.5 flex-shrink-0 rounded-md px-2 py-1 text-xs font-semibold tabular-nums',
              CATEGORY_CHIP[vm.category],
              vm.cancelled && 'line-through opacity-70'
            )}
          >
            {formatTime(m.start_time)}
            <span className="mx-0.5 opacity-50">–</span>
            {formatTime(m.end_time)}
          </span>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-1.5">
              <span
                className={cn(
                  'font-semibold text-foreground',
                  vm.isHero ? 'text-base' : 'text-sm',
                  vm.cancelled && 'line-through text-foreground/70'
                )}
              >
                {m.subject}
              </span>
              {vm.online && (
                <Video className="h-3.5 w-3.5 text-foreground/50 flex-shrink-0" aria-label="Online meeting" />
              )}
              <RecordingMic vm={vm} />
              <RecordingChip vm={vm} />
            </div>
            {vm.secondary && (
              <div className="mt-0.5 text-xs text-foreground/60 truncate">{vm.secondary}</div>
            )}
            {/* Hero surfaces a join affordance directly. */}
            {vm.isHero && vm.online && (m.meeting_url || vm.inProgress) && (
              <div className="mt-3">
                <span className="inline-flex h-8 items-center gap-1.5 rounded-md bg-primary px-3 text-xs font-medium text-primary-foreground shadow-sm transition-colors group-hover:bg-primary/90">
                  <Video className="h-3.5 w-3.5" />
                  {vm.inProgress ? 'Join now' : 'Join meeting'}
                </span>
              </div>
            )}
          </div>
          <div className="flex-shrink-0 self-center">
            <RelativeBadge vm={vm} />
          </div>
        </div>
      </button>
    )
    return withHover(m, node)
  }

  // ── Recent row (ended within the hour) — slim + faded; running-over stays hot ─
  const RecentRow = (vm: MeetingVM, index: number) => {
    const { m } = vm
    const node = (
      <button
        onClick={() => navigate(`/meeting/${m.id}`)}
        data-testid="recent-row"
        style={{ animationDelay: `${Math.min(index, 6) * 40}ms` }}
        className={cn(
          'group animate-rise-in flex w-full items-center gap-3 rounded-lg border px-3 py-2 text-left transition-colors',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring hover:bg-muted/50',
          vm.runningOver
            ? 'border-red-500/40 bg-red-500/[0.05] ring-1 ring-red-500/10'
            : 'border-transparent',
          !vm.runningOver && 'opacity-70 hover:opacity-100'
        )}
      >
        <CategoryDot vm={vm} className="h-2 w-2" />
        <span className="w-20 flex-shrink-0 text-xs font-medium tabular-nums text-foreground/55">
          {formatTime(m.start_time)}
        </span>
        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-1.5">
            <span className="truncate text-sm text-foreground/80">{m.subject}</span>
            <RecordingMic vm={vm} />
            <RecordingChip vm={vm} />
          </span>
        </span>
        <RelativeBadge vm={vm} subtle />
      </button>
    )
    return withHover(m, node)
  }

  // ── Later row (>2h ahead) — compact single line; grows into a card in time ──
  const LaterRow = (vm: MeetingVM, index: number) => {
    const { m } = vm
    const node = (
      <button
        onClick={() => navigate(`/meeting/${m.id}`)}
        data-testid="later-row"
        style={{ animationDelay: `${Math.min(index, 6) * 40}ms` }}
        className={cn(
          'group animate-rise-in flex w-full items-center gap-3 rounded-lg border border-transparent px-3 py-1.5 text-left transition-colors',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring hover:bg-muted/50',
          vm.cancelled && 'opacity-60'
        )}
      >
        <CategoryDot vm={vm} className="h-2 w-2 opacity-70" />
        <span className="w-20 flex-shrink-0 text-xs font-medium tabular-nums text-foreground/50">
          {formatTime(m.start_time)}
        </span>
        <span
          className={cn(
            'min-w-0 flex-1 truncate text-sm text-foreground/65',
            vm.cancelled && 'line-through'
          )}
        >
          {m.subject}
        </span>
        {vm.online && <Video className="h-3.5 w-3.5 flex-shrink-0 text-foreground/40" aria-label="Online meeting" />}
        <RecordingMic vm={vm} />
        <RelativeBadge vm={vm} subtle />
      </button>
    )
    return withHover(m, node)
  }

  // ── Earlier group capsule (collapsed block of >1h-old meetings) ────────────
  const GroupCapsule = (group: { meetings: BriefingMeeting[]; label: string; startMs: number; endMs: number }) => {
    const key = String(group.startMs)
    const expanded = expandedGroups.has(key)
    const recordedCount = group.meetings.filter((m) => recordedSet.has(m.id)).length
    return (
      <div key={key}>
        <button
          onClick={() => toggleGroup(key)}
          aria-expanded={expanded}
          data-testid="group-capsule"
          className="group flex w-full items-center gap-2 rounded-lg border border-transparent bg-muted/40 px-3 py-2 text-left transition-colors hover:bg-muted/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <ChevronRight
            className={cn('h-3.5 w-3.5 flex-shrink-0 text-foreground/45 transition-transform', expanded && 'rotate-90')}
          />
          <span className="text-xs font-semibold uppercase tracking-wide text-foreground/55">{group.label}</span>
          <span className="text-xs text-foreground/50">
            · {group.meetings.length} {group.meetings.length === 1 ? 'meeting' : 'meetings'}
          </span>
          {recordedCount > 0 && (
            <span className="flex items-center gap-1 text-xs text-emerald-600 dark:text-emerald-500">
              · {recordedCount} recorded
              <CheckCircle2 className="h-3 w-3" />
            </span>
          )}
          {/* Tiny dot row previewing each meeting's category. */}
          <span className="ml-auto flex items-center gap-1">
            {group.meetings.slice(0, 8).map((m) => {
              const cat = categorizeMeeting({
                subject: m.subject,
                attendeeCount: participantsByMeeting[m.id]?.length || undefined
              })
              return <span key={m.id} className={cn('h-1.5 w-1.5 rounded-full', CATEGORY_DOT[cat])} aria-hidden="true" />
            })}
          </span>
        </button>
        {expanded && (
          <div className="mt-1 space-y-0.5 pl-6">
            {group.meetings.map((m) => {
              const vm = buildVM(m)
              return (
                <button
                  key={m.id}
                  onClick={() => navigate(`/meeting/${m.id}`)}
                  className="flex w-full items-center gap-3 rounded-md px-3 py-1.5 text-left text-sm opacity-80 transition-colors hover:bg-muted/50 hover:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <span className={cn('h-2 w-2 flex-shrink-0 rounded-full', CATEGORY_DOT[vm.category])} aria-hidden="true" />
                  <span className="w-20 flex-shrink-0 text-xs tabular-nums text-foreground/55">
                    {formatTime(m.start_time)}
                  </span>
                  <span className={cn('min-w-0 flex-1 truncate text-foreground/80', vm.cancelled && 'line-through')}>
                    {m.subject}
                  </span>
                  <RecordingMic vm={vm} />
                </button>
              )
            })}
          </div>
        )}
      </div>
    )
  }

  // ── Ribbon empty/edge states ───────────────────────────────────────────────
  const anyUpcomingOrLive = zoned.focus.length > 0 || zoned.later.length > 0
  const dayOver = anyUpcomingOrLive === false && (zoned.recent.length > 0 || zoned.earlier.length > 0)
  const preFirstMeeting =
    zoned.focus.length === 0 &&
    zoned.later.length > 0 &&
    zoned.recent.length === 0 &&
    zoned.earlier.length === 0
  const firstUpcoming = zoned.later[0]
  const firstUpcomingTiming = firstUpcoming ? timings.get(firstUpcoming.id) : undefined

  const focusVMs = zoned.focus.map(buildVM)
  // Hero (isFocus) first, then the rest by start.
  const orderedFocus = [...focusVMs].sort((a, b) => {
    if (a.isHero !== b.isHero) return a.isHero ? -1 : 1
    return new Date(a.m.start_time).getTime() - new Date(b.m.start_time).getTime()
  })

  return (
    <div ref={scrollRef} className="h-full overflow-y-auto bg-background">
      <div className="mx-auto max-w-3xl space-y-6 px-6 py-6">
        {/* Header */}
        <div className="flex items-end justify-between animate-rise-in">
          <div>
            <div className="flex items-center gap-1.5 text-sm font-semibold uppercase tracking-wide text-primary">
              <Sun className="h-4 w-4" />
              {new Date().toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric' })}
            </div>
            <h1 className="mt-1 text-4xl font-bold tracking-tight">{greeting()}, Sebastián</h1>
            {data && (
              <p className="mt-2 text-sm text-foreground/70">
                <span className="font-semibold text-foreground">{data.stats.transcribedCount}</span> meetings in your
                knowledge base ·{' '}
                <span className="font-semibold text-foreground">{data.stats.indexedChunks}</span> memory chunks indexed
                · <span className="font-semibold text-foreground">{data.stats.pendingActionables}</span> pending actions
              </p>
            )}
          </div>
          <Button variant="outline" size="sm" onClick={load} disabled={loading}>
            <RefreshCw className={cn('mr-2 h-4 w-4', loading && 'animate-spin')} />
            Refresh
          </Button>
        </div>

        {error && (
          <Card className="border-destructive/50">
            <CardContent className="py-4 text-sm text-destructive">{error}</CardContent>
          </Card>
        )}

        {/* The living time ribbon */}
        <Card className="animate-rise-in overflow-hidden">
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center justify-between text-base">
              <span className="flex items-center gap-2">
                <Clock className="h-4 w-4" />
                Your day
              </span>
              {/* Category legend on hover. */}
              <HoverCard openDelay={100}>
                <HoverCardTrigger asChild>
                  <button
                    className="flex items-center gap-1 rounded-md px-1.5 py-0.5 text-xs font-normal text-foreground/45 transition-colors hover:text-foreground/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    aria-label="Meeting category legend"
                  >
                    <Info className="h-3.5 w-3.5" />
                    Legend
                  </button>
                </HoverCardTrigger>
                <HoverCardContent align="end" className="w-52">
                  <div className="space-y-1.5">
                    <div className="text-xs font-semibold text-foreground/70">Meeting types</div>
                    {CATEGORY_ORDER.map((c) => (
                      <div key={c} className="flex items-center gap-2 text-xs">
                        <span className={cn('h-2.5 w-2.5 rounded-full', CATEGORY_DOT[c])} />
                        <span className="text-foreground/70">{MEETING_CATEGORY_LABELS[c]}</span>
                      </div>
                    ))}
                  </div>
                </HoverCardContent>
              </HoverCard>
            </CardTitle>
          </CardHeader>
          <CardContent>
            {!data?.calendar.configured ? (
              <div className="flex items-center justify-between gap-4 rounded-lg border border-dashed p-4">
                <div className="text-sm text-muted-foreground">
                  Your Outlook calendar isn&apos;t connected yet. Add your Outlook ICS URL in Settings and your meetings
                  will appear here, correlate with recordings automatically, and enrich every transcript.
                </div>
                <Button size="sm" onClick={() => navigate('/settings')}>
                  <SettingsIcon className="mr-2 h-4 w-4" />
                  Connect calendar
                </Button>
              </div>
            ) : data.todayMeetings.length === 0 ? (
              <p className="text-sm text-muted-foreground">No meetings scheduled today.</p>
            ) : timedMeetings.length === 0 ? (
              <p className="text-sm text-muted-foreground">No timed meetings today.</p>
            ) : (
              <div>
                <div className="space-y-2">
                  {/* Earlier — collapsed capsules */}
                  {earlierGroups.map((g) => GroupCapsule(g))}

                  {/* Recent — ended within the hour */}
                  {zoned.recent.map((m, i) => RecentRow(buildVM(m), i))}

                  {/* NOW line */}
                  <div ref={nowLineRef} className="flex items-center gap-2 py-1.5" aria-label="Current time">
                    <span className="relative flex h-3 w-3 flex-shrink-0">
                      <span className="absolute inline-flex h-full w-full rounded-full bg-primary opacity-60 animate-ping motion-reduce:hidden" />
                      <span className="relative inline-flex h-3 w-3 rounded-full bg-primary" />
                    </span>
                    <span className="text-xs font-bold uppercase tracking-wider text-primary tabular-nums">
                      {formatClock(now)}
                    </span>
                    <span className="ml-1 text-[11px] font-medium uppercase tracking-wider text-primary/60">Now</span>
                    <span className="h-px flex-1 bg-gradient-to-r from-primary/40 to-transparent" aria-hidden="true" />
                  </div>

                  {/* Live recording card slots directly under the now-line */}
                  {deviceRecording && activeRecordingFilename && (
                    <LiveRecordingCard
                      inProgressMeetings={attributionCandidates}
                      allMeetings={data.todayMeetings}
                    />
                  )}

                  {/* pre-first-meeting hero countdown */}
                  {preFirstMeeting && firstUpcoming && (
                    <div>
                      <div className="rounded-xl border border-primary/30 bg-primary/[0.04] p-5 shadow-sm">
                        <div className="text-xs font-medium uppercase tracking-wide text-primary/70">First meeting</div>
                        <div className="mt-1 text-2xl font-bold tracking-tight text-foreground">
                          {formatMinutesUntil(firstUpcomingTiming?.minutes ?? 0).replace(/^in /, '')}
                        </div>
                        <div className="mt-1 text-sm text-foreground/70">
                          {firstUpcoming.subject} · {formatTime(firstUpcoming.start_time)}
                        </div>
                      </div>
                    </div>
                  )}

                  {/* Focus — full cards (hero first) */}
                  {orderedFocus.map((vm, i) => FocusCard(vm, i))}

                  {/* day-over completion summary */}
                  {dayOver && (
                    <div>
                      <div className="rounded-xl border border-border/70 bg-muted/40 p-5">
                        <div className="flex items-center gap-2 text-sm font-semibold text-foreground">
                          <CheckCircle2 className="h-4 w-4 text-emerald-600 dark:text-emerald-500" />
                          That&apos;s a wrap for today
                        </div>
                        <div className="mt-1 text-sm text-foreground/65">
                          {timedMeetings.length} {timedMeetings.length === 1 ? 'meeting' : 'meetings'} ·{' '}
                          {recordedSet.size} recorded
                        </div>
                        <Button
                          size="sm"
                          variant="outline"
                          className="mt-3"
                          onClick={() => navigate('/actionables')}
                        >
                          Review actionables
                          <ArrowRight className="ml-1 h-4 w-4" />
                        </Button>
                      </div>
                    </div>
                  )}

                  {/* Later — compact rows */}
                  {zoned.later.map((m, i) => LaterRow(buildVM(m), i))}
                </div>

                {/* All-day / holiday context — subtle, below the ribbon. */}
                {allDayMeetings.length > 0 && (
                  <div className="mt-3 flex flex-wrap items-center gap-x-2 gap-y-1 px-1 pt-2 text-foreground/45">
                    <CalendarBadge />
                    <span className="text-[10px] font-semibold uppercase tracking-wide">All day</span>
                    {allDayMeetings.map((m, i) => (
                      <Fragment key={m.id}>
                        {i > 0 && <span aria-hidden="true">·</span>}
                        <span className="text-[11px] font-medium text-foreground/60">{m.subject}</span>
                      </Fragment>
                    ))}
                  </div>
                )}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Follow up on your last meeting */}
        {latest && (
          <Card className="animate-rise-in border-primary/30 bg-primary/[0.03]">
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center gap-2 text-base">
                <Sparkles className="h-4 w-4 text-amber-500" />
                Follow up on your last meeting
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div>
                <div className="font-semibold">{latest.title}</div>
                <div className="text-xs text-muted-foreground">
                  {formatDay(latest.dateRecorded)} · {latest.wordCount ?? '—'} words
                  {latest.actionItems.length > 0 && ` · ${latest.actionItems.length} action items detected`}
                </div>
                {latest.summary && <p className="mt-2 line-clamp-2 text-sm text-muted-foreground">{latest.summary}</p>}
              </div>
              {latest.actionItems.length > 0 && (
                <ul className="space-y-1 text-sm">
                  {latest.actionItems.slice(0, 4).map((a, i) => (
                    <li key={i} className="flex gap-2">
                      <span className="text-muted-foreground">→</span>
                      <span className="line-clamp-1">{a}</span>
                    </li>
                  ))}
                </ul>
              )}
              <div className="flex flex-wrap gap-2 pt-1">
                <Button size="sm" onClick={() => generateFor(latest.recordingId, 'claude_code_prompt')}>
                  <Terminal className="mr-2 h-4 w-4" />
                  Claude Code handoff
                </Button>
                <Button size="sm" variant="outline" onClick={() => generateFor(latest.recordingId, 'meeting_minutes')}>
                  <FileText className="mr-2 h-4 w-4" />
                  Meeting minutes
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => navigate('/assistant', { state: { contextId: latest.recordingId } })}
                >
                  <Bot className="mr-2 h-4 w-4" />
                  Ask the assistant
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => navigate('/library', { state: { selectedId: latest.recordingId } })}
                >
                  Open in Library
                  <ArrowRight className="ml-1 h-4 w-4" />
                </Button>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Identity suggestions (renders only when the queue is non-empty) */}
        <TodayIdentitySuggestions />

        <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
          {/* Pending actions */}
          <Card className="animate-rise-in">
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center justify-between text-base">
                <span className="flex items-center gap-2">
                  <ListTodo className="h-4 w-4" />
                  Next actions
                </span>
                <Button variant="ghost" size="sm" onClick={() => navigate('/actionables')}>
                  View all
                  <ArrowRight className="ml-1 h-4 w-4" />
                </Button>
              </CardTitle>
            </CardHeader>
            <CardContent>
              {!data || data.pendingActionables.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  Nothing pending. New suggestions appear here after each transcription.
                </p>
              ) : (
                <div className="space-y-2">
                  {data.pendingActionables.slice(0, 5).map((a) => (
                    <div key={a.id} className="flex items-center gap-3 rounded-lg border p-3">
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-sm font-medium">{a.title}</div>
                        <div className="text-[10px] uppercase tracking-wider text-muted-foreground">
                          {a.type.replace(/_/g, ' ')}
                        </div>
                      </div>
                      <Button
                        size="sm"
                        variant="outline"
                        className="flex-shrink-0"
                        onClick={() => generateFor(a.sourceKnowledgeId, a.suggestedTemplate || 'meeting_minutes')}
                      >
                        <Sparkles className="mr-1 h-4 w-4" />
                        Generate
                      </Button>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

          {/* Recent knowledge */}
          <Card className="animate-rise-in">
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center justify-between text-base">
                <span className="flex items-center gap-2">
                  <BookOpen className="h-4 w-4" />
                  Recent knowledge
                </span>
                <Button variant="ghost" size="sm" onClick={() => navigate('/library')}>
                  Library
                  <ArrowRight className="ml-1 h-4 w-4" />
                </Button>
              </CardTitle>
            </CardHeader>
            <CardContent>
              {!data || data.recentKnowledge.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  Transcribe recordings from your HiDock and they&apos;ll show up here.
                </p>
              ) : (
                <div className="space-y-2">
                  {data.recentKnowledge.map((k) => (
                    <div
                      key={k.recordingId}
                      className="flex w-full items-center justify-between gap-3 rounded-lg border p-3 transition-colors hover:bg-muted/50"
                    >
                      <button
                        onClick={() => navigate('/library', { state: { selectedId: k.recordingId } })}
                        className="min-w-0 flex-1 rounded text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      >
                        <div className="truncate text-sm font-medium">{k.title}</div>
                      </button>
                      {k.dateRecorded && (
                        <EntityMention
                          type="date"
                          date={k.dateRecorded}
                          name={formatDay(k.dateRecorded)}
                          className="shrink-0"
                        />
                      )}
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  )
}

/** Small calendar glyph reused for the all-day banner (kept local + tiny). */
function CalendarBadge() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
      <rect x="3" y="4" width="18" height="18" rx="2" />
      <path d="M16 2v4M8 2v4M3 10h18" />
    </svg>
  )
}

export default Today
