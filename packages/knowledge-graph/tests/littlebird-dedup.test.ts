// @vitest-environment node

/**
 * Synthetic-fixture tests for Littlebird cross-source deduplication
 * (task 12.6, Req 8.5-8.8). Exercises `evaluateDedup`'s precedence ordering
 * against `.kiro/specs/hidock-graph-extraction-hardening/notes/littlebird-cross-source-dedup.md`.
 *
 * PRIVACY: every fixture below is invented (synthetic names, apps,
 * timestamps, hashes). No real meeting, transcript, or participant data
 * appears anywhere in this file.
 */

import { describe, it, expect } from 'vitest'
import type { CanonicalCaptureModel } from '../src/littlebird-adapter.js'
import {
  evaluateDedup,
  assertExplicitEquivalence,
  retractEquivalence,
  isActiveEquivalence,
  DEFAULT_DEDUP_CONFIG,
  type DedupConfig,
  type CalendarAnchor,
} from '../src/littlebird-dedup.js'
import { Category } from '../src/extract.js'

const NOW = '2099-01-01T12:00:00.000Z'

function record(overrides: Partial<CanonicalCaptureModel> = {}): CanonicalCaptureModel {
  return {
    source: 'littlebird',
    nativeEventId: 'synthetic-native-a',
    originatingApp: 'synthetic-chat-app',
    appContext: 'synthetic-channel-1',
    sourceTimestamp: '2099-01-01T10:00:00.000Z',
    participants: ['Synthetic Alpha', 'Synthetic Beta'],
    permalink: 'https://synthetic.invalid/a',
    captureTimestamp: '2099-01-01T10:05:00.000Z',
    classification: Category.Work,
    connectorVersion: 'test-connector-0.0.0',
    contentHash: 'sha256:synthetic-hash-a',
    tombstone: false,
    ...overrides,
  }
}

describe('evaluateDedup — (a) native identifier / permalink, strongest', () => {
  it('matches on identical nativeEventId + source', () => {
    const a = record({ nativeEventId: 'synthetic-shared-id', source: 'littlebird' })
    const b = record({
      nativeEventId: 'synthetic-shared-id',
      source: 'littlebird',
      permalink: 'https://synthetic.invalid/different',
      participants: ['Nobody Overlapping'],
      sourceTimestamp: '2050-06-15T00:00:00.000Z',
    })
    const eq = evaluateDedup(a, b, NOW)
    expect(eq?.matchedRule).toBe('native')
    expect(eq?.evidence).toEqual({ rule: 'native', nativeEventId: 'synthetic-shared-id' })
    expect(eq?.reversible).toBe(true)
    expect(eq?.retractedAt).toBeNull()
  })

  it('matches on identical permalink when nativeEventId differs', () => {
    const a = record({ nativeEventId: 'synthetic-id-1', permalink: 'https://synthetic.invalid/shared' })
    const b = record({
      nativeEventId: 'synthetic-id-2',
      permalink: 'https://synthetic.invalid/shared',
      participants: ['Nobody Overlapping'],
      sourceTimestamp: '2050-06-15T00:00:00.000Z',
    })
    const eq = evaluateDedup(a, b, NOW)
    expect(eq?.matchedRule).toBe('native')
    expect(eq?.evidence).toEqual({ rule: 'native', permalink: 'https://synthetic.invalid/shared' })
  })

  it('absent/differing native identity degrades gracefully to rule (b), never errors', () => {
    const a = record({ nativeEventId: 'synthetic-id-1', permalink: undefined })
    const b = record({ nativeEventId: 'synthetic-id-2', permalink: undefined })
    // a & b otherwise agree on app/time/participants -> should fall through to (b), not fail.
    const eq = evaluateDedup(a, b, NOW)
    expect(eq?.matchedRule).toBe('app+time+participants')
  })
})

