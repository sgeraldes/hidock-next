/**
 * Contacts IPC Handlers
 *
 * Handles all contact-related IPC communication using the Result pattern.
 */

import { ipcMain } from 'electron'
import { z } from 'zod'
import {
  getContacts,
  getContactById,
  getContactByName,
  createContact,
  updateContact,
  deleteContact,
  getMeetingsForContact,
  getContactsForMeeting,
  getContactsForMeetingOwner,
  mergeContacts,
  unmergeContacts,
  filterVisibleEntityIds,
  blankIneligibleContactFields,
  UnmergeResult,
  Contact
} from '../services/database'
import { getEventBus } from '../services/event-bus'
import { success, error, Result } from '../types/api'
import {
  GetContactsRequestSchema,
  GetContactByIdRequestSchema,
  CreateContactRequestSchema,
  UpdateContactRequestSchema,
  DeleteContactRequestSchema,
  MergeContactsRequestSchema
} from '../validation/contacts'
import type { Person } from '@/types/knowledge'
import type { Meeting } from '../services/database'

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

        const { search, type, limit, offset } = parsed.data
        const result = getContacts(search, type, limit, offset)

        // ADV27-1 (round-28) — People is a NON-OWNER identity surface: a
        // transcript-created contact ENTITY whose sole source recording is
        // excluded (personal/soft-deleted/value-excluded/hard-purged) must not stay
        // searchable/listed here. Route the page through the central visible-identity
        // boundary (manual/calendar entities always survive; fail-closed). The total
        // is left as the raw count (an over-count is a benign display artifact, never
        // a leak — the suppressed rows themselves never cross the boundary).
        const { visible } = filterVisibleEntityIds('contact', result.contacts.map((c) => c.id))
        const contacts = result.contacts.filter((c) => visible.has(c.id))

        // ADV29-2 (round-31) — a contact kept visible by an eligible recording can
        // still carry a `role` enriched from an excluded one; blank it fail-closed.
        return success({
          contacts: blankIneligibleContactFields(contacts).map(mapToPerson),
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
    async (_, id: unknown): Promise<Result<{ contact: Person; meetings: Meeting[]; totalMeetingTimeMinutes: number }>> => {
      try {
        const parsed = GetContactByIdRequestSchema.safeParse({ id })
        if (!parsed.success) {
          return error('VALIDATION_ERROR', 'Invalid contact ID', parsed.error.format())
        }

        const contact = getContactById(parsed.data.id)
        if (!contact) {
          return error('NOT_FOUND', `Contact with ID ${parsed.data.id} not found`)
        }

        // ADV27-1 (round-28) — POINT read on the same non-owner surface. A
        // transcript-created contact whose provenance is fully excluded is treated
        // as absent (NOT_FOUND), consistent with its suppression from the list;
        // manual/calendar contacts pass. Fail-closed.
        const { visible } = filterVisibleEntityIds('contact', [parsed.data.id])
        if (!visible.has(parsed.data.id)) {
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

        // ADV29-2 (round-31) — blank a transcript-enriched role whose source
        // recording is ineligible even though the entity itself stays visible.
        const [safeContact] = blankIneligibleContactFields([contact])
        return success({
          contact: mapToPerson(safeContact),
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
   * Create a new contact (manual "Add Person"). Guards against an exact
   * (case-insensitive) name collision so the user opens the existing contact
   * rather than silently minting a twin — the renderer surfaces the existing id.
   */
  ipcMain.handle(
    'contacts:create',
    async (_, request: unknown): Promise<Result<Person>> => {
      try {
        const parsed = CreateContactRequestSchema.safeParse(request)
        if (!parsed.success) {
          return error('VALIDATION_ERROR', 'Invalid create request', parsed.error.format())
        }

        const name = parsed.data.name.trim()
        const existing = getContactByName(name)
        if (existing) {
          return error('DUPLICATE_ENTRY', `A contact named ${existing.name} already exists`, {
            existingId: existing.id,
            existingName: existing.name
          })
        }

        const created = createContact({
          name,
          email: parsed.data.email ?? null,
          type: parsed.data.type,
          role: parsed.data.role ?? null,
          company: parsed.data.company ?? null
        })

        return success(mapToPerson(created))
      } catch (err) {
        console.error('contacts:create error:', err)
        return error('DATABASE_ERROR', 'Failed to create contact', err)
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

        const { id, tags, name, email, ...otherUpdates } = parsed.data
        const contact = getContactById(id)
        if (!contact) {
          return error('NOT_FOUND', `Contact with ID ${id} not found`)
        }

        const updates: Partial<Contact> = { ...otherUpdates }
        if (tags) {
          updates.tags = JSON.stringify(tags)
        }
        if (name !== undefined) {
          updates.name = name
        }
        if (email !== undefined) {
          updates.email = email
        }

        updateContact(id, updates)

        const updatedContact = getContactById(id)

        // Living knowledge graph (v27): a rename re-keys the person's graph node.
        if (name !== undefined && updatedContact && contact.name !== updatedContact.name) {
          try {
            getEventBus().emitDomainEvent({
              type: 'entity:contact-changed',
              timestamp: new Date().toISOString(),
              payload: {
                contactId: id,
                change: 'updated',
                oldName: contact.name,
                newName: updatedContact.name
              }
            })
          } catch (e) {
            console.warn('[contacts:update] contact-changed emit failed:', e)
          }
        }

        return success(mapToPerson(updatedContact!))
      } catch (err) {
        console.error('contacts:update error:', err)
        return error('DATABASE_ERROR', 'Failed to update contact', err)
      }
    }
  )

  /**
   * Delete contact and all meeting associations
   */
  ipcMain.handle(
    'contacts:delete',
    async (_, id: unknown): Promise<Result<void>> => {
      try {
        const parsed = DeleteContactRequestSchema.safeParse({ id })
        if (!parsed.success) {
          return error('VALIDATION_ERROR', 'Invalid contact ID', parsed.error.format())
        }

        const contact = getContactById(parsed.data.id)
        if (!contact) {
          return error('NOT_FOUND', `Contact with ID ${parsed.data.id} not found`)
        }

        deleteContact(parsed.data.id)

        return success(undefined)
      } catch (err) {
        console.error('contacts:delete error:', err)
        return error('DATABASE_ERROR', 'Failed to delete contact', err)
      }
    }
  )

  /**
   * Merge one contact into another. The keeper survives; the loser's links are
   * repointed, useful fields folded in, and the loser row deleted.
   */
  ipcMain.handle(
    'contacts:merge',
    async (_, request: unknown): Promise<Result<Person>> => {
      try {
        const parsed = MergeContactsRequestSchema.safeParse(request)
        if (!parsed.success) {
          return error('VALIDATION_ERROR', 'Invalid merge request', parsed.error.format())
        }

        const { keeperId, loserId } = parsed.data
        if (keeperId === loserId) {
          return error('VALIDATION_ERROR', 'Cannot merge a contact into itself')
        }
        if (!getContactById(keeperId)) {
          return error('NOT_FOUND', `Keeper contact ${keeperId} not found`)
        }
        if (!getContactById(loserId)) {
          return error('NOT_FOUND', `Loser contact ${loserId} not found`)
        }

        const merged = mergeContacts(keeperId, loserId)
        return success(mapToPerson(merged))
      } catch (err) {
        console.error('contacts:merge error:', err)
        return error('DATABASE_ERROR', 'Failed to merge contacts', err)
      }
    }
  )

  /**
   * Reverse a contact merge from its merge_journal id. Recreates the loser,
   * repoints the journaled links back, and returns restore counts plus the list
   * of links that appeared after the merge for the user to reassign by hand.
   */
  ipcMain.handle('contacts:unmerge', async (_, journalId: unknown): Promise<Result<UnmergeResult>> => {
    try {
      const parsed = z.string().min(1).max(200).safeParse(journalId)
      if (!parsed.success) {
        return error('VALIDATION_ERROR', 'Invalid journal id', parsed.error.format())
      }
      return success(unmergeContacts(parsed.data))
    } catch (err) {
      console.error('contacts:unmerge error:', err)
      return error('DATABASE_ERROR', err instanceof Error ? err.message : 'Failed to unmerge contacts', err)
    }
  })

  /**
   * Get contacts for a specific meeting — GATED default (ASSISTANT / hover / Today
   * tier). R28-RES-1 (round-29): the membership rows are filtered fail-closed
   * through filterEligibleMembershipRows inside getContactsForMeeting, so a
   * transcript-extracted attendee from an excluded recording never surfaces here.
   * EntityHoverCards / CalendarTooltips / Today consume this via
   * meeting-participants.ts.
   */
  ipcMain.handle(
    'contacts:getForMeeting',
    async (_, meetingId: unknown): Promise<Result<Person[]>> => {
      try {
        if (typeof meetingId !== 'string') {
          return error('VALIDATION_ERROR', 'Meeting ID must be a string')
        }

        // ADV29-2 (round-31) — assistant/hover tier: blank a transcript-enriched
        // role whose source recording is ineligible (the participant may stay via a
        // structural/eligible membership while its role came from an excluded one).
        const contacts = blankIneligibleContactFields(getContactsForMeeting(meetingId))
        return success(contacts.map(mapToPerson))
      } catch (err) {
        console.error('contacts:getForMeeting error:', err)
        return error('DATABASE_ERROR', 'Failed to fetch contacts for meeting', err)
      }
    }
  )

  /**
   * R28-RES-1 (round-29) — OWNER-MANAGEMENT meeting participants (existence-scoped).
   * Repointed ONLY by MeetingDetail + SourceReader/useReaderPeople so the owner sees
   * every participant of their OWN meeting, including ones derived from an excluded
   * recording. NOT used by any assistant/Today surface (those stay on the gated
   * default above).
   */
  ipcMain.handle(
    'contacts:getForMeetingOwner',
    async (_, meetingId: unknown): Promise<Result<Person[]>> => {
      try {
        if (typeof meetingId !== 'string') {
          return error('VALIDATION_ERROR', 'Meeting ID must be a string')
        }

        const contacts = getContactsForMeetingOwner(meetingId)
        return success(contacts.map(mapToPerson))
      } catch (err) {
        console.error('contacts:getForMeetingOwner error:', err)
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