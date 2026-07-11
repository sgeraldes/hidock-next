// @vitest-environment node

/**
 * Round-4 finding 2 — structured analysis-error classification.
 *
 * classifyAnalysisError runs AT THE SERVICE/IPC boundary, where the raw
 * provider error (structured status codes, canonical English tokens) is
 * available — so the renderer keys its retry policy off `kind`, never off
 * possibly-localized message text. Pure functions: no DB, no network.
 */

import { describe, it, expect, vi } from 'vitest'
import { tmpdir } from 'os'
import { join } from 'path'

// Keep the import chain Electron-free: timeline-analysis → database →
// file-storage → config touches Electron `app` at load; mocking file-storage
// severs that (same pattern as timeline-analysis.test.ts). No DB is opened —
// these tests exercise only pure functions.
vi.mock('../file-storage', () => ({
  getDatabasePath: () => join(tmpdir(), `hidock-classify-${process.pid}.sqlite`)
}))

import {
  classifyAnalysisError,
  parseRetryAfter,
  RETRY_AFTER_MAX_MS,
  deriveSentimentSegments,
  type SpeakerTurn
} from '../timeline-analysis'

describe('classifyAnalysisError', () => {
  it('maps structured 401/403 to auth — even with a fully localized message', () => {
    expect(classifyAnalysisError({ status: 401, message: 'no autorizado' }).kind).toBe('auth')
    expect(classifyAnalysisError({ httpStatus: 403, message: 'zugriff verweigert' }).kind).toBe('auth')
    // Numeric `code` variants (some SDKs use code instead of status).
    expect(classifyAnalysisError({ code: 403, message: 'accès refusé' }).kind).toBe('auth')
  })

  it('maps auth tokens in the message when no structured status exists', () => {
    expect(classifyAnalysisError(new Error('API key not valid. Please pass a valid API key.')).kind).toBe('auth')
    expect(classifyAnalysisError(new Error('Request had invalid authentication credentials')).kind).toBe('auth')
    expect(classifyAnalysisError(new Error('PERMISSION_DENIED: permission denied for resource')).kind).toBe('auth')
  })

  it('maps 429 to rate-limit and parses a retry-after hint into milliseconds', () => {
    const withSeconds = classifyAnalysisError({ status: 429, message: 'Too many requests. Retry after 12s' })
    expect(withSeconds.kind).toBe('rate-limit')
    expect(withSeconds.retryAfterMs).toBe(12000)

    const withRetryIn = classifyAnalysisError(new Error('rate limit exceeded, retry in 1.5 seconds'))
    expect(withRetryIn.kind).toBe('rate-limit')
    expect(withRetryIn.retryAfterMs).toBe(1500)

    const noHint = classifyAnalysisError({ status: 429, message: 'Too Many Requests' })
    expect(noHint.kind).toBe('rate-limit')
    expect(noHint.retryAfterMs).toBeUndefined()
  })

  it('maps quota/billing exhaustion to quota', () => {
    expect(classifyAnalysisError(new Error('RESOURCE_EXHAUSTED: quota exceeded for quota metric')).kind).toBe('quota')
    expect(classifyAnalysisError(new Error('billing account disabled')).kind).toBe('quota')
  })

  it('maps 400 / invalid-argument to invalid-input', () => {
    expect(classifyAnalysisError({ status: 400, message: 'peticion incorrecta' }).kind).toBe('invalid-input')
    expect(classifyAnalysisError(new Error('INVALID_ARGUMENT: Invalid argument provided')).kind).toBe('invalid-input')
  })

  it('maps transport failures and 5xx to network', () => {
    expect(classifyAnalysisError(new Error('fetch failed')).kind).toBe('network')
    expect(classifyAnalysisError(new Error('connect ECONNREFUSED 142.250.0.1:443')).kind).toBe('network')
    expect(classifyAnalysisError(new Error('request timed out after 30000ms')).kind).toBe('network')
    expect(classifyAnalysisError({ status: 503, message: 'service unavailable' }).kind).toBe('network')
  })

  it('falls back to unknown for unrecognized shapes (consumers treat it conservatively)', () => {
    expect(classifyAnalysisError(new Error('algo salió mal')).kind).toBe('unknown')
    expect(classifyAnalysisError(undefined).kind).toBe('unknown')
    expect(classifyAnalysisError('¯\\_(ツ)_/¯').kind).toBe('unknown')
  })

  it('prefers the structured status over misleading message tokens', () => {
    // Message mentions "quota", but the structured status is 401 → auth wins.
    expect(classifyAnalysisError({ status: 401, message: 'quota check failed: unauthorized' }).kind).toBe('auth')
  })
})

