import { useState, useEffect } from 'react'
import { Search, Plus, Trash2, RefreshCw, FolderOpen, Database } from 'lucide-react'
import { useKnowledgeStore } from '../stores/knowledge-store'
import { useDebounce } from '../hooks/use-debounce'
import { Button } from '../components/ui/button'
import { Input } from '../components/ui/input'
import { Badge } from '../components/ui/badge'
import { Card, CardContent } from '../components/ui/card'
import { ScrollArea } from '../components/ui/scroll-area'
import { cn } from '../lib/utils'

// ── Empty state ────────────────────────────────────────────────────────────────

function EmptyState() {
  return (
    <div className="flex flex-col items-center justify-center flex-1 gap-3 py-16 text-center">
      <div className="flex items-center justify-center w-14 h-14 rounded-2xl bg-muted/60 border border-border mb-1">
        <Database className="w-7 h-7 text-muted-foreground" />
      </div>
      <p className="font-display text-base font-semibold text-foreground">
        No sources indexed yet
      </p>
      <p className="font-sans text-sm text-muted-foreground max-w-xs leading-relaxed">
        Add a folder or file to get started. The knowledge base will be automatically indexed and
        made searchable.
      </p>
    </div>
  )
}

// ── Indexing progress ──────────────────────────────────────────────────────────

function IndexingProgress({ current, total }: { current: number; total: number }) {
  const pct = total > 0 ? Math.round((current / total) * 100) : 0
  return (
    <div className="flex flex-col gap-2 p-4 rounded-lg border border-accent/20 bg-accent/5">
      <div className="flex items-center justify-between">
        <span className="font-sans text-sm font-medium text-foreground flex items-center gap-2">
          <RefreshCw className="w-3.5 h-3.5 text-accent animate-spin" />
          Indexing…
        </span>
        <span className="font-mono text-sm text-accent">
          {current} / {total} chunks
        </span>
      </div>
      <div className="h-1 rounded-full bg-muted overflow-hidden">
        <div
          className="h-full bg-accent rounded-full transition-all duration-standard"
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  )
}

// ── Search result card ─────────────────────────────────────────────────────────

interface SearchResultCardProps {
  text: string
  sourcePath?: string
  score: number
}

function SearchResultCard({ text, sourcePath, score }: SearchResultCardProps) {
  const pct = Math.round(score * 100)
  const badgeVariant = pct >= 80 ? 'success' : pct >= 60 ? 'info' : 'default'

  return (
    <Card>
      <CardContent className="py-3 flex flex-col gap-2">
        <div className="flex items-start justify-between gap-3">
          <p className="font-sans text-[13px] text-foreground leading-relaxed truncate-lines-2 flex-1">
            {text}
          </p>
          <Badge variant={badgeVariant as 'success' | 'info' | 'default'} className="shrink-0">
            {pct}%
          </Badge>
        </div>
        {sourcePath && (
          <div className="flex items-center gap-1.5">
            <FolderOpen className="w-3 h-3 text-muted-foreground shrink-0" />
            <span className="font-mono text-[11px] text-muted-foreground truncate">
              {sourcePath}
            </span>
          </div>
        )}
      </CardContent>
    </Card>
  )
}

// ── Source row ────────────────────────────────────────────────────────────────

interface SourceRowProps {
  path: string
  onRemove: (path: string) => void
}

function SourceRow({ path, onRemove }: SourceRowProps) {
  return (
    <div className="flex items-center gap-2 px-3 py-2 rounded-md border border-border bg-card group">
      <FolderOpen className="w-4 h-4 text-muted-foreground shrink-0" />
      <span className="font-mono text-[12px] text-foreground flex-1 min-w-0 truncate">{path}</span>
      <Button
        variant="ghost"
        size="icon"
        className="h-6 w-6 opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-destructive transition-opacity"
        onClick={() => onRemove(path)}
        title="Remove source"
      >
        <Trash2 className="w-3.5 h-3.5" />
      </Button>
    </div>
  )
}

// ── Knowledge Base Page ───────────────────────────────────────────────────────

// Track sources in local state — the store doesn't expose a list yet
// so we maintain one client-side (backed by IPC calls on the store).
const SOURCES_KEY = 'kb_sources_v1'

function loadSources(): string[] {
  try {
    const raw = localStorage.getItem(SOURCES_KEY)
    return raw ? (JSON.parse(raw) as string[]) : []
  } catch {
    return []
  }
}

function saveSources(sources: string[]) {
  localStorage.setItem(SOURCES_KEY, JSON.stringify(sources))
}

