import { useState, useEffect, useRef } from 'react'

/**
 * Hook that returns the current date and updates at midnight
 * Ensures "today" is always accurate even if the app runs overnight
 *
 * C-CAL-011: Fixed interval leak - the setInterval created inside setTimeout
 * was never cleaned up on unmount because the cleanup function returned from
 * inside setTimeout is ignored (it's not the useEffect cleanup). Now uses a
 * ref to track the interval ID so both timer and interval are properly cleaned up.
 */
export function useToday(): Date {
  const [today, setToday] = useState(() => new Date())
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null)

  useEffect(() => {
    // Calculate milliseconds until next midnight
    const now = new Date()
    const tomorrow = new Date(now)
    tomorrow.setHours(24, 0, 0, 0)
    const msUntilMidnight = tomorrow.getTime() - now.getTime()

    // Set timer to update at midnight
    const timer = setTimeout(() => {
      setToday(new Date())

      // Set up daily refresh interval
      intervalRef.current = setInterval(() => {
        setToday(new Date())
      }, 24 * 60 * 60 * 1000) // 24 hours
    }, msUntilMidnight)

    return () => {
      clearTimeout(timer)
      if (intervalRef.current) {
        clearInterval(intervalRef.current)
        intervalRef.current = null
      }
    }
  }, [])

  return today
}
