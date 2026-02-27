import { useState, useEffect } from 'react'

/**
 * Hook that returns the current date and updates at midnight
 * Ensures "today" is always accurate even if the app runs overnight
 */
export function useToday(): Date {
  const [today, setToday] = useState(() => new Date())

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
      const interval = setInterval(() => {
        setToday(new Date())
      }, 24 * 60 * 60 * 1000) // 24 hours

      return () => clearInterval(interval)
    }, msUntilMidnight)

    return () => clearTimeout(timer)
  }, [])

  return today
}
