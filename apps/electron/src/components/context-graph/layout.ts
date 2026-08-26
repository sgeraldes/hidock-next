/**
 * Deterministic stratified layout for the Context Lens.
 *
 * Force-directed physics cannot show reasoning — it renders typed nodes as
 * undifferentiated soup. This lays nodes out on two meaningful axes instead:
 *
 *   • y = STRATUM (abstraction). Fixed horizontal bands, top→down:
 *       strategic → operational → people → evidence.
 *   • x = TIME (sequence). A single shared ORDINAL time scale across every
 *     band, so a decision sits roughly ABOVE the meeting that produced it
 *     (same date → same x). Older = left, newer = right. Distance encodes
 *     ORDER, not duration — the labelled date ticks (see {@link AxisTick})
 *     keep that honest.
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

/** A date tick on the (ordinal) time axis: where to draw it and the real date it marks. */
export interface AxisTick {
  x: number
  dateMs: number
}

export interface LayoutResult {
  /** node id → fixed graph-space position. */
  positions: Map<string, { x: number; y: number }>
  /** One rect per NON-EMPTY band, in top-to-bottom render order. */
  bands: BandRect[]
  /** Horizontal extent actually used by the nodes (for band backgrounds). */
  minX: number
  maxX: number
  /**
   * Sparse labelled date ticks for the bottom axis. The x scale is ORDINAL
   * (rank-based), so on-canvas distance is sequence, not duration — these ticks
   * put real dates in sight so distance is never read as duration. Always
   * includes the oldest and newest distinct dates; empty when nothing is dated.
   */
  ticks: AxisTick[]
}

export interface LayoutOptions {
  /** Vertical size of each band (graph units). */
  bandHeight?: number
  /** Horizontal span the time axis maps onto (graph units). */
  width?: number
  /** Minimum horizontal gap between two nodes sharing a sub-row (graph units). */
  nodeGap?: number
  /**
   * Minimum spacing between two DISTINCT time-slot x positions (graph units).
   * Defaults to the rendered node diameter (2 × NODE_R_MAX = 28). When more
   * distinct timestamps exist than fit at this spacing, adjacent ranks are
   * BINNED into shared slots — never spaced below a node's own width.
   */
  minSlotSpacing?: number
}

const DEFAULTS = {
  bandHeight: 240,
  width: 1100,
  nodeGap: 46,
  /** Rendered node diameter — keep in sync with NODE_R_MAX (14) in StratifiedLensCanvas. */
  minSlotSpacing: 28,
} as const

/** Vertical padding inside a band so nodes never sit on the band edges. */
const BAND_INNER_PAD = 42

/** How many labelled date ticks the axis aims for (first + last always included). */
const TICK_TARGET = 6

/** The ordinal time scale used by the layout — exported for regression tests. */
export interface TimeScale {
  /** Graph-space x for a node date (null → far left / undated). */
  scaleX: (ms: number | null) => number
  /** The distinct drawable slot x positions, left→right (each ≥ minSlotSpacing apart). */
  slotXs: number[]
  /** Sparse labelled date ticks (oldest + newest + every Nth distinct date). */
  ticks: AxisTick[]
}

/**
 * Build the shared ORDINAL time scale for a set of node dates.
 *
 * Each DISTINCT timestamp maps to an evenly-spaced rank inside a padded domain,
 * so clustered-recent data spreads across the full width instead of piling at
 * the right edge. When more distinct timestamps exist than fit at
 * `minSlotSpacing` (the rendered node diameter), adjacent ranks are BINNED into
 * shared slots — the scale never produces two distinct x positions closer than
 * a node's own width. Equal dates always share an x; older always sorts left.
 */
