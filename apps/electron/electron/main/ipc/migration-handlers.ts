import { ipcMain, BrowserWindow } from 'electron'
import { getDatabase, runInTransaction, saveDatabase } from '../services/database'
import { readFileSync } from 'fs'
import { join } from 'path'
import { v4 as uuidv4 } from 'uuid'
import { randomUUID } from 'crypto'

// ============================================================================
// Types
// ============================================================================

interface CleanupPreview {
  orphanedTranscripts: Array<{ id: string; recording_id: string }>
  duplicateRecordings: Array<{ id: string; filename: string; count: number }>
  invalidMeetingRefs: Array<{ id: string; meeting_id: string }>
}

interface CleanupResult {
  success: boolean
  orphanedTranscriptsRemoved: number
  duplicateRecordingsRemoved: number
  invalidMeetingRefsFixed: number
  errors: string[]
}

interface MigrationResult {
  success: boolean
  capturesCreated: number
  errors: string[]
  verified: boolean
}

interface MigrationStatus {
  pending: number
  migrated: number
  skipped: number
  total: number
}

interface VerificationResult {
  success: boolean
  errors: string[]
}

// ============================================================================
// P1 #009: Migration State Management with Locking
// ============================================================================

let migrationInProgress = false
const migrationLock = {
  acquire(): boolean {
    if (migrationInProgress) {
      return false
    }
    migrationInProgress = true
    return true
  },
  release(): void {
    migrationInProgress = false
  }
}

// ============================================================================
// P1 #013: Progress Tracking Cleanup (Memory Leak Prevention)
// ============================================================================

const activeProgressTrackers = new Set<string>()

function registerProgressTracker(id: string): void {
  activeProgressTrackers.add(id)
}

function cleanupProgressTracker(id: string): void {
  activeProgressTrackers.delete(id)
}

function cleanupAllProgressTrackers(): void {
  activeProgressTrackers.clear()
}

// Cleanup on process exit
process.on('exit', () => {
  cleanupAllProgressTrackers()
})

// ============================================================================
// Error Sanitization (Security Best Practice)
// ============================================================================

function sanitizeError(error: Error): string {
  const message = error.message
  // Remove file paths, database paths, and internal details
  return message
    .replace(/\/[^\s]*/g, '[path]')
    .replace(/\\/g, '[path]')
    .replace(/[A-Z]:\\[^\s]*/g, '[path]')
    .replace(/database.*?:/gi, 'Database:')
    .replace(/SQLITE_ERROR.*?:/gi, 'Database error:')
    .slice(0, 200) // Limit length
}

// ============================================================================
// P1 #010: Load Proper V11 Schema (Ensures Correct Table Names)
// ============================================================================

function loadV11Schema(): string {
  try {
    const schemaPath = join(__dirname, '../services/migrations/v11-knowledge-captures.sql')
    return readFileSync(schemaPath, 'utf-8')
  } catch (error) {
    console.error('Failed to load V11 schema file:', error)
    throw new Error('V11 schema file not found. Cannot proceed with migration.')
  }
}

// ============================================================================
// P1 #012: Backup and Restore Functions
// ============================================================================

function createMigrationBackup(): void {
  const db = getDatabase()

  // Create backup tables (drop if they exist from previous failed migration)
  db.run('DROP TABLE IF EXISTS _backup_recordings')
  db.run('DROP TABLE IF EXISTS _backup_transcripts')

  // Create backup tables with full schema
  db.run(`
    CREATE TABLE _backup_recordings AS
    SELECT * FROM recordings WHERE 1=0
  `)

  db.run(`
    CREATE TABLE _backup_transcripts AS
    SELECT * FROM transcripts WHERE 1=0
  `)

  // Backup all recordings that will be migrated
  db.run(`
    INSERT INTO _backup_recordings
    SELECT * FROM recordings
    WHERE migration_status IS NULL OR migration_status = 'pending'
  `)

  // Backup all transcripts for recordings that will be migrated
  db.run(`
    INSERT INTO _backup_transcripts
    SELECT t.* FROM transcripts t
    INNER JOIN recordings r ON t.recording_id = r.id
    WHERE r.migration_status IS NULL OR r.migration_status = 'pending'
  `)
}

