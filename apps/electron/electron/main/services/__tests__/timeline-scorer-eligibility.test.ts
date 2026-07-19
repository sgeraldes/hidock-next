// @vitest-environment node

/**
 * ADV43-3 (round-45) — the production sentiment scorer (geminiWindowScorer)
 * awaits a DYNAMIC config import BEFORE its generateContent call. An owner
 * exclusion committed during that setup await must abort the provider call. The
 * scorer receives a fail-closed shouldGenerate gate, re-checks it SYNCHRONOUSLY
 * after the awaited setup and immediately before generateContent, and returns an
 * empty score map (sentiment omitted, NO provider call) on false/throw.
 *
 * deriveSentimentSegments must FORWARD the gate to whichever scorer it uses.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockGenerateContent = vi.fn(async () => ({
  response: { text: () => '[{"i":0,"score":0.5}]' },
}))
const mockGetGenerativeModel = vi.fn(() => ({ generateContent: mockGenerateContent }))
vi.mock('@google/generative-ai', () => ({
  GoogleGenerativeAI: vi.fn(function () {
    return { getGenerativeModel: mockGetGenerativeModel }
  }),
}))
// geminiWindowScorer resolves getConfig via a DYNAMIC import — mocking the module
// makes that dynamic import resolve to this fake (with a key configured).
vi.mock('../config', () => ({
  getConfig: () => ({ transcription: { geminiApiKey: 'k', geminiModel: 'gemini-3.5-flash' } }),
}))

import { geminiWindowScorer, deriveSentimentSegments, type SentimentWindow } from '../timeline-analysis'

const WINDOWS: SentimentWindow[] = [
  { index: 0, startSec: 0, endSec: 30, text: 'hola qué tal' },
  { index: 1, startSec: 30, endSec: 60, text: 'todo bien' },
]

describe('geminiWindowScorer shouldGenerate gate (round-45 ADV43-3)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('exclusion during the setup await (gate false) ⇒ generateContent NOT called, empty scores', async () => {
    const scores = await geminiWindowScorer(WINDOWS, () => false)
    expect(mockGenerateContent).not.toHaveBeenCalled()
    expect(scores.size).toBe(0)
  })

  it('a gate that THROWS is fail-closed ⇒ generateContent NOT called', async () => {
    const scores = await geminiWindowScorer(WINDOWS, () => {
      throw new Error('eligibility lookup failed')
    })
    expect(mockGenerateContent).not.toHaveBeenCalled()
    expect(scores.size).toBe(0)
  })

  it('control: a gate that stays true calls generateContent and returns scores', async () => {
    const scores = await geminiWindowScorer(WINDOWS, () => true)
    expect(mockGenerateContent).toHaveBeenCalledTimes(1)
    expect(scores.get(0)).toBe(0.5)
  })

  it('no gate configured ⇒ unchanged legacy behaviour (provider called)', async () => {
    const scores = await geminiWindowScorer(WINDOWS)
    expect(mockGenerateContent).toHaveBeenCalledTimes(1)
    expect(scores.get(0)).toBe(0.5)
  })
})

describe('deriveSentimentSegments forwards shouldGenerate to the scorer (round-45 ADV43-3)', () => {
  it('passes the gate through as the scorer’s second argument', async () => {
    const gate = () => true
    let received: (() => boolean) | undefined
    const spyScorer = vi.fn(async (_windows: SentimentWindow[], shouldGenerate?: () => boolean) => {
      received = shouldGenerate
      return new Map<number, number>()
    })
    await deriveSentimentSegments(
      [{ speaker: 'Speaker 1', start: 0, end: 30, text: 'hola a todos, empecemos la reunión de hoy' }],
      { scoreWindows: spyScorer, shouldGenerate: gate }
    )
    expect(spyScorer).toHaveBeenCalledTimes(1)
    expect(received).toBe(gate)
  })
})
