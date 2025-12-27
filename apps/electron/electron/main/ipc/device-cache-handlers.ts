import { ipcMain } from 'electron'
import { getDatabase, queryAll, run } from '../services/database'

// Device cache stores the list of files from the HiDock device for offline access
// This allows the UI to show the device file list even when disconnected

interface CachedDeviceFile {
  filename: string
  size: number
  duration: number
  dateCreated: string
}

export function registerDeviceCacheHandlers(): void {
  // Get all cached device files
  ipcMain.handle('deviceCache:getAll', async () => {
    try {
      const files = queryAll<CachedDeviceFile>(
        'SELECT * FROM device_file_cache ORDER BY dateCreated DESC'
      )
      return files
    } catch (error) {
      // Table might not exist yet
      console.log('[DeviceCache] Cache table not initialized, returning empty array')
      return []
    }
  })

  // Save all device files to cache (replaces existing cache)
  ipcMain.handle('deviceCache:saveAll', async (_event, files: CachedDeviceFile[]) => {
    try {
      const db = getDatabase()

      // Create table if it doesn't exist
      db.run(`
        CREATE TABLE IF NOT EXISTS device_file_cache (
          filename TEXT PRIMARY KEY,
          size INTEGER,
          duration REAL,
          dateCreated TEXT
        )
      `)

      // Clear existing cache
      db.run('DELETE FROM device_file_cache')

      // Insert new files
      const stmt = db.prepare(
        'INSERT INTO device_file_cache (filename, size, duration, dateCreated) VALUES (?, ?, ?, ?)'
      )

      for (const file of files) {
        stmt.run([file.filename, file.size, file.duration, file.dateCreated])
      }
      stmt.free()

      console.log(`[DeviceCache] Cached ${files.length} files`)
    } catch (error) {
      console.error('[DeviceCache] Error saving cache:', error)
      throw error
    }
  })

  // Clear the device cache
  ipcMain.handle('deviceCache:clear', async () => {
    try {
      run('DELETE FROM device_file_cache')
      console.log('[DeviceCache] Cache cleared')
    } catch (error) {
      // Table might not exist
      console.log('[DeviceCache] Cache already empty or not initialized')
    }
  })

  console.log('[DeviceCache] IPC handlers registered')
}
