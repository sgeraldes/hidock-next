/**
 * Turns a suggestion's evidence blob into short, human-readable reasons a person
 * can actually judge — replacing the opaque "matched by fuzzy". Pure and unit-
 * tested; the component renders the returned phrases as a bulleted list and the
 * shared topics as chips (see {@link topicChips}).
 */

export type EmailMatch = 'exact' | 'local' | 'conflict' | 'none'

/** Best-effort shape of a discovery/resolver evidence blob (all fields optional). */
export interface SuggestionEvidence {
  method?: string
  meetingId?: string
  coOccurring?: string[]
  signals?: { name?: number; email?: number; role?: number; graph?: number }
  composite?: number
  autoMergeable?: boolean
  keeperId?: string
  keeperName?: string
  loserId?: string
  loserName?: string
  emailMatch?: EmailMatch
  roleOverlap?: string[]
  sharedMeetings?: number
  sharedTopics?: string[]
  superseded?: boolean
  /** Name base-rate label from the resolver/discovery — 'common' triggers a caution. */
  rarity?: 'common' | 'rare'
}

/** Safely parse the evidence JSON string; never throws. */
export function parseEvidence(raw: string | null | undefined): SuggestionEvidence {
  if (!raw) return {}
  try {
    const parsed = JSON.parse(raw)
    return parsed && typeof parsed === 'object' ? (parsed as SuggestionEvidence) : {}
  } catch {
    return {}
  }
}

const norm = (s: string): string => s.toLowerCase().trim().replace(/\s+/g, ' ')

/** Title-case a lowercase role token phrase ("project manager" → "Project Manager"). */
function titleCase(s: string): string {
  return s.replace(/\b\w/g, (c) => c.toUpperCase())
}

/** Combining diacritical marks (U+0300–U+036F); built from escapes to keep the source ASCII. */
const COMBINING_MARKS = new RegExp('[\\u0300-\\u036f]', 'g')

/** Drop diacritics for accent-insensitive comparison ("Jose" with accent → "jose"). */
function stripAccents(s: string): string {
  return s.normalize('NFD').replace(COMBINING_MARKS, '')
}

/** Levenshtein edit distance between two strings. */
function editDistance(a: string, b: string): number {
  const m = a.length
  const n = b.length
  if (m === 0) return n
  if (n === 0) return m
  let prev = Array.from({ length: n + 1 }, (_, j) => j)
  let curr = new Array<number>(n + 1)
  for (let i = 1; i <= m; i++) {
    curr[0] = i
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1
      curr[j] = Math.min(prev[j] + 1, curr[j - 1] + 1, prev[j - 1] + cost)
    }
    ;[prev, curr] = [curr, prev]
  }
  return prev[n]
}

/**
 * A phrase describing how the two names relate, computed from the names themselves
 * so it works even when the resolver supplied no numeric signal. In priority order:
 * identical → containment ("'Sergi' is part of 'Sergio'") → accent variant → a 1–2
 * character difference ("'Nouman' is one letter from 'Nauman'"). Falls back to the
 * generic "similar names" only when a name signal exists but none of the concrete
 * relationships apply, and to null only when a name is missing.
 */
function namePhrase(candidateName: string, keeperName: string, nameSignal?: number): string | null {
  const a = norm(candidateName)
  const b = norm(keeperName)
  if (!a || !b) return null
  if (a === b) return 'identical names'

  // Containment: one name is wholly inside the other (nickname / partial spelling).
  const [short, long] = a.length <= b.length ? [a, b] : [b, a]
  if (short.length >= 3 && long.includes(short)) {
    const shortDisplay = short === a ? candidateName : keeperName
    const longDisplay = long === a ? candidateName : keeperName
    return `'${shortDisplay.trim()}' is part of '${longDisplay.trim()}'`
  }

  // Accent variant: identical once diacritics are removed ("Óscar" vs "Oscar").
  if (stripAccents(a) === stripAccents(b)) return 'same name with/without accents'

  // A small spelling difference the reader can verify at a glance.
  const dist = editDistance(a, b)
  if (dist === 1) return `'${candidateName.trim()}' is one letter from '${keeperName.trim()}'`
  if (dist === 2) return `'${candidateName.trim()}' is two letters from '${keeperName.trim()}'`

  // No concrete relationship — only assert similarity if the resolver flagged one.
  return (nameSignal ?? 0) > 0 ? 'similar names' : null
}

/** Role-overlap phrase from the shared normalized role tokens ("both Project Manager"). */
function rolePhrase(roleOverlap?: string[]): string | null {
  if (!roleOverlap || roleOverlap.length === 0) return null
  return `both ${titleCase(roleOverlap.join(' '))}`
}

/** Shared-meeting count phrase ("3 shared meetings"). */
function meetingsPhrase(sharedMeetings?: number): string | null {
  if (!sharedMeetings || sharedMeetings <= 0) return null
  return `${sharedMeetings} shared meeting${sharedMeetings === 1 ? '' : 's'}`
}

/** Email-relation phrase; a conflicting email is surfaced as a caution. */
function emailPhrase(emailMatch?: EmailMatch): string | null {
  switch (emailMatch) {
    case 'exact':
      return 'same email address'
    case 'local':
      return 'same email name, different domain'
    case 'conflict':
      return 'different email addresses (caution)'
    default:
      return null
  }
}

/**
 * Compose the ordered, human-readable reasons for a suggestion. `candidateName`
 * is the name under review; `keeperName` is the entity it may fold into.
 */
export function evidenceToPhrases(
  evidence: SuggestionEvidence,
  candidateName: string,
  keeperName: string
): string[] {
  const phrases: string[] = []
  const name = namePhrase(candidateName, keeperName, evidence.signals?.name)
  if (name) phrases.push(name)
  const role = rolePhrase(evidence.roleOverlap)
  if (role) phrases.push(role)
  const meetings = meetingsPhrase(evidence.sharedMeetings)
  if (meetings) phrases.push(meetings)
  const email = emailPhrase(evidence.emailMatch)
  if (email) phrases.push(email)

  // Legacy resolver evidence has no signals — fall back to a plain method note.
  if (phrases.length === 0 && evidence.method) {
    phrases.push(`matched by ${evidence.method.replace(/_/g, ' ')}`)
  }
  return phrases
}

/** The shared topics to render as chips (capped). */
export function topicChips(evidence: SuggestionEvidence, max = 3): string[] {
  return (evidence.sharedTopics ?? []).filter(Boolean).slice(0, max)
}
