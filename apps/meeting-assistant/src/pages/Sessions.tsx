import { useEffect, useState } from 'react'
import { format } from 'date-fns'
import { Trash2, Clock, CalendarDays, Search } from 'lucide-react'
import { useSessionStore } from '../stores/session-store'
import { useNotesStore } from '../stores/notes-store'
import { useTranscriptStore } from '../stores/transcript-store'
import { useSuggestionStore } from '../stores/suggestion-store'
import type { Session } from '../types/models'
import { Button } from '../components/ui/button'
import { Badge } from '../components/ui/badge'
import { Input } from '../components/ui/input'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '../components/ui/dialog'
import { ScrollArea } from '../components/ui/scroll-area'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '../components/ui/tabs'
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

// ── Notes Panel ───────────────────────────────────────────────────────────────

function NotesPanel({ session }: { session: Session }) {
  const { notes, fetchForSession } = useNotesStore()

  useEffect(() => {
    fetchForSession(session.id)
  }, [session.id, fetchForSession])

  const sessionNote = notes.find((n) => n.session_id === session.id)

  if (!sessionNote) {
    return (
      <div className="flex items-center justify-center h-full text-muted-foreground text-sm">
        No notes for this session
      </div>
    )
  }

  return (
    <ScrollArea className="h-full">
      <div className="p-4">
        <p className="font-sans text-[13px] text-foreground whitespace-pre-wrap leading-relaxed">
          {sessionNote.content}
        </p>
      </div>
    </ScrollArea>
  )
}

// ── Suggestions Panel ─────────────────────────────────────────────────────────

function SuggestionsPanel({ session }: { session: Session }) {
  const { suggestions, fetchActive, dismiss } = useSuggestionStore()

  useEffect(() => {
    fetchActive(session.id)
  }, [session.id, fetchActive])

  const sessionSuggestions = suggestions.filter((s) => !s.dismissed)

  if (sessionSuggestions.length === 0) {
    return (
      <div className="flex items-center justify-center h-full text-muted-foreground text-sm">
        No suggestions for this session
      </div>
    )
  }

  return (
    <ScrollArea className="h-full">
      <div className="flex flex-col gap-2 p-4">
        {sessionSuggestions.map((s) => (
          <div
            key={s.id}
            className="flex items-start gap-3 p-3 rounded-lg border border-border bg-muted/20"
          >
            <p className="flex-1 font-sans text-[13px] text-foreground leading-relaxed">{s.text}</p>
            <Button
              variant="ghost"
              size="sm"
              className="shrink-0 text-muted-foreground hover:text-foreground"
              onClick={() => dismiss(s.id)}
            >
              Dismiss
            </Button>
          </div>
        ))}
      </div>
    </ScrollArea>
  )
}

// ── Session Detail ────────────────────────────────────────────────────────────

interface SessionDetailProps {
  session: Session
  onDelete: () => void
}

