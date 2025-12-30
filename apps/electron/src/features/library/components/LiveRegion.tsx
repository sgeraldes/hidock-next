/**
 * LiveRegion Component
 *
 * Announces dynamic updates to screen readers using ARIA live regions.
 * Provides accessible notifications for filter changes, download completion, etc.
 */

import { useEffect, useState } from 'react'

interface LiveRegionProps {
  message: string
  politeness?: 'polite' | 'assertive'
}

/**
 * A visually hidden live region that announces messages to screen readers.
 * The message is updated when the prop changes.
 */
export function LiveRegion({ message, politeness = 'polite' }: LiveRegionProps) {
  const [announcement, setAnnouncement] = useState('')

  useEffect(() => {
    if (message) {
      // Clear first to ensure the same message can be announced again
      setAnnouncement('')
      // Set the message after a brief delay to trigger the announcement
      const timer = setTimeout(() => setAnnouncement(message), 100)
      return () => clearTimeout(timer)
    }
    return undefined
  }, [message])

  return (
    <div
      role="status"
      aria-live={politeness}
      aria-atomic="true"
      className="sr-only"
    >
      {announcement}
    </div>
  )
}

/**
 * Hook to manage announcements for a live region.
 */
export function useAnnouncement() {
  const [message, setMessage] = useState('')

  const announce = (text: string) => {
    setMessage(text)
  }

  const clear = () => {
    setMessage('')
  }

  return { message, announce, clear }
}
