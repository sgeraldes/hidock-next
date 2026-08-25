import {
  ChevronDown,
  CloudDownload,
  Download,
  FileUp,
  FolderOpen,
  LayoutGrid,
  List,
  Plus,
  RefreshCw,
  Trash2,
  Zap
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger
} from '@/components/ui/dropdown-menu'
import { cn } from '@/lib/utils'
import { TranscriptUpgradeButton } from './TranscriptUpgradeButton'

interface LibraryHeaderProps {
  stats: {
    total: number
    deviceOnly: number
    localOnly: number
    unsynced: number
  }
  deviceConnected: boolean
  deviceOnlyActive: boolean
  loading: boolean
  compactView: boolean
  pendingDownloadCount: number
  activeDownloadCount: number
  bulkCounts: {
    deviceOnly: number
    needsTranscription: number
  }
  bulkProcessing: boolean
  bulkProgress: { current: number; total: number }
  onAddRecording: () => void
  onImportFile: () => void
  onOpenFolder: () => void
  onBulkDownload: () => void
  onBulkProcess: () => void
  onRefresh: () => void
  onShowDeviceOnly: () => void
  onSetCompactView: (compact: boolean) => void
  showTrash: boolean
  trashCount: number
  onToggleTrash: () => void
}

export function LibraryHeader({
  stats,
  deviceConnected,
  deviceOnlyActive,
  loading,
  compactView,
  pendingDownloadCount,
  activeDownloadCount,
  bulkCounts,
  bulkProcessing,
  bulkProgress,
  onAddRecording,
  onImportFile,
  onOpenFolder,
  onBulkDownload,
  onBulkProcess,
  onRefresh,
  onShowDeviceOnly,
  onSetCompactView,
  showTrash,
  trashCount,
  onToggleTrash
}: LibraryHeaderProps) {
  const queuedDownloadCount = pendingDownloadCount + activeDownloadCount
  const downloadActionLabel = activeDownloadCount > 0
    ? 'Downloading'
    : pendingDownloadCount > 0
      ? 'Start download'
      : 'Download'

  return (
    <header className="border-b px-4 py-3 lg:px-6">
      <div className="flex flex-wrap items-center gap-x-6 gap-y-3">
        <div className="min-w-0 shrink-0">
          <h1 className="whitespace-nowrap text-xl font-bold tracking-tight sm:text-2xl">Knowledge Library</h1>
          <div className="mt-1 flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
            <span className="tabular-nums">
              {stats.total.toLocaleString()} source{stats.total !== 1 ? 's' : ''}
            </span>
            {stats.deviceOnly > 0 && (
              <button
                type="button"
                onClick={onShowDeviceOnly}
                aria-pressed={deviceOnlyActive}
                aria-label={`Show ${stats.deviceOnly} source${stats.deviceOnly === 1 ? '' : 's'} that need download`}
                className={cn(
                  'inline-flex h-6 items-center gap-1.5 rounded-full border px-2.5 text-xs font-medium transition-colors',
                  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
                  deviceOnlyActive
                    ? 'border-orange-400/60 bg-orange-500/15 text-orange-700 dark:text-orange-300'
                    : 'border-orange-400/30 bg-orange-500/5 text-orange-700 hover:border-orange-400/60 hover:bg-orange-500/10 dark:text-orange-300'
                )}
                title="Show audio stored only on the HiDock"
              >
                <CloudDownload className="h-3.5 w-3.5" aria-hidden="true" />
                <span className="tabular-nums">{stats.deviceOnly}</span>
                <span>needs download</span>
              </button>
            )}
          </div>
        </div>

        <div className="ml-auto flex min-w-0 flex-wrap items-center justify-end gap-2">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="default" size="sm" title="Add a source to the Library">
                <Plus className="mr-2 h-4 w-4" aria-hidden="true" />
                Add source
                <ChevronDown className="ml-1 h-3.5 w-3.5" aria-hidden="true" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-56">
              <DropdownMenuLabel>Add to Library</DropdownMenuLabel>
              <DropdownMenuItem onSelect={onAddRecording}>
                <Plus className="mr-2 h-4 w-4" aria-hidden="true" />
                Import audio capture
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={onImportFile}>
                <FileUp className="mr-2 h-4 w-4" aria-hidden="true" />
                Import document or image
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem onSelect={onOpenFolder}>
                <FolderOpen className="mr-2 h-4 w-4" aria-hidden="true" />
                Open Library folder
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>

          {bulkCounts.deviceOnly > 0 && (
            <Button
              variant="outline"
              size="sm"
              onClick={onBulkDownload}
              disabled={activeDownloadCount > 0 || !deviceConnected}
              aria-label={`${downloadActionLabel} ${bulkCounts.deviceOnly} source${bulkCounts.deviceOnly === 1 ? '' : 's'}`}
              title={`Download ${bulkCounts.deviceOnly} source${bulkCounts.deviceOnly === 1 ? '' : 's'} from the device`}
            >
              {activeDownloadCount > 0 ? (
                <RefreshCw className="h-4 w-4 animate-spin xl:mr-2" aria-hidden="true" />
              ) : (
                <Download className="h-4 w-4 xl:mr-2" aria-hidden="true" />
              )}
              <span className="hidden xl:inline">{downloadActionLabel}</span>
              <span className="ml-1 tabular-nums">
                {queuedDownloadCount > 0 ? queuedDownloadCount : bulkCounts.deviceOnly}
              </span>
            </Button>
          )}

          {bulkCounts.needsTranscription > 0 && (
            <Button
              variant="outline"
              size="sm"
              onClick={onBulkProcess}
              disabled={bulkProcessing}
              aria-label={`${bulkProcessing ? 'Processing' : 'Process'} ${bulkCounts.needsTranscription} audio source${bulkCounts.needsTranscription === 1 ? '' : 's'}`}
              title={`Queue ${bulkCounts.needsTranscription} audio source${bulkCounts.needsTranscription === 1 ? '' : 's'} for transcription`}
            >
              {bulkProcessing ? (
                <RefreshCw className="h-4 w-4 animate-spin xl:mr-2" aria-hidden="true" />
              ) : (
                <Zap className="h-4 w-4 xl:mr-2" aria-hidden="true" />
              )}
              <span className="hidden xl:inline">{bulkProcessing ? 'Processing' : 'Process'}</span>
              <span className="ml-1 tabular-nums">
                {bulkProcessing ? `${bulkProgress.current}/${bulkProgress.total}` : bulkCounts.needsTranscription}
              </span>
            </Button>
          )}

          <TranscriptUpgradeButton compact />

          <Button
            variant="ghost"
            size="icon-sm"
            onClick={onRefresh}
            disabled={loading}
            title="Refresh Library"
            aria-label="Refresh Library"
          >
            <RefreshCw className={cn('h-4 w-4', loading && 'animate-spin')} aria-hidden="true" />
          </Button>

          <Button
            type="button"
            variant={showTrash ? 'secondary' : 'ghost'}
            size="sm"
            onClick={onToggleTrash}
            aria-pressed={showTrash}
            aria-label={showTrash ? 'Exit Trash' : `View Trash${trashCount > 0 ? `, ${trashCount} items` : ''}`}
            title={showTrash ? 'Exit Trash' : 'View Trash'}
            className="px-2"
          >
            <Trash2 className="h-4 w-4" aria-hidden="true" />
            <span className="sr-only">{showTrash ? 'Exit Trash' : 'View Trash'}</span>
            {trashCount > 0 && (
              <span className="ml-1.5 min-w-4 rounded-full bg-muted px-1 text-[10px] font-semibold tabular-nums text-muted-foreground">
                {trashCount}
              </span>
            )}
          </Button>

          {!showTrash && (
            <div
              className="flex items-center overflow-hidden rounded-md border bg-background"
              role="group"
              aria-label="View layout"
              data-testid="grid-view-toggle"
            >
              <Button
                variant={compactView ? 'ghost' : 'default'}
                size="icon-sm"
                onClick={() => onSetCompactView(false)}
                className="rounded-none border-0"
                title="Card view"
                aria-label="Card view"
                aria-pressed={!compactView}
              >
                <LayoutGrid className="h-4 w-4" aria-hidden="true" />
              </Button>
              <Button
                variant={compactView ? 'default' : 'ghost'}
                size="icon-sm"
                onClick={() => onSetCompactView(true)}
                className="rounded-none border-0 border-l"
                title="List view"
                aria-label="List view"
                aria-pressed={compactView}
              >
                <List className="h-4 w-4" aria-hidden="true" />
              </Button>
            </div>
          )}
        </div>
      </div>
    </header>
  )
}
