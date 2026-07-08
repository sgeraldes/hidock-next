import { useEffect, useState } from 'react'
import { Loader2, Mail, Briefcase, CalendarDays, Users, Folder } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { formatDateTime } from '@/lib/utils'

/**
 * Hover-card bodies for entity mentions. Each fetches its own detail lazily —
 * they only mount when the popover opens (Radix Popover.Content mounts on open),
 * so the IPC call runs on hover/focus, not on initial render of the mention.
 */

function HoverCardSkeleton({ label }: { label: string }) {
  return (
    <div className="flex items-center gap-2 text-sm text-muted-foreground">
      <Loader2 className="h-4 w-4 animate-spin" />
      <span className="truncate">{label}</span>
    </div>
  )
}

export function PersonHoverCard({ id, name }: { id: string; name: string }) {
  const [contact, setContact] = useState<Record<string, unknown> | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    ;(async () => {
      try {
        const res = await window.electronAPI.contacts.getById(id)
        if (!cancelled && res.success && res.data?.contact) {
          setContact(res.data.contact as unknown as Record<string, unknown>)
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

  if (loading && !contact) return <HoverCardSkeleton label={name} />

  const c = contact ?? {}
  const type = (c.type as string) || 'unknown'
  const email = (c.email as string) || ''
  const role = (c.role as string) || ''
  const company = (c.company as string) || ''
  const meetingCount = (c.meeting_count as number) ?? (c.interactionCount as number) ?? undefined
  const lastSeen = (c.last_seen_at as string) || (c.lastSeenAt as string) || ''

  return (
    <div className="space-y-2">
      <div className="flex items-start justify-between gap-2">
        <p className="font-semibold text-sm leading-tight truncate">{(c.name as string) || name}</p>
        <Badge variant="person" className="capitalize shrink-0">
          {type}
        </Badge>
      </div>
      {(role || company) && (
        <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <Briefcase className="h-3 w-3 shrink-0" />
          <span className="truncate">{[role, company].filter(Boolean).join(' · ')}</span>
        </p>
      )}
      {email && (
        <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <Mail className="h-3 w-3 shrink-0" />
          <span className="truncate">{email}</span>
        </p>
      )}
      <div className="flex items-center gap-3 pt-1 text-xs text-muted-foreground">
        {meetingCount !== undefined && (
          <span className="flex items-center gap-1">
            <Users className="h-3 w-3" />
            {meetingCount} meeting{meetingCount === 1 ? '' : 's'}
          </span>
        )}
        {lastSeen && (
          <span className="flex items-center gap-1">
            <CalendarDays className="h-3 w-3" />
            {formatDateTime(lastSeen)}
          </span>
        )}
      </div>
    </div>
  )
}

export function ProjectHoverCard({ id, name }: { id: string; name: string }) {
  const [project, setProject] = useState<Record<string, unknown> | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    ;(async () => {
      try {
        const res = await window.electronAPI.projects.getById(id)
        if (!cancelled && res.success && res.data?.project) {
          setProject(res.data.project as unknown as Record<string, unknown>)
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

  if (loading && !project) return <HoverCardSkeleton label={name} />

  const p = project ?? {}
  const status = (p.status as string) || ''
  const description = (p.description as string) || ''

  return (
    <div className="space-y-2">
      <div className="flex items-start justify-between gap-2">
        <p className="flex items-center gap-1.5 font-semibold text-sm leading-tight truncate">
          <Folder className="h-3.5 w-3.5 shrink-0 text-emerald-600" />
          <span className="truncate">{(p.name as string) || name}</span>
        </p>
        {status && (
          <Badge variant="project" className="capitalize shrink-0">
            {status}
          </Badge>
        )}
      </div>
      {description && <p className="text-xs text-muted-foreground line-clamp-3">{description}</p>}
    </div>
  )
}

export function MeetingHoverCard({ id, name }: { id: string; name: string }) {
  const [meeting, setMeeting] = useState<Record<string, unknown> | null>(null)
  const [loading, setLoading] = useState(true)

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

  if (loading && !meeting) return <HoverCardSkeleton label={name} />

  const m = meeting ?? {}
  const subject = (m.subject as string) || name
  const startTime = (m.start_time as string) || ''
  const organizer = (m.organizer_name as string) || ''

  return (
    <div className="space-y-2">
      <p className="flex items-center gap-1.5 font-semibold text-sm leading-tight">
        <CalendarDays className="h-3.5 w-3.5 shrink-0 text-violet-600" />
        <span className="truncate">{subject}</span>
      </p>
      {startTime && <p className="text-xs text-muted-foreground">{formatDateTime(startTime)}</p>}
      {organizer && (
        <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <Users className="h-3 w-3 shrink-0" />
          <span className="truncate">{organizer}</span>
        </p>
      )}
    </div>
  )
}
