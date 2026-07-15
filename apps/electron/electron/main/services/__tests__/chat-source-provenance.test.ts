// @vitest-environment node

/**
 * ADV18 (round-19) — chat/RAG persisted-provenance boundary.
 *
 * Deterministic unit coverage of the message-level provenance union model:
 * packSources (persist) + revalidateStoredSources (read) + isProvenanceExcluded
 * (the shared fail-closed decision) + presentSourcesNoRevalidate, with the shared
 * eligibility boundaries MOCKED so every branch (eligible / one-excluded /
 * capture-excluded / unverifiable / legacy / older-version / malformed /
 * fail-closed) is exercised without a live DB.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../recording-eligibility', () => ({
  filterEligibleRecordingIds: vi.fn(),
  filterEligibleCaptureIds: vi.fn()
}))

import { filterEligibleRecordingIds, filterEligibleCaptureIds } from '../recording-eligibility'
import {
  packSources,
  presentSourcesNoRevalidate,
  revalidateStoredSources,
  isProvenanceExcluded,
  REDACTED_ANSWER,
  SOURCE_PROVENANCE_V,
  type MessageProvenance
} from '../chat-source-provenance'

const setOf = (ids: string[]) => ({ eligible: new Set(ids), failClosed: false })
const failClosed = () => ({ eligible: new Set<string>(), failClosed: true })

const prov = (recordingIds: string[], captureIds: string[] = [], unverifiable = false): MessageProvenance => ({
  recordingIds,
  captureIds,
  unverifiable
})

/** Build a stored v2 envelope with the given sources array + provenance union. */
const packWith = (sources: unknown[], p: MessageProvenance): string =>
  packSources(JSON.stringify(sources), p)!

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(filterEligibleRecordingIds).mockReturnValue(setOf([]))
  vi.mocked(filterEligibleCaptureIds).mockReturnValue(setOf([]))
})

describe('packSources', () => {
  it('builds a versioned envelope with the message-level provenance union', () => {
    const packed = packSources(
      JSON.stringify([{ content: 'excerpt', meetingId: 'm1' }]),
      prov(['recA', 'recB'], ['capX'])
    )!
    const env = JSON.parse(packed)
    expect(env.v).toBe(SOURCE_PROVENANCE_V)
    expect(env.sources).toEqual([{ content: 'excerpt', meetingId: 'm1' }])
    expect(env.prov.recordingIds.sort()).toEqual(['recA', 'recB'])
    expect(env.prov.captureIds).toEqual(['capX'])
    expect(env.prov.unverifiable).toBe(false)
  })

  it('writes an envelope even when the sources array is empty (pinned/graph-only answer)', () => {
    const packed = packSources(undefined, prov(['recA']))!
    const env = JSON.parse(packed)
    expect(env.v).toBe(SOURCE_PROVENANCE_V)
    expect(env.sources).toEqual([])
    expect(env.prov.recordingIds).toEqual(['recA'])
  })

  it('normalizes the union (dedup + drop non-string ids)', () => {
    const packed = packSources('[]', {
      recordingIds: ['recA', 'recA', '', 1 as never],
      captureIds: [],
      unverifiable: false
    })!
    expect(JSON.parse(packed).prov.recordingIds).toEqual(['recA'])
  })

  it('without a provenance union, stores raw sources verbatim / null', () => {
    expect(packSources(undefined)).toBeNull()
    expect(packSources(null)).toBeNull()
    expect(packSources('[]')).toBe('[]')
    expect(packSources(JSON.stringify([{ a: 1 }]))).toBe(JSON.stringify([{ a: 1 }]))
  })
})

describe('presentSourcesNoRevalidate', () => {
  it('unwraps the envelope to the plain sources array', () => {
    const packed = packWith([{ content: 'excerpt', meetingId: 'm1', subject: 'Sync' }], prov(['recA']))
    expect(JSON.parse(presentSourcesNoRevalidate(packed)!)).toEqual([
      { content: 'excerpt', meetingId: 'm1', subject: 'Sync' }
    ])
  })

  it('passes through non-envelope blobs untouched', () => {
    expect(presentSourcesNoRevalidate(null)).toBeNull()
    expect(presentSourcesNoRevalidate('[]')).toBe('[]')
  })
})

describe('isProvenanceExcluded (shared fail-closed decision)', () => {
  it('true for undefined provenance (unverifiable)', () => {
    expect(isProvenanceExcluded(undefined)).toBe(true)
  })

  it('true when explicitly marked unverifiable', () => {
    expect(isProvenanceExcluded(prov(['recA'], [], true))).toBe(true)
  })

  it('false for an all-eligible union', () => {
    vi.mocked(filterEligibleRecordingIds).mockReturnValue(setOf(['recA']))
    vi.mocked(filterEligibleCaptureIds).mockReturnValue(setOf(['capX']))
    expect(isProvenanceExcluded(prov(['recA'], ['capX']))).toBe(false)
  })

  it('false for an empty, verifiable union (nothing excludable)', () => {
    expect(isProvenanceExcluded(prov([], []))).toBe(false)
    expect(filterEligibleRecordingIds).not.toHaveBeenCalled()
    expect(filterEligibleCaptureIds).not.toHaveBeenCalled()
  })

  it('true when ANY recording is excluded', () => {
    vi.mocked(filterEligibleRecordingIds).mockReturnValue(setOf(['recA'])) // recB excluded
    expect(isProvenanceExcluded(prov(['recA', 'recB']))).toBe(true)
  })

  it('true when ANY capture is excluded', () => {
    vi.mocked(filterEligibleRecordingIds).mockReturnValue(setOf(['recA']))
    vi.mocked(filterEligibleCaptureIds).mockReturnValue(setOf([])) // capX excluded
    expect(isProvenanceExcluded(prov(['recA'], ['capX']))).toBe(true)
  })

  it('true (fail closed) when the recording eligibility lookup fails', () => {
    vi.mocked(filterEligibleRecordingIds).mockReturnValue(failClosed())
    expect(isProvenanceExcluded(prov(['recA']))).toBe(true)
  })

  it('true (fail closed) when the capture eligibility lookup fails', () => {
    vi.mocked(filterEligibleCaptureIds).mockReturnValue(failClosed())
    expect(isProvenanceExcluded(prov([], ['capX']))).toBe(true)
  })
})

