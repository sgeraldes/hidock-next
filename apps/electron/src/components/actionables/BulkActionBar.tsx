/**
 * Floating action bar shown when one or more actionables are selected. Offers
 * bulk Dismiss and bulk Generate, plus a Clear-selection escape. Presentational
 * only — the page owns the selection set and performs the IPC work.
 */

import { Sparkles, X, Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'

export interface BulkActionBarProps {
  count: number
  onDismiss: () => void
  onGenerate: () => void
  onClear: () => void
  busy?: boolean
}

export function BulkActionBar({ count, onDismiss, onGenerate, onClear, busy = false }: BulkActionBarProps) {
  if (count <= 0) return null
  return (
    <div
      role="region"
      aria-label="Bulk actions"
      className="animate-rise-in fixed bottom-4 left-1/2 -translate-x-1/2 z-40 flex items-center gap-3 px-4 py-2.5 bg-card border rounded-xl shadow-lg"
    >
      <span className="text-sm font-medium whitespace-nowrap">
        {count} selected
      </span>
      <div className="h-5 w-px bg-border" aria-hidden />
      <Button size="sm" className="gap-2" onClick={onGenerate} disabled={busy}>
        {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
        Generate
      </Button>
      <Button
        size="sm"
        variant="ghost"
        className="gap-2 text-muted-foreground hover:text-destructive"
        onClick={onDismiss}
        disabled={busy}
      >
        <X className="h-4 w-4" />
        Dismiss
      </Button>
      <div className="h-5 w-px bg-border" aria-hidden />
      <Button size="sm" variant="ghost" onClick={onClear} disabled={busy} aria-label="Clear selection">
        Clear
      </Button>
    </div>
  )
}
