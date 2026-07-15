/**
 * Briefing IPC Handlers
 *
 * One round-trip data source for the Today page: today's meetings, the latest
 * transcribed knowledge, pending actionables and calendar sync state.
 */

import { ipcMain } from 'electron'
import { getMeetings, queryAll, queryOne } from '../services/database'
import { filterEligibleRecordingIds } from '../services/recording-eligibility'
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

/**
 * RE7-P2b/P2c (round-8) — page `fetchPage` until `limit` ELIGIBLE rows are
 * collected or the source is exhausted, so a run of value-excluded rows in the
 * first page can't leave the display list short of its limit. `recIdOf` returns
 * a row's source recording id, or null when the row is NOT recording-backed
 * (standalone → always kept). Fail-closed: when eligibility can't be established,
 * ONLY recording-backed rows are dropped — standalone (null-recording) rows are
 * still kept (matches actionables:getAll).
 */
function collectEligibleRows<T>(
  limit: number,
  fetchPage: (pageLimit: number, offset: number) => T[],
  recIdOf: (row: T) => string | null
): T[] {
  if (limit <= 0) return []
  const PAGE = Math.max(limit * 4, 20)
  const MAX_PAGES = 25
  const out: T[] = []
  let offset = 0
  for (let page = 0; page < MAX_PAGES; page++) {
    const rows = fetchPage(PAGE, offset)
    if (rows.length === 0) break
    const recIds = rows.map(recIdOf).filter((x): x is string => !!x)
    const { eligible, failClosed } = filterEligibleRecordingIds(recIds)
    for (const row of rows) {
      const rec = recIdOf(row)
      const ok = rec == null ? true : !failClosed && eligible.has(rec)
      if (ok) {
        out.push(row)
        if (out.length >= limit) return out.slice(0, limit)
      }
    }
    if (rows.length < PAGE) break // source exhausted
    offset += PAGE
  }
  return out.slice(0, limit)
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

      // RE7-P2b (round-8) — page the Recent list until 6 ELIGIBLE rows are
      // collected (no fixed 30-row cap that a run of value-excluded rows could
      // exhaust before the list is filled). Every row here is recording-backed.
      const recentKnowledge: BriefingRecentItem[] = collectEligibleRows(
        6,
        (pageLimit, offset) =>
          queryAll<TranscriptRow>(
            `SELECT ${TRANSCRIPT_SELECT}
             FROM transcripts t
             LEFT JOIN recordings r ON r.id = t.recording_id
             LEFT JOIN meetings m ON m.id = r.meeting_id
             WHERE TRIM(COALESCE(t.full_text, '')) != ''
               AND COALESCE(r.personal, 0) = 0 AND r.deleted_at IS NULL
             ORDER BY COALESCE(r.date_recorded, '') DESC
             LIMIT ? OFFSET ?`,
            [pageLimit, offset]
          ).map(mapTranscriptRow),
        (r) => r.recordingId
      )

      // Today's recorded + transcribed meetings, newest first — the follow-up
      // digest (today-scoped, so bounded); every row is recording-backed, so on
      // failClosed the eligible filter honestly empties it.
      const todayFollowUpsRaw: BriefingRecentItem[] = queryAll<TranscriptRow>(
        `SELECT ${TRANSCRIPT_SELECT}
         FROM transcripts t
         JOIN recordings r ON r.id = t.recording_id
         LEFT JOIN meetings m ON m.id = r.meeting_id
         WHERE TRIM(COALESCE(t.full_text, '')) != ''
           AND COALESCE(r.personal, 0) = 0 AND r.deleted_at IS NULL
           AND r.date_recorded >= ? AND r.date_recorded < ?
         ORDER BY r.date_recorded DESC`,
        [dayStart, dayEnd]
      ).map(mapTranscriptRow)

      // Today's recordings still awaiting a transcript (honest "still processing" count).
      const todayRecordingsPending = queryAll<{ n: number }>(
        `SELECT COUNT(1) AS n FROM recordings r
         WHERE r.date_recorded >= ? AND r.date_recorded < ?
           AND COALESCE(r.personal, 0) = 0 AND r.deleted_at IS NULL
           AND NOT EXISTS (
             SELECT 1 FROM transcripts t
             WHERE t.recording_id = r.id AND TRIM(COALESCE(t.full_text, '')) != ''
           )`,
        [dayStart, dayEnd]
      )[0]?.n ?? 0

      // RE7-3 (round-7) — Today is an assistant-facing DISPLAY, so route every
      // recording-backed row through the shared eligibility boundary. The SQL
      // above already drops personal/soft-deleted, but VALUE-excluded rows (and
      // a stale actionable pointing at a now-excluded recording) still slip
      // through. An actionable's source_knowledge_id is a capture id (→ resolve
      // its source recording) or, when no capture row exists, a recording id.
      // A capture with a NULL source recording → standalone actionable (kept).
      const actionableRec = new Map<string, string | null>()
      const resolveActionableRec = (sourceKnowledgeId: string): string | null => {
        if (actionableRec.has(sourceKnowledgeId)) return actionableRec.get(sourceKnowledgeId) ?? null
        const kc = queryOne<{ source_recording_id: string | null }>(
          'SELECT source_recording_id FROM knowledge_captures WHERE id = ?',
          [sourceKnowledgeId]
        )
        const rec = kc ? kc.source_recording_id ?? null : sourceKnowledgeId
        actionableRec.set(sourceKnowledgeId, rec)
        return rec
      }

      // RE7-P2b (round-8) — page pending actionables until 8 ELIGIBLE rows are
      // collected. RE7-P2c — collectEligibleRows keeps standalone (NULL-source)
      // actionables even on failClosed (only recording-backed rows are dropped),
      // matching actionables:getAll rather than the previous "drop everything".
      const pendingActionables: BriefingActionable[] = collectEligibleRows(
        8,
        (pageLimit, offset) =>
          queryAll<{
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
             LIMIT ? OFFSET ?`,
            [pageLimit, offset]
          ).map<BriefingActionable>((a) => ({
            id: a.id,
            type: a.type,
            title: a.title,
            description: a.description,
            suggestedTemplate: a.suggested_template,
            sourceKnowledgeId: a.source_knowledge_id,
            confidence: a.confidence,
            createdAt: a.created_at
          })),
        (a) => resolveActionableRec(a.sourceKnowledgeId)
      )

      // todayFollowUps is recording-backed and today-scoped: apply the boundary
      // directly (failClosed → honestly empty).
      const { eligible: followUpEligible, failClosed: followUpFailClosed } = filterEligibleRecordingIds(
        todayFollowUpsRaw.map((r) => r.recordingId)
      )
      const todayFollowUps = followUpFailClosed
        ? []
        : todayFollowUpsRaw.filter((r) => followUpEligible.has(r.recordingId))

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
