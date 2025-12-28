/**
 * Output Validation Schemas
 *
 * Zod schemas for validating output generation requests.
 */

import { z } from 'zod'
import { UUIDSchema } from './common'

// =============================================================================
// Output Template ID
// =============================================================================

/**
 * Valid output template identifiers
 */
export const OutputTemplateIdSchema = z.enum([
  'meeting_minutes',
  'interview_feedback',
  'project_status',
  'action_items'
])

// =============================================================================
// Generate Output Request
// =============================================================================

/**
 * Request to generate output
 */
export const GenerateOutputRequestSchema = z.object({
  templateId: OutputTemplateIdSchema,
  meetingId: UUIDSchema.optional(),
  projectId: UUIDSchema.optional(),
  contactId: UUIDSchema.optional(),
  knowledgeCaptureId: UUIDSchema.optional(),
  actionableId: UUIDSchema.optional()
}).refine(
  (data) => data.meetingId || data.projectId || data.contactId || data.knowledgeCaptureId,
  { message: 'At least one context (meetingId, projectId, contactId, or knowledgeCaptureId) must be provided' }
)

// =============================================================================
// Type Exports
// =============================================================================

export type OutputTemplateId = z.infer<typeof OutputTemplateIdSchema>
export type GenerateOutputRequest = z.infer<typeof GenerateOutputRequestSchema>
