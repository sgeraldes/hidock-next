/**
 * Littlebird cross-source deduplication (Req 8.5, 8.6, 8.7, 8.8).
 *
 * Implements, as real runtime code, the design in
 * `.kiro/specs/hidock-graph-extraction-hardening/notes/littlebird-cross-source-dedup.md`
 * (task 12.5): a strict, explainable, reversible equivalence precedence over
 * `CanonicalCaptureModel` records.
 *
 * This module never deletes, overwrites, or merges records — it only
 * asserts or retracts equivalence LINKS between them ("retain both,
 * represent equivalence", design note §3). Deduplication on title alone is
 * prohibited (Req 8.8): `CanonicalCaptureModel` carries no title field at
 * all, so this module is structurally incapable of matching on title — a
 * caller holding a title elsewhere may use it only as corroborating context
 * alongside a rule below, never as the sole match evidence.
 */

import type { CanonicalCaptureModel } from './littlebird-adapter.js'

/** Which §2 precedence rule produced an equivalence — recorded for explainability. */
export type MatchedRule =
  | 'native'
  | 'app+time+participants'
  | 'content-hash'
  | 'calendar-correlation'
  | 'explicit'

/** A minimal, order-insensitive reference to one canonical record. */
export interface CanonicalRecordRef {
  source: CanonicalCaptureModel['source']
  nativeEventId: string
}

/**
 * Rule-specific evidence. Never carries raw content — identifiers, derived
 * signals, and hashes only (Req 8.11 / architecture note §5).
 */
export type Evidence =
  | { rule: 'native'; nativeEventId?: string; permalink?: string }
  | {
      rule: 'app+time+participants'
      originatingApp: string
      appContext?: string
      timestampDeltaMs: number
      participantOverlapCount: number
      participantOverlapFraction: number
    }
  | { rule: 'content-hash'; contentHash: string }
  | { rule: 'calendar-correlation'; calendarAnchorId: string }
  | { rule: 'explicit'; note?: string }

/** Provenance of an equivalence assertion. */
export type AssertedBy = { kind: 'system' } | { kind: 'operator'; operatorId: string }

/** A single asserted (or retracted) equivalence between two canonical records. */
export interface EquivalenceRecord {
  leftId: CanonicalRecordRef
  rightId: CanonicalRecordRef
  matchedRule: MatchedRule
  evidence: Evidence
  createdAt: string
  /** Always true — every equivalence link is a reversible metadata operation (§5). */
  reversible: true
  retractedAt: string | null
  assertedBy: AssertedBy
}

/** Tunable thresholds for rule (b): app + timestamp + participants. */
export interface DedupConfig {
  /** Maximum |sourceTimestamp delta| (ms) for two records to be considered same-time. */
  timestampToleranceMs: number
  /** Minimum overlap fraction (0..1], relative to the smaller participant set. */
  participantOverlapThreshold: number
}

export const DEFAULT_DEDUP_CONFIG: DedupConfig = {
  timestampToleranceMs: 15 * 60 * 1000, // 15 minutes
  participantOverlapThreshold: 0.5,
}

/** A calendar/meeting-time anchor used only by rule (d). */
export interface CalendarAnchor {
  id: string
  startTimestamp: string
  endTimestamp: string
  participants: string[]
}

function toRef(r: CanonicalCaptureModel): CanonicalRecordRef {
  return { source: r.source, nativeEventId: r.nativeEventId }
}

function participantOverlap(a: readonly string[], b: readonly string[]): { count: number; fraction: number } {
  const setA = new Set(a.map((p) => p.trim().toLowerCase()).filter(Boolean))
  const setB = new Set(b.map((p) => p.trim().toLowerCase()).filter(Boolean))
  if (setA.size === 0 || setB.size === 0) return { count: 0, fraction: 0 }
  let count = 0
  for (const p of setA) if (setB.has(p)) count++
  const smaller = Math.min(setA.size, setB.size)
  return { count, fraction: smaller === 0 ? 0 : count / smaller }
}

function buildRecord(
  left: CanonicalCaptureModel,
  right: CanonicalCaptureModel,
  matchedRule: MatchedRule,
  evidence: Evidence,
  now: string,
  assertedBy: AssertedBy = { kind: 'system' }
): EquivalenceRecord {
  return {
    leftId: toRef(left),
    rightId: toRef(right),
    matchedRule,
    evidence,
    createdAt: now,
    reversible: true,
    retractedAt: null,
    assertedBy,
  }
}

/**
 * Evaluate the automatic §2 (a)-(d) precedence for a candidate pair. Returns
 * `null` when no rule fires — records are left un-linked (the safe "retain
 * both" default, never a guessed match). Rule (e), explicit equivalence, is
 * NOT automatic — see `assertExplicitEquivalence` below.
 *
 * `now` is a caller-supplied ISO timestamp (injectable clock) so callers —
 * including tests — are deterministic.
 */
