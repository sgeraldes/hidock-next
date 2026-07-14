import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Loader2, Mail, Briefcase, CalendarDays, Users, Folder, MapPin, Video, Mic, ArrowRight } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { formatDateTime } from '@/lib/utils'
import { useMeetingParticipants, participantLabel, getCachedMeetingParticipants } from '@/lib/meeting-participants'
import { useMeetingRecordingIntel, getCachedMeetingRecordingIntel } from '@/lib/meeting-recording-intelligence'
import { meaningfulDescriptionLines, extractMeetingUrl } from '@/lib/description-format'

const HOVER_PARTICIPANT_LIMIT = 5
const HOVER_MEETING_LIMIT = 3
const HOVER_TOPIC_LIMIT = 4

/**
 * Hover-card bodies for entity mentions. Each fetches its own detail lazily —
 * they only mount when the popover opens (Radix Popover.Content mounts on open),
 * so the IPC call runs on hover/focus, not on initial render of the mention.
 *
 * INCREMENTAL DISCLOSURE: a hover card must be *net-new* relative to the surface
 * that triggered it. Repeating what's already on screen (the title, the time,
 * the person's name) trains the user to stop hovering. Each trigger declares
 * what it already shows via `visibleFields`, and the card SKIPS those fields,
 * surfacing only the enrichment the surface can't. When nothing net-new remains
 * the card degrades to a single quiet "No additional details" line (and the
 * trigger's suppression pre-check should keep it from mounting at all — see
 * `meetingHoverWillHaveContent`).
 */

/** Meeting-card sections a trigger surface may already be showing. */
export type MeetingHoverField =
  | 'title'
  | 'time'
  | 'organizer'
  | 'location'
  | 'agenda'
  | 'join'
  | 'participants'
  | 'recording'

/** Person-card sections a trigger surface may already be showing. */
export type PersonHoverField = 'name' | 'type' | 'role' | 'company' | 'email' | 'meetings' | 'lastSeen'

/** Project-card sections a trigger surface may already be showing. */
export type ProjectHoverField = 'name' | 'status' | 'description' | 'activity'

function HoverCardSkeleton({ label }: { label: string }) {
  return (
    <div className="flex items-center gap-2 text-sm text-muted-foreground">
      <Loader2 className="h-4 w-4 animate-spin" />
      <span className="truncate">{label}</span>
    </div>
  )
}

/** The quiet fallback shown when a card has nothing net-new to add. */
function NoAdditionalDetails() {
  return <p className="text-xs italic text-muted-foreground/70">No additional details</p>
}

/** A discoverability affordance echoing that the trigger click navigates. */
function OpenAffordance({ label }: { label: string }) {
  return (
    <p className="flex items-center gap-1 pt-1 text-[11px] font-medium text-primary/80">
      {label}
      <ArrowRight className="h-3 w-3" />
    </p>
  )
}

