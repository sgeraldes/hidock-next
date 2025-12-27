import { registerConfigHandlers } from './config-handlers'
import { registerDatabaseHandlers } from './database-handlers'
import { registerCalendarHandlers } from './calendar-handlers'
import { registerStorageHandlers } from './storage-handlers'
import { registerRecordingHandlers } from './recording-handlers'
import { registerRAGHandlers } from './rag-handlers'
import { registerAppHandlers } from './app-handlers'
import { registerContactsHandlers } from './contacts-handlers'
import { registerProjectsHandlers } from './projects-handlers'
import { registerOutputsHandlers } from './outputs-handlers'
import { registerQualityHandlers } from './quality-handlers'
import { registerMigrationHandlers } from './migration-handlers'
import { registerDownloadServiceHandlers } from '../services/download-service'

export function registerIpcHandlers(): void {
  // Register all IPC handlers
  registerConfigHandlers()
  registerDatabaseHandlers()
  registerCalendarHandlers()
  registerStorageHandlers()
  registerRecordingHandlers()
  registerRAGHandlers()
  registerAppHandlers()
  registerContactsHandlers()
  registerProjectsHandlers()
  registerOutputsHandlers()
  registerQualityHandlers()
  registerMigrationHandlers()
  registerDownloadServiceHandlers()

  console.log('All IPC handlers registered')
}
