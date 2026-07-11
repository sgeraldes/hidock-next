/**
 * saveConfig two-file transaction — the store-then-config split-brain, the OTHER
 * direction (Codex review HIGH).
 *
 * saveConfig commits the Gemini key to the credential store (brains.json) FIRST,
 * then writes config.json. If the config.json write fails AFTER a successful store
 * key change, the store would hold the NEW key while config.json + a restart's
 * boot reconciliation flip back to the OLD plaintext — and resolveGeminiApiKey()
 * prefers the store, so a *failed* save would have silently changed the active
 * credential. saveConfig must therefore COMPENSATE: restore the prior store value
 * and the prior in-memory config, then rethrow — leaving disk, memory, AND the
 * effective key all on the PREVIOUS value. If compensation itself fails it must be
 * logged loudly and explicitly (split-brain, naming both files).
 *
 * These tests mock `fs` so the config.json write (renameSync) can be forced to
 * fail on demand, and mock the credential store so store writes / their restore
 * can be independently failed.
 *
 * @vitest-environment node
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { tmpdir } from 'os'

vi.mock('electron', () => ({
  app: { getPath: () => tmpdir() },
  safeStorage: { isEncryptionAvailable: () => false },
}))

// --- fs mock: config.json writes go through here; renameSync is the commit point
// we can force to fail (models disk-full / permissions / AV after the temp write).
let failConfigWrite = false
vi.mock('fs', () => ({
  existsSync: vi.fn(() => true), // dir + temp always "exist" → skip mkdir, exercise temp cleanup
  readFileSync: vi.fn(() => '{}'),
  writeFileSync: vi.fn(() => {}),
  mkdirSync: vi.fn(() => {}),
  renameSync: vi.fn(() => {
    if (failConfigWrite) throw new Error('ENOSPC: simulated config.json write failure')
  }),
  unlinkSync: vi.fn(() => {}),
  openSync: vi.fn(() => 3),
  fsyncSync: vi.fn(() => {}),
  closeSync: vi.fn(() => {}),
}))

// --- credential-store mock: stateful, with independent failure controls.
let storeState: Record<string, string | null> = {}
let setSecretShouldFail = false
let setSecretCallCount = 0
let setSecretFailFromCall = Infinity // 1-based: calls at/after this index return false
const mockGetSecret = vi.fn((_brainId: string, key: string) => storeState[key] ?? null)
const mockSetSecret = vi.fn((_brainId: string, key: string, value: string | null): boolean => {
  setSecretCallCount++
  if (setSecretShouldFail || setSecretCallCount >= setSecretFailFromCall) return false
  if (value === null || value === '') delete storeState[key]
  else storeState[key] = value
  return true
})
vi.mock('../brains/brain-credential-store', () => ({
  getBrainCredentialStore: () => ({ getSecret: mockGetSecret, setSecret: mockSetSecret }),
}))

// Mock the SDK so importing the brain (for resolveGeminiApiKey) is side-effect-free.
vi.mock('@google/generative-ai', () => ({ GoogleGenerativeAI: vi.fn(() => ({})) }))

import { updateConfig, getConfig } from '../config'
import { resolveGeminiApiKey } from '../brains/gemini-api-brain'

beforeEach(async () => {
  // Clean baseline: empty store + empty in-memory key, config.json writable.
  storeState = {}
  setSecretShouldFail = false
  setSecretCallCount = 0
  setSecretFailFromCall = Infinity
  failConfigWrite = false
  vi.clearAllMocks()
  await updateConfig('transcription', { geminiApiKey: '' })
  storeState = {}
  setSecretCallCount = 0
  vi.clearAllMocks()
})

describe('saveConfig — config-write failure after a successful store write (split-brain, other direction)', () => {
  it('keeps disk, memory, AND the effective key on the PREVIOUS key (store compensated)', async () => {
    // Baseline: key = sk-prev everywhere, config.json writes fine.
    await updateConfig('transcription', { geminiApiKey: 'sk-prev' }) // pragma: allowlist secret
    expect(storeState.apiKey).toBe('sk-prev')
    expect(resolveGeminiApiKey()).toBe('sk-prev')

    // A key CHANGE whose store write succeeds but whose config.json write fails.
    failConfigWrite = true
    setSecretCallCount = 0
    await expect(
      updateConfig('transcription', { geminiApiKey: 'sk-new' }) // pragma: allowlist secret
    ).rejects.toThrow()

    // Store compensated back to the prior key → NOT split-brained.
    expect(storeState.apiKey).toBe('sk-prev')
    // In-memory config restored.
    expect(getConfig().transcription.geminiApiKey).toBe('sk-prev')
    // Effective key (resolveGeminiApiKey precedence: store first) stays previous.
    expect(resolveGeminiApiKey()).toBe('sk-prev')
  })

  it('logs an explicit split-brain warning (naming both files) when compensation ALSO fails', async () => {
    await updateConfig('transcription', { geminiApiKey: 'sk-prev' }) // pragma: allowlist secret
    expect(storeState.apiKey).toBe('sk-prev')

    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    failConfigWrite = true
    // First store write of this save (the key change → sk-new) succeeds; the
    // second (the compensation restore) fails.
    setSecretCallCount = 0
    setSecretFailFromCall = 2
    await expect(
      updateConfig('transcription', { geminiApiKey: 'sk-new' }) // pragma: allowlist secret
    ).rejects.toThrow()

    // Compensation failed → the store is genuinely split-brained (holds sk-new)…
    expect(storeState.apiKey).toBe('sk-new')
    // …and that was surfaced loudly and explicitly, naming BOTH files.
    const splitBrainCall = errSpy.mock.calls.find((c) => String(c[0]).includes('SPLIT-BRAIN'))
    expect(splitBrainCall).toBeDefined()
    const msg = String(splitBrainCall![0])
    expect(msg).toContain('config.json')
    expect(msg).toContain('brains.json')
    // In-memory config was still restored to the prior key.
    expect(getConfig().transcription.geminiApiKey).toBe('sk-prev')
    errSpy.mockRestore()
  })

  it('does NOT rollback/touch the store when a NON-key config save fails to write', async () => {
    await updateConfig('transcription', { geminiApiKey: 'sk-keep' }) // pragma: allowlist secret
    expect(storeState.apiKey).toBe('sk-keep')

    failConfigWrite = true
    mockSetSecret.mockClear()
    setSecretCallCount = 0
    await expect(updateConfig('ui', { theme: 'dark' })).rejects.toThrow()

    // Key never changed → no compensation write, store untouched, no split-brain.
    expect(mockSetSecret).not.toHaveBeenCalled()
    expect(storeState.apiKey).toBe('sk-keep')
    // In-memory config restored (the failed ui change did not stick).
    expect(getConfig().ui.theme).not.toBe('dark')
    expect(resolveGeminiApiKey()).toBe('sk-keep')
  })
})

describe('saveConfig — unrelated (non-key) saves are unaffected by the atomic write path', () => {
  it('writes a non-key config change normally and leaves the store alone', async () => {
    await updateConfig('transcription', { geminiApiKey: 'sk-keep' }) // pragma: allowlist secret
    mockSetSecret.mockClear()

    await expect(updateConfig('ui', { theme: 'dark' })).resolves.toBeUndefined()

    expect(getConfig().ui.theme).toBe('dark')
    // Store already matched the desired key → reconcile is a no-op (no write).
    expect(mockSetSecret).not.toHaveBeenCalled()
    expect(storeState.apiKey).toBe('sk-keep')
  })
})
