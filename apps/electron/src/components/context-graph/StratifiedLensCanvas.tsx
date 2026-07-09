import { useEffect, useMemo, useRef, useState, useCallback } from 'react'
import ForceGraph2D, { type ForceGraphMethods, type NodeObject } from 'react-force-graph-2d'
import type { ContextLensData, ContextLensNode } from './types'
import { colorForType, STRATUM_STYLES } from './graph-theme'
import { computeStratifiedLayout, type BandRect } from './layout'

type GNode = ContextLensNode & NodeObject
interface GLink {
  source: string
  target: string
  type: string
  weight: number
}

/** Minimum on-screen hit radius (px). Guarantees clicks land at any zoom. */
const MIN_HIT_PX = 11
/** Below this zoom, only the focused/hovered/highlighted labels show. */
const LABEL_ZOOM_THRESHOLD = 1.4

interface StratifiedLensCanvasProps {
  data: ContextLensData
  /** Node to spotlight (draws a ring; the lens centers on it). */
  focusId?: string | null
  /** When non-empty, matching nodes stay bright and the rest dim (provenance). */
  highlightIds?: Set<string>
  isDark: boolean
  reducedMotion: boolean
  onNodeClick?: (node: ContextLensNode) => void
  onNodeDoubleClick?: (node: ContextLensNode) => void
  onNodeHover?: (node: ContextLensNode | null) => void
}

/**
 * The stratified lens: nodes pinned into horizontal reasoning bands (strategy →
 * evidence, top → down) and ordered left→right by time. No physics settle — the
 * layout is deterministic, so the picture itself reads as reasoning. Zoom/pan,
 * click-to-select, double-click-to-recenter, hover rings, a guaranteed minimum
 * hit target, provenance dimming, and age decay all live here.
 */
