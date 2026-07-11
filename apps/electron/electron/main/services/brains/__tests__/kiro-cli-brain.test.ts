/**
 * KiroCliBrain tests — verifies capabilities, LOGIN-FIRST auth (`kiro-cli whoami`
 * session probe; KIRO_API_KEY is an "(unverified)" fallback), the headless argv
 * `kiro-cli chat --no-interactive --trust-tools=` with the PROMPT PIPED VIA STDIN
 * (never argv — no process-listing exposure, no leading-dash option injection),
 * ANSI/marker stdout cleaning, key injection, no-throw failure modes, and —
 * critically — that we ONLY ever spawn the headless `kiro-cli` binary and NEVER
 * the `kiro` IDE launcher / a GUI window. Fake spawn only.
 *
 * @vitest-environment node
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { KiroCliBrain, parseKiroOutput, parseWhoami } from '../kiro-cli-brain'
import type { SpawnFn } from '../cli-runner'
import { makeFakeSpawn, type FakeSpawnScript } from './fake-spawn'

const asSpawn = (fn: unknown) => fn as SpawnFn
const WHOAMI_JSON = JSON.stringify({
  accountType: 'IamIdentityCenter',
  startUrl: 'https://x.awsapps.com/start/',
  region: 'us-east-1',
  email: 'user@example.com',
})
/** Observed real stdout: JSON object followed by plain-text profile lines. */
const WHOAMI_STDOUT = `${WHOAMI_JSON}\n\nProfile:\nSomeProfile\narn:aws:codewhisperer:...`
const NOT_LOGGED_IN: FakeSpawnScript = { stdout: '', stderr: 'Not logged in', code: 1 }

/** Route the whoami probe vs chat to different scripts. */
function scripted(whoami: FakeSpawnScript, chat: FakeSpawnScript) {
  return (_cmd: string, args: string[]): FakeSpawnScript => (args[0] === 'whoami' ? whoami : chat)
}

describe('parseKiroOutput', () => {
  it('strips ANSI escapes and the "> " answer marker (observed real output)', () => {
    // Real capture from this machine: `\x1b[38;5;141m> \x1b[0mOK`
    expect(parseKiroOutput('\x1b[38;5;141m> \x1b[0mOK')).toBe('OK')
  })
  it('strips cursor-control sequences too', () => {
    expect(parseKiroOutput('\x1b[?25l> hello world\x1b[?25h')).toBe('hello world')
  })
  it('passes through plain text', () => {
    expect(parseKiroOutput('  plain answer  ')).toBe('plain answer')
  })
  it('returns null when nothing remains', () => {
    expect(parseKiroOutput('\x1b[0m>  ')).toBeNull()
    expect(parseKiroOutput('   ')).toBeNull()
  })
})

describe('parseWhoami (positive-discriminator login parse)', () => {
  it('exit-0 `{}` is NOT a login (no identity fields)', () => {
    expect(parseWhoami('{}')).toBeNull()
  })

  it('`{"loggedIn":false}` is NOT a login (explicit negative signal)', () => {
    expect(parseWhoami('{"loggedIn":false}')).toBeNull()
    // …even if identity-ish fields are also present.
    expect(parseWhoami('{"loggedIn":false,"email":"x@y.z"}')).toBeNull()
  })

  it('an error envelope is NOT a login', () => {
    expect(parseWhoami('{"error":"token expired"}')).toBeNull()
    expect(parseWhoami('{"error":{"code":401},"email":"x@y.z"}')).toBeNull()
  })

  it('parses NESTED-object JSON whole (brace-depth scan, not first-closing-brace)', () => {
    const nested =
      '{"accountType":"IamIdentityCenter","meta":{"inner":{"deep":true},"brace":"}{"},"email":"a@b.c"}'
    const who = parseWhoami(nested + '\n\nProfile:\nSomeProfile')
    expect(who).toEqual({ accountType: 'IamIdentityCenter', email: 'a@b.c' })
  })

  it('accepts the real whoami shape with trailing plain-text profile lines', () => {
    const who = parseWhoami(WHOAMI_STDOUT)
    expect(who?.accountType).toBe('IamIdentityCenter')
    expect(who?.email).toBe('user@example.com')
  })

  it('startUrl alone satisfies the positive discriminator', () => {
    expect(parseWhoami('{"startUrl":"https://x.awsapps.com/start/"}')).not.toBeNull()
  })

  it('rejects non-leading JSON (log noise first), non-object JSON, and junk', () => {
    expect(parseWhoami('starting up...\n{"email":"a@b.c"}')).toBeNull()
    expect(parseWhoami('["email"]')).toBeNull()
    expect(parseWhoami('not json at all')).toBeNull()
    expect(parseWhoami('')).toBeNull()
  })
})

