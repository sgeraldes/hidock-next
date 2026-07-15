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

interface ProvenanceEnvelope {
  v: number
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
 * PERSIST — wrap an assistant answer's renderer-supplied `sources` array together
 * with the authoritative provenance union in a versioned envelope. When `prov`
 * is supplied (an assistant answer from the RAG service), an envelope is ALWAYS
 * written — EVEN IF the sources array is empty — so a pinned/graph-only answer is
 * still verifiable (and redactable) on read. Without `prov` (user messages, error
 * messages, non-RAG writes) the raw sources are stored verbatim, or null.
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
    return JSON.stringify({ v: SOURCE_PROVENANCE_V, sources, prov: normalizeProv(prov) })
  }
  if (!sourcesJson) return null
  return sourcesJson
}

/** Parse a stored blob to the CURRENT-version envelope, or null if it isn't one. */
function parseEnvelope(stored: string): ProvenanceEnvelope | null {
  let parsed: unknown
  try {
    parsed = JSON.parse(stored)
  } catch {
    return null
  }
  if (
    parsed &&
    typeof parsed === 'object' &&
    !Array.isArray(parsed) &&
    (parsed as ProvenanceEnvelope).v === SOURCE_PROVENANCE_V &&
    Array.isArray((parsed as ProvenanceEnvelope).sources)
  ) {
    return {
      v: SOURCE_PROVENANCE_V,
      sources: (parsed as ProvenanceEnvelope).sources,
      prov: coerceProv((parsed as { prov?: unknown }).prov)
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
 * content must be redacted. Policy (round-19): redact the ENTIRE assistant answer
 * (and drop ALL chips) whenever ANY contributing source is excluded OR the
 * provenance is unverifiable. User-authored text is never redacted.
 */
export function revalidateStoredSources(
  stored: string | null | undefined,
  role: string
): { sources: string | null; redactContent: boolean } {
  if (!stored) return { sources: stored ?? null, redactContent: false }

  const isAssistant = role === 'assistant'

  const env = parseEnvelope(stored)
  if (env) {
    // A malformed/absent `prov` inside a current-version envelope ⇒ coerceProv
    // returned undefined ⇒ isProvenanceExcluded fails closed.
    const redact = isAssistant && isProvenanceExcluded(env.prov)
    if (redact) return { sources: '[]', redactContent: true }
    return { sources: JSON.stringify(env.sources), redactContent: false }
  }

  // NOT a current-version envelope: a legacy raw array, an older/unknown envelope
  // version, or a malformed blob. User text is always preserved. For an assistant
  // message we fail closed: unverifiable provenance ⇒ redact whenever the blob
  // carries any sources payload (an empty '[]' grounds nothing → keep).
  if (!isAssistant) return { sources: stored, redactContent: false }

  let parsed: unknown
  try {
    parsed = JSON.parse(stored)
  } catch {
    // Malformed/parse-error blob on an assistant message → cannot verify → redact.
    return { sources: '[]', redactContent: true }
  }
  const hasSourcesPayload =
    (Array.isArray(parsed) && parsed.length > 0) ||
    (!!parsed && typeof parsed === 'object' && !Array.isArray(parsed))
  if (hasSourcesPayload) return { sources: '[]', redactContent: true }
  return { sources: stored, redactContent: false }
}
