import { useState } from 'react'
import { ChevronDown, ChevronRight, Check, X, Sparkles, Users } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { cn } from '@/lib/utils'
import { useIdentitySuggestions, parseEvidence, type IdentitySuggestion } from './useIdentitySuggestions'

/** Confidence → tier styling. ≥80 green, 50–79 amber. */
function confidenceTier(confidence: number | null): { label: string; className: string } {
  const pct = Math.round((confidence ?? 0) * 100)
  const className =
    pct >= 80
      ? 'border-emerald-500/20 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300'
      : 'border-amber-500/20 bg-amber-500/10 text-amber-700 dark:text-amber-300'
  return { label: `${pct}%`, className }
}

/** Human-readable one-liner from the evidence blob. */
function evidenceSummary(suggestion: IdentitySuggestion): string {
  const ev = parseEvidence(suggestion.evidence)
  const parts: string[] = []
  if (ev.method) parts.push(`matched by ${ev.method.replace(/_/g, ' ')}`)
  const co = (ev.coOccurring ?? []).filter((n) => n && n !== suggestion.candidate_name)
  if (co.length > 0) parts.push(`seen with ${co.slice(0, 3).join(', ')}`)
  else if (ev.meetingId) parts.push('same meeting')
  return parts.join(' · ')
}

/**
 * Collapsible "Identity suggestions" review queue for the People page. Renders
 * only when at least one pending suggestion exists. Each card asks whether a
 * candidate name is the same as a known entity, with confidence + evidence and
 * optimistic Accept / Reject.
 */
export function IdentitySuggestionsSection() {
  const { suggestions, loading, targetNames, accept, reject } = useIdentitySuggestions()
  const [expanded, setExpanded] = useState(true)

  if (loading || suggestions.length === 0) return null

  return (
    <section className="mb-6" aria-label="Identity suggestions">
      <button
        type="button"
        onClick={() => setExpanded((prev) => !prev)}
        className="flex items-center gap-2 w-full text-left mb-3 group"
        aria-expanded={expanded}
      >
        {expanded ? (
          <ChevronDown className="h-4 w-4 text-muted-foreground" />
        ) : (
          <ChevronRight className="h-4 w-4 text-muted-foreground" />
        )}
        <Sparkles className="h-4 w-4 text-amber-500" />
        <span className="text-sm font-semibold">Identity suggestions ({suggestions.length})</span>
        <span className="text-xs text-muted-foreground hidden sm:inline">
          — possible duplicate names to confirm
        </span>
      </button>

      {expanded && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {suggestions.map((s) => {
            const tier = confidenceTier(s.confidence)
            const targetName = targetNames[s.target_id]
            const summary = evidenceSummary(s)
            return (
              <Card key={s.id} className="border-amber-500/20 bg-amber-500/[0.03]">
                <CardContent className="p-4 space-y-3">
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex items-start gap-2 min-w-0">
                      {s.kind === 'project' ? (
                        <Sparkles className="h-4 w-4 text-emerald-500 mt-0.5 flex-shrink-0" />
                      ) : (
                        <Users className="h-4 w-4 text-blue-500 mt-0.5 flex-shrink-0" />
                      )}
                      <p className="text-sm leading-snug">
                        Is <span className="font-semibold">&lsquo;{s.candidate_name}&rsquo;</span> the same as{' '}
                        <span className="font-semibold">{targetName ?? 'this ' + s.kind}</span>?
                      </p>
                    </div>
                    <span
                      className={cn(
                        'inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium flex-shrink-0',
                        tier.className
                      )}
                    >
                      {tier.label}
                    </span>
                  </div>

                  {summary && <p className="text-xs text-muted-foreground pl-6">{summary}</p>}

                  <div className="flex items-center gap-2 pl-6">
                    <Button size="sm" variant="default" className="h-7" onClick={() => accept(s.id)}>
                      <Check className="h-3.5 w-3.5 mr-1" />
                      Yes, merge
                    </Button>
                    <Button size="sm" variant="outline" className="h-7" onClick={() => reject(s.id)}>
                      <X className="h-3.5 w-3.5 mr-1" />
                      No
                    </Button>
                  </div>
                </CardContent>
              </Card>
            )
          })}
        </div>
      )}
    </section>
  )
}

export default IdentitySuggestionsSection
