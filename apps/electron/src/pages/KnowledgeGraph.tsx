import { useState, useEffect, useCallback } from 'react'
import {
  Network,
  RefreshCw,
  Download,
  Users,
  Star,
  User,
  AlertCircle,
  Loader2,
  Info
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { toast } from '@/components/ui/toaster'
import { cn } from '@/lib/utils'
import { useUIStore } from '@/store/ui/useUIStore'
import { EntityMention, useContactResolver } from '@/components/entity'

/**
 * Graph meeting nodes carry their meeting id + label under `props` (which may be
 * a JSON string). Normalize both the legacy {meetingId,meetingLabel} shape and
 * the raw GraphNode shape so mentions render a real label and navigable id.
 */
function normalizeGraphMeeting(m: {
  meetingId?: string
  meetingLabel?: string
  date?: string
  label?: string
  props?: unknown
}): { id?: string; label: string; date?: string } {
  let props = m?.props as { meetingId?: string; date?: string } | undefined
  if (typeof props === 'string') {
    try {
      props = JSON.parse(props)
    } catch {
      props = undefined
    }
  }
  return {
    id: m?.meetingId ?? props?.meetingId,
    label: m?.meetingLabel ?? m?.label ?? props?.meetingId ?? 'Meeting',
    date: m?.date ?? props?.date
  }
}

// ---------- Types ----------------------------------------------------------

interface GraphStats {
  nodes: number
  edges: number
  nodesByType: Record<string, number>
}

interface TopAttendee {
  person: string
  personId: string
  meetings: number
}

interface TopSkillDemonstrator {
  person: string
  personId: string
  weight: number
}

interface PersonProfile {
  personId: string
  personLabel: string
  meetings: Array<{ meetingId: string; meetingLabel: string; date?: string }>
  skills: Array<{ skill: string; weight: number }>
  actionItems: Array<{ id: string; label: string; status?: string }>
}

// ---------- Section wrapper ------------------------------------------------

function Section({
  title,
  icon: Icon,
  children,
  className
}: {
  title: string
  icon: React.ElementType
  children: React.ReactNode
  className?: string
}) {
  return (
    <Card className={cn('shadow-sm', className)}>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-sm font-bold uppercase tracking-wider text-muted-foreground">
          <Icon className="h-4 w-4" />
          {title}
        </CardTitle>
      </CardHeader>
      <CardContent>{children}</CardContent>
    </Card>
  )
}

// ---------- Error alert ----------------------------------------------------

function ErrorAlert({ message }: { message: string }) {
  // Surface "no AI provider configured" as a friendly info box instead of a red error
  const isProviderError =
    message.toLowerCase().includes('no ai provider') ||
    message.toLowerCase().includes('provider') ||
    message.toLowerCase().includes('api key')

  return (
    <div
      className={cn(
        'flex items-start gap-3 rounded-lg border p-3 text-sm',
        isProviderError
          ? 'border-amber-500/30 bg-amber-500/5 text-amber-700 dark:text-amber-400'
          : 'border-destructive/30 bg-destructive/5 text-destructive'
      )}
    >
      {isProviderError ? (
        <Info className="h-4 w-4 mt-0.5 flex-shrink-0" />
      ) : (
        <AlertCircle className="h-4 w-4 mt-0.5 flex-shrink-0" />
      )}
      <span>{message}</span>
    </div>
  )
}

// ---------- Stats header ---------------------------------------------------

function StatsHeader({
  stats,
  loading,
  onRefresh
}: {
  stats: GraphStats | null
  loading: boolean
  onRefresh: () => void
}) {
  return (
    <div className="flex items-center justify-between gap-4 flex-wrap">
      <div className="flex items-center gap-6">
        <div className="flex flex-col">
          <span className="text-3xl font-bold tabular-nums">
            {loading ? <Loader2 className="h-7 w-7 animate-spin text-muted-foreground" /> : (stats?.nodes ?? '—')}
          </span>
          <span className="text-xs text-muted-foreground uppercase tracking-wider">Nodes</span>
        </div>
        <div className="flex flex-col">
          <span className="text-3xl font-bold tabular-nums">
            {loading ? '…' : (stats?.edges ?? '—')}
          </span>
          <span className="text-xs text-muted-foreground uppercase tracking-wider">Edges</span>
        </div>
        {stats && Object.keys(stats.nodesByType).length > 0 && (
          <div className="flex flex-wrap gap-2">
            {Object.entries(stats.nodesByType).map(([type, count]) => (
              <span
                key={type}
                className="text-[11px] px-2 py-0.5 rounded-full bg-muted text-muted-foreground font-mono"
              >
                {type}: {count}
              </span>
            ))}
          </div>
        )}
      </div>
      <Button
        variant="ghost"
        size="sm"
        onClick={onRefresh}
        disabled={loading}
        className="gap-2 text-muted-foreground hover:text-foreground"
      >
        <RefreshCw className={cn('h-4 w-4', loading && 'animate-spin')} />
        Refresh
      </Button>
    </div>
  )
}

// ---------- Main page -------------------------------------------------------

export function KnowledgeGraph() {
  const qaEnabled = useUIStore((s) => s.qaLogsEnabled)
  const { resolveByName } = useContactResolver()

  // Stats
  const [stats, setStats] = useState<GraphStats | null>(null)
  const [statsLoading, setStatsLoading] = useState(true)
  const [statsError, setStatsError] = useState<string | null>(null)

  // Ingest
  const [ingestLoading, setIngestLoading] = useState(false)
  const [ingestResult, setIngestResult] = useState<{
    ingested: number
    skipped: number
    errors: Array<{ transcriptId: string; error: string }>
  } | null>(null)
  const [ingestError, setIngestError] = useState<string | null>(null)

  // Top attendees
  const [attendeesQuery, setAttendeesQuery] = useState('')
  const [attendeesLoading, setAttendeesLoading] = useState(false)
  const [attendeesResults, setAttendeesResults] = useState<TopAttendee[] | null>(null)
  const [attendeesError, setAttendeesError] = useState<string | null>(null)

  // Top skill
  const [skillQuery, setSkillQuery] = useState('')
  const [skillLoading, setSkillLoading] = useState(false)
  const [skillResults, setSkillResults] = useState<TopSkillDemonstrator[] | null>(null)
  const [skillError, setSkillError] = useState<string | null>(null)

  // Person profile
  const [profileQuery, setProfileQuery] = useState('')
  const [profileLoading, setProfileLoading] = useState(false)
  const [profileResult, setProfileResult] = useState<PersonProfile | null>(null)
  const [profileError, setProfileError] = useState<string | null>(null)

  // ---- Fetch stats ---------------------------------------------------------

  const fetchStats = useCallback(async () => {
    setStatsLoading(true)
    setStatsError(null)
    try {
      if (qaEnabled) console.log('[QA-MONITOR][KnowledgeGraph] Fetching graph stats')
      const result = await window.electronAPI.graph.stats()
      if (result.success && result.data) {
        setStats(result.data)
        if (qaEnabled) console.log('[QA-MONITOR][KnowledgeGraph] Stats loaded', result.data)
      } else {
        setStatsError(result.error ?? 'Failed to load graph stats')
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Unexpected error loading stats'
      setStatsError(msg)
    } finally {
      setStatsLoading(false)
    }
  }, [qaEnabled])

  useEffect(() => {
    fetchStats()
  }, [fetchStats])

  // ---- Ingest --------------------------------------------------------------

  const handleIngestAll = async () => {
    setIngestLoading(true)
    setIngestError(null)
    setIngestResult(null)
    try {
      if (qaEnabled) console.log('[QA-MONITOR][KnowledgeGraph] Starting ingestAll')
      const result = await window.electronAPI.graph.ingestAll()
      if (result.success && result.data) {
        setIngestResult(result.data)
        toast.success(
          'Ingestion complete',
          `${result.data.ingested} ingested, ${result.data.skipped} skipped` +
            (result.data.errors.length > 0 ? `, ${result.data.errors.length} errors` : '')
        )
        if (qaEnabled) console.log('[QA-MONITOR][KnowledgeGraph] ingestAll result', result.data)
        // Refresh stats after ingestion
        await fetchStats()
      } else {
        const errMsg = result.error ?? 'Ingestion failed'
        setIngestError(errMsg)
        // Don't show a toast.error here — the inline ErrorAlert is enough
        if (qaEnabled) console.log('[QA-MONITOR][KnowledgeGraph] ingestAll error', errMsg)
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Unexpected error during ingestion'
      setIngestError(msg)
    } finally {
      setIngestLoading(false)
    }
  }

  // ---- Top attendees -------------------------------------------------------

  const handleTopAttendees = async () => {
    if (!attendeesQuery.trim()) return
    setAttendeesLoading(true)
    setAttendeesError(null)
    setAttendeesResults(null)
    try {
      if (qaEnabled) console.log('[QA-MONITOR][KnowledgeGraph] topAttendees query:', attendeesQuery)
      const result = await window.electronAPI.graph.topAttendees(attendeesQuery.trim())
      if (result.success) {
        setAttendeesResults(result.data ?? [])
      } else {
        setAttendeesError(result.error ?? 'Query failed')
      }
    } catch (err) {
      setAttendeesError(err instanceof Error ? err.message : 'Unexpected error')
    } finally {
      setAttendeesLoading(false)
    }
  }

  // ---- Top skill -----------------------------------------------------------

  const handleTopSkill = async () => {
    if (!skillQuery.trim()) return
    setSkillLoading(true)
    setSkillError(null)
    setSkillResults(null)
    try {
      if (qaEnabled) console.log('[QA-MONITOR][KnowledgeGraph] topSkill query:', skillQuery)
      const result = await window.electronAPI.graph.topSkill(skillQuery.trim())
      if (result.success) {
        setSkillResults(result.data ?? [])
      } else {
        setSkillError(result.error ?? 'Query failed')
      }
    } catch (err) {
      setSkillError(err instanceof Error ? err.message : 'Unexpected error')
    } finally {
      setSkillLoading(false)
    }
  }

  // ---- Person profile -------------------------------------------------------

  const handlePersonProfile = async () => {
    if (!profileQuery.trim()) return
    setProfileLoading(true)
    setProfileError(null)
    setProfileResult(null)
    try {
      if (qaEnabled) console.log('[QA-MONITOR][KnowledgeGraph] personProfile query:', profileQuery)
      const result = await window.electronAPI.graph.personProfile(profileQuery.trim())
      if (result.success) {
        setProfileResult(result.data ?? null)
        if (!result.data) {
          setProfileError(`No profile found for "${profileQuery}"`)
        }
      } else {
        setProfileError(result.error ?? 'Query failed')
      }
    } catch (err) {
      setProfileError(err instanceof Error ? err.message : 'Unexpected error')
    } finally {
      setProfileLoading(false)
    }
  }

  // ---- Render ---------------------------------------------------------------

  return (
    <div className="flex flex-col h-full bg-background">
      {/* Header */}
      <header className="border-b px-6 py-6 bg-muted/5 shrink-0">
        <div className="flex items-start gap-4">
          <div className="w-10 h-10 rounded-xl bg-violet-500/10 flex items-center justify-center border border-violet-500/20 shrink-0">
            <Network className="h-5 w-5 text-violet-500" />
          </div>
          <div className="flex-1 min-w-0">
            <h1 className="text-2xl font-bold tracking-tight">Knowledge Graph</h1>
            <p className="text-sm text-muted-foreground mt-0.5">
              Explore people, skills, and relationships extracted from your transcripts.
            </p>
          </div>
        </div>

        {/* Stats bar */}
        <div className="mt-5">
          {statsError ? (
            <ErrorAlert message={statsError} />
          ) : (
            <StatsHeader stats={stats} loading={statsLoading} onRefresh={fetchStats} />
          )}
        </div>
      </header>

      {/* Body */}
      <div className="flex-1 overflow-auto">
        <div className="max-w-5xl mx-auto p-6 space-y-6">

          {/* ---- Ingest -------------------------------------------------- */}
          <Section title="Ingest transcripts" icon={Download}>
            <div className="space-y-3">
              <p className="text-sm text-muted-foreground">
                Extract people, skills, and relationships from all transcribed recordings. Re-running is safe — already-ingested transcripts are skipped.
              </p>
              <Button
                onClick={handleIngestAll}
                disabled={ingestLoading}
                className="gap-2"
              >
                {ingestLoading ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Ingesting…
                  </>
                ) : (
                  <>
                    <Download className="h-4 w-4" />
                    Ingest transcripts
                  </>
                )}
              </Button>

              {ingestError && <ErrorAlert message={ingestError} />}

              {ingestResult && !ingestError && (
                <div className="rounded-lg border border-emerald-500/20 bg-emerald-500/5 px-4 py-3 text-sm space-y-1">
                  <p className="font-semibold text-emerald-700 dark:text-emerald-400">
                    Ingestion complete
                  </p>
                  <div className="flex gap-4 text-muted-foreground font-mono text-xs">
                    <span>Ingested: <strong className="text-foreground">{ingestResult.ingested}</strong></span>
                    <span>Skipped: <strong className="text-foreground">{ingestResult.skipped}</strong></span>
                    {ingestResult.errors.length > 0 && (
                      <span className="text-amber-600 dark:text-amber-400">
                        Errors: {ingestResult.errors.length}
                      </span>
                    )}
                  </div>
                  {ingestResult.errors.length > 0 && (
                    <details className="mt-2">
                      <summary className="cursor-pointer text-xs text-muted-foreground hover:text-foreground">
                        Show errors
                      </summary>
                      <ul className="mt-1 space-y-0.5 text-xs text-destructive pl-2">
                        {ingestResult.errors.map((e, i) => (
                          <li key={i}>{e.transcriptId}: {e.error}</li>
                        ))}
                      </ul>
                    </details>
                  )}
                </div>
              )}
            </div>
          </Section>

          {/* ---- Top attendees ------------------------------------------- */}
          <Section title="Top attendees for topic / project" icon={Users}>
            <div className="space-y-3">
              <div className="flex gap-2">
                <Input
                  placeholder="e.g. Amazon Connect, Q1 Planning…"
                  value={attendeesQuery}
                  onChange={(e) => setAttendeesQuery(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && handleTopAttendees()}
                  className="flex-1"
                />
                <Button
                  onClick={handleTopAttendees}
                  disabled={attendeesLoading || !attendeesQuery.trim()}
                  className="gap-2 shrink-0"
                >
                  {attendeesLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Users className="h-4 w-4" />}
                  Search
                </Button>
              </div>

              {attendeesError && <ErrorAlert message={attendeesError} />}

              {attendeesResults !== null && !attendeesError && (
                attendeesResults.length === 0 ? (
                  <p className="text-sm text-muted-foreground text-center py-6 border-2 border-dashed rounded-xl opacity-50">
                    No attendees found for "{attendeesQuery}"
                  </p>
                ) : (
                  <div className="rounded-lg border overflow-hidden">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="bg-muted/50 border-b">
                          <th className="text-left px-4 py-2 font-semibold text-xs uppercase tracking-wider text-muted-foreground">Person</th>
                          <th className="text-right px-4 py-2 font-semibold text-xs uppercase tracking-wider text-muted-foreground">Meetings</th>
                        </tr>
                      </thead>
                      <tbody>
                        {attendeesResults.map((row, i) => (
                          <tr key={row.personId} className={cn('border-b last:border-0', i % 2 === 0 ? 'bg-background' : 'bg-muted/20')}>
                            <td className="px-4 py-2.5 font-medium">
                              <EntityMention type="person" id={resolveByName(row.person)?.id} name={row.person} />
                            </td>
                            <td className="px-4 py-2.5 text-right tabular-nums text-muted-foreground">{row.meetings}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )
              )}
            </div>
          </Section>

          {/* ---- Top skill demonstrators --------------------------------- */}
          <Section title="Top skill demonstrators" icon={Star}>
            <div className="space-y-3">
              <div className="flex gap-2">
                <Input
                  placeholder="e.g. React, leadership, SQL…"
                  value={skillQuery}
                  onChange={(e) => setSkillQuery(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && handleTopSkill()}
                  className="flex-1"
                />
                <Button
                  onClick={handleTopSkill}
                  disabled={skillLoading || !skillQuery.trim()}
                  className="gap-2 shrink-0"
                >
                  {skillLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Star className="h-4 w-4" />}
                  Search
                </Button>
              </div>

              {skillError && <ErrorAlert message={skillError} />}

              {skillResults !== null && !skillError && (
                skillResults.length === 0 ? (
                  <p className="text-sm text-muted-foreground text-center py-6 border-2 border-dashed rounded-xl opacity-50">
                    No demonstrators found for "{skillQuery}"
                  </p>
                ) : (
                  <div className="rounded-lg border overflow-hidden">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="bg-muted/50 border-b">
                          <th className="text-left px-4 py-2 font-semibold text-xs uppercase tracking-wider text-muted-foreground">Person</th>
                          <th className="text-right px-4 py-2 font-semibold text-xs uppercase tracking-wider text-muted-foreground">Weight</th>
                        </tr>
                      </thead>
                      <tbody>
                        {skillResults.map((row, i) => (
                          <tr key={row.personId} className={cn('border-b last:border-0', i % 2 === 0 ? 'bg-background' : 'bg-muted/20')}>
                            <td className="px-4 py-2.5 font-medium">
                              <EntityMention type="person" id={resolveByName(row.person)?.id} name={row.person} />
                            </td>
                            <td className="px-4 py-2.5 text-right tabular-nums text-muted-foreground font-mono">{row.weight.toFixed(2)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )
              )}
            </div>
          </Section>

          {/* ---- Person profile ------------------------------------------ */}
          <Section title="Person profile" icon={User}>
            <div className="space-y-3">
              <div className="flex gap-2">
                <Input
                  placeholder="Enter a person's name…"
                  value={profileQuery}
                  onChange={(e) => setProfileQuery(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && handlePersonProfile()}
                  className="flex-1"
                />
                <Button
                  onClick={handlePersonProfile}
                  disabled={profileLoading || !profileQuery.trim()}
                  className="gap-2 shrink-0"
                >
                  {profileLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <User className="h-4 w-4" />}
                  Look up
                </Button>
              </div>

              {profileError && <ErrorAlert message={profileError} />}

              {profileResult && !profileError && (
                <div className="space-y-4 pt-1">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-full bg-violet-500/10 flex items-center justify-center font-bold text-violet-600 border border-violet-500/20 text-lg">
                      {profileResult.personLabel.charAt(0).toUpperCase()}
                    </div>
                    <div>
                      <EntityMention
                        type="person"
                        id={resolveByName(profileResult.personLabel)?.id}
                        name={profileResult.personLabel}
                        className="text-sm"
                      />
                      <p className="text-xs text-muted-foreground font-mono mt-0.5">{profileResult.personId}</p>
                    </div>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                    {/* Meetings attended */}
                    <div className="space-y-2">
                      <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                        Meetings ({profileResult.meetings.length})
                      </p>
                      {profileResult.meetings.length === 0 ? (
                        <p className="text-xs text-muted-foreground">None</p>
                      ) : (
                        <ul className="space-y-1">
                          {profileResult.meetings.map((m, i) => {
                            const mtg = normalizeGraphMeeting(m)
                            return (
                              <li key={mtg.id ?? i} className="flex items-center gap-1 text-sm">
                                <EntityMention type="meeting" id={mtg.id} name={mtg.label} />
                                {mtg.date && (
                                  <span className="text-[10px] text-muted-foreground">
                                    {new Date(mtg.date).toLocaleDateString()}
                                  </span>
                                )}
                              </li>
                            )
                          })}
                        </ul>
                      )}
                    </div>

                    {/* Skills */}
                    <div className="space-y-2">
                      <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                        Skills ({profileResult.skills.length})
                      </p>
                      {profileResult.skills.length === 0 ? (
                        <p className="text-xs text-muted-foreground">None</p>
                      ) : (
                        <div className="flex flex-wrap gap-1.5">
                          {profileResult.skills.map((s, i) => (
                            <span
                              key={i}
                              className="text-[11px] px-2 py-0.5 rounded-full bg-violet-500/10 text-violet-700 dark:text-violet-300 border border-violet-500/20"
                              title={`weight: ${s.weight}`}
                            >
                              {s.skill}
                            </span>
                          ))}
                        </div>
                      )}
                    </div>

                    {/* Action items */}
                    <div className="space-y-2">
                      <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                        Action items ({profileResult.actionItems.length})
                      </p>
                      {profileResult.actionItems.length === 0 ? (
                        <p className="text-xs text-muted-foreground">None</p>
                      ) : (
                        <ul className="space-y-1">
                          {profileResult.actionItems.map((a, i) => (
                            <li key={a.id ?? i} className="flex items-start gap-1.5 text-sm">
                              <span
                                className={cn(
                                  'mt-0.5 h-2 w-2 rounded-full shrink-0',
                                  a.status === 'done' ? 'bg-emerald-500' : 'bg-amber-500'
                                )}
                              />
                              <span className="text-foreground/80 truncate" title={a.label}>{a.label}</span>
                            </li>
                          ))}
                        </ul>
                      )}
                    </div>
                  </div>
                </div>
              )}
            </div>
          </Section>

        </div>
      </div>
    </div>
  )
}

export default KnowledgeGraph
