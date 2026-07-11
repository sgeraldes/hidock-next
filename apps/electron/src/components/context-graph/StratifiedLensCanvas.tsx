import { useEffect, useMemo, useRef, useState, useCallback } from 'react'
import ForceGraph2D, { type ForceGraphMethods, type NodeObject } from 'react-force-graph-2d'
import type { ContextLensData, ContextLensNode } from './types'
import { colorForType, STRATUM_STYLES } from './graph-theme'
import { computeStratifiedLayout, type BandRect, type AxisTick } from './layout'
import { formatSmartDate } from '@/lib/smartDate'

type GNode = ContextLensNode & NodeObject
interface GLink {
  source: string | GNode
  target: string | GNode
  type: string
  weight: number
}

/** Minimum on-screen hit radius (px). Guarantees clicks land at any zoom. */
const MIN_HIT_PX = 11
/** Below this zoom, only the focused/hovered/highlighted labels show. */
const LABEL_ZOOM_THRESHOLD = 1.4
/** Node radius clamp (graph units) — degree must never produce viewport-sized circles. */
const NODE_R_MIN = 4
const NODE_R_MAX = 14
/** Modest emphasis for the lens center (well under 1.5× the cap). */
const CENTER_EMPHASIS = 1.3

/** Sqrt-scaled, HARD-CLAMPED radius. Uncapped degree sizing let a ~400-degree
 *  hub cover a quarter of the viewport; the clamp compresses the distribution.
 *  Exported for regression tests. */
export function baseRadius(degree: number): number {
  return Math.min(NODE_R_MAX, Math.max(NODE_R_MIN, 3.5 + Math.sqrt(degree || 0) * 1.2))
}

/** force-graph rebinds link endpoints to node OBJECTS — resolve either form.
 *  Exported for regression tests. */
export function endpointId(v: string | { id: string }): string {
  return typeof v === 'object' && v !== null ? v.id : v
}

/** Axis tick label — short smart date WITH the year (e.g. "Jun 1, 2026").
 *  The x axis is ORDINAL (sequence, not duration), so real dates must stay in
 *  sight for the spacing to read honestly. Exported for regression tests. */
export function tickLabel(dateMs: number): string {
  return formatSmartDate(dateMs, { time: false })
}