export function buildTimeScale(
  datedMs: number[],
  width: number,
  minSlotSpacing: number = DEFAULTS.minSlotSpacing
): TimeScale {
  const EDGE_PAD = Math.min(48, width * 0.05)
  const usableW = Math.max(1, width - EDGE_PAD * 2)

  const uniqueSorted = Array.from(new Set(datedMs)).sort((a, b) => a - b)
  const rankOf = new Map<number, number>()
  uniqueSorted.forEach((ms, i) => rankOf.set(ms, i))
  const distinctDates = uniqueSorted.length

  // Dense-timeline binning: a slot is a drawable x position. When there are more
  // distinct timestamps than fit at minSlotSpacing, adjacent RANKS share a slot
  // (aggregate ticks) instead of collapsing the spacing below a node's diameter.
  const maxSlots = Math.max(2, Math.floor(usableW / minSlotSpacing) + 1)
  const slotCount = distinctDates <= 1 ? 1 : Math.min(distinctDates, maxSlots)
  const slotOfRank = (rank: number): number =>
    distinctDates <= 1 ? 0 : Math.round((rank / (distinctDates - 1)) * (slotCount - 1))
  const slotX = (slot: number): number =>
    slotCount <= 1 ? width / 2 : EDGE_PAD + (slot / (slotCount - 1)) * usableW

  const slotXs = Array.from({ length: slotCount }, (_, s) => slotX(s))

  const scaleX = (ms: number | null): number => {
    if (ms == null) return 0 // undated → far left (oldest), left of the padded domain
    // All timestamps equal (or a single dated node): center them — a degenerate
    // time axis carries no ordering signal, so a shared midpoint reads honestly.
    if (distinctDates <= 1) return width / 2
    return slotX(slotOfRank(rankOf.get(ms) ?? 0))
  }

  // Sparse labelled date ticks: first + last rank always, plus every Nth rank in
  // between (TICK_TARGET total). Deduped by slot so binned ranks yield one tick.
  const ticks: AxisTick[] = []
  if (distinctDates === 1) {
    ticks.push({ x: width / 2, dateMs: uniqueSorted[0] })
  } else if (distinctDates > 1) {
    const step = Math.max(1, Math.ceil((distinctDates - 1) / (TICK_TARGET - 1)))
    const tickRanks = new Set<number>([0, distinctDates - 1])
    for (let r = step; r < distinctDates - 1; r += step) tickRanks.add(r)
    const seenSlots = new Set<number>()
    for (const r of Array.from(tickRanks).sort((a, b) => a - b)) {
      const slot = slotOfRank(r)
      if (seenSlots.has(slot)) continue
      seenSlots.add(slot)
      ticks.push({ x: slotX(slot), dateMs: uniqueSorted[r] })
    }
    // The newest date must always be labelled: if its slot was claimed by an
    // earlier rank, relabel that final tick with the newest date.
    const last = ticks[ticks.length - 1]
    if (last && slotOfRank(distinctDates - 1) === slotOfRank(rankOf.get(last.dateMs) ?? 0)) {
      last.dateMs = uniqueSorted[distinctDates - 1]
    }
  }

  return { scaleX, slotXs, ticks }
}

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
  const minSlotSpacing = opts.minSlotSpacing ?? DEFAULTS.minSlotSpacing

  const positions = new Map<string, { x: number; y: number }>()

  // Shared time scale across ALL bands so equal dates align vertically.
  //
  // We use an ORDINAL (rank) time axis, not a raw-linear one. Real context data
  // clusters hard in time — a person's recent 2-hop subgraph inherits a handful
  // of recent meeting dates, so ~90% of nodes land in the newest ~5% of the
  // linear range and pile against the right edge, leaving most of the canvas (and
  // the labelled bands) visibly empty. The ordinal scale spreads that cluster
  // across the full width while keeping the two properties the layout actually
  // promises: equal dates share an x (vertical cross-band alignment) and older
  // sorts left. The trade-off — distance no longer encodes duration — is
  // disclosed by the labelled date ticks in {@link LayoutResult.ticks}.
  const { scaleX, ticks } = buildTimeScale(
    nodes.filter((n) => n.dateMs != null).map((n) => n.dateMs as number),
    width,
    minSlotSpacing
  )

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

  return { positions, bands, minX, maxX, ticks }
}
