/**
 * Transcript Speaker IPC Handlers
 *
 * Binds transcript speaker labels (e.g. "Speaker 1") to canonical contacts,
 * so a transcript can render real identities. Uses the Result pattern.
 */

import { ipcMain } from 'electron'
import { z } from 'zod'
import {
  assignSpeaker,
  getSpeakerMap,
  unassignSpeaker,
  getRecordingById,
  resolveRecordingId,
  queryOne,
  run,
  runInTransaction,
  runNoSave,
  Contact,
  SpeakerMapEntry,
  getActiveProcessingRunsForRecording
} from '../services/database'
import { isRecordingEligible } from '../services/recording-eligibility'
import { consolidateVoiceIdentityForSpeaker } from '../services/voice-identity-consolidation'
import { getVectorStore } from '../services/vector-store'
import { success, error, Result } from '../types/api'
import { UUIDSchema } from '../validation/common'

// Recording ids are UUIDs post-migration, but keep this permissive so a legacy
// or externally-imported recording id is never rejected at the boundary.
const RecordingIdSchema = z.string().min(1).max(200)
const SpeakerLabelSchema = z.string().min(1).max(200)

const AssignSpeakerRequestSchema = z
  .object({
    recordingId: RecordingIdSchema,
    speakerLabel: SpeakerLabelSchema,
    contactId: UUIDSchema.optional(),
    newName: z.string().min(1).max(500).optional()
  })
  .refine((data) => data.contactId !== undefined || (data.newName !== undefined && data.newName.trim().length > 0), {
    message: 'Either contactId or newName is required'
  })

const GetSpeakerMapRequestSchema = z.object({
  recordingId: RecordingIdSchema
})

const UnassignSpeakerRequestSchema = z.object({
  recordingId: RecordingIdSchema,
  speakerLabel: SpeakerLabelSchema
})

const UpdateExtractedItemRequestSchema = z.object({
  recordingId: RecordingIdSchema,
  kind: z.enum(['action', 'decision']),
  index: z.number().int().min(0).max(10000),
  content: z.string().trim().min(1).max(4000)
})

const EditableTranscriptSegmentSchema = z
  .object({
    speaker: z.string().trim().min(1).max(200).optional(),
    start: z.number().finite().min(0).max(7 * 24 * 60 * 60),
    end: z.number().finite().min(0).max(7 * 24 * 60 * 60).optional(),
    text: z.string().trim().min(1).max(50_000)
  })
  .refine((segment) => segment.end === undefined || segment.end >= segment.start, {
    message: 'Segment end must not precede its start'
  })

const UpdateTranscriptRequestSchema = z
  .object({
    recordingId: RecordingIdSchema,
    expectedFullText: z.string().max(10_000_000),
    segments: z.array(EditableTranscriptSegmentSchema).min(1).max(50_000)
  })
  .superRefine(({ segments }, ctx) => {
    let size = 0
    let previousStart = -1
    for (const [index, segment] of segments.entries()) {
      size += segment.text.length + (segment.speaker?.length ?? 0)
      if (segment.start < previousStart) {
        ctx.addIssue({
          code: 'custom',
          path: ['segments', index, 'start'],
          message: 'Segments must be ordered by start time'
        })
      }
      previousStart = segment.start
    }
    if (size > 10_000_000) {
      ctx.addIssue({ code: 'custom', path: ['segments'], message: 'Transcript is too large' })
    }
  })

type EditableTranscriptSegment = z.infer<typeof EditableTranscriptSegmentSchema>

interface TranscriptEditResult {
  fullText: string
  segments: EditableTranscriptSegment[]
  wordCount: number
  indexedChunks: number
  ragStatus: 'indexed' | 'pending'
  ragError?: string
}

function canonicalTranscriptText(segments: EditableTranscriptSegment[]): string {
  return segments
    .map((segment) => (segment.speaker ? `${segment.speaker}: ${segment.text}` : segment.text))
    .join('\n')
}

