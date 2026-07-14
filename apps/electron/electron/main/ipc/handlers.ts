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
import { registerTranscriptsHandlers } from './transcripts-handlers'
import { registerJensenHandlers } from './jensen-handlers'
import { registerKnowledgeGraphHandlers } from './knowledge-graph-handlers'
import { registerDevicePipelineHandlers } from './device-pipeline-handlers'
import { registerBriefingHandlers } from './briefing-handlers'
import { registerActionItemsHandlers } from './action-items-handlers'
import { registerIdentityHandlers } from './identity-handlers'
import { registerArtifactHandlers } from './artifact-handlers'
import { registerTranscriptUpgradeHandlers } from './transcript-upgrade-handlers'
import { registerConnectorsHandlers } from './connectors-handlers'
import { registerSelfIdentificationHandlers } from './self-identification-handlers'
import { registerTurnSpeakersHandlers } from './turn-speakers-handlers'
import { registerRecordingDeletionHandlers } from './recording-deletion-handlers'
import { registerTranscriptionHandlers } from './transcription-handlers'
import { registerReDiarizeHandlers } from './re-diarize-handlers'
import { registerTimelineHandlers } from './timeline-handlers'
import { registerClipboardCaptureHandlers } from './clipboard-capture-handlers'
import { registerGitCommitsHandlers } from './git-commits-handlers'
import { registerWaveformCacheHandlers } from './waveform-cache-handlers'
import { registerBrainsHandlers } from './brains-handlers'
import { registerHandoverHandlers } from './handover-handlers'
import { registerValueBackfillHandlers } from './value-backfill-handlers'
import { ipcMain } from 'electron'
import { installFeatureGate } from '../services/feature-gate'

export function registerIpcHandlers(): void {
  // Track I (Gate 2): wrap ipcMain.handle for the duration of registration so
  // every feature-owned channel is auto-gated fail-closed. Core/shared channels
  // pass through untouched, and under the default `full` preset nothing is gated
  // (zero behavior change). Restored in `finally` so later dynamic handlers are
  // unaffected. See services/feature-gate.ts for the rationale.
  const restoreGate = installFeatureGate(ipcMain)
  try {
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
  registerTranscriptsHandlers()
  registerJensenHandlers()
  registerKnowledgeGraphHandlers()
  // Slice 4: DevicePipeline state/action IPC bridge. INERT — the live app still
  // uses the old device path; this only exposes get-state/actions + event bridge.
  // It does NOT call initAutoConnect (no competing USB connect listener).
  registerDevicePipelineHandlers()
  registerBriefingHandlers()
  registerActionItemsHandlers()
  registerIdentityHandlers()
  registerArtifactHandlers()
  registerTranscriptUpgradeHandlers()
  registerConnectorsHandlers()
  registerSelfIdentificationHandlers()
  registerTurnSpeakersHandlers()
  registerRecordingDeletionHandlers()
  registerTranscriptionHandlers()
  registerReDiarizeHandlers()
  registerTimelineHandlers()
  registerClipboardCaptureHandlers()
  registerGitCommitsHandlers()
  registerWaveformCacheHandlers()
  registerBrainsHandlers()
  registerHandoverHandlers()
  registerValueBackfillHandlers()
  } finally {
    restoreGate()
  }

  console.log('All IPC handlers registered')
}
