import { TerminalSquare } from 'lucide-react'
import { StatusBadge } from '@components/StatusBadge'
import { formatDateTime } from '@data/format'
import type { DeviceStatus, SyncRunRow } from '../../electron/preload/index.d'

interface LogsViewProps {
  device: DeviceStatus | null
  lastMessage: string
  syncRuns: SyncRunRow[]
}

export function LogsView({ device, lastMessage, syncRuns }: LogsViewProps): JSX.Element {
  return (
    <div className="view-stack">
      <div className="page-heading">
        <div>
          <h1>Logs/status</h1>
          <p>Runtime state for the local-first bridge.</p>
        </div>
      </div>

      <section className="panel log-panel">
        <header className="panel-header">
          <div>
            <h2>Session</h2>
            <p>Main-process service readiness.</p>
          </div>
          <TerminalSquare size={18} />
        </header>
        <pre>{`device.connected=${device?.connected ?? false}
device.productId=${device?.productId ?? 'none'}
device.safeMode=${device?.safeMode ?? true}
last.message=${lastMessage || 'Ready'}`}</pre>
      </section>

      <section className="panel table-panel">
        <div className="table-header sync-table">
          <span>Status</span>
          <span>Started</span>
          <span>Finished</span>
          <span>Message</span>
        </div>
        {syncRuns.map((run) => (
          <div className="table-row sync-table" key={run.id}>
            <StatusBadge value={run.status} tone={run.status === 'failed' ? 'warning' : 'good'} />
            <span>{formatDateTime(run.startedAt)}</span>
            <span>{formatDateTime(run.finishedAt)}</span>
            <strong>{run.message ?? 'No message'}</strong>
          </div>
        ))}
      </section>
    </div>
  )
}
