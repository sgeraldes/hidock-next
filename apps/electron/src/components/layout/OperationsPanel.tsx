import { useState, useEffect, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  X,
  Download,
  Sparkles,
  RefreshCw,
  AlertCircle,
  RotateCcw,
  ChevronDown,
  ChevronUp,
  Maximize2,
  ArrowUp,
  ArrowDown,
  Pause,
  Play,
  CornerUpRight
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'
import {
  useDownloadQueue,
  useDeviceSyncProgress,
  useDeviceSyncEta,
  useUnifiedRecordings
} from '@/store/useAppStore'
import { getHiDockDeviceService } from '@/services/hidock-device'
import {
  useTranscriptionStore,
  useTranscriptionStats,
  useTranscriptionPaused,
  type TranscriptionItem,
  type TranscriptionStatus
} from '@/store/features/useTranscriptionStore'
import {
  useUIStore,
  useOperationsDockCollapsed,
  useOperationsOverlayOpen
} from '@/store/ui/useUIStore'
import { useOperations } from '@/hooks/useOperations'
import { toast } from '@/components/ui/toaster'
import { formatEta } from '@/utils/formatters'
import type { UnifiedRecording } from '@/types/unified-recording'

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
  return a.filename.localeCompare(b.filename)
}

/** Strip the recording extension for a cleaner display name (keeps the date stamp). */
function displayName(filename: string): string {
  return filename.replace(/\.(hda|wav|mp3|m4a)$/i, '')
}

/** Resolve a net-new, human title for the source behind a transcription item. */
function sourceTitleFor(item: TranscriptionItem, rec?: UnifiedRecording): string | null {
  const title = rec?.title ?? rec?.meetingSubject
  if (title && title.trim() && title !== item.filename) return title
  return null
}

