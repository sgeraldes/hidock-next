import { describe, it, expect } from 'vitest'
import {
  sortActionables,
  groupActionables,
  filterByType,
  filterByDate,
  distinctTypes
} from '../actionablesFilters'
import type { Actionable } from '@/types/knowledge'

function makeActionable(overrides: Partial<Actionable> = {}): Actionable {
  return {
    id: Math.random().toString(36).slice(2),
    type: 'meeting_minutes',
    title: 'Untitled',
    description: null,
    sourceKnowledgeId: 'k1',
    sourceActionItemId: null,
    suggestedTemplate: 'meeting_minutes',
    suggestedRecipients: [],
    status: 'pending',
    confidence: 0.5,
    artifactId: null,
    generatedAt: null,
    sharedAt: null,
    createdAt: new Date('2026-06-01T10:00:00Z').toISOString(),
    updatedAt: new Date('2026-06-01T10:00:00Z').toISOString(),
    ...overrides
  }
}

describe('sortActionables', () => {
  const a = makeActionable({ id: 'a', createdAt: '2026-01-01T00:00:00Z', confidence: 0.3, type: 'status_report' })
  const b = makeActionable({ id: 'b', createdAt: '2026-03-01T00:00:00Z', confidence: 0.9, type: 'action_items' })
  const c = makeActionable({ id: 'c', createdAt: '2026-02-01T00:00:00Z', confidence: 0.6, type: 'meeting_minutes' })
  const items = [a, b, c]

  it('sorts by date descending (newest first)', () => {
    const out = sortActionables(items, 'date', 'desc').map((x) => x.id)
    expect(out).toEqual(['b', 'c', 'a'])
  })

  it('sorts by date ascending (oldest first)', () => {
    const out = sortActionables(items, 'date', 'asc').map((x) => x.id)
    expect(out).toEqual(['a', 'c', 'b'])
  })

  it('sorts by confidence descending', () => {
    const out = sortActionables(items, 'confidence', 'desc').map((x) => x.id)
    expect(out).toEqual(['b', 'c', 'a'])
  })

  it('sorts by type alphabetically (by human label) ascending', () => {
    // labels: Action items (b), Meeting minutes (c), Status report (a)
    const out = sortActionables(items, 'type', 'asc').map((x) => x.id)
    expect(out).toEqual(['b', 'c', 'a'])
  })

  it('does not mutate the input array', () => {
    const original = items.map((x) => x.id)
    sortActionables(items, 'date', 'asc')
    expect(items.map((x) => x.id)).toEqual(original)
  })
})

describe('groupActionables', () => {
  it('returns a single unlabelled group when key is none', () => {
    const items = [makeActionable(), makeActionable()]
    const groups = groupActionables(items, 'none')
    expect(groups).toHaveLength(1)
    expect(groups[0].label).toBe('')
    expect(groups[0].items).toHaveLength(2)
  })

  it('groups by status in a fixed meaningful order', () => {
    const items = [
      makeActionable({ status: 'dismissed' }),
      makeActionable({ status: 'pending' }),
      makeActionable({ status: 'generated' })
    ]
    const groups = groupActionables(items, 'status')
    expect(groups.map((g) => g.key)).toEqual(['pending', 'generated', 'dismissed'])
    expect(groups[0].label).toBe('Pending')
  })

  it('groups by type with a bucket per distinct type', () => {
    const items = [
      makeActionable({ type: 'meeting_minutes' }),
      makeActionable({ type: 'action_items' }),
      makeActionable({ type: 'meeting_minutes' })
    ]
    const groups = groupActionables(items, 'type')
    expect(groups).toHaveLength(2)
    const mm = groups.find((g) => g.key === 'meeting_minutes')
    expect(mm?.items).toHaveLength(2)
  })

  it('groups by source knowledge id', () => {
    const items = [
      makeActionable({ sourceKnowledgeId: 'src-1' }),
      makeActionable({ sourceKnowledgeId: 'src-2' })
    ]
    const groups = groupActionables(items, 'source')
    expect(groups).toHaveLength(2)
  })
})

describe('filterByType', () => {
  const items = [
    makeActionable({ type: 'meeting_minutes' }),
    makeActionable({ type: 'action_items' })
  ]

  it('returns all when type is "all"', () => {
    expect(filterByType(items, 'all')).toHaveLength(2)
  })

  it('filters to the matching type', () => {
    const out = filterByType(items, 'action_items')
    expect(out).toHaveLength(1)
    expect(out[0].type).toBe('action_items')
  })
})

describe('filterByDate', () => {
  const now = new Date('2026-06-30T00:00:00Z')
  const recent = makeActionable({ id: 'recent', createdAt: '2026-06-28T00:00:00Z' })
  const old = makeActionable({ id: 'old', createdAt: '2026-01-01T00:00:00Z' })
  const items = [recent, old]

  it('returns everything for "all"', () => {
    expect(filterByDate(items, 'all', now)).toHaveLength(2)
  })

  it('keeps only items within the last 7 days', () => {
    const out = filterByDate(items, '7d', now).map((x) => x.id)
    expect(out).toEqual(['recent'])
  })

  it('keeps items within the last 30 days', () => {
    const out = filterByDate(items, '30d', now).map((x) => x.id)
    expect(out).toEqual(['recent'])
  })
})

describe('distinctTypes', () => {
  it('returns sorted, de-duplicated human-labelled types', () => {
    const items = [
      makeActionable({ type: 'status_report' }),
      makeActionable({ type: 'action_items' }),
      makeActionable({ type: 'action_items' })
    ]
    const out = distinctTypes(items)
    expect(out.map((t) => t.value)).toEqual(['action_items', 'status_report'])
    expect(out[0].label).toBe('Action items')
  })
})
