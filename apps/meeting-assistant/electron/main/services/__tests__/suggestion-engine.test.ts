import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { SuggestionEngine } from '../suggestion-engine'
import type { Suggestion } from '../suggestion-engine'

// ─── Mocks ───────────────────────────────────────────────────────────────────

vi.mock('ai', () => ({
  generateText: vi.fn(async () => ({
    text: '- Point one\n- Point two\n- Point three',
  })),
}))

// ─── Helpers ─────────────────────────────────────────────────────────────────

import { generateText } from 'ai'
const mockGenerateText = vi.mocked(generateText)

/** Minimal model stub */
function makeModel() {
  return { modelId: 'test-model', provider: 'test' } as unknown as import('ai').LanguageModel
}

type TranscriptSegment = { speaker: string | null; text: string; start_time: number }
type ScreenshotEntry = { analysis: string | null }
type MeetingInfo = { title?: string; attendees?: string; agenda?: string } | null

type Accessors = {
  getRecentTranscript: (sessionId: string, limit: number) => TranscriptSegment[]
  getScreenshots: (sessionId: string) => ScreenshotEntry[]
  getMeetingInfo: () => MeetingInfo
}

function makeAccessors(overrides: Partial<{
  segments: TranscriptSegment[]
  screenshots: ScreenshotEntry[]
  meetingInfo: MeetingInfo
}> = {}): Accessors {
  const segments = overrides.segments ?? [
    { speaker: 'Alice', text: 'Hello everyone.', start_time: 1000 },
    { speaker: 'Bob', text: 'Thanks for joining.', start_time: 2000 },
  ]
  return {
    getRecentTranscript: vi.fn<(sessionId: string, limit: number) => TranscriptSegment[]>().mockImplementation(() => segments),
    getScreenshots: vi.fn<(sessionId: string) => ScreenshotEntry[]>().mockImplementation(() => overrides.screenshots ?? []),
    getMeetingInfo: vi.fn<() => MeetingInfo>().mockImplementation(() => overrides.meetingInfo ?? null),
  }
}

