import { useEffect, useState } from 'react'
import { format } from 'date-fns'
import { Trash2, ChevronDown, ChevronUp, Clock, FileText, ImageIcon, CalendarDays } from 'lucide-react'
import { useSessionStore } from '../stores/session-store'
import { useNotesStore } from '../stores/notes-store'
import { useTranscriptStore } from '../stores/transcript-store'
import type { Session } from '../types/models'
import { Button } from '../components/ui/button'
import { Badge } from '../components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '../components/ui/dialog'
import { ScrollArea } from '../components/ui/scroll-area'
import { TranscriptViewer } from '../components/transcript/TranscriptViewer'
import { ScreenshotGallery } from '../components/screenshots/ScreenshotGallery'
import { cn } from '../lib/utils'

// ── Helpers ───────────────────────────────────────────────────────────────────

function formatDuration(startedAt: number, endedAt: number | null): string {
  const endMs = endedAt ?? Date.now()
  const totalSecs = Math.floor((endMs - startedAt) / 1000)
  const h = Math.floor(totalSecs / 3600)
  const m = Math.floor((totalSecs % 3600) / 60)
  const s = totalSecs % 60
  if (h > 0) return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
}

function statusVariant(status: Session['status']): 'live' | 'warning' | 'success' {
  if (status === 'recording') return 'live'
  if (status === 'processing') return 'warning'
  return 'success'
}

function statusLabel(status: Session['status']): string {
  if (status === 'recording') return 'Live'
  if (status === 'processing') return 'Processing'
  return 'Completed'
}

// ── Session Detail Panel ──────────────────────────────────────────────────────

interface SessionDetailProps {
  session: Session
}

function SessionDetail({ session }: SessionDetailProps) {
  const { notes, fetchForSession } = useNotesStore()
  const { fetchSegments, segments } = useTranscriptStore()

  useEffect(() => {
    fetchForSession(session.id)
    fetchSegments(session.id)
  }, [session.id, fetchForSession, fetchSegments])

  const sessionNote = notes.find((n) => n.session_id === session.id)

  return (
    <div className="flex flex-col gap-4 pt-3 border-t border-border/50">
      {/* Transcript */}
      <div>
        <h3 className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground mb-2 flex items-center gap-1.5">
          <FileText className="w-3 h-3" />
          Transcript
          <span className="ml-1 font-mono text-[10px]">({segments.length} segments)</span>
        </h3>
        <div className="rounded-lg border border-border bg-background/60 h-48 overflow-hidden">
          <TranscriptViewer sessionId={session.id} sessionStartedAt={session.startedAt} />
        </div>
      </div>

      {/* Notes */}
      {sessionNote && (
        <div>
          <h3 className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground mb-2 flex items-center gap-1.5">
            <FileText className="w-3 h-3" />
            Notes
          </h3>
          <div className="rounded-lg border border-border bg-background/60 p-3 max-h-40 overflow-y-auto">
            <p className="font-sans text-[13px] text-foreground whitespace-pre-wrap leading-relaxed">
              {sessionNote.content}
            </p>
          </div>
        </div>
      )}

      {/* Screenshots */}
      <div>
        <h3 className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground mb-2 flex items-center gap-1.5">
          <ImageIcon className="w-3 h-3" />
          Screenshots
        </h3>
        <ScreenshotGallery sessionId={session.id} />
      </div>
    </div>
  )
}

// ── Session Card ──────────────────────────────────────────────────────────────

interface SessionCardProps {
  session: Session
  expanded: boolean
  onToggle: () => void
  onDelete: () => void
}

