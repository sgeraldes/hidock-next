/**
 * Resumable value-classification backfill for the ~1,900 already-transcribed
 * captures (F16/spec-003, Part G). User-triggered from Settings ONLY — this
 * module is NEVER registered in boot-tasks.ts and never runs on Library
 * mount. (F15/F16 rationale: the owner has been burned repeatedly by heavy
 * boot-time work freezing the app on a 1.6 GB / ~1,900-capture real DB; this
 * runner makes up to ~1,900 LLM calls, which must only ever happen because
 * the user explicitly asked for it, chunked and yielded so the renderer never
 * blocks.)
 *
 * Architecture (Codex adversarial review AR-3 — atomic reserve/call/finalize):
 * for each eligible capture, in order:
 *   1. RESERVE (durable, its own transaction) — UPSERT value_backfill_state
 *      to status='in_progress', bump attempts, stamp this run's run_id.
 *      Happens BEFORE the LLM call, so a crash mid-call still leaves a durable
 *      record that this capture was attempted.
 *   2. CALL — classifyCaptureValueRaw(captureId) (load+prompt+LLM+parse, NO
 *      persistence — see value-classification.ts). In-run transient retries
 *      (backoff, 429-shaped errors) happen HERE, entirely in-process, and do
 *      NOT touch the durable `attempts` counter (Codex adversarial review
 *      AR-4 — attempts increments exactly ONCE per durable attempt, at
 *      reserve time).
 *   3. FINALIZE — ONE transaction: the guarded rating UPDATE
 *      (applyCaptureValueClassification, never-downgrade + confidence-floored)
 *      and the value_backfill_state marker (status='classified',
 *      result_rating=...) commit or roll back TOGETHER. A capture is never
 *      left with a rating change but no marker, or a marker but no rating
 *      change, even on a crash between them.
 *   On an unrecoverable CALL failure: FINALIZE-as-failure instead — marks
 *      status='failed' + last_error WITHOUT touching attempts (already
 *      incremented once, at reserve).
 *
 * Recovery: a capture's `value_backfill_state` row is re-eligible on a later
 * run when it is 'failed' with attempts < MAX_DURABLE_ATTEMPTS, OR when it is
 * still 'in_progress' (which — since concurrent runs are impossible, guarded
 * by the module-level `running` flag — can only mean a PRIOR run crashed or
 * was killed before reaching FINALIZE; there is no other writer). Terminal
 * parking = attempts >= MAX_DURABLE_ATTEMPTS, using the SAME counter the
 * eligibility query reads, so "parked items are retried on later runs until
 * the cap" is literally true (AR-4).
 *
 * All marker writes are `INSERT ... ON CONFLICT(capture_id) DO UPDATE`
 * (never `INSERT OR REPLACE`, which would silently reset columns the UPDATE
 * doesn't mention — e.g. resetting `attempts` back to a literal on every
 * write, defeating the counter).
 */

import type { BrowserWindow } from 'electron'
import { randomUUID } from 'crypto'
import { queryAll, queryOne, run, runInTransaction } from './database'
import { classifyCaptureValueRaw, applyCaptureValueClassification, type RawClassificationResult } from './value-classification'
import { getProviderConfigFromSettings } from './ai-provider-config'

// ---------------------------------------------------------------------------
// Tunables — `let` (not `const`) so tests can shrink delays/chunk sizes to
// run fast and deterministically without real wall-clock waits. Production
// code never mutates these; only `_setValueBackfillConfigForTests` does.
// ---------------------------------------------------------------------------

/** Items processed per chunk before yielding to the event loop. */
let CHUNK_SIZE = 5
/** Minimum spacing between LLM calls (rate limit). */
let MIN_INTERVAL_MS = 800
/** Terminal parking threshold — a 'failed' item with attempts >= this is
 *  excluded from the eligible set (both the query AND this constant read the
 *  SAME number, per AR-4). */
let MAX_DURABLE_ATTEMPTS = 3
/** In-run transient-retry backoff schedule (NOT durable attempts — AR-4).
 *  Length + 1 = total in-process tries within one durable attempt. */
