// @vitest-environment node

/**
 * ADV17-2 (round-18) — chat-source provenance boundary.
 *
 * Deterministic unit coverage of packSources + revalidateStoredSources +
 * presentSourcesNoRevalidate with the DB resolution and the shared eligibility
 * boundaries MOCKED, so every branch (eligible / excluded / all-excluded /
 * legacy / fail-closed / capture-source) is exercised without a live DB.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../database', () => ({
  getRecordingsForMeeting: vi.fn()
}))
vi.mock('../recording-eligibility', () => ({
  filterEligibleRecordingIds: vi.fn(),
  filterEligibleCaptureIds: vi.fn()
}))

import { getRecordingsForMeeting } from '../database'
import { filterEligibleRecordingIds, filterEligibleCaptureIds } from '../recording-eligibility'
import {
  packSources,
  presentSourcesNoRevalidate,
  revalidateStoredSources,
  REDACTED_ANSWER,
  SOURCE_PROVENANCE_V
} from '../chat-source-provenance'

const setOf = (ids: string[]) => ({ eligible: new Set(ids), failClosed: false })
const failClosed = () => ({ eligible: new Set<string>(), failClosed: true })

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(getRecordingsForMeeting).mockReturnValue([])
  vi.mocked(filterEligibleRecordingIds).mockReturnValue(setOf([]))
  vi.mocked(filterEligibleCaptureIds).mockReturnValue(setOf([]))
})

describe('packSources', () => {
  it('resolves meetingId → recording ids and keeps captureId as provenance', () => {
    vi.mocked(getRecordingsForMeeting).mockReturnValue([{ id: 'recA' } as never, { id: 'recB' } as never])
    const packed = packSources(JSON.stringify([{ content: 'excerpt', meetingId: 'm1' }, { content: 'img', captureId: 'capX', sourceType: 'image' }]))
    const env = JSON.parse(packed!)
    expect(env.v).toBe(SOURCE_PROVENANCE_V)
    expect(env.sources[0]._prov.recordingIds.sort()).toEqual(['recA', 'recB'])
    expect(env.sources[1]._prov.captureIds).toEqual(['capX'])
  })

  it('returns null for empty / missing sources and stores a bare [] verbatim', () => {
    expect(packSources(undefined)).toBeNull()
    expect(packSources(null)).toBeNull()
    expect(packSources('[]')).toBe('[]')
  })
})

describe('presentSourcesNoRevalidate', () => {
  it('unwraps the envelope and strips internal _prov', () => {
    vi.mocked(getRecordingsForMeeting).mockReturnValue([{ id: 'recA' } as never])
    const packed = packSources(JSON.stringify([{ content: 'excerpt', meetingId: 'm1', subject: 'Sync' }]))!
    const out = JSON.parse(presentSourcesNoRevalidate(packed)!)
    expect(out).toEqual([{ content: 'excerpt', meetingId: 'm1', subject: 'Sync' }])
    expect(out[0]).not.toHaveProperty('_prov')
  })
})

describe('revalidateStoredSources', () => {
  function packWithMeeting(recIds: string[]): string {
    vi.mocked(getRecordingsForMeeting).mockReturnValue(recIds.map((id) => ({ id }) as never))
    return packSources(JSON.stringify([{ content: 'excerpt', meetingId: 'm1', subject: 'Sync' }]))!
  }

  it('keeps a source whose recording is still eligible (unchanged)', () => {
    const stored = packWithMeeting(['recA'])
    vi.mocked(filterEligibleRecordingIds).mockReturnValue(setOf(['recA']))
    const { sources, redactContent } = revalidateStoredSources(stored, 'assistant')
    expect(JSON.parse(sources!)).toEqual([{ content: 'excerpt', meetingId: 'm1', subject: 'Sync' }])
    expect(redactContent).toBe(false)
  })

  it('drops the snippet + redacts the answer when the only source becomes excluded', () => {
    const stored = packWithMeeting(['recA'])
    vi.mocked(filterEligibleRecordingIds).mockReturnValue(setOf([])) // recA no longer eligible
    const { sources, redactContent } = revalidateStoredSources(stored, 'assistant')
    expect(JSON.parse(sources!)).toEqual([])
    expect(redactContent).toBe(true)
  })

  it('keeps the eligible source and drops the excluded one on a mixed message (content NOT redacted)', () => {
    vi.mocked(getRecordingsForMeeting)
      .mockReturnValueOnce([{ id: 'recGood' } as never])
      .mockReturnValueOnce([{ id: 'recBad' } as never])
    const stored = packSources(
      JSON.stringify([
        { content: 'good', meetingId: 'mGood' },
        { content: 'bad', meetingId: 'mBad' }
      ])
    )!
    vi.mocked(filterEligibleRecordingIds).mockReturnValue(setOf(['recGood']))
    const { sources, redactContent } = revalidateStoredSources(stored, 'assistant')
    const kept = JSON.parse(sources!)
    expect(kept).toHaveLength(1)
    expect(kept[0].content).toBe('good')
    expect(redactContent).toBe(false)
  })

  it('drops a capture-backed source when the capture is excluded', () => {
    const stored = packSources(JSON.stringify([{ content: 'img', captureId: 'capX', sourceType: 'image' }]))!
    vi.mocked(filterEligibleCaptureIds).mockReturnValue(setOf([])) // capX excluded
    const { sources, redactContent } = revalidateStoredSources(stored, 'assistant')
    expect(JSON.parse(sources!)).toEqual([])
    expect(redactContent).toBe(true)
  })

  it('keeps a capture-backed source when the capture is eligible', () => {
    const stored = packSources(JSON.stringify([{ content: 'img', captureId: 'capX', sourceType: 'image' }]))!
    vi.mocked(filterEligibleCaptureIds).mockReturnValue(setOf(['capX']))
    const { sources } = revalidateStoredSources(stored, 'assistant')
    expect(JSON.parse(sources!)).toHaveLength(1)
  })

  it('fails closed (drops + redacts) when the recording eligibility lookup fails', () => {
    const stored = packWithMeeting(['recA'])
    vi.mocked(filterEligibleRecordingIds).mockReturnValue(failClosed())
    const { sources, redactContent } = revalidateStoredSources(stored, 'assistant')
    expect(JSON.parse(sources!)).toEqual([])
    expect(redactContent).toBe(true)
  })

  it('conservatively drops snippets of a LEGACY (un-enveloped) message but keeps its text', () => {
    // A pre-round-18 message: a bare JSON array of sources, no provenance envelope.
    const legacy = JSON.stringify([{ content: 'old excerpt', meetingId: 'm1' }])
    const { sources, redactContent } = revalidateStoredSources(legacy, 'assistant')
    expect(JSON.parse(sources!)).toEqual([])
    expect(redactContent).toBe(false) // legacy: snippets redacted, message text kept
  })

  it('leaves a null / empty-sources message untouched', () => {
    expect(revalidateStoredSources(null, 'assistant')).toEqual({ sources: null, redactContent: false })
    expect(revalidateStoredSources('[]', 'assistant')).toEqual({ sources: '[]', redactContent: false })
  })

  it('never redacts a USER message content even if its (unlikely) sources are excluded', () => {
    const stored = packWithMeeting(['recA'])
    vi.mocked(filterEligibleRecordingIds).mockReturnValue(setOf([]))
    const { redactContent } = revalidateStoredSources(stored, 'user')
    expect(redactContent).toBe(false)
  })
})

describe('REDACTED_ANSWER', () => {
  it('is a non-empty placeholder', () => {
    expect(REDACTED_ANSWER.length).toBeGreaterThan(0)
  })
})
