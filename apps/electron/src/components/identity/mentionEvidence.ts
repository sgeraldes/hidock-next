/**
 * Primary-source ("decidability") evidence for a suggestion: transcript excerpts
 * where a name literally occurs, and the co-presence disproof — when two variant
 * names appear in the SAME conversation they are almost certainly different people.
 * Pure and unit-tested; the backend supplies the raw {@link MentionResult}.
 */

export interface MentionSnippet {
  recordingId: string
  title: string
  date: string | null
  snippet: string
}

export interface MentionResult {
  snippets: MentionSnippet[]
  /** Every recording id whose transcript contains the name (not just the excerpted ones). */
  recordingIds: string[]
  /**
   * True when the transcript lookup itself failed (IPC error or timeout) rather
   * than succeeding with zero matches. Distinguishes "couldn't check" from "no
   * verbatim mentions". Absent/false means the lookup resolved.
   */
  error?: boolean
}

/** Normalized cache key for a name lookup. */
export function mentionKey(name: string): string {
  return (name || '').trim().toLowerCase()
}

/** The distinct terminal (or transient) states of a name's transcript lookup. */
export type MentionState = 'loading' | 'error' | 'mentions' | 'extracted'

export interface MentionStatus {
  state: MentionState
  text: string
}

/**
 * One-line transcript-evidence status for a name. `undefined` means the lookup is
 * still in flight — a transient state, never terminal. A resolved lookup with zero
 * verbatim matches is reported as "extracted from meeting analysis" (many names,
 * e.g. analysis participants, are correct yet never spoken verbatim); an errored or
 * timed-out lookup is reported distinctly so it never masquerades as "no mentions".
 */
export function mentionStatus(mentions: MentionResult | undefined): MentionStatus {
  if (!mentions) return { state: 'loading', text: 'checking transcripts…' }
  if (mentions.error) return { state: 'error', text: "Couldn't check transcripts" }
  const count = mentions.recordingIds.length
  if (count > 0) {
    return { state: 'mentions', text: `appears in ${count} recording${count === 1 ? '' : 's'}` }
  }
  return { state: 'extracted', text: 'No verbatim mentions — extracted from meeting analysis' }
}

export interface CoMention {
  /** True when both names occur in at least one shared recording. */
  coMention: boolean
  /** The shared recording ids (decisive negative evidence when non-empty). */
  recordingIds: string[]
}

/**
 * Intersect the recording-id sets of two names. A non-empty intersection is the
 * co-presence disproof: the two spellings were both spoken in one conversation.
 */
export function computeCoMention(a: MentionResult | undefined, b: MentionResult | undefined): CoMention {
  if (!a || !b || a.recordingIds.length === 0 || b.recordingIds.length === 0) {
    return { coMention: false, recordingIds: [] }
  }
  const setB = new Set(b.recordingIds)
  const shared = [...new Set(a.recordingIds)].filter((id) => setB.has(id))
  return { coMention: shared.length > 0, recordingIds: shared }
}
