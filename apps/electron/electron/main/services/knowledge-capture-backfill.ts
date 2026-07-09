/**
 * Knowledge-capture backfill / self-heal.
 *
 * The Knowledge Library entity (`knowledge_captures`) is populated from finished
 * transcripts: one capture per transcribed recording. Historically the only code
 * that created captures was the standalone V11 migration IPC (never wired to the
 * UI) and the artifact importer — so on a device-first library the captures table
 * sits empty even though transcripts exist. This module is the canonical creator:
 *
 *  - ensureKnowledgeCaptureForRecording() — idempotent single-recording upsert,
 *    called from the transcription pipeline so every new transcript gets a capture.
 *  - backfillKnowledgeCaptures() — boot self-heal that creates captures for any
 *    transcript still lacking one (recovers a library that predates this wiring,
 *    or one emptied by an earlier bug).
 *
 * A capture is linked to its recording BOTH ways: knowledge_captures.source_recording_id
 * and recordings.migrated_to_capture_id (+ migration_status='migrated'), so the
 * existing title-suggestion updater (updateKnowledgeCaptureTitle) keeps working.
 */

import { randomUUID } from 'crypto'
import { queryAll, queryOne, run, runInTransaction } from './database'

interface CaptureSourceRow {
  recording_id: string
  filename?: string | null
  date_recorded?: string | null
  meeting_id?: string | null
  summary?: string | null
  title_suggestion?: string | null
  transcript_created_at?: string | null
}

const CAPTURE_SOURCE_SELECT = `
  SELECT t.recording_id,
         r.filename,
         r.date_recorded,
         r.meeting_id,
         t.summary,
         t.title_suggestion,
         t.created_at AS transcript_created_at
  FROM transcripts t
  LEFT JOIN recordings r ON r.id = t.recording_id
  WHERE TRIM(COALESCE(t.full_text, '')) != ''`

/** Insert a capture from a source row and link it to its recording. Returns the new id. */
function createCaptureFromSource(row: CaptureSourceRow): string {
  const id = randomUUID()
  const now = new Date().toISOString()
  const title = (row.title_suggestion || row.filename || 'Untitled').toString()
  const capturedAt = row.date_recorded || row.transcript_created_at || now

  run(
    `INSERT INTO knowledge_captures
       (id, title, summary, category, status, meeting_id, source_recording_id,
        captured_at, created_at, updated_at)
     VALUES (?, ?, ?, 'meeting', 'ready', ?, ?, ?, ?, ?)`,
    [id, title, row.summary ?? null, row.meeting_id ?? null, row.recording_id, capturedAt, now, now]
  )
  // Two-way link so updateKnowledgeCaptureTitle() (which reads migrated_to_capture_id) works.
  run(
    `UPDATE recordings SET migrated_to_capture_id = ?, migration_status = 'migrated', migrated_at = ?
     WHERE id = ?`,
    [id, now, row.recording_id]
  )
  return id
}

/**
 * Ensure a knowledge capture exists for a recording that has a transcript.
 * Idempotent: returns the existing capture id if one is already linked, creates
 * one otherwise, or null when the recording has no (non-empty) transcript.
 */
export function ensureKnowledgeCaptureForRecording(recordingId: string): string | null {
  const existing = queryOne<{ id: string }>(
    'SELECT id FROM knowledge_captures WHERE source_recording_id = ?',
    [recordingId]
  )
  if (existing) return existing.id

  const row = queryOne<CaptureSourceRow>(`${CAPTURE_SOURCE_SELECT} AND t.recording_id = ?`, [recordingId])
  if (!row) return null

  return runInTransaction(() => createCaptureFromSource(row))
}

export interface BackfillResult {
  created: number
  existing: number
}

/**
 * Create a knowledge capture for every transcript that lacks one. Idempotent and
 * cheap (DB-only) — safe to run on every boot. Runs in a single transaction so
 * the whole sql.js database is persisted once.
 */
export function backfillKnowledgeCaptures(): BackfillResult {
  const rows = queryAllSources()
  let created = 0
  let existing = 0
  if (rows.length === 0) return { created, existing }

  runInTransaction(() => {
    for (const row of rows) {
      const already = queryOne<{ id: string }>(
        'SELECT id FROM knowledge_captures WHERE source_recording_id = ?',
        [row.recording_id]
      )
      if (already) {
        existing++
        continue
      }
      createCaptureFromSource(row)
      created++
    }
  })

  if (created > 0) {
    console.log(`[KnowledgeCaptureBackfill] Created ${created} capture(s) (${existing} already present)`)
  }
  return { created, existing }
}

/** All transcript source rows eligible for a capture. */
function queryAllSources(): CaptureSourceRow[] {
  return queryAll<CaptureSourceRow>(CAPTURE_SOURCE_SELECT)
}
