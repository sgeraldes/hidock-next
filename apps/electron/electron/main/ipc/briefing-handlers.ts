/**
 * Briefing IPC Handlers
 *
 * One round-trip data source for the Today page: today's meetings, the latest
 * transcribed knowledge, pending actionables and calendar sync state.
 */

import { ipcMain } from 'electron'
import { getMeetings, queryAll } from '../services/database'
import { filterEligibleRecordingIds, filterEligibleProvenanceRows } from '../services/recording-eligibility'
import { filterEligibleActionableRows } from '../services/actionable-eligibility'
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
 * collected or the source is exhausted, so a run of excluded rows in the first
 * page can't leave the display list short of its limit. `filterPage` applies the
 * relevant shared boundary to each page and MUST preserve row order (both
 * {@link filterEligibleByRecording} and {@link filterEligibleActionableRows} do).
 * Fail-closed handling lives inside the page filter (recording-backed / capture-
 * backed rows dropped; standalone rows kept).
 */
function collectEligibleRows<T>(
  limit: number,
  fetchPage: (pageLimit: number, offset: number) => T[],
  filterPage: (rows: T[]) => T[]
): T[] {
  if (limit <= 0) return []
  const PAGE = Math.max(limit * 4, 20)
  const out: T[] = []
  // RE8-P2a (round-9) — NO fixed page ceiling: page until `limit` eligible rows
  // are collected OR the source is genuinely exhausted (a page returns fewer than
  // PAGE rows). OFFSET advances every iteration, so the loop is bounded by the
  // table size; a long run of excluded rows can no longer leave the list short.
  for (let offset = 0; ; offset += PAGE) {
    const rows = fetchPage(PAGE, offset)
    if (rows.length === 0) break
    for (const row of filterPage(rows)) {
      out.push(row)
      if (out.length >= limit) return out.slice(0, limit)
    }
    if (rows.length < PAGE) break // source exhausted
  }
  return out.slice(0, limit)
}

/**
 * RE7-3 — recording-backed page filter: keep a row iff its source recording is
 * eligible (personal/soft-deleted/value-excluded/hard-purged all drop it),
 * fail-closed; rows with no recording id are kept. Preserves input order.
 */
function filterEligibleByRecording<T>(rows: T[], recIdOf: (row: T) => string | null): T[] {
  const recIds = rows.map(recIdOf).filter((x): x is string => !!x)
  const { eligible, failClosed } = filterEligibleRecordingIds(recIds)
  return rows.filter((row) => {
    const rec = recIdOf(row)
    return rec == null ? true : !failClosed && eligible.has(rec)
  })
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
        (rows) => filterEligibleByRecording(rows, (r) => r.recordingId)
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

      // ADV15 (round-16) — Today's pending actionables are an assistant-facing
      // DISPLAY, so route them through the ONE shared CAPTURE-aware boundary
      // {@link filterEligibleActionableRows} (identical to actionables:getAll).
      // It resolves each row's source_knowledge_id to a live capture (gated on
      // deleted_at + recording-derived delegation + standalone quality) or a
      // legacy recording id; only truly standalone actionables (null source) are
      // kept. This replaces the round-7 predicate that unconditionally kept
      // null-SOURCE-RECORDING (standalone) captures — ADV15-3. Fill-until-limit is
      // preserved: collectEligibleRows pages until 8 eligible rows are collected.
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
        (rows) => filterEligibleActionableRows(rows, (a) => a.sourceKnowledgeId)
      )

      // todayFollowUps is recording-backed and today-scoped: apply the recording
      // boundary directly (failClosed → honestly empty, since every row here is
      // recording-backed).
      const todayFollowUps = filterEligibleByRecording(todayFollowUpsRaw, (r) => r.recordingId)

      const config = getConfig()

      // ADV44-2 (round-46) — the displayed statistics count DERIVATIVE tables
      // (transcripts / vector chunks / pending actionables). A COUNT(*) over the
      // raw tables over-reports soft-deleted / personal / value-excluded /
      // hard-purged sources, contradicting the deletion + value controls. Produce
      // each total through the SAME shared positive-eligibility boundaries the
      // display lists use, FAIL-CLOSED to zero (never inflate). Follows the
      // round-9 fetch-then-filter pattern (no truncation-before-filter): fetch the
      // provenance ids, filter, count.

      // transcribedCount — only transcripts whose recording is eligible.
      const transcribedCount = filterEligibleByRecording(
        queryAll<{ recording_id: string }>(
          `SELECT recording_id FROM transcripts WHERE TRIM(COALESCE(full_text, '')) != ''`
        ),
        (r) => r.recording_id
      ).length

      // indexedChunks — only vector chunks with eligible positive provenance
      // (same boundary as vector-store search / rag:status FIX 1).
      const indexedChunks = filterEligibleProvenanceRows(
        queryAll<{ recording_id: string | null; capture_id: string | null }>(
          `SELECT recording_id, capture_id FROM vector_embeddings`
        ),
        (r) => r.recording_id,
        (r) => r.capture_id
      ).length

      // pendingActionables — only pending actionables whose source capture/recording
      // is eligible (standalone null-source rows kept), via the shared boundary.
      const pendingActionablesCount = filterEligibleActionableRows(
        queryAll<{ id: string; source_knowledge_id: string | null }>(
          `SELECT id, source_knowledge_id FROM actionables WHERE status = 'pending'`
        ),
        (a) => a.source_knowledge_id
      ).length

      const stats = {
        transcribedCount,
        indexedChunks,
        pendingActionables: pendingActionablesCount
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