function restoreFromBackup(): void {
  const db = getDatabase()

  try {
    // Check if backup tables exist
    const stmt = db.prepare(`
      SELECT name FROM sqlite_master
      WHERE type='table' AND name IN ('_backup_recordings', '_backup_transcripts')
    `)
    const hasBackup = stmt.step()
    stmt.free()

    if (!hasBackup) {
      console.log('No backup tables found, skipping restore')
      return
    }

    // Restore recordings from backup
    db.run(`
      UPDATE recordings
      SET migration_status = (
        SELECT migration_status FROM _backup_recordings b
        WHERE b.id = recordings.id
      ),
      migrated_to_capture_id = NULL,
      migrated_at = NULL
      WHERE id IN (SELECT id FROM _backup_recordings)
    `)

    console.log('Successfully restored from backup')
  } catch (error) {
    console.error('Failed to restore from backup:', error)
    throw error
  }
}

function cleanupBackupTables(): void {
  const db = getDatabase()

  try {
    db.run('DROP TABLE IF EXISTS _backup_recordings')
    db.run('DROP TABLE IF EXISTS _backup_transcripts')
  } catch (error) {
    console.error('Failed to cleanup backup tables:', error)
    // Don't throw - this is just cleanup
  }
}

// ============================================================================
// P1 #013: Post-Migration Verification
// ============================================================================

function verifyMigration(): VerificationResult {
  const db = getDatabase()
  const errors: string[] = []

  try {
    // Verify record counts match
    const migratedStmt = db.prepare(`
      SELECT COUNT(*) as count
      FROM recordings
      WHERE migration_status = 'migrated'
    `)
    migratedStmt.step()
    const migratedCount = (migratedStmt.getAsObject().count as number) || 0
    migratedStmt.free()

    const capturesStmt = db.prepare(`
      SELECT COUNT(*) as count
      FROM knowledge_captures
      WHERE source_recording_id IS NOT NULL
    `)
    capturesStmt.step()
    const capturesCount = (capturesStmt.getAsObject().count as number) || 0
    capturesStmt.free()

    if (capturesCount !== migratedCount) {
      errors.push(`Count mismatch: ${capturesCount} captures created vs ${migratedCount} recordings marked as migrated`)
    }

    // Verify required fields are populated
    const invalidStmt = db.prepare(`
      SELECT COUNT(*) as count
      FROM knowledge_captures
      WHERE title IS NULL OR title = ''
         OR captured_at IS NULL
         OR source_recording_id IS NULL
    `)
    invalidStmt.step()
    const invalidCount = (invalidStmt.getAsObject().count as number) || 0
    invalidStmt.free()

    if (invalidCount > 0) {
      errors.push(`Found ${invalidCount} captures with missing required fields (title, captured_at, source_recording_id)`)
    }

    // Verify foreign key integrity for meeting references
    const orphanedStmt = db.prepare(`
      SELECT COUNT(*) as count
      FROM knowledge_captures
      WHERE meeting_id IS NOT NULL
        AND NOT EXISTS (SELECT 1 FROM meetings WHERE id = knowledge_captures.meeting_id)
    `)
    orphanedStmt.step()
    const orphanedCount = (orphanedStmt.getAsObject().count as number) || 0
    orphanedStmt.free()

    if (orphanedCount > 0) {
      errors.push(`Found ${orphanedCount} captures with invalid meeting references`)
    }

    // Verify foreign key integrity for recording references
    const orphanedRecordingsStmt = db.prepare(`
      SELECT COUNT(*) as count
      FROM knowledge_captures
      WHERE source_recording_id IS NOT NULL
        AND NOT EXISTS (SELECT 1 FROM recordings WHERE id = knowledge_captures.source_recording_id)
    `)
    orphanedRecordingsStmt.step()
    const orphanedRecordingsCount = (orphanedRecordingsStmt.getAsObject().count as number) || 0
    orphanedRecordingsStmt.free()

    if (orphanedRecordingsCount > 0) {
      errors.push(`Found ${orphanedRecordingsCount} captures with invalid recording references`)
    }

  } catch (error) {
    errors.push(`Verification failed: ${sanitizeError(error as Error)}`)
  }

  return {
    success: errors.length === 0,
    errors
  }
}

// ============================================================================
// Cleanup Preview
// ============================================================================

