
import { describe, it, expect } from 'vitest'
import type { KnowledgeCapture, AudioSource, ActionItem } from '../knowledge'
import type { UnifiedRecording } from '../unified-recording'

describe('Knowledge Domain Types', () => {
  it('should allow creating a valid KnowledgeCapture object', () => {
    const capture: KnowledgeCapture = {
      id: 'test-id',
      title: 'Test Capture',
      summary: null,
      category: null,
      status: 'ready',
      quality: 'valuable',
      qualityConfidence: null,
      qualityAssessedAt: null,
      storageTier: 'hot',
      retentionDays: null,
      expiresAt: null,
      meetingId: null,
      correlationConfidence: null,
      correlationMethod: null,
      sourceRecordingId: 'rec-123',
      capturedAt: new Date().toISOString(),
      createdAt: null,
      updatedAt: null,
      deletedAt: null
    }

    expect(capture.id).toBe('test-id')
    expect(capture.quality).toBe('valuable')
  })

  it('should allow creating a valid AudioSource object', () => {
    const source: AudioSource = {
      id: 'source-1',
      knowledgeCaptureId: 'test-id',
      type: 'device',
      devicePath: null,
      localPath: null,
      cloudUrl: null,
      filename: 'rec.wav',
      fileSize: null,
      durationSeconds: 120,
      format: null,
      syncedFromDeviceAt: null,
      uploadedToCloudAt: null,
      createdAt: null,
      updatedAt: null
    }

    expect(source.type).toBe('device')
    expect(source.knowledgeCaptureId).toBe('test-id')
  })

  it('should allow creating a valid ActionItem object', () => {
    const action: ActionItem = {
      id: 'action-1',
      knowledgeCaptureId: 'test-id',
      content: 'Do something',
      assignee: null,
      dueDate: null,
      priority: 'medium',
      status: 'pending',
      extractedFrom: null,
      confidence: null,
      createdAt: new Date().toISOString(),
      updatedAt: null
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
