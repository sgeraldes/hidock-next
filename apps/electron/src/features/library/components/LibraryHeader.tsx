import { Plus, FolderOpen, Download, Zap, RefreshCw, LayoutGrid, List } from 'lucide-react'
import { Button } from '@/components/ui/button'

interface LibraryHeaderProps {
  stats: {
    total: number
    deviceOnly: number
    localOnly: number
    unsynced: number
  }
  deviceConnected: boolean
  loading: boolean
  compactView: boolean
  downloadQueueSize: number
  bulkCounts: {
    deviceOnly: number
    needsTranscription: number
  }
  bulkProcessing: boolean
  bulkProgress: { current: number; total: number }
  onAddRecording: () => void
  onOpenFolder: () => void
  onBulkDownload: () => void
  onBulkProcess: () => void
  onRefresh: () => void
  onSetCompactView: (compact: boolean) => void
}

export function LibraryHeader({
  stats,
  deviceConnected,
  loading,
  compactView,
  downloadQueueSize,
  bulkCounts,
  bulkProcessing,
  bulkProgress,
  onAddRecording,
  onOpenFolder,
  onBulkDownload,
  onBulkProcess,
  onRefresh,
  onSetCompactView
}: LibraryHeaderProps) {
  return (
    <header className="border-b px-6 py-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Knowledge Library</h1>
          <p className="text-sm text-muted-foreground">
            {stats.total} capture{stats.total !== 1 ? 's' : ''}
            {stats.unsynced > 0 && (
              <span className="ml-2 text-orange-600 dark:text-orange-400">
                ({stats.unsynced} on device only)
              </span>
            )}
            {!deviceConnected && stats.deviceOnly === 0 && (
              <span className="ml-2 text-muted-foreground">(device not connected)</span>
            )}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={onAddRecording} title="Import audio file">
            <Plus className="h-4 w-4 mr-2" />
            Add Capture
          </Button>
          <Button variant="outline" size="sm" onClick={onOpenFolder}>
            <FolderOpen className="h-4 w-4 mr-2" />
            Open Folder
          </Button>

          {/* Bulk Download */}
          {bulkCounts.deviceOnly > 0 && (
            <Button
              variant="outline"
              size="sm"
              onClick={onBulkDownload}
              disabled={downloadQueueSize > 0 || !deviceConnected}
              title={`Download ${bulkCounts.deviceOnly} captures from device`}
            >
              {downloadQueueSize > 0 ? (
                <>
                  <RefreshCw className="h-4 w-4 mr-2 animate-spin" />
                  Syncing...
                </>
              ) : (
                <>
                  <Download className="h-4 w-4 mr-2" />
                  Download All ({bulkCounts.deviceOnly})
                </>
              )}
            </Button>
          )}

          {/* Bulk Process */}
          {bulkCounts.needsTranscription > 0 && (
            <Button
              variant="outline"
              size="sm"
              onClick={onBulkProcess}
              disabled={bulkProcessing}
              title={`Queue ${bulkCounts.needsTranscription} captures for transcription`}
            >
              {bulkProcessing ? (
                <>
                  <RefreshCw className="h-4 w-4 mr-2 animate-spin" />
                  {bulkProgress.current}/{bulkProgress.total}
                </>
              ) : (
                <>
                  <Zap className="h-4 w-4 mr-2" />
                  Process All ({bulkCounts.needsTranscription})
                </>
              )}
            </Button>
          )}

          <Button variant="outline" size="sm" onClick={onRefresh} disabled={loading}>
            <RefreshCw className={`h-4 w-4 mr-2 ${loading ? 'animate-spin' : ''}`} />
            Refresh
          </Button>

          {/* View Toggle */}
          <div className="flex items-center border rounded-md overflow-hidden ml-2" data-testid="grid-view-toggle">
            <Button
              variant={compactView ? 'ghost' : 'default'}
              size="sm"
              onClick={() => onSetCompactView(false)}
              className="rounded-none border-0 px-2"
              title="Card view"
            >
              <LayoutGrid className="h-4 w-4" />
            </Button>
            <Button
              variant={compactView ? 'default' : 'ghost'}
              size="sm"
              onClick={() => onSetCompactView(true)}
              className="rounded-none border-0 border-l px-2"
              title="List view"
            >
              <List className="h-4 w-4" />
            </Button>
          </div>
        </div>
      </div>
    </header>
  )
}
