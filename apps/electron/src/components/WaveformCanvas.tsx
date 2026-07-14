/**
 * WaveformCanvas Component
 *
 * Simple vertical bar waveform visualization with optional sentiment coloring.
 * Displays audio amplitude as vertical bars (3px wide, 1px gap).
 * Supports click-to-seek functionality.
 */

import { useRef, useEffect } from 'react'

/**
 * Sentiment segment with time bounds and label
 */
export interface SentimentSegment {
  startTime: number // Seconds
  endTime: number // Seconds
  sentiment: 'positive' | 'negative' | 'neutral'
}

/**
 * A per-speaker time band used to color the waveform bars by who was speaking.
 * Times are in seconds; `color` is a resolved hex; `speakerKey` lets the caller
 * isolate a single speaker (see `isolatedSpeakerKey`).
 */
export interface WaveformSpeakerRange {
  startTime: number // Seconds
  endTime: number // Seconds
  color: string
  speakerKey: string
}

export interface WaveformCanvasProps {
  /** PCM audio samples for amplitude-based waveform */
  audioData: Float32Array | null
  /** Optional sentiment analysis data for color coding */
  sentimentData?: SentimentSegment[]
  /**
   * Optional per-speaker color bands. When present, a bar is painted with the
   * color of the speaker active at that time — taking precedence over sentiment
   * and the played/unplayed split. Sentiment still colors the GAPS between
   * speaker ranges, so both hooks are honored without fighting.
   */
  speakerRanges?: WaveformSpeakerRange[]
  /**
   * When set, only bars belonging to this speaker key render at full strength;
   * every other bar is dimmed. Used by the legend to isolate one speaker.
   */
  isolatedSpeakerKey?: string | null
  /** Current playback position in seconds (for playhead) */
  currentTime?: number
  /** Total audio duration in seconds */
  duration: number
  /** Callback when user clicks to seek */
  onSeek: (time: number) => void
  /** Canvas height in pixels */
  height?: number
  /** Canvas width in pixels (defaults to 800) */
  width?: number
}

/**
 * Resolve theme-aware, high-contrast colors from CSS custom properties on the
 * canvas element. Values in index.css are HSL triplets ("205 90% 36%"), so we
 * wrap them in hsl(); when unavailable (e.g. jsdom) we fall back to fixed hexes
 * that still meet ≥4.5:1 against the player's muted background in both themes.
 */
function resolveWaveformColors(el: HTMLElement): {
  played: string
  unplayed: string
  playhead: string
} {
  const cs = typeof getComputedStyle === 'function' ? getComputedStyle(el) : null
  const read = (name: string, fallback: string): string => {
    const raw = cs?.getPropertyValue(name).trim()
    return raw ? `hsl(${raw})` : fallback
  }
  return {
    // Played progress uses the committed primary (azure) — a clear, saturated
    // fill that reads as "how far you are" at a glance.
    played: read('--primary', '#1666a8'),
    // Unplayed uses muted-foreground (mid-contrast in both themes) instead of
    // the old slate-400 (#94A3B8), which washed out on the light lavender panel.
    unplayed: read('--muted-foreground', '#556070'),
    // Playhead uses the full-strength foreground so it's unmistakable on either
    // theme (the old rgba(0,0,0,0.3) vanished in dark mode).
    playhead: read('--foreground', '#0f172a')
  }
}

/**
 * WaveformCanvas - Renders simple vertical bar waveform
 *
 * Features:
 * - Vertical bars (3px wide, 1px gap) based on audio amplitude
 * - Played/unplayed split: played bars use the primary color, unplayed use
 *   muted-foreground — a high-contrast (≥4.5:1) seek affordance in both themes
 * - Sentiment coloring: Red (negative), Green (positive) override the split
 * - Click-to-seek functionality
 * - Strong 2px playhead indicator
 */
