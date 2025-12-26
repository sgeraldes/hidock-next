import { ipcMain, BrowserWindow } from 'electron'
import { getDatabase } from '../services/database'

// Types for migration functions (will be implemented by schema team)
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
}

interface MigrationStatus {
  pending: number
  migrated: number
  skipped: number
  total: number
}

// These will be replaced with actual imports once schema team delivers
// For now, they're placeholder implementations
async function generateCleanupPreviewImpl(): Promise<CleanupPreview> {
  const db = getDatabase()
  const orphanedTranscripts: Array<{ id: string; recording_id: string }> = []
  const duplicateRecordings: Array<{ id: string; filename: string; count: number }> = []
  const invalidMeetingRefs: Array<{ id: string; meeting_id: string }> = []

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

  return { orphanedTranscripts, duplicateRecordings, invalidMeetingRefs }
}

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

    // Remove duplicate recordings (keep oldest)
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

    // Fix invalid meeting references
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
    result.success = false
    result.errors.push((error as Error).message)
  }

  return result
}

async function migrateToV11Impl(mainWindow: BrowserWindow | null): Promise<MigrationResult> {
  const db = getDatabase()
  const result: MigrationResult = {
    success: true,
    capturesCreated: 0,
    errors: []
  }

  try {
    // Emit progress event
    mainWindow?.webContents.send('migration:progress', {
      phase: 'creating_tables',
      progress: 0
    })

    // Create knowledge_captures table
    db.run(`
      CREATE TABLE IF NOT EXISTS knowledge_captures (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        capture_type TEXT NOT NULL CHECK(capture_type IN ('meeting', 'recording', 'note', 'external')),
        content TEXT NOT NULL,
        summary TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        source_meeting_id TEXT,
        source_recording_id TEXT,
        metadata TEXT,
        FOREIGN KEY (source_meeting_id) REFERENCES meetings(id),
        FOREIGN KEY (source_recording_id) REFERENCES recordings(id)
      )
    `)

    // Create capture_action_items table
    db.run(`
      CREATE TABLE IF NOT EXISTS capture_action_items (
        id TEXT PRIMARY KEY,
        capture_id TEXT NOT NULL,
        description TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'open' CHECK(status IN ('open', 'in_progress', 'completed', 'cancelled')),
        assigned_to TEXT,
        due_date TEXT,
        created_at TEXT NOT NULL,
        completed_at TEXT,
        FOREIGN KEY (capture_id) REFERENCES knowledge_captures(id) ON DELETE CASCADE
      )
    `)

    // Add migration_status column to recordings
    try {
      db.run(`
        ALTER TABLE recordings ADD COLUMN migration_status TEXT DEFAULT 'pending'
          CHECK(migration_status IN ('pending', 'migrated', 'skipped'))
      `)
    } catch (error) {
      // Column might already exist from a previous migration attempt
      console.log('migration_status column may already exist:', (error as Error).message)
    }

    mainWindow?.webContents.send('migration:progress', {
      phase: 'migrating_data',
      progress: 10
    })

    // Get total count for progress calculation
    const countStmt = db.prepare(`
      SELECT COUNT(*) as total
      FROM recordings r
      INNER JOIN transcripts t ON r.id = t.recording_id
      WHERE r.migration_status = 'pending' OR r.migration_status IS NULL
    `)
    countStmt.step()
    const totalCount = (countStmt.getAsObject().total as number) || 0
    countStmt.free()

    if (totalCount === 0) {
      mainWindow?.webContents.send('migration:progress', {
        phase: 'complete',
        progress: 100
      })
      return result
    }

    // Migrate recordings with transcripts to knowledge_captures
    const migrateStmt = db.prepare(`
      SELECT r.id as recording_id, r.filename, r.date_recorded, r.meeting_id,
             t.full_text, t.summary, t.action_items
      FROM recordings r
      INNER JOIN transcripts t ON r.id = t.recording_id
      WHERE r.migration_status = 'pending' OR r.migration_status IS NULL
    `)

    const insertCaptureStmt = db.prepare(`
      INSERT INTO knowledge_captures (id, title, capture_type, content, summary, created_at, updated_at, source_meeting_id, source_recording_id, metadata)
      VALUES (?, ?, 'recording', ?, ?, ?, ?, ?, ?, ?)
    `)

    const insertActionItemStmt = db.prepare(`
      INSERT INTO capture_action_items (id, capture_id, description, status, created_at)
      VALUES (?, ?, ?, 'open', ?)
    `)

    const updateRecordingStmt = db.prepare(`
      UPDATE recordings SET migration_status = 'migrated' WHERE id = ?
    `)

    let processed = 0
    while (migrateStmt.step()) {
      const row = migrateStmt.getAsObject()
      try {
        const { v4: uuidv4 } = await import('uuid')
        const captureId = uuidv4()
        const now = new Date().toISOString()
        const title = `Recording: ${row.filename}`
        const metadata = JSON.stringify({ original_filename: row.filename })

        insertCaptureStmt.run([
          captureId,
          title,
          row.full_text,
          row.summary || null,
          row.date_recorded,
          now,
          row.meeting_id || null,
          row.recording_id,
          metadata
        ])

        // Extract action items from transcript
        if (row.action_items) {
          try {
            const actionItems = JSON.parse(row.action_items as string)
            if (Array.isArray(actionItems)) {
              for (const item of actionItems) {
                const description = typeof item === 'string' ? item : item.description || item.text
                if (description) {
                  insertActionItemStmt.run([uuidv4(), captureId, description, now])
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

        updateRecordingStmt.run([row.recording_id])
        result.capturesCreated++
        processed++

        // Emit progress every 10 records
        if (processed % 10 === 0) {
          const progress = Math.floor((processed / totalCount) * 90) + 10
          mainWindow?.webContents.send('migration:progress', {
            phase: 'migrating_data',
            progress,
            processed,
            total: totalCount
          })
        }
      } catch (error) {
        result.errors.push(`Failed to migrate recording ${row.recording_id}: ${(error as Error).message}`)
      }
    }

    migrateStmt.free()
    insertCaptureStmt.free()
    insertActionItemStmt.free()
    updateRecordingStmt.free()

    // Update schema version
    db.run(`INSERT OR REPLACE INTO schema_version (version) VALUES (11)`)

    mainWindow?.webContents.send('migration:progress', {
      phase: 'complete',
      progress: 100,
      processed,
      total: totalCount
    })
  } catch (error) {
    result.success = false
    result.errors.push((error as Error).message)
    mainWindow?.webContents.send('migration:progress', {
      phase: 'error',
      error: (error as Error).message
    })
  }

  return result
}

async function rollbackV11MigrationImpl(): Promise<{ success: boolean; errors: string[] }> {
  const db = getDatabase()
  const result = { success: true, errors: [] as string[] }

  try {
    // Drop new tables
    db.run('DROP TABLE IF EXISTS capture_action_items')
    db.run('DROP TABLE IF EXISTS knowledge_captures')

    // Reset migration status (if column exists)
    try {
      db.run(`UPDATE recordings SET migration_status = 'pending' WHERE migration_status = 'migrated'`)
    } catch {
      // Column might not exist if migration wasn't completed
    }

    // Revert schema version
    db.run(`DELETE FROM schema_version WHERE version = 11`)
  } catch (error) {
    result.success = false
    result.errors.push((error as Error).message)
  }

  return result
}

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
          SUM(CASE WHEN migration_status = 'pending' OR migration_status IS NULL THEN 1 ELSE 0 END) as pending,
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
        error: (error as Error).message
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
        errors: [(error as Error).message]
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
        errors: [(error as Error).message]
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
        errors: [(error as Error).message]
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
        error: (error as Error).message
      }
    }
  })
}
