/**
 * Knowledge Graph Service — wires @hidock/knowledge-graph into the Electron app.
 *
 * Provides:
 * - Singleton KnowledgeGraphStore backed by the app's SQLite database
 * - LlmExtractor that uses @hidock/ai-providers complete()
 * - Incremental ingestion from DB transcripts and from a folder of .txt/.md files
 * - Thin query wrappers for IPC handlers
 */

import { resolve, basename, extname } from 'path'
import { readdirSync, readFileSync, existsSync, statSync } from 'fs'
import { createHash } from 'crypto'
import {
  KnowledgeGraphStore,
  extractGraphFromTranscript,
  ingestExtraction,
  topAttendeesForProjectOrTopic,
  topSkillDemonstrators,
  personProfile,
  meetingSummaryGraph,
  fullGraph,
  neighborhood,
  pruneGenericNodes,
  lensGraph,
  pickDefaultCenter,
  provenance,
  renameNode,
  mergeNodes,
  mergeBlastRadius,
  deleteNode,
  setNodeProps,
  ownDateMs,
  removeRecordingProvenance,
  pruneOrphanEdgeSources,
  DEFAULT_OVERVIEW_NODE_LIMIT,
  ExtractionError,
  getCurrentExtractionProvenance,
} from '@hidock/knowledge-graph'
import type {
  GraphDb,
  ExtractionErrorCategory,
  CurrentExtractionProvenance,
  LlmExtractor,
  PersonResolver,
  AttendeeResult,
  SkillDemonstratorResult,
  GraphNode,
  ExtractionResult,
  SubGraph,
  LensGraph,
  Provenance,
  NodeGraphStats,
} from '@hidock/knowledge-graph'
import { complete } from '@hidock/ai-providers'
import {
  run,
  runInTransaction,
  queryAll,
  queryOne,
  promoteExtractionToFirstClassTables,
  getValueExcludedRecordingIds,
  getRecordingsForMeeting,
  isRecordingGraphIngestable,
  getContactById,
  blankIneligibleContactFields,
  filterVisibleEntityIds,
  getContactByName,
  createContact,
  updateContact,
  upsertContactAlias,
  getContactAliases,
  mergeContacts,
  mergeProjects,
  getMergeImpact,
  getIdentitySuggestionById,
  acceptIdentitySuggestion,
  mergeJournalIdsFor,
  finalizeAcceptedMerge,
  captureLoserSubgraph,
  attachGraphSnapshotToJournal,
  scrubMergeJournalGraphSnapshots,
  scrubMergeJournalRelationalSnapshots,
} from './database'
import type { Contact, Project, IdentitySuggestion, AcceptSuggestionResult, MergeKind } from './database'
import { getEventBus } from './event-bus'
import { resolveContact } from './entity-resolver'
import { filterEligibleCaptureIds, filterEligibleRecordingIds, isEligible } from './recording-eligibility'
import type { RecordingEligibilityStatus } from './recording-eligibility'

// ---------------------------------------------------------------------------
// GraphDb adapter — bridges the app's database exports to the GraphDb interface
// ---------------------------------------------------------------------------

/**
 * Transient-error retry around the extraction LLM call.
 *
 * Large transcripts (observed 29k-67k chars) intermittently drop the local
 * Ollama HTTP request mid-generation with `TypeError: fetch failed` — a
 * transport hiccup, not a bad prompt or a bad response. Without a retry, one
 * such blip skips that transcript for the whole ingest pass (it stays unmarked
 * and only re-tries on a future pass), and a bulk re-ingest / backfill reports
 * it as an error. This wraps ONLY the transport `complete()` call and retries
 * ONLY transient fetch/network failures, with a short backoff. It does NOT wrap
 * parsing: `parseExtractionOutput` throws a typed `ExtractionError` /
 * `SchemaError` for malformed/schema-noncompliant model output (task 4.1), and
 * those propagate straight out of `extractGraphFromTranscript` to the ingest
 * loop's per-transcript catch (task 4.5), which leaves the transcript
 * unmarked/retryable and writes nothing — they are deliberately NOT retried on
 * this transport path. (Typed transport-signal classification for this retry is
 * implemented by {@link isTransientTransportError}, task 10.1: retry is decided
 * from real error codes/classes/status, not a `"network"` message substring.)
 *
 * hidock-graph-extraction-hardening Task 5.1 — PER-ATTEMPT ELIGIBILITY RECHECK.
 * The task-2.4 fetch-time gate (`isEligible` / `filterEligibleCaptureIds` in
 * each entry point) is the authoritative FIRST gate, but it runs ONCE, before
 * the extraction call. `completeWithRetry` then retries the transport
 * `complete()` internally with backoff, and a recording can become
 * personal/deleted/purged/value-excluded DURING that backoff window. Req 3.1
 * requires an eligibility recheck IMMEDIATELY BEFORE EVERY provider attempt
 * (the initial call AND every retry). This function therefore takes an optional
 * `checkEligible` callback and invokes it before each `complete()` call. If the
 * callback reports anything other than `eligible`, the retry loop ABORTS WITHOUT
 * another provider call and throws a typed {@link PrivacyBlockedError} — kept
 * DISTINCT from a transport error so task 5.3 can map it to a
 * privacy-blocked/skipped report (not a generic fetch error). Because the
 * injected `llm` (which wraps this function) is the SAME seam
 * `extractGraphFromTranscript` uses for the initial call AND every
 * schema-repair re-prompt (task 4.9), the recheck also covers repair re-prompts
 * — every provider attempt, from any caller, is gated on the same predicate.
 *
 * The recheck is INDEPENDENT of the {@link isTransientTransportError} transport
 * classifier (task 10.1 decides WHICH errors are transient from typed
 * codes/classes/status; this seam does not touch that): a privacy abort is
 * decided purely by `checkEligible`, never by inspecting an error message. No
 * transcript contents appear in the abort/error (Req 3.3/7.6);
 * a `PrivacyBlockedError` carries only the non-sensitive eligibility status.
 *
 * @param prompt  the extraction prompt
 * @param cfg     resolved provider config (extraction model)
 * @param attempts max attempts (default 3)
 * @param checkEligible OPTIONAL recording/capture eligibility recheck, invoked
 *   immediately before EVERY provider attempt (initial + every retry). When it
 *   returns a non-`eligible` status the loop aborts with a
 *   {@link PrivacyBlockedError} and NO further `complete()` call is made.
 */

/**
 * hidock-graph-extraction-hardening Task 5.1 — typed sentinel thrown when a
 * per-attempt eligibility recheck aborts the retry loop. It is DELIBERATELY not
 * a transport error and is NOT classified transient by
 * {@link isTransientTransportError}, so a caller (and
 * task 5.3's reporting) can distinguish a privacy-blocked abort — a legitimate,
 * expected skip — from a genuine provider/transport failure. It carries ONLY
 * the non-sensitive {@link RecordingEligibilityStatus} (its `kind`/`reason` or a
 * redacted lookup-error string); NEVER a transcript body, prompt, or model
 * output. `status.kind` is one of `privacy_blocked` (an eligibility exclusion)
 * or `lookup_error` (a fail-closed eligibility LOOKUP failure) — never
 * `eligible` (an eligible status never constructs this error).
 */
export class PrivacyBlockedError extends Error {
  readonly status: Exclude<RecordingEligibilityStatus, { kind: 'eligible' }>
  constructor(status: Exclude<RecordingEligibilityStatus, { kind: 'eligible' }>) {
    const detail = status.kind === 'privacy_blocked' ? `reason=${status.reason}` : 'lookup_error'
    super(`Recording became ineligible before provider attempt (${detail})`)
    this.name = 'PrivacyBlockedError'
    this.status = status
    Object.setPrototypeOf(this, PrivacyBlockedError.prototype)
  }
}

/**
 * hidock-graph-extraction-hardening Task 10.1 (Req 7.1, 7.7) — genuine
 * transient TRANSPORT error codes we retry on.
 *
 * These are Node/libuv system error `code`s (and undici transient-class codes)
 * that name a real transport-level hiccup: a connection reset/refused/aborted,
 * a socket timeout, a DNS blip, a broken pipe. They are keyed off the error's
 * (or its `cause` chain's) `.code` — NOT off a free-text message. The old
 * heuristic matched the WORD "network" anywhere in the message string, which is
 * fragile (any error whose message happens to contain "network" was retried,
 * and a genuine transient whose message lacked those exact words was not). Req
 * 7.1/7.7 require the decision to come from typed transport signals instead.
 */
const TRANSIENT_TRANSPORT_CODES: ReadonlySet<string> = new Set([
  'ECONNRESET',   // peer reset the connection mid-flight
  'ECONNREFUSED', // provider not accepting connections yet (e.g. Ollama restarting)
  'ECONNABORTED', // connection aborted
  'ETIMEDOUT',    // socket-level timeout
  'EPIPE',        // wrote to a closed socket ("broken pipe" / "socket hang up")
  'ENOTFOUND',    // transient DNS resolution failure
  'EAI_AGAIN',    // transient DNS "try again"
  'EHOSTUNREACH', // host transiently unreachable
  'ENETUNREACH',  // network transiently unreachable
  'ENETDOWN',     // network transiently down
  'EHOSTDOWN',    // host transiently down
])

/**
 * hidock-graph-extraction-hardening Task 10.1 (Req 7.1, 7.7) — transient HTTP
 * status classes. When a provider/SDK error carries a numeric status, only
 * these classes are retryable: request timeout, too-early, rate-limit, and the
 * 5xx server-side transients. A terminal 4xx (400/401/403/404/…) is NOT
 * retried — it will never succeed on a re-send of the same request.
 */
const TRANSIENT_HTTP_STATUSES: ReadonlySet<number> = new Set([408, 425, 429, 500, 502, 503, 504])

/**
 * Walk the `cause` chain of an error and pull the first Node system-error
 * `code` string we find. A failed `fetch()` throws a `TypeError('fetch failed')`
 * whose `.cause` is the underlying system error (e.g. `{ code: 'ECONNRESET' }`),
 * sometimes nested another level via undici. We bound the walk to avoid a
 * pathological/cyclic chain. Only reads `.code` — never the message text, never
 * any prompt/transcript content (Req 7.6).
 */
function extractErrorCode(err: unknown): string | undefined {
  let cur: unknown = err
  for (let depth = 0; depth < 8 && cur && typeof cur === 'object'; depth++) {
    const code = (cur as { code?: unknown }).code
    if (typeof code === 'string' && code.length > 0) return code
    const next = (cur as { cause?: unknown }).cause
    if (next === cur) break
    cur = next
  }
  return undefined
}

/**
 * Walk the `cause` chain and pull the first numeric HTTP status we find. SDK
 * errors surface it under a few different field names (`status`,
 * `statusCode`, `response.status`); we check each. Only reads numeric status
 * fields — never message text or request/response bodies.
 */
function extractHttpStatus(err: unknown): number | undefined {
  let cur: unknown = err
  for (let depth = 0; depth < 8 && cur && typeof cur === 'object'; depth++) {
    const o = cur as { status?: unknown; statusCode?: unknown; response?: { status?: unknown } }
    for (const candidate of [o.status, o.statusCode, o.response?.status]) {
      if (typeof candidate === 'number' && Number.isFinite(candidate)) return candidate
    }
    const next = (cur as { cause?: unknown }).cause
    if (next === cur) break
    cur = next
  }
  return undefined
}

/**
 * hidock-graph-extraction-hardening Task 10.1 (Req 7.1, 7.7) — TYPED
 * transient-transport classifier for the fetch-retry path.
 *
 * Decides retryability from GENUINE transport signals, never from a `"network"`
 * (or any other) substring in the error message:
 *   1. TERMINAL by type: a typed {@link ExtractionError} (which `SchemaError`
 *      extends) is a malformed/schema-noncompliant MODEL OUTPUT, not a transport
 *      failure. It is TERMINAL for this path — it must propagate so the ingest
 *      loop / bounded schema-repair policy (task 4.9) owns it. Returns false.
 *   2. RETRY on transport code: an `AbortError`/timeout class, or a
 *      Node/undici system error `.code` in {@link TRANSIENT_TRANSPORT_CODES}
 *      (found by walking `error.cause`, so a `TypeError('fetch failed')` whose
 *      `cause.code === 'ECONNRESET'` is retried via its code, not its words).
 *      Also treats undici transient socket classes (`UND_ERR_SOCKET`,
 *      `UND_ERR_CONNECT_TIMEOUT`, `UND_ERR_HEADERS_TIMEOUT`, `UND_ERR_BODY_TIMEOUT`)
 *      as transient.
 *   3. RETRY on transient HTTP status: a status in {@link TRANSIENT_HTTP_STATUSES}
 *      (408/425/429/5xx). A terminal 4xx is NOT retried.
 *   4. Everything else (a plain non-transport Error, an error whose message
 *      merely CONTAINS "network" but carries no transient code/class/status) is
 *      TERMINAL. Returns false.
 *
 * PRIVACY (Req 7.6): inspects only `name`/`code`/status fields and the
 * `instanceof` type — never logs or reads the prompt or transcript.
 */
export function isTransientTransportError(err: unknown): boolean {
  // (1) Schema/invalid-output errors are TERMINAL for the fetch-retry path.
  if (err instanceof ExtractionError) return false

  // (2) Abort/timeout classes and transient transport codes.
  const name = err instanceof Error ? err.name : undefined
  if (name === 'AbortError' || name === 'TimeoutError') return true

  const code = extractErrorCode(err)
  if (code) {
    if (TRANSIENT_TRANSPORT_CODES.has(code)) return true
    // Undici's transient socket/timeout classes (connection-level, not schema).
    if (
      code === 'UND_ERR_SOCKET' ||
      code === 'UND_ERR_CONNECT_TIMEOUT' ||
      code === 'UND_ERR_HEADERS_TIMEOUT' ||
      code === 'UND_ERR_BODY_TIMEOUT'
    ) {
      return true
    }
  }

  // (3) Transient HTTP status classes where a status is available on the error.
  const status = extractHttpStatus(err)
  if (typeof status === 'number' && TRANSIENT_HTTP_STATUSES.has(status)) return true

  // (4) No genuine transport signal ⇒ TERMINAL (no substring heuristic).
  return false
}

/**
 * hidock-graph-extraction-hardening Task 10.3 (Req 7.3) — typed sentinel thrown
 * when a cancellation/shutdown signal aborts the retry sequence (during a
 * pending backoff, or before an attempt). Kept DISTINCT from a transport error
 * AND from {@link PrivacyBlockedError} so a caller / the `ingestion_run` ledger
 * can map it to the `cancelled` terminal status (never to a generic `error` or a
 * `privacy_blocked` skip). It carries ONLY the non-sensitive attempt count and a
 * fixed message — NEVER a prompt, transcript, or model output (Req 7.6).
 *
 * NOTE: cancellation is decided by inspecting the injected {@link AbortSignal}'s
 * `aborted` flag directly, NOT by classifying an `AbortError` name — a provider
 * `AbortError` (e.g. an internal SDK timeout) remains a transient TRANSPORT
 * error under {@link isTransientTransportError}. Only OUR signal produces this.
 */
export class RetryCancelledError extends Error {
  /** Number of provider attempts that had been made when cancellation won. */
  readonly attempts: number
  constructor(attempts: number) {
    super('Extraction retry cancelled by shutdown/cancellation signal')
    this.name = 'RetryCancelledError'
    this.attempts = attempts
    Object.setPrototypeOf(this, RetryCancelledError.prototype)
  }
}

/**
 * hidock-graph-extraction-hardening Task 10.3 (Req 7.5) — terminal category of a
 * completed retry sequence. Aligned with (a subset/superset of) the
 * {@link IngestionRunStatus} vocabulary so the two never drift:
 *   - `success`             — a provider attempt returned output.
 *   - `transient-exhausted` — every attempt failed with a transient TRANSPORT
 *                             error and the attempt budget ran out.
 *   - `cancelled`           — a cancellation/shutdown signal stopped the loop
 *                             (maps to `ingestion_run.status = 'cancelled'`).
 *   - `privacy_blocked`     — a per-attempt eligibility recheck aborted the loop
 *                             (maps to `ingestion_run.status = 'privacy_blocked'`).
 *   - `terminal-error`      — a non-transient error (including a typed
 *                             ExtractionError/SchemaError) ended the loop.
 */
export type RetryTerminalCategory =
  | 'success'
  | 'transient-exhausted'
  | 'cancelled'
  | 'privacy_blocked'
  | 'terminal-error'

/**
 * hidock-graph-extraction-hardening Task 10.3 (Req 7.5) — the reported outcome
 * of a retry sequence: how many provider attempts were MADE and the terminal
 * category. PRIVACY (Req 7.6): counts + category only — never a prompt,
 * transcript, model output, or credential.
 */
export interface RetryOutcome {
  attempts: number
  category: RetryTerminalCategory
}

/**
 * hidock-graph-extraction-hardening Task 10.3 (Req 7.2) — bounded exponential
 * backoff configuration. All fields optional; sensible defaults keep the
 * pre-existing behaviour reasonable (a 3-attempt loop that used to wait ~1.5s
 * then ~3s now waits a JITTERED delay in the same order of magnitude, capped).
 *
 *   - `baseMs`  base delay for the FIRST retry (default 1500).
 *   - `capMs`   hard maximum for any single backoff delay (default 30000). The
 *              computed exponential delay is clamped to this BEFORE jitter, so a
 *              jittered delay can NEVER exceed the cap.
 *   - `factor`  exponential multiplier per attempt (default 2).
 *   - `jitter`  `'full'` (uniform in `[0, capped]`, the default — decorrelates
 *              retriers) or `'equal'` (`capped/2 + uniform[0, capped/2]`, keeps a
 *              guaranteed minimum wait) or `'none'` (deterministic, for tests).
 */
export interface RetryBackoffConfig {
  baseMs?: number
  capMs?: number
  factor?: number
  jitter?: 'full' | 'equal' | 'none'
}

const DEFAULT_RETRY_BACKOFF: Required<RetryBackoffConfig> = {
  baseMs: 1500,
  capMs: 30_000,
  factor: 2,
  jitter: 'full',
}

/**
 * hidock-graph-extraction-hardening Task 10.3 (Req 7.2) — compute the backoff
 * delay for a 1-based `attempt` number under bounded exponential backoff +
 * jitter. PURE + deterministic given `rand` (defaults to `Math.random`), so
 * tests can assert both the CAP and the jitter ENVELOPE precisely.
 *
 * Formula:
 *   raw    = baseMs * factor^(attempt - 1)
 *   capped = min(raw, capMs)                       // clamp BEFORE jitter
 *   full   = rand() * capped                       // uniform [0, capped]
 *   equal  = capped/2 + rand() * capped/2          // uniform [capped/2, capped]
 *
 * The clamp happens BEFORE jitter, so the returned delay is ALWAYS in
 * `[0, capMs]` (full) / `[capMs/2, capMs]`-bounded-above-by-capMs (equal) — it
 * can never exceed the configured cap.
 */
export function computeBackoffDelayMs(
  attempt: number,
  config: RetryBackoffConfig = {},
  rand: () => number = Math.random
): number {
  const { baseMs, capMs, factor, jitter } = { ...DEFAULT_RETRY_BACKOFF, ...config }
  const raw = baseMs * Math.pow(factor, Math.max(0, attempt - 1))
  const capped = Math.min(raw, capMs)
  if (jitter === 'none') return capped
  if (jitter === 'equal') return capped / 2 + rand() * (capped / 2)
  return rand() * capped // 'full'
}

/**
 * hidock-graph-extraction-hardening Task 10.3 (Req 7.3) — an INTERRUPTIBLE
 * sleep. Resolves after `ms`, OR rejects promptly with a {@link RetryCancelledError}
 * the instant the injected {@link AbortSignal} fires — the pending timer is
 * cleared and the abort listener removed so nothing leaks. Unlike a bare
 * `setTimeout` await, an app shutdown / cancellation does NOT have to wait out
 * the full backoff. `attempts` is threaded only so the thrown error can report
 * the count (Req 7.5). An injected `sleepImpl` lets tests substitute a fake
 * clock without racing real time.
 */
function interruptibleSleep(
  ms: number,
  attempts: number,
  signal?: AbortSignal,
  sleepImpl: (ms: number) => { promise: Promise<void>; cancel: () => void } = defaultSleep
): Promise<void> {
  if (signal?.aborted) return Promise.reject(new RetryCancelledError(attempts))
  return new Promise<void>((resolve, reject) => {
    const { promise, cancel } = sleepImpl(ms)
    const onAbort = () => {
      cancel()
      reject(new RetryCancelledError(attempts))
    }
    signal?.addEventListener('abort', onAbort, { once: true })
    promise.then(() => {
      signal?.removeEventListener('abort', onAbort)
      resolve()
    })
  })
}

/** Default timer-backed sleep with a cancel handle (so the abort path clears it). */
function defaultSleep(ms: number): { promise: Promise<void>; cancel: () => void } {
  let handle: ReturnType<typeof setTimeout>
  const promise = new Promise<void>((r) => {
    handle = setTimeout(r, ms)
  })
  return { promise, cancel: () => clearTimeout(handle) }
}

/**
 * hidock-graph-extraction-hardening Task 10.3 — options for {@link completeWithRetry}.
 * All optional; omitting them preserves the pre-task-10.3 behaviour (bar the
 * backoff now being bounded-exponential-with-jitter instead of linear).
 *
 *   - `signal`   an {@link AbortSignal} tied to app shutdown / user cancellation.
 *               A pending backoff (and the loop itself) abort promptly on it and
 *               the sequence terminates as `cancelled` with NO further provider
 *               attempt (Req 7.3).
 *   - `backoff`  {@link RetryBackoffConfig} overrides (base/cap/factor/jitter).
 *   - `onOutcome` a callback invoked EXACTLY ONCE with the {@link RetryOutcome}
 *               (attempts made + terminal category) as the loop terminates —
 *               success OR any thrown terminal. This is the least-invasive way
 *               to surface Req 7.5 reporting without changing the `Promise<string>`
 *               return shape the three existing callers rely on. The same outcome
 *               is ALSO attached to any thrown error as a non-enumerable
 *               `.retryOutcome` for callers that prefer to read it off the catch.
 *   - `sleepImpl` test seam: a fake sleep with a cancel handle (defaults to a
 *               real timer). Never used in production.
 *   - `rand`    test seam for the jitter RNG (defaults to `Math.random`).
 */
export interface CompleteWithRetryOptions {
  signal?: AbortSignal
  backoff?: RetryBackoffConfig
  onOutcome?: (outcome: RetryOutcome) => void
  sleepImpl?: (ms: number) => { promise: Promise<void>; cancel: () => void }
  rand?: () => number
}

/**
 * Attach a {@link RetryOutcome} to a thrown error as a NON-ENUMERABLE
 * `.retryOutcome` (so it never leaks into a `JSON.stringify` of the error and
 * carries only counts + category — Req 7.5/7.6) and return the same error. If
 * the thrown value is not an object we cannot annotate it; the `onOutcome`
 * callback still fires, so reporting is never lost.
 */
function annotateWithOutcome(err: unknown, outcome: RetryOutcome): unknown {
  if (err && typeof err === 'object') {
    Object.defineProperty(err, 'retryOutcome', {
      value: outcome,
      enumerable: false,
      configurable: true,
      writable: true,
    })
  }
  return err
}

/**
 * hidock-graph-extraction-hardening Task 10.3 — the terminal category for a
 * thrown error, derived WITHOUT reading any message text (Req 7.6): a
 * {@link RetryCancelledError} ⇒ `cancelled`; a {@link PrivacyBlockedError} ⇒
 * `privacy_blocked`; a still-transient error at budget exhaustion ⇒
 * `transient-exhausted`; anything else ⇒ `terminal-error`.
 */
function categorizeRetryError(err: unknown, exhausted: boolean): RetryTerminalCategory {
  if (err instanceof RetryCancelledError) return 'cancelled'
  if (err instanceof PrivacyBlockedError) return 'privacy_blocked'
  if (exhausted && isTransientTransportError(err)) return 'transient-exhausted'
  return 'terminal-error'
}

/**
 * Transient-error retry around the extraction LLM call — hardened per Task 10.3.
 *
 * Behaviour (Req 7.2–7.6):
 *   - BOUNDED EXPONENTIAL BACKOFF + JITTER (Req 7.2): between retries it waits a
 *     {@link computeBackoffDelayMs} delay (exponential in the attempt number,
 *     jittered, CLAMPED to a configured `capMs`) instead of the old linear
 *     `1500 * i`. Defaults keep a 3-attempt loop's waits in the same ballpark.
 *   - CANCELLATION / SHUTDOWN AWARE (Req 7.3): an optional {@link AbortSignal}
 *     is checked before every attempt AND interrupts a pending backoff — on
 *     abort the loop stops, makes NO further `complete()` call, and terminates
 *     as `cancelled` (a typed {@link RetryCancelledError}).
 *   - PER-ATTEMPT ELIGIBILITY RECHECK (Req 7.4, unchanged from task 5.1):
 *     `checkEligible` runs immediately before EVERY provider attempt (initial +
 *     every retry). A non-`eligible` status aborts with a
 *     {@link PrivacyBlockedError} and NO provider call.
 *   - REPORTED ATTEMPTS + TERMINAL CATEGORY (Req 7.5): the number of attempts
 *     made and the {@link RetryTerminalCategory} are reported via the optional
 *     `onOutcome` callback (fired exactly once) and attached to any thrown error
 *     as a non-enumerable `.retryOutcome`. The `Promise<string>` return shape is
 *     UNCHANGED so the existing callers need no edits (least-invasive design).
 *   - PRIVACY-SAFE LOGGING (Req 7.6, preserved): the retry log line emits only a
 *     stable transport code/status/name + counts — never a prompt, transcript,
 *     model output, or credential.
 *
 * @param prompt        the extraction prompt
 * @param cfg           resolved provider config (extraction model)
 * @param attempts      max attempts (default 3)
 * @param checkEligible OPTIONAL per-attempt eligibility recheck (task 5.1)
 * @param options       OPTIONAL {@link CompleteWithRetryOptions} (signal, backoff,
 *                      onOutcome, and test seams)
 */
export async function completeWithRetry(
  prompt: string,
  cfg: Parameters<typeof complete>[1],
  attempts = 3,
  checkEligible?: () => RecordingEligibilityStatus,
  options: CompleteWithRetryOptions = {}
): Promise<string> {
  const { signal, backoff, onOutcome, sleepImpl, rand } = options
  let lastErr: unknown
  let made = 0 // provider attempts actually MADE (Req 7.5 count)

  const report = (outcome: RetryOutcome): void => {
    try {
      onOutcome?.(outcome)
    } catch {
      /* a reporting-callback failure must never mask the real result */
    }
  }
  const fail = (err: unknown, exhausted: boolean): never => {
    const outcome: RetryOutcome = { attempts: made, category: categorizeRetryError(err, exhausted) }
    report(outcome)
    throw annotateWithOutcome(err, outcome)
  }

  for (let i = 1; i <= attempts; i++) {
    // CANCELLATION (Req 7.3): honour a shutdown/cancellation signal BEFORE the
    // attempt — do not start another provider call once cancelled.
    if (signal?.aborted) fail(new RetryCancelledError(made), false)

    // PER-ATTEMPT RECHECK (Req 3.1/7.4): re-verify eligibility IMMEDIATELY
    // BEFORE this provider attempt — the first attempt (as authoritative as the
    // task-2.4 fetch-time gate) AND every retry after a backoff. A non-eligible
    // recheck aborts BEFORE the provider call with the typed sentinel so nothing
    // else fires. Decided independently of the transport-error classifier.
    if (checkEligible) {
      const status = checkEligible()
      if (status.kind !== 'eligible') fail(new PrivacyBlockedError(status), false)
    }
    try {
      made++
      const out = await complete(prompt, cfg)
      report({ attempts: made, category: 'success' })
      return out
    } catch (e) {
      lastErr = e
      // TYPED classification (task 10.1, Req 7.1/7.7): retry ONLY genuine
      // transient TRANSPORT errors, decided from error codes/classes/status —
      // never from a `"network"` (or any) substring. A typed ExtractionError/
      // SchemaError is TERMINAL here (routed to the schema-repair policy).
      const transient = isTransientTransportError(e)
      if (!transient) fail(e, false) // terminal-error
      if (i === attempts) fail(e, true) // transient budget exhausted
      // Bounded, non-sensitive log line: a stable transport CODE/status/name +
      // counts — never the prompt, transcript, or raw model output (Req 7.6).
      const code = extractErrorCode(e)
      const httpStatus = extractHttpStatus(e)
      const sig = code ?? (typeof httpStatus === 'number' ? `HTTP ${httpStatus}` : (e instanceof Error ? e.name : 'transport error'))
      // BOUNDED EXPONENTIAL BACKOFF + JITTER, CAPPED (Req 7.2).
      const backoffMs = Math.round(computeBackoffDelayMs(i, backoff, rand))
      console.warn(`[KnowledgeGraph] extraction transport error (attempt ${i}/${attempts}), retrying in ${backoffMs}ms: ${sig}`)
      // INTERRUPTIBLE backoff (Req 7.3): a cancellation during the wait rejects
      // promptly with RetryCancelledError → categorized as `cancelled` below,
      // with NO further provider attempt.
      try {
        await interruptibleSleep(backoffMs, made, signal, sleepImpl)
      } catch (sleepErr) {
        fail(sleepErr, false) // RetryCancelledError ⇒ cancelled
      }
    }
  }
  // Unreachable in practice (the loop always fails() on its last iteration), but
  // keep a defensive terminal report so no path returns without an outcome. The
  // explicit `throw` also satisfies control-flow analysis for a value-returning
  // async function whose only exits are inside the loop.
  const outcome: RetryOutcome = { attempts: made, category: categorizeRetryError(lastErr, true) }
  report(outcome)
  throw annotateWithOutcome(lastErr, outcome)
}

const graphDbAdapter: GraphDb = {
  run(sql: string, params?: unknown[]) {
    run(sql, (params ?? []) as any[])
  },
  queryAll<T>(sql: string, params?: unknown[]): T[] {
    return queryAll<T>(sql, (params ?? []) as any[])
  },
  queryOne<T>(sql: string, params?: unknown[]): T | undefined {
    return queryOne<T>(sql, (params ?? []) as any[])
  },
  // ADV52-1 (round-54): expose the engine's RE-ENTRANT transaction primitive so
  // the package's mergeNodes runs atomically on the shared DB. Re-entrant means a
  // mergeNodes called while an outer transaction is already open (e.g. inside an
  // ingest/removeRecordingProvenance runInTransaction) joins that transaction
  // rather than issuing a nested BEGIN — and a COMMIT persists (better-sqlite3 +
  // WAL) only on success, so a rolled-back merge is never written to disk.
  runInTransaction<T>(fn: () => T): T {
    return runInTransaction(fn)
  },
}

// ---------------------------------------------------------------------------
// Singleton store (lazy init on first use)
// ---------------------------------------------------------------------------

let _store: KnowledgeGraphStore | null = null

export function getKnowledgeGraphStore(): KnowledgeGraphStore {
  if (!_store) {
    _store = new KnowledgeGraphStore(graphDbAdapter)
  }
  // Always (re-)run schema init — idempotent (CREATE TABLE IF NOT EXISTS).
  // This ensures graph tables + tracking table exist even when the DB engine
  // has been re-initialized since the singleton was created (e.g., in tests).
  _store.initSchema()
  _ensureIngestTrackingTable()
  _runLegacyMarkerMigrationOnce()
  return _store
}

/**
 * hidock-graph-extraction-hardening Task 8.3 (Req 5.2) — run the additive,
 * idempotent legacy-marker migration exactly once per store init, alongside the
 * schema DDL. Re-entrancy guarded because {@link migrateLegacyIngestMarkers}
 * itself calls {@link getKnowledgeGraphStore} (to guarantee the tables exist);
 * without the guard that call would recurse back into this init path. Failures
 * are swallowed (logged) so a migration hiccup can never block the store from
 * initialising — the legacy markers remain intact and readable regardless.
 */
let _migratingLegacyMarkers = false

/**
 * hidock-graph-extraction-hardening Task 8.7 (Req 5.4) — run `fn` with the
 * legacy-marker migration SUPPRESSED.
 *
 * The atomic current-marking stamp ({@link recordIngestionRun}) runs INSIDE the
 * ingest transaction, AFTER the `graph_ingested_transcripts` marker has been
 * inserted in that same transaction. `recordIngestionRun` calls
 * {@link getKnowledgeGraphStore} (to guarantee its table exists), which triggers
 * {@link _runLegacyMarkerMigrationOnce}. Left unsuppressed, that migration would
 * observe the just-inserted marker as an "unmigrated legacy marker" and
 * synthesize a spurious `legacy` sentinel `ingestion_run` row alongside the real
 * `success` row we are about to write — polluting the provenance ledger on every
 * fresh ingest. Reusing the migration's own re-entrancy flag suppresses that
 * mid-transaction re-trigger: the tables are already ensured at the start of
 * each ingest entry point, so nothing is lost. Restores the prior flag value in
 * `finally` so nested/normal use is unaffected.
 */
function _withLegacyMigrationSuppressed<T>(fn: () => T): T {
  const prev = _migratingLegacyMarkers
  _migratingLegacyMarkers = true
  try {
    return fn()
  } finally {
    _migratingLegacyMarkers = prev
  }
}

function _runLegacyMarkerMigrationOnce(): void {
  if (_migratingLegacyMarkers) return
  _migratingLegacyMarkers = true
  try {
    migrateLegacyIngestMarkers()
  } catch (e) {
    console.warn('[KnowledgeGraph] Legacy ingest-marker migration failed (markers left intact):', e)
  } finally {
    _migratingLegacyMarkers = false
  }
}

function _ensureIngestTrackingTable(): void {
  try {
    run(
      `CREATE TABLE IF NOT EXISTS graph_ingested_transcripts (
        transcript_id TEXT PRIMARY KEY,
        ingested_at TEXT NOT NULL
      )`
    )
    run(
      `CREATE TABLE IF NOT EXISTS graph_ingested_artifacts (
        artifact_id TEXT PRIMARY KEY,
        source_id TEXT NOT NULL,
        meeting_id TEXT NOT NULL,
        content_hash TEXT NOT NULL,
        ingested_at TEXT NOT NULL
      )`
    )
    // hidock-graph-extraction-hardening Task 8.1 (Req 5.1) — durable extraction
    // provenance. ONE row per extraction ATTEMPT (success OR failure), carrying
    // every provenance field Req 5.1 requires: transcript/recording ids, the
    // transcript content hash, provider + model, prompt version + hash, schema +
    // parser versions, started/completed timestamps, the terminal status, a
    // BOUNDED + redacted `error_summary` that NEVER contains transcript text
    // (see makeIngestionRunErrorSummary), and the accepted / privacy-filtered
    // entity counts. App-side tracking table (like `graph_ingested_transcripts`),
    // NOT part of the graph schema. Idempotent (CREATE TABLE IF NOT EXISTS).
    run(
      `CREATE TABLE IF NOT EXISTS ingestion_run (
        id                     INTEGER PRIMARY KEY,
        transcript_id          TEXT    NOT NULL,
        recording_id           TEXT    NOT NULL,
        transcript_hash        TEXT    NOT NULL,
        provider               TEXT    NOT NULL,
        model                  TEXT    NOT NULL,
        prompt_version         TEXT    NOT NULL,
        prompt_hash            TEXT    NOT NULL,
        schema_version         TEXT    NOT NULL,
        parser_version         TEXT    NOT NULL,
        started_at             TEXT    NOT NULL,
        completed_at           TEXT,
        status                 TEXT    NOT NULL,
        error_summary          TEXT,
        accepted_entity_count  INTEGER NOT NULL DEFAULT 0,
        privacy_filtered_count INTEGER NOT NULL DEFAULT 0
      )`
    )
    run('CREATE INDEX IF NOT EXISTS idx_ingestion_run_transcript ON ingestion_run(transcript_id)')
    run('CREATE INDEX IF NOT EXISTS idx_ingestion_run_recording ON ingestion_run(recording_id)')
  } catch (e) {
    console.warn('[KnowledgeGraph] Could not create graph ingest tracking tables:', e)
  }
}

// Graph provenance historically names its source column `recording_id`. Keep
// that stable schema while admitting positively-verified standalone captures by
// namespacing them. Every read boundary below resolves these ids through the
// matching eligibility allowlist; an unknown id remains ineligible.
const CAPTURE_GRAPH_SOURCE_PREFIX = 'capture:'

function captureGraphSourceId(captureId: string): string {
  return `${CAPTURE_GRAPH_SOURCE_PREFIX}${captureId}`
}

/**
 * hidock-graph-extraction-hardening Task 5.1 — the CAPTURE analogue of
 * `isEligible(recordingId)` for the capture-backed entry point
 * (`ingestFromHiNotesArtifacts`). HiNotes material is keyed by knowledge-capture
 * id, not a recording id, so its authoritative predicate is
 * `filterEligibleCaptureIds` (which inherits the source recording's
 * personal/deleted/purged/value-excluded exclusion and is fail-closed). This
 * wraps a SINGLE-capture recheck into the SAME `RecordingEligibilityStatus`
 * union `completeWithRetry`'s `checkEligible` callback expects, so the
 * per-attempt recheck seam is identical across both entry points and can never
 * diverge:
 *   - capture present in the eligible set → `{ kind: 'eligible' }`
 *   - `failClosed` (the capture/recording eligibility LOOKUP could not
 *     complete) → `{ kind: 'lookup_error' }` — a fail-closed operational
 *     failure, NOT a silent privacy skip
 *   - capture absent from the eligible set (dropped by the fail-closed
 *     boundary: deleted, or its source recording is personal/deleted/purged/
 *     value-excluded, or a standalone value exclusion) → `privacy_blocked`. The
 *     capture boundary does not expose a granular reason, so this maps to
 *     `value_excluded` as the capture-level exclusion classification (the same
 *     way the fetch-time capture gate reports these drop-outs as
 *     `privacy_blocked`).
 */
function isCaptureEligibleStatus(captureId: string): RecordingEligibilityStatus {
  const { eligible, failClosed } = filterEligibleCaptureIds([captureId])
  if (failClosed) {
    return { kind: 'lookup_error', error: 'capture eligibility lookup failed (fail-closed)' }
  }
  if (eligible.has(captureId)) {
    return { kind: 'eligible' }
  }
  return { kind: 'privacy_blocked', reason: 'value_excluded' }
}

function getEligibleGraphSourceIds(candidateIds: Iterable<string>): {
  eligible: Set<string>
  failClosed: boolean
} {
  const unique = [...new Set([...candidateIds].filter((id): id is string => !!id))]
  const recordingIds = unique.filter((id) => !id.startsWith(CAPTURE_GRAPH_SOURCE_PREFIX))
  const capturePairs = unique
    .filter((id) => id.startsWith(CAPTURE_GRAPH_SOURCE_PREFIX))
    .map((sourceId) => ({ sourceId, captureId: sourceId.slice(CAPTURE_GRAPH_SOURCE_PREFIX.length) }))

  const recordings = filterEligibleRecordingIds(recordingIds)
  const captures = filterEligibleCaptureIds(capturePairs.map((pair) => pair.captureId))
  if (recordings.failClosed || captures.failClosed) {
    return { eligible: new Set<string>(), failClosed: true }
  }

  const eligible = new Set(recordings.eligible)
  for (const pair of capturePairs) {
    if (captures.eligible.has(pair.captureId)) eligible.add(pair.sourceId)
  }
  return { eligible, failClosed: false }
}

