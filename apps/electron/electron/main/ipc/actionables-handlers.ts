
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
      run('UPDATE actionables SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?', [status, id])
      return { success: true }
    } catch (error) {
      console.error('Failed to update actionable status:', error)
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
    artifactId: row.artifact_id,
    generatedAt: row.generated_at,
    sharedAt: row.shared_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  }
}
