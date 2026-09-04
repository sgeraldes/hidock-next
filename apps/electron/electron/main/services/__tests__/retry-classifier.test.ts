/**
 * hidock-graph-extraction-hardening Task 10.1 (Req 7.1, 7.7) — focused unit
 * tests for the TYPED transient-transport retry classifier
 * (`isTransientTransportError`) in knowledge-graph-service.ts.
 *
 * These assert the classifier keys off genuine transport SIGNALS
 * (Node/undici error codes + classes + HTTP status) and NOT off a `"network"`
 * message substring, and that the typed extraction-error hierarchy
 * (`ExtractionError`/`SchemaError`) is TERMINAL for this fetch-retry path.
 *
 * The classifier is a pure, stateless function. We mock the same heavy
 * side-effecting deps the other service tests mock (electron/config/
 * ai-providers/file-storage) purely so importing the module doesn't touch the
 * real Electron/DB layer — the tests themselves never touch a DB.
 */

// @vitest-environment node

import { describe, it, expect, vi } from 'vitest'
import { tmpdir } from 'os'
import { join } from 'path'

// ---------------------------------------------------------------------------
// Top-level mocks (hoisted before imports) — mirror knowledge-graph-service.test.ts
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
  getDatabasePath: vi.fn(() => join(tmpdir(), `hidock-kg-retry-test-${Date.now()}-${++_dbCounter}.sqlite`))
}))

// ---------------------------------------------------------------------------
// Imports (after mocks)
// ---------------------------------------------------------------------------

import { isTransientTransportError } from '../knowledge-graph-service'
import { ExtractionError, SchemaError } from '@hidock/knowledge-graph'

/** Build a `TypeError('fetch failed')` whose `.cause` carries a Node code — the
 *  exact shape a dropped local `fetch()` throws. */
function fetchFailed(code: string): TypeError {
  const err = new TypeError('fetch failed')
  ;(err as { cause?: unknown }).cause = Object.assign(new Error('underlying'), { code })
  return err
}

function withCode(message: string, code: string): Error {
  return Object.assign(new Error(message), { code })
}

function withStatus(message: string, status: number): Error {
  return Object.assign(new Error(message), { status })
}

describe('isTransientTransportError (task 10.1, Req 7.1/7.7)', () => {
  describe('retryable — genuine transient transport signals', () => {
    it('retries on ECONNRESET code', () => {
      expect(isTransientTransportError(withCode('read ECONNRESET', 'ECONNRESET'))).toBe(true)
    })

    it('retries on ETIMEDOUT code', () => {
      expect(isTransientTransportError(withCode('connect ETIMEDOUT', 'ETIMEDOUT'))).toBe(true)
    })

    it('retries on ECONNREFUSED / EPIPE / ENOTFOUND / EAI_AGAIN codes', () => {
      for (const code of ['ECONNREFUSED', 'EPIPE', 'ENOTFOUND', 'EAI_AGAIN']) {
        expect(isTransientTransportError(withCode(`op ${code}`, code))).toBe(true)
      }
    })

    it('retries on an AbortError (name-based class)', () => {
      const abort = new Error('The operation was aborted')
      abort.name = 'AbortError'
      expect(isTransientTransportError(abort)).toBe(true)
    })

    it('retries on a 503 (and other transient HTTP status classes)', () => {
      for (const status of [408, 425, 429, 500, 502, 503, 504]) {
        expect(isTransientTransportError(withStatus(`server said ${status}`, status))).toBe(true)
      }
    })

    it('retries on an undici transient socket class (UND_ERR_SOCKET)', () => {
      expect(isTransientTransportError(withCode('other side closed', 'UND_ERR_SOCKET'))).toBe(true)
      expect(isTransientTransportError(withCode('connect timeout', 'UND_ERR_CONNECT_TIMEOUT'))).toBe(true)
    })

    it('retries on TypeError("fetch failed") whose cause.code is ECONNRESET (via cause, not message)', () => {
      expect(isTransientTransportError(fetchFailed('ECONNRESET'))).toBe(true)
    })
  })

  describe('terminal — NOT retryable', () => {
    it('does not retry a plain non-transport Error', () => {
      expect(isTransientTransportError(new Error('something went wrong'))).toBe(false)
    })

    it('does not retry an ExtractionError (schema/invalid-output is terminal here)', () => {
      expect(isTransientTransportError(new ExtractionError())).toBe(false)
    })

    it('does not retry a SchemaError (subclass of ExtractionError, terminal here)', () => {
      expect(isTransientTransportError(new SchemaError())).toBe(false)
    })

    it('does not retry terminal HTTP 4xx (400/401/403/404)', () => {
      for (const status of [400, 401, 403, 404]) {
        expect(isTransientTransportError(withStatus(`client error ${status}`, status))).toBe(false)
      }
    })

    // The critical Req 7.7 proof: the OLD heuristic matched the word "network"
    // anywhere in the message. The typed classifier must NOT retry an error that
    // merely CONTAINS "network" but carries no transient code/class/status.
    it('does NOT retry an error whose message merely contains "network" (substring heuristic is gone)', () => {
      expect(isTransientTransportError(new Error('the network config file is invalid'))).toBe(false)
      expect(isTransientTransportError(new Error('network policy rejected this request'))).toBe(false)
      // Even a fetch-failed-shaped TypeError with a NON-transient cause code is terminal.
      expect(isTransientTransportError(fetchFailed('EACCES'))).toBe(false)
    })

    it('does not retry a non-Error value', () => {
      expect(isTransientTransportError('network')).toBe(false)
      expect(isTransientTransportError(null)).toBe(false)
      expect(isTransientTransportError(undefined)).toBe(false)
    })
  })
})
