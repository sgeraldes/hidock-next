
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

vi.mock('../ollama', () => ({
  getOllamaService: vi.fn(() => ({
    isAvailable: vi.fn().mockResolvedValue(true),
    generate: vi.fn().mockResolvedValue('Generated Content')
  }))
}))

describe('OutputGeneratorService', () => {
  beforeEach(() => {
    vi.clearAllMocks()
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
})
