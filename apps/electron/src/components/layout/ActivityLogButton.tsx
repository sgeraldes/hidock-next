/**
 * ActivityLogButton — the titlebar entry point for the Activity Log.
 *
 * The sidebar's ActivityLogPanel remains the dock-footer surface; this button
 * elevates the SAME activity-log data (`useActivityLog`) into the titlebar right
 * cluster (concept 03). It renders a compact ⚡ trigger with a live count badge
 * (amber when there are errors/warnings) and opens a renderer-only overlay that
 * mirrors the existing Activity Log overlay's look and behaviour (Escape to
 * close, auto-scroll to newest, colour-coded entries, Clear).
 *
 * Self-contained so the titlebar can reuse it without restructuring
 * ActivityLogPanel.
 */

import { useEffect, useRef, useState } from 'react'
import { Activity, Terminal, X, Trash2 } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { useActivityLog, useAppStore } from '@/store/useAppStore'
import type { ActivityLogEntry } from '@/services/hidock-device'

export function ActivityLogButton() {
  const activityLog = useActivityLog()
  const clearActivityLog = useAppStore((s) => s.clearActivityLog)
  const [open, setOpen] = useState(false)

  const count = activityLog.length
  const hasErrors = activityLog.some((e) => e.type === 'error' || e.type === 'warning')

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label={
          count > 0
            ? `Activity log: ${count} ${count === 1 ? 'entry' : 'entries'}${hasErrors ? ', has errors or warnings' : ''}`
            : 'Activity log'
        }
        title="Activity log"
        className="titlebar-no-drag relative flex h-7 w-7 items-center justify-center rounded-md text-slate-300 transition-colors hover:bg-slate-700 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-400"
      >
        <Activity className="h-4 w-4" />
        {count > 0 && (
          <span
            aria-hidden="true"
            className={cn(
              'absolute -right-0.5 -top-0.5 flex h-3.5 min-w-3.5 items-center justify-center rounded-full px-1 text-[9px] font-semibold leading-none text-white ring-2 ring-slate-900',
              hasErrors ? 'bg-red-500' : 'bg-sky-500'
            )}
          >
            {count > 99 ? '99+' : count}
          </span>
        )}
      </button>

      <ActivityLogOverlay
        open={open}
        onClose={() => setOpen(false)}
        entries={activityLog}
        onClear={() => clearActivityLog?.()}
      />
    </>
  )
}

interface ActivityLogOverlayProps {
  open: boolean
  onClose: () => void
  entries: ActivityLogEntry[]
  onClear: () => void
}

function ActivityLogOverlay({ open, onClose, entries, onClear }: ActivityLogOverlayProps) {
  const listRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])

  useEffect(() => {
    if (open && listRef.current) {
      requestAnimationFrame(() => {
        if (listRef.current) listRef.current.scrollTop = listRef.current.scrollHeight
      })
    }
  }, [open, entries.length])

  if (!open) return null

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-6"
      role="dialog"
      aria-modal="true"
      aria-label="Activity log"
    >
      <button type="button" aria-label="Close" className="absolute inset-0 bg-black/50" onClick={onClose} />
      <div className="relative z-10 flex max-h-[80vh] w-full max-w-2xl flex-col overflow-hidden rounded-lg border border-slate-700 bg-slate-900 text-slate-100 shadow-2xl">
        <div className="flex items-center justify-between border-b border-slate-700 px-4 py-3">
          <div className="flex items-center gap-2">
            <Terminal className="h-4 w-4 text-slate-400" />
            <h2 className="text-sm font-semibold">Activity Log</h2>
            <span className="rounded-full bg-slate-700 px-1.5 text-[10px] text-slate-300">{entries.length}</span>
          </div>
          <div className="flex items-center gap-1">
            {entries.length > 0 && (
              <Button
                variant="ghost"
                size="sm"
                className="h-7 gap-1.5 px-2 text-xs text-slate-300 hover:text-slate-100"
                onClick={onClear}
                aria-label="Clear activity log"
              >
                <Trash2 className="h-3.5 w-3.5" />
                Clear
              </Button>
            )}
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7 text-slate-400 hover:text-slate-100"
              onClick={onClose}
              aria-label="Close"
            >
              <X className="h-4 w-4" />
            </Button>
          </div>
        </div>

        <div ref={listRef} className="min-h-0 flex-1 overflow-y-auto bg-slate-950 p-3 font-mono">
          {entries.length === 0 ? (
            <p className="py-8 text-center text-sm text-slate-500">No activity.</p>
          ) : (
            entries.map((entry, i) => (
              <div
                key={`${entry.timestamp.getTime()}-${i}`}
                className={cn(
                  'py-0.5 text-[11px] leading-5',
                  entry.type === 'error'
                    ? 'text-red-400'
                    : entry.type === 'success'
                      ? 'text-green-400'
                      : entry.type === 'warning'
                        ? 'text-amber-400'
                        : entry.type === 'usb-out'
                          ? 'text-blue-400'
                          : entry.type === 'usb-in'
                            ? 'text-purple-400'
                            : 'text-slate-400'
                )}
              >
                <span className="mr-1.5 text-slate-600">
                  {entry.timestamp.toLocaleTimeString('en-US', {
                    hour12: false,
                    hour: '2-digit',
                    minute: '2-digit',
                    second: '2-digit'
                  })}
                </span>
                {entry.message}
                {entry.details && <span className="ml-1 text-slate-600">— {entry.details}</span>}
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  )
}

export default ActivityLogButton
