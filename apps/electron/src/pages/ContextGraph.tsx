import { useState, useEffect, useCallback, useMemo, useRef, Suspense, lazy } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  Network,
  RefreshCw,
  Download,
  Search,
  Loader2,
  AlertCircle,
  Info,
  Maximize2,
  GitMerge,
  Sparkles,
  Plus,
  Layers,
  Globe2,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { toast } from '@/components/ui/toaster'
import { cn } from '@/lib/utils'
import { useUIStore } from '@/store/ui/useUIStore'
import { useTheme } from '@/hooks/useTheme'
import { ENTITY_COLORS, entityColor, STRATUM_STYLES, STRATA_ORDER } from '@/components/context-graph/graph-theme'
import type {
  ContextGraphData,
  ContextGraphNode,
  ContextLensData,
  ContextLensNode,
  Provenance,
  ProvenanceEntity,
  Stratum,
} from '@/components/context-graph/types'
import { LensPicker, type LensSelection, type LensSearchHit } from '@/components/context-graph/LensPicker'

// Canvases are heavy (force-graph + canvas) — keep them out of the initial chunk.
const StratifiedLensCanvas = lazy(() => import('@/components/context-graph/StratifiedLensCanvas'))
const ContextGraphCanvas = lazy(() => import('@/components/context-graph/ContextGraphCanvas'))
const NodeInspector = lazy(() => import('@/components/context-graph/NodeInspector'))

interface GraphStats {
  nodes: number
  edges: number
  nodesByType: Record<string, number>
}

const EMPTY_GRAPH: ContextGraphData = { center: null, nodes: [], edges: [] }
const EMPTY_LENS: ContextLensData = { center: null, nodes: [], edges: [], referenceMs: null, strata: [] }

