import { useNavigate } from 'react-router-dom'
import { Layers, Image as ImageIcon, FileText, StickyNote, Braces, File, type LucideIcon } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { cn } from '@/lib/utils'
import { sourceTypeLabel, type LibrarySourceType } from '@/features/library/utils/sourceType'
import { useTodayCaptures, type TodayCapture } from './useTodayCaptures'

/** Per-kind glyph — mirrors the Library row icons so the two surfaces read alike. */
const TYPE_ICON: Record<Exclude<LibrarySourceType, 'audio'>, LucideIcon> = {
  image: ImageIcon,
  pdf: FileText,
  note: StickyNote,
  data: Braces,
  unknown: File
}

function formatTime(d: Date): string {
  return isNaN(d.getTime()) ? '' : d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}

/**
 * "Also captured today" — an ADDITION to the Today agenda that surfaces the day's
 * NON-recording knowledge moments (clipboard screenshots, imported PDFs/notes/data)
 * alongside the meetings and recordings already shown above.
 *
 * Strictly current-day scoped. Renders nothing when nothing non-audio was captured
 * today (no empty scaffolding), so it never competes with the agenda on quiet days.
 */
export function TodayCaptures() {
  const navigate = useNavigate()
  const captures = useTodayCaptures()

  if (captures.length === 0) return null

  const openInLibrary = (c: TodayCapture) => navigate('/library', { state: { selectedId: c.id } })

  return (
    <Card className="animate-rise-in" data-testid="today-captures">
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center justify-between text-base">
          <span className="flex items-center gap-2">
            <Layers className="h-4 w-4 text-foreground/60" />
            Also captured today
          </span>
          <span className="text-xs font-normal text-muted-foreground">
            {captures.length} {captures.length === 1 ? 'item' : 'items'}
          </span>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
        {captures.map((c, i) => {
          const Icon = TYPE_ICON[c.type]
          const time = formatTime(c.date)
          return (
            <button
              key={c.id}
              onClick={() => openInLibrary(c)}
              data-testid="today-capture-row"
              style={{ animationDelay: `${Math.min(i, 6) * 40}ms` }}
              className={cn(
                'group animate-rise-in flex w-full items-center gap-3 rounded-lg border p-3 text-left transition-colors',
                'hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring'
              )}
            >
              <span className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-md bg-muted text-foreground/70">
                <Icon className="h-4 w-4" aria-hidden="true" />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium text-foreground">{c.title}</span>
                <span className="mt-0.5 flex items-center gap-1.5 text-[11px] text-muted-foreground">
                  <span className="rounded bg-muted px-1.5 py-0.5 font-medium uppercase tracking-wide text-foreground/60">
                    {sourceTypeLabel(c.type)}
                  </span>
                  {time && <span className="tabular-nums">{time}</span>}
                </span>
              </span>
            </button>
          )
        })}
      </CardContent>
    </Card>
  )
}

export default TodayCaptures
