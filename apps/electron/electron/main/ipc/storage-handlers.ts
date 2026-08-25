import { BrowserWindow, dialog, ipcMain, shell } from 'electron'
import { randomUUID } from 'crypto'
import { existsSync } from 'fs'
import {
  getStorageInfo,
  getRecordingsPath,
  getTranscriptsPath,
  readRecordingFile,
  deleteRecording,
  saveRecording
} from '../services/file-storage'
import {
  insertRecording,
  enrichRecordingScheduleMetadata,
  addSyncedFile,
  getRecordingIdByFilePath,
  type Recording
} from '../services/database'
import {
  OpenFolderSchema,
  ReadRecordingFileSchema,
  DeleteRecordingFileSchema,
  SaveRecordingSchema
} from './validation'
import { getConfig } from '../services/config'
import { isFeatureEnabled } from '../services/feature-gate'

// Month name mapping for HiDock filename parsing
// Shared HiDock filename date parser (single source of truth lives in
// services/hidock-filename.ts) — see that module for why filename dates are
// authoritative over mtimes.
import { parseHiDockFilenameDate } from '../services/hidock-filename'

export function registerStorageHandlers(): void {
  // Get storage info
  ipcMain.handle('storage:get-info', async () => {
    try {
      return { success: true, data: getStorageInfo() }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error'
      return { success: false, error: message }
    }
  })

  // Open folder in file explorer
  ipcMain.handle('storage:open-folder', async (_, folder: unknown) => {
    try {
      const result = OpenFolderSchema.safeParse({ folder })
      if (!result.success) {
        return { success: false, error: result.error.issues[0]?.message || 'Invalid folder type' }
      }

      let path: string
      switch (result.data.folder) {
        case 'recordings':
          path = getRecordingsPath()
          break
        case 'transcripts':
          path = getTranscriptsPath()
          break
        case 'data':
          path = getStorageInfo().dataPath
          break
      }

      await shell.openPath(path)
      return { success: true, data: true }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error'
      return { success: false, error: message }
    }
  })

  ipcMain.handle('storage:select-folder', async (_, currentPath: unknown) => {
    try {
      const focusedWindow = BrowserWindow.getFocusedWindow()
      const options = {
        title: 'Select storage folder',
        properties: ['openDirectory', 'createDirectory'] as Electron.OpenDialogOptions['properties'],
        defaultPath: typeof currentPath === 'string' && currentPath.trim() ? currentPath : undefined
      }

      const result = focusedWindow
        ? await dialog.showOpenDialog(focusedWindow, options)
        : await dialog.showOpenDialog(options)

      if (result.canceled || result.filePaths.length === 0) {
        return { success: true, data: null }
      }

      return { success: true, data: result.filePaths[0] }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error'
      return { success: false, error: message }
    }
  })

  ipcMain.handle('storage:open-file', async (_, filePath: unknown) => {
    try {
      if (typeof filePath !== 'string' || !filePath) {
        return { success: false, error: 'Invalid file path' }
      }
      // ADV45-2 (round-47) — EXISTENCE-SCOPED owner gate: the path must resolve to
      // a REAL recording row. Owner may open their own trashed/personal/low-value
      // recording, but a hard-purged / orphan / arbitrary path is refused (also
      // blocks arbitrary-path traversal to files no recording owns).
      if (!getRecordingIdByFilePath(filePath)) {
        return { success: false, error: 'File not found' }
      }
      if (!existsSync(filePath)) {
        return { success: false, error: 'File not found' }
      }
      const errorMessage = await shell.openPath(filePath)
      if (errorMessage) {
        return { success: false, error: errorMessage }
      }
      return { success: true, data: true }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error'
      return { success: false, error: message }
    }
  })

  ipcMain.handle('storage:reveal-in-folder', async (_, filePath: unknown) => {
    try {
      if (typeof filePath !== 'string' || !filePath) {
        return { success: false, error: 'Invalid file path' }
      }
      // ADV45-2 (round-47) — EXISTENCE-SCOPED owner gate (see storage:open-file).
      if (!getRecordingIdByFilePath(filePath)) {
        return { success: false, error: 'File not found' }
      }
      if (!existsSync(filePath)) {
        return { success: false, error: 'File not found' }
      }
      shell.showItemInFolder(filePath)
      return { success: true, data: true }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error'
      return { success: false, error: message }
    }
  })

  ipcMain.handle('storage:read-recording', async (_, filePath: unknown) => {
    try {
      const result = ReadRecordingFileSchema.safeParse({ filePath })
      if (!result.success) {
        return { success: false, error: result.error.issues[0]?.message || 'Invalid file path' }
      }

      // ADV45-2 (round-47) — resolve the path to a canonical recording row and
      // gate BEFORE serving any bytes. EXISTENCE-SCOPED owner action: the owner
      // may play their own trashed/personal/low-value recording, but a
      // hard-purged / orphan / arbitrary path yields no recording ⇒ refuse (no
      // audio bytes). Fail-closed: a lookup failure resolves to null ⇒ refuse.
      if (!getRecordingIdByFilePath(result.data.filePath)) {
        return { success: false, error: 'File not found' }
      }

      const buffer = readRecordingFile(result.data.filePath)
      if (buffer) {
        return { success: true, data: buffer.toString('base64') }
      }
      return { success: false, error: 'File not found' }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error'
      return { success: false, error: message }
    }
  })

  // Delete recording file
  ipcMain.handle('storage:delete-recording', async (_, filePath: unknown) => {
    try {
      const result = DeleteRecordingFileSchema.safeParse({ filePath })
      if (!result.success) {
        return { success: false, error: result.error.issues[0]?.message || 'Invalid file path' }
      }

      const deleted = deleteRecording(result.data.filePath)
      return { success: true, data: deleted }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error'
      return { success: false, error: message }
    }
  })

  // Save recording from device and add to database/transcription queue
  // recordingDateIso is the original recording date from the device (optional)
  ipcMain.handle('storage:save-recording', async (_, filename: unknown, data: unknown, recordingDateIso?: string) => {
    try {
      const result = SaveRecordingSchema.safeParse({ filename, data })
      if (!result.success) {
        return { success: false, error: result.error.issues[0]?.message || 'Invalid save recording request' }
      }

      // Parse the original recording date if provided
      let originalDate: Date | undefined
      if (recordingDateIso) {
        originalDate = new Date(recordingDateIso)
        if (isNaN(originalDate.getTime())) {
          console.warn('Invalid recording date provided:', recordingDateIso)
          originalDate = undefined
        }
      }

      // If no date was passed, try to parse from HiDock filename formats
      if (!originalDate) {
        originalDate = parseHiDockFilenameDate(result.data.filename)
      }

      const buffer = Buffer.from(result.data.data)
      const filePath = await saveRecording(result.data.filename, buffer, undefined, originalDate)

      // Use the parsed date or fall back to current time
      const dateRecorded = originalDate?.toISOString() || new Date().toISOString()

      const recordingId = randomUUID()

      // Only auto-queue for transcription when the user has enabled it AND the
      // transcription feature itself is on (adversarial round-2 [HIGH]: saving is
      // core behavior, but its transcription side effect must respect the feature
      // gate). Mirrors the check inside queueTranscriptionIfEnabled so the row's
      // transcription_status stays honest.
      const autoTranscribe =
        getConfig().transcription.autoTranscribe === true && isFeatureEnabled('transcription')

      // Insert into database
      const recording: Omit<Recording, 'created_at'> = {
        id: recordingId,
        filename: result.data.filename,
        original_filename: result.data.filename,
        file_path: filePath,
        file_size: buffer.length,
        duration_seconds: undefined, // Will be calculated after processing
        date_recorded: dateRecorded,
        meeting_id: undefined,
        correlation_confidence: undefined,
        correlation_method: undefined,
        status: 'pending',
        location: 'both',
        on_device: 1,
        on_local: 1,
        transcription_status: autoTranscribe ? 'pending' : 'none',
        source: 'hidock',
        is_imported: 0
      }

      insertRecording(recording)

      // Use the same current-snapshot, ambiguity-aware matcher as device
      // discovery. The old first-match loop could bind a new file to an obsolete
      // recurring row before transcription had any chance to repair it.
      enrichRecordingScheduleMetadata(recordingId)

      // Add to transcription queue only when auto-transcribe is enabled. Lazy
      // import: keeps the heavy transcription module out of this handler's
      // static surface for the common (no-new-recording) path (execution
      // deferral, not chunk splitting).
      import('../services/transcription').then(({ queueTranscriptionIfEnabled }) => {
        queueTranscriptionIfEnabled(recordingId)
      }).catch(() => {})

      // Track this file as synced so we don't re-download it
      addSyncedFile(result.data.filename, result.data.filename, filePath, buffer.length)

      console.log(
        `Recording saved${autoTranscribe ? ' and queued for transcription' : ''}: ${result.data.filename}`
      )
      return { success: true, data: filePath }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error'
      return { success: false, error: message }
    }
  })
}