/**
 * F17/T6 (spec-006) AR3-3(a) — graph-health pre-flight for a hard purge.
 * Called from the IPC handler layer (recording-deletion-handlers.ts) BEFORE
 * deleteCascade, so a broken graph store (corrupt DB, disk full, permission
 * denied) is caught with an honest, fast failure OUTSIDE the delete
 * transaction — never discovered only after a write transaction is already
 * open. Runs store init (idempotent DDL — now surfaces real failures per
 * AR3-3b) plus a 1-row sanity SELECT that proves the connection actually
 * works, not just that initSchema() didn't throw. Never throws to the caller;
 * the fail-closed refusal itself is the hard branch's own AR3-1 seam check
 * inside deleteRecordingCascade — this is purely an earlier, cheaper warning.
 */
export function ensureGraphReady(): { ok: boolean; error?: string } {
  try {
    const store = getKnowledgeGraphStore()
    store.db.queryOne('SELECT 1 AS ok')
    return { ok: true }
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e)
    console.error('[KnowledgeGraph] ensureGraphReady failed:', e)
    return { ok: false, error }
  }
}

// ---------------------------------------------------------------------------
// Person identity resolution (R4c — key person nodes by contact id)
// ---------------------------------------------------------------------------

/** The confidence at/above which we key a person node by contact id (the
 *  resolver's auto-link line). Below it, the node stays name-keyed. */
const REKEY_CONFIDENCE = 0.8

/**
 * A PersonResolver for graph ingest: turns a raw name into a canonical contact
 * identity when the shared entity resolver is confident enough, using meeting
 * co-occurrence as context. Returns null (→ name-keyed node) otherwise.
 */
function makePersonResolver(meetingId?: string): PersonResolver {
  return (name: string) => {
    try {
      // forKeying (ADV30-2): resolve a person node's stable contact-id norm_key,
      // PREFERRING a VISIBLE same-name contact and NEVER keying to a suppressed one
      // (a keyed node becomes graph-visible via the eligible recording's edges, which
      // would leak the suppressed contact's fields). Only-suppressed ⇒ null ⇒ the
      // node stays name-keyed.
      const r = resolveContact(name, { forKeying: true, ...(meetingId ? { meetingId } : {}) })
      if (r.id && r.confidence >= REKEY_CONFIDENCE) {
        const contact = getContactById(r.id)
        return { id: r.id, label: contact?.name ?? name }
      }
    } catch (e) {
      console.warn('[KnowledgeGraph] person resolve failed:', e)
    }
    return null
  }
}

// ---------------------------------------------------------------------------
// Ingestion from DB transcripts
// ---------------------------------------------------------------------------

interface TranscriptRow {
  id: string
  full_text: string
  recording_id: string
  date_recorded: string | null
  meeting_id: string | null
  subject: string | null
}

/**
 * hidock-graph-extraction-hardening Task 4.7 — per-transcript batch-result
 * status discriminant.
 *
 * This is the FORMALISED outcome for a single item in a batch ingest pass. It
 * is a strict superset of the pre-existing counters (`ingested` / `skipped` /
 * `extractionFailures`) — every item that touched a counter now also emits one
 * {@link BatchResultEntry} carrying its outcome. The vocabulary is deliberately
 * aligned with (and a superset of) the `ingestion_run.status` vocabulary that
 * task 8.1 uses (`success | extraction_error | schema_error | privacy_blocked |
 * cancelled`), so the two never drift:
 *
 *   - `success`          — extracted (possibly empty) and marked ingested.
 *   - `skipped`          — a benign no-op: already ingested, or filtered out for
 *                          a non-privacy reason.
 *   - `privacy_blocked`  — excluded by the recording/capture eligibility gate
 *                          (personal / deleted / purged / value-excluded). A
 *                          privacy exclusion, NOT a failure.
 *   - `extraction_error` — typed {@link ExtractionError} (provider returned
 *                          invalid JSON). Nothing written, transcript retryable.
 *   - `schema_error`     — typed `SchemaError` (valid JSON, schema-noncompliant).
 *                          Nothing written, transcript retryable.
 *   - `error`            — any other collected error (transport failure, an
 *                          eligibility LOOKUP failure, a promotion failure).
 *
 * PRIVACY (Req 2.5): an entry carries ONLY the `transcriptId`, the `status`, an
 * optional stable `errorCategory`, and an optional bounded+redacted
 * `errorSummary`. It NEVER carries the transcript body, the prompt, or the raw
 * model output. `errorSummary` is capped and only ever holds a fixed error
 * `name`/short phrase (for typed failures) or a provider/transport message that
 * cannot contain transcript text (see {@link summarizeBatchError}).
 */
export type BatchResultStatus =
  | 'success'
  | 'skipped'
  | 'privacy_blocked'
  | 'extraction_error'
  | 'schema_error'
  | 'error'

/** Maximum length of a surfaced {@link BatchResultEntry.errorSummary}. Keeps
 *  the redacted summary bounded so a runaway provider/transport message can
 *  never balloon a batch report (design §Error Handling & Security). */
export const BATCH_ERROR_SUMMARY_MAX = 200

export interface BatchResultEntry {
  transcriptId: string
  status: BatchResultStatus
  /**
   * Stable, non-sensitive discriminant (`'extraction_error' | 'schema_error'`)
   * for a failure raised by the typed extraction-error hierarchy. Present ONLY
   * for `extraction_error` / `schema_error` statuses; absent otherwise. NEVER
   * carries transcript text, prompts, or raw model output.
   */
  errorCategory?: ExtractionErrorCategory
  /**
   * Bounded, redacted human-readable summary. For a typed extraction/schema
   * failure this is the error `name` (a fixed phrase); for other errors it is
   * the bounded provider/transport message. NEVER contains the transcript body,
   * the prompt, or the raw model output. Absent for `success` / `skipped` /
   * `privacy_blocked`.
   */
  errorSummary?: string
}

export interface IngestResult {
  ingested: number
  skipped: number
  /**
   * hidock-graph-extraction-hardening Task 4.5 — count of transcripts whose
   * extraction was ABORTED by a typed {@link ExtractionError} / `SchemaError`
   * (malformed/schema-noncompliant model output). These transcripts wrote no
   * graph rows, no first-class rows, and NO marker — they stay unmarked and
   * retryable. This counter is deliberately DISTINCT from:
   *   - `skipped` (a privacy/eligibility exclusion or an already-ingested
   *     no-op — NOT a failure), and
   *   - a successful EMPTY extraction (schema-compliant, empty arrays) which
   *     is a success and IS marked ingested.
   * The failures are also collected in {@link IngestResult.errors} with a
   * bounded, non-sensitive `errorCategory` so task 4.7 can formalise the
   * `{ transcriptId, status, errorCategory }` batch-result shape.
   */
  extractionFailures: number
  errors: Array<{
    transcriptId: string
    error: string
    /**
     * Stable, non-sensitive discriminant (`'extraction_error' | 'schema_error'`)
     * for a failure raised by the typed extraction-error hierarchy. Present
     * ONLY for extraction/schema failures; absent for other collected errors
     * (e.g. an eligibility lookup failure or a provider transport error).
     * NEVER carries transcript text, prompts, or raw model output.
     */
    errorCategory?: ExtractionErrorCategory
  }>
  /**
   * hidock-graph-extraction-hardening Task 4.7 — the FORMALISED per-transcript
   * batch result. One {@link BatchResultEntry} per item processed, each with an
   * explicit {@link BatchResultStatus} discriminant plus (for failures) a stable
   * `errorCategory` and a bounded, redacted `errorSummary`. This is the
   * surfacing contract for Req 2.5: it lets a caller tell a `schema_error` apart
   * from a `privacy_blocked` skip or a plain `success` WITHOUT inspecting the
   * legacy `errors[]`/counters, and it is guaranteed free of transcript text,
   * prompts, or raw model output. The legacy `errors`/`ingested`/`skipped`/
   * `extractionFailures` fields are retained unchanged for backward compat.
   */
  results: BatchResultEntry[]
}

/**
 * hidock-graph-extraction-hardening Task 4.7 — bounded + redacted error summary
 * for a {@link BatchResultEntry}.
 *
 * Redaction contract (Req 2.5 / 7.6): the returned string NEVER contains the
 * transcript body, the prompt, or the raw model output.
 *   - Typed {@link ExtractionError} / `SchemaError`: their `message` is a fixed,
 *     bounded, non-sensitive constant (see extract.ts), and their `name` is a
 *     stable phrase. We surface the `name` — never any model output.
 *   - Other errors (transport/eligibility): their `message` is a provider- or
 *     transport-shaped string (e.g. "fetch failed", "API rate limit") that the
 *     pipeline never interpolates transcript content into. We still HARD-CAP it
 *     so a pathological message cannot balloon the report.
 * A non-Error value is stringified and capped the same way.
 */
export function summarizeBatchError(e: unknown): string {
  const raw = e instanceof ExtractionError ? e.name : e instanceof Error ? e.message : String(e)
  return raw.length > BATCH_ERROR_SUMMARY_MAX ? `${raw.slice(0, BATCH_ERROR_SUMMARY_MAX)}…` : raw
}

// ---------------------------------------------------------------------------
// hidock-graph-extraction-hardening Task 8.1 (Req 5.1) — Ingestion_Run provenance
// ---------------------------------------------------------------------------

/**
 * Terminal status of a single extraction ATTEMPT recorded in `ingestion_run`.
 * Deliberately a SUBSET of {@link BatchResultStatus} restricted to the outcomes
 * an attempt can terminate in (design §5 / the DDL's `status` comment):
 *   - `success`          — extraction completed (possibly empty) and persisted.
 *   - `extraction_error` — typed `ExtractionError` (provider returned invalid JSON).
 *   - `schema_error`     — typed `SchemaError` (valid JSON, schema-noncompliant).
 *   - `privacy_blocked`  — excluded by the eligibility gate before/around the attempt.
 *   - `cancelled`        — a cancellation/shutdown signal stopped the attempt.
 */
export type IngestionRunStatus =
  | 'success'
  | 'extraction_error'
  | 'schema_error'
  | 'privacy_blocked'
  | 'cancelled'

/**
 * hidock-graph-extraction-hardening Task 8.1 (Req 5.1) — one row per extraction
 * ATTEMPT. Mirrors the `ingestion_run` columns 1:1 (camelCase here, snake_case
 * in SQL). Every provenance field Req 5.1 enumerates is present:
 *   - identity: `transcriptId`, `recordingId`
 *   - content: `transcriptHash` (the transcript CONTENT HASH — a reference, never
 *     the transcript text itself)
 *   - model config: `provider`, `model`
 *   - versioning: `promptVersion`, `promptHash`, `schemaVersion`, `parserVersion`
 *   - timing: `startedAt`, optional `completedAt`
 *   - outcome: `status`, optional bounded+redacted `errorSummary`
 *   - counts: `acceptedEntityCount`, `privacyFilteredCount`
 *
 * PRIVACY (Req 5.1): `errorSummary` is bounded (<= {@link INGESTION_RUN_ERROR_SUMMARY_MAX})
 * and MUST NOT contain transcript text — it is always built via
 * {@link makeIngestionRunErrorSummary}, which surfaces only a typed error name or
 * a bounded provider/transport phrase.
 */
export interface IngestionRunRow {
  id: number
  transcriptId: string
  recordingId: string
  transcriptHash: string
  provider: string
  model: string
  promptVersion: string
  promptHash: string
  schemaVersion: string
  parserVersion: string
  startedAt: string
  completedAt?: string
  status: IngestionRunStatus
  errorSummary?: string
  acceptedEntityCount: number
  privacyFilteredCount: number
}

/** Fields required to record an ingestion run (id + timing default is filled in). */
export type IngestionRunInput = Omit<IngestionRunRow, 'id'>

/**
 * Maximum length of a stored {@link IngestionRunRow.errorSummary}. Bounds the
 * redacted summary so a runaway provider/transport message can never balloon the
 * provenance row (design §5 / §Error Handling & Security). Matches the batch
 * report cap ({@link BATCH_ERROR_SUMMARY_MAX}) so the two never drift.
 */
export const INGESTION_RUN_ERROR_SUMMARY_MAX = BATCH_ERROR_SUMMARY_MAX

/**
 * hidock-graph-extraction-hardening Task 8.1 (Req 5.1) — build a BOUNDED,
 * TRANSCRIPT-TEXT-FREE `error_summary` for an `ingestion_run` row.
 *
 * Redaction contract (Req 5.1 / 7.6): the returned string NEVER contains the
 * transcript body, the prompt, or the raw model output.
 *   - Typed {@link ExtractionError} / `SchemaError`: their `message` is a fixed,
 *     bounded, non-sensitive constant and their `name` is a stable phrase — we
 *     surface only the `name`.
 *   - Any other error (transport/eligibility): its `message` is a provider- or
 *     transport-shaped string the pipeline never interpolates transcript content
 *     into. We still HARD-CAP it.
 * The result is additionally stripped of newlines/tabs (collapsed to single
 * spaces) so a multi-line provider dump cannot smuggle transcript-shaped text,
 * then truncated to {@link INGESTION_RUN_ERROR_SUMMARY_MAX}. Returns `undefined`
 * for a nullish input (a successful attempt records no summary).
 */
export function makeIngestionRunErrorSummary(e: unknown): string | undefined {
  if (e == null) return undefined
  const raw = e instanceof ExtractionError ? e.name : e instanceof Error ? e.message : String(e)
  const collapsed = raw.replace(/\s+/g, ' ').trim()
  if (collapsed.length === 0) return undefined
  return collapsed.length > INGESTION_RUN_ERROR_SUMMARY_MAX
    ? `${collapsed.slice(0, INGESTION_RUN_ERROR_SUMMARY_MAX)}…`
    : collapsed
}

/**
 * Persist one {@link IngestionRunRow} (Task 8.1 / Req 5.1). The `errorSummary`,
 * if supplied, is re-bounded defensively at the storage boundary so a row can
 * never be written with an over-long or transcript-shaped summary regardless of
 * how the caller produced it. Returns the assigned row id.
 */
export function recordIngestionRun(input: IngestionRunInput): number {
  getKnowledgeGraphStore() // ensure ingestion_run exists (idempotent CREATE IF NOT EXISTS)
  const errorSummary =
    input.errorSummary != null ? makeIngestionRunErrorSummary(input.errorSummary) ?? null : null
  run(
    `INSERT INTO ingestion_run (
       transcript_id, recording_id, transcript_hash, provider, model,
       prompt_version, prompt_hash, schema_version, parser_version,
       started_at, completed_at, status, error_summary,
       accepted_entity_count, privacy_filtered_count
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      input.transcriptId,
      input.recordingId,
      input.transcriptHash,
      input.provider,
      input.model,
      input.promptVersion,
      input.promptHash,
      input.schemaVersion,
      input.parserVersion,
      input.startedAt,
      input.completedAt ?? null,
      input.status,
      errorSummary,
      input.acceptedEntityCount,
      input.privacyFilteredCount,
    ]
  )
  const row = queryOne<{ id: number }>('SELECT last_insert_rowid() AS id')
  return row?.id ?? 0
}

/** READ-ONLY: fetch a single {@link IngestionRunRow} by id (or undefined). */
export function getIngestionRun(id: number): IngestionRunRow | undefined {
  getKnowledgeGraphStore()
  const r = queryOne<{
    id: number
    transcript_id: string
    recording_id: string
    transcript_hash: string
    provider: string
    model: string
    prompt_version: string
    prompt_hash: string
    schema_version: string
    parser_version: string
    started_at: string
    completed_at: string | null
    status: string
    error_summary: string | null
    accepted_entity_count: number
    privacy_filtered_count: number
  }>('SELECT * FROM ingestion_run WHERE id = ?', [id])
  if (!r) return undefined
  return {
    id: r.id,
    transcriptId: r.transcript_id,
    recordingId: r.recording_id,
    transcriptHash: r.transcript_hash,
    provider: r.provider,
    model: r.model,
    promptVersion: r.prompt_version,
    promptHash: r.prompt_hash,
    schemaVersion: r.schema_version,
    parserVersion: r.parser_version,
    startedAt: r.started_at,
    completedAt: r.completed_at ?? undefined,
    status: r.status as IngestionRunStatus,
    errorSummary: r.error_summary ?? undefined,
    acceptedEntityCount: r.accepted_entity_count,
    privacyFilteredCount: r.privacy_filtered_count,
  }
}

/** READ-ONLY: all {@link IngestionRunRow}s for a transcript, newest-first by id. */
export function getIngestionRunsForTranscript(transcriptId: string): IngestionRunRow[] {
  getKnowledgeGraphStore()
  const rows = queryAll<{ id: number }>(
    'SELECT id FROM ingestion_run WHERE transcript_id = ? ORDER BY id DESC',
    [transcriptId]
  )
  return rows.map((r) => getIngestionRun(r.id)!).filter(Boolean)
}

/**
 * hidock-graph-extraction-hardening Task 8.7 (Req 5.4) — count the ACCEPTED
 * entities in a parsed {@link ExtractionResult}, i.e. the entities that survived
 * the fail-closed personal-content filter (Req 1) and will be persisted into the
 * graph. `extractGraphFromTranscript` / `parseExtractionOutput` return ONLY the
 * retained (explicitly-"work") items — personal/untagged entities are dropped at
 * the parse boundary and are NOT present here — so this sum is exactly the
 * `accepted_entity_count` a `success` `ingestion_run` row should record. The
 * complementary `privacy_filtered_count` is NOT derivable at this seam: the
 * parser discards filtered entities WITHOUT returning a tally, so the atomic
 * `success` stamp records `privacyFilteredCount: 0` (the drop already happened,
 * privately, upstream; the count is not reconstructable without leaking the
 * dropped items). Purely additive read over the seven result arrays.
 */
export function countAcceptedEntities(extraction: ExtractionResult): number {
  return (
    extraction.people.length +
    extraction.topics.length +
    extraction.projects.length +
    extraction.decisions.length +
    extraction.action_items.length +
    extraction.risks.length +
    extraction.next_steps.length
  )
}

// ---------------------------------------------------------------------------
// hidock-graph-extraction-hardening Task 8.5 (Req 5.3) — staleness detection by
// version/hash (COMPARISON ONLY; never deletes, clears, or mutates anything)
// ---------------------------------------------------------------------------

/**
 * Why a transcript's most-relevant extraction is considered STALE relative to
 * the CURRENT extraction generation. A stale result carries one or more of
 * these; a fresh one carries none.
 *
 *  - `prompt_hash`      — the extraction's prompt hash differs from current.
 *  - `schema_version`   — the output-schema version differs from current.
 *  - `parser_version`   — the parser version differs from current.
 *  - `transcript_hash`  — the transcript CONTENT changed since extraction (the
 *                         stored content hash differs from the transcript's
 *                         current hash), so the extraction no longer reflects
 *                         the transcript text.
 *  - `legacy`           — the run was SYNTHESIZED from a legacy
 *                         `graph_ingested_transcripts` marker (Task 8.3): it
 *                         carries no real provenance (sentinels), so it can
 *                         never match a current generation and is always stale.
 *  - `no_prior_run`     — there is no `ingestion_run` row for the transcript at
 *                         all; nothing current has been recorded, so it is
 *                         treated as stale (needs a fresh extraction).
 *
 * Note `legacy` is reported INSTEAD OF the individual field mismatches for a
 * migrated row: a legacy row differs on every field by construction, but the
 * meaningful, actionable reason is "this is a legacy marker", not a noisy list
 * of six sentinel mismatches.
 */
export type StalenessReason =
  | 'prompt_hash'
  | 'schema_version'
  | 'parser_version'
  | 'transcript_hash'
  | 'legacy'
  | 'no_prior_run'

/** Result of a staleness comparison for one transcript (Task 8.5 / Req 5.3). */
export interface StalenessResult {
  /** True when the latest/most-relevant run differs from current in any way. */
  stale: boolean
  /** The specific reason(s); empty iff `stale` is false. */
  reasons: StalenessReason[]
  /**
   * The `ingestion_run.id` the decision was made against, or `null` when there
   * was no prior run (reason `no_prior_run`). Purely informational.
   */
  ingestionRunId: number | null
}

/** A stale transcript surfaced by the batch detector (id + why). */
export interface StaleTranscript {
  transcriptId: string
  reasons: StalenessReason[]
}

/**
 * hidock-graph-extraction-hardening Task 8.5 (Req 5.3) — decide whether a
 * transcript's latest/most-relevant extraction is STALE relative to the CURRENT
 * extraction generation.
 *
 * COMPARISON ONLY. This function issues nothing but SELECTs (via
 * {@link getIngestionRunsForTranscript} + {@link computeTranscriptHash}). It
 * NEVER deletes rows, clears markers, or mutates any table — "identify stale
 * extractions ... without performing blanket deletion" (Req 5.3). Detecting
 * staleness and acting on it are deliberately separate concerns; acting is a
 * scoped, gated re-ingestion operation, not something this read-only comparator
 * ever performs.
 *
 * Algorithm:
 *  1. Take the NEWEST `ingestion_run` for the transcript (they come back
 *     newest-first). No run ⇒ `no_prior_run` (stale).
 *  2. A migration-synthesized (legacy) row ⇒ `legacy` (stale) — it carries only
 *     sentinels and can never be "current".
 *  3. Otherwise compare each of {prompt_hash, schema_version, parser_version}
 *     against `current`, and the stored `transcript_hash` against the
 *     transcript's CURRENT content hash. Any difference is a reason; none ⇒ not
 *     stale.
 *
 * @param transcriptId the transcript to evaluate.
 * @param current      the current generation descriptor. Defaults to
 *                     {@link getCurrentExtractionProvenance} — the SAME single
 *                     source of truth the live extraction path stamps — so the
 *                     comparison uses exactly the "current" values a fresh run
 *                     would write, never a divergent constant.
 */
export function isExtractionStale(
  transcriptId: string,
  current: CurrentExtractionProvenance = getCurrentExtractionProvenance()
): StalenessResult {
  getKnowledgeGraphStore() // ensure ingestion_run/transcripts exist (idempotent); no writes

  const runs = getIngestionRunsForTranscript(transcriptId) // newest-first, READ-ONLY
  const latest = runs[0]

  if (!latest) {
    return { stale: true, reasons: ['no_prior_run'], ingestionRunId: null }
  }

  // A legacy-migrated row (Task 8.3) is identified by its self-describing
  // prompt-hash sentinel. It carries no real provenance, so it is ALWAYS stale;
  // report the single meaningful `legacy` reason rather than six sentinel diffs.
  if (latest.promptHash === LEGACY_MARKER_PROMPT_HASH) {
    return { stale: true, reasons: ['legacy'], ingestionRunId: latest.id }
  }

  const reasons: StalenessReason[] = []
  if (latest.promptHash !== current.promptHash) reasons.push('prompt_hash')
  if (latest.schemaVersion !== current.schemaVersion) reasons.push('schema_version')
  if (latest.parserVersion !== current.parserVersion) reasons.push('parser_version')

  // Transcript-content drift: compare the stored content hash against the
  // transcript's CURRENT hash. If the transcript is gone, we cannot recompute a
  // current hash, so we do NOT invent a transcript_hash mismatch here (absence
  // of the transcript is a separate concern, not a version/hash staleness).
  const t = queryOne<{ full_text: string }>('SELECT full_text FROM transcripts WHERE id = ?', [
    transcriptId,
  ])
  if (t) {
    const currentTranscriptHash = computeTranscriptHash(t.full_text ?? '')
    if (latest.transcriptHash !== currentTranscriptHash) reasons.push('transcript_hash')
  }

  return { stale: reasons.length > 0, reasons, ingestionRunId: latest.id }
}

/**
 * hidock-graph-extraction-hardening Task 8.5 (Req 5.3) — batch variant.
 *
 * Evaluate every MARKED transcript (the population an operator would consider
 * for re-ingestion) and return only the STALE ones with their reasons. READ-ONLY
 * end to end: reuses {@link listMarkedReIngestionCandidates} (SELECT-only) and
 * {@link isExtractionStale} (SELECT-only). Deletes/clears NOTHING and, in
 * particular, performs NO blanket deletion of stale rows (Req 5.3) — it only
 * *identifies* them. Ordered deterministically by transcript id.
 *
 * @param current the current generation descriptor (defaults as in
 *                {@link isExtractionStale}); accepted as a parameter so a caller
 *                computes it once and reuses it across the whole batch.
 */
export function findStaleMarkedTranscripts(
  current: CurrentExtractionProvenance = getCurrentExtractionProvenance()
): StaleTranscript[] {
  getKnowledgeGraphStore()
  const candidates = listMarkedReIngestionCandidates() // READ-ONLY enumerator
  const out: StaleTranscript[] = []
  for (const { transcriptId } of candidates) {
    const result = isExtractionStale(transcriptId, current)
    if (result.stale) out.push({ transcriptId, reasons: result.reasons })
  }
  return out.sort((a, b) => a.transcriptId.localeCompare(b.transcriptId))
}

// ---------------------------------------------------------------------------
// hidock-graph-extraction-hardening Task 8.3 (Req 5.2) — backward-compatible
// marker migration
// ---------------------------------------------------------------------------

/**
 * hidock-graph-extraction-hardening Task 8.3 (Req 5.2) — sentinel written into
 * `ingestion_run.prompt_hash` for every row SYNTHESIZED from a legacy
 * `graph_ingested_transcripts` marker.
 *
 * The legacy marker table `(transcript_id, ingested_at)` predates the Req 5
 * provenance model and carries NO provider/model/prompt/schema/parser/hash
 * information. Migrating a marker therefore cannot fabricate those fields as if
 * they were real — doing so would make a migrated row indistinguishable from a
 * genuine fresh extraction run and corrupt staleness detection (Req 5.3, which
 * compares `prompt_hash`/`schema_version`/`parser_version`/`transcript_hash`).
 *
 * Instead, every unknown provenance field is filled with an explicit,
 * self-describing sentinel (this value for `prompt_hash`, {@link LEGACY_MARKER_SENTINEL}
 * for the rest) so a migrated row is ALWAYS distinguishable from a real run and
 * is NEVER mistaken for "current". This sentinel doubles as the idempotency key:
 * the migration inserts one synthesized row per legacy marker and skips any
 * marker that already carries a row with this `prompt_hash`.
 */
export const LEGACY_MARKER_PROMPT_HASH = 'migration:graph_ingested_transcripts'

/**
 * hidock-graph-extraction-hardening Task 8.3 (Req 5.2) — sentinel value written
 * into the remaining unknown provenance columns of a migrated legacy row
 * (`transcript_hash`, `provider`, `model`, `prompt_version`, `schema_version`,
 * `parser_version`). Marks the field as "not known from the legacy marker",
 * distinct from any real run value and from an empty transcript hash.
 */
export const LEGACY_MARKER_SENTINEL = 'legacy'

/** Report returned by {@link migrateLegacyIngestMarkers}. */
export interface LegacyMarkerMigrationReport {
  /** Total legacy `graph_ingested_transcripts` markers found (pre-migration). */
  totalMarkers: number
  /** Markers newly represented as synthesized `ingestion_run` rows this call. */
  migrated: number
  /** Markers already represented by a prior migration (skipped — idempotent). */
  alreadyMigrated: number
}

/**
 * hidock-graph-extraction-hardening Task 8.3 (Req 5.2) — read every existing
 * `graph_ingested_transcripts` marker and represent it in the new
 * {@link IngestionRunRow} provenance model WITHOUT data loss.
 *
 * Guarantees:
 *  - **No data loss:** every legacy marker gets a synthesized `ingestion_run`
 *    row preserving its `transcript_id` and its `ingested_at` timestamp (mapped
 *    to BOTH `started_at` and `completed_at`, since the legacy marker only
 *    records that ingestion completed at that instant). The `recording_id` is
 *    resolved from the `transcripts` table when available, else a sentinel.
 *  - **No blanket deletion / still readable:** the `graph_ingested_transcripts`
 *    table is NEVER dropped, renamed, or row-deleted. The legacy markers remain
 *    the authoritative "already ingested" source read by the incremental-skip
 *    and re-ingestion-discovery paths. Migration is purely ADDITIVE.
 *  - **No fabricated provenance:** unknown fields are written as explicit
 *    sentinels ({@link LEGACY_MARKER_PROMPT_HASH} / {@link LEGACY_MARKER_SENTINEL}),
 *    so a migrated row is always distinguishable from a genuine fresh run and is
 *    never mistaken for "current" by staleness detection (Req 5.3).
 *  - **Idempotent + backfill-only:** re-running is safe. A marker whose
 *    transcript already has ANY `ingestion_run` row — a prior migration sentinel
 *    OR a real `success` row written atomically by the live ingest path (Task
 *    8.7) — is skipped, so running twice never duplicates provenance and a
 *    genuinely-ingested transcript never gets a spurious `legacy` row.
 *
 * Issues only SELECTs plus additive INSERTs into `ingestion_run`; never a DELETE
 * or DROP. Runs inside a single transaction so the migration is all-or-nothing.
 */
export function migrateLegacyIngestMarkers(): LegacyMarkerMigrationReport {
  // Hold the re-entrancy guard across the ENTIRE body. Both getKnowledgeGraphStore()
  // (ensure-tables) and recordIngestionRun() call getKnowledgeGraphStore(), which
  // calls _runLegacyMarkerMigrationOnce(), which calls back into this function.
  // Without the guard held for the whole body, that inner init-time migration would
  // re-run mid-loop and duplicate rows. With it held, the inner init-migration is a
  // no-op and THIS call exclusively owns the work.
  const wasMigrating = _migratingLegacyMarkers
  _migratingLegacyMarkers = true
  try {
    getKnowledgeGraphStore() // ensure graph_ingested_transcripts + ingestion_run exist (idempotent)

    const markers = queryAll<{ transcript_id: string; ingested_at: string }>(
      'SELECT transcript_id, ingested_at FROM graph_ingested_transcripts ORDER BY transcript_id',
      []
    )

    const report: LegacyMarkerMigrationReport = {
      totalMarkers: markers.length,
      migrated: 0,
      alreadyMigrated: 0,
    }
    if (markers.length === 0) return report

    runInTransaction(() => {
      for (const marker of markers) {
      // Idempotency: skip a marker whose transcript is ALREADY represented by
      // ANY ingestion_run row — not just a prior migration-sourced sentinel row.
      //
      // hidock-graph-extraction-hardening Task 8.7 (Req 5.4) — the live ingest
      // path now writes a REAL `success` ingestion_run row atomically with the
      // `graph_ingested_transcripts` marker. Such a marker is fully represented
      // by that genuine run and must NOT also get a synthesized `legacy`
      // sentinel: doing so would (a) duplicate provenance and (b) let the
      // always-stale legacy row co-exist with the real current row. Checking for
      // ANY row (not `prompt_hash = LEGACY_MARKER_PROMPT_HASH`) makes the
      // migration purely a BACKFILL for markers that predate provenance — a
      // marker with a real run is left exactly as the live path wrote it. (A
      // legacy marker still gets its one sentinel row; re-running stays
      // idempotent because that sentinel row is itself an ingestion_run row.)
      const existing = queryOne<{ id: number }>(
        'SELECT id FROM ingestion_run WHERE transcript_id = ? LIMIT 1',
        [marker.transcript_id]
      )
      if (existing) {
        report.alreadyMigrated++
        continue
      }

      // Resolve the recording id from the transcript when available; the legacy
      // marker itself does not carry it. Absent transcript ⇒ sentinel (no fabrication).
      const t = queryOne<{ recording_id: string | null }>(
        'SELECT recording_id FROM transcripts WHERE id = ?',
        [marker.transcript_id]
      )
      const recordingId = t?.recording_id ?? LEGACY_MARKER_SENTINEL

      // `ingested_at` is the only real datum on the legacy marker; preserve it as
      // both start and completion of the synthesized (already-complete) run.
      recordIngestionRun({
        transcriptId: marker.transcript_id,
        recordingId,
        transcriptHash: LEGACY_MARKER_SENTINEL,
        provider: LEGACY_MARKER_SENTINEL,
        model: LEGACY_MARKER_SENTINEL,
        promptVersion: LEGACY_MARKER_SENTINEL,
        promptHash: LEGACY_MARKER_PROMPT_HASH,
        schemaVersion: LEGACY_MARKER_SENTINEL,
        parserVersion: LEGACY_MARKER_SENTINEL,
          startedAt: marker.ingested_at,
          completedAt: marker.ingested_at,
          status: 'success',
          acceptedEntityCount: 0,
          privacyFilteredCount: 0,
        })
        report.migrated++
      }
    })

    return report
  } finally {
    _migratingLegacyMarkers = wasMigrating
  }
}

export async function ingestFromDbTranscripts(): Promise<IngestResult> {
  // ADV55-1 (round-57): lazy-load provider config so importing this service (now done
  // by org-reconciler for the contact-merge composite) does NOT eagerly pull config.ts,
  // which reads app.getPath('home') at MODULE LOAD. Keeping it lazy lets the graph
  // service be imported in a plain Node context without an Electron `app` mock, while
  // ingestion (which needs the provider) still resolves it here.
  const { getExtractionProviderConfig } = await import('./ai-provider-config')
  const providerConfig = getExtractionProviderConfig()
  if (!providerConfig) {
    throw new Error('No AI provider configured. Please set a provider API key in Settings.')
  }

  const store = getKnowledgeGraphStore()

  // Get all transcripts with recording + meeting meta
  // Cross-reference (/simplify S-5, database.ts's getExcludedRecordingIds):
  // personal/deleted exclusion is composed differently here than in the RAG
  // path — filtered directly in this base query, then layered with
  // value-exclusion below (pre-filter Set + fresh point-read), rather than
  // unioned into one Set. Same net effect; deliberate, not drift.
  const rows = queryAll<TranscriptRow>(`
    SELECT
      t.id,
      t.full_text,
      t.recording_id,
      r.date_recorded,
      r.meeting_id,
      m.subject
    FROM transcripts t
    JOIN recordings r ON r.id = t.recording_id
    LEFT JOIN meetings m ON m.id = r.meeting_id
    WHERE COALESCE(r.personal, 0) = 0 AND r.deleted_at IS NULL
  `)

  const result: IngestResult = { ingested: 0, skipped: 0, extractionFailures: 0, errors: [], results: [] }

  // F16/spec-002 (AR-1, layer 1 of 2): cheap once-per-run PRE-FILTER. A
  // transcript whose recording is already value-excluded at run start is
  // skipped BEFORE the LLM extraction call — no LLM cost, no marker (so a
  // later rating upgrade re-ingests it on a future pass). This snapshot is
  // what bounds the cost: skipped rows are never marked, so without this
  // pre-filter every ingest pass (60s-debounced transcript-ready, boot,
  // manual) would re-run the full extraction for every excluded transcript,
  // forever. The snapshot may go stale across the loop's awaits — that is
  // layer 2's job, not this one's. Defensive try/catch (mirrors the RAG
  // union in getExcludedRecordingIds): a value-query failure degrades to
  // "no pre-filter" rather than failing the whole ingest pass — layer 2
  // still gates each row's persistence.
  let valueExcluded: Set<string>
  try {
    valueExcluded = getValueExcludedRecordingIds()
  } catch (e) {
    console.warn('[KnowledgeGraph] Value pre-filter unavailable (per-row transactional check still gates):', e)
    valueExcluded = new Set<string>()
  }

  for (const row of rows) {
    // Pre-filter (layer 1): excluded at run start — skip without extracting.
    // A value-exclusion is a PRIVACY skip (Task 4.7): surface it as
    // `privacy_blocked`, distinct from a benign already-ingested `skipped`.
    if (valueExcluded.has(row.recording_id)) {
      result.skipped++
      result.results.push({ transcriptId: row.id, status: 'privacy_blocked' })
      console.log(
        `[KnowledgeGraph] Skipped value-excluded recording ${row.recording_id} (transcript ${row.id})`
      )
      continue
    }

    // Check if already ingested (incremental)
    const already = queryOne<{ transcript_id: string }>(
      'SELECT transcript_id FROM graph_ingested_transcripts WHERE transcript_id = ?',
      [row.id]
    )
    if (already) {
      result.skipped++
      result.results.push({ transcriptId: row.id, status: 'skipped' })
      continue
    }

    try {
      // P1 (round-3, FAIL CLOSED) — the value pre-filter Set above degrades to
      // EMPTY on a lookup error (fail-open), which would send an excluded
      // recording's full_text to the LLM. Gate the provider call on an
      // AUTHORITATIVE fresh point-read (exists AND not deleted AND not personal
      // AND not value-excluded) so a transient exclusion-lookup failure never
      // leaks content to the provider.
      //
      // hidock-graph-extraction-hardening Task 2.4 — this is the AUTHORITATIVE
      // Recording_Level_Gate at fetch time (design §1/§3). It runs through the
      // shared `isEligible` seam so an ineligible recording is skipped BEFORE
      // any provider call or promotion, with a precise privacy-blocked reason
      // (personal/deleted/purged/value_excluded) rather than a bare boolean, and
      // WITHOUT writing a marker (the transcript stays retryable). `isEligible`
      // is itself fail-closed and delegates to the same predicate as the in-txn
      // `isRecordingGraphIngestable` recheck below, so the two never diverge.
      // Task 5.1 will reuse this exact seam for the per-attempt recheck loop.
      const gate = isEligible(row.recording_id)
      if (gate.kind === 'lookup_error') {
        // Fail-closed: an eligibility LOOKUP failure (e.g. a transient DB
        // error) is NOT a legitimate privacy skip — surface it as a collected
        // per-row error so the pass doesn't silently drop the transcript, and
        // no marker is written (it stays retryable). The whole ingest pass
        // still completes for the remaining rows.
        result.errors.push({ transcriptId: row.id, error: gate.error })
        result.results.push({
          transcriptId: row.id,
          status: 'error',
          errorSummary: summarizeBatchError(gate.error),
        })
        console.error(
          `[KnowledgeGraph] Eligibility lookup failed for recording ${row.recording_id} before extraction (transcript ${row.id}): ${gate.error}`
        )
        continue
      }
      if (gate.kind !== 'eligible') {
        result.skipped++
        result.results.push({ transcriptId: row.id, status: 'privacy_blocked' })
        console.log(
          `[KnowledgeGraph] Skipped ineligible recording ${row.recording_id} before extraction (transcript ${row.id}, reason=${gate.reason})`
        )
        continue
      }
      const meta = {
        meetingId: row.meeting_id ?? row.recording_id,
        title: row.subject ?? undefined,
        date: row.date_recorded ?? undefined,
      }
      // hidock-graph-extraction-hardening Task 5.1 — per-row LlmExtractor that
      // threads the PER-ATTEMPT eligibility recheck into every provider call.
      // `checkEligible` re-runs the SAME authoritative `isEligible` seam as the
      // fetch-time gate above (they can never diverge), so if this recording
      // becomes personal/deleted/purged/value-excluded during a transport
      // backoff — or between the fetch-time gate and the first attempt — the
      // next `complete()` call is aborted before it fires (Req 3.1, 3.4). A
      // non-eligible recheck throws a typed PrivacyBlockedError caught below.
      const llm: LlmExtractor = (prompt: string) =>
        completeWithRetry(prompt, providerConfig, 3, () => isEligible(row.recording_id))

      // hidock-graph-extraction-hardening Task 8.7 (Req 5.4) — capture the
      // CURRENT-generation provenance the atomic success stamp will write. All
      // computed OUTSIDE the transaction (they only read the transcript text /
      // static build constants):
      //   - `startedAt`: when this attempt began (before the provider call).
      //   - `currentProvenance`: the SAME single-source-of-truth descriptor the
      //     staleness comparator reads back (prompt version/hash + schema/parser
      //     version). Stamping it is what MAKES a freshly-ingested transcript
      //     "current" — isExtractionStale then finds NO mismatch (not stale).
      //   - `transcriptHash`: the transcript CONTENT hash (a reference, never the
      //     text) so a later content change is detected as stale-by-hash.
      const startedAt = new Date().toISOString()
      const currentProvenance = getCurrentExtractionProvenance()
      const transcriptHash = computeTranscriptHash(row.full_text ?? '')

      // The LLM extraction call stays OUTSIDE the transaction (Codex
      // adversarial review AR-1) — it can take seconds and must not hold a
      // DB transaction open.
      const extraction = await extractGraphFromTranscript(row.full_text, meta, llm)
      // F16/spec-002 (AR-1, layer 2 of 2) + F18 (spec-004, Step 6): FINAL
      // eligibility is decided with a FRESH point-read at persistence time,
      // inside the SAME transaction as the graph writes + ingested-marker
      // insert — the pre-filter Set above is only a run-start snapshot and
      // can go stale across this loop's awaits. isRecordingGraphIngestable is
      // a strict superset of the old value-only check: it ALSO closes the
      // purge/soft-delete-vs-ingest race (a hard-purged or soft-deleted
      // recording is ineligible for re-ingest at this instant). A rating (or
      // existence) written any time up to this instant — including while
      // THIS row's extraction call was in flight — is honored: an ineligible
      // recording is skipped WITHOUT writing the marker (a still-live
      // exclusion is then in the NEXT run's pre-filter snapshot, so the one
      // extraction this run paid for is the last), and a recording that
      // became eligible mid-run still ingests. Wrapping ingest+marker in one
      // transaction also makes them atomic: a mid-ingest failure rolls back
      // both.
      //
      // The marker is also RE-CHECKED inside the transaction: two ingest entry
      // points (debounced graph-sync + manual graph:ingestAll) can both pass
      // the pre-extraction check before either commits, and the loser would
      // re-upsert every edge (weight inflation). The transaction callback is
      // synchronous — no await can interleave — so the recheck+writes+marker
      // are race-free on the single better-sqlite3 connection. The marker
      // INSERT is deliberately NOT "OR IGNORE": after both rechecks a conflict
      // is impossible, and if one ever happens it must be loud.
      const ingestedNow = runInTransaction(() => {
        if (!isRecordingGraphIngestable(row.recording_id)) {
          console.log(
            `[KnowledgeGraph] Skipped non-ingestable recording ${row.recording_id} (transcript ${row.id})`
          )
          return false
        }

        // F18 (AR2-4): fresh in-txn marker re-check. The outer "already
        // ingested" pre-check above runs OUTSIDE this transaction, so two
        // overlapping ingest passes can both pass it before either commits.
        // This point-read — taken inside the SAME transaction as the write —
        // is what actually prevents a double-ingest / double weight-bump: the
        // second pass to reach this line sees the first pass's marker and
        // skips, rather than re-asserting every edge a second time.
        const claimed = queryOne<{ transcript_id: string }>(
          'SELECT transcript_id FROM graph_ingested_transcripts WHERE transcript_id = ?',
          [row.id]
        )
        if (claimed) return false // lost the race — a concurrent ingest committed first

        ingestExtraction(store, extraction, meta, {
          now: new Date().toISOString(),
          resolvePerson: makePersonResolver(row.meeting_id ?? undefined),
          recordingId: row.recording_id,
          transcriptId: row.id,
        })

        // Promote the SAME extraction's decisions/action_items into the
        // first-class relational tables the hidock-mcp server reads. Runs in
        // this transaction (atomic with the graph ingest + marker below), so a
        // rollback drops all three together and the marker guarantees one
        // promote per transcript. Fresh (non-migrated) recordings only ever get
        // their decisions/actions into those tables via this call.
        promoteExtractionToFirstClassTables(row.recording_id, extraction, {
          meetingDate: row.date_recorded ?? null,
          extractedFrom: `transcript:${row.id}`,
        })

        // Mark as ingested
        run(
          'INSERT INTO graph_ingested_transcripts (transcript_id, ingested_at) VALUES (?, ?)',
          [row.id, new Date().toISOString()]
        )

        // hidock-graph-extraction-hardening Task 8.7 (Req 5.4) — ATOMIC
        // CURRENT-MARKING. Record a CURRENT-provenance `ingestion_run` row in the
        // SAME transaction as the graph writes (ingestExtraction), the promotion
        // (promoteExtractionToFirstClassTables), and the marker INSERT above. All
        // FOUR now commit or roll back together: a throw in ANY of them (a graph
        // write, promotion, the marker INSERT, or this stamp) aborts the whole
        // `runInTransaction` and better-sqlite3 rolls back everything — leaving
        // NOTHING marked current (no marker, no provenance row, no graph/promotion
        // rows). The row is stamped `success` with the CURRENT descriptor captured
        // above, so isExtractionStale immediately reports the transcript as NOT
        // stale — the operational definition of "current" (marker + a
        // current-provenance run + graph + promotion all co-committed). This is
        // the FIRST live path to call recordIngestionRun outside the Task 8.3
        // migration; the failure path deliberately records NO row (the transcript
        // stays unmarked/retryable per tasks 4.5/5.3). Suppress the legacy-marker
        // migration for this call: the marker was just inserted above IN THIS
        // transaction, so an unsuppressed migration (re-triggered by
        // recordIngestionRun's getKnowledgeGraphStore()) would synthesize a
        // spurious `legacy` row for that marker alongside this real `success` row.
        _withLegacyMigrationSuppressed(() =>
          recordIngestionRun({
            transcriptId: row.id,
            recordingId: row.recording_id,
            transcriptHash,
            provider: providerConfig.provider,
            model: providerConfig.model,
            promptVersion: currentProvenance.promptVersion,
            promptHash: currentProvenance.promptHash,
            schemaVersion: currentProvenance.schemaVersion,
            parserVersion: currentProvenance.parserVersion,
            startedAt,
            completedAt: new Date().toISOString(),
            status: 'success',
            acceptedEntityCount: countAcceptedEntities(extraction),
            privacyFilteredCount: 0,
          })
        )
        return true
      })
      if (ingestedNow) {
        result.ingested++
        result.results.push({ transcriptId: row.id, status: 'success' })
      } else {
        // Lost the in-txn race or became ineligible at persistence time — a
        // benign no-op from this pass's point of view. (A fresh-read privacy
        // downgrade is already surfaced as `privacy_blocked` on the NEXT pass's
        // pre-filter; here we only know it didn't ingest.)
        result.skipped++
        result.results.push({ transcriptId: row.id, status: 'skipped' })
      }
    } catch (e: unknown) {
      // hidock-graph-extraction-hardening Task 5.1 — a PER-ATTEMPT eligibility
      // recheck aborted before a provider call: the recording became
      // ineligible (personal/deleted/purged/value-excluded) or its eligibility
      // LOOKUP failed (fail-closed) during processing. Like the typed
      // extraction failures below, this throw happens BEFORE the
      // `runInTransaction` write block, so nothing was persisted and no marker
      // was written — the transcript stays retryable. Report it as a privacy
      // skip distinct from a transport/fetch error (Req 3.2, 3.3), with NO
      // transcript contents. (Task 5.3 formalises the full report semantics and
      // the "no second provider call, nothing persisted" assertions; this seam
      // just aborts cleanly and classifies the outcome.) A `lookup_error`-kind
      // abort is a fail-closed operational failure — surfaced as a collected
      // `error` — while a `privacy_blocked`-kind abort is an expected skip.
      if (e instanceof PrivacyBlockedError) {
        if (e.status.kind === 'privacy_blocked') {
          result.skipped++
          result.results.push({ transcriptId: row.id, status: 'privacy_blocked' })
          console.log(
            `[KnowledgeGraph] Recording ${row.recording_id} became ineligible before a provider attempt (transcript ${row.id}, reason=${e.status.reason}); aborted, nothing persisted`
          )
        } else {
          result.errors.push({ transcriptId: row.id, error: e.status.error })
          result.results.push({
            transcriptId: row.id,
            status: 'error',
            errorSummary: summarizeBatchError(e.status.error),
          })
          console.error(
            `[KnowledgeGraph] Eligibility recheck lookup failed for recording ${row.recording_id} before a provider attempt (transcript ${row.id}): ${e.status.error}`
          )
        }
        continue
      }
      // hidock-graph-extraction-hardening Task 4.5 — no-marker / no-writes on a
      // typed extraction failure. `extractGraphFromTranscript` (line above) runs
      // and THROWS an `ExtractionError` / `SchemaError` BEFORE the
      // `runInTransaction` block that does the graph writes + first-class
      // promotion + marker INSERT. So a throw here guarantees: zero graph rows,
      // zero first-class rows, and NO `graph_ingested_transcripts` marker for
      // this transcript — it stays unmarked and is retried on the next pass.
      // (`SchemaError extends ExtractionError`, so this one guard covers both.)
      //
      // We collect the failure per-transcript keyed by the stable, non-sensitive
      // `err.category` discriminant (NOT the message, and NEVER transcript text /
      // prompt / raw model output), increment the distinct `extractionFailures`
      // counter, and CONTINUE the loop so the pass still processes every other
      // transcript. A successful EMPTY extraction never reaches this branch — it
      // marks ingested like any other success.
      if (e instanceof ExtractionError) {
        result.extractionFailures++
        result.errors.push({ transcriptId: row.id, error: e.name, errorCategory: e.category })
        // Task 4.7 — surface the typed failure with its stable status/category
        // and a redacted summary (the fixed error `name`, never model output).
        result.results.push({
          transcriptId: row.id,
          status: e.category,
          errorCategory: e.category,
          errorSummary: summarizeBatchError(e),
        })
        console.error(
          `[KnowledgeGraph] Extraction failed for transcript ${row.id} (recording ${row.recording_id}); left unmarked/retryable [category=${e.category}]`
        )
        continue
      }
      const msg = e instanceof Error ? e.message : String(e)
      result.errors.push({ transcriptId: row.id, error: msg })
      result.results.push({
        transcriptId: row.id,
        status: 'error',
        errorSummary: summarizeBatchError(e),
      })
      console.error(`[KnowledgeGraph] Failed to ingest transcript ${row.id}:`, e)
    }
  }

  // Bring any legacy name-keyed person nodes onto the contact-id identity.
  try {
    const rk = rekeyExistingPersonNodes()
    if (rk.rekeyed + rk.merged > 0) {
      console.log(`[KnowledgeGraph] Re-keyed ${rk.rekeyed} + merged ${rk.merged} person node(s) by contact id`)
    }
  } catch (e) {
    console.warn('[KnowledgeGraph] Person re-key pass failed (non-fatal):', e)
  }

  // F18 (spec-004, Step 6.3): hygiene sweep for graph_edge_sources rows
  // orphaned by a merge-collision repoint that had no keeper edge to
  // transfer onto (a self-loop collapse — see mutations.ts::mergeNodes).
  // Non-fatal; removeRecordingProvenance already tolerates orphaned rows via
  // its own JOIN, so a failure here never affects correctness.
  try {
    pruneOrphanEdgeSources(store)
  } catch (e) {
    console.warn('[KnowledgeGraph] Orphan edge-source prune failed (non-fatal):', e)
  }

  return result
}

// ---------------------------------------------------------------------------
// Ingestion from HiNotes connector artifacts
// ---------------------------------------------------------------------------

interface HiNotesArtifactRow {
  artifact_id: string
  capture_id: string
  content_hash: string
  extracted_text: string
  source_ref: string | null
  title: string
  captured_at: string
}

interface IngestedArtifactRow {
  artifact_id: string
  source_id: string
  meeting_id: string
  content_hash: string
}

/** Keep graph extraction bounded for very long meetings while retaining the
 * complete HiNotes summary plus enough transcript context to resolve speakers
 * and named entities. The full artifact remains available to Library/RAG. */
function graphTextFromHiNotes(markdown: string): string {
  const MAX_GRAPH_TEXT = 24_000
  const summary = markdown.match(/## Summary\s*\n([\s\S]*?)(?=\n## Transcript|$)/i)?.[1]?.trim() ?? ''
  if (summary) {
    const speakers = [...markdown.matchAll(/^\*\*([^*\n]{1,100})\*\*\s*$/gm)]
      .map((match) => match[1].trim())
      .filter((name, index, all) => !!name && all.indexOf(name) === index)
    const speakerLine = speakers.length > 0 ? `\n\nSpeakers mentioned: ${speakers.join(', ')}` : ''
    return `## Summary\n${summary}${speakerLine}`.slice(0, MAX_GRAPH_TEXT)
  }

  // Older/imported artifacts without the standard section still get a bounded
  // fallback rather than becoming permanently ungraphable.
  return markdown.slice(0, MAX_GRAPH_TEXT)
}

