import { useEffect, useMemo, useRef, useState, useCallback } from 'react'
import ForceGraph2D, { type ForceGraphMethods, type NodeObject } from 'react-force-graph-2d'
import type { ContextGraphData, ContextGraphNode } from './types'
import { colorForType } from './graph-theme'

type GNode = ContextGraphNode & NodeObject
interface GLink {
  source: string
  target: string
  type: string
  weight: number
}

/**
 * Below this zoom, node labels are illegible noise, so we hide them and only
 * reveal a label for the focused or hovered node. Above it (the user has zoomed
 * in) every visible node is labelled.
 */
const LABEL_ZOOM_THRESHOLD = 1.8

/**
 * Sqrt-scaled, HARD-CLAMPED node radius (graph units). Uncapped degree sizing
 * let a several-hundred-degree hub cover a quarter of the viewport.
 */
function nodeRadius(degree: number): number {
  return Math.min(14, Math.max(4, 3 + Math.sqrt(degree || 0) * 1.2))
}

interface ContextGraphCanvasProps {
  data: ContextGraphData
  /** Node to spotlight (centers + zooms on it, draws a ring). */
  focusId?: string | null
  /** When non-empty, matching nodes stay bright and the rest are dimmed. */
  highlightIds?: Set<string>
  isDark: boolean
  reducedMotion: boolean
  onNodeClick?: (node: ContextGraphNode) => void
  onNodeHover?: (node: ContextGraphNode | null) => void
}

/**
 * Interactive force-directed canvas for the Context Graph. Zoom/pan, click-to-
 * focus, degree-based node sizing, category coloring, and reduced-motion-safe
 * settling are all handled here; the parent supplies data + interaction hooks.
 */
export function ContextGraphCanvas({
  data,
  focusId,
  highlightIds,
  isDark,
  reducedMotion,
  onNodeClick,
  onNodeHover,
}: ContextGraphCanvasProps) {
  const fgRef = useRef<ForceGraphMethods<GNode, GLink> | undefined>(undefined)
  const containerRef = useRef<HTMLDivElement>(null)
  const [size, setSize] = useState({ width: 800, height: 600 })
  const [hoverId, setHoverId] = useState<string | null>(null)
  const didFitRef = useRef(false)

  // React-force-graph mutates node objects (x/y). Rebuild only when data changes.
  const graphData = useMemo(() => {
    const nodes: GNode[] = data.nodes.map((n) => ({ ...n }))
    const links: GLink[] = data.edges.map((e) => ({
      source: e.source,
      target: e.target,
      type: e.type,
      weight: e.weight,
    }))
    return { nodes, links }
  }, [data])

  // A fresh dataset re-fits the view.
  useEffect(() => {
    didFitRef.current = false
  }, [graphData])

  // Track container size so the canvas fills its panel.
  useEffect(() => {
    const el = containerRef.current
    if (!el || typeof ResizeObserver === 'undefined') return
    const measure = () => setSize({ width: el.clientWidth, height: el.clientHeight })
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  // Spotlight the focused node once positions exist.
  useEffect(() => {
    if (!focusId) return
    const dur = reducedMotion ? 0 : 600
    const t = setTimeout(
      () => {
        const node = graphData.nodes.find((n) => n.id === focusId)
        if (node && typeof node.x === 'number' && typeof node.y === 'number') {
          fgRef.current?.centerAt(node.x, node.y, dur)
          fgRef.current?.zoom(2.4, dur)
        }
      },
      reducedMotion ? 0 : 250
    )
    return () => clearTimeout(t)
  }, [focusId, graphData, reducedMotion])

  const hasHighlight = !!highlightIds && highlightIds.size > 0

  const paintNode = useCallback(
    (node: GNode, ctx: CanvasRenderingContext2D, globalScale: number) => {
      const x = node.x ?? 0
      const y = node.y ?? 0
      const radius = nodeRadius(node.degree)
      const bright = !hasHighlight || highlightIds!.has(node.id)
      const isFocus = node.id === focusId

      ctx.globalAlpha = bright ? 1 : 0.12
      ctx.beginPath()
      ctx.arc(x, y, radius, 0, 2 * Math.PI)
      ctx.fillStyle = colorForType(node.type, isDark)
      ctx.fill()

      if (isFocus) {
        ctx.lineWidth = 2.5 / globalScale
        ctx.strokeStyle = isDark ? '#f8fafc' : '#0f172a'
        ctx.stroke()
      }

      // Low zoom = labels are illegible noise: show them only when zoomed in,
      // or for the focused/hovered node (common force-graph practice).
      const showLabel =
        bright && (globalScale > LABEL_ZOOM_THRESHOLD || isFocus || node.id === hoverId)
      if (showLabel) {
        const fontSize = Math.max(11 / globalScale, 2)
        ctx.font = `${fontSize}px Inter, system-ui, sans-serif`
        ctx.textAlign = 'center'
        ctx.textBaseline = 'top'
        ctx.fillStyle = isDark ? '#e2e8f0' : '#1e293b'
        const label = node.label.length > 26 ? `${node.label.slice(0, 25)}…` : node.label
        ctx.fillText(label, x, y + radius + 1)
      }
      ctx.globalAlpha = 1
    },
    [focusId, hasHighlight, highlightIds, isDark, hoverId]
  )

  const paintPointerArea = useCallback(
    (node: GNode, color: string, ctx: CanvasRenderingContext2D) => {
      const radius = nodeRadius(node.degree) + 2
      ctx.fillStyle = color
      ctx.beginPath()
      ctx.arc(node.x ?? 0, node.y ?? 0, radius, 0, 2 * Math.PI)
      ctx.fill()
    },
    []
  )

  return (
    <div ref={containerRef} className="h-full w-full" data-testid="context-graph-canvas">
      <ForceGraph2D<GNode, GLink>
        ref={fgRef}
        graphData={graphData}
        width={size.width}
        height={size.height}
        backgroundColor="rgba(0,0,0,0)"
        nodeId="id"
        nodeRelSize={4}
        nodeCanvasObject={paintNode}
        nodePointerAreaPaint={paintPointerArea}
        nodeLabel={(n: GNode) => `${n.label} · ${n.type}`}
        linkColor={() => (isDark ? 'rgba(148,163,184,0.28)' : 'rgba(100,116,139,0.35)')}
        linkWidth={(l: GLink) => Math.min(0.5 + (l.weight || 1) * 0.25, 2.5)}
        linkDirectionalParticles={0}
        cooldownTicks={reducedMotion ? 0 : 120}
        warmupTicks={reducedMotion ? 120 : 0}
        d3VelocityDecay={0.28}
        onEngineStop={() => {
          if (!didFitRef.current) {
            fgRef.current?.zoomToFit(reducedMotion ? 0 : 400, 48)
            didFitRef.current = true
          }
        }}
        onNodeClick={(n: GNode) => onNodeClick?.(n)}
        onNodeHover={(n: GNode | null) => {
          setHoverId(n?.id ?? null)
          onNodeHover?.(n ?? null)
        }}
      />
    </div>
  )
}

export default ContextGraphCanvas
