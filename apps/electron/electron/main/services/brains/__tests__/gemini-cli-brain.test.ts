/**
 * GeminiCliBrain tests — verifies capabilities, key-driven auth (env or the app's
 * stored Gemini key), argv for `gemini -p ... --output-format json`, JSON envelope
 * parsing, key injection into the child env, and no-throw failure modes.
 *
 * @vitest-environment node
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

// Stub resolveGeminiApiKey so the test controls the app's stored key without
// pulling config / @google/generative-ai into the import graph.
const mockResolveKey = vi.fn<() => string>()
vi.mock('../gemini-api-brain', () => ({ resolveGeminiApiKey: () => mockResolveKey() }))

import { GeminiCliBrain, parseGeminiJson } from '../gemini-cli-brain'
import type { SpawnFn } from '../cli-runner'
import { makeFakeSpawn } from './fake-spawn'

const asSpawn = (fn: unknown) => fn as SpawnFn

describe('parseGeminiJson', () => {
  it('extracts the response field from the JSON envelope', () => {
    expect(parseGeminiJson(JSON.stringify({ response: '  hi there  ', stats: {} }))).toBe('hi there')
  })
  it('returns null when JSON has no usable response', () => {
    expect(parseGeminiJson(JSON.stringify({ stats: {} }))).toBeNull()
  })
  it('falls back to raw text when stdout is not JSON', () => {
    expect(parseGeminiJson('plain text answer')).toBe('plain text answer')
  })
  it('returns null on empty stdout', () => {
    expect(parseGeminiJson('   ')).toBeNull()
  })
})

describe('GeminiCliBrain', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockResolveKey.mockReturnValue('')
  })

  it('advertises generate/chat/agentic only (no embed)', () => {
    expect([...new GeminiCliBrain().capabilities()].sort()).toEqual(['agentic', 'chat', 'generate'])
  })

  describe('authStatus', () => {
    it('configured=api-key labelled "GEMINI_API_KEY env" when env has the key', async () => {
      const spawn = makeFakeSpawn({ stdout: '0.49.0', code: 0 })
      const brain = new GeminiCliBrain({ spawn: asSpawn(spawn.fn), env: { GEMINI_API_KEY: 'k' } })
      const status = await brain.authStatus()
      expect(status.configured).toBe(true)
      expect(status.method).toBe('api-key')
      expect(status.detail).toMatch(/GEMINI_API_KEY env/)
      expect(spawn.calls[0]).toMatchObject({ command: 'gemini', args: ['--version'] })
    })

    it('configured=api-key labelled "app key (injected)" when the app stored key resolves', async () => {
      mockResolveKey.mockReturnValue('stored-key')
      const spawn = makeFakeSpawn({ stdout: '0.49.0', code: 0 })
      const brain = new GeminiCliBrain({ spawn: asSpawn(spawn.fn), env: {} })
      const status = await brain.authStatus()
      expect(status.configured).toBe(true)
      expect(status.method).toBe('api-key')
      expect(status.detail).toMatch(/app key \(injected\)/)
    })

    it('configured=oauth when no key but the CLI has an OAuth login (honest: presence, not verified)', async () => {
      const spawn = makeFakeSpawn({ stdout: '0.49.0', code: 0 })
      const brain = new GeminiCliBrain({
        spawn: asSpawn(spawn.fn),
        env: {},
        hasOAuthLogin: () => true,
      })
      const status = await brain.authStatus()
      expect(status.configured).toBe(true)
      expect(status.method).toBe('oauth')
      expect(status.detail).toMatch(/OAuth login/)
    })

    it('not configured when CLI present but no key AND no OAuth login', async () => {
      const spawn = makeFakeSpawn({ stdout: '0.49.0', code: 0 })
      const brain = new GeminiCliBrain({
        spawn: asSpawn(spawn.fn),
        env: {},
        hasOAuthLogin: () => false,
      })
      const status = await brain.authStatus()
      expect(status.configured).toBe(false)
      expect(status.method).toBe('none')
    })

    it('not configured when the CLI is absent (even with a key)', async () => {
      const spawn = makeFakeSpawn({ emitError: true })
      const brain = new GeminiCliBrain({ spawn: asSpawn(spawn.fn), env: { GEMINI_API_KEY: 'k' } })
      expect((await brain.authStatus()).configured).toBe(false)
    })
  })

  describe('generate', () => {
    it('builds `gemini -p "" --output-format json` with the prompt on STDIN (not argv), parses .response', async () => {
      const spawn = makeFakeSpawn({ stdout: JSON.stringify({ response: 'answer' }), code: 0 })
      const brain = new GeminiCliBrain({ spawn: asSpawn(spawn.fn), env: { GEMINI_API_KEY: 'k' } })
      const out = await brain.generate([{ role: 'user', content: 'q' }])
      expect(out).toBe('answer')
      expect(spawn.calls[0].args).toEqual(['-p', '', '--output-format', 'json']) // prompt NOT in argv
      expect(spawn.lastChild?.stdin.write).toHaveBeenCalledWith('User: q') // prompt on stdin
    })

    it('appends --model when set (prompt still on stdin)', async () => {
      const spawn = makeFakeSpawn({ stdout: JSON.stringify({ response: 'x' }), code: 0 })
      const brain = new GeminiCliBrain({ spawn: asSpawn(spawn.fn), env: { GEMINI_API_KEY: 'k' } })
      await brain.generate([{ role: 'user', content: 'q' }], { model: 'gemini-3-pro' })
      expect(spawn.calls[0].args).toEqual(['-p', '', '--output-format', 'json', '--model', 'gemini-3-pro'])
      expect(spawn.lastChild?.stdin.write).toHaveBeenCalledWith('User: q')
    })

    it('injects the app stored key into the child env when env lacks one', async () => {
      mockResolveKey.mockReturnValue('stored-key')
      const spawn = makeFakeSpawn({ stdout: JSON.stringify({ response: 'x' }), code: 0 })
      const brain = new GeminiCliBrain({ spawn: asSpawn(spawn.fn), env: {} })
      await brain.generate([{ role: 'user', content: 'q' }])
      const opts = spawn.calls[0].options as { env: Record<string, string> }
      expect(opts.env.GEMINI_API_KEY).toBe('stored-key')
    })

    it('returns null on non-zero exit', async () => {
      const spawn = makeFakeSpawn({ stderr: 'err', code: 1 })
      const brain = new GeminiCliBrain({ spawn: asSpawn(spawn.fn), env: { GEMINI_API_KEY: 'k' } })
      expect(await brain.generate([{ role: 'user', content: 'q' }])).toBeNull()
    })

    it('returns null on spawn error', async () => {
      const spawn = makeFakeSpawn({ emitError: true })
      const brain = new GeminiCliBrain({ spawn: asSpawn(spawn.fn), env: { GEMINI_API_KEY: 'k' } })
      expect(await brain.generate([{ role: 'user', content: 'q' }])).toBeNull()
    })

    it('returns null + kills on abort', async () => {
      const spawn = makeFakeSpawn({ never: true })
      const brain = new GeminiCliBrain({ spawn: asSpawn(spawn.fn), env: { GEMINI_API_KEY: 'k' } })
      const controller = new AbortController()
      const p = brain.generate([{ role: 'user', content: 'q' }], { signal: controller.signal })
      controller.abort()
      expect(await p).toBeNull()
      expect(spawn.lastChild?.kill).toHaveBeenCalled()
    })
  })
})