/** Fast, non-speculative baseline for a large historical backfill. Speaker
 * labels are explicit source data, so they are safe to graph without an LLM;
 * the meeting node itself is always created by ingestExtraction. */
function deterministicHiNotesExtraction(markdown: string): ExtractionResult {
  const speakers = [...markdown.matchAll(/^\*\*([^*\n]{1,100})\*\*\s*$/gm)]
    .map((match) => match[1].trim())
    .filter((name, index, all) => !!name && all.indexOf(name) === index)
  return {
    people: speakers.map((name) => ({ name, skills: [] })),
    topics: [],
    projects: [],
    decisions: [],
    action_items: [],
    risks: [],
    next_steps: [],
  }
}

function hiNotesArtifactRows(): HiNotesArtifactRow[] {
  return queryAll<HiNotesArtifactRow>(`
    SELECT
      a.id AS artifact_id,
      a.knowledge_capture_id AS capture_id,
      COALESCE(a.content_hash, '') AS content_hash,
      a.extracted_text,
      a.source_ref,
      k.title,
      k.captured_at
    FROM artifacts a
    JOIN knowledge_captures k ON k.id = a.knowledge_capture_id
    WHERE a.source_connector_id = 'hinotes'
      AND a.knowledge_capture_id IS NOT NULL
      AND a.extracted_text IS NOT NULL
      AND TRIM(a.extracted_text) <> ''
  `)
}

/**
 * Incrementally ingest HiNotes artifacts into Context Graph. Capture-backed
 * provenance is namespaced in graph_edge_sources and resolved through the same
 * fail-closed capture eligibility boundary used by Library and RAG.
 *
 * A changed artifact is extracted before any write, then its old provenance is
 * removed and the replacement extraction committed atomically with the marker.
 * Missing or newly-ineligible artifacts are retracted on the next pass.
 */
export async function ingestFromHiNotesArtifacts(): Promise<IngestResult> {
  const { getExtractionProviderConfig } = await import('./ai-provider-config')
  const providerConfig = getExtractionProviderConfig()

  const store = getKnowledgeGraphStore()
  const rows = hiNotesArtifactRows()
  // hidock-graph-extraction-hardening Task 2.4 — AUTHORITATIVE recording-level
  // gate for the capture-backed entry point. HiNotes material is keyed by
  // knowledge-capture id (not a recording id), so its authoritative fetch-time
  // gate is `filterEligibleCaptureIds` — the capture analogue of `isEligible`:
  // it inherits the source recording's personal/deleted/purged/value-excluded
  // exclusion (see recording-eligibility.ts) and is fail-closed. An ineligible
  // capture is filtered out BEFORE any provider call or promotion below, and a
  // capture that becomes ineligible mid-flight is re-checked inside the ingest
  // transaction. No extraction runs for an ineligible capture.
  const captureEligibility = filterEligibleCaptureIds(rows.map((row) => row.capture_id))
  if (captureEligibility.failClosed) {
    throw new Error('Could not verify HiNotes capture eligibility. Graph ingestion stopped safely.')
  }

  const eligibleRows = rows.filter((row) => captureEligibility.eligible.has(row.capture_id))
  const eligibleArtifactIds = new Set(eligibleRows.map((row) => row.artifact_id))
  const result: IngestResult = {
    ingested: 0,
    skipped: rows.length - eligibleRows.length,
    extractionFailures: 0,
    errors: [],
    results: [],
  }
  // Task 4.7 — the captures filtered out above were dropped by the fail-closed
  // capture-eligibility gate: surface each as a `privacy_blocked` batch entry
  // (keyed by artifact id, matching how the rest of this loop keys its
  // `transcriptId`). No transcript text is included.
  for (const row of rows) {
    if (!eligibleArtifactIds.has(row.artifact_id)) {
      result.results.push({ transcriptId: row.artifact_id, status: 'privacy_blocked' })
    }
  }

  // Retract graph facts whose artifact disappeared or whose capture is no
  // longer eligible. Each marker + provenance removal is one transaction.
  const tracked = queryAll<IngestedArtifactRow>('SELECT * FROM graph_ingested_artifacts')
  for (const marker of tracked) {
    if (eligibleArtifactIds.has(marker.artifact_id)) continue
    try {
      runInTransaction(() => {
        removeRecordingProvenance(store, marker.source_id, { meetingId: marker.meeting_id })
        run('DELETE FROM graph_ingested_artifacts WHERE artifact_id = ?', [marker.artifact_id])
      })
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      result.errors.push({ transcriptId: marker.artifact_id, error: msg })
      result.results.push({
        transcriptId: marker.artifact_id,
        status: 'error',
        errorSummary: summarizeBatchError(e),
      })
    }
  }

  const trackedHashes = new Map(tracked.map((marker) => [marker.artifact_id, marker.content_hash]))
  const pendingCount = eligibleRows.filter(
    (row) => trackedHashes.get(row.artifact_id) !== row.content_hash
  ).length
  // A large historical backlog gets the explicit speaker/meeting baseline in
  // one fast pass. Small ongoing batches can afford richer local/provider LLM
  // extraction. This is decided once per run so an interrupted backlog resumes
  // consistently instead of switching modes halfway through.
  const enrichWithLlm = !!providerConfig && pendingCount <= 25

  for (const row of eligibleRows) {
    const existing = queryOne<IngestedArtifactRow>(
      'SELECT * FROM graph_ingested_artifacts WHERE artifact_id = ?',
      [row.artifact_id]
    )
    if (existing?.content_hash === row.content_hash) {
      result.skipped++
      result.results.push({ transcriptId: row.artifact_id, status: 'skipped' })
      continue
    }

    const sourceId = captureGraphSourceId(row.capture_id)
    const meetingId = `hinotes:${row.source_ref || row.artifact_id}`
    const meta = { meetingId, title: row.title || undefined, date: row.captured_at || undefined }

    try {
      // hidock-graph-extraction-hardening Task 5.1 — per-row LlmExtractor that
      // threads the PER-ATTEMPT capture-eligibility recheck (the capture
      // analogue of `isEligible`) into every provider call. If this capture
      // becomes ineligible — deleted, its source recording turns
      // personal/deleted/purged/value-excluded, or a lookup fails closed —
      // during a transport backoff (or between the fetch-time gate and the
      // first attempt), the next `complete()` call is aborted and a typed
      // PrivacyBlockedError is thrown (Req 3.1, 3.4). The deterministic baseline
      // branch makes NO provider call, so it needs no recheck.
      const llm: LlmExtractor = (prompt: string) =>
        completeWithRetry(prompt, providerConfig!, 3, () => isCaptureEligibleStatus(row.capture_id))

      // hidock-graph-extraction-hardening Task 8.7 (Req 5.4) — capture the
      // CURRENT-generation provenance for this capture-backed current-marking,
      // mirroring the transcript path. Computed OUTSIDE the transaction. The
      // provenance row is keyed by the SAME identity graph provenance uses for a
      // capture: `recordingId` = the namespaced `capture:<id>` graph source id,
      // `transcriptId` = `artifact:<id>`. `transcriptHash` is the CONTENT hash of
      // the artifact's extracted text (a reference, never the text). NOTE the
      // deterministic-baseline branch stamps the same CURRENT prompt hash even
      // though it makes no provider call: the baseline is this build's
      // authoritative extraction for that path, so recording the current
      // generation keeps the marker + provenance co-persistence consistent.
      const startedAt = new Date().toISOString()
      const currentProvenance = getCurrentExtractionProvenance()
      const transcriptHash = computeTranscriptHash(row.extracted_text ?? '')

      // Provider work stays outside the transaction. Historical backfills use
      // the deterministic baseline; new/changed small batches get enrichment.
      const extraction = enrichWithLlm
        ? await extractGraphFromTranscript(graphTextFromHiNotes(row.extracted_text), meta, llm)
        : deterministicHiNotesExtraction(row.extracted_text)

      const ingestedNow = runInTransaction(() => {
        // Re-read both artifact identity/hash and capture eligibility after the
        // awaited extraction. A deletion, update, or value downgrade wins.
        const fresh = queryOne<HiNotesArtifactRow>(`
          SELECT a.id AS artifact_id, a.knowledge_capture_id AS capture_id,
                 COALESCE(a.content_hash, '') AS content_hash, a.extracted_text,
                 a.source_ref, k.title, k.captured_at
            FROM artifacts a
            JOIN knowledge_captures k ON k.id = a.knowledge_capture_id
           WHERE a.id = ? AND a.source_connector_id = 'hinotes'
        `, [row.artifact_id])
        const eligibility = filterEligibleCaptureIds([row.capture_id])
        if (
          !fresh ||
          fresh.capture_id !== row.capture_id ||
          fresh.content_hash !== row.content_hash ||
          eligibility.failClosed ||
          !eligibility.eligible.has(row.capture_id)
        ) return false

        const claimed = queryOne<IngestedArtifactRow>(
          'SELECT * FROM graph_ingested_artifacts WHERE artifact_id = ?',
          [row.artifact_id]
        )
        if (claimed?.content_hash === row.content_hash) return false
        if (claimed) {
          removeRecordingProvenance(store, claimed.source_id, { meetingId: claimed.meeting_id })
        }

        ingestExtraction(store, extraction, meta, {
          now: new Date().toISOString(),
          resolvePerson: makePersonResolver(),
          recordingId: sourceId,
          transcriptId: `artifact:${row.artifact_id}`,
        })
        run(
          `INSERT INTO graph_ingested_artifacts
             (artifact_id, source_id, meeting_id, content_hash, ingested_at)
           VALUES (?, ?, ?, ?, ?)
           ON CONFLICT(artifact_id) DO UPDATE SET
             source_id = excluded.source_id,
             meeting_id = excluded.meeting_id,
             content_hash = excluded.content_hash,
             ingested_at = excluded.ingested_at`,
          [row.artifact_id, sourceId, meetingId, row.content_hash, new Date().toISOString()]
        )

        // hidock-graph-extraction-hardening Task 8.7 (Req 5.4) — ATOMIC
        // CURRENT-MARKING for the capture-backed path. Record a CURRENT-provenance
        // `ingestion_run` row in the SAME transaction as the graph writes
        // (ingestExtraction), any prior-provenance removal, and the
        // `graph_ingested_artifacts` marker upsert above. All co-commit or roll
        // back together: a throw anywhere in this block aborts the whole
        // `runInTransaction` and nothing is marked current (no marker, no
        // provenance row, no graph rows). Stamped `success` with the CURRENT
        // descriptor so the capture's current-marking is defined by the same
        // atomic co-persistence as the transcript path. Suppress the legacy-marker
        // migration for the same reason as the transcript path (the graph markers
        // exist by now; an unsuppressed migration would synthesize spurious
        // `legacy` rows mid-transaction).
        _withLegacyMigrationSuppressed(() =>
          recordIngestionRun({
            transcriptId: `artifact:${row.artifact_id}`,
            recordingId: sourceId,
            transcriptHash,
            provider: providerConfig!.provider,
            model: providerConfig!.model,
            promptVersion: currentProvenance.promptVersion,
            promptHash: currentProvenance.promptHash,
            schemaVersion: currentProvenance.schemaVersion,
            parserVersion: currentProvenance.parserVersion,
            startedAt,
            completedAt: new Date().toISOString(),
            status: 'success',
            acceptedEntityCount: countAcceptedEntities(extraction),
            privacyFilteredCount: 0,
          })
        )
        return true
      })

      if (ingestedNow) {
        result.ingested++
        result.results.push({ transcriptId: row.artifact_id, status: 'success' })
      } else {
        result.skipped++
        result.results.push({ transcriptId: row.artifact_id, status: 'skipped' })
      }
    } catch (e) {
      // hidock-graph-extraction-hardening Task 5.1 — a PER-ATTEMPT capture
      // eligibility recheck aborted before a provider call (capture became
      // ineligible mid-flight, or its eligibility lookup failed closed). The
      // recheck runs inside the LLM extractor, BEFORE the `runInTransaction`
      // write block, so nothing was persisted and no marker was written — the
      // artifact stays retryable. Report a privacy skip distinct from a
      // transport/fetch error (Req 3.2, 3.3), with NO transcript contents.
      // (Task 5.3 formalises the full report semantics; this seam aborts
      // cleanly.) A `lookup_error`-kind abort is surfaced as a collected
      // `error`; a `privacy_blocked`-kind abort is an expected skip.
      if (e instanceof PrivacyBlockedError) {
        if (e.status.kind === 'privacy_blocked') {
          result.skipped++
          result.results.push({ transcriptId: row.artifact_id, status: 'privacy_blocked' })
          console.log(
            `[KnowledgeGraph] HiNotes capture ${row.capture_id} became ineligible before a provider attempt (artifact ${row.artifact_id}, reason=${e.status.reason}); aborted, nothing persisted`
          )
        } else {
          result.errors.push({ transcriptId: row.artifact_id, error: e.status.error })
          result.results.push({
            transcriptId: row.artifact_id,
            status: 'error',
            errorSummary: summarizeBatchError(e.status.error),
          })
          console.error(
            `[KnowledgeGraph] Capture eligibility recheck lookup failed for capture ${row.capture_id} before a provider attempt (artifact ${row.artifact_id}): ${e.status.error}`
          )
        }
        continue
      }
      // hidock-graph-extraction-hardening Task 4.5 — same no-marker / no-writes
      // guarantee for the capture-backed entry point. The (LLM) extraction runs
      // BEFORE the `runInTransaction` block that writes graph rows and the
      // `graph_ingested_artifacts` marker, so a thrown `ExtractionError` /
      // `SchemaError` leaves the artifact unmarked and retryable with nothing
      // persisted. Collected by non-sensitive `category` (never model output /
      // transcript text); counted in the distinct `extractionFailures` tally;
      // the pass continues for the remaining artifacts. (The deterministic
      // baseline branch never throws these — only the LLM enrichment path does.)
      if (e instanceof ExtractionError) {
        result.extractionFailures++
        result.errors.push({ transcriptId: row.artifact_id, error: e.name, errorCategory: e.category })
        result.results.push({
          transcriptId: row.artifact_id,
          status: e.category,
          errorCategory: e.category,
          errorSummary: summarizeBatchError(e),
        })
        console.error(
          `[KnowledgeGraph] Extraction failed for HiNotes artifact ${row.artifact_id} (capture ${row.capture_id}); left unmarked/retryable [category=${e.category}]`
        )
        continue
      }
      const msg = e instanceof Error ? e.message : String(e)
      result.errors.push({ transcriptId: row.artifact_id, error: msg })
      result.results.push({
        transcriptId: row.artifact_id,
        status: 'error',
        errorSummary: summarizeBatchError(e),
      })
      console.error(`[KnowledgeGraph] Failed to ingest HiNotes artifact ${row.artifact_id}:`, e)
    }
  }

  return result
}

/** Manual/automatic entry point used by Context Graph: all supported sources,
 * reported as one incremental result for the existing renderer contract. */
export async function ingestAllGraphSources(): Promise<IngestResult> {
  const transcripts = await ingestFromDbTranscripts()
  const artifacts = await ingestFromHiNotesArtifacts()
  return {
    ingested: transcripts.ingested + artifacts.ingested,
    skipped: transcripts.skipped + artifacts.skipped,
    extractionFailures: transcripts.extractionFailures + artifacts.extractionFailures,
    errors: [...transcripts.errors, ...artifacts.errors],
    results: [...transcripts.results, ...artifacts.results],
  }
}

// ---------------------------------------------------------------------------
// Ingestion from folder (text/markdown files)
// ---------------------------------------------------------------------------

export async function ingestFromFolder(folderPath: string): Promise<IngestResult> {
  // Security: validate path (no traversal)
  if (!folderPath || typeof folderPath !== 'string') {
    throw new Error('Invalid folder path')
  }

  const resolved = resolve(folderPath)

  // Reject paths that contain traversal segments
  if (folderPath.includes('..')) {
    throw new Error('Path traversal not allowed')
  }

  if (!existsSync(resolved)) {
    throw new Error(`Folder does not exist: ${resolved}`)
  }

  if (!statSync(resolved).isDirectory()) {
    throw new Error(`Path is not a directory: ${resolved}`)
  }

  // Lazy-load — see ingestFromDbTranscripts (ADV55-1): avoids an eager config.ts load.
  const { getExtractionProviderConfig } = await import('./ai-provider-config')
  const providerConfig = getExtractionProviderConfig()
  if (!providerConfig) {
    throw new Error('No AI provider configured. Please set a provider API key in Settings.')
  }

  const store = getKnowledgeGraphStore()
  // hidock-graph-extraction-hardening Task 5.1 — DELIBERATELY NO per-attempt
  // eligibility recheck here. `ingestFromFolder` ingests loose .txt/.md files
  // from a user-chosen directory; those files have NO recording- or
  // capture-backed identity (no `recording_id`, no `knowledge_capture_id`), so
  // per Req 3.4 this entry point does NOT process recording/capture-backed
  // material and there is no eligibility predicate to recheck. Passing no
  // `checkEligible` callback to `completeWithRetry` keeps its transport-retry
  // behaviour unchanged for this path. (The recheck seam applies ONLY to the
  // recording-backed `ingestFromDbTranscripts` and capture-backed
  // `ingestFromHiNotesArtifacts` entry points.)
  const llm: LlmExtractor = (prompt: string) => completeWithRetry(prompt, providerConfig)

  const files = readdirSync(resolved).filter((f) => {
    const ext = extname(f).toLowerCase()
    return ext === '.txt' || ext === '.md'
  })

  const result: IngestResult = { ingested: 0, skipped: 0, extractionFailures: 0, errors: [], results: [] }

  for (const file of files) {
    const filePath = resolve(resolved, file)
    const transcriptId = `folder:${resolved}:${file}`

    // Incremental check
    const already = queryOne<{ transcript_id: string }>(
      'SELECT transcript_id FROM graph_ingested_transcripts WHERE transcript_id = ?',
      [transcriptId]
    )
    if (already) {
      result.skipped++
      result.results.push({ transcriptId: file, status: 'skipped' })
      continue
    }

    try {
      const content = readFileSync(filePath, 'utf-8')
      const nameWithoutExt = basename(file, extname(file))
      const meta = {
        meetingId: transcriptId,
        title: nameWithoutExt,
        date: undefined,
      }

      const extraction = await extractGraphFromTranscript(content, meta, llm)
      // Atomic + race-checked for the same reasons as ingestFromDbTranscripts
      // above: a mid-ingest failure must not half-commit nodes/edges without
      // the marker, and a concurrent ingest that committed during the await
      // must be detected inside the synchronous transaction, or the loser
      // re-upserts every edge (weight inflation).
      const ingestedNow = runInTransaction(() => {
        const claimed = queryOne<{ transcript_id: string }>(
          'SELECT transcript_id FROM graph_ingested_transcripts WHERE transcript_id = ?',
          [transcriptId]
        )
        if (claimed) return false // lost the race — a concurrent ingest committed first

        ingestExtraction(store, extraction, meta, {
          now: new Date().toISOString(),
          resolvePerson: makePersonResolver(),
        })

        run(
          'INSERT INTO graph_ingested_transcripts (transcript_id, ingested_at) VALUES (?, ?)',
          [transcriptId, new Date().toISOString()]
        )
        // hidock-graph-extraction-hardening Task 8.7 (Req 5.4) — DELIBERATELY NO
        // `ingestion_run` provenance stamp here. Loose .txt/.md files from a
        // user-chosen folder have NO recording- or capture-backed identity (no
        // `recording_id`, no `knowledge_capture_id`) — the `ingestion_run`
        // provenance model (transcript_id + recording_id + content hash) exists to
        // track recording/transcript-backed current-marking, and the same Req
        // 3.4/5.4 judgment that excludes this path from per-attempt eligibility
        // rechecks excludes it from the recording-scoped provenance stamp. The
        // graph writes + marker still commit ATOMICALLY in this one transaction
        // (no partial/mixed state); this path simply does not participate in the
        // recording-provenance ingestion_run ledger. (The recording-backed
        // ingestFromDbTranscripts and capture-backed ingestFromHiNotesArtifacts
        // paths are the ones that stamp a current-provenance row.)
        return true
      })
      if (ingestedNow) {
        result.ingested++
        result.results.push({ transcriptId: file, status: 'success' })
      } else {
        result.skipped++
        result.results.push({ transcriptId: file, status: 'skipped' })
      }
    } catch (e: unknown) {
      // hidock-graph-extraction-hardening Task 4.5 — folder entry point gets the
      // same guarantee: extraction throws BEFORE the transaction that writes the
      // graph rows + `graph_ingested_transcripts` marker, so an `ExtractionError`
      // / `SchemaError` leaves the file's transcript unmarked and retryable with
      // nothing persisted. Collected by non-sensitive `category` (never file
      // contents), counted distinctly, loop continues.
      if (e instanceof ExtractionError) {
        result.extractionFailures++
        result.errors.push({ transcriptId: file, error: e.name, errorCategory: e.category })
        result.results.push({
          transcriptId: file,
          status: e.category,
          errorCategory: e.category,
          errorSummary: summarizeBatchError(e),
        })
        console.error(
          `[KnowledgeGraph] Extraction failed for file ${file}; left unmarked/retryable [category=${e.category}]`
        )
        continue
      }
      const msg = e instanceof Error ? e.message : String(e)
      result.errors.push({ transcriptId: file, error: msg })
      result.results.push({
        transcriptId: file,
        status: 'error',
        errorSummary: summarizeBatchError(e),
      })
      console.error(`[KnowledgeGraph] Failed to ingest file ${file}:`, e)
    }
  }

  return result
}

// ---------------------------------------------------------------------------
// F18 (spec-004): per-recording graph-provenance cleanup
//
// removeRecordingProvenanceCore is the TRANSACTION-NEUTRAL removal engine
// (AR2-2): plain sequential statements, NO runInTransaction of its own. Two
// callers:
//   (a) removeRecordingFromGraph — wraps the core in ITS OWN runInTransaction,
//       for the impact dialog's dry-run and any standalone graph-reset caller.
//   (b) F17/T6's hard-purge path (NOT implemented by T4) — calls the core
//       directly, INSIDE deleteRecordingCascade's own runInTransaction,
//       passing pre-captured meetingId/transcriptIds (captured BEFORE the
//       cascade deletes the recordings/transcripts rows). That makes the graph
//       cleanup commit atomically with the rest of the purge: one commit, no
//       crash window between the cascade and the graph cleanup, no
//       pending-cleanup journal. A thrown error there aborts the WHOLE purge
//       (honest all-or-nothing) — this core function does not catch.
// ---------------------------------------------------------------------------

export interface RemoveRecordingFromGraphOptions {
  /** Compute the plan without writing anything (F17's impact dialog). */
  dryRun?: boolean
  /**
   * Pre-captured meeting id. F17/T6 calls the core AFTER
   * deleteRecordingCascade has already deleted the `recordings` row, so
   * self-resolution is no longer possible there — it must pass this. Omit for
   * dry-run / standalone use (the recording still exists; self-resolved from
   * `recordings.meeting_id ?? recordingId`, matching ingest's own meta.meetingId).
   */
  meetingId?: string
  /**
   * Pre-captured transcript ids (same reason as meetingId). Omit for
   * dry-run / standalone use — self-resolved as the union of the live
   * `transcripts` table and `graph_edge_sources.transcript_id` for this
   * recording (self-heals a stale marker left by a re-transcribed-away
   * transcript, §3.7).
   */
  transcriptIds?: string[]
}

/**
 * Every count field below — `markersRemoved` through `unattributedResidueKept`
 * (incl. `orphanNodesByType`) — is computed from a single in-memory PLAN taken
 * BEFORE any write (both here and in the package's `removeRecordingProvenance`
 * that this spreads in). When `dryRun` is true, these numbers are therefore an
 * ESTIMATE (AR2-5): accurate only if the graph stays quiescent between the dry
 * run and a later real run. Anything else that writes to the graph in between
 * (another recording's ingest or cleanup) can change them — F17's impact
 * dialog must present them as approximate ("~N graph links"), never as an
 * exact pre-count of what the real purge will do. A non-dryRun result's counts
 * are the actual committed numbers.
 */
export interface RemoveRecordingFromGraphResult {
  ok: boolean
  recordingId: string
  dryRun: boolean
  /** graph_ingested_transcripts markers removed. */
  markersRemoved: number
  edgesRemoved: number
  edgeSourceRowsRemoved: number
  meetingNodesRemoved: number
  orphanNodesRemoved: number
  orphanNodesByType: Record<string, number>
  sharedEdgesKept: number
  /** Edges kept because part of their weight is an unattributed (legacy /
   *  folder-ingest) co-assertion this recording cannot account for (CX-T4-1). */
  unattributedResidueKept: number
  /** Populated on failure; the caller inspects this — never a silent catch (CX-T3-7). */
  error?: string
}

/** A project node is protected (never GC'd) when it is linked to a real
 *  `projects` DB row — matched by name, same as projectNameIndex() elsewhere
 *  in this file (project graph nodes are name-keyed, not id-keyed). */
function isProjectNodeProtected(node: { label: string }): boolean {
  const row = queryOne<{ id: string }>('SELECT id FROM projects WHERE LOWER(name) = ?', [
    (node.label || '').toLowerCase().trim(),
  ])
  return !!row
}

/**
 * Transaction-neutral removal core (AR2-2) — see the section banner above for
 * the full contract. Resolves meetingId/transcriptIds (preferring the
 * caller's pre-captured values), deletes `graph_ingested_transcripts` markers
 * FIRST (belt-and-suspenders; the real race fix is `isRecordingGraphIngestable`
 * at ingest time), then delegates the graph surgery itself to the package's
 * `removeRecordingProvenance`. Throws on failure — callers wrap in their own
 * transaction and/or catch.
 */
