/**
 * useDevicePipeline — the renderer's ONE authoritative subscription to the
 * main-process DevicePipelineService state projection (Slice 4).
 *
 * On mount it reads the current state via `device-pipeline:get-state` and then
 * subscribes to the `onState` / `onFiles` push events, keeping a local copy in
 * React state. This replaces the renderer juggling device state across several
 * hooks (useDeviceSubscriptions / useDownloadOrchestrator / useUnifiedRecordings)
 * with a single source of truth fed by the coordinator.
 *
 * ⚠ INERT (Slice 4). This hook is built + unit-tested but NOT consumed by any
 * page yet. Activation/cutover happens in a later supervised slice — the live
 * app keeps using the existing device path until then.
 */

import { useEffect, useRef, useState } from 'react'
import type { FileInfo } from '@hidock/jensen-protocol'
import type { PipelineState } from '../../electron/main/types/device-pipeline'

const INITIAL_STATE: PipelineState = {
  phase: 'disconnected',
  device: null,
  scanProgress: null,
  downloadProgress: null,
  error: null
}

export interface UseDevicePipelineResult {
  state: PipelineState
  files: FileInfo[]
  /** Imperative action wrappers (delegate straight to the main-process coordinator). */
  connect: () => Promise<boolean>
  disconnect: () => Promise<void>
  sync: () => Promise<void>
  cancel: () => Promise<void>
  deleteFile: (filename: string) => Promise<{ result: string } | null>
  format: () => Promise<{ result: string } | null>
}

export function useDevicePipeline(): UseDevicePipelineResult {
  const [state, setState] = useState<PipelineState>(INITIAL_STATE)
  const [files, setFiles] = useState<FileInfo[]>([])

  // Avoid setting state after unmount (the get-state read is async).
  const mountedRef = useRef(true)

  useEffect(() => {
    mountedRef.current = true
    const api = window.electronAPI?.devicePipeline
    if (!api) return

    // Initial read of the projected state + files.
    void api
      .getState()
      .then((s) => {
        if (mountedRef.current && s) setState(s)
      })
      .catch(() => {
        /* main process may not be ready yet — push events will catch us up */
      })
    void api
      .getFiles()
      .then((f) => {
        if (mountedRef.current && Array.isArray(f)) setFiles(f as FileInfo[])
      })
      .catch(() => {
        /* same as above */
      })

    // Subscribe to push updates.
    const unsubState = api.onState((s) => {
      if (mountedRef.current && s) setState(s)
    })
    const unsubFiles = api.onFiles((f) => {
      if (mountedRef.current && Array.isArray(f)) setFiles(f as FileInfo[])
    })

    return () => {
      mountedRef.current = false
      unsubState()
      unsubFiles()
    }
  }, [])

  return {
    state,
    files,
    connect: () => window.electronAPI?.devicePipeline?.connect() ?? Promise.resolve(false),
    disconnect: () => window.electronAPI?.devicePipeline?.disconnect() ?? Promise.resolve(),
    sync: () => window.electronAPI?.devicePipeline?.sync() ?? Promise.resolve(),
    cancel: () => window.electronAPI?.devicePipeline?.cancel() ?? Promise.resolve(),
    deleteFile: (filename: string) =>
      window.electronAPI?.devicePipeline?.deleteFile(filename) ?? Promise.resolve(null),
    format: () => window.electronAPI?.devicePipeline?.format() ?? Promise.resolve(null)
  }
}