// Atlas overview caps (the whole-graph secondary view).
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

  const [tab, setTab] = useState<'lens' | 'atlas'>('lens')
  const [stats, setStats] = useState<GraphStats | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const [ingestLoading, setIngestLoading] = useState(false)
  const [rekeyLoading, setRekeyLoading] = useState(false)
  const [pruneLoading, setPruneLoading] = useState(false)

  // ---- Lens state ----------------------------------------------------------
  const [ownerLabel, setOwnerLabel] = useState<string | null>(null)
  const [selection, setSelection] = useState<LensSelection>({ kind: 'you', centerId: null, label: 'Your context' })
  const [windowDays, setWindowDays] = useState<number | null>(30)
  const [lens, setLens] = useState<ContextLensData>(EMPTY_LENS)
  const [lensLoading, setLensLoading] = useState(false)
  const [provenance, setProvenance] = useState<Provenance | null>(null)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const historyRef = useRef<LensSelection[]>([])

  // ---- Atlas state ---------------------------------------------------------
  const [overview, setOverview] = useState<ContextGraphData>(EMPTY_GRAPH)
  const [overviewLimit, setOverviewLimit] = useState(OVERVIEW_BASE_LIMIT)
  const [atlasFocus, setAtlasFocus] = useState<ContextGraphData | null>(null)
  const [atlasSelected, setAtlasSelected] = useState<ContextGraphNode | null>(null)
  const [atlasHighlight, setAtlasHighlight] = useState<Set<string>>(new Set())
  const [query, setQuery] = useState('')
  const [suggestions, setSuggestions] = useState<ContextGraphNode[]>([])
  const [showSuggestions, setShowSuggestions] = useState(false)
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Per-stratum counts (shown vs. in-scope) for the band rail truncation affordance.
  const lensStrataByBand = useMemo(() => {
    const m = new Map<Stratum, { shown: number; total: number }>()
    for (const s of lens.strata ?? []) m.set(s.stratum as Stratum, { shown: s.shown, total: s.total })
    return m
  }, [lens.strata])
  const lensTruncated = useMemo(() => (lens.strata ?? []).some((s) => s.total > s.shown), [lens.strata])

  const log = useCallback(
    (...args: unknown[]) => {
      if (qaEnabled) console.log('[QA-MONITOR][ContextGraph]', ...args)
    },
    [qaEnabled]
  )

  // ---- Bootstrap: stats + default center + overview ------------------------
  const loadStatsAndCenter = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const [statsRes, centerRes, overviewRes] = await Promise.all([
        window.electronAPI.graph.stats(),
        window.electronAPI.contextGraph.defaultCenter(),
        window.electronAPI.contextGraph.getGraph(OVERVIEW_BASE_LIMIT),
      ])
      if (statsRes.success && statsRes.data) setStats(statsRes.data)
      if (overviewRes.success && overviewRes.data) setOverview(overviewRes.data)
      if (centerRes.success && centerRes.data) {
        const c = centerRes.data
        setOwnerLabel(c.label)
        setSelection({ kind: 'you', centerId: c.id, label: `You · ${c.label}` })
      } else {
        // No people yet → fall back to a whole-graph recent lens.
        setSelection({ kind: 'week', centerId: null, label: 'Recent activity' })
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unexpected error loading the graph')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    loadStatsAndCenter()
  }, [loadStatsAndCenter])

  // ---- Load the lens whenever the perspective / window changes -------------
  const loadLens = useCallback(async () => {
    setLensLoading(true)
    try {
      log('Loading lens', selection.kind, selection.centerId, 'window', windowDays)
      const hops = selection.centerId ? 2 : 2
      const cap = selection.centerId ? undefined : 240
      const res = await window.electronAPI.contextGraph.getLens(
        selection.centerId,
        hops,
        selection.kind === 'week' ? 7 : windowDays,
        cap
      )
      if (res.success && res.data) {
        setLens(res.data)
      } else if (res.error) {
        setError(res.error)
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unexpected error loading the lens')
    } finally {
      setLensLoading(false)
    }
  }, [selection, windowDays, log])

  useEffect(() => {
    if (tab === 'lens' && !loading) loadLens()
  }, [tab, loading, loadLens])

  // ---- Selection -----------------------------------------------------------
  // Selecting a node opens the inspector; the inspector itself loads the node's
  // detail + provenance and reports the provenance back (for the evidence-path
  // highlight), so there's a single fetch path.
  const selectNode = useCallback((node: ContextLensNode | ProvenanceEntity) => {
    setSelectedId(node.id)
  }, [])

  const clearSelection = useCallback(() => {
    setSelectedId(null)
    setProvenance(null)
  }, [])

  // Recenter the lens on a node (double-click / "center lens here").
  const recenter = useCallback(
    (node: { id: string; type: string; label: string }) => {
      historyRef.current.push(selection)
      const kind: LensSelection['kind'] =
        node.type === 'person' ? 'person' : node.type === 'project' ? 'project' : node.type === 'decision' ? 'decision' : 'person'
      setSelection({ kind, centerId: node.id, label: node.label })
      clearSelection()
    },
    [selection, clearSelection]
  )

  // Esc: close provenance → pop lens history → reset to default.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || tab !== 'lens') return
      if (selectedId) {
        clearSelection()
      } else if (historyRef.current.length > 0) {
        const prev = historyRef.current.pop()!
        setSelection(prev)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [tab, selectedId, clearSelection])

  const onSelectLens = useCallback((sel: LensSelection) => {
    historyRef.current = []
    setSelection(sel)
    setSelectedId(null)
    setProvenance(null)
  }, [])

  const onSearchEntity = useCallback(
    async (q: string, type: string): Promise<LensSearchHit[]> => {
      if (!q.trim()) return []
      try {
        const res = await window.electronAPI.contextGraph.search(q.trim())
        if (!res.success || !res.data) return []
        return res.data.filter((n) => n.type === type).map((n) => ({ id: n.id, label: n.label, type: n.type }))
      } catch {
        return []
      }
    },
    []
  )

  // ---- Entity navigation ---------------------------------------------------
  const openEntityPage = useCallback(
    (node: { type: string; contactId?: string; meetingId?: string; projectId?: string }) => {
      if (node.type === 'person' && node.contactId) navigate(`/person/${node.contactId}`)
      else if (node.type === 'meeting' && node.meetingId) navigate(`/meeting/${node.meetingId}`)
      else if (node.type === 'project' && node.projectId)
        navigate('/projects', { state: { selectedId: node.projectId } })
    },
    [navigate]
  )
  const canOpen = useCallback(
    (node: { type: string; contactId?: string; meetingId?: string; projectId?: string }): boolean =>
      (node.type === 'person' && !!node.contactId) ||
      (node.type === 'meeting' && !!node.meetingId) ||
      (node.type === 'project' && !!node.projectId),
    []
  )

  // ---- Global actions (ingest / rekey / prune) -----------------------------
  const refreshAll = useCallback(async () => {
    await loadStatsAndCenter()
    if (tab === 'lens') await loadLens()
  }, [loadStatsAndCenter, loadLens, tab])

  // Reload counts + the active view WITHOUT resetting the chosen perspective —
  // used after a node edit (rename / convert / merge / remove).
  const refreshGraphData = useCallback(async () => {
    try {
      const statsRes = await window.electronAPI.graph.stats()
      if (statsRes.success && statsRes.data) setStats(statsRes.data)
    } catch {
      /* stats are non-critical here */
    }
    if (tab === 'lens') {
      await loadLens()
    } else {
      try {
        const res = await window.electronAPI.contextGraph.getGraph(overviewLimit)
        if (res.success && res.data) setOverview(res.data)
      } catch {
        /* handled by stats error */
      }
    }
  }, [tab, loadLens, overviewLimit])

  // After a node edit, refresh data and reconcile the selection: clear it on
  // delete, or follow the surviving keeper on rename/convert/merge.
  const handleNodeChanged = useCallback(
    async (info: { keeperId?: string | null; removed?: boolean }) => {
      await refreshGraphData()
      if (info.removed) {
        setSelectedId(null)
        setProvenance(null)
        setAtlasSelected(null)
        setAtlasFocus(null)
        setAtlasHighlight(new Set())
      } else if (info.keeperId) {
        setSelectedId(info.keeperId)
      }
    },
    [refreshGraphData]
  )

  const handleIngest = async () => {
    setIngestLoading(true)
    try {
      const res = await window.electronAPI.graph.ingestAll()
      if (res.success && res.data) {
        toast.success('Ingestion complete', `${res.data.ingested} added, ${res.data.skipped} skipped`)
        await refreshAll()
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
        toast.success('People re-keyed by identity', `${res.data.rekeyed} re-keyed, ${res.data.merged} merged`)
        await refreshAll()
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
          await refreshAll()
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

  // ---- Atlas: overview + focus ---------------------------------------------
  const loadOverview = useCallback(async () => {
    try {
      const res = await window.electronAPI.contextGraph.getGraph(overviewLimit)
      if (res.success && res.data) setOverview(res.data)
    } catch {
      /* handled by stats error */
    }
  }, [overviewLimit])

  useEffect(() => {
    if (tab === 'atlas') loadOverview()
  }, [tab, loadOverview])

  const atlasFocusEntity = useCallback(async (node: ContextGraphNode) => {
    setAtlasSelected(node)
    setSelectedId(node.id) // open the inspector on it too
    try {
      const res = await window.electronAPI.contextGraph.getNeighborhood(node.id, 1)
      if (res.success && res.data && res.data.nodes.length > 0) {
        setAtlasFocus(res.data)
        setAtlasHighlight(new Set(res.data.nodes.map((n) => n.id)))
      } else {
        toast.info('No connections', 'This entity has no neighbors in the graph yet.')
      }
    } catch (err) {
      toast.error('Focus failed', err instanceof Error ? err.message : 'Unexpected error')
    }
  }, [])

  // Locate/focus a node in the active view: recenter the lens on it, or focus its
  // neighborhood in the atlas — so a selected node is always findable on the canvas.
  const handleLocate = useCallback(
    (n: { id: string; type: string; label: string }) => {
      if (tab === 'lens') recenter(n)
      else atlasFocusEntity({ id: n.id, type: n.type, label: n.label, degree: 0 })
    },
    [tab, recenter, atlasFocusEntity]
  )

  const clearAtlasFocus = useCallback(() => {
    setAtlasFocus(null)
    setAtlasSelected(null)
    setAtlasHighlight(new Set())
  }, [])

  const handleExpand = () => setOverviewLimit((l) => Math.min(l * OVERVIEW_STEP, OVERVIEW_MAX_LIMIT))
  useEffect(() => {
    if (tab === 'atlas') loadOverview()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [overviewLimit])

  const onAtlasQueryChange = (value: string) => {
    setQuery(value)
    setShowSuggestions(true)
    if (searchTimer.current) clearTimeout(searchTimer.current)
    searchTimer.current = setTimeout(async () => {
      if (!value.trim()) return setSuggestions([])
      const res = await window.electronAPI.contextGraph.search(value.trim())
      if (res.success) setSuggestions(res.data ?? [])
    }, 200)
  }

  const pickAtlasSuggestion = (node: ContextGraphNode) => {
    setQuery(node.label)
    setShowSuggestions(false)
    atlasFocusEntity(node)
  }

  const atlasData = atlasFocus ?? overview
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
              A reasoning-level view of your work — decisions, people, and the meetings they came
              from, laid out by abstraction and time.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="ghost" size="sm" onClick={refreshAll} disabled={loading} className="gap-2">
              <RefreshCw className={cn('h-4 w-4', loading && 'animate-spin')} />
              Refresh
            </Button>
            <Button variant="outline" size="sm" onClick={handleRekey} disabled={rekeyLoading} className="gap-2" title="Re-key people by contact identity">
              {rekeyLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <GitMerge className="h-4 w-4" />}
              Re-key
            </Button>
            <Button variant="outline" size="sm" onClick={handlePrune} disabled={pruneLoading} className="gap-2" title="Remove generic collective/role nodes">
              {pruneLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
              Clean up
            </Button>
            <Button size="sm" onClick={handleIngest} disabled={ingestLoading} className="gap-2">
              {ingestLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
              Ingest
            </Button>
          </div>
        </div>

        {/* Tabs: Lens (default) vs Atlas (whole graph) */}
        <div className="mt-4 flex items-center gap-4 flex-wrap">
          <div className="flex items-center rounded-lg border overflow-hidden text-sm">
            <button
              onClick={() => setTab('lens')}
              className={cn(
                'flex items-center gap-1.5 px-3 py-1.5 transition-colors',
                tab === 'lens' ? 'bg-violet-500/15 text-violet-600 dark:text-violet-300 font-medium' : 'text-muted-foreground hover:bg-muted/50'
              )}
            >
              <Layers className="h-4 w-4" />
              Lens
            </button>
            <button
              onClick={() => setTab('atlas')}
              className={cn(
                'flex items-center gap-1.5 px-3 py-1.5 transition-colors',
                tab === 'atlas' ? 'bg-violet-500/15 text-violet-600 dark:text-violet-300 font-medium' : 'text-muted-foreground hover:bg-muted/50'
              )}
            >
              <Globe2 className="h-4 w-4" />
              Atlas
            </button>
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

          {tab === 'atlas' && atlasFocus && (
            <Button variant="ghost" size="sm" onClick={clearAtlasFocus} className="gap-1.5 text-muted-foreground">
              <Maximize2 className="h-3.5 w-3.5" />
              Show all
            </Button>
          )}
        </div>

        {/* Lens controls */}
        {tab === 'lens' && !isEmpty && (
          <div className="mt-3">
            <LensPicker
              selection={selection}
              windowDays={windowDays}
              onSelect={onSelectLens}
              onWindowChange={setWindowDays}
              onSearch={onSearchEntity}
              ownerLabel={ownerLabel}
            />
          </div>
        )}

        {/* Atlas search */}
        {tab === 'atlas' && !isEmpty && (
          <div className="mt-3 relative flex-1 min-w-[240px] max-w-md">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search a person, project, topic…"
              value={query}
              onChange={(e) => onAtlasQueryChange(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && suggestions.length > 0 && pickAtlasSuggestion(suggestions[0])}
              onFocus={() => query && setShowSuggestions(true)}
              className="pl-9"
              aria-label="Search the context graph"
            />
            {showSuggestions && suggestions.length > 0 && (
              <div className="absolute z-20 mt-1 w-full rounded-lg border bg-popover shadow-lg overflow-hidden max-h-64 overflow-y-auto">
                {suggestions.map((s) => (
                  <button
                    key={s.id}
                    className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-muted/60"
                    onClick={() => pickAtlasSuggestion(s)}
                  >
                    <span className="h-2.5 w-2.5 rounded-full shrink-0" style={{ backgroundColor: entityColor(s.type).light }} />
                    <span className="truncate flex-1">{s.label}</span>
                    <span className="text-[10px] uppercase tracking-wider text-muted-foreground">{s.type}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
        )}

        {error && (
          <div className="mt-3">
            <ProviderAwareError message={error} />
          </div>
        )}
      </header>

      {/* Body */}
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
                  Ingest your transcripts to build the graph of decisions, people, projects, and the
                  meetings they came from.
                </p>
              </div>
              <Button onClick={handleIngest} disabled={ingestLoading} className="gap-2">
                {ingestLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
                Ingest transcripts
              </Button>
            </div>
          ) : tab === 'lens' ? (
            <>
              <Suspense
                fallback={
                  <div className="absolute inset-0 flex items-center justify-center">
                    <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
                  </div>
                }
              >
                <StratifiedLensCanvas
                  data={lens}
                  focusId={selectedId ?? lens.center}
                  highlightIds={provenance ? new Set(provenance.pathIds) : undefined}
                  isDark={isDark}
                  reducedMotion={reducedMotion}
                  onNodeClick={(n) => selectNode(n)}
                  onNodeDoubleClick={(n) => recenter(n)}
                />
              </Suspense>

              {lensLoading && (
                <div className="absolute top-3 right-3 rounded-full border bg-background/85 backdrop-blur px-3 py-1.5 text-[11px] text-muted-foreground shadow-sm flex items-center gap-1.5">
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  Loading lens…
                </div>
              )}

              {lens.nodes.length === 0 && !lensLoading && (
                <div className="absolute top-3 left-1/2 -translate-x-1/2 rounded-full border bg-background/85 backdrop-blur px-3 py-1.5 text-[11px] text-muted-foreground shadow-sm">
                  Nothing in this window — widen the time range or pick another lens.
                </div>
              )}

              {/* Band rail — reasoning strata, top→down. Each band reports how many
                  nodes it shows out of how many are in scope, so a capped band reads
                  "Decisions · 20 of 214" rather than silently truncating. */}
              <div className="absolute top-3 left-3 hidden sm:flex flex-col gap-1 rounded-lg border bg-background/85 backdrop-blur px-3 py-2 text-[11px] max-w-[46%]">
                <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground mb-0.5">
                  Reasoning strata
                </span>
                {STRATA_ORDER.map((s) => {
                  const count = lensStrataByBand.get(s)
                  const truncated = !!count && count.total > count.shown
                  return (
                    <span key={s} className="flex items-center gap-1.5 text-foreground">
                      <span
                        className="h-2 w-2 rounded-sm shrink-0"
                        style={{ backgroundColor: isDark ? STRATUM_STYLES[s].bgDark : STRATUM_STYLES[s].bgLight, outline: `1px solid ${isDark ? '#334155' : '#cbd5e1'}` }}
                      />
                      <strong className="font-medium">{STRATUM_STYLES[s].label}</strong>
                      {count ? (
                        <span
                          className={cn('tabular-nums shrink-0', truncated ? 'text-amber-600 dark:text-amber-400 font-medium' : 'text-muted-foreground')}
                          title={truncated ? `Showing the ${count.shown} most recent of ${count.total} ${STRATUM_STYLES[s].label.toLowerCase()}` : undefined}
                        >
                          · {truncated ? `${count.shown} of ${count.total}` : count.shown}
                        </span>
                      ) : (
                        <span className="text-muted-foreground truncate">— {STRATUM_STYLES[s].hint}</span>
                      )}
                    </span>
                  )
                })}
                {lensTruncated && (
                  <span className="mt-1 pt-1 border-t border-border/60 text-[10px] leading-snug text-muted-foreground">
                    Showing the most recent slice — narrow the time range or open Atlas for everything.
                  </span>
                )}
              </div>
            </>
          ) : (
            <>
              <Suspense
                fallback={
                  <div className="absolute inset-0 flex items-center justify-center">
                    <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
                  </div>
                }
              >
                <ContextGraphCanvas
                  data={atlasData}
                  focusId={atlasFocus ? atlasData.center : atlasSelected?.id ?? null}
                  highlightIds={atlasHighlight}
                  isDark={isDark}
                  reducedMotion={reducedMotion}
                  onNodeClick={(n) => atlasFocusEntity(n)}
                />
              </Suspense>

              {!atlasFocus && (
                <div className="absolute top-3 left-1/2 -translate-x-1/2 flex items-center gap-2 rounded-full border bg-background/85 backdrop-blur px-3 py-1.5 text-[11px] text-muted-foreground shadow-sm max-w-[90%]">
                  <Info className="h-3.5 w-3.5 shrink-0 text-violet-500" />
                  <span className="truncate">
                    Atlas — the{' '}
                    <strong className="text-foreground tabular-nums">{overview.nodes.length}</strong> most
                    connected entities. Click any node to focus.
                  </span>
                  {stats && stats.nodes > overview.nodes.length && overviewLimit < OVERVIEW_MAX_LIMIT && (
                    <button
                      onClick={handleExpand}
                      className="flex items-center gap-1 rounded-full border border-violet-500/30 bg-violet-500/10 px-2 py-0.5 font-medium text-violet-600 hover:bg-violet-500/20 dark:text-violet-300 shrink-0"
                      title="Load more of the graph"
                    >
                      <Plus className="h-3 w-3" />
                      Show more
                    </button>
                  )}
                </div>
              )}
            </>
          )}

          {/* Type legend (kept — user likes it) */}
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

        {/* Node inspector — identity, provenance, and every edit (both tabs) */}
        {selectedId && (
          <Suspense fallback={null}>
            <NodeInspector
              key={selectedId}
              nodeId={selectedId}
              fallback={
                tab === 'atlas' && atlasSelected
                  ? { type: atlasSelected.type, label: atlasSelected.label }
                  : null
              }
              isDark={isDark}
              onLocate={handleLocate}
              onOpenEntity={openEntityPage}
              canOpen={canOpen}
              onFocusEntity={(e) => selectNode(e)}
              onChanged={handleNodeChanged}
              onProvenanceLoaded={setProvenance}
              onClose={clearSelection}
            />
          </Suspense>
        )}
      </div>
    </div>
  )
}

export default ContextGraph
