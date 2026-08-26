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
  Contact,
  SpeakerMapEntry,
  getActiveProcessingRunsForRecording
} from '../services/database'
import { isRecordingEligible } from '../services/recording-eligibility'
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
