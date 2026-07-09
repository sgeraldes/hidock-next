import { useState, useEffect, useCallback, useRef, Suspense, lazy } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  Network,
  RefreshCw,
  Download,
  Search,
  Loader2,
  AlertCircle,
  Info,
  X,
  Maximize2,
  ArrowUpRight,
  GitMerge,
  Sparkles,
  Plus,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { toast } from '@/components/ui/toaster'
import { cn } from '@/lib/utils'
import { useUIStore } from '@/store/ui/useUIStore'
import { useTheme } from '@/hooks/useTheme'
import { ENTITY_COLORS, entityColor, relationLabel } from '@/components/context-graph/graph-theme'
import type { ContextGraphData, ContextGraphNode } from '@/components/context-graph/types'

// Canvas is heavy (force-graph + canvas) — keep it out of the initial chunk.
const ContextGraphCanvas = lazy(() => import('@/components/context-graph/ContextGraphCanvas'))

interface GraphStats {
  nodes: number
  edges: number
  nodesByType: Record<string, number>
}

const EMPTY_GRAPH: ContextGraphData = { center: null, nodes: [], edges: [] }

// The overview renders only the most-connected hubs so the first paint is
// digestible, not a whole-graph hairball. "Show more" raises the cap in steps.
const OVERVIEW_BASE_LIMIT = 150
const OVERVIEW_MAX_LIMIT = 2000
const OVERVIEW_STEP = 3

function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false)
  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return
    const mql = window.matchMedia('(prefers-reduced-motion: reduce)')
    setReduced(mql.matches)
    const onChange = () => setReduced(mql.matches)
    mql.addEventListener('change', onChange)
    return () => mql.removeEventListener('change', onChange)
  }, [])
  return reduced
}

