/**
 * BulkProgressModal - Shows detailed per-item progress during bulk operations
 *
 * Pure display component - does NOT own state. All state comes from useBulkOperation hook via props.
 */

import { useState, useEffect, useRef } from 'react'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { CheckCircle2, XCircle, Circle, Loader2, Ban, ChevronDown, ChevronRight } from 'lucide-react'
import { BulkOperationItem, BulkItemStatus } from '@/hooks/useBulkOperation'
import { LibraryError, getRecoveryAction } from '@/features/library/utils/errorHandling'
import { cn } from '@/lib/utils'

interface BulkProgressModalProps {
  isOpen: boolean
  onClose: () => void
  operation: 'download' | 'transcribe' | 'delete'
  items: BulkOperationItem[]
  progress: { current: number; total: number }
  onCancel: () => void
}

/**
 * Status icon component with accessibility
 */
function StatusIcon({ status }: { status: BulkItemStatus }) {
  const iconProps = { className: 'h-4 w-4', 'aria-hidden': true }

  switch (status) {
    case 'success':
      return <CheckCircle2 {...iconProps} className="h-4 w-4 text-green-500" />
    case 'failed':
      return <XCircle {...iconProps} className="h-4 w-4 text-destructive" />
    case 'pending':
      return <Circle {...iconProps} className="h-4 w-4 text-muted-foreground" />
    case 'processing':
      return <Loader2 {...iconProps} className="h-4 w-4 animate-spin text-primary" />
    case 'cancelled':
      return <Ban {...iconProps} className="h-4 w-4 text-muted-foreground" />
    default:
      return <Circle {...iconProps} className="h-4 w-4 text-muted-foreground" />
  }
}

/**
 * Status text for screen readers
 */
function getStatusText(status: BulkItemStatus): string {
  switch (status) {
    case 'success':
      return 'completed successfully'
    case 'failed':
      return 'failed'
    case 'pending':
      return 'pending'
    case 'processing':
      return 'in progress'
    case 'cancelled':
      return 'cancelled'
    default:
      return 'unknown status'
  }
}

/**
 * Operation verb for display
 */
function getOperationVerb(operation: 'download' | 'transcribe' | 'delete', suffix: 'ing' | 'ed' = 'ing'): string {
  const verbs = {
    download: { ing: 'Downloading', ed: 'downloaded' },
    transcribe: { ing: 'Transcribing', ed: 'transcribed' },
    delete: { ing: 'Deleting', ed: 'deleted' }
  }
  return verbs[operation][suffix]
}

/**
 * Expandable error details component
 */
