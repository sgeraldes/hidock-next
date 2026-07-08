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
}

/** Normalized cache key for a name lookup. */
export function mentionKey(name: string): string {
  return (name || '').trim().toLowerCase()
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