let IN_RUN_RETRY_DELAYS_MS = [1000, 2000, 4000]
/** Progress events are throttled to at most one per this many ms (except the
 *  final item, which always flushes), mirroring migration:progress. */
let PROGRESS_THROTTLE_MS = 500
/** Injectable so tests never actually wait. */
let delayFn: (ms: number) => Promise<void> = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

export function _setValueBackfillConfigForTests(overrides: {
  chunkSize?: number
  minIntervalMs?: number
  maxDurableAttempts?: number
  inRunRetryDelaysMs?: number[]
  progressThrottleMs?: number
  delayFn?: (ms: number) => Promise<void>
}): void {
  if (overrides.chunkSize !== undefined) CHUNK_SIZE = overrides.chunkSize
  if (overrides.minIntervalMs !== undefined) MIN_INTERVAL_MS = overrides.minIntervalMs
  if (overrides.maxDurableAttempts !== undefined) MAX_DURABLE_ATTEMPTS = overrides.maxDurableAttempts
  if (overrides.inRunRetryDelaysMs !== undefined) IN_RUN_RETRY_DELAYS_MS = overrides.inRunRetryDelaysMs
  if (overrides.progressThrottleMs !== undefined) PROGRESS_THROTTLE_MS = overrides.progressThrottleMs
  if (overrides.delayFn !== undefined) delayFn = overrides.delayFn
}

/** Resets tunables AND runtime state (running/cancelled/timing). Call in
 *  beforeEach/afterEach so tests never leak state into each other. */
export function _resetValueBackfillForTests(): void {
  CHUNK_SIZE = 5
  MIN_INTERVAL_MS = 800
  MAX_DURABLE_ATTEMPTS = 3
  IN_RUN_RETRY_DELAYS_MS = [1000, 2000, 4000]
  PROGRESS_THROTTLE_MS = 500
  delayFn = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
  running = false
  cancelled = false
  lastCallStartedAt = 0
  mainWindow = null
  yieldCallCount = 0
}

// ---------------------------------------------------------------------------
// Renderer notification (mirrors transcription.ts's setMainWindowForTranscription
// + notifyRenderer pattern exactly).
// ---------------------------------------------------------------------------

let mainWindow: BrowserWindow | null = null

export function setMainWindowForValueBackfill(win: BrowserWindow): void {
  mainWindow = win
}

function notifyRenderer(channel: string, data: unknown): void {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send(channel, data)
  }
}

// ---------------------------------------------------------------------------
// Table safety net — triple-placed (SCHEMA string + MIGRATIONS[43] in
// database.ts, AND this lazy create), because repairPhase only force-adds
// missing COLUMNS to existing tables, never a whole new TABLE. Mirrors
// knowledge-graph-service.ts's _ensureIngestTrackingTable exactly.
// ---------------------------------------------------------------------------

function _ensureValueBackfillTable(): void {
  try {
    run(`CREATE TABLE IF NOT EXISTS value_backfill_state (
      capture_id TEXT PRIMARY KEY,
      status TEXT NOT NULL,
      result_rating TEXT,
      attempts INTEGER NOT NULL DEFAULT 0,
      run_id TEXT,
      last_error TEXT,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP
    )`)
  } catch (e) {
    console.warn('[ValueBackfill] Could not create value_backfill_state table:', e)
  }
}

// ---------------------------------------------------------------------------
// Runtime guard + cancellation
// ---------------------------------------------------------------------------

let running = false
let cancelled = false

// ---------------------------------------------------------------------------
// Shared SQL fragments (/simplify S-4) — getEligibleCaptureIds (the
// eligibility denominator) and getValueBackfillStatus (the status
// denominator) MUST stay in lockstep (CX-T3-4): a capture that drops out of
// scope for one (privacy change, cap reached) must drop out of the other on
// the exact same call. Hoisting both the privacy predicate and the parked-
// attempt predicate into one shared constant each makes that structural
// instead of a matter of keeping two hand-written WHERE clauses in sync.
// Both fragments assume the enclosing query aliases knowledge_captures `kc`,
// recordings `r`, transcripts `t`, and (parked predicate only) joins
// value_backfill_state as `vbs`.
// ---------------------------------------------------------------------------

