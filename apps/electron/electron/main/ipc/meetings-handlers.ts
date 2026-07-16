/**
 * Meetings IPC Handlers
 *
 * Handles meeting-related IPC communication using the Result pattern.
 */

import { ipcMain } from 'electron'
import {
  getMeetingById,
  updateMeeting,
  addMeetingAttendee,
  removeMeetingAttendee,
  EntityVisibilityUnavailableError,
  Contact
} from '../services/database'
import { success, error, Result } from '../types/api'
import { z } from 'zod'
import { UUIDSchema, OptionalStringSchema } from '../validation/common'

const UpdateMeetingRequestSchema = z.object({
  id: UUIDSchema,
  subject: z.string().min(1).max(1000).optional(),
  start_time: z.string().optional(),
  end_time: z.string().optional(),
  location: OptionalStringSchema,
  description: OptionalStringSchema,
  organizer_name: OptionalStringSchema,
  // Allow a valid email, an empty string (clear), or null.
  organizer_email: z.union([z.string().email().max(500), z.literal('')]).nullable().optional()
}).refine(
  (data) =>
    data.subject !== undefined ||
    data.start_time !== undefined ||
    data.end_time !== undefined ||
    data.location !== undefined ||
    data.description !== undefined ||
    data.organizer_name !== undefined ||
    data.organizer_email !== undefined,
  { message: 'At least one field must be provided' }
)

const AddAttendeeRequestSchema = z
  .object({
    meetingId: UUIDSchema,
    name: z.string().min(1).max(500).optional(),
    email: z.string().email().max(500).optional()
  })
  .refine((data) => data.name !== undefined || data.email !== undefined, {
    message: 'At least one of name or email is required'
  })

const RemoveAttendeeRequestSchema = z.object({
  meetingId: UUIDSchema,
  contactId: UUIDSchema
})

export function registerMeetingsHandlers(): void {
  /**
   * Update meeting details (title, times, location, description, organizer)
   */
  ipcMain.handle(
    'meetings:update',
    async (_, request: unknown): Promise<Result<any>> => {
      try {
        const parsed = UpdateMeetingRequestSchema.safeParse(request)
        if (!parsed.success) {
          return error('VALIDATION_ERROR', 'Invalid update request', parsed.error.format())
        }

        const { id, ...updates } = parsed.data
        const meeting = getMeetingById(id)
        if (!meeting) {
          return error('NOT_FOUND', `Meeting with ID ${id} not found`)
        }

        updateMeeting(id, updates)

        const updatedMeeting = getMeetingById(id)
        return success(updatedMeeting)
      } catch (err) {
        console.error('meetings:update error:', err)
        return error('DATABASE_ERROR', 'Failed to update meeting', err)
      }
    }
  )

  /**
   * Add an attendee to a meeting (upserts + links the contact, regenerates JSON)
   */
  ipcMain.handle(
    'meetings:addAttendee',
    async (_, request: unknown): Promise<Result<Contact>> => {
      try {
        const parsed = AddAttendeeRequestSchema.safeParse(request)
        if (!parsed.success) {
          return error('VALIDATION_ERROR', 'Invalid addAttendee request', parsed.error.format())
        }

        const { meetingId, name, email } = parsed.data
        if (!getMeetingById(meetingId)) {
          return error('NOT_FOUND', `Meeting with ID ${meetingId} not found`)
        }

        const contact = addMeetingAttendee(meetingId, { name, email })
        return success(contact)
      } catch (err) {
        // ADV37-1 (round-39) — a fail-closed visibility lookup aborts the write; surface
        // it as RETRYABLE so a transient DB fault never persists a reanimating link.
        if (err instanceof EntityVisibilityUnavailableError) {
          return error('RETRYABLE_ERROR', 'Could not verify this attendee. Please try again.')
        }
        console.error('meetings:addAttendee error:', err)
        return error('DATABASE_ERROR', 'Failed to add attendee', err)
      }
    }
  )

  /**
   * Remove an attendee link from a meeting (regenerates attendees JSON)
   */
  ipcMain.handle(
    'meetings:removeAttendee',
    async (_, request: unknown): Promise<Result<void>> => {
      try {
        const parsed = RemoveAttendeeRequestSchema.safeParse(request)
        if (!parsed.success) {
          return error('VALIDATION_ERROR', 'Invalid removeAttendee request', parsed.error.format())
        }

        const { meetingId, contactId } = parsed.data
        if (!getMeetingById(meetingId)) {
          return error('NOT_FOUND', `Meeting with ID ${meetingId} not found`)
        }

        removeMeetingAttendee(meetingId, contactId)
        return success(undefined)
      } catch (err) {
        console.error('meetings:removeAttendee error:', err)
        return error('DATABASE_ERROR', 'Failed to remove attendee', err)
      }
    }
  )
}