function safeErrorMessage(err: unknown): string {
  return err instanceof Error && err.message.trim() ? err.message : 'Embedding provider unavailable'
}

async function indexCorrectedTranscript(recordingId: string, fullText: string): Promise<number> {
  const recording = getRecordingById(recordingId)
  if (!recording || !isRecordingEligible(recordingId)) throw new Error('Recording is no longer available')

  const meeting = recording.meeting_id
    ? queryOne<{ subject: string | null }>('SELECT subject FROM meetings WHERE id = ?', [recording.meeting_id])
    : undefined
  const indexedChunks = await getVectorStore().indexTranscript(fullText, {
    meetingId: recording.meeting_id ?? undefined,
    recordingId,
    timestamp: recording.date_recorded ?? recording.created_at,
    subject: meeting?.subject ?? undefined,
    shouldGenerate: () => isRecordingEligible(recordingId),
    shouldPersist: () => isRecordingEligible(recordingId)
  })
  if (indexedChunks < 1) throw new Error('No search chunks were generated')
  return indexedChunks
}

export function registerTranscriptsHandlers(): void {
  ipcMain.handle('transcripts:getProcessingRuns', async (_, request: unknown) => {
    const parsed = GetSpeakerMapRequestSchema.safeParse(request)
    if (!parsed.success) return error('VALIDATION_ERROR', 'Invalid processing-runs request', parsed.error.format())
    try {
      if (!getRecordingById(parsed.data.recordingId)) return success([])
      return success(getActiveProcessingRunsForRecording(parsed.data.recordingId))
    } catch (err) {
      return error('DATABASE_ERROR', 'Failed to fetch processing provenance', err)
    }
  })

  /**
   * Bind a speaker label to a contact (existing contactId or a newName to upsert).
   */
  ipcMain.handle('transcripts:assignSpeaker', async (_, request: unknown): Promise<Result<Contact>> => {
    try {
      const parsed = AssignSpeakerRequestSchema.safeParse(request)
      if (!parsed.success) {
        return error('VALIDATION_ERROR', 'Invalid assignSpeaker request', parsed.error.format())
      }

      const { recordingId, speakerLabel, contactId, newName } = parsed.data
      const contact = assignSpeaker(recordingId, speakerLabel, {
        contactId,
        newName,
        voiceAnchor: { method: 'manual', confidence: 1 }
      })
      try {
        const consolidated = consolidateVoiceIdentityForSpeaker(recordingId, speakerLabel, contact.id)
        if (consolidated.mergedClusterIds.length) {
          console.info(
            `[VoiceID] Consolidated ${consolidated.mergedClusterIds.length} acoustic duplicate(s) for ${contact.id}`
          )
        }
      } catch (consolidationError) {
        // The explicit person assignment already committed and remains valid.
        // Report repair failure without lying to the user that the assignment failed.
        console.warn('[VoiceID] Person assigned; historical voice consolidation failed:', consolidationError)
      }
      return success(contact)
    } catch (err) {
      console.error('transcripts:assignSpeaker error:', err)
      return error('DATABASE_ERROR', 'Failed to assign speaker', err)
    }
  })

  /**
   * Get the speaker-label → contact map for a recording.
   */
  ipcMain.handle('transcripts:getSpeakerMap', async (_, request: unknown): Promise<Result<SpeakerMapEntry[]>> => {
    try {
      const parsed = GetSpeakerMapRequestSchema.safeParse(request)
      if (!parsed.success) {
        return error('VALIDATION_ERROR', 'Invalid getSpeakerMap request', parsed.error.format())
      }

      return success(getSpeakerMap(parsed.data.recordingId))
    } catch (err) {
      console.error('transcripts:getSpeakerMap error:', err)
      return error('DATABASE_ERROR', 'Failed to fetch speaker map', err)
    }
  })

  /**
   * Remove a speaker-label → contact binding.
   */
  ipcMain.handle('transcripts:unassignSpeaker', async (_, request: unknown): Promise<Result<void>> => {
    try {
      const parsed = UnassignSpeakerRequestSchema.safeParse(request)
      if (!parsed.success) {
        return error('VALIDATION_ERROR', 'Invalid unassignSpeaker request', parsed.error.format())
      }

      unassignSpeaker(parsed.data.recordingId, parsed.data.speakerLabel)
      return success(undefined)
    } catch (err) {
      console.error('transcripts:unassignSpeaker error:', err)
      return error('DATABASE_ERROR', 'Failed to unassign speaker', err)
    }
  })

  /**
   * Persist a user-corrected transcript and invalidate its old semantic index in
   * one SQLite transaction. Re-embedding follows immediately. A provider failure
   * is reported as an honest, retryable RAG-pending state; stale chunks are never
   * left searchable after corrected source text has committed.
   */
  ipcMain.handle(
    'transcripts:updateContent',
    async (_, request: unknown): Promise<Result<TranscriptEditResult>> => {
      const parsed = UpdateTranscriptRequestSchema.safeParse(request)
      if (!parsed.success) {
        return error('VALIDATION_ERROR', 'Invalid transcript edit', parsed.error.format())
      }

      try {
        const canonical = getRecordingById(parsed.data.recordingId) ?? resolveRecordingId(parsed.data.recordingId)
        const recordingId = canonical?.id ?? parsed.data.recordingId
        if (!isRecordingEligible(recordingId)) return error('RECORDING_INELIGIBLE', 'Recording not available')

        const fullText = canonicalTranscriptText(parsed.data.segments)
        const wordCount = fullText.split(/\s+/u).filter(Boolean).length
        const vectorStore = getVectorStore()
        vectorStore.ensureSchema()

        runInTransaction(() => {
          if (!isRecordingEligible(recordingId)) throw new Error('RECORDING_INELIGIBLE')
          const current = queryOne<{ full_text: string }>(
            'SELECT full_text FROM transcripts WHERE recording_id = ?',
            [recordingId]
          )
          if (!current) throw new Error('TRANSCRIPT_NOT_FOUND')
          if (current.full_text !== parsed.data.expectedFullText) throw new Error('TRANSCRIPT_CHANGED')

          runNoSave(
            'UPDATE transcripts SET full_text = ?, speakers = ?, word_count = ? WHERE recording_id = ?',
            [fullText, JSON.stringify(parsed.data.segments), wordCount, recordingId]
          )
          runNoSave('DELETE FROM vector_embeddings WHERE recording_id = ?', [recordingId])
        })
        vectorStore.dropByRecordingFromMemory(recordingId)

        let indexedChunks = 0
        let ragStatus: TranscriptEditResult['ragStatus'] = 'indexed'
        let ragError: string | undefined
        try {
          indexedChunks = await indexCorrectedTranscript(recordingId, fullText)
        } catch (err) {
          ragStatus = 'pending'
          ragError = safeErrorMessage(err)
          console.warn(`[TranscriptEdit] Saved ${recordingId}; RAG reindex pending:`, ragError)
        }

        try {
          const { exportMeetingWiki } = await import('../services/meeting-wiki')
          exportMeetingWiki(recordingId)
        } catch (err) {
          console.warn('[TranscriptEdit] Meeting wiki refresh failed (non-fatal):', safeErrorMessage(err))
        }

        return success({
          fullText,
          segments: parsed.data.segments,
          wordCount,
          indexedChunks,
          ragStatus,
          ...(ragError ? { ragError } : {})
        })
      } catch (err) {
        const message = safeErrorMessage(err)
        if (message === 'TRANSCRIPT_CHANGED') {
          return error('RETRYABLE_ERROR', 'The transcript changed while you were editing. Reload it and try again.')
        }
        if (message === 'TRANSCRIPT_NOT_FOUND') return error('NOT_FOUND', 'Transcript not found')
        if (message === 'RECORDING_INELIGIBLE') {
          return error('RECORDING_INELIGIBLE', 'Recording not available')
        }
        console.error('transcripts:updateContent error:', err)
        return error('DATABASE_ERROR', 'Failed to save transcript correction', message)
      }
    }
  )

  ipcMain.handle(
    'transcripts:reindex',
    async (_, request: unknown): Promise<Result<{ indexedChunks: number }>> => {
      const parsed = GetSpeakerMapRequestSchema.safeParse(request)
      if (!parsed.success) return error('VALIDATION_ERROR', 'Invalid transcript reindex request', parsed.error.format())

      try {
        const canonical = getRecordingById(parsed.data.recordingId) ?? resolveRecordingId(parsed.data.recordingId)
        const recordingId = canonical?.id ?? parsed.data.recordingId
        if (!isRecordingEligible(recordingId)) return error('RECORDING_INELIGIBLE', 'Recording not available')
        const transcript = queryOne<{ full_text: string }>(
          'SELECT full_text FROM transcripts WHERE recording_id = ?',
          [recordingId]
        )
        if (!transcript?.full_text.trim()) return error('NOT_FOUND', 'Transcript not found')

        await getVectorStore().deleteByRecording(recordingId)
        const indexedChunks = await indexCorrectedTranscript(recordingId, transcript.full_text)
        return success({ indexedChunks })
      } catch (err) {
        const message = safeErrorMessage(err)
        console.warn('transcripts:reindex error:', message)
        return error('SERVICE_UNAVAILABLE', 'Transcript is saved, but the RAG index could not be updated', message)
      }
    }
  )

  /**
   * Edit ONE element of the transcript's extracted action_items / key_points
   * JSON arrays (2026-07-22 — reader event-list editability for
   * transcript-derived items, refIds `txa_<i>` / `txk_<i>`).
   *
   * Gating (ADV17/38 lineage): the recording must be eligible BEFORE the read
   * AND the write — an excluded recording's extracted text is neither read nor
   * mutated. Index-addressed: a concurrent retranscription that rewrites the
   * arrays between read and write is detected by re-reading inside the same
   * synchronous statement sequence (sql.js is single-writer; there is no await
   * between the eligibility check, the bounds check, and the UPDATE).
   */
  ipcMain.handle(
    'transcripts:updateExtractedItem',
    async (_, request: unknown): Promise<Result<{ kind: 'action' | 'decision'; index: number; content: string }>> => {
      try {
        const parsed = UpdateExtractedItemRequestSchema.safeParse(request)
        if (!parsed.success) {
          return error('VALIDATION_ERROR', 'Invalid updateExtractedItem request', parsed.error.format())
        }
        const { recordingId, kind, index, content } = parsed.data

        const canonical = getRecordingById(recordingId) ?? resolveRecordingId(recordingId)
        const id = canonical?.id ?? recordingId
        if (!isRecordingEligible(id)) {
          return error('RECORDING_INELIGIBLE', 'Recording not available')
        }

        const column = kind === 'action' ? 'action_items' : 'key_points'
        const row = queryOne<{ v: string | null }>(
          `SELECT ${column} AS v FROM transcripts WHERE recording_id = ?`,
          [id]
        )
        if (!row) {
          return error('NOT_FOUND', 'Transcript not found')
        }
        let arr: unknown
        try {
          arr = JSON.parse(row.v ?? '[]')
        } catch {
          arr = []
        }
        if (!Array.isArray(arr) || index >= arr.length || typeof arr[index] !== 'string') {
          return error('NOT_FOUND', 'Extracted item not found at index')
        }
        arr[index] = content
        run(`UPDATE transcripts SET ${column} = ? WHERE recording_id = ?`, [JSON.stringify(arr), id])
        return success({ kind, index, content })
      } catch (err) {
        console.error('transcripts:updateExtractedItem error:', err)
        return error('DATABASE_ERROR', 'Failed to update extracted item', err)
      }
    }
  )
}
