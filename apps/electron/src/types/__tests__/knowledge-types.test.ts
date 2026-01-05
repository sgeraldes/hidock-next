
import { describe, it, expect } from 'vitest'
import type { KnowledgeCapture, AudioSource, ActionItem } from '../knowledge'
import type { UnifiedRecording } from '../unified-recording'

describe('Knowledge Domain Types', () => {
  it('should allow creating a valid KnowledgeCapture object', () => {
    const capture: KnowledgeCapture = {
      id: 'test-id',
      title: 'Test Capture',
      capturedAt: new Date().toISOString(),
      status: 'ready',
      quality: 'valuable',
      storageTier: 'hot',
      sourceRecordingId: 'rec-123'
    }

    expect(capture.id).toBe('test-id')
    expect(capture.quality).toBe('valuable')
  })

  it('should allow creating a valid AudioSource object', () => {
    const source: AudioSource = {
      id: 'source-1',
      knowledgeCaptureId: 'test-id',
      type: 'device',
      filename: 'rec.wav',
      durationSeconds: 120
    }

    expect(source.type).toBe('device')
    expect(source.knowledgeCaptureId).toBe('test-id')
  })

  it('should allow creating a valid ActionItem object', () => {
    const action: ActionItem = {
      id: 'action-1',
      knowledgeCaptureId: 'test-id',
      content: 'Do something',
      status: 'pending',
      priority: 'medium',
      createdAt: new Date().toISOString()
    }

    expect(action.content).toBe('Do something')
    expect(action.status).toBe('pending')
  })

  it('should allow linking UnifiedRecording to KnowledgeCapture', () => {
    const recording: UnifiedRecording = {
      id: 'rec-1',
      filename: 'test.wav',
      size: 1000,
      duration: 60,
      dateRecorded: new Date(),
      transcriptionStatus: 'complete',
      location: 'device-only',
      deviceFilename: 'test.wav',
      syncStatus: 'not-synced',
      knowledgeCaptureId: 'kc-1',
      title: 'Linked Capture',
      quality: 'valuable'
    }

    expect(recording.knowledgeCaptureId).toBe('kc-1')
    expect(recording.quality).toBe('valuable')
  })
})
