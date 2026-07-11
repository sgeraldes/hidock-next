/**
 * KiroCliBrain tests — verifies capabilities, HONEST auth (headless REQUIRES a
 * KIRO_API_KEY; an interactive login is NOT sufficient), the documented headless
 * argv `kiro-cli chat --no-interactive --trust-tools= "<prompt>"`, key injection,
 * no-throw failure modes, and — critically — that we ONLY ever spawn the headless
 * `kiro-cli` binary and NEVER the `kiro` IDE launcher / a GUI window. Fake spawn only.
 *
 * @vitest-environment node
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { KiroCliBrain } from '../kiro-cli-brain'
import type { SpawnFn } from '../cli-runner'
import { makeFakeSpawn } from './fake-spawn'

const asSpawn = (fn: unknown) => fn as SpawnFn
const VERSION = 'kiro-cli-chat 2.11.0'

describe('KiroCliBrain', () => {
  beforeEach(() => vi.clearAllMocks())

  it('advertises generate/chat/agentic only (no audio, no embed)', () => {
    const brain = new KiroCliBrain()
    const caps = brain.capabilities()
    expect([...caps].sort()).toEqual(['agentic', 'chat', 'generate'])
    expect(caps.has('analyzeAudio')).toBe(false)
    expect(caps.has('embed')).toBe(false)
  })

  describe('authStatus', () => {
    it('not configured (kiro-cli not on PATH) on spawn error', async () => {
      const spawn = makeFakeSpawn({ emitError: true })
      const brain = new KiroCliBrain({ spawn: asSpawn(spawn.fn), env: {}, getStoredKey: () => '' })
      const status = await brain.authStatus()
      expect(status.configured).toBe(false)
      expect(status.method).toBe('none')
      expect(status.detail).toMatch(/not on PATH/i)
      // Presence probe is the headless CLI + --version — never the `kiro` IDE.
      expect(spawn.calls[0]).toMatchObject({ command: 'kiro-cli', args: ['--version'] })
    })

    it('installed but NO API key → NOT configured (login is not enough for headless)', async () => {
      const spawn = makeFakeSpawn({ stdout: VERSION, code: 0 })
      const brain = new KiroCliBrain({ spawn: asSpawn(spawn.fn), env: {}, getStoredKey: () => '' })
      const status = await brain.authStatus()
      expect(status.configured).toBe(false)
      expect(status.method).toBe('none')
      expect(status.detail).toMatch(/headless mode needs a Kiro API key/i)
      expect(status.detail).toMatch(/KIRO_API_KEY/)
    })

    it('configured=api-key when KIRO_API_KEY is set in the env', async () => {
      const spawn = makeFakeSpawn({ stdout: VERSION, code: 0 })
      const brain = new KiroCliBrain({ spawn: asSpawn(spawn.fn), env: { KIRO_API_KEY: 'kk' }, getStoredKey: () => '' })
      const status = await brain.authStatus()
      expect(status.configured).toBe(true)
      expect(status.method).toBe('api-key')
      expect(status.detail).toMatch(/Kiro API key present/)
    })

    it('configured=api-key when the app stored Kiro key resolves', async () => {
      const spawn = makeFakeSpawn({ stdout: VERSION, code: 0 })
      const brain = new KiroCliBrain({ spawn: asSpawn(spawn.fn), env: {}, getStoredKey: () => 'stored-kiro' })
      expect((await brain.authStatus()).configured).toBe(true)
    })
  })

  describe('generate', () => {
    it('returns null WITHOUT spawning when there is no API key (never launches a session)', async () => {
      const spawn = makeFakeSpawn({ stdout: 'x', code: 0 })
      const brain = new KiroCliBrain({ spawn: asSpawn(spawn.fn), env: {}, getStoredKey: () => '' })
      expect(await brain.generate([{ role: 'user', content: 'q' }])).toBeNull()
      expect(spawn.calls).toHaveLength(0)
    })

    it('returns null on empty prompt without spawning', async () => {
      const spawn = makeFakeSpawn({ stdout: 'x', code: 0 })
      const brain = new KiroCliBrain({ spawn: asSpawn(spawn.fn), env: { KIRO_API_KEY: 'kk' }, getStoredKey: () => '' })
      expect(await brain.generate([])).toBeNull()
      expect(spawn.calls).toHaveLength(0)
    })

    it('builds documented headless argv `chat --no-interactive --trust-tools= "<prompt>"`', async () => {
      const spawn = makeFakeSpawn({ stdout: '  the answer  ', code: 0 })
      const brain = new KiroCliBrain({ spawn: asSpawn(spawn.fn), env: { KIRO_API_KEY: 'kk' }, getStoredKey: () => '' })
      const out = await brain.generate([{ role: 'user', content: 'q' }])
      expect(out).toBe('the answer')
      expect(spawn.calls[0]).toMatchObject({
        command: 'kiro-cli',
        args: ['chat', '--no-interactive', '--trust-tools=', 'User: q'],
      })
    })

    it('inserts --model before the prompt when set', async () => {
      const spawn = makeFakeSpawn({ stdout: 'ok', code: 0 })
      const brain = new KiroCliBrain({ spawn: asSpawn(spawn.fn), env: { KIRO_API_KEY: 'kk' }, getStoredKey: () => '' })
      await brain.generate([{ role: 'user', content: 'q' }], { model: 'sonnet' })
      expect(spawn.calls[0].args).toEqual(['chat', '--no-interactive', '--trust-tools=', '--model', 'sonnet', 'User: q'])
    })

    it('injects the app stored key into the child env when env lacks one', async () => {
      const spawn = makeFakeSpawn({ stdout: 'ok', code: 0 })
      const brain = new KiroCliBrain({ spawn: asSpawn(spawn.fn), env: {}, getStoredKey: () => 'stored-kiro' })
      await brain.generate([{ role: 'user', content: 'q' }])
      const opts = spawn.calls[0].options as { env: Record<string, string> }
      expect(opts.env.KIRO_API_KEY).toBe('stored-kiro')
    })

    it('returns null on non-zero exit (no throw)', async () => {
      const spawn = makeFakeSpawn({ stderr: 'boom', code: 1 })
      const brain = new KiroCliBrain({ spawn: asSpawn(spawn.fn), env: { KIRO_API_KEY: 'kk' }, getStoredKey: () => '' })
      expect(await brain.generate([{ role: 'user', content: 'q' }])).toBeNull()
    })

    it('returns null on spawn error', async () => {
      const spawn = makeFakeSpawn({ emitError: true })
      const brain = new KiroCliBrain({ spawn: asSpawn(spawn.fn), env: { KIRO_API_KEY: 'kk' }, getStoredKey: () => '' })
      expect(await brain.generate([{ role: 'user', content: 'q' }])).toBeNull()
    })

    it('returns null + kills the child on abort', async () => {
      const spawn = makeFakeSpawn({ never: true })
      const brain = new KiroCliBrain({ spawn: asSpawn(spawn.fn), env: { KIRO_API_KEY: 'kk' }, getStoredKey: () => '' })
      const controller = new AbortController()
      const p = brain.generate([{ role: 'user', content: 'q' }], { signal: controller.signal })
      controller.abort()
      expect(await p).toBeNull()
      expect(spawn.lastChild?.kill).toHaveBeenCalled()
    })
  })

  it('NEVER spawns the `kiro` IDE launcher or a GUI window — only headless `kiro-cli`', async () => {
    const spawn = makeFakeSpawn({ stdout: 'answer', code: 0 })
    const brain = new KiroCliBrain({ spawn: asSpawn(spawn.fn), env: { KIRO_API_KEY: 'kk' }, getStoredKey: () => '' })
    await brain.authStatus()
    await brain.generate([{ role: 'user', content: 'q' }])
    await brain.chat([{ role: 'user', content: 'hi' }])
    // Every spawn targets the headless CLI binary, never the IDE launcher.
    expect(spawn.calls.every((c) => c.command === 'kiro-cli')).toBe(true)
    expect(spawn.calls.some((c) => c.command === 'kiro')).toBe(false)
    // No GUI window flags, and every chat invocation is headless (--no-interactive).
    for (const c of spawn.calls) {
      expect(c.args).not.toContain('--new-window')
      expect(c.args).not.toContain('--maximize')
      expect(c.args).not.toContain('--reuse-window')
      if (c.args.includes('chat')) expect(c.args).toContain('--no-interactive')
    }
  })
})