export default function KnowledgeBase() {
  const { searchResults, indexing, indexProgress, addSource, removeSource, search, reindex } =
    useKnowledgeStore()

  const [query, setQuery] = useState('')
  const [sources, setSources] = useState<string[]>(loadSources)
  const [newSourcePath, setNewSourcePath] = useState('')
  const [showAddInput, setShowAddInput] = useState(false)

  const debouncedQuery = useDebounce(query, 400)

  // Search whenever debounced query changes
  useEffect(() => {
    if (debouncedQuery.trim()) {
      search(debouncedQuery.trim())
    }
  }, [debouncedQuery, search])

  async function handleAddSource() {
    const path = newSourcePath.trim()
    if (!path) return
    await addSource(path)
    const updated = [...sources, path]
    setSources(updated)
    saveSources(updated)
    setNewSourcePath('')
    setShowAddInput(false)
  }

  async function handleRemoveSource(path: string) {
    await removeSource(path)
    const updated = sources.filter((s) => s !== path)
    setSources(updated)
    saveSources(updated)
  }

  function handleSearch() {
    if (query.trim()) {
      search(query.trim())
    }
  }

  return (
    <div className="flex flex-col h-full p-6 gap-5 min-h-0">
      {/* Page header */}
      <div className="flex items-center justify-between shrink-0">
        <h1 className="font-display text-2xl font-bold text-foreground tracking-tight">
          Knowledge Base
        </h1>
        {sources.length > 0 && (
          <span className="font-mono text-sm text-muted-foreground">{sources.length} source{sources.length !== 1 ? 's' : ''}</span>
        )}
      </div>

      {/* Search bar */}
      <div className="flex gap-2 shrink-0">
        <div className="relative flex-1 min-w-0">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground pointer-events-none" />
          <Input
            className="pl-8"
            placeholder="Search knowledge base…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') handleSearch() }}
          />
        </div>
        <Button variant="secondary" onClick={handleSearch} disabled={!query.trim()}>
          <Search className="w-3.5 h-3.5" />
          Search
        </Button>
      </div>

      {/* Indexing progress */}
      {indexing && indexProgress && (
        <div className="shrink-0">
          <IndexingProgress current={indexProgress.current} total={indexProgress.total} />
        </div>
      )}

      <div className="flex flex-col gap-5 flex-1 min-h-0 overflow-hidden">
        {/* Source management section */}
        <div className="flex flex-col gap-3 shrink-0">
          <div className="flex items-center justify-between">
            <h2 className="font-display text-sm font-semibold text-foreground uppercase tracking-wider">
              Sources
            </h2>
            <div className="flex items-center gap-2">
              <Button
                variant="secondary"
                size="sm"
                onClick={reindex}
                disabled={indexing || sources.length === 0}
              >
                <RefreshCw className={cn('w-3.5 h-3.5', indexing && 'animate-spin')} />
                Reindex All
              </Button>
              <Button
                variant="primary"
                size="sm"
                onClick={() => setShowAddInput((v) => !v)}
              >
                <Plus className="w-3.5 h-3.5" />
                Add Source
              </Button>
            </div>
          </div>

          {/* Add source input */}
          {showAddInput && (
            <div className="flex gap-2">
              <Input
                placeholder="Enter file or folder path…"
                value={newSourcePath}
                onChange={(e) => setNewSourcePath(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') handleAddSource() }}
                autoFocus
              />
              <Button variant="primary" size="default" onClick={handleAddSource} disabled={!newSourcePath.trim()}>
                Add
              </Button>
              <Button variant="ghost" size="default" onClick={() => { setShowAddInput(false); setNewSourcePath('') }}>
                Cancel
              </Button>
            </div>
          )}

          {/* Sources list */}
          {sources.length > 0 ? (
            <div className="flex flex-col gap-1.5">
              {sources.map((path) => (
                <SourceRow key={path} path={path} onRemove={handleRemoveSource} />
              ))}
            </div>
          ) : (
            !showAddInput && <EmptyState />
          )}
        </div>

        {/* Search results section */}
        {searchResults.length > 0 && (
          <div className="flex flex-col gap-3 min-h-0 flex-1">
            <div className="flex items-center justify-between shrink-0">
              <h2 className="font-display text-sm font-semibold text-foreground uppercase tracking-wider">
                Search Results
              </h2>
              <Badge variant="info">{searchResults.length} results</Badge>
            </div>
            <ScrollArea className="flex-1 min-h-0">
              <div className="flex flex-col gap-2 pr-2">
                {searchResults.map((result, i) => (
                  <SearchResultCard
                    key={i}
                    text={result.text}
                    sourcePath={result.source_path}
                    score={result.score}
                  />
                ))}
              </div>
            </ScrollArea>
          </div>
        )}

        {/* No results state */}
        {query && debouncedQuery && searchResults.length === 0 && (
          <div className="flex flex-col items-center justify-center py-8 text-center">
            <Search className="w-8 h-8 text-muted-foreground mb-2" />
            <p className="font-sans text-sm text-muted-foreground">
              No results found for "{debouncedQuery}"
            </p>
          </div>
        )}
      </div>
    </div>
  )
}
