/**
 * Pre-Migration Cleanup for V11
 */

import { Database as SqlJsDatabase } from 'sql.js'

export interface CleanupReport {
  orphanedTranscripts: number
  orphanedEmbeddings: number
  duplicateRecordings: number
  invalidMeetingRefs: number
  fixedRecords: number
  errors: string[]
}

export interface CleanupPreview {
  orphanedTranscripts: number
  orphanedEmbeddings: number
  duplicateRecordings: number
  invalidMeetingRefs: number
}

export function generateCleanupPreview(db: SqlJsDatabase): CleanupPreview {
  return {
    orphanedTranscripts: countRows(db, `
      SELECT COUNT(*) as count FROM transcripts t
      WHERE NOT EXISTS (SELECT 1 FROM recordings r WHERE r.id = t.recording_id)
    `),
    orphanedEmbeddings: countRows(db, `
      SELECT COUNT(*) as count FROM embeddings e
      WHERE NOT EXISTS (SELECT 1 FROM transcripts t WHERE t.id = e.transcript_id)
    `),
    duplicateRecordings: countRows(db, `
      SELECT COUNT(*) - COUNT(DISTINCT filename) as count FROM recordings
    `),
    invalidMeetingRefs: countRows(db, `
      SELECT COUNT(*) as count FROM recordings r
      WHERE r.meeting_id IS NOT NULL
      AND NOT EXISTS (SELECT 1 FROM meetings m WHERE m.id = r.meeting_id)
    `)
  }
}

function countRows(db: SqlJsDatabase, sql: string): number {
  const result = db.exec(sql)
  return result.length > 0 && result[0].values.length > 0
    ? (result[0].values[0][0] as number)
    : 0
}

export async function runPreMigrationCleanup(db: SqlJsDatabase): Promise<CleanupReport> {
  const report: CleanupReport = {
    orphanedTranscripts: 0,
    orphanedEmbeddings: 0,
    duplicateRecordings: 0,
    invalidMeetingRefs: 0,
    fixedRecords: 0,
    errors: []
  }

  try {
    report.orphanedTranscripts = cleanOrphanedTranscripts(db)
    report.orphanedEmbeddings = cleanOrphanedEmbeddings(db)
    report.duplicateRecordings = cleanDuplicateRecordings(db)
    report.invalidMeetingRefs = fixInvalidMeetingRefs(db)
    report.fixedRecords = report.orphanedTranscripts + report.orphanedEmbeddings + report.duplicateRecordings + report.invalidMeetingRefs
  } catch (error) {
    report.errors.push(String(error))
  }

  return report
}

function cleanOrphanedTranscripts(db: SqlJsDatabase): number {
  db.run(`CREATE TABLE IF NOT EXISTS _orphaned_transcripts_backup AS SELECT * FROM transcripts WHERE 0`)
  db.run(`INSERT INTO _orphaned_transcripts_backup SELECT * FROM transcripts WHERE NOT EXISTS (SELECT 1 FROM recordings WHERE id = recording_id)`)
  const count = countRows(db, `SELECT COUNT(*) as count FROM _orphaned_transcripts_backup`)
  db.run(`DELETE FROM transcripts WHERE NOT EXISTS (SELECT 1 FROM recordings WHERE id = recording_id)`)
  return count
}

function cleanOrphanedEmbeddings(db: SqlJsDatabase): number {
  const count = countRows(db, `SELECT COUNT(*) as count FROM embeddings WHERE NOT EXISTS (SELECT 1 FROM transcripts WHERE id = transcript_id)`)
  db.run(`DELETE FROM embeddings WHERE NOT EXISTS (SELECT 1 FROM transcripts WHERE id = transcript_id)`)
  return count
}

function cleanDuplicateRecordings(db: SqlJsDatabase): number {
  const duplicates = db.exec(`SELECT filename FROM recordings GROUP BY filename HAVING COUNT(*) > 1`)
  let count = 0
  if (duplicates.length > 0) {
    for (const row of duplicates[0].values) {
      const filename = row[0]
      db.run(`UPDATE recordings SET location = 'deleted' WHERE filename = ? AND id NOT IN (SELECT id FROM recordings WHERE filename = ? ORDER BY created_at DESC LIMIT 1)`, [filename, filename])
      count++
    }
  }
  return count
}

function fixInvalidMeetingRefs(db: SqlJsDatabase): number {
  const count = countRows(db, `SELECT COUNT(*) as count FROM recordings WHERE meeting_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM meetings WHERE id = meeting_id)`)
  db.run(`UPDATE recordings SET meeting_id = NULL WHERE meeting_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM meetings WHERE id = meeting_id)`)
  return count
}