function ProviderAwareError({ message }: { message: string }) {
  const isProviderError = /no ai provider|provider|api key/i.test(message)
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

export function ContextGraph() {
  const qaEnabled = useUIStore((s) => s.qaLogsEnabled)
  const { resolvedTheme } = useTheme()
  const isDark = resolvedTheme === 'dark'
  const reducedMotion = usePrefersReducedMotion()
  const navigate = useNavigate()

  const [stats, setStats] = useState<GraphStats | null>(null)
  const [overview, setOverview] = useState<ContextGraphData>(EMPTY_GRAPH)
  const [focus, setFocus] = useState<ContextGraphData | null>(null)
  const [viewMode, setViewMode] = useState<'overview' | 'focus'>('overview')
  const [hops, setHops] = useState<1 | 2>(1)
  const [selected, setSelected] = useState<ContextGraphNode | null>(null)
  const [highlightIds, setHighlightIds] = useState<Set<string>>(new Set())

  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // Search-to-focus
  const [query, setQuery] = useState('')
  const [suggestions, setSuggestions] = useState<ContextGraphNode[]>([])
  const [showSuggestions, setShowSuggestions] = useState(false)
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const [ingestLoading, setIngestLoading] = useState(false)
  const [rekeyLoading, setRekeyLoading] = useState(false)
  const [pruneLoading, setPruneLoading] = useState(false)
  const [overviewLimit, setOverviewLimit] = useState(OVERVIEW_BASE_LIMIT)

  const log = useCallback(
    (...args: unknown[]) => {
      if (qaEnabled) console.log('[QA-MONITOR][ContextGraph]', ...args)
    },
    [qaEnabled]
  )

  // ---- Load overview + stats -----------------------------------------------

  const loadGraph = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      log('Loading overview graph + stats', 'limit', overviewLimit)
      const [graphRes, statsRes] = await Promise.all([
        window.electronAPI.contextGraph.getGraph(overviewLimit),
        window.electronAPI.graph.stats(),
      ])
      if (graphRes.success && graphRes.data) {
        setOverview(graphRes.data)
      } else {
        setError(graphRes.error ?? 'Failed to load the context graph')
      }
      if (statsRes.success && statsRes.data) setStats(statsRes.data)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unexpected error loading the graph')
    } finally {
      setLoading(false)
    }
  }, [log, overviewLimit])

  useEffect(() => {
    loadGraph()
  }, [loadGraph])

  // ---- Focus a node's neighborhood -----------------------------------------

  const focusEntity = useCallback(
    async (entityId: string, node?: ContextGraphNode) => {
      try {
        log('Focusing neighborhood of', entityId, 'hops', hops)
        const res = await window.electronAPI.contextGraph.getNeighborhood(entityId, hops)
        const nbrData = res.data
        if (res.success && nbrData && nbrData.nodes.length > 0) {
          setFocus(nbrData)
          setViewMode('focus')
          setHighlightIds(new Set(nbrData.nodes.map((n) => n.id)))
          const center = node ?? nbrData.nodes.find((n) => n.id === nbrData.center) ?? null
          setSelected(center)
        } else {
          toast.info('No connections', 'This entity has no neighbors in the graph yet.')
        }
      } catch (err) {
        toast.error('Focus failed', err instanceof Error ? err.message : 'Unexpected error')
      }
    },
    [hops, log]
  )

  // Re-focus when hops changes while focused.
  useEffect(() => {
    if (viewMode === 'focus' && selected) {
      focusEntity(selected.id, selected)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hops])

  const clearFocus = useCallback(() => {
    setViewMode('overview')
    setFocus(null)
    setHighlightIds(new Set())
    setSelected(null)
  }, [])

  // ---- Search-to-focus ------------------------------------------------------

  const runSearch = useCallback(
    async (q: string) => {
      if (!q.trim()) {
        setSuggestions([])
        return
      }
      try {
        const res = await window.electronAPI.contextGraph.search(q.trim())
        if (res.success) setSuggestions(res.data ?? [])
      } catch {
        setSuggestions([])
      }
    },
    []
  )

  const onQueryChange = (value: string) => {
    setQuery(value)
    setShowSuggestions(true)
    if (searchTimer.current) clearTimeout(searchTimer.current)
    searchTimer.current = setTimeout(() => runSearch(value), 200)
  }

  const pickSuggestion = (node: ContextGraphNode) => {
    setQuery(node.label)
    setShowSuggestions(false)
    focusEntity(node.id, node)
  }

  const onSearchSubmit = () => {
    if (suggestions.length > 0) {
      pickSuggestion(suggestions[0])
    }
  }

  // ---- Ingest / re-key ------------------------------------------------------

  const handleIngest = async () => {
    setIngestLoading(true)
    try {
      const res = await window.electronAPI.graph.ingestAll()
      if (res.success && res.data) {
        toast.success('Ingestion complete', `${res.data.ingested} added, ${res.data.skipped} skipped`)
        await loadGraph()
      } else {
        setError(res.error ?? 'Ingestion failed')
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unexpected error during ingestion')
    } finally {
      setIngestLoading(false)
    }
  }

  const handleRekey = async () => {
    setRekeyLoading(true)
    try {
      const res = await window.electronAPI.contextGraph.rekey()
      if (res.success && res.data) {
        toast.success(
          'People re-keyed by identity',
          `${res.data.rekeyed} re-keyed, ${res.data.merged} merged`
        )
        await loadGraph()
      } else {
        toast.error('Re-key failed', res.error ?? 'Unexpected error')
      }
    } catch (err) {
      toast.error('Re-key failed', err instanceof Error ? err.message : 'Unexpected error')
    } finally {
      setRekeyLoading(false)
    }
  }

  const handlePrune = async () => {
    setPruneLoading(true)
    try {
      const res = await window.electronAPI.contextGraph.prune()
      if (res.success && res.data) {
        const { removedNodes, removedEdges } = res.data
        if (removedNodes > 0) {
          toast.success(
            'Graph cleaned',
            `Removed ${removedNodes} generic node${removedNodes === 1 ? '' : 's'} and ${removedEdges} edge${removedEdges === 1 ? '' : 's'}`
          )
          await loadGraph()
        } else {
          toast.info('Nothing to clean', 'No generic collective/role nodes were found.')
        }
      } else {
        toast.error('Clean-up failed', res.error ?? 'Unexpected error')
      }
    } catch (err) {
      toast.error('Clean-up failed', err instanceof Error ? err.message : 'Unexpected error')
    } finally {
      setPruneLoading(false)
    }
  }

  // Explicit "show more" — raise the overview cap in steps (chunked expansion).
  const handleExpand = () => {
    setOverviewLimit((l) => Math.min(l * OVERVIEW_STEP, OVERVIEW_MAX_LIMIT))
  }

  // ---- Node interactions ----------------------------------------------------

  const onNodeClick = useCallback(
    (node: ContextGraphNode) => {
      setSelected(node)
      focusEntity(node.id, node)
    },
    [focusEntity]
  )

  const openEntityPage = (node: ContextGraphNode) => {
    if (node.type === 'person' && node.contactId) navigate(`/person/${node.contactId}`)
    else if (node.type === 'meeting' && node.meetingId) navigate(`/meeting/${node.meetingId}`)
    else if (node.type === 'project' && node.projectId)
      navigate('/projects', { state: { selectedId: node.projectId } })
  }

  const canOpen = (node: ContextGraphNode): boolean =>
    (node.type === 'person' && !!node.contactId) ||
    (node.type === 'meeting' && !!node.meetingId) ||
    (node.type === 'project' && !!node.projectId)

  const data = viewMode === 'focus' && focus ? focus : overview

  // Neighbors of the selected node (for the detail panel), derived from `data`.
  const selectedNeighbors: Array<{ node: ContextGraphNode; rel: string }> = []
  if (selected) {
    const byId = new Map(data.nodes.map((n) => [n.id, n]))
    for (const e of data.edges) {
      if (e.source === selected.id) {
        const n = byId.get(e.target)
        if (n) selectedNeighbors.push({ node: n, rel: relationLabel(e.type) })
      } else if (e.target === selected.id) {
        const n = byId.get(e.source)
        if (n) selectedNeighbors.push({ node: n, rel: relationLabel(e.type) })
      }
    }
  }

  const isEmpty = !loading && overview.nodes.length === 0

  return (
    <div className="flex flex-col h-full bg-background">
      {/* Header */}
      <header className="border-b px-6 py-4 bg-muted/5 shrink-0">
        <div className="flex items-start gap-4">
          <div className="w-10 h-10 rounded-xl bg-violet-500/10 flex items-center justify-center border border-violet-500/20 shrink-0">
            <Network className="h-5 w-5 text-violet-500" />
          </div>
          <div className="flex-1 min-w-0">
            <h1 className="text-2xl font-bold tracking-tight">Context Graph</h1>
            <p className="text-sm text-muted-foreground mt-0.5">
              The people, projects, meetings, and topics your knowledge connects — explore how they
              relate.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="ghost" size="sm" onClick={loadGraph} disabled={loading} className="gap-2">
              <RefreshCw className={cn('h-4 w-4', loading && 'animate-spin')} />
              Refresh
            </Button>
            <Button variant="outline" size="sm" onClick={handleRekey} disabled={rekeyLoading} className="gap-2" title="Re-key people by contact identity">
              {rekeyLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <GitMerge className="h-4 w-4" />}
              Re-key
            </Button>
            <Button variant="outline" size="sm" onClick={handlePrune} disabled={pruneLoading} className="gap-2" title="Remove generic collective/role nodes (e.g. “Team”, “All attendees”)">
              {pruneLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
              Clean up
            </Button>
            <Button size="sm" onClick={handleIngest} disabled={ingestLoading} className="gap-2">
              {ingestLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
              Ingest
            </Button>
          </div>
        </div>

        {/* Search + stats row */}
        <div className="mt-4 flex items-center gap-4 flex-wrap">
          <div className="relative flex-1 min-w-[240px] max-w-md">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search a person, project, topic…"
              value={query}
              onChange={(e) => onQueryChange(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && onSearchSubmit()}
              onFocus={() => query && setShowSuggestions(true)}
              className="pl-9"
              aria-label="Search the context graph"
            />
            {showSuggestions && suggestions.length > 0 && (
              <div className="absolute z-20 mt-1 w-full rounded-lg border bg-popover shadow-lg overflow-hidden">
                {suggestions.map((s) => (
                  <button
                    key={s.id}
                    className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-muted/60"
                    onClick={() => pickSuggestion(s)}
                  >
                    <span
                      className="h-2.5 w-2.5 rounded-full shrink-0"
                      style={{ backgroundColor: entityColor(s.type).light }}
                    />
                    <span className="truncate flex-1">{s.label}</span>
                    <span className="text-[10px] uppercase tracking-wider text-muted-foreground">{s.type}</span>
                  </button>
                ))}
              </div>
            )}
          </div>

          {stats && (
            <div className="flex items-center gap-4 text-sm">
              <span className="text-muted-foreground">
                <strong className="text-foreground tabular-nums">{stats.nodes}</strong> nodes
              </span>
              <span className="text-muted-foreground">
                <strong className="text-foreground tabular-nums">{stats.edges}</strong> edges
              </span>
            </div>
          )}

          {viewMode === 'focus' && (
            <div className="flex items-center gap-2">
              <div className="flex items-center rounded-lg border overflow-hidden text-xs">
                {([1, 2] as const).map((h) => (
                  <button
                    key={h}
                    onClick={() => setHops(h)}
                    className={cn(
                      'px-2.5 py-1 transition-colors',
                      hops === h ? 'bg-violet-500/15 text-violet-600 dark:text-violet-300 font-medium' : 'text-muted-foreground hover:bg-muted/50'
                    )}
                  >
                    {h} hop{h > 1 ? 's' : ''}
                  </button>
                ))}
              </div>
              <Button variant="ghost" size="sm" onClick={clearFocus} className="gap-1.5 text-muted-foreground">
                <Maximize2 className="h-3.5 w-3.5" />
                Show all
              </Button>
            </div>
          )}
        </div>

        {error && (
          <div className="mt-3">
            <ProviderAwareError message={error} />
          </div>
        )}
      </header>

      {/* Body: canvas + detail panel */}
      <div className="flex-1 min-h-0 flex">
        <div className="flex-1 min-w-0 relative">
          {loading ? (
            <div className="absolute inset-0 flex items-center justify-center">
              <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
            </div>
          ) : isEmpty ? (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-4 p-8 text-center">
              <div className="w-14 h-14 rounded-2xl bg-violet-500/10 flex items-center justify-center border border-violet-500/20">
                <Network className="h-7 w-7 text-violet-500" />
              </div>
              <div className="max-w-sm">
                <h2 className="text-lg font-semibold">No context yet</h2>
                <p className="text-sm text-muted-foreground mt-1">
                  Ingest your transcripts to build the graph of people, projects, and topics your
                  conversations connect.
                </p>
              </div>
              <Button onClick={handleIngest} disabled={ingestLoading} className="gap-2">
                {ingestLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
                Ingest transcripts
              </Button>
            </div>
          ) : (
            <Suspense
              fallback={
                <div className="absolute inset-0 flex items-center justify-center">
                  <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
                </div>
              }
            >
              <ContextGraphCanvas
                data={data}
                focusId={viewMode === 'focus' ? data.center : selected?.id ?? null}
                highlightIds={highlightIds}
                isDark={isDark}
                reducedMotion={reducedMotion}
                onNodeClick={onNodeClick}
              />
            </Suspense>
          )}

          {/* Overview hint — the first render shows only the most-connected hubs */}
          {viewMode === 'overview' && !isEmpty && !loading && (
            <div className="absolute top-3 left-1/2 -translate-x-1/2 flex items-center gap-2 rounded-full border bg-background/85 backdrop-blur px-3 py-1.5 text-[11px] text-muted-foreground shadow-sm max-w-[90%]">
              <Info className="h-3.5 w-3.5 shrink-0 text-violet-500" />
              <span className="truncate">
                Showing the{' '}
                <strong className="text-foreground tabular-nums">{overview.nodes.length}</strong>{' '}
                most connected entities — search or click any node to explore.
              </span>
              {stats && stats.nodes > overview.nodes.length && overviewLimit < OVERVIEW_MAX_LIMIT && (
                <button
                  onClick={handleExpand}
                  disabled={loading}
                  className="flex items-center gap-1 rounded-full border border-violet-500/30 bg-violet-500/10 px-2 py-0.5 font-medium text-violet-600 hover:bg-violet-500/20 dark:text-violet-300 shrink-0"
                  title="Load more of the graph"
                >
                  <Plus className="h-3 w-3" />
                  Show more
                </button>
              )}
            </div>
          )}

          {/* Legend */}
          {!isEmpty && !loading && (
            <div className="absolute bottom-3 left-3 flex flex-wrap gap-x-3 gap-y-1 rounded-lg border bg-background/85 backdrop-blur px-3 py-2 text-[11px] max-w-[70%]">
              {Object.entries(ENTITY_COLORS).map(([type, c]) => (
                <span key={type} className="flex items-center gap-1.5 text-muted-foreground">
                  <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: isDark ? c.dark : c.light }} />
                  {c.label}
                </span>
              ))}
            </div>
          )}
        </div>

        {/* Detail panel */}
        {selected && (
          <aside className="w-80 shrink-0 border-l bg-muted/5 flex flex-col overflow-hidden">
            <div className="flex items-start justify-between gap-2 border-b px-4 py-3">
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <span
                    className="h-3 w-3 rounded-full shrink-0"
                    style={{ backgroundColor: isDark ? entityColor(selected.type).dark : entityColor(selected.type).light }}
                  />
                  <span className="text-[10px] uppercase tracking-wider text-muted-foreground">{selected.type}</span>
                </div>
                <h3 className="text-sm font-semibold mt-1 break-words">{selected.label}</h3>
              </div>
              <button
                onClick={() => setSelected(null)}
                className="text-muted-foreground hover:text-foreground shrink-0"
                aria-label="Close details"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="px-4 py-3 space-y-3 overflow-auto">
              {canOpen(selected) && (
                <Button variant="outline" size="sm" className="w-full gap-2" onClick={() => openEntityPage(selected)}>
                  <ArrowUpRight className="h-4 w-4" />
                  Open {selected.type} page
                </Button>
              )}

              <div>
                <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-1.5">
                  Connections ({selectedNeighbors.length})
                </p>
                {selectedNeighbors.length === 0 ? (
                  <p className="text-xs text-muted-foreground">No connections in the current view.</p>
                ) : (
                  <ul className="space-y-1">
                    {selectedNeighbors.map(({ node, rel }, i) => (
                      <li key={`${node.id}-${i}`}>
                        <button
                          className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-muted/60"
                          onClick={() => onNodeClick(node)}
                          title={`${rel} — click to focus`}
                        >
                          <span
                            className="h-2 w-2 rounded-full shrink-0"
                            style={{ backgroundColor: isDark ? entityColor(node.type).dark : entityColor(node.type).light }}
                          />
                          <span className="truncate flex-1">{node.label}</span>
                          <span className="text-[10px] text-muted-foreground shrink-0">{rel}</span>
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </div>
          </aside>
        )}
      </div>
    </div>
  )
}

export default ContextGraph
