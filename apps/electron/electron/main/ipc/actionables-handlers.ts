
import { ipcMain } from 'electron'
import { queryAll, run } from '../services/database'
import type { Actionable } from '@/types/knowledge'

export function registerActionablesHandlers(): void {
  // Get all actionables
  ipcMain.handle('actionables:getAll', async (_, { status }: { status?: string } = {}) => {
    try {
      let sql = 'SELECT * FROM actionables'
      const params: any[] = []
      
      if (status) {
        sql += ' WHERE status = ?'
        params.push(status)
      }
      
      sql += ' ORDER BY created_at DESC'
      
      const rows = queryAll<any>(sql, params)
      return rows.map(mapToActionable)
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

      // Define valid transitions
      const validTransitions: Record<string, string[]> = {
        'pending': ['in_progress', 'dismissed'],
        'in_progress': ['generated', 'pending'],
        'generated': ['shared', 'pending'],
        'shared': [],
        'dismissed': ['pending']
      }

      const allowedTransitions = validTransitions[actionable.status] || []
      if (!allowedTransitions.includes(status)) {
        return {
          success: false,
          error: `Invalid status transition: ${actionable.status} → ${status}`
        }
      }

      run('UPDATE actionables SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?', [status, id])
      return { success: true }
    } catch (error) {
      console.error('Failed to update actionable status:', error)
      return { success: false, error: (error as Error).message }
    }
  })

  // Generate output from actionable (approval workflow)
  ipcMain.handle('actionables:generateOutput', async (_, actionableId: string) => {
    try {
      const actionable = queryAll<any>('SELECT * FROM actionables WHERE id = ?', [actionableId])[0]

      if (!actionable) {
        return { success: false, error: `Actionable ${actionableId} not found` }
      }

      if (actionable.status !== 'pending') {
        return { success: false, error: 'Only pending actionables can be generated' }
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
