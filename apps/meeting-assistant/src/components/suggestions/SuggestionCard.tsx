import { useState } from 'react'
import { Copy, X } from 'lucide-react'
import type { Suggestion } from '../../types/models'
import { Button } from '../ui/button'
import { cn } from '../../lib/utils'

interface SuggestionCardProps {
  suggestion: Suggestion
  onDismiss: (id: string) => void
}

export function SuggestionCard({ suggestion, onDismiss }: SuggestionCardProps) {
  const [copied, setCopied] = useState(false)

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(suggestion.text)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch (err) {
      console.error('[SuggestionCard] Failed to copy:', err)
    }
  }

  return (
    <div
      className={cn(
        'bg-accent/10 border-l-2 border-accent rounded p-3',
        'animate-slide-in-up',
        'group relative'
      )}
    >
      <p className="font-sans text-sm text-foreground leading-snug pr-12">{suggestion.text}</p>

      <div className="absolute top-1.5 right-1.5 flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity duration-standard">
        <Button
          variant="ghost"
          size="icon"
          className="h-6 w-6"
          onClick={handleCopy}
          title={copied ? 'Copied!' : 'Copy'}
          aria-label={copied ? 'Copied to clipboard' : 'Copy suggestion'}
        >
          {copied ? (
            <span className="text-[10px] font-sans font-medium text-accent">✓</span>
          ) : (
            <Copy className="h-3 w-3" />
          )}
        </Button>

        <Button
          variant="ghost"
          size="icon"
          className="h-6 w-6 text-muted-foreground hover:text-foreground"
          onClick={() => onDismiss(suggestion.id)}
          title="Dismiss"
          aria-label="Dismiss suggestion"
        >
          <X className="h-3 w-3" />
        </Button>
      </div>
    </div>
  )
}
