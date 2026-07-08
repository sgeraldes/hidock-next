/**
 * Formatter for ICS meeting descriptions.
 *
 * Outlook/Exchange ICS descriptions arrive as plain text carrying pseudo-markdown:
 * bullet markers on their own line above the text they belong to, runs of blank
 * lines, and bare meeting URLs embedded in prose. This module turns that into
 * structured blocks (paragraphs + lists) with URLs split out as link tokens, so
 * the UI can render real `<ul>`/`<a>` instead of stray `*` characters.
 */

export type DescToken =
  | { kind: 'text'; value: string }
  | { kind: 'link'; value: string; href: string }

export interface DescBlock {
  type: 'paragraph' | 'list'
  /** Paragraph: one entry per wrapped line. List: one entry per bullet item. */
  lines: DescToken[][]
}

// A URL run, stopping before trailing sentence punctuation so "…meet). " keeps
// the paren/period out of the href.
const URL_RE = /(https?:\/\/[^\s<>()"']+)/gi
const TRAILING_PUNCT = /[.,;:!?)\]]+$/

/** Split a single line of text into text and link tokens. */
export function linkify(text: string): DescToken[] {
  const tokens: DescToken[] = []
  let last = 0
  for (const match of text.matchAll(URL_RE)) {
    const idx = match.index ?? 0
    let url = match[0]
    // Peel trailing punctuation back into the surrounding text.
    const trail = url.match(TRAILING_PUNCT)?.[0] ?? ''
    if (trail) url = url.slice(0, url.length - trail.length)
    if (idx > last) tokens.push({ kind: 'text', value: text.slice(last, idx) })
    tokens.push({ kind: 'link', value: url, href: url })
    if (trail) tokens.push({ kind: 'text', value: trail })
    last = idx + match[0].length
  }
  if (last < text.length) tokens.push({ kind: 'text', value: text.slice(last) })
  if (tokens.length === 0) tokens.push({ kind: 'text', value: text })
  return tokens
}

const LONE_MARKER_RE = /^[*\-•·]$/
const BULLET_LINE_RE = /^[*\-•·]\s+(.*)$/

/**
 * Normalize raw description text into clean lines:
 *  - a lone bullet marker (`*` on its own line) is joined with the next
 *    non-empty line to form one `- item` bullet,
 *  - existing bullets are normalized to a leading `- `,
 *  - runs of blank lines collapse to a single blank, and leading/trailing
 *    blank lines are trimmed.
 */
export function normalizeDescriptionLines(raw: string): string[] {
  const rawLines = raw.replace(/\r\n?/g, '\n').split('\n')
  const merged: string[] = []

  for (let i = 0; i < rawLines.length; i++) {
    const trimmed = rawLines[i].trim()

    if (LONE_MARKER_RE.test(trimmed)) {
      let j = i + 1
      while (j < rawLines.length && rawLines[j].trim() === '') j++
      if (j < rawLines.length) {
        merged.push(`- ${rawLines[j].trim()}`)
        i = j
      }
      // A lone marker with nothing after it is dropped.
      continue
    }

    const bullet = trimmed.match(BULLET_LINE_RE)
    merged.push(bullet ? `- ${bullet[1].trim()}` : trimmed)
  }

  // Collapse consecutive blanks to a single blank.
  const collapsed: string[] = []
  let sawBlank = false
  for (const line of merged) {
    if (line === '') {
      if (!sawBlank) collapsed.push('')
      sawBlank = true
    } else {
      collapsed.push(line)
      sawBlank = false
    }
  }
  while (collapsed.length && collapsed[0] === '') collapsed.shift()
  while (collapsed.length && collapsed[collapsed.length - 1] === '') collapsed.pop()
  return collapsed
}

/** Parse a raw ICS description into renderable paragraph/list blocks. */
export function parseDescriptionBlocks(raw: string | null | undefined): DescBlock[] {
  if (!raw || !raw.trim()) return []
  const lines = normalizeDescriptionLines(raw)
  const blocks: DescBlock[] = []
  let list: DescToken[][] | null = null
  let para: DescToken[][] | null = null

  const flushList = () => {
    if (list) {
      blocks.push({ type: 'list', lines: list })
      list = null
    }
  }
  const flushPara = () => {
    if (para) {
      blocks.push({ type: 'paragraph', lines: para })
      para = null
    }
  }

  for (const line of lines) {
    if (line === '') {
      flushList()
      flushPara()
      continue
    }
    const bullet = line.match(/^- (.*)$/)
    if (bullet) {
      flushPara()
      ;(list ??= []).push(linkify(bullet[1]))
    } else {
      flushList()
      ;(para ??= []).push(linkify(line))
    }
  }
  flushList()
  flushPara()
  return blocks
}

// A line made up only of separator/marker characters (horizontal rules like
// "______" or "------", stray bullets, "===" dividers) carries no meaning —
// Teams/Outlook descriptions routinely open with these.
const SEPARATOR_ONLY_RE = /^[\s*_=~–—-]+$/

/**
 * The first human-meaningful line of a description, for a one-line summary such
 * as the Today row's secondary line. Reuses {@link normalizeDescriptionLines}
 * (so lone bullet markers are folded into their text and blank runs collapse),
 * then skips separator/rule junk and returns the first line with real content,
 * stripped of any leading bullet marker. Empty when nothing meaningful remains.
 */
export function firstMeaningfulLine(description: string | null | undefined): string {
  if (!description) return ''
  for (const line of normalizeDescriptionLines(description)) {
    const text = line.replace(/^-\s+/, '').trim()
    if (text && !SEPARATOR_ONLY_RE.test(text)) return text
  }
  return ''
}

// Known video-conferencing hosts whose links are worth surfacing as "Join".
const MEETING_HOST_RE = /(teams\.microsoft\.com|teams\.live\.com|zoom\.us|meet\.google\.com|webex\.com|whereby\.com|gotomeeting\.com)/i

/**
 * Extract the first video-conferencing URL from a description (Teams meetings
 * embed the join link in the body rather than a dedicated field). Returns the
 * URL with any trailing punctuation stripped, or null when none is present.
 */
export function extractMeetingUrl(text: string | null | undefined): string | null {
  if (!text) return null
  for (const match of text.matchAll(URL_RE)) {
    const url = match[0].replace(TRAILING_PUNCT, '')
    if (MEETING_HOST_RE.test(url)) return url
  }
  return null
}
