import { useEffect, useState } from 'react'
import { format } from 'date-fns'
import { FileText, Sparkles, Save, Eye, Code2, RefreshCw } from 'lucide-react'
import { useNotesStore } from '../stores/notes-store'
import { useSessionStore } from '../stores/session-store'
import type { Note } from '../types/models'
import { Button } from '../components/ui/button'
import { Badge } from '../components/ui/badge'
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from '../components/ui/select'
import { ScrollArea } from '../components/ui/scroll-area'
import { cn } from '../lib/utils'

// ── Empty state ────────────────────────────────────────────────────────────────

function EmptyState({ hasSession }: { hasSession: boolean }) {
  return (
    <div className="flex flex-col items-center justify-center flex-1 gap-3 py-20 text-center">
      <div className="flex items-center justify-center w-14 h-14 rounded-2xl bg-muted/60 border border-border mb-1">
        <FileText className="w-7 h-7 text-muted-foreground" />
      </div>
      <p className="font-display text-base font-semibold text-foreground">
        {hasSession ? 'No notes yet for this session' : 'Select a session to view or generate notes'}
      </p>
      <p className="font-sans text-sm text-muted-foreground max-w-xs leading-relaxed">
        {hasSession
          ? 'Choose a template and click "Generate Notes" to create AI-powered notes.'
          : 'Pick a recorded session from the dropdown above to get started.'}
      </p>
    </div>
  )
}

// ── Generation progress ────────────────────────────────────────────────────────

function GenerationProgress({ progress }: { progress: number }) {
  return (
    <div className="flex flex-col gap-2 p-4 rounded-lg border border-primary/20 bg-primary/5">
      <div className="flex items-center justify-between">
        <span className="font-sans text-sm font-medium text-foreground flex items-center gap-2">
          <RefreshCw className="w-3.5 h-3.5 text-primary animate-spin" />
          Generating notes…
        </span>
        <span className="font-mono text-sm text-primary">{Math.round(progress * 100)}%</span>
      </div>
      <div className="h-1 rounded-full bg-muted overflow-hidden">
        <div
          className="h-full bg-primary rounded-full transition-all duration-standard"
          style={{ width: `${Math.round(progress * 100)}%` }}
        />
      </div>
    </div>
  )
}

// ── Notes editor ──────────────────────────────────────────────────────────────

interface NotesEditorProps {
  note: Note
  onSave: (noteId: string, content: string) => Promise<void>
}

function NotesEditor({ note, onSave }: NotesEditorProps) {
  const [content, setContent] = useState(note.content)
  const [previewMode, setPreviewMode] = useState(false)
  const [saving, setSaving] = useState(false)
  const isDirty = content !== note.content

  // Sync external note updates (e.g. after generate)
  useEffect(() => {
    setContent(note.content)
  }, [note.content])

  async function handleSave() {
    setSaving(true)
    await onSave(note.id, content)
    setSaving(false)
  }

  return (
    <div className="flex flex-col flex-1 min-h-0 gap-2">
      {/* Toolbar */}
      <div className="flex items-center justify-between shrink-0">
        <div className="flex items-center gap-1">
          <Button
            variant={!previewMode ? 'secondary' : 'ghost'}
            size="sm"
            onClick={() => setPreviewMode(false)}
          >
            <Code2 className="w-3.5 h-3.5" />
            Edit
          </Button>
          <Button
            variant={previewMode ? 'secondary' : 'ghost'}
            size="sm"
            onClick={() => setPreviewMode(true)}
          >
            <Eye className="w-3.5 h-3.5" />
            Preview
          </Button>
        </div>

        <div className="flex items-center gap-2">
          <span className="font-sans text-[11px] text-muted-foreground">
            Updated {format(new Date(note.updated_at), 'MMM d, HH:mm')}
          </span>
          {isDirty && (
            <Button variant="primary" size="sm" onClick={handleSave} disabled={saving}>
              <Save className="w-3.5 h-3.5" />
              {saving ? 'Saving…' : 'Save'}
            </Button>
          )}
        </div>
      </div>

      {/* Editor / preview */}
      <div className="flex-1 min-h-0 rounded-lg border border-border overflow-hidden">
        {previewMode ? (
          <ScrollArea className="h-full">
            <div className="p-4">
              <div
                className={cn(
                  'font-sans text-[13px] text-foreground leading-relaxed',
                  'prose-headings:font-display prose-headings:text-foreground',
                  'whitespace-pre-wrap'
                )}
              >
                {content || <span className="text-muted-foreground italic">Nothing to preview yet.</span>}
              </div>
            </div>
          </ScrollArea>
        ) : (
          <textarea
            className={cn(
              'w-full h-full resize-none bg-muted/20',
              'px-4 py-3',
              'font-mono text-[13px] text-foreground leading-relaxed',
              'placeholder:text-muted-foreground/60',
              'focus:outline-none',
              'border-0'
            )}
            value={content}
            onChange={(e) => setContent(e.target.value)}
            placeholder="Start writing your notes here…"
          />
        )}
      </div>
    </div>
  )
}

