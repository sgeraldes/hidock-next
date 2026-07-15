/**
 * ADV18 (round-19) — comprehensive chat/RAG persisted-provenance boundary.
 *
 * Chat persists each assistant message together with serialized `sources`
 * (verbatim transcript excerpts). An ANSWER, however, is synthesised across
 * EVERY prompt input — not just the vector snippets shown as chips, but also
 * PINNED transcript context and GRAPH facts. It therefore inherits the STRICTEST
 * source's eligibility: if ANY contributing source is later excluded (personal /
 * trashed / value-excluded) OR its provenance is unverifiable, the whole answer
 * must be redacted — keeping the prose because one source survived would leak the
 * excluded source's content that is woven into it.
 *
 * Round-18's envelope was too weak in three ways; round-19 hardens it:
 *   1. PROVENANCE UNION — the persisted envelope now carries a MESSAGE-LEVEL
 *      authoritative provenance union (recordingIds + captureIds) computed by the
 *      RAG service over ALL prompt components (vector + pinned + graph), NOT a
 *      per-source blob derived from mutable meetingIds. If any component could not
 *      be resolved the union is marked `unverifiable`.
 *   2. REDACT-ON-ANY — an assistant answer is redacted whenever ANY contributing
 *      recording/capture is excluded OR the union is unverifiable (legacy message
 *      with no envelope, malformed/parse-error envelope, older envelope version,
 *      or a component marked unverifiable). Role=user text is ALWAYS preserved.
 *   3. SHARED DECISION — {@link isProvenanceExcluded} is the ONE fail-closed
 *      routine used by every read/resend path (assistant:getMessages,
 *      db:get-chat-history, AND the rag.ts conversation-history resend) so they
 *      cannot drift.
 *
 * Schema stays v43: the envelope rides INSIDE the existing `chat_messages.sources`
 * TEXT column. The envelope is VERSIONED ({@link SOURCE_PROVENANCE_V}); any
 * unknown/older version is treated conservatively (unverifiable ⇒ fail-closed).
 */

import { filterEligibleRecordingIds, filterEligibleCaptureIds } from './recording-eligibility'

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

interface ProvenanceEnvelope {
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
 * THE shared fail-closed decision, used by every read/resend path so they cannot
 * diverge. Returns true (⇒ redact the answer / drop the history entry) when the
 * provenance union is absent, unverifiable, or references ANY recording/capture
 * that is no longer eligible. Fail-closed on any eligibility-lookup error
 * (filterEligible* already fail closed → failClosed forces true). An EMPTY,
 * verifiable union (no attributable sources — e.g. an answer grounded only on
 * legacy zero-provenance graph facts, or "no relevant transcripts found") is NOT
 * excluded — nothing excludable contributed.
 */
export function isProvenanceExcluded(prov: MessageProvenance | undefined): boolean {
  if (!prov || prov.unverifiable) return true
  if (prov.recordingIds.length) {
    const rec = filterEligibleRecordingIds(prov.recordingIds)
    if (rec.failClosed) return true
    for (const id of prov.recordingIds) if (!rec.eligible.has(id)) return true
  }
  if (prov.captureIds.length) {
    const cap = filterEligibleCaptureIds(prov.captureIds)
    if (cap.failClosed) return true
    for (const id of prov.captureIds) if (!cap.eligible.has(id)) return true
  }
  return false
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
function parseEnvelope(stored: string): ProvenanceEnvelope | null {
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
 * READ — revalidate a stored sources blob against the shared boundary. Returns
 * the sanitized sources JSON for the renderer plus whether the assistant answer
 * content must be redacted.
 *
 * Policy (ADV19-1, round-20) — for an ASSISTANT message we FAIL CLOSED: the answer
 * is trusted ONLY when the blob is a valid CURRENT-VERSION MAIN-ISSUED envelope
 * that is EITHER `kind:'non-rag'` (grounds on nothing) OR `kind:'rag'` with a
 * verifiable, fully-eligible provenance union. Everything else — null, `[]`, a
 * legacy pre-v2 raw array, an older/unknown envelope version, a malformed blob, or
 * a `kind:'rag'` union that is unverifiable / references ANY excluded
 * recording/capture — is redacted (whole answer + all chips dropped).
 *
 * ADV21 (round-22) — EXACT role handling, fail-closed for unknown roles:
 *   • exact 'user'      — user-authored text, ALWAYS preserved verbatim.
 *   • exact 'assistant' — envelope/provenance redaction (below).
 *   • ANY OTHER value   — a legacy/unknown/smuggled role ('system', 'Assistant',
 *     ' assistant ', '', null, non-string) ⇒ FAIL CLOSED (redact content + drop
 *     chips). This protects pre-existing rows persisted with a non-standard role
 *     and anything that somehow bypassed the write allowlist.
 */
export function revalidateStoredSources(
  stored: string | null | undefined,
  role: string
): { sources: string | null; redactContent: boolean } {
  // User-authored text is ALWAYS preserved verbatim (never redacted, envelope or
  // not — the renderer never packs a user message with a provenance envelope).
  if (role === 'user') return { sources: stored ?? null, redactContent: false }

  // Not exactly 'user' and not exactly 'assistant' ⇒ unknown/smuggled role ⇒ fail
  // closed (redact). Never preserve content for a role we do not explicitly trust.
  if (role !== 'assistant') return { sources: '[]', redactContent: true }

  // ASSISTANT — only a valid current-version main-issued envelope is trusted.
  const env = stored ? parseEnvelope(stored) : null
  if (env) {
    if (env.kind === 'non-rag') {
      // Main issued this; it grounds on nothing → trusted, never redacted.
      return { sources: '[]', redactContent: false }
    }
    // kind === 'rag' — a malformed/absent `prov` ⇒ coerceProv returned undefined ⇒
    // isProvenanceExcluded fails closed. Redact on ANY excluded/unverifiable source.
    if (isProvenanceExcluded(env.prov)) return { sources: '[]', redactContent: true }
    return { sources: JSON.stringify(env.sources), redactContent: false }
  }

  // Not a valid current-version envelope (null, [], legacy raw array, older/unknown
  // version, malformed/parse-error) ⇒ unverifiable ⇒ fail-closed redact.
  return { sources: '[]', redactContent: true }
}