/** Not soft-deleted, not user-rated (an explicit user rating/clear is
 *  authoritative and out of scope for both eligibility and status), owning
 *  recording not personal/deleted, and a non-blank transcript exists. */
const VALUE_BACKFILL_PRIVACY_WHERE = `kc.deleted_at IS NULL
        AND COALESCE(kc.quality_source, '') != 'user'
        AND COALESCE(r.personal, 0) = 0
        AND r.deleted_at IS NULL
        AND t.full_text IS NOT NULL
        AND TRIM(t.full_text) != ''`

/** Durable retry cap exhausted — applies identically to a terminally-'failed'
 *  row and a crashed-and-never-finalized 'in_progress' row (AR-3 / Opus review
 *  M1). Binds exactly one `?` param (MAX_DURABLE_ATTEMPTS). */
const VALUE_BACKFILL_PARKED_PREDICATE = `vbs.status IN ('failed', 'in_progress') AND vbs.attempts >= ?`

// ---------------------------------------------------------------------------
// Eligible-set query — re-run at the START of every startValueBackfill() call
// (the durable cursor is value_backfill_state itself, not an in-memory Set
// carried across runs). A capture is eligible when it has a non-blank
// transcript, is currently unrated, was NOT explicitly cleared to unrated by
// the user (COALESCE(quality_source,'')!='user' — the write guard already
// blocks that downgrade, but excluding it here avoids spending an LLM call
// re-judging it), is not soft-deleted (NEITHER the capture NOR its recording —
// CX-T3-1: a soft-deleted recording's transcript must never reach the external
// provider), is not personal, and its marker (if any) is neither 'classified'
// nor capped out at MAX_DURABLE_ATTEMPTS. The attempts cap applies to BOTH
// 'failed' AND stale 'in_progress' rows (AR-3's eligibility formula, Opus
// review M1): reserve re-increments attempts on every recovery of a crashed
// 'in_progress' row, so without the cap a capture that hard-crashes the
// process during the LLM call would be retried unboundedly. Below the cap, a
// leftover 'in_progress' row IS re-eligible — only a prior (necessarily
// crashed/killed) run could have left one, since concurrent runs are
// impossible (the `running` guard + Electron single-instance lock; see the
// run_id note at startValueBackfill).
// ---------------------------------------------------------------------------

function getEligibleCaptureIds(order: 'newest' | 'oldest'): string[] {
  const orderClause = order === 'oldest' ? 'ASC' : 'DESC'
  // The transcripts JOIN cannot fan a capture out into duplicate rows:
  // transcripts.recording_id is NOT NULL UNIQUE (one transcript per recording).
  const rows = queryAll<{ id: string }>(
    `SELECT kc.id AS id
       FROM knowledge_captures kc
       JOIN transcripts t ON t.recording_id = kc.source_recording_id
       LEFT JOIN recordings r ON r.id = kc.source_recording_id
      WHERE ${VALUE_BACKFILL_PRIVACY_WHERE}
        AND kc.quality_rating = 'unrated'
        AND NOT EXISTS (
          SELECT 1 FROM value_backfill_state vbs
           WHERE vbs.capture_id = kc.id
             AND (vbs.status = 'classified' OR (${VALUE_BACKFILL_PARKED_PREDICATE}))
        )
      ORDER BY kc.captured_at ${orderClause}`,
    [MAX_DURABLE_ATTEMPTS]
  )
  return rows.map((r) => r.id)
}

