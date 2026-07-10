/**
 * Turn-level speaker IPC handlers (v37).
 *
 * Label-level assignment (transcripts:assignSpeaker) binds a diarization label
 * to a contact and rewrites EVERY turn of that label. That is wrong when the
 * diarizer merges two people onto one label. These handlers add the finer
 * controls:
 *
 *   - getOverrides / setOverride / clearOverride  Per-turn override that
 *       supersedes the label default for a single turn ("Just this turn").
 *   - getSplits / split / mergeSplit              Fork a label into a derived,
 *       independently-assignable label from a chosen turn onward, and undo it.
 *   - assignFromHere                              Split at a turn AND bind the
 *       derived label to a contact in one step ("From here on").
 *   - getMergeHints                               Diarization-merge suspicions
 *       recorded by the self-identification pass, scoped to one recording.
 */

import { ipcMain } from 'electron'
import { z } from 'zod'
import {
  getTurnOverrides,
  setTurnOverride,
  clearTurnOverride,
  getSpeakerSplits,
  splitSpeakerFrom,
  mergeSpeakerSplit,
  assignSpeakerFromHere,
  queryAll,
  Contact,
  TurnOverrideEntry,
  SpeakerSplitEntry
} from '../services/database'
import { success, error, Result } from '../types/api'
import { UUIDSchema } from '../validation/common'

// Recording ids are UUIDs post-migration, but keep permissive so a legacy or
// externally-imported recording id is never rejected at the boundary.
const RecordingIdSchema = z.string().min(1).max(200)
const LabelSchema = z.string().min(1).max(200)
const TurnIndexSchema = z.number().int().min(0).max(1_000_000)

// Config-KV prefix the self-identification pass writes merge suspicions under
// (see self-identification.ts MERGE_KEY_PREFIX). Read-only mirror here so the
// renderer can surface a per-recording "may be two people" hint.
const MERGE_KEY_PREFIX = 'self_id:merge_suspected:'

const GetByRecordingSchema = z.object({ recordingId: RecordingIdSchema })

const SetOverrideSchema = z
  .object({
    recordingId: RecordingIdSchema,
    turnIndex: TurnIndexSchema,
    contactId: UUIDSchema.optional(),
    newName: z.string().min(1).max(500).optional()
  })
  .refine((d) => d.contactId !== undefined || (d.newName !== undefined && d.newName.trim().length > 0), {
    message: 'Either contactId or newName is required'
  })

const ClearOverrideSchema = z.object({
  recordingId: RecordingIdSchema,
  turnIndex: TurnIndexSchema
})

const SplitSchema = z.object({
  recordingId: RecordingIdSchema,
  baseLabel: LabelSchema,
  fromTurnIndex: TurnIndexSchema
})

const AssignFromHereSchema = z
  .object({
    recordingId: RecordingIdSchema,
    baseLabel: LabelSchema,
    fromTurnIndex: TurnIndexSchema,
    contactId: UUIDSchema.optional(),
    newName: z.string().min(1).max(500).optional()
  })
  .refine((d) => d.contactId !== undefined || (d.newName !== undefined && d.newName.trim().length > 0), {
    message: 'Either contactId or newName is required'
  })

export interface MergeHint {
  label: string
  names: string[]
}

/** Merge suspicions for one recording, read from the config KV markers. */
export function getMergeHintsForRecording(recordingId: string): MergeHint[] {
  const rows = queryAll<{ value: string | null }>('SELECT value FROM config WHERE key LIKE ?', [
    `${MERGE_KEY_PREFIX}${recordingId}:%`
  ])
  const out: MergeHint[] = []
  for (const r of rows) {
    if (!r.value) continue
    try {
      const parsed = JSON.parse(r.value) as { label?: string; names?: string[] }
      if (parsed.label && Array.isArray(parsed.names)) out.push({ label: parsed.label, names: parsed.names })
    } catch {
      /* skip malformed marker */
    }
  }
  return out
}

