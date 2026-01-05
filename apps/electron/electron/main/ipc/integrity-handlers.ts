/**
 * IPC handlers for the Data Integrity Service
 */

import { existsSync } from 'fs'
import { ipcMain } from 'electron'
import { getIntegrityService } from '../services/integrity-service'
import { deleteWronglyNamedRecordings } from '../services/file-storage'
import { clearAllSyncedFiles, queryAll, run, saveDatabase } from '../services/database'

interface Recording {
  id: string
  filename: string
  file_path: string | null
}

export function registerIntegrityHandlers(): void {
  const service = getIntegrityService()

  // Run full integrity scan
  ipcMain.handle('integrity:run-scan', async () => {
    return service.runFullScan()
  })

  // Get last scan report
  ipcMain.handle('integrity:get-report', () => {
    return service.getLastReport()
  })

  // Repair a specific issue
  ipcMain.handle('integrity:repair-issue', async (_, issueId: string) => {
    return service.repairIssue(issueId)
  })

  // Repair all auto-repairable issues
  ipcMain.handle('integrity:repair-all', async () => {
    return service.repairAllAuto()
  })

  // Run startup checks (can also be called manually)
  ipcMain.handle('integrity:run-startup-checks', async () => {
    return service.runStartupChecks()
  })

  // Cleanup wrongly-named recordings and clear sync records
  // This deletes files with wrong format (e.g., 2025-12-27_2252.wav) and clears synced_files table
  // After this, connect device and files will be re-downloaded with correct names
  ipcMain.handle('integrity:cleanup-wrongly-named', async () => {
    console.log('[IntegrityHandlers] Starting cleanup of wrongly-named recordings...')

    // Step 1: Delete physical files with wrong naming format
    const fileResult = deleteWronglyNamedRecordings()

    // Step 2: Clear synced_files database table so files can be re-downloaded
    const dbCount = clearAllSyncedFiles()

    const result = {
      deletedFiles: fileResult.deleted,
      keptFiles: fileResult.kept,
      clearedDbRecords: dbCount
    }

    console.log('[IntegrityHandlers] Cleanup complete:', result)
    return result
  })

  // AGGRESSIVE PURGE: Delete ALL recordings where file doesn't exist or file_path is not set
  // This is the nuclear option when Health Check doesn't find issues
  ipcMain.handle('integrity:purge-missing-files', async () => {
    console.log('[IntegrityHandlers] Starting PURGE of recordings with missing files...')

    // Get ALL recordings from database
    const allRecordings = queryAll<Recording>('SELECT id, filename, file_path FROM recordings')
    console.log(`[IntegrityHandlers] Found ${allRecordings.length} total recordings in database`)

    const deleted: string[] = []
    const kept: string[] = []

    for (const rec of allRecordings) {
      const hasValidPath = rec.file_path && rec.file_path.trim() !== ''
      const fileExists = hasValidPath && existsSync(rec.file_path!)

      if (!fileExists) {
        // Delete this record - file is missing or path is not set
        console.log(`[IntegrityHandlers] Deleting orphaned record: ${rec.filename} (path: ${rec.file_path || 'NULL'}, exists: ${fileExists})`)
        try {
          run('DELETE FROM recordings WHERE id = ?', [rec.id])
          deleted.push(rec.filename)
        } catch (err) {
          console.error(`[IntegrityHandlers] Failed to delete ${rec.filename}:`, err)
        }
      } else {
        kept.push(rec.filename)
      }
    }

    if (deleted.length > 0) {
      saveDatabase()
    }

    const result = {
      totalRecords: allRecordings.length,
      deleted: deleted.length,
      kept: kept.length,
      deletedFiles: deleted
    }

    console.log('[IntegrityHandlers] PURGE complete:', result)
    return result
  })

  console.log('[IntegrityHandlers] IPC handlers registered')
}
