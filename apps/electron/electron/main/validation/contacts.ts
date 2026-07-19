/**
 * Contact Validation Schemas
 *
 * Zod schemas for validating contact-related IPC requests.
 */

import { z } from 'zod'
import { UUIDSchema, OptionalStringSchema, SearchPaginationSchema } from './common'

// =============================================================================
// Contact Schemas
// =============================================================================

/**
 * Get contacts request with optional search, type filter, and pagination
 */
export const GetContactsRequestSchema = SearchPaginationSchema.extend({
  type: z.enum(['team', 'candidate', 'customer', 'external', 'unknown', 'all']).optional(),
  sortBy: z.enum(['name', 'lastSeen', 'interactions']).optional()
})

/**
 * Get contact by ID request
 */
export const GetContactByIdRequestSchema = z.object({
  id: UUIDSchema
})

/**
 * Update contact request
 */
export const UpdateContactRequestSchema = z.object({
  id: UUIDSchema,
  name: z.string().min(1).max(500).optional(),
  email: z.string().email().max(500).nullable().optional(),
  notes: OptionalStringSchema,
  type: z.enum(['team', 'candidate', 'customer', 'external', 'unknown']).optional(),
  role: OptionalStringSchema,
  company: OptionalStringSchema,
  tags: z.array(z.string()).optional()
})

/**
 * Create contact request — a manually added person ("Add Person" dialog).
 * Only name is required; email/role/type are optional refinements.
 */
export const CreateContactRequestSchema = z.object({
  name: z.string().trim().min(1).max(500),
  email: z.string().email().max(500).nullable().optional(),
  type: z.enum(['team', 'candidate', 'customer', 'external', 'unknown']).optional(),
  role: OptionalStringSchema,
  company: OptionalStringSchema
})

/**
 * Delete contact request
 */
export const DeleteContactRequestSchema = z.object({
  id: UUIDSchema
})

/**
 * Merge contacts request — fold the loser into the keeper.
 */
export const MergeContactsRequestSchema = z.object({
  keeperId: UUIDSchema,
  loserId: UUIDSchema
})

/**
 * Contact role in a meeting
 */
export const ContactRoleSchema = z.enum(['organizer', 'attendee'])

/**
 * Meeting-Contact association
 */
export const MeetingContactSchema = z.object({
  meeting_id: UUIDSchema,
  contact_id: UUIDSchema,
  role: ContactRoleSchema
})

/**
 * Contact entity (for validation when creating from attendees)
 */
export const ContactCreateSchema = z.object({
  id: UUIDSchema,
  name: z.string().min(1).max(500),
  email: z.string().email().max(500).nullable().optional(),
  notes: OptionalStringSchema,
  first_seen_at: z.string(),
  last_seen_at: z.string(),
  meeting_count: z.number().int().nonnegative().default(0)
})

// =============================================================================
// Type Exports
// =============================================================================

export type GetContactsRequest = z.infer<typeof GetContactsRequestSchema>
export type GetContactByIdRequest = z.infer<typeof GetContactByIdRequestSchema>
export type UpdateContactRequest = z.infer<typeof UpdateContactRequestSchema>
export type CreateContactRequest = z.infer<typeof CreateContactRequestSchema>
export type DeleteContactRequest = z.infer<typeof DeleteContactRequestSchema>
export type MergeContactsRequest = z.infer<typeof MergeContactsRequestSchema>
export type ContactRole = z.infer<typeof ContactRoleSchema>
export type MeetingContact = z.infer<typeof MeetingContactSchema>
export type ContactCreate = z.infer<typeof ContactCreateSchema>
