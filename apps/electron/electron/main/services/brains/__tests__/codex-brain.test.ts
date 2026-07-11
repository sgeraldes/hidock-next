/**
 * CodexBrain tests — verifies capabilities, HONEST auth detection via the
 * codex-companion JSON probe (fallback to `codex login status`, NOT a version
 * probe), argv for `codex exec` with the PROMPT PIPED VIA STDIN (never argv),
 * stdout parsing, and no-throw failure modes. Fake spawn only.
 *
 * @vitest-environment node
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { CodexBrain } from '../codex-brain'
import type { SpawnFn } from '../cli-runner'
import { makeFakeSpawn, type FakeSpawnScript } from './fake-spawn'

const asSpawn = (fn: unknown) => fn as SpawnFn
const COMPANION = 'C:/fake/codex-companion.mjs'

describe('CodexBrain', () => {
  beforeEach(() => vi.clearAllMocks())

  it('advertises generate/chat/agentic only', () => {
    expect([...new CodexBrain().capabilities()].sort()).toEqual(['agentic', 'chat', 'generate'])
  })

  describe('authStatus via companion', () => {
    it('configured=cli-login when companion reports available + loggedIn', async () => {
      const spawn = makeFakeSpawn({ stdout: JSON.stringify({ codex: { available: true }, auth: { loggedIn: true } }), code: 0 })
      const brain = new CodexBrain({ spawn: asSpawn(spawn.fn), env: {}, companionPath: COMPANION })
      const status = await brain.authStatus()
      expect(status.configured).toBe(true)
      expect(status.method).toBe('cli-login')
      // First call runs the companion via node.
      expect(spawn.calls[0]).toMatchObject({ command: 'node', args: [COMPANION, 'setup', '--json'] })
    })

    it('parses companion JSON even when log noise precedes it', async () => {
      const noisy = 'starting...\n' + JSON.stringify({ codex: { available: true }, auth: { loggedIn: true } })
      const spawn = makeFakeSpawn({ stdout: noisy, code: 0 })
      const brain = new CodexBrain({ spawn: asSpawn(spawn.fn), env: {}, companionPath: COMPANION })
      expect((await brain.authStatus()).configured).toBe(true)
    })

    it('not configured when companion reports available but not loggedIn (no key)', async () => {
      const spawn = makeFakeSpawn({ stdout: JSON.stringify({ codex: { available: true }, auth: { loggedIn: false } }), code: 0 })
      const brain = new CodexBrain({ spawn: asSpawn(spawn.fn), env: {}, companionPath: COMPANION })
      const status = await brain.authStatus()
      expect(status.configured).toBe(false)
    })

    it('falls back to `codex login status` when the companion cannot be spawned', async () => {
      // node (companion) errors → fall through to `codex login status`.
      const spawn = makeFakeSpawn((cmd) =>
        cmd === 'node' ? { emitError: true } : ({ stdout: 'Logged in using ChatGPT', code: 0 } as FakeSpawnScript)
      )
      const brain = new CodexBrain({ spawn: asSpawn(spawn.fn), env: {}, companionPath: COMPANION })
      const status = await brain.authStatus()
      expect(status.configured).toBe(true)
      expect(spawn.calls.some((c) => c.command === 'codex' && c.args[0] === 'login' && c.args[1] === 'status')).toBe(true)
    })
  })

  describe('authStatus without companion', () => {
    it('uses `codex login status` and reports cli-login when logged in', async () => {
      const spawn = makeFakeSpawn({ stdout: 'Logged in using ChatGPT', code: 0 })
      const brain = new CodexBrain({ spawn: asSpawn(spawn.fn), env: {} })
      const status = await brain.authStatus()
      expect(status.configured).toBe(true)
      expect(status.method).toBe('cli-login')
      expect(spawn.calls[0]).toMatchObject({ command: 'codex', args: ['login', 'status'] })
    })

    it('NOT configured when installed but not logged in (status ran, no "logged in", no key)', async () => {
      const spawn = makeFakeSpawn({ stdout: 'Not logged in', code: 1 })
      const brain = new CodexBrain({ spawn: asSpawn(spawn.fn), env: {} })
      const status = await brain.authStatus()
      expect(status.configured).toBe(false)
      expect(status.detail).toMatch(/not logged in/i)
    })

    it('reports api-key when OPENAI_API_KEY is set and CLI absent', async () => {
      const spawn = makeFakeSpawn({ emitError: true })
      const brain = new CodexBrain({ spawn: asSpawn(spawn.fn), env: { OPENAI_API_KEY: 'sk' } })
      const status = await brain.authStatus()
      expect(status.configured).toBe(true)
      expect(status.method).toBe('api-key')
    })

    it('not configured when CLI absent and no key', async () => {
      const spawn = makeFakeSpawn({ emitError: true })
      const brain = new CodexBrain({ spawn: asSpawn(spawn.fn), env: {} })
      expect((await brain.authStatus()).configured).toBe(false)
    })
  })

  describe('generate', () => {
    it('builds `codex exec` with the prompt on STDIN (not argv) and returns trimmed stdout', async () => {
      const spawn = makeFakeSpawn({ stdout: '  result text  ', code: 0 })
      const brain = new CodexBrain({ spawn: asSpawn(spawn.fn), env: {} })
      const out = await brain.generate([{ role: 'user', content: 'do it' }])
      expect(out).toBe('result text')
      expect(spawn.calls[0]).toMatchObject({ command: 'codex', args: ['exec'] }) // prompt NOT in argv
      expect(spawn.lastChild?.stdin.write).toHaveBeenCalledWith('User: do it')
    })

    it('inserts --model after exec (prompt still on stdin)', async () => {
      const spawn = makeFakeSpawn({ stdout: 'ok', code: 0 })
      const brain = new CodexBrain({ spawn: asSpawn(spawn.fn), env: {} })
      await brain.generate([{ role: 'user', content: 'q' }], { model: 'gpt-x' })
      expect(spawn.calls[0].args).toEqual(['exec', '--model', 'gpt-x'])
      expect(spawn.lastChild?.stdin.write).toHaveBeenCalledWith('User: q')
    })

    it('returns null on non-zero exit', async () => {
      const spawn = makeFakeSpawn({ stderr: 'nope', code: 1 })
      const brain = new CodexBrain({ spawn: asSpawn(spawn.fn), env: {} })
      expect(await brain.generate([{ role: 'user', content: 'q' }])).toBeNull()
    })

    it('returns null on spawn error', async () => {
      const spawn = makeFakeSpawn({ emitError: true })
      const brain = new CodexBrain({ spawn: asSpawn(spawn.fn), env: {} })
      expect(await brain.generate([{ role: 'user', content: 'q' }])).toBeNull()
    })

    it('returns null + kills on abort', async () => {
      const spawn = makeFakeSpawn({ never: true })
      const brain = new CodexBrain({ spawn: asSpawn(spawn.fn), env: {} })
      const controller = new AbortController()
      const p = brain.generate([{ role: 'user', content: 'q' }], { signal: controller.signal })
      controller.abort()
      expect(await p).toBeNull()
      expect(spawn.lastChild?.kill).toHaveBeenCalled()
    })
  })
})
