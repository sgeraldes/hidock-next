/**
 * WaveformPlayer
 *
 * A self-contained audio player + waveform for the Library reader. It replaces
 * the tall, edge-to-edge AudioPlayer with three space-calibrated presentations,
 * behind one `mode` prop, so SourceReader just renders it:
 *
 *  - 'pill'     Voice-message pill (docked default): [▶] · mini waveform bars ·
 *               elapsed time · a "1×" speed pill — one short rounded bar.
 *  - 'scrubber' Bare fallback for narrow panels: [▶] ──●──── 0:00 / 1:28 [🔊].
 *  - 'full'     The classic waveform, SMALLER, with a CLEAR time playhead.
 *
 * Playback is owned by OperationController (via `useAudioControls`); this
 * component only reflects state and drives transport, exactly like AudioPlayer.
 *
 * Extension seam (for the follow-up rich timeline — rendered only in 'full' mode,
 * a no-op when absent, so the props can be wired now and populated later):
 *  - `speakerRanges` per-speaker colored bands under the waveform
 *  - `events`        numbered markers (actions/decisions) linked to summary items
 *  - `sentiment`     an optional sentiment curve / coloring
 */

import { useCallback, useState } from 'react'
import { Play, Pause, Square, SkipBack, SkipForward, Volume2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select'
import { useUIStore } from '@/store/useUIStore'
import { useAudioControls } from '@/components/OperationController'
import { WaveformCanvas, type SentimentSegment } from '@/components/WaveformCanvas'
import { formatTimestamp } from '@/utils/audioUtils'
import { cn } from '@/lib/utils'

export type WaveformPlayerMode = 'pill' | 'scrubber' | 'full'

/** A per-speaker time band (future full-mode overlay). */
export interface SpeakerRange {
  startSec: number
  endSec: number
  /** Stable key for the speaker (e.g. contact id or effective label). */
  speakerKey: string
  /** Optional explicit color; the follow-up may derive one from the speaker. */
  color?: string
}

/** A numbered timeline marker (action / decision / note) linked to a summary item. */
export interface TimelineEvent {
  id: string
  timeSec: number
  /** 1-based number shown on the marker + the summary item it links to. */
  index?: number
  label?: string
  kind?: 'action' | 'decision' | 'note'
}

interface WaveformPlayerProps {
  recordingId?: string
  filePath?: string
  /** Presentation. Defaults to the docked 'pill'. */
  mode?: WaveformPlayerMode
  /** Per-speaker colored bands (full mode only; no-op when absent). */
  speakerRanges?: SpeakerRange[]
  /** Numbered event markers (full mode only; no-op when absent). */
  events?: TimelineEvent[]
  /** Sentiment segments to color the waveform (full mode; falls back to store data). */
  sentiment?: SentimentSegment[]
  /** Notified when the user seeks (seconds). */
  onSeek?: (sec: number) => void
  /** Notified when the user clicks an event marker. */
  onEventClick?: (event: TimelineEvent) => void
  className?: string
}

/** Shared playback state + transport, derived once and used by every mode. */
function usePlayback(recordingId?: string, filePath?: string) {
  const isPlaying = useUIStore((s) => s.isPlaying)
  const currentlyPlayingId = useUIStore((s) => s.currentlyPlayingId)
  const currentTime = useUIStore((s) => s.playbackCurrentTime)
  const duration = useUIStore((s) => s.playbackDuration)
  const audioControls = useAudioControls()

  const isLoaded = !recordingId || currentlyPlayingId === recordingId
  const canPlayThis = isLoaded || (!!recordingId && !!filePath)
  const showLiveTime = isLoaded

  const togglePlay = useCallback(() => {
    if (isLoaded) {
      if (isPlaying) audioControls.pause()
      else audioControls.resume()
    } else if (recordingId && filePath) {
      audioControls.play(recordingId, filePath)
    }
  }, [isLoaded, isPlaying, audioControls, recordingId, filePath])

  return {
    isPlaying,
    audioControls,
    togglePlay,
    isLoaded,
    canPlayThis,
    liveTime: showLiveTime ? currentTime : 0,
    liveDuration: showLiveTime ? duration : 0,
    rawCurrentTime: currentTime,
    rawDuration: duration,
    showLiveTime
  }
}

/** Scope the global (single-engine) waveform state to this recording. */
function useScopedWaveform(recordingId?: string) {
  const playbackWaveformData = useUIStore((s) => s.playbackWaveformData)
  const storeSentiment = useUIStore((s) => s.playbackSentimentData)
  const waveformLoadingId = useUIStore((s) => s.waveformLoadingId)
  const rawWaveformError = useUIStore((s) => s.waveformLoadingError)
  const waveformErrorForId = useUIStore((s) => s.waveformErrorForId)
  const waveformLoadedForId = useUIStore((s) => s.waveformLoadedForId)

  const isForThis = (id: string | null) => !recordingId || id === recordingId
  return {
    waveformData: isForThis(waveformLoadedForId) ? playbackWaveformData : null,
    storeSentiment,
    waveformLoadingError: isForThis(waveformErrorForId) ? rawWaveformError : null,
    isLoadingThis: !!waveformLoadingId && isForThis(waveformLoadingId)
  }
}

/** The "1×" speed control as a compact pill-friendly Select. */
function SpeedPill({ value, onChange, className }: { value: string; onChange: (v: string) => void; className?: string }) {
  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger className={cn('h-7 w-[58px] rounded-full px-2.5 text-xs', className)} aria-label="Playback speed">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="0.5">0.5×</SelectItem>
        <SelectItem value="1">1×</SelectItem>
        <SelectItem value="1.5">1.5×</SelectItem>
        <SelectItem value="2">2×</SelectItem>
      </SelectContent>
    </Select>
  )
}

