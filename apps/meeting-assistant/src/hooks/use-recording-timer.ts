import { useState, useEffect } from 'react'

function formatElapsed(seconds: number): string {
  const h = Math.floor(seconds / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  const s = seconds % 60
  return [h, m, s].map((v) => String(v).padStart(2, '0')).join(':')
}

/**
 * Returns a formatted elapsed-time string ("HH:MM:SS") that ticks every
 * second while `startedAt` is non-null.
 *
 * @param startedAt  Unix timestamp (ms) of when recording began, or null.
 */
export function useRecordingTimer(startedAt: number | null): string {
  const [elapsed, setElapsed] = useState<number>(0)

  useEffect(() => {
    if (startedAt === null) {
      setElapsed(0)
      return
    }

    // Compute immediately so the display is correct on the first render.
    const compute = () => Math.floor((Date.now() - startedAt) / 1000)
    setElapsed(compute())

    const id = setInterval(() => {
      setElapsed(compute())
    }, 1000)

    return () => clearInterval(id)
  }, [startedAt])

  return formatElapsed(elapsed)
}
