// TODO: W1-HS-07: This store is not consumed by any component. Wire it to the Device page or remove it.
/**
 * Device Sync Store (Feature)
 *
 * Manages HiDock device connection state and file synchronization.
 * Tracks device status, file list, and sync operations.
 * Uses subscribeWithSelector middleware for fine-grained subscriptions.
 */

import { create } from 'zustand'
import { subscribeWithSelector } from 'zustand/middleware'

export type DeviceConnectionStatus = 'disconnected' | 'connecting' | 'connected' | 'error'

export interface DeviceFile {
  filename: string
  size: number
  date: string
  isSynced: boolean
}

export interface DeviceSyncState {
  syncing: boolean
  progress: { current: number; total: number } | null
  currentFile: string | null
  fileProgress: number
}

export interface DeviceSyncStore {
  // Connection State
  connectionStatus: DeviceConnectionStatus
  deviceModel: string | null
  deviceSerial: string | null
  connectionError: string | null

  // File List
  files: DeviceFile[]
  filesLoading: boolean

  // Sync State
  sync: DeviceSyncState

  // Storage Info
  storageUsed: number // bytes
  storageTotal: number // bytes

  // Actions
  setConnectionStatus: (
    status: DeviceConnectionStatus,
    model: string | null,
    serial: string | null
  ) => void
  setConnectionError: (error: string | null) => void
  setFiles: (files: DeviceFile[]) => void
  setFilesLoading: (loading: boolean) => void
  setSyncState: (state: Partial<DeviceSyncState>) => void
  clearSyncState: () => void
  setStorageInfo: (used: number, total: number) => void
  markFileSynced: (filename: string) => void

  // NOTE: Async device actions (connect, disconnect, refreshFileList, syncFile, syncAll)
  // were removed — they called window.electronAPI.device.* which doesn't exist.
  // Actual device operations go through hidock-device.ts → jensen.ts (WebUSB).
}

export const useDeviceSyncStore = create<DeviceSyncStore>()(
  subscribeWithSelector((set, get) => ({
    // Initial state
    connectionStatus: 'disconnected',
    deviceModel: null,
    deviceSerial: null,
    connectionError: null,

    files: [],
    filesLoading: false,

    sync: {
      syncing: false,
      progress: null,
      currentFile: null,
      fileProgress: 0
    },

    storageUsed: 0,
    storageTotal: 0,

    // Actions
    setConnectionStatus: (status, model, serial) => {
      set({
        connectionStatus: status,
        deviceModel: model ?? null,
        deviceSerial: serial ?? null,
        connectionError: status === 'connected' ? null : get().connectionError
      })
    },

    setConnectionError: (error) => {
      set({ connectionError: error })
    },

    setFiles: (files) => {
      set({ files })
    },

    setFilesLoading: (loading) => {
      set({ filesLoading: loading })
    },

    setSyncState: (state) => {
      set((prev) => ({
        sync: { ...prev.sync, ...state }
      }))
    },

    clearSyncState: () => {
      set({
        sync: {
          syncing: false,
          progress: null,
          currentFile: null,
          fileProgress: 0
        }
      })
    },

    setStorageInfo: (used, total) => {
      set({ storageUsed: used, storageTotal: total })
    },

    markFileSynced: (filename) => {
      set((state) => ({
        files: state.files.map((file) =>
          file.filename === filename ? { ...file, isSynced: true } : file
        )
      }))
    },

    // NOTE: Dead async actions removed (connect, disconnect, refreshFileList, syncFile, syncAll).
    // They called window.electronAPI.device.* which doesn't exist in preload.
    // See FIX-019 in STABILITY_FIXES.md.
  }))
)

// =============================================================================
// Selector Hooks
// =============================================================================

/**
 * Get unsynced files count
 */
export const useUnsyncedFilesCount = () => {
  return useDeviceSyncStore((state) => state.files.filter((file) => !file.isSynced).length)
}

/**
 * Get storage percentage
 */
export const useStoragePercentage = () => {
  return useDeviceSyncStore((state) => {
    if (state.storageTotal === 0) return 0
    return Math.round((state.storageUsed / state.storageTotal) * 100)
  })
}

/**
 * Check if device is connected
 */
export const useIsDeviceConnected = () => {
  return useDeviceSyncStore((state) => state.connectionStatus === 'connected')
}

/**
 * Check if sync is in progress
 */
export const useIsSyncing = () => {
  return useDeviceSyncStore((state) => state.sync.syncing)
}
