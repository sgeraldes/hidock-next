
import { ipcMain } from 'electron'
import { queryAll, run } from '../services/database'
import { filterEligibleActionableRows } from '../services/actionable-eligibility'
import type { Actionable } from '@/types/knowledge'

/**
 * ADV15 (round-16) — actionables lists route through the ONE shared capture-aware
 * boundary {@link filterEligibleActionableRows}. It resolves each row's
 * `source_knowledge_id` to a live capture (gated via filterEligibleCaptureIds:
 * deleted_at + recording-derived delegation + standalone quality) or, for legacy
 * rows, a recording id (filterEligibleRecordingIds); truly standalone actionables
 * (null source) are kept. This replaces the round-7 per-handler predicate that
 * unconditionally kept null-source (standalone) captures (ADV15-3).
 */
const gateActionables = <T extends { source_knowledge_id?: string | null }>(rows: T[]): T[] =>
  filterEligibleActionableRows(rows, (r) => r.source_knowledge_id)

/**
 * ADV38 sweep (round-40) — single-row eligibility gate for a MUTATION reached by a
 * (possibly stale) actionable id. An actionable is a capture-derived derivative; a
 * renderer holding a stale id could mark its source recording personal / delete /
 * rate-low-value / trash the capture, then still hit a per-id mutation that reads
 * back derived metadata (source_knowledge_id / suggested_template) or writes the
 * excluded derivative. Route the row through the SAME shared actionable boundary
 * (fail-closed) so an excluded/orphaned source refuses. Returns true iff the row
 * is still eligible to read/mutate.
 */
const isActionableEligible = (row: { source_knowledge_id?: string | null }): boolean =>
  filterEligibleActionableRows([row], (r) => r.source_knowledge_id).length > 0

