import type {
  DashboardApi,
  DashboardSettings,
  RecordingRow,
  SyncRunRow,
  TaskEventRow,
  TaskRow
} from '../../electron/preload/index.d'

const recordings: RecordingRow[] = [
  {
    id: 'rec-briefing',
    title: 'Customer briefing',
    recordedAt: '2026-06-17T14:30:00.000Z',
    durationSeconds: 2140,
    status: 'downloaded',
    transcriptStatus: 'complete'
  },
  {
    id: 'rec-design-review',
    title: 'Design review',
    recordedAt: '2026-06-16T09:15:00.000Z',
    durationSeconds: 1685,
    status: 'on-device',
    transcriptStatus: 'none'
  },
  {
    id: 'rec-ops-sync',
    title: 'Ops sync',
    recordedAt: '2026-06-15T18:05:00.000Z',
    durationSeconds: 1260,
    status: 'summarized',
    transcriptStatus: 'complete'
  }
]

let tasks: TaskRow[] = [
  {
    id: 'task-follow-up',
    title: 'Send dashboard follow-up notes',
    sourceRecordingId: 'rec-briefing',
    dueAt: '2026-06-19T16:00:00.000Z',
    status: 'open',
    lane: 'mine',
    priority: 'high'
  },
  {
    id: 'task-export',
    title: 'Review exported transcript formatting',
    sourceRecordingId: 'rec-ops-sync',
    dueAt: null,
    status: 'open',
    lane: 'inbox',
    priority: 'normal'
  }
]

let taskEvents: TaskEventRow[] = [
  {
    id: 'event-follow-up-created',
    taskId: 'task-follow-up',
    eventType: 'created',
    payload: { source: 'preview-seed' },
    createdAt: '2026-06-17T15:12:00.000Z'
  }
]

let syncRuns: SyncRunRow[] = [
  {
    id: 'sync-preview',
    status: 'ready',
    message: 'Preview metadata initialized',
    startedAt: '2026-06-17T15:00:00.000Z',
    finishedAt: '2026-06-17T15:00:01.000Z'
  }
]

let settings: DashboardSettings = {
  autoDownloadEnabled: false,
  allowDestructiveDeviceCommands: false,
  allowReminderWrites: false,
  downloadsDirectory: null,
  aiModelId: 'google/gemini-3.1-flash-lite',
  theme: 'system'
}

export const mockDashboardApi: DashboardApi = {
  dashboard: {
    async getSummary() {
      return {
        recordingCount: recordings.length,
        taskCount: tasks.length,
        openTaskCount: tasks.filter((task) => task.status === 'open').length,
        lastSyncStatus: syncRuns[0]?.status ?? 'never-run'
      }
    }
  },
  recordings: {
    async list() {
      return recordings
    },
    async get(id) {
      const recording = recordings.find((item) => item.id === id)
      if (!recording) return null

      return {
        recording,
        transcript:
          recording.transcriptStatus === 'complete'
            ? {
                id: `transcript-${recording.id}`,
                recordingId: recording.id,
                text: 'Preview transcript text for local-first dashboard smoke testing.',
                createdAt: recording.recordedAt
              }
            : null,
        summary:
          recording.status === 'summarized'
            ? {
                id: `summary-${recording.id}`,
                recordingId: recording.id,
                text: 'Preview summary for the selected recording.',
                modelId: settings.aiModelId,
                createdAt: recording.recordedAt
              }
            : null,
        tasks: tasks.filter((task) => task.sourceRecordingId === recording.id)
      }
    }
  },
  tasks: {
    async list() {
      return tasks
    },
    async create(input) {
      const task: TaskRow = {
        id: `task-preview-${Date.now()}`,
        title: input.title,
        sourceRecordingId: input.sourceRecordingId ?? null,
        dueAt: input.dueAt ?? null,
        status: input.status ?? 'open',
        lane: input.lane ?? 'inbox',
        priority: input.priority ?? 'normal'
      }
      tasks = [task, ...tasks]
      taskEvents = [
        ...taskEvents,
        {
          id: `event-preview-${Date.now()}`,
          taskId: task.id,
          eventType: 'created',
          payload: { ...task },
          createdAt: new Date().toISOString()
        }
      ]
      return task
    },
    async update(id, patch) {
      const current = tasks.find((task) => task.id === id)
      if (!current) return null
      const status =
        patch.lane === 'done'
          ? 'done'
          : patch.lane === 'disregarded'
            ? 'disregarded'
            : patch.lane
              ? 'open'
              : (patch.status ?? current.status)
      const updated = { ...current, ...patch, status }
      tasks = tasks.map((task) => (task.id === id ? updated : task))
      taskEvents = [
        ...taskEvents,
        {
          id: `event-preview-${Date.now()}`,
          taskId: id,
          eventType: patch.lane ? 'lane-changed' : patch.status ? 'status-changed' : 'updated',
          payload: { ...patch },
          createdAt: new Date().toISOString()
        }
      ]
      return updated
    },
    async listEvents(taskId) {
      return taskEvents.filter((event) => event.taskId === taskId)
    }
  },
  sync: {
    async listRecent(limit = 10) {
      return syncRuns.slice(0, limit)
    }
  },
  settings: {
    async get() {
      return settings
    },
    async update(patch) {
      settings = {
        ...settings,
        ...patch,
        allowDestructiveDeviceCommands: false,
        allowReminderWrites: false,
        autoDownloadEnabled: patch.autoDownloadEnabled === true
      }
      return settings
    }
  },
  device: {
    async getStatus() {
      return {
        connected: false,
        model: null,
        productId: null,
        firmwareVersion: null,
        safeMode: true
      }
    },
    async listRecordings() {
      return []
    },
    async downloadRecording(recordingId) {
      return {
        ok: true,
        message: `Selected download scaffold ready for ${recordingId}. Connect a HiDock device to enable manual transfer.`
      }
    },
    async syncMetadata() {
      const run: SyncRunRow = {
        id: `sync-preview-${Date.now()}`,
        status: 'ready',
        message: 'Preview metadata sync completed',
        startedAt: new Date().toISOString(),
        finishedAt: new Date().toISOString()
      }
      syncRuns = [run, ...syncRuns]
      return {
        ok: true,
        message: run.message as string
      }
    }
  }
}