function SessionDetail({ session, onDelete }: SessionDetailProps) {
  const { fetchSegments } = useTranscriptStore()

  useEffect(() => {
    fetchSegments(session.id)
  }, [session.id, fetchSegments])

  return (
    <div className="flex flex-col h-full min-h-0">
      {/* Header */}
      <div className="flex items-start gap-3 px-5 py-4 border-b border-border/50 shrink-0">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <h2 className="font-display text-base font-semibold text-foreground truncate">
              {session.title}
            </h2>
            <Badge variant={statusVariant(session.status)} className="shrink-0">
              {statusLabel(session.status)}
            </Badge>
          </div>
          <div className="flex items-center gap-3 mt-1 text-[12px] text-muted-foreground">
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
        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7 shrink-0 text-muted-foreground hover:text-destructive"
          onClick={onDelete}
          title="Delete session"
        >
          <Trash2 className="w-3.5 h-3.5" />
        </Button>
      </div>

      {/* Tabs */}
      <Tabs defaultValue="transcript" className="flex flex-col flex-1 min-h-0">
        <div className="px-5 shrink-0">
          <TabsList>
            <TabsTrigger value="transcript">Transcript</TabsTrigger>
            <TabsTrigger value="notes">Notes</TabsTrigger>
            <TabsTrigger value="screenshots">Screenshots</TabsTrigger>
            <TabsTrigger value="suggestions">Suggestions</TabsTrigger>
          </TabsList>
        </div>
        <TabsContent value="transcript" className="flex-1 min-h-0 overflow-hidden px-5 pb-4">
          <div className="h-full rounded-lg border border-border bg-background/60 overflow-hidden">
            <TranscriptViewer sessionId={session.id} sessionStartedAt={session.startedAt} />
          </div>
        </TabsContent>
        <TabsContent value="notes" className="flex-1 min-h-0 overflow-hidden px-5 pb-4">
          <div className="h-full rounded-lg border border-border bg-background/60 overflow-hidden">
            <NotesPanel session={session} />
          </div>
        </TabsContent>
        <TabsContent value="screenshots" className="flex-1 min-h-0 overflow-hidden px-5 pb-4">
          <div className="h-full rounded-lg border border-border bg-background/60 overflow-hidden">
            <ScrollArea className="h-full">
              <div className="p-4">
                <ScreenshotGallery sessionId={session.id} />
              </div>
            </ScrollArea>
          </div>
        </TabsContent>
        <TabsContent value="suggestions" className="flex-1 min-h-0 overflow-hidden px-5 pb-4">
          <div className="h-full rounded-lg border border-border bg-background/60 overflow-hidden">
            <SuggestionsPanel session={session} />
          </div>
        </TabsContent>
      </Tabs>
    </div>
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
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [deleteTargetId, setDeleteTargetId] = useState<string | null>(null)

  useEffect(() => {
    fetchSessions()
  }, [fetchSessions])

  // Sort newest first
  const sorted = [...sessions].sort((a, b) => b.startedAt - a.startedAt)

  // Filter by search
  const filtered = search.trim()
    ? sorted.filter((s) => s.title.toLowerCase().includes(search.trim().toLowerCase()))
    : sorted

  // Auto-select first session when list loads
  useEffect(() => {
    if (!selectedId && filtered.length > 0) {
      setSelectedId(filtered[0].id)
    }
  }, [filtered.length, selectedId])

  const selectedSession = sessions.find((s) => s.id === selectedId) ?? null

  async function handleConfirmDelete() {
    if (deleteTargetId) {
      await deleteSession(deleteTargetId)
      if (selectedId === deleteTargetId) {
        // Select next session after deletion
        const remaining = sorted.filter((s) => s.id !== deleteTargetId)
        setSelectedId(remaining.length > 0 ? remaining[0].id : null)
      }
      setDeleteTargetId(null)
    }
  }

  const deleteTarget = sessions.find((s) => s.id === deleteTargetId)

  if (loading && sessions.length === 0) {
    return (
      <div className="flex items-center justify-center h-full">
        <p className="font-sans text-sm text-muted-foreground">Loading sessions…</p>
      </div>
    )
  }

  if (sessions.length === 0) {
    return <EmptyState />
  }

  return (
    <div className="flex h-full gap-0 min-h-0">
      {/* Left: Session List */}
      <div className="w-80 shrink-0 flex flex-col border-r border-border min-h-0">
        {/* Header */}
        <div className="px-4 pt-5 pb-3 shrink-0">
          <div className="flex items-center justify-between mb-3">
            <h1 className="font-display text-lg font-bold text-foreground tracking-tight">Sessions</h1>
            <span className="font-mono text-xs text-muted-foreground">{sessions.length} total</span>
          </div>
          {/* Search */}
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground pointer-events-none" />
            <Input
              className="pl-8"
              placeholder="Search sessions…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
        </div>

        {/* Session list */}
        <ScrollArea className="flex-1 min-h-0">
          <div className="flex flex-col gap-1 px-2 pb-4">
            {filtered.length === 0 ? (
              <p className="text-center text-[12px] text-muted-foreground py-8">No sessions match</p>
            ) : (
              filtered.map((session) => (
                <button
                  key={session.id}
                  type="button"
                  onClick={() => setSelectedId(session.id)}
                  className={cn(
                    'w-full text-left px-3 py-2.5 rounded-lg transition-colors duration-micro',
                    'hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                    selectedId === session.id ? 'bg-muted' : '',
                  )}
                >
                  <div className="flex items-center gap-2">
                    <span className="flex-1 font-medium text-[13px] text-foreground truncate">
                      {session.title}
                    </span>
                    <Badge variant={statusVariant(session.status)} className="shrink-0 text-[10px]">
                      {statusLabel(session.status)}
                    </Badge>
                  </div>
                  <div className="flex items-center justify-between mt-0.5">
                    <span className="text-[11px] text-muted-foreground">
                      {format(new Date(session.startedAt), 'MMM d, yyyy · HH:mm')}
                    </span>
                    <span className="font-mono text-[11px] text-muted-foreground">
                      {formatDuration(session.startedAt, session.endedAt)}
                    </span>
                  </div>
                </button>
              ))
            )}
          </div>
        </ScrollArea>
      </div>

      {/* Right: Session Detail */}
      <div className="flex-1 flex flex-col min-h-0 overflow-hidden">
        {selectedSession ? (
          <SessionDetail
            session={selectedSession}
            onDelete={() => setDeleteTargetId(selectedSession.id)}
          />
        ) : (
          <div className="flex-1 flex items-center justify-center text-muted-foreground text-sm">
            Select a session to view details
          </div>
        )}
      </div>

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
