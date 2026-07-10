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
 * Full-mode "meeting timeline" (rendered only in 'full' mode, each part a no-op
 * when its data is absent, so the reader degrades gracefully):
 *  - `speakerRanges` + `speakerLegend` — per-speaker colored bars + a clickable
 *    legend that isolates one speaker's bars.
 *  - `events` — numbered action/decision markers on the axis, cross-linked with
 *    an events list below (click a marker → seek + highlight; click a list item →
 *    seek + highlight the marker).
 *  - `sentiment` — a score-based sentiment curve drawn above the waveform, and
 *    fed (converted) into WaveformCanvas's bar-coloring hook for the gaps.
 */

import { useCallback, useEffect, useMemo, useState } from 'react'
import { Play, Pause, Square, SkipBack, SkipForward, Volume2, CheckSquare, GitBranch, StickyNote } from 'lucide-react'
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
import { WaveformCanvas, type SentimentSegment, type WaveformSpeakerRange } from '@/components/WaveformCanvas'
import type { DerivedSpeakerRange, SpeakerLegendEntry } from '../utils/speakerRanges'
import { formatTimestamp } from '@/utils/audioUtils'
import { cn } from '@/lib/utils'

export type WaveformPlayerMode = 'pill' | 'scrubber' | 'full'

/**
 * A per-speaker time band that colors the full-mode waveform bars. Structurally
 * the util's `DerivedSpeakerRange` (seconds-based, with a resolved color + key).
 */
export type SpeakerRange = DerivedSpeakerRange

/** A numbered timeline marker (action / decision / note) linked to a summary item. */
export interface TimelineEvent {
  id: string
  timeSec: number
  /** 1-based number shown on the marker + the list item it links to. */
  index?: number
  label?: string
  kind?: 'action' | 'decision' | 'note'
  /** Optional id of the linked summary/action item (for cross-highlighting). */
  refId?: string
}

/** A sentiment sample over a time span; `score` in [-1, 1] (up = positive). */
export interface SentimentScorePoint {
  startSec: number
  endSec: number
  score: number
}

interface WaveformPlayerProps {
  recordingId?: string
  filePath?: string
  /** Presentation. Defaults to the docked 'pill'. */
  mode?: WaveformPlayerMode
  /**
   * Full-width docked bar. When true the 'pill' spans its container (a sticky
   * player bar across the whole reader pane) instead of a compact left-aligned
   * chip. No-op for 'scrubber' (already fluid) and 'full'.
   */
  fluid?: boolean
  /** Per-speaker colored bars (full mode only; no-op when absent). */
  speakerRanges?: SpeakerRange[]
  /** Distinct speakers for the color legend (full mode only). */
  speakerLegend?: SpeakerLegendEntry[]
  /** Numbered event markers (full mode only; no-op when absent). */
  events?: TimelineEvent[]
  /** Score-based sentiment for the curve + bar-coloring hook (full mode). */
  sentiment?: SentimentScorePoint[]
  /** Notified when the user seeks (seconds). */
  onSeek?: (sec: number) => void
  /** Notified when the user clicks an event marker or its list row. */
  onEventClick?: (event: TimelineEvent) => void
  /** Externally-controlled highlighted event id (bidirectional list linking). */
  activeEventId?: string | null
  className?: string
}

/** Convert score-based sentiment to the canvas's label-based coloring hook. */
function scoreSentimentToSegments(points: SentimentScorePoint[]): SentimentSegment[] {
  return points.map((p) => ({
    startTime: p.startSec,
    endTime: p.endSec,
    sentiment: p.score > 0.2 ? 'positive' : p.score < -0.2 ? 'negative' : 'neutral'
  }))
}

/** Marker accent per kind — actions vs decisions read as distinct colors. */
const EVENT_KIND_COLOR: Record<NonNullable<TimelineEvent['kind']>, string> = {
  action: '#D97706', // amber-600
  decision: '#7C3AED', // violet-600
  note: '#64748B' // slate-500
}
const EVENT_KIND_ICON = {
  action: CheckSquare,
  decision: GitBranch,
  note: StickyNote
} as const

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
  fluid = false,
  speakerRanges,
  speakerLegend,
  events,
  sentiment,
  onSeek,
  onEventClick,
  activeEventId,
  className
}: WaveformPlayerProps) {
  const pb = usePlayback(recordingId, filePath)
  const wf = useScopedWaveform(recordingId)
  const [playbackRate, setPlaybackRate] = useState('1')

  // Full-mode timeline interactions (local to the player):
  //  - isolatedKey: a legend click fades every other speaker's bars.
  //  - internalActiveEvent: which event marker/list row is highlighted, unless a
  //    parent drives it via `activeEventId`.
  const [isolatedKey, setIsolatedKey] = useState<string | null>(null)
  const [internalActiveEvent, setInternalActiveEvent] = useState<string | null>(null)
  const activeEvent = activeEventId !== undefined ? activeEventId : internalActiveEvent

  // Reset transient timeline selections when the recording changes.
  useEffect(() => {
    setIsolatedKey(null)
    setInternalActiveEvent(null)
  }, [recordingId])

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
          'items-center gap-2 rounded-full border bg-muted/50 py-1 pl-1 pr-2 text-foreground',
          fluid ? 'flex w-full' : 'inline-flex max-w-full',
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
        <div className={cn('min-w-0 flex-1', !fluid && 'max-w-[280px]')}>
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
  return (
    <FullTimeline
      pb={pb}
      wf={wf}
      className={className}
      progress={progress}
      seekTo={seekTo}
      skipBackward={skipBackward}
      skipForward={skipForward}
      playbackRate={playbackRate}
      handleRate={handleRate}
      speakerRanges={speakerRanges}
      speakerLegend={speakerLegend}
      events={events}
      sentiment={sentiment}
      storeSentiment={wf.storeSentiment}
      onEventClick={onEventClick}
      activeEvent={activeEvent}
      setInternalActiveEvent={setInternalActiveEvent}
      isolatedKey={isolatedKey}
      setIsolatedKey={setIsolatedKey}
    />
  )
}

