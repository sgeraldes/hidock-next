/**
 * Meetings IPC Handlers
 *
 * Handles meeting-related IPC communication using the Result pattern.
 */

import { ipcMain } from 'electron'
import { getMeetingById, updateMeeting } from '../services/database'
import { success, error, Result } from '../types/api'
import { z } from 'zod'
import { UUIDSchema, OptionalStringSchema } from '../validation/common'

const UpdateMeetingRequestSchema = z.object({
  id: UUIDSchema,
  subject: z.string().min(1).max(1000).optional(),
  start_time: z.string().optional(),
  end_time: z.string().optional(),
  location: OptionalStringSchema,
  description: OptionalStringSchema
}).refine(
  (data) => data.subject !== undefined || data.start_time !== undefined || data.end_time !== undefined || data.location !== undefined || data.description !== undefined,
  { message: 'At least one field must be provided' }
)

export function registerMeetingsHandlers(): void {
  /**
   * Update meeting details (title, times, location, description)
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
}
