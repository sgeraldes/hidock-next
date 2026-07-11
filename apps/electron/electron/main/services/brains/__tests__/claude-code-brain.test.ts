/**
 * ClaudeCodeBrain tests — verifies capabilities, HONEST auth detection via
 * `claude auth status --json` (+ ANTHROPIC_API_KEY), argv construction for
 * `claude -p` with the PROMPT PIPED VIA STDIN (never argv), stdout parsing,
 * timeout/abort → null, and no-throw on spawn error. Fake spawn only.
 *
 * @vitest-environment node
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { ClaudeCodeBrain } from '../claude-code-brain'
import type { SpawnFn } from '../cli-runner'
import { makeFakeSpawn, type FakeSpawnScript } from './fake-spawn'

const asSpawn = (fn: unknown) => fn as SpawnFn

/** Route `auth status` vs generate to different scripts. */
function scripted(auth: FakeSpawnScript, generate: FakeSpawnScript) {
  return (_cmd: string, args: string[]): FakeSpawnScript => (args[0] === 'auth' ? auth : generate)
}

describe('ClaudeCodeBrain', () => {
  beforeEach(() => vi.clearAllMocks())

  it('advertises generate/chat/agentic only (no audio, no embed)', () => {
    const brain = new ClaudeCodeBrain()
    expect([...brain.capabilities()].sort()).toEqual(['agentic', 'chat', 'generate'])
  })

  describe('authStatus', () => {
    it('configured=cli-login when `claude auth status --json` reports loggedIn', async () => {
      const spawn = makeFakeSpawn({ stdout: JSON.stringify({ loggedIn: true, email: 'a@b.com' }), code: 0 })
      const brain = new ClaudeCodeBrain({ spawn: asSpawn(spawn.fn), env: {} })
      const status = await brain.authStatus()
      expect(status.configured).toBe(true)
      expect(status.method).toBe('cli-login')
      expect(spawn.calls[0]).toMatchObject({ command: 'claude', args: ['auth', 'status', '--json'] })
    })

    it('NOT configured when installed but not logged in (loggedIn:false, no key)', async () => {
      const spawn = makeFakeSpawn({ stdout: JSON.stringify({ loggedIn: false }), code: 0 })
      const brain = new ClaudeCodeBrain({ spawn: asSpawn(spawn.fn), env: {} })
      const status = await brain.authStatus()
      expect(status.configured).toBe(false)
      expect(status.method).toBe('none')
      // Honest: never labels a not-logged-in CLI as usable.
      expect(status.detail).toMatch(/not logged in/i)
    })

    it('reports api-key when ANTHROPIC_API_KEY is set', async () => {
      const spawn = makeFakeSpawn({ stdout: JSON.stringify({ loggedIn: true }), code: 0 })
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

    it('still configured (api-key) when the CLI is absent but a key is present', async () => {
      const spawn = makeFakeSpawn({ emitError: true })
      const brain = new ClaudeCodeBrain({ spawn: asSpawn(spawn.fn), env: { ANTHROPIC_API_KEY: 'sk-x' } })
      expect((await brain.authStatus()).configured).toBe(true)
    })
  })

  describe('generate', () => {
    it('builds `claude -p` with the prompt on STDIN (not argv) and returns trimmed stdout', async () => {
      const spawn = makeFakeSpawn(scripted({ stdout: '{}', code: 0 }, { stdout: '  the answer  ', code: 0 }))
      const brain = new ClaudeCodeBrain({ spawn: asSpawn(spawn.fn), env: {} })
      const out = await brain.generate([{ role: 'user', content: 'q' }])
      expect(out).toBe('the answer')
      const genCall = spawn.calls.find((c) => c.args[0] === '-p')
      expect(genCall?.args).toEqual(['-p']) // prompt is NOT in argv
      expect(spawn.lastChild?.stdin.write).toHaveBeenCalledWith('User: q') // prompt on stdin
    })

    it('appends --model when opts.model is set (prompt still on stdin)', async () => {
      const spawn = makeFakeSpawn({ stdout: 'ok', code: 0 })
      const brain = new ClaudeCodeBrain({ spawn: asSpawn(spawn.fn), env: {} })
      await brain.generate([{ role: 'user', content: 'q' }], { model: 'opus' })
      expect(spawn.calls[0].args).toEqual(['-p', '--model', 'opus'])
      expect(spawn.lastChild?.stdin.write).toHaveBeenCalledWith('User: q')
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

  it('chat folds history into the STDIN prompt (system + turns)', async () => {
    const spawn = makeFakeSpawn({ stdout: 'reply', code: 0 })
    const brain = new ClaudeCodeBrain({ spawn: asSpawn(spawn.fn), env: {} })
    const out = await brain.chat([
      { role: 'system', content: 'sys' },
      { role: 'user', content: 'hi' },
    ])
    expect(out).toBe('reply')
    expect(spawn.calls[0].args).toEqual(['-p'])
    expect(spawn.lastChild?.stdin.write).toHaveBeenCalledWith('System: sys\n\nUser: hi')
  })
})