export function WaveformCanvas({
  audioData,
  sentimentData,
  speakerRanges,
  isolatedSpeakerKey,
  currentTime,
  duration,
  onSeek,
  height = 60,
  width = 800
}: WaveformCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)

  // Draw waveform bars
  useEffect(() => {
    if (!canvasRef.current || !audioData) return

    const canvas = canvasRef.current
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    // Bar configuration
    const barWidth = 3
    const barGap = 1
    const barCount = Math.floor(width / (barWidth + barGap))

    // Clear canvas
    ctx.clearRect(0, 0, width, height)

    // Theme-aware, high-contrast colors (played/unplayed/playhead)
    const colors = resolveWaveformColors(canvas)
    const playedFraction =
      currentTime !== undefined && currentTime > 0 && duration > 0
        ? currentTime / duration
        : 0

    const hasSpeakers = !!speakerRanges && speakerRanges.length > 0

    // Draw bars
    for (let i = 0; i < barCount; i++) {
      // Sample audio data for this bar
      const dataIndex = Math.floor((i / barCount) * audioData.length)
      const amplitude = Math.abs(audioData[dataIndex] || 0)
      const barHeight = Math.max(2, amplitude * height * 0.9) // Min 2px, max 90% height
      const x = i * (barWidth + barGap)
      const y = (height - barHeight) / 2 // Center vertically
      const timeForBar = (i / barCount) * duration

      // Base color = played/unplayed split (the seek affordance). Bars up to the
      // playhead are filled with the primary color; the rest stay muted.
      const isPlayed = i / barCount <= playedFraction
      let barColor = isPlayed ? colors.played : colors.unplayed
      let barAlpha = 1

      // Precedence: speaker color (who is talking) > sentiment (pos/neg) >
      // played/unplayed split. Speaker ranges win where present; sentiment then
      // colors the GAPS between speakers — so both hooks are honored.
      let speakerHit: WaveformSpeakerRange | undefined
      if (hasSpeakers) {
        speakerHit = speakerRanges!.find(
          (r) => timeForBar >= r.startTime && timeForBar < r.endTime
        )
        if (speakerHit) barColor = speakerHit.color
      }

      if (!speakerHit && sentimentData && sentimentData.length > 0) {
        const segment = sentimentData.find(
          (s) => timeForBar >= s.startTime && timeForBar < s.endTime
        )
        if (segment) {
          if (segment.sentiment === 'positive') {
            barColor = '#16A34A' // green-600 (AA on light + dark)
          } else if (segment.sentiment === 'negative') {
            barColor = '#DC2626' // red-600 (AA on light + dark)
          }
          // neutral keeps the played/unplayed split color
        }
      }

      // Unplayed portion is dimmed so the playhead progress still reads even when
      // bars carry a speaker/sentiment hue (which ignores the played split).
      if (!isPlayed && (speakerHit || (hasSpeakers === false && sentimentData?.length))) {
        barAlpha = 0.45
      }

      // Legend isolation: fade every bar that isn't the isolated speaker.
      if (isolatedSpeakerKey) {
        barAlpha = speakerHit && speakerHit.speakerKey === isolatedSpeakerKey ? 1 : 0.12
      }

      // Draw bar
      ctx.globalAlpha = barAlpha
      ctx.fillStyle = barColor
      ctx.fillRect(x, y, barWidth, barHeight)
      ctx.globalAlpha = 1
    }

    // Draw a strong, high-contrast playhead if currentTime provided
    if (currentTime !== undefined && currentTime > 0 && duration > 0) {
      const playheadX = (currentTime / duration) * width
      ctx.strokeStyle = colors.playhead
      ctx.lineWidth = 2
      ctx.beginPath()
      ctx.moveTo(playheadX, 0)
      ctx.lineTo(playheadX, height)
      ctx.stroke()
    }
  }, [audioData, sentimentData, speakerRanges, isolatedSpeakerKey, currentTime, duration, height, width])

  // Handle click to seek
  const handleClick = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!duration) return

    const canvas = canvasRef.current
    if (!canvas) return

    const rect = canvas.getBoundingClientRect()
    const clickX = e.clientX - rect.left
    const seekTime = (clickX / rect.width) * duration

    onSeek(seekTime)
  }

  return (
    <canvas
      ref={canvasRef}
      width={width}
      height={height}
      onClick={handleClick}
      className="w-full cursor-pointer"
      style={{ imageRendering: 'crisp-edges' }} // Sharp bars, no blur
    />
  )
}
