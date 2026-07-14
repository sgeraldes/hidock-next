import { describe, it, expect } from 'vitest'
import { computeSharedContext, topicsShare, topicTokens, type PersonContext } from '../personContext'

const ctx = (people: string[], topics: string[]): PersonContext => ({ people, topics })

describe('topicTokens', () => {
  it('lowercases, strips stopwords (EN + ES), and stems plurals/gerunds', () => {
    const t = topicTokens('Process for Peer Reviews and Evidence Uploads')
    expect(t.has('process')).toBe(true)
    expect(t.has('peer')).toBe(true)
    expect(t.has('review')).toBe(true) // reviews → review
    expect(t.has('upload')).toBe(true) // uploads → upload
    expect(t.has('for')).toBe(false) // stopword
    expect(t.has('and')).toBe(false) // stopword
  })

  it('drops Spanish connectors but keeps subject nouns', () => {
    const t = topicTokens('Proceso de revisión de código')
    expect(t.has('de')).toBe(false)
    expect(t.has('proceso')).toBe(true)
    expect(t.has('codigo')).toBe(true) // accent stripped
  })
})

describe('topicsShare', () => {
  it('treats phrasings of the same subject as shared (live example)', () => {
    expect(
      topicsShare('Code Review Bottlenecks and Peer Reviews', 'Process for Peer Review and Evidence Uploads')
    ).toBe(true)
  })

  it('shares on a single distinctive token like "jira" or "peer review"', () => {
    expect(topicsShare('Jira Backlog Grooming', 'Migrating tickets to Jira')).toBe(true)
    expect(topicsShare('Peer Review Guidelines', 'Speeding up peer review')).toBe(true)
  })

  it('does not share genuinely different subjects', () => {
    expect(topicsShare('Budget Forecasting', 'Kubernetes Autoscaling')).toBe(false)
    expect(topicsShare('Atlas', 'Nimbus')).toBe(false)
  })

  it('is empty-safe and symmetric', () => {
    expect(topicsShare('', 'anything')).toBe(false)
    expect(topicsShare('and the of', 'for to in')).toBe(false) // all stopwords → empty sets
    expect(topicsShare('Peer Review', 'Review Peer')).toBe(true)
  })
})

describe('computeSharedContext', () => {
  it('highlights entries shared by both sides within their kind', () => {
    const c = computeSharedContext(ctx(['Bob', 'Carol'], ['Atlas']), ctx(['Bob'], ['Atlas', 'Nimbus']))
    const aPeople = c.a.people
    expect(aPeople.find((x) => x.label === 'Bob')?.shared).toBe(true)
    expect(aPeople.find((x) => x.label === 'Carol')?.shared).toBe(false)
    expect(c.a.topics.find((x) => x.label === 'Atlas')?.shared).toBe(true)
    // Symmetric: Bob is shared on side B too.
    expect(c.b.people.find((x) => x.label === 'Bob')?.shared).toBe(true)
    expect(c.hasShared).toBe(true)
    expect(c.disjoint).toBe(false)
  })

  it('matches people case-insensitively and dedupes within a side', () => {
    const c = computeSharedContext(ctx(['bob', 'Bob'], []), ctx(['BOB'], []))
    // Deduped to one chip, and it is shared.
    expect(c.a.people).toHaveLength(1)
    expect(c.a.people[0].shared).toBe(true)
  })

  it('marks semantically-related topics as shared and flags relatedTopics (positive signal)', () => {
    const c = computeSharedContext(
      ctx([], ['Code Review Bottlenecks and Peer Reviews']),
      ctx([], ['Process for Peer Review and Evidence Uploads'])
    )
    expect(c.a.topics[0].shared).toBe(true)
    expect(c.b.topics[0].shared).toBe(true)
    expect(c.relatedTopics).toBe(true)
    expect(c.hasShared).toBe(true)
    expect(c.disjoint).toBe(false)
  })

  it('flags "different circles" only when both sides are genuinely disjoint', () => {
    const c = computeSharedContext(ctx(['Alice'], ['Budget Forecasting']), ctx(['Zoe'], ['Kubernetes Autoscaling']))
    expect(c.hasShared).toBe(false)
    expect(c.relatedTopics).toBe(false)
    expect(c.disjoint).toBe(true)
  })

  it('does NOT flag disjoint when topics are only fuzzy-shared (regression on over-warning)', () => {
    const c = computeSharedContext(
      ctx(['Alice'], ['Peer Review Process']),
      ctx(['Zoe'], ['Reviewing peers and evidence'])
    )
    expect(c.disjoint).toBe(false)
    expect(c.relatedTopics).toBe(true)
  })

  it('does not flag disjoint when a side has no context', () => {
    const c = computeSharedContext(ctx(['Alice'], ['Atlas']), ctx([], []))
    expect(c.disjoint).toBe(false)
    expect(c.hasShared).toBe(false)
  })

  it('does not cross-match a person against a topic of the same label', () => {
    // 'Atlas' as a person on A must not count as shared with 'Atlas' topic on B.
    const c = computeSharedContext(ctx(['Atlas'], []), ctx([], ['Atlas']))
    expect(c.hasShared).toBe(false)
    expect(c.a.people[0].shared).toBe(false)
  })
})
