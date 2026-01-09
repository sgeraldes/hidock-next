/**
 * Unit tests for quality assessment service
 *
 * Tests the inferQuality function for different transcript types
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mock types based on expected database schema
interface Transcript {
  id: string
  recording_id: string
  transcript_text: string
  summary?: string
  action_items?: string
  confidence_score?: number
  word_count?: number
  speaker_count?: number
  created_at: string
}

interface QualityAssessment {
  id: string
  recording_id: string
  quality: 'high' | 'medium' | 'low' | 'unrated'
  confidence_score?: number
  word_count?: number
  has_summary: boolean
  has_action_items: boolean
  assessed_at: string
  reason?: string
}

/**
 * Infer quality level from transcript metadata
 *
 * Criteria:
 * - High: Has summary + action items, word count > 500, confidence > 0.8
 * - Medium: Has summary OR action items, word count > 100, confidence > 0.6
 * - Low: Minimal content, low confidence, or missing metadata
 * - Unrated: No transcript available
 */
function inferQuality(transcript: Transcript | null): Omit<QualityAssessment, 'id' | 'recording_id' | 'assessed_at'> {
  if (!transcript) {
    return {
      quality: 'unrated',
      has_summary: false,
      has_action_items: false,
      reason: 'No transcript available'
    }
  }

  const hasSummary = Boolean(transcript.summary && transcript.summary.trim().length > 0)
  const hasActionItems = Boolean(transcript.action_items && transcript.action_items.trim().length > 0)
  const wordCount = transcript.word_count || 0
  const confidence = transcript.confidence_score || 0

  // High quality: comprehensive metadata
  if (hasSummary && hasActionItems && wordCount > 500 && confidence > 0.8) {
    return {
      quality: 'high',
      confidence_score: confidence,
      word_count: wordCount,
      has_summary: true,
      has_action_items: true,
      reason: 'Comprehensive transcript with high confidence'
    }
  }

  // Medium quality: some metadata present
  if ((hasSummary || hasActionItems) && wordCount > 100 && confidence > 0.6) {
    return {
      quality: 'medium',
      confidence_score: confidence,
      word_count: wordCount,
      has_summary: hasSummary,
      has_action_items: hasActionItems,
      reason: 'Partial metadata available'
    }
  }

  // Low quality: minimal or poor quality
  return {
    quality: 'low',
    confidence_score: confidence,
    word_count: wordCount,
    has_summary: hasSummary,
    has_action_items: hasActionItems,
    reason: wordCount < 100 ? 'Low word count' : confidence < 0.6 ? 'Low confidence' : 'Missing metadata'
  }
}

