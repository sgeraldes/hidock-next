import { Plus, FileUp, FolderOpen, Download, Zap, RefreshCw, LayoutGrid, List, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { TranscriptUpgradeButton } from './TranscriptUpgradeButton'

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
  onImportFile: () => void
  onOpenFolder: () => void
  onBulkDownload: () => void
  onBulkProcess: () => void
  onRefresh: () => void
  onSetCompactView: (compact: boolean) => void
  /** spec-005/F17 T5 §D1/§D4 — Trash view-mode toggle + its (eagerly-loaded) count. */
  showTrash: boolean
  trashCount: number
  onToggleTrash: () => void
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
  onImportFile,
  onOpenFolder,
  onBulkDownload,
  onBulkProcess,
  onRefresh,
  onSetCompactView,
  showTrash,
  trashCount,
  onToggleTrash
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
          <Button variant="outline" size="sm" onClick={onImportFile} title="Import a document or image (PDF, MD, TXT, JSON, PNG, JPG, SVG, WEBP)">
            <FileUp className="h-4 w-4 mr-2" />
            Import File
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

          <TranscriptUpgradeButton />

          <Button variant="outline" size="sm" onClick={onRefresh} disabled={loading}>
            <RefreshCw className={`h-4 w-4 mr-2 ${loading ? 'animate-spin' : ''}`} />
            Refresh
          </Button>

          {/* Trash toggle (spec-005/F17 T5 §D1/§D4) — a real button with
              aria-pressed + a visible count, always available so the user can
              exit Trash even though the filters/view-toggle disappear there. */}
          <Button
            type="button"
            variant={showTrash ? 'default' : 'outline'}
            size="sm"
            onClick={onToggleTrash}
            aria-pressed={showTrash}
            title={showTrash ? 'Exit Trash' : 'View Trash'}
          >
            <Trash2 className="h-4 w-4 mr-2" aria-hidden="true" />
            Trash ({trashCount})
          </Button>

          {/* View Toggle — hidden in Trash mode (§D1: Trash always forces the
              SourceRow list; the card↔compact toggle has nothing to switch there). */}
          {!showTrash && (
            <div className="flex items-center border rounded-md overflow-hidden ml-2" role="group" aria-label="View layout" data-testid="grid-view-toggle">
              <Button
                variant={compactView ? 'ghost' : 'default'}
                size="sm"
                onClick={() => onSetCompactView(false)}
                className="rounded-none border-0 px-2"
                title="Card view"
                aria-label="Card view"
                aria-pressed={!compactView}
              >
                <LayoutGrid className="h-4 w-4" aria-hidden="true" />
              </Button>
              <Button
                variant={compactView ? 'default' : 'ghost'}
                size="sm"
                onClick={() => onSetCompactView(true)}
                className="rounded-none border-0 border-l px-2"
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