/** Helper: advance fake timers by ms, then flush microtasks */
async function advanceAndFlush(ms: number): Promise<void> {
  vi.advanceTimersByTime(ms)
  // Drain the microtask queue by awaiting a resolved promise several times
  for (let i = 0; i < 10; i++) {
    await Promise.resolve()
  }
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('SuggestionEngine', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  // ── 1. Constructor defaults ──────────────────────────────────────────────
  describe('constructor defaults', () => {
    it('uses default options when none provided', () => {
      const engine = new SuggestionEngine()
      expect(engine).toBeInstanceOf(SuggestionEngine)
    })

    it('accepts custom options', () => {
      const engine = new SuggestionEngine({
        triggerIntervalMs: 5000,
        maxSuggestions: 5,
        contextWindowSeconds: 60,
      })
      expect(engine).toBeInstanceOf(SuggestionEngine)
    })

    it('does not fire at 89s with default 90s interval', async () => {
      const engine = new SuggestionEngine()
      const model = makeModel() as Parameters<typeof engine.setModel>[0]
      engine.setModel(model)
      const accessors = makeAccessors()
      engine.setDataAccessors(accessors)
      engine.start('session-1')

      await advanceAndFlush(89_000)
      expect(mockGenerateText).not.toHaveBeenCalled()
      engine.stop()
    })
  })

  // ── 2. start() ───────────────────────────────────────────────────────────
  describe('start()', () => {
    it('emits started event with sessionId', () => {
      const engine = new SuggestionEngine()
      const events: unknown[] = []
      engine.on('started', (e) => events.push(e))
      engine.start('sess-abc')
      expect(events).toEqual(['sess-abc'])
    })

    it('sets up interval that fires trigger at configured interval', async () => {
      const engine = new SuggestionEngine({ triggerIntervalMs: 1000 })
      const accessors = makeAccessors()
      engine.setModel(makeModel() as Parameters<typeof engine.setModel>[0])
      engine.setDataAccessors(accessors)
      engine.start('sess-1')

      await advanceAndFlush(1000)

      expect(accessors.getRecentTranscript).toHaveBeenCalled()
      engine.stop()
    })

    it('clears suggestions and dismissedTexts on each start', async () => {
      const engine = new SuggestionEngine({ triggerIntervalMs: 1000 })
      const model = makeModel() as Parameters<typeof engine.setModel>[0]
      engine.setModel(model)
      engine.setDataAccessors(makeAccessors())
      engine.start('sess-1')

      await advanceAndFlush(1000)

      const suggestions = engine.getActiveSuggestions()
      if (suggestions.length > 0) {
        engine.dismiss(suggestions[0].id)
      }

      engine.stop()

      // Restart: dismissed suggestions should be cleared
      engine.setDataAccessors(makeAccessors({ segments: [{ speaker: 'Alice', text: 'Hello.', start_time: 5000 }] }))
      engine.start('sess-2')
      expect(engine.getActiveSuggestions()).toHaveLength(0)
      engine.stop()
    })
  })

  // ── 3. stop() ────────────────────────────────────────────────────────────
  describe('stop()', () => {
    it('clears the interval and emits stopped', async () => {
      const engine = new SuggestionEngine({ triggerIntervalMs: 1000 })
      const accessors = makeAccessors()
      engine.setModel(makeModel() as Parameters<typeof engine.setModel>[0])
      engine.setDataAccessors(accessors)
      engine.start('sess-1')

      const stoppedEvents: unknown[] = []
      engine.on('stopped', () => stoppedEvents.push(true))
      engine.stop()

      expect(stoppedEvents).toHaveLength(1)

      // Interval should no longer fire after stop
      vi.clearAllMocks()
      await advanceAndFlush(5000)
      expect(accessors.getRecentTranscript).not.toHaveBeenCalled()
    })

    it('is safe to call when not started', () => {
      const engine = new SuggestionEngine()
      expect(() => engine.stop()).not.toThrow()
    })
  })

  // ── 4. dismiss() ─────────────────────────────────────────────────────────
  describe('dismiss()', () => {
    it('marks suggestion as dismissed and emits suggestion-dismissed', async () => {
      const engine = new SuggestionEngine({ triggerIntervalMs: 1000 })
      engine.setModel(makeModel() as Parameters<typeof engine.setModel>[0])
      engine.setDataAccessors(makeAccessors())
      engine.start('sess-1')

      await advanceAndFlush(1000)

      const active = engine.getActiveSuggestions()
      expect(active.length).toBeGreaterThan(0)

      const dismissEvents: string[] = []
      engine.on('suggestion-dismissed', (id: string) => dismissEvents.push(id))

      const targetId = active[0].id
      engine.dismiss(targetId)

      expect(dismissEvents).toEqual([targetId])
      expect(engine.getActiveSuggestions().find((s) => s.id === targetId)).toBeUndefined()
      engine.stop()
    })

    it('does nothing when dismissing unknown id', () => {
      const engine = new SuggestionEngine()
      const events: unknown[] = []
      engine.on('suggestion-dismissed', (e) => events.push(e))
      engine.dismiss('non-existent-id')
      expect(events).toHaveLength(0)
    })
  })

  // ── 5. getActiveSuggestions() ────────────────────────────────────────────
  describe('getActiveSuggestions()', () => {
    it('returns only non-dismissed suggestions', async () => {
      const engine = new SuggestionEngine({ triggerIntervalMs: 1000 })
      engine.setModel(makeModel() as Parameters<typeof engine.setModel>[0])
      engine.setDataAccessors(makeAccessors())
      engine.start('sess-1')

      await advanceAndFlush(1000)

      const allSugs = engine.getActiveSuggestions()
      expect(allSugs.length).toBeGreaterThan(0)

      engine.dismiss(allSugs[0].id)
      const remaining = engine.getActiveSuggestions()
      expect(remaining).toHaveLength(allSugs.length - 1)
      expect(remaining.every((s: Suggestion) => !s.dismissed)).toBe(true)
      engine.stop()
    })

    it('returns empty array before any triggers', () => {
      const engine = new SuggestionEngine()
      expect(engine.getActiveSuggestions()).toEqual([])
    })
  })

  // ── 6. trigger() without model/transcript ───────────────────────────────
  describe('trigger() - early return conditions', () => {
    it('returns early when no model is set', async () => {
      const engine = new SuggestionEngine()
      engine.setDataAccessors(makeAccessors())
      engine.start('sess-1')
      await engine.trigger()
      expect(mockGenerateText).not.toHaveBeenCalled()
      engine.stop()
    })

    it('returns early when no sessionId is set', async () => {
      const engine = new SuggestionEngine()
      engine.setModel(makeModel() as Parameters<typeof engine.setModel>[0])
      engine.setDataAccessors(makeAccessors())
      // Don't call start() — no sessionId
      await engine.trigger()
      expect(mockGenerateText).not.toHaveBeenCalled()
    })

    it('returns early when no getRecentTranscript accessor is set', async () => {
      const engine = new SuggestionEngine()
      engine.setModel(makeModel() as Parameters<typeof engine.setModel>[0])
      engine.start('sess-1')
      await engine.trigger()
      expect(mockGenerateText).not.toHaveBeenCalled()
      engine.stop()
    })

    it('returns early when transcript is empty', async () => {
      const engine = new SuggestionEngine()
      engine.setModel(makeModel() as Parameters<typeof engine.setModel>[0])
      engine.setDataAccessors(makeAccessors({ segments: [] }))
      engine.start('sess-1')
      await engine.trigger()
      expect(mockGenerateText).not.toHaveBeenCalled()
      engine.stop()
    })
  })

  // ── 7. trigger() with everything configured ──────────────────────────────
  describe('trigger() - full flow', () => {
    it('calls generateText with a prompt containing transcript content', async () => {
      const engine = new SuggestionEngine()
      engine.setModel(makeModel() as Parameters<typeof engine.setModel>[0])
      engine.setDataAccessors(makeAccessors({
        meetingInfo: { title: 'Q4 Review', attendees: 'Alice, Bob' },
      }))
      engine.start('sess-1')
      await engine.trigger()

      expect(mockGenerateText).toHaveBeenCalledOnce()
      const callArg = mockGenerateText.mock.calls[0][0]
      expect(typeof callArg.prompt).toBe('string')
      expect(callArg.prompt).toContain('Alice')
      expect(callArg.prompt).toContain('Q4 Review')
      engine.stop()
    })

    it('parses response lines into suggestions and emits suggestions-updated', async () => {
      const engine = new SuggestionEngine()
      engine.setModel(makeModel() as Parameters<typeof engine.setModel>[0])
      engine.setDataAccessors(makeAccessors())
      engine.start('sess-1')

      const updateEvents: Suggestion[][] = []
      engine.on('suggestions-updated', (s: Suggestion[]) => updateEvents.push(s))

      await engine.trigger()

      expect(updateEvents).toHaveLength(1)
      const suggestions = updateEvents[0]
      expect(suggestions).toHaveLength(3)
      expect(suggestions[0].text).toBe('Point one')
      expect(suggestions[0].dismissed).toBe(false)
      engine.stop()
    })

    it('caps suggestions at maxSuggestions', async () => {
      mockGenerateText.mockResolvedValueOnce({
        text: '- One\n- Two\n- Three\n- Four\n- Five',
      } as Awaited<ReturnType<typeof generateText>>)

      const engine = new SuggestionEngine({ maxSuggestions: 2 })
      engine.setModel(makeModel() as Parameters<typeof engine.setModel>[0])
      engine.setDataAccessors(makeAccessors())
      engine.start('sess-1')
      await engine.trigger()

      expect(engine.getActiveSuggestions()).toHaveLength(2)
      engine.stop()
    })
  })

  // ── 8. trigger() with knowledge base ────────────────────────────────────
  describe('trigger() - knowledge base', () => {
    it('calls knowledgeSearchFn when set', async () => {
      const engine = new SuggestionEngine()
      engine.setModel(makeModel() as Parameters<typeof engine.setModel>[0])
      engine.setDataAccessors(makeAccessors())

      const kbSearch = vi.fn(async () => [{ text: 'KB result text', score: 0.9 }])
      engine.setKnowledgeSearch(kbSearch)
      engine.start('sess-1')
      await engine.trigger()

      expect(kbSearch).toHaveBeenCalled()
      const callArg = mockGenerateText.mock.calls[0][0]
      expect(callArg.prompt).toContain('KB result text')
      engine.stop()
    })

    it('sets suggestion source to knowledge when KB returns results', async () => {
      const engine = new SuggestionEngine()
      engine.setModel(makeModel() as Parameters<typeof engine.setModel>[0])
      engine.setDataAccessors(makeAccessors())
      engine.setKnowledgeSearch(async () => [{ text: 'KB context', score: 0.8 }])
      engine.start('sess-1')

      const updateEvents: Suggestion[][] = []
      engine.on('suggestions-updated', (s: Suggestion[]) => updateEvents.push(s))

      await engine.trigger()

      expect(updateEvents[0].every((s: Suggestion) => s.source === 'knowledge')).toBe(true)
      engine.stop()
    })
  })

  // ── 9. trigger() skips if no new content ─────────────────────────────────
  describe('trigger() - deduplication', () => {
    it('skips second trigger when no new transcript content', async () => {
      const engine = new SuggestionEngine()
      engine.setModel(makeModel() as Parameters<typeof engine.setModel>[0])
      // Fixed start_time so second trigger sees same latestTime
      engine.setDataAccessors(makeAccessors({
        segments: [{ speaker: 'A', text: 'Hello.', start_time: 1000 }],
      }))
      engine.start('sess-1')

      await engine.trigger() // processes lastProcessedTime → 1000
      expect(mockGenerateText).toHaveBeenCalledTimes(1)

      await engine.trigger() // latestTime=1000 == lastProcessedTime → skip
      expect(mockGenerateText).toHaveBeenCalledTimes(1) // still 1
      engine.stop()
    })
  })

  // ── 10. trigger() filters dismissed texts ───────────────────────────────
  describe('trigger() - dismissed text filtering', () => {
    it('includes dismissed topics in prompt to prevent re-suggestion', async () => {
      const engine = new SuggestionEngine()
      engine.setModel(makeModel() as Parameters<typeof engine.setModel>[0])
      engine.setDataAccessors(makeAccessors())
      engine.start('sess-1')

      await engine.trigger()

      const suggestions = engine.getActiveSuggestions()
      const topmostText = suggestions[0].text
      engine.dismiss(suggestions[0].id)

      // Change transcript so latestTime advances
      engine.setDataAccessors(makeAccessors({
        segments: [{ speaker: 'C', text: 'New topic here.', start_time: 99999 }],
      }))
      await engine.trigger()

      const promptArg = mockGenerateText.mock.calls[1][0].prompt as string
      expect(promptArg).toContain(topmostText.toLowerCase().trim())
      engine.stop()
    })
  })

  // ── 11. trigger() error handling ────────────────────────────────────────
  describe('trigger() - error handling', () => {
    it('emits error event when generateText throws', async () => {
      const err = new Error('LLM failed')
      mockGenerateText.mockRejectedValueOnce(err)

      const engine = new SuggestionEngine()
      engine.setModel(makeModel() as Parameters<typeof engine.setModel>[0])
      engine.setDataAccessors(makeAccessors())
      engine.start('sess-1')

      const errorEvents: unknown[] = []
      engine.on('error', (e) => errorEvents.push(e))

      await engine.trigger()
      expect(errorEvents).toEqual([err])
      engine.stop()
    })
  })
})
