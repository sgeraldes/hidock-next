/**
 * ADV18 (round-19) — chat/RAG persisted-provenance ENVELOPE CORE.
 *
 * This module holds the ELIGIBILITY-FREE half of the chat provenance boundary:
 * the versioned `sources` envelope shape, its parser, the persist helpers, and
 * the F17 hard-purge at-rest scrub decision. It deliberately imports NOTHING from
 * recording-eligibility.ts (which imports database.ts) so that database.ts can
 * reuse the SAME envelope parser during a hard purge WITHOUT pulling the
 * recording-eligibility ⇄ database import cycle into database.ts.
 *
 * The eligibility-dependent read/resend decisions ({@link isProvenanceExcluded},
 * {@link revalidateStoredSources}) stay in `chat-source-provenance.ts`, which
 * re-exports everything here so external import paths are unchanged.
 *
 * Chat persists each assistant message together with serialized `sources`
 * (verbatim transcript excerpts). An ANSWER is synthesised across EVERY prompt
 * input — vector snippets, PINNED transcript context, and GRAPH facts — so the
 * persisted envelope carries a MESSAGE-LEVEL authoritative provenance union
 * (recordingIds + captureIds) computed over ALL prompt components. The envelope
 * is VERSIONED ({@link SOURCE_PROVENANCE_V}); any unknown/older version is treated
 * conservatively (unverifiable ⇒ fail-closed).
 */

/**
 * Envelope version marker. BUMPED to 2 for the round-19 message-level provenance
 * union (round-18 used v1 per-source `_prov`). A stored envelope whose `v` does
 * NOT equal this is treated as an unknown/older version → conservative
 * fail-closed on read (see {@link revalidateStoredSources}).
 */
export const SOURCE_PROVENANCE_V = 2

/** Shown in place of an assistant answer that referenced now-excluded sources. */
export const REDACTED_ANSWER =
  '[This response referenced sources that have since been excluded from the knowledge base.]'

/**
 * F17/ADV59-1 — the tombstone written into a `chat_messages.content` when a HARD
 * purge permanently deletes a source recording that a persisted RAG answer was
 * grounded on. The row is KEPT (so the conversation thread stays intact) but its
 * synthesized prose + provenance envelope are erased in the SAME purge
 * transaction. Distinct from {@link REDACTED_ANSWER} (a read-time exclusion
 * notice) — this is a durable AT-REST erasure marker.
 */
export const PURGE_TOMBSTONE = '[Removed: a source recording was permanently deleted.]'

/**
 * The authoritative, message-level provenance union for one assistant answer:
 * every recording/capture id that contributed to ANY prompt component (vector
 * snippets, pinned context, graph facts), resolved main-side at generation time.
 * `unverifiable` is set when a component's provenance could not be resolved
 * (e.g. a graph fact-provenance read threw, or a vector chunk had neither a
 * recording nor a capture id) → the whole message fails closed on read.
 */
export interface MessageProvenance {
  recordingIds: string[]
  captureIds: string[]
  unverifiable: boolean
}

/**
 * ADV19-1 (round-20) — the MAIN-ISSUED message-kind marker. EVERY persisted
 * role=assistant message carries an explicit envelope stamped MAIN-SIDE:
 *   • `rag`     — a RAG answer grounded on recordings/captures. Its `prov` union
 *                 drives redaction (redact on ANY excluded/unverifiable source).
 *   • `non-rag` — a genuine non-source assistant emit (error text, "no results",
 *                 greeting, status). It grounds on NOTHING, so it is TRUSTED and
 *                 preserved on read. The renderer cannot forge this: main derives
 *                 the kind from RAG pipeline state (see rag.ts consumeAssistantAnswer)
 *                 or issues it from the fixed notice catalog (assistant:addNotice),
 *                 never from renderer input, and always OWNS the content + envelope.
 * An assistant message WITHOUT a valid current-version envelope (null, `[]`,
 * legacy pre-v2, malformed, unknown version) is unverifiable ⇒ fail-closed redact.
 */
export type MessageKind = 'rag' | 'non-rag'

export interface ProvenanceEnvelope {
  v: number
  /** Main-issued message kind — 'rag' (redactable via `prov`) or 'non-rag' (trusted). */
  kind: MessageKind
  /** The plain renderer source objects shown as citation chips. */
  sources: Array<Record<string, unknown>>
  /** Authoritative union; `undefined` when the stored envelope's prov is malformed. */
  prov?: MessageProvenance
}

/** Normalize a provenance union for persistence: dedup, string-only ids, boolean flag. */
function normalizeProv(p: MessageProvenance): MessageProvenance {
  return {
    recordingIds: [...new Set((p.recordingIds ?? []).filter((i): i is string => typeof i === 'string' && !!i))],
    captureIds: [...new Set((p.captureIds ?? []).filter((i): i is string => typeof i === 'string' && !!i))],
    unverifiable: !!p.unverifiable
  }
}

/** Coerce a stored `prov` blob to a valid union, or `undefined` if malformed. */
function coerceProv(x: unknown): MessageProvenance | undefined {
  if (!x || typeof x !== 'object') return undefined
  const r = (x as { recordingIds?: unknown }).recordingIds
  const c = (x as { captureIds?: unknown }).captureIds
  if (!Array.isArray(r) || !Array.isArray(c)) return undefined
  return {
    recordingIds: r.filter((i): i is string => typeof i === 'string'),
    captureIds: c.filter((i): i is string => typeof i === 'string'),
    unverifiable: !!(x as { unverifiable?: unknown }).unverifiable
  }
}