/**
 * Fresh per-item privacy check (CX-T3-2), run immediately BEFORE the RESERVE
 * + LLM call: the eligible-id list is a snapshot taken at run start, so a
 * recording marked personal or soft-deleted (or a capture soft-deleted /
 * hard-purged) WHILE the run is in flight would otherwise still be sent to
 * the external provider minutes later. A blocked item is skipped entirely —
 * no reserve, no attempt consumed, no marker — so if the flag is later
 * reverted, a future run picks the capture up with its counter untouched.
 */
function isCapturePrivacyBlocked(captureId: string): boolean {
  const row = queryOne<{ personal: number; r_deleted: string | null; kc_deleted: string | null }>(
    `SELECT COALESCE(r.personal, 0) AS personal,
            r.deleted_at AS r_deleted,
            kc.deleted_at AS kc_deleted
       FROM knowledge_captures kc
       LEFT JOIN recordings r ON r.id = kc.source_recording_id
      WHERE kc.id = ?`,
    [captureId]
  )
  // Capture vanished mid-run (hard purge) — treat as blocked.
  if (!row) return true
  return row.personal === 1 || row.r_deleted !== null || row.kc_deleted !== null
}

// ---------------------------------------------------------------------------
// Reserve / finalize — the three durable-write steps of one item.
// ---------------------------------------------------------------------------

/** RESERVE (AR-3 step 1): durable, own transaction, BEFORE the LLM call.
 *  `attempts` increments exactly once here per durable attempt (AR-4) — never
 *  again for this attempt, regardless of how many in-run transient retries
 *  the CALL step performs. `INSERT ... ON CONFLICT DO UPDATE` (never OR
 *  REPLACE) so unrelated columns are never clobbered. */
function reserveAttempt(captureId: string, runId: string): void {
  const now = new Date().toISOString()
  runInTransaction(() => {
    run(
      `INSERT INTO value_backfill_state (capture_id, status, result_rating, attempts, run_id, last_error, updated_at)
       VALUES (?, 'in_progress', NULL, 1, ?, NULL, ?)
       ON CONFLICT(capture_id) DO UPDATE SET
         status = 'in_progress',
         run_id = excluded.run_id,
         attempts = value_backfill_state.attempts + 1,
         last_error = NULL,
         updated_at = excluded.updated_at`,
      [captureId, runId, now]
    )
  })
}

/** FINALIZE-as-failure (AR-3): the CALL step exhausted its in-run retries.
 *  Marks 'failed' WITHOUT touching `attempts` (already incremented once, at
 *  reserve) — so this item stays eligible for a LATER run's fresh durable
 *  attempt, up to MAX_DURABLE_ATTEMPTS. Returns `captureGone: true` when the
 *  capture was purged mid-flight and NO marker was written (CX-T3-8/CX-T3-10)
 *  — the caller reports such an item as skipped, not failed. */
function finalizeFailure(captureId: string, runId: string, error: unknown): { captureGone: boolean } {
  const message = error instanceof Error ? error.message : String(error)
  const now = new Date().toISOString()
  let captureGone = false
  runInTransaction(() => {
    // CX-T3-8: same existence guard as the classified finalize — a
    // concurrent hard purge removed the capture AND its marker rows; a
    // failure park must not resurrect an orphaned marker for it.
    const exists = queryOne<{ one: number }>(
      'SELECT 1 AS one FROM knowledge_captures WHERE id = ?',
      [captureId]
    )
    if (!exists) {
      console.log(`[ValueBackfill] capture=${captureId} purged mid-run — failure not parked, no marker written`)
      captureGone = true
      return
    }
    run(
      `INSERT INTO value_backfill_state (capture_id, status, result_rating, attempts, run_id, last_error, updated_at)
       VALUES (?, 'failed', NULL, 1, ?, ?, ?)
       ON CONFLICT(capture_id) DO UPDATE SET
         status = 'failed',
         run_id = excluded.run_id,
         last_error = excluded.last_error,
         updated_at = excluded.updated_at`,
      [captureId, runId, message.slice(0, 500), now]
    )
  })
  return { captureGone }
}

/** FINALIZE-as-classified (AR-3 step 3): the guarded rating apply and the
 *  marker write happen in ONE transaction — commit or roll back together.
 *  Called with the transaction already open (see processOneCapture). */