describe('evaluateDedup — (b) app + timestamp window + participant overlap', () => {
  it('matches when all three agree within tolerance', () => {
    const a = record({ nativeEventId: 'synthetic-id-1' })
    const b = record({
      nativeEventId: 'synthetic-id-2',
      permalink: undefined,
      sourceTimestamp: '2099-01-01T10:05:00.000Z', // 5 min delta, within default 15 min tolerance
    })
    const eq = evaluateDedup(a, b, NOW)
    expect(eq?.matchedRule).toBe('app+time+participants')
    if (eq?.evidence.rule !== 'app+time+participants') throw new Error('wrong evidence shape')
    expect(eq.evidence.originatingApp).toBe('synthetic-chat-app')
    expect(eq.evidence.participantOverlapFraction).toBe(1)
  })

  it('does not match when timestamps fall outside tolerance', () => {
    const a = record({ nativeEventId: 'synthetic-id-1' })
    const b = record({
      nativeEventId: 'synthetic-id-2',
      permalink: undefined,
      contentHash: 'sha256:different-hash',
      sourceTimestamp: '2099-01-01T14:00:00.000Z', // 4h delta
    })
    const eq = evaluateDedup(a, b, NOW)
    expect(eq).toBeNull()
  })

  it('does not match when participant overlap is below threshold', () => {
    const a = record({ nativeEventId: 'synthetic-id-1', participants: ['Synthetic Alpha', 'Synthetic Beta'] })
    const b = record({
      nativeEventId: 'synthetic-id-2',
      permalink: undefined,
      contentHash: 'sha256:different-hash',
      participants: ['Synthetic Gamma', 'Synthetic Delta'], // zero overlap
    })
    const eq = evaluateDedup(a, b, NOW)
    expect(eq).toBeNull()
  })

  it('does not match when appContext disagrees on both sides', () => {
    const a = record({ nativeEventId: 'synthetic-id-1', appContext: 'synthetic-channel-1' })
    const b = record({
      nativeEventId: 'synthetic-id-2',
      permalink: undefined,
      contentHash: 'sha256:different-hash',
      appContext: 'synthetic-channel-2',
    })
    const eq = evaluateDedup(a, b, NOW)
    expect(eq).toBeNull()
  })

  it('tolerance and threshold are configurable', () => {
    const a = record({ nativeEventId: 'synthetic-id-1' })
    const b = record({
      nativeEventId: 'synthetic-id-2',
      permalink: undefined,
      contentHash: 'sha256:different-hash', // must differ, or rule (c) fires regardless of (b)'s config
      sourceTimestamp: '2099-01-01T11:00:00.000Z', // 1h delta
    })
    const strict: DedupConfig = { timestampToleranceMs: 5 * 60 * 1000, participantOverlapThreshold: 0.9 }
    expect(evaluateDedup(a, b, NOW, strict)).toBeNull()

    const loose: DedupConfig = { timestampToleranceMs: 2 * 60 * 60 * 1000, participantOverlapThreshold: 0.5 }
    expect(evaluateDedup(a, b, NOW, loose)?.matchedRule).toBe('app+time+participants')
  })
})

describe('evaluateDedup — (c) normalized content hash', () => {
  it('matches on identical contentHash when app/time/participants all disagree', () => {
    const a = record({
      nativeEventId: 'synthetic-id-1',
      originatingApp: 'synthetic-app-one',
      sourceTimestamp: '2010-01-01T00:00:00.000Z',
      participants: ['Synthetic Solo'],
      contentHash: 'sha256:shared-normalized-hash',
    })
    const b = record({
      nativeEventId: 'synthetic-id-2',
      permalink: undefined,
      originatingApp: 'synthetic-app-two',
      sourceTimestamp: '2090-01-01T00:00:00.000Z',
      participants: ['Someone Else Entirely'],
      contentHash: 'sha256:shared-normalized-hash',
    })
    const eq = evaluateDedup(a, b, NOW)
    expect(eq?.matchedRule).toBe('content-hash')
    expect(eq?.evidence).toEqual({ rule: 'content-hash', contentHash: 'sha256:shared-normalized-hash' })
  })
})

describe('evaluateDedup — (d) calendar / meeting-time correlation', () => {
  const anchor: CalendarAnchor = {
    id: 'synthetic-calendar-anchor-1',
    startTimestamp: '2099-03-01T09:00:00.000Z',
    endTimestamp: '2099-03-01T10:00:00.000Z',
    participants: ['Synthetic Alpha', 'Synthetic Beta'],
  }

  it('matches via calendar correlation when (a)-(c) do not fire', () => {
    const a = record({
      nativeEventId: 'synthetic-id-1',
      originatingApp: 'synthetic-app-one',
      contentHash: 'sha256:hash-one',
      sourceTimestamp: '2099-03-01T09:15:00.000Z',
      participants: ['Synthetic Alpha'],
    })
    const b = record({
      nativeEventId: 'synthetic-id-2',
      permalink: undefined,
      originatingApp: 'synthetic-app-two',
      contentHash: 'sha256:hash-two',
      sourceTimestamp: '2099-03-01T09:45:00.000Z',
      participants: ['Synthetic Beta'],
    })
    const eq = evaluateDedup(a, b, NOW, DEFAULT_DEDUP_CONFIG, [anchor])
    expect(eq?.matchedRule).toBe('calendar-correlation')
    expect(eq?.evidence).toEqual({ rule: 'calendar-correlation', calendarAnchorId: anchor.id })
  })

  it('does not match when only one record falls in the anchor window', () => {
    const a = record({
      nativeEventId: 'synthetic-id-1',
      originatingApp: 'synthetic-app-one',
      contentHash: 'sha256:hash-one',
      sourceTimestamp: '2099-03-01T09:15:00.000Z',
      participants: ['Synthetic Alpha'],
    })
    const b = record({
      nativeEventId: 'synthetic-id-2',
      permalink: undefined,
      originatingApp: 'synthetic-app-two',
      contentHash: 'sha256:hash-two',
      sourceTimestamp: '2050-01-01T00:00:00.000Z', // outside the anchor window
      participants: ['Synthetic Beta'],
    })
    expect(evaluateDedup(a, b, NOW, DEFAULT_DEDUP_CONFIG, [anchor])).toBeNull()
  })
})

