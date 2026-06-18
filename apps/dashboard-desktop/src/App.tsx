import { useEffect, useMemo, useState } from 'react'
import { Activity, Disc3, LayoutDashboard, ListChecks, Settings, TerminalSquare } from 'lucide-react'
import { DashboardView } from '@views/DashboardView'
import { LogsView } from '@views/LogsView'
import { RecordingsView } from '@views/RecordingsView'
import { SettingsView } from '@views/SettingsView'
import { TasksView } from '@views/TasksView'
import { dashboardApi } from '@data/api'
import type {
  DashboardSettings,
  DashboardSummary,
  DeviceStatus,
  RecordingRow,
  SyncRunRow,
  TaskUpdatePatch,
  TaskRow
} from '../electron/preload/index.d'

type ViewId = 'dashboard' | 'recordings' | 'tasks' | 'settings' | 'logs'

const NAV_ITEMS: Array<{ id: ViewId; label: string; icon: typeof LayoutDashboard }> = [
  { id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { id: 'recordings', label: 'Recordings', icon: Disc3 },
  { id: 'tasks', label: 'Tasks', icon: ListChecks },
  { id: 'settings', label: 'Settings', icon: Settings },
  { id: 'logs', label: 'Logs/status', icon: TerminalSquare }
]

export function App(): JSX.Element {
  const [activeView, setActiveView] = useState<ViewId>('dashboard')
  const [summary, setSummary] = useState<DashboardSummary | null>(null)
  const [recordings, setRecordings] = useState<RecordingRow[]>([])
  const [tasks, setTasks] = useState<TaskRow[]>([])
  const [syncRuns, setSyncRuns] = useState<SyncRunRow[]>([])
  const [settings, setSettings] = useState<DashboardSettings | null>(null)
  const [device, setDevice] = useState<DeviceStatus | null>(null)
  const [lastMessage, setLastMessage] = useState('Ready')

  const openTaskCount = useMemo(() => tasks.filter((task) => task.status === 'open').length, [tasks])

  async function refresh(): Promise<void> {
    const [nextSummary, nextRecordings, nextTasks, nextSyncRuns, nextSettings, nextDevice] = await Promise.all([
      dashboardApi.dashboard.getSummary(),
      dashboardApi.recordings.list(),
      dashboardApi.tasks.list(),
      dashboardApi.sync.listRecent(12),
      dashboardApi.settings.get(),
      dashboardApi.device.getStatus()
    ])

    setSummary(nextSummary)
    setRecordings(nextRecordings)
    setTasks(nextTasks)
    setSyncRuns(nextSyncRuns)
    setSettings(nextSettings)
    setDevice(nextDevice)
  }

  useEffect(() => {
    refresh().catch((error: unknown) => {
      setLastMessage(error instanceof Error ? error.message : 'Unable to load dashboard state')
    })
  }, [])

  async function updateSettings(patch: Partial<DashboardSettings>): Promise<void> {
    const next = await dashboardApi.settings.update(patch)
    setSettings(next)
    setLastMessage('Settings updated')
  }

  async function syncMetadata(): Promise<void> {
    const result = await dashboardApi.device.syncMetadata()
    setLastMessage(result.message)
    await refresh()
  }

  async function updateTask(id: string, patch: TaskUpdatePatch): Promise<void> {
    const updated = await dashboardApi.tasks.update(id, patch)
    if (!updated) {
      setLastMessage('Task was not found')
      return
    }
    setLastMessage('Task updated')
    await refresh()
  }

  async function downloadRecording(recordingId: string): Promise<void> {
    const result = await dashboardApi.device.downloadRecording(recordingId)
    setLastMessage(result.message)
  }

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand-lockup">
          <div className="brand-mark">
            <Activity size={20} />
          </div>
          <div>
            <strong>HiDock</strong>
            <span>Dashboard</span>
          </div>
        </div>

        <nav aria-label="Primary">
          {NAV_ITEMS.map((item) => {
            const Icon = item.icon
            return (
              <button
                className={activeView === item.id ? 'nav-item nav-item--active' : 'nav-item'}
                key={item.id}
                type="button"
                onClick={() => setActiveView(item.id)}
              >
                <Icon size={18} />
                <span>{item.label}</span>
              </button>
            )
          })}
        </nav>

        <div className="sidebar-status">
          <span className={device?.connected ? 'connection-dot connection-dot--online' : 'connection-dot'} />
          <div>
            <strong>{device?.connected ? 'Device online' : 'Device offline'}</strong>
            <span>{device?.safeMode ? 'Safe bridge active' : 'Bridge unknown'}</span>
          </div>
        </div>
      </aside>

      <main className="workspace">
        <header className="topbar">
          <div>
            <span>Local-first desktop</span>
            <strong>{openTaskCount} open tasks</strong>
          </div>
          <div>
            <span>Auto-download</span>
            <strong>{settings?.autoDownloadEnabled ? 'Enabled' : 'Off'}</strong>
          </div>
        </header>

        {activeView === 'dashboard' && (
          <DashboardView
            summary={summary}
            device={device}
            recordings={recordings}
            tasks={tasks}
            onSyncMetadata={syncMetadata}
          />
        )}
        {activeView === 'recordings' && (
          <RecordingsView recordings={recordings} onDownloadRecording={downloadRecording} />
        )}
        {activeView === 'tasks' && <TasksView tasks={tasks} onTaskUpdate={updateTask} />}
        {activeView === 'settings' && <SettingsView settings={settings} onSettingsChange={updateSettings} />}
        {activeView === 'logs' && <LogsView device={device} lastMessage={lastMessage} syncRuns={syncRuns} />}
      </main>
    </div>
  )
}
