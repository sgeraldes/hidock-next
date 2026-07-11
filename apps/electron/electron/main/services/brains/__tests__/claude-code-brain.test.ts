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

describe('resolveClaudeCommand (trusted-root, identity-verified resolution)', () => {
  // PATH deliberately contains an "evil" dir that is NOT a trusted root — the
  // resolver must never even look there.
  const env = { PATH: 'C:\\evil;C:\\trusted' } as NodeJS.ProcessEnv
  const TRUSTED = 'C:\\trusted'
  const REAL = 'C:\\trusted\\claude.exe'
  const noOverride = () => ''

  it('NEVER probes/executes an exe from an arbitrary PATH directory (untrusted discovery banned)', async () => {
    // A malicious claude.exe sits on an arbitrary PATH dir — identity-probing it
    // would BE the code execution, so it must never be discovered at all.
    const checked: string[] = []
    const fileExists = (p: string) => {
      checked.push(p)
      return p === 'C:\\evil\\claude.exe'
    }
    const verify = vi.fn(async () => true)
    const out = await resolveClaudeCommand(env, {
      platform: 'win32',
      fileExists,
      verify,
      getConfiguredPath: noOverride,
      trustedRoots: [TRUSTED],
    })
    expect(out).toBe('claude') // bare fallback — Windows' normal selection
    expect(verify).not.toHaveBeenCalled() // the evil exe was never executed
    expect(checked.some((p) => p.startsWith('C:\\evil'))).toBe(false) // never even looked there
  })

  it('uses a trusted-root exe only after it passes identity verification', async () => {
    const fileExists = (p: string) => p === REAL
    const verify = vi.fn(async (p: string) => p === REAL)
    const out = await resolveClaudeCommand(env, {
      platform: 'win32',
      fileExists,
      verify,
      getConfiguredPath: noOverride,
      trustedRoots: [TRUSTED],
    })
    expect(out).toBe(REAL)
    expect(verify).toHaveBeenCalledWith(REAL)
  })

  it('REJECTS a trusted-root exe that fails identity verification', async () => {
    const fileExists = (p: string) => p === REAL
    const verify = vi.fn(async () => false)
    expect(
      await resolveClaudeCommand(env, {
        platform: 'win32',
        fileExists,
        verify,
        getConfiguredPath: noOverride,
        trustedRoots: [TRUSTED],
      })
    ).toBe('claude')
  })

  it('config override WINS outright when the file exists (explicit user consent, no auto-discovery)', async () => {
    const CUSTOM = 'D:\\my-tools\\claude-custom.exe'
    const fileExists = (p: string) => p === CUSTOM || p === REAL
    const verify = vi.fn(async () => true)
    const out = await resolveClaudeCommand(env, {
      platform: 'win32',
      fileExists,
      verify,
      getConfiguredPath: () => CUSTOM,
      trustedRoots: [TRUSTED],
    })
    expect(out).toBe(CUSTOM) // beats the trusted-root candidate
    expect(verify).not.toHaveBeenCalled() // no discovery probing needed
  })

  it('ignores a configured override whose file does not exist (falls through to trusted roots)', async () => {
    const fileExists = (p: string) => p === REAL
    const verify = vi.fn(async () => true)
    const out = await resolveClaudeCommand(env, {
      platform: 'win32',
      fileExists,
      verify,
      getConfiguredPath: () => 'D:\\gone\\claude.exe',
      trustedRoots: [TRUSTED],
    })
    expect(out).toBe(REAL)
  })

  it('falls back to the bare command when trusted roots hold no native exe', async () => {
    const fileExists = () => false
    const verify = vi.fn(async () => true)
    const out = await resolveClaudeCommand(env, {
      platform: 'win32',
      fileExists,
      verify,
      getConfiguredPath: noOverride,
      trustedRoots: [TRUSTED],
    })
    expect(out).toBe('claude')
    expect(verify).not.toHaveBeenCalled()
  })

  it('treats a throwing verifier as unverified (never throws, falls back)', async () => {
    const fileExists = (p: string) => p === REAL
    const verify = vi.fn(async () => {
      throw new Error('probe exploded')
    })
    expect(
      await resolveClaudeCommand(env, {
        platform: 'win32',
        fileExists,
        verify,
        getConfiguredPath: noOverride,
        trustedRoots: [TRUSTED],
      })
    ).toBe('claude')
  })

  it('is a no-op off win32 (POSIX resolves natively) — but the explicit override still wins', async () => {
    const fileExists = () => true
    const verify = vi.fn(async () => true)
    expect(
      await resolveClaudeCommand(env, {
        platform: 'linux',
        fileExists,
        verify,
        getConfiguredPath: noOverride,
        trustedRoots: [TRUSTED],
      })
    ).toBe('claude')
    expect(verify).not.toHaveBeenCalled()
    // The explicit user override applies on any platform.
    expect(
      await resolveClaudeCommand(env, {
        platform: 'linux',
        fileExists,
        verify,
        getConfiguredPath: () => '/opt/claude/claude',
        trustedRoots: [TRUSTED],
      })
    ).toBe('/opt/claude/claude')
  })
})

