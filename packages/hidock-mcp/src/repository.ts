import type { ReadonlyDatabase } from './database.js'
import { eligibleCaptureIds, requireEligibleCapture } from './eligibility.js'

export interface DateFilter { from?: string; to?: string; limit?: number }

const limitOf = (value?: number) => Math.max(1, Math.min(value ?? 20, 100))
const parseJson = (value: string | null) => {
  if (!value) return null
  try { return JSON.parse(value) } catch { return value }
}

export class HidockRepository {
  constructor(private readonly db: ReadonlyDatabase) {}

  recentMeetings(filter: DateFilter = {}) {
    const rows = this.db.prepare(`
      SELECT kc.id AS captureId, COALESCE(kc.user_title, m.subject, kc.title) AS title,
             kc.summary, COALESCE(r.date_recorded, kc.captured_at) AS date,
             m.subject AS meetingSubject, m.attendees
      FROM knowledge_captures kc
      LEFT JOIN recordings r ON r.id = kc.source_recording_id
      LEFT JOIN meetings m ON m.id = kc.meeting_id
      WHERE (? IS NULL OR substr(COALESCE(r.date_recorded, kc.captured_at), 1, 10) >= ?)
        AND (? IS NULL OR substr(COALESCE(r.date_recorded, kc.captured_at), 1, 10) <= ?)
      ORDER BY COALESCE(r.date_recorded, kc.captured_at) DESC
      LIMIT ?
    `).all(filter.from ?? null, filter.from ?? null, filter.to ?? null, filter.to ?? null,
      limitOf(filter.limit) * 3) as Array<Record<string, unknown> & { captureId: string }>
    const eligible = eligibleCaptureIds(this.db, rows.map((row) => row.captureId))
    return rows.filter((row) => eligible.has(row.captureId)).slice(0, limitOf(filter.limit))
  }

  search(query: string, filter: DateFilter = {}) {
    const terms = query.trim().split(/\s+/).filter(Boolean).slice(0, 8)
    if (!terms.length) return []
    const clauses = terms.map(() => `(LOWER(COALESCE(kc.user_title, kc.title, '')) LIKE ? OR LOWER(COALESCE(kc.summary, '')) LIKE ? OR LOWER(COALESCE(t.full_text, '')) LIKE ?)`).join(' AND ')
    const termParams = terms.flatMap((term) => Array(3).fill(`%${term.toLowerCase()}%`))
    const rows = this.db.prepare(`
      SELECT kc.id AS captureId, COALESCE(kc.user_title, m.subject, kc.title) AS title,
             COALESCE(r.date_recorded, kc.captured_at) AS date, kc.summary,
             substr(t.full_text, 1, 800) AS excerpt
      FROM knowledge_captures kc
      LEFT JOIN recordings r ON r.id = kc.source_recording_id
      LEFT JOIN transcripts t ON t.recording_id = kc.source_recording_id
      LEFT JOIN meetings m ON m.id = kc.meeting_id
      WHERE ${clauses}
        AND (? IS NULL OR substr(COALESCE(r.date_recorded, kc.captured_at), 1, 10) >= ?)
        AND (? IS NULL OR substr(COALESCE(r.date_recorded, kc.captured_at), 1, 10) <= ?)
      ORDER BY COALESCE(r.date_recorded, kc.captured_at) DESC LIMIT ?
    `).all(...termParams, filter.from ?? null, filter.from ?? null, filter.to ?? null,
      filter.to ?? null, limitOf(filter.limit) * 3) as Array<Record<string, unknown> & { captureId: string }>
    const eligible = eligibleCaptureIds(this.db, rows.map((row) => row.captureId))
    return rows.filter((row) => eligible.has(row.captureId)).slice(0, limitOf(filter.limit))
  }

  transcript(captureId: string) {
    requireEligibleCapture(this.db, captureId)
    const row = this.db.prepare(`
      SELECT kc.id AS captureId, COALESCE(kc.user_title, m.subject, kc.title) AS title,
             COALESCE(r.date_recorded, kc.captured_at) AS date, t.full_text AS transcript,
             t.summary, t.topics, t.key_points AS keyPoints, t.speakers, t.mentioned_people AS mentionedPeople
      FROM knowledge_captures kc
      LEFT JOIN recordings r ON r.id = kc.source_recording_id
      LEFT JOIN transcripts t ON t.recording_id = kc.source_recording_id
      LEFT JOIN meetings m ON m.id = kc.meeting_id WHERE kc.id = ?
    `).get(captureId) as Record<string, unknown> | undefined
    if (!row) throw new Error('Capture not found')
    for (const key of ['topics', 'keyPoints', 'speakers', 'mentionedPeople']) row[key] = parseJson(row[key] as string | null)
    return row
  }

  actions(filter: DateFilter & { status?: string } = {}) {
    return this.eligibleDerivativeRows('action_items', `ai.content, ai.assignee, ai.due_date AS dueDate, ai.priority, ai.status, ai.confidence`, 'ai', filter, filter.status)
  }

  decisions(filter: DateFilter = {}) {
    const rows = this.eligibleDerivativeRows('decisions', `d.content, d.context, d.participants, d.confidence, d.decided_at AS decidedAt`, 'd', filter)
    return rows.map((row) => ({ ...row, participants: parseJson(row.participants as string | null) }))
  }

  private eligibleDerivativeRows(table: string, columns: string, alias: string, filter: DateFilter, status?: string) {
    const statusClause = status === undefined ? '' : `AND ${alias}.status = ?`
    const statusParams = status === undefined ? [] : [status]
    const rows = this.db.prepare(`
      SELECT ${alias}.id, ${alias}.knowledge_capture_id AS captureId, ${columns},
             COALESCE(kc.user_title, m.subject, kc.title) AS sourceTitle,
             COALESCE(r.date_recorded, kc.captured_at) AS sourceDate
      FROM ${table} ${alias}
      JOIN knowledge_captures kc ON kc.id = ${alias}.knowledge_capture_id
      LEFT JOIN recordings r ON r.id = kc.source_recording_id
      LEFT JOIN meetings m ON m.id = kc.meeting_id
      WHERE 1 = 1 ${statusClause}
        AND (? IS NULL OR substr(COALESCE(r.date_recorded, kc.captured_at), 1, 10) >= ?)
        AND (? IS NULL OR substr(COALESCE(r.date_recorded, kc.captured_at), 1, 10) <= ?)
      ORDER BY COALESCE(r.date_recorded, kc.captured_at) DESC LIMIT ?
    `).all(...statusParams, filter.from ?? null, filter.from ?? null,
      filter.to ?? null, filter.to ?? null, limitOf(filter.limit) * 3) as Array<Record<string, unknown> & { captureId: string }>
    const eligible = eligibleCaptureIds(this.db, rows.map((row) => row.captureId))
    return rows.filter((row) => eligible.has(row.captureId)).slice(0, limitOf(filter.limit))
  }
}
