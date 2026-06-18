import { contextBridge, ipcRenderer } from 'electron'
import type {
  DashboardApi,
  DashboardSettings,
  DashboardSummary,
  DeviceRecording,
  DeviceStatus,
  RecordingDetail,
  RecordingRow,
  SyncRunRow,
  TaskCreateInput,
  TaskEventRow,
  TaskUpdatePatch,
  TaskRow
} from './index.d'

const invoke = <T>(channel: string, ...args: unknown[]): Promise<T> => ipcRenderer.invoke(channel, ...args)

const api: DashboardApi = {
  dashboard: {
    getSummary: () => invoke<DashboardSummary>('dashboard:getSummary')
  },
  recordings: {
    list: () => invoke<RecordingRow[]>('recordings:list'),
    get: (id) => invoke<RecordingDetail | null>('recordings:get', id)
  },
  tasks: {
    list: () => invoke<TaskRow[]>('tasks:list'),
    create: (input: TaskCreateInput) => invoke<TaskRow>('tasks:create', input),
    update: (id: string, patch: TaskUpdatePatch) => invoke<TaskRow | null>('tasks:update', id, patch),
    listEvents: (taskId: string) => invoke<TaskEventRow[]>('tasks:listEvents', taskId)
  },
  sync: {
    listRecent: (limit) => invoke<SyncRunRow[]>('sync:listRecent', limit)
  },
  settings: {
    get: () => invoke<DashboardSettings>('settings:get'),
    update: (patch) => invoke<DashboardSettings>('settings:update', patch)
  },
  device: {
    getStatus: () => invoke<DeviceStatus>('device:getStatus'),
    listRecordings: () => invoke<DeviceRecording[]>('device:listRecordings'),
    downloadRecording: (recordingId: string) =>
      invoke<{ ok: true; message: string }>('device:downloadRecording', recordingId),
    syncMetadata: () => invoke<{ ok: true; message: string }>('device:syncMetadata')
  }
}

contextBridge.exposeInMainWorld('dashboardAPI', api)