export function removeRecordingProvenanceCore(
  recordingId: string,
  opts: RemoveRecordingFromGraphOptions = {}
): RemoveRecordingFromGraphResult {
  const store = getKnowledgeGraphStore()
  const dryRun = !!opts.dryRun

  let meetingId = opts.meetingId
  if (meetingId === undefined) {
    const rec = queryOne<{ meeting_id: string | null }>('SELECT meeting_id FROM recordings WHERE id = ?', [
      recordingId,
    ])
    meetingId = rec?.meeting_id ?? recordingId
  }

  const liveTranscriptIds = queryAll<{ id: string }>('SELECT id FROM transcripts WHERE recording_id = ?', [
    recordingId,
  ]).map((r) => r.id)
  const sourcedTranscriptIds = store.db
    .queryAll<{ transcript_id: string }>(
      'SELECT DISTINCT transcript_id FROM graph_edge_sources WHERE recording_id = ?',
      [recordingId]
    )
    .map((r) => r.transcript_id)
  const transcriptIds = [...new Set([...(opts.transcriptIds ?? []), ...liveTranscriptIds, ...sourcedTranscriptIds])]

  // Markers FIRST (§3.3). Plan (which markers currently exist) then execute,
  // so dryRun and a subsequent real run report the same count (AR2-5: the
  // dryRun figure is an estimate for the impact dialog; the real run's is the
  // committed count).
  let markersRemoved = 0
  if (transcriptIds.length > 0) {
    const placeholders = transcriptIds.map(() => '?').join(',')
    const existingMarkers = queryAll<{ transcript_id: string }>(
      `SELECT transcript_id FROM graph_ingested_transcripts WHERE transcript_id IN (${placeholders})`,
      transcriptIds
    )
    markersRemoved = existingMarkers.length
    if (!dryRun) {
      for (const tid of transcriptIds) {
        run('DELETE FROM graph_ingested_transcripts WHERE transcript_id = ?', [tid])
      }
    }
  }

  const removal = removeRecordingProvenance(store, recordingId, {
    dryRun,
    meetingId,
    isProjectProtected: isProjectNodeProtected,
  })

  // ADV57-1 (round-59): the live-graph scrub above is not enough — a merge_journal
  // graph snapshot (round-58) still holds full-row copies of this recording's edges
  // + graph_edge_sources, which a later UNMERGE would re-insert, resurrecting traces
  // of a permanently-deleted recording. Strip this recording's contribution from
  // every OPEN journal snapshot in the SAME transaction as the live cleanup, using
  // the identical transcript-id set. Skipped on dryRun (F17's impact dialog writes
  // nothing). See scrubMergeJournalGraphSnapshots for the exact trimming contract.
  if (!dryRun) {
    scrubMergeJournalGraphSnapshots(recordingId, transcriptIds)
    // ADV58-1 (round-60): the graph scrub only trims manifest.graph. The RELATIONAL
    // scrub strips the purged recording from every open journal's loser_snapshot —
    // redacting PII (+ invalidating the undo) when the loser entity's identity
    // provenance IS this recording, and redacting R-sourced field values otherwise —
    // so a hard purge does not retain the entity's PII at rest or let a later unmerge
    // resurrect a permanently-deleted (or unprovenanced) entity. Same transaction.
    scrubMergeJournalRelationalSnapshots(recordingId)
  }

  return {
    ok: true,
    recordingId,
    dryRun,
    markersRemoved,
    ...removal,
  }
}

function emptyRemovalCounts(): Omit<
  RemoveRecordingFromGraphResult,
  'ok' | 'recordingId' | 'dryRun' | 'error'
> {
  return {
    markersRemoved: 0,
    edgesRemoved: 0,
    edgeSourceRowsRemoved: 0,
    meetingNodesRemoved: 0,
    orphanNodesRemoved: 0,
    orphanNodesByType: {},
    sharedEdgesKept: 0,
    unattributedResidueKept: 0,
  }
}

/**
 * Standalone/dry-run entry point: wraps `removeRecordingProvenanceCore` in its
 * own `runInTransaction` for atomicity, and never throws to the caller —
 * returns `{ ok: false, error }` on failure instead (CX-T3-7: no silent
 * catch). Used by F17's impact dialog (`dryRun: true`) and any standalone
 * graph-reset caller. The F17 hard-purge path does NOT call this function —
 * it calls `removeRecordingProvenanceCore` directly, inside
 * `deleteRecordingCascade`'s own transaction (AR2-2), so a graph failure
 * aborts the whole purge instead of leaving a partial, uncommitted cleanup.
 */
export function removeRecordingFromGraph(
  recordingId: string,
  opts: RemoveRecordingFromGraphOptions = {}
): RemoveRecordingFromGraphResult {
  const dryRun = !!opts.dryRun
  try {
    return runInTransaction(() => removeRecordingProvenanceCore(recordingId, opts))
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e)
    console.error(`[KnowledgeGraph] removeRecordingFromGraph(${recordingId}) failed:`, e)
    return {
      ok: false,
      recordingId,
      dryRun,
      ...emptyRemovalCounts(),
      error,
    }
  }
}

// ---------------------------------------------------------------------------
// Query wrappers
// ---------------------------------------------------------------------------

// RE4-3 (round-4) — the whole family of raw graph reads exposed via graph:* IPC.
// Each applies fail-closed getGroundingExclusionSet + node-visibility suppression
// so an excluded-only person/meeting/skill/label is never retrievable. See the
// {endpoint → filtered?} audit table in .claude/changes/ARF-HIGHS-CHANGES.md.

// INC1/INC2 (round-5) — eligibility for a ranking/relationship must be decided
// at the EDGE that actually carries it, evaluated fail-closed, NOT inferred from
// the resulting node's GLOBAL visibility: a person/meeting/skill whose
// contributing path is entirely excluded must not appear (even if the node has
// an eligible edge elsewhere), and counts/weights must sum over surviving edges.

export function queryTopAttendees(name: string): AttendeeResult[] {
  const store = getKnowledgeGraphStore()
  const exclusion = getGroundingExclusionSet(true) // ADV23-2: non-owner surface — suppress legacy zero-provenance edges
  if (exclusionIsNoop(exclusion)) return topAttendeesForProjectOrTopic(store, name)
  const normName = name.toLowerCase().trim()
  // Raw (person, meeting) attendance rows WITH the two connecting edge ids so
  // each contributing path can be provenance-filtered before aggregation.
  const rows = store.db.queryAll<{
    person_id: string
    person_label: string
    meeting_id: string
    ea_id: string
    ab_id: string
  }>(
    `SELECT p.id AS person_id, p.label AS person_label, m.id AS meeting_id,
            ea.id AS ea_id, ab.id AS ab_id
       FROM graph_nodes p
       JOIN graph_edges ea ON ea.source_id = p.id AND ea.type = 'ATTENDED'
       JOIN graph_nodes m  ON m.id = ea.target_id AND m.type = 'meeting'
       JOIN graph_edges ab ON ab.source_id = m.id AND ab.type = 'ABOUT'
       JOIN graph_nodes t  ON t.id = ab.target_id AND (t.type = 'topic' OR t.type = 'project')
      WHERE p.type = 'person' AND LOWER(t.norm_key) LIKE ?`,
    [`%${normName}%`]
  )
  const edgeIds = [...new Set(rows.flatMap((r) => [r.ea_id, r.ab_id]))]
  const suppressed = provenanceSuppressedEdgeIds(store, edgeIds, exclusion)
  const byPerson = new Map<string, { label: string; meetings: Set<string> }>()
  for (const r of rows) {
    // BOTH the ATTENDED and the ABOUT edge must survive for this path to count.
    if (suppressed.has(r.ea_id) || suppressed.has(r.ab_id)) continue
    let e = byPerson.get(r.person_id)
    if (!e) { e = { label: r.person_label, meetings: new Set() }; byPerson.set(r.person_id, e) }
    e.meetings.add(r.meeting_id)
  }
  return [...byPerson.entries()]
    .map(([personId, e]) => ({ person: e.label, personId, meetings: e.meetings.size }))
    .sort((a, b) => b.meetings - a.meetings)
}

export function queryTopSkill(skill: string): SkillDemonstratorResult[] {
  const store = getKnowledgeGraphStore()
  const exclusion = getGroundingExclusionSet(true) // ADV23-2: non-owner surface — suppress legacy zero-provenance edges
  if (exclusionIsNoop(exclusion)) return topSkillDemonstrators(store, skill)
  const normSkill = skill.toLowerCase().trim()
  const rows = store.db.queryAll<{ person_id: string; person_label: string; edge_id: string; weight: number }>(
    `SELECT p.id AS person_id, p.label AS person_label, e.id AS edge_id, e.weight AS weight
       FROM graph_nodes p
       JOIN graph_edges e ON e.source_id = p.id AND e.type = 'DEMONSTRATED'
       JOIN graph_nodes s ON s.id = e.target_id AND s.type = 'skill'
      WHERE p.type = 'person' AND LOWER(s.norm_key) LIKE ?`,
    [`%${normSkill}%`]
  )
  const suppressed = provenanceSuppressedEdgeIds(store, rows.map((r) => r.edge_id), exclusion)
  const byPerson = new Map<string, { label: string; weight: number }>()
  for (const r of rows) {
    if (suppressed.has(r.edge_id)) continue // demonstration edge excluded
    let e = byPerson.get(r.person_id)
    if (!e) { e = { label: r.person_label, weight: 0 }; byPerson.set(r.person_id, e) }
    e.weight += r.weight
  }
  return [...byPerson.entries()]
    .map(([personId, e]) => ({ person: e.label, personId, weight: e.weight }))
    .sort((a, b) => b.weight - a.weight)
}

/**
 * ADV34-3 sweep (round-36) — the profile's related entities are returned as
 * SANITIZED ContextGraphNode DTOs (via the shared {@link nodeToDTO}), NOT raw
 * GraphNode objects: personProfile previously leaked raw norm_key + props + row
 * timestamps on the graph:personProfile IPC surface. (The related nodes are
 * meetings/skills/actions — never person — so they carry no contactId; the DTO
 * strips norm_key/props regardless.)
 */
export interface PersonProfileDTO {
  personId: string
  personLabel: string
  meetings: ContextGraphNode[]
  skills: ContextGraphNode[]
  actionItems: ContextGraphNode[]
}

export function queryPersonProfile(name: string): PersonProfileDTO | undefined {
  const store = getKnowledgeGraphStore()
  const profile = personProfile(store, name)
  if (!profile) return undefined
  const projects = projectNameIndex()
  const sanitize = (nodes: GraphNode[]): ContextGraphNode[] => {
    const vis = visibleContactIdSet(nodes)
    return nodes.map((n) => nodeToDTO({ ...n, degree: 0 }, projects, vis))
  }
  const exclusion = getGroundingExclusionSet(true) // ADV23-2: non-owner surface — suppress legacy zero-provenance edges
  if (exclusionIsNoop(exclusion)) {
    return {
      personId: profile.personId,
      personLabel: profile.personLabel,
      meetings: sanitize(profile.meetings),
      skills: sanitize(profile.skills),
      actionItems: sanitize(profile.actionItems),
    }
  }
  // An excluded-only person is not retrievable at all.
  if (!isNodeVisibleUnderExclusion(store, profile.personId, exclusion)) return undefined
  // INC2 — each relationship is filtered by ITS CONNECTING edge's provenance,
  // not the related node's global visibility (a meeting reachable via an
  // excluded ATTENDED edge is dropped even if the meeting is globally visible).
  const related = (edgeType: string): GraphNode[] => {
    const rows = store.db.queryAll<GraphNode & { __edge_id: string }>(
      `SELECT n.id, n.type, n.label, n.norm_key, n.props, n.created_at, n.updated_at, e.id AS __edge_id
         FROM graph_nodes n
         JOIN graph_edges e ON e.target_id = n.id AND e.type = ?
        WHERE e.source_id = ?`,
      [edgeType, profile.personId]
    )
    const suppressed = provenanceSuppressedEdgeIds(store, rows.map((r) => r.__edge_id), exclusion)
    return rows
      .filter((r) => !suppressed.has(r.__edge_id))
      .map(({ __edge_id, ...node }) => node as GraphNode)
  }
  return {
    personId: profile.personId,
    personLabel: profile.personLabel,
    meetings: sanitize(related('ATTENDED')),
    skills: sanitize(related('DEMONSTRATED')),
    actionItems: sanitize(related('OWNS')),
  }
}

/**
 * Sanitized meeting-graph DTO returned on the graph:meetingGraph IPC surface.
 * ADV34-1 (round-36) — nodes (and the meeting node) are ContextGraphNode DTOs
 * mapped through the shared contact-visibility-aware {@link nodeToDTO}, NOT raw
 * GraphNode objects: a node visible via an eligible meeting edge but keyed to a
 * SUPPRESSED contact must never leak its `norm_key` (`contact:<id>`) or
 * `props.contactId` on this non-owner surface. Edges keep the package's
 * source_id/target_id shape (they carry no contact-identity leak).
 */
export interface MeetingGraphDTO {
  meeting: ContextGraphNode | null
  nodes: ContextGraphNode[]
  edges: Array<{ id: string; source_id: string; target_id: string; type: string; weight: number }>
}

export function queryMeetingGraph(meetingId: string): MeetingGraphDTO {
  const store = getKnowledgeGraphStore()
  const graph = meetingSummaryGraph(store, meetingId)
  const empty: MeetingGraphDTO = { meeting: null, nodes: [], edges: [] }
  if (!graph.meeting) return empty
  const exclusion = getGroundingExclusionSet(true) // ADV23-2: non-owner surface — suppress legacy zero-provenance edges

  let keptNodes = graph.nodes
  let keptEdges = graph.edges
  if (!exclusionIsNoop(exclusion)) {
    // Centered on a meeting: fail closed + never expose an excluded-only meeting.
    if (exclusion.failClosed || !isNodeVisibleUnderExclusion(store, graph.meeting.id, exclusion)) {
      return empty
    }
    const suppressed = provenanceSuppressedEdgeIds(store, graph.edges.map((e) => e.id), exclusion)
    keptEdges = graph.edges.filter((e) => !suppressed.has(e.id))
    const incident = new Set<string>([graph.meeting.id])
    for (const e of keptEdges) {
      incident.add(e.source_id)
      incident.add(e.target_id)
    }
    keptNodes = graph.nodes.filter((n) => incident.has(n.id))
  }

  // ADV34-1 (round-36) — route the meeting node AND every surviving node through
  // the shared nodeToDTO (with a batched fail-closed visibleContactIdSet), so a
  // person node keyed to a suppressed contact never returns its contactId, and no
  // raw norm_key/props leaves this surface — on the healthy path too (raw nodes
  // were previously returned wholesale).
  const projects = projectNameIndex()
  const visibleContacts = visibleContactIdSet([graph.meeting, ...keptNodes])
  return {
    meeting: nodeToDTO({ ...graph.meeting, degree: 0 }, projects, visibleContacts),
    nodes: keptNodes.map((n) => nodeToDTO({ ...n, degree: 0 }, projects, visibleContacts)),
    edges: keptEdges.map((e) => ({
      id: e.id,
      source_id: e.source_id,
      target_id: e.target_id,
      type: e.type,
      weight: e.weight,
    })),
  }
}

export function queryStats(): { nodes: number; edges: number; nodesByType: Record<string, number> } {
  const store = getKnowledgeGraphStore()
  const exclusion = getGroundingExclusionSet(true) // ADV23-2: non-owner surface — suppress legacy zero-provenance edges
  if (!exclusionIsNoop(exclusion)) {
    // RE4-3 — counts must reflect only VISIBLE (eligible) content, so an
    // excluded recording's attributed nodes/edges aren't counted. Build the
    // suppressed full graph and count survivors.
    const full = suppressExcludedFromView(toDTO(fullGraph(store)), exclusion)
    const nodesByType: Record<string, number> = {}
    for (const n of full.nodes) nodesByType[n.type] = (nodesByType[n.type] ?? 0) + 1
    return { nodes: full.nodes.length, edges: full.edges.length, nodesByType }
  }
  const nodes = store.db.queryAll<{ count: number }>('SELECT COUNT(*) AS count FROM graph_nodes')
  const edges = store.db.queryAll<{ count: number }>('SELECT COUNT(*) AS count FROM graph_edges')
  const byType = store.db.queryAll<{ type: string; count: number }>(
    'SELECT type, COUNT(*) AS count FROM graph_nodes GROUP BY type'
  )
  const nodesByType: Record<string, number> = {}
  for (const row of byType) {
    nodesByType[row.type] = row.count
  }
  return {
    nodes: nodes[0]?.count ?? 0,
    edges: edges[0]?.count ?? 0,
    nodesByType,
  }
}

export function queryListNodes(type?: string): GraphNode[] {
  const store = getKnowledgeGraphStore()
  const nodes = store.findNodes(type ? { type: type as any } : {})
  const exclusion = getGroundingExclusionSet(true) // ADV23-2: non-owner surface — suppress legacy zero-provenance edges
  if (exclusionIsNoop(exclusion)) return nodes
  return nodes.filter((n) => isNodeVisibleUnderExclusion(store, n.id, exclusion))
}

// ---------------------------------------------------------------------------
// R4c migration — re-key existing name-keyed person nodes by contact id
// ---------------------------------------------------------------------------

interface PersonNodeRow {
  id: string
  label: string
  norm_key: string
  props: string | null
}

/**
 * LLM-free surgery that brings already-ingested (name-keyed) person nodes onto
 * the contact-id identity. For each person node not yet keyed by `contact:*`,
 * resolve its label to a contact; if confident, either fold it into the
 * existing contact-keyed node (repointing edges) or relabel it in place.
 *
 * Idempotent: contact-keyed nodes are skipped, so re-running is a no-op.
 */
export function rekeyExistingPersonNodes(): { rekeyed: number; merged: number; skipped: number } {
  const store = getKnowledgeGraphStore()
  const db = store.db
  const result = { rekeyed: 0, merged: 0, skipped: 0 }

  const nameKeyed = db.queryAll<PersonNodeRow>(
    "SELECT id, label, norm_key, props FROM graph_nodes WHERE type = 'person' AND norm_key NOT LIKE 'contact:%'"
  )

  // ADV47-1 (round-49): this AUTOMATIC maintenance rekey/merge (runs after every
  // transcript ingestion) is a MUTATION — it repoints edges / deletes / rewrites
  // node identity — so it must pass the SAME execution-time node-visibility /
  // mutability boundary the interactive mutations (bindNodeToContact,
  // mergeGraphNodes) use. Round-35 mis-classified it owner-cleanup-safe; "owner
  // cleanup" only exempts pure REMOVAL, never a rewrite/merge that changes
  // identity or topology. Compute the fail-closed exclusion snapshot ONCE for the
  // whole scan (same source the read/mutation guards use).
  const exclusion = getGroundingExclusionSet(true)

  for (const node of nameKeyed) {
    // BEFORE resolving/merging/rewriting: a name-keyed node whose only provenance
    // is now personal / deleted / value-excluded / hard-purged (or a legacy
    // zero-provenance node on this non-owner boundary) is NOT visible. Merging it
    // into a contact-keyed node or rewriting its identity would repoint its HIDDEN
    // edges or delete the hidden node, so restoring the recording later would
    // resurface its facts under a CHANGED / accent-mismatched identity. Fail
    // closed: an excluded-only source OR a visibility-lookup failure ⇒ SKIP the
    // node entirely (no resolve, no merge, no rewrite).
    const sourceNode = store.getNode(node.id)
    if (!isNodeMutable(store, node.id, sourceNode, exclusion)) {
      result.skipped++
      continue
    }

    let contactId: string | null = null
    try {
      const r = resolveContact(node.label, { forKeying: true })
      if (r.id && r.confidence >= REKEY_CONFIDENCE) contactId = r.id
    } catch {
      contactId = null
    }
    if (!contactId) {
      result.skipped++
      continue
    }

    const contactKey = `contact:${contactId}`
    const canonicalLabel = getContactById(contactId)?.name ?? node.label
    const keeper = db.queryOne<{ id: string }>(
      "SELECT id FROM graph_nodes WHERE type = 'person' AND norm_key = ?",
      [contactKey]
    )

    if (keeper && keeper.id !== node.id) {
      // ADV47-1: don't fold a node into a keeper that is itself suppressed — the
      // merge TARGET must be visible/eligible under the same snapshot (mirrors the
      // round-33/34 merge guards + bindNodeToContact's implicit-keeper check).
      // Fail closed: a hidden / excluded-only / lookup-failing keeper ⇒ SKIP.
      if (!isNodeMergeEligible(store, keeper.id, store.getNode(keeper.id), exclusion)) {
        result.skipped++
        continue
      }
      // Fold this node into the existing contact-keyed node via the package's
      // mergeNodes (repoints edges, drops a colliding one after transferring
      // its graph_edge_sources rows + weight onto the survivor — AR2-1 — and
      // cleans up any resulting self-loop), then delete the loser.
      mergeNodes(store, keeper.id, node.id)
      result.merged++
    } else if (!keeper) {
      // No contact-keyed node yet — relabel this one in place. Edges reference
      // the node id (unchanged), so nothing else needs repointing.
      let props: Record<string, unknown> = {}
      if (node.props) {
        try {
          props = JSON.parse(node.props) as Record<string, unknown>
        } catch {
          props = {}
        }
      }
      props.contactId = contactId
      db.run('UPDATE graph_nodes SET norm_key = ?, label = ?, props = ?, updated_at = ? WHERE id = ?', [
        contactKey,
        canonicalLabel,
        JSON.stringify(props),
        new Date().toISOString(),
        node.id,
      ])
      result.rekeyed++
    } else {
      result.skipped++
    }
  }

  return result
}

// ---------------------------------------------------------------------------
// Context Graph — visualization + neighborhood retrieval
// ---------------------------------------------------------------------------

export interface ContextGraphNode {
  id: string
  type: string
  label: string
  degree: number
  /** Click-through target ids, present per node type. */
  contactId?: string
  meetingId?: string
  projectId?: string
}

export interface ContextGraphData {
  center: string | null
  nodes: ContextGraphNode[]
  edges: Array<{ id: string; source: string; target: string; type: string; weight: number }>
}

function parseProps(props: string | null | undefined): Record<string, unknown> {
  if (!props) return {}
  try {
    return JSON.parse(props) as Record<string, unknown>
  } catch {
    return {}
  }
}

/** Cache of lowercased project name → id, rebuilt per graph assembly (cheap). */
function projectNameIndex(): Map<string, string> {
  const rows = queryAll<{ id: string; name: string }>('SELECT id, name FROM projects')
  const m = new Map<string, string>()
  for (const r of rows) m.set((r.name || '').toLowerCase().trim(), r.id)
  return m
}

/**
 * ADV32-1 (round-34) — batch-resolve which person-node backing contactIds are
 * VISIBLE on non-owner surfaces, so the SHARED {@link nodeToDTO} mapper can
 * sanitize contactId for EVERY DTO reader (overview / neighborhood / lens /
 * provenance / default-center / search / list) at a single choke-point, WITHOUT a
 * per-node DB round-trip. A node can be graph-visible via an ELIGIBLE recording's
 * edge while its BACKING contact is SUPPRESSED (its own source recording excluded /
 * hard-purged, or a keying collision to an older suppressed same-name row) — edge
 * suppression only proves the node has surviving EVIDENCE, not that its contact
 * IDENTITY may be exposed. Routed through the shared FAIL-CLOSED entity-visibility
 * boundary; a lookup failure ⇒ empty set ⇒ every contactId omitted.
 */
function visibleContactIdSet(nodes: Array<Pick<GraphNode, 'type' | 'props'>>): Set<string> {
  const ids: string[] = []
  for (const n of nodes) {
    if (n.type !== 'person') continue
    const props = parseProps(n.props)
    if (typeof props.contactId === 'string' && props.contactId) ids.push(props.contactId)
  }
  if (ids.length === 0) return new Set<string>()
  const { visible, failClosed } = filterVisibleEntityIds('contact', ids)
  return failClosed ? new Set<string>() : visible
}

/**
 * Enrich a raw graph node into a context DTO node with click-through ids.
 * `visibleContactIds` is the batch-resolved allowlist of backing contactIds that
 * may be exposed on this non-owner surface (see {@link visibleContactIdSet}): a
 * person node whose contactId is NOT in the set has its contactId OMITTED
 * (ADV32-1, fail-closed) so a suppressed legacy contact never leaks through ANY of
 * the DTO readers that funnel through this shared mapper.
 */
function nodeToDTO(
  n: GraphNode & { degree?: number },
  projects: Map<string, string>,
  visibleContactIds: Set<string>
): ContextGraphNode {
  const props = parseProps(n.props)
  const dto: ContextGraphNode = {
    id: n.id,
    type: n.type,
    label: n.label,
    degree: n.degree ?? 0,
  }
  if (n.type === 'person' && typeof props.contactId === 'string' && visibleContactIds.has(props.contactId)) {
    dto.contactId = props.contactId
  }
  if (n.type === 'meeting' && typeof props.meetingId === 'string') dto.meetingId = props.meetingId
  if (n.type === 'project') {
    const pid = projects.get((n.label || '').toLowerCase().trim())
    if (pid) dto.projectId = pid
  }
  return dto
}

function toDTO(sub: SubGraph): ContextGraphData {
  const projects = projectNameIndex()
  const visibleContactIds = visibleContactIdSet(sub.nodes)
  const nodes: ContextGraphNode[] = sub.nodes.map((n) => nodeToDTO(n, projects, visibleContactIds))
  const edges = sub.edges.map((e) => ({
    id: e.id,
    source: e.source_id,
    target: e.target_id,
    type: e.type,
    weight: e.weight,
  }))
  return { center: sub.center?.id ?? null, nodes, edges }
}

/**
 * The overview graph — capped to the highest-degree `limit` nodes so the initial
 * render is a digestible set of hubs, not an unreadable whole-graph hairball.
 * Defaults to {@link DEFAULT_OVERVIEW_NODE_LIMIT}; callers pass a larger cap only
 * for an explicit "show more" expansion.
 */
export function queryContextGraph(limit: number = DEFAULT_OVERVIEW_NODE_LIMIT): ContextGraphData {
  const store = getKnowledgeGraphStore()
  const exclusion = getGroundingExclusionSet(true) // ADV23-2: non-owner surface — suppress legacy zero-provenance edges
  // Fast path: nothing to suppress (healthy + empty) → original behaviour.
  if (exclusionIsNoop(exclusion)) return toDTO(fullGraph(store, limit))

  // INC-4 (round-3) — fullGraph picks the highest-degree nodes BEFORE
  // suppression, so excluded hubs would eat the slice and leave a sparse/empty
  // overview. Instead suppress on the FULL graph, then pick the top-`limit`
  // nodes by their POST-suppression (eligible) degree so the cap fills with
  // visible content.
  const full = suppressExcludedFromView(toDTO(fullGraph(store)), exclusion)
  if (full.nodes.length <= limit) return full
  const eligibleDegree = new Map<string, number>()
  for (const e of full.edges) {
    eligibleDegree.set(e.source, (eligibleDegree.get(e.source) ?? 0) + 1)
    eligibleDegree.set(e.target, (eligibleDegree.get(e.target) ?? 0) + 1)
  }
  const topNodes = [...full.nodes]
    .sort((a, b) => (eligibleDegree.get(b.id) ?? 0) - (eligibleDegree.get(a.id) ?? 0))
    .slice(0, limit)
  const keptIds = new Set(topNodes.map((n) => n.id))
  const keptEdges = full.edges.filter((e) => keptIds.has(e.source) && keptIds.has(e.target))
  return { ...full, nodes: topNodes, edges: keptEdges }
}

/**
 * One-time maintenance: prune generic "garbage" person nodes (collective/role
 * words) and their edges from the live graph. Idempotent.
 */
export function pruneGenericGraphNodes(): { removedNodes: number; removedEdges: number } {
  const store = getKnowledgeGraphStore()
  return pruneGenericNodes(store)
}

/**
 * Resolve an arbitrary entity id (graph node id, contact id, meeting id, project
 * id, or a bare name) to a graph node id, so callers can pass a domain id.
 */
export function resolveEntityToNodeId(entityId: string): string | null {
  const store = getKnowledgeGraphStore()
  const db = store.db

  // 1. Direct graph node id.
  const direct = db.queryOne<{ id: string }>('SELECT id FROM graph_nodes WHERE id = ?', [entityId])
  if (direct) return direct.id

  // 2. Person node carrying this contact id.
  const person = db.queryOne<{ id: string }>(
    "SELECT id FROM graph_nodes WHERE type = 'person' AND JSON_EXTRACT(props, '$.contactId') = ?",
    [entityId]
  )
  if (person) return person.id

  // 3. Meeting node carrying this meeting id.
  const meeting = db.queryOne<{ id: string }>(
    "SELECT id FROM graph_nodes WHERE type = 'meeting' AND JSON_EXTRACT(props, '$.meetingId') = ?",
    [entityId]
  )
  if (meeting) return meeting.id

  // 4. Project id → project name → project node (name-keyed).
  const project = queryOne<{ name: string }>('SELECT name FROM projects WHERE id = ?', [entityId])
  if (project) {
    const norm = project.name.toLowerCase().trim().replace(/\s+/g, ' ')
    const pnode = db.queryOne<{ id: string }>(
      "SELECT id FROM graph_nodes WHERE type = 'project' AND norm_key = ?",
      [norm]
    )
    if (pnode) return pnode.id
  }

  // 5. Bare name → any node whose label matches.
  const byLabel = db.queryOne<{ id: string }>('SELECT id FROM graph_nodes WHERE LOWER(label) = ?', [
    entityId.toLowerCase().trim(),
  ])
  return byLabel?.id ?? null
}

/** Neighborhood (1–3 hops) around an entity, resolved from any id form. */
export function queryNeighborhood(entityId: string, hops = 1): ContextGraphData {
  const store = getKnowledgeGraphStore()
  const nodeId = resolveEntityToNodeId(entityId)
  if (!nodeId) return { center: null, nodes: [], edges: [] }
  const exclusion = getGroundingExclusionSet(true) // ADV23-2: non-owner surface — suppress legacy zero-provenance edges
  // RE4-2 (round-4) — a centered view fails closed and never exposes an
  // excluded-only center: check center visibility BEFORE building.
  if (exclusion.failClosed || !isNodeVisibleUnderExclusion(store, nodeId, exclusion)) {
    return { center: null, nodes: [], edges: [] }
  }
  return suppressExcludedFromView(toDTO(neighborhood(store, nodeId, hops)), exclusion)
}

/** Find graph nodes whose label matches a query — powers search-to-focus. */
export function searchGraphNodes(query: string, limit = 12): ContextGraphNode[] {
  const store = getKnowledgeGraphStore()
  const q = query.trim().toLowerCase()
  if (!q) return []
  if (limit <= 0) return []
  const exclusion = getGroundingExclusionSet(true) // ADV23-2: non-owner surface — suppress legacy zero-provenance edges
  // Stable ordering across pages: LENGTH(label) then id, so OFFSET pagination
  // never revisits or skips a row (LENGTH alone is not a total order).
  const orderedQuery =
    'SELECT * FROM graph_nodes WHERE LOWER(label) LIKE ? ORDER BY LENGTH(label) ASC, id ASC LIMIT ? OFFSET ?'

  // Fast path — no exclusions active: a single ordered page of `limit` rows.
  if (exclusionIsNoop(exclusion)) {
    const rows = store.db.queryAll<GraphNode>(orderedQuery, [`%${q}%`, limit, 0])
    return toDTO({ center: undefined, nodes: rows.map((n) => ({ ...n, degree: 0 })), edges: [] }).nodes
  }

  // ADV11-MED (round-12) — express exclusion in SQL so the DB's LIMIT applies to
  // VISIBLE rows directly. Round-11 paged the ordered matches and called
  // isNodeVisibleUnderExclusion PER NODE (each firing its own incident-edge +
  // provenance queries) until `limit` visible were found — an unbounded N+1
  // synchronous main-thread scan that, under heavy/cleanup-stale exclusions,
  // could examine the whole table and freeze IPC/UI. Instead we materialize the
  // set of excluded-only node ids ONCE (a fixed, bounded number of queries — two
  // full scans, NOT one-per-node), then let SQLite skip them so a single ordered
  // page of `limit` rows is already the visible answer. No false-negative
  // truncation: a genuinely eligible node beyond the first page is still returned
  // because the DB filters before applying LIMIT.
  const hidden = computeExcludedOnlyNodeIds(store, exclusion)
  if (hidden.size === 0) {
    // Exclusions active but they suppress no NODE (e.g. only shared-source edges) —
    // the plain ordered page is already all-visible.
    const rows = store.db.queryAll<GraphNode>(orderedQuery, [`%${q}%`, limit, 0])
    return toDTO({ center: undefined, nodes: rows.map((n) => ({ ...n, degree: 0 })), edges: [] }).nodes
  }
  // ADV12-MED (round-13) — materialize the excluded-only ids in a TEMP TABLE and
  // ANTI-JOIN, instead of an `id NOT IN (?, ?, …)` list. The old build pushed
  // EVERY hidden id into one param array, so the statement's bound-variable count
  // grew with the exclusion size; better-sqlite3's MAX_VARIABLE_NUMBER is 32766,
  // so ~32.7k excluded-only nodes made the statement exceed the ceiling and graph
  // search THREW (realistic under a large excluded graph, or fail-closed
  // suppressing nearly all attributed nodes). The temp-table anti-join keeps the
  // SELECT's bound-variable count O(1) (just the LIKE pattern + LIMIT) regardless
  // of exclusion size; the inserts are batched well under the parameter ceiling.
  // LIMIT still applies to VISIBLE rows (the anti-join filters BEFORE LIMIT), so
  // there is no false-negative truncation, and the stable LENGTH(label),id
  // ordering is preserved.
  const TEMP = '_sgn_excluded_nodes'
  try {
    // Drop first in case a prior call on this (singleton, per-connection) handle
    // left the temp table behind — temp tables persist for the connection's life.
    store.db.run(`DROP TABLE IF EXISTS ${TEMP}`)
    store.db.run(`CREATE TEMP TABLE ${TEMP} (id TEXT PRIMARY KEY)`)
    const hiddenIds = [...hidden]
    // 500 bound variables per INSERT — far under the 32766 ceiling, so the
    // bound-variable count is O(1) in the batch size, not in |hidden|.
    const INSERT_CHUNK = 500
    for (let i = 0; i < hiddenIds.length; i += INSERT_CHUNK) {
      const chunk = hiddenIds.slice(i, i + INSERT_CHUNK)
      store.db.run(
        `INSERT OR IGNORE INTO ${TEMP} (id) VALUES ${chunk.map(() => '(?)').join(',')}`,
        chunk
      )
    }
    const filteredQuery =
      `SELECT n.* FROM graph_nodes n ` +
      `LEFT JOIN ${TEMP} x ON x.id = n.id ` +
      `WHERE LOWER(n.label) LIKE ? AND x.id IS NULL ` +
      `ORDER BY LENGTH(n.label) ASC, n.id ASC LIMIT ?`
    const rows = store.db.queryAll<GraphNode>(filteredQuery, [`%${q}%`, limit])
    return toDTO({ center: undefined, nodes: rows.map((n) => ({ ...n, degree: 0 })), edges: [] }).nodes
  } finally {
    // Drop so repeated searches on the singleton connection never inherit stale
    // exclusion state or collide on the fixed table name.
    store.db.run(`DROP TABLE IF EXISTS ${TEMP}`)
  }
}

/**
 * ADV11-MED (round-12) — materialize the set of EXCLUDED-ONLY graph node ids
 * (nodes with ≥1 incident edge where EVERY incident edge is provenance-
 * suppressed) using a FIXED, bounded number of queries: one full read of
 * graph_edge_sources + one full read of graph_edges, regardless of how many
 * nodes match a search. This replaces the per-node isNodeVisibleUnderExclusion
 * N+1 so a caller can push the exclusion into SQL (`id NOT IN(...)`) and keep the
 * DB's LIMIT meaningful. The visibility decision is byte-for-byte the same as
 * isNodeVisibleUnderExclusion: a node with ≥1 surviving (non-suppressed / legacy
 * zero-provenance) edge is NOT hidden; a node with all-suppressed incident edges IS
 * hidden; and (ADV35-1, round-37) an ISOLATED node is decided by NODE-LEVEL
 * provenance ({@link classifyIsolatedNodeVisible}) — a derived orphan of an
 * excluded/purged recording is hidden, a manual/structural orphan stays visible,
 * and a legacy (origin-NULL) orphan is hidden UNLESS it has positive backing
 * ({@link legacyNodeBackingVisible}), regardless of its node type (ADV36-1).
 */
function computeExcludedOnlyNodeIds(
  store: KnowledgeGraphStore,
  exclusion: GroundingExclusion
): Set<string> {
  const hidden = new Set<string>()
  if (exclusionIsNoop(exclusion)) return hidden

  // 1. Group provenance by edge (one full scan), then decide which edges are
  //    suppressed with the SAME rule as provenanceSuppressedEdgeIds.
  const provRows = store.db.queryAll<{ edge_id: string; recording_id: string }>(
    'SELECT edge_id, recording_id FROM graph_edge_sources WHERE recording_id IS NOT NULL'
  )
  const byEdge = new Map<string, string[]>()
  for (const r of provRows) {
    const list = byEdge.get(r.edge_id)
    if (list) list.push(r.recording_id)
    else byEdge.set(r.edge_id, [r.recording_id])
  }
  const suppressedEdges = new Set<string>()
  for (const [edgeId, recIds] of byEdge) {
    // fail-closed → every attributed edge (has provenance rows) is suppressed;
    // otherwise → suppressed only when EVERY source recording is excluded.
    if (exclusion.failClosed || recIds.every((id) => exclusion.ids.has(id))) {
      suppressedEdges.add(edgeId)
    }
  }

  // 2. Per node, count incident edges vs suppressed incident edges (one full
  //    scan). A node is hidden iff it has incident edges and ALL are suppressed.
  const incident = new Map<string, number>()
  const suppressedIncident = new Map<string, number>()
  const bump = (m: Map<string, number>, k: string): void => {
    m.set(k, (m.get(k) ?? 0) + 1)
  }
  const edges = store.db.queryAll<{ id: string; source_id: string; target_id: string }>(
    'SELECT id, source_id, target_id FROM graph_edges'
  )
  for (const e of edges) {
    // ADV23-2 (round-24) — a zero-provenance edge (no graph_edge_sources rows,
    // hence absent from byEdge) is suppressed on non-owner surfaces, exactly as
    // provenanceSuppressedEdgeIds does, so an excluded-only node computed here
    // matches isNodeVisibleUnderExclusion byte-for-byte.
    const isSup =
      suppressedEdges.has(e.id) || (!!exclusion.suppressZeroProvenance && !byEdge.has(e.id))
    for (const nodeId of [e.source_id, e.target_id]) {
      bump(incident, nodeId)
      if (isSup) bump(suppressedIncident, nodeId)
    }
  }
  for (const [nodeId, count] of incident) {
    if (count > 0 && suppressedIncident.get(nodeId) === count) hidden.add(nodeId)
  }

  // 3. ADV35-1 (round-37) — ISOLATED nodes (no incident edge, hence absent from
  //    `incident`) are not decided by edge-provenance. Scan all nodes, and for each
  //    isolated one apply the NODE-LEVEL provenance rule. Batch the derived-source
  //    eligibility lookup ONCE (not per node) to preserve this function's bounded,
  //    non-N+1 contract.
  const allNodes = store.db.queryAll<NodeProvenanceRow & { id: string }>(
    'SELECT id, type, origin, source_recording_id, label, norm_key, props FROM graph_nodes'
  )
  const isolatedDerivedSourceIds = new Set<string>()
  let hasLegacyIsolated = false
  for (const n of allNodes) {
    if (incident.has(n.id)) continue // has edges — decided above
    if (n.origin === 'derived' && n.source_recording_id && !exclusion.failClosed) {
      isolatedDerivedSourceIds.add(n.source_recording_id)
    } else if (n.origin !== 'derived' && n.origin !== 'manual' && n.origin !== 'structural') {
      hasLegacyIsolated = true // origin NULL ⇒ needs a positive-backing lookup
    }
  }
  const { eligible: eligibleIsolatedSources, failClosed: isolatedFailClosed } =
    isolatedDerivedSourceIds.size > 0
      ? getEligibleGraphSourceIds(isolatedDerivedSourceIds)
      : { eligible: new Set<string>(), failClosed: false }
  const sourceEligible = (recId: string): boolean =>
    !isolatedFailClosed && eligibleIsolatedSources.has(recId)
  // ADV36-1 (round-38) — build the project name index ONCE (only if a legacy
  // isolated node needs the positive-backing lookup) so legacyNodeBackingVisible
  // does not re-scan `projects` per node.
  const projectIndex = hasLegacyIsolated ? projectNameIndex() : undefined
  for (const n of allNodes) {
    if (incident.has(n.id)) continue
    if (!classifyIsolatedNodeVisible(n, exclusion, sourceEligible, () => legacyNodeBackingVisible(n, projectIndex)))
      hidden.add(n.id)
  }
  return hidden
}