export function evaluateDedup(
  a: CanonicalCaptureModel,
  b: CanonicalCaptureModel,
  now: string,
  config: DedupConfig = DEFAULT_DEDUP_CONFIG,
  calendarAnchors: readonly CalendarAnchor[] = []
): EquivalenceRecord | null {
  // (a) native identifier / permalink — strongest signal, but stability is
  // UNCONFIRMED for Littlebird (task 12.1), so absence is the expected case
  // and simply falls through to (b) rather than erroring.
  if (a.source === b.source && a.nativeEventId && b.nativeEventId && a.nativeEventId === b.nativeEventId) {
    return buildRecord(a, b, 'native', { rule: 'native', nativeEventId: a.nativeEventId }, now)
  }
  if (a.permalink && b.permalink && a.permalink === b.permalink) {
    return buildRecord(a, b, 'native', { rule: 'native', permalink: a.permalink }, now)
  }

  // (b) app + timestamp window + participant overlap — all three required
  // together; appContext, when present on both sides, must also agree.
  if (a.originatingApp && b.originatingApp && a.originatingApp === b.originatingApp) {
    const appContextMatches =
      a.appContext === undefined || b.appContext === undefined || a.appContext === b.appContext
    const tA = Date.parse(a.sourceTimestamp)
    const tB = Date.parse(b.sourceTimestamp)
    const timestampDeltaMs =
      Number.isFinite(tA) && Number.isFinite(tB) ? Math.abs(tA - tB) : Number.POSITIVE_INFINITY
    const { count, fraction } = participantOverlap(a.participants, b.participants)
    if (
      appContextMatches &&
      timestampDeltaMs <= config.timestampToleranceMs &&
      fraction >= config.participantOverlapThreshold
    ) {
      return buildRecord(
        a,
        b,
        'app+time+participants',
        {
          rule: 'app+time+participants',
          originatingApp: a.originatingApp,
          appContext: a.appContext,
          timestampDeltaMs,
          participantOverlapCount: count,
          participantOverlapFraction: fraction,
        },
        now
      )
    }
  }

  // (c) normalized content hash. Normalization/hashing happens upstream at
  // capture time (adapter-produced `contentHash`); this rule is a straight
  // equality check over the already-normalized value.
  if (a.contentHash && b.contentHash && a.contentHash === b.contentHash) {
    return buildRecord(a, b, 'content-hash', { rule: 'content-hash', contentHash: a.contentHash }, now)
  }

  // (d) calendar / meeting-time correlation — corroborating signal, tried
  // only when (a)-(c) do not fire.
  for (const anchor of calendarAnchors) {
    const start = Date.parse(anchor.startTimestamp)
    const end = Date.parse(anchor.endTimestamp)
    const tA = Date.parse(a.sourceTimestamp)
    const tB = Date.parse(b.sourceTimestamp)
    const aInWindow = Number.isFinite(tA) && tA >= start && tA <= end
    const bInWindow = Number.isFinite(tB) && tB >= start && tB <= end
    if (!aInWindow || !bInWindow) continue
    const overlapA = participantOverlap(a.participants, anchor.participants)
    const overlapB = participantOverlap(b.participants, anchor.participants)
    if (
      overlapA.fraction >= config.participantOverlapThreshold &&
      overlapB.fraction >= config.participantOverlapThreshold
    ) {
      return buildRecord(
        a,
        b,
        'calendar-correlation',
        { rule: 'calendar-correlation', calendarAnchorId: anchor.id },
        now
      )
    }
  }

  // No rule fired: leave un-linked. Safe default — both records simply
  // coexist, exactly the "retain both" posture (§3).
  return null
}

/**
 * Rule (e): explicit, operator- or system-asserted equivalence. Never
 * discovered automatically — always an explicit call, used when (a)-(d) are
 * inconclusive or need a human correction.
 */
export function assertExplicitEquivalence(
  left: CanonicalCaptureModel,
  right: CanonicalCaptureModel,
  now: string,
  assertedBy: AssertedBy,
  note?: string
): EquivalenceRecord {
  return buildRecord(left, right, 'explicit', { rule: 'explicit', note }, now, assertedBy)
}

/**
 * Soft-retract an equivalence link. Never destructive: the underlying
 * canonical records were never merged, so retraction is a metadata-only
 * operation and there is nothing to "restore" (§5). Returns a new record —
 * the input is not mutated.
 */
export function retractEquivalence(record: EquivalenceRecord, now: string): EquivalenceRecord {
  return { ...record, retractedAt: now }
}

/** True when an equivalence link has not been retracted. */
export function isActiveEquivalence(record: EquivalenceRecord): boolean {
  return record.retractedAt === null
}
