/**
 * Action Items IPC Handlers
 *
 * Handles action-item editability using the Result pattern. Round 3a adds the
 * assignee → canonical-contact binding (action_items.assignee_contact_id, v26).
 */

import { ipcMain } from 'electron'
import { getContactById, setActionItemAssignee, ActionItem } from '../services/database'
import { success, error, Result } from '../types/api'
import { z } from 'zod'
import { UUIDSchema } from '../validation/common'

const SetAssigneeRequestSchema = z.object({
  actionItemId: UUIDSchema,
  contactId: UUIDSchema.nullable()
})

export function registerActionItemsHandlers(): void {
  /**
   * Bind (or clear) the canonical contact for an action item's assignee.
   * Pass contactId: null to clear the binding.
   */
  ipcMain.handle(
    'actionItems:setAssignee',
    async (_, request: unknown): Promise<Result<ActionItem>> => {
      try {
        const parsed = SetAssigneeRequestSchema.safeParse(request)
        if (!parsed.success) {
          return error('VALIDATION_ERROR', 'Invalid setAssignee request', parsed.error.format())
        }

        const { actionItemId, contactId } = parsed.data
        if (contactId && !getContactById(contactId)) {
          return error('NOT_FOUND', `Contact ${contactId} not found`)
        }

        const updated = setActionItemAssignee(actionItemId, contactId)
        return success(updated)
      } catch (err) {
        console.error('actionItems:setAssignee error:', err)
        return error('DATABASE_ERROR', 'Failed to set action item assignee', err)
      }
    }
  )
}