describe('stale resolution cache (invalidate + single re-resolve)', () => {
  const DEAD = 'C:\\dead\\claude.exe'
  const REAL = 'C:\\trusted\\claude.exe'

  it('uninstall-mid-session: a dead cached path recovers on the next call', async () => {
    let call = 0
    const resolveCommand = vi.fn(async () => (++call === 1 ? DEAD : 'claude'))
    const spawn = makeFakeSpawn((cmd) =>
      cmd === DEAD
        ? ({ emitError: true } as FakeSpawnScript)
        : ({ stdout: JSON.stringify({ loggedIn: true, authMethod: 'claude.ai' }), code: 0 } as FakeSpawnScript)
    )
    const brain = new ClaudeCodeBrain({ spawn: asSpawn(spawn.fn), env: {}, resolveCommand })
    const status = await brain.authStatus()
    expect(status.configured).toBe(true)
    expect(status.detail).toBe('Logged in (claude.ai)')
    expect(resolveCommand).toHaveBeenCalledTimes(2) // initial + one re-resolve
    expect(spawn.calls.map((c) => c.command)).toEqual([DEAD, 'claude'])
  })

  it('install-after-fallback: a broken bare fallback picks up the newly installed native exe', async () => {
    let call = 0
    const resolveCommand = vi.fn(async () => (++call === 1 ? 'claude' : REAL))
    const spawn = makeFakeSpawn((cmd) =>
      cmd === 'claude'
        ? ({ stdout: '', stderr: 'claude: command not found', code: 127 } as FakeSpawnScript)
        : ({ stdout: JSON.stringify({ loggedIn: true, authMethod: 'claude.ai' }), code: 0 } as FakeSpawnScript)
    )
    const brain = new ClaudeCodeBrain({ spawn: asSpawn(spawn.fn), env: {}, resolveCommand })
    const status = await brain.authStatus()
    expect(status.configured).toBe(true)
    expect(spawn.calls.map((c) => c.command)).toEqual(['claude', REAL])
  })

  it('no infinite re-resolve loop: exactly one retry per operation', async () => {
    const resolveCommand = vi.fn(async () => DEAD)
    const spawn = makeFakeSpawn({ emitError: true })
    const brain = new ClaudeCodeBrain({ spawn: asSpawn(spawn.fn), env: {}, resolveCommand })
    const status = await brain.authStatus()
    expect(status.configured).toBe(false)
    expect(spawn.calls).toHaveLength(2) // initial + single retry, then stop
    expect(resolveCommand).toHaveBeenCalledTimes(2)
  })

  it('a clean "not logged in" (code 0 + parsed JSON) is NOT retried', async () => {
    const resolveCommand = vi.fn(async () => 'claude')
    const spawn = makeFakeSpawn({ stdout: JSON.stringify({ loggedIn: false }), code: 0 })
    const brain = new ClaudeCodeBrain({ spawn: asSpawn(spawn.fn), env: {}, resolveCommand })
    const status = await brain.authStatus()
    expect(status.configured).toBe(false)
    expect(spawn.calls).toHaveLength(1) // legitimate answer — no re-resolution
    expect(resolveCommand).toHaveBeenCalledTimes(1)
  })

  it('generate retries once after a spawn error with a fresh resolution', async () => {
    let call = 0
    const resolveCommand = vi.fn(async () => (++call === 1 ? DEAD : 'claude'))
    const spawn = makeFakeSpawn((cmd) =>
      cmd === DEAD ? ({ emitError: true } as FakeSpawnScript) : ({ stdout: 'answer', code: 0 } as FakeSpawnScript)
    )
    const brain = new ClaudeCodeBrain({ spawn: asSpawn(spawn.fn), env: {}, resolveCommand })
    expect(await brain.generate([{ role: 'user', content: 'q' }])).toBe('answer')
    expect(spawn.calls.map((c) => c.command)).toEqual([DEAD, 'claude'])
  })
})
