import { useEffect, useRef, useState } from 'react'
import { X, Copy } from 'lucide-react'
import { useTranscriptStore } from '../../stores/transcript-store'
import { useSuggestionStore } from '../../stores/suggestion-store'
import { Button } from '../ui/button'
import { cn } from '../../lib/utils'
import { getElectronAPI } from '../../lib/electron-api'
import type { TranscriptSegment } from '../../types/models'
import type { Suggestion } from '../../types/models'

const speakerColorClasses: Record<number, string> = {
  1: 'text-speaker-1',
  2: 'text-speaker-2',
  3: 'text-speaker-3',
  4: 'text-speaker-4',
  5: 'text-speaker-5',
  6: 'text-speaker-6',
}

function speakerColorIndex(speaker: string): number {
  let hash = 0
  for (const char of speaker) hash = ((hash << 5) - hash + char.charCodeAt(0)) | 0
  return (Math.abs(hash) % 6) + 1
}

function TranscriptLine({ segment }: { segment: TranscriptSegment }) {
  const speaker = segment.speaker ?? 'Unknown'
  const colorIndex = speakerColorIndex(speaker)
  const colorClass = speakerColorClasses[colorIndex]

  return (
    <div className="flex flex-col gap-0.5 px-3 py-1">
      <span className={cn('font-sans text-[11px] font-semibold leading-none', colorClass)}>
        {speaker}
      </span>
      <p className="font-sans text-xs text-foreground/90 leading-snug">{segment.text}</p>
    </div>
  )
}

function CompactSuggestionCard({
  suggestion,
  onDismiss,
}: {
  suggestion: Suggestion
  onDismiss: (id: string) => void
}) {
  const [copied, setCopied] = useState(false)

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(suggestion.text)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch (err) {
      console.error('[OverlayContent] Failed to copy suggestion:', err)
    }
  }

  return (
    <div className="bg-accent/10 border-l-2 border-accent rounded p-2 group relative">
      <p className="font-sans text-xs text-foreground leading-snug pr-10">{suggestion.text}</p>
      <div className="absolute top-1 right-1 flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
        <Button
          variant="ghost"
          size="icon"
          className="h-5 w-5 text-muted-foreground hover:text-foreground"
          onClick={handleCopy}
          title={copied ? 'Copied!' : 'Copy'}
          aria-label={copied ? 'Copied to clipboard' : 'Copy suggestion'}
        >
          {copied ? (
            <span className="text-[9px] font-sans font-medium text-accent">✓</span>
          ) : (
            <Copy className="h-3 w-3" />
          )}
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className="h-5 w-5 text-muted-foreground hover:text-foreground"
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

export function OverlayContent() {
  const segments = useTranscriptStore((s) => s.segments)
  const interimText = useTranscriptStore((s) => s.interimText)
  const suggestions = useSuggestionStore((s) => s.suggestions)
  const dismiss = useSuggestionStore((s) => s.dismiss)

  const transcriptEndRef = useRef<HTMLDivElement>(null)

  // Show last 20 segments
  const recentSegments = segments.slice(-20)
  const activeSuggestions = suggestions.filter((s) => !s.dismissed)

  // Auto-scroll transcript to bottom when new content arrives
  useEffect(() => {
    transcriptEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [segments, interimText])

  const handleClose = () => {
    const api = getElectronAPI()
    if (!api) return
    api.window.close()
  }

  return (
    <div
      className={cn(
        'w-[350px] h-[500px]',
        'bg-background/85 backdrop-blur-md',
        'rounded-xl shadow-overlay border border-border/50',
        'flex flex-col overflow-hidden',
      )}
    >
      {/* Header */}
      <div className="h-10 flex items-center justify-between px-3 border-b border-border/50 titlebar-drag-region flex-shrink-0">
        <span className="font-sans text-xs font-semibold text-foreground/80">
          Meeting Assistant
        </span>
        <Button
          variant="ghost"
          size="icon"
          className="h-6 w-6 text-muted-foreground hover:text-foreground titlebar-no-drag"
          onClick={handleClose}
          title="Close overlay"
          aria-label="Close overlay"
        >
          <X className="h-3.5 w-3.5" />
        </Button>
      </div>

      {/* Live Transcript */}
      <div className="flex-1 min-h-0 overflow-y-auto py-1">
        {recentSegments.length === 0 && !interimText ? (
          <div className="flex items-center justify-center h-full">
            <span className="font-sans text-xs text-muted-foreground">
              Transcript will appear here...
            </span>
          </div>
        ) : (
          <>
            {recentSegments.map((segment) => (
              <TranscriptLine key={segment.id} segment={segment} />
            ))}
            {interimText && (
              <div className="px-3 py-1">
                <p className="font-sans text-xs text-muted-foreground italic leading-snug">
                  {interimText}
                </p>
              </div>
            )}
            <div ref={transcriptEndRef} />
          </>
        )}
      </div>

      {/* Suggestions */}
      {activeSuggestions.length > 0 && (
        <div className="border-t border-border/50 flex flex-col max-h-[40%] flex-shrink-0">
          <div className="px-3 pt-2 pb-1 flex-shrink-0">
            <span className="font-sans text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">
              Suggestions
            </span>
          </div>
          <div className="overflow-y-auto px-3 pb-2 flex flex-col gap-1.5">
            {activeSuggestions.map((suggestion) => (
              <CompactSuggestionCard
                key={suggestion.id}
                suggestion={suggestion}
                onDismiss={dismiss}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