/**
 * Find the person/project graph node whose label is named in a block of text
 * (longest label wins). Precise substring match — powers the RAG grounding hook
 * without over-triggering on stray words. Returns null when nothing is named.
 */
export function findMentionedEntity(text: string): ContextGraphNode | null {
  const haystack = ` ${text.toLowerCase()} `
  const store = getKnowledgeGraphStore()
  const rows = store.db.queryAll<GraphNode>(
    "SELECT * FROM graph_nodes WHERE type IN ('person', 'project')"
  )
  let best: GraphNode | null = null
  for (const n of rows) {
    const label = (n.label || '').trim().toLowerCase()
    if (label.length < 3) continue
    if (haystack.includes(` ${label} `) || haystack.includes(` ${label}`) || haystack.includes(`${label} `)) {
      if (!best || label.length > best.label.trim().length) best = n
    }
  }
  if (!best) return null
  return toDTO({ center: undefined, nodes: [{ ...best, degree: 0 }], edges: [] }).nodes[0]
}

/**
 * ARF-2 / P1 (round-3, fail-closed) — the excluded-recording context for graph
 * suppression. `ids` = soft-deleted OR personal OR value-excluded recordings
 * (the EXACT predicate the vector store enforces via getExcludedRecordingIds).
 * `failClosed` = the lookup THREW: the exclusion set is UNKNOWN, so every
 * recording-attributed edge must be suppressed (only legacy zero-provenance
 * edges survive) rather than defaulting to "exclude nothing" (fail-open would
 * turn a transient DB error into unrestricted retrieval).
 */
export interface GroundingExclusion {
  ids: Set<string>
  failClosed: boolean
  /**
   * ADV23-2 (round-24) — when true, ALSO suppress ZERO-PROVENANCE (legacy pre-F18)
   * edges — edges with no graph_edge_sources rows — from the surface using this
   * context. NON-OWNER Context Graph read surfaces (views / search / topic +
   * attendee + skill + profile + stats aggregates) pass `true`: a pre-F18 edge
   * cannot be proven to NOT derive from a now-excluded recording, so it is
   * suppressed (fail-closed interim until the F21 provenance rebuild restores it
   * WITH attribution). CHAT grounding (neighborhoodFacts/buildGraphContext) keeps
   * this `false` — it handles zero-provenance separately via the answer's
   * `unresolved` provenance flag (rounds 19-20), dropping the whole graph bundle
   * from the prompt rather than suppressing edges here.
   */
  suppressZeroProvenance?: boolean
}

/**
 * Compute the grounding/view exclusion context ONCE per query (the assistant
 * path in rag.ts threads it through every neighborhoodFacts call). On a lookup
 * error it FAILS CLOSED (P1): no leak of attributed content on a transient DB
 * failure.
 */
export function getGroundingExclusionSet(suppressZeroProvenance = false): GroundingExclusion {
  try {
    // ADV9 (round-9) — derive the suppression blocklist from the POSITIVE
    // eligibility allowlist over the recording ids actually referenced by graph
    // provenance, rather than from getExcludedRecordingIds (which only reads LIVE
    // recordings). A HARD-PURGED / pending-skipGraphCleanup provenance id is gone
    // from `recordings`, so it was never in the old blocklist and its residual
    // edges kept grounding. Here it is simply NOT in the allowlist → included in
    // the suppression set. Every downstream consumer (provenanceSuppressedEdgeIds,
    // node visibility, center-reachability) keeps working unchanged.
    const store = getKnowledgeGraphStore()
    // Include BOTH edge and node provenance. After precise source cleanup an
    // entity shared with another source can legitimately remain as an isolated
    // derived node; omitting node sources here made an empty edge-source set look
    // like a no-op and exposed that orphan without its eligibility check.
    const provRows = store.db.queryAll<{ recording_id: string }>(`
      SELECT DISTINCT recording_id
        FROM graph_edge_sources
       WHERE recording_id IS NOT NULL
      UNION
      SELECT DISTINCT source_recording_id AS recording_id
        FROM graph_nodes
       WHERE origin = 'derived' AND source_recording_id IS NOT NULL
    `)
    const provIds = provRows.map((r) => r.recording_id).filter((x): x is string => !!x)
    if (provIds.length === 0) return { ids: new Set<string>(), failClosed: false, suppressZeroProvenance }
    const { eligible, failClosed } = getEligibleGraphSourceIds(provIds)
    if (failClosed) return { ids: new Set<string>(), failClosed: true, suppressZeroProvenance }
    const ids = new Set<string>()
    for (const id of provIds) if (!eligible.has(id)) ids.add(id)
    return { ids, failClosed: false, suppressZeroProvenance }
  } catch (e) {
    console.error('[KnowledgeGraph] grounding exclusion lookup FAILED — failing closed (suppressing all attributed facts):', e)
    return { ids: new Set<string>(), failClosed: true, suppressZeroProvenance }
  }
}

/**
 * True when this exclusion context can suppress nothing (healthy + empty). A
 * context that suppresses zero-provenance edges (ADV23-2 non-owner surfaces) is
 * NEVER a no-op — even with an empty excluded-recording set it must still run so
 * legacy pre-F18 edges are dropped.
 */
function exclusionIsNoop(exclusion: GroundingExclusion): boolean {
  return !exclusion.failClosed && exclusion.ids.size === 0 && !exclusion.suppressZeroProvenance
}

/** Fetch graph_edge_sources for a set of edge ids, chunked to stay under the
 *  SQL bound-parameter limit (large overview edge sets). */
function edgeProvenanceRows(
  store: KnowledgeGraphStore,
  edgeIds: string[]
): Array<{ edge_id: string; recording_id: string }> {
  const out: Array<{ edge_id: string; recording_id: string }> = []
  const CHUNK = 400
  for (let i = 0; i < edgeIds.length; i += CHUNK) {
    const chunk = edgeIds.slice(i, i + CHUNK)
    const placeholders = chunk.map(() => '?').join(',')
    out.push(
      ...store.db.queryAll<{ edge_id: string; recording_id: string }>(
        `SELECT edge_id, recording_id FROM graph_edge_sources WHERE edge_id IN (${placeholders})`,
        chunk
      )
    )
  }
  return out
}

/**
 * ARF-2 / P1 — given candidate graph edge ids, return the subset to SUPPRESS.
 * An edge with NO provenance rows (legacy pre-F18) or with ≥1 source from an
 * eligible recording is KEPT. In fail-closed mode EVERY provenance-attributed
 * edge is suppressed (the exclusion set is unknown); if the provenance read
 * ITSELF throws in fail-closed mode, every candidate edge is suppressed (we
 * cannot prove any edge eligible).
 */
function provenanceSuppressedEdgeIds(
  store: KnowledgeGraphStore,
  edgeIds: string[],
  exclusion: GroundingExclusion
): Set<string> {
  const suppressed = new Set<string>()
  if (edgeIds.length === 0 || exclusionIsNoop(exclusion)) return suppressed

  let rows: Array<{ edge_id: string; recording_id: string }>
  try {
    rows = edgeProvenanceRows(store, edgeIds)
  } catch (e) {
    if (exclusion.failClosed) {
      // Can't even read provenance while already failing closed — suppress
      // every candidate edge (safe: no attributed content can leak).
      console.error('[KnowledgeGraph] provenance read failed while fail-closed — suppressing all candidate edges:', e)
      return new Set(edgeIds)
    }
    throw e
  }

  const byEdge = new Map<string, string[]>()
  for (const r of rows) {
    const list = byEdge.get(r.edge_id)
    if (list) list.push(r.recording_id)
    else byEdge.set(r.edge_id, [r.recording_id])
  }
  // Iterate the CANDIDATE edges (not just the attributed ones) so a zero-provenance
  // legacy edge can be suppressed on non-owner surfaces (ADV23-2).
  for (const edgeId of edgeIds) {
    const recIds = byEdge.get(edgeId)
    if (!recIds || recIds.length === 0) {
      // Zero-provenance legacy edge (no graph_edge_sources rows). ADV23-2
      // (round-24): suppressed on non-owner surfaces (suppressZeroProvenance);
      // kept for chat grounding (handled via the answer's unresolved flag).
      if (exclusion.suppressZeroProvenance) suppressed.add(edgeId)
      continue
    }
    // fail-closed → any attributed edge (it has provenance rows) is suppressed;
    // otherwise → suppressed only when EVERY source is excluded.
    if (exclusion.failClosed || recIds.every((id) => exclusion.ids.has(id))) {
      suppressed.add(edgeId)
    }
  }
  return suppressed
}

interface NodeProvenanceRow {
  type: string
  origin: string | null
  source_recording_id: string | null
  label: string
  norm_key: string
  props: string | null
}

/** The node fields a legacy backing lookup needs (subset of {@link NodeProvenanceRow}). */
type LegacyBackingRow = Pick<NodeProvenanceRow, 'type' | 'label' | 'norm_key' | 'props'>

/**
 * ADV36-1 (round-38) — POSITIVE backing check for a LEGACY (origin-NULL) ISOLATED
 * node. Node TYPE is NOT provenance: ingestExtraction creates recording-DERIVED
 * person / meeting / project nodes too, so the round-37 "structural kind ⇒ visible"
 * heuristic fails OPEN (a legacy transcript-derived person/meeting/project leaked
 * its label with no eligible backing). A legacy edgeless node is therefore visible
 * ONLY when it resolves to a still-visible backing row:
 *   • person  ⇒ its backing CONTACT is visible (filterVisibleEntityIds 'contact',
 *     via props.contactId or the `contact:<id>` norm_key);
 *   • meeting ⇒ an ELIGIBLE meeting/recording backs it (getEligibleRecordingIds
 *     over the meeting's recordings + the meetingId itself as a candidate recording id);
 *   • project ⇒ its backing PROJECT is visible (filterVisibleEntityIds 'project',
 *     resolved by name);
 *   • any other (purely DERIVED) kind — risk/topic/skill/decision/action_item/
 *     next_step — has NO structural backing ⇒ SUPPRESS.
 * Fail-closed: an unresolvable backing id, a suppressed/ineligible backing row, or
 * any lookup failure ⇒ NOT visible.
 */
function legacyNodeBackingVisible(row: LegacyBackingRow, projectIndex?: Map<string, string>): boolean {
  const props = parseProps(row.props)
  if (row.type === 'person') {
    let contactId: string | null = null
    if (typeof props.contactId === 'string' && props.contactId) contactId = props.contactId
    else if (row.norm_key.startsWith('contact:')) contactId = row.norm_key.slice('contact:'.length)
    if (!contactId) return false
    const { visible, failClosed } = filterVisibleEntityIds('contact', [contactId])
    return !failClosed && visible.has(contactId)
  }
  if (row.type === 'meeting') {
    let meetingId: string | null = null
    if (typeof props.meetingId === 'string' && props.meetingId) meetingId = props.meetingId
    else if (row.norm_key.startsWith('meeting:')) meetingId = row.norm_key.slice('meeting:'.length)
    if (!meetingId) return false
    // meetingId may itself be a recordingId (ingest keys meeting nodes by
    // `recordings.meeting_id ?? recordingId`), so probe it directly too.
    const recIds = new Set<string>([meetingId])
    try {
      for (const rec of getRecordingsForMeeting(meetingId)) recIds.add(rec.id)
    } catch (e) {
      console.error('[KnowledgeGraph] legacy meeting backing lookup failed — fail-closed:', e)
      return false
    }
    const { eligible, failClosed } = getEligibleGraphSourceIds(recIds)
    return !failClosed && eligible.size > 0
  }
  if (row.type === 'project') {
    const idx = projectIndex ?? projectNameIndex()
    const pid = idx.get((row.label || '').toLowerCase().trim())
    if (!pid) return false
    const { visible, failClosed } = filterVisibleEntityIds('project', [pid])
    return !failClosed && visible.has(pid)
  }
  return false // derived-only kind ⇒ no structural backing ⇒ suppress (fail-closed)
}

/**
 * ADV35-1 (round-37) / ADV36-1 (round-38) — PURE isolated-node visibility rule,
 * shared by the per-node {@link isIsolatedNodeVisible} (point reads / views /
 * mutation guard) and the batched {@link computeExcludedOnlyNodeIds} (search) so
 * they never drift. Given a node's provenance row, a predicate for whether a derived
 * source recording is currently eligible, and a lazy callback resolving legacy
 * POSITIVE backing:
 *   • origin 'manual'/'structural' ⇒ VISIBLE (user/folder/calendar — not tied to a
 *     recording, nothing to exclude);
 *   • origin 'derived' ⇒ visible ONLY if its source_recording_id resolves ELIGIBLE
 *     (no source id, an ineligible/hard-purged source, or a fail-closed context ⇒
 *     SUPPRESSED);
 *   • origin NULL (legacy) ⇒ visible ONLY if it has POSITIVE backing
 *     ({@link legacyNodeBackingVisible}) — NO type heuristic (round-38 fix).
 */
function classifyIsolatedNodeVisible(
  row: NodeProvenanceRow,
  exclusion: GroundingExclusion,
  sourceEligible: (recId: string) => boolean,
  legacyBackingVisible: () => boolean
): boolean {
  if (row.origin === 'manual' || row.origin === 'structural') return true
  if (row.origin === 'derived') {
    if (!row.source_recording_id) return false // derived but unassociable ⇒ suppress
    if (exclusion.failClosed) return false // fail-closed context suppresses attributed content
    return sourceEligible(row.source_recording_id)
  }
  // origin NULL = LEGACY pre-v47. Require POSITIVE backing (no type heuristic —
  // person/meeting/project are derived too, ADV36-1).
  return legacyBackingVisible()
}

/**
 * ADV35-1 (round-37) — visibility for a single ISOLATED (zero-incident-edge) node.
 * An isolated node has NO graph_edge_sources rows, so edge-provenance can't suppress
 * it; the NODE-LEVEL provenance rule ({@link classifyIsolatedNodeVisible}) decides.
 * A missing node row ⇒ not visible (fail-closed).
 */
function isIsolatedNodeVisible(
  store: KnowledgeGraphStore,
  nodeId: string,
  exclusion: GroundingExclusion
): boolean {
  const row = store.db.queryOne<NodeProvenanceRow>(
    'SELECT type, origin, source_recording_id, label, norm_key, props FROM graph_nodes WHERE id = ?',
    [nodeId]
  )
  if (!row) return false // gone ⇒ not visible (fail-closed)
  return classifyIsolatedNodeVisible(
    row,
    exclusion,
    (recId) => {
      const { eligible, failClosed } = getEligibleGraphSourceIds([recId])
      return !failClosed && eligible.has(recId)
    },
    () => legacyNodeBackingVisible(row)
  )
}

/**
 * P3 (round-3) — is a graph node visible under the current exclusion? A node with
 * ≥1 incident edge is HIDDEN only when EVERY incident edge is provenance-suppressed
 * (an "excluded-only" node). ADV35-1 (round-37): a node with ZERO incident edges is
 * no longer blanket-visible — an ISOLATED DERIVED node (e.g. an edgeless risk) has
 * no edge-provenance to suppress by, so its NODE-LEVEL provenance decides (see
 * {@link isIsolatedNodeVisible}); manual/structural isolated nodes stay visible.
 * Used by the inspector/search read paths (searchGraphNodes, queryProvenance,
 * getNodeDetail, default-center, queryListNodes) AND the mutation guard
 * (isNodeMutable) so they never expose / mutate an excluded-only or
 * excluded-derived-orphan node.
 */
function isNodeVisibleUnderExclusion(
  store: KnowledgeGraphStore,
  nodeId: string,
  exclusion: GroundingExclusion
): boolean {
  if (exclusionIsNoop(exclusion)) return true
  const incident = store.db.queryAll<{ id: string }>(
    'SELECT id FROM graph_edges WHERE source_id = ? OR target_id = ?',
    [nodeId, nodeId]
  )
  if (incident.length === 0) return isIsolatedNodeVisible(store, nodeId, exclusion) // node-level provenance
  const suppressed = provenanceSuppressedEdgeIds(store, incident.map((e) => e.id), exclusion)
  return suppressed.size < incident.length // ≥1 edge survived ⇒ visible
}

/**
 * RE4-1 (round-4) — the set of nodes REACHABLE from `centerId` within `hops`
 * traversing ONLY surviving (non-suppressed) edges. Stricter than
 * isNodeVisibleUnderExclusion: a node with eligible edges ELSEWHERE but reachable
 * from this center only via an excluded edge is NOT in the set. Used to derive a
 * centered provenance/subgraph solely from survivors.
 */
function centerReachableSurvivorIds(
  store: KnowledgeGraphStore,
  centerId: string,
  hops: number,
  exclusion: GroundingExclusion
): Set<string> {
  const sub = neighborhood(store, centerId, hops)
  const suppressed = provenanceSuppressedEdgeIds(store, sub.edges.map((e) => e.id), exclusion)
  const adj = new Map<string, Set<string>>()
  const link = (a: string, b: string): void => {
    let s = adj.get(a)
    if (!s) { s = new Set(); adj.set(a, s) }
    s.add(b)
  }
  for (const e of sub.edges) {
    if (suppressed.has(e.id)) continue
    link(e.source_id, e.target_id)
    link(e.target_id, e.source_id)
  }
  const reachable = new Set<string>([centerId])
  const queue = [centerId]
  while (queue.length) {
    const cur = queue.shift() as string
    for (const nb of adj.get(cur) ?? []) {
      if (!reachable.has(nb)) {
        reachable.add(nb)
        queue.push(nb)
      }
    }
  }
  return reachable
}

/**
 * RE-4 (Codex adversarial re-review round 2) — apply the SAME provenance-aware
 * suppression used for assistant grounding to a Context Graph VIEW DTO (nodes +
 * edges): drop every edge whose provenance is entirely excluded (post-F18
 * attributed excluded recording), then prune any node ORPHANED by that removal
 * (it had incident edges, all now suppressed). The center node and nodes still
 * incident to a kept edge, and isolated nodes not touched by the removal, are
 * kept. Legacy ZERO-provenance edges are never suppressed (RE-3 ruling), so
 * pre-F18 content persists in views until a future full graph rebuild.
 * Generic over ContextGraphData / ContextLensData — extra fields (weight,
 * stratum, strata, referenceMs) pass through untouched.
 */
function suppressExcludedFromView<
  T extends {
    center: string | null
    nodes: Array<{ id: string }>
    edges: Array<{ id: string; source: string; target: string }>
  }
>(data: T, exclusion: GroundingExclusion): T {
  if (exclusionIsNoop(exclusion)) return data
  const suppressed = provenanceSuppressedEdgeIds(
    getKnowledgeGraphStore(),
    data.edges.map((e) => e.id),
    exclusion
  )

  const keptEdges = data.edges.filter((e) => !suppressed.has(e.id))
  const incidentToKept = new Set<string>()
  for (const e of keptEdges) {
    incidentToKept.add(e.source)
    incidentToKept.add(e.target)
  }
  const incidentToSuppressed = new Set<string>()
  for (const e of data.edges) {
    if (suppressed.has(e.id)) {
      incidentToSuppressed.add(e.source)
      incidentToSuppressed.add(e.target)
    }
  }
  const store = getKnowledgeGraphStore()
  const keptNodes = data.nodes.filter((n) => {
    // RE4-2 (round-4) — the center is NOT exempt from pruning. Centered callers
    // (queryNeighborhood/queryLens) pre-check center visibility and bail EMPTY
    // for an excluded-only / fail-closed center BEFORE building, so a surviving
    // center always retains ≥1 eligible incident edge here and is kept via
    // incidentToKept below; an excluded-only center is never allowed to reach
    // this function.
    if (incidentToKept.has(n.id)) return true // still connected
    // Orphaned strictly BY the removal (was only on suppressed edges) → prune.
    if (incidentToSuppressed.has(n.id)) return false
    // ADV35-1 (round-37) — isolated within this view (touched by NO edge here, e.g.
    // an edgeless risk in the overview, or a fullGraph-limit-truncated node). No
    // longer blanket-kept: re-verify through the shared boundary, which decides an
    // isolated node by NODE-LEVEL provenance (derived-orphan of an excluded/purged
    // recording ⇒ suppressed; manual/structural ⇒ kept).
    return isNodeVisibleUnderExclusion(store, n.id, exclusion)
  })
  return { ...data, nodes: keptNodes, edges: keptEdges }
}

/**
 * ADV18-2 (round-19) — provenance sink for graph grounding. When passed to
 * {@link neighborhoodFacts}, it accumulates the authoritative recording ids that
 * back the EMITTED fact edges (from graph_edge_sources), across every call, so
 * the RAG service can fold graph provenance into the persisted answer's union.
 * `unresolved` is set if a provenance read THREW (⇒ the answer's provenance is
 * unverifiable ⇒ fail-closed redaction on later re-read). Legacy zero-provenance
 * fact edges contribute NO recording id and do NOT set `unresolved` — they are an
 * accepted residual (RE-3 ruling: pre-F18 content can't be retracted per-record).
 */
export interface NeighborhoodFactProvenance {
  recordingIds: Set<string>
  unresolved: boolean
}

/**
 * Compact, human-readable facts about an entity's neighborhood — one line per
 * connected entity. Used to ground the assistant/RAG with graph context.
 * Returns '' when nothing is found (caller appends nothing).
 *
 * ARF-2 (Codex adversarial FINAL review, BINDING) — provenance-aware: a fact
 * (edge) is SUPPRESSED when EVERY graph_edge_sources row backing it belongs to
 * an excluded recording (soft-deleted / personal / value-excluded), so the
 * assistant is never grounded on content the UI promises is "excluded from all
 * AI processing / the Context Graph". Facts with NO provenance rows (legacy
 * pre-F18 content) or with ≥1 eligible source remain — matching the honest
 * scope of the deletion copy (legacy graph content may still appear in Context
 * Graph VIEWS until a hard purge; the assistant grounding filtered here is what
 * the promise covers for post-F18 content). `excluded` is computed once per
 * query by the caller (rag.ts) and threaded in; it defaults to a fresh read so
 * this function stays independently correct + testable.
 *
 * ADV18-2 (round-19) — when `provOut` is supplied, the recording ids backing the
 * EMITTED fact edges are collected into it so the answer's persisted provenance
 * union covers graph facts, not just vector snippets.
 */
export function neighborhoodFacts(
  entityId: string,
  hops = 1,
  maxFacts = 20,
  exclusion: GroundingExclusion = getGroundingExclusionSet(),
  provOut?: NeighborhoodFactProvenance
): string {
  // Build the RAW neighborhood directly — NOT via queryNeighborhood, which
  // (RE4-2, round-4) empties a centered VIEW on an excluded-only / fail-closed
  // center. GROUNDING has a different fail-closed policy (round-3 P1): suppress
  // attributed edges but KEEP legacy zero-provenance facts so the assistant is
  // not gutted on a transient DB error. The edge suppression below enforces it.
  const store = getKnowledgeGraphStore()
  const nodeId = resolveEntityToNodeId(entityId)
  if (!nodeId) return ''
  const data = toDTO(neighborhood(store, nodeId, hops))
  if (!data.center || data.nodes.length <= 1) return ''

  const byId = new Map(data.nodes.map((n) => [n.id, n]))
  const center = byId.get(data.center)
  if (!center) return ''

  const suppressed = provenanceSuppressedEdgeIds(
    getKnowledgeGraphStore(),
    data.edges.map((e) => e.id),
    exclusion
  )

  const lines: string[] = []
  const emittedEdgeIds: string[] = []
  for (const e of data.edges) {
    if (lines.length >= maxFacts) break
    if (suppressed.has(e.id)) continue // ARF-2 — fully-excluded provenance
    const src = byId.get(e.source)
    const tgt = byId.get(e.target)
    if (!src || !tgt) continue
    if (src.id !== center.id && tgt.id !== center.id) continue
    const rel = e.type.toLowerCase().replace(/_/g, ' ')
    lines.push(`- ${src.label} ${rel} ${tgt.label}`)
    if (provOut) emittedEdgeIds.push(e.id)
  }
  if (lines.length === 0) return ''

  // ADV18-2 — record the authoritative recording ids behind the EMITTED facts so
  // the persisted answer can be redacted if any of them is later excluded.
  // ADV19-3 (round-20) — a legacy edge with NO graph_edge_sources rows is
  // UNVERIFIABLE for CHAT grounding: we cannot prove it wasn't derived from a
  // now-excluded recording, so an answer grounded (even partly) on it must fail
  // closed on re-read. Mark the answer's provenance union `unresolved` whenever
  // ANY emitted fact edge lacks provenance rows. This is scoped to the CHAT
  // provenance sink (provOut) only — graph VIEWS keep the legacy caveat (RE-3
  // ruling) and never pass a provOut, so their behaviour is unchanged.
  if (provOut && emittedEdgeIds.length) {
    try {
      const attributedEdges = new Set<string>()
      for (const r of edgeProvenanceRows(store, emittedEdgeIds)) {
        attributedEdges.add(r.edge_id)
        if (r.recording_id) provOut.recordingIds.add(r.recording_id)
      }
      for (const edgeId of emittedEdgeIds) {
        if (!attributedEdges.has(edgeId)) {
          provOut.unresolved = true // zero-provenance legacy fact ⇒ unverifiable for chat
          break
        }
      }
    } catch (e) {
      provOut.unresolved = true
      console.error('[KnowledgeGraph] fact provenance read failed — marking answer provenance unverifiable:', e)
    }
  }

  return `Context graph — ${center.label} (${center.type}):\n${lines.join('\n')}`
}

// ---------------------------------------------------------------------------
// Context Lens — stratified, time-aware perspective + provenance
// ---------------------------------------------------------------------------

export interface ContextLensNode extends ContextGraphNode {
  /** Abstraction band: strategic | operational | people | evidence. */
  stratum: string
  /** Effective recency (epoch ms) for time ordering + age decay, or null. */
  dateMs: number | null
}

/** Per-stratum totals-in-scope vs. shown after the lens node budget. */
export interface ContextLensStratumCount {
  stratum: string
  total: number
  shown: number
}

export interface ContextLensData {
  center: string | null
  nodes: ContextLensNode[]
  edges: Array<{ id: string; source: string; target: string; type: string; weight: number }>
  /** Newest activity in the lens — the reference the time chips measure back from. */
  referenceMs: number | null
  /** Per-stratum totals-vs-shown — drives the "20 of 214" truncation affordance. */
  strata: ContextLensStratumCount[]
}

/** A one-line entity descriptor for the lens center / provenance nodes. */
export interface LensCenter {
  id: string
  type: string
  label: string
  contactId?: string
  meetingId?: string
  projectId?: string
}

export interface ProvenanceDTO {
  node: (LensCenter & { dateMs: number | null }) | null
  meetings: Array<LensCenter & { dateMs: number | null }>
  people: Array<LensCenter & { dateMs: number | null }>
  projects: Array<LensCenter & { dateMs: number | null }>
  actions: Array<LensCenter & { dateMs: number | null }>
  pathIds: string[]
  narrative: string
  dateMs: number | null
}

function toLensDTO(lens: LensGraph): ContextLensData {
  const projects = projectNameIndex()
  const visibleContactIds = visibleContactIdSet(lens.nodes)
  const nodes: ContextLensNode[] = lens.nodes.map((n) => ({
    ...nodeToDTO(n, projects, visibleContactIds),
    stratum: n.stratum,
    dateMs: n.dateMs,
  }))
  const edges = lens.edges.map((e) => ({
    id: e.id,
    source: e.source_id,
    target: e.target_id,
    type: e.type,
    weight: e.weight,
  }))
  const strata: ContextLensStratumCount[] = lens.strata.map((s) => ({
    stratum: s.stratum,
    total: s.total,
    shown: s.shown,
  }))
  return { center: lens.center?.id ?? null, nodes, edges, referenceMs: lens.referenceMs, strata }
}

/**
 * A stratified, time-aware lens. `centerEntityId` accepts any id form (graph
 * node id, contact id, meeting id, project id, or bare name); null builds a
 * whole-graph lens capped to the highest-degree hubs. `windowDays` filters to
 * recent activity (null = All).
 */
export function queryLens(
  centerEntityId: string | null,
  opts: { hops?: number; cap?: number; windowDays?: number | null } = {}
): ContextLensData {
  const store = getKnowledgeGraphStore()
  const emptyLens: ContextLensData = { center: null, nodes: [], edges: [], referenceMs: null, strata: [] }
  const exclusion = getGroundingExclusionSet(true) // ADV23-2: non-owner surface — suppress legacy zero-provenance edges
  let centerNodeId: string | null = null
  if (centerEntityId) {
    centerNodeId = resolveEntityToNodeId(centerEntityId)
    if (!centerNodeId) return emptyLens
    // RE4-2 (round-4) — a CENTERED lens fails closed and never exposes an
    // excluded-only center. (A null-center whole-graph lens is not "centered";
    // it falls through to suppressExcludedFromView, which under fail-closed
    // suppresses attributed edges and keeps only legacy, like the overview.)
    if (exclusion.failClosed || !isNodeVisibleUnderExclusion(store, centerNodeId, exclusion)) {
      return emptyLens
    }
  }
  const filtered = suppressExcludedFromView(toLensDTO(lensGraph(store, centerNodeId, opts)), exclusion)
  // INC5 (round-5) — decide center retention from the POST-FILTER survivor
  // graph: the lens's windowDays / stratum node budget can drop the center's
  // ONLY eligible edge while an excluded one remains, so suppression then prunes
  // the center yet the DTO still points `center` at the now-missing node id
  // (a blank, mislabelled lens). If the center did not survive, empty out.
  if (centerNodeId && !filtered.nodes.some((n) => n.id === filtered.center)) {
    return emptyLens
  }
  return filtered
}

/**
 * The default lens center — the app owner's person node when known, else the
 * highest-degree person (the natural ego of the user's own context). Returns
 * null when the graph has no people yet.
 */
export function pickLensCenter(ownerContactId?: string | null): LensCenter | null {
  const store = getKnowledgeGraphStore()
  const node = pickDefaultCenter(store, ownerContactId ?? undefined)
  if (!node) return null
  // P3 (round-3) — never default-center an excluded-only node; fall back to
  // null so the caller builds the (already-suppressed) whole-graph lens.
  // ADV23-2 — non-owner surface: legacy zero-provenance nodes are excluded-only.
  if (!isNodeVisibleUnderExclusion(store, node.id, getGroundingExclusionSet(true))) return null
  const projects = projectNameIndex()
  // ADV32-1 (round-34) — sanitize contactId through the shared fail-closed set so a
  // default-centered node keyed to a suppressed contact never exposes its id.
  const dto = nodeToDTO({ ...node, degree: 0 }, projects, visibleContactIdSet([node]))
  return { id: dto.id, type: dto.type, label: dto.label, contactId: dto.contactId }
}

/**
 * Provenance for an entity: the meeting(s) it emerged from, people present, the
 * project it belongs to, downstream actions, and a one-line narrative. Accepts
 * any id form. Returns an empty provenance when the entity is unknown.
 */
export function queryProvenance(entityId: string): ProvenanceDTO {
  const store = getKnowledgeGraphStore()
  const nodeId = resolveEntityToNodeId(entityId)
  const empty: ProvenanceDTO = {
    node: null,
    meetings: [],
    people: [],
    projects: [],
    actions: [],
    pathIds: [],
    narrative: '',
    dateMs: null,
  }
  if (!nodeId) return empty
  const exclusion = getGroundingExclusionSet(true) // ADV23-2: non-owner surface — suppress legacy zero-provenance edges
  // RE4-2 — centered read: fail closed, and never expose an excluded-only center.
  if (exclusion.failClosed || !isNodeVisibleUnderExclusion(store, nodeId, exclusion)) return empty

  const prov: Provenance = provenance(store, nodeId)
  const projects = projectNameIndex()
  // ADV32-1 (round-34) — batch-resolve the visible backing contactIds ONCE for
  // every entity this provenance may map, so mapEntity's shared nodeToDTO sanitizes
  // contactId fail-closed (a person keyed to a suppressed contact never leaks its
  // id here) without a per-entity visibility lookup.
  const provFullNodes = [prov.node, ...prov.meetings, ...prov.people, ...prov.projects, ...prov.actions]
    .filter((e): e is NonNullable<typeof e> => !!e)
    .map((e) => store.getNode(e.id))
    .filter((n): n is NonNullable<typeof n> => !!n)
  const visibleContacts = visibleContactIdSet(provFullNodes)
  const mapEntity = (e: {
    id: string
    type: string
    label: string
    dateMs: number | null
  }): LensCenter & { dateMs: number | null } => {
    // Reuse click-through enrichment by looking up the full node for ids.
    const full = store.getNode(e.id)
    const base = full ? nodeToDTO({ ...full, degree: 0 }, projects, visibleContacts) : { id: e.id, type: e.type, label: e.label, degree: 0 }
    return {
      id: base.id,
      type: base.type,
      label: base.label,
      contactId: base.contactId,
      meetingId: base.meetingId,
      projectId: base.projectId,
      dateMs: e.dateMs,
    }
  }

  // RE4-1 (round-4) — the round-3 residual (pathIds + narrative + dateMs came
  // from the UNFILTERED graph) leaked excluded NAMES via the label-derived
  // type:slug node ids and the narrative. Derive EVERYTHING solely from
  // survivors: keep only entities REACHABLE from the center via non-suppressed
  // edges (a node reachable only via an excluded edge is dropped even if it has
  // eligible edges elsewhere). pathIds rebuilt from survivors; narrative dropped
  // when anything was suppressed (it embeds excluded labels); dateMs recomputed
  // from the newest SURVIVING meeting.
  const survivors = exclusionIsNoop(exclusion)
    ? null // fast path — no suppression, keep the package result verbatim
    : centerReachableSurvivorIds(store, nodeId, 2, exclusion)
  const keep = (e: { id: string }): boolean => survivors === null || survivors.has(e.id)

  const meetings = prov.meetings.filter(keep)
  const people = prov.people.filter(keep)
  const projectsArr = prov.projects.filter(keep)
  const actions = prov.actions.filter(keep)
  const suppressedAny =
    survivors !== null &&
    (meetings.length !== prov.meetings.length ||
      people.length !== prov.people.length ||
      projectsArr.length !== prov.projects.length ||
      actions.length !== prov.actions.length)

  const pathIds =
    survivors === null
      ? prov.pathIds
      : [...new Set([nodeId, ...meetings, ...people, ...projectsArr, ...actions].map((x) => (typeof x === 'string' ? x : x.id)))]
  // Package sorts meetings newest-first; the newest SURVIVING meeting drives dateMs.
  const dateMs = survivors === null ? prov.dateMs : (meetings[0]?.dateMs ?? prov.node?.dateMs ?? null)
  const narrative = suppressedAny ? '' : prov.narrative

  return {
    node: prov.node ? mapEntity(prov.node) : null,
    meetings: meetings.map(mapEntity),
    people: people.map(mapEntity),
    projects: projectsArr.map(mapEntity),
    actions: actions.map(mapEntity),
    pathIds,
    narrative,
    dateMs,
  }
}

// ===========================================================================
// Node editing — rename-as-correction, convert/link to a contact, merge, remove
//
// The Context Graph's editing affordances. Graph surgery is delegated to the
// package's mutations; identity policy (routing a linked-person rename through
// the contact record, binding at the resolver's sovereign 'manual' tier, reusing
// the contacts merge journal) lives HERE and reuses the existing identity
// platform (entity-resolver / contact aliases / contacts merge) rather than
// duplicating it.
// ===========================================================================

/**
 * ADV30-2 (round-32) — is this contact currently VISIBLE on non-owner surfaces?
 * A person node can be visible via an eligible recording's edges while its BACKING
 * contact is SUPPRESSED (its own source recording excluded / hard-purged, or a keying
 * collision to an older suppressed same-name row). Non-owner graph surfaces must not
 * expose or mutate such a contact. Routed through the shared entity-visibility
 * boundary; FAIL-CLOSED (a lookup error ⇒ not visible).
 */
function isContactVisible(contactId: string): boolean {
  const { visible, failClosed } = filterVisibleEntityIds('contact', [contactId])
  return !failClosed && visible.has(contactId)
}

/** The contact id a person node is bound to: explicit prop, or its `contact:<id>` key. */
function contactIdOfNode(node: GraphNode): string | null {
  const props = parseProps(node.props)
  if (typeof props.contactId === 'string' && props.contactId) return props.contactId
  if (node.type === 'person' && node.norm_key.startsWith('contact:')) {
    return node.norm_key.slice('contact:'.length)
  }
  return null
}

/** Detail DTO for the node inspector — what a bare label cannot show. */
export interface NodeDetailDTO {
  node: LensCenter | null
  /** True when this person node is bound to a real, saved contact. */
  linked: boolean
  contactId: string | null
  /** Preferred pronouns (from the node's props), when set. */
  pronouns: string | null
  role: string | null
  company: string | null
  email: string | null
  meetingCount: number
  firstSeenMs: number | null
  lastSeenMs: number | null
  peopleCount: number
  projectCount: number
  degree: number
  /** Known spellings folded onto this identity (contact aliases). */
  aliases: string[]
  /** One-line provenance narrative — where this entity comes from. */
  narrative: string
}

