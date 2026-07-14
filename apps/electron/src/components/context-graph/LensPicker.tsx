import { useEffect, useRef, useState } from 'react'
import { User, FolderKanban, Lightbulb, CalendarRange, Compass, Search } from 'lucide-react'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'
import { entityColor } from './graph-theme'

export type LensKind = 'you' | 'person' | 'project' | 'decision' | 'week'

export interface LensSelection {
  kind: LensKind
  /** Graph entity id the lens centers on (null for the whole-graph "week" lens). */
  centerId: string | null
  label: string
}

export interface LensSearchHit {
  id: string
  label: string
  type: string
}

interface LensPickerProps {
  selection: LensSelection
  windowDays: number | null
  onSelect: (sel: LensSelection) => void
  onWindowChange: (days: number | null) => void
  onSearch: (query: string, type: string) => Promise<LensSearchHit[]>
  /** Label for the default "Your context" center (owner / top person). */
  ownerLabel?: string | null
}

const KINDS: Array<{ kind: LensKind; label: string; icon: typeof User; entityType?: string }> = [
  { kind: 'you', label: 'Your context', icon: Compass },
  { kind: 'person', label: 'Person', icon: User, entityType: 'person' },
  { kind: 'project', label: 'Project', icon: FolderKanban, entityType: 'project' },
  { kind: 'decision', label: 'Decision', icon: Lightbulb, entityType: 'decision' },
  { kind: 'week', label: 'This week', icon: CalendarRange },
]

const WINDOWS: Array<{ days: number | null; label: string }> = [
  { days: 7, label: '7d' },
  { days: 30, label: '30d' },
  { days: 90, label: '90d' },
  { days: null, label: 'All' },
]

/**
 * Lens-first entry: choose the PERSPECTIVE (whose/what context) and the TIME
 * window. Person / Project / Decision open a typed entity search; "This week"
 * scopes the whole recent graph; "Your context" is the ego view of the owner.
 */
export function LensPicker({
  selection,
  windowDays,
  onSelect,
  onWindowChange,
  onSearch,
  ownerLabel,
}: LensPickerProps) {
  const [pending, setPending] = useState<LensKind | null>(null) // kind awaiting an entity pick
  const [query, setQuery] = useState('')
  const [hits, setHits] = useState<LensSearchHit[]>([])
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const activeEntityType = KINDS.find((k) => k.kind === pending)?.entityType

  useEffect(() => {
    if (!pending || !activeEntityType) return
    if (timer.current) clearTimeout(timer.current)
    timer.current = setTimeout(async () => {
      const res = await onSearch(query, activeEntityType)
      setHits(res)
    }, 180)
    return () => {
      if (timer.current) clearTimeout(timer.current)
    }
  }, [query, pending, activeEntityType, onSearch])

  const clickKind = (kind: LensKind) => {
    const def = KINDS.find((k) => k.kind === kind)!
    if (def.entityType) {
      // Open the typed search to pick an entity to center on.
      setPending(kind)
      setQuery('')
      setHits([])
      return
    }
    setPending(null)
    if (kind === 'week') {
      onWindowChange(7)
      onSelect({ kind: 'week', centerId: null, label: 'This week' })
    } else {
      onSelect({ kind: 'you', centerId: null, label: ownerLabel ? `You · ${ownerLabel}` : 'Your context' })
    }
  }

  const pickHit = (hit: LensSearchHit) => {
    setPending(null)
    setQuery('')
    setHits([])
    onSelect({
      kind: activeEntityType === 'person' ? 'person' : activeEntityType === 'project' ? 'project' : 'decision',
      centerId: hit.id,
      label: hit.label,
    })
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2 flex-wrap">
        <div className="flex items-center rounded-lg border overflow-hidden text-xs">
          {KINDS.map(({ kind, label, icon: Icon }) => {
            const active = pending === kind || (!pending && selection.kind === kind)
            return (
              <button
                key={kind}
                onClick={() => clickKind(kind)}
                className={cn(
                  'flex items-center gap-1.5 px-2.5 py-1.5 transition-colors',
                  active
                    ? 'bg-violet-500/15 text-violet-600 dark:text-violet-300 font-medium'
                    : 'text-muted-foreground hover:bg-muted/50'
                )}
                aria-pressed={active}
              >
                <Icon className="h-3.5 w-3.5" />
                {label}
              </button>
            )
          })}
        </div>

        {/* Time-window chips */}
        <div className="flex items-center rounded-lg border overflow-hidden text-xs" role="group" aria-label="Time range">
          {WINDOWS.map(({ days, label }) => {
            const active = windowDays === days
            return (
              <button
                key={label}
                onClick={() => onWindowChange(days)}
                className={cn(
                  'px-2.5 py-1.5 transition-colors',
                  active
                    ? 'bg-violet-500/15 text-violet-600 dark:text-violet-300 font-medium'
                    : 'text-muted-foreground hover:bg-muted/50'
                )}
                aria-pressed={active}
              >
                {label}
              </button>
            )
          })}
        </div>

        {/* Current lens label */}
        {!pending && (
          <span className="text-xs text-muted-foreground truncate max-w-[240px]">
            Lens: <strong className="text-foreground">{selection.label}</strong>
          </span>
        )}
      </div>

      {/* Typed entity search (Person / Project / Decision) */}
      {pending && activeEntityType && (
        <div className="relative max-w-md">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            autoFocus
            placeholder={`Search a ${activeEntityType.replace('_', ' ')}…`}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && hits.length > 0) pickHit(hits[0])
              if (e.key === 'Escape') setPending(null)
            }}
            className="pl-9"
            aria-label={`Search a ${activeEntityType}`}
          />
          {hits.length > 0 && (
            <div className="absolute z-20 mt-1 w-full rounded-lg border bg-popover shadow-lg overflow-hidden max-h-64 overflow-y-auto">
              {hits.map((h) => (
                <button
                  key={h.id}
                  className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-muted/60"
                  onClick={() => pickHit(h)}
                >
                  <span
                    className="h-2.5 w-2.5 rounded-full shrink-0"
                    style={{ backgroundColor: entityColor(h.type).light }}
                  />
                  <span className="truncate flex-1">{h.label}</span>
                  <span className="text-[10px] uppercase tracking-wider text-muted-foreground">{h.type}</span>
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

export default LensPicker
