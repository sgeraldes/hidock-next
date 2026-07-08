import { useCallback, useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  Sun,
  CalendarDays,
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
  Settings as SettingsIcon
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { EntityMention, MeetingHoverCard } from '@/components/entity'
import { HoverCard, HoverCardTrigger, HoverCardContent } from '@/components/ui/hover-card'
import { TodayIdentitySuggestions } from '@/components/identity/TodayIdentitySuggestions'
import { cn } from '@/lib/utils'
import { firstMeaningfulLine } from '@/lib/description-format'
import { useAppStore } from '@/store'
import { fetchMeetingParticipants, participantFirstName } from '@/lib/meeting-participants'
import {
  classifyMeetingTimings,
  formatMinutesLeft,
  formatMinutesUntil
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

function formatDay(iso?: string): string {
  if (!iso) return ''
  const d = new Date(iso)
  return isNaN(d.getTime()) ? '' : d.toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' })
}

export function Today() {
  const navigate = useNavigate()
  const [data, setData] = useState<BriefingData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [participantsByMeeting, setParticipantsByMeeting] = useState<Record<string, Contact[]>>({})
  const [recordingByMeeting, setRecordingByMeeting] = useState<Record<string, boolean>>({})
  // Live device-recording flag (see useAppStore.deviceRecording TODO). Scalar → no
  // useShallow needed. Stays false until a device-status read path sets it.
  const deviceRecording = useAppStore((s) => s.deviceRecording)
  // Live clock so relative "in X min" badges and the next-meeting highlight stay
  // accurate; ticks every 15s (WCAG reduced-motion is unaffected — it's data,
  // not animation).
  const [now, setNow] = useState(() => new Date())
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 15_000)
    return () => clearInterval(id)
  }, [])

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

  // Fetch known participants for today's meetings once per briefing load, in
  // parallel and tolerant of failures (empty results simply hide the line).
  const todayMeetings = data?.todayMeetings
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

  // Whether each meeting already has a linked recording, so the row can show a
  // "recorded" indicator. Tolerant of a missing/failing API (empty = no badge).
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

  const timings = classifyMeetingTimings(data?.todayMeetings ?? [], now)

  const latest = data?.recentKnowledge[0]

  const generateFor = (sourceId: string, templateId: string) => {
    navigate('/actionables', { state: { sourceId, action: 'generate', templateId } })
  }

  return (
    <div className="h-full overflow-y-auto p-6">
      <div className="max-w-5xl mx-auto space-y-6">
        {/* Header */}
        <div className="flex items-end justify-between">
          <div>
            <div className="flex items-center gap-1.5 text-primary text-sm font-semibold uppercase tracking-wide">
              <Sun className="h-4 w-4" />
              {new Date().toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric' })}
            </div>
            <h1 className="text-4xl font-bold tracking-tight mt-1">{greeting()}, Sebastián</h1>
            {data && (
              <p className="text-sm text-foreground/70 mt-2">
                <span className="font-semibold text-foreground">{data.stats.transcribedCount}</span> meetings in your
                knowledge base ·{' '}
                <span className="font-semibold text-foreground">{data.stats.indexedChunks}</span> memory chunks indexed
                · <span className="font-semibold text-foreground">{data.stats.pendingActionables}</span> pending actions
              </p>
            )}
          </div>
          <Button variant="outline" size="sm" onClick={load} disabled={loading}>
            <RefreshCw className={cn('h-4 w-4 mr-2', loading && 'animate-spin')} />
            Refresh
          </Button>
        </div>

        {error && (
          <Card className="border-destructive/50">
            <CardContent className="py-4 text-sm text-destructive">{error}</CardContent>
          </Card>
        )}

        {/* Today's meetings */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-base">
              <CalendarDays className="h-4 w-4" />
              Today&apos;s meetings
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
                  <SettingsIcon className="h-4 w-4 mr-2" />
                  Connect calendar
                </Button>
              </div>
            ) : data.todayMeetings.length === 0 ? (
              <p className="text-sm text-muted-foreground">No meetings scheduled today.</p>
            ) : (
              <div className="space-y-2">
                {data.todayMeetings.map((m) => {
                  const people = participantsByMeeting[m.id] ?? []
                  const names = people.slice(0, TODAY_PARTICIPANT_LIMIT).map(participantFirstName)
                  const extra = people.length - names.length
                  const timing = timings.get(m.id)
                  const cancelled = timing?.state === 'cancelled'
                  const past = timing?.state === 'past'
                  const inProgress = timing?.state === 'in_progress'
                  const upcoming = timing?.state === 'upcoming'
                  const isFocus = timing?.isFocus ?? false
                  const isNextUp = timing?.isNextUp ?? false
                  // The soonest upcoming meeting while another is in progress — gets a
                  // lighter secondary accent so "what's next" reads at a glance.
                  const secondaryEmphasis = isNextUp && !isFocus
                  const online = isOnlineMeeting(m)
                  const hasRecording = recordingByMeeting[m.id]
                  // Live capture: the HiDock is recording and this is the meeting in
                  // progress it's most likely capturing (the focused running meeting).
                  const recording = inProgress && isFocus && deviceRecording
                  const dimmed = past || cancelled
                  // Secondary line: participants, else first meaningful description line, else location.
                  const secondary =
                    names.length > 0
                      ? `${names.join(', ')}${extra > 0 ? ` +${extra}` : ''}`
                      : firstMeaningfulLine(m.description) || m.location || ''
                  const badgeLabel = inProgress
                    ? formatMinutesLeft(timing?.minutes ?? 0)
                    : formatMinutesUntil(timing?.minutes ?? 0)
                  return (
                    <HoverCard key={m.id}>
                      <HoverCardTrigger asChild>
                        <button
                          onClick={() => navigate(`/meeting/${m.id}`)}
                          className={cn(
                            'group w-full flex items-center gap-3 rounded-lg border p-3 text-left',
                            'transition-all duration-150 ease-out hover:bg-muted/60 hover:shadow-sm hover:-translate-y-px',
                            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                            (inProgress || isFocus) && 'border-primary/40 bg-primary/[0.04] ring-1 ring-primary/10',
                            secondaryEmphasis && 'border-primary/25 ring-1 ring-primary/[0.06]',
                            dimmed && 'opacity-60'
                          )}
                        >
                          <Clock
                            className={cn(
                              'h-4 w-4 flex-shrink-0',
                              inProgress || isFocus ? 'text-primary' : 'text-foreground/60'
                            )}
                          />
                          <span
                            className={cn(
                              'text-sm font-medium w-24 flex-shrink-0 text-foreground/80',
                              cancelled && 'line-through'
                            )}
                          >
                            {formatTime(m.start_time)}–{formatTime(m.end_time)}
                          </span>
                          <span className="min-w-0 flex-1">
                            <span className="flex items-center gap-1.5">
                              <span
                                className={cn(
                                  'text-sm font-medium text-foreground truncate',
                                  cancelled && 'line-through text-foreground/70'
                                )}
                              >
                                {m.subject}
                              </span>
                              {online && (
                                <Video
                                  className="h-3.5 w-3.5 text-foreground/50 flex-shrink-0"
                                  aria-label="Online meeting"
                                />
                              )}
                              {hasRecording && (
                                <Mic
                                  className="h-3.5 w-3.5 text-emerald-600 dark:text-emerald-500 flex-shrink-0"
                                  aria-label="Recording linked"
                                />
                              )}
                              {recording && (
                                <span
                                  className="flex items-center gap-1 flex-shrink-0 rounded-full bg-red-500/10 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-red-600 dark:text-red-500"
                                  aria-label="Recording in progress"
                                >
                                  <span className="h-1.5 w-1.5 rounded-full bg-red-500 animate-pulse motion-reduce:animate-none" />
                                  Recording
                                </span>
                              )}
                            </span>
                            {secondary && (
                              <span className="text-xs text-foreground/60 truncate block">{secondary}</span>
                            )}
                          </span>
                          {(inProgress || upcoming) && !cancelled && (
                            <span
                              className={cn(
                                'flex items-center gap-1.5 text-xs whitespace-nowrap rounded-full px-2 py-0.5 flex-shrink-0',
                                inProgress || isFocus || isNextUp
                                  ? 'bg-primary/10 text-primary font-medium'
                                  : 'text-foreground/55'
                              )}
                            >
                              {inProgress && (
                                <span
                                  className={cn(
                                    'h-1.5 w-1.5 rounded-full flex-shrink-0 animate-pulse motion-reduce:animate-none',
                                    recording ? 'bg-red-500' : 'bg-primary'
                                  )}
                                />
                              )}
                              {/* Re-key on label change so the text fades in on each tick update. */}
                              <span
                                key={badgeLabel}
                                className="animate-in fade-in duration-300 motion-reduce:animate-none"
                              >
                                {badgeLabel}
                              </span>
                            </span>
                          )}
                        </button>
                      </HoverCardTrigger>
                      <HoverCardContent align="start">
                        <MeetingHoverCard id={m.id} name={m.subject} />
                      </HoverCardContent>
                    </HoverCard>
                  )
                })}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Follow up on your last meeting */}
        {latest && (
          <Card className="border-primary/30 bg-primary/[0.03]">
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
                {latest.summary && (
                  <p className="text-sm text-muted-foreground mt-2 line-clamp-2">{latest.summary}</p>
                )}
              </div>
              {latest.actionItems.length > 0 && (
                <ul className="text-sm space-y-1">
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
                  <Terminal className="h-4 w-4 mr-2" />
                  Claude Code handoff
                </Button>
                <Button size="sm" variant="outline" onClick={() => generateFor(latest.recordingId, 'meeting_minutes')}>
                  <FileText className="h-4 w-4 mr-2" />
                  Meeting minutes
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => navigate('/assistant', { state: { contextId: latest.recordingId } })}
                >
                  <Bot className="h-4 w-4 mr-2" />
                  Ask the assistant
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => navigate('/library', { state: { selectedId: latest.recordingId } })}
                >
                  Open in Library
                  <ArrowRight className="h-4 w-4 ml-1" />
                </Button>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Identity suggestions (renders only when the queue is non-empty) */}
        <TodayIdentitySuggestions />

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Pending actions */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center justify-between text-base">
                <span className="flex items-center gap-2">
                  <ListTodo className="h-4 w-4" />
                  Next actions
                </span>
                <Button variant="ghost" size="sm" onClick={() => navigate('/actionables')}>
                  View all
                  <ArrowRight className="h-4 w-4 ml-1" />
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
                      <div className="flex-1 min-w-0">
                        <div className="text-sm font-medium truncate">{a.title}</div>
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
                        <Sparkles className="h-4 w-4 mr-1" />
                        Generate
                      </Button>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

          {/* Recent knowledge */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center justify-between text-base">
                <span className="flex items-center gap-2">
                  <BookOpen className="h-4 w-4" />
                  Recent knowledge
                </span>
                <Button variant="ghost" size="sm" onClick={() => navigate('/library')}>
                  Library
                  <ArrowRight className="h-4 w-4 ml-1" />
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
                      className="w-full rounded-lg border p-3 hover:bg-muted/50 transition-colors flex items-center justify-between gap-3"
                    >
                      <button
                        onClick={() => navigate('/library', { state: { selectedId: k.recordingId } })}
                        className="min-w-0 flex-1 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded"
                      >
                        <div className="text-sm font-medium truncate">{k.title}</div>
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

export default Today
