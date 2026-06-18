import { ShieldCheck } from 'lucide-react'
import type { DashboardSettings } from '../../electron/preload/index.d'

interface SettingsViewProps {
  settings: DashboardSettings | null
  onSettingsChange(patch: Partial<DashboardSettings>): void
}

export function SettingsView({ settings, onSettingsChange }: SettingsViewProps): JSX.Element {
  return (
    <div className="view-stack">
      <div className="page-heading">
        <div>
          <h1>Settings</h1>
          <p>Local defaults and model selection.</p>
        </div>
      </div>

      <section className="panel settings-panel">
        <label className="setting-row">
          <span>
            <strong>Auto-download</strong>
            <small>Downloads remain off until enabled by the user.</small>
          </span>
          <input
            type="checkbox"
            checked={settings?.autoDownloadEnabled ?? false}
            onChange={(event) => onSettingsChange({ autoDownloadEnabled: event.currentTarget.checked })}
          />
        </label>

        <label className="setting-row setting-row--column">
          <span>
            <strong>AI model</strong>
            <small>Accepts arbitrary OpenRouter model IDs.</small>
          </span>
          <input
            value={settings?.aiModelId ?? ''}
            onChange={(event) => onSettingsChange({ aiModelId: event.currentTarget.value })}
          />
        </label>

        <label className="setting-row">
          <span>
            <strong>Theme</strong>
            <small>System follows macOS appearance.</small>
          </span>
          <select
            value={settings?.theme ?? 'system'}
            onChange={(event) => onSettingsChange({ theme: event.currentTarget.value as DashboardSettings['theme'] })}
          >
            <option value="system">System</option>
            <option value="light">Light</option>
            <option value="dark">Dark</option>
          </select>
        </label>
      </section>

      <section className="panel compact-panel">
        <ShieldCheck size={18} />
        <div>
          <h2>Locked controls</h2>
          <p>Destructive device commands and reminder/calendar writes are disabled in the settings store and IPC surface.</p>
        </div>
      </section>
    </div>
  )
}