function ErrorDetails({ error }: { error: LibraryError }) {
  const [isExpanded, setIsExpanded] = useState(false)
  const recoveryAction = getRecoveryAction(error.type)

  return (
    <div className="mt-2 ml-6 text-sm">
      <button
        onClick={() => setIsExpanded(!isExpanded)}
        className="flex items-center gap-1 text-muted-foreground hover:text-foreground transition-colors"
        aria-expanded={isExpanded}
        aria-controls={`error-details-${error.sourceId}`}
      >
        {isExpanded ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
        <span className="text-destructive">Error details</span>
      </button>

      {isExpanded && (
        <div id={`error-details-${error.sourceId}`} className="mt-2 p-3 bg-destructive/5 rounded-md border border-destructive/20">
          <p className="text-destructive font-medium">{error.message}</p>
          {error.details && <p className="mt-1 text-muted-foreground">{error.details}</p>}
          {recoveryAction && error.recoverable && (
            <p className="mt-2 text-sm font-medium text-primary">{recoveryAction.label}</p>
          )}
        </div>
      )}
    </div>
  )
}

/**
 * Individual item row component
 */
function ItemRow({ item }: { item: BulkOperationItem }) {
  // Extract title from item data (assuming data has a title property)
  const title = (item.data as any)?.title || (item.data as any)?.name || `Item ${item.id.slice(0, 8)}`

  return (
    <li className="py-2 border-b last:border-b-0" aria-label={`${title}: ${getStatusText(item.status)}`}>
      <div className="flex items-start gap-3">
        <div className="flex-shrink-0 mt-0.5">
          <StatusIcon status={item.status} />
        </div>

        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium truncate">{title}</p>

          {/* Progress bar for processing items */}
          {item.status === 'processing' && item.progress !== undefined && (
            <div className="mt-1 w-full h-1.5 bg-muted rounded-full overflow-hidden">
              <div
                className="h-full bg-primary transition-all duration-300"
                style={{ width: `${item.progress}%` }}
                role="progressbar"
                aria-valuenow={item.progress}
                aria-valuemin={0}
                aria-valuemax={100}
              />
            </div>
          )}
        </div>

        {/* Status text for screen readers */}
        <span className="sr-only">{getStatusText(item.status)}</span>
      </div>

      {/* Error details (expandable) */}
      {item.error && <ErrorDetails error={item.error} />}
    </li>
  )
}

/**
 * BulkProgressModal - Main component
 */
export function BulkProgressModal({
  isOpen,
  onClose,
  operation,
  items,
  progress,
  onCancel
}: BulkProgressModalProps) {
  // Track if operation is running (items with pending or processing status)
  const isRunning = items.some((item) => item.status === 'pending' || item.status === 'processing')

  // Track failed items count
  const failedCount = items.filter((item) => item.status === 'failed').length

  // Live region announcement ref
  const liveRegionRef = useRef<HTMLDivElement>(null)
  const [announcement, setAnnouncement] = useState('')

  // Update announcement when progress changes
  useEffect(() => {
    if (progress.current > 0) {
      setAnnouncement(`${progress.current} of ${progress.total} items processed`)
    }
  }, [progress.current, progress.total])

  // Determine close behavior
  const handleClose = () => {
    if (isRunning) {
      // Operation still running - do nothing (user must cancel first)
      return
    }
    onClose()
  }

  // Calculate progress percentage
  const progressPercent = progress.total > 0 ? (progress.current / progress.total) * 100 : 0

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && handleClose()}>
      <DialogContent
        className="max-w-2xl max-h-[80vh] flex flex-col"
        aria-labelledby="bulk-progress-title"
        aria-describedby="bulk-progress-description"
        // Prevent closing while running
        onEscapeKeyDown={(e) => isRunning && e.preventDefault()}
        onPointerDownOutside={(e) => isRunning && e.preventDefault()}
        onInteractOutside={(e) => isRunning && e.preventDefault()}
      >
        <DialogHeader>
          <DialogTitle id="bulk-progress-title">
            {getOperationVerb(operation)} Files
          </DialogTitle>
          <DialogDescription id="bulk-progress-description">
            {progress.current} of {progress.total} complete
            {failedCount > 0 && ` (${failedCount} failed)`}
          </DialogDescription>
        </DialogHeader>

        {/* Live region for screen readers */}
        <div
          ref={liveRegionRef}
          role="status"
          aria-live="polite"
          aria-atomic="true"
          className="sr-only"
        >
          {announcement}
        </div>

        {/* Overall progress bar */}
        <div className="px-6 -mt-2">
          <div className="w-full h-2 bg-muted rounded-full overflow-hidden">
            <div
              className="h-full bg-primary transition-all duration-300"
              style={{ width: `${progressPercent}%` }}
              role="progressbar"
              aria-valuenow={progressPercent}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-label="Overall progress"
            />
          </div>
        </div>

        {/* Item list - scrollable */}
        <div className="flex-1 overflow-y-auto min-h-0 px-6">
          <ul role="list" aria-label="Operation progress" className="space-y-0">
            {items.map((item) => (
              <ItemRow key={item.id} item={item} />
            ))}
          </ul>
        </div>

        <DialogFooter className="flex flex-row justify-between items-center gap-2">
          {/* Cancel button (only show when running) */}
          {isRunning && (
            <Button onClick={onCancel} variant="destructive" size="sm">
              Cancel Remaining
            </Button>
          )}

          {/* Close button */}
          <Button
            onClick={handleClose}
            variant={isRunning ? 'outline' : 'default'}
            disabled={isRunning}
            size="sm"
            className="ml-auto"
          >
            {isRunning ? 'Running...' : 'Close'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
