import { describe, it, expect } from 'vitest'
import { computeStratifiedLayout, type LayoutInputNode } from '../layout'
import { stratumOf, STRATA_ORDER } from '../graph-theme'

const DAY = 86_400_000
const base = Date.parse('2026-06-01')

function n(id: string, stratum: LayoutInputNode['stratum'], dayOffset: number | null, degree = 1): LayoutInputNode {
  return { id, stratum, dateMs: dayOffset == null ? null : base + dayOffset * DAY, degree }
}

describe('stratumOf (renderer mirror)', () => {
  it('maps types to the same bands as the package', () => {
    expect(stratumOf('decision')).toBe('strategic')
    expect(stratumOf('risk')).toBe('strategic')
    expect(stratumOf('project')).toBe('operational')
    expect(stratumOf('action_item')).toBe('operational')
    expect(stratumOf('topic')).toBe('operational')
    expect(stratumOf('person')).toBe('people')
    expect(stratumOf('skill')).toBe('people')
    expect(stratumOf('meeting')).toBe('evidence')
    expect(stratumOf('unknown-type')).toBe('operational')
  })
})

describe('computeStratifiedLayout: strata bands (y axis)', () => {
  it('places each node in its stratum band, ordered top→down', () => {
    const nodes = [
      n('d1', 'strategic', 0),
      n('p1', 'operational', 0),
      n('per1', 'people', 0),
      n('m1', 'evidence', 0),
    ]
    const { positions, bands } = computeStratifiedLayout(nodes)
    // Bands are in canonical top-to-bottom order.
    expect(bands.map((b) => b.stratum)).toEqual(['strategic', 'operational', 'people', 'evidence'])
    // y increases as abstraction decreases (strategic highest / smallest y).
    const yFor = (id: string) => positions.get(id)!.y
    expect(yFor('d1')).toBeLessThan(yFor('p1'))
    expect(yFor('p1')).toBeLessThan(yFor('per1'))
    expect(yFor('per1')).toBeLessThan(yFor('m1'))
  })

  it('only emits bands that actually hold nodes', () => {
    const nodes = [n('per1', 'people', 0), n('m1', 'evidence', 0)]
    const { bands } = computeStratifiedLayout(nodes)
    expect(bands.map((b) => b.stratum)).toEqual(['people', 'evidence'])
  })

  it('a node stays within its band vertical extent', () => {
    const nodes = [n('per1', 'people', 0), n('per2', 'people', 1)]
    const { positions, bands } = computeStratifiedLayout(nodes)
    const band = bands.find((b) => b.stratum === 'people')!
    for (const id of ['per1', 'per2']) {
      const y = positions.get(id)!.y
      expect(y).toBeGreaterThanOrEqual(band.yTop)
      expect(y).toBeLessThanOrEqual(band.yBottom)
    }
  })
})

