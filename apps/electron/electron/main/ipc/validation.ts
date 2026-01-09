/**
 * Input validation schemas for IPC handlers
 * Prevents injection attacks and invalid data from reaching services
 *
 * MIGRATION NOTE: This file has been migrated from manual validation functions
 * to Zod schemas for better type safety and consistency. Legacy functions are
 * kept for backward compatibility but are deprecated.
 */

import { z } from 'zod'

// =============================================================================
// Quality Assessment Schemas
// =============================================================================

/**
 * Quality level enum
 */
export const QualityLevelSchema = z.enum(['high', 'medium', 'low'])

/**
 * Assessment method enum
 */
export const AssessmentMethodSchema = z.enum(['manual', 'auto', 'ai'])

/**
 * Set quality assessment request
 */
export const SetQualitySchema = z.object({
  recordingId: z.string().uuid('Recording ID must be a valid UUID'),
  quality: QualityLevelSchema,
  reason: z.string().max(1000).optional(),
  assessedBy: z.string().max(200).optional()
})

/**
 * Get by quality level request
 */
export const GetByQualitySchema = z.object({
  quality: QualityLevelSchema
})

/**
 * Batch auto-assess request
 */
export const BatchAutoAssessSchema = z.object({
  recordingIds: z.array(z.string().uuid()).min(1).max(1000)
})

// =============================================================================
// Storage Policy Schemas
// =============================================================================

/**
 * Storage tier enum
 */
export const StorageTierSchema = z.enum(['hot', 'warm', 'cold', 'archive'])

/**
 * Min age override object for cleanup
 */
export const MinAgeOverrideSchema = z.record(
  StorageTierSchema,
  z.number().int().nonnegative()
).optional()

/**
 * Get by tier request
 */
export const GetByTierSchema = z.object({
  tier: StorageTierSchema
})

/**
 * Get cleanup suggestions request
 */
export const GetCleanupSuggestionsSchema = z.object({
  minAgeOverride: MinAgeOverrideSchema
})

/**
 * Get cleanup suggestions for tier request
 */
export const GetCleanupSuggestionsForTierSchema = z.object({
  tier: StorageTierSchema,
  minAgeDays: z.number().int().min(0).max(36500).optional()
})

/**
 * Execute cleanup request
 */
export const ExecuteCleanupSchema = z.object({
  recordingIds: z.array(z.string().uuid()).min(1).max(1000),
  archive: z.boolean().default(false)
})

/**
 * Assign tier request
 */
export const AssignTierSchema = z.object({
  recordingId: z.string().uuid(),
  quality: QualityLevelSchema
})

// =============================================================================
// Recording Schemas
// =============================================================================

/**
 * Recording ID validation
 */
export const RecordingIdSchema = z.string().uuid('Recording ID must be a valid UUID')

/**
 * Get recording by ID request
 */
export const GetRecordingByIdSchema = z.object({
  id: RecordingIdSchema
})

/**
 * Delete recording request
 */
export const DeleteRecordingSchema = z.object({
  id: RecordingIdSchema
})

/**
 * Link recording to meeting request
 */
export const LinkRecordingToMeetingSchema = z.object({
  recordingId: RecordingIdSchema,
  meetingId: z.string().uuid('Meeting ID must be a valid UUID')
})

/**
 * Unlink recording from meeting request
 */
export const UnlinkRecordingFromMeetingSchema = z.object({
  recordingId: RecordingIdSchema
})

/**
 * Transcribe recording request
 */
export const TranscribeRecordingSchema = z.object({
  recordingId: RecordingIdSchema
})

// =============================================================================
// Storage Handlers Schemas
// =============================================================================

/**
 * Open folder request
 */
export const OpenFolderSchema = z.object({
  folder: z.enum(['recordings', 'transcripts', 'data'])
})

/**
 * Read recording file request
 */
export const ReadRecordingFileSchema = z.object({
  filePath: z.string().min(1).max(500)
})

/**
 * Delete recording file request
 */
export const DeleteRecordingFileSchema = z.object({
  filePath: z.string().min(1).max(500)
})

/**
 * Save recording request
 */
export const SaveRecordingSchema = z.object({
  filename: z.string().min(1).max(255),
  data: z.array(z.number().int().min(0).max(255))
})

// =============================================================================
// Calendar Schemas
// =============================================================================

/**
 * Set ICS URL request
 */
export const SetIcsUrlSchema = z.object({
  url: z.string().url('Must be a valid URL').max(2000)
})

/**
 * Toggle auto-sync request
 */
export const ToggleAutoSyncSchema = z.object({
  enabled: z.boolean()
})

/**
 * Set sync interval request
 */
export const SetSyncIntervalSchema = z.object({
  minutes: z.number().int().min(1).max(1440) // 1 minute to 24 hours
})

// =============================================================================
// Type Exports
// =============================================================================