export function OperationsPanel({ sidebarOpen }: OperationsPanelProps) {
  const navigate = useNavigate()
  // SM-06 fix: Use granular selector exports
  const downloadQueue = useDownloadQueue()
  const deviceSyncProgress = useDeviceSyncProgress()
  const deviceSyncEta = useDeviceSyncEta()
  const transcriptionStats = useTranscriptionStats()
  const transcriptionQueue = useTranscriptionStore((s) => s.queue)
  const prioritize = useTranscriptionStore((s) => s.prioritize)
  const deprioritize = useTranscriptionStore((s) => s.deprioritize)
  const retryItem = useTranscriptionStore((s) => s.retry)
  const queuePaused = useTranscriptionPaused()
  const pauseQueue = useTranscriptionStore((s) => s.pauseQueue)
  const resumeQueue = useTranscriptionStore((s) => s.resumeQueue)
  const applyQueueState = useTranscriptionStore((s) => s.applyQueueState)
  const toggleQueuePaused = useCallback(() => {
    if (queuePaused) resumeQueue()
    else pauseQueue()
  }, [queuePaused, pauseQueue, resumeQueue])
  const recordings = useUnifiedRecordings()
  const { cancelAllDownloads, cancelAllTranscriptions, cancelTranscription } = useOperations()

  // Dock chrome (collapse to a compact chip / expand to a larger overlay), persisted.
  const dockCollapsed = useOperationsDockCollapsed()
  const overlayOpen = useOperationsOverlayOpen()
  const toggleDock = useUIStore((s) => s.toggleOperationsDock)
  const openOverlay = useUIStore((s) => s.openOperationsOverlay)
  const closeOverlay = useUIStore((s) => s.closeOperationsOverlay)

  // DL-15: Track failed download count for retry button
  const [failedDownloadCount, setFailedDownloadCount] = useState(0)

  useEffect(() => {
    if (!window.electronAPI?.downloadService) return

    window.electronAPI.downloadService.getState().then((state) => {
      const failedCount = state?.queue?.filter((item: { status: string }) => item.status === 'failed').length ?? 0
      setFailedDownloadCount(failedCount)
    }).catch(() => {})

    const unsub = window.electronAPI.downloadService.onStateUpdate((state: { queue: Array<{ status: string }> }) => {
      const failedCount = state.queue.filter((item) => item.status === 'failed').length
      setFailedDownloadCount(failedCount)
    })
    return unsub
  }, [])

  // Mirror the main-process transcription queue state (paused? which id is live?):
  // pull once on mount, then reflect every push. Main owns the truth.
  useEffect(() => {
    const api = window.electronAPI?.recordings
    if (!api) return
    api.getTranscriptionQueueState?.().then((state) => {
      if (state) applyQueueState(state)
    }).catch(() => {})
    const unsub = window.electronAPI.onTranscriptionQueueState?.((state) => applyQueueState(state))
    return unsub
  }, [applyQueueState])

  const handleRetryFailed = useCallback(async () => {
    try {
      const deviceConnected = getHiDockDeviceService().isConnected()
      const result = await window.electronAPI.downloadService.retryFailed(deviceConnected)
      if (result.error) {
        toast({ title: 'Cannot retry downloads', description: result.error, variant: 'error' })
      } else if (result.count > 0) {
        toast({
          title: 'Retrying downloads',
          description: `Re-queued ${result.count} failed download${result.count !== 1 ? 's' : ''}`,
          variant: 'default'
        })
      }
    } catch (e) {
      console.error('[OperationsPanel] Failed to retry downloads:', e)
    }
  }, [])

  // B6: client-side navigation to the meeting/recording behind a transcription.
  const goToSource = useCallback((item: TranscriptionItem) => {
    const rec = recordings.find((r) => r.id === item.recordingId)
    if (rec?.meetingId) {
      navigate(`/meeting/${rec.meetingId}`)
    } else {
      navigate('/library', { state: { selectedId: item.recordingId } })
    }
    closeOverlay()
  }, [recordings, navigate, closeOverlay])

  const hasDownloads = downloadQueue.size > 0
  const hasFailedDownloads = failedDownloadCount > 0
  const hasTranscriptions =
    transcriptionStats.pending > 0 || transcriptionStats.processing > 0 || transcriptionStats.failed > 0
  const hasAnyOperations = hasDownloads || hasFailedDownloads || hasTranscriptions

  if (!hasAnyOperations) return null

  const activeTranscriptions = transcriptionStats.processing + transcriptionStats.pending
  const orderedTranscriptions = Array.from(transcriptionQueue.values())
    .filter((i) => i.status !== 'completed')
    .sort(compareTranscriptions)

  // ── Collapsed sidebar rail: tiny numeric summary that opens the overlay ──────
  if (!sidebarOpen) {
    return (
      <>
        <div className="border-t border-slate-700 px-2 py-2">
          <button
            type="button"
            onClick={openOverlay}
            aria-label="Open operations detail"
            className="flex w-full flex-col items-center gap-1 rounded-md py-1 text-slate-300 hover:bg-slate-800"
          >
            {(hasDownloads || hasFailedDownloads) && (
              <span className="flex items-center gap-1 text-[10px]">
                <Download className={cn('h-3 w-3', hasDownloads ? 'text-emerald-400' : 'text-amber-400')} />
                {hasDownloads ? downloadQueue.size : failedDownloadCount}
              </span>
            )}
            {hasTranscriptions && (
              <span className="flex items-center gap-1 text-[10px] text-purple-400">
                <Sparkles className="h-3 w-3" />
                {activeTranscriptions}
              </span>
            )}
          </button>
        </div>
        <OperationsOverlay
          open={overlayOpen}
          onClose={closeOverlay}
          items={orderedTranscriptions}
          recordings={recordings}
          paused={queuePaused}
          onTogglePause={toggleQueuePaused}
          onGoTo={goToSource}
          onPrioritize={prioritize}
          onDeprioritize={deprioritize}
          onCancel={cancelTranscription}
          onRetry={retryItem}
        />
      </>
    )
  }

  // ── Collapsed dock (expanded sidebar): a compact summary chip ────────────────
  if (dockCollapsed) {
    return (
      <>
        <div className="border-t border-slate-700 px-2 py-1.5">
          <button
            type="button"
            onClick={toggleDock}
            aria-label="Expand operations dock"
            className="flex w-full items-center gap-2 rounded-md px-1.5 py-1 text-xs text-slate-300 hover:bg-slate-800"
          >
            {(hasDownloads || hasFailedDownloads) && (
              <span className="flex items-center gap-1">
                <Download className={cn('h-3 w-3', hasDownloads ? 'text-emerald-400' : 'text-amber-400')} />
                {hasDownloads ? downloadQueue.size : failedDownloadCount}
              </span>
            )}
            {hasTranscriptions && (
              <span className="flex items-center gap-1 text-purple-400">
                <Sparkles className="h-3 w-3" />
                {activeTranscriptions}
              </span>
            )}
            <span className="ml-auto text-slate-500">Operations</span>
            <ChevronUp className="h-3 w-3 text-slate-500" />
          </button>
        </div>
        <OperationsOverlay
          open={overlayOpen}
          onClose={closeOverlay}
          items={orderedTranscriptions}
          recordings={recordings}
          paused={queuePaused}
          onTogglePause={toggleQueuePaused}
          onGoTo={goToSource}
          onPrioritize={prioritize}
          onDeprioritize={deprioritize}
          onCancel={cancelTranscription}
          onRetry={retryItem}
        />
      </>
    )
  }

  // ── Full dock ────────────────────────────────────────────────────────────────
  return (
    <>
      <div className="border-t border-slate-700 px-2 py-2 space-y-2">
        {/* Dock header: title + expand-to-overlay + collapse */}
        <div className="flex items-center justify-between px-1">
          <span className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">Operations</span>
          <div className="flex items-center gap-0.5">
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-5 w-5 text-slate-400 hover:text-slate-100"
                    onClick={openOverlay}
                    aria-label="Open operations detail"
                  >
                    <Maximize2 className="h-3 w-3" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>Expand to detail view</TooltipContent>
              </Tooltip>
            </TooltipProvider>
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-5 w-5 text-slate-400 hover:text-slate-100"
                    onClick={toggleDock}
                    aria-label="Collapse operations dock"
                  >
                    <ChevronDown className="h-3 w-3" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>Collapse dock</TooltipContent>
              </Tooltip>
            </TooltipProvider>
          </div>
        </div>

        {/* Downloads Section */}
        {(hasDownloads || hasFailedDownloads) && (
          <div className="space-y-1">
            <div className="flex items-center justify-between px-1">
              <div className="flex items-center gap-1.5 text-xs text-slate-300">
                <Download className={`h-3 w-3 ${hasDownloads ? 'text-emerald-400 animate-pulse' : 'text-amber-400'}`} />
                <span>
                  Downloads{' '}
                  {deviceSyncProgress
                    ? `(${deviceSyncProgress.current}/${deviceSyncProgress.total})`
                    : hasDownloads
                      ? `(${downloadQueue.size})`
                      : `(${failedDownloadCount} failed)`}
                </span>
              </div>
              {hasDownloads && (
                <TooltipProvider>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-5 w-5 text-slate-400 hover:text-red-400"
                        onClick={cancelAllDownloads}
                        aria-label="Cancel all downloads"
                      >
                        <X className="h-3 w-3" />
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent>Cancel all downloads</TooltipContent>
                  </Tooltip>
                </TooltipProvider>
              )}
            </div>

            <div className="space-y-1.5 px-1">
              {deviceSyncProgress && deviceSyncProgress.total > 0 && (
                <div>
                  {(() => {
                    const rawPct = (deviceSyncProgress.current / deviceSyncProgress.total) * 100
                    const pct = Number.isFinite(rawPct) ? Math.round(rawPct) : 0
                    return (
                      <>
                        <div className="flex justify-between text-[10px] text-slate-400 mb-0.5">
                          <span>Overall</span>
                          <span>{pct}%</span>
                        </div>
                        <div className="h-1.5 bg-slate-700 rounded-full overflow-hidden">
                          <div className="h-full bg-emerald-500 transition-all duration-200" style={{ width: `${pct}%` }} />
                        </div>
                      </>
                    )
                  })()}
                  {deviceSyncEta != null && deviceSyncEta > 0 && (
                    <div className="text-[10px] text-slate-500 mt-0.5">~{formatEta(deviceSyncEta)}</div>
                  )}
                </div>
              )}
              {Array.from(downloadQueue.entries()).slice(0, 2).map(([id, item]) => (
                <div key={id} className="space-y-0.5">
                  <div className="flex justify-between text-[10px]">
                    <span className="text-slate-400 truncate max-w-[140px]" title={item.filename}>
                      {(() => {
                        const name = displayName(item.filename)
                        return name.length > 24 ? `${name.slice(0, 24)}...` : name
                      })()}
                    </span>
                    <span className="text-slate-500">{Number.isFinite(item.progress) ? item.progress : 0}%</span>
                  </div>
                  <div className="h-1 bg-slate-700 rounded-full overflow-hidden">
                    <div
                      className="h-full bg-blue-500 transition-all duration-200"
                      style={{ width: `${Number.isFinite(item.progress) ? item.progress : 0}%` }}
                    />
                  </div>
                </div>
              ))}
              {downloadQueue.size > 2 && (
                <div className="text-[10px] text-slate-500">+{downloadQueue.size - 2} more in queue</div>
              )}
              {failedDownloadCount > 0 && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="w-full h-6 text-[10px] text-amber-400 hover:text-amber-300"
                  onClick={handleRetryFailed}
                >
                  <RotateCcw className="h-2.5 w-2.5 mr-1" />
                  Retry {failedDownloadCount} Failed
                </Button>
              )}
            </div>
          </div>
        )}

        {/* Transcriptions Section */}
        {hasTranscriptions && (
          <div className="space-y-1">
            <div className="flex items-center justify-between px-1">
              <div className="flex items-center gap-1.5 text-xs text-slate-300">
                <Sparkles className="h-3 w-3 text-purple-400 animate-pulse" />
                <span>
                  Transcriptions ({activeTranscriptions}
                  {transcriptionStats.failed > 0 && `, ${transcriptionStats.failed} failed`})
                </span>
                {queuePaused && (
                  <span className="rounded bg-amber-500/20 px-1 text-[9px] font-medium uppercase tracking-wide text-amber-300">
                    Paused
                  </span>
                )}
              </div>
              {activeTranscriptions > 0 && (
                <div className="flex items-center gap-0.5">
                  <TooltipProvider>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-5 w-5 text-slate-400 hover:text-slate-100"
                          onClick={toggleQueuePaused}
                          aria-label={queuePaused ? 'Resume transcription queue' : 'Pause transcription queue'}
                        >
                          {queuePaused ? <Play className="h-3 w-3" /> : <Pause className="h-3 w-3" />}
                        </Button>
                      </TooltipTrigger>
                      <TooltipContent>
                        {queuePaused ? 'Resume queue' : 'Pause queue (current item finishes)'}
                      </TooltipContent>
                    </Tooltip>
                  </TooltipProvider>
                  <TooltipProvider>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-5 w-5 text-slate-400 hover:text-red-400"
                          onClick={cancelAllTranscriptions}
                          aria-label="Cancel all transcriptions"
                        >
                          <X className="h-3 w-3" />
                        </Button>
                      </TooltipTrigger>
                      <TooltipContent>Cancel all transcriptions</TooltipContent>
                    </Tooltip>
                  </TooltipProvider>
                </div>
              )}
            </div>

            {activeTranscriptions > 0 && (
              <div className="px-1">
                <div className="w-full h-1.5 bg-slate-700 rounded-full overflow-hidden">
                  <div
                    className="h-full bg-purple-500 rounded-full transition-all duration-300"
                    style={{ width: `${transcriptionStats.aggregateProgress}%` }}
                  />
                </div>
                <div className="text-[9px] text-slate-500 mt-0.5 text-right">
                  {transcriptionStats.aggregateProgress}% overall
                </div>
              </div>
            )}

            <div className="space-y-0.5 px-1">
              {orderedTranscriptions.slice(0, 4).map((item) => (
                <TranscriptionRow
                  key={item.id}
                  item={item}
                  sourceTitle={sourceTitleFor(item, recordings.find((r) => r.id === item.recordingId))}
                  onGoTo={goToSource}
                  onPrioritize={prioritize}
                  onDeprioritize={deprioritize}
                  onCancel={cancelTranscription}
                  onRetry={retryItem}
                />
              ))}
              {orderedTranscriptions.length > 4 && (
                <button
                  type="button"
                  onClick={openOverlay}
                  className="w-full text-left text-[10px] text-slate-500 hover:text-slate-300"
                >
                  +{orderedTranscriptions.length - 4} more — view all
                </button>
              )}
            </div>
          </div>
        )}
      </div>

      <OperationsOverlay
        open={overlayOpen}
        onClose={closeOverlay}
        items={orderedTranscriptions}
        recordings={recordings}
        paused={queuePaused}
        onTogglePause={toggleQueuePaused}
        onGoTo={goToSource}
        onPrioritize={prioritize}
        onDeprioritize={deprioritize}
        onCancel={cancelTranscription}
        onRetry={retryItem}
      />
    </>
  )
}

