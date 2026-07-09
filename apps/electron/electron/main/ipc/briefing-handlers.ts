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
  /** Calendar identity — present only when the source recording is linked to a meeting. */
  meetingId?: string
  meetingSubject?: string
  meetingStart?: string
  meetingEnd?: string
}

/** A transcript row joined to its recording and (optionally) its calendar meeting. */
interface TranscriptRow {
  recording_id: string
  title_suggestion?: string
  summary?: string
  action_items?: string
  word_count?: number
  filename?: string
  date_recorded?: string
  meeting_id?: string | null
  meeting_subject?: string | null
  meeting_start?: string | null
  meeting_end?: string | null
}

function mapTranscriptRow(row: TranscriptRow): BriefingRecentItem {
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
    wordCount: row.word_count,
    meetingId: row.meeting_id ?? undefined,
    meetingSubject: row.meeting_subject ?? undefined,
    meetingStart: row.meeting_start ?? undefined,
    meetingEnd: row.meeting_end ?? undefined
  }
}

/** Columns every transcript-derived follow-up row needs (recording + meeting identity). */
const TRANSCRIPT_SELECT = `t.recording_id, t.title_suggestion, t.summary, t.action_items, t.word_count,
        r.filename, r.date_recorded, r.meeting_id,
        m.subject AS meeting_subject, m.start_time AS meeting_start, m.end_time AS meeting_end`

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

      const recentKnowledge: BriefingRecentItem[] = queryAll<TranscriptRow>(
        `SELECT ${TRANSCRIPT_SELECT}
         FROM transcripts t
         LEFT JOIN recordings r ON r.id = t.recording_id
         LEFT JOIN meetings m ON m.id = r.meeting_id
         WHERE TRIM(COALESCE(t.full_text, '')) != ''
         ORDER BY COALESCE(r.date_recorded, '') DESC
         LIMIT 6`
      ).map(mapTranscriptRow)

      // Today's recorded + transcribed meetings, newest first — the follow-up digest.
      const todayFollowUps: BriefingRecentItem[] = queryAll<TranscriptRow>(
        `SELECT ${TRANSCRIPT_SELECT}
         FROM transcripts t
         JOIN recordings r ON r.id = t.recording_id
         LEFT JOIN meetings m ON m.id = r.meeting_id
         WHERE TRIM(COALESCE(t.full_text, '')) != ''
           AND r.date_recorded >= ? AND r.date_recorded < ?
         ORDER BY r.date_recorded DESC`,
        [dayStart, dayEnd]
      ).map(mapTranscriptRow)

      // Today's recordings still awaiting a transcript (honest "still processing" count).
      const todayRecordingsPending = queryAll<{ n: number }>(
        `SELECT COUNT(1) AS n FROM recordings r
         WHERE r.date_recorded >= ? AND r.date_recorded < ?
           AND NOT EXISTS (
             SELECT 1 FROM transcripts t
             WHERE t.recording_id = r.id AND TRIM(COALESCE(t.full_text, '')) != ''
           )`,
        [dayStart, dayEnd]
      )[0]?.n ?? 0

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
          todayFollowUps,
          todayRecordingsPending,
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
