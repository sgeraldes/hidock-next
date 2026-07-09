/**
 * @vitest-environment node
 */

import { describe, it, expect } from 'vitest'
import {
  scoreMeetingCandidates,
  deriveTranscriptTitle,
  deriveTranscriptSummary,
  countTranscriptSpeakers,
  buildContentText,
  type MatchCandidateInput
} from '../recording-match-scoring'

// The reported failure: recording 2:07–2:37 PM, transcript-derived title
// "Cierre de Proyecto y Acciones de Retrospectiva". None of the meetings overlap.
const REC46 = {
  dateRecorded: '2026-07-08T14:07:19-05:00',
  durationSeconds: 30 * 60,
  contentText: 'Cierre de Proyecto y Acciones de Retrospectiva'
}

const REC46_CANDIDATES: MatchCandidateInput[] = [
  { meetingId: 'almuerzo', subject: 'Almuerzo', startTime: '2026-07-08T13:00:00-05:00', endTime: '2026-07-08T14:00:00-05:00' },
  { meetingId: 'cx', subject: 'CX-Weekly', startTime: '2026-07-08T13:00:00-05:00', endTime: '2026-07-08T14:00:00-05:00' },
  { meetingId: 'retro', subject: 'Retro Belcorp', startTime: '2026-07-08T15:00:00-05:00', endTime: '2026-07-08T15:30:00-05:00' },
  { meetingId: 'dfx5', subject: 'DFX5 AM3', startTime: '2026-07-08T15:00:00-05:00', endTime: '2026-07-08T16:00:00-05:00' }
]

describe('scoreMeetingCandidates — Rec46 reported case', () => {
  const scored = scoreMeetingCandidates(REC46, REC46_CANDIDATES)
  const byId = Object.fromEntries(scored.map((s) => [s.meetingId, s]))

  it('surfaces the content-matching Retro Belcorp as the clear best match', () => {
    expect(scored[0].meetingId).toBe('retro')
    expect(byId.retro.isBestMatch).toBe(true)
    // Every other candidate is not flagged.
    for (const id of ['almuerzo', 'cx', 'dfx5']) {
      expect(byId[id].isBestMatch).toBe(false)
    }
  })

  it('gives Retro a visibly higher score than the closer-in-time lunch/CX', () => {
    expect(byId.retro.confidenceScore).toBeGreaterThan(byId.almuerzo.confidenceScore)
    expect(byId.retro.confidenceScore - byId.almuerzo.confidenceScore).toBeGreaterThanOrEqual(0.2)
  })

  it('labels the content match with the shared token', () => {
    expect(byId.retro.matchReason).toContain('"retro"')
    expect(byId.retro.matchReason.toLowerCase()).toContain('title mentions')
  })

  it('does not read as a time overlap for any zero-overlap candidate', () => {
    for (const s of scored) {
      expect(s.hasOverlap).toBe(false)
      expect(s.matchReason).not.toMatch(/overlaps/i)
    }
  })

  it('scores differ across candidates when evidence differs (no flat field)', () => {
    const uniqueScores = new Set(scored.map((s) => s.confidenceScore))
    expect(uniqueScores.size).toBeGreaterThan(1)
  })

  it('describes proximity for the near-miss candidates', () => {
    // Lunch/CX end 7 min before the recording starts.
    expect(byId.almuerzo.matchReason).toContain('7 min')
    // Retro starts 23 min after the recording ends.
    expect(byId.retro.matchReason).toContain('23 min')
  })
})

describe('scoreMeetingCandidates — overlap scoring', () => {
  const rec = { dateRecorded: '2026-07-08T14:00:00Z', durationSeconds: 30 * 60, contentText: null }

  it('scores a full overlap near the top and above any non-overlap', () => {
    const scored = scoreMeetingCandidates(rec, [
      { meetingId: 'full', subject: 'A', startTime: '2026-07-08T14:00:00Z', endTime: '2026-07-08T14:30:00Z' },
      { meetingId: 'near', subject: 'B', startTime: '2026-07-08T14:40:00Z', endTime: '2026-07-08T15:00:00Z' }
    ])
    const full = scored.find((s) => s.meetingId === 'full')!
    const near = scored.find((s) => s.meetingId === 'near')!
    expect(full.hasOverlap).toBe(true)
    expect(full.matchReason).toMatch(/entire recording/i)
    expect(full.confidenceScore).toBeGreaterThan(0.9)
    // Overlapping always sorts first and scores above a non-overlap.
    expect(scored[0].meetingId).toBe('full')
    expect(full.confidenceScore).toBeGreaterThan(near.confidenceScore)
  })

  it('reports the overlap fraction for a partial overlap', () => {
    const scored = scoreMeetingCandidates(rec, [
      // Meeting 14:00–14:15 overlaps the first 15 of the 30-min recording (~50%).
      { meetingId: 'half', subject: 'A', startTime: '2026-07-08T14:00:00Z', endTime: '2026-07-08T14:15:00Z' }
    ])
    expect(scored[0].hasOverlap).toBe(true)
    expect(scored[0].matchReason).toMatch(/Overlaps 50% of the recording/)
  })

  it('sorts every overlapping candidate above every non-overlapping one', () => {
    const scored = scoreMeetingCandidates(rec, [
      { meetingId: 'nearContent', subject: 'Retrospectiva', startTime: '2026-07-08T14:35:00Z', endTime: '2026-07-08T15:00:00Z' },
      { meetingId: 'overlap', subject: 'Zzz', startTime: '2026-07-08T14:05:00Z', endTime: '2026-07-08T14:10:00Z' }
    ])
    // Even though nearContent could match content, the overlap wins the top slot.
    expect(scored[0].meetingId).toBe('overlap')
  })
})

