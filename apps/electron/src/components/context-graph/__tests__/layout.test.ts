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

  it('enforces a minimum horizontal gap between neighbours', () => {
    // Three meetings on the SAME day would collide without the sweep.
    const nodes = [n('a', 'evidence', 5), n('b', 'evidence', 5), n('c', 'evidence', 5)]
    const { positions } = computeStratifiedLayout(nodes, { nodeGap: 50 })
    const xs = ['a', 'b', 'c'].map((id) => positions.get(id)!.x).sort((p, q) => p - q)
    expect(xs[1] - xs[0]).toBeGreaterThanOrEqual(50 - 1e-9)
    expect(xs[2] - xs[1]).toBeGreaterThanOrEqual(50 - 1e-9)
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
