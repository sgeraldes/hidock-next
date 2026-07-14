import { Cloud, HardDrive, Check, Circle, Clock, Loader2, CheckCircle2, AlertCircle, Info, type LucideIcon } from 'lucide-react'
import { Popover, PopoverTrigger, PopoverContent } from '@/components/ui/popover'

interface LegendItem {
  Icon: LucideIcon
  color: string
  label: string
}

// Mirrors StatusIcon (location) — the leading glyph on every row.
const LOCATION_ITEMS: LegendItem[] = [
  { Icon: Cloud, color: 'text-orange-600 dark:text-orange-400', label: 'On device only' },
  { Icon: HardDrive, color: 'text-blue-600 dark:text-blue-400', label: 'Downloaded to computer' },
  { Icon: Check, color: 'text-green-600 dark:text-green-400', label: 'Synced (device + computer)' }
]

// Mirrors TranscriptionStatusBadge (compact) — the second glyph on every row.
const TRANSCRIPTION_ITEMS: LegendItem[] = [
  { Icon: Circle, color: 'text-muted-foreground/50', label: 'Not transcribed' },
  { Icon: Clock, color: 'text-yellow-600 dark:text-yellow-400', label: 'Queued' },
  { Icon: Loader2, color: 'text-yellow-600 dark:text-yellow-400', label: 'Transcribing' },
  { Icon: CheckCircle2, color: 'text-green-600 dark:text-green-400', label: 'Transcribed' },
  { Icon: AlertCircle, color: 'text-destructive', label: 'Failed' }
]

/**
 * StatusLegend — click-to-open key explaining the status glyphs that lead each
 * library row. Discoverable (a labeled trigger, not hover-only), mirroring the
 * category legend on the Today page. Answers "what do these colors/icons mean?".
 */
export function StatusLegend() {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          className="flex items-center gap-1 rounded-md px-1.5 py-0.5 text-xs font-normal text-foreground/45 transition-colors hover:text-foreground/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          aria-label="Status icon legend"
        >
          <Info className="h-3.5 w-3.5" aria-hidden="true" />
          Legend
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-60 p-3">
        <div className="space-y-3">
          <div className="space-y-1.5">
            <div className="text-xs font-semibold text-foreground/70">Location</div>
            {LOCATION_ITEMS.map(({ Icon, color, label }) => (
              <div key={label} className="flex items-center gap-2 text-xs">
                <Icon className={`h-3.5 w-3.5 shrink-0 ${color}`} aria-hidden="true" />
                <span className="text-foreground/70">{label}</span>
              </div>
            ))}
          </div>
          <div className="space-y-1.5">
            <div className="text-xs font-semibold text-foreground/70">Transcription</div>
            {TRANSCRIPTION_ITEMS.map(({ Icon, color, label }) => (
              <div key={label} className="flex items-center gap-2 text-xs">
                <Icon className={`h-3.5 w-3.5 shrink-0 ${color}`} aria-hidden="true" />
                <span className="text-foreground/70">{label}</span>
              </div>
            ))}
          </div>
        </div>
      </PopoverContent>
    </Popover>
  )
}
