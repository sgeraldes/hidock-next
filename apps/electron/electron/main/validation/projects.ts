/**
 * Project Validation Schemas
 *
 * Zod schemas for validating project-related IPC requests.
 */

import { z } from 'zod'
import { UUIDSchema, NonEmptyStringSchema, OptionalStringSchema, SearchPaginationSchema } from './common'

// =============================================================================
// Project Schemas
// =============================================================================

/**
 * Get projects request with optional search and pagination
 */
export const GetProjectsRequestSchema = SearchPaginationSchema

/**
 * Get project by ID request
 */
export const GetProjectByIdRequestSchema = z.object({
  id: UUIDSchema
})

/**
 * Create project request
 */
export const CreateProjectRequestSchema = z.object({
  name: NonEmptyStringSchema,
  description: OptionalStringSchema
})

/**
 * Update project request
 */
export const UpdateProjectRequestSchema = z.object({
  id: UUIDSchema,
  name: NonEmptyStringSchema.optional(),
  description: OptionalStringSchema,
  status: z.enum(['active', 'archived']).optional()
}).refine(
  (data) => data.name !== undefined || data.description !== undefined || data.status !== undefined,
  { message: 'At least one field (name, description, or status) must be provided' }
)

/**
 * Delete project request
 */
export const DeleteProjectRequestSchema = z.object({
  id: UUIDSchema
})

/**
 * Tag meeting to project request
 */
export const TagMeetingRequestSchema = z.object({
  meetingId: UUIDSchema,
  projectId: UUIDSchema
})

/**
 * Untag meeting from project request
 */
export const UntagMeetingRequestSchema = z.object({
  meetingId: UUIDSchema,
  projectId: UUIDSchema
})

/**
 * Project entity (for validation)
 */
export const ProjectCreateSchema = z.object({
  id: UUIDSchema,
  name: NonEmptyStringSchema,
  description: OptionalStringSchema
})

/**
 * Meeting-Project association
 */
export const MeetingProjectSchema = z.object({
  meeting_id: UUIDSchema,
  project_id: UUIDSchema
})

// =============================================================================
// Type Exports
// =============================================================================

export type GetProjectsRequest = z.infer<typeof GetProjectsRequestSchema>
export type GetProjectByIdRequest = z.infer<typeof GetProjectByIdRequestSchema>
export type CreateProjectRequest = z.infer<typeof CreateProjectRequestSchema>
export type UpdateProjectRequest = z.infer<typeof UpdateProjectRequestSchema>
export type DeleteProjectRequest = z.infer<typeof DeleteProjectRequestSchema>
export type TagMeetingRequest = z.infer<typeof TagMeetingRequestSchema>
export type UntagMeetingRequest = z.infer<typeof UntagMeetingRequestSchema>
export type ProjectCreate = z.infer<typeof ProjectCreateSchema>
export type MeetingProject = z.infer<typeof MeetingProjectSchema>