// ---------------------------------------------------------------------------
// Round-5 finding 2 — nested / aggregate / SDK-wrapper shapes must classify.
// ---------------------------------------------------------------------------
describe('classifyAnalysisError — nested and aggregate error shapes', () => {
  it('classifies a 401 carried on Error.cause as auth (not unknown)', () => {
    const err = new Error('mensaje envoltorio localizado', { cause: { status: 401, message: 'no autorizado' } })
    expect(classifyAnalysisError(err).kind).toBe('auth')
  })

  it('classifies an AggregateError whose child is a 429 as rate-limit', () => {
    const child = Object.assign(new Error('demasiadas solicitudes'), { status: 429 })
    const agg = new AggregateError([new Error('otro fallo'), child], 'varios errores')
    expect(classifyAnalysisError(agg).kind).toBe('rate-limit')
  })

  it('classifies a realistic Gemini SDK wrapper holding a fetch Response + Retry-After header', () => {
    // GoogleGenerativeAIFetchError-style: wrapper Error with a `response`
    // carrying the real status and Headers (get() interface).
    const response = {
      status: 429,
      statusText: 'Too Many Requests',
      headers: { get: (name: string) => (name.toLowerCase() === 'retry-after' ? '30' : null) }
    }
    const wrapper = Object.assign(new Error('[GoogleGenerativeAI Error]: Error fetching from the API'), { response })
    const classified = classifyAnalysisError(wrapper)
    expect(classified.kind).toBe('rate-limit')
    expect(classified.retryAfterMs).toBe(30_000)
  })

  it('classifies a nested `error` envelope (JSON API shape)', () => {
    const err = { message: 'request failed', error: { code: 403, message: 'permiso denegado' } }
    expect(classifyAnalysisError(err).kind).toBe('auth')
  })

  it('the most actionable kind wins across nodes (nested auth beats top-level network)', () => {
    const err = Object.assign(new Error('fetch failed'), { cause: { status: 401 } })
    expect(classifyAnalysisError(err).kind).toBe('auth')
  })

  it('is cycle-safe and depth-bounded (self-referential cause does not hang)', () => {
    const err = new Error('bucle') as Error & { cause?: unknown }
    err.cause = err
    expect(classifyAnalysisError(err).kind).toBe('unknown')
    // Deeply nested beyond the bound (depth > 4) is ignored, not crashed on.
    const deep: Record<string, unknown> = { message: 'lvl0' }
    let cursor = deep
    for (let i = 1; i <= 6; i++) {
      cursor.cause = { message: `lvl${i}`, ...(i === 6 ? { status: 401 } : {}) }
      cursor = cursor.cause as Record<string, unknown>
    }
    expect(classifyAnalysisError(deep).kind).toBe('unknown')
  })
})

// ---------------------------------------------------------------------------
// Round-5 finding 3 — retry-after parsing: delta-seconds, HTTP-date, clamping.
// ---------------------------------------------------------------------------
describe('parseRetryAfter', () => {
  const NOW = Date.UTC(2026, 6, 11, 12, 0, 0) // 2026-07-11T12:00:00Z

  it('parses delta-seconds (integer and fractional)', () => {
    expect(parseRetryAfter('120', NOW)).toBe(120_000)
    expect(parseRetryAfter('1.5', NOW)).toBe(1500)
    expect(parseRetryAfter(30, NOW)).toBe(30_000) // numeric seconds
  })

  it('parses the HTTP-date form relative to now', () => {
    const inTwoMinutes = new Date(NOW + 2 * 60 * 1000).toUTCString()
    expect(parseRetryAfter(inTwoMinutes, NOW)).toBe(120_000)
  })

  it('clamps absurd values to RETRY_AFTER_MAX_MS (15 minutes)', () => {
    expect(parseRetryAfter('86400', NOW)).toBe(RETRY_AFTER_MAX_MS) // a day → 15 min
    const nextWeek = new Date(NOW + 7 * 24 * 60 * 60 * 1000).toUTCString()
    expect(parseRetryAfter(nextWeek, NOW)).toBe(RETRY_AFTER_MAX_MS)
    expect(parseRetryAfter(1e12, NOW)).toBe(RETRY_AFTER_MAX_MS)
  })

  it('rejects invalid, non-finite, non-positive, and past-date input → undefined', () => {
    expect(parseRetryAfter('soon', NOW)).toBeUndefined()
    expect(parseRetryAfter('', NOW)).toBeUndefined()
    expect(parseRetryAfter(null, NOW)).toBeUndefined()
    expect(parseRetryAfter(Number.NaN, NOW)).toBeUndefined()
    expect(parseRetryAfter(Number.POSITIVE_INFINITY, NOW)).toBeUndefined()
    expect(parseRetryAfter(-5, NOW)).toBeUndefined()
    const past = new Date(NOW - 60_000).toUTCString()
    expect(parseRetryAfter(past, NOW)).toBeUndefined()
  })
})

describe('deriveSentimentSegments — raw scorer error surfaces via onError', () => {
  const turns: SpeakerTurn[] = [
    { speaker: 'A', start: 0, end: 30, text: 'hello there everyone' },
    { speaker: 'B', start: 30, end: 60, text: 'good morning team' }
  ]

  it('invokes onError with the RAW error and returns an empty series (non-throwing contract)', async () => {
    const raw = Object.assign(new Error('Too many requests. Retry after 12s'), { status: 429 })
    const onError = vi.fn()
    const segments = await deriveSentimentSegments(turns, {
      scoreWindows: async () => { throw raw },
      onError
    })
    expect(segments).toEqual([])
    expect(onError).toHaveBeenCalledWith(raw)
    // And the raw error classifies with full structure intact.
    const classified = classifyAnalysisError(onError.mock.calls[0][0])
    expect(classified).toMatchObject({ kind: 'rate-limit', retryAfterMs: 12000 })
  })

  it('does not invoke onError on success', async () => {
    const onError = vi.fn()
    const segments = await deriveSentimentSegments(turns, {
      scoreWindows: async (windows) => new Map(windows.map((w) => [w.index, 0.5])),
      onError
    })
    expect(segments.length).toBeGreaterThan(0)
    expect(onError).not.toHaveBeenCalled()
  })
})
