import { useCallback, useEffect, useRef, useState } from 'react'
import { Loader2, Pause, Play, Scissors, Sparkles } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Slider } from '@/components/ui/slider'
import { ConfirmDialog } from '@/components/ConfirmDialog'
import { toast } from '@/components/ui/toaster'
import { cn } from '@/lib/utils'

interface SplitSuggestion {
  timeSec: number
  confidence: number
  reason: 'silence' | 'transcript-gap' | 'silence-and-transcript-gap'
  gapSeconds: number
}

interface RecordingSplitEditorProps {
  recordingId: string
  filePath: string
  durationSec: number
  pointSec: number
  isPlaying: boolean
  onPointChange: (timeSec: number) => void
  onCancel: () => void
  onSplitCompleted: (firstChildId: string) => void
}

function formatPreciseTime(seconds: number): string {
  const bounded = Math.max(0, seconds)
  const totalTenths = Math.round(bounded * 10)
  const whole = Math.floor(totalTenths / 10)
  const hours = Math.floor(whole / 3600)
  const minutes = Math.floor((whole % 3600) / 60)
  const secs = whole % 60
  const tenths = totalTenths % 10
  return hours > 0
    ? `${hours}:${String(minutes).padStart(2, '0')}:${String(secs).padStart(2, '0')}.${tenths}`
    : `${minutes}:${String(secs).padStart(2, '0')}.${tenths}`
}

function suggestionLabel(suggestion: SplitSuggestion): string {
  const signal = suggestion.reason === 'silence-and-transcript-gap'
    ? 'silence + transcript gap'
    : suggestion.reason === 'transcript-gap'
      ? 'transcript gap'
      : 'silence'
  return `${formatPreciseTime(suggestion.timeSec)} · ${suggestion.gapSeconds.toFixed(1)}s ${signal}`
}

function detectionFailureCopy(error: string): string {
  const normalized = error.toLowerCase()
  if (normalized.includes('local audio file is unavailable')) return 'the local audio file is unavailable'
  if (normalized.includes('determine the audio duration')) return 'the audio duration could not be read'
  return 'the audio analysis could not finish'
}

