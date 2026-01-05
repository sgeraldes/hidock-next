import { X, Download, Wand2, Trash2, CheckSquare, Square } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Progress } from '@/components/ui/progress'
import { cn } from '@/lib/utils'

interface BulkActionsBarProps {
  selectedCount: number
  totalCount: number
  deviceConnected: boolean
  isProcessing: boolean
  progress?: { current: number; total: number }
  disabledActions?: {
    download?: boolean
    process?: boolean
    delete?: boolean
  }
  onSelectAll: () => void
  onDeselectAll: () => void
  onDownload: () => void
  onProcess: () => void
  onDelete: () => void
}

export function BulkActionsBar({
  selectedCount,
  totalCount,
  deviceConnected,
  isProcessing,
  progress,
  disabledActions = {},
  onSelectAll,
  onDeselectAll,
  onDownload,
  onProcess,
  onDelete
}: BulkActionsBarProps) {
  if (selectedCount === 0) return null

  const allSelected = selectedCount === totalCount && totalCount > 0

  return (
    <div
      className={cn(
        'flex items-center justify-between gap-4 px-6 py-3',
        'bg-primary/5 border-b border-primary/20',
        'animate-in slide-in-from-top-2 duration-200'
      )}
      role="toolbar"
      aria-label="Bulk actions"
    >
      <div className="flex items-center gap-3">
        {/* Selection Toggle */}
        <Button
          variant="ghost"
          size="sm"
          onClick={allSelected ? onDeselectAll : onSelectAll}
          className="gap-2"
          aria-label={allSelected ? 'Deselect all' : 'Select all'}
        >
          {allSelected ? (
            <CheckSquare className="h-4 w-4 text-primary" />
          ) : (
            <Square className="h-4 w-4" />
          )}
          {allSelected ? 'Deselect All' : 'Select All'}
        </Button>

        {/* Selection Count */}
        <span className="text-sm text-muted-foreground">
          {selectedCount} of {totalCount} selected
        </span>

        {/* Progress Indicator */}
        {isProcessing && progress && (
          <div className="flex items-center gap-2 ml-4">
            <Progress value={(progress.current / progress.total) * 100} className="w-32 h-2" />
            <span className="text-xs text-muted-foreground">
              {progress.current}/{progress.total}
            </span>
          </div>
        )}
      </div>

      <div className="flex items-center gap-2">
        {/* Download Action */}
        <Button
          variant="outline"
          size="sm"
          onClick={onDownload}
          disabled={!deviceConnected || isProcessing || disabledActions.download}
          className="gap-2"
          title={!deviceConnected ? 'Device not connected' : 'Download selected from device'}
        >
          <Download className="h-4 w-4" />
          Download
        </Button>

        {/* Process/Transcribe Action */}
        <Button
          variant="outline"
          size="sm"
          onClick={onProcess}
          disabled={isProcessing || disabledActions.process}
          className="gap-2"
          title="Transcribe selected recordings"
        >
          <Wand2 className="h-4 w-4" />
          {isProcessing ? 'Processing...' : 'Transcribe'}
        </Button>

        {/* Delete Action */}
        <Button
          variant="outline"
          size="sm"
          onClick={onDelete}
          disabled={isProcessing || disabledActions.delete}
          className="gap-2 text-destructive hover:text-destructive"
          title="Delete selected"
        >
          <Trash2 className="h-4 w-4" />
          Delete
        </Button>

        {/* Clear Selection */}
        <Button
          variant="ghost"
          size="sm"
          onClick={onDeselectAll}
          className="ml-2"
          aria-label="Clear selection"
        >
          <X className="h-4 w-4" />
        </Button>
      </div>
    </div>
  )
}
