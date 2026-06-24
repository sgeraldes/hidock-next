import { Circle, Clock, Loader2, CheckCircle2, AlertCircle, type LucideIcon } from 'lucide-react'
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

// Distinct shape per status — status must be legible without relying on color
// (WCAG 1.4.1). Each state has its own glyph, so colorblind users and a
// monochrome glance can still tell them apart.
const STATUS_ICONS: Record<string, LucideIcon> = {
  none: Circle,
  pending: Clock,
  processing: Loader2,
  complete: CheckCircle2,
  error: AlertCircle
}

// Icon color per status (paired with the distinct shape above, not the sole signal)
const ICON_COLORS: Record<string, string> = {
  none: 'text-muted-foreground/50',
  pending: 'text-yellow-600 dark:text-yellow-400',
  processing: 'text-yellow-600 dark:text-yellow-400',
  complete: 'text-green-600 dark:text-green-400',
  error: 'text-destructive'
}

// Badge styling based on status
const STATUS_STYLES: Record<string, string> = {
  none: 'bg-secondary text-secondary-foreground',
  pending: 'bg-yellow-100 dark:bg-yellow-900 text-yellow-700 dark:text-yellow-300',
  processing: 'bg-yellow-100 dark:bg-yellow-900 text-yellow-700 dark:text-yellow-300',
  complete: 'bg-green-100 dark:bg-green-900 text-green-700 dark:text-green-300',
  error: 'bg-red-100 dark:bg-red-900 text-red-700 dark:text-red-300'
}

export function TranscriptionStatusBadge({ status, compact, className }: TranscriptionStatusBadgeProps) {
  if (compact) {
    const Icon = STATUS_ICONS[status] ?? Circle
    return (
      <TooltipProvider>
        <Tooltip>
          <TooltipTrigger asChild>
            <span className={`inline-flex shrink-0 ${className || ''}`} aria-label={STATUS_LABELS[status]} role="img">
              <Icon
                className={`h-3.5 w-3.5 ${ICON_COLORS[status]} ${status === 'processing' ? 'motion-safe:animate-spin' : ''}`}
                aria-hidden="true"
              />
            </span>
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
