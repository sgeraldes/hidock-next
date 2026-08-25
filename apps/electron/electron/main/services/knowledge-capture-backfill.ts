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

/**
 * Ensure a locally confirmed no-speech recording has a library capture and a
 * deterministic value classification. Unlike the normal creator, this path
 * must not require a transcript: local VAD/provider evidence has proven there
 * is no intelligible content, so leaving the row `unrated` is misleading.
 *
 * User-authored ratings remain authoritative because
 * applyCaptureValueClassification never overwrites quality_source='user'.
 */
export function ensureNoSpeechKnowledgeCapture(recordingId: string): string | null {
  let captureId = queryOne<{ id: string }>(
    'SELECT id FROM knowledge_captures WHERE source_recording_id = ?',
    [recordingId]
  )?.id ?? null

  if (!captureId) {
    const recording = queryOne<{
      id: string
      filename: string
      date_recorded: string | null
      meeting_id: string | null
    }>(
      `SELECT id, filename, date_recorded, meeting_id
         FROM recordings
        WHERE id = ? AND deleted_at IS NULL`,
      [recordingId]
    )
    if (!recording) return null

    captureId = runInTransaction(() => createCaptureFromSource({
      recording_id: recording.id,
      filename: recording.filename,
      date_recorded: recording.date_recorded,
      meeting_id: recording.meeting_id,
      summary: null,
      title_suggestion: null,
      transcript_created_at: null
    }))
  }

  // Local no-speech proof is deterministic (not an LLM judgement), but the
  // existing schema's generated-vs-user provenance vocabulary is `ai|user`.
  // Store it on the generated side so a later explicit user rating remains
  // immutable and a future successful reprocess may refresh it.
  run(
    `UPDATE knowledge_captures
        SET quality_rating = 'garbage',
            quality_confidence = 1,
            quality_assessed_at = ?,
            quality_reasons = '["no_substance"]',
            quality_source = 'ai',
            updated_at = ?
      WHERE id = ?
        AND (quality_source IS NULL OR quality_source != 'user')`,
    [new Date().toISOString(), new Date().toISOString(), captureId]
  )
  return captureId
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

  if (rows.length > 0) {
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
  }

  // A no-speech result deliberately has no transcript, so it is absent from
  // queryAllSources(). Heal those rows separately. The helper is idempotent and
  // preserves any user-set value rating.
  const noSpeechRecordingIds = queryAll<{ id: string }>(
    `SELECT id FROM recordings
      WHERE deleted_at IS NULL
        AND (status = 'no_speech' OR transcription_status = 'no_speech')`
  )
  for (const row of noSpeechRecordingIds) {
    const existed = !!queryOne<{ id: string }>(
      'SELECT id FROM knowledge_captures WHERE source_recording_id = ?',
      [row.id]
    )
    if (ensureNoSpeechKnowledgeCapture(row.id)) {
      if (existed) existing++
      else created++
    }
  }

  if (created > 0) {
    console.log(`[KnowledgeCaptureBackfill] Created ${created} capture(s) (${existing} already present)`)
  }
  return { created, existing }
}

/** All transcript source rows eligible for a capture. */
function queryAllSources(): CaptureSourceRow[] {
  return queryAll<CaptureSourceRow>(CAPTURE_SOURCE_SELECT)
}
