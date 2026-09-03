import type { ReadonlyDatabase } from './database.js'

const EXCLUDED = new Set(['garbage', 'low-value'])

interface CaptureGateRow {
  id: string
  source_recording_id: string | null
  quality_rating: string | null
  deleted_at: string | null
  rec_id: string | null
  personal: number | null
  rec_deleted_at: string | null
  recording_excluded: number
}

/** Positive allowlist matching HiDock Next's capture/recording privacy policy. */
export function eligibleCaptureIds(db: ReadonlyDatabase, candidateIds: Iterable<string>): Set<string> {
  const ids = [...new Set(candidateIds)].filter(Boolean)
  if (!ids.length) return new Set()

  try {
    const placeholders = ids.map(() => '?').join(',')
    const rows = db.prepare(`
      SELECT kc.id, kc.source_recording_id, kc.quality_rating, kc.deleted_at,
             r.id AS rec_id, r.personal, r.deleted_at AS rec_deleted_at,
             EXISTS (
               SELECT 1 FROM knowledge_captures bad
               WHERE bad.source_recording_id = r.id AND bad.deleted_at IS NULL
                 AND bad.quality_rating IN ('garbage', 'low-value')
                 AND NOT EXISTS (
                   SELECT 1 FROM knowledge_captures keep
                   WHERE keep.source_recording_id = r.id AND keep.deleted_at IS NULL
                     AND keep.quality_rating IN ('valuable', 'archived')
                 )
             ) AS recording_excluded
      FROM knowledge_captures kc
      LEFT JOIN recordings r ON r.id = kc.source_recording_id
      WHERE kc.id IN (${placeholders})
    `).all(...ids) as CaptureGateRow[]

    return new Set(rows.filter((row) => {
      if (row.deleted_at != null || EXCLUDED.has(row.quality_rating ?? '')) return false
      if (!row.source_recording_id) return true
      return row.rec_id != null && row.personal !== 1 && row.rec_deleted_at == null &&
        row.recording_excluded !== 1
    }).map((row) => row.id))
  } catch {
    // Eligibility is deliberately fail-closed: schema/read errors expose nothing.
    return new Set()
  }
}

export function requireEligibleCapture(db: ReadonlyDatabase, captureId: string): void {
  if (!eligibleCaptureIds(db, [captureId]).has(captureId)) {
    throw new Error('Capture not found or is not eligible to be surfaced')
  }
}