// =============================================================================
// Transcription row — observable + clickable (compact, sidebar)
// =============================================================================

interface TranscriptionRowProps {
  item: TranscriptionItem
  sourceTitle: string | null
  onGoTo: (item: TranscriptionItem) => void
  onPrioritize: (id: string) => void
  onDeprioritize: (id: string) => void
  onCancel: (recordingId: string) => void
  onRetry: (id: string) => void
}

function TranscriptionRow({
  item,
  sourceTitle,
  onGoTo,
  onPrioritize,
  onDeprioritize,
  onCancel,
  onRetry
}: TranscriptionRowProps) {
  const name = displayName(item.filename)
  const hoverTitle = `${sourceTitle ? `${sourceTitle} — ` : ''}${STATUS_LABEL[item.status]}`
  const isPending = item.status === 'pending'
  const isProcessing = item.status === 'processing'
  const isFailed = item.status === 'failed'

  return (
    <div className="group flex items-center gap-1 text-[10px]" title={hoverTitle}>
      {isProcessing && <RefreshCw className="h-2.5 w-2.5 text-purple-400 animate-spin shrink-0" />}
      {isPending && <div className="h-2.5 w-2.5 rounded-full bg-yellow-500/60 shrink-0" />}
      {isFailed && <AlertCircle className="h-2.5 w-2.5 text-red-400 shrink-0" />}

      {/* WHAT it is: filename + (net-new) source title on the second line-worth of info */}
      <button
        type="button"
        onClick={() => onGoTo(item)}
        className="min-w-0 flex-1 truncate text-left text-slate-400 hover:text-sky-300"
        aria-label={`Go to ${sourceTitle ?? name}`}
      >
        {name.length > 18 ? `${name.slice(0, 15)}...` : name}
      </button>

      {/* Actions — appear on hover to keep the row calm */}
      <div className="flex shrink-0 items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100">
        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type="button"
                onClick={() => onGoTo(item)}
                className="text-slate-500 hover:text-sky-300"
                aria-label="Go to source"
              >
                <CornerUpRight className="h-2.5 w-2.5" />
              </button>
            </TooltipTrigger>
            <TooltipContent>Go to {sourceTitle ?? 'recording'}</TooltipContent>
          </Tooltip>
        </TooltipProvider>

        {isPending && (
          <>
            <button
              type="button"
              onClick={() => onPrioritize(item.id)}
              className="text-slate-500 hover:text-emerald-300"
              aria-label="Prioritize"
            >
              <ArrowUp className="h-2.5 w-2.5" />
            </button>
            <button
              type="button"
              onClick={() => onDeprioritize(item.id)}
              className="text-slate-500 hover:text-amber-300"
              aria-label="Deprioritize"
            >
              <ArrowDown className="h-2.5 w-2.5" />
            </button>
          </>
        )}

        {isFailed ? (
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  onClick={() => onRetry(item.id)}
                  className="text-slate-500 hover:text-slate-300"
                  aria-label="Retry"
                >
                  <RotateCcw className="h-2.5 w-2.5" />
                </button>
              </TooltipTrigger>
              <TooltipContent>
                <p>Retry</p>
                {item.error && <p className="text-xs text-muted-foreground">{item.error}</p>}
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
        ) : (
          <button
            type="button"
            onClick={() => onCancel(item.recordingId)}
            className="text-slate-500 hover:text-red-400"
            aria-label="Cancel"
          >
            <X className="h-2.5 w-2.5" />
          </button>
        )}
      </div>
    </div>
  )
}

