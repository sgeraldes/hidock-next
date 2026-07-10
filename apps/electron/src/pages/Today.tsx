/**
 * Today — the Stream.
 *
 * A single chronological feed of everything you captured, across ALL knowledge
 * source types (recordings, documents, images, and — once their producers emit
 * moments — code and diagrams), grouped by day with a left time-gutter and a
 * right context rail. This replaces the old meeting-agenda Today content with a
 * universal, multi-source daily timeline. See `src/features/today/`.
 */

import { useMemo } from 'react'
import { Sun, RefreshCw, Sparkles, Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { cn } from '@/lib/utils'
import { pageWide } from '@/lib/pageLayout'
import { useStream } from '@/features/today/useStream'
import { MomentCard } from '@/features/today/components/MomentCard'
import { StreamRail } from '@/features/today/components/StreamRail'
import { SOURCE_META } from '@/features/today/sourceMeta'
import type { Moment, MomentDay } from '@/features/today/types'

function greeting(): string {
  const h = new Date().getHours()
  if (h < 12) return 'Good morning'
  if (h < 19) return 'Good afternoon'
  return 'Good evening'
}

function formatTime(iso: string): string {
  const d = new Date(iso)
  return isNaN(d.getTime()) ? '' : d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}

function fullDate(d: Date): string {
  return d.toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric' })
}

/** One day: header (label · N captured · M on device) + the gutter timeline. */
function DayGroup({ day }: { day: MomentDay }) {
  const isRelative = day.label === 'Today' || day.label === 'Yesterday'
  return (
    <section className="animate-rise-in" data-testid="stream-day">
      <div className="mb-3 flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <h2 className="text-lg font-bold tracking-tight text-foreground">{day.label}</h2>
        {isRelative && <span className="text-sm text-muted-foreground">{fullDate(day.date)}</span>}
        <span className="text-sm text-muted-foreground" aria-hidden="true">
          ·
        </span>
        <span className="text-sm text-muted-foreground">
          {day.capturedCount} {day.capturedCount === 1 ? 'moment' : 'moments'} captured
        </span>
        {day.onDeviceCount > 0 && (
          <span className="text-sm font-medium text-amber-600 dark:text-amber-400">
            · {day.onDeviceCount} still on device
          </span>
        )}
      </div>

      <ol className="space-y-3">
        {day.moments.map((m: Moment) => (
          <li key={m.id} className="relative flex gap-2 sm:gap-3" data-testid="stream-row">
            {/* Time gutter */}
            <div className="flex w-12 flex-shrink-0 justify-end pt-4 sm:w-14">
              <time className="text-xs font-medium tabular-nums text-foreground/55" dateTime={m.timestamp}>
                {formatTime(m.timestamp)}
              </time>
            </div>
            {/* Spine + colored node dot */}
            <div className="relative flex-shrink-0" aria-hidden="true">
              <span className="absolute left-1/2 top-0 h-full w-px -translate-x-1/2 bg-border" />
              <span
                className={cn(
                  'relative mt-4 block h-3 w-3 rounded-full ring-4 ring-background',
                  SOURCE_META[m.source].dot
                )}
                title={SOURCE_META[m.source].label}
              />
            </div>
            {/* Card */}
            <div className="min-w-0 flex-1 pb-1">
              <MomentCard moment={m} />
            </div>
          </li>
        ))}
      </ol>
    </section>
  )
}

export function Today() {
  const { days, moments, loading, error, rail, refresh } = useStream()

  const weekCount = useMemo(() => rail.sourceMix.reduce((s, e) => s + e.count, 0), [rail.sourceMix])
  const hasMoments = moments.length > 0

  return (
    <div className="h-full overflow-y-auto bg-background">
      <div className={cn(pageWide, 'space-y-6 px-6 py-6')}>
        {/* Header */}
        <div className="flex items-end justify-between gap-4 animate-rise-in">
          <div>
            <div className="flex items-center gap-1.5 text-sm font-semibold uppercase tracking-wide text-primary">
              <Sun className="h-4 w-4" />
              {new Date().toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric' })}
            </div>
            <h1 className="mt-1 text-4xl font-bold tracking-tight">{greeting()}, Sebastián</h1>
            <p className="mt-2 text-sm text-foreground/70">
              Your stream —{' '}
              <span className="font-semibold text-foreground">{weekCount}</span>{' '}
              {weekCount === 1 ? 'moment' : 'moments'} captured across all sources in the last 7 days.
            </p>
          </div>
          <Button variant="outline" size="sm" onClick={refresh} disabled={loading}>
            <RefreshCw className={cn('mr-2 h-4 w-4', loading && 'animate-spin')} />
            Refresh
          </Button>
        </div>

        {error && (
          <Card className="border-destructive/50">
            <CardContent className="py-4 text-sm text-destructive">{error}</CardContent>
          </Card>
        )}

        {/* Body — stream + rail. Rail drops below the stream until 2xl. */}
        <div className="grid grid-cols-1 gap-6 2xl:grid-cols-[minmax(0,1.7fr)_minmax(0,1fr)] 2xl:items-start">
          {/* Stream */}
          <div className="min-w-0 space-y-8">
            {loading && !hasMoments ? (
              <div className="flex items-center gap-2 py-16 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin motion-reduce:animate-none" aria-hidden="true" />
                Gathering your moments…
              </div>
            ) : !hasMoments ? (
              <Card className="animate-rise-in">
                <CardContent className="flex flex-col items-center gap-3 py-16 text-center">
                  <Sparkles className="h-8 w-8 text-primary/60" aria-hidden="true" />
                  <div className="text-base font-semibold text-foreground">Your stream is empty</div>
                  <p className="max-w-sm text-sm text-muted-foreground">
                    Recordings, documents, and screenshots you capture will appear here as a single daily timeline,
                    newest first.
                  </p>
                </CardContent>
              </Card>
            ) : (
              days.map((day) => <DayGroup key={day.key} day={day} />)
            )}
          </div>

          {/* Right context rail */}
          <div className="min-w-0 2xl:sticky 2xl:top-6">
            <StreamRail threads={rail.threads} people={rail.people} sourceMix={rail.sourceMix} />
          </div>
        </div>
      </div>
    </div>
  )
}

export default Today