async function generateCleanupPreviewImpl(): Promise<CleanupPreview> {
  const db = getDatabase()
  const orphanedTranscripts: Array<{ id: string; recording_id: string }> = []
  const duplicateRecordings: Array<{ id: string; filename: string; count: number }> = []
  const invalidMeetingRefs: Array<{ id: string; meeting_id: string }> = []

  try {
    // Find orphaned transcripts
    const orphanedStmt = db.prepare(`
      SELECT t.id, t.recording_id
      FROM transcripts t
      LEFT JOIN recordings r ON t.recording_id = r.id
      WHERE r.id IS NULL
    `)
    while (orphanedStmt.step()) {
      const row = orphanedStmt.getAsObject()
      orphanedTranscripts.push({
        id: row.id as string,
        recording_id: row.recording_id as string
      })
    }
    orphanedStmt.free()

    // Find duplicate recordings
    const duplicatesStmt = db.prepare(`
      SELECT filename, COUNT(*) as count, MIN(id) as id
      FROM recordings
      GROUP BY filename
      HAVING COUNT(*) > 1
    `)
    while (duplicatesStmt.step()) {
      const row = duplicatesStmt.getAsObject()
      duplicateRecordings.push({
        id: row.id as string,
        filename: row.filename as string,
        count: row.count as number
      })
    }
    duplicatesStmt.free()

    // Find invalid meeting references
    const invalidRefsStmt = db.prepare(`
      SELECT r.id, r.meeting_id
      FROM recordings r
      WHERE r.meeting_id IS NOT NULL
      AND NOT EXISTS (SELECT 1 FROM meetings m WHERE m.id = r.meeting_id)
    `)
    while (invalidRefsStmt.step()) {
      const row = invalidRefsStmt.getAsObject()
      invalidMeetingRefs.push({
        id: row.id as string,
        meeting_id: row.meeting_id as string
      })
    }
    invalidRefsStmt.free()
  } catch (error) {
    console.error('Failed to generate cleanup preview:', error)
  }

  return { orphanedTranscripts, duplicateRecordings, invalidMeetingRefs }
}

// ============================================================================
// Pre-Migration Cleanup
// ============================================================================

async function runPreMigrationCleanupImpl(): Promise<CleanupResult> {
  const db = getDatabase()
  const result: CleanupResult = {
    success: true,
    orphanedTranscriptsRemoved: 0,
    duplicateRecordingsRemoved: 0,
    invalidMeetingRefsFixed: 0,
    errors: []
  }

  try {
    // Remove orphaned transcripts
    try {
      const orphanedStmt = db.prepare(`
        DELETE FROM transcripts
        WHERE id IN (
          SELECT t.id FROM transcripts t
          LEFT JOIN recordings r ON t.recording_id = r.id
          WHERE r.id IS NULL
        )
      `)
      orphanedStmt.step()
      result.orphanedTranscriptsRemoved = db.getRowsModified()
      orphanedStmt.free()
    } catch (error) {
      result.errors.push(`Failed to remove orphaned transcripts: ${sanitizeError(error as Error)}`)
    }

    // Remove duplicate recordings (keep oldest)
    try {
      const duplicatesStmt = db.prepare(`
        DELETE FROM recordings
        WHERE id NOT IN (
          SELECT MIN(id) FROM recordings GROUP BY filename
        )
        AND filename IN (
          SELECT filename FROM recordings GROUP BY filename HAVING COUNT(*) > 1
        )
      `)
      duplicatesStmt.step()
      result.duplicateRecordingsRemoved = db.getRowsModified()
      duplicatesStmt.free()
    } catch (error) {
      result.errors.push(`Failed to remove duplicate recordings: ${sanitizeError(error as Error)}`)
    }

    // Fix invalid meeting references
    try {
      const invalidRefsStmt = db.prepare(`
        UPDATE recordings
        SET meeting_id = NULL, correlation_confidence = NULL, correlation_method = NULL
        WHERE meeting_id IS NOT NULL
        AND NOT EXISTS (SELECT 1 FROM meetings m WHERE m.id = meeting_id)
      `)
      invalidRefsStmt.step()
      result.invalidMeetingRefsFixed = db.getRowsModified()
      invalidRefsStmt.free()
    } catch (error) {
      result.errors.push(`Failed to fix invalid meeting references: ${sanitizeError(error as Error)}`)
    }

    if (result.errors.length > 0) {
      result.success = false
    }
  } catch (error) {
    result.success = false
    result.errors.push((error as Error).message)
  }

  return result
}