function SessionCard({ session, expanded, onToggle, onDelete }: SessionCardProps) {
  return (
    <Card className={cn('transition-all duration-standard', expanded && 'border-primary/30')}>
      {/* Header row */}
      <CardHeader className="pb-2">
        <div className="flex items-start gap-3">
          <div className="flex flex-col gap-1 flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <CardTitle className="truncate">{session.title}</CardTitle>
              <Badge variant={statusVariant(session.status)} className="shrink-0">
                {statusLabel(session.status)}
              </Badge>
            </div>
            <div className="flex items-center gap-3 text-[12px] text-muted-foreground">
              <span className="flex items-center gap-1">
                <CalendarDays className="w-3 h-3" />
                {format(new Date(session.startedAt), 'MMM d, yyyy · HH:mm')}
              </span>
              <span className="flex items-center gap-1">
                <Clock className="w-3 h-3" />
                <span className="font-mono">{formatDuration(session.startedAt, session.endedAt)}</span>
              </span>
            </div>
          </div>

          <div className="flex items-center gap-1 shrink-0">
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7 text-muted-foreground hover:text-destructive"
              onClick={(e) => { e.stopPropagation(); onDelete() }}
              title="Delete session"
            >
              <Trash2 className="w-3.5 h-3.5" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7 text-muted-foreground"
              onClick={onToggle}
              title={expanded ? 'Collapse' : 'Expand'}
            >
              {expanded ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
            </Button>
          </div>
        </div>
      </CardHeader>

      {/* Detail panel */}
      {expanded && (
        <CardContent className="pt-0">
          <SessionDetail session={session} />
        </CardContent>
      )}
    </Card>
  )
}

// ── Empty State ───────────────────────────────────────────────────────────────

function EmptyState() {
  return (
    <div className="flex flex-col items-center justify-center flex-1 gap-3 py-20 text-center">
      <div className="flex items-center justify-center w-14 h-14 rounded-2xl bg-muted/60 border border-border mb-1">
        <CalendarDays className="w-7 h-7 text-muted-foreground" />
      </div>
      <p className="font-display text-base font-semibold text-foreground">No sessions recorded yet</p>
      <p className="font-sans text-sm text-muted-foreground max-w-xs leading-relaxed">
        Start a recording from the Dashboard — your sessions will appear here.
      </p>
    </div>
  )
}

// ── Sessions Page ─────────────────────────────────────────────────────────────

export default function Sessions() {
  const { sessions, loading, fetchSessions, deleteSession } = useSessionStore()
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [deleteTargetId, setDeleteTargetId] = useState<string | null>(null)

  useEffect(() => {
    fetchSessions()
  }, [fetchSessions])

  // Sort newest first
  const sorted = [...sessions].sort((a, b) => b.startedAt - a.startedAt)

  function handleToggle(id: string) {
    setExpandedId((prev) => (prev === id ? null : id))
  }

  async function handleConfirmDelete() {
    if (deleteTargetId) {
      await deleteSession(deleteTargetId)
      if (expandedId === deleteTargetId) setExpandedId(null)
      setDeleteTargetId(null)
    }
  }

  const deleteTarget = sessions.find((s) => s.id === deleteTargetId)

  return (
    <div className="flex flex-col h-full p-6 gap-5 min-h-0">
      {/* Page header */}
      <div className="flex items-center justify-between shrink-0">
        <h1 className="font-display text-2xl font-bold text-foreground tracking-tight">Sessions</h1>
        {sessions.length > 0 && (
          <span className="font-mono text-sm text-muted-foreground">{sessions.length} total</span>
        )}
      </div>

      {/* Session list */}
      {loading && sessions.length === 0 ? (
        <div className="flex items-center justify-center flex-1">
          <p className="font-sans text-sm text-muted-foreground">Loading sessions…</p>
        </div>
      ) : sorted.length === 0 ? (
        <EmptyState />
      ) : (
        <ScrollArea className="flex-1 min-h-0">
          <div className="flex flex-col gap-3 pr-2">
            {sorted.map((session) => (
              <SessionCard
                key={session.id}
                session={session}
                expanded={expandedId === session.id}
                onToggle={() => handleToggle(session.id)}
                onDelete={() => setDeleteTargetId(session.id)}
              />
            ))}
          </div>
        </ScrollArea>
      )}

      {/* Delete confirmation dialog */}
      <Dialog open={deleteTargetId !== null} onOpenChange={(open) => { if (!open) setDeleteTargetId(null) }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete session?</DialogTitle>
            <DialogDescription>
              {deleteTarget
                ? `"${deleteTarget.title}" recorded on ${format(new Date(deleteTarget.startedAt), 'MMM d, yyyy')} will be permanently deleted along with its transcript, notes, and screenshots.`
                : 'This session will be permanently deleted.'}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="secondary" onClick={() => setDeleteTargetId(null)}>Cancel</Button>
            <Button variant="destructive" onClick={handleConfirmDelete}>Delete</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