describe('revalidateStoredSources — redact on ANY excluded / unverifiable', () => {
  it('keeps a fully-eligible answer unchanged', () => {
    const stored = packWith([{ content: 'excerpt', subject: 'Sync' }], prov(['recA']))
    vi.mocked(filterEligibleRecordingIds).mockReturnValue(setOf(['recA']))
    const { sources, redactContent } = revalidateStoredSources(stored, 'assistant')
    expect(JSON.parse(sources!)).toEqual([{ content: 'excerpt', subject: 'Sync' }])
    expect(redactContent).toBe(false)
  })

  it('mixed-source answer with ONE excluded ⇒ WHOLE answer redacted + all chips dropped', () => {
    const stored = packWith(
      [{ content: 'good' }, { content: 'bad' }],
      prov(['recGood', 'recBad'])
    )
    vi.mocked(filterEligibleRecordingIds).mockReturnValue(setOf(['recGood'])) // recBad excluded
    const { sources, redactContent } = revalidateStoredSources(stored, 'assistant')
    expect(JSON.parse(sources!)).toEqual([])
    expect(redactContent).toBe(true)
  })

  it('pinned/graph-only answer (empty chips) whose recording is excluded ⇒ redacted', () => {
    const stored = packSources(undefined, prov(['recPinned']))! // no chips, only union
    vi.mocked(filterEligibleRecordingIds).mockReturnValue(setOf([])) // recPinned excluded
    const { sources, redactContent } = revalidateStoredSources(stored, 'assistant')
    expect(JSON.parse(sources!)).toEqual([])
    expect(redactContent).toBe(true)
  })

  it('capture-backed answer whose capture is excluded ⇒ redacted', () => {
    const stored = packWith([{ content: 'img', captureId: 'capX' }], prov([], ['capX']))
    vi.mocked(filterEligibleCaptureIds).mockReturnValue(setOf([])) // capX excluded
    const { redactContent } = revalidateStoredSources(stored, 'assistant')
    expect(redactContent).toBe(true)
  })

  it('unverifiable union ⇒ redacted', () => {
    const stored = packWith([{ content: 'x' }], prov(['recA'], [], true))
    vi.mocked(filterEligibleRecordingIds).mockReturnValue(setOf(['recA']))
    expect(revalidateStoredSources(stored, 'assistant').redactContent).toBe(true)
  })

  it('empty verifiable union ⇒ kept (grounded on nothing excludable)', () => {
    const stored = packSources(undefined, prov([], []))!
    const { redactContent } = revalidateStoredSources(stored, 'assistant')
    expect(redactContent).toBe(false)
  })

  it('LEGACY (un-enveloped) assistant message with sources ⇒ redacted (fail closed)', () => {
    const legacy = JSON.stringify([{ content: 'old excerpt', meetingId: 'm1' }])
    const { sources, redactContent } = revalidateStoredSources(legacy, 'assistant')
    expect(JSON.parse(sources!)).toEqual([])
    expect(redactContent).toBe(true)
  })

  it('OLDER envelope version (v1) ⇒ treated conservatively (redacted)', () => {
    const v1 = JSON.stringify({ v: 1, sources: [{ content: 'x', _prov: {} }] })
    expect(revalidateStoredSources(v1, 'assistant').redactContent).toBe(true)
  })

  it('MALFORMED / parse-error blob on an assistant message ⇒ redacted', () => {
    expect(revalidateStoredSources('{not valid json', 'assistant').redactContent).toBe(true)
  })

  it('a current-version envelope with MALFORMED prov ⇒ unverifiable ⇒ redacted', () => {
    const broken = JSON.stringify({ v: SOURCE_PROVENANCE_V, sources: [{ content: 'x' }], prov: 5 })
    expect(revalidateStoredSources(broken, 'assistant').redactContent).toBe(true)
  })

  it('leaves a null / empty-sources message untouched', () => {
    expect(revalidateStoredSources(null, 'assistant')).toEqual({ sources: null, redactContent: false })
    expect(revalidateStoredSources('[]', 'assistant')).toEqual({ sources: '[]', redactContent: false })
  })

  it('NEVER redacts a USER message, even with an excluded union', () => {
    const stored = packWith([{ content: 'x' }], prov(['recA']))
    vi.mocked(filterEligibleRecordingIds).mockReturnValue(setOf([])) // recA excluded
    expect(revalidateStoredSources(stored, 'user').redactContent).toBe(false)
    // A legacy user message keeps its sources verbatim too.
    expect(revalidateStoredSources(JSON.stringify([{ content: 'y' }]), 'user').redactContent).toBe(false)
  })
})

describe('REDACTED_ANSWER', () => {
  it('is a non-empty placeholder', () => {
    expect(REDACTED_ANSWER.length).toBeGreaterThan(0)
  })
})
