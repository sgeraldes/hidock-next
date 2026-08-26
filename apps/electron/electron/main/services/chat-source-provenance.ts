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
 *
 * ADV59-1 (round-61) — the ELIGIBILITY-FREE envelope parser + persist helpers +
 * the F17 hard-purge at-rest scrub decision now live in
 * `chat-source-provenance-core.ts` (which imports NOTHING from
 * recording-eligibility.ts) so database.ts can reuse the SAME parser during a
 * hard purge without dragging the recording-eligibility ⇄ database cycle into it.
 * This module re-exports the core so external import paths are unchanged, and
 * keeps ONLY the two eligibility-dependent read/resend decisions below.
 */

import { filterEligibleRecordingIds, filterEligibleCaptureIds } from './recording-eligibility'
import { parseEnvelope, type MessageProvenance } from './chat-source-provenance-core'

// Re-export the eligibility-free core so `from './chat-source-provenance'`
// importers (assistant-handlers, database-handlers, rag, tests) are unchanged.
export {
  SOURCE_PROVENANCE_V,
  REDACTED_ANSWER,
  PURGE_TOMBSTONE,
  packSources,
  packNonRagAssistant,
  parseEnvelope,
  presentSourcesNoRevalidate,
  messageReferencesPurgedRecording,
  type MessageProvenance,
  type MessageKind,
  type ProvenanceEnvelope
} from './chat-source-provenance-core'

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
