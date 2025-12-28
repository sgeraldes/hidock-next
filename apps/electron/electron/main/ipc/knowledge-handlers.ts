
import { ipcMain } from 'electron'
import { queryAll, queryOne, run } from '../services/database'
import type { KnowledgeCapture } from '@/types/knowledge'

export function registerKnowledgeHandlers(): void {
  // Get all knowledge captures
  ipcMain.handle('knowledge:getAll', async (_, { limit = 100, offset = 0, status, quality, category }: { limit?: number; offset?: number; status?: string; quality?: string; category?: string } = {}) => {
    let sql = `SELECT * FROM knowledge_captures`
    const conditions: string[] = []
    const params: (string | number)[] = []

    if (status) {
      conditions.push('status = ?')
      params.push(status)
    }
    if (quality) {
      conditions.push('quality_rating = ?')
      params.push(quality)
    }
    if (category) {
      conditions.push('category = ?')
      params.push(category)
    }

    if (conditions.length > 0) {
      sql += ` WHERE ${conditions.join(' AND ')}`
    }

    sql += ` ORDER BY captured_at DESC LIMIT ? OFFSET ?`
    params.push(limit, offset)

    try {
      const captures = queryAll<any>(sql, params)
      return captures.map(mapToKnowledgeCapture)
    } catch (error) {
      console.error('Failed to get knowledge captures:', error)
      return []
    }
  })

  // Get by ID
  ipcMain.handle('knowledge:getById', async (_, id: string) => {
    try {
      const capture = queryOne<any>(`SELECT * FROM knowledge_captures WHERE id = ?`, [id])
      if (!capture) return null
      return mapToKnowledgeCapture(capture)
    } catch (error) {
      console.error('Failed to get knowledge capture:', error)
      return null
    }
  })

  // Update
  ipcMain.handle('knowledge:update', async (_, id: string, updates: Partial<KnowledgeCapture>) => {
    try {
      // Construct UPDATE query dynamically
      const fields: string[] = []
      const values: any[] = []

      // Map camelCase updates to snake_case DB columns
      if (updates.title !== undefined) { fields.push('title = ?'); values.push(updates.title); }
      if (updates.summary !== undefined) { fields.push('summary = ?'); values.push(updates.summary); }
      if (updates.category !== undefined) { fields.push('category = ?'); values.push(updates.category); }
      if (updates.status !== undefined) { fields.push('status = ?'); values.push(updates.status); }
      if (updates.quality !== undefined) { fields.push('quality_rating = ?'); values.push(updates.quality); }
      if (updates.storageTier !== undefined) { fields.push('storage_tier = ?'); values.push(updates.storageTier); }
      
      if (fields.length === 0) return { success: true }

      fields.push('updated_at = CURRENT_TIMESTAMP')
      
      const sql = `UPDATE knowledge_captures SET ${fields.join(', ')} WHERE id = ?`
      values.push(id)

      run(sql, values)
      return { success: true }
    } catch (error) {
      console.error('Failed to update knowledge capture:', error)
      return { success: false, error: (error as Error).message }
    }
  })
}

// Mapper from DB snake_case to Interface camelCase
function mapToKnowledgeCapture(row: any): KnowledgeCapture {
  return {
    id: row.id,
    title: row.title,
    summary: row.summary,
    category: row.category,
    status: row.status,
    quality: row.quality_rating,
    qualityConfidence: row.quality_confidence,
    qualityAssessedAt: row.quality_assessed_at,
    storageTier: row.storage_tier,
    retentionDays: row.retention_days,
    expiresAt: row.expires_at,
    meetingId: row.meeting_id,
    correlationConfidence: row.correlation_confidence,
    correlationMethod: row.correlation_method,
    sourceRecordingId: row.source_recording_id,
    capturedAt: row.captured_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    deletedAt: row.deleted_at
  }
}
