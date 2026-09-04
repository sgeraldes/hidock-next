/**
 * hidock-graph-extraction-hardening Task 10.3 (Req 7.2–7.6) — focused unit tests
 * for the hardened transient-retry primitive in knowledge-graph-service.ts:
 *
 *   - `computeBackoffDelayMs` — bounded exponential backoff + jitter, capped at
 *     a configured maximum (Req 7.2).
 *   - `completeWithRetry`      — cancellation/shutdown-aware (Req 7.3) via an
 *     injected AbortSignal + interruptible sleep; per-attempt eligibility
 *     recheck before EVERY attempt (Req 7.4); reported attempt count + terminal
 *     category (Req 7.5); and privacy-safe logging (Req 7.6).
 *
 * These are pure/seam-driven: `completeWithRetry` takes an injected `sleepImpl`
 * (a fake clock with a cancel handle) and `rand` (deterministic jitter), so the
 * tests never race real time and never touch a DB. The heavy side-effecting deps
 * are mocked exactly like retry-classifier.test.ts purely so importing the
 * module does not touch the real Electron/DB layer.
 */

// @vitest-environment node

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { tmpdir } from 'os'
import { join } from 'path'

// ---------------------------------------------------------------------------
// Top-level mocks (hoisted before imports) — mirror retry-classifier.test.ts
// ---------------------------------------------------------------------------

vi.mock('electron', () => ({ app: { getPath: () => tmpdir(), getVersion: () => '0.0.0' } }))

vi.mock('../config', () => ({
  getConfig: vi.fn(() => ({
    chat: { provider: 'ollama', ollamaModel: 'llama3.2', extractionOllamaModel: 'gemma3:12b', maxContextChunks: 10 },
    transcription: { geminiApiKey: '', geminiModel: '' },
    storage: { dataPath: tmpdir(), maxRecordingsGB: 50 },
    version: '1.0.0'
  }))
}))

vi.mock('@hidock/ai-providers', async (importOriginal) => {
  const mod = await importOriginal<typeof import('@hidock/ai-providers')>()
  return { ...mod, complete: vi.fn() }
})

let _dbCounter = 0
vi.mock('../file-storage', () => ({
  getDatabasePath: vi.fn(() => join(tmpdir(), `hidock-kg-backoff-test-${Date.now()}-${++_dbCounter}.sqlite`))
}))

// ---------------------------------------------------------------------------
// Imports (after mocks)
// ---------------------------------------------------------------------------

import {
  computeBackoffDelayMs,
  completeWithRetry,
  RetryCancelledError,
  PrivacyBlockedError,
  type RetryOutcome,
} from '../knowledge-graph-service'
import { complete } from '@hidock/ai-providers'
import { ExtractionError } from '@hidock/knowledge-graph'

const completeMock = complete as unknown as ReturnType<typeof vi.fn>

/** A genuine transient transport error (fetch-failed shape, cause.code set). */
function transientErr(code = 'ECONNRESET'): TypeError {
  const err = new TypeError('fetch failed')
  ;(err as { cause?: unknown }).cause = Object.assign(new Error('underlying'), { code })
  return err
}

/**
 * A fake sleep with a cancel handle. It never touches real time: it records
 * every requested delay and hands back a manually-resolvable promise plus a
 * `cancel()` that (if invoked before resolution) leaves the promise pending
 * forever — exactly the behaviour the interruptible-sleep abort path relies on
 * (the abort listener rejects instead).
 */
function makeFakeSleep() {
  const delays: number[] = []
  const pending: Array<{ resolve: () => void; cancelled: boolean }> = []
  const sleepImpl = (ms: number) => {
    delays.push(ms)
    const entry = { resolve: () => {}, cancelled: false }
    const promise = new Promise<void>((res) => {
      entry.resolve = res
    })
    pending.push(entry)
    return {
      promise,
      cancel: () => {
        entry.cancelled = true
      },
    }
  }
  return {
    sleepImpl,
    delays,
    /** Resolve the Nth (0-based) pending sleep — simulates the timer firing. */
    fire: (i = pending.length - 1) => pending[i]?.resolve(),
    pending,
  }
}

beforeEach(() => {
  completeMock.mockReset()
})

