/**
 * ClaudeCodeBrain tests — verifies capabilities, auth detection via the version
 * probe + ANTHROPIC_API_KEY, argv construction for `claude -p`, stdout parsing,
 * timeout/abort → null, and no-throw on spawn error. Fake spawn only.
 *
 * @vitest-environment node
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { ClaudeCodeBrain } from '../claude-code-brain'
import type { SpawnFn } from '../cli-runner'
import { makeFakeSpawn, type FakeSpawnScript } from './fake-spawn'

const asSpawn = (fn: unknown) => fn as SpawnFn

/** Route --version vs generate to different scripts. */
function scripted(version: FakeSpawnScript, generate: FakeSpawnScript) {
  return (_cmd: string, args: string[]): FakeSpawnScript =>
    args[0] === '--version' ? version : generate
}

describe('ClaudeCodeBrain', () => {
  beforeEach(() => vi.clearAllMocks())

  it('advertises generate/chat/agentic only (no audio, no embed)', () => {
    const brain = new ClaudeCodeBrain()
    expect([...brain.capabilities()].sort()).toEqual(['agentic', 'chat', 'generate'])
  })

  describe('authStatus', () => {
    it('configured=cli-login when `claude --version` exits 0', async () => {
      const spawn = makeFakeSpawn({ stdout: '2.1.205 (Claude Code)', code: 0 })
      const brain = new ClaudeCodeBrain({ spawn: asSpawn(spawn.fn), env: {} })
      const status = await brain.authStatus()
      expect(status.configured).toBe(true)
      expect(status.method).toBe('cli-login')
      expect(spawn.calls[0]).toMatchObject({ command: 'claude', args: ['--version'] })
    })

    it('reports api-key when ANTHROPIC_API_KEY is set', async () => {
      const spawn = makeFakeSpawn({ stdout: '2.1.205', code: 0 })
      const brain = new ClaudeCodeBrain({ spawn: asSpawn(spawn.fn), env: { ANTHROPIC_API_KEY: 'sk-x' } })
      const status = await brain.authStatus()
      expect(status.configured).toBe(true)
      expect(status.method).toBe('api-key')
    })

    it('not configured when the CLI is absent and no API key', async () => {
      const spawn = makeFakeSpawn({ emitError: true })
      const brain = new ClaudeCodeBrain({ spawn: asSpawn(spawn.fn), env: {} })
      const status = await brain.authStatus()
      expect(status.configured).toBe(false)
      expect(status.method).toBe('none')
    })

    it('still configured (api-key) when CLI errors but a key is present', async () => {
      const spawn = makeFakeSpawn({ emitError: true })
      const brain = new ClaudeCodeBrain({ spawn: asSpawn(spawn.fn), env: { ANTHROPIC_API_KEY: 'sk-x' } })
      expect((await brain.authStatus()).configured).toBe(true)
    })
  })

  describe('generate', () => {
    it('builds `claude -p <prompt>` and returns trimmed stdout', async () => {
      const spawn = makeFakeSpawn(scripted({ stdout: 'v', code: 0 }, { stdout: '  the answer  ', code: 0 }))
      const brain = new ClaudeCodeBrain({ spawn: asSpawn(spawn.fn), env: {} })
      const out = await brain.generate([{ role: 'user', content: 'q' }])
      expect(out).toBe('the answer')
      const genCall = spawn.calls.find((c) => c.args[0] === '-p')
      expect(genCall?.args).toEqual(['-p', 'User: q'])
    })

    it('appends --model when opts.model is set', async () => {
      const spawn = makeFakeSpawn({ stdout: 'ok', code: 0 })
      const brain = new ClaudeCodeBrain({ spawn: asSpawn(spawn.fn), env: {} })
      await brain.generate([{ role: 'user', content: 'q' }], { model: 'opus' })
      expect(spawn.calls[0].args).toEqual(['-p', 'User: q', '--model', 'opus'])
    })

    it('returns null on non-zero exit (no throw)', async () => {
      const spawn = makeFakeSpawn({ stderr: 'auth error', code: 1 })
      const brain = new ClaudeCodeBrain({ spawn: asSpawn(spawn.fn), env: {} })
      expect(await brain.generate([{ role: 'user', content: 'q' }])).toBeNull()
    })

    it('returns null on spawn error (CLI missing)', async () => {
      const spawn = makeFakeSpawn({ emitError: true })
      const brain = new ClaudeCodeBrain({ spawn: asSpawn(spawn.fn), env: {} })
      expect(await brain.generate([{ role: 'user', content: 'q' }])).toBeNull()
    })

    it('returns null and kills the child when aborted', async () => {
      const spawn = makeFakeSpawn({ never: true })
      const brain = new ClaudeCodeBrain({ spawn: asSpawn(spawn.fn), env: {} })
      const controller = new AbortController()
      const p = brain.generate([{ role: 'user', content: 'q' }], { signal: controller.signal })
      controller.abort()
      expect(await p).toBeNull()
      expect(spawn.lastChild?.kill).toHaveBeenCalled()
    })

    it('returns null on empty prompt without spawning', async () => {
      const spawn = makeFakeSpawn({ stdout: 'x', code: 0 })
      const brain = new ClaudeCodeBrain({ spawn: asSpawn(spawn.fn), env: {} })
      expect(await brain.generate([])).toBeNull()
      expect(spawn.calls).toHaveLength(0)
    })
  })

  it('chat folds history into the prompt (system + turns)', async () => {
    const spawn = makeFakeSpawn({ stdout: 'reply', code: 0 })
    const brain = new ClaudeCodeBrain({ spawn: asSpawn(spawn.fn), env: {} })
    const out = await brain.chat([
      { role: 'system', content: 'sys' },
      { role: 'user', content: 'hi' },
    ])
    expect(out).toBe('reply')
    expect(spawn.calls[0].args).toEqual(['-p', 'System: sys\n\nUser: hi'])
  })
})