function finalizeClassifiedInTransaction(captureId: string, runId: string, resultRating: string): void {
  const now = new Date().toISOString()
  run(
    `INSERT INTO value_backfill_state (capture_id, status, result_rating, attempts, run_id, last_error, updated_at)
     VALUES (?, 'classified', ?, 1, ?, NULL, ?)
     ON CONFLICT(capture_id) DO UPDATE SET
       status = 'classified',
       result_rating = excluded.result_rating,
       run_id = excluded.run_id,
       last_error = NULL,
       updated_at = excluded.updated_at`,
    [captureId, resultRating, runId, now]
  )
}

// ---------------------------------------------------------------------------
// In-run transient retry (AR-4) — entirely separate from the durable
// `attempts` counter. A handful of quick backoff retries for a blip
// (network hiccup, transient 429) within THIS ONE durable attempt.
// ---------------------------------------------------------------------------

function isRateLimitError(e: unknown): boolean {
  const message = e instanceof Error ? e.message : String(e)
  return /429|rate.?limit|too many requests|quota/i.test(message)
}

/** "Longer on 429/rate errors" (spec Part G) — a rate-limit-shaped error backs
 *  off further than a generic transient failure. */
const RATE_LIMIT_BACKOFF_MULTIPLIER = 3

async function callWithInRunRetries(captureId: string): Promise<RawClassificationResult> {
  let lastError: unknown
  for (let attempt = 0; attempt <= IN_RUN_RETRY_DELAYS_MS.length; attempt++) {
    try {
      const result = await classifyCaptureValueRaw(captureId)
      // CX-T3-9/CX-T3-11: the rate-limit TIMESTAMP is stamped only when the
      // provider was ACTUALLY invoked — a raw-level skip (capture became
      // rated after the snapshot, transcript vanished, provider
      // deconfigured) performs no provider work and must not consume a
      // throttle slot. Stamping AFTER the call (end-to-start spacing) is
      // equally valid rate limiting.
      if (result.providerCalled) {
        lastCallStartedAt = Date.now()
      }
      return result
    } catch (e) {
      // classifyCaptureValueRaw throws only from the complete() call itself
      // (the skip paths return; parsing never throws) — the provider WAS
      // invoked, so a failed attempt still counts for spacing.
      lastCallStartedAt = Date.now()
      lastError = e
      if (attempt < IN_RUN_RETRY_DELAYS_MS.length) {
        const baseDelay = IN_RUN_RETRY_DELAYS_MS[attempt]
        const waitMs = isRateLimitError(e) ? baseDelay * RATE_LIMIT_BACKOFF_MULTIPLIER : baseDelay
        await delayFn(waitMs)
      }
    }
  }
  throw lastError
}

// ---------------------------------------------------------------------------
// Rate limiting between LLM calls (across items, not the in-run retries above).
// CX-T3-9/CX-T3-11: WAIT and TIMESTAMP are deliberately separated.
// waitForThrottle() only spaces against the last REAL provider invocation;
// the stamp happens inside callWithInRunRetries, after each attempt that
// actually reached the provider (result.providerCalled, or a throw from
// complete() itself). Neither a privacy-skip (never reaches the call) nor a
// raw-level skip (classifyCaptureValueRaw returns `skipped` without provider
// work) consumes a throttle slot — the old combined wait+stamp form billed
// one full MIN_INTERVAL_MS per skip, turning a bulk privacy change mid-run
// into minutes of dead waiting. Now at most ONE residual wait follows the
// last real call, no matter how many skips intervene.
// ---------------------------------------------------------------------------

let lastCallStartedAt = 0

async function waitForThrottle(): Promise<void> {
  const elapsed = Date.now() - lastCallStartedAt
  if (lastCallStartedAt > 0 && elapsed < MIN_INTERVAL_MS) {
    await delayFn(MIN_INTERVAL_MS - elapsed)
  }
}

let yieldCallCount = 0