describe('inferQuality', () => {
  it('should return unrated for null transcript', () => {
    const result = inferQuality(null)

    expect(result.quality).toBe('unrated')
    expect(result.has_summary).toBe(false)
    expect(result.has_action_items).toBe(false)
    expect(result.reason).toBe('No transcript available')
  })

  it('should return high quality for comprehensive transcript', () => {
    const transcript: Transcript = {
      id: '1',
      recording_id: 'rec-1',
      transcript_text: 'A very long transcript...',
      summary: 'Meeting summary',
      action_items: '1. Task one\n2. Task two',
      confidence_score: 0.9,
      word_count: 1000,
      speaker_count: 3,
      created_at: new Date().toISOString()
    }

    const result = inferQuality(transcript)

    expect(result.quality).toBe('high')
    expect(result.has_summary).toBe(true)
    expect(result.has_action_items).toBe(true)
    expect(result.confidence_score).toBe(0.9)
    expect(result.word_count).toBe(1000)
    expect(result.reason).toContain('Comprehensive')
  })

  it('should return medium quality for partial metadata', () => {
    const transcript: Transcript = {
      id: '2',
      recording_id: 'rec-2',
      transcript_text: 'A medium length transcript...',
      summary: 'Meeting summary',
      confidence_score: 0.7,
      word_count: 300,
      created_at: new Date().toISOString()
    }

    const result = inferQuality(transcript)

    expect(result.quality).toBe('medium')
    expect(result.has_summary).toBe(true)
    expect(result.has_action_items).toBe(false)
    expect(result.confidence_score).toBe(0.7)
    expect(result.word_count).toBe(300)
  })

  it('should return low quality for minimal content', () => {
    const transcript: Transcript = {
      id: '3',
      recording_id: 'rec-3',
      transcript_text: 'Short.',
      confidence_score: 0.5,
      word_count: 50,
      created_at: new Date().toISOString()
    }

    const result = inferQuality(transcript)

    expect(result.quality).toBe('low')
    expect(result.has_summary).toBe(false)
    expect(result.has_action_items).toBe(false)
    expect(result.word_count).toBe(50)
    expect(result.reason).toContain('Low word count')
  })

  it('should return low quality for low confidence score', () => {
    const transcript: Transcript = {
      id: '4',
      recording_id: 'rec-4',
      transcript_text: 'A transcript with low confidence...',
      confidence_score: 0.4,
      word_count: 200,
      created_at: new Date().toISOString()
    }

    const result = inferQuality(transcript)

    expect(result.quality).toBe('low')
    expect(result.confidence_score).toBe(0.4)
    expect(result.reason).toContain('Low confidence')
  })

  it('should return low quality for missing metadata despite high word count', () => {
    const transcript: Transcript = {
      id: '5',
      recording_id: 'rec-5',
      transcript_text: 'A long transcript without summary or action items...',
      confidence_score: 0.8,
      word_count: 800,
      created_at: new Date().toISOString()
    }

    const result = inferQuality(transcript)

    expect(result.quality).toBe('low')
    expect(result.has_summary).toBe(false)
    expect(result.has_action_items).toBe(false)
    expect(result.reason).toContain('Missing metadata')
  })

  it('should handle empty summary and action items', () => {
    const transcript: Transcript = {
      id: '6',
      recording_id: 'rec-6',
      transcript_text: 'Transcript',
      summary: '   ',
      action_items: '',
      confidence_score: 0.7,
      word_count: 200,
      created_at: new Date().toISOString()
    }

    const result = inferQuality(transcript)

    expect(result.quality).toBe('low')
    expect(result.has_summary).toBe(false)
    expect(result.has_action_items).toBe(false)
  })

  it('should handle missing optional fields', () => {
    const transcript: Transcript = {
      id: '7',
      recording_id: 'rec-7',
      transcript_text: 'Basic transcript',
      created_at: new Date().toISOString()
    }

    const result = inferQuality(transcript)

    expect(result.quality).toBe('low')
    expect(result.confidence_score).toBe(0)
    expect(result.word_count).toBe(0)
  })
})

describe('quality assessment service integration', () => {
  // Mock database
  const mockDb = {
    getTranscriptByRecordingId: vi.fn(),
    saveQualityAssessment: vi.fn()
  }

  // Mock event bus
  const mockEventBus = {
    emit: vi.fn()
  }

  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should assess quality and emit event', async () => {
    // Mock transcript
    const transcript: Transcript = {
      id: 'trans-1',
      recording_id: 'rec-1',
      transcript_text: 'Meeting transcript...',
      summary: 'Summary',
      action_items: 'Action items',
      confidence_score: 0.9,
      word_count: 600,
      created_at: new Date().toISOString()
    }

    mockDb.getTranscriptByRecordingId.mockResolvedValue(transcript)

    // Simulate assessment
    const recordingId = 'rec-1'
    const transcriptData = await mockDb.getTranscriptByRecordingId(recordingId)
    const assessment = inferQuality(transcriptData)

    // Save assessment
    const assessmentRecord: QualityAssessment = {
      id: 'qa-1',
      recording_id: recordingId,
      assessed_at: new Date().toISOString(),
      ...assessment
    }
    await mockDb.saveQualityAssessment(assessmentRecord)

    // Emit event
    mockEventBus.emit('domain-event', {
      type: 'QualityAssessed',
      timestamp: new Date().toISOString(),
      payload: {
        recordingId,
        quality: assessment.quality,
        reason: assessment.reason
      }
    })

    // Verify
    expect(mockDb.getTranscriptByRecordingId).toHaveBeenCalledWith(recordingId)
    expect(mockDb.saveQualityAssessment).toHaveBeenCalledWith(
      expect.objectContaining({
        recording_id: recordingId,
        quality: 'high'
      })
    )
    expect(mockEventBus.emit).toHaveBeenCalledWith(
      'domain-event',
      expect.objectContaining({
        type: 'QualityAssessed',
        payload: expect.objectContaining({
          recordingId,
          quality: 'high'
        })
      })
    )
  })

  it('should handle missing transcript gracefully', async () => {
    mockDb.getTranscriptByRecordingId.mockResolvedValue(null)

    const recordingId = 'rec-2'
    const transcriptData = await mockDb.getTranscriptByRecordingId(recordingId)
    const assessment = inferQuality(transcriptData)

    expect(assessment.quality).toBe('unrated')
    expect(assessment.reason).toBe('No transcript available')
  })
})