describe('computeStratifiedLayout: time ordering (x axis)', () => {
  it('x is non-decreasing with dateMs within a band', () => {
    const nodes = [
      n('c', 'evidence', 20),
      n('a', 'evidence', 0),
      n('b', 'evidence', 10),
    ]
    const { positions } = computeStratifiedLayout(nodes)
    const xa = positions.get('a')!.x
    const xb = positions.get('b')!.x
    const xc = positions.get('c')!.x
    expect(xa).toBeLessThan(xb)
    expect(xb).toBeLessThan(xc)
  })

  it('never collides two nodes: same sub-row keeps the min gap, positions are unique', () => {
    // Five meetings on the SAME day would collide without collision handling.
    const nodes = [0, 1, 2, 3, 4].map((i) => n(`m${i}`, 'evidence', 5))
    const { positions } = computeStratifiedLayout(nodes, { nodeGap: 50 })
    // Group by sub-row (y); within a row, horizontal gaps must be >= nodeGap.
    const byRow = new Map<number, number[]>()
    for (const nd of nodes) {
      const p = positions.get(nd.id)!
      if (!byRow.has(p.y)) byRow.set(p.y, [])
      byRow.get(p.y)!.push(p.x)
    }
    for (const xs of byRow.values()) {
      xs.sort((p, q) => p - q)
      for (let i = 1; i < xs.length; i++) {
        expect(xs[i] - xs[i - 1]).toBeGreaterThanOrEqual(50 - 1e-9)
      }
    }
    // No two nodes share the exact same (x, y).
    const keys = nodes.map((nd) => {
      const p = positions.get(nd.id)!
      return `${p.x}|${p.y}`
    })
    expect(new Set(keys).size).toBe(keys.length)
  })

  it('bounds the horizontal extent for dense bands (no scanline aspect ratio)', () => {
    // 120 same-day meetings: an unbounded rightward sweep grew ~5,500 units wide
    // (vs ~960 tall), squashing inter-band edges into horizontal moiré noise.
    // Multi-row wrapping must keep the used width in the same order as `width`.
    const nodes = Array.from({ length: 120 }, (_, i) => n(`m${i}`, 'evidence', 5))
    const { positions, minX, maxX, bands } = computeStratifiedLayout(nodes, {
      width: 1100,
      nodeGap: 46,
    })
    expect(maxX - minX).toBeLessThanOrEqual(1100 * 1.5)
    // All nodes still inside their band.
    const band = bands.find((b) => b.stratum === 'evidence')!
    for (const nd of nodes) {
      const y = positions.get(nd.id)!.y
      expect(y).toBeGreaterThanOrEqual(band.yTop)
      expect(y).toBeLessThanOrEqual(band.yBottom)
    }
  })

  it('spreads clustered-recent timestamps across the width (no far-right pile)', () => {
    // Real data clusters: one old node + a tight burst of recent distinct dates.
    // A raw-linear time axis crams the burst into the rightmost ~8% of the range
    // (everything piles against the right edge, most of the band reads empty).
    // The ordinal axis must spread the distinct dates across the full width.
    const width = 1100
    const nodes: LayoutInputNode[] = [
      n('old', 'strategic', 0),
      ...Array.from({ length: 10 }, (_, i) => n(`recent${i}`, 'strategic', 100 + i)),
    ]
    const { positions, minX, maxX } = computeStratifiedLayout(nodes, { width, nodeGap: 46 })
    const xs = nodes.map((nd) => positions.get(nd.id)!.x)
    // The used extent fills most of the width — not a sliver at the right edge.
    expect(maxX - minX).toBeGreaterThan(width * 0.7)
    // Nodes actually populate the MIDDLE of the band (empty under a linear axis,
    // where the whole recent burst would sit beyond ~0.9·width).
    const inMiddle = xs.filter((x) => x > width * 0.3 && x < width * 0.7)
    expect(inMiddle.length).toBeGreaterThan(0)
    // Oldest still anchors the left.
    expect(Math.min(...xs)).toBeLessThanOrEqual(width * 0.1)
  })

  it('all-equal timestamps fall back to a centered spread, not the right edge', () => {
    const width = 1100
    const nodes = Array.from({ length: 6 }, (_, i) => n(`d${i}`, 'operational', 12))
    const { positions } = computeStratifiedLayout(nodes, { width, nodeGap: 46 })
    const xs = nodes.map((nd) => positions.get(nd.id)!.x)
    // A degenerate time axis centers the cluster (min-gap fans it out around mid),
    // rather than gluing every node to x=width.
    expect(Math.min(...xs)).toBeLessThanOrEqual(width / 2 + 1e-6)
    expect(Math.max(...xs)).toBeLessThan(width) // never pinned to the exact right edge
  })

  it('populates every labelled band across the width under clustered dates', () => {
    // Legend counts nodes in DECISIONS/WORK/People/Meetings — each band must be
    // visibly filled, not silently truncated into an off-canvas right column.
    const width = 1100
    const strata: LayoutInputNode['stratum'][] = ['strategic', 'operational', 'people', 'evidence']
    const nodes: LayoutInputNode[] = []
    for (const s of strata) {
      // 8 distinct recent dates per band (the clustered case).
      for (let i = 0; i < 8; i++) nodes.push(n(`${s}-${i}`, s, 90 + i))
    }
    const { positions, bands } = computeStratifiedLayout(nodes, { width, nodeGap: 46 })
    expect(bands.map((b) => b.stratum)).toEqual(strata)
    for (const s of strata) {
      const xs = nodes.filter((nd) => nd.stratum === s).map((nd) => positions.get(nd.id)!.x)
      // Each band spreads across a wide swath — proof its nodes aren't jammed right.
      expect(Math.max(...xs) - Math.min(...xs)).toBeGreaterThan(width * 0.5)
    }
  })

  it('undated nodes sort to the far left (oldest)', () => {
    const nodes = [n('dated', 'operational', 30), n('undated', 'operational', null)]
    const { positions } = computeStratifiedLayout(nodes)
    expect(positions.get('undated')!.x).toBeLessThan(positions.get('dated')!.x)
  })

  it('aligns equal dates across different bands to the same x (shared time scale)', () => {
    const nodes = [
      n('decision', 'strategic', 10),
      n('meeting', 'evidence', 10),
      n('old-meeting', 'evidence', 0),
    ]
    const { positions } = computeStratifiedLayout(nodes)
    // The decision and the same-day meeting share the time scale → equal x.
    expect(positions.get('decision')!.x).toBeCloseTo(positions.get('meeting')!.x, 5)
  })
})