export function registerTurnSpeakersHandlers(): void {
  ipcMain.handle('turn-speakers:getOverrides', async (_, request: unknown): Promise<Result<TurnOverrideEntry[]>> => {
    try {
      const parsed = GetByRecordingSchema.safeParse(request)
      if (!parsed.success) return error('VALIDATION_ERROR', 'Invalid getOverrides request', parsed.error.format())
      return success(getTurnOverrides(parsed.data.recordingId))
    } catch (err) {
      console.error('turn-speakers:getOverrides error:', err)
      return error('DATABASE_ERROR', 'Failed to fetch turn overrides', err)
    }
  })

  ipcMain.handle('turn-speakers:setOverride', async (_, request: unknown): Promise<Result<Contact>> => {
    try {
      const parsed = SetOverrideSchema.safeParse(request)
      if (!parsed.success) return error('VALIDATION_ERROR', 'Invalid setOverride request', parsed.error.format())
      const { recordingId, turnIndex, contactId, newName } = parsed.data
      return success(setTurnOverride(recordingId, turnIndex, { contactId, newName }))
    } catch (err) {
      console.error('turn-speakers:setOverride error:', err)
      return error('DATABASE_ERROR', 'Failed to set turn override', err)
    }
  })

  ipcMain.handle('turn-speakers:clearOverride', async (_, request: unknown): Promise<Result<void>> => {
    try {
      const parsed = ClearOverrideSchema.safeParse(request)
      if (!parsed.success) return error('VALIDATION_ERROR', 'Invalid clearOverride request', parsed.error.format())
      clearTurnOverride(parsed.data.recordingId, parsed.data.turnIndex)
      return success(undefined)
    } catch (err) {
      console.error('turn-speakers:clearOverride error:', err)
      return error('DATABASE_ERROR', 'Failed to clear turn override', err)
    }
  })

  ipcMain.handle('turn-speakers:getSplits', async (_, request: unknown): Promise<Result<SpeakerSplitEntry[]>> => {
    try {
      const parsed = GetByRecordingSchema.safeParse(request)
      if (!parsed.success) return error('VALIDATION_ERROR', 'Invalid getSplits request', parsed.error.format())
      return success(getSpeakerSplits(parsed.data.recordingId))
    } catch (err) {
      console.error('turn-speakers:getSplits error:', err)
      return error('DATABASE_ERROR', 'Failed to fetch speaker splits', err)
    }
  })

  ipcMain.handle('turn-speakers:split', async (_, request: unknown): Promise<Result<{ derivedLabel: string }>> => {
    try {
      const parsed = SplitSchema.safeParse(request)
      if (!parsed.success) return error('VALIDATION_ERROR', 'Invalid split request', parsed.error.format())
      const { recordingId, baseLabel, fromTurnIndex } = parsed.data
      const derivedLabel = splitSpeakerFrom(recordingId, baseLabel, fromTurnIndex)
      return success({ derivedLabel })
    } catch (err) {
      console.error('turn-speakers:split error:', err)
      return error('DATABASE_ERROR', 'Failed to split speaker', err)
    }
  })

  ipcMain.handle('turn-speakers:mergeSplit', async (_, request: unknown): Promise<Result<void>> => {
    try {
      const parsed = SplitSchema.safeParse(request)
      if (!parsed.success) return error('VALIDATION_ERROR', 'Invalid mergeSplit request', parsed.error.format())
      const { recordingId, baseLabel, fromTurnIndex } = parsed.data
      mergeSpeakerSplit(recordingId, baseLabel, fromTurnIndex)
      return success(undefined)
    } catch (err) {
      console.error('turn-speakers:mergeSplit error:', err)
      return error('DATABASE_ERROR', 'Failed to merge speaker split', err)
    }
  })

  ipcMain.handle(
    'turn-speakers:assignFromHere',
    async (_, request: unknown): Promise<Result<{ derivedLabel: string; contact: Contact }>> => {
      try {
        const parsed = AssignFromHereSchema.safeParse(request)
        if (!parsed.success) return error('VALIDATION_ERROR', 'Invalid assignFromHere request', parsed.error.format())
        const { recordingId, baseLabel, fromTurnIndex, contactId, newName } = parsed.data
        return success(assignSpeakerFromHere(recordingId, baseLabel, fromTurnIndex, { contactId, newName }))
      } catch (err) {
        console.error('turn-speakers:assignFromHere error:', err)
        return error('DATABASE_ERROR', 'Failed to assign speaker from here', err)
      }
    }
  )

  ipcMain.handle('turn-speakers:getMergeHints', async (_, request: unknown): Promise<Result<MergeHint[]>> => {
    try {
      const parsed = GetByRecordingSchema.safeParse(request)
      if (!parsed.success) return error('VALIDATION_ERROR', 'Invalid getMergeHints request', parsed.error.format())
      return success(getMergeHintsForRecording(parsed.data.recordingId))
    } catch (err) {
      console.error('turn-speakers:getMergeHints error:', err)
      return error('DATABASE_ERROR', 'Failed to fetch merge hints', err)
    }
  })
}
