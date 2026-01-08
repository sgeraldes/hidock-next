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

export interface WaveformCanvasProps {
  /** PCM audio samples for amplitude-based waveform */
  audioData: Float32Array | null
  /** Optional sentiment analysis data for color coding */
  sentimentData?: SentimentSegment[]
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
 * WaveformCanvas - Renders simple vertical bar waveform
 *
 * Features:
 * - Vertical bars (3px wide, 1px gap) based on audio amplitude
 * - Monochromatic gray/blue by default (#94A3B8)
 * - Sentiment coloring: Red (negative), Green (positive), Gray (neutral)
 * - Click-to-seek functionality
 * - Optional playhead indicator
 */
export function WaveformCanvas({
  audioData,
  sentimentData,
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

    // Default monochrome color (Tailwind slate-400)
    const defaultColor = '#94A3B8'

    // Draw bars
    for (let i = 0; i < barCount; i++) {
      // Sample audio data for this bar
      const dataIndex = Math.floor((i / barCount) * audioData.length)
      const amplitude = Math.abs(audioData[dataIndex] || 0)
      const barHeight = Math.max(2, amplitude * height * 0.9) // Min 2px, max 90% height
      const x = i * (barWidth + barGap)
      const y = (height - barHeight) / 2 // Center vertically

      // Determine bar color based on sentiment (if available)
      let barColor = defaultColor

      if (sentimentData && sentimentData.length > 0) {
        const timeForBar = (i / barCount) * duration
        const segment = sentimentData.find(
          (s) => timeForBar >= s.startTime && timeForBar < s.endTime
        )

        if (segment) {
          if (segment.sentiment === 'positive') {
            barColor = '#22C55E' // Tailwind green-500
          } else if (segment.sentiment === 'negative') {
            barColor = '#EF4444' // Tailwind red-500
          }
          // neutral stays default color
        }
      }

      // Draw bar
      ctx.fillStyle = barColor
      ctx.fillRect(x, y, barWidth, barHeight)
    }

    // Draw subtle playhead if currentTime provided
    if (currentTime !== undefined && currentTime > 0 && duration > 0) {
      const playheadX = (currentTime / duration) * width
      ctx.strokeStyle = 'rgba(0, 0, 0, 0.3)' // Subtle dark line
      ctx.lineWidth = 1
      ctx.beginPath()
      ctx.moveTo(playheadX, 0)
      ctx.lineTo(playheadX, height)
      ctx.stroke()
    }
  }, [audioData, sentimentData, currentTime, duration, height, width])

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
