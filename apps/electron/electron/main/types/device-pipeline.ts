/**
 * Shared DevicePipeline state types (Slice 4).
 *
 * These are the PURE, dependency-free projection types that cross the IPC
 * boundary: the main-process DevicePipelineService produces them, the preload
 * bridge forwards them, and the renderer hook (useDevicePipeline) consumes them.
 *
 * They live under electron/main/types/ — which the renderer tsconfig
 * (tsconfig.web.json) already includes — so the renderer can import the state
 * shape WITHOUT pulling in the main-only service graph (jensen / download /
 * database / etc.). The DevicePipelineService re-exports these so existing
 * imports from '../services/device-pipeline' keep working.
 */

import type { DeviceModel } from '@hidock/jensen-protocol'

export type PipelinePhase =
  | 'disconnected'
  | 'connecting'
  | 'initializing'
  | 'scanning'
  | 'reconciling'
  | 'downloading'
  | 'idle'
  | 'error'

export interface PipelineDeviceState {
  model: DeviceModel
  serialNumber: string | null
  firmwareVersion: string | null
  storage: { used: number; capacity: number; freePercent: number } | null
  settings: { autoRecord: boolean } | null
  recordingCount: number
}

export interface PipelineDownloadProgress {
  filename: string
  current: number
  total: number
  bytesDownloaded: number
  totalBytes: number
  eta: number | null
}

export interface PipelineState {
  phase: PipelinePhase
  device: PipelineDeviceState | null
  scanProgress: { current: number; total: number } | null
  downloadProgress: PipelineDownloadProgress | null
  error: string | null
}