/** Small static bars used as the pill's waveform stand-in while none is decoded. */
function MiniBars() {
  return (
    <div className="flex h-6 items-center gap-[2px] overflow-hidden" aria-hidden="true">
      {Array.from({ length: 28 }).map((_, i) => (
        <div
          key={i}
          className="w-[2px] shrink-0 rounded-full bg-current opacity-40"
          style={{ height: `${((i * 41) % 70) + 25}%` }}
        />
      ))}
    </div>
  )
}

export function WaveformPlayer({
  recordingId,
  filePath,
  mode = 'pill',
  speakerRanges,
  events,
  sentiment,
  onSeek,
  onEventClick,
  className
}: WaveformPlayerProps) {
  const pb = usePlayback(recordingId, filePath)
  const wf = useScopedWaveform(recordingId)
  const [playbackRate, setPlaybackRate] = useState('1')

  const handleRate = useCallback(
    (value: string) => {
      setPlaybackRate(value)
      pb.audioControls.setPlaybackRate(parseFloat(value))
    },
    [pb.audioControls]
  )

  const seekTo = useCallback(
    (sec: number) => {
      if (!pb.liveDuration || pb.liveDuration <= 0) return
      pb.audioControls.seek(sec)
      onSeek?.(sec)
    },
    [pb.audioControls, pb.liveDuration, onSeek]
  )

  const skipBackward = useCallback(() => pb.audioControls.seek(Math.max(0, pb.rawCurrentTime - 10)), [pb.audioControls, pb.rawCurrentTime])
  const skipForward = useCallback(
    () => pb.audioControls.seek(Math.min(pb.rawDuration, pb.rawCurrentTime + 10)),
    [pb.audioControls, pb.rawDuration, pb.rawCurrentTime]
  )

  const progress = pb.liveDuration > 0 ? Math.min(1, pb.liveTime / pb.liveDuration) : 0

  // Click-to-seek on a plain progress/bar track (scrubber + overlay hosts).
  const trackSeek = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      if (pb.liveDuration <= 0) return
      const rect = e.currentTarget.getBoundingClientRect()
      const frac = Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width))
      seekTo(frac * pb.liveDuration)
    },
    [pb.liveDuration, seekTo]
  )

  // ---- 'pill' -------------------------------------------------------------
  if (mode === 'pill') {
    return (
      <div
        className={cn(
          'inline-flex max-w-full items-center gap-2 rounded-full border bg-muted/50 py-1 pl-1 pr-2 text-foreground',
          className
        )}
        data-testid="waveform-player-pill"
      >
        <Button
          variant="secondary"
          size="icon"
          onClick={pb.togglePlay}
          disabled={!pb.canPlayThis}
          title={pb.canPlayThis ? (pb.isPlaying ? 'Pause' : 'Play') : 'Download to play'}
          aria-label={pb.isPlaying ? 'Pause' : 'Play'}
          className="h-8 w-8 shrink-0 rounded-full"
        >
          {pb.isPlaying ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
        </Button>
        <div className="min-w-0 flex-1 max-w-[280px]">
          {wf.waveformData ? (
            <WaveformCanvas
              audioData={wf.waveformData}
              currentTime={pb.liveTime}
              duration={pb.liveDuration}
              onSeek={seekTo}
              height={24}
            />
          ) : (
            <MiniBars />
          )}
        </div>
        <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
          {formatTimestamp(pb.liveTime)}
        </span>
        <SpeedPill value={playbackRate} onChange={handleRate} />
      </div>
    )
  }

  // ---- 'scrubber' ---------------------------------------------------------
  if (mode === 'scrubber') {
    return (
      <div className={cn('flex items-center gap-2 px-1', className)} data-testid="waveform-player-scrubber">
        <Button
          variant="ghost"
          size="icon"
          onClick={pb.togglePlay}
          disabled={!pb.canPlayThis}
          title={pb.canPlayThis ? (pb.isPlaying ? 'Pause' : 'Play') : 'Download to play'}
          aria-label={pb.isPlaying ? 'Pause' : 'Play'}
          className="h-8 w-8 shrink-0"
        >
          {pb.isPlaying ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
        </Button>
        <div
          className="group relative h-6 min-w-0 flex-1 cursor-pointer"
          onClick={trackSeek}
          role="slider"
          aria-label="Seek"
          aria-valuemin={0}
          aria-valuemax={Math.round(pb.liveDuration)}
          aria-valuenow={Math.round(pb.liveTime)}
          tabIndex={0}
        >
          <div className="absolute inset-x-0 top-1/2 h-1 -translate-y-1/2 rounded-full bg-muted-foreground/25" />
          <div
            className="absolute left-0 top-1/2 h-1 -translate-y-1/2 rounded-full bg-primary"
            style={{ width: `${progress * 100}%` }}
          />
          <div
            className="absolute top-1/2 h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full bg-primary shadow"
            style={{ left: `${progress * 100}%` }}
          />
        </div>
        <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
          {formatTimestamp(pb.liveTime)} / {formatTimestamp(pb.liveDuration)}
        </span>
        <Volume2 className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
      </div>
    )
  }

  // ---- 'full' -------------------------------------------------------------
  // NB: plain computations (not hooks) so they stay below the pill/scrubber
  // early returns without breaking hook order.
  const effectiveSentiment = sentiment ?? wf.storeSentiment ?? undefined
  const markers =
    events && pb.liveDuration > 0
      ? events
          .filter((e) => e.timeSec >= 0 && e.timeSec <= pb.liveDuration)
          .map((e) => ({ ...e, leftPct: (e.timeSec / pb.liveDuration) * 100 }))
      : []
  const bands =
    speakerRanges && pb.liveDuration > 0
      ? speakerRanges.map((r) => ({
          ...r,
          leftPct: (Math.max(0, r.startSec) / pb.liveDuration) * 100,
          widthPct: (Math.max(0, r.endSec - r.startSec) / pb.liveDuration) * 100
        }))
      : []

  return (
    <div className={cn('space-y-2 rounded-lg border bg-muted/40 p-3', className)} data-testid="waveform-player-full">
      {/* Waveform + overlays. WaveformCanvas already draws a strong 2px playhead
          (foreground color, both themes) — the CLEAR time cursor the timeline
          needs. Event markers + speaker bands render only when provided. */}
      <div className="relative">
        {wf.waveformData ? (
          <WaveformCanvas
            audioData={wf.waveformData}
            sentimentData={effectiveSentiment}
            currentTime={pb.liveTime}
            duration={pb.liveDuration}
            onSeek={seekTo}
            height={56}
          />
        ) : wf.waveformLoadingError ? (
          <div className="flex h-14 items-center justify-center rounded bg-destructive/10 text-xs text-destructive">
            Waveform unavailable
          </div>
        ) : wf.isLoadingThis ? (
          <div className="flex h-14 items-center gap-0.5 overflow-hidden rounded">
            {Array.from({ length: 64 }).map((_, i) => (
              <div
                key={i}
                className="w-1 shrink-0 rounded bg-muted-foreground/25 motion-safe:animate-pulse"
                style={{ height: `${((i * 37) % 80) + 20}%`, animationDelay: `${i * 20}ms` }}
              />
            ))}
          </div>
        ) : (
          <div className="flex h-14 items-center justify-center rounded bg-background text-xs text-muted-foreground">
            Press play to load the waveform
          </div>
        )}

        {/* Explicit playhead cursor line — reinforces WaveformCanvas's playhead
            and stays visible over the placeholder/loading states too. */}
        {pb.liveDuration > 0 && (
          <div
            className="pointer-events-none absolute inset-y-0 w-px bg-foreground/80"
            style={{ left: `${progress * 100}%` }}
            aria-hidden="true"
          />
        )}

        {/* Per-speaker bands (follow-up seam). */}
        {bands.length > 0 && (
          <div className="pointer-events-none absolute inset-x-0 bottom-0 h-1.5">
            {bands.map((b, i) => (
              <div
                key={`${b.speakerKey}-${i}`}
                className="absolute bottom-0 h-1.5 rounded-full"
                style={{ left: `${b.leftPct}%`, width: `${b.widthPct}%`, backgroundColor: b.color ?? 'hsl(var(--primary))' }}
              />
            ))}
          </div>
        )}

        {/* Numbered event markers (follow-up seam). */}
        {markers.map((m) => (
          <button
            key={m.id}
            type="button"
            onClick={() => onEventClick?.(m)}
            title={m.label ? `${m.label} (${formatTimestamp(m.timeSec)})` : `Marker ${m.index ?? ''}`.trim()}
            aria-label={`Jump to marker ${m.index ?? ''}${m.label ? `: ${m.label}` : ''}`.trim()}
            className="absolute -top-1 flex h-4 w-4 -translate-x-1/2 items-center justify-center rounded-full border border-background bg-primary text-[9px] font-semibold leading-none text-primary-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50"
            style={{ left: `${m.leftPct}%` }}
          >
            {m.index ?? ''}
          </button>
        ))}
      </div>

      {/* Times + transport */}
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-1">
          {PlayButtonFull(pb)}
          <Button variant="ghost" size="icon" className="h-8 w-8" onClick={skipBackward} disabled={!pb.showLiveTime || pb.rawCurrentTime <= 0} title="Back 10s" aria-label="Skip back 10 seconds">
            <SkipBack className="h-4 w-4" />
          </Button>
          <Button variant="ghost" size="icon" className="h-8 w-8" onClick={skipForward} disabled={!pb.showLiveTime || pb.rawCurrentTime >= pb.rawDuration} title="Forward 10s" aria-label="Skip forward 10 seconds">
            <SkipForward className="h-4 w-4" />
          </Button>
          <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => pb.audioControls.stop()} title="Stop" aria-label="Stop playback">
            <Square className="h-4 w-4" />
          </Button>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs tabular-nums text-muted-foreground">
            {formatTimestamp(pb.liveTime)} / {formatTimestamp(pb.liveDuration)}
          </span>
          <SpeedPill value={playbackRate} onChange={handleRate} />
        </div>
      </div>
    </div>
  )
}

/** The full-mode primary transport button (kept out of JSX for icon clarity). */
function PlayButtonFull(pb: ReturnType<typeof usePlayback>) {
  return (
    <Button
      variant="outline"
      size="icon"
      onClick={pb.togglePlay}
      disabled={!pb.canPlayThis}
      title={pb.canPlayThis ? (pb.isPlaying ? 'Pause' : 'Play') : 'Download to play'}
      aria-label={pb.isPlaying ? 'Pause' : 'Play'}
      className="h-9 w-9 shrink-0"
    >
      {pb.isPlaying ? <Pause className="h-5 w-5" /> : <Play className="h-5 w-5" />}
    </Button>
  )
}
