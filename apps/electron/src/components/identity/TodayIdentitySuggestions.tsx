import { useNavigate } from 'react-router-dom'
import { Sparkles, ArrowRight } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { useIdentitySuggestions } from './useIdentitySuggestions'

/**
 * Compact Today-page card summarizing the pending identity-suggestion queue.
 * Renders only when suggestions exist; shows the count, the top 2 candidates,
 * and a "Review all" affordance that deep-links to the People page.
 */
export function TodayIdentitySuggestions() {
  const navigate = useNavigate()
  const { suggestions, loading, targetNames } = useIdentitySuggestions()

  if (loading || suggestions.length === 0) return null

  const top = suggestions.slice(0, 2)

  return (
    <Card className="border-amber-500/30 bg-amber-500/[0.03]">
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center justify-between text-base">
          <span className="flex items-center gap-2">
            <Sparkles className="h-4 w-4 text-amber-500" />
            Identity suggestions
            <span className="text-xs font-normal text-muted-foreground">({suggestions.length})</span>
          </span>
          <Button variant="ghost" size="sm" onClick={() => navigate('/people')}>
            Review all
            <ArrowRight className="h-4 w-4 ml-1" />
          </Button>
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="space-y-2">
          {top.map((s) => (
            <button
              key={s.id}
              onClick={() => navigate('/people')}
              className="w-full flex items-center gap-2 rounded-lg border p-3 text-left hover:bg-muted/50 transition-colors"
            >
              <span className="text-sm truncate flex-1">
                Is <span className="font-semibold">&lsquo;{s.candidate_name}&rsquo;</span> the same as{' '}
                <span className="font-semibold">{targetNames[s.target_id] ?? 'a known ' + s.kind}</span>?
              </span>
              <span className="text-xs text-muted-foreground flex-shrink-0">
                {Math.round((s.confidence ?? 0) * 100)}%
              </span>
            </button>
          ))}
        </div>
      </CardContent>
    </Card>
  )
}

export default TodayIdentitySuggestions
