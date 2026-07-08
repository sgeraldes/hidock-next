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

/**
 * A phrase describing how the two names relate, or null when they are unrelated.
 * Prefers a concrete containment ("'Sergi' is part of 'Sergio'"); otherwise leans
 * on the resolver's name signal for accent/spelling similarity.
 */
function namePhrase(candidateName: string, keeperName: string, nameSignal?: number): string | null {
  const a = norm(candidateName)
  const b = norm(keeperName)
  if (!a || !b) return null
  if (a === b) return 'identical names'

  const [short, long] = a.length <= b.length ? [a, b] : [b, a]
  if (short.length >= 3 && long.includes(short)) {
    const shortDisplay = short === a ? candidateName : keeperName
    const longDisplay = long === a ? candidateName : keeperName
    return `'${shortDisplay.trim()}' is part of '${longDisplay.trim()}'`
  }

  const sig = nameSignal ?? 0
  if (sig >= 0.9) return 'the same name spelled differently'
  if (sig >= 0.7) return 'very similar spelling'
  if (sig > 0) return 'similar names'
  return null
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
