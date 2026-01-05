/**
 * BulkResultSummary - Dialog showing results after bulk operations complete
 *
 * Displays summary of succeeded/failed/cancelled items and provides retry functionality
 * for failed items with retryable errors.
 */

import { useMemo } from 'react'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogDescription
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { BulkOperationResult } from '@/hooks/useBulkOperation'
import { LibraryError } from '@/features/library/utils/errorHandling'
import { AlertCircle, CheckCircle, XCircle } from 'lucide-react'

export interface BulkResultSummaryProps {
  isOpen: boolean
  onClose: () => void
  operation: 'Download' | 'Transcribe' | 'Delete'
  result: BulkOperationResult
  onRetryFailed: (ids: string[]) => void
}

/**
 * Determine dialog title based on operation result
 */
function getTitle(result: BulkOperationResult, operation: string): string {
  if (result.wasAborted) {
    return `${operation} Cancelled`
  }
  if (result.failed.length === 0) {
    return `${operation} Complete`
  }
  return `${operation} Completed with Errors`
}

/**
 * Get icon for error item based on retryability
 */
function ErrorIcon({ error }: { error: LibraryError }) {
  if (error.retryable) {
    return <AlertCircle className="h-4 w-4 text-yellow-500 flex-shrink-0" aria-label="Retryable error" />
  }
  return <XCircle className="h-4 w-4 text-destructive flex-shrink-0" aria-label="Permanent error" />
}

export function BulkResultSummary({ isOpen, onClose, operation, result, onRetryFailed }: BulkResultSummaryProps) {
  // Filter retryable failed items
  const retryableItems = useMemo(() => result.failed.filter((f) => f.error.retryable), [result.failed])

  const hasRetryableErrors = retryableItems.length > 0

  const handleRetry = () => {
    const retryableIds = retryableItems.map((item) => item.id)
    onRetryFailed(retryableIds)
  }

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-2xl max-h-[80vh] flex flex-col" aria-describedby="bulk-result-description">
        <DialogHeader>
          <DialogTitle>{getTitle(result, operation)}</DialogTitle>
          <DialogDescription id="bulk-result-description">
            Summary of the bulk {operation.toLowerCase()} operation
          </DialogDescription>
        </DialogHeader>

        {/* Summary Statistics */}
        <div className="grid grid-cols-3 gap-4 py-4">
          {/* Succeeded */}
          <div className="flex flex-col items-center justify-center p-4 rounded-lg bg-green-50 dark:bg-green-950/20">
            <CheckCircle className="h-8 w-8 text-green-600 dark:text-green-400 mb-2" aria-hidden="true" />
            <div className="text-2xl font-bold text-green-700 dark:text-green-300" aria-label="Succeeded count">
              {result.succeeded.length}
            </div>
            <div className="text-sm text-green-600 dark:text-green-400">Succeeded</div>
          </div>

          {/* Failed */}
          <div className="flex flex-col items-center justify-center p-4 rounded-lg bg-red-50 dark:bg-red-950/20">
            <XCircle className="h-8 w-8 text-red-600 dark:text-red-400 mb-2" aria-hidden="true" />
            <div className="text-2xl font-bold text-red-700 dark:text-red-300" aria-label="Failed count">
              {result.failed.length}
            </div>
            <div className="text-sm text-red-600 dark:text-red-400">Failed</div>
          </div>

          {/* Cancelled */}
          <div className="flex flex-col items-center justify-center p-4 rounded-lg bg-gray-50 dark:bg-gray-950/20">
            <AlertCircle className="h-8 w-8 text-gray-600 dark:text-gray-400 mb-2" aria-hidden="true" />
            <div className="text-2xl font-bold text-gray-700 dark:text-gray-300" aria-label="Cancelled count">
              {result.cancelled.length}
            </div>
            <div className="text-sm text-gray-600 dark:text-gray-400">Cancelled</div>
          </div>
        </div>

        {/* Failed Items List */}
        {result.failed.length > 0 && (
          <div className="flex-1 overflow-y-auto">
            <h3 className="text-sm font-semibold mb-2">Failed Items</h3>
            <dl className="space-y-3" aria-label="Failed items list">
              {result.failed.map((item) => (
                <div
                  key={item.id}
                  className="flex gap-3 p-3 rounded-lg border bg-card text-card-foreground"
                  role="group"
                  aria-label={`Failed item ${item.id}`}
                >
                  <ErrorIcon error={item.error} />
                  <div className="flex-1 min-w-0">
                    <dt className="text-sm font-medium truncate" title={item.id}>
                      {item.id}
                    </dt>
                    <dd className="text-sm text-muted-foreground mt-1">{item.error.message}</dd>
                    {item.error.details && (
                      <dd className="text-xs text-muted-foreground mt-1 italic">{item.error.details}</dd>
                    )}
                    {item.error.retryable && (
                      <dd className="text-xs text-yellow-600 dark:text-yellow-400 mt-1">Can be retried</dd>
                    )}
                  </div>
                </div>
              ))}
            </dl>
          </div>
        )}

        {/* Footer Actions */}
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Dismiss
          </Button>
          {hasRetryableErrors && (
            <Button onClick={handleRetry} aria-label={`Retry ${retryableItems.length} failed items`}>
              Retry Failed ({retryableItems.length})
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