/**
 * PERSIST a RAG assistant answer — wrap the renderer-supplied `sources` array
 * together with the authoritative provenance union in a versioned, MAIN-ISSUED
 * `kind:'rag'` envelope. An envelope is ALWAYS written — EVEN IF the sources array
 * is empty — so a pinned/graph-only answer is still verifiable (and redactable) on
 * read. Without `prov` (user messages) the raw sources are stored verbatim, or
 * null. Assistant messages MUST route through this (with a `prov`) or through
 * {@link packNonRagAssistant}; a raw/enveloped-less assistant blob fails closed.
 */
export function packSources(sourcesJson: string | null | undefined, prov?: MessageProvenance): string | null {
  if (prov) {
    let sources: unknown[] = []
    if (sourcesJson) {
      try {
        const parsed = JSON.parse(sourcesJson)
        if (Array.isArray(parsed)) sources = parsed
      } catch {
        /* keep [] — the union, not the chips, drives redaction */
      }
    }
    return JSON.stringify({ v: SOURCE_PROVENANCE_V, kind: 'rag', sources, prov: normalizeProv(prov) })
  }
  if (!sourcesJson) return null
  return sourcesJson
}

/**
 * PERSIST a genuine NON-RAG assistant emit (error text, "no results", greeting,
 * status) — a MAIN-ISSUED `kind:'non-rag'` envelope. It grounds on NOTHING, so it
 * is trusted and preserved on read. Only main may call this; the content + the
 * decision to stamp non-rag are main-owned — either the RAG service's stored error
 * text (rag.ts consumeAssistantAnswer) or a fixed catalog string (assistant:addNotice),
 * never renderer-supplied prose.
 */
export function packNonRagAssistant(): string {
  return JSON.stringify({ v: SOURCE_PROVENANCE_V, kind: 'non-rag', sources: [] })
}

/**
 * Parse a stored blob to the CURRENT-version, valid-kind envelope, or null if it
 * isn't one. A v2 blob missing/invalid `kind` (e.g. a pre-round-20 envelope) is
 * NOT a valid current envelope ⇒ null ⇒ fail-closed on the assistant read path.
 */
export function parseEnvelope(stored: string): ProvenanceEnvelope | null {
  let parsed: unknown
  try {
    parsed = JSON.parse(stored)
  } catch {
    return null
  }
  const kind = (parsed as { kind?: unknown })?.kind
  if (
    parsed &&
    typeof parsed === 'object' &&
    !Array.isArray(parsed) &&
    (parsed as ProvenanceEnvelope).v === SOURCE_PROVENANCE_V &&
    (kind === 'rag' || kind === 'non-rag') &&
    Array.isArray((parsed as ProvenanceEnvelope).sources)
  ) {
    return {
      v: SOURCE_PROVENANCE_V,
      kind,
      sources: (parsed as ProvenanceEnvelope).sources,
      prov: kind === 'rag' ? coerceProv((parsed as { prov?: unknown }).prov) : undefined
    }
  }
  return null
}

/**
 * Unpack the stored blob to the plain sources array the renderer expects, WITHOUT
 * eligibility revalidation. Used for the freshly-added message returned by
 * addMessage (nothing can be excluded yet).
 */
export function presentSourcesNoRevalidate(stored: string | null | undefined): string | null {
  if (!stored) return stored ?? null
  const env = parseEnvelope(stored)
  if (!env) return stored
  return JSON.stringify(env.sources)
}

/**
 * F17/ADV59-1 — the HARD-PURGE at-rest scrub decision for ONE `chat_messages`
 * row. Reuses the SAME v2 envelope parser as the read path ({@link parseEnvelope})
 * so the erasure decision and the read-time redaction decision cannot drift.
 *
 * Returns `true` (⇒ the caller must REDACT: tombstone the `content`, null the
 * `sources`) when this message may still carry the purged recording's synthesized
 * prose, verbatim excerpts, or provenance union:
 *   • role === 'assistant' AND the message has a sources blob present AND
 *     - it is a valid `kind:'rag'` envelope whose provenance UNION references
 *       `recordingId` OR any id in `captureIds`; OR
 *     - it is a `kind:'rag'` envelope whose `prov` union is absent/unverifiable
 *       (a rag answer we cannot prove does NOT reference R) — FAIL-CLOSED; OR
 *     - the blob is present but NOT a valid current-version envelope (legacy raw
 *       array / older version / malformed) — FAIL-CLOSED.
 *
 * Returns `false` (⇒ leave untouched) for: USER messages (thread turns are always
 * preserved), assistant messages with NO sources blob (null/empty — carry no
 * envelope/excerpts referencing R), valid `kind:'non-rag'` envelopes (ground on
 * nothing), and `kind:'rag'` envelopes whose VERIFIABLE union references only
 * SURVIVING recordings/captures.
 *
 * Matches by PARSED union membership (exact id equality) — never a substring —
 * so an id that merely shares a prefix with `recordingId` is not a false match.
 */
export function messageReferencesPurgedRecording(
  stored: string | null | undefined,
  role: string,
  recordingId: string,
  captureIds: readonly string[]
): boolean {
  if (role !== 'assistant') return false
  // No-sources assistant message (null/empty) → no envelope/excerpts to scrub.
  if (!stored) return false
  const env = parseEnvelope(stored)
  // Present but NOT a valid current-version envelope (legacy/older/malformed) ⇒
  // cannot prove it does NOT reference R ⇒ fail-closed redact.
  if (!env) return true
  // Main-issued non-rag grounds on nothing ⇒ never references R.
  if (env.kind === 'non-rag') return false
  // kind === 'rag' — an absent/unverifiable union can't be proven clean ⇒ redact.
  const prov = env.prov
  if (!prov || prov.unverifiable) return true
  if (prov.recordingIds.includes(recordingId)) return true
  if (captureIds.length) {
    const capSet = new Set(captureIds)
    for (const c of prov.captureIds) if (capSet.has(c)) return true
  }
  return false
}
