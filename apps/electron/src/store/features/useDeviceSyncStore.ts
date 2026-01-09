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
    model?: string | null,
    serial?: string | null
  ) => void
  setConnectionError: (error: string | null) => void
  setFiles: (files: DeviceFile[]) => void
  setFilesLoading: (loading: boolean) => void
  setSyncState: (state: Partial<DeviceSyncState>) => void
  clearSyncState: () => void
  setStorageInfo: (used: number, total: number) => void
  markFileSynced: (filename: string) => void

  // Async Actions
  connect: () => Promise<void>
  disconnect: () => Promise<void>
  refreshFileList: () => Promise<void>
  syncFile: (filename: string) => Promise<void>
  syncAll: () => Promise<void>
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

    // Async Actions
    connect: async () => {
      set({ connectionStatus: 'connecting', connectionError: null })
      try {
        const result = await (window.electronAPI as any).device.connect()
        if (result.success) {
          set({
            connectionStatus: 'connected',
            deviceModel: result.model || null,
            deviceSerial: result.serial || null
          })
          // Load file list after connection
          await get().refreshFileList()
        } else {
          set({
            connectionStatus: 'error',
            connectionError: result.error || 'Failed to connect'
          })
        }
      } catch (error) {
        set({
          connectionStatus: 'error',
          connectionError: String(error)
        })
      }
    },

    disconnect: async () => {
      try {
        await (window.electronAPI as any).device.disconnect()
        set({
          connectionStatus: 'disconnected',
          deviceModel: null,
          deviceSerial: null,
          files: [],
          storageUsed: 0,
          storageTotal: 0
        })
        get().clearSyncState()
      } catch (error) {
        console.error('Failed to disconnect:', error)
      }
    },

    refreshFileList: async () => {
      if (get().connectionStatus !== 'connected') return

      set({ filesLoading: true })
      try {
        const result = await (window.electronAPI as any).device.getFileList()
        if (result.success) {
          set({
            files: result.files.map((file: any) => ({
              filename: file.filename,
              size: file.size,
              date: file.date,
              isSynced: file.isSynced || false
            })),
            storageUsed: result.storageUsed || 0,
            storageTotal: result.storageTotal || 0,
            filesLoading: false
          })
        } else {
          set({ filesLoading: false })
        }
      } catch (error) {
        console.error('Failed to load file list:', error)
        set({ filesLoading: false })
      }
    },

    syncFile: async (filename) => {
      get().setSyncState({
        syncing: true,
        currentFile: filename,
        progress: { current: 1, total: 1 },
        fileProgress: 0
      })

      try {
        await (window.electronAPI as any).device.downloadFile(filename, (progress: number) => {
          get().setSyncState({ fileProgress: progress })
        })

        get().markFileSynced(filename)
        get().clearSyncState()
      } catch (error) {
        console.error(`Failed to sync file ${filename}:`, error)
        get().clearSyncState()
      }
    },

    syncAll: async () => {
      const unsyncedFiles = get().files.filter((file) => !file.isSynced)
      if (unsyncedFiles.length === 0) return

      get().setSyncState({
        syncing: true,
        progress: { current: 0, total: unsyncedFiles.length },
        fileProgress: 0
      })

      for (let i = 0; i < unsyncedFiles.length; i++) {
        const file = unsyncedFiles[i]

        get().setSyncState({
          currentFile: file.filename,
          progress: { current: i + 1, total: unsyncedFiles.length }
        })

        try {
          await (window.electronAPI as any).device.downloadFile(file.filename, (progress: number) => {
            get().setSyncState({ fileProgress: progress })
          })
          get().markFileSynced(file.filename)
        } catch (error) {
          console.error(`Failed to sync file ${file.filename}:`, error)
        }
      }

      get().clearSyncState()
    }
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
