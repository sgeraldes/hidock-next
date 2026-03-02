/**
 * highlightText Utility
 *
 * Returns React elements with matching portions of text wrapped in <mark> tags
 * for visual highlighting of search query matches in the Library list.
 */

import React from 'react'

/**
 * Highlights portions of text that match the given query.
 * Returns React nodes with <mark> elements around matching segments.
 *
 * If query is empty or not found, returns the original text string.
 */
export function highlightText(text: string, query: string): React.ReactNode {
  if (!query || query.length === 0) {
    return text
  }

  // Escape special regex characters in the query
  const escapedQuery = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const regex = new RegExp(`(${escapedQuery})`, 'gi')
  const parts = text.split(regex)

  if (parts.length === 1) {
    // No match found
    return text
  }

  return (
    <>
      {parts.map((part, i) => {
        const isMatch = part.toLowerCase() === query.toLowerCase()
        return isMatch ? (
          <mark key={i} className="bg-yellow-200 dark:bg-yellow-800 rounded-sm px-0.5">
            {part}
          </mark>
        ) : (
          <React.Fragment key={i}>{part}</React.Fragment>
        )
      })}
    </>
  )
}
