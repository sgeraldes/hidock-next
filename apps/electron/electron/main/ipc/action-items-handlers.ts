/**
 * Action Items IPC Handlers
 *
 * Handles action-item editability using the Result pattern. Round 3a adds the
 * assignee → canonical-contact binding (action_items.assignee_contact_id, v26).
 */

import { ipcMain } from 'electron'
import {
  getActionItemById,
  setActionItemAssignee,
  filterVisibleEntityIds,
  runInTransaction,
  ActionItem
} from '../services/database'
import { filterEligibleCaptureIds } from '../services/recording-eligibility'
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
   *
   * ADV38-1 (round-40) — an action item is a DERIVATIVE of its source capture
   * (action_items.knowledge_capture_id), which in turn may derive from a
   * recording. A renderer holding a STALE action-item id could otherwise mark the
   * source recording personal / soft-deleted / value-excluded, then call this to
   * (a) read back the excluded item's FULL content, and (b) persist a SUPPRESSED
   * contact as the assignee. Both are closed here, fail-closed, in ONE synchronous
   * transaction (no await between the eligibility check and the write):
   *   • the item's source capture MUST be eligible via filterEligibleCaptureIds
   *     (which inherits the source recording's personal/deleted/value/purge
   *     exclusion) — else the item's content is excluded and is neither read,
   *     updated, nor returned; and
   *   • a non-null contactId MUST be VISIBLE via filterVisibleEntityIds('contact')
   *     — a suppressed contact is never persisted as an assignee.
   * On ANY lookup failure we refuse (never return the row content). Ineligible
   * results carry a generic code (ACTIONABLE_INELIGIBLE / CONTACT_INELIGIBLE) and
   * NO sensitive payload.
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

        // BOTH checks + the UPDATE happen in one synchronous transaction so there is
        // no TOCTOU await gap between verifying eligibility and mutating/returning.
        return runInTransaction((): Result<ActionItem> => {
          const item = getActionItemById(actionItemId)
          if (!item) {
            // Non-existent (or hard-purged via capture cascade) ⇒ generic not-found.
            return error('NOT_FOUND', 'Action item not found')
          }

          // (a) Source capture must be eligible; else the item's content is excluded
          // and must not be read/updated/returned. Fail-closed refuses too.
          const capElig = filterEligibleCaptureIds([item.knowledge_capture_id])
          if (capElig.failClosed || !capElig.eligible.has(item.knowledge_capture_id)) {
            return error('ACTIONABLE_INELIGIBLE', 'Action item not available')
          }

          // (b) A non-null contact reference must be VISIBLE — never persist a
          // suppressed contact as an assignee. Fail-closed refuses too.
          if (contactId) {
            const vis = filterVisibleEntityIds('contact', [contactId])
            if (vis.failClosed || !vis.visible.has(contactId)) {
              return error('CONTACT_INELIGIBLE', 'Contact not available')
            }
          }

          const updated = setActionItemAssignee(actionItemId, contactId)
          return success(updated)
        })
      } catch (err) {
        console.error('actionItems:setAssignee error:', err)
        return error('DATABASE_ERROR', 'Failed to set action item assignee', err)
      }
    }
  )
}