describe('evaluateDedup — no rule fires: safe "retain both" default', () => {
  it('returns null when nothing correlates', () => {
    const a = record({
      nativeEventId: 'synthetic-id-1',
      originatingApp: 'synthetic-app-one',
      contentHash: 'sha256:hash-one',
      sourceTimestamp: '2010-01-01T00:00:00.000Z',
      participants: ['Synthetic Alpha'],
    })
    const b = record({
      nativeEventId: 'synthetic-id-2',
      permalink: undefined,
      originatingApp: 'synthetic-app-two',
      contentHash: 'sha256:hash-two',
      sourceTimestamp: '2090-01-01T00:00:00.000Z',
      participants: ['Synthetic Zeta'],
    })
    expect(evaluateDedup(a, b, NOW)).toBeNull()
  })
})

describe('evaluateDedup — Req 8.8: title alone can never produce a match', () => {
  it('identical injected "title" fields do not cause a match when every real signal disagrees', () => {
    // CanonicalCaptureModel has no title field; evaluateDedup never reads one.
    // This simulates a caller mistakenly attaching a shared title alongside
    // two otherwise-unrelated records, to prove title cannot smuggle a match.
    const a = { ...record({ nativeEventId: 'synthetic-id-1', originatingApp: 'synthetic-app-one', contentHash: 'sha256:hash-one', sourceTimestamp: '2010-01-01T00:00:00.000Z', participants: ['Synthetic Alpha'] }), title: 'Weekly Sync' } as CanonicalCaptureModel & { title: string }
    const b = { ...record({ nativeEventId: 'synthetic-id-2', permalink: undefined, originatingApp: 'synthetic-app-two', contentHash: 'sha256:hash-two', sourceTimestamp: '2090-01-01T00:00:00.000Z', participants: ['Synthetic Zeta'] }), title: 'Weekly Sync' } as CanonicalCaptureModel & { title: string }
    expect(evaluateDedup(a, b, NOW)).toBeNull()
  })
})

describe('assertExplicitEquivalence — rule (e), never automatic', () => {
  it('creates a matchedRule:"explicit" record with the given provenance', () => {
    const a = record({ nativeEventId: 'synthetic-id-1' })
    const b = record({ nativeEventId: 'synthetic-id-2', permalink: undefined, contentHash: 'sha256:unrelated' })
    const eq = assertExplicitEquivalence(a, b, NOW, { kind: 'operator', operatorId: 'synthetic-operator-1' }, 'confirmed same meeting')
    expect(eq.matchedRule).toBe('explicit')
    expect(eq.assertedBy).toEqual({ kind: 'operator', operatorId: 'synthetic-operator-1' })
    expect(eq.evidence).toEqual({ rule: 'explicit', note: 'confirmed same meeting' })
    expect(eq.reversible).toBe(true)
    expect(eq.retractedAt).toBeNull()
  })
})

describe('retractEquivalence / isActiveEquivalence — reversibility (Req 8.7)', () => {
  it('retraction is a non-mutating metadata operation, not data loss', () => {
    const a = record({ nativeEventId: 'synthetic-id-1' })
    const b = record({ nativeEventId: 'synthetic-id-2', permalink: undefined })
    const eq = evaluateDedup(a, b, NOW)
    if (!eq) throw new Error('expected a match to retract')
    expect(isActiveEquivalence(eq)).toBe(true)

    const retracted = retractEquivalence(eq, '2099-01-02T00:00:00.000Z')
    expect(isActiveEquivalence(retracted)).toBe(false)
    expect(retracted.retractedAt).toBe('2099-01-02T00:00:00.000Z')

    // Original is untouched (no mutation) and every other field is preserved.
    expect(eq.retractedAt).toBeNull()
    expect(retracted.matchedRule).toBe(eq.matchedRule)
    expect(retracted.evidence).toEqual(eq.evidence)
    expect(retracted.leftId).toEqual(eq.leftId)
    expect(retracted.rightId).toEqual(eq.rightId)
  })
})