export function registerActionablesHandlers(): void {
  // Get all actionables
  ipcMain.handle('actionables:getAll', async (_, options?: { status?: string }) => {
    const status = options?.status
    try {
      let sql = 'SELECT * FROM actionables'
      const params: any[] = []

      if (status) {
        sql += ' WHERE status = ?'
        params.push(status)
      }

      sql += ' ORDER BY created_at DESC'

      const rows = queryAll<any>(sql, params)
      return gateActionables(rows).map(mapToActionable)
    } catch (error) {
      console.error('Failed to get actionables:', error)
      return []
    }
  })

  // Update status
  ipcMain.handle('actionables:updateStatus', async (_, id: string, status: string) => {
    try {
      // Validate status transition
      const actionable = queryAll<any>('SELECT * FROM actionables WHERE id = ?', [id])[0]
      if (!actionable) {
        return { success: false, error: `Actionable ${id} not found` }
      }

      // ADV38 sweep (round-40) — refuse a stale-id status write whose source
      // recording/capture became excluded (personal/deleted/value-excluded/
      // hard-purged) or whose eligibility can't be verified. Generic not-found so
      // the excluded derivative's existence is not disclosed; no output cleanup or
      // status write happens on an excluded row.
      if (!isActionableEligible(actionable)) {
        return { success: false, error: `Actionable ${id} not found` }
      }

      // Idempotent: setting the status it already has is a no-op success. The
      // approve flow calls updateStatus('generated') as a safety net after
      // outputs:generate has already set 'generated' inside its transaction;
      // without this, that redundant call hit the "generated → generated"
      // invalid-transition branch and returned a spurious error.
      if (actionable.status === status) {
        return { success: true }
      }

      // C-ACT-001: Relaxed status transition validation
      // Allow pending->generated for direct completion, generated->pending for re-processing
      const validTransitions: Record<string, string[]> = {
        'pending': ['in_progress', 'generated', 'dismissed'],
        'in_progress': ['generated', 'pending'],
        'generated': ['shared', 'pending', 'dismissed'],
        'shared': ['pending'],
        'dismissed': ['pending']
      }

      const allowedTransitions = validTransitions[actionable.status] || []
      if (!allowedTransitions.includes(status)) {
        return {
          success: false,
          error: `Invalid status transition: ${actionable.status} → ${status}`
        }
      }

      // C-ACT-002: Clean up generated outputs when transitioning away from 'generated'
      // When dismissing or reverting to pending, remove the associated output artifact
      if ((status === 'dismissed' || status === 'pending') && actionable.artifact_id) {
        try {
          run('DELETE FROM outputs WHERE id = ?', [actionable.artifact_id])
          run('UPDATE actionables SET artifact_id = NULL, generated_at = NULL WHERE id = ?', [id])
        } catch (cleanupError) {
          console.warn('[actionables:updateStatus] Failed to clean up output:', cleanupError)
          // Continue with status update even if cleanup fails
        }
      }

      run('UPDATE actionables SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?', [status, id])
      return { success: true }
    } catch (error) {
      console.error('Failed to update actionable status:', error)
      return { success: false, error: (error as Error).message }
    }
  })

  // Get actionables by meeting ID
  ipcMain.handle('actionables:getByMeeting', async (_, meetingId: string) => {
    try {
      // AUD2-001: Query actionables through multiple paths:
      // Path 1: Direct - knowledge_captures.meeting_id matches
      // Path 2: Indirect - through recordings that belong to the meeting
      const sql = `
        SELECT DISTINCT a.*
        FROM actionables a
        INNER JOIN knowledge_captures kc ON a.source_knowledge_id = kc.id
        LEFT JOIN recordings r ON kc.source_recording_id = r.id
        WHERE kc.meeting_id = ?
           OR r.meeting_id = ?
        ORDER BY a.created_at DESC
      `
      const rows = gateActionables(queryAll<any>(sql, [meetingId, meetingId]))

      // Log for debugging when no actionables found
      if (rows.length === 0) {
        console.log(`[actionables:getByMeeting] No actionables found for meeting ${meetingId}`)

        // Debug query to understand why
        const debugSql = `
          SELECT
            COUNT(DISTINCT a.id) as actionable_count,
            COUNT(DISTINCT CASE WHEN kc.meeting_id = ? THEN a.id END) as direct_match,
            COUNT(DISTINCT CASE WHEN r.meeting_id = ? THEN a.id END) as via_recording
          FROM actionables a
          INNER JOIN knowledge_captures kc ON a.source_knowledge_id = kc.id
          LEFT JOIN recordings r ON kc.source_recording_id = r.id
        `
        const debug = queryAll<any>(debugSql, [meetingId, meetingId])[0]
        console.log(`[actionables:getByMeeting] Debug stats:`, debug)
      }

      return rows.map(mapToActionable)
    } catch (error) {
      console.error('Failed to get actionables for meeting:', error)
      return []
    }
  })

  // Generate output from actionable (approval workflow)
  ipcMain.handle('actionables:generateOutput', async (_, actionableId: string) => {
    try {
      const actionable = queryAll<any>('SELECT * FROM actionables WHERE id = ?', [actionableId])[0]

      if (!actionable) {
        return { success: false, error: `Actionable ${actionableId} not found` }
      }

      // ADV38 sweep (round-40) — refuse before reading back derived metadata
      // (source_knowledge_id / suggested_template) or flipping status when the
      // source recording/capture is excluded or can't be verified. Generic
      // not-found; nothing derived is returned for an excluded actionable.
      if (!isActionableEligible(actionable)) {
        return { success: false, error: `Actionable ${actionableId} not found` }
      }

      // C-ACT-001: Allow regeneration from both 'pending' and 'generated' states
      if (actionable.status !== 'pending' && actionable.status !== 'generated') {
        return { success: false, error: `Cannot generate from '${actionable.status}' status. Must be 'pending' or 'generated'.` }
      }

      // Update status to in_progress
      run(
        'UPDATE actionables SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
        ['in_progress', actionableId]
      )

      // Return success - actual generation will be triggered by frontend calling outputs.generate
      return {
        success: true,
        data: {
          actionableId,
          sourceKnowledgeId: actionable.source_knowledge_id,
          suggestedTemplate: actionable.suggested_template
        }
      }
    } catch (error) {
      console.error('Failed to generate output:', error)

      // Revert to pending on failure
      try {
        run('UPDATE actionables SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?', ['pending', actionableId])
      } catch (revertError) {
        console.error('Failed to revert status:', revertError)
      }

      return { success: false, error: (error as Error).message }
    }
  })
}

function mapToActionable(row: any): Actionable {
  let recipients: string[] = []
  if (row.suggested_recipients) {
    try {
      recipients = JSON.parse(row.suggested_recipients)
    } catch {
      recipients = []
    }
  }

  return {
    id: row.id,
    type: row.type,
    title: row.title,
    description: row.description,
    sourceKnowledgeId: row.source_knowledge_id,
    sourceActionItemId: row.source_action_item_id,
    suggestedTemplate: row.suggested_template,
    suggestedRecipients: recipients,
    status: row.status,
    confidence: row.confidence,
    artifactId: row.artifact_id,
    generatedAt: row.generated_at,
    sharedAt: row.shared_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  }
}