describe('date axis ticks (honest ordinal scale)', () => {
  it('labels the oldest and newest distinct dates at the correct x positions', () => {
    const nodes = [
      n('a', 'evidence', 0),
      n('b', 'evidence', 10),
      n('c', 'evidence', 100), // clustered gap — exactly what the ordinal axis compresses
      n('d', 'strategic', 101),
    ]
    const { ticks, positions } = computeStratifiedLayout(nodes, { width: 1100 })
    expect(ticks.length).toBeGreaterThanOrEqual(2)
    // First tick = oldest date, last tick = newest date — real dates in sight.
    expect(ticks[0].dateMs).toBe(base + 0 * DAY)
    expect(ticks[ticks.length - 1].dateMs).toBe(base + 101 * DAY)
    // Tick x positions align with the shared node scale: the oldest node sits on
    // the first tick, the newest node's base position on the last tick.
    expect(ticks[0].x).toBeCloseTo(positions.get('a')!.x, 5)
    expect(ticks[ticks.length - 1].x).toBeCloseTo(positions.get('d')!.x, 5)
    // Ticks run strictly left-to-right.
    for (let i = 1; i < ticks.length; i++) expect(ticks[i].x).toBeGreaterThan(ticks[i - 1].x)
  })

  it('a single distinct date yields one centered tick; no dated nodes yield none', () => {
    const one = computeStratifiedLayout([n('a', 'evidence', 5), n('b', 'people', 5)], { width: 1000 })
    expect(one.ticks).toHaveLength(1)
    expect(one.ticks[0].dateMs).toBe(base + 5 * DAY)
    expect(one.ticks[0].x).toBe(500)

    const none = computeStratifiedLayout([n('u', 'evidence', null)], { width: 1000 })
    expect(none.ticks).toHaveLength(0)
  })

  it('keeps ticks sparse (bounded count) even with many distinct dates', () => {
    const nodes = Array.from({ length: 60 }, (_, i) => n(`m${i}`, 'evidence', i))
    const { ticks } = computeStratifiedLayout(nodes, { width: 1100 })
    expect(ticks.length).toBeGreaterThanOrEqual(2)
    expect(ticks.length).toBeLessThanOrEqual(8)
    expect(ticks[0].dateMs).toBe(base)
    expect(ticks[ticks.length - 1].dateMs).toBe(base + 59 * DAY)
  })

  // Dynamically importing the canvas module can be starved past the default 5s
  // timeout when the full suite runs in parallel; the import itself is <50ms in
  // isolation. Give it headroom so heavy-load runs don't flake.
  it('tick labels render as short smart dates with the year', async () => {
    const { tickLabel } = await import('../StratifiedLensCanvas')
    expect(tickLabel(Date.parse('2026-06-01T12:00:00Z'))).toMatch(/Jun\s+1,\s+2026/)
    expect(tickLabel(Date.parse('2025-12-31T12:00:00Z'))).toMatch(/2025/)
  }, 15000)
})

