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
  updateActionItem,
  getDecisionById,
  updateDecision,
  getCaptureIdsForRecording,
  getActionItemsForCaptureIds,
  getDecisionsForCaptureIds,
  getRecordingById,
  resolveRecordingId,
  filterVisibleEntityIds,
  runInTransaction,
  ActionItem,
  DecisionRow
} from '../services/database'
import { filterEligibleCaptureIds, isRecordingEligible } from '../services/recording-eligibility'
import { success, error, Result } from '../types/api'
import { z } from 'zod'
import { UUIDSchema } from '../validation/common'

const SetAssigneeRequestSchema = z.object({
  actionItemId: UUIDSchema,
  contactId: UUIDSchema.nullable()
})

const ACTION_ITEM_STATUSES = ['pending', 'in_progress', 'completed', 'cancelled'] as const
const ACTION_ITEM_PRIORITIES = ['low', 'medium', 'high', 'urgent'] as const

const UpdateActionItemRequestSchema = z.object({
  actionItemId: UUIDSchema,
  content: z.string().trim().min(1).max(4000).optional(),
  status: z.enum(ACTION_ITEM_STATUSES).optional(),
  dueDate: z.string().max(64).nullable().optional(),
  priority: z.enum(ACTION_ITEM_PRIORITIES).optional()
})

const UpdateDecisionRequestSchema = z.object({
  decisionId: UUIDSchema,
  content: z.string().trim().min(1).max(4000).optional(),
  context: z.string().max(4000).nullable().optional()
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

  /**
   * First-class action items + decisions for a recording (reader event-list
   * detail surface). DISPLAY read boundary (same ADV17-1 rule as
   * getTimelineAnalysis): an ineligible recording returns EMPTY lists, never
   * suppressed content.
   */
  ipcMain.handle(
    'actionItems:getForRecording',
    async (_, recordingId: unknown): Promise<Result<{ actionItems: ActionItem[]; decisions: DecisionRow[] }>> => {
      try {
        const parsed = z.string().min(1).max(200).safeParse(recordingId)
        if (!parsed.success) {
          return error('VALIDATION_ERROR', 'Invalid recording id')
        }
        if (!isRecordingEligible(parsed.data)) {
          return success({ actionItems: [], decisions: [] })
        }
        // Canonicalize (alias ids resolve to the persisted recording id).
        const canonical = getRecordingById(parsed.data) ?? resolveRecordingId(parsed.data)
        const captureIds = getCaptureIdsForRecording(canonical?.id ?? parsed.data)
        return success({
          actionItems: getActionItemsForCaptureIds(captureIds),
          decisions: getDecisionsForCaptureIds(captureIds)
        })
      } catch (err) {
        console.error('actionItems:getForRecording error:', err)
        return error('DATABASE_ERROR', 'Failed to fetch action items', err)
      }
    }
  )

  /**
   * Edit an action item's user-facing fields (content / status / due date /
   * priority). Same ADV38-1 gating as setAssignee: the item's source capture
   * must be eligible, checked in the SAME synchronous transaction as the write.
   */
  ipcMain.handle(
    'actionItems:update',
    async (_, request: unknown): Promise<Result<ActionItem>> => {
      try {
        const parsed = UpdateActionItemRequestSchema.safeParse(request)
        if (!parsed.success) {
          return error('VALIDATION_ERROR', 'Invalid update request', parsed.error.format())
        }
        const { actionItemId, content, status, dueDate, priority } = parsed.data

        return runInTransaction((): Result<ActionItem> => {
          const item = getActionItemById(actionItemId)
          if (!item) {
            return error('NOT_FOUND', 'Action item not found')
          }
          const capElig = filterEligibleCaptureIds([item.knowledge_capture_id])
          if (capElig.failClosed || !capElig.eligible.has(item.knowledge_capture_id)) {
            return error('ACTIONABLE_INELIGIBLE', 'Action item not available')
          }
          const updated = updateActionItem(actionItemId, { content, status, dueDate, priority })
          return success(updated)
        })
      } catch (err) {
        console.error('actionItems:update error:', err)
        return error('DATABASE_ERROR', 'Failed to update action item', err)
      }
    }
  )

  /**
   * Edit a decision's user-facing fields (content / context). Same gating as
   * actionItems:update, via the decision's source capture.
   */
  ipcMain.handle(
    'decisions:update',
    async (_, request: unknown): Promise<Result<DecisionRow>> => {
      try {
        const parsed = UpdateDecisionRequestSchema.safeParse(request)
        if (!parsed.success) {
          return error('VALIDATION_ERROR', 'Invalid update request', parsed.error.format())
        }
        const { decisionId, content, context } = parsed.data

        return runInTransaction((): Result<DecisionRow> => {
          const row = getDecisionById(decisionId)
          if (!row) {
            return error('NOT_FOUND', 'Decision not found')
          }
          const capElig = filterEligibleCaptureIds([row.knowledge_capture_id])
          if (capElig.failClosed || !capElig.eligible.has(row.knowledge_capture_id)) {
            return error('ACTIONABLE_INELIGIBLE', 'Decision not available')
          }
          const updated = updateDecision(decisionId, { content, context })
          return success(updated)
        })
      } catch (err) {
        console.error('decisions:update error:', err)
        return error('DATABASE_ERROR', 'Failed to update decision', err)
      }
    }
  )
}
