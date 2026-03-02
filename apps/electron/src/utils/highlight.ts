/**
 * Text highlighting utility for search result display.
 *
 * Wraps matched search terms in text with <mark> tags for visual highlighting.
 * Handles multi-term queries, special regex characters, and edge cases.
 *
 * SECURITY: All input text is HTML-escaped before highlight markers are inserted,
 * preventing XSS when used with dangerouslySetInnerHTML.
 */

/**
 * Escapes special regex characters in a string so it can be safely used
 * in a RegExp constructor.
 */
function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/**
 * Escapes HTML entities to prevent XSS when the result is rendered via
 * dangerouslySetInnerHTML. This is applied BEFORE highlight markers are
 * inserted, so the <mark> tags themselves are not escaped.
 */
function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

/**
 * Wraps occurrences of `query` terms in `text` with `<mark>` tags.
 *
 * Splits the query into individual terms and highlights each occurrence.
 * The matching is case-insensitive. Input text is HTML-escaped first to
 * prevent XSS, making this safe for use with dangerouslySetInnerHTML.
 *
 * @param text - The text to search within
 * @param query - The search query (may contain multiple space-separated terms)
 * @returns HTML string with matched terms wrapped in <mark> tags (XSS-safe)
 *
 * @example
 * highlightMatch('Hello World', 'hello')
 * // => '<mark>Hello</mark> World'
 *
 * highlightMatch('API Design meeting notes', 'API notes')
 * // => '<mark>API</mark> Design meeting <mark>notes</mark>'
 */
export function highlightMatch(text: string, query: string): string {
  if (!text || !query || !query.trim()) {
    return escapeHtml(text || '')
  }

  // Split query into individual terms, filter empty strings
  const terms = query
    .trim()
    .split(/\s+/)
    .filter((t) => t.length > 0)

  if (terms.length === 0) {
    return escapeHtml(text)
  }

  // HTML-escape the text first to prevent XSS
  const safeText = escapeHtml(text)

  // Build a single regex that matches any of the terms (case-insensitive)
  // Note: terms are also HTML-escaped so they match against the escaped text
  const escapedTerms = terms.map((t) => escapeRegex(escapeHtml(t)))
  const pattern = new RegExp(`(${escapedTerms.join('|')})`, 'gi')

  return safeText.replace(pattern, '<mark>$1</mark>')
}
