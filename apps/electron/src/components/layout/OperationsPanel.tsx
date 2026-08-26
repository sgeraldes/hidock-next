import { useState, useEffect, useCallback, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  X,
  Download,
  Sparkles,
  RefreshCw,
  AlertCircle,
  RotateCcw,
  Maximize2,
  ArrowUp,
  ArrowDown,
  Pause,
  Play,
  CornerUpRight,
  Copy,
  Check,
  ChevronDown,
  Trash2
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'
import { formatBytes } from '@/utils/formatters'
import {
  useDownloadQueue,
  useUnifiedRecordings
} from '@/store/useAppStore'
import type { DownloadQueueEntry } from '@/store/useAppStore'
import {
  useTranscriptionStore,
  useTranscriptionStats,
  useTranscriptionPaused,
  type TranscriptionItem,
  type TranscriptionStatus
} from '@/store/features/useTranscriptionStore'
import {
  useUIStore,
  useOperationsOverlayOpen
} from '@/store/ui/useUIStore'
import { useOperations } from '@/hooks/useOperations'
import { isRetryableDownloadItem } from '@/hooks/useDownloadOrchestrator'
import type { UnifiedRecording } from '@/types/unified-recording'
import { toast } from '@/components/ui/toaster'

interface OperationsPanelProps {
  sidebarOpen: boolean
}

/** Human-readable status for a transcription queue item. */
const STATUS_LABEL: Record<TranscriptionStatus, string> = {
  pending: 'Queued',
  processing: 'Transcribing…',
  completed: 'Done',
  failed: 'Failed'
}

/** Display order: active first, then queued (by priority), then failed. */
function statusRank(s: TranscriptionStatus): number {
  return s === 'processing' ? 0 : s === 'pending' ? 1 : s === 'failed' ? 2 : 3
}

function compareTranscriptions(a: TranscriptionItem, b: TranscriptionItem): number {
  const r = statusRank(a.status) - statusRank(b.status)
  if (r !== 0) return r
  if (a.priority !== b.priority) return b.priority - a.priority
  // Newest recording first (filenames start with a date stamp, so reverse-sort).
  return b.filename.localeCompare(a.filename)
}

/** Strip the recording extension for a cleaner display name (keeps the date stamp). */
function displayName(filename: string): string {
  return filename.replace(/\.(hda|wav|mp3|m4a)$/i, '')
}

const OPERATION_TIME_FORMAT = new Intl.DateTimeFormat(undefined, {
  dateStyle: 'medium',
  timeStyle: 'medium'
})

function formatOperationTime(value?: Date): string | null {
  if (!value || Number.isNaN(value.getTime())) return null
  return OPERATION_TIME_FORMAT.format(value)
}

function attemptLabel(item: TranscriptionItem): string {
  const attempts = item.attempts || 0
  if (attempts === 0) return 'Not attempted yet'
  return `${attempts} attempt${attempts === 1 ? '' : 's'}`
}

/** Human-readable status line for a download row. */
function downloadStatusLabel(dl: DownloadQueueEntry): string {
  switch (dl.status) {
    case 'pending':
      return 'Queued'
    case 'cancelling':
      return 'Cancelling…'
    case 'cancelled':
      return 'Cancelled'
    case 'failed':
      return 'Failed'
    case 'completed':
      return 'Done'
    default:
      return dl.progress > 0 ? `Downloading… ${Math.round(dl.progress)}%` : 'Starting download…'
  }
}

/** A download the user can still cancel (queued or actively transferring). */
function isCancelableDownload(dl: DownloadQueueEntry): boolean {
  return dl.status === 'pending' || dl.status === 'downloading'
}

/** Active-first ordering: downloading, then cancelling, then queued, then cancelled. */
function downloadStatusRank(dl: DownloadQueueEntry): number {
  switch (dl.status) {
    case 'downloading':
      return 0
    case 'cancelling':
      return 1
    case 'pending':
      return 2
    default:
      return 3
  }
}

/** Resolve a net-new, human title for the source behind a transcription item. */
function sourceTitleFor(item: TranscriptionItem, rec?: UnifiedRecording): string | null {
  const title = rec?.title ?? rec?.meetingSubject
  if (title && title.trim() && title !== item.filename) return title
  return null
}

/**
 * The Operations surface does NOT live in the sidebar. The sidebar shows only a
 * single compact status badge — what's happening and the error count — that
 * opens the full queue in an overlay. Transcription providers do not expose a
 * trustworthy percentage, so this surface must not render the store estimate.
 * The whole list is in the overlay, never crammed into the nav column.
 */
export function OperationsPanel({ sidebarOpen }: OperationsPanelProps) {
  const navigate = useNavigate()
  const downloadQueue = useDownloadQueue()
  const transcriptionStats = useTranscriptionStats()
  const transcriptionQueue = useTranscriptionStore((s) => s.queue)
  const prioritize = useTranscriptionStore((s) => s.prioritize)
  const deprioritize = useTranscriptionStore((s) => s.deprioritize)
  const retryItem = useTranscriptionStore((s) => s.retry)
  const dismissItem = useTranscriptionStore((s) => s.dismiss)
  const dismissFailedItems = useTranscriptionStore((s) => s.dismissFailed)
  const queuePaused = useTranscriptionPaused()
  const pauseQueue = useTranscriptionStore((s) => s.pauseQueue)
  const resumeQueue = useTranscriptionStore((s) => s.resumeQueue)
  const applyQueueState = useTranscriptionStore((s) => s.applyQueueState)
  const toggleQueuePaused = useCallback(() => {
    if (queuePaused) resumeQueue()
    else pauseQueue()
  }, [queuePaused, pauseQueue, resumeQueue])
  const recordings = useUnifiedRecordings()
  const { cancelTranscription, cancelDownload, cancelAllDownloads, retryFailedDownloads } = useOperations()

  const overlayOpen = useOperationsOverlayOpen()
  const openOverlay = useUIStore((s) => s.openOperationsOverlay)
  const closeOverlay = useUIStore((s) => s.closeOperationsOverlay)

  // Active downloads live in the renderer Map. Terminal failures are deliberately
  // omitted there so unrelated Download buttons are not disabled; retain a second,
  // read-only projection from the durable main queue for Operations history.
  const [persistedDownloads, setPersistedDownloads] = useState<DownloadQueueEntry[]>([])

  useEffect(() => {
    if (!window.electronAPI?.downloadService) return
    window.electronAPI.downloadService.getState().then((state) => {
      setPersistedDownloads((state?.queue ?? []).map((item) => ({
        filename: item.filename,
        size: item.fileSize,
        progress: item.progress,
        status: item.status,
        error: item.error,
        cancelReason: item.cancelReason
      })))
    }).catch(() => {})
    const unsub = window.electronAPI.downloadService.onStateUpdate((state: { queue: Array<{ filename: string; fileSize: number; progress: number; status: DownloadQueueEntry['status']; error?: string; cancelReason?: 'user' | 'interrupted' }> }) => {
      setPersistedDownloads(state.queue.map((item) => ({
        filename: item.filename,
        size: item.fileSize,
        progress: item.progress,
        status: item.status,
        error: item.error,
        cancelReason: item.cancelReason
      })))
    })
    return unsub
  }, [])

  const downloads = useMemo(() => {
    const merged = new Map(persistedDownloads.map((item) => [item.filename, item]))
    for (const item of downloadQueue.values()) merged.set(item.filename, item)
    return Array.from(merged.values())
      .filter((item) => item.status !== 'completed')
      .sort((a, b) => downloadStatusRank(a) - downloadStatusRank(b))
  }, [downloadQueue, persistedDownloads])

  // Mirror the main-process transcription queue state (paused? which id is live?).
  useEffect(() => {
    const api = window.electronAPI?.recordings
    if (!api) return
    api.getTranscriptionQueueState?.().then((state) => {
      if (state) applyQueueState(state)
    }).catch(() => {})
    const unsub = window.electronAPI.onTranscriptionQueueState?.((state) => applyQueueState(state))
    return unsub
  }, [applyQueueState])

  // "View source" always means the Library source reader. Linking a recording to
  // a meeting must not silently redirect this control to a different surface.
  // A normal push preserves the page the user came from in browser history.
  const goToSource = useCallback((item: TranscriptionItem) => {
    const rec = recordings.find((r) => r.id === item.recordingId)
    if (!rec) {
      toast.warning('Source unavailable', 'This source is no longer in the Library.')
      return
    }
    navigate('/library', { state: { selectedId: rec.id } })
    closeOverlay()
  }, [recordings, navigate, closeOverlay])

  const goToDownloadSource = useCallback((filename: string) => {
    const rec = recordings.find((r) => r.filename === filename || ('deviceFilename' in r && r.deviceFilename === filename))
    if (!rec) {
      toast.warning('Source unavailable', 'This file is no longer available in the Library.')
      return
    }
    navigate('/library', { state: { selectedId: rec.id } })
    closeOverlay()
  }, [recordings, navigate, closeOverlay])

  const clearFinishedDownloads = useCallback(async () => {
    await window.electronAPI.downloadService.clearCompleted()
    toast.success('Finished downloads cleared')
  }, [])

  const dismissDownload = useCallback(async (filename: string) => {
    return window.electronAPI.downloadService.dismiss(filename)
  }, [])

  const activeDownloadCount = downloads.filter((item) => ['pending', 'downloading', 'cancelling'].includes(item.status)).length
  const failedDownloadCount = downloads.filter((item) => isRetryableDownloadItem(item)).length
  const hasDownloads = activeDownloadCount > 0
  const hasFailedDownloads = failedDownloadCount > 0
  const hasTranscriptions =
    transcriptionStats.pending > 0 || transcriptionStats.processing > 0 || transcriptionStats.failed > 0
  if (!hasDownloads && !hasFailedDownloads && !hasTranscriptions) return null

  const activeTranscriptions = transcriptionStats.processing + transcriptionStats.pending
  const errorCount = transcriptionStats.failed + failedDownloadCount
  const orderedTranscriptions = Array.from(transcriptionQueue.values())
    .filter((i) => i.status !== 'completed')
    .sort(compareTranscriptions)

  const overlay = (
    <OperationsOverlay
      open={overlayOpen}
      onClose={closeOverlay}
      items={orderedTranscriptions}
      downloads={downloads}
      recordings={recordings}
      paused={queuePaused}
      onTogglePause={toggleQueuePaused}
      onGoTo={goToSource}
      onPrioritize={prioritize}
      onDeprioritize={deprioritize}
      onCancel={cancelTranscription}
      onRetry={retryItem}
      onDismiss={dismissItem}
      onDismissAllFailed={dismissFailedItems}
      onCancelDownload={cancelDownload}
      onCancelAllDownloads={cancelAllDownloads}
      onGoToDownload={goToDownloadSource}
      onClearFinishedDownloads={clearFinishedDownloads}
      onDismissDownload={dismissDownload}
      onRetryFailedDownloads={retryFailedDownloads}
    />
  )

  // Collapsed sidebar rail: tiny icon + count.
  if (!sidebarOpen) {
    return (
      <>
        <div className="border-t border-slate-700 px-2 py-2">
          <button
            type="button"
            onClick={openOverlay}
            aria-label={`Operations: ${activeTranscriptions} transcribing${errorCount ? `, ${errorCount} error(s)` : ''}`}
            className="relative flex w-full flex-col items-center gap-1 rounded-md py-1 text-slate-300 hover:bg-slate-800"
          >
            {hasTranscriptions && (
              <span className="flex items-center gap-1 text-[10px] text-purple-400">
                <Sparkles className={cn('h-3 w-3', activeTranscriptions > 0 && 'animate-pulse')} />
                {activeTranscriptions}
              </span>
            )}
            {(hasDownloads || hasFailedDownloads) && (
              <span className="flex items-center gap-1 text-[10px]">
                <Download className={cn('h-3 w-3', hasDownloads ? 'text-emerald-400' : 'text-amber-400')} />
                {hasDownloads ? activeDownloadCount : failedDownloadCount}
              </span>
            )}
            {errorCount > 0 && (
              <span className="absolute right-1 top-0 rounded-full bg-red-500 px-1 text-[9px] font-semibold text-white">{errorCount}</span>
            )}
          </button>
        </div>
        {overlay}
      </>
    )
  }

  // Expanded sidebar: activity + honest indeterminate stage + error count.
  const primaryLabel =
    activeTranscriptions > 0
      ? `${activeTranscriptions} transcribing`
      : hasDownloads
        ? `${activeDownloadCount} downloading`
        : errorCount > 0
          ? `${errorCount} failed`
          : 'Operations'

  return (
    <>
      <div className="border-t border-slate-700 px-2 py-2">
        <button
          type="button"
          onClick={openOverlay}
          aria-label="Open operations detail"
          className="w-full rounded-md px-2 py-1.5 text-left hover:bg-slate-800"
        >
          <div className="flex items-center gap-2 text-xs text-slate-300">
            <Sparkles className={cn('h-3.5 w-3.5 shrink-0', activeTranscriptions > 0 ? 'text-purple-400 animate-pulse' : 'text-slate-500')} />
            <span className="truncate">{primaryLabel}</span>
            {queuePaused && (
              <span className="rounded bg-amber-500/20 px-1 text-[9px] font-medium uppercase tracking-wide text-amber-300">Paused</span>
            )}
            <span className="ml-auto flex items-center gap-1.5">
              {errorCount > 0 && (
                <span className="rounded-full bg-red-500/20 px-1.5 text-[10px] font-semibold text-red-300">{errorCount}</span>
              )}
              <Maximize2 className="h-3 w-3 text-slate-500" />
            </span>
          </div>
          {activeTranscriptions > 0 && (
            <div className="mt-1.5 flex items-center gap-2">
              <div className="h-1 flex-1 overflow-hidden rounded-full bg-slate-700" aria-hidden="true">
                <div className="h-full w-1/2 animate-pulse rounded-full bg-purple-500" />
              </div>
              <span className="text-[9px] text-slate-400">Transcribing · progress unavailable</span>
            </div>
          )}
        </button>
      </div>
      {overlay}
    </>
  )
}

// =============================================================================
// Operations overlay — the full detail surface (renderer-only, not an OS window)
// =============================================================================

interface OperationsOverlayProps {
  open: boolean
  onClose: () => void
  items: TranscriptionItem[]
  downloads: DownloadQueueEntry[]
  recordings: UnifiedRecording[]
  paused: boolean
  onTogglePause: () => void
  onGoTo: (item: TranscriptionItem) => void
  onPrioritize: (id: string) => void
  onDeprioritize: (id: string) => void
  onCancel: (recordingId: string) => void
  onRetry: (id: string) => Promise<boolean>
  onDismiss: (id: string) => Promise<boolean>
  onDismissAllFailed: () => Promise<number>
  onCancelDownload: (filename: string) => void
  onCancelAllDownloads: () => void
  onGoToDownload: (filename: string) => void
  onClearFinishedDownloads: () => Promise<void>
  onDismissDownload: (filename: string) => Promise<boolean>
  onRetryFailedDownloads: () => Promise<number>
}

function OperationsOverlay({
  open,
  onClose,
  items,
  downloads,
  recordings,
  paused,
  onTogglePause,
  onGoTo,
  onPrioritize,
  onDeprioritize,
  onCancel,
  onRetry,
  onDismiss,
  onDismissAllFailed,
  onCancelDownload,
  onCancelAllDownloads,
  onGoToDownload,
  onClearFinishedDownloads,
  onDismissDownload,
  onRetryFailedDownloads
}: OperationsOverlayProps) {
  const [copiedErrorId, setCopiedErrorId] = useState<string | null>(null)
  const [busyIds, setBusyIds] = useState<Set<string>>(new Set())

  const withBusy = useCallback(async (id: string, action: () => Promise<boolean>, successMessage: string) => {
    setBusyIds((current) => new Set(current).add(id))
    try {
      const ok = await action()
      if (ok) toast.success(successMessage)
      else toast.error('Operation could not be updated')
    } finally {
      setBusyIds((current) => {
        const next = new Set(current)
        next.delete(id)
        return next
      })
    }
  }, [])

  const copyError = useCallback(async (item: TranscriptionItem) => {
    if (!item.error) return
    try {
      await navigator.clipboard.writeText(item.error)
      setCopiedErrorId(item.id)
      window.setTimeout(() => setCopiedErrorId((current) => current === item.id ? null : current), 1800)
    } catch {
      setCopiedErrorId(null)
    }
  }, [])

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])

  if (!open) return null

  const totalCount = items.length + downloads.length
  const canCancelAllDownloads = downloads.some(isCancelableDownload)
  const failedTranscriptionCount = items.filter((item) => item.status === 'failed').length
  const terminalDownloadCount = downloads.filter((item) => ['failed', 'cancelled', 'completed'].includes(item.status)).length
  const retryableDownloadCount = downloads.filter((item) => {
    if (!isRetryableDownloadItem(item)) return false
    return recordings.some((recording) =>
      recording.filename === item.filename
      || ('deviceFilename' in recording && recording.deviceFilename === item.filename)
    )
  }).length

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-6" role="dialog" aria-modal="true" aria-label="Operations detail">
      <button type="button" aria-label="Close" className="absolute inset-0 bg-black/50" onClick={onClose} />
      <div className="relative z-10 flex max-h-[80vh] w-full max-w-2xl flex-col overflow-hidden rounded-lg border border-slate-700 bg-slate-900 text-slate-100 shadow-2xl">
        <div className="flex items-center justify-between border-b border-slate-700 px-4 py-3">
          <div className="flex items-center gap-2">
            <Sparkles className="h-4 w-4 text-purple-400" />
            <h2 className="text-sm font-semibold">Operations</h2>
            <span className="rounded-full bg-slate-700 px-1.5 text-[10px] text-slate-300">{totalCount}</span>
            {paused && (
              <span className="rounded bg-amber-500/20 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-amber-300">Paused</span>
            )}
          </div>
          <div className="flex items-center gap-1">
            {retryableDownloadCount > 0 && (
              <Button
                variant="ghost"
                size="sm"
                className="h-7 gap-1.5 px-2 text-xs text-slate-300 hover:text-slate-100"
                onClick={() => void onRetryFailedDownloads()}
              >
                <RotateCcw className="h-3.5 w-3.5" />
                Retry downloads
              </Button>
            )}
            {(failedTranscriptionCount > 0 || terminalDownloadCount > 0) && (
              <Button
                variant="ghost"
                size="sm"
                className="h-7 gap-1.5 px-2 text-xs text-slate-300 hover:text-slate-100"
                onClick={() => {
                  void Promise.all([
                    failedTranscriptionCount > 0 ? onDismissAllFailed() : Promise.resolve(0),
                    terminalDownloadCount > 0 ? onClearFinishedDownloads() : Promise.resolve()
                  ]).then(([count]) => {
                    if (count > 0) toast.success(`${count} transcription failure${count === 1 ? '' : 's'} dismissed`)
                  })
                }}
                aria-label="Clear failed operations"
              >
                <Trash2 className="h-3.5 w-3.5" />
                Clear failures
              </Button>
            )}
            {canCancelAllDownloads && (
              <Button
                variant="ghost"
                size="sm"
                className="h-7 gap-1.5 px-2 text-xs text-red-400 hover:text-red-300"
                onClick={onCancelAllDownloads}
                aria-label="Cancel all downloads"
              >
                <X className="h-3.5 w-3.5" />
                Cancel all downloads
              </Button>
            )}
            {items.some((i) => i.status === 'pending' || i.status === 'processing') && (
              <Button
                variant="ghost"
                size="sm"
                className="h-7 gap-1.5 px-2 text-xs text-slate-300 hover:text-slate-100"
                onClick={onTogglePause}
                aria-label={paused ? 'Resume transcription queue' : 'Pause transcription queue'}
              >
                {paused ? <Play className="h-3.5 w-3.5" /> : <Pause className="h-3.5 w-3.5" />}
                {paused ? 'Resume' : 'Pause'}
              </Button>
            )}
            <Button variant="ghost" size="icon" className="h-7 w-7 text-slate-400 hover:text-slate-100" onClick={onClose} aria-label="Close">
              <X className="h-4 w-4" />
            </Button>
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto p-3">
          {totalCount === 0 ? (
            <p className="py-8 text-center text-sm text-slate-500">No active operations.</p>
          ) : (
            <div className="space-y-3">
              {downloads.length > 0 && (
                <section aria-label="Downloads">
                  <h3 className="mb-1 flex items-center gap-1.5 px-2 text-[11px] font-medium uppercase tracking-wide text-slate-500">
                    <Download className="h-3 w-3" />
                    Downloads
                    <span className="rounded-full bg-slate-700 px-1.5 text-[10px] text-slate-300">{downloads.length}</span>
                  </h3>
                  <ul className="space-y-1">
                    {downloads.map((dl) => (
                      <li key={`dl-${dl.filename}`} className="flex items-center gap-3 rounded-md px-2 py-2 hover:bg-slate-800">
                        {dl.status === 'cancelling' ? (
                          <RefreshCw className="h-4 w-4 shrink-0 animate-spin text-amber-400" />
                        ) : dl.status === 'failed' ? (
                          <AlertCircle className="h-4 w-4 shrink-0 text-red-400" />
                        ) : (
                          <Download className={cn('h-4 w-4 shrink-0', dl.status === 'cancelled' ? 'text-slate-500' : 'text-emerald-400')} />
                        )}
                        <div className="min-w-0 flex-1">
                          <div className="truncate text-sm text-slate-100">{displayName(dl.filename)}</div>
                          <div className="truncate text-[11px] text-slate-500">
                            {downloadStatusLabel(dl)}
                            {dl.size > 0 ? ` · ${formatBytes(dl.size)}` : ''}
                            {dl.error ? ` · ${dl.error}` : ''}
                          </div>
                        </div>
                        {(() => {
                          const sourceAvailable = recordings.some((recording) =>
                            recording.filename === dl.filename
                            || ('deviceFilename' in recording && recording.deviceFilename === dl.filename)
                          )
                          return (
                            <div className="flex shrink-0 items-center gap-1">
                              {sourceAvailable ? (
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  className="h-7 gap-1.5 px-2 text-xs text-slate-300 hover:text-sky-300"
                                  onClick={() => onGoToDownload(dl.filename)}
                                >
                                  <CornerUpRight className="h-3.5 w-3.5" />
                                  View source
                                </Button>
                              ) : dl.status === 'failed' ? (
                                <span className="px-2 text-[11px] text-amber-300">Source unavailable</span>
                              ) : null}
                            </div>
                          )
                        })()}
                        {(dl.status === 'failed' || dl.status === 'cancelled') && (
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-7 gap-1.5 px-2 text-xs text-slate-300 hover:text-slate-100"
                            disabled={busyIds.has(`download:${dl.filename}`)}
                            onClick={() => void withBusy(
                              `download:${dl.filename}`,
                              () => onDismissDownload(dl.filename),
                              'Download failure dismissed'
                            )}
                            aria-label={`Dismiss download failure ${displayName(dl.filename)}`}
                          >
                            <X className="h-3.5 w-3.5" />
                            Dismiss
                          </Button>
                        )}
                        {(isCancelableDownload(dl) || dl.status === 'cancelling') && (
                          <IconBtn
                            label={`Cancel download ${displayName(dl.filename)}`}
                            danger
                            disabled={dl.status === 'cancelling'}
                            onClick={() => onCancelDownload(dl.filename)}
                          >
                            <X className="h-4 w-4" />
                          </IconBtn>
                        )}
                      </li>
                    ))}
                  </ul>
                </section>
              )}

              {items.length > 0 && (
                <section aria-label="Transcriptions">
                  <h3 className="mb-1 flex items-center gap-1.5 px-2 text-[11px] font-medium uppercase tracking-wide text-slate-500">
                    <Sparkles className="h-3 w-3" />
                    Transcriptions
                    <span className="rounded-full bg-slate-700 px-1.5 text-[10px] text-slate-300">{items.length}</span>
                  </h3>
                  <ul className="space-y-1">
              {items.map((item) => {
                const rec = recordings.find((r) => r.id === item.recordingId)
                const title = sourceTitleFor(item, rec)
                const isPending = item.status === 'pending'
                const isFailed = item.status === 'failed'
                const startedAt = formatOperationTime(item.startedAt)
                const failedAt = formatOperationTime(item.completedAt)
                const queuedAt = formatOperationTime(item.createdAt)
                const eventTime = isFailed ? failedAt : item.status === 'processing' ? startedAt : queuedAt
                const isBusy = busyIds.has(item.id)
                return (
                  <li
                    key={item.id}
                    className={cn(
                      'rounded-md px-2 py-2 transition-colors hover:bg-slate-800',
                      isFailed && 'bg-red-950/20'
                    )}
                  >
                    <div className="flex items-center gap-3">
                      {item.status === 'processing' && <RefreshCw className="h-4 w-4 shrink-0 animate-spin text-purple-400" />}
                      {isPending && <div className="h-3 w-3 shrink-0 rounded-full bg-yellow-500/70" />}
                      {isFailed && <AlertCircle className="h-4 w-4 shrink-0 text-red-400" />}

                      <div className="min-w-0 flex-1 text-left">
                        <div className="truncate text-sm text-slate-100 hover:text-sky-300">{title ?? displayName(item.filename)}</div>
                        <div className="truncate text-[11px] tabular-nums text-slate-400">
                          {displayName(item.filename)} · {STATUS_LABEL[item.status]} · {attemptLabel(item)}
                          {eventTime ? ` · ${eventTime}` : ''}
                        </div>
                      </div>

                      <div className="flex shrink-0 items-center gap-1">
                        {rec && (
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-7 gap-1.5 px-2 text-xs text-slate-300 hover:text-sky-300"
                            onClick={() => onGoTo(item)}
                          >
                            <CornerUpRight className="h-3.5 w-3.5" />
                            View source
                          </Button>
                        )}
                        {isPending && (
                          <>
                            <IconBtn label="Prioritize" onClick={() => onPrioritize(item.id)}>
                              <ArrowUp className="h-4 w-4" />
                            </IconBtn>
                            <IconBtn label="Deprioritize" onClick={() => onDeprioritize(item.id)}>
                              <ArrowDown className="h-4 w-4" />
                            </IconBtn>
                          </>
                        )}
                        {isFailed ? (
                          <>
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-7 gap-1.5 px-2 text-xs text-slate-200 hover:text-white"
                              disabled={isBusy}
                              onClick={() => void withBusy(
                                item.id,
                                () => onRetry(item.id),
                                paused ? 'Retry queued — transcription queue is paused' : 'Retry queued'
                              )}
                            >
                              <RotateCcw className={cn('h-3.5 w-3.5', isBusy && 'animate-spin')} />
                              {isBusy ? 'Updating…' : 'Retry'}
                            </Button>
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-7 gap-1.5 px-2 text-xs text-slate-400 hover:text-red-300"
                              disabled={isBusy}
                              onClick={() => void withBusy(item.id, () => onDismiss(item.id), 'Failure dismissed')}
                            >
                              <X className="h-3.5 w-3.5" />
                              Dismiss
                            </Button>
                          </>
                        ) : (
                          <IconBtn label="Cancel" danger onClick={() => onCancel(item.recordingId)}>
                            <X className="h-4 w-4" />
                          </IconBtn>
                        )}
                      </div>
                    </div>

                    {isFailed && (
                      <details className="group mt-2 ms-7 rounded-md bg-slate-950/70">
                        <summary className="flex cursor-pointer list-none items-center gap-2 rounded-md px-3 py-2 text-xs font-medium text-red-200 outline-none hover:bg-slate-800/80 focus-visible:ring-1 focus-visible:ring-red-400 [&::-webkit-details-marker]:hidden">
                          <ChevronDown className="h-3.5 w-3.5 shrink-0 transition-transform group-open:rotate-180" />
                          <span>Failure details</span>
                          {failedAt && <span className="ms-auto tabular-nums font-normal text-slate-400">{failedAt}</span>}
                        </summary>
                        <div className="space-y-3 px-3 pb-3">
                          <dl className="grid grid-cols-1 gap-1 text-[11px] text-slate-400 sm:grid-cols-2">
                            <div><dt className="inline text-slate-500">Attempts: </dt><dd className="inline text-slate-200">{item.attempts}</dd></div>
                            <div><dt className="inline text-slate-500">Retries: </dt><dd className="inline text-slate-200">{item.retryCount}</dd></div>
                            <div><dt className="inline text-slate-500">First queued: </dt><dd className="inline tabular-nums text-slate-200">{queuedAt ?? 'Unknown'}</dd></div>
                            <div><dt className="inline text-slate-500">Last started: </dt><dd className="inline tabular-nums text-slate-200">{startedAt ?? 'Unknown'}</dd></div>
                          </dl>
                          <div className="rounded-md bg-red-950/30 px-3 py-2">
                            <pre className="select-text whitespace-pre-wrap break-words font-sans text-xs leading-5 text-red-100">{item.error || 'No error details were recorded.'}</pre>
                          </div>
                          {item.error && (
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-7 gap-1.5 px-2 text-xs text-slate-300 hover:text-white"
                              onClick={() => void copyError(item)}
                              aria-label={`Copy error for ${displayName(item.filename)}`}
                            >
                              {copiedErrorId === item.id ? <Check className="h-3.5 w-3.5 text-emerald-400" /> : <Copy className="h-3.5 w-3.5" />}
                              {copiedErrorId === item.id ? 'Copied' : 'Copy error'}
                            </Button>
                          )}
                        </div>
                      </details>
                    )}
                  </li>
                )
              })}
                  </ul>
                </section>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

function IconBtn({
  label,
  onClick,
  danger,
  disabled,
  children
}: {
  label: string
  onClick: () => void
  danger?: boolean
  disabled?: boolean
  children: React.ReactNode
}) {
  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            className={cn('h-6 w-6 text-slate-400', danger ? 'hover:text-red-400' : 'hover:text-slate-100')}
            onClick={onClick}
            disabled={disabled}
            aria-label={label}
          >
            {children}
          </Button>
        </TooltipTrigger>
        <TooltipContent>{label}</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  )
}