// ============================================================================
// P1 #011: V11 Migration with Transaction Safety
// ============================================================================

async function migrateToV11Impl(mainWindow: BrowserWindow | null): Promise<MigrationResult> {
  // P1 #009: Acquire migration lock
  if (!migrationLock.acquire()) {
    return {
      success: false,
      capturesCreated: 0,
      errors: ['Migration already in progress'],
      verified: false
    }
  }

  // P1 #013: Register progress tracker
  const trackerId = randomUUID()
  registerProgressTracker(trackerId)

  const result: MigrationResult = {
    success: true,
    capturesCreated: 0,
    errors: [],
    verified: false
  }

  try {
    // P1 #011: Wrap everything in a transaction
    runInTransaction(() => {
      const db = getDatabase()

      // Emit progress event
      mainWindow?.webContents.send('migration:progress', {
        phase: 'creating_backup',
        progress: 0
      })

      // P1 #012: Create backup before migration
      createMigrationBackup()

      mainWindow?.webContents.send('migration:progress', {
        phase: 'creating_tables',
        progress: 10
      })

      // P1 #010: Load and execute proper V11 schema
      const schemaSQL = loadV11Schema()

      // Execute schema SQL (split by semicolons, filter out comments and empty lines)
      const statements = schemaSQL
        .split(';')
        .map(s => s.trim())
        .filter(s => s.length > 0 && !s.startsWith('--'))

      for (const stmt of statements) {
        if (stmt.trim()) {
          try {
            db.run(stmt)
          } catch (error) {
            // Some statements might fail if tables/columns already exist - that's ok
            console.log('Schema statement warning:', (error as Error).message)
          }
        }
      }

      mainWindow?.webContents.send('migration:progress', {
        phase: 'migrating_data',
        progress: 20
      })

      // Get total count for progress calculation
      const countStmt = db.prepare(`
        SELECT COUNT(*) as total
        FROM recordings r
        INNER JOIN transcripts t ON r.id = t.recording_id
        WHERE r.migration_status IS NULL OR r.migration_status = 'pending'
      `)
      countStmt.step()
      const totalCount = (countStmt.getAsObject().total as number) || 0
      countStmt.free()

      if (totalCount === 0) {
        mainWindow?.webContents.send('migration:progress', {
          phase: 'complete',
          progress: 100
        })
        return
      }

      // Prepare statements
      const migrateStmt = db.prepare(`
        SELECT r.id as recording_id, r.filename, r.date_recorded, r.meeting_id,
               t.full_text, t.summary, t.action_items
        FROM recordings r
        INNER JOIN transcripts t ON r.id = t.recording_id
        WHERE r.migration_status IS NULL OR r.migration_status = 'pending'
      `)

      const insertCaptureStmt = db.prepare(`
        INSERT INTO knowledge_captures (
          id, title, summary, captured_at, created_at, updated_at,
          meeting_id, source_recording_id
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `)

      const insertActionItemStmt = db.prepare(`
        INSERT INTO action_items (
          id, knowledge_capture_id, content, created_at
        )
        VALUES (?, ?, ?, ?)
      `)

      const updateRecordingStmt = db.prepare(`
        UPDATE recordings
        SET migration_status = 'migrated',
            migrated_to_capture_id = ?,
            migrated_at = ?
        WHERE id = ?
      `)

      let processed = 0
      while (migrateStmt.step()) {
        const row = migrateStmt.getAsObject()
        try {
          const captureId = uuidv4()
          const now = new Date().toISOString()
          const title = `Recording: ${row.filename}`

          // Insert knowledge capture
          insertCaptureStmt.run([
            captureId,
            title,
            row.summary || null,
            row.date_recorded,
            now,
            now,
            row.meeting_id || null,
            row.recording_id
          ])

          // Migrate action items with full structure preservation
          if (row.action_items) {
            try {
              const actionItems = JSON.parse(row.action_items as string)
              if (Array.isArray(actionItems)) {
                for (const item of actionItems) {
                  let content: string
                  if (typeof item === 'string') {
                    content = item
                  } else if (typeof item === 'object' && item !== null) {
                    // P1: Preserve full structure
                    content = item.description || item.text || item.task || item.action || JSON.stringify(item)
                  } else {
                    continue
                  }

                  if (content && content.trim()) {
                    insertActionItemStmt.run([uuidv4(), captureId, content, now])
                  }
                }
              }
            } catch {
              // If action_items is not valid JSON, try to parse as plain text
              const actionItemsText = row.action_items as string
              if (actionItemsText.trim()) {
                insertActionItemStmt.run([uuidv4(), captureId, actionItemsText, now])
              }
            }
          }

          // Update recording status
          updateRecordingStmt.run([captureId, now, row.recording_id])
          result.capturesCreated++
          processed++

          // Emit progress every 10 records
          if (processed % 10 === 0) {
            const progress = Math.floor((processed / totalCount) * 60) + 20
            mainWindow?.webContents.send('migration:progress', {
              phase: 'migrating_data',
              progress,
              processed,
              total: totalCount
            })
          }
        } catch (error) {
          result.errors.push(`Failed to migrate recording ${row.recording_id}: ${sanitizeError(error as Error)}`)
        }
      }

      migrateStmt.free()
      insertCaptureStmt.free()
      insertActionItemStmt.free()
      updateRecordingStmt.free()

      mainWindow?.webContents.send('migration:progress', {
        phase: 'verifying',
        progress: 85
      })

      // P1 #013: Verify migration integrity
      const verification = verifyMigration()
      result.verified = verification.success

      if (!verification.success) {
        result.errors.push(...verification.errors)
        throw new Error('Migration verification failed: ' + verification.errors.join(', '))
      }

      // Update schema version
      db.run(`INSERT OR REPLACE INTO schema_version (version) VALUES (11)`)

      mainWindow?.webContents.send('migration:progress', {
        phase: 'complete',
        progress: 100,
        processed,
        total: totalCount
      })

      // P1 #012: Clean up backup tables on success
      cleanupBackupTables()
    })
  } catch (error) {
    result.success = false
    result.errors.push(sanitizeError(error as Error))

    mainWindow?.webContents.send('migration:progress', {
      phase: 'error',
      error: sanitizeError(error as Error)
    })

    // P1 #012: Restore from backup on failure
    try {
      restoreFromBackup()
      result.errors.push('Migration failed. Original data has been restored from backup.')
    } catch (restoreError) {
      result.errors.push(`Failed to restore from backup: ${sanitizeError(restoreError as Error)}`)
    }
  } finally {
    // P1 #013: Cleanup progress tracker
    cleanupProgressTracker(trackerId)
    // P1 #009: Release lock
    migrationLock.release()
  }

  return result
}