export function PersonHoverCard({
  id,
  name,
  visibleFields = []
}: {
  id: string
  name: string
  visibleFields?: PersonHoverField[]
}) {
  const navigate = useNavigate()
  const [contact, setContact] = useState<Record<string, unknown> | null>(null)
  const [meetings, setMeetings] = useState<Array<Record<string, unknown>>>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    ;(async () => {
      try {
        const res = await window.electronAPI.contacts.getById(id)
        if (!cancelled && res.success && res.data?.contact) {
          setContact(res.data.contact as unknown as Record<string, unknown>)
          setMeetings((res.data.meetings ?? []) as unknown as Array<Record<string, unknown>>)
        }
      } catch {
        /* leave minimal card */
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [id])

  const skip = (f: PersonHoverField) => visibleFields.includes(f)

  if (loading && !contact) return <HoverCardSkeleton label={name} />

  const c = contact ?? {}
  const type = (c.type as string) || ''
  const email = (c.email as string) || ''
  const role = (c.role as string) || ''
  const company = (c.company as string) || ''
  const meetingCount = (c.meeting_count as number) ?? (c.interactionCount as number) ?? meetings.length
  const lastSeen = (c.last_seen_at as string) || (c.lastSeenAt as string) || ''

  const showTitle = !skip('name')
  const showType = !skip('type') && Boolean(type)
  const showRoleCompany = (!skip('role') || !skip('company')) && Boolean(role || company)
  const showEmail = !skip('email') && Boolean(email)
  const showMeetings = !skip('meetings') && meetingCount > 0
  const showLastSeen = !skip('lastSeen') && Boolean(lastSeen)
  const showRecent = meetings.length > 0

  const netNew = [showTitle, showType, showRoleCompany, showEmail, showMeetings, showLastSeen, showRecent].filter(
    Boolean
  ).length

  if (netNew === 0) return <NoAdditionalDetails />

  return (
    <div className="space-y-2">
      {(showTitle || showType) && (
        <div className="flex items-start justify-between gap-2">
          {showTitle ? (
            <p className="font-semibold text-sm leading-tight truncate">{(c.name as string) || name}</p>
          ) : (
            <span />
          )}
          {showType && (
            <Badge variant="person" className="capitalize shrink-0">
              {type}
            </Badge>
          )}
        </div>
      )}
      {showRoleCompany && (
        <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <Briefcase className="h-3 w-3 shrink-0" />
          <span className="truncate">{[role, company].filter(Boolean).join(' · ')}</span>
        </p>
      )}
      {showEmail && (
        <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <Mail className="h-3 w-3 shrink-0" />
          <span className="truncate">{email}</span>
        </p>
      )}
      {(showMeetings || showLastSeen) && (
        <div className="flex items-center gap-3 text-xs text-muted-foreground">
          {showMeetings && (
            <span className="flex items-center gap-1">
              <Users className="h-3 w-3" />
              {meetingCount} meeting{meetingCount === 1 ? '' : 's'}
            </span>
          )}
          {showLastSeen && (
            <span className="flex items-center gap-1">
              <CalendarDays className="h-3 w-3" />
              {formatDateTime(lastSeen)}
            </span>
          )}
        </div>
      )}
      {showRecent && (
        <div className="space-y-1 border-t border-border/60 pt-1.5">
          <p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground/70">Recent meetings</p>
          {meetings.slice(0, HOVER_MEETING_LIMIT).map((m) => (
            <button
              key={m.id as string}
              type="button"
              onClick={() => navigate(`/meeting/${m.id as string}`)}
              className="flex w-full items-center gap-1.5 rounded px-1 py-0.5 text-left text-xs hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <CalendarDays className="h-3 w-3 shrink-0 text-violet-600" />
              <span className="truncate flex-1">{(m.subject as string) || 'Meeting'}</span>
              {m.start_time ? (
                <span className="shrink-0 text-[10px] text-muted-foreground">
                  {new Date(m.start_time as string).toLocaleDateString()}
                </span>
              ) : null}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

export function ProjectHoverCard({
  id,
  name,
  visibleFields = []
}: {
  id: string
  name: string
  visibleFields?: ProjectHoverField[]
}) {
  const [project, setProject] = useState<Record<string, unknown> | null>(null)
  const [meetings, setMeetings] = useState<Array<Record<string, unknown>>>([])
  const [topics, setTopics] = useState<string[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    ;(async () => {
      try {
        const res = await window.electronAPI.projects.getById(id)
        if (!cancelled && res.success && res.data?.project) {
          setProject(res.data.project as unknown as Record<string, unknown>)
          setMeetings((res.data.meetings ?? []) as unknown as Array<Record<string, unknown>>)
          setTopics((res.data.topics ?? []) as string[])
        }
      } catch {
        /* leave minimal card */
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [id])

  const skip = (f: ProjectHoverField) => visibleFields.includes(f)

  if (loading && !project) return <HoverCardSkeleton label={name} />

  const p = project ?? {}
  const status = (p.status as string) || ''
  const description = (p.description as string) || ''
  const lastActivity = (meetings[0]?.start_time as string) || ''

  const showTitle = !skip('name')
  const showStatus = !skip('status') && Boolean(status)
  const showDescription = !skip('description') && Boolean(description)
  const showActivity = !skip('activity') && (meetings.length > 0 || Boolean(lastActivity))
  const showTopics = topics.length > 0

  const netNew = [showTitle, showStatus, showDescription, showActivity, showTopics].filter(Boolean).length

  if (netNew === 0) return <NoAdditionalDetails />

  return (
    <div className="space-y-2">
      {(showTitle || showStatus) && (
        <div className="flex items-start justify-between gap-2">
          {showTitle ? (
            <p className="flex items-center gap-1.5 font-semibold text-sm leading-tight truncate">
              <Folder className="h-3.5 w-3.5 shrink-0 text-emerald-600" />
              <span className="truncate">{(p.name as string) || name}</span>
            </p>
          ) : (
            <span />
          )}
          {showStatus && (
            <Badge variant="project" className="capitalize shrink-0">
              {status}
            </Badge>
          )}
        </div>
      )}
      {showDescription && <p className="text-xs text-muted-foreground line-clamp-3">{description}</p>}
      {showActivity && (
        <div className="flex items-center gap-3 text-xs text-muted-foreground">
          {meetings.length > 0 && (
            <span className="flex items-center gap-1">
              <CalendarDays className="h-3 w-3" />
              {meetings.length} meeting{meetings.length === 1 ? '' : 's'}
            </span>
          )}
          {lastActivity && <span className="truncate">Last activity {formatDateTime(lastActivity)}</span>}
        </div>
      )}
      {showTopics && (
        <div className="flex flex-wrap items-center gap-1 pt-0.5">
          {topics.slice(0, HOVER_TOPIC_LIMIT).map((t) => (
            <span
              key={t}
              className="inline-flex items-center rounded-full bg-secondary px-2 py-0.5 text-[11px] text-secondary-foreground"
            >
              {t}
            </span>
          ))}
        </div>
      )}
    </div>
  )
}

export function MeetingHoverCard({
  id,
  name,
  visibleFields = []
}: {
  id: string
  name: string
  visibleFields?: MeetingHoverField[]
}) {
  const [meeting, setMeeting] = useState<Record<string, unknown> | null>(null)
  const [loading, setLoading] = useState(true)
  const { participants, loading: participantsLoading } = useMeetingParticipants(id)
  const { intel, loading: intelLoading } = useMeetingRecordingIntel(id)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    ;(async () => {
      try {
        const data = await window.electronAPI.meetings.getById(id)
        if (!cancelled && data) setMeeting(data as Record<string, unknown>)
      } catch {
        /* leave minimal card */
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [id])

  const skip = (f: MeetingHoverField) => visibleFields.includes(f)

  if (loading && !meeting) return <HoverCardSkeleton label={name} />

  const m = meeting ?? {}
  const subject = (m.subject as string) || name
  const startTime = (m.start_time as string) || ''
  const organizer = (m.organizer_name as string) || ''
  const location = (m.location as string) || ''
  const description = (m.description as string) || ''
  const joinUrl = (m.meeting_url as string) || extractMeetingUrl(description) || ''
  const agenda = meaningfulDescriptionLines(description, 4)

  const showTitle = !skip('title')
  const showTime = !skip('time') && Boolean(startTime)
  const showOrganizer = !skip('organizer') && Boolean(organizer)
  const showAgenda = !skip('agenda') && agenda.length > 0
  const showLocation = !skip('location') && Boolean(location)
  const showJoin = !skip('join') && Boolean(joinUrl)
  const showParticipants = !skip('participants') && participants.length > 0
  const showRecording = !skip('recording') && Boolean(intel?.recorded)

  const netNew = [
    showTitle,
    showTime,
    showOrganizer,
    showAgenda,
    showLocation,
    showJoin,
    showParticipants,
    showRecording
  ].filter(Boolean).length

  // Hold the skeleton while async enrichment (participants / recording intel)
  // might still flip an empty card non-empty, so the "No additional details"
  // fallback never flashes before content arrives.
  const asyncPending = participantsLoading || intelLoading
  if (netNew === 0) {
    if (asyncPending) return <HoverCardSkeleton label={name} />
    return <NoAdditionalDetails />
  }

  const recordingLabel = !intel?.recorded
    ? ''
    : intel.transcribed
      ? intel.wordCount
        ? `Recorded · transcribed (${intel.wordCount.toLocaleString()} words)`
        : 'Recorded · transcript available'
      : 'Recorded'

  return (
    <div className="space-y-2">
      {showTitle && (
        <p className="flex items-center gap-1.5 font-semibold text-sm leading-tight">
          <CalendarDays className="h-3.5 w-3.5 shrink-0 text-violet-600" />
          <span className="truncate">{subject}</span>
        </p>
      )}
      {showTime && <p className="text-xs text-muted-foreground">{formatDateTime(startTime)}</p>}
      {showOrganizer && (
        <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <Users className="h-3 w-3 shrink-0" />
          <span className="truncate">{organizer}</span>
        </p>
      )}
      {showAgenda && (
        <ul className="space-y-0.5 text-xs text-muted-foreground">
          {agenda.map((line, i) => (
            <li key={i} className="truncate">
              {line}
            </li>
          ))}
        </ul>
      )}
      {showLocation && (
        <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <MapPin className="h-3 w-3 shrink-0" />
          <span className="truncate">{location}</span>
        </p>
      )}
      {showJoin && (
        <a
          href={joinUrl}
          target="_blank"
          rel="noreferrer"
          className="flex items-center gap-1.5 text-xs font-medium text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <Video className="h-3 w-3 shrink-0" />
          <span className="truncate">Join meeting</span>
        </a>
      )}
      {showRecording && (
        <p className="flex items-center gap-1.5 text-xs font-medium text-emerald-600 dark:text-emerald-500">
          <Mic className="h-3 w-3 shrink-0" />
          <span className="truncate">{recordingLabel}</span>
        </p>
      )}
      {showParticipants && (
        <div className="flex flex-wrap items-center gap-1 pt-0.5">
          {participants.slice(0, HOVER_PARTICIPANT_LIMIT).map((p) => (
            <span
              key={p.id}
              className="inline-flex items-center rounded-full bg-secondary px-2 py-0.5 text-[11px] text-secondary-foreground"
            >
              {participantLabel(p)}
            </span>
          ))}
          {participants.length > HOVER_PARTICIPANT_LIMIT && (
            <span className="text-[11px] text-muted-foreground">
              +{participants.length - HOVER_PARTICIPANT_LIMIT} more
            </span>
          )}
        </div>
      )}
      <OpenAffordance label="Open meeting" />
    </div>
  )
}

/**
 * Synchronous suppression pre-check for a meeting hover card. A trigger surface
 * that already holds the full meeting object can call this to decide whether the
 * card would have anything net-new *before* mounting the HoverCard wrapper —
 * avoiding a card that only echoes the row. Reads the shared participant/recording
 * caches synchronously; an unfetched meeting counts those as "unknown/absent"
 * (matching the design: prefer a plain row over a card that pops in empty).
 *
 * Returns true when at least one non-skipped section would render.
 */
export function meetingHoverWillHaveContent(
  meeting:
    | {
        id?: string
        description?: string | null
        location?: string | null
        meeting_url?: string | null
        organizer_name?: string | null
      }
    | null
    | undefined,
  visibleFields: MeetingHoverField[] = []
): boolean {
  if (!meeting) return false
  const skip = (f: MeetingHoverField) => visibleFields.includes(f)
  const description = meeting.description || ''
  const cachedParticipants = getCachedMeetingParticipants(meeting.id)
  const cachedIntel = getCachedMeetingRecordingIntel(meeting.id)

  if (!skip('organizer') && meeting.organizer_name) return true
  if (!skip('agenda') && meaningfulDescriptionLines(description, 1).length > 0) return true
  if (!skip('location') && meeting.location) return true
  if (!skip('join') && (meeting.meeting_url || extractMeetingUrl(description))) return true
  if (!skip('participants') && (cachedParticipants?.length ?? 0) > 0) return true
  if (!skip('recording') && cachedIntel?.recorded) return true
  return false
}