// ===========================================================================
// (a)/(b) computeBackoffDelayMs — exponential growth, cap, jitter envelope
// ===========================================================================
describe('computeBackoffDelayMs (Req 7.2)', () => {
  it('grows exponentially with jitter="none" (deterministic base)', () => {
    const cfg = { baseMs: 100, capMs: 100_000, factor: 2, jitter: 'none' as const }
    expect(computeBackoffDelayMs(1, cfg)).toBe(100) // 100 * 2^0
    expect(computeBackoffDelayMs(2, cfg)).toBe(200) // 100 * 2^1
    expect(computeBackoffDelayMs(3, cfg)).toBe(400) // 100 * 2^2
    expect(computeBackoffDelayMs(4, cfg)).toBe(800) // 100 * 2^3
  })

  it('is CAPPED at the configured maximum (never exceeds capMs), even for large attempt numbers', () => {
    const cfg = { baseMs: 1000, capMs: 5000, factor: 2, jitter: 'none' as const }
    expect(computeBackoffDelayMs(1, cfg)).toBe(1000)
    expect(computeBackoffDelayMs(2, cfg)).toBe(2000)
    expect(computeBackoffDelayMs(3, cfg)).toBe(4000)
    expect(computeBackoffDelayMs(4, cfg)).toBe(5000) // 8000 clamped → 5000
    expect(computeBackoffDelayMs(20, cfg)).toBe(5000) // still capped
  })

  it('FULL jitter stays within [0, capped] for every attempt across the RNG range', () => {
    const cfg = { baseMs: 1000, capMs: 4000, factor: 2, jitter: 'full' as const }
    for (const attempt of [1, 2, 3, 4, 10]) {
      const capped = Math.min(1000 * 2 ** (attempt - 1), 4000)
      for (const r of [0, 0.25, 0.5, 0.9999, 1]) {
        const d = computeBackoffDelayMs(attempt, cfg, () => r)
        expect(d).toBeGreaterThanOrEqual(0)
        expect(d).toBeLessThanOrEqual(capped)
        expect(d).toBeLessThanOrEqual(cfg.capMs) // never exceeds the cap
        expect(d).toBeCloseTo(r * capped, 6)
      }
    }
  })

  it('EQUAL jitter stays within [capped/2, capped] (guaranteed minimum wait)', () => {
    const cfg = { baseMs: 1000, capMs: 4000, factor: 2, jitter: 'equal' as const }
    for (const attempt of [1, 2, 3, 10]) {
      const capped = Math.min(1000 * 2 ** (attempt - 1), 4000)
      for (const r of [0, 0.5, 1]) {
        const d = computeBackoffDelayMs(attempt, cfg, () => r)
        expect(d).toBeGreaterThanOrEqual(capped / 2)
        expect(d).toBeLessThanOrEqual(capped)
        expect(d).toBeLessThanOrEqual(cfg.capMs)
      }
    }
  })

  it('uses documented defaults (base 1500, cap 30000, factor 2, full jitter)', () => {
    // rand=1 → full-jitter delay equals the capped exponential value.
    expect(computeBackoffDelayMs(1, {}, () => 1)).toBe(1500) // 1500 * 2^0
    expect(computeBackoffDelayMs(2, {}, () => 1)).toBe(3000) // 1500 * 2^1
    expect(computeBackoffDelayMs(6, {}, () => 1)).toBe(30_000) // 48000 clamped → 30000
  })
})