function yieldToEventLoop(): Promise<void> {
  yieldCallCount++
  return new Promise((resolve) => setTimeout(resolve, 0))
}

/** Test-only: proves the loop actually yields between chunks (spec Part G
 *  "spy that a yield occurs between chunks"), without coupling the test to
 *  the internal setTimeout mechanics. */
export function _getYieldCountForTests(): number {
  return yieldCallCount
}

// ---------------------------------------------------------------------------
// One item, start to finish: RESERVE -> CALL (with in-run retries) -> FINALIZE.
// ---------------------------------------------------------------------------

type ProcessOutcome = 'marked' | 'unmarked' | 'skipped' | 'failed'

async function processOneCapture(captureId: string, runId: string): Promise<ProcessOutcome> {
  // CX-T3-6: the rate-limit wait comes FIRST — it can park this item for up
  // to MIN_INTERVAL_MS, and a privacy flag landing during that wait must be
  // honored. So the fresh privacy check (CX-T3-2) runs AFTER the throttle,
  // with nothing but the synchronous reserve between it and the LLM call —
  // no await separates the check from the first send. (In-run retries
  // re-send the same already-checked content within seconds of that first
  // call; they expose nothing the first send didn't.) The wait spaces
  // against the last REAL call only (CX-T3-9) — a skipped item stamps
  // nothing, so consecutive skips cost at most one residual wait in total.
  await waitForThrottle()

  // CX-T3-2: fresh privacy read BEFORE any durable write or LLM call — the
  // eligible-id snapshot can be minutes stale by the time this item's turn
  // comes. Blocked ⇒ skip entirely: no reserve, no attempt consumed, no marker.
  if (isCapturePrivacyBlocked(captureId)) {
    console.log(`[ValueBackfill] capture=${captureId} privacy-blocked mid-run (personal/deleted) — skipped, no reserve`)
    return 'skipped'
  }

  reserveAttempt(captureId, runId)

  let raw: RawClassificationResult
  try {
    raw = await callWithInRunRetries(captureId)
  } catch (e) {
    // CX-T3-10: if a concurrent purge removed the capture while the failing
    // call was in flight, finalizeFailure writes nothing — report the item
    // as skipped (consistent with the successful-call purge path), not as a
    // failed-but-nonexistent, non-retryable phantom.
    const parked = finalizeFailure(captureId, runId, e)
    return parked.captureGone ? 'skipped' : 'failed'
  }

  // resultRating starts as the row's rating at load time (skip case never
  // calls apply) and is overwritten with the ACTUAL post-guard rating when we
  // do apply — applyCaptureValueClassification may itself decline to write
  // (never-downgrade / confidence floor), in which case its `rating` already
  // reports the row's real current state, not our intended target.
  let resultRating: string = raw.skipped ? raw.currentRating : 'unrated'
  let captureGone = false
  try {
    runInTransaction(() => {
      // CX-T3-8: a concurrent hard purge (deleteRecordingCascade; FKs are
      // OFF) may have deleted the capture — and its marker rows — while the
      // LLM call was in flight. Writing the marker now would resurrect an
      // orphaned row for a purged capture. Verify existence INSIDE the txn
      // so the decision and the write are atomic against the purge's own
      // transaction.
      const exists = queryOne<{ one: number }>(
        'SELECT 1 AS one FROM knowledge_captures WHERE id = ?',
        [captureId]
      )
      if (!exists) {
        captureGone = true
        return
      }
      if (!raw.skipped) {
        const applied = applyCaptureValueClassification(captureId, raw.classification)
        resultRating = applied.rating
        // CX-T3-7: apply is deliberately non-throwing — a DB failure inside
        // it surfaces as reason:'error' with NO write performed. Marking
        // that 'classified' would permanently exclude a never-classified
        // capture from retries; abort the txn instead so the catch below
        // parks it as 'failed' (retryable under the attempts cap). Legit
        // non-writes (below-floor, not-eligible) keep finalizing as
        // 'classified' — distinguished by reason.
        if (applied.reason === 'error') {
          throw new Error(`applyCaptureValueClassification failed (reason=error) for capture=${captureId}`)
        }
      }
      finalizeClassifiedInTransaction(captureId, runId, resultRating)
    })
  } catch (e) {
    // OP-L1: an environmental DB failure (disk full, locked, ...) in the
    // finalize transaction parks THIS item and lets the run continue — one
    // bad write must not abort a long batch. The rolled-back txn left the
    // rating untouched, so parking is honest.
    console.warn(
      `[ValueBackfill] finalize failed for capture=${captureId}:`,
      e instanceof Error ? e.message : e
    )
    try {
      const parked = finalizeFailure(captureId, runId, e)
      // CX-T3-10: purged mid-flight — nothing was parked; report skipped.
      if (parked.captureGone) return 'skipped'
    } catch (parkError) {
      // Even the park write failed — the row stays 'in_progress' (from
      // reserve) and the next run's stale-in_progress recovery picks it up.
      console.warn(
        `[ValueBackfill] could not park capture=${captureId} (row stays in_progress for next-run recovery):`,
        parkError instanceof Error ? parkError.message : parkError
      )
    }
    return 'failed'
  }

  if (captureGone) {
    console.log(`[ValueBackfill] capture=${captureId} purged mid-run — skipped, no marker written`)
    return 'skipped'
  }

  if (raw.skipped) return 'skipped'
  return resultRating === 'low-value' || resultRating === 'garbage' ? 'marked' : 'unmarked'
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export interface StartValueBackfillResult {
  started: boolean
  reason?: 'no-provider' | 'already-running'
  total?: number
}

/**
 * Start a backfill run. NEVER called from boot-tasks.ts or on Library mount —
 * the ONLY call site is the user-triggered Settings button (Part I) via the
 * `value:startBackfill` IPC handler. Chunked + rate-limited + yields between
 * chunks so the renderer stays responsive; resumable (durable marker table);
 * cancellable (module-level flag, checked between items).
 */
export async function startValueBackfill(opts?: { order?: 'newest' | 'oldest' }): Promise<StartValueBackfillResult> {
  if (running) {
    return { started: false, reason: 'already-running' }
  }
  // Claim the slot synchronously (no `await` above this line) so two
  // near-simultaneous calls can never both pass the guard.
  running = true
  cancelled = false

  // CX-T3-5: EVERYTHING after the flag claim runs inside this try/finally —
  // a throw anywhere (the eligibility query, table-ensure, an unexpected
  // reserve failure mid-loop) must never leave `running=true` orphaned, which
  // would report 'already-running' until app restart.
  let processed = 0
  let marked = 0
  let failed = 0
  let total = 0
  let loopStarted = false

  try {
    const providerConfig = getProviderConfigFromSettings()
    if (!providerConfig) {
      return { started: false, reason: 'no-provider' }
    }

    _ensureValueBackfillTable()

    const order = opts?.order ?? 'newest'
    // run_id is stamped on every marker write for diagnostics (which run last
    // touched a row). Recovery does NOT compare it (AR-3's literal
    // `run_id != current` predicate): the single-run invariant — this module's
    // `running` flag plus Electron's single-instance lock — guarantees any
    // 'in_progress' row observed at run start belongs to a dead run, so every
    // one is stale by construction. The unbounded-retry risk that predicate
    // also guarded against is closed by the attempts cap in
    // getEligibleCaptureIds instead (Opus review M1/L3).
    const runId = randomUUID()
    const eligibleIds = getEligibleCaptureIds(order)
    total = eligibleIds.length

    let lastProgressAt = 0
    lastCallStartedAt = 0
    loopStarted = true

    outer: for (let i = 0; i < eligibleIds.length; i += CHUNK_SIZE) {
      const chunk = eligibleIds.slice(i, i + CHUNK_SIZE)
      for (const captureId of chunk) {
        if (cancelled) break outer

        const outcome = await processOneCapture(captureId, runId)
        processed++
        if (outcome === 'marked') marked++
        else if (outcome === 'failed') failed++

        const now = Date.now()
        if (now - lastProgressAt >= PROGRESS_THROTTLE_MS || processed === total) {
          lastProgressAt = now
          notifyRenderer('value:backfill-progress', { processed, total, marked, failed })
        }
      }
      // Yield between chunks so a long run never blocks the renderer for more
      // than one chunk's worth of (already-awaited) work at a time.
      await yieldToEventLoop()
    }

    return { started: true, total }
  } finally {
    running = false
    // Only a run whose processing loop actually started emits a completion
    // event — a setup failure (no-provider, eligibility-query throw) returns/
    // throws without one, and the Settings card resets its own local state
    // from the start() response instead.
    if (loopStarted) {
      notifyRenderer('value:backfill-complete', { processed, total, marked, failed, cancelled })
    }
  }
}

/** Sets the cancel flag; the loop checks it between items and stops cleanly
 *  (the in-flight item's RESERVE/FINALIZE always completes first — no partial
 *  state). No-op (cancelled:false) when nothing is running. */
export function cancelValueBackfill(): { cancelled: boolean } {
  if (!running) return { cancelled: false }
  cancelled = true
  return { cancelled: true }
}

export interface ValueBackfillStatus {
  running: boolean
  total: number
  done: number
  marked: number
  failed: number
  remaining: number
}

/**
 * Derives status from the marker table (survives a restart — a run cannot,
 * since `running` is in-memory only, but the user re-triggering resumes from
 * exactly where the table left off) + the in-memory `running` flag.
 *
 * ALL aggregates derive from ONE scoped capture set (CX-T3-4/OP-L2): the same
 * WHERE clause defines the denominator (total) AND the numerators
 * (done/marked/failed), so a capture that leaves the scope after being
 * classified — e.g. the user re-rates it, stamping quality_source='user', or
 * its recording is soft-deleted/marked personal — drops out of every count
 * together. `done` can therefore never exceed `total`.
 *  - total: captures in scope — currently-unrated eligible captures PLUS
 *    anything the backfill has already touched (still-in-scope), so the
 *    denominator does not shrink as items get classified low-value/garbage.
 *  - done: classified count. marked: classified AND low-value/garbage.
 *  - failed: PARKED count only (attempts >= cap, whether 'failed' or a
 *    crashed-at-cap 'in_progress' — mirrors the eligibility predicate) — a
 *    merely-retry-eligible row is counted in `remaining`, not `failed`,
 *    since a future run will pick it back up.
 */
export function getValueBackfillStatus(): ValueBackfillStatus {
  _ensureValueBackfillTable()

  const row = queryOne<{ total: number; done: number; marked: number; failed: number }>(
    `SELECT COUNT(DISTINCT kc.id) AS total,
            COUNT(DISTINCT CASE WHEN vbs.status = 'classified' THEN kc.id END) AS done,
            COUNT(DISTINCT CASE WHEN vbs.status = 'classified'
                                 AND vbs.result_rating IN ('low-value', 'garbage') THEN kc.id END) AS marked,
            COUNT(DISTINCT CASE WHEN ${VALUE_BACKFILL_PARKED_PREDICATE} THEN kc.id END) AS failed
       FROM knowledge_captures kc
       JOIN transcripts t ON t.recording_id = kc.source_recording_id
       LEFT JOIN recordings r ON r.id = kc.source_recording_id
       LEFT JOIN value_backfill_state vbs ON vbs.capture_id = kc.id
      WHERE ${VALUE_BACKFILL_PRIVACY_WHERE}
        AND (kc.quality_rating = 'unrated' OR vbs.capture_id IS NOT NULL)`,
    [MAX_DURABLE_ATTEMPTS]
  )

  const total = row?.total ?? 0
  const done = row?.done ?? 0
  const failed = row?.failed ?? 0
  const remaining = Math.max(0, total - done - failed)

  return { running, total, done, marked: row?.marked ?? 0, failed, remaining }
}
