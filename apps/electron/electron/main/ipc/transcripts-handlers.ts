/**
 * Transcript Speaker IPC Handlers
 *
 * Binds transcript speaker labels (e.g. "Speaker 1") to canonical contacts,
 * so a transcript can render real identities. Uses the Result pattern.
 */

import { ipcMain } from 'electron'
import { z } from 'zod'
import { assignSpeaker, getSpeakerMap, unassignSpeaker, Contact, SpeakerMapEntry } from '../services/database'
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

export function registerTranscriptsHandlers(): void {
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
      const contact = assignSpeaker(recordingId, speakerLabel, { contactId, newName })
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
}
