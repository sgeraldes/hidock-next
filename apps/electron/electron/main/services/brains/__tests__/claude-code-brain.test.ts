/**
 * ClaudeCodeBrain tests — verifies capabilities, HONEST auth detection via
 * `claude auth status --json` (+ ANTHROPIC_API_KEY), argv construction for
 * `claude -p` with the PROMPT PIPED VIA STDIN (never argv), stdout parsing,
 * timeout/abort → null, and no-throw on spawn error. Fake spawn only.
 *
 * @vitest-environment node
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { ClaudeCodeBrain, resolveClaudeCommand } from '../claude-code-brain'
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

    it('surfaces the authMethod in the detail (e.g. "Logged in (claude.ai)")', async () => {
      const spawn = makeFakeSpawn({
        stdout: JSON.stringify({ loggedIn: true, authMethod: 'claude.ai', email: 'a@b.com' }),
        code: 0,
      })
      const brain = new ClaudeCodeBrain({ spawn: asSpawn(spawn.fn), env: {} })
      const status = await brain.authStatus()
      expect(status.configured).toBe(true)
      expect(status.method).toBe('cli-login')
      expect(status.detail).toBe('Logged in (claude.ai)')
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
      // Command resolution is async now — let the child actually spawn first so
      // the abort exercises the kill path (an abort BEFORE spawn also nulls, but
      // then there is no child to kill).
      await new Promise((r) => setTimeout(r, 0))
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

describe('resolveClaudeCommand (identity-verified win32 exec-path fix)', () => {
  const PATH = 'C:\\shim;C:\\real'
  const env = { PATH } as NodeJS.ProcessEnv
  const REAL = 'C:\\real\\claude.exe'

  it('prefers a native claude.exe over an earlier-on-PATH proxy .cmd shim — after identity verification', async () => {
    // Reproduces this machine's bug: a `.cmd` (WSL proxy) shadows the real
    // `claude.exe`. The runner mirrors that (first dir wins) → probe hits the
    // broken shim → "auth status unavailable". The fix resolves the native exe,
    // but only once verify() proves it is Anthropic Claude Code.
    const fileExists = (p: string) => p === 'C:\\shim\\claude.cmd' || p === REAL
    const verify = vi.fn(async (p: string) => p === REAL)
    const out = await resolveClaudeCommand(env, { platform: 'win32', fileExists, verify })
    expect(out).toBe(REAL)
    expect(verify).toHaveBeenCalledWith(REAL)
  })

  it("REJECTS an unrelated vendor's claude.exe that fails identity verification", async () => {
    // A random third-party claude.exe on PATH must never be selected — its
    // --version does not carry the Claude Code signature → fall back to the bare
    // command (cli-runner's normal resolution).
    const stranger = 'C:\\shim\\claude.exe'
    const fileExists = (p: string) => p === stranger
    const verify = vi.fn(async () => false)
    const out = await resolveClaudeCommand(env, { platform: 'win32', fileExists, verify })
    expect(out).toBe('claude')
    expect(verify).toHaveBeenCalledWith(stranger)
  })

  it('skips an unverified exe and accepts a later verified one', async () => {
    const stranger = 'C:\\shim\\claude.exe'
    const fileExists = (p: string) => p === stranger || p === REAL
    const verify = vi.fn(async (p: string) => p === REAL)
    expect(await resolveClaudeCommand(env, { platform: 'win32', fileExists, verify })).toBe(REAL)
  })

  it('falls back to the bare command when only a .cmd exists (normal npm install) — verify never runs', async () => {
    const fileExists = (p: string) => p === 'C:\\shim\\claude.cmd'
    const verify = vi.fn(async () => true)
    const out = await resolveClaudeCommand(env, { platform: 'win32', fileExists, verify })
    expect(out).toBe('claude')
    expect(verify).not.toHaveBeenCalled()
  })

  it('treats a throwing verifier as unverified (never throws, falls back)', async () => {
    const fileExists = (p: string) => p === REAL
    const verify = vi.fn(async () => {
      throw new Error('probe exploded')
    })
    expect(await resolveClaudeCommand(env, { platform: 'win32', fileExists, verify })).toBe('claude')
  })

  it('is a no-op off win32 (POSIX resolves natively)', async () => {
    const fileExists = () => true
    const verify = vi.fn(async () => true)
    expect(await resolveClaudeCommand(env, { platform: 'linux', fileExists, verify })).toBe('claude')
    expect(verify).not.toHaveBeenCalled()
  })
})
