import { Terminal } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useActivityLog } from '@/store/useAppStore'
import { useUIStore } from '@/store/ui/useUIStore'

interface ActivityLogPanelProps {
  sidebarOpen: boolean
}

/**
 * The Activity Log does NOT live in the sidebar. The sidebar shows only a single
 * compact "Activity Log (N)" badge — matching the Operations badge pattern — that
 * OPENS the shared Activity Log overlay.
 *
 * Open-state is unified with the titlebar ⚡ button via `activityLogExpanded` on
 * the UI store: this panel is a pure TRIGGER (it sets the shared flag) and no
 * longer renders its own overlay — the always-mounted titlebar ActivityLogButton
 * owns the single overlay, so opening from either place is consistent and there
 * are never two stacked modals.
 */
export function ActivityLogPanel({ sidebarOpen }: ActivityLogPanelProps) {
  const activityLog = useActivityLog()
  const openLog = useUIStore((s) => s.setActivityLogExpanded)

  const count = activityLog.length
  const hasErrors = activityLog.some((e) => e.type === 'error' || e.type === 'warning')

  // Nothing to show → no footer badge at all (matches Operations behaviour).
  if (count === 0) {
    return null
  }

  // Collapsed sidebar rail: tiny icon + count (amber when there are errors/warnings).
  if (!sidebarOpen) {
    return (
      <div className="border-t border-slate-700 px-2 py-2">
        <button
          type="button"
          onClick={() => openLog(true)}
          aria-label={`Activity log: ${count} ${count === 1 ? 'entry' : 'entries'}${hasErrors ? ', has errors or warnings' : ''}`}
          className="relative flex w-full flex-col items-center gap-1 rounded-md py-1 text-slate-300 hover:bg-slate-800"
        >
          <Terminal className={cn('h-4 w-4', hasErrors ? 'text-amber-400' : 'text-slate-400')} />
          <span className="text-[10px] text-slate-400">{count > 99 ? '99+' : count}</span>
        </button>
      </div>
    )
  }

  // Expanded sidebar: a single compact "Activity Log (N)" badge that opens the overlay.
  return (
    <div className="border-t border-slate-700 px-2 py-2">
      <button
        type="button"
        onClick={() => openLog(true)}
        aria-label="Open activity log"
        className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs text-slate-300 hover:bg-slate-800"
      >
        <Terminal className={cn('h-3.5 w-3.5 shrink-0', hasErrors ? 'text-amber-400' : 'text-slate-500')} />
        <span className="truncate">Activity Log</span>
        <span
          className={cn(
            'ml-auto rounded-full px-1.5 text-[10px] font-semibold',
            hasErrors ? 'bg-red-500/20 text-red-300' : 'bg-slate-700 text-slate-300'
          )}
        >
          {count > 99 ? '99+' : count}
        </span>
      </button>
    </div>
  )
}
