/**
 * NotificationsButton — the titlebar 🔔 for background operations.
 *
 * Wires to the EXISTING operations surface: it opens the shared Operations
 * overlay (the same one the sidebar OperationsPanel renders, driven by
 * `operationsOverlayOpen`) rather than a bespoke popover, so there is a single
 * queue surface. The badge counts live work from the existing stores —
 * transcriptions in flight/queued + active downloads, plus a red error count —
 * so the bell only lights up when something is actually happening.
 */

import { Bell } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useDownloadQueue } from '@/store/useAppStore'
import { useTranscriptionStats } from '@/store/features/useTranscriptionStore'
import { useUIStore } from '@/store/ui/useUIStore'

export function NotificationsButton() {
  const downloadQueue = useDownloadQueue()
  const txStats = useTranscriptionStats()
  const openOperationsOverlay = useUIStore((s) => s.openOperationsOverlay)

  const active = txStats.processing + txStats.pending + downloadQueue.size
  const errors = txStats.failed
  const total = active + errors
  const hasActivity = total > 0

  return (
    <button
      type="button"
      onClick={openOperationsOverlay}
      aria-label={
        hasActivity
          ? `Notifications: ${active} operation${active === 1 ? '' : 's'} in progress${errors ? `, ${errors} failed` : ''}`
          : 'Notifications'
      }
      title="Notifications & operations"
      className="titlebar-no-drag relative flex h-7 w-7 items-center justify-center rounded-md text-slate-300 transition-colors hover:bg-slate-700 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-400"
    >
      <Bell className={cn('h-4 w-4', active > 0 && 'animate-pulse motion-reduce:animate-none')} />
      {hasActivity && (
        <span
          aria-hidden="true"
          className={cn(
            'absolute -right-0.5 -top-0.5 flex h-3.5 min-w-3.5 items-center justify-center rounded-full px-1 text-[9px] font-semibold leading-none text-white ring-2 ring-slate-900',
            errors > 0 ? 'bg-red-500' : 'bg-sky-500'
          )}
        >
          {total > 99 ? '99+' : total}
        </span>
      )}
    </button>
  )
}

export default NotificationsButton