/**
 * ADV31-3 (round-33) — the inspector's node STATISTICS derived from an
 * EXCLUSION-FILTERED one-hop subgraph. Package {@link nodeGraphStats} traverses
 * the RAW store, so its meeting/person/project counts, degree and first/last-seen
 * dates include personal/deleted/value-excluded (and legacy zero-provenance)
 * edges. getNodeDetail is a NON-OWNER surface: every statistic must derive from
 * ONLY the edges that survive the SAME provenance suppression the other Context
 * Graph reads use ({@link provenanceSuppressedEdgeIds}) and the neighbors still
 * reachable from the center via a surviving edge. Fail-closed: on a suppression
 * lookup failure the exclusion is failClosed ⇒ every attributed edge is
 * suppressed ⇒ minimal stats (never the raw store's numbers). Mirrors the
 * package's counting rules (degree = surviving incident edges; meeting dates from
 * surviving meeting neighbors) over the filtered survivor set.
 */
function exclusionFilteredNodeStats(
  store: KnowledgeGraphStore,
  nodeId: string,
  exclusion: GroundingExclusion
): NodeGraphStats {
  const empty: NodeGraphStats = {
    meetingCount: 0,
    firstSeenMs: null,
    lastSeenMs: null,
    peopleCount: 0,
    projectCount: 0,
    degree: 0,
  }
  const sub = neighborhood(store, nodeId, 1)
  if (!sub.center) return empty
  // No filtering to do (healthy + empty exclusion, or no edges) → mirror raw.
  const suppressed =
    sub.edges.length === 0
      ? new Set<string>()
      : provenanceSuppressedEdgeIds(store, sub.edges.map((e) => e.id), exclusion)

  // Neighbors still connected to the CENTER via a surviving (non-suppressed) edge,
  // and the center's surviving-incident degree.
  const survivingNeighbors = new Set<string>()
  let degree = 0
  for (const e of sub.edges) {
    if (suppressed.has(e.id)) continue
    if (e.source_id === nodeId || e.target_id === nodeId) {
      degree++
      const other = e.source_id === nodeId ? e.target_id : e.source_id
      if (other !== nodeId) survivingNeighbors.add(other)
    }
  }

  const byId = new Map(sub.nodes.map((n) => [n.id, n]))
  let meetingCount = 0
  let peopleCount = 0
  let projectCount = 0
  let firstSeenMs: number | null = null
  let lastSeenMs: number | null = null
  for (const id of survivingNeighbors) {
    const n = byId.get(id)
    if (!n) continue
    if (n.type === 'meeting') {
      meetingCount++
      const d = ownDateMs(n)
      if (d != null) {
        if (firstSeenMs == null || d < firstSeenMs) firstSeenMs = d
        if (lastSeenMs == null || d > lastSeenMs) lastSeenMs = d
      }
    } else if (n.type === 'person') {
      peopleCount++
    } else if (n.type === 'project') {
      projectCount++
    }
  }
  return { meetingCount, firstSeenMs, lastSeenMs, peopleCount, projectCount, degree }
}

/**
 * ADV31-3 / RE4-1 (round-33) — the inspector's one-line provenance narrative with
 * excluded-neighbor LABELS removed. Package {@link provenance} builds the narrative
 * from a RAW 2-hop neighborhood and embeds neighbor meeting/person labels; on this
 * NON-OWNER surface an excluded neighbor's name must not appear. Reuses the exact
 * queryProvenance (RE4-1) rule: derive the survivor set via
 * {@link centerReachableSurvivorIds} and DROP the narrative entirely when ANY
 * neighbor was suppressed (a partial narrative could still leak an excluded name).
 * Fail-closed: a failClosed exclusion suppresses every attributed neighbor.
 */
function provenanceSuppressedNarrative(
  store: KnowledgeGraphStore,
  nodeId: string,
  exclusion: GroundingExclusion
): string {
  const prov = provenance(store, nodeId)
  if (exclusionIsNoop(exclusion)) return prov.narrative
  const survivors = centerReachableSurvivorIds(store, nodeId, 2, exclusion)
  const keep = (e: { id: string }): boolean => survivors.has(e.id)
  const suppressedAny =
    prov.meetings.some((m) => !keep(m)) ||
    prov.people.some((p) => !keep(p)) ||
    prov.projects.some((p) => !keep(p)) ||
    prov.actions.some((a) => !keep(a))
  return suppressedAny ? '' : prov.narrative
}

/**
 * Everything the inspector needs to answer "what IS this node?": identity
 * (linked contact vs. raw extracted name), the contact's role/org/email + known
 * aliases when linked, pronouns, graph-derived stats (meetings, first/last seen,
 * neighborhood), and the provenance narrative. Accepts any id form.
 */
export function getNodeDetail(entityId: string): NodeDetailDTO {
  const store = getKnowledgeGraphStore()
  const empty: NodeDetailDTO = {
    node: null,
    linked: false,
    contactId: null,
    pronouns: null,
    role: null,
    company: null,
    email: null,
    meetingCount: 0,
    firstSeenMs: null,
    lastSeenMs: null,
    peopleCount: 0,
    projectCount: 0,
    degree: 0,
    aliases: [],
    narrative: '',
  }
  const nodeId = resolveEntityToNodeId(entityId)
  if (!nodeId) return empty
  const node = store.getNode(nodeId)
  if (!node) return empty
  // P3 (round-3) — the inspector must not expose an excluded-only node.
  // ADV23-2 — non-owner surface: legacy zero-provenance nodes are excluded-only.
  // ADV31-3 (round-33) — compute the exclusion ONCE and reuse it for the node
  // visibility gate AND the exclusion-filtered statistics below.
  const exclusion = getGroundingExclusionSet(true)
  if (!isNodeVisibleUnderExclusion(store, nodeId, exclusion)) return empty

  const projects = projectNameIndex()
  // ADV32-1 (round-34): the shared nodeToDTO now sanitizes contactId through the
  // fail-closed visibleContactIdSet, so the DTO no longer carries a suppressed id.
  const dto = nodeToDTO({ ...node, degree: 0 }, projects, visibleContactIdSet([node]))
  // ADV30-2 (round-32): defence-in-depth — the inspector re-derives contactId below
  // under isContactVisible (which also covers the `contact:<id>` node key, not just
  // props.contactId), so clear any prop-derived value first. Harmless when the
  // shared mapper already omitted it.
  if (dto.contactId) dto.contactId = undefined
  const props = parseProps(node.props)
  const pronouns = typeof props.pronouns === 'string' && props.pronouns ? props.pronouns : null

  // ADV30-2 (round-32): the node can be visible via an eligible recording's edges
  // (passed isNodeVisibleUnderExclusion above) while its BACKING contact is SUPPRESSED
  // on non-owner surfaces (own source recording excluded / hard-purged, or a keying
  // collision to an older suppressed same-name row). Gate the contact id through the
  // shared entity-visibility boundary (fail-closed): when suppressed, expose NEITHER
  // contactId NOR any contact-derived field (company/email/role/aliases).
  const rawContactId = contactIdOfNode(node)
  const contactId = rawContactId && isContactVisible(rawContactId) ? rawContactId : null
  let role: string | null = null
  let company: string | null = null
  let email: string | null = null
  let aliases: string[] = []
  const linked = node.type === 'person' && !!contactId
  if (contactId) {
    const contact = getContactById(contactId)
    if (contact) {
      // ADV29-2 (round-31) — graph inspector is a NON-OWNER surface: blank a
      // transcript-enriched role whose source recording is ineligible (fail-closed),
      // even though the node/contact stays visible via an eligible recording.
      const [safe] = blankIneligibleContactFields([contact])
      role = safe.role
      company = safe.company
      email = safe.email
      dto.contactId = contactId
    }
    try {
      aliases = getContactAliases(contactId)
        .filter((a) => a.source !== 'rejected')
        .map((a) => a.alias)
    } catch {
      aliases = []
    }
  }

  // ADV31-3 (round-33): inspector statistics from an EXCLUSION-FILTERED one-hop
  // subgraph — NOT the raw store (nodeGraphStats), which would count excluded
  // (personal/deleted/value-excluded/legacy-zero-provenance) neighbors and edges.
  const stats = exclusionFilteredNodeStats(store, nodeId, exclusion)
  let narrative = ''
  try {
    // RE4-1 / ADV31-3 (round-33): the narrative embeds neighbor meeting/person
    // LABELS. Derive it from the SAME exclusion-suppressed subgraph the stats use,
    // so an excluded neighbor's name never reaches this non-owner surface. When the
    // node has no surviving neighbor evidence, emit no narrative.
    narrative = provenanceSuppressedNarrative(store, nodeId, exclusion)
  } catch {
    narrative = ''
  }

  return {
    node: { id: dto.id, type: dto.type, label: dto.label, contactId: dto.contactId, meetingId: dto.meetingId, projectId: dto.projectId },
    linked,
    contactId: contactId ?? null,
    pronouns,
    role,
    company,
    email,
    meetingCount: stats.meetingCount,
    firstSeenMs: stats.firstSeenMs,
    lastSeenMs: stats.lastSeenMs,
    peopleCount: stats.peopleCount,
    projectCount: stats.projectCount,
    degree: stats.degree,
    aliases,
    narrative,
  }
}

export interface RenameEntityResult {
  outcome: 'noop' | 'renamed' | 'merged'
  /** 'contact' when the rename propagated through the contact record app-wide;
   *  'graph' when it was a graph-only correction of a name-only node. */
  scope: 'contact' | 'graph'
  nodeId: string | null
}

/**
 * Correct an entity's name (Jiarabi → Yaraví). NOT an alias — a canonical rename.
 * A linked person is renamed through its CONTACT record (updateContact + the
 * entity:contact-changed event), so the correction propagates everywhere the app
 * uses that contact. A name-only node is corrected directly in the graph (rename,
 * or fold into an existing node already under the correct spelling).
 */
export function renameGraphEntity(entityId: string, newLabel: string): RenameEntityResult {
  const store = getKnowledgeGraphStore()
  const label = (newLabel || '').trim()
  const nodeId = resolveEntityToNodeId(entityId)
  if (!nodeId || !label) return { outcome: 'noop', scope: 'graph', nodeId: nodeId ?? null }
  const node = store.getNode(nodeId)
  if (!node) return { outcome: 'noop', scope: 'graph', nodeId: null }

  // ADV33-2 (round-35): execution-time NODE-visibility recheck (TOCTOU). Refuse a
  // rename of a node that became personal / deleted / value-excluded / hard-purged /
  // zero-provenance AFTER the inspector loaded — a contact-scoped rename would emit
  // entity:contact-changed and re-expose a now-hidden node's identity everywhere.
  // Fail-closed no-op. ONE exclusion snapshot drives this guard AND the implicit
  // collision-keeper guard below so they are consistent (ADV34-3).
  const exclusion = getGroundingExclusionSet(true)
  if (!isNodeMutable(store, nodeId, node, exclusion)) return { outcome: 'noop', scope: 'graph', nodeId }

  const contactId = contactIdOfNode(node)
  if (node.type === 'person' && contactId) {
    // ADV30-2 (round-32): refuse a contact-scoped rename when the backing contact is
    // SUPPRESSED on non-owner surfaces — renaming through updateContact + the
    // contact-changed event would mutate/re-expose a hidden excluded contact from a
    // non-owner graph action. Fail-closed no-op.
    if (!isContactVisible(contactId)) {
      return { outcome: 'noop', scope: 'contact', nodeId }
    }
    const contact = getContactById(contactId)
    if (contact) {
      const oldName = contact.name
      if (normalizeGraphLabel(oldName) === normalizeGraphLabel(label)) {
        return { outcome: 'noop', scope: 'contact', nodeId }
      }
      // ADV54-1 (round-56): a contact-scoped rename is a CROSS-LAYER composite — the
      // RELATIONAL contacts.name update PLUS the display-only GRAPH graph_nodes.label
      // refresh. Run as separate auto-commits, a graph-phase failure left the contact
      // renamed while the graph node kept the stale label — relational/graph identity
      // diverge. Wrap BOTH writes in ONE re-entrant runInTransaction so they roll back
      // together, and emit entity:contact-changed only AFTER the commit so listeners
      // never observe a rename that rolled back.
      runInTransaction(() => {
        updateContact(contactId, { name: label })
        // The contact-keyed graph node's label is display-only (its key stays
        // contact:<id>); refresh it in place so the graph shows the correction now.
        run('UPDATE graph_nodes SET label = ?, updated_at = ? WHERE id = ?', [
          label,
          new Date().toISOString(),
          nodeId,
        ])
      })
      try {
        getEventBus().emitDomainEvent({
          type: 'entity:contact-changed',
          timestamp: new Date().toISOString(),
          payload: { contactId, change: 'updated', oldName, newName: label },
        })
      } catch (e) {
        console.warn('[knowledge-graph] rename contact-changed emit failed:', e)
      }
      return { outcome: 'renamed', scope: 'contact', nodeId }
    }
  }

  // ADV34-3 (round-36): a graph-only rename runs through the package's renameNode,
  // which SILENTLY MERGES this node into an existing same-(type, norm_key) node when
  // the new label collides — folding the VISIBLE source's edges into that keeper and
  // DELETING the source. Round-35 validated only the requested node. Resolve the
  // implicit collision keeper and require it to pass merge-eligibility under the SAME
  // exclusion snapshot; if the keeper is excluded-only / hidden (or the lookup fails),
  // REFUSE before any graph change so a stale rename cannot fold a visible source into
  // a suppressed keeper.
  const newKey = normalizeGraphLabel(label)
  if (newKey !== node.norm_key) {
    const keeper = store.db.queryOne<{ id: string }>(
      'SELECT id FROM graph_nodes WHERE type = ? AND norm_key = ? AND id != ?',
      [node.type, newKey, nodeId]
    )
    if (keeper && !isNodeMergeEligible(store, keeper.id, store.getNode(keeper.id), exclusion)) {
      return { outcome: 'noop', scope: 'graph', nodeId }
    }
  }

  const res = renameNode(store, nodeId, label)
  return { outcome: res.outcome, scope: 'graph', nodeId: res.nodeId }
}

/** normalizeName lives app-side; a local copy matching the graph key rule. */
function normalizeGraphLabel(label: string): string {
  return (label || '').toLowerCase().trim().replace(/\s+/g, ' ')
}

/**
 * Bind a graph node to a contact at the resolver's sovereign 'manual' tier: write
 * a manual alias (so future extractions of this spelling resolve to the contact)
 * and re-key the node onto the contact identity — folding it into an existing
 * contact-keyed node when one already exists.
 */
function bindNodeToContact(nodeId: string, contactId: string): { outcome: 'linked' | 'merged'; nodeId: string } {
  const store = getKnowledgeGraphStore()
  const node = store.getNode(nodeId)
  if (!node) return { outcome: 'linked', nodeId }
  const canonicalName = getContactById(contactId)?.name ?? node.label

  const contactKey = `contact:${contactId}`
  const keeper = queryOne<{ id: string }>(
    "SELECT id FROM graph_nodes WHERE type = 'person' AND norm_key = ?",
    [contactKey]
  )

  // ADV34-3 (round-36): when a contact-keyed node ALREADY carries this identity,
  // the bind SILENTLY MERGES the source into that keeper (repoints its edges,
  // deletes the visible source). Round-35's execution-time guard covered only the
  // explicit source. Resolve the IMPLICIT keeper and require BOTH the source and
  // the keeper to pass the SAME merge-eligibility check under ONE current exclusion
  // snapshot BEFORE any alias write or graph change: if the keeper is excluded-only /
  // hidden (or the visibility lookup fails), REFUSE with NO state mutation — a stale
  // bind must never fold a visible source into a suppressed keeper.
  const exclusion = getGroundingExclusionSet(true)
  if (!isNodeMutable(store, nodeId, node, exclusion)) {
    throw new Error('Node not available')
  }
  if (keeper && keeper.id !== nodeId) {
    if (!isNodeMergeEligible(store, keeper.id, store.getNode(keeper.id), exclusion)) {
      throw new Error('Node not available')
    }
  }

  // ADV54-1 (round-56): the manual bind is a CROSS-LAYER composite — a RELATIONAL
  // contact_aliases write (upsertContactAlias) PLUS GRAPH re-key/merge (mergeNodes /
  // graph_nodes UPDATE / setNodeProps). Round-35..55 ran these as SEPARATE
  // auto-commits, so a graph-phase failure (DB I/O, schema, statement error) left the
  // sovereign manual alias committed while the caller reported failure — the resolver
  // would then link this spelling through a bind the app NEVER completed, corrupting
  // identity provenance. Wrap the whole mutation in ONE re-entrant runInTransaction
  // (upsertContactAlias/run/mergeNodes/setNodeProps all write through the SAME engine)
  // so the alias and the graph rekey roll back together. The alias write NO LONGER
  // swallows failures — a swallowed alias error would defeat the atomicity (the graph
  // would rekey without the resolver alias); let it propagate to trigger the rollback.
  return runInTransaction(() => {
    // Sovereign manual bind so the resolver links this spelling from now on.
    upsertContactAlias(contactId, node.label, 'manual', 1.0)

    const now = new Date().toISOString()

    if (keeper && keeper.id !== nodeId) {
      mergeNodes(store, keeper.id, nodeId)
      run('UPDATE graph_nodes SET label = ?, updated_at = ? WHERE id = ?', [canonicalName, now, keeper.id])
      setNodeProps(store, keeper.id, { contactId })
      return { outcome: 'merged' as const, nodeId: keeper.id }
    }

    run('UPDATE graph_nodes SET norm_key = ?, label = ?, updated_at = ? WHERE id = ?', [
      contactKey,
      canonicalName,
      now,
      nodeId,
    ])
    setNodeProps(store, nodeId, { contactId })
    return { outcome: 'linked' as const, nodeId }
  })
}

export interface LinkContactResult {
  contactId: string
  outcome: 'linked' | 'merged'
  nodeId: string
  /** True when an existing contact was reused instead of a new one being created. */
  reusedExisting?: boolean
}

/**
 * "This node IS person X." Bind an extracted person node to an existing contact
 * (manual/sovereign tier). Reuses the contacts identity platform — no new store.
 */
export function linkNodeToContact(entityId: string, contactId: string): LinkContactResult {
  const store = getKnowledgeGraphStore()
  const nodeId = resolveEntityToNodeId(entityId)
  if (!nodeId) throw new Error('Node not found')
  const node = store.getNode(nodeId)
  if (!node) throw new Error('Node not found')
  // ADV33-2 (round-35): execution-time NODE-visibility recheck (TOCTOU). Refuse
  // binding a node that became personal / deleted / value-excluded / hard-purged /
  // zero-provenance AFTER the inspector loaded — the bind writes a manual alias +
  // re-keys the node onto the contact identity, re-exposing a now-hidden node.
  // Fail-closed refusal BEFORE the target-contact visibility check.
  if (!isNodeMutable(store, nodeId, node)) throw new Error('Node not available')
  const contact = getContactById(contactId)
  if (!contact) throw new Error('Contact not found')
  // ADV30-2 (round-32): refuse binding a (visible) graph node to a SUPPRESSED contact.
  // The bind writes a manual alias + re-keys the node onto the contact identity,
  // which makes the hidden excluded contact graph-visible and exposes its fields.
  // Fail-closed refusal.
  if (!isContactVisible(contactId)) throw new Error('Contact not available')
  const r = bindNodeToContact(nodeId, contactId)
  return { contactId, outcome: r.outcome, nodeId: r.nodeId }
}

/**
 * Convert a name-only person node into a real contact: create the contact (or
 * reuse an exact-name match), then bind the node at the sovereign manual tier.
 * This is the fix for "there is no contact behind Jiarabi today."
 */
export function convertNodeToContact(
  entityId: string,
  opts?: { role?: string | null; company?: string | null; email?: string | null }
): LinkContactResult {
  const store = getKnowledgeGraphStore()
  const nodeId = resolveEntityToNodeId(entityId)
  if (!nodeId) throw new Error('Node not found')
  const node = store.getNode(nodeId)
  if (!node) throw new Error('Node not found')
  if (node.type !== 'person') throw new Error('Only person nodes can become contacts')

  // ADV33-2 (round-35): execution-time NODE-visibility recheck (TOCTOU). The
  // inspector may have loaded this node while it was visible, but by the time the
  // user clicks "convert" the node's source recording could have become
  // personal / deleted / value-excluded / hard-purged (all its edges now suppressed).
  // Converting a now-HIDDEN node would mint a source='user' contact that is ALWAYS
  // visible — permanently laundering excluded-derived identity. Refuse fail-closed
  // (missing node or fail-closed exclusion lookup ⇒ refuse) BEFORE any create/bind.
  if (!isNodeMutable(store, nodeId, node)) throw new Error('Node not available')

  const existingContactId = contactIdOfNode(node)
  // ADV31-1 (round-33): only REUSE the node's existing backing contact when it is
  // VISIBLE. A node can be graph-visible via an eligible recording's edges while its
  // backing contact is SUPPRESSED (own source excluded / hard-purged, or a keying
  // collision to an older suppressed same-name row). Returning it here would expose
  // the suppressed id AND skip creating the promised fresh visible contact. When the
  // binding is suppressed, IGNORE it and fall through to the visible-only exact-name
  // logic below, which creates/binds a FRESH VISIBLE contact (bindNodeToContact
  // re-keys the node off the suppressed identity). Fail-closed: isContactVisible
  // treats a lookup error as not-visible.
  if (existingContactId && getContactById(existingContactId) && isContactVisible(existingContactId)) {
    // Already a VISIBLE contact — nothing to create; treat as a no-op link.
    return { contactId: existingContactId, outcome: 'linked', nodeId, reusedExisting: true }
  }

  // Reuse an exact-name contact rather than minting a twin — but only a VISIBLE one.
  // ADV30-2 (round-32): a SUPPRESSED same-name contact must not be reused/re-exposed
  // by binding a visible node to it; fall through to create a fresh (visible) contact.
  const existing = getContactByName(node.label)
  if (existing && isContactVisible(existing.id)) {
    const r = bindNodeToContact(nodeId, existing.id)
    return { contactId: existing.id, outcome: r.outcome, nodeId: r.nodeId, reusedExisting: true }
  }

  // contacts.type is CHECK-constrained: team|candidate|customer|external|unknown.
  // An extracted person is an 'external' contact.
  // ADV54-1 (round-56): fresh-create is a CROSS-LAYER composite — createContact
  // commits an always-visible source='user' contact (RELATIONAL) and bindNodeToContact
  // then writes the manual alias + re-keys/merges the GRAPH node. Run separately, a
  // graph-phase failure inside bindNodeToContact propagated as failure to the IPC but
  // left the always-visible contact (and possibly its manual alias) persisted — future
  // extraction would resolve through a conversion the app reported as FAILED, laundering
  // identity provenance. Wrap create+bind in ONE outer runInTransaction; bindNodeToContact's
  // own runInTransaction is RE-ENTRANT and JOINS this one, so a throw anywhere rolls the
  // contact create back too. Eligibility/visibility guards stay BEFORE the transaction.
  return runInTransaction(() => {
    const contact = createContact({
      name: node.label,
      type: 'external',
      role: opts?.role ?? null,
      company: opts?.company ?? null,
      email: opts?.email ?? null,
    })
    const r = bindNodeToContact(nodeId, contact.id)
    return { contactId: contact.id, outcome: r.outcome, nodeId: r.nodeId, reusedExisting: false }
  })
}

/** Set (or clear, with '') a person node's pronouns. Stored on the node props. */
export function setNodePronouns(entityId: string, pronouns: string): boolean {
  const store = getKnowledgeGraphStore()
  const nodeId = resolveEntityToNodeId(entityId)
  if (!nodeId) return false
  // ADV33-2 (round-35): execution-time NODE-visibility recheck (TOCTOU). Refuse
  // mutating props on a node that became personal / deleted / value-excluded /
  // hard-purged / zero-provenance AFTER the inspector loaded. Fail-closed no-op.
  const node = store.getNode(nodeId)
  if (!isNodeMutable(store, nodeId, node)) return false
  const value = (pronouns || '').trim()
  return setNodeProps(store, nodeId, { pronouns: value ? value : null })
}

export interface MergePreviewDTO {
  a: { id: string; label: string; type: string; edges: number } | null
  b: { id: string; label: string; type: string; edges: number } | null
  shared: number
  resulting: number
  /** True when BOTH nodes are linked contacts — the merge folds contacts (undoable). */
  contactMerge: boolean
  /** Contact link counts for a contact-merge, so the UI can gate a heavy merge. */
  contactImpact?: { keeper: number; loser: number }
  /**
   * ADV32-2 (round-34) — true when the preview is REFUSED because a node is not
   * visible under exclusion or its backing contact is suppressed on this non-owner
   * surface (mirrors {@link mergeGraphNodes}' refusal). No labels/counts are
   * exposed when blocked, and the commit will refuse too.
   */
  blocked?: boolean
}

/**
 * ADV33-2 (round-35) — the SHARED execution-time NODE-visibility guard for EVERY
 * point graph mutation (convert / rename / link / pronouns / merge). At EXECUTION
 * time — NOT inspector-load time — the target node must still be VISIBLE under the
 * CURRENT exclusion set: a node that became personal / deleted / value-excluded /
 * hard-purged, or whose incident edges are now ALL provenance-suppressed / legacy
 * zero-provenance, is NOT mutable. This closes the TOCTOU where a stale mutation
 * (worst case: convertNodeToContact minting an always-visible source='user' contact)
 * could promote, rename, re-bind, or fold a now-HIDDEN node and thereby launder
 * excluded-derived identity. Fail-closed: a missing node OR a fail-closed exclusion
 * lookup ⇒ NOT mutable (refuse; no state change). Backing-CONTACT visibility is
 * mutation-specific (convert's fall-through-to-fresh, rename's contact path, link's
 * target, merge's both nodes) and enforced at each call site / by isNodeMergeEligible.
 */
function isNodeMutable(
  store: KnowledgeGraphStore,
  nodeId: string,
  node: GraphNode | undefined,
  exclusion: GroundingExclusion = getGroundingExclusionSet(true)
): boolean {
  if (!node) return false
  if (exclusion.failClosed) return false
  return isNodeVisibleUnderExclusion(store, nodeId, exclusion)
}

/**
 * ADV31-2 / ADV32-2 (round-34) — merge eligibility for a node on a NON-OWNER
 * surface, SHARED by {@link mergeGraphPreview} and {@link mergeGraphNodes} so the
 * preview and the commit AGREE. Builds on the shared {@link isNodeMutable}
 * execution-time NODE-visibility guard and additionally requires that, when the node
 * is contact-backed, its BACKING contact is visible (merge folds edges into a
 * contact-keyed keeper / calls mergeContacts, so a suppressed backing contact must
 * refuse the whole merge). Fail-closed: a missing node, an excluded-only node, a
 * suppressed backing contact, or a visibility-lookup failure ⇒ NOT eligible.
 */
function isNodeMergeEligible(
  store: KnowledgeGraphStore,
  nodeId: string,
  node: GraphNode | undefined,
  exclusion: GroundingExclusion
): boolean {
  if (!isNodeMutable(store, nodeId, node, exclusion)) return false
  if (!node) return false // narrowing (isNodeMutable already refused a missing node)
  const contact = contactIdOfNode(node)
  if (contact && !isContactVisible(contact)) return false
  return true
}

/**
 * ADV32-2 (round-34) — the merge blast radius computed over ONLY the edges that
 * SURVIVE provenance suppression, so a non-owner preview's per-node edge counts,
 * shared count and resulting count never include personal / deleted / value-excluded
 * or legacy zero-provenance edges. Mirrors the package's mergeBlastRadius counting
 * (neighbor-relative keys; a↔b relations collapse to self-loops and are dropped) but
 * filters suppressed edges FIRST. Used only when exclusions are active; the healthy
 * fast path keeps calling the package primitive.
 */
function exclusionFilteredBlastRadius(
  store: KnowledgeGraphStore,
  keeperId: string,
  loserId: string,
  exclusion: GroundingExclusion
): Pick<MergePreviewDTO, 'a' | 'b' | 'shared' | 'resulting'> {
  const keeper = store.getNode(keeperId)
  const loser = store.getNode(loserId)
  const survivingKeys = (nodeId: string): Set<string> => {
    const rows = store.db.queryAll<{ id: string; source_id: string; target_id: string; type: string }>(
      'SELECT id, source_id, target_id, type FROM graph_edges WHERE source_id = ? OR target_id = ?',
      [nodeId, nodeId]
    )
    const suppressed =
      rows.length === 0 ? new Set<string>() : provenanceSuppressedEdgeIds(store, rows.map((r) => r.id), exclusion)
    const keys = new Set<string>()
    for (const r of rows) {
      if (suppressed.has(r.id)) continue
      if (r.source_id === nodeId) keys.add(`out:${r.type}:${r.target_id}`)
      if (r.target_id === nodeId) keys.add(`in:${r.type}:${r.source_id}`)
    }
    return keys
  }
  const aKeys = keeper ? survivingKeys(keeperId) : new Set<string>()
  const bKeys = loser ? survivingKeys(loserId) : new Set<string>()
  let shared = 0
  const union = new Set<string>(aKeys)
  for (const k of bKeys) {
    if (aKeys.has(k)) shared++
    union.add(k)
  }
  let selfLoops = 0
  for (const k of union) if (k.endsWith(`:${keeperId}`) || k.endsWith(`:${loserId}`)) selfLoops++
  const resulting = Math.max(0, union.size - selfLoops)
  const toBlast = (n: GraphNode | undefined, keys: Set<string>) =>
    n ? { id: n.id, label: n.label, type: n.type, edges: keys.size } : null
  return { a: toBlast(keeper, aKeys), b: toBlast(loser, bKeys), shared, resulting }
}

/** Preview merging two nodes: the blast radius (what collapses) BEFORE committing. */
export function mergeGraphPreview(keeperEntityId: string, loserEntityId: string): MergePreviewDTO {
  const store = getKnowledgeGraphStore()
  const keeperId = resolveEntityToNodeId(keeperEntityId)
  const loserId = resolveEntityToNodeId(loserEntityId)
  if (!keeperId || !loserId) {
    return { a: null, b: null, shared: 0, resulting: 0, contactMerge: false }
  }
  const keeperNode = store.getNode(keeperId)
  const loserNode = store.getNode(loserId)
  // ADV32-2 (round-34): the preview is a NON-OWNER surface and must MATCH the
  // commit. mergeBlastRadius runs over the RAW graph, so previously the labels +
  // per-node edge counts + shared/resulting counts included EXCLUDED and legacy
  // zero-provenance edges, and an excluded-only / suppressed-contact node was still
  // previewable even though mergeGraphNodes REFUSES it. Refuse fail-closed here
  // under the SAME shared eligibility check the commit uses (node visible under
  // exclusion AND backing contact visible) so no raw label/count for a blocked
  // merge reaches the display.
  const exclusion = getGroundingExclusionSet(true)
  if (
    !isNodeMergeEligible(store, keeperId, keeperNode, exclusion) ||
    !isNodeMergeEligible(store, loserId, loserNode, exclusion)
  ) {
    return { a: null, b: null, shared: 0, resulting: 0, contactMerge: false, blocked: true }
  }
  // Both nodes + backing contacts are visible — compute the blast radius from
  // SURVIVING edges only so excluded relations don't inflate the counts (the
  // package primitive is safe on the healthy fast path with no active exclusions).
  const blast = exclusionIsNoop(exclusion)
    ? mergeBlastRadius(store, keeperId, loserId)
    : exclusionFilteredBlastRadius(store, keeperId, loserId, exclusion)
  const keeperContact = keeperNode ? contactIdOfNode(keeperNode) : null
  const loserContact = loserNode ? contactIdOfNode(loserNode) : null
  // Both backing contacts are already proven VISIBLE by isNodeMergeEligible above,
  // so a distinct pair is a genuine (undoable) contact merge.
  const contactMerge = !!keeperContact && !!loserContact && keeperContact !== loserContact
  let contactImpact: { keeper: number; loser: number } | undefined
  if (contactMerge && keeperContact && loserContact) {
    try {
      contactImpact = getMergeImpact('contact', keeperContact, loserContact)
    } catch {
      contactImpact = undefined
    }
  }
  return { a: blast.a, b: blast.b, shared: blast.shared, resulting: blast.resulting, contactMerge, contactImpact }
}

export interface MergeNodesResultDTO {
  keeperId: string
  movedEdges: number
  /** 'contact' when the underlying contacts were merged (journaled, undoable);
   *  'graph' when only the graph nodes were folded. */
  path: 'contact' | 'graph'
}

/**
 * Merge the LOSER node into the KEEPER. When both are linked contacts, the
 * contacts are merged through the existing journaled contacts flow (undoable),
 * then their graph nodes are folded. Otherwise the graph nodes are folded directly.
 */
export function mergeGraphNodes(keeperEntityId: string, loserEntityId: string): MergeNodesResultDTO {
  const store = getKnowledgeGraphStore()
  const keeperId = resolveEntityToNodeId(keeperEntityId)
  const loserId = resolveEntityToNodeId(loserEntityId)
  if (!keeperId || !loserId) throw new Error('Node not found')
  if (keeperId === loserId) throw new Error('Cannot merge a node into itself')

  const keeperNode = store.getNode(keeperId)
  const loserNode = store.getNode(loserId)

  // ADV31-2 (round-33) + ADV32-2 (round-34): REFUSE the ENTIRE merge fail-closed
  // whenever EITHER node is not visible under exclusion OR its backing contact is
  // SUPPRESSED — the SAME shared eligibility check mergeGraphPreview enforces, so
  // preview and commit AGREE. The round-32 code merely skipped the journaled
  // mergeContacts but still FELL THROUGH to an unconditional graph-only mergeNodes —
  // which deletes the loser node and folds ALL its edges (incl. EXCLUDED provenance)
  // into the keeper. From a non-owner surface that destructively mutates
  // suppressed-contact-backed / excluded-only graph state, and if the excluded
  // recording is later restored its facts reappear under the WRONG identity.
  // Fail-closed: a missing/excluded-only node or a visibility-lookup failure ⇒ no
  // node or edge changes.
  const exclusion = getGroundingExclusionSet(true)
  if (!isNodeMergeEligible(store, keeperId, keeperNode, exclusion)) {
    throw new Error('Node not available')
  }
  if (!isNodeMergeEligible(store, loserId, loserNode, exclusion)) {
    throw new Error('Node not available')
  }

  const keeperContact = keeperNode ? contactIdOfNode(keeperNode) : null
  const loserContact = loserNode ? contactIdOfNode(loserNode) : null

  if (keeperContact && loserContact && keeperContact !== loserContact) {
    // Both backing contacts are VISIBLE (checked above) — real, journaled contacts
    // merge (undoable), then fold the graph nodes. Both graph nodes are known
    // present + eligible here (keeperId/loserId came FROM the store and passed the
    // guards above), so the shared cross-layer core ALWAYS folds them.
    //
    // ADV53-1 (round-55): the composite must be CROSS-LAYER failure-atomic. The
    // relational merge (rows + undo-journal) and the graph fold share ONE rollback
    // boundary via mergeContactsFoldingNodes's runInTransaction (see there for the
    // re-entrancy contract). ADV55-1 (round-57): factored into that shared core so the
    // People-UI / reconciler contact-id entry point (mergeContactsWithGraph) gets the
    // SAME atomic fold instead of depending on the post-commit name event.
    const { movedEdges } = mergeContactsFoldingNodes(keeperContact, loserContact, keeperId, loserId)
    return { keeperId, movedEdges, path: 'contact' as const }
  }

  const r = mergeNodes(store, keeperId, loserId)
  return { keeperId: r.keeperId, movedEdges: r.movedEdges, path: 'graph' }
}

/**
 * Resolve a CONTACT id to its backing person NODE id, the way the merge/rekey code
 * keys contact nodes: the canonical `contact:<id>` norm_key first (what
 * rekeyExistingPersonNodes + bindNodeToContact look up), then a legacy person node
 * still carrying the id only in props.contactId. Returns null when the contact has
 * no backing person node yet — the graph fold is then a no-op (the contact merge
 * still proceeds atomically). Name-only legacy nodes (norm_key = a name, no
 * contactId prop) intentionally do NOT resolve here; those are folded by graph-sync's
 * post-commit name-event fallback, which resolves by normalized name.
 */
function resolveContactToNodeId(contactId: string): string | null {
  const store = getKnowledgeGraphStore()
  const db = store.db
  const byKey = db.queryOne<{ id: string }>(
    "SELECT id FROM graph_nodes WHERE type = 'person' AND norm_key = ?",
    [`contact:${contactId}`]
  )
  if (byKey) return byKey.id
  const byProp = db.queryOne<{ id: string }>(
    "SELECT id FROM graph_nodes WHERE type = 'person' AND JSON_EXTRACT(props, '$.contactId') = ?",
    [contactId]
  )
  return byProp?.id ?? null
}

/**
 * Cross-layer atomic core: merge the relational CONTACTS (journaled, undoable) AND
 * fold their backing person NODES in ONE re-entrant runInTransaction, so a throw in
 * either phase rolls BOTH back (a single rollback boundary). mergeContacts's inner
 * runInTransaction and mergeNodes's runInGraphTransaction (→ graphDbAdapter
 * .runInTransaction → engine.runInTransaction) are RE-ENTRANT: with a transaction
 * already open they JOIN it (no illegal nested BEGIN) and defer to the outer
 * COMMIT/ROLLBACK.
 *
 * The node fold runs only when BOTH contacts resolve to DISTINCT person nodes; a
 * contact with no backing node (or a still-name-keyed legacy node) folds as a no-op
 * and the contact merge still commits — unlike the inspector path, which starts FROM
 * nodes and refuses a missing one.
 *
 * Event timing (ADV55-1 / round-57): mergeContacts emits `entity:contact-changed`
 * AFTER its inner (joined) transaction returns but BEFORE this outer COMMIT, and the
 * EventEmitter dispatch is synchronous — so graph-sync's `merged` handler runs
 * mid-transaction. That handler resolves nodes by NORMALIZED NAME, so for
 * contact-keyed nodes (norm_key `contact:<id>`) it finds nothing and no-ops; the
 * authoritative fold is THIS in-transaction mergeNodes. For legacy name-keyed nodes
 * the handler performs the (now same-transaction) fold and resolveContactToNodeId
 * returns null here, so there is no double-fold. The event is still emitted for its
 * other subscribers (rag reindex, UI refresh).
 */
function mergeContactsFoldingNodes(
  keeperContactId: string,
  loserContactId: string,
  keeperNodeId: string | null,
  loserNodeId: string | null
): { contact: Contact; movedEdges: number } {
  const store = getKnowledgeGraphStore()
  const doFold = !!(keeperNodeId && loserNodeId && keeperNodeId !== loserNodeId)
  return runInTransaction(() => {
    // Capture the journal ids BEFORE the merge so we can find the row it writes.
    const journalsBefore = doFold ? mergeJournalIdsFor('contact', keeperContactId) : null
    const contact = mergeContacts(keeperContactId, loserContactId)
    let movedEdges = 0
    if (doFold) {
      // ADV56-2 (round-58): snapshot the loser's pre-fold subgraph so unmerge can reverse
      // the fold EXACTLY, then patch it into the journal row mergeContacts just wrote.
      const snapshot = captureLoserSubgraph(loserNodeId!, keeperNodeId!)
      // Resolve AFTER the contact merge is harmless: the loser's GRAPH node persists
      // (only its contact ROW was deleted), so its `contact:<id>` key still folds.
      const r = mergeNodes(store, keeperNodeId!, loserNodeId!)
      movedEdges = r.movedEdges
      const journalsAfter = mergeJournalIdsFor('contact', keeperContactId)
      const newId = [...journalsAfter].find((jid) => !journalsBefore!.has(jid))
      if (newId) attachGraphSnapshotToJournal(newId, snapshot)
    }
    return { contact, movedEdges }
  })
}

