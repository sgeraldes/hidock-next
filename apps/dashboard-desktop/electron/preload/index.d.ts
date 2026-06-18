export interface DashboardSummary {
  recordingCount: number
  taskCount: number
  openTaskCount: number
  lastSyncStatus: string
}

export interface RecordingRow {
  id: string
  title: string
  recordedAt: string
  durationSeconds: number
  status: 'on-device' | 'downloaded' | 'transcribed' | 'summarized'
  transcriptStatus: 'none' | 'queued' | 'complete' | 'failed'
}

export interface TranscriptRow {
  id: string
  recordingId: string
  text: string
  createdAt: string
}

export interface SummaryRow {
  id: string
  recordingId: string
  text: string
  modelId: string
  createdAt: string
}

export interface TaskRow {
  id: string
  title: string
  sourceRecordingId: string | null
  dueAt: string | null
  status: 'open' | 'done' | 'disregarded'
  lane: 'inbox' | 'mine' | 'watching' | 'done' | 'disregarded'
  priority: 'low' | 'normal' | 'high'
}

export interface TaskEventRow {
  id: string
  taskId: string
  eventType: string
  payload: Record<string, unknown>
  createdAt: string
}

export interface SyncRunRow {
  id: string
  status: 'running' | 'ready' | 'failed'
  message: string | null
  startedAt: string
  finishedAt: string | null
}

export interface RecordingDetail {
  recording: RecordingRow
  transcript: TranscriptRow | null
  summary: SummaryRow | null
  tasks: TaskRow[]
}

export interface TaskCreateInput {
  title: string
  sourceRecordingId?: string | null
  dueAt?: string | null
  status?: 'open' | 'done' | 'disregarded'
  lane?: 'inbox' | 'mine' | 'watching' | 'done' | 'disregarded'
  priority?: 'low' | 'normal' | 'high'
}

export interface TaskUpdatePatch {
  title?: string
  sourceRecordingId?: string | null
  dueAt?: string | null
  status?: 'open' | 'done' | 'disregarded'
  lane?: 'inbox' | 'mine' | 'watching' | 'done' | 'disregarded'
  priority?: 'low' | 'normal' | 'high'
}

export interface DashboardSettings {
  autoDownloadEnabled: boolean
  allowDestructiveDeviceCommands: false
  allowReminderWrites: false
  downloadsDirectory: string | null
  aiModelId: string
  theme: 'system' | 'light' | 'dark'
}

export interface DeviceStatus {
  connected: boolean
  model: string | null
  productId: string | null
  firmwareVersion: string | null
  safeMode: true
}

export interface DeviceRecording {
  id: string
  filename: string
  sizeBytes: number
  recordedAt: string | null
}

export interface DashboardApi {
  dashboard: {
    getSummary(): Promise<DashboardSummary>
  }
  recordings: {
    list(): Promise<RecordingRow[]>
    get(id: string): Promise<RecordingDetail | null>
  }
  tasks: {
    list(): Promise<TaskRow[]>
    create(input: TaskCreateInput): Promise<TaskRow>
    update(id: string, patch: TaskUpdatePatch): Promise<TaskRow | null>
    listEvents(taskId: string): Promise<TaskEventRow[]>
  }
  sync: {
    listRecent(limit?: number): Promise<SyncRunRow[]>
  }
  settings: {
    get(): Promise<DashboardSettings>
    update(patch: Partial<DashboardSettings>): Promise<DashboardSettings>
  }
  device: {
    getStatus(): Promise<DeviceStatus>
    listRecordings(): Promise<DeviceRecording[]>
    downloadRecording(recordingId: string): Promise<{ ok: true; message: string }>
    syncMetadata(): Promise<{ ok: true; message: string }>
  }
}

declare global {
  interface Window {
    dashboardAPI: DashboardApi
  }
}
