import { v4 as uuidv4 } from 'uuid'
import {
  queryAll,
  getRecordingByIdAsync,
  getTranscriptByRecordingIdAsync,
  upsertQualityAssessmentAsync,
  getQualityAssessmentAsync,
  getQualityAssessment,
  getRecordingsByQuality,
  getRecordingsByIds,
  getTranscriptsByRecordingIds,
  upsertQualityAssessment,
  Recording,
  Transcript,
  QualityAssessment
} from './database'
import { getEventBus } from './event-bus'
import type { QualityAssessedEvent } from './event-bus'

export type QualityLevel = 'high' | 'medium' | 'low'
export type AssessmentMethod = 'auto' | 'manual'

/**
 * QualityAssessmentService - Manages recording quality assessment
 * Provides both manual and automatic quality inference based on heuristics
 */
export class QualityAssessmentService {
  /**
   * Assess the quality of a recording manually
   */
  async assessQuality(
    recordingId: string,
    quality: QualityLevel,
    reason?: string,
    assessedBy?: string
  ): Promise<QualityAssessment> {
    const recording = await getRecordingByIdAsync(recordingId)
    if (!recording) {
      throw new Error(`Recording not found: ${recordingId}`)
    }

    const assessment: Omit<QualityAssessment, 'assessed_at'> = {
      id: uuidv4(),
      recording_id: recordingId,
      quality,
      assessment_method: 'manual',
      confidence: 1.0, // Manual assessments have full confidence
      reason,
      assessed_by: assessedBy
    }

    await upsertQualityAssessmentAsync(assessment)

    // Emit domain event
    const event: QualityAssessedEvent = {
      type: 'quality:assessed',
      timestamp: new Date().toISOString(),
      payload: {
        recordingId,
        quality,
        assessmentMethod: 'manual',
        confidence: 1.0,
        reason
      }
    }
    getEventBus().emitDomainEvent(event)

    return (await getQualityAssessmentAsync(recordingId))!
  }

  /**
   * Get quality assessment for a recording
   */
  getQuality(recordingId: string): QualityAssessment | undefined {
    return getQualityAssessment(recordingId)
  }

  /**
   * Get all recordings with a specific quality level
   */
  getByQuality(quality: QualityLevel): Recording[] {
    return getRecordingsByQuality(quality)
  }

  /**
   * Automatically assess quality based on heuristics
   * This is called when a recording is transcribed or manually triggered
   */
  async autoAssess(recordingId: string): Promise<QualityAssessment> {
    const quality = await this.inferQualityAsync(recordingId)

    const assessment: Omit<QualityAssessment, 'assessed_at'> = {
      id: uuidv4(),
      recording_id: recordingId,
      quality: quality.level,
      assessment_method: 'auto',
      confidence: quality.confidence,
      reason: quality.reason,
      assessed_by: 'system'
    }

    await upsertQualityAssessmentAsync(assessment)

    // Emit domain event
    const event: QualityAssessedEvent = {
      type: 'quality:assessed',
      timestamp: new Date().toISOString(),
      payload: {
        recordingId,
        quality: quality.level,
        assessmentMethod: 'auto',
        confidence: quality.confidence,
        reason: quality.reason
      }
    }
    getEventBus().emitDomainEvent(event)

    return (await getQualityAssessmentAsync(recordingId))!
  }