/**
 * People-UI + reconciler entry point (ADV55-1 / round-57): merge two CONTACTS by id
 * AND fold their backing graph person nodes ATOMICALLY. Resolves each contact to its
 * `contact:<id>` node (see resolveContactToNodeId) and shares mergeContactsFoldingNodes
 * with mergeGraphNodes' contact branch, so the loser's graph node, edges, and
 * graph_edge_sources provenance are repointed onto the keeper inside the same
 * transaction as the relational merge — no longer stranded under the deleted loser
 * contact id and no longer dependent on the best-effort post-commit name event
 * (which no-ops for contact-keyed nodes and is skipped when graph sync is disabled).
 *
 * Callers must apply their own visibility/eligibility gates on BOTH ids first (the
 * contacts:merge IPC's fail-closed boundary; the org-reconciler dedup partition).
 */
export function mergeContactsWithGraph(keeperContactId: string, loserContactId: string): Contact {
  const keeperNodeId = resolveContactToNodeId(keeperContactId)
  const loserNodeId = resolveContactToNodeId(loserContactId)
  return mergeContactsFoldingNodes(keeperContactId, loserContactId, keeperNodeId, loserNodeId).contact
}

/**
 * Resolve a PROJECT id to its backing graph project NODE id. Project nodes are
 * NAME-KEYED (unlike person nodes, which carry `contact:<id>`): the graph keys a
 * project node by its normalized name (`type='project' AND norm_key = normalize(name)`
 * — see resolveEntityToNodeId step 4 and the graph key rule normalizeGraphLabel).
 * Returns null when the project has no backing node (a project that never surfaced
 * in an ingested transcript), so the graph fold is a graceful no-op and the relational
 * merge still proceeds. Uses the SAME normalizer the project-node keying uses.
 */
function resolveProjectToNodeId(projectId: string): string | null {
  const store = getKnowledgeGraphStore()
  const project = queryOne<{ name: string }>('SELECT name FROM projects WHERE id = ?', [projectId])
  if (!project) return null
  const norm = normalizeGraphLabel(project.name)
  if (!norm) return null
  const node = store.db.queryOne<{ id: string }>(
    "SELECT id FROM graph_nodes WHERE type = 'project' AND norm_key = ?",
    [norm]
  )
  return node?.id ?? null
}

/**
 * Cross-layer atomic core for a PROJECT merge: merge the relational PROJECTS
 * (journaled, undoable) AND fold their backing project NODES in ONE re-entrant
 * runInTransaction, so a throw in either phase rolls BOTH back (a single rollback
 * boundary). Mirrors mergeContactsFoldingNodes; mergeProjects's inner runInTransaction
 * and mergeNodes's runInGraphTransaction are RE-ENTRANT and JOIN the open transaction.
 *
 * The node fold runs only when BOTH projects resolve to DISTINCT project nodes; a
 * project with no backing node folds as a no-op and the project merge still commits.
 * The project nodes are NAME-KEYED, so BOTH must be resolved to their node ids BEFORE
 * mergeProjects runs (which deletes the loser project ROW — after that the loser's
 * name→id lookup would fail, but its GRAPH node persists under the old name and still
 * folds).
 */
function mergeProjectsFoldingNodes(
  keeperProjectId: string,
  loserProjectId: string,
  keeperNodeId: string | null,
  loserNodeId: string | null
): { project: Project; movedEdges: number } {
  const store = getKnowledgeGraphStore()
  const doFold = !!(keeperNodeId && loserNodeId && keeperNodeId !== loserNodeId)
  return runInTransaction(() => {
    const journalsBefore = doFold ? mergeJournalIdsFor('project', keeperProjectId) : null
    const project = mergeProjects(keeperProjectId, loserProjectId)
    let movedEdges = 0
    if (doFold) {
      // ADV56-2 (round-58): snapshot the loser's pre-fold subgraph so unmerge can reverse
      // the fold EXACTLY, then patch it into the journal row mergeProjects just wrote.
      const snapshot = captureLoserSubgraph(loserNodeId!, keeperNodeId!)
      const r = mergeNodes(store, keeperNodeId!, loserNodeId!)
      movedEdges = r.movedEdges
      const journalsAfter = mergeJournalIdsFor('project', keeperProjectId)
      const newId = [...journalsAfter].find((jid) => !journalsBefore!.has(jid))
      if (newId) attachGraphSnapshotToJournal(newId, snapshot)
    }
    return { project, movedEdges }
  })
}

/**
 * Projects entry point (ADV56-3 / round-58): merge two PROJECTS by id AND fold their
 * backing graph project nodes ATOMICALLY. mergeProjects (relational-only) deletes the
 * loser project WITHOUT touching its NAME-KEYED graph node, so the loser's project
 * node + edges + graph_edge_sources stayed reachable under a project that no longer
 * existed relationally. Resolving BOTH project nodes by NAME and folding them inside
 * the same transaction as the relational merge closes that strand — the direct analogue
 * of the round-57 contact composite.
 *
 * Callers must apply their own visibility/eligibility gates on BOTH ids first (the
 * projects:merge IPC's fail-closed filterVisibleEntityIds boundary; the suggestion-accept
 * eligibility gate).
 */
export function mergeProjectsWithGraph(keeperProjectId: string, loserProjectId: string): Project {
  // Resolve BOTH nodes by NAME BEFORE the relational merge deletes the loser row.
  const keeperNodeId = resolveProjectToNodeId(keeperProjectId)
  const loserNodeId = resolveProjectToNodeId(loserProjectId)
  return mergeProjectsFoldingNodes(keeperProjectId, loserProjectId, keeperNodeId, loserNodeId).project
}

/**
 * Accept an identity suggestion — graph-aware, atomic entry point (ADV56-1 / round-58).
 *
 * This is the sole PRODUCTION entry for identity:acceptSuggestion. Two failures the
 * bare database.ts acceptIdentitySuggestion had on a RESOLVABLE-LOSER accept:
 *   1. It called bare mergeContacts/mergeProjects, so the loser's graph node/edges/
 *      graph_edge_sources were STRANDED (same bug as ADV55-1 / ADV56-3).
 *   2. It merged in one transaction and wrote the supersede + status='accepted' in a
 *      SEPARATE transaction — a failure in the second left the identity merged but the
 *      suggestion pending (a retry then took a different path).
 *
 * The resolvable-loser branch here routes the merge through the graph-aware composite
 * (mergeContactsWithGraph / mergeProjectsWithGraph — which fold the graph node in the
 * SAME transaction as the relational merge) AND wraps {merge + journal-id capture +
 * supersede + status write} in ONE re-entrant runInTransaction, so the whole accept is
 * all-or-nothing across BOTH layers. The bare-ALIAS branch (no resolvable loser) is
 * single-transaction and graph-neutral already, so it delegates to database.ts's
 * acceptIdentitySuggestion unchanged.
 *
 * Callers apply the accept-time eligibility gate (isSuggestionEligibleForAccept) BEFORE
 * this, exactly as the IPC does.
 */
export function acceptIdentitySuggestionWithGraph(id: string): AcceptSuggestionResult {
  const s = getIdentitySuggestionById(id)
  if (!s) throw new Error(`Identity suggestion ${id} not found`)

  let evidence: { loserId?: string } = {}
  try {
    evidence = s.evidence ? (JSON.parse(s.evidence) as { loserId?: string }) : {}
  } catch {
    evidence = {}
  }

  const jkind: MergeKind = s.kind === 'person' ? 'contact' : 'project'
  const loserId = evidence.loserId
  const table = s.kind === 'person' ? 'contacts' : 'projects'
  const loserExists =
    !!loserId &&
    loserId !== s.target_id &&
    !!queryOne<{ id: string }>(`SELECT id FROM ${table} WHERE id = ?`, [loserId])

  if (!loserExists) {
    // Alias accept — graph-neutral, already single-transaction in database.ts.
    return acceptIdentitySuggestion(id)
  }

  // Resolvable-loser accept: atomic merge (graph-aware) + supersede + status write.
  return runInTransaction(() => {
    const before = mergeJournalIdsFor(jkind, s.target_id)
    if (s.kind === 'person') mergeContactsWithGraph(s.target_id, loserId!)
    else mergeProjectsWithGraph(s.target_id, loserId!)
    const { mergeJournalId, supersededCount } = finalizeAcceptedMerge(s as IdentitySuggestion, loserId!, jkind, before)
    const row = getIdentitySuggestionById(id)!
    return { ...row, mergeJournalId, supersededCount }
  })
}

/** Remove a junk node from the graph (and its edges). Idempotent. */
export function deleteGraphNode(entityId: string): { removed: boolean; removedEdges: number } {
  const store = getKnowledgeGraphStore()
  const nodeId = resolveEntityToNodeId(entityId)
  if (!nodeId) return { removed: false, removedEdges: 0 }
  return deleteNode(store, nodeId)
}

// ===========================================================================
// hidock-graph-extraction-hardening — Task 6.1
// Scoped re-ingestion: READ-ONLY discovery / dry-run manifest (Req 4.2, 4.8)
// ===========================================================================
//
// The legacy `graph:reingestRecordings` handler derives its scope LIVE on every
// invocation ("all recordings with a marker"), so a dry-run and a later real
// run can silently disagree if new markers appear in between (design §4 / Req
// 4). Req 4 replaces that with an EXPLICITLY SCOPED operation. This task
// delivers the READ-ONLY half: given an explicit selection of
// (recordingId, transcriptId) pairs, `discoverReIngestionScope` returns an
// exact `ReIngestionManifest` describing precisely the set a destructive run
// would touch — no more, no less (Req 4.2) — with per-`extracted_from`
// deletion counts computed PRE-mutation and READ-ONLY (Req 4.8).
//
// STRICTLY READ-ONLY: this function and its helper issue only SELECTs. They
// write nothing, delete nothing, and never touch a marker. The destructive
// half (Scope_Digest enforcement 6.3, selection validation 6.5, scoped
// deletion 6.7, transaction/journal 6.10, ordering 6.12, unmarked routing
// 6.14) is built on top of this manifest by later tasks.

/** An explicit (recording, transcript) pair the operator has chosen to re-ingest. */
export interface ReIngestionPair {
  recordingId: string
  transcriptId: string
}

/** Explicit, caller-supplied scope for a re-ingestion discovery/dry-run. */
export interface ReIngestionSelection {
  pairs: ReIngestionPair[]
}

/**
 * The exact, read-only picture of what a scoped destructive re-ingestion run
 * would affect for a given selection (design §4). Every field is derived
 * PRE-mutation from the current DB state:
 * - recordingIds / transcriptIds: the distinct, sorted ids in the selection.
 * - transcriptHashes: a stable content hash of each transcript's `full_text`
 *   (transcripts carry no persisted hash column, so we compute one). A missing
 *   transcript maps to the empty-string sentinel `''` (nothing to hash).
 * - markerState: 'marked' when a `graph_ingested_transcripts` row exists for the
 *   transcript, else 'unmarked'.
 * - deletionCountsByExtractedFrom: counts of first-class rows (decisions +
 *   action_items) a destructive run WOULD delete, grouped by their
 *   `extracted_from` label, computed read-only. Only rows keyed by the selected
 *   transcript's capture AND `extracted_from = 'transcript:<transcriptId>'` are
 *   counted — this is exactly the scoped-deletion set task 6.7 will remove.
 *   Manually authored / migrated / other-sourced rows (a different
 *   `extracted_from`) are never counted. Only MARKED transcripts contribute.
 * - unmarkedTranscripts: selected transcripts with no ingestion marker, reported
 *   SEPARATELY. They are NOT part of the destructive scope and contribute
 *   nothing to the deletion counts. Task 6.14 routes them to incremental
 *   ingestion via {@link routeUnmarkedToIncrementalIngestion} (the additive,
 *   non-destructive path), never auto-adding them to the destructive manifest.
 */
export interface ReIngestionManifest {
  recordingIds: string[]
  transcriptIds: string[]
  transcriptHashes: Record<string, string>
  markerState: Record<string, 'marked' | 'unmarked'>
  deletionCountsByExtractedFrom: Record<string, number>
  unmarkedTranscripts: string[]
}

/** A candidate (recording, transcript) pair currently carrying an ingest marker. */
export interface MarkedReIngestionCandidate {
  recordingId: string
  transcriptId: string
}

/**
 * Stable content hash for a transcript body. SHA-256 over the raw `full_text`,
 * hex-encoded, prefixed so the algorithm is self-describing in the manifest and
 * in any Scope_Digest built from it (task 6.3). Deterministic: identical text
 * always yields the same value.
 */
export function computeTranscriptHash(fullText: string): string {
  return `sha256:${createHash('sha256').update(fullText, 'utf8').digest('hex')}`
}

/**
 * READ-ONLY discovery: list the (recording, transcript) pairs that currently
 * carry an ingest marker, so an operator can choose an explicit selection to
 * feed {@link discoverReIngestionScope}. This is deliberately kept SEPARATE
 * from the scoped `discover()` — it is a convenience enumerator, NOT the scoped
 * manifest, and it never derives the destructive scope on the operator's
 * behalf. Ordered deterministically (recording_id, transcript_id).
 *
 * Issues only SELECTs — no writes, no deletes, no marker changes.
 */
export function listMarkedReIngestionCandidates(): MarkedReIngestionCandidate[] {
  getKnowledgeGraphStore() // ensure graph_ingested_transcripts exists (idempotent CREATE IF NOT EXISTS)
  const rows = queryAll<{ recording_id: string; transcript_id: string }>(
    `SELECT t.recording_id AS recording_id, git.transcript_id AS transcript_id
       FROM graph_ingested_transcripts git
       JOIN transcripts t ON t.id = git.transcript_id
      ORDER BY t.recording_id, git.transcript_id`,
    []
  )
  return rows.map((r) => ({ recordingId: r.recording_id, transcriptId: r.transcript_id }))
}

/**
 * READ-ONLY discovery / dry-run for scoped re-ingestion (Req 4.2, 4.8).
 *
 * Builds an exact {@link ReIngestionManifest} for the caller-supplied explicit
 * selection. Performs NO writes, NO deletes, and NO marker changes — only
 * SELECTs against the current DB state. This is the dry-run half of the scoped
 * re-ingestion operation; the destructive half (digest enforcement, pair
 * validation, scoped deletion, atomicity, unmarked routing) is layered on top
 * by later tasks and is NOT performed here.
 *
 * Selection validation (unknown / duplicate / mismatched pairs) is task 6.5;
 * here we simply accept the pairs as given and describe them. Duplicate pairs
 * are de-duplicated for the id lists and per-transcript maps so the manifest
 * describes a set, not a bag.
 */
export function discoverReIngestionScope(selection: ReIngestionSelection): ReIngestionManifest {
  getKnowledgeGraphStore() // ensure tracking table exists (idempotent)

  const pairs = selection?.pairs ?? []

  const recordingIds = [...new Set(pairs.map((p) => p.recordingId))].sort()
  const transcriptIds = [...new Set(pairs.map((p) => p.transcriptId))].sort()

  // capture_id for a transcript is resolved through its selected recording:
  // knowledge_captures.source_recording_id = recordingId (the same key the
  // promotion path and the legacy reingest handler use). Build the
  // transcript -> recording map from the selection so counts are scoped to the
  // EXPLICITLY selected pairing, not to whatever else references the transcript.
  const recordingForTranscript = new Map<string, string>()
  for (const p of pairs) {
    if (!recordingForTranscript.has(p.transcriptId)) {
      recordingForTranscript.set(p.transcriptId, p.recordingId)
    }
  }

  const transcriptHashes: Record<string, string> = {}
  const markerState: Record<string, 'marked' | 'unmarked'> = {}
  const deletionCountsByExtractedFrom: Record<string, number> = {}
  const unmarkedTranscripts: string[] = []

  for (const transcriptId of transcriptIds) {
    // Transcript hash (stable, computed from full_text; '' when absent).
    const t = queryOne<{ full_text: string }>('SELECT full_text FROM transcripts WHERE id = ?', [transcriptId])
    transcriptHashes[transcriptId] = t ? computeTranscriptHash(t.full_text ?? '') : ''

    // Marker state.
    const marker = queryOne<{ transcript_id: string }>(
      'SELECT transcript_id FROM graph_ingested_transcripts WHERE transcript_id = ?',
      [transcriptId]
    )
    const isMarked = !!marker
    markerState[transcriptId] = isMarked ? 'marked' : 'unmarked'

    // Unmarked transcripts are reported SEPARATELY and NEVER counted as
    // destructive scope (Req 4.12 / task 6.14 routes them to incremental).
    if (!isMarked) {
      unmarkedTranscripts.push(transcriptId)
      continue
    }

    // Deletion preview (Req 4.8), PRE-mutation and READ-ONLY. Resolve the
    // capture(s) for this transcript's selected recording, then count first-class
    // rows keyed by EACH capture AND extracted_from = 'transcript:<transcriptId>'
    // — exactly the scoped-deletion set task 6.7 will delete. Rows with a
    // different extracted_from (manual / migration:* / other) are NOT counted.
    //
    // hidock-graph-extraction-hardening Task 6.12 (Req 4.11) — DETERMINISTIC
    // CAPTURE ORDERING. A recording can map to MORE THAN ONE knowledge capture
    // (schema allows many captures per source_recording_id). Resolve them via
    // the shared `capturesForRecording` helper, which issues an EXPLICIT,
    // deterministic `ORDER BY created_at, id` and returns EVERY matching
    // capture — NOT a bare unordered single-row `SELECT id` (queryOne), which
    // would non-deterministically pick ONE arbitrary capture and silently
    // ignore the rest. Iterating every capture here (the SAME set, in the SAME
    // order, that `deletePromotedRowsForTranscript` deletes from) keeps this
    // read-only preview aligned with the actual scoped deletion, so predicted
    // == actual holds even for a multi-capture recording (Req 4.8 / tasks 6.9,
    // 6.16). Reusing the one ordered helper (instead of duplicating the query)
    // guarantees discovery and deletion can never diverge on capture selection.
    const recordingId = recordingForTranscript.get(transcriptId)
    if (!recordingId) continue
    const captureIds = capturesForRecording(recordingId)
    if (captureIds.length === 0) continue
    const extractedFrom = `transcript:${transcriptId}`

    let total = 0
    for (const captureId of captureIds) {
      const decCount =
        queryAll<{ n: number }>(
          'SELECT COUNT(*) AS n FROM decisions WHERE knowledge_capture_id = ? AND extracted_from = ?',
          [captureId, extractedFrom]
        )[0]?.n ?? 0
      const actCount =
        queryAll<{ n: number }>(
          'SELECT COUNT(*) AS n FROM action_items WHERE knowledge_capture_id = ? AND extracted_from = ?',
          [captureId, extractedFrom]
        )[0]?.n ?? 0
      total += decCount + actCount
    }

    if (total > 0) {
      deletionCountsByExtractedFrom[extractedFrom] =
        (deletionCountsByExtractedFrom[extractedFrom] ?? 0) + total
    }
  }

  return {
    recordingIds,
    transcriptIds,
    transcriptHashes,
    markerState,
    deletionCountsByExtractedFrom,
    unmarkedTranscripts,
  }
}

// ===========================================================================
// hidock-graph-extraction-hardening — Task 6.3
// Scope_Digest: compute + enforce before any destructive mutation (Req 4.3, 4.4)
// ===========================================================================
//
// A destructive re-ingestion run must operate on EXACTLY the scope the operator
// reviewed in the dry-run manifest (task 6.1) — not on whatever the DB happens
// to look like by the time the run actually fires. Between "operator reviews
// the dry-run" and "operator confirms the destructive run" the relevant source
// state can drift: a selected id changes, a transcript is re-transcribed (its
// content — hence its content hash — changes), or a marker flips
// (marked <-> unmarked). Any such drift means the reviewed manifest no longer
// describes reality and the run must be blocked BEFORE it mutates anything.
//
// Scope_Digest is a STABLE hash over a CANONICAL serialization of the scope's
// identity + the relevant source state (Req 4.3):
//   - sorted recording ids
//   - sorted transcript ids
//   - transcript content hashes (transcriptHashes) — captures re-transcription
//   - marker state (markerState)      — captures marked <-> unmarked flips
//
// It DELIBERATELY does NOT fold in `deletionCountsByExtractedFrom` or
// `unmarkedTranscripts`:
//   - `unmarkedTranscripts` is a pure projection of `markerState` (a transcript
//     is unmarked iff markerState[id] === 'unmarked'), so it carries no
//     information the marker state doesn't already contribute; including it
//     would be redundant, not more sensitive.
//   - `deletionCountsByExtractedFrom` is a DERIVED preview count over
//     first-class rows. It is not part of the scope's IDENTITY, and per the
//     design the digest is over IDs + transcript hashes + marker state. Folding
//     a volatile derived count into the identity digest would make the digest
//     flip for reasons unrelated to "did the reviewed scope/state change",
//     conflating deletion-preview drift with scope drift. The digest tracks the
//     source state (Req 4.4's "relevant source state"); the counts are a
//     read-only consequence of it, re-derived fresh on every discovery.
//
// Canonicalization is deterministic: ids are sorted, and the per-transcript
// maps are emitted as key-sorted [id, value] tuple arrays (NOT raw objects,
// whose key order is not guaranteed to round-trip stably), then JSON-encoded
// with a versioned envelope. Identical scope + state therefore always yields an
// identical digest, and ANY change to a selected id, a transcript hash, or a
// marker yields a DIFFERENT digest.
//
// STRICTLY READ-ONLY: `computeScopeDigest` hashes an in-memory manifest and
// writes nothing. `assertScopeDigestMatches` re-runs the READ-ONLY
// `discoverReIngestionScope` and hashes it; it only THROWS or RETURNS — it
// never mutates. The actual deletion is task 6.7/6.10 and calls this guard
// FIRST, so a mismatch fails before any row is touched.

/** A stable digest of a re-ingestion scope + its relevant source state. */
export interface ScopeDigest {
  value: string
}

/**
 * Versioned envelope tag for the canonical Scope_Digest serialization. Bump if
 * the canonical shape ever changes so digests from different encodings can
 * never be mistaken for a match.
 */
const SCOPE_DIGEST_VERSION = 'scope-digest:v1'

/**
 * Deterministic canonical serialization of the parts of a manifest that define
 * the scope identity + relevant source state (see the section header for what
 * is and is not included). Maps are emitted as key-sorted tuple arrays so the
 * encoding does not depend on object key insertion order.
 */
function canonicalScopeSerialization(manifest: ReIngestionManifest): string {
  const recordingIds = [...manifest.recordingIds].sort()
  const transcriptIds = [...manifest.transcriptIds].sort()
  const transcriptHashes = Object.entries(manifest.transcriptHashes ?? {}).sort(([a], [b]) =>
    a < b ? -1 : a > b ? 1 : 0
  )
  const markerState = Object.entries(manifest.markerState ?? {}).sort(([a], [b]) =>
    a < b ? -1 : a > b ? 1 : 0
  )
  return JSON.stringify({
    v: SCOPE_DIGEST_VERSION,
    recordingIds,
    transcriptIds,
    transcriptHashes,
    markerState,
  })
}

/**
 * Compute the {@link ScopeDigest} for a re-ingestion manifest (Req 4.3).
 *
 * STABLE + DETERMINISTIC: the same scope + source state always produces the
 * same digest. SENSITIVE: changing any selected recording/transcript id, any
 * transcript content hash (i.e. a re-transcription), or any marker
 * (marked <-> unmarked) produces a different digest. READ-ONLY: hashes an
 * in-memory manifest, writes nothing.
 */
export function computeScopeDigest(manifest: ReIngestionManifest): ScopeDigest {
  const canonical = canonicalScopeSerialization(manifest)
  return { value: `sha256:${createHash('sha256').update(canonical, 'utf8').digest('hex')}` }
}

/**
 * Typed error thrown by {@link assertScopeDigestMatches} when the freshly
 * recomputed Scope_Digest does not match the caller-supplied digest (Req 4.4).
 *
 * It signals that the scope or its relevant source state (ids, transcript
 * content hashes, or marker state) changed since the supplied digest was
 * computed, so the destructive run MUST NOT proceed. It is thrown BEFORE any
 * mutation by the enforcement guard, which is the first thing the destructive
 * path (task 6.7/6.10) calls.
 *
 * PRIVACY (Req 4.4 / design §Error Handling & Security): the message and fields
 * carry ONLY the two non-sensitive digest VALUES (opaque sha256 hashes) — never
 * a transcript body, a transcript's `full_text`, a prompt, or model output. A
 * transcript content HASH is not transcript content, and in any case the digest
 * is a hash-of-hashes, so nothing recoverable is exposed.
 */
export class ScopeChangedError extends Error {
  readonly expected: string
  readonly actual: string
  constructor(expected: string, actual: string) {
    super(
      'Re-ingestion scope or source state changed since the supplied Scope_Digest was computed; ' +
        `refusing to mutate (expected ${expected}, recomputed ${actual}).`
    )
    this.name = 'ScopeChangedError'
    this.expected = expected
    this.actual = actual
    Object.setPrototypeOf(this, ScopeChangedError.prototype)
  }
}

/**
 * Enforcement guard for a destructive scoped re-ingestion run (Req 4.4).
 *
 * This is the seam task 6.7/6.10 calls BEFORE deleting anything. It:
 *   1. Freshly re-runs the READ-ONLY {@link discoverReIngestionScope} for the
 *      selection to obtain the CURRENT manifest (so the verified scope reflects
 *      reality now, not a stale snapshot).
 *   2. Recomputes the Scope_Digest over that fresh manifest.
 *   3. Compares it to the caller-supplied digest.
 *   4. If they DIFFER, THROWS {@link ScopeChangedError} — BEFORE any mutation
 *      (this guard performs no writes; the caller has not started deleting yet
 *      because it awaits the returned manifest). Any change to a selected id, a
 *      transcript content hash (re-transcription), or a marker flips the digest
 *      and trips this guard.
 *   5. On a MATCH, RETURNS the fresh manifest, so the caller proceeds using the
 *      VERIFIED current scope (not the caller's possibly-stale copy).
 *
 * STRICTLY READ-ONLY: re-discovery issues only SELECTs and the guard only
 * throws or returns; it never writes, deletes, or touches a marker. No
 * transcript contents appear in the thrown error (see {@link ScopeChangedError}).
 */
export function assertScopeDigestMatches(
  selection: ReIngestionSelection,
  suppliedDigest: ScopeDigest
): ReIngestionManifest {
  const freshManifest = discoverReIngestionScope(selection)
  const recomputed = computeScopeDigest(freshManifest)
  if (recomputed.value !== suppliedDigest?.value) {
    throw new ScopeChangedError(suppliedDigest?.value ?? '(none)', recomputed.value)
  }
  return freshManifest
}

// ===========================================================================
// hidock-graph-extraction-hardening — Task 6.5
// Selection validation: non-empty explicit list; reject invalid pairs (Req 4.1, 4.5)
// ===========================================================================
//
// A destructive re-ingestion run must operate on a list the operator explicitly
// reviewed and approved — nothing implicit, nothing ambiguous. Req 4.1 requires
// a NON-EMPTY explicit list before a destructive run; Req 4.5 requires rejecting
// UNKNOWN, DUPLICATE, or MISMATCHED (recordingId, transcriptId) pairs. This task
// delivers that guard: a READ-ONLY point-read validator that runs BEFORE any
// mutation and throws a typed {@link InvalidReIngestionSelectionError} when the
// list is empty or contains any invalid pair.
//
// The four reject conditions (design §4):
//   - EMPTY:      selection is missing/undefined or has zero pairs. A destructive
//                 run has nothing to approve, so it is refused (Req 4.1).
//   - UNKNOWN:    a recordingId with no `recordings` row, or a transcriptId with
//                 no `transcripts` row. The operator referenced something that
//                 does not exist (Req 4.5).
//   - MISMATCHED: a (recordingId, transcriptId) where the transcript's
//                 `transcripts.recording_id` is NOT the given recordingId — the
//                 transcript does not belong to that recording, so the pairing is
//                 wrong (Req 4.5). Deletion is scoped by this pairing (task 6.7
//                 resolves the capture via `knowledge_captures.source_recording_id
//                 = recordingId`), so a mismatched pair would scope deletion to
//                 the WRONG recording — it must be rejected before any mutation.
//   - DUPLICATE:  the SAME (recordingId, transcriptId) appears more than once in
//                 the explicit list (Req 4.5).
//
// DUPLICATE handling vs. discovery's de-dupe — DELIBERATELY DIFFERENT:
//   `discoverReIngestionScope` (task 6.1) is a READ-ONLY dry-run that describes a
//   SET, so it silently de-duplicates repeated pairs into its id lists / maps —
//   a duplicate there is harmless because it only affects a preview, never a
//   mutation. This DESTRUCTIVE-path validator does the OPPOSITE: it REJECTS
//   duplicates instead of silently collapsing them. The approved destructive
//   list must be EXACTLY what the operator reviewed, unambiguous, and free of
//   accidental repeats (which usually signal a copy/paste or generation bug in
//   the caller). Silently de-duping here would mutate on a list that differs
//   from the reviewed one, so the two behaviours are kept distinct on purpose.
//
// ORDERING vs. the Scope_Digest guard ({@link assertScopeDigestMatches}, task
// 6.3): BOTH must pass before any deletion, and they check DIFFERENT things:
//   - `validateReIngestionSelection` checks the SHAPE of the operator's list
//     (non-empty, no unknown/mismatched/duplicate pairs) — "is this a coherent,
//     unambiguous selection at all?"
//   - `assertScopeDigestMatches` checks that the CURRENT source state still
//     matches the reviewed snapshot (no drift in ids / transcript hashes /
//     markers) — "is the reviewed scope still true right now?"
//   RECOMMENDED ORDER: validate the selection FIRST (cheapest, catches a
//   malformed list before we bother recomputing a digest), THEN enforce the
//   digest. Either order is SAFE because both are strictly READ-ONLY and throw
//   before any mutation; the destructive path (task 6.7/6.10) simply requires
//   that BOTH have passed before it deletes a single row.
//
// STRICTLY READ-ONLY: this validator issues only point-read SELECTs against
// `recordings` and `transcripts`. It writes nothing, deletes nothing, and never
// touches a marker. On the happy path it RETURNS the validated, order-preserved
// selection; on any violation it THROWS before the caller mutates anything.
//
// PRIVACY (Req 4.5 / design §Error Handling & Security): the thrown error names
// the offending pairs by ID ONLY (recordingId / transcriptId). It NEVER contains
// a transcript body, a transcript's `full_text`, a prompt, or model output — ids
// are not content, and this validator never reads `full_text` at all.

/** The kind of selection defect a pair (or the whole list) exhibits. */
export type ReIngestionSelectionViolationKind =
  | 'empty'
  | 'unknown_recording'
  | 'unknown_transcript'
  | 'mismatched_pair'
  | 'duplicate_pair'

/**
 * A single structured, NON-sensitive violation found while validating a
 * re-ingestion selection. Carries ONLY ids (never transcript content), so it is
 * safe to surface in a report or the destructive-gate package.
 *
 * - `empty`               — the whole list is empty; `recordingId`/`transcriptId` are absent.
 * - `unknown_recording`   — `recordingId` has no `recordings` row.
 * - `unknown_transcript`  — `transcriptId` has no `transcripts` row.
 * - `mismatched_pair`     — the transcript exists but belongs to a different
 *                           recording; `actualRecordingId` is the transcript's
 *                           real `transcripts.recording_id`.
 * - `duplicate_pair`      — the (recordingId, transcriptId) pair appears more than
 *                           once in the explicit list.
 */
export interface ReIngestionSelectionViolation {
  kind: ReIngestionSelectionViolationKind
  recordingId?: string
  transcriptId?: string
  /** For `mismatched_pair`: the recording the transcript actually belongs to (id only). */
  actualRecordingId?: string
}

/**
 * Typed error thrown by {@link validateReIngestionSelection} when the explicit
 * selection is empty or contains any unknown, mismatched, or duplicate pair
 * (Req 4.1, 4.5). It is thrown BEFORE any mutation, so the destructive path
 * never begins deleting on an invalid list.
 *
 * The `violations` array is structured and NON-sensitive: every entry names the
 * offending pair by ID ONLY. No transcript body, `full_text`, prompt, or model
 * output appears in the message or fields (design §Error Handling & Security),
 * so a caller/report can say precisely which pairs were unknown / mismatched /
 * duplicated without leaking content.
 */
export class InvalidReIngestionSelectionError extends Error {
  readonly violations: ReIngestionSelectionViolation[]
  constructor(violations: ReIngestionSelectionViolation[]) {
    super(InvalidReIngestionSelectionError.buildMessage(violations))
    this.name = 'InvalidReIngestionSelectionError'
    this.violations = violations
    Object.setPrototypeOf(this, InvalidReIngestionSelectionError.prototype)
  }

  /**
   * Build a bounded, id-only summary message. NEVER includes transcript content
   * — only the violation kinds and the offending ids.
   */
  private static buildMessage(violations: ReIngestionSelectionViolation[]): string {
    if (violations.length === 1 && violations[0].kind === 'empty') {
      return 'Re-ingestion selection is empty; a destructive run requires a non-empty explicit list of (recordingId, transcriptId) pairs.'
    }
    const parts = violations.map((v) => {
      switch (v.kind) {
        case 'empty':
          return 'empty selection'
        case 'unknown_recording':
          return `unknown recording ${v.recordingId}`
        case 'unknown_transcript':
          return `unknown transcript ${v.transcriptId}`
        case 'mismatched_pair':
          return `mismatched pair (recording ${v.recordingId}, transcript ${v.transcriptId} belongs to recording ${v.actualRecordingId})`
        case 'duplicate_pair':
          return `duplicate pair (recording ${v.recordingId}, transcript ${v.transcriptId})`
        default:
          return 'invalid pair'
      }
    })
    return `Invalid re-ingestion selection; refusing to mutate. Offending items: ${parts.join('; ')}.`
  }
}

/**
 * Validate an explicit re-ingestion {@link ReIngestionSelection} BEFORE any
 * destructive mutation (Req 4.1, 4.5).
 *
 * Rejects, by throwing {@link InvalidReIngestionSelectionError}:
 *   - an EMPTY list (missing selection or zero pairs) — Req 4.1;
 *   - any pair whose recordingId is UNKNOWN (no `recordings` row) — Req 4.5;
 *   - any pair whose transcriptId is UNKNOWN (no `transcripts` row) — Req 4.5;
 *   - any MISMATCHED pair (the transcript belongs to a different recording) — Req 4.5;
 *   - any DUPLICATE pair (same (recordingId, transcriptId) appears twice) — Req 4.5.
 *
 * All violations across the list are collected so the thrown error can report
 * EVERY offending pair (by id) in one pass, rather than failing on the first.
 *
 * On success RETURNS the validated selection with its pair order preserved (the
 * caller keeps the exact list it approved). STRICTLY READ-ONLY: issues only
 * point-read SELECTs; writes nothing. Call this alongside
 * {@link assertScopeDigestMatches} — both must pass before deletion (see the
 * section header for ordering guidance).
 */
export function validateReIngestionSelection(selection: ReIngestionSelection): ReIngestionSelection {
  getKnowledgeGraphStore() // ensure schema/tracking tables exist (idempotent); no writes to domain tables

  const pairs = selection?.pairs ?? []

  // Req 4.1: a destructive run requires a NON-EMPTY explicit list.
  if (pairs.length === 0) {
    throw new InvalidReIngestionSelectionError([{ kind: 'empty' }])
  }

  const violations: ReIngestionSelectionViolation[] = []

  // Duplicate detection over the RAW list (do NOT de-dupe — that is discovery's
  // job; the destructive list must be exactly the reviewed one). A given pair is
  // reported as a duplicate exactly once (on its first repeat), regardless of how
  // many times it recurs.
  const seenPairKeys = new Set<string>()
  const reportedDuplicateKeys = new Set<string>()

  // Cache point-reads so a repeated id is looked up once (still read-only).
  const recordingExists = new Map<string, boolean>()
  const transcriptRecording = new Map<string, string | null>() // transcriptId -> its recording_id, or null if absent

  for (const p of pairs) {
    const recordingId = p.recordingId
    const transcriptId = p.transcriptId
    const pairKey = `${recordingId}\u0000${transcriptId}`

    // DUPLICATE (Req 4.5): same explicit pair appears more than once.
    if (seenPairKeys.has(pairKey)) {
      if (!reportedDuplicateKeys.has(pairKey)) {
        violations.push({ kind: 'duplicate_pair', recordingId, transcriptId })
        reportedDuplicateKeys.add(pairKey)
      }
      // Still fall through to structural checks below so an unknown/mismatched
      // duplicate is also flagged for its structural defect (one entry each).
    }
    seenPairKeys.add(pairKey)

    // UNKNOWN recording (Req 4.5).
    if (!recordingExists.has(recordingId)) {
      const rec = queryOne<{ id: string }>('SELECT id FROM recordings WHERE id = ?', [recordingId])
      recordingExists.set(recordingId, !!rec)
    }
    if (!recordingExists.get(recordingId)) {
      violations.push({ kind: 'unknown_recording', recordingId, transcriptId })
    }

    // UNKNOWN transcript / MISMATCHED pair (Req 4.5).
    if (!transcriptRecording.has(transcriptId)) {
      const t = queryOne<{ recording_id: string }>(
        'SELECT recording_id FROM transcripts WHERE id = ?',
        [transcriptId]
      )
      transcriptRecording.set(transcriptId, t ? t.recording_id : null)
    }
    const actualRecordingId = transcriptRecording.get(transcriptId) ?? null
    if (actualRecordingId === null) {
      violations.push({ kind: 'unknown_transcript', recordingId, transcriptId })
    } else if (actualRecordingId !== recordingId) {
      // The transcript exists but belongs to a DIFFERENT recording than the one
      // paired with it — reject (mismatched). Only report this when the
      // transcript is known; an unknown transcript is already flagged above.
      violations.push({ kind: 'mismatched_pair', recordingId, transcriptId, actualRecordingId })
    }
  }

  if (violations.length > 0) {
    throw new InvalidReIngestionSelectionError(violations)
  }

  // Happy path: return the exact, order-preserved selection the operator approved.
  return { pairs: [...pairs] }
}