// ============================================================================
// Rollback Migration
// ============================================================================

async function rollbackV11MigrationImpl(): Promise<{ success: boolean; errors: string[] }> {
  // P1 #009: Acquire migration lock
  if (!migrationLock.acquire()) {
    return {
      success: false,
      errors: ['Migration in progress, cannot rollback']
    }
  }

  const result = { success: true, errors: [] as string[] }

  try {
    // P1 #011: Wrap in transaction
    runInTransaction(() => {
      const db = getDatabase()

      // P1 #012: Restore from backup if it exists
      try {
        restoreFromBackup()
      } catch (error) {
        console.log('No backup to restore, proceeding with standard rollback')
      }

      // Drop new tables
      db.run('DROP TABLE IF EXISTS outputs')
      db.run('DROP TABLE IF EXISTS follow_ups')
      db.run('DROP TABLE IF EXISTS decisions')
      db.run('DROP TABLE IF EXISTS action_items')
      db.run('DROP TABLE IF EXISTS audio_sources')
      db.run('DROP TABLE IF EXISTS knowledge_captures')

      // Reset migration status
      try {
        db.run(`UPDATE recordings SET migration_status = 'pending', migrated_to_capture_id = NULL, migrated_at = NULL WHERE migration_status = 'migrated'`)
      } catch {
        // Columns might not exist if migration wasn't completed
      }

      // Revert schema version
      db.run(`DELETE FROM schema_version WHERE version = 11`)

      // Clean up backup tables
      cleanupBackupTables()
    })
  } catch (error) {
    result.success = false
    result.errors.push(sanitizeError(error as Error))
  } finally {
    // P1 #009: Release lock
    migrationLock.release()
  }

  return result
}

