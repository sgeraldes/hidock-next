interface TranscriptionStatusBadgeProps {
  status: 'none' | 'pending' | 'processing' | 'complete' | 'error'
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

export function TranscriptionStatusBadge({ status, className }: TranscriptionStatusBadgeProps) {
  return (
    <span className={`text-xs px-2 py-1 rounded-full ${STATUS_STYLES[status]} ${className || ''}`}>
      {STATUS_LABELS[status]}
    </span>
  )
}
