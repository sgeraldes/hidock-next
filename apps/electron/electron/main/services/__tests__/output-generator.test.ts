
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { getOutputGeneratorService } from '../output-generator'
import * as db from '../database'

// RE6-2 — mutable exclusion result so a test can flip a recording to excluded /
// force fail-closed. Default: all eligible.
let excludedRecordingResult: { ids: Set<string>; failClosed: boolean } = { ids: new Set<string>(), failClosed: false }

// Mock dependencies
vi.mock('../database', () => ({
  getMeetingById: vi.fn(),
  getRecordingsForMeeting: vi.fn(),
  getTranscriptByRecordingId: vi.fn(),
  getMeetingsForProject: vi.fn(),
  getMeetingsForContact: vi.fn(),
  getProjectById: vi.fn(),
  getContactById: vi.fn(),
  getSpeakerMap: vi.fn(() => []),
  queryOne: vi.fn(),
  // RE6-2 (round-6) — output generation routes every resolved recording id
  // through the shared eligibility boundary; default: all eligible.
  getExcludedRecordingIds: () => excludedRecordingResult,
  // ADV9 (round-9) — the boundary now uses the POSITIVE allowlist; derive it
  // from the same excluded source (existing recordings minus excluded).
  getEligibleRecordingIds: (ids: Iterable<string>) =>
    excludedRecordingResult.failClosed
      ? { eligible: new Set<string>(), failClosed: true }
      : { eligible: new Set([...ids].filter((i) => i && !excludedRecordingResult.ids.has(i))), failClosed: false }
}))

// Stable Ollama spies so tests can assert whether the local fallback was invoked.
const { mockOllamaIsAvailable, mockOllamaGenerate } = vi.hoisted(() => ({
  mockOllamaIsAvailable: vi.fn(async () => true),
  mockOllamaGenerate: vi.fn(async () => 'Generated Content')
}))
vi.mock('../ollama', () => ({
  getOllamaService: () => ({
    isAvailable: mockOllamaIsAvailable,
    generate: mockOllamaGenerate
  })
}))

// Gemini SDK mock (used only when a key is configured).
const { mockGenerateContent } = vi.hoisted(() => ({ mockGenerateContent: vi.fn() }))
const mockGetGenerativeModel = vi.fn(() => ({ generateContent: mockGenerateContent }))
vi.mock('@google/generative-ai', () => ({
  GoogleGenerativeAI: vi.fn(function () {
    return { getGenerativeModel: mockGetGenerativeModel }
  })
}))

// Mutable config: default has NO Gemini key → generator falls back to Ollama.
const mockConfig = {
  transcription: { geminiApiKey: '' as string, geminiModel: 'gemini-3.5-flash' },
  chat: { geminiModel: 'gemini-3.5-flash' }
}
vi.mock('../config', () => ({
  getConfig: vi.fn(() => mockConfig)
}))