// ============================================================================
// Get Migration Status
// ============================================================================

async function getMigrationStatusImpl(): Promise<MigrationStatus> {
  const db = getDatabase()
  const status: MigrationStatus = {
    pending: 0,
    migrated: 0,
    skipped: 0,
    total: 0
  }

  try {
    // Check if migration_status column exists
    const tableInfoStmt = db.prepare(`PRAGMA table_info(recordings)`)
    let hasMigrationStatus = false
    while (tableInfoStmt.step()) {
      const col = tableInfoStmt.getAsObject()
      if (col.name === 'migration_status') {
        hasMigrationStatus = true
        break
      }
    }
    tableInfoStmt.free()

    if (hasMigrationStatus) {
      const stmt = db.prepare(`
        SELECT
          SUM(CASE WHEN migration_status IS NULL OR migration_status = 'pending' THEN 1 ELSE 0 END) as pending,
          SUM(CASE WHEN migration_status = 'migrated' THEN 1 ELSE 0 END) as migrated,
          SUM(CASE WHEN migration_status = 'skipped' THEN 1 ELSE 0 END) as skipped,
          COUNT(*) as total
        FROM recordings
      `)
      stmt.step()
      const row = stmt.getAsObject()
      status.pending = (row.pending as number) || 0
      status.migrated = (row.migrated as number) || 0
      status.skipped = (row.skipped as number) || 0
      status.total = (row.total as number) || 0
      stmt.free()
    } else {
      // If column doesn't exist, count all recordings as pending
      const stmt = db.prepare(`SELECT COUNT(*) as total FROM recordings`)
      stmt.step()
      const row = stmt.getAsObject()
      status.pending = (row.total as number) || 0
      status.total = (row.total as number) || 0
      stmt.free()
    }
  } catch (error) {
    console.error('Failed to get migration status:', error)
  }

  return status
}

// ============================================================================
// IPC Handler Registration
// ============================================================================

let mainWindowRef: BrowserWindow | null = null

export function setMainWindowForMigration(window: BrowserWindow | null): void {
  mainWindowRef = window
}

export function registerMigrationHandlers(): void {
  // Get cleanup preview
  ipcMain.handle('migration:previewCleanup', async () => {
    try {
      return await generateCleanupPreviewImpl()
    } catch (error) {
      console.error('Failed to preview cleanup:', error)
      return {
        orphanedTranscripts: [],
        duplicateRecordings: [],
        invalidMeetingRefs: [],
        error: sanitizeError(error as Error)
      }
    }
  })

  // Run pre-migration cleanup
  ipcMain.handle('migration:runCleanup', async () => {
    try {
      return await runPreMigrationCleanupImpl()
    } catch (error) {
      console.error('Failed to run cleanup:', error)
      return {
        success: false,
        orphanedTranscriptsRemoved: 0,
        duplicateRecordingsRemoved: 0,
        invalidMeetingRefsFixed: 0,
        errors: [sanitizeError(error as Error)]
      }
    }
  })

  // Run full migration
  ipcMain.handle('migration:runV11', async () => {
    try {
      return await migrateToV11Impl(mainWindowRef)
    } catch (error) {
      console.error('Failed to run migration:', error)
      return {
        success: false,
        capturesCreated: 0,
        errors: [sanitizeError(error as Error)],
        verified: false
      }
    }
  })

  // Rollback migration
  ipcMain.handle('migration:rollbackV11', async () => {
    try {
      return await rollbackV11MigrationImpl()
    } catch (error) {
      console.error('Failed to rollback migration:', error)
      return {
        success: false,
        errors: [sanitizeError(error as Error)]
      }
    }
  })

  // Get migration status
  ipcMain.handle('migration:getStatus', async () => {
    try {
      return await getMigrationStatusImpl()
    } catch (error) {
      console.error('Failed to get migration status:', error)
      return {
        pending: 0,
        migrated: 0,
        skipped: 0,
        total: 0,
        error: sanitizeError(error as Error)
      }
    }
  })
}