describe('KiroCliBrain', () => {
  beforeEach(() => vi.clearAllMocks())

  it('advertises generate/chat/agentic only (no audio, no embed)', () => {
    const brain = new KiroCliBrain()
    const caps = brain.capabilities()
    expect([...caps].sort()).toEqual(['agentic', 'chat', 'generate'])
    expect(caps.has('analyzeAudio')).toBe(false)
    expect(caps.has('embed')).toBe(false)
  })

  describe('authStatus (login-first)', () => {
    it('not configured (kiro-cli not on PATH) on spawn error', async () => {
      const spawn = makeFakeSpawn({ emitError: true })
      const brain = new KiroCliBrain({ spawn: asSpawn(spawn.fn), env: {}, getStoredKey: () => '' })
      const status = await brain.authStatus()
      expect(status.configured).toBe(false)
      expect(status.method).toBe('none')
      expect(status.detail).toMatch(/not on PATH/i)
      // The probe is the headless CLI's whoami — never the `kiro` IDE.
      expect(spawn.calls[0]).toMatchObject({ command: 'kiro-cli', args: ['whoami', '--format', 'json'] })
    })

    it('configured=cli-login when whoami reports a session (even with trailing profile text)', async () => {
      const spawn = makeFakeSpawn({ stdout: WHOAMI_STDOUT, code: 0 })
      const brain = new KiroCliBrain({ spawn: asSpawn(spawn.fn), env: {}, getStoredKey: () => '' })
      const status = await brain.authStatus()
      expect(status.configured).toBe(true)
      expect(status.method).toBe('cli-login')
      expect(status.detail).toBe('Kiro login active (IamIdentityCenter, user@example.com)')
    })

    it('LOGIN-FIRST: cli-login wins even when KIRO_API_KEY is also set', async () => {
      const spawn = makeFakeSpawn({ stdout: WHOAMI_STDOUT, code: 0 })
      const brain = new KiroCliBrain({
        spawn: asSpawn(spawn.fn),
        env: { KIRO_API_KEY: 'kk' },
        getStoredKey: () => '',
      })
      const status = await brain.authStatus()
      expect(status.method).toBe('cli-login')
      expect(status.detail).toMatch(/Kiro login active/)
    })

    it('API key is an HONEST fallback: "(unverified)" and only when not logged in', async () => {
      const spawn = makeFakeSpawn(NOT_LOGGED_IN)
      const brain = new KiroCliBrain({
        spawn: asSpawn(spawn.fn),
        env: { KIRO_API_KEY: 'kk' },
        getStoredKey: () => '',
      })
      const status = await brain.authStatus()
      expect(status.configured).toBe(true)
      expect(status.method).toBe('api-key')
      expect(status.detail).toBe('Kiro API key present (unverified)')
    })

    it('stored app key also counts as the (unverified) fallback', async () => {
      const spawn = makeFakeSpawn(NOT_LOGGED_IN)
      const brain = new KiroCliBrain({ spawn: asSpawn(spawn.fn), env: {}, getStoredKey: () => 'stored-kiro' })
      const status = await brain.authStatus()
      expect(status.configured).toBe(true)
      expect(status.detail).toMatch(/unverified/)
    })

    it('installed, not logged in, no key → NOT configured with a clear reason', async () => {
      const spawn = makeFakeSpawn(NOT_LOGGED_IN)
      const brain = new KiroCliBrain({ spawn: asSpawn(spawn.fn), env: {}, getStoredKey: () => '' })
      const status = await brain.authStatus()
      expect(status.configured).toBe(false)
      expect(status.method).toBe('none')
      expect(status.detail).toMatch(/not logged in/i)
    })

    it('an exit-0 `{}` / error-envelope whoami never reads as "login active"', async () => {
      for (const stdout of ['{}', '{"loggedIn":false}', '{"error":"token expired"}']) {
        const spawn = makeFakeSpawn({ stdout, code: 0 })
        const brain = new KiroCliBrain({ spawn: asSpawn(spawn.fn), env: {}, getStoredKey: () => '' })
        const status = await brain.authStatus()
        expect(status.configured, `stdout=${stdout}`).toBe(false)
        expect(status.method).toBe('none')
      }
    })
  })

  describe('generate', () => {
    it('returns null on empty prompt without spawning', async () => {
      const spawn = makeFakeSpawn({ stdout: 'x', code: 0 })
      const brain = new KiroCliBrain({ spawn: asSpawn(spawn.fn), env: {}, getStoredKey: () => '' })
      expect(await brain.generate([])).toBeNull()
      expect(spawn.calls).toHaveLength(0)
    })

    it('builds headless argv `chat --no-interactive --trust-tools=` with the prompt on STDIN (not argv)', async () => {
      const spawn = makeFakeSpawn({ stdout: '> the answer', code: 0 })
      const brain = new KiroCliBrain({ spawn: asSpawn(spawn.fn), env: {}, getStoredKey: () => '' })
      const out = await brain.generate([{ role: 'user', content: 'q' }])
      expect(out).toBe('the answer')
      expect(spawn.calls[0]).toMatchObject({
        command: 'kiro-cli',
        args: ['chat', '--no-interactive', '--trust-tools='],
      })
      expect(spawn.lastChild?.stdin.write).toHaveBeenCalledWith('User: q')
    })

    it('a LEADING-DASH prompt goes to stdin, never argv (no option injection past --trust-tools=)', async () => {
      const spawn = makeFakeSpawn({ stdout: 'ok', code: 0 })
      const brain = new KiroCliBrain({ spawn: asSpawn(spawn.fn), env: {}, getStoredKey: () => '' })
      await brain.generate([{ role: 'user', content: '--trust-all-tools; rm -rf /' }])
      // argv contains ONLY the fixed flags — the hostile prompt never reaches it.
      expect(spawn.calls[0].args).toEqual(['chat', '--no-interactive', '--trust-tools='])
      expect(spawn.calls[0].args.join(' ')).not.toContain('--trust-all-tools')
      expect(spawn.lastChild?.stdin.write).toHaveBeenCalledWith('User: --trust-all-tools; rm -rf /')
    })

    it('EMPTY TRUST CONTRACT: every chat invocation passes --trust-tools= (no tools trusted)', async () => {
      const spawn = makeFakeSpawn({ stdout: 'ok', code: 0 })
      const brain = new KiroCliBrain({ spawn: asSpawn(spawn.fn), env: {}, getStoredKey: () => '' })
      await brain.generate([{ role: 'user', content: 'a' }])
      await brain.chat([{ role: 'user', content: 'b' }])
      const chatCalls = spawn.calls.filter((c) => c.args[0] === 'chat')
      expect(chatCalls.length).toBe(2)
      for (const c of chatCalls) {
        expect(c.args).toContain('--trust-tools=')
        // The empty value must stay ONE token (a separate value would re-enable defaults).
        expect(c.args).not.toContain('--trust-tools')
        expect(c.args).not.toContain('--trust-all-tools')
      }
    })

    it('strips ANSI decoration from the stdout answer', async () => {
      const spawn = makeFakeSpawn({ stdout: '\x1b[38;5;141m> \x1b[0mOK', code: 0 })
      const brain = new KiroCliBrain({ spawn: asSpawn(spawn.fn), env: {}, getStoredKey: () => '' })
      expect(await brain.generate([{ role: 'user', content: 'q' }])).toBe('OK')
    })

    it('inserts --model before the stdin-piped prompt when set', async () => {
      const spawn = makeFakeSpawn({ stdout: 'ok', code: 0 })
      const brain = new KiroCliBrain({ spawn: asSpawn(spawn.fn), env: {}, getStoredKey: () => '' })
      await brain.generate([{ role: 'user', content: 'q' }], { model: 'sonnet' })
      expect(spawn.calls[0].args).toEqual(['chat', '--no-interactive', '--trust-tools=', '--model', 'sonnet'])
      expect(spawn.lastChild?.stdin.write).toHaveBeenCalledWith('User: q')
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
      const brain = new KiroCliBrain({ spawn: asSpawn(spawn.fn), env: {}, getStoredKey: () => '' })
      expect(await brain.generate([{ role: 'user', content: 'q' }])).toBeNull()
    })

    it('returns null on spawn error', async () => {
      const spawn = makeFakeSpawn({ emitError: true })
      const brain = new KiroCliBrain({ spawn: asSpawn(spawn.fn), env: {}, getStoredKey: () => '' })
      expect(await brain.generate([{ role: 'user', content: 'q' }])).toBeNull()
    })

    it('returns null + kills the child on abort', async () => {
      const spawn = makeFakeSpawn({ never: true })
      const brain = new KiroCliBrain({ spawn: asSpawn(spawn.fn), env: {}, getStoredKey: () => '' })
      const controller = new AbortController()
      const p = brain.generate([{ role: 'user', content: 'q' }], { signal: controller.signal })
      controller.abort()
      expect(await p).toBeNull()
      expect(spawn.lastChild?.kill).toHaveBeenCalled()
    })
  })

  it('NEVER spawns the `kiro` IDE launcher or a GUI window — only headless `kiro-cli`', async () => {
    const spawn = makeFakeSpawn(scripted({ stdout: WHOAMI_STDOUT, code: 0 }, { stdout: 'answer', code: 0 }))
    const brain = new KiroCliBrain({ spawn: asSpawn(spawn.fn), env: {}, getStoredKey: () => '' })
    await brain.authStatus()
    await brain.generate([{ role: 'user', content: 'q' }])
    await brain.chat([{ role: 'user', content: 'hi' }])
    // Every spawn targets the headless CLI binary, never the IDE launcher.
    expect(spawn.calls.length).toBeGreaterThan(0)
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