export type QualityLevel = z.infer<typeof QualityLevelSchema>
export type AssessmentMethod = z.infer<typeof AssessmentMethodSchema>
export type SetQuality = z.infer<typeof SetQualitySchema>
export type GetByQuality = z.infer<typeof GetByQualitySchema>
export type BatchAutoAssess = z.infer<typeof BatchAutoAssessSchema>
export type StorageTier = z.infer<typeof StorageTierSchema>
export type MinAgeOverride = z.infer<typeof MinAgeOverrideSchema>
export type GetByTier = z.infer<typeof GetByTierSchema>
export type GetCleanupSuggestions = z.infer<typeof GetCleanupSuggestionsSchema>
export type GetCleanupSuggestionsForTier = z.infer<typeof GetCleanupSuggestionsForTierSchema>
export type ExecuteCleanup = z.infer<typeof ExecuteCleanupSchema>
export type AssignTier = z.infer<typeof AssignTierSchema>
export type RecordingId = z.infer<typeof RecordingIdSchema>
export type GetRecordingById = z.infer<typeof GetRecordingByIdSchema>
export type DeleteRecording = z.infer<typeof DeleteRecordingSchema>
export type LinkRecordingToMeeting = z.infer<typeof LinkRecordingToMeetingSchema>
export type UnlinkRecordingFromMeeting = z.infer<typeof UnlinkRecordingFromMeetingSchema>
export type TranscribeRecording = z.infer<typeof TranscribeRecordingSchema>
export type OpenFolder = z.infer<typeof OpenFolderSchema>
export type ReadRecordingFile = z.infer<typeof ReadRecordingFileSchema>
export type DeleteRecordingFile = z.infer<typeof DeleteRecordingFileSchema>
export type SaveRecording = z.infer<typeof SaveRecordingSchema>
export type SetIcsUrl = z.infer<typeof SetIcsUrlSchema>
export type ToggleAutoSync = z.infer<typeof ToggleAutoSyncSchema>
export type SetSyncInterval = z.infer<typeof SetSyncIntervalSchema>

// =============================================================================
// Legacy Validation Functions (DEPRECATED - Use Zod schemas instead)
// =============================================================================

/**
 * @deprecated Use SetQualitySchema.safeParse() instead
 */
export class ValidationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ValidationError'
  }
}

/**
 * @deprecated Use RecordingIdSchema.safeParse() instead
 */
export function validateRecordingId(id: unknown): string {
  const result = RecordingIdSchema.safeParse(id)
  if (!result.success) {
    throw new ValidationError(result.error.issues[0]?.message || 'Invalid recording ID')
  }
  return result.data
}

/**
 * @deprecated Use BatchAutoAssessSchema.safeParse() instead
 */
export function validateRecordingIds(ids: unknown): string[] {
  const result = z.array(z.string().uuid()).min(1).max(1000).safeParse(ids)
  if (!result.success) {
    throw new ValidationError(result.error.issues[0]?.message || 'Invalid recording IDs array')
  }
  return result.data
}

/**
 * @deprecated Use QualityLevelSchema.safeParse() instead
 */
export function validateQualityLevel(quality: unknown): 'high' | 'medium' | 'low' {
  const result = QualityLevelSchema.safeParse(quality)
  if (!result.success) {
    throw new ValidationError(result.error.issues[0]?.message || 'Invalid quality level')
  }
  return result.data
}

/**
 * @deprecated Use StorageTierSchema.safeParse() instead
 */
export function validateStorageTier(tier: unknown): 'hot' | 'warm' | 'cold' | 'archive' {
  const result = StorageTierSchema.safeParse(tier)
  if (!result.success) {
    throw new ValidationError(result.error.issues[0]?.message || 'Invalid storage tier')
  }
  return result.data
}

/**
 * @deprecated Use z.string().max(n).optional().safeParse() instead
 */
export function validateOptionalString(value: unknown, maxLength = 10000): string | undefined {
  const result = z.string().max(maxLength).optional().safeParse(value)
  if (!result.success) {
    throw new ValidationError(result.error.issues[0]?.message || 'Invalid string')
  }
  return result.data
}

/**
 * @deprecated Use z.boolean().safeParse() instead
 */
export function validateBoolean(value: unknown): boolean {
  const result = z.boolean().safeParse(value)
  if (!result.success) {
    throw new ValidationError(result.error.issues[0]?.message || 'Invalid boolean')
  }
  return result.data
}

/**
 * @deprecated Use z.number().int().min(n).max(m).safeParse() instead
 */
export function validateNumber(value: unknown, min?: number, max?: number): number {
  let schema = z.number()
  if (min !== undefined) schema = schema.min(min)
  if (max !== undefined) schema = schema.max(max)
  const result = schema.safeParse(value)
  if (!result.success) {
    throw new ValidationError(result.error.issues[0]?.message || 'Invalid number')
  }
  return result.data
}

/**
 * @deprecated Use MinAgeOverrideSchema.safeParse() instead
 */
export function validateMinAgeOverride(override: unknown): Partial<Record<'hot' | 'warm' | 'cold' | 'archive', number>> | undefined {
  const result = MinAgeOverrideSchema.safeParse(override)
  if (!result.success) {
    throw new ValidationError(result.error.issues[0]?.message || 'Invalid min age override')
  }
  return result.data
}
