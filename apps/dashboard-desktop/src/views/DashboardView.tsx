import { Activity, CheckCircle2, HardDriveDownload, ListChecks } from 'lucide-react'
import { MetricTile } from '@components/MetricTile'
import { StatusBadge } from '@components/StatusBadge'
import { formatDateTime, formatDuration } from '@data/format'
import type { DashboardSummary, DeviceStatus, RecordingRow, TaskRow } from '../../electron/preload/index.d'

interface DashboardViewProps {
  summary: DashboardSummary | null
  device: DeviceStatus | null
  recordings: RecordingRow[]
  tasks: TaskRow[]
  onSyncMetadata(): void
}

export function DashboardView({
  summary,
  device,
  recordings,
  tasks,
  onSyncMetadata
}: DashboardViewProps): JSX.Element {
  const latestRecordings = recordings.slice(0, 4)
  const openTasks = tasks.filter((task) => task.status === 'open').slice(0, 4)

  return (
    <div className="view-stack">
      <div className="page-heading">
        <div>
          <h1>Dashboard</h1>
          <p>Local capture review, sync readiness, and follow-up queue.</p>
        </div>
        <button className="primary-button" type="button" onClick={onSyncMetadata}>
          <HardDriveDownload size={17} />
          Sync metadata
        </button>
      </div>

      <div className="metric-grid">
        <MetricTile label="Recordings" value={summary?.recordingCount ?? '-'} detail="Local library rows" />
        <MetricTile label="Open tasks" value={summary?.openTaskCount ?? '-'} detail={`${summary?.taskCount ?? 0} total`} />
        <MetricTile label="Sync state" value={summary?.lastSyncStatus ?? 'unknown'} detail="Metadata only" />
        <MetricTile label="Device" value={device?.connected ? 'Connected' : 'Offline'} detail={device?.safeMode ? 'Safe bridge' : 'Unknown'} />
      </div>

      <div className="split-grid">
        <section className="panel">
          <header className="panel-header">
            <div>
              <h2>Recent recordings</h2>
              <p>Review and selected-download queue.</p>
            </div>
            <Activity size={18} />
          </header>
          <div className="row-list">
            {latestRecordings.map((recording) => (
              <div className="data-row" key={recording.id}>
                <div>
                  <strong>{recording.title}</strong>
                  <span>{formatDateTime(recording.recordedAt)} · {formatDuration(recording.durationSeconds)}</span>
                </div>
                <StatusBadge value={recording.status} tone={recording.status === 'on-device' ? 'warning' : 'good'} />
              </div>
            ))}
          </div>
        </section>

        <section className="panel">
          <header className="panel-header">
            <div>
              <h2>Task lane</h2>
              <p>Follow-ups extracted from local recordings.</p>
            </div>
            <ListChecks size={18} />
          </header>
          <div className="row-list">
            {openTasks.map((task) => (
              <div className="data-row" key={task.id}>
                <div>
                  <strong>{task.title}</strong>
                  <span>{formatDateTime(task.dueAt)}</span>
                </div>
                <StatusBadge value={task.priority} tone={task.priority === 'high' ? 'warning' : 'neutral'} />
              </div>
            ))}
          </div>
        </section>
      </div>

      <section className="panel compact-panel">
        <CheckCircle2 size={18} />
        <div>
          <h2>Safe command surface</h2>
          <p>Discovery, device info, recording list, selected downloads, and metadata sync are the only planned bridge operations.</p>
        </div>
      </section>
    </div>
  )
}
