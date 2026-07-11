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
  /** Minimum horizontal gap between two nodes sharing a sub-row (graph units). */
  nodeGap?: number
}

const DEFAULTS = {
  bandHeight: 240,
  width: 1100,
  nodeGap: 46,
} as const

/** Vertical padding inside a band so nodes never sit on the band edges. */
const BAND_INNER_PAD = 42

/**
 * Compute fixed positions for a set of lens nodes. Nodes are grouped into their
 * stratum band and ordered left→right by effective date within the band.
 *
 * Dense bands wrap onto MULTIPLE sub-rows (round-robin in time order) instead of
 * sweeping unboundedly to the right — this keeps the overall aspect ratio sane.
 * An unbounded sweep let a 100-node band grow ~5,000 units wide against ~960
 * tall; after zoom-to-fit every inter-band edge rendered as a near-horizontal
 * line, and hundreds of them stacked into moiré "scanline" noise across the
 * whole canvas. Bounding the width keeps edges visibly diagonal, so flows
 * between bands read as flows. Within each sub-row a left-to-right min-gap
 * sweep de-collides while preserving the date sort, so x stays monotonic in
 * dateMs per sub-row. Undated nodes sort oldest (leftmost). Fully deterministic.
 */
export function computeStratifiedLayout(
  nodes: LayoutInputNode[],
  opts: LayoutOptions = {}
): LayoutResult {
  const bandHeight = opts.bandHeight ?? DEFAULTS.bandHeight
  const width = opts.width ?? DEFAULTS.width
  const nodeGap = opts.nodeGap ?? DEFAULTS.nodeGap

  const positions = new Map<string, { x: number; y: number }>()

  // Shared time scale across ALL bands so equal dates align vertically.
  //
  // We use an ORDINAL (rank) time axis, not a raw-linear one. Real context data
  // clusters hard in time — a person's recent 2-hop subgraph inherits a handful
  // of recent meeting dates, so ~90% of nodes land in the newest ~5% of the
  // linear range and pile against the right edge, leaving most of the canvas (and
  // the labelled bands) visibly empty. Mapping each DISTINCT timestamp to an
  // evenly-spaced rank spreads that cluster across the full width while keeping
  // the two properties the layout actually promises: equal dates share an x
  // (vertical cross-band alignment) and older sorts left. Padding the domain
  // keeps the newest slice off the exact edge so it never clips.
  const EDGE_PAD = Math.min(48, width * 0.05)
  const usableW = Math.max(1, width - EDGE_PAD * 2)
  const uniqueSorted = Array.from(
    new Set(nodes.filter((n) => n.dateMs != null).map((n) => n.dateMs as number))
  ).sort((a, b) => a - b)
  const rankOf = new Map<number, number>()
  uniqueSorted.forEach((ms, i) => rankOf.set(ms, i))
  const distinctDates = uniqueSorted.length
  const scaleX = (ms: number | null): number => {
    if (ms == null) return 0 // undated → far left (oldest), left of the padded domain
    // All timestamps equal (or a single dated node): center them — a degenerate
    // time axis carries no ordering signal, so a shared midpoint reads honestly.
    if (distinctDates <= 1) return width / 2
    const rank = rankOf.get(ms) ?? 0
    return EDGE_PAD + (rank / (distinctDates - 1)) * usableW
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

    // Enough sub-rows that the band's nodes fit within ~width (min 2 for label
    // breathing room when the band has more than one node).
    const capacity = Math.max(1, Math.floor(width / nodeGap))
    const rowCount = Math.max(
      bandNodes.length > 1 ? 2 : 1,
      Math.ceil(bandNodes.length / capacity)
    )
    const usable = bandHeight - BAND_INNER_PAD * 2
    const rowY = (r: number): number =>
      rowCount === 1 ? band.yCenter : band.yTop + BAND_INNER_PAD + (usable * r) / (rowCount - 1)

    const rowLastX = new Array<number>(rowCount).fill(-Infinity)
    bandNodes.forEach((n, i) => {
      const r = i % rowCount // round-robin in time order
      const baseX = scaleX(n.dateMs)
      // Per-row min-gap sweep in sort order → x monotonic in dateMs per sub-row.
      const x = Math.max(baseX, rowLastX[r] + nodeGap)
      rowLastX[r] = x
      positions.set(n.id, { x, y: rowY(r) })
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
