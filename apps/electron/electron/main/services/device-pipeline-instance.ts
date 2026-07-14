/**
 * Real-singleton wiring for DevicePipelineService.
 *
 * Kept separate from device-pipeline.ts so the class stays importable in unit
 * tests without pulling in the Electron / native-USB module graph. Critically,
 * this uses STATIC imports: a lazy `require('./jensen')` does NOT resolve in the
 * electron-vite-bundled main process (everything is bundled into one file, so
 * the relative path doesn't exist at runtime) — which crashed startup with
 * "Cannot find module './jensen'".
 */
import {
  DevicePipelineService,
  type PipelineJensen,
  type PipelineDownloadService,
} from './device-pipeline'
import { getJensenDevice } from './jensen'
import { getDownloadService } from './download-service'
import { getConfig } from './config'
import { queueTranscriptionIfEnabled } from './transcription'
import { getRecordingByFilename } from './database'

let pipelineInstance: DevicePipelineService | null = null

export function getDevicePipelineService(): DevicePipelineService {
  if (!pipelineInstance) {
    pipelineInstance = new DevicePipelineService(
      getJensenDevice() as unknown as PipelineJensen,
      getDownloadService() as unknown as PipelineDownloadService,
      {
        getConfig: () => getConfig() as { device?: { autoConnect?: boolean } },
        queueTranscriptionIfEnabled,
        getRecordingByFilename: (filename: string) =>
          getRecordingByFilename(filename) as { id: string } | null | undefined,
      }
    )
  }
  return pipelineInstance
}

/** Test-only: reset the singleton between suites. */
export function __resetDevicePipelineServiceForTests(): void {
  pipelineInstance = null
}
