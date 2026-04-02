import { useEffect, useState } from 'react'
import { isToday, isYesterday, isValid } from 'date-fns'
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
import { Tabs, TabsList, TabsTrigger } from '../components/ui/tabs'
import { cn } from '../lib/utils'
import { safeFormat } from '../lib/date-format'

// ── Date grouping ──────────────────────────────────────────────────────────────

function formatDateGroup(timestamp: number): string {
  if (timestamp == null || isNaN(timestamp)) return '--'
  const date = new Date(timestamp)
  if (!isValid(date)) return '--'
  if (isToday(date)) return 'Today'
  if (isYesterday(date)) return 'Yesterday'
  return safeFormat(timestamp, 'MMM d, yyyy')
}

function groupByDate(notes: Note[]): [string, Note[]][] {
  const groups = new Map<string, Note[]>()
  for (const note of notes) {
    const label = formatDateGroup(note.created_at)
    if (!groups.has(label)) groups.set(label, [])
    groups.get(label)!.push(note)
  }
  return [...groups.entries()]
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

// ── Note Editor ────────────────────────────────────────────────────────────────

interface NoteEditorProps {
  note: Note
  onSave: (noteId: string, content: string) => Promise<void>
}

function NoteEditor({ note, onSave }: NoteEditorProps) {
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
    <div className="flex flex-col h-full min-h-0 gap-2 p-4">
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
            Updated {safeFormat(note.updated_at, 'MMM d, HH:mm')}
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

type CategoryFilter = 'all' | 'meeting' | 'action'

export default function Notes() {
  const { notes, templates, generationProgress, fetchForSession, generate, update, fetchTemplates } =
    useNotesStore()
  const { sessions, fetchSessions } = useSessionStore()

  const [selectedNoteId, setSelectedNoteId] = useState<string | null>(null)
  const [selectedSessionId, setSelectedSessionId] = useState<string>('')
  const [selectedTemplateId, setSelectedTemplateId] = useState<string>('')
  const [categoryFilter, setCategoryFilter] = useState<CategoryFilter>('all')
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

  // All notes sorted newest-first
  const sortedNotes = [...notes].sort((a, b) => b.created_at - a.created_at)

  // Category filter (session_id lookup for 'meeting' vs standalone for 'action')
  const filteredNotes = sortedNotes.filter((note) => {
    if (categoryFilter === 'meeting') return !!note.session_id
    if (categoryFilter === 'action') return !note.session_id
    return true
  })

  const groupedNotes = groupByDate(filteredNotes)

  const selectedNote = notes.find((n) => n.id === selectedNoteId) ?? null

  // Auto-select first note when list loads/changes
  useEffect(() => {
    if (!selectedNoteId && filteredNotes.length > 0) {
      setSelectedNoteId(filteredNotes[0].id)
    }
  }, [filteredNotes.length, selectedNoteId])

  async function handleGenerate() {
    if (!selectedSessionId) return
    setGenerating(true)
    const templateId = selectedTemplateId && selectedTemplateId !== '__default__' ? selectedTemplateId : undefined
    const note = await generate(selectedSessionId, templateId)
    if (note) setSelectedNoteId(note.id)
    setGenerating(false)
  }

  const isGenerating = generating || generationProgress !== null

  return (
    <div className="flex h-full min-h-0 gap-0">
      {/* Left: Notes List */}
      <div className="w-72 shrink-0 flex flex-col border-r border-border min-h-0">
        {/* Header */}
        <div className="px-4 pt-5 pb-3 shrink-0">
          <h1 className="font-display text-lg font-bold text-foreground tracking-tight mb-3">Notes</h1>

          {/* Category filter tabs */}
          <Tabs value={categoryFilter} onValueChange={(v) => setCategoryFilter(v as CategoryFilter)}>
            <TabsList className="w-full">
              <TabsTrigger value="all" className="flex-1 text-[11px]">All</TabsTrigger>
              <TabsTrigger value="meeting" className="flex-1 text-[11px]">Meetings</TabsTrigger>
              <TabsTrigger value="action" className="flex-1 text-[11px]">Actions</TabsTrigger>
            </TabsList>
          </Tabs>
        </div>

        {/* Notes grouped by date */}
        <ScrollArea className="flex-1 min-h-0">
          <div className="pb-4">
            {filteredNotes.length === 0 ? (
              <p className="text-center text-[12px] text-muted-foreground py-8 px-4">
                No notes yet
              </p>
            ) : (
              groupedNotes.map(([dateLabel, dateNotes]) => (
                <div key={dateLabel}>
                  <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground px-4 py-2 sticky top-0 bg-background/95 backdrop-blur-sm">
                    {dateLabel}
                  </div>
                  {dateNotes.map((note) => (
                    <button
                      key={note.id}
                      type="button"
                      onClick={() => setSelectedNoteId(note.id)}
                      className={cn(
                        'w-full text-left px-4 py-2 transition-colors duration-micro',
                        'hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset',
                        selectedNoteId === note.id ? 'bg-muted' : '',
                      )}
                    >
                      <div className="font-medium text-[13px] text-foreground truncate">
                        {sessions.find((s) => s.id === note.session_id)?.title ?? 'Untitled'}
                      </div>
                      <div className="text-[11px] text-muted-foreground">
                        {safeFormat(note.created_at, 'HH:mm')}
                      </div>
                    </button>
                  ))}
                </div>
              ))
            )}
          </div>
        </ScrollArea>

        {/* Generate controls at bottom of left panel */}
        <div className="px-4 py-3 border-t border-border/50 shrink-0 flex flex-col gap-2">
          {/* Session selector */}
          <Select value={selectedSessionId} onValueChange={setSelectedSessionId}>
            <SelectTrigger className="h-8 text-[12px]">
              <SelectValue placeholder="Select session…" />
            </SelectTrigger>
            <SelectContent>
              {sortedSessions.length === 0 ? (
                <div className="px-2 py-3 text-center text-[12px] text-muted-foreground">
                  No sessions found
                </div>
              ) : (
                sortedSessions.map((s) => (
                  <SelectItem key={s.id} value={s.id}>
                    {s.title} — {safeFormat(s.startedAt, 'MMM d, yyyy')}
                  </SelectItem>
                ))
              )}
            </SelectContent>
          </Select>

          {/* Template selector */}
          <Select value={selectedTemplateId} onValueChange={setSelectedTemplateId}>
            <SelectTrigger className="h-8 text-[12px]">
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

          {/* Generation progress */}
          {generationProgress !== null && (
            <GenerationProgress progress={generationProgress} />
          )}

          {/* Generate button */}
          <Button
            variant="primary"
            size="sm"
            onClick={handleGenerate}
            disabled={!selectedSessionId || isGenerating}
            className="w-full"
          >
            <Sparkles className="w-3.5 h-3.5" />
            {isGenerating ? 'Generating…' : 'Generate Notes'}
          </Button>
        </div>
      </div>

      {/* Right: Note Editor */}
      <div className="flex-1 flex flex-col min-h-0 overflow-hidden">
        {selectedNote ? (
          <>
            {/* Note header */}
            <div className="px-5 pt-4 pb-2 shrink-0 border-b border-border/50 flex items-center justify-between">
              <div>
                <h2 className="font-display text-base font-semibold text-foreground">
                  {sessions.find((s) => s.id === selectedNote.session_id)?.title ?? 'Untitled'}
                </h2>
                <div className="flex items-center gap-2 mt-0.5">
                  <Badge variant="accent">
                    <FileText className="w-3 h-3" />
                    {safeFormat(selectedNote.created_at, 'MMM d, yyyy')}
                  </Badge>
                </div>
              </div>
            </div>
            <div className="flex-1 min-h-0 overflow-hidden">
              <NoteEditor note={selectedNote} onSave={update} />
            </div>
          </>
        ) : (
          <div className="flex-1 flex items-center justify-center text-muted-foreground text-sm">
            Select a note to view
          </div>
        )}
      </div>
    </div>
  )
}
