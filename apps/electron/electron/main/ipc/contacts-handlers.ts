/**
 * Contacts IPC Handlers
 *
 * Handles all contact-related IPC communication using the Result pattern.
 */

import { ipcMain } from 'electron'
import {
  getContacts,
  getContactById,
  updateContact,
  getMeetingsForContact,
  getContactsForMeeting,
  Contact
} from '../services/database'
import { success, error, Result } from '../types/api'
import {
  GetContactsRequestSchema,
  GetContactByIdRequestSchema,
  UpdateContactRequestSchema
} from '../validation/contacts'
import type { ContactWithMeetings } from '../types/database'
import type { GetContactsResponse } from '../types/api'
import type { Person } from '../../src/types/knowledge'

export function registerContactsHandlers(): void {
  /**
   * Get all contacts with optional search and pagination
   */
  ipcMain.handle(
    'contacts:getAll',
    async (_, request?: unknown): Promise<Result<{ contacts: Person[]; total: number }>> => {
      try {
        const parsed = GetContactsRequestSchema.safeParse(request ?? {})
        if (!parsed.success) {
          return error('VALIDATION_ERROR', 'Invalid request parameters', parsed.error.format())
        }

        const { search, limit, offset } = parsed.data
        const result = getContacts(search, limit, offset)

        return success({
          contacts: result.contacts.map(mapToPerson),
          total: result.total
        })
      } catch (err) {
        console.error('contacts:getAll error:', err)
        return error('DATABASE_ERROR', 'Failed to fetch contacts', err)
      }
    }
  )

  /**
   * Get contact by ID with associated meetings
   */
  ipcMain.handle(
    'contacts:getById',
    async (_, id: unknown): Promise<Result<{ contact: Person; meetings: any[]; totalMeetingTimeMinutes: number }>> => {
      try {
        const parsed = GetContactByIdRequestSchema.safeParse({ id })
        if (!parsed.success) {
          return error('VALIDATION_ERROR', 'Invalid contact ID', parsed.error.format())
        }

        const contact = getContactById(parsed.data.id)
        if (!contact) {
          return error('NOT_FOUND', `Contact with ID ${parsed.data.id} not found`)
        }

        const meetings = getMeetingsForContact(parsed.data.id)

        // Calculate total meeting time
        let totalMeetingTimeMinutes = 0
        for (const meeting of meetings) {
          const start = new Date(meeting.start_time).getTime()
          const end = new Date(meeting.end_time).getTime()
          totalMeetingTimeMinutes += Math.round((end - start) / 60000)
        }

        return success({
          contact: mapToPerson(contact),
          meetings,
          totalMeetingTimeMinutes
        })
      } catch (err) {
        console.error('contacts:getById error:', err)
        return error('DATABASE_ERROR', 'Failed to fetch contact', err)
      }
    }
  )

  /**
   * Update contact
   */
  ipcMain.handle(
    'contacts:update',
    async (_, request: unknown): Promise<Result<Person>> => {
      try {
        const parsed = UpdateContactRequestSchema.safeParse(request)
        if (!parsed.success) {
          return error('VALIDATION_ERROR', 'Invalid update request', parsed.error.format())
        }

        const { id, tags, ...otherUpdates } = parsed.data
        const contact = getContactById(id)
        if (!contact) {
          return error('NOT_FOUND', `Contact with ID ${id} not found`)
        }

        const updates: Partial<Contact> = { ...otherUpdates }
        if (tags) {
          updates.tags = JSON.stringify(tags)
        }

        updateContact(id, updates)

        const updatedContact = getContactById(id)
        return success(mapToPerson(updatedContact!))
      } catch (err) {
        console.error('contacts:update error:', err)
        return error('DATABASE_ERROR', 'Failed to update contact', err)
      }
    }
  )

  /**
   * Get contacts for a specific meeting
   */
  ipcMain.handle(
    'contacts:getForMeeting',
    async (_, meetingId: unknown): Promise<Result<Person[]>> => {
      try {
        if (typeof meetingId !== 'string') {
          return error('VALIDATION_ERROR', 'Meeting ID must be a string')
        }

        const contacts = getContactsForMeeting(meetingId)
        return success(contacts.map(mapToPerson))
      } catch (err) {
        console.error('contacts:getForMeeting error:', err)
        return error('DATABASE_ERROR', 'Failed to fetch contacts for meeting', err)
      }
    }
  )
}

function mapToPerson(contact: Contact): Person {
  let tags: string[] = []
  if (contact.tags) {
    try {
      tags = JSON.parse(contact.tags)
    } catch {
      tags = []
    }
  }

  return {
    id: contact.id,
    name: contact.name,
    email: contact.email,
    type: contact.type as any,
    role: contact.role,
    company: contact.company,
    notes: contact.notes,
    tags,
    firstSeenAt: contact.first_seen_at,
    lastSeenAt: contact.last_seen_at,
    interactionCount: contact.meeting_count,
    createdAt: contact.created_at
  }
}