interface FullTimelineProps {
  pb: ReturnType<typeof usePlayback>
  wf: ReturnType<typeof useScopedWaveform>
  className?: string
  progress: number
  seekTo: (sec: number) => void
  skipBackward: () => void
  skipForward: () => void
  playbackRate: string
  handleRate: (v: string) => void
  speakerRanges?: SpeakerRange[]
  speakerLegend?: SpeakerLegendEntry[]
  events?: TimelineEvent[]
  sentiment?: SentimentScorePoint[]
  storeSentiment: SentimentSegment[] | null
  onEventClick?: (event: TimelineEvent) => void
  activeEvent: string | null
  setInternalActiveEvent: (id: string | null) => void
  isolatedKey: string | null
  setIsolatedKey: (key: string | null) => void
}

/** The full-mode meeting timeline: colored bars, playhead, markers, sentiment. */
function FullTimeline({
  pb,
  wf,
  className,
  progress,
  seekTo,
  skipBackward,
  skipForward,
  playbackRate,
  handleRate,
  speakerRanges,
  speakerLegend,
  events,
  sentiment,
  storeSentiment,
  onEventClick,
  activeEvent,
  setInternalActiveEvent,
  isolatedKey,
  setIsolatedKey
}: FullTimelineProps) {
  const duration = pb.liveDuration

  // Speaker bars for the canvas (seconds → the canvas's WaveformSpeakerRange).
  const canvasSpeakerRanges = useMemo<WaveformSpeakerRange[] | undefined>(() => {
    if (!speakerRanges || speakerRanges.length === 0) return undefined
    return speakerRanges.map((r) => ({
      startTime: r.startSec,
      endTime: r.endSec,
      color: r.color,
      speakerKey: r.speakerKey
    }))
  }, [speakerRanges])

  // Sentiment for the canvas hook: the score-based prop (converted) when present,
  // else the store's label-based data. Speaker colors take precedence in-canvas.
  const canvasSentiment = useMemo<SentimentSegment[] | undefined>(() => {
    if (sentiment && sentiment.length > 0) return scoreSentimentToSegments(sentiment)
    return storeSentiment ?? undefined
  }, [sentiment, storeSentiment])

  // Event markers positioned on the axis (only those inside the known duration).
  const markers = useMemo(() => {
    if (!events || duration <= 0) return []
    return events
      .filter((e) => e.timeSec >= 0 && e.timeSec <= duration)
      .map((e) => ({ ...e, leftPct: (e.timeSec / duration) * 100 }))
  }, [events, duration])

  // Sentiment polyline points (px-independent: x in [0,1], y in [0,1], 0 = top).
  const sentimentPath = useMemo(() => {
    if (!sentiment || sentiment.length === 0 || duration <= 0) return null
    const pts = sentiment
      .filter((s) => s.endSec > s.startSec)
      .map((s) => {
        const midX = ((s.startSec + s.endSec) / 2 / duration)
        const y = (1 - (Math.max(-1, Math.min(1, s.score)) + 1) / 2)
        return { x: Math.max(0, Math.min(1, midX)), y }
      })
      .sort((a, b) => a.x - b.x)
    return pts.length >= 2 ? pts : null
  }, [sentiment, duration])

  const activateEvent = useCallback(
    (e: TimelineEvent) => {
      setInternalActiveEvent(e.id)
      if (duration > 0) seekTo(e.timeSec)
      onEventClick?.(e)
    },
    [duration, seekTo, onEventClick, setInternalActiveEvent]
  )

  const legend = speakerLegend ?? []

  return (
    <div className={cn('space-y-2 rounded-lg border bg-muted/40 p-3', className)} data-testid="waveform-player-full">
      {/* Sentiment curve — a thin line above the waveform, same time axis. */}
      {sentimentPath && (
        <div className="relative h-6" data-testid="sentiment-curve" aria-hidden="true">
          <svg className="absolute inset-0 h-full w-full" viewBox="0 0 100 100" preserveAspectRatio="none">
            {/* neutral baseline */}
            <line x1="0" y1="50" x2="100" y2="50" stroke="hsl(var(--muted-foreground))" strokeOpacity="0.25" strokeWidth="0.5" />
            <polyline
              points={sentimentPath.map((p) => `${p.x * 100},${p.y * 100}`).join(' ')}
              fill="none"
              stroke="hsl(var(--primary))"
              strokeWidth="1.5"
              strokeLinejoin="round"
              strokeLinecap="round"
              vectorEffect="non-scaling-stroke"
            />
          </svg>
        </div>
      )}

      {/* Waveform + overlays. WaveformCanvas draws speaker-colored bars, a strong
          2px playhead, and seeks on click. Numbered markers sit on the axis. */}
      <div className="relative">
        {wf.waveformData ? (
          <WaveformCanvas
            audioData={wf.waveformData}
            sentimentData={canvasSentiment}
            speakerRanges={canvasSpeakerRanges}
            isolatedSpeakerKey={isolatedKey}
            currentTime={pb.liveTime}
            duration={duration}
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
        {duration > 0 && (
          <div
            className="pointer-events-none absolute inset-y-0 w-px bg-foreground/80"
            style={{ left: `${progress * 100}%` }}
            aria-hidden="true"
          />
        )}

        {/* Numbered event markers — actions vs decisions in distinct accents. */}
        {markers.map((m) => {
          const kind = m.kind ?? 'note'
          const color = EVENT_KIND_COLOR[kind]
          const isActive = activeEvent === m.id
          return (
            <button
              key={m.id}
              type="button"
              onClick={() => activateEvent(m)}
              title={`${kind}${m.label ? `: ${m.label}` : ''} (${formatTimestamp(m.timeSec)})`}
              aria-label={`Jump to marker ${m.index ?? ''} (${kind})${m.label ? `: ${m.label}` : ''}`.trim()}
              aria-pressed={isActive}
              className={cn(
                'absolute -top-1 flex h-4 w-4 -translate-x-1/2 items-center justify-center rounded-full border text-[9px] font-semibold leading-none text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/60',
                isActive ? 'border-foreground ring-2 ring-foreground/40' : 'border-background'
              )}
              style={{ left: `${m.leftPct}%`, backgroundColor: color }}
            >
              {m.index ?? ''}
            </button>
          )
        })}
      </div>

      {/* Speaker legend — click to isolate one speaker's bars. */}
      {legend.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5" data-testid="speaker-legend">
          {legend.map((s) => {
            const isolated = isolatedKey === s.speakerKey
            return (
              <button
                key={s.speakerKey}
                type="button"
                onClick={() => setIsolatedKey(isolated ? null : s.speakerKey)}
                aria-pressed={isolated}
                title={isolated ? `Show all speakers` : `Isolate ${s.name}`}
                className={cn(
                  'inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-xs transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50',
                  isolated ? 'border-foreground/40 bg-background' : 'border-transparent bg-muted/60 hover:bg-muted'
                )}
              >
                <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: s.color }} aria-hidden="true" />
                <span className="max-w-[9rem] truncate">{s.name}</span>
                {isolatedKey && !isolated && <span className="text-muted-foreground/60">·</span>}
              </button>
            )
          })}
          {isolatedKey && (
            <button
              type="button"
              onClick={() => setIsolatedKey(null)}
              className="rounded-full px-2 py-0.5 text-xs text-muted-foreground underline-offset-2 hover:underline"
            >
              Show all
            </button>
          )}
        </div>
      )}

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

      {/* Event list — numbered actions/decisions, cross-linked with the markers. */}
      {markers.length > 0 && (
        <ul className="space-y-0.5 border-t pt-2" data-testid="timeline-events">
          {markers.map((m) => {
            const kind = m.kind ?? 'note'
            const Icon = EVENT_KIND_ICON[kind]
            const isActive = activeEvent === m.id
            return (
              <li key={m.id}>
                <button
                  type="button"
                  onClick={() => activateEvent(m)}
                  aria-pressed={isActive}
                  className={cn(
                    'flex w-full items-center gap-2 rounded px-1.5 py-1 text-left text-xs transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40',
                    isActive ? 'bg-primary/10' : 'hover:bg-muted/60'
                  )}
                >
                  <span
                    className="flex h-4 w-4 shrink-0 items-center justify-center rounded-full text-[9px] font-semibold text-white"
                    style={{ backgroundColor: EVENT_KIND_COLOR[kind] }}
                  >
                    {m.index ?? ''}
                  </span>
                  <Icon className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
                  <span className="min-w-0 flex-1 truncate">{m.label || `${kind} at ${formatTimestamp(m.timeSec)}`}</span>
                  <span className="shrink-0 tabular-nums text-muted-foreground">{formatTimestamp(m.timeSec)}</span>
                </button>
              </li>
            )
          })}
        </ul>
      )}
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