// =============================================================================
// Operations overlay — larger in-app detail surface (renderer-only, not an OS window)
// =============================================================================

interface OperationsOverlayProps {
  open: boolean
  onClose: () => void
  items: TranscriptionItem[]
  recordings: UnifiedRecording[]
  paused: boolean
  onTogglePause: () => void
  onGoTo: (item: TranscriptionItem) => void
  onPrioritize: (id: string) => void
  onDeprioritize: (id: string) => void
  onCancel: (recordingId: string) => void
  onRetry: (id: string) => void
}

function OperationsOverlay({
  open,
  onClose,
  items,
  recordings,
  paused,
  onTogglePause,
  onGoTo,
  onPrioritize,
  onDeprioritize,
  onCancel,
  onRetry
}: OperationsOverlayProps) {
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])

  if (!open) return null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-6" role="dialog" aria-modal="true" aria-label="Operations detail">
      <button type="button" aria-label="Close" className="absolute inset-0 bg-black/50" onClick={onClose} />
      <div className="relative z-10 flex max-h-[80vh] w-full max-w-2xl flex-col overflow-hidden rounded-lg border border-slate-700 bg-slate-900 text-slate-100 shadow-2xl">
        <div className="flex items-center justify-between border-b border-slate-700 px-4 py-3">
          <div className="flex items-center gap-2">
            <Sparkles className="h-4 w-4 text-purple-400" />
            <h2 className="text-sm font-semibold">Transcription queue</h2>
            <span className="rounded-full bg-slate-700 px-1.5 text-[10px] text-slate-300">{items.length}</span>
            {paused && (
              <span className="rounded bg-amber-500/20 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-amber-300">
                Paused
              </span>
            )}
          </div>
          <div className="flex items-center gap-1">
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
          {items.length === 0 ? (
            <p className="py-8 text-center text-sm text-slate-500">No active transcriptions.</p>
          ) : (
            <ul className="space-y-1">
              {items.map((item) => {
                const rec = recordings.find((r) => r.id === item.recordingId)
                const title = sourceTitleFor(item, rec)
                const isPending = item.status === 'pending'
                const isFailed = item.status === 'failed'
                return (
                  <li key={item.id} className="flex items-center gap-3 rounded-md px-2 py-2 hover:bg-slate-800">
                    {item.status === 'processing' && <RefreshCw className="h-4 w-4 shrink-0 animate-spin text-purple-400" />}
                    {isPending && <div className="h-3 w-3 shrink-0 rounded-full bg-yellow-500/70" />}
                    {isFailed && <AlertCircle className="h-4 w-4 shrink-0 text-red-400" />}

                    <button
                      type="button"
                      onClick={() => onGoTo(item)}
                      className="min-w-0 flex-1 text-left"
                      aria-label={`Go to ${title ?? item.filename}`}
                    >
                      <div className="truncate text-sm text-slate-100 hover:text-sky-300">{title ?? displayName(item.filename)}</div>
                      <div className="truncate text-[11px] text-slate-500">
                        {displayName(item.filename)} · {STATUS_LABEL[item.status]}
                        {item.error ? ` · ${item.error}` : ''}
                      </div>
                    </button>

                    <div className="flex shrink-0 items-center gap-1">
                      <IconBtn label="Go to source" onClick={() => onGoTo(item)}>
                        <CornerUpRight className="h-4 w-4" />
                      </IconBtn>
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
                        <IconBtn label="Retry" onClick={() => onRetry(item.id)}>
                          <RotateCcw className="h-4 w-4" />
                        </IconBtn>
                      ) : (
                        <IconBtn label="Cancel" danger onClick={() => onCancel(item.recordingId)}>
                          <X className="h-4 w-4" />
                        </IconBtn>
                      )}
                    </div>
                  </li>
                )
              })}
            </ul>
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
  children
}: {
  label: string
  onClick: () => void
  danger?: boolean
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