describe('dense-timeline binning (no sub-diameter slot spacing)', () => {
  it('1000 distinct timestamps: the time scale bins ranks — adjacent slots never closer than the node diameter', async () => {
    // One node per minute for ~16h: without binning the ordinal scale would space
    // distinct x positions ~1 unit apart — far below the 28-unit node diameter —
    // and the band would collapse back into an unreadable smear.
    const { buildTimeScale } = await import('../layout')
    const MIN = 60_000
    const dates = Array.from({ length: 1000 }, (_, i) => base + i * MIN)
    const { slotXs, scaleX, ticks } = buildTimeScale(dates, 1100, 28)

    // The drawable slot grid respects the diameter floor…
    expect(slotXs.length).toBeGreaterThan(1)
    expect(slotXs.length).toBeLessThan(1000) // binning actually happened
    for (let i = 1; i < slotXs.length; i++) {
      expect(slotXs[i] - slotXs[i - 1]).toBeGreaterThanOrEqual(28 - 1e-9)
    }
    // …every node x lands ON that grid (no off-grid sub-diameter positions from
    // the scale itself)…
    const grid = new Set(slotXs.map((x) => x.toFixed(6)))
    for (const d of dates) expect(grid.has(scaleX(d).toFixed(6))).toBe(true)
    // …order is preserved and the anchors hold.
    expect(scaleX(dates[0])).toBeLessThan(scaleX(dates[500]))
    expect(scaleX(dates[500])).toBeLessThan(scaleX(dates[999]))
    expect(ticks[0].dateMs).toBe(dates[0])
    expect(ticks[ticks.length - 1].dateMs).toBe(dates[999])
  })

  it('1000-timestamp layout keeps every sub-row at >= nodeGap spacing (no sub-diameter neighbors in a row)', () => {
    const MIN = 60_000
    const nodes: LayoutInputNode[] = Array.from({ length: 1000 }, (_, i) => ({
      id: `t${i}`,
      stratum: 'evidence',
      dateMs: base + i * MIN,
      degree: 1,
    }))
    const { positions } = computeStratifiedLayout(nodes, { width: 1100, nodeGap: 46, minSlotSpacing: 28 })
    // Group by sub-row (y); horizontally adjacent nodes in a row must keep the
    // min gap — combined with the slot-grid floor above, nothing the scale or
    // the sweep produces sits closer than a node's own width to its neighbor.
    const byRow = new Map<number, number[]>()
    for (const nd of nodes) {
      const p = positions.get(nd.id)!
      if (!byRow.has(p.y)) byRow.set(p.y, [])
      byRow.get(p.y)!.push(p.x)
    }
    for (const xs of byRow.values()) {
      xs.sort((a, b) => a - b)
      for (let i = 1; i < xs.length; i++) {
        expect(xs[i] - xs[i - 1]).toBeGreaterThanOrEqual(46 - 1e-9)
      }
    }
  })

  it('binning does not kick in below the density threshold (few dates stay evenly spread)', async () => {
    const { buildTimeScale } = await import('../layout')
    const dates = Array.from({ length: 10 }, (_, i) => base + i * DAY)
    const { slotXs } = buildTimeScale(dates, 1100, 28)
    // 10 distinct dates fit comfortably → one slot per date, full-width spread.
    expect(slotXs.length).toBe(10)
    expect(slotXs[slotXs.length - 1] - slotXs[0]).toBeGreaterThan(1100 * 0.8)
  })
})

describe('node radius clamp (defect: unbounded degree sizing)', () => {
  it('clamps radius into a sane range regardless of degree', async () => {
    const { baseRadius } = await import('../StratifiedLensCanvas')
    // A ~400-degree hub used to cover a quarter of the viewport.
    expect(baseRadius(400)).toBeLessThanOrEqual(14)
    expect(baseRadius(10_000)).toBeLessThanOrEqual(14)
    // Leaves never vanish.
    expect(baseRadius(0)).toBeGreaterThanOrEqual(4)
    expect(baseRadius(1)).toBeGreaterThanOrEqual(4)
    // Still monotonic in degree below the cap (sqrt compression).
    expect(baseRadius(9)).toBeGreaterThan(baseRadius(1))
  })

  it('endpointId resolves both string ids and rebound node objects', async () => {
    const { endpointId } = await import('../StratifiedLensCanvas')
    expect(endpointId('person:alice')).toBe('person:alice')
    expect(endpointId({ id: 'person:alice' })).toBe('person:alice')
  })
})

describe('computeStratifiedLayout: determinism', () => {
  it('produces identical output for identical input', () => {
    const mk = (): LayoutInputNode[] => [
      n('d1', 'strategic', 3, 2),
      n('a1', 'operational', 1, 5),
      n('a2', 'operational', 1, 5),
      n('per1', 'people', 0),
      n('m1', 'evidence', 2),
    ]
    const r1 = computeStratifiedLayout(mk())
    const r2 = computeStratifiedLayout(mk())
    for (const id of ['d1', 'a1', 'a2', 'per1', 'm1']) {
      expect(r1.positions.get(id)).toEqual(r2.positions.get(id))
    }
  })

  it('STRATA_ORDER is the canonical four bands', () => {
    expect([...STRATA_ORDER]).toEqual(['strategic', 'operational', 'people', 'evidence'])
  })
})