export function RecordingSplitEditor({
  recordingId,
  filePath,
  durationSec,
  pointSec,
  isPlaying,
  onPointChange,
  onCancel,
  onSplitCompleted,
}: RecordingSplitEditorProps) {
  const [suggestions, setSuggestions] = useState<SplitSuggestion[]>([])
  const [detecting, setDetecting] = useState(true)
  const [detectError, setDetectError] = useState<string | null>(null)
  const [previewActive, setPreviewActive] = useState(false)
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [splitting, setSplitting] = useState(false)
  const wasPlayingRef = useRef(isPlaying)

  const min = 1
  const max = Math.max(min, durationSec - 1)
  const selected = Math.min(max, Math.max(min, pointSec))

  useEffect(() => {
    let cancelled = false
    setDetecting(true)
    setDetectError(null)
    window.electronAPI.recordings.detectSplitPoints(recordingId)
      .then((result) => {
        if (cancelled) return
        if (!result.success) {
          setDetectError(result.error || 'Automatic suggestions are unavailable')
          return
        }
        setSuggestions(result.suggestions ?? [])
      })
      .catch((error) => {
        if (!cancelled) setDetectError(error instanceof Error ? error.message : 'Automatic suggestions are unavailable')
      })
      .finally(() => {
        if (!cancelled) setDetecting(false)
      })
    return () => { cancelled = true }
  }, [recordingId])

  // If a preview reaches the end or is paused elsewhere, return to the cut point
  // instead of leaving the playhead at an unrelated position.
  useEffect(() => {
    if (previewActive && wasPlayingRef.current && !isPlaying) {
      window.__audioControls?.seek(selected)
      setPreviewActive(false)
    }
    wasPlayingRef.current = isPlaying
  }, [isPlaying, previewActive, selected])

  useEffect(() => () => {
    if (previewActive) window.__audioControls?.pause()
  }, [previewActive])

  const changePoint = useCallback((next: number) => {
    const bounded = Math.min(max, Math.max(min, Math.round(next * 10) / 10))
    if (previewActive || isPlaying) window.__audioControls?.pause()
    setPreviewActive(false)
    onPointChange(bounded)
    window.__audioControls?.seek(bounded)
  }, [isPlaying, max, onPointChange, previewActive])

  const togglePreview = useCallback(async () => {
    if (previewActive && isPlaying) {
      window.__audioControls?.pause()
      window.__audioControls?.seek(selected)
      setPreviewActive(false)
      return
    }
    const play = window.__audioControls?.play
    if (!play) {
      toast.error('Preview unavailable', 'The audio player is not ready yet.')
      return
    }
    setPreviewActive(true)
    try {
      await play(recordingId, filePath, selected)
    } catch (error) {
      setPreviewActive(false)
      toast.error('Preview unavailable', error instanceof Error ? error.message : undefined)
    }
  }, [filePath, isPlaying, previewActive, recordingId, selected])

  const createSplit = useCallback(async () => {
    setSplitting(true)
    window.__audioControls?.pause()
    try {
      const response = await window.electronAPI.recordings.split(recordingId, selected)
      if (!response.success || !response.result) throw new Error(response.error || 'The recording could not be split')
      toast.success('Recording split', 'Two lossless recordings were created. The original is recoverable from Trash.')
      onSplitCompleted(response.result.children[0].id)
    } catch (error) {
      toast.error('Split failed', error instanceof Error ? error.message : 'The original recording was not changed.')
    } finally {
      setSplitting(false)
      setConfirmOpen(false)
    }
  }, [onSplitCompleted, recordingId, selected])

  return (
    <section
      className="mt-2 rounded-lg border border-primary/35 bg-primary/[0.04] p-3 shadow-sm"
      aria-label="Split recording editor"
      data-testid="recording-split-editor"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 items-start gap-2.5">
          <span className="mt-0.5 inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-primary text-primary-foreground shadow-sm">
            <Scissors className="h-4 w-4" aria-hidden="true" />
          </span>
          <div>
            <h3 className="text-sm font-semibold">Choose the exact session boundary</h3>
            <p className="mt-0.5 text-xs text-muted-foreground">
              Click the waveform or any transcript timestamp, then drag or use the arrow keys for 0.1-second precision.
            </p>
          </div>
        </div>
        <Button variant="ghost" size="sm" onClick={onCancel} disabled={splitting}>Cancel</Button>
      </div>

      <div className="mt-4 grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-end gap-3">
        <div>
          <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">First recording</p>
          <p className="mt-0.5 text-sm font-semibold tabular-nums">{formatPreciseTime(selected)}</p>
        </div>
        <div className="text-center">
          <p className="text-[11px] font-medium text-muted-foreground">Cut at</p>
          <output className="text-lg font-semibold tabular-nums text-primary" aria-live="polite">
            {formatPreciseTime(selected)}
          </output>
        </div>
        <div className="text-right">
          <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Second recording</p>
          <p className="mt-0.5 text-sm font-semibold tabular-nums">{formatPreciseTime(durationSec - selected)}</p>
        </div>
      </div>

      <Slider
        className="mt-3 py-2"
        min={min}
        max={max}
        step={0.1}
        value={[selected]}
        onValueChange={([value]) => changePoint(value)}
        aria-label="Exact split position"
        aria-valuetext={formatPreciseTime(selected)}
      />

      <div className="mt-2 flex flex-wrap items-center gap-1.5">
        {[-1, -0.1, 0.1, 1].map((delta) => (
          <Button
            key={delta}
            type="button"
            variant="outline"
            size="sm"
            className="h-7 px-2 text-xs tabular-nums"
            onClick={() => changePoint(selected + delta)}
            disabled={splitting || selected + delta < min || selected + delta > max}
            aria-label={`${delta < 0 ? 'Move cut earlier' : 'Move cut later'} by ${Math.abs(delta)} seconds`}
          >
            {delta > 0 ? '+' : '−'}{Math.abs(delta)}s
          </Button>
        ))}
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="ml-1 h-7 gap-1.5 px-2 text-xs"
          onClick={togglePreview}
          disabled={splitting}
        >
          {previewActive && isPlaying ? <Pause className="h-3.5 w-3.5" /> : <Play className="h-3.5 w-3.5" />}
          {previewActive && isPlaying ? 'Stop preview' : 'Preview from cut'}
        </Button>
      </div>

      <div className="mt-3 border-t border-border/60 pt-3">
        <div className="flex items-center gap-1.5 text-xs font-medium">
          {detecting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5 text-primary" />}
          Suggested boundaries
        </div>
        {detecting ? (
          <p className="mt-1 text-xs text-muted-foreground" role="status">Listening for longer silences and transcript gaps…</p>
        ) : suggestions.length > 0 ? (
          <div className="mt-2 flex flex-wrap gap-1.5">
            {suggestions.map((suggestion) => (
              <button
                key={`${suggestion.timeSec}-${suggestion.reason}`}
                type="button"
                onClick={() => changePoint(suggestion.timeSec)}
                className={cn(
                  'rounded-full border px-2.5 py-1 text-xs transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/60',
                  Math.abs(selected - suggestion.timeSec) < 0.05
                    ? 'border-primary bg-primary text-primary-foreground'
                    : 'border-border bg-background hover:border-primary/60 hover:bg-primary/5'
                )}
                aria-pressed={Math.abs(selected - suggestion.timeSec) < 0.05}
                aria-label={`${suggestionLabel(suggestion)}. ${Math.round(suggestion.confidence * 100)}% confidence`}
                title={`${Math.round(suggestion.confidence * 100)}% confidence`}
              >
                {suggestionLabel(suggestion)}
              </button>
            ))}
          </div>
        ) : (
          <p className="mt-1 text-xs text-muted-foreground">
            {detectError
              ? `Automatic suggestions are unavailable because ${detectionFailureCopy(detectError)}. Manual selection still works.`
              : 'No strong boundary found; choose the point manually.'}
          </p>
        )}
      </div>

      <div className="mt-4 flex flex-wrap items-center justify-between gap-2">
        <p className="max-w-xl text-xs text-muted-foreground">
          The two new FLAC files are lossless. The original and its current transcript move to Trash as a recoverable safety copy.
        </p>
        <Button className="gap-2" onClick={() => setConfirmOpen(true)} disabled={splitting || durationSec <= 2}>
          {splitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Scissors className="h-4 w-4" />}
          Create two recordings
        </Button>
      </div>

      <ConfirmDialog
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        title={`Split at ${formatPreciseTime(selected)}?`}
        description={`This creates recordings of ${formatPreciseTime(selected)} and ${formatPreciseTime(durationSec - selected)}. The original stays recoverable in Trash.`}
        actionLabel="Create two recordings"
        cancelLabel="Keep editing"
        variant="default"
        onConfirm={createSplit}
      />
    </section>
  )
}
