import { useState, useEffect, useCallback } from 'react'
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
  CornerUpRight
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'
import {
  useDownloadQueue,
  useUnifiedRecordings
} from '@/store/useAppStore'
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
import { isRetryableDownloadStatus } from '@/hooks/useDownloadOrchestrator'
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
  // Newest recording first (filenames start with a date stamp, so reverse-sort).
  return b.filename.localeCompare(a.filename)
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

/**
 * The Operations surface does NOT live in the sidebar. The sidebar shows only a
 * single compact status badge — what's happening (count), how far along
 * (progress bar), and an error count — that opens the full queue in an overlay.
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
  const queuePaused = useTranscriptionPaused()
  const pauseQueue = useTranscriptionStore((s) => s.pauseQueue)
  const resumeQueue = useTranscriptionStore((s) => s.resumeQueue)
  const applyQueueState = useTranscriptionStore((s) => s.applyQueueState)
  const toggleQueuePaused = useCallback(() => {
    if (queuePaused) resumeQueue()
    else pauseQueue()
  }, [queuePaused, pauseQueue, resumeQueue])
  const recordings = useUnifiedRecordings()
  const { cancelTranscription } = useOperations()

  const overlayOpen = useOperationsOverlayOpen()
  const openOverlay = useUIStore((s) => s.openOperationsOverlay)
  const closeOverlay = useUIStore((s) => s.closeOperationsOverlay)

  const [failedDownloadCount, setFailedDownloadCount] = useState(0)

  useEffect(() => {
    if (!window.electronAPI?.downloadService) return
    window.electronAPI.downloadService.getState().then((state) => {
      // MEDIUM-4: count interrupted downloads (failed OR disconnect-cancelled) so the
      // badge stays consistent with the reconnect retry, which re-queues both.
      const failedCount = state?.queue?.filter((item: { status: string }) => isRetryableDownloadStatus(item.status)).length ?? 0
      setFailedDownloadCount(failedCount)
    }).catch(() => {})
    const unsub = window.electronAPI.downloadService.onStateUpdate((state: { queue: Array<{ status: string }> }) => {
      setFailedDownloadCount(state.queue.filter((item) => isRetryableDownloadStatus(item.status)).length)
    })
    return unsub
  }, [])

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

  // Client-side navigation to the meeting/recording behind a transcription.
  const goToSource = useCallback((item: TranscriptionItem) => {
    const rec = recordings.find((r) => r.id === item.recordingId)
    if (rec?.meetingId) navigate(`/meeting/${rec.meetingId}`)
    else navigate('/library', { state: { selectedId: item.recordingId } })
    closeOverlay()
  }, [recordings, navigate, closeOverlay])

  const hasDownloads = downloadQueue.size > 0
  const hasFailedDownloads = failedDownloadCount > 0
  const hasTranscriptions =
    transcriptionStats.pending > 0 || transcriptionStats.processing > 0 || transcriptionStats.failed > 0
  if (!hasDownloads && !hasFailedDownloads && !hasTranscriptions) return null

  const activeTranscriptions = transcriptionStats.processing + transcriptionStats.pending
  const errorCount = transcriptionStats.failed + failedDownloadCount
  const pct = transcriptionStats.aggregateProgress
  const orderedTranscriptions = Array.from(transcriptionQueue.values())
    .filter((i) => i.status !== 'completed')
    .sort(compareTranscriptions)

  const overlay = (
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
                {hasDownloads ? downloadQueue.size : failedDownloadCount}
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

  // Expanded sidebar: a single compact badge — activity + progress bar + error count.
  const primaryLabel =
    activeTranscriptions > 0
      ? `${activeTranscriptions} transcribing`
      : hasDownloads
        ? `${downloadQueue.size} downloading`
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
              <div className="h-1 flex-1 overflow-hidden rounded-full bg-slate-700">
                <div className="h-full rounded-full bg-purple-500 transition-all duration-300" style={{ width: `${pct}%` }} />
              </div>
              <span className="text-[9px] tabular-nums text-slate-500">{pct}%</span>
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
              <span className="rounded bg-amber-500/20 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-amber-300">Paused</span>
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
