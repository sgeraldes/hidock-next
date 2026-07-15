/**
 * ADV17-2 (round-18) — shared chat-source provenance boundary.
 *
 * Chat persists each assistant message together with serialized `sources`
 * (verbatim transcript excerpts). Any reader that returns those persisted
 * sources (assistant:getMessages AND the legacy db:get-chat-history, which read
 * the SAME chat_messages table) must revalidate the sources against the shared
 * fail-closed eligibility boundaries — otherwise, after a source recording /
 * capture becomes personal / trashed / value-excluded, reopening the
 * conversation still displays the generated output and its stale excerpts.
 *
 * Schema stays v43: normalized provenance rides INSIDE the existing
 * `chat_messages.sources` TEXT column as a versioned envelope; the renderer
 * never sees the envelope (it is unwrapped on the way out).
 *
 *   • PERSIST (packSources) — wrap the renderer-supplied sources array in an
 *     envelope recording per-source provenance: recording ids resolved from the
 *     source's meetingId + the source's own captureId.
 *   • READ (revalidateStoredSources) — revalidate every source's provenance
 *     through the shared boundaries; drop excluded snippets; when an assistant
 *     answer is grounded ONLY on now-excluded sources, redact its content too.
 *   • LEGACY (no envelope but has snippets) — conservative fail-closed: drop the
 *     unverifiable snippets, keep the message + its text.
 */

import { getRecordingsForMeeting } from './database'
import { filterEligibleRecordingIds, filterEligibleCaptureIds } from './recording-eligibility'

/** Envelope version marker for normalized-provenance source blobs. */
export const SOURCE_PROVENANCE_V = 1

/** Shown in place of an assistant answer grounded solely on now-excluded sources. */
export const REDACTED_ANSWER =
  '[This response referenced sources that have since been excluded from the knowledge base.]'

export interface SourceProvenance {
  recordingIds: string[]
  captureIds: string[]
}

interface ProvenanceEnvelope {
  v: number
  sources: Array<Record<string, unknown> & { _prov?: SourceProvenance }>
}

/**
 * Resolve one renderer-supplied source object to its normalized provenance at
 * PERSIST time. A meeting source's `meetingId` is expanded to that meeting's
 * recording ids (the snippet was grounded on one of them); a capture/image
 * source carries `captureId` directly. Empty provenance (neither resolvable)
 * ⇒ the source is unverifiable and will fail closed on read.
 */
function resolveSourceProvenance(source: unknown): SourceProvenance {
  const recordingIds = new Set<string>()
  const captureIds = new Set<string>()
  if (source && typeof source === 'object') {
    const s = source as Record<string, unknown>
    if (typeof s.captureId === 'string' && s.captureId) captureIds.add(s.captureId)
    if (typeof s.meetingId === 'string' && s.meetingId) {
      try {
        for (const rec of getRecordingsForMeeting(s.meetingId)) recordingIds.add(rec.id)
      } catch {
        // Leave recordingIds empty → unresolvable → fail closed on read.
      }
    }
  }
  return { recordingIds: [...recordingIds], captureIds: [...captureIds] }
}

/**
 * PERSIST — pack the renderer-supplied sources JSON into a provenance envelope.
 * Non-array / empty / unparseable payloads are stored verbatim (nothing to
 * revalidate). Returns null when there are no sources.
 */
export function packSources(sourcesJson: string | null | undefined): string | null {
  if (!sourcesJson) return null
  let arr: unknown
  try {
    arr = JSON.parse(sourcesJson)
  } catch {
    return sourcesJson
  }
  if (!Array.isArray(arr) || arr.length === 0) return sourcesJson
  const sources = arr.map((s) => ({ ...(s as Record<string, unknown>), _prov: resolveSourceProvenance(s) }))
  return JSON.stringify({ v: SOURCE_PROVENANCE_V, sources })
}

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
    return parsed as ProvenanceEnvelope
  }
  return null
}

/** Strip the internal `_prov` field so the renderer sees its original source shape. */
function stripProv(source: Record<string, unknown> & { _prov?: SourceProvenance }): Record<string, unknown> {
  const { _prov, ...clean } = source
  return clean
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
  return JSON.stringify(env.sources.map(stripProv))
}

/** A source is eligible iff EVERY recording/capture it resolves to is eligible (fail-closed). */
function isSourceEligible(
  prov: SourceProvenance | undefined,
  recEligible: { eligible: Set<string>; failClosed: boolean },
  capEligible: { eligible: Set<string>; failClosed: boolean }
): boolean {
  const rec = prov?.recordingIds ?? []
  const cap = prov?.captureIds ?? []
  if (rec.length === 0 && cap.length === 0) return false // unresolvable ⇒ fail closed
  if (rec.length) {
    if (recEligible.failClosed) return false
    if (!rec.every((id) => recEligible.eligible.has(id))) return false
  }
  if (cap.length) {
    if (capEligible.failClosed) return false
    if (!cap.every((id) => capEligible.eligible.has(id))) return false
  }
  return true
}

/**
 * READ — revalidate a stored sources blob against the shared boundaries.
 * Returns the sanitized sources JSON for the renderer plus whether the assistant
 * answer content should be redacted (grounded solely on now-excluded sources).
 */
export function revalidateStoredSources(
  stored: string | null | undefined,
  role: string
): { sources: string | null; redactContent: boolean } {
  if (!stored) return { sources: stored ?? null, redactContent: false }

  const env = parseEnvelope(stored)
  if (env) {
    if (env.sources.length === 0) return { sources: '[]', redactContent: false }

    const allRec = new Set<string>()
    const allCap = new Set<string>()
    for (const s of env.sources) {
      for (const r of s._prov?.recordingIds ?? []) allRec.add(r)
      for (const c of s._prov?.captureIds ?? []) allCap.add(c)
    }
    const recEligible = filterEligibleRecordingIds([...allRec])
    const capEligible = filterEligibleCaptureIds([...allCap])

    const kept = env.sources.filter((s) => isSourceEligible(s._prov, recEligible, capEligible)).map(stripProv)
    const allExcluded = kept.length === 0 && env.sources.length > 0
    return { sources: JSON.stringify(kept), redactContent: role === 'assistant' && allExcluded }
  }

  // Legacy array with un-normalized provenance → conservative fail-closed: drop
  // the unverifiable snippets, keep the message text.
  let parsed: unknown
  try {
    parsed = JSON.parse(stored)
  } catch {
    return { sources: stored, redactContent: false }
  }
  if (Array.isArray(parsed) && parsed.length > 0) {
    return { sources: '[]', redactContent: false }
  }
  return { sources: stored, redactContent: false }
}