// ===========================================================================
// completeWithRetry — cancellation, recheck, reporting, privacy
// ===========================================================================
describe('completeWithRetry (Req 7.3–7.6)', () => {
  // ---- success -----------------------------------------------------------
  it('(e) reports { attempts: 1, category: "success" } and returns output on first-try success', async () => {
    completeMock.mockResolvedValueOnce('OK')
    let outcome: RetryOutcome | undefined
    const out = await completeWithRetry('p', {} as any, 3, undefined, {
      onOutcome: (o) => (outcome = o),
    })
    expect(out).toBe('OK')
    expect(outcome).toEqual({ attempts: 1, category: 'success' })
    expect(completeMock).toHaveBeenCalledTimes(1)
  })

  it('(e) success after transient retries reports the true attempt count', async () => {
    completeMock.mockRejectedValueOnce(transientErr()).mockResolvedValueOnce('OK')
    const fake = makeFakeSleep()
    let outcome: RetryOutcome | undefined
    const p = completeWithRetry('p', {} as any, 3, undefined, {
      onOutcome: (o) => (outcome = o),
      sleepImpl: fake.sleepImpl,
      rand: () => 0.5,
    })
    // Let the first (rejected) attempt settle, then fire the backoff timer.
    await Promise.resolve()
    await Promise.resolve()
    fake.fire()
    expect(await p).toBe('OK')
    expect(outcome).toEqual({ attempts: 2, category: 'success' })
  })

  // ---- transient exhausted ----------------------------------------------
  it('(e) reports "transient-exhausted" with the full attempt count when every attempt is transient', async () => {
    completeMock.mockRejectedValue(transientErr())
    const fake = makeFakeSleep()
    let outcome: RetryOutcome | undefined
    const p = completeWithRetry('p', {} as any, 3, undefined, {
      onOutcome: (o) => (outcome = o),
      sleepImpl: fake.sleepImpl,
      rand: () => 0.5,
    }).catch((e) => e)
    // Drain: attempt1 → sleep → attempt2 → sleep → attempt3 → throw.
    for (let k = 0; k < 6; k++) {
      await Promise.resolve()
      fake.fire()
      await Promise.resolve()
    }
    const err = await p
    expect(err).toBeInstanceOf(TypeError) // the last transient transport error
    expect(outcome).toEqual({ attempts: 3, category: 'transient-exhausted' })
    // Exponential envelope: two backoffs were scheduled (between the 3 attempts).
    expect(fake.delays).toHaveLength(2)
    expect(completeMock).toHaveBeenCalledTimes(3)
    // Outcome also attached to the thrown error (non-enumerable, counts only).
    expect((err as { retryOutcome?: RetryOutcome }).retryOutcome).toEqual({
      attempts: 3,
      category: 'transient-exhausted',
    })
  })

  // ---- terminal error ----------------------------------------------------
  it('(e) reports "terminal-error" for a non-transient error and does NOT retry', async () => {
    completeMock.mockRejectedValueOnce(new ExtractionError())
    const fake = makeFakeSleep()
    let outcome: RetryOutcome | undefined
    const err = await completeWithRetry('p', {} as any, 3, undefined, {
      onOutcome: (o) => (outcome = o),
      sleepImpl: fake.sleepImpl,
    }).catch((e) => e)
    expect(err).toBeInstanceOf(ExtractionError)
    expect(outcome).toEqual({ attempts: 1, category: 'terminal-error' })
    expect(fake.delays).toHaveLength(0) // never backed off
    expect(completeMock).toHaveBeenCalledTimes(1)
  })

  // ---- cancellation ------------------------------------------------------
  it('(c) an aborted signal mid-backoff stops promptly, makes NO further complete() call, and reports "cancelled"', async () => {
    completeMock.mockRejectedValueOnce(transientErr())
    const fake = makeFakeSleep()
    const controller = new AbortController()
    let outcome: RetryOutcome | undefined
    const p = completeWithRetry('p', {} as any, 3, undefined, {
      signal: controller.signal,
      onOutcome: (o) => (outcome = o),
      sleepImpl: fake.sleepImpl,
      rand: () => 0.5,
    }).catch((e) => e)
    // First attempt has rejected and we are parked on the backoff sleep.
    await Promise.resolve()
    await Promise.resolve()
    expect(fake.delays).toHaveLength(1)
    // ABORT mid-backoff. The interruptible sleep must reject promptly.
    controller.abort()
    const err = await p
    expect(err).toBeInstanceOf(RetryCancelledError)
    expect((err as RetryCancelledError).attempts).toBe(1)
    expect(outcome).toEqual({ attempts: 1, category: 'cancelled' })
    // No SECOND provider attempt after cancellation.
    expect(completeMock).toHaveBeenCalledTimes(1)
  })

  it('(c) an already-aborted signal makes ZERO complete() calls and reports "cancelled"', async () => {
    const controller = new AbortController()
    controller.abort()
    let outcome: RetryOutcome | undefined
    const err = await completeWithRetry('p', {} as any, 3, undefined, {
      signal: controller.signal,
      onOutcome: (o) => (outcome = o),
    }).catch((e) => e)
    expect(err).toBeInstanceOf(RetryCancelledError)
    expect(outcome).toEqual({ attempts: 0, category: 'cancelled' })
    expect(completeMock).not.toHaveBeenCalled()
  })

  // ---- per-attempt eligibility recheck (Req 7.4) -------------------------
  it('(d) runs the eligibility recheck before EVERY attempt (initial + every retry)', async () => {
    completeMock.mockRejectedValueOnce(transientErr()).mockResolvedValueOnce('OK')
    const fake = makeFakeSleep()
    const checkEligible = vi.fn(() => ({ kind: 'eligible' as const }))
    const p = completeWithRetry('p', {} as any, 3, checkEligible, {
      sleepImpl: fake.sleepImpl,
      rand: () => 0.5,
    })
    await Promise.resolve()
    await Promise.resolve()
    fake.fire()
    await p
    // One recheck before attempt 1, one before the retry attempt 2.
    expect(checkEligible).toHaveBeenCalledTimes(2)
    expect(completeMock).toHaveBeenCalledTimes(2)
  })

  it('(d) a mid-backoff ineligibility aborts with PrivacyBlockedError, NO further complete(), reports "privacy_blocked"', async () => {
    completeMock.mockRejectedValueOnce(transientErr())
    const fake = makeFakeSleep()
    let eligible = true
    const checkEligible = vi.fn(() =>
      eligible ? { kind: 'eligible' as const } : { kind: 'privacy_blocked' as const, reason: 'personal' as const }
    )
    let outcome: RetryOutcome | undefined
    const p = completeWithRetry('p', {} as any, 3, checkEligible, {
      onOutcome: (o) => (outcome = o),
      sleepImpl: fake.sleepImpl,
      rand: () => 0.5,
    }).catch((e) => e)
    await Promise.resolve()
    await Promise.resolve()
    // Recording becomes personal DURING the backoff, then the timer fires.
    eligible = false
    fake.fire()
    const err = await p
    expect(err).toBeInstanceOf(PrivacyBlockedError)
    expect(outcome).toEqual({ attempts: 1, category: 'privacy_blocked' })
    // Recheck fired before attempt 1 (eligible) and before the retry (blocked).
    expect(checkEligible).toHaveBeenCalledTimes(2)
    // No second provider attempt — aborted at the recheck.
    expect(completeMock).toHaveBeenCalledTimes(1)
  })

  it('a pre-flight ineligibility on the FIRST attempt makes zero complete() calls', async () => {
    const checkEligible = vi.fn(() => ({ kind: 'privacy_blocked' as const, reason: 'deleted' as const }))
    let outcome: RetryOutcome | undefined
    const err = await completeWithRetry('p', {} as any, 3, checkEligible, {
      onOutcome: (o) => (outcome = o),
    }).catch((e) => e)
    expect(err).toBeInstanceOf(PrivacyBlockedError)
    expect(outcome).toEqual({ attempts: 0, category: 'privacy_blocked' })
    expect(completeMock).not.toHaveBeenCalled()
  })

  // ---- privacy-safe logging (Req 7.6) ------------------------------------
  it('(f) never logs the prompt, transcript, or credentials — only a transport signal + counts', async () => {
    const SECRET_PROMPT = 'SECRET_TRANSCRIPT_BODY_9f83 with a private doctor visit and api_key=sk-TOPSECRET'
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    completeMock.mockRejectedValueOnce(transientErr('ETIMEDOUT')).mockResolvedValueOnce('OK')
    const fake = makeFakeSleep()
    const p = completeWithRetry(SECRET_PROMPT, {} as any, 3, undefined, {
      sleepImpl: fake.sleepImpl,
      rand: () => 0.5,
    })
    await Promise.resolve()
    await Promise.resolve()
    fake.fire()
    await p

    // Exactly one retry warning was emitted; inspect its full serialized form.
    expect(warn).toHaveBeenCalledTimes(1)
    const logged = warn.mock.calls.map((c) => c.map(String).join(' ')).join('\n')
    expect(logged).not.toContain(SECRET_PROMPT)
    expect(logged).not.toContain('SECRET_TRANSCRIPT_BODY_9f83')
    expect(logged).not.toContain('doctor')
    expect(logged).not.toContain('sk-TOPSECRET')
    expect(logged).not.toContain('api_key')
    // It DOES carry the stable transport signal + bounded counts.
    expect(logged).toContain('ETIMEDOUT')
    expect(logged).toMatch(/attempt 1\/3/)
    warn.mockRestore()
  })

  it('(f) the reported outcome carries only counts + category (no prompt/transcript) — JSON-safe', async () => {
    const SECRET = 'PROMPT_SECRET_ABC transcript body'
    completeMock.mockRejectedValue(transientErr())
    const fake = makeFakeSleep()
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    let outcome: RetryOutcome | undefined
    const p = completeWithRetry(SECRET, {} as any, 2, undefined, {
      onOutcome: (o) => (outcome = o),
      sleepImpl: fake.sleepImpl,
      rand: () => 0.5,
    }).catch((e) => e)
    for (let k = 0; k < 4; k++) {
      await Promise.resolve()
      fake.fire()
      await Promise.resolve()
    }
    const err = await p
    expect(outcome).toEqual({ attempts: 2, category: 'transient-exhausted' })
    const serialized = JSON.stringify(outcome)
    expect(serialized).not.toContain('SECRET')
    expect(serialized).not.toContain('transcript')
    // `.retryOutcome` on the thrown error is non-enumerable ⇒ absent from JSON.
    expect(JSON.stringify(err)).not.toContain('PROMPT_SECRET_ABC')
    ;(console.warn as ReturnType<typeof vi.fn>).mockRestore?.()
  })
})
