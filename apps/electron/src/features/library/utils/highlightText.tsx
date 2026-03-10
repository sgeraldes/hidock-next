/**
 * highlightText Utility
 *
 * Returns React elements with matching portions of text wrapped in <mark> tags
 * for visual highlighting of search query matches in the Library list.
 *
 * Supports multi-token queries: "Sofia Connect" highlights "Sofia" and "Connect"
 * independently wherever they appear in the text.
 */

import React from 'react'

/**
 * Highlights portions of text that match the given query.
 * The query is split on whitespace into tokens; each token is highlighted
 * independently. Returns React nodes with <mark> elements around matches.
 *
 * If query is empty or no tokens match, returns the original text string.
 */
export function highlightText(text: string, query: string): React.ReactNode {
  if (!query || query.length === 0) return text

  const tokens = query.toLowerCase().split(/\s+/).filter((t) => t.length > 0)
  if (tokens.length === 0) return text

  // Build alternation regex from all tokens
  const escapedTokens = tokens.map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
  const regex = new RegExp(`(${escapedTokens.join('|')})`, 'gi')
  const parts = text.split(regex)

  if (parts.length === 1) return text

  const tokenSet = new Set(tokens)

  return (
    <>
      {parts.map((part, i) =>
        tokenSet.has(part.toLowerCase()) ? (
          <mark key={i} className="bg-yellow-200 dark:bg-yellow-800 rounded-sm px-0.5">
            {part}
          </mark>
        ) : (
          <React.Fragment key={i}>{part}</React.Fragment>
        )
      )}
    </>
  )
}
