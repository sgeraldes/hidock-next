/**
 * AssistantPanel Component
 *
 * AI Assistant panel for the Library tri-pane layout.
 * Provides context-aware suggestions and quick actions for selected recordings.
 *
 * Security:
 * - User input sanitized before display
 * - AI responses rendered as text-only (no HTML injection)
 * - Query length limited to 500 characters
 * - Rate limiting enforced (max 10 queries per minute)
 */

import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { UnifiedRecording, hasLocalPath } from '@/types/unified-recording'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { Sparkles, FileText, Lightbulb, AlertCircle } from 'lucide-react'

interface AssistantPanelProps {
  recording: UnifiedRecording | null
  transcript?: { question_suggestions?: string | null } | null
  onAskAssistant?: (recording: UnifiedRecording) => void
  onGenerateOutput?: (recording: UnifiedRecording) => void
}

const MAX_QUERY_LENGTH = 500
const MAX_QUERIES_PER_MINUTE = 10

export function AssistantPanel({ recording, transcript, onAskAssistant, onGenerateOutput }: AssistantPanelProps) {
  const navigate = useNavigate()
  const [query, setQuery] = useState('')
  const [queryCount, setQueryCount] = useState(0)
  const [rateLimitReset, setRateLimitReset] = useState<number | null>(null)

  // Rate limiting: reset count every minute
  useEffect(() => {
    if (queryCount > 0 && !rateLimitReset) {
      const resetTime = Date.now() + 60000 // 1 minute from now
      setRateLimitReset(resetTime)

      const timer = setTimeout(() => {
        setQueryCount(0)
        setRateLimitReset(null)
      }, 60000)

      return () => clearTimeout(timer)
    }
    return undefined
  }, [queryCount, rateLimitReset])

  const handleQuerySubmit = () => {
    if (!recording || !query.trim()) return

    // Rate limiting check
    if (queryCount >= MAX_QUERIES_PER_MINUTE) {
      alert('Rate limit exceeded. Please wait before submitting more queries.')
      return
    }

    // Sanitize input (basic trim and length limit)
    const sanitizedQuery = query.trim().slice(0, MAX_QUERY_LENGTH)

    // Increment query count for rate limiting
    setQueryCount((prev) => prev + 1)

    // Navigate to assistant with context
    navigate('/assistant', {
      state: {
        contextId: recording.knowledgeCaptureId || recording.id,
        initialQuery: sanitizedQuery
      }
    })

    // Clear input
    setQuery('')
  }

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleQuerySubmit()
    }
  }

  const isRateLimited = queryCount >= MAX_QUERIES_PER_MINUTE
  const canQuery = recording && query.trim().length > 0 && !isRateLimited

  // Parse dynamic questions from transcript, fallback to default questions
  const suggestedQuestions = (() => {
    if (transcript?.question_suggestions) {
      try {
        const parsed = JSON.parse(transcript.question_suggestions)
        if (Array.isArray(parsed) && parsed.length > 0) {
          return parsed
        }
      } catch (e) {
        console.warn('Failed to parse question_suggestions:', e)
      }
    }
    // Fallback to default questions
    return [
      'What were the key topics discussed?',
      'What action items were mentioned?',
      'Summarize the main decisions made'
    ]
  })()

  return (
    <div className="flex flex-col h-full bg-background">
      {/* Header */}
      <div className="p-4 border-b">
        <div className="flex items-center gap-2">
          <Sparkles className="h-5 w-5 text-primary" />
          <h3 className="font-semibold">AI Assistant</h3>
        </div>
      </div>

      {/* Content Area */}
      <div className="flex-1 overflow-auto p-4">
        {recording ? (
          <div className="space-y-4">
            {/* Context-aware suggestions */}
            <div className="space-y-2">
              <h4 className="text-sm font-medium text-muted-foreground">Quick Actions</h4>
              <div className="space-y-2">
                {recording.transcriptionStatus === 'complete' && (
                  <Button
                    variant="outline"
                    size="sm"
                    className="w-full justify-start"
                    onClick={() => onGenerateOutput?.(recording)}
                  >
                    <FileText className="h-4 w-4 mr-2" />
                    Generate Meeting Minutes
                  </Button>
                )}

                {hasLocalPath(recording) && (
                  <Button
                    variant="outline"
                    size="sm"
                    className="w-full justify-start"
                    onClick={() => onAskAssistant?.(recording)}
                  >
                    <Lightbulb className="h-4 w-4 mr-2" />
                    Ask about this recording
                  </Button>
                )}
              </div>
            </div>

            {/* Contextual suggestions */}
            <div className="space-y-2">
              <h4 className="text-sm font-medium text-muted-foreground">Suggested Questions</h4>
              <div className="space-y-2 text-sm">
                {suggestedQuestions.map((question, index) => (
                  <button
                    key={index}
                    className="w-full text-left p-2 rounded hover:bg-muted transition-colors"
                    onClick={() => setQuery(question)}
                  >
                    {question}
                  </button>
                ))}
              </div>
            </div>
          </div>
        ) : (
          <div className="text-center text-muted-foreground py-8">
            <Sparkles className="h-8 w-8 mx-auto mb-2 opacity-50" />
            <p className="text-sm">Select a recording to get AI assistance</p>
          </div>
        )}
      </div>

      {/* Input Area */}
      <div className="p-4 border-t space-y-2">
        {isRateLimited && (
          <div className="flex items-start gap-2 p-2 bg-destructive/10 text-destructive text-xs rounded">
            <AlertCircle className="h-4 w-4 flex-shrink-0 mt-0.5" />
            <p>Rate limit reached. Wait {Math.ceil((rateLimitReset! - Date.now()) / 1000)}s before submitting more queries.</p>
          </div>
        )}
        <div className="space-y-2">
          <Textarea
            placeholder={
              recording
                ? 'Ask a question about this recording...'
                : 'Select a recording first'
            }
            value={query}
            onChange={(e) => setQuery(e.target.value.slice(0, MAX_QUERY_LENGTH))}
            onKeyDown={handleKeyDown}
            disabled={!recording || isRateLimited}
            className="resize-none"
            rows={3}
          />
          <div className="flex items-center justify-between">
            <span className="text-xs text-muted-foreground">
              {query.length}/{MAX_QUERY_LENGTH}
            </span>
            <Button
              size="sm"
              onClick={handleQuerySubmit}
              disabled={!canQuery}
            >
              Ask
            </Button>
          </div>
        </div>
      </div>
    </div>
  )
}
