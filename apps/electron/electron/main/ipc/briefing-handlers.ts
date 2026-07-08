/**
 * Briefing IPC Handlers
 *
 * One round-trip data source for the Today page: today's meetings, the latest
 * transcribed knowledge, pending actionables and calendar sync state.
 */

import { ipcMain } from 'electron'
import { getMeetings, queryAll } from '../services/database'
import { getConfig } from '../services/config'

export interface BriefingRecentItem {
  recordingId: string
  title: string
  filename?: string
  dateRecorded?: string
  summary?: string
  actionItems: string[]
  wordCount?: number
}

export interface BriefingActionable {
  id: string
  type: string
  title: string
  description?: string
  suggestedTemplate?: string
  sourceKnowledgeId: string
  confidence?: number
  createdAt?: string
}

export function registerBriefingHandlers(): void {
  ipcMain.handle('briefing:get', async () => {
    try {
      const now = new Date()
      const dayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString()
      const dayEnd = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1).toISOString()

      const todayMeetings = getMeetings(dayStart, dayEnd)

      const recent = queryAll<{
        recording_id: string
        title_suggestion?: string
        summary?: string
        action_items?: string
        word_count?: number
        filename?: string
        date_recorded?: string
      }>(
        `SELECT t.recording_id, t.title_suggestion, t.summary, t.action_items, t.word_count,
                r.filename, r.date_recorded
         FROM transcripts t
         LEFT JOIN recordings r ON r.id = t.recording_id
         WHERE TRIM(COALESCE(t.full_text, '')) != ''
         ORDER BY COALESCE(r.date_recorded, '') DESC
         LIMIT 6`
      )

      const recentKnowledge: BriefingRecentItem[] = recent.map((row) => {
        let actionItems: string[] = []
        try {
          const parsed = JSON.parse(row.action_items || '[]')
          if (Array.isArray(parsed)) actionItems = parsed.map(String)
        } catch {
          actionItems = []
        }
        return {
          recordingId: row.recording_id,
          title: row.title_suggestion || row.filename || row.recording_id,
          filename: row.filename,
          dateRecorded: row.date_recorded,
          summary: row.summary,
          actionItems,
          wordCount: row.word_count
        }
      })

      const pendingActionables = queryAll<{
        id: string
        type: string
        title: string
        description?: string
        suggested_template?: string
        source_knowledge_id: string
        confidence?: number
        created_at?: string
      }>(
        `SELECT id, type, title, description, suggested_template, source_knowledge_id, confidence, created_at
         FROM actionables
         WHERE status = 'pending'
         ORDER BY created_at DESC
         LIMIT 8`
      ).map<BriefingActionable>((a) => ({
        id: a.id,
        type: a.type,
        title: a.title,
        description: a.description,
        suggestedTemplate: a.suggested_template,
        sourceKnowledgeId: a.source_knowledge_id,
        confidence: a.confidence,
        createdAt: a.created_at
      }))

      const config = getConfig()
      const stats = {
        transcribedCount: queryAll<{ n: number }>(
          `SELECT COUNT(1) AS n FROM transcripts WHERE TRIM(COALESCE(full_text, '')) != ''`
        )[0]?.n ?? 0,
        indexedChunks: queryAll<{ n: number }>(`SELECT COUNT(1) AS n FROM vector_embeddings`)[0]?.n ?? 0,
        pendingActionables: queryAll<{ n: number }>(
          `SELECT COUNT(1) AS n FROM actionables WHERE status = 'pending'`
        )[0]?.n ?? 0
      }

      return {
        success: true,
        data: {
          todayMeetings,
          recentKnowledge,
          pendingActionables,
          calendar: {
            configured: Boolean(config.calendar.icsUrl),
            syncEnabled: config.calendar.syncEnabled,
            lastSyncAt: config.calendar.lastSyncAt
          },
          stats
        }
      }
    } catch (error) {
      console.error('briefing:get error:', error)
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' }
    }
  })

  console.log('Briefing IPC handlers registered')
}