/** Labels go into force-graph's HTML tooltip — escape user data. */
function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

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
 * hit target, full-text hover tooltips, provenance dimming, and age decay all
 * live here.
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
  const { graphData, bands, xExtent, ticks } = useMemo(() => {
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
      ticks: layout.ticks,
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

  /** Painted radius: clamped base × gentle age decay (+ center emphasis). */
  const paintedRadius = useCallback(
    (node: GNode): number => {
      const rec = recency(node.dateMs)
      let r = baseRadius(node.degree) * (0.8 + 0.2 * rec)
      if (node.id === data.center) r *= CENTER_EMPHASIS
      return r
    },
    [recency, data.center]
  )

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

  // --- Band backgrounds: four flat translucent rects + one hairline separator
  // per boundary, drawn ONCE per frame (onRenderFramePre) in graph space,
  // beneath the links and nodes. State is save/restored so nothing leaks.
  const paintBands = useCallback(
    (ctx: CanvasRenderingContext2D, globalScale: number) => {
      const rects = bands as BandRect[]
      if (rects.length === 0) return
      ctx.save()

      const left = xExtent.min
      const right = xExtent.max
      for (const band of rects) {
        const style = STRATUM_STYLES[band.stratum]
        ctx.fillStyle = isDark ? style.bgDark : style.bgLight
        ctx.fillRect(left, band.yTop, right - left, band.yBottom - band.yTop)
      }

      // One hairline separator per interior band boundary (screen-constant 1px).
      ctx.strokeStyle = isDark ? 'rgba(148,163,184,0.22)' : 'rgba(100,116,139,0.22)'
      ctx.lineWidth = 1 / globalScale
      for (let i = 1; i < rects.length; i++) {
        const y = rects[i].yTop
        ctx.beginPath()
        ctx.moveTo(left, y)
        ctx.lineTo(right, y)
        ctx.stroke()
      }

      // Band tags pinned to the left edge. Font is zoom-compensated but clamped
      // so a zoomed-out view can't blow the tag up past the band itself.
      const bandHeight = rects[0].yBottom - rects[0].yTop
      const fontSize = Math.min(Math.max(13 / globalScale, 3), bandHeight * 0.22)
      ctx.font = `600 ${fontSize}px Inter, system-ui, sans-serif`
      ctx.textAlign = 'left'
      ctx.textBaseline = 'middle'
      for (const band of rects) {
        const style = STRATUM_STYLES[band.stratum]
        ctx.fillStyle = isDark ? style.labelDark : style.labelLight
        ctx.fillText(style.label.toUpperCase(), left + 8 / globalScale, band.yCenter)
      }

      // Date axis below the bottom band. The x scale is ORDINAL — distance is
      // sequence, not duration — so sparse REAL-DATE ticks (oldest + newest +
      // every Nth distinct date, from the layout) keep the axis honest.
      if (ticks.length > 0) {
        const axisY = rects[rects.length - 1].yBottom
        const tickFont = Math.min(Math.max(11 / globalScale, 3), bandHeight * 0.16)
        ctx.font = `500 ${tickFont}px Inter, system-ui, sans-serif`
        ctx.textAlign = 'center'
        ctx.textBaseline = 'top'
        ctx.strokeStyle = isDark ? 'rgba(148,163,184,0.45)' : 'rgba(100,116,139,0.45)'
        ctx.lineWidth = 1 / globalScale
        const tickLen = 5 / globalScale
        for (const t of ticks as AxisTick[]) {
          ctx.beginPath()
          ctx.moveTo(t.x, axisY)
          ctx.lineTo(t.x, axisY + tickLen)
          ctx.stroke()
          ctx.fillStyle = isDark ? '#94a3b8' : '#64748b'
          ctx.fillText(tickLabel(t.dateMs), t.x, axisY + tickLen + 2 / globalScale)
        }
      }

      ctx.restore()
    },
    [bands, xExtent, ticks, isDark]
  )

  const paintNode = useCallback(
    (node: GNode, ctx: CanvasRenderingContext2D, globalScale: number) => {
      const x = node.x ?? 0
      const y = node.y ?? 0
      const rec = recency(node.dateMs) // 0 (old) … 1 (new)
      const radius = paintedRadius(node)
      const bright = !hasHighlight || highlightIds!.has(node.id)
      const isFocus = node.id === focusId
      const isHover = node.id === hoverId
      const isCenter = node.id === data.center

      // Alpha: dim non-path nodes hard; otherwise fade old nodes gently.
      ctx.globalAlpha = bright ? 0.55 + 0.45 * rec : 0.1
      ctx.beginPath()
      ctx.arc(x, y, radius, 0, 2 * Math.PI)
      ctx.fillStyle = colorForType(node.type, isDark)
      ctx.fill()

      // The lens center reads as the anchor via a standing ring, not raw size.
      if (isCenter && bright) {
        ctx.globalAlpha = 0.85
        ctx.lineWidth = 1.5 / globalScale
        ctx.strokeStyle = colorForType(node.type, isDark)
        ctx.beginPath()
        ctx.arc(x, y, radius + 3.5 / globalScale, 0, 2 * Math.PI)
        ctx.stroke()
      }
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
    [focusId, hoverId, hasHighlight, highlightIds, isDark, recency, paintedRadius, data.center]
  )

  // Pointer area: minimum SCREEN-space hit target (clickable at any zoom), plus
  // coverage of the label text zone so hovering a truncated label still raises
  // the full-text tooltip.
  const paintPointerArea = useCallback(
    (node: GNode, color: string, ctx: CanvasRenderingContext2D, globalScale: number) => {
      const x = node.x ?? 0
      const y = node.y ?? 0
      const radius = Math.max(paintedRadius(node) + 2, MIN_HIT_PX / globalScale)
      ctx.fillStyle = color
      ctx.beginPath()
      ctx.arc(x, y, radius, 0, 2 * Math.PI)
      ctx.fill()

      if (globalScale > LABEL_ZOOM_THRESHOLD) {
        const fontSize = Math.max(11 / globalScale, 2)
        const label = node.label.length > 26 ? `${node.label.slice(0, 25)}…` : node.label
        const w = label.length * fontSize * 0.62
        ctx.fillRect(x - w / 2, y + paintedRadius(node) + 1, w, fontSize + 2)
      }
    },
    [paintedRadius]
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
        nodeLabel={(n: GNode) => `${escapeHtml(n.label)} · ${n.type.replace(/_/g, ' ')}`}
        linkColor={(l: GLink) => {
          if (hasHighlight) {
            const on = highlightIds!.has(endpointId(l.source)) && highlightIds!.has(endpointId(l.target))
            if (!on) return isDark ? 'rgba(148,163,184,0.06)' : 'rgba(100,116,139,0.06)'
            return isDark ? 'rgba(226,232,240,0.55)' : 'rgba(51,65,85,0.55)'
          }
          return isDark ? 'rgba(148,163,184,0.15)' : 'rgba(100,116,139,0.18)'
        }}
        linkWidth={(l: GLink) => Math.min(0.4 + (l.weight || 1) * 0.2, 1.8)}
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
