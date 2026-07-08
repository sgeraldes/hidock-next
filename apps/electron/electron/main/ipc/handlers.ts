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
import { registerDeviceCacheHandlers } from './device-cache-handlers'
import { registerDownloadServiceHandlers } from '../services/download-service'
import { registerIntegrityHandlers } from './integrity-handlers'
import { registerKnowledgeHandlers } from './knowledge-handlers'
import { registerAssistantHandlers } from './assistant-handlers'
import { registerActionablesHandlers } from './actionables-handlers'
import { registerMeetingsHandlers } from './meetings-handlers'
import { registerJensenHandlers } from './jensen-handlers'
import { registerKnowledgeGraphHandlers } from './knowledge-graph-handlers'
import { registerDevicePipelineHandlers } from './device-pipeline-handlers'
import { registerBriefingHandlers } from './briefing-handlers'

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
  registerDeviceCacheHandlers()
  registerDownloadServiceHandlers()
  registerIntegrityHandlers()
  registerKnowledgeHandlers()
  registerAssistantHandlers()
  registerActionablesHandlers()
  registerMeetingsHandlers()
  registerJensenHandlers()
  registerKnowledgeGraphHandlers()
  // Slice 4: DevicePipeline state/action IPC bridge. INERT — the live app still
  // uses the old device path; this only exposes get-state/actions + event bridge.
  // It does NOT call initAutoConnect (no competing USB connect listener).
  registerDevicePipelineHandlers()
  registerBriefingHandlers()

  console.log('All IPC handlers registered')
}
