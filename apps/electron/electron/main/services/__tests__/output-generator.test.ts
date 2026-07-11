
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { getOutputGeneratorService } from '../output-generator'
import * as db from '../database'

// Mock dependencies
vi.mock('../database', () => ({
  getMeetingById: vi.fn(),
  getRecordingsForMeeting: vi.fn(),
  getTranscriptByRecordingId: vi.fn(),
  getMeetingsForProject: vi.fn(),
  getMeetingsForContact: vi.fn(),
  getProjectById: vi.fn(),
  getContactById: vi.fn(),
  queryOne: vi.fn()
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
})
