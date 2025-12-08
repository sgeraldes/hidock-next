import { registerConfigHandlers } from './config-handlers'
import { registerDatabaseHandlers } from './database-handlers'
import { registerCalendarHandlers } from './calendar-handlers'
import { registerStorageHandlers } from './storage-handlers'
import { registerRecordingHandlers } from './recording-handlers'
import { registerRAGHandlers } from './rag-handlers'
import { registerAppHandlers } from './app-handlers'

export function registerIpcHandlers(): void {
  // Register all IPC handlers
  registerConfigHandlers()
  registerDatabaseHandlers()
  registerCalendarHandlers()
  registerStorageHandlers()
  registerRecordingHandlers()
  registerRAGHandlers()
  registerAppHandlers()

  console.log('All IPC handlers registered')
}