describe('scoreMeetingCandidates — labels & edges', () => {
  it('labels far same-day meetings as "Same day · no overlap" with a low score', () => {
    const rec = { dateRecorded: '2026-07-08T09:00:00Z', durationSeconds: 10 * 60, contentText: null }
    const scored = scoreMeetingCandidates(rec, [
      { meetingId: 'far', subject: 'Evening review', startTime: '2026-07-08T18:00:00Z', endTime: '2026-07-08T19:00:00Z' }
    ])
    expect(scored[0].hasOverlap).toBe(false)
    expect(scored[0].matchReason).toContain('Same day · no overlap')
    expect(scored[0].confidenceScore).toBeLessThanOrEqual(0.1)
  })

  it('handles a missing duration by treating the recording as a point in time', () => {
    const rec = { dateRecorded: '2026-07-08T14:10:00Z', durationSeconds: null, contentText: null }
    const scored = scoreMeetingCandidates(rec, [
      { meetingId: 'during', subject: 'A', startTime: '2026-07-08T14:00:00Z', endTime: '2026-07-08T14:30:00Z' }
    ])
    expect(scored[0].hasOverlap).toBe(true)
    expect(scored[0].matchReason).toMatch(/started during this meeting/i)
  })

  it('normalizes accents and case for the content match', () => {
    const rec = { dateRecorded: '2026-07-08T14:00:00Z', durationSeconds: 600, contentText: 'RETROSPECTIVA del equipo' }
    const scored = scoreMeetingCandidates(rec, [
      { meetingId: 'm', subject: 'Retrospectíva', startTime: '2026-07-08T20:00:00Z', endTime: '2026-07-08T21:00:00Z' }
    ])
    expect(scored[0].matchReason).toContain('Title mentions')
  })

  it('does not flag a best match when the field is a tie', () => {
    const rec = { dateRecorded: '2026-07-08T14:00:00Z', durationSeconds: 600, contentText: null }
    const scored = scoreMeetingCandidates(rec, [
      { meetingId: 'a', subject: 'A', startTime: '2026-07-08T14:05:00Z', endTime: '2026-07-08T14:20:00Z' },
      { meetingId: 'b', subject: 'B', startTime: '2026-07-08T14:05:00Z', endTime: '2026-07-08T14:20:00Z' }
    ])
    expect(scored.every((s) => !s.isBestMatch)).toBe(true)
  })

  it('returns an empty array for no candidates', () => {
    expect(scoreMeetingCandidates(REC46, [])).toEqual([])
  })
})

describe('transcript context helpers', () => {
  it('derives the headline title from title_suggestion first', () => {
    expect(deriveTranscriptTitle({ title_suggestion: 'Cierre de Proyecto', summary: 'x' })).toBe('Cierre de Proyecto')
  })

  it('falls back to the first sentence of the summary', () => {
    expect(deriveTranscriptTitle({ summary: 'Primera frase. Segunda frase.' })).toBe('Primera frase.')
  })

  it('returns null with no transcript', () => {
    expect(deriveTranscriptTitle(null)).toBeNull()
    expect(deriveTranscriptSummary(undefined)).toBeNull()
  })

  it('counts distinct speakers from the speaker-turn JSON', () => {
    const speakers = JSON.stringify([
      { speaker: 'Speaker 1', text: 'a' },
      { speaker: 'Speaker 2', text: 'b' },
      { speaker: 'Speaker 1', text: 'c' }
    ])
    expect(countTranscriptSpeakers({ speakers })).toBe(2)
  })

  it('returns null speaker count for unparseable / empty speakers', () => {
    expect(countTranscriptSpeakers({ speakers: 'not json' })).toBeNull()
    expect(countTranscriptSpeakers({ speakers: '[]' })).toBeNull()
    expect(countTranscriptSpeakers({})).toBeNull()
  })

  it('builds content text from title + topics (JSON array or plain)', () => {
    expect(buildContentText({ title_suggestion: 'Retro', topics: JSON.stringify(['belcorp', 'acciones']) }))
      .toBe('Retro belcorp acciones')
    expect(buildContentText({ topics: 'planning, roadmap' })).toBe('planning, roadmap')
    expect(buildContentText({})).toBeNull()
  })
})