export function StratifiedLensCanvas({
  data,
  focusId,
  highlightIds,
  isDark,
  reducedMotion,
  onNodeClick,
  onNodeDoubleClick,
  onNodeHover,
}: StratifiedLensCanvasProps) {
  const fgRef = useRef<ForceGraphMethods<GNode, GLink> | undefined>(undefined)
  const containerRef = useRef<HTMLDivElement>(null)
  const [size, setSize] = useState({ width: 800, height: 600 })
  const [hoverId, setHoverId] = useState<string | null>(null)
  const didFitRef = useRef(false)
  const lastClickRef = useRef<{ id: string; t: number }>({ id: '', t: 0 })

  // Deterministic layout → pinned positions. Rebuilt only when data changes.
  const { graphData, bands, xExtent } = useMemo(() => {
    const layout = computeStratifiedLayout(
      data.nodes.map((n) => ({ id: n.id, stratum: n.stratum, dateMs: n.dateMs, degree: n.degree })),
      {}
    )
    const nodes: GNode[] = data.nodes.map((n) => {
      const pos = layout.positions.get(n.id) ?? { x: 0, y: 0 }
      // fx/fy PIN the node — the force sim leaves it where the layout placed it.
      return { ...n, x: pos.x, y: pos.y, fx: pos.x, fy: pos.y }
    })
    const links: GLink[] = data.edges.map((e) => ({
      source: e.source,
      target: e.target,
      type: e.type,
      weight: e.weight,
    }))
    const padX = 90
    return {
      graphData: { nodes, links },
      bands: layout.bands,
      xExtent: { min: layout.minX - padX, max: layout.maxX + padX },
    }
  }, [data])

  // Recency scale for age decay (newest = 1, oldest = 0).
  const recency = useMemo(() => {
    const dated = data.nodes.map((n) => n.dateMs).filter((d): d is number => d != null)
    if (dated.length === 0) return () => 1
    const min = Math.min(...dated)
    const max = Math.max(...dated)
    const span = max - min
    return (ms: number | null): number => {
      if (ms == null || span <= 0) return 1
      return (ms - min) / span
    }
  }, [data])

  // A fresh dataset re-fits the view.
  useEffect(() => {
    didFitRef.current = false
  }, [graphData])

  useEffect(() => {
    const el = containerRef.current
    if (!el || typeof ResizeObserver === 'undefined') return
    const measure = () => setSize({ width: el.clientWidth, height: el.clientHeight })
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  // Spotlight the focused node (positions already exist — no settle needed).
  useEffect(() => {
    if (!focusId) return
    const node = graphData.nodes.find((n) => n.id === focusId)
    if (node && typeof node.x === 'number' && typeof node.y === 'number') {
      const dur = reducedMotion ? 0 : 500
      fgRef.current?.centerAt(node.x, node.y, dur)
      fgRef.current?.zoom(1.8, dur)
    }
  }, [focusId, graphData, reducedMotion])

  const hasHighlight = !!highlightIds && highlightIds.size > 0

  // --- Band backgrounds + labels (drawn beneath the nodes) ------------------
  const paintBands = useCallback(
    (ctx: CanvasRenderingContext2D, globalScale: number) => {
      for (const band of bands as BandRect[]) {
        const style = STRATUM_STYLES[band.stratum]
        ctx.fillStyle = isDark ? style.bgDark : style.bgLight
        ctx.fillRect(xExtent.min, band.yTop, xExtent.max - xExtent.min, band.yBottom - band.yTop)

        // Zoom-compensated band tag pinned to the band's left edge → stable size.
        const fontSize = Math.max(13 / globalScale, 3)
        ctx.font = `600 ${fontSize}px Inter, system-ui, sans-serif`
        ctx.textAlign = 'left'
        ctx.textBaseline = 'middle'
        ctx.fillStyle = isDark ? style.labelDark : style.labelLight
        ctx.fillText(style.label.toUpperCase(), xExtent.min + 8 / globalScale, band.yCenter)
      }
    },
    [bands, xExtent, isDark]
  )

  const paintNode = useCallback(
    (node: GNode, ctx: CanvasRenderingContext2D, globalScale: number) => {
      const x = node.x ?? 0
      const y = node.y ?? 0
      const rec = recency(node.dateMs) // 0 (old) … 1 (new)
      // Age decay: newer nodes a touch larger. Degree still drives base size.
      const radius = (3 + Math.sqrt(node.degree || 0) * 1.5) * (0.72 + 0.28 * rec)
      const bright = !hasHighlight || highlightIds!.has(node.id)
      const isFocus = node.id === focusId
      const isHover = node.id === hoverId

      // Alpha: dim non-path nodes hard; otherwise fade old nodes gently.
      ctx.globalAlpha = bright ? 0.55 + 0.45 * rec : 0.1
      ctx.beginPath()
      ctx.arc(x, y, radius, 0, 2 * Math.PI)
      ctx.fillStyle = colorForType(node.type, isDark)
      ctx.fill()

      if (isHover && bright) {
        ctx.globalAlpha = 0.9
        ctx.lineWidth = 2 / globalScale
        ctx.strokeStyle = isDark ? '#cbd5e1' : '#475569'
        ctx.beginPath()
        ctx.arc(x, y, radius + 2.5 / globalScale, 0, 2 * Math.PI)
        ctx.stroke()
      }
      if (isFocus) {
        ctx.globalAlpha = 1
        ctx.lineWidth = 2.5 / globalScale
        ctx.strokeStyle = isDark ? '#f8fafc' : '#0f172a'
        ctx.beginPath()
        ctx.arc(x, y, radius + 1, 0, 2 * Math.PI)
        ctx.stroke()
      }

      const showLabel =
        bright && (globalScale > LABEL_ZOOM_THRESHOLD || isFocus || isHover || (hasHighlight && highlightIds!.has(node.id)))
      if (showLabel) {
        const fontSize = Math.max(11 / globalScale, 2)
        ctx.globalAlpha = 1
        ctx.font = `${fontSize}px Inter, system-ui, sans-serif`
        ctx.textAlign = 'center'
        ctx.textBaseline = 'top'
        ctx.fillStyle = isDark ? '#e2e8f0' : '#1e293b'
        const label = node.label.length > 26 ? `${node.label.slice(0, 25)}…` : node.label
        ctx.fillText(label, x, y + radius + 1.5)
      }
      ctx.globalAlpha = 1
    },
    [focusId, hoverId, hasHighlight, highlightIds, isDark, recency]
  )

  // Minimum hit target in SCREEN space → clickable at any zoom.
  const paintPointerArea = useCallback(
    (node: GNode, color: string, ctx: CanvasRenderingContext2D, globalScale: number) => {
      const base = 3 + Math.sqrt(node.degree || 0) * 1.5 + 2
      const radius = Math.max(base, MIN_HIT_PX / globalScale)
      ctx.fillStyle = color
      ctx.beginPath()
      ctx.arc(node.x ?? 0, node.y ?? 0, radius, 0, 2 * Math.PI)
      ctx.fill()
    },
    []
  )

  const handleClick = useCallback(
    (node: GNode) => {
      const now = Date.now()
      const last = lastClickRef.current
      if (last.id === node.id && now - last.t < 300) {
        lastClickRef.current = { id: '', t: 0 }
        onNodeDoubleClick?.(node)
        return
      }
      lastClickRef.current = { id: node.id, t: now }
      onNodeClick?.(node)
    },
    [onNodeClick, onNodeDoubleClick]
  )

  return (
    <div ref={containerRef} className="h-full w-full" data-testid="stratified-lens-canvas">
      <ForceGraph2D<GNode, GLink>
        ref={fgRef}
        graphData={graphData}
        width={size.width}
        height={size.height}
        backgroundColor="rgba(0,0,0,0)"
        nodeId="id"
        nodeRelSize={4}
        onRenderFramePre={paintBands}
        nodeCanvasObject={paintNode}
        nodePointerAreaPaint={paintPointerArea}
        nodeLabel={(n: GNode) => `${n.label} · ${n.type}`}
        linkColor={(l: GLink) => {
          if (hasHighlight) {
            const on = highlightIds!.has(l.source as unknown as string) && highlightIds!.has(l.target as unknown as string)
            if (!on) return isDark ? 'rgba(148,163,184,0.08)' : 'rgba(100,116,139,0.08)'
            return isDark ? 'rgba(226,232,240,0.55)' : 'rgba(51,65,85,0.55)'
          }
          return isDark ? 'rgba(148,163,184,0.22)' : 'rgba(100,116,139,0.28)'
        }}
        linkWidth={(l: GLink) => Math.min(0.5 + (l.weight || 1) * 0.25, 2.5)}
        linkDirectionalParticles={0}
        // Positions are pinned (fx/fy) → no settle. Zero ticks = deterministic.
        cooldownTicks={0}
        warmupTicks={0}
        onEngineStop={() => {
          if (!didFitRef.current) {
            fgRef.current?.zoomToFit(reducedMotion ? 0 : 400, 56)
            didFitRef.current = true
          }
        }}
        onNodeClick={handleClick}
        onNodeHover={(n: GNode | null) => {
          setHoverId(n?.id ?? null)
          onNodeHover?.(n ?? null)
        }}
      />
    </div>
  )
}

export default StratifiedLensCanvas