// ── Notes Page ────────────────────────────────────────────────────────────────

export default function Notes() {
  const { notes, templates, generationProgress, fetchForSession, generate, update, fetchTemplates } =
    useNotesStore()
  const { sessions, fetchSessions } = useSessionStore()

  const [selectedSessionId, setSelectedSessionId] = useState<string>('')
  const [selectedTemplateId, setSelectedTemplateId] = useState<string>('')
  const [generating, setGenerating] = useState(false)

  // Fetch data on mount
  useEffect(() => {
    fetchSessions()
    fetchTemplates()
  }, [fetchSessions, fetchTemplates])

  // When session changes, load its notes
  useEffect(() => {
    if (selectedSessionId) {
      fetchForSession(selectedSessionId)
    }
  }, [selectedSessionId, fetchForSession])

  // Sort sessions newest first for the dropdown
  const sortedSessions = [...sessions].sort((a, b) => b.startedAt - a.startedAt)

  const activeNote: Note | undefined = notes.find((n) => n.session_id === selectedSessionId)

  async function handleGenerate() {
    if (!selectedSessionId) return
    setGenerating(true)
    const templateId = selectedTemplateId && selectedTemplateId !== '__default__' ? selectedTemplateId : undefined
    await generate(selectedSessionId, templateId)
    setGenerating(false)
  }

  const isGenerating = generating || generationProgress !== null

  return (
    <div className="flex flex-col h-full p-6 gap-5 min-h-0">
      {/* Page header */}
      <div className="flex items-center justify-between shrink-0">
        <h1 className="font-display text-2xl font-bold text-foreground tracking-tight">Notes</h1>
        {activeNote && (
          <Badge variant="accent">
            <FileText className="w-3 h-3" />
            {format(new Date(activeNote.created_at), 'MMM d, yyyy')}
          </Badge>
        )}
      </div>

      {/* Controls row */}
      <div className="flex items-center gap-3 shrink-0">
        {/* Session selector */}
        <div className="flex-1 min-w-0 max-w-xs">
          <Select value={selectedSessionId} onValueChange={setSelectedSessionId}>
            <SelectTrigger>
              <SelectValue placeholder="Select a session…" />
            </SelectTrigger>
            <SelectContent>
              {sortedSessions.length === 0 ? (
                <div className="px-2 py-3 text-center text-[12px] text-muted-foreground">
                  No sessions found
                </div>
              ) : (
                sortedSessions.map((s) => (
                  <SelectItem key={s.id} value={s.id}>
                    {s.title} — {format(new Date(s.startedAt), 'MMM d, yyyy')}
                  </SelectItem>
                ))
              )}
            </SelectContent>
          </Select>
        </div>

        {/* Template selector */}
        <div className="w-48">
          <Select value={selectedTemplateId} onValueChange={setSelectedTemplateId}>
            <SelectTrigger>
              <SelectValue placeholder="Default template" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="__default__">Default template</SelectItem>
              {templates.map((t) => (
                <SelectItem key={t.id} value={t.id || `template-${t.name}`}>
                  {t.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {/* Generate button */}
        <Button
          variant="primary"
          onClick={handleGenerate}
          disabled={!selectedSessionId || isGenerating}
        >
          <Sparkles className="w-3.5 h-3.5" />
          {isGenerating ? 'Generating…' : 'Generate Notes'}
        </Button>
      </div>

      {/* Generation progress */}
      {generationProgress !== null && (
        <div className="shrink-0">
          <GenerationProgress progress={generationProgress} />
        </div>
      )}

      {/* Content area */}
      {!selectedSessionId ? (
        <EmptyState hasSession={false} />
      ) : !activeNote ? (
        <EmptyState hasSession={true} />
      ) : (
        <NotesEditor note={activeNote} onSave={update} />
      )}
    </div>
  )
}