describe('OutputGeneratorService', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    excludedRecordingResult = { ids: new Set<string>(), failClosed: false }
    mockConfig.transcription.geminiApiKey = ''
    mockOllamaIsAvailable.mockResolvedValue(true)
    mockOllamaGenerate.mockResolvedValue('Generated Content')
    mockGenerateContent.mockResolvedValue({ response: { text: () => 'Gemini Content' } })
  })

  it('should generate output for a knowledge capture', async () => {
    const generator = getOutputGeneratorService()

    vi.mocked(db.queryOne).mockReturnValue({
      id: 'kc-1',
      title: 'Knowledge Capture 1',
      source_recording_id: 'rec-1',
      captured_at: new Date().toISOString()
    })

    vi.mocked(db.getTranscriptByRecordingId).mockReturnValue({
      id: 'trans-1',
      recording_id: 'rec-1',
      full_text: 'Full transcript text',
      language: 'en',
      created_at: new Date().toISOString()
    } as any)

    const result = await generator.generate({
      templateId: 'meeting_minutes',
      knowledgeCaptureId: 'kc-1'
    })

    expect(result.content).toBe('Generated Content')
    expect(db.queryOne).toHaveBeenCalledWith(expect.stringContaining('knowledge_captures'), ['kc-1'])
  })

  // 2026-07-24 — the output header must carry FACTS, not LLM guesses: the linked
  // meeting's subject/date, the attendee roster (calendar invite or speaker-map
  // names), and the speaker map so labels render as names.
  it('injects meeting date, attendee roster, and speaker map into the prompt (no "Not specified", no invented names)', async () => {
    const generator = getOutputGeneratorService()

    vi.mocked(db.queryOne).mockImplementation((sql: string) => {
      if (sql.includes('knowledge_captures')) {
        return { id: 'kc-1', title: 'Itau POC', source_recording_id: 'rec-1', captured_at: '2026-07-24' }
      }
      if (sql.includes('recordings')) {
        return { id: 'rec-1', filename: 'Rec40.wav', date_recorded: '2026-07-24T04:01:58.000Z', meeting_id: 'm-1' }
      }
      return undefined
    })
    vi.mocked(db.getMeetingById).mockReturnValue({
      id: 'm-1',
      subject: 'Itau Real State Tech POC',
      start_time: '2026-07-24T04:00:00.000Z',
      end_time: '2026-07-24T05:00:00.000Z',
      is_recurring: 0,
      created_at: '',
      updated_at: ''
    } as any)
    vi.mocked(db.getTranscriptByRecordingId).mockReturnValue({
      id: 'trans-1',
      recording_id: 'rec-1',
      full_text: 'Speaker 1: let us ship the POC.',
      language: 'en',
      created_at: ''
    } as any)
    vi.mocked(db.getSpeakerMap).mockReturnValue([
      { speaker_label: 'Speaker 1', contact_id: 'c1', name: 'Lucas' },
      { speaker_label: 'Speaker 2', contact_id: 'c2', name: 'Shardul' }
    ])

    await generator.generate({ templateId: 'meeting_minutes', knowledgeCaptureId: 'kc-1' })

    const prompt = (mockOllamaGenerate.mock.calls[0] as unknown[])[0] as string
    expect(prompt).toContain('Itau Real State Tech POC')
    expect(prompt).toContain('Jul 24, 2026') // the meeting's real date
    expect(prompt).toContain('Lucas, Shardul') // roster from the speaker map (no calendar invite)
    expect(prompt).toContain('Speaker 1 = Lucas') // the label→name map
    expect(prompt).not.toContain('Not specified')
  })

  it('prefers the calendar invite list over speaker names when present', async () => {
    const generator = getOutputGeneratorService()

    vi.mocked(db.queryOne).mockImplementation((sql: string) => {
      if (sql.includes('knowledge_captures')) {
        return { id: 'kc-1', title: 'X', source_recording_id: 'rec-1', captured_at: '2026-07-24' }
      }
      if (sql.includes('recordings')) {
        return { id: 'rec-1', filename: 'Rec40.wav', date_recorded: '2026-07-24T04:01:58.000Z', meeting_id: 'm-1' }
      }
      return undefined
    })
    vi.mocked(db.getMeetingById).mockReturnValue({
      id: 'm-1',
      subject: 'Itau POC',
      start_time: '2026-07-24T04:00:00.000Z',
      end_time: '2026-07-24T05:00:00.000Z',
      attendees: '[{"name":"Lucas Silva"},"Eduardo Prado"]',
      is_recurring: 0,
      created_at: '',
      updated_at: ''
    } as any)
    vi.mocked(db.getTranscriptByRecordingId).mockReturnValue({
      id: 't', recording_id: 'rec-1', full_text: 'text', language: 'en', created_at: ''
    } as any)
    vi.mocked(db.getSpeakerMap).mockReturnValue([{ speaker_label: 'Speaker 1', contact_id: 'c1', name: 'Wrongname' }])

    await generator.generate({ templateId: 'meeting_minutes', knowledgeCaptureId: 'kc-1' })

    const prompt = (mockOllamaGenerate.mock.calls[0] as unknown[])[0] as string
    expect(prompt).toContain('Lucas Silva, Eduardo Prado')
    expect(prompt).not.toContain('Wrongname,')
  })

  // A Gemini API error must propagate to the caller — the output generator does
  // NOT silently fall back to Ollama (that would produce a document from a
  // different model than the user configured). Regression guard for the seam.
  it('propagates a Gemini API error WITHOUT falling back to Ollama', async () => {
    mockConfig.transcription.geminiApiKey = 'sk-key' // pragma: allowlist secret
    mockGenerateContent.mockRejectedValue(new Error('Gemini 500'))

    const generator = getOutputGeneratorService()
    vi.mocked(db.queryOne).mockReturnValue({
      id: 'kc-1',
      title: 'Knowledge Capture 1',
      source_recording_id: 'rec-1',
      captured_at: new Date().toISOString()
    })
    vi.mocked(db.getTranscriptByRecordingId).mockReturnValue({
      id: 'trans-1',
      recording_id: 'rec-1',
      full_text: 'Full transcript text',
      language: 'en',
      created_at: new Date().toISOString()
    } as any)

    await expect(
      generator.generate({ templateId: 'meeting_minutes', knowledgeCaptureId: 'kc-1' })
    ).rejects.toThrow(/Gemini 500/)
    expect(mockOllamaGenerate).not.toHaveBeenCalled()
  })

  // RE6-2 (round-6) — every resolved recording id is routed through the shared
  // eligibility boundary immediately before prompt construction.
  describe('RE6-2 — recording eligibility boundary', () => {
    function stubCapture(): void {
      vi.mocked(db.queryOne).mockReturnValue({
        id: 'kc-1',
        title: 'Knowledge Capture 1',
        source_recording_id: 'rec-1',
        captured_at: new Date().toISOString()
      })
      vi.mocked(db.getTranscriptByRecordingId).mockReturnValue({
        id: 'trans-1',
        recording_id: 'rec-1',
        full_text: 'Full transcript text',
        language: 'en',
        created_at: new Date().toISOString()
      } as any)
    }

    it('refuses when the pinned/context recording is excluded (personal/trashed/value-excluded)', async () => {
      stubCapture()
      excludedRecordingResult = { ids: new Set(['rec-1']), failClosed: false }
      const generator = getOutputGeneratorService()
      await expect(
        generator.generate({ templateId: 'meeting_minutes', knowledgeCaptureId: 'kc-1' })
      ).rejects.toThrow(/No transcripts available/)
    })

    it('fails closed (refuses) when eligibility cannot be established', async () => {
      stubCapture()
      excludedRecordingResult = { ids: new Set<string>(), failClosed: true }
      const generator = getOutputGeneratorService()
      await expect(
        generator.generate({ templateId: 'meeting_minutes', knowledgeCaptureId: 'kc-1' })
      ).rejects.toThrow(/refused \(fail closed\)/)
    })

    it('generates normally for an eligible recording (control)', async () => {
      stubCapture()
      excludedRecordingResult = { ids: new Set<string>(), failClosed: false }
      const generator = getOutputGeneratorService()
      const result = await generator.generate({ templateId: 'meeting_minutes', knowledgeCaptureId: 'kc-1' })
      expect(result.content).toBe('Generated Content')
    })

    // ADV41-4 (round-43) — the transcript eligibility check runs BEFORE the
    // awaited BrainRouter.resolve (provider auth/availability). An owner deletion
    // / personal / value-exclusion committing during that gap must be caught by a
    // recheck immediately before brain.generate — the already-built prompt embeds
    // the transcript, so partial dropping is impossible: refuse instead.
    it('flips eligibility DURING brain resolution ⇒ brain.generate is NOT called (fail closed)', async () => {
      stubCapture()
      excludedRecordingResult = { ids: new Set<string>(), failClosed: false } // eligible at first check
      // BrainRouter.resolve probes Ollama availability; use that await to commit
      // the exclusion, exactly modelling a deletion landing during resolution.
      mockOllamaIsAvailable.mockImplementation(async () => {
        excludedRecordingResult = { ids: new Set(['rec-1']), failClosed: false }
        return true
      })
      const generator = getOutputGeneratorService()
      await expect(
        generator.generate({ templateId: 'meeting_minutes', knowledgeCaptureId: 'kc-1' })
      ).rejects.toThrow(/eligibility changed during provider resolution/)
      expect(mockOllamaGenerate).not.toHaveBeenCalled()
    })
  })
})
