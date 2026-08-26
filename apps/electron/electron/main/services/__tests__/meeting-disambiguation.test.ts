// @vitest-environment node

/**
 * meeting-disambiguation (2026-07-24) — the LLM pick for MULTIPLE overlapping
 * meeting candidates. Guards the owner contract:
 *   - a single overlap NEVER triggers an LLM call (time match is the answer);
 *   - the pick parses strictly (a number in range, else deterministic order);
 *   - every failure mode (no transcript text, brain null, garbage answer,
 *     out-of-range answer, brain throw) falls back to deterministic order.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

const generateText = vi.fn()
vi.mock('../chat-llm', () => ({
  getChatLLMService: () => ({ generateText })
}))
vi.mock('../recording-eligibility', () => ({
  isRecordingEligible: vi.fn(() => true)
}))

import {
  buildDisambiguationPrompt,
  parseDisambiguationAnswer,
  disambiguateOverlappingCandidates
} from '../meeting-disambiguation'

const CANDIDATES = [
  { meetingId: 'm1', subject: 'Sync interna TSC', startTime: '2026-07-23T22:00:00.000Z', endTime: '2026-07-23T22:30:00.000Z' },
  { meetingId: 'm2', subject: 'Delivery Technical Weekly', startTime: '2026-07-23T14:00:00.000Z', endTime: '2026-07-23T15:00:00.000Z' },
  { meetingId: 'm3', subject: 'Weekly Interna BHD', startTime: '2026-07-23T23:00:00.000Z', endTime: '2026-07-23T23:30:00.000Z' }
]
const CONTEXT = { title: 'Planificación y Justificación de Desvíos TCC', summary: 'El equipo revisó desvíos del módulo de rentabilidad para TCC.', dateLabel: 'Jul 23, 2026, 7:08 PM' }

beforeEach(() => {
  vi.clearAllMocks()
})

describe('buildDisambiguationPrompt', () => {
  it('includes the transcript context and numbered candidates with times', () => {
    const prompt = buildDisambiguationPrompt(CONTEXT, CANDIDATES)
    expect(prompt).toContain('Planificación y Justificación de Desvíos TCC')
    expect(prompt).toContain('rentabilidad para TCC')
    expect(prompt).toContain('1. "Sync interna TSC"')
    expect(prompt).toContain('3. "Weekly Interna BHD"')
    expect(prompt).toContain('ONLY the meeting number')
  })
})

describe('parseDisambiguationAnswer', () => {
  it('parses a bare number in range', () => {
    expect(parseDisambiguationAnswer('2', 3)).toBe(1)
    expect(parseDisambiguationAnswer('1.', 3)).toBe(0)
  })
  it('rejects 0 (no match) and out-of-range / garbage', () => {
    expect(parseDisambiguationAnswer('0', 3)).toBeNull()
    expect(parseDisambiguationAnswer('4', 3)).toBeNull()
    expect(parseDisambiguationAnswer('the second one', 3)).toBeNull()
    expect(parseDisambiguationAnswer('', 3)).toBeNull()
  })
})

describe('disambiguateOverlappingCandidates', () => {
  it('returns the picked meeting with a reason', async () => {
    generateText.mockResolvedValue('2')
    const res = await disambiguateOverlappingCandidates('rec-1', CONTEXT, CANDIDATES)
    expect(res).toEqual({ meetingId: 'm2', reason: 'AI match: "Delivery Technical Weekly"' })
  })

  it('NEVER calls the brain for a single overlap', async () => {
    const res = await disambiguateOverlappingCandidates('rec-1', CONTEXT, [CANDIDATES[0]])
    expect(res).toBeNull()
    expect(generateText).not.toHaveBeenCalled()
  })

  it('never calls the brain without transcript text', async () => {
    const res = await disambiguateOverlappingCandidates('rec-1', { title: null, summary: null, dateLabel: 'x' }, CANDIDATES)
    expect(res).toBeNull()
    expect(generateText).not.toHaveBeenCalled()
  })

  it('falls back to null on a null brain answer', async () => {
    generateText.mockResolvedValue(null)
    expect(await disambiguateOverlappingCandidates('rec-1', CONTEXT, CANDIDATES)).toBeNull()
  })

  it('falls back to null on a garbage answer', async () => {
    generateText.mockResolvedValue('I think it could be the second meeting')
    expect(await disambiguateOverlappingCandidates('rec-1', CONTEXT, CANDIDATES)).toBeNull()
  })

  it('falls back to null when the brain throws', async () => {
    generateText.mockRejectedValue(new Error('provider down'))
    expect(await disambiguateOverlappingCandidates('rec-1', CONTEXT, CANDIDATES)).toBeNull()
  })
})
