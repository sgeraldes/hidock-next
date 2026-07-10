/**
 * The Stream's right context rail:
 *   1. Ask your knowledge — routes the question to the Assistant (prefilled).
 *   2. Threads this week — meetings/projects touched, by moment count.
 *   3. People today — contacts in today's moments, with meeting/action rollups.
 *   4. Source mix · 7 days — a mini bar list of moments per source type.
 */

import { useState, type FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { Sparkles, MessagesSquare, Users, BarChart3, ArrowRight } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'
import { SOURCE_META } from '../sourceMeta'
import type { PersonToday, SourceMixEntry, ThreadSummary } from '../types'

function AskKnowledge() {
  const navigate = useNavigate()
  const [q, setQ] = useState('')
  const submit = (e: FormEvent) => {
    e.preventDefault()
    const query = q.trim()
    navigate('/assistant', query ? { state: { initialQuery: query } } : undefined)
  }
  return (
    <Card className="animate-rise-in">
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <Sparkles className="h-4 w-4 text-primary" />
          Ask your knowledge
        </CardTitle>
      </CardHeader>
      <CardContent>
        <form onSubmit={submit} className="flex items-center gap-2">
          <Input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Ask about anything you've captured…"
            aria-label="Ask your knowledge"
            data-testid="ask-input"
          />
          <button
            type="submit"
            aria-label="Ask"
            className="inline-flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-md bg-primary text-primary-foreground shadow-sm transition-colors hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <ArrowRight className="h-4 w-4" />
          </button>
        </form>
        <p className="mt-2 text-[11px] text-muted-foreground">
          Opens the Assistant with your question, grounded in your knowledge base.
        </p>
      </CardContent>
    </Card>
  )
}

function ThreadsThisWeek({ threads }: { threads: ThreadSummary[] }) {
  const navigate = useNavigate()
  return (
    <Card className="animate-rise-in">
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <MessagesSquare className="h-4 w-4" />
          Threads this week
        </CardTitle>
      </CardHeader>
      <CardContent>
        {threads.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No linked threads yet. Recordings correlate to meetings and group here.
          </p>
        ) : (
          <ul className="space-y-1.5">
            {threads.map((t) => {
              const meetingId = t.key.startsWith('meeting:') ? t.key.slice('meeting:'.length) : null
              const canOpen = meetingId && !meetingId.includes(' ')
              return (
                <li key={t.key}>
                  <button
                    onClick={() => canOpen && navigate(`/meeting/${meetingId}`)}
                    disabled={!canOpen}
                    data-testid="thread-row"
                    className={cn(
                      'flex w-full items-center justify-between gap-3 rounded-lg px-2 py-1.5 text-left transition-colors',
                      canOpen && 'hover:bg-muted/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring'
                    )}
                  >
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm text-foreground">{t.label}</span>
                      <span className="flex items-center gap-1 pt-0.5">
                        {t.sources.map((s) => (
                          <span key={s} className={cn('h-1.5 w-1.5 rounded-full', SOURCE_META[s].dot)} aria-hidden="true" />
                        ))}
                      </span>
                    </span>
                    <span className="flex-shrink-0 text-xs font-medium tabular-nums text-muted-foreground">
                      {t.count}
                    </span>
                  </button>
                </li>
              )
            })}
          </ul>
        )}
      </CardContent>
    </Card>
  )
}

function PeopleToday({ people }: { people: PersonToday[] }) {
  const navigate = useNavigate()
  return (
    <Card className="animate-rise-in">
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <Users className="h-4 w-4" />
          People today
        </CardTitle>
      </CardHeader>
      <CardContent>
        {people.length === 0 ? (
          <p className="text-sm text-muted-foreground">No people in today&apos;s moments yet.</p>
        ) : (
          <ul className="space-y-1.5">
            {people.map((p) => {
              const meta = [
                `${p.momentCount} ${p.momentCount === 1 ? 'moment' : 'moments'}`,
                p.actionCount > 0 ? `${p.actionCount} ${p.actionCount === 1 ? 'action' : 'actions'}` : null
              ]
                .filter(Boolean)
                .join(' · ')
              return (
                <li key={p.id ?? p.name}>
                  <button
                    onClick={() => p.id && navigate(`/person/${p.id}`)}
                    disabled={!p.id}
                    data-testid="person-row"
                    className={cn(
                      'flex w-full items-center gap-2.5 rounded-lg px-2 py-1.5 text-left transition-colors',
                      p.id && 'hover:bg-muted/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring'
                    )}
                  >
                    <span
                      className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full bg-blue-500/10 text-[11px] font-semibold text-blue-700 dark:text-blue-300"
                      aria-hidden="true"
                    >
                      {p.name.slice(0, 2).toUpperCase()}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm text-foreground">{p.name}</span>
                      <span className="block truncate text-[11px] text-muted-foreground">{meta}</span>
                    </span>
                  </button>
                </li>
              )
            })}
          </ul>
        )}
      </CardContent>
    </Card>
  )
}

function SourceMix({ mix }: { mix: SourceMixEntry[] }) {
  const total = mix.reduce((s, e) => s + e.count, 0)
  const max = mix.reduce((m, e) => Math.max(m, e.count), 0) || 1
  return (
    <Card className="animate-rise-in">
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <BarChart3 className="h-4 w-4" />
          Source mix
          <span className="ml-1 text-xs font-normal text-muted-foreground">· 7 days</span>
        </CardTitle>
      </CardHeader>
      <CardContent>
        {total === 0 ? (
          <p className="text-sm text-muted-foreground">Nothing captured in the last 7 days.</p>
        ) : (
          <ul className="space-y-2">
            {mix.map((e) => {
              const meta = SOURCE_META[e.source]
              return (
                <li key={e.source} className="flex items-center gap-2" data-testid="sourcemix-row">
                  <span className="w-12 flex-shrink-0 text-[11px] font-medium uppercase tracking-wide text-foreground/60">
                    {meta.short}
                  </span>
                  <span className="flex h-2.5 flex-1 overflow-hidden rounded-full bg-muted">
                    <span
                      className={cn('h-full rounded-full', meta.bar)}
                      style={{ width: `${Math.max(6, (e.count / max) * 100)}%` }}
                    />
                  </span>
                  <span className="w-5 flex-shrink-0 text-right text-xs font-medium tabular-nums text-muted-foreground">
                    {e.count}
                  </span>
                </li>
              )
            })}
          </ul>
        )}
      </CardContent>
    </Card>
  )
}

export function StreamRail({
  threads,
  people,
  sourceMix
}: {
  threads: ThreadSummary[]
  people: PersonToday[]
  sourceMix: SourceMixEntry[]
}) {
  return (
    <div className="space-y-6">
      <AskKnowledge />
      <ThreadsThisWeek threads={threads} />
      <PeopleToday people={people} />
      <SourceMix mix={sourceMix} />
    </div>
  )
}

export default StreamRail
