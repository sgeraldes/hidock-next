/**
 * Deterministic stratified layout for the Context Lens.
 *
 * Force-directed physics cannot show reasoning — it renders typed nodes as
 * undifferentiated soup. This lays nodes out on two meaningful axes instead:
 *
 *   • y = STRATUM (abstraction). Fixed horizontal bands, top→down:
 *       strategic → operational → people → evidence.
 *   • x = TIME (recency). A single shared time scale across every band, so a
 *       decision sits roughly ABOVE the meeting that produced it (same date →
 *       same x). Older = left, newer = right.
 *
 * The layout is pure and deterministic (no randomness, stable tie-breaks) so it
 * is unit-testable and renders identically every time — no animated settle.
 */

import type { Stratum } from './types'
import { STRATA_ORDER } from './graph-theme'

export interface LayoutInputNode {
  id: string
  stratum: Stratum
  dateMs: number | null
  degree: number
}

export interface BandRect {
  stratum: Stratum
  yTop: number
  yBottom: number
  yCenter: number
}

export interface LayoutResult {
  /** node id → fixed graph-space position. */
  positions: Map<string, { x: number; y: number }>
  /** One rect per NON-EMPTY band, in top-to-bottom render order. */
  bands: BandRect[]
  /** Horizontal extent actually used by the nodes (for band backgrounds). */
  minX: number
  maxX: number
}

export interface LayoutOptions {
  /** Vertical size of each band (graph units). */
  bandHeight?: number
  /** Horizontal span the time axis maps onto (graph units). */
  width?: number
  /** Minimum horizontal gap between two nodes in a band (graph units). */
  nodeGap?: number
  /** Vertical stagger between the two sub-rows within a band (graph units). */
  rowGap?: number
}

const DEFAULTS = {
  bandHeight: 240,
  width: 1100,
  nodeGap: 46,
  rowGap: 56,
} as const

/**
 * Compute fixed positions for a set of lens nodes. Nodes are grouped into their
 * stratum band (row) and ordered left→right by effective date within the band.
 * A left-to-right sweep enforces a minimum horizontal gap, which — because it
 * preserves the date sort order — guarantees x is monotonic in dateMs within a
 * band. Undated nodes sort oldest (leftmost).
 */
export function computeStratifiedLayout(
  nodes: LayoutInputNode[],
  opts: LayoutOptions = {}
): LayoutResult {
  const bandHeight = opts.bandHeight ?? DEFAULTS.bandHeight
  const width = opts.width ?? DEFAULTS.width
  const nodeGap = opts.nodeGap ?? DEFAULTS.nodeGap
  const rowGap = opts.rowGap ?? DEFAULTS.rowGap

  const positions = new Map<string, { x: number; y: number }>()

  // Shared time scale across ALL bands so equal dates align vertically.
  const dated = nodes.filter((n) => n.dateMs != null).map((n) => n.dateMs as number)
  const minMs = dated.length ? Math.min(...dated) : 0
  const maxMs = dated.length ? Math.max(...dated) : 0
  const span = maxMs - minMs
  const scaleX = (ms: number | null): number => {
    if (ms == null) return 0 // undated → far left (oldest)
    return span > 0 ? ((ms - minMs) / span) * width : width / 2
  }

  // Only bands that actually hold nodes get a rect (so the picture isn't padded
  // with empty strata).
  const usedStrata = STRATA_ORDER.filter((s) => nodes.some((n) => n.stratum === s))
  const bands: BandRect[] = usedStrata.map((stratum, i) => {
    const yTop = i * bandHeight
    return { stratum, yTop, yBottom: yTop + bandHeight, yCenter: yTop + bandHeight / 2 }
  })

  let minX = Infinity
  let maxX = -Infinity

  for (const band of bands) {
    const bandNodes = nodes.filter((n) => n.stratum === band.stratum)
    // Sort: oldest first (nulls oldest), then busiest, then id — fully deterministic.
    bandNodes.sort((a, b) => {
      const ax = a.dateMs ?? -Infinity
      const bx = b.dateMs ?? -Infinity
      if (ax !== bx) return ax - bx
      if (a.degree !== b.degree) return b.degree - a.degree
      return a.id < b.id ? -1 : a.id > b.id ? 1 : 0
    })

    let prevX = -Infinity
    bandNodes.forEach((n, i) => {
      const baseX = scaleX(n.dateMs)
      // Enforce a min gap in sort order → x stays monotonic in dateMs.
      const x = Math.max(baseX, prevX + nodeGap)
      prevX = x
      // Two-row stagger keeps labels from colliding while staying in the band.
      const y = band.yCenter + (i % 2 === 0 ? -rowGap / 2 : rowGap / 2)
      positions.set(n.id, { x, y })
      if (x < minX) minX = x
      if (x > maxX) maxX = x
    })
  }

  if (!Number.isFinite(minX)) {
    minX = 0
    maxX = width
  }

  return { positions, bands, minX, maxX }
}