// ===========================================================================
// hidock-graph-extraction-hardening — Task 6.7
// Scoped relational deletion primitive (Req 4.6, 4.7)
// ===========================================================================
//
// This is the SCOPED-DELETION primitive the destructive re-ingestion run
// removes first-class rows with. It is the "actually delete now" counterpart to
// the READ-ONLY deletion PREVIEW `discoverReIngestionScope` computes
// (`deletionCountsByExtractedFrom`, task 6.1). By construction the set it
// deletes is EXACTLY the set the preview counted, so predicted == actual
// (Req 4.8 / tasks 6.9, 6.16).
//
// WHAT IT DELETES — the WHERE clause, verbatim, for BOTH first-class tables:
//
//     DELETE FROM decisions
//      WHERE knowledge_capture_id = ?               -- a capture of the selected recording
//        AND extracted_from = 'transcript:<transcriptId>'
//
//     DELETE FROM action_items
//      WHERE knowledge_capture_id = ?
//        AND extracted_from = 'transcript:<transcriptId>'
//
// Both predicates MUST hold. `extracted_from = 'transcript:<transcriptId>'`
// already uniquely encodes the promoting transcript (the promotion path stamps
// exactly this label — see `promoteExtractionToFirstClassTables`, which is
// called with `extractedFrom: \`transcript:${row.id}\``). Rows written by any
// OTHER source are NEVER touched, even on the same capture:
//   - 'knowledge-graph'  (the promote default when no transcript label given)
//   - 'manual'           (operator-authored)
//   - 'migration:*'      (migrated rows)
//   - any other label, or NULL (`extracted_from IS NULL`)
// A NULL `extracted_from` can never equal a string literal in SQL, so NULL-
// sourced rows are excluded automatically. Rows on OTHER captures / OTHER
// transcripts are excluded by the `knowledge_capture_id` + label pairing.
// This is the whole of Req 4.6 (scope limited to capture + transcript label)
// and Req 4.7 (never delete manual / migrated / other-sourced rows).
//
// CAPTURE RESOLUTION & MULTIPLE CAPTURES:
// The capture for a (recordingId, transcriptId) pair is resolved the SAME way
// the promotion path resolves it: `knowledge_captures.source_recording_id =
// recordingId`. The promotion path uses a single-row `SELECT id` (queryOne),
// which silently ignores extra captures when a recording maps to more than one.
// This primitive deliberately does NOT rely on that unordered single-row read:
// it selects ALL captures for the recording with an EXPLICIT, deterministic
// `ORDER BY created_at, id` and deletes the transcript-labelled rows under EACH
// of them. Because the label `transcript:<transcriptId>` is itself unique to the
// transcript, the multi-capture handling is fully robust regardless of capture
// count — a transcript's promoted rows are removed wherever they were promoted,
// and no other transcript's rows are ever affected.
//   Relationship to task 6.12: 6.12 owns the end-to-end DETERMINISTIC ORDERING
//   of capture processing across the whole destructive run. This primitive
//   already avoids the unordered `SELECT id` foot-gun (it orders by
//   `created_at, id`), and 6.12 can extend / reuse `capturesForRecording`
//   without changing this primitive's per-transcript scoping contract.
//
// TRANSACTION-NEUTRAL CONTRACT:
// Like `removeRecordingProvenanceCore`, this primitive issues PLAIN statements
// and opens NO transaction of its own (no BEGIN/COMMIT). It is designed to be
// composed INSIDE the whole-batch transaction task 6.10 supplies (via
// `runInTransaction`), alongside graph-provenance removal and marker clearing,
// so the whole scoped batch commits or rolls back atomically. Calling it
// outside a transaction still works (each `run` auto-saves) — it is safe both
// standalone (tests) and composed (6.10).
//
// SAFETY / LOGGING: ids only. No transcript contents, capture titles, or row
// content appear in any return value, log, or error (Req 7.6 / design §Error
// Handling & Security).

/** Per-table deleted-row counts for one scoped deletion. */
export interface ScopedDeletionCounts {
  decisions: number
  actionItems: number
  /** decisions + actionItems — the total this transcript contributed. */
  total: number
}

/** Result of a scoped deletion for a single transcript. */
export interface ScopedDeletionResult {
  transcriptId: string
  /** The capture ids the transcript's rows were removed from (deterministic order). */
  captureIds: string[]
  counts: ScopedDeletionCounts
  /**
   * Deleted totals grouped by `extracted_from` — always the single key
   * `transcript:<transcriptId>` (that is the only label this primitive ever
   * deletes). Shaped to line up directly with the dry-run manifest's
   * `deletionCountsByExtractedFrom` so predicted == actual is a plain equality
   * check (Req 4.8 / tasks 6.9, 6.16).
   */
  deletedByExtractedFrom: Record<string, number>
}

/**
 * READ-ONLY: all capture ids for a recording, resolved the same way the
 * promotion path resolves them (`source_recording_id = recordingId`) but with an
 * EXPLICIT deterministic order (`created_at, id`) instead of an unordered
 * single-row `SELECT id`. Returns every matching capture so a recording that
 * maps to multiple knowledge captures is handled correctly (a transcript's rows
 * are removed wherever they were promoted). Empty when the recording has no
 * capture. Exported so task 6.12 can reuse the same ordered resolution.
 */
export function capturesForRecording(recordingId: string): string[] {
  return queryAll<{ id: string }>(
    'SELECT id FROM knowledge_captures WHERE source_recording_id = ? ORDER BY created_at, id',
    [recordingId]
  ).map((r) => r.id)
}

/**
 * Scoped relational deletion for ONE (recording, transcript) pair (Req 4.6, 4.7).
 *
 * Deletes ONLY first-class rows (`decisions`, `action_items`) whose
 * `knowledge_capture_id` is a capture of `recordingId` AND whose
 * `extracted_from = 'transcript:<transcriptId>'`. Never touches rows with any
 * other `extracted_from` (manual / migration:* / knowledge-graph / NULL / other)
 * on the same capture, and never touches rows on other captures or other
 * transcripts.
 *
 * TRANSACTION-NEUTRAL: opens no transaction of its own; compose inside the
 * whole-batch transaction supplied by task 6.10. See the section header.
 *
 * Returns per-table deleted counts plus a `deletedByExtractedFrom` map keyed by
 * the single `transcript:<transcriptId>` label, so a caller can assert the
 * actual deletion equals the pre-mutation preview (predicted == actual).
 *
 * @param recordingId  the recording whose capture(s) hold the transcript's rows
 * @param transcriptId the transcript whose promoted rows are removed
 */
export function deletePromotedRowsForTranscript(
  recordingId: string,
  transcriptId: string
): ScopedDeletionResult {
  getKnowledgeGraphStore() // ensure schema exists (idempotent); no domain writes here

  const extractedFrom = `transcript:${transcriptId}`
  const captureIds = capturesForRecording(recordingId)

  let decisions = 0
  let actionItems = 0

  for (const captureId of captureIds) {
    // COUNT the exact set BEFORE deleting so the returned figure is the number
    // of rows this call actually removes (getRowsModified would also work, but a
    // count keeps the primitive independent of engine change-tracking and makes
    // the "predicted == actual" contract explicit and testable).
    decisions +=
      queryAll<{ n: number }>(
        'SELECT COUNT(*) AS n FROM decisions WHERE knowledge_capture_id = ? AND extracted_from = ?',
        [captureId, extractedFrom]
      )[0]?.n ?? 0
    actionItems +=
      queryAll<{ n: number }>(
        'SELECT COUNT(*) AS n FROM action_items WHERE knowledge_capture_id = ? AND extracted_from = ?',
        [captureId, extractedFrom]
      )[0]?.n ?? 0

    // The scoped DELETEs. BOTH predicates required. A NULL extracted_from never
    // equals the string literal, so NULL-sourced rows are excluded automatically.
    run('DELETE FROM decisions WHERE knowledge_capture_id = ? AND extracted_from = ?', [
      captureId,
      extractedFrom,
    ])
    run('DELETE FROM action_items WHERE knowledge_capture_id = ? AND extracted_from = ?', [
      captureId,
      extractedFrom,
    ])
  }

  const total = decisions + actionItems
  return {
    transcriptId,
    captureIds,
    counts: { decisions, actionItems, total },
    deletedByExtractedFrom: total > 0 ? { [extractedFrom]: total } : {},
  }
}

/** Aggregate result of a batch scoped deletion over a validated selection. */
export interface ScopedDeletionBatchResult {
  /** Per-transcript results, in the order the selection listed the transcripts. */
  perTranscript: ScopedDeletionResult[]
  /** Grand totals across every transcript in the batch. */
  totals: ScopedDeletionCounts
  /**
   * Batch-wide deleted totals grouped by `extracted_from` (one key per
   * transcript that deleted anything). Directly comparable to the union of the
   * manifest's `deletionCountsByExtractedFrom` for the same selection
   * (predicted == actual across the batch).
   */
  deletedByExtractedFrom: Record<string, number>
}

/**
 * Batch scoped deletion over an already-validated selection (Req 4.6, 4.7).
 *
 * Applies {@link deletePromotedRowsForTranscript} to each distinct
 * (recording, transcript) pair in the selection. Pairs are de-duplicated on
 * (recordingId, transcriptId) so a transcript is deleted at most once even if
 * the raw list repeats it. Order of `perTranscript` follows first appearance in
 * `selection.pairs`.
 *
 * PRECONDITIONS (enforced by callers, not here): the selection must already have
 * passed {@link validateReIngestionSelection} (non-empty, known + matched pairs)
 * and {@link assertScopeDigestMatches} (scope unchanged). This primitive assumes
 * the pairs are valid and simply executes the scoped deletes.
 *
 * TRANSACTION-NEUTRAL: opens no transaction of its own; task 6.10 wraps a whole
 * batch in one `runInTransaction` so every transcript's deletion commits or
 * rolls back together, never leaving a silent mixed state (Req 4.9, 4.10).
 */
export function deletePromotedRowsForSelection(
  selection: ReIngestionSelection
): ScopedDeletionBatchResult {
  const pairs = selection?.pairs ?? []

  const seen = new Set<string>()
  const perTranscript: ScopedDeletionResult[] = []
  const totals: ScopedDeletionCounts = { decisions: 0, actionItems: 0, total: 0 }
  const deletedByExtractedFrom: Record<string, number> = {}

  for (const p of pairs) {
    const key = `${p.recordingId}\u0000${p.transcriptId}`
    if (seen.has(key)) continue
    seen.add(key)

    const res = deletePromotedRowsForTranscript(p.recordingId, p.transcriptId)
    perTranscript.push(res)

    totals.decisions += res.counts.decisions
    totals.actionItems += res.counts.actionItems
    totals.total += res.counts.total
    for (const [label, n] of Object.entries(res.deletedByExtractedFrom)) {
      deletedByExtractedFrom[label] = (deletedByExtractedFrom[label] ?? 0) + n
    }
  }

  return { perTranscript, totals, deletedByExtractedFrom }
}

// ===========================================================================
// hidock-graph-extraction-hardening — Task 6.10
// Whole-batch transaction + durable Progress_Journal (Req 4.9, 4.10)
// ===========================================================================
//
// This task COMPOSES the read-only guards (6.5 selection validation, 6.3
// Scope_Digest enforcement) with the transaction-neutral destructive
// primitives (removeRecordingProvenanceCore graph+marker removal, task 6.7's
// deletePromotedRowsForTranscript scoped first-class deletion) into the
// destructive scoped re-ingestion RUN. The invariant it must uphold (Req 4.10):
// NEVER leave a silent mixed state — either the whole scoped batch takes
// effect, or none of it does, and any partial-completion is EXACTLY reported.
//
// TWO MODES, one invariant:
//
//   (A) WHOLE-BATCH TRANSACTION — the PRIMARY / preferred path for a scoped
//       batch (`runScopedReIngestionRemoval`). The ENTIRE batch runs inside ONE
//       `runInTransaction`. For each selected (recording, transcript) pair it
//       calls `removeRecordingProvenanceCore` (graph provenance + marker clear)
//       AND `deletePromotedRowsForTranscript` (scoped first-class deletion).
//       Because both primitives are TRANSACTION-NEUTRAL and `runInTransaction`
//       is RE-ENTRANT (a nested call just joins the outer transaction — see
//       database.ts / engine.ts), they compose into the single outer
//       transaction: better-sqlite3 + WAL commits only on success, and ANY
//       throw at ANY point rolls back EVERYTHING already done in the batch. No
//       mixed state is possible. This is the right choice for an operator-sized
//       scoped batch reviewed at the destructive gate (task 15).
//
//   (B) DURABLE PROGRESS_JOURNAL — the fallback for a LONG run (the ~790-item
//       backlog) where holding one transaction open across the whole run is not
//       feasible (`runJournaledReIngestionRemoval`). Each item's removal runs in
//       its OWN small transaction that ALSO records the item's completion in the
//       `reingestion_progress` journal table IN THE SAME transaction. So an item
//       is ATOMICALLY either {removed AND journaled} or {neither} — a crash or
//       thrown error mid-item leaves that item completely untouched and
//       un-journaled (no partial removal, no orphan journal row). A resume reads
//       the journal and returns EXACT {completed, remaining}, re-running only the
//       remaining items and SKIPPING any already-journaled item. This is exact
//       partial-completion recovery, never a silent mixed state.
//
// GUARDS FIRE BEFORE ANY MUTATION (both modes): the run FIRST calls
// `validateReIngestionSelection` (6.5 — throws InvalidReIngestionSelectionError
// on an empty / unknown / mismatched / duplicate list) and THEN
// `assertScopeDigestMatches` (6.3 — throws ScopeChangedError on any drift and
// returns the fresh VERIFIED manifest). Both are strictly read-only and throw
// before a single row is deleted, so a bad selection or a drifted scope aborts
// with nothing changed.
//
// MARKED-ONLY DESTRUCTIVE SCOPE (Req 4.12 / task 6.14): the run restricts the
// destructive batch to the MARKED transcripts in the verified manifest.
// Unmarked transcripts are reported SEPARATELY (`skippedUnmarked`) and are NOT
// destructively processed here — nothing was promoted under an unmarked
// transcript's ingest, so there is nothing to remove. Task 6.14 owns routing
// them to incremental ingestion; 6.10 simply keeps them out of the destructive
// batch.
//
// PREDICTED == ACTUAL (Req 4.8): each item's `deletePromotedRowsForTranscript`
// returns its `deletedByExtractedFrom`; the run aggregates them and the caller
// (and tests) can compare the batch total against the manifest's pre-mutation
// `deletionCountsByExtractedFrom`.
//
// NOT WIRED DESTRUCTIVELY-BY-DEFAULT: these functions are EXPORTED for the
// destructive gate (task 15) to call AFTER explicit approval, and for tests.
// Nothing in the live IPC path calls them by default, and they never start a
// live batch.
//
// SAFETY / LOGGING (Req 7.6 / design §Error Handling & Security): ids only. No
// transcript body, `full_text`, capture title, prompt, or model output appears
// in any return value, journal row, log, or error.

/** One (recording, transcript) pair actually removed by a destructive run. */
export interface ReIngestionRemovedItem {
  recordingId: string
  transcriptId: string
  /** Graph provenance + marker removal counts from removeRecordingProvenanceCore. */
  provenance: RemoveRecordingFromGraphResult
  /** Scoped first-class deletion result from deletePromotedRowsForTranscript. */
  scopedDeletion: ScopedDeletionResult
}

/** Result of the whole-batch destructive scoped re-ingestion run (mode A). */
export interface ScopedReIngestionRemovalResult {
  /** How the batch was executed. */
  mode: 'whole-batch'
  /** The fresh, digest-verified manifest the run operated on (task 6.3 return). */
  manifest: ReIngestionManifest
  /** The MARKED (recording, transcript) pairs that were destructively processed. */
  processed: ReIngestionRemovedItem[]
  /**
   * Selected transcripts that were UNMARKED and therefore NOT destructively
   * processed (reported separately per Req 4.12 / task 6.14). Ids only.
   */
  skippedUnmarked: string[]
  /** Aggregate scoped-deletion totals across every processed transcript. */
  totals: ScopedDeletionCounts
  /**
   * Batch-wide actual deletions grouped by `extracted_from`. Directly comparable
   * to the manifest's pre-mutation `deletionCountsByExtractedFrom` for the same
   * selection (predicted == actual, Req 4.8).
   */
  deletedByExtractedFrom: Record<string, number>
}

/**
 * Resolve the ordered list of MARKED (recording, transcript) pairs to
 * destructively process, from a digest-verified manifest + the operator's
 * selection. Preserves the selection's pair order (first appearance),
 * de-duplicates, and drops any pair whose transcript is unmarked in the
 * manifest. Read-only.
 */
function markedPairsForRemoval(
  selection: ReIngestionSelection,
  manifest: ReIngestionManifest
): ReIngestionPair[] {
  const marked = new Set(
    Object.entries(manifest.markerState ?? {})
      .filter(([, state]) => state === 'marked')
      .map(([tid]) => tid)
  )
  const seen = new Set<string>()
  const out: ReIngestionPair[] = []
  for (const p of selection.pairs) {
    if (!marked.has(p.transcriptId)) continue
    const key = `${p.recordingId}\u0000${p.transcriptId}`
    if (seen.has(key)) continue
    seen.add(key)
    out.push({ recordingId: p.recordingId, transcriptId: p.transcriptId })
  }
  return out
}

/**
 * Remove one (recording, transcript) pair's graph provenance + marker AND its
 * scoped first-class rows, composing the two transaction-neutral primitives.
 * TRANSACTION-NEUTRAL itself (no BEGIN/COMMIT of its own): the caller supplies
 * the transaction (the whole-batch outer transaction in mode A, or the per-item
 * transaction in mode B). Ids only in the returned shape.
 */
function removeOneReIngestionPair(recordingId: string, transcriptId: string): ReIngestionRemovedItem {
  // Graph provenance + graph_ingested_transcripts marker clear. Reuse the
  // re-entrant core (do NOT duplicate its logic). Passing the specific
  // transcript id keeps the marker clear scoped to this transcript.
  const provenance = removeRecordingProvenanceCore(recordingId, { transcriptIds: [transcriptId] })
  // Scoped first-class deletion (decisions + action_items) for this transcript.
  const scopedDeletion = deletePromotedRowsForTranscript(recordingId, transcriptId)
  return { recordingId, transcriptId, provenance, scopedDeletion }
}

/**
 * DESTRUCTIVE scoped re-ingestion run — WHOLE-BATCH TRANSACTION (mode A, the
 * PRIMARY path). Req 4.9, 4.10.
 *
 * Order of operations:
 *   1. `validateReIngestionSelection` (6.5) — throws InvalidReIngestionSelectionError
 *      on an empty / unknown / mismatched / duplicate list. BEFORE any mutation.
 *   2. `assertScopeDigestMatches` (6.3) — throws ScopeChangedError on any drift;
 *      returns the fresh VERIFIED manifest used as the authoritative scope.
 *      BEFORE any mutation.
 *   3. Restrict to the MARKED transcripts (unmarked reported separately, Req 4.12).
 *   4. Wrap the ENTIRE batch in ONE `runInTransaction`. For each marked pair,
 *      call `removeOneReIngestionPair` (graph provenance + marker + scoped
 *      first-class deletion), composing re-entrantly in the single outer
 *      transaction. If ANY item throws, the outer transaction ROLLS BACK
 *      EVERYTHING — no row or marker changes for ANY item (Req 4.10). The error
 *      propagates unchanged (its message carries ids only).
 *
 * On success the transaction COMMITS and the result reports processed items,
 * separately-reported unmarked transcripts, aggregate totals, and the actual
 * `deletedByExtractedFrom` (comparable to the manifest's predicted counts).
 *
 * EXPORTED for the destructive gate (task 15) to call after approval and for
 * tests. Does NOT start any live batch on its own.
 *
 * @throws InvalidReIngestionSelectionError  empty / invalid selection (nothing mutated)
 * @throws ScopeChangedError                 scope/state drift (nothing mutated)
 */
export function runScopedReIngestionRemoval(
  selection: ReIngestionSelection,
  suppliedDigest: ScopeDigest
): ScopedReIngestionRemovalResult {
  // (1) Selection shape guard — throws BEFORE any mutation.
  const validated = validateReIngestionSelection(selection)
  // (2) Scope-drift guard — throws BEFORE any mutation; returns fresh manifest.
  const manifest = assertScopeDigestMatches(validated, suppliedDigest)
  // (3) Marked-only destructive scope; unmarked reported separately (Req 4.12).
  const markedPairs = markedPairsForRemoval(validated, manifest)
  const skippedUnmarked = [...manifest.unmarkedTranscripts]

  const totals: ScopedDeletionCounts = { decisions: 0, actionItems: 0, total: 0 }
  const deletedByExtractedFrom: Record<string, number> = {}

  // (4) WHOLE-BATCH TRANSACTION: all-or-nothing. Any throw rolls back the lot.
  const processed = runInTransaction<ReIngestionRemovedItem[]>(() => {
    const out: ReIngestionRemovedItem[] = []
    for (const pair of markedPairs) {
      const item = removeOneReIngestionPair(pair.recordingId, pair.transcriptId)
      out.push(item)
      totals.decisions += item.scopedDeletion.counts.decisions
      totals.actionItems += item.scopedDeletion.counts.actionItems
      totals.total += item.scopedDeletion.counts.total
      for (const [label, n] of Object.entries(item.scopedDeletion.deletedByExtractedFrom)) {
        deletedByExtractedFrom[label] = (deletedByExtractedFrom[label] ?? 0) + n
      }
    }
    return out
  })

  return {
    mode: 'whole-batch',
    manifest,
    processed,
    skippedUnmarked,
    totals,
    deletedByExtractedFrom,
  }
}

// ---------------------------------------------------------------------------
// Durable Progress_Journal (mode B) — reingestion_progress table
// ---------------------------------------------------------------------------
//
// The journal is a durable, per-item completion record for the LONG run where a
// single whole-batch transaction is not feasible. It is keyed by a stable
// (runId, recordingId, transcriptId) tuple so multiple independent runs can
// coexist and a resume can scope to exactly one run. Each item is inserted in
// the SAME transaction as its removal, so a journal row exists IFF that item's
// destructive work committed.

/** A single completed item recorded in the durable Progress_Journal. */
export interface ReIngestionJournalEntry {
  runId: string
  recordingId: string
  transcriptId: string
  /** ISO timestamp the item's removal committed. */
  completedAt: string
  /** Total first-class rows this item deleted (from deletePromotedRowsForTranscript). */
  deletedTotal: number
}

/**
 * Create the durable Progress_Journal table if absent. App-side tracking table
 * (like `graph_ingested_transcripts`), NOT part of the graph schema. Idempotent.
 * The PRIMARY KEY (run_id, recording_id, transcript_id) makes an item's journal
 * insert unique per run, so a re-run of an already-journaled item is a no-op
 * (INSERT OR IGNORE) rather than a duplicate.
 */
export function ensureReIngestionProgressTable(): void {
  run(
    `CREATE TABLE IF NOT EXISTS reingestion_progress (
       run_id         TEXT    NOT NULL,
       recording_id   TEXT    NOT NULL,
       transcript_id  TEXT    NOT NULL,
       completed_at   TEXT    NOT NULL,
       deleted_total  INTEGER NOT NULL DEFAULT 0,
       PRIMARY KEY (run_id, recording_id, transcript_id)
     )`,
    []
  )
}

/** READ-ONLY: the set of (recording, transcript) keys already journaled for a run. */
function journaledKeysForRun(runId: string): Set<string> {
  ensureReIngestionProgressTable()
  const rows = queryAll<{ recording_id: string; transcript_id: string }>(
    'SELECT recording_id, transcript_id FROM reingestion_progress WHERE run_id = ?',
    [runId]
  )
  return new Set(rows.map((r) => `${r.recording_id}\u0000${r.transcript_id}`))
}

/** READ-ONLY: all journal entries for a run, in completion order then id order. */
export function readReIngestionJournal(runId: string): ReIngestionJournalEntry[] {
  ensureReIngestionProgressTable()
  const rows = queryAll<{
    run_id: string
    recording_id: string
    transcript_id: string
    completed_at: string
    deleted_total: number
  }>(
    `SELECT run_id, recording_id, transcript_id, completed_at, deleted_total
       FROM reingestion_progress
      WHERE run_id = ?
      ORDER BY completed_at, recording_id, transcript_id`,
    [runId]
  )
  return rows.map((r) => ({
    runId: r.run_id,
    recordingId: r.recording_id,
    transcriptId: r.transcript_id,
    completedAt: r.completed_at,
    deletedTotal: r.deleted_total,
  }))
}

/** Result of a journaled destructive run / resume (mode B). */
export interface JournaledReIngestionRemovalResult {
  mode: 'journaled'
  runId: string
  /** The digest-verified manifest the run operated on. */
  manifest: ReIngestionManifest
  /**
   * Items completed AND journaled during THIS invocation (excludes items already
   * journaled by a prior run — those are skipped, see `alreadyDone`).
   */
  completed: ReIngestionRemovedItem[]
  /**
   * Marked items that were ALREADY journaled by a prior run and therefore
   * SKIPPED this invocation (exact partial-completion recovery). Ids only.
   */
  alreadyDone: ReIngestionPair[]
  /**
   * Marked items still NOT journaled after this invocation. Empty on a fully
   * successful run; non-empty if the run was asked to stop early or an item
   * threw (that item and everything after it remain). Ids only.
   */
  remaining: ReIngestionPair[]
  /** Selected transcripts that were UNMARKED and NOT processed (Req 4.12). */
  skippedUnmarked: string[]
}

/**
 * DESTRUCTIVE scoped re-ingestion run — DURABLE PROGRESS_JOURNAL (mode B, the
 * LONG-run fallback). Req 4.9, 4.10.
 *
 * Same guards as mode A fire FIRST and BEFORE any mutation
 * (`validateReIngestionSelection`, then `assertScopeDigestMatches`), and the
 * destructive scope is restricted to MARKED transcripts (unmarked reported
 * separately, Req 4.12).
 *
 * Unlike mode A, each marked item's removal runs in its OWN small
 * `runInTransaction` that ALSO inserts the item's journal row IN THE SAME
 * transaction. Because `runInTransaction` commits only on success and rolls back
 * on throw, an item is ATOMICALLY {removed AND journaled} or {neither} — a
 * mid-item failure leaves that item neither partially-removed nor journaled (no
 * silent mixed state). Items already journaled by a prior invocation are SKIPPED
 * (resume with exact partial-completion). If an item throws, the run stops,
 * that item and all subsequent items are reported in `remaining`, and the error
 * is NOT swallowed for the failing item — but every prior item is durably
 * journaled, so a later resume continues from exactly where this left off.
 *
 * Re-run / resume semantics: call again with the SAME `runId` and selection.
 * The scope digest is re-verified (a drift aborts the resume before mutation),
 * already-journaled items are reported in `alreadyDone` and skipped, and only
 * the truly remaining items are processed.
 *
 * EXPORTED for the destructive gate (task 15) / long-run driver and tests. Does
 * NOT start a live batch on its own; the caller decides when (and whether) to
 * run it.
 *
 * @param opts.stopAfter  optional cap on how many NEW items to process this
 *   invocation (the rest are left in `remaining` and journaled on a later
 *   resume) — lets the long-run driver checkpoint in bounded slices.
 * @throws InvalidReIngestionSelectionError  empty / invalid selection (nothing mutated)
 * @throws ScopeChangedError                 scope/state drift (nothing mutated)
 */
export function runJournaledReIngestionRemoval(
  runId: string,
  selection: ReIngestionSelection,
  suppliedDigest: ScopeDigest,
  opts: { stopAfter?: number } = {}
): JournaledReIngestionRemovalResult {
  // Guards fire BEFORE any mutation (same order as mode A).
  const validated = validateReIngestionSelection(selection)
  const manifest = assertScopeDigestMatches(validated, suppliedDigest)
  ensureReIngestionProgressTable()

  // The set of transcripts CURRENTLY marked in the fresh verified manifest.
  const markedTranscripts = new Set(
    Object.entries(manifest.markerState ?? {})
      .filter(([, state]) => state === 'marked')
      .map(([tid]) => tid)
  )
  const alreadyJournaled = journaledKeysForRun(runId)

  // Deduped selection pairs in first-appearance order (the destructive list the
  // operator approved, without accidental repeats).
  const seenPairKeys = new Set<string>()
  const orderedPairs: ReIngestionPair[] = []
  for (const p of validated.pairs) {
    const key = `${p.recordingId}\u0000${p.transcriptId}`
    if (seenPairKeys.has(key)) continue
    seenPairKeys.add(key)
    orderedPairs.push({ recordingId: p.recordingId, transcriptId: p.transcriptId })
  }

  const completed: ReIngestionRemovedItem[] = []
  const alreadyDone: ReIngestionPair[] = []
  const remaining: ReIngestionPair[] = []
  const skippedUnmarked: string[] = []

  const cap = opts.stopAfter ?? Number.POSITIVE_INFINITY
  let processedThisRun = 0
  let stoppedEarly = false

  for (const pair of orderedPairs) {
    const key = `${pair.recordingId}\u0000${pair.transcriptId}`

    // JOURNAL is the authoritative "already completed" signal (independent of
    // marker state): an item this run already removed had its marker cleared, so
    // it now LOOKS unmarked — but the journal proves it is done. Check it FIRST
    // so a resume correctly reports it as alreadyDone rather than mis-classifying
    // it as unmarked (exact partial-completion recovery, Req 4.9/4.10).
    if (alreadyJournaled.has(key)) {
      alreadyDone.push(pair)
      continue
    }

    // Not journaled AND not currently marked → nothing was ever promoted under
    // this transcript's ingest, so there is nothing to remove. Report separately
    // (Req 4.12 / task 6.14 routes it to incremental), never destructively touch.
    if (!markedTranscripts.has(pair.transcriptId)) {
      skippedUnmarked.push(pair.transcriptId)
      continue
    }

    // Once we've stopped (cap reached), everything else is simply remaining.
    if (stoppedEarly || processedThisRun >= cap) {
      remaining.push(pair)
      continue
    }

    // PER-ITEM ATOMIC {removal + journal insert}: both commit together or
    // neither does. A throw here rolls back this item's transaction entirely
    // (no partial removal, no orphan journal row) and stops the run.
    let item: ReIngestionRemovedItem
    try {
      item = runInTransaction<ReIngestionRemovedItem>(() => {
        const removed = removeOneReIngestionPair(pair.recordingId, pair.transcriptId)
        run(
          `INSERT OR IGNORE INTO reingestion_progress
             (run_id, recording_id, transcript_id, completed_at, deleted_total)
           VALUES (?, ?, ?, ?, ?)`,
          [runId, pair.recordingId, pair.transcriptId, new Date().toISOString(), removed.scopedDeletion.counts.total]
        )
        return removed
      })
    } catch (e) {
      // This item rolled back atomically (nothing removed, nothing journaled).
      // Re-throw so the caller sees the failure; the returned result object is
      // discarded on the throw path, so we do not populate `remaining` here.
      // Every PRIOR item is durably journaled, so a later resume with the same
      // runId continues from exactly this item onward (exact partial-completion,
      // no silent mixed state). Ids only in the propagated error.
      throw e
    }

    completed.push(item)
    alreadyJournaled.add(key)
    processedThisRun += 1
    if (processedThisRun >= cap) stoppedEarly = true
  }

  return {
    mode: 'journaled',
    runId,
    manifest,
    completed,
    alreadyDone,
    remaining,
    skippedUnmarked,
  }
}

// ===========================================================================
// hidock-graph-extraction-hardening — Task 6.14
// Route unmarked transcripts to INCREMENTAL ingestion (Req 4.12)
// ===========================================================================
//
// Req 4.12: "WHEN a selected transcript is unmarked, THE Re_Ingestion_Handler
// SHALL route the transcript to incremental ingestion, SHALL report it
// separately, and SHALL NOT add it automatically to the destructive manifest."
//
// The discovery manifest (task 6.1) and both destructive runs (task 6.10)
// already satisfy TWO of the three clauses: `unmarkedTranscripts` /
// `skippedUnmarked` report them SEPARATELY, and the destructive scope is
// restricted to MARKED transcripts so an unmarked one is NEVER in the marked
// selection the scoped deletion touches (a `deletePromotedRowsForTranscript`
// call never fires for it). This task supplies the still-missing clause: the
// POSITIVE routing of those unmarked transcripts to the INCREMENTAL (additive)
// ingest path — the normal, non-destructive `ingestFromDbTranscripts` flow that
// extracts + promotes + marks a transcript for the FIRST time, with NO
// pre-deletion.
//
// WHY `ingestFromDbTranscripts` IS THE INCREMENTAL PATH: it iterates DB
// transcripts, SKIPS any that already carry a `graph_ingested_transcripts`
// marker ("Check if already ingested (incremental)"), and additively ingests
// only the unmarked ones — it deletes nothing and touches no marked/destructive
// state. An unmarked transcript from a re-ingestion selection is EXACTLY an
// item that path is designed to pick up: routing it here is a no-op relative to
// the destructive manifest and cannot delete a manually authored / migrated /
// other-sourced row (unlike the destructive path).
//
// SEPARATION FROM THE DESTRUCTIVE PATH (Req 4.12, defensive): the routing helper
// takes ONLY the separately-reported unmarked ids (from a manifest or a
// destructive-run result) and NEVER accepts a marked transcript. It re-verifies,
// from the fresh DB marker state, that every id it is about to route is
// genuinely unmarked, and refuses (throws) if any id is actually marked — so a
// caller can never smuggle a marked/destructive transcript through the
// incremental seam, and an unmarked one can never be auto-added to the
// destructive manifest.

/**
 * The set of unmarked transcript ids carried by a discovery manifest or a
 * destructive-run result. Both shapes report unmarked transcripts separately
 * (`ReIngestionManifest.unmarkedTranscripts` /
 * `{Scoped,Journaled}ReIngestionRemovalResult.skippedUnmarked`); this narrows
 * to just that field so the routing helper is agnostic to which produced it.
 */
export type UnmarkedTranscriptSource =
  | Pick<ReIngestionManifest, 'unmarkedTranscripts'>
  | Pick<ScopedReIngestionRemovalResult, 'skippedUnmarked'>
  | Pick<JournaledReIngestionRemovalResult, 'skippedUnmarked'>

/** READ-ONLY: extract the separately-reported unmarked transcript ids (deduped, sorted). */
export function unmarkedTranscriptsFrom(source: UnmarkedTranscriptSource): string[] {
  const ids =
    'unmarkedTranscripts' in source ? source.unmarkedTranscripts : source.skippedUnmarked
  return [...new Set(ids ?? [])].sort()
}

/**
 * Typed error thrown by {@link routeUnmarkedToIncrementalIngestion} when a
 * transcript it was asked to route to the INCREMENTAL path is in fact MARKED
 * (i.e. destructive scope). This is a hard guard on Req 4.12's separation
 * clause: an unmarked-only seam must never be handed a marked/destructive
 * transcript, and the check fails closed (nothing is ingested). Ids only — no
 * transcript content.
 */
export class MarkedTranscriptRoutedToIncrementalError extends Error {
  constructor(public readonly markedTranscriptIds: string[]) {
    super(
      `Refusing to route ${markedTranscriptIds.length} MARKED transcript(s) to incremental ingestion ` +
        `(marked transcripts are destructive scope and must not enter the incremental path): ` +
        markedTranscriptIds.join(', ')
    )
    this.name = 'MarkedTranscriptRoutedToIncrementalError'
  }
}

/** Result of routing unmarked transcripts to the incremental (additive) path. */
export interface IncrementalRoutingResult {
  /**
   * The unmarked transcript ids that were routed to incremental ingestion
   * (deduped, sorted). Reported SEPARATELY from any destructive scope (Req 4.12).
   */
  routedTranscriptIds: string[]
  /**
   * The result of the incremental (additive) ingest pass the unmarked
   * transcripts were routed through, or `null` when there were no unmarked
   * transcripts to route (nothing was run). This is the normal
   * `ingestFromDbTranscripts` contract — NO pre-deletion, marked transcripts
   * skipped — so it is DISTINCT from any destructive removal result.
   */
  incremental: IngestResult | null
}

/**
 * READ-ONLY guard: confirm every id is genuinely UNMARKED in the CURRENT DB
 * state before routing it to the incremental path (Req 4.12 separation clause).
 * Throws {@link MarkedTranscriptRoutedToIncrementalError} — before any ingest —
 * if any supplied id is actually marked. Ids only.
 */
function assertAllUnmarked(transcriptIds: string[]): void {
  getKnowledgeGraphStore() // ensure graph_ingested_transcripts exists (idempotent)
  const marked: string[] = []
  for (const tid of transcriptIds) {
    const row = queryOne<{ transcript_id: string }>(
      'SELECT transcript_id FROM graph_ingested_transcripts WHERE transcript_id = ?',
      [tid]
    )
    if (row) marked.push(tid)
  }
  if (marked.length > 0) {
    throw new MarkedTranscriptRoutedToIncrementalError(marked.sort())
  }
}

/**
 * Route the separately-reported UNMARKED transcripts of a re-ingestion
 * selection to INCREMENTAL ingestion (Req 4.12 / task 6.14).
 *
 * This is the POSITIVE half of Req 4.12: an unmarked transcript is NOT
 * destructive scope (it was never promoted, so there is nothing to remove), so
 * instead of being dropped it is routed to the NORMAL additive ingest path
 * ({@link ingestFromDbTranscripts}) — extract → promote → mark, with NO
 * pre-deletion. The additive path itself skips already-marked transcripts, so
 * this run only ever ingests genuinely-unmarked material and can never delete a
 * manually authored / migrated / other-sourced row.
 *
 * SEPARATION (Req 4.12): the ids are taken ONLY from the separately-reported
 * `unmarkedTranscripts` / `skippedUnmarked` field of a manifest or destructive
 * result — never from the marked/destructive selection. Before running, a
 * fresh READ-ONLY marker recheck asserts every id is still unmarked; if any is
 * marked, it throws {@link MarkedTranscriptRoutedToIncrementalError} and
 * ingests NOTHING (fail-closed). A marked/destructive transcript can therefore
 * never enter the incremental path, and an unmarked one is never auto-added to
 * the destructive manifest.
 *
 * When there are no unmarked transcripts to route, this is a no-op: it returns
 * `{ routedTranscriptIds: [], incremental: null }` WITHOUT running an ingest
 * pass.
 *
 * NOT wired into any live path by default — EXPORTED for the destructive gate's
 * "subsequent incremental invocation" (design §Destructive_Operation_Gate /
 * task 15.1) and for tests. It performs an additive (non-destructive) ingest;
 * it starts no destructive run and clears no marker.
 *
 * @throws MarkedTranscriptRoutedToIncrementalError  a supplied id is marked (nothing ingested)
 */
export async function routeUnmarkedToIncrementalIngestion(
  source: UnmarkedTranscriptSource
): Promise<IncrementalRoutingResult> {
  const routedTranscriptIds = unmarkedTranscriptsFrom(source)

  // Nothing to route → do NOT run an ingest pass (no-op, distinct from a run
  // that ingested zero rows).
  if (routedTranscriptIds.length === 0) {
    return { routedTranscriptIds, incremental: null }
  }

  // Fail-closed separation guard: every routed id MUST be unmarked right now.
  assertAllUnmarked(routedTranscriptIds)

  // Route to the incremental (additive) path. `ingestFromDbTranscripts` skips
  // already-marked transcripts and additively ingests unmarked ones with NO
  // pre-deletion — exactly the incremental contract Req 4.12 calls for.
  const incremental = await ingestFromDbTranscripts()
  return { routedTranscriptIds, incremental }
}
