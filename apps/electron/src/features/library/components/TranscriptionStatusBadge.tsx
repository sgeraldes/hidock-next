import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'

interface TranscriptionStatusBadgeProps {
  status: 'none' | 'pending' | 'processing' | 'complete' | 'error'
  compact?: boolean
  className?: string
}

// Human-readable status text mapping
const STATUS_LABELS: Record<string, string> = {
  none: 'Not transcribed',
  pending: 'Queued',
  processing: 'In Progress',
  complete: 'Transcribed',
  error: 'Failed'
}

// Badge styling based on status
const STATUS_STYLES: Record<string, string> = {
  none: 'bg-secondary text-secondary-foreground',
  pending: 'bg-yellow-100 dark:bg-yellow-900 text-yellow-700 dark:text-yellow-300',
  processing: 'bg-yellow-100 dark:bg-yellow-900 text-yellow-700 dark:text-yellow-300',
  complete: 'bg-green-100 dark:bg-green-900 text-green-700 dark:text-green-300',
  error: 'bg-red-100 dark:bg-red-900 text-red-700 dark:text-red-300'
}

// Compact dot colors
const DOT_STYLES: Record<string, string> = {
  none: 'bg-muted-foreground/40',
  pending: 'bg-yellow-500',
  processing: 'bg-yellow-500 animate-pulse',
  complete: 'bg-green-500',
  error: 'bg-red-500'
}

export function TranscriptionStatusBadge({ status, compact, className }: TranscriptionStatusBadgeProps) {
  if (compact) {
    return (
      <TooltipProvider>
        <Tooltip>
          <TooltipTrigger asChild>
            <span
              className={`inline-block h-2 w-2 rounded-full shrink-0 ${DOT_STYLES[status]} ${className || ''}`}
              aria-label={STATUS_LABELS[status]}
            />
          </TooltipTrigger>
          <TooltipContent>
            <p>{STATUS_LABELS[status]}</p>
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>
    )
  }

  return (
    <span className={`text-xs px-2 py-1 rounded-full ${STATUS_STYLES[status]} ${className || ''}`}>
      {STATUS_LABELS[status]}
    </span>
  )
}
