import { useSuggestionStore } from '../../stores/suggestion-store'
import { SuggestionCard } from './SuggestionCard'

interface SuggestionListProps {
  sessionId?: string
}

export function SuggestionList({ sessionId: _sessionId }: SuggestionListProps) {
  const { suggestions, dismiss } = useSuggestionStore()

  const activeSuggestions = suggestions.filter((s) => !s.dismissed)

  if (activeSuggestions.length === 0) {
    return (
      <div className="flex items-center justify-center h-full min-h-[80px]">
        <p className="font-sans text-sm text-muted-foreground">No suggestions yet</p>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-2 p-2">
      {activeSuggestions.map((suggestion) => (
        <SuggestionCard key={suggestion.id} suggestion={suggestion} onDismiss={dismiss} />
      ))}
    </div>
  )
}