  /**
   * Infer quality from recording metadata using heuristics
   * Factors considered:
   * - Has transcript
   * - Has meeting correlation
   * - Duration (meetings should be reasonable length)
   * - File size (corruption indicator)
   */
  private inferQualityFromData(recording: Recording, transcript?: Transcript): {
    level: QualityLevel
    confidence: number
    reason: string
  } {
    const hasMeeting = !!recording.meeting_id
    const hasTranscript = !!transcript
    const duration = recording.duration_seconds || 0

    let score = 0
    let confidence = 0.7 // Default confidence for auto-assessment
    const reasons: string[] = []

    // Factor 1: Has transcript (40 points)
    if (hasTranscript) {
      score += 40
      reasons.push('has transcript')

      // Check transcript quality
      if (transcript.word_count && transcript.word_count > 100) {
        score += 10
        reasons.push('substantial transcript')
      }

      if (transcript.summary) {
        score += 5
        reasons.push('has summary')
      }
    } else {
      reasons.push('no transcript')
    }

    // Factor 2: Meeting correlation (30 points)
    if (hasMeeting) {
      score += 30
      reasons.push('linked to meeting')

      if (recording.correlation_confidence && recording.correlation_confidence > 0.8) {
        score += 10
        reasons.push('high meeting confidence')
      }
    } else {
      reasons.push('no meeting link')
    }

    // Factor 3: Duration appropriateness (20 points)
    if (duration >= 60 && duration <= 7200) {
      // 1 min to 2 hours is reasonable for meetings
      score += 20
      reasons.push('appropriate duration')
    } else if (duration < 60) {
      reasons.push('very short recording')
      confidence = 0.6
    } else if (duration > 7200) {
      reasons.push('very long recording')
    }

    // Factor 4: File integrity (10 points)
    if (recording.file_size && recording.file_size > 1000) {
      // Non-trivial file size
      score += 10
      reasons.push('valid file size')
    } else {
      reasons.push('suspicious file size')
      confidence = 0.5
    }

    // Determine quality level from score
    let level: QualityLevel
    if (score >= 70) {
      level = 'high'
    } else if (score >= 40) {
      level = 'medium'
    } else {
      level = 'low'
    }

    const reason = reasons.join(', ')
    return { level, confidence, reason }
  }

  /**
   * Async version of inferQuality - yields to event loop to prevent blocking
   */
  private async inferQualityAsync(recordingId: string): Promise<{
    level: QualityLevel
    confidence: number
    reason: string
  }> {
    const recording = await getRecordingByIdAsync(recordingId)
    if (!recording) {
      return { level: 'low', confidence: 1.0, reason: 'Recording not found' }
    }

    const transcript = await getTranscriptByRecordingIdAsync(recordingId)
    return this.inferQualityFromData(recording, transcript)
  }

  /**
   * Batch auto-assess multiple recordings
   * Useful for initial import or re-assessment
   */
  async batchAutoAssess(recordingIds: string[]): Promise<QualityAssessment[]> {
    // Batch load all required data to avoid N+1 queries
    // imports moved to top of file

    const recordingsMap = getRecordingsByIds(recordingIds)
    const transcriptsMap = getTranscriptsByRecordingIds(recordingIds)
    const results: QualityAssessment[] = []

    for (const recordingId of recordingIds) {
      try {
        const recording = recordingsMap.get(recordingId)
        if (!recording) continue

        const transcript = transcriptsMap.get(recordingId)
        const quality = this.inferQualityFromData(recording, transcript)

        const assessment: Omit<QualityAssessment, 'assessed_at'> = {
          id: uuidv4(),
          recording_id: recordingId,
          quality: quality.level,
          assessment_method: 'auto',
          confidence: quality.confidence,
          reason: quality.reason,
          assessed_by: 'system'
        }

        upsertQualityAssessment(assessment)

        // Emit domain event
        const event: QualityAssessedEvent = {
          type: 'quality:assessed',
          timestamp: new Date().toISOString(),
          payload: {
            recordingId,
            quality: quality.level,
            assessmentMethod: 'auto',
            confidence: quality.confidence,
            reason: quality.reason
          }
        }
        getEventBus().emitDomainEvent(event)

        results.push(getQualityAssessment(recordingId)!)
      } catch (error) {
        console.error(`Failed to assess recording ${recordingId}:`, error)
      }
    }

    return results
  }

  /**
   * Re-assess all recordings that don't have quality assessments
   */
  async assessUnassessed(): Promise<number> {
    // imports moved to top of file

    // Get all recordings without quality assessments
    const unassessed = queryAll<Recording>(`
      SELECT r.* FROM recordings r
      LEFT JOIN quality_assessments qa ON r.id = qa.recording_id
      WHERE qa.id IS NULL
      ORDER BY r.date_recorded DESC
    `)

    console.log(`[QualityAssessment] Found ${unassessed.length} unassessed recordings`)

    const assessments = await this.batchAutoAssess(unassessed.map((r) => r.id))

    console.log(`[QualityAssessment] Assessed ${assessments.length} recordings`)

    return assessments.length
  }
}

// Singleton instance
let qualityAssessmentServiceInstance: QualityAssessmentService | null = null

export function getQualityAssessmentService(): QualityAssessmentService {
  if (!qualityAssessmentServiceInstance) {
    qualityAssessmentServiceInstance = new QualityAssessmentService()
  }
  return qualityAssessmentServiceInstance
}
