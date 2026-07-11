/**
 * cli-runner tests — the spawn/timeout/abort/no-throw contract every CLI brain
 * depends on. Uses the fake spawn (no real child process).
 *
 * @vitest-environment node
 */
import { describe, it, expect } from 'vitest'
import { mkdtempSync, writeFileSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join, delimiter } from 'path'
import {
  runCli,
  foldMessagesToPrompt,
  resolveWindowsExecutable,
  buildCmdInvocation,
  type SpawnFn,
} from '../cli-runner'
import { makeFakeSpawn } from './fake-spawn'

const asSpawn = (fn: unknown) => fn as SpawnFn
const itWin = process.platform === 'win32' ? it : it.skip

describe('runCli', () => {
  it('captures stdout + exit code on success', async () => {
    const spawn = makeFakeSpawn({ stdout: 'hello world', code: 0 })
    const res = await runCli('mycli', ['--flag', 'x'], { timeoutMs: 1000 }, asSpawn(spawn.fn))
    expect(res.code).toBe(0)
    expect(res.stdout).toBe('hello world')
    expect(res.spawnError).toBe(false)
    expect(res.timedOut).toBe(false)
    expect(res.aborted).toBe(false)
    expect(spawn.calls[0]).toMatchObject({ command: 'mycli', args: ['--flag', 'x'] })
  })

  it('captures stderr + non-zero code without throwing', async () => {
    const spawn = makeFakeSpawn({ stderr: 'boom', code: 2 })
    const res = await runCli('mycli', [], { timeoutMs: 1000 }, asSpawn(spawn.fn))
    expect(res.code).toBe(2)
    expect(res.stderr).toBe('boom')
  })

  it('resolves with spawnError when the process errors (ENOENT)', async () => {
    const spawn = makeFakeSpawn({ emitError: true })
    const res = await runCli('missing', [], { timeoutMs: 1000 }, asSpawn(spawn.fn))
    expect(res.spawnError).toBe(true)
    expect(res.code).toBeNull()
  })

  it('resolves with spawnError when spawn() itself throws', async () => {
    const throwingSpawn = asSpawn(() => {
      throw new Error('cannot spawn')
    })
    const res = await runCli('x', [], { timeoutMs: 1000 }, throwingSpawn)
    expect(res.spawnError).toBe(true)
  })

  it('kills the child and flags timedOut when it hangs past timeoutMs', async () => {
    const spawn = makeFakeSpawn({ never: true })
    const res = await runCli('hang', [], { timeoutMs: 20 }, asSpawn(spawn.fn))
    expect(res.timedOut).toBe(true)
    expect(res.code).toBeNull()
    expect(spawn.lastChild?.kill).toHaveBeenCalled()
  })

  it('kills the child when the abort signal fires', async () => {
    const spawn = makeFakeSpawn({ never: true })
    const controller = new AbortController()
    const p = runCli('hang', [], { timeoutMs: 5000, signal: controller.signal }, asSpawn(spawn.fn))
    controller.abort()
    const res = await p
    expect(res.aborted).toBe(true)
    expect(spawn.lastChild?.kill).toHaveBeenCalled()
  })

  it('does not spawn at all when the signal is already aborted', async () => {
    const spawn = makeFakeSpawn({ stdout: 'x', code: 0 })
    const controller = new AbortController()
    controller.abort()
    const res = await runCli('x', [], { timeoutMs: 1000, signal: controller.signal }, asSpawn(spawn.fn))
    expect(res.aborted).toBe(true)
    expect(spawn.calls).toHaveLength(0)
  })

  it('writes input to stdin then closes it', async () => {
    const spawn = makeFakeSpawn({ stdout: 'ok', code: 0 })
    await runCli('x', [], { timeoutMs: 1000, input: 'piped' }, asSpawn(spawn.fn))
    expect(spawn.lastChild?.stdin.write).toHaveBeenCalledWith('piped')
    expect(spawn.lastChild?.stdin.end).toHaveBeenCalled()
  })

  it('overlays env onto process.env', async () => {
    const spawn = makeFakeSpawn({ stdout: 'ok', code: 0 })
    await runCli('x', [], { timeoutMs: 1000, env: { FOO: 'bar' } }, asSpawn(spawn.fn))
    const opts = spawn.calls[0].options as { env: Record<string, string> }
    expect(opts.env.FOO).toBe('bar')
  })
})

// HIGH-2 — timeout/abort must WAIT for the child to actually terminate, escalate
// to a forceful process-tree kill when the child ignores the graceful signal, and
// only resolve once termination is confirmed (watchdog backstop).
describe('runCli — bounded termination (HIGH-2)', () => {
  it('escalates to a forceful tree-kill and resolves when the child ignores the signal', async () => {
    const spawn = makeFakeSpawn((cmd) =>
      /taskkill/i.test(cmd)
        ? { code: 0 } // the tree-killer itself
        : { never: true, ignoreKill: true, pid: 4321 } // stubborn child that ignores SIGTERM
    )
    const res = await runCli(
      'stubborn',
      [],
      { timeoutMs: 10, killGraceMs: 20, killWatchdogMs: 80 },
      asSpawn(spawn.fn)
    )
    expect(res.timedOut).toBe(true)
    expect(res.code).toBeNull()
    const main = spawn.children[0]
    // Graceful terminate first, then a forceful SIGKILL after the grace window.
    expect(main.kill).toHaveBeenCalled()
    expect(main.killSignals).toContain('SIGKILL')
    // On Windows the whole tree is torn down via taskkill /T /F.
    if (process.platform === 'win32') {
      expect(spawn.calls.some((c) => /taskkill/i.test(c.command))).toBe(true)
    }
  })

  it('resolves promptly (via close) when a killed child terminates normally', async () => {
    const spawn = makeFakeSpawn({ never: true }) // well-behaved: dies on kill()
    const res = await runCli('hang', [], { timeoutMs: 15, killGraceMs: 1000, killWatchdogMs: 5000 }, asSpawn(spawn.fn))
    expect(res.timedOut).toBe(true)
    expect(spawn.children[0].kill).toHaveBeenCalled()
  })
})

// HIGH (Codex review) — a killed wrapper (cmd.exe / .cmd shim) closes IMMEDIATELY
// while the real CLI keeps running underneath. The old code let that wrapper close
// clear the escalation and resolve, so the tree-kill never ran and the model
// invocation was orphaned. Tree teardown must be part of COMPLETION: run
// taskkill /pid <pid> /t /f and AWAIT it before resolving, regardless of the
// wrapper being reaped first.
describe('runCli — wrapper close must not skip tree teardown (Windows-shaped)', () => {
  const itWin = process.platform === 'win32' ? it : it.skip

  // (a) The wrapper closes first (models cmd.exe being reaped) but a descendant is
  // still alive → the tree-termination utility is invoked AND awaited before runCli
  // resolves. We prove "awaited" by delaying the tree-killer's exit and asserting
  // the run did not resolve until after that delay.
  itWin('invokes AND awaits the tree-termination utility even when the wrapper closes first', async () => {
    const TREE_KILL_DELAY = 40
    const spawn = makeFakeSpawn((cmd) =>
      /taskkill/i.test(cmd)
        ? { code: 0, delayMs: TREE_KILL_DELAY } // tree-killer takes time to confirm
        : { never: true, pid: 7777 } // wrapper: closes the instant we signal it
    )
    const start = Date.now()
    const res = await runCli(
      'wrapper',
      [],
      { timeoutMs: 10, killGraceMs: 1000, killWatchdogMs: 5000 },
      asSpawn(spawn.fn)
    )
    const elapsed = Date.now() - start
    expect(res.timedOut).toBe(true)
    expect(res.code).toBeNull()
    // Tree teardown ran despite the wrapper closing first…
    expect(spawn.calls.some((c) => /taskkill/i.test(c.command))).toBe(true)
    // …and runCli WAITED for it (did not resolve on the wrapper close alone).
    expect(elapsed).toBeGreaterThanOrEqual(TREE_KILL_DELAY - 5)
    // Confirmed teardown → NOT flagged unconfirmed.
    expect(res.terminationUnconfirmed).toBeFalsy()
  })

  // (b) When the tree teardown itself can't be confirmed in time, the absolute
  // watchdog resolves the run flagged terminationUnconfirmed — and the cleanup
  // (tree-kill) is still fired rather than the run silently returning.
  itWin('flags terminationUnconfirmed and still fires cleanup when the watchdog backstop trips', async () => {
    const spawn = makeFakeSpawn((cmd) =>
      /taskkill/i.test(cmd)
        ? { never: true } // tree-killer never confirms (models a stuck teardown)
        : { never: true, ignoreKill: true, pid: 8888 } // wrapper ignores signals, never closes
    )
    const res = await runCli(
      'stuck',
      [],
      { timeoutMs: 10, killGraceMs: 20, killWatchdogMs: 60 },
      asSpawn(spawn.fn)
    )
    expect(res.timedOut).toBe(true)
    expect(res.code).toBeNull()
    expect(res.terminationUnconfirmed).toBe(true)
    // Cleanup was still attempted (tree-termination dispatched) despite the
    // unconfirmed return — the survivor is not silently orphaned.
    expect(spawn.calls.some((c) => /taskkill/i.test(c.command))).toBe(true)
  })
})

// HIGH (Codex review, round 2) — the Windows tree-termination utility (taskkill)
// resolving on its `close`/`error` event WITHOUT checking the exit code meant a
// FAILED teardown (non-zero exit, error, or spawn throw) was reported as a
// confirmed kill, even though the CLI subtree may still be running. A failed
// teardown must flag terminationUnconfirmed. The platform gate is injected so this
// win32-shaped path is exercised on any host.
describe('runCli — Windows teardown failure must not be reported as confirmed (HIGH-1)', () => {
  it('flags terminationUnconfirmed when the tree-termination utility exits NON-ZERO', async () => {
    const spawn = makeFakeSpawn((cmd) =>
      /taskkill/i.test(cmd)
        ? { code: 1 } // teardown utility FAILS (e.g. access denied / invalid pid)
        : { never: true, pid: 5150 } // wrapper: closes the instant we signal it
    )
    const res = await runCli(
      'wrapper',
      [],
      { timeoutMs: 10, killGraceMs: 1000, killWatchdogMs: 5000 },
      asSpawn(spawn.fn),
      { platform: 'win32' }
    )
    expect(res.timedOut).toBe(true)
    expect(res.code).toBeNull()
    // The teardown WAS dispatched…
    expect(spawn.calls.some((c) => /taskkill/i.test(c.command))).toBe(true)
    // …but its non-zero exit means we could not confirm it.
    expect(res.terminationUnconfirmed).toBe(true)
  })

  it('flags terminationUnconfirmed when the tree-termination utility EMITS AN ERROR', async () => {
    const spawn = makeFakeSpawn((cmd) =>
      /taskkill/i.test(cmd)
        ? { emitError: true } // teardown utility cannot even run
        : { never: true, pid: 5151 }
    )
    const res = await runCli(
      'wrapper',
      [],
      { timeoutMs: 10, killGraceMs: 1000, killWatchdogMs: 5000 },
      asSpawn(spawn.fn),
      { platform: 'win32' }
    )
    expect(res.timedOut).toBe(true)
    expect(res.terminationUnconfirmed).toBe(true)
  })

  it('flags terminationUnconfirmed when the tree-termination utility FAILS TO SPAWN (throws)', async () => {
    const base = makeFakeSpawn({ never: true, pid: 6060 })
    const spawnFn = asSpawn((command: string, args: string[], options?: unknown) => {
      if (/taskkill/i.test(command)) throw new Error('EPERM')
      return base.fn(command, args, options)
    })
    const res = await runCli(
      'wrapper',
      [],
      { timeoutMs: 10, killGraceMs: 1000, killWatchdogMs: 5000 },
      spawnFn,
      { platform: 'win32' }
    )
    expect(res.timedOut).toBe(true)
    expect(res.terminationUnconfirmed).toBe(true)
  })

  it('does NOT flag terminationUnconfirmed when the tree-termination utility exits 0', async () => {
    const spawn = makeFakeSpawn((cmd) =>
      /taskkill/i.test(cmd)
        ? { code: 0 } // clean teardown
        : { never: true, pid: 5152 }
    )
    const res = await runCli(
      'wrapper',
      [],
      { timeoutMs: 10, killGraceMs: 1000, killWatchdogMs: 5000 },
      asSpawn(spawn.fn),
      { platform: 'win32' }
    )
    expect(res.timedOut).toBe(true)
    expect(spawn.calls.some((c) => /taskkill/i.test(c.command))).toBe(true)
    expect(res.terminationUnconfirmed).toBeFalsy()
  })
})

// HIGH (Codex review, round 2) — on POSIX the child was spawned WITHOUT
// `detached:true`, so its pid was not a process-group id; `process.kill(-pid,…)`
// throws ESRCH (swallowed) while descendants survive, yet the run resolved as a
// confirmed teardown. Fix: spawn the CLI as a process-group leader and VERIFY the
// group signal — a throw flags terminationUnconfirmed. The platform + process-group
// signaller are injected so this POSIX-shaped path is exercised on any host.
describe('runCli — POSIX process-group teardown (HIGH-2)', () => {
  it('spawns the child DETACHED (group leader) and signals the NEGATIVE pid on the normal path', async () => {
    const spawn = makeFakeSpawn({ never: true, ignoreKill: true, pid: 909 })
    const killed: Array<[number, string | number | undefined]> = []
    const res = await runCli(
      'posix-hang',
      [],
      { timeoutMs: 10, killGraceMs: 20, killWatchdogMs: 500 },
      asSpawn(spawn.fn),
      { platform: 'linux', processKill: (pid, signal) => void killed.push([pid, signal]) }
    )
    expect(res.timedOut).toBe(true)
    // The child was made a process-group leader so the group can be signalled.
    expect((spawn.calls[0].options as { detached?: boolean }).detached).toBe(true)
    // Teardown targeted the whole GROUP (negative pid), not just the leader.
    expect(killed).toContainEqual([-909, 'SIGKILL'])
    // The group signal succeeded → confirmed teardown.
    expect(res.terminationUnconfirmed).toBeFalsy()
  })

  it('flags terminationUnconfirmed when the POSIX group signal throws ESRCH', async () => {
    const spawn = makeFakeSpawn({ never: true, ignoreKill: true, pid: 4242 })
    const killed: number[] = []
    const res = await runCli(
      'posix-hang',
      [],
      { timeoutMs: 10, killGraceMs: 20, killWatchdogMs: 500 },
      asSpawn(spawn.fn),
      {
        platform: 'linux',
        processKill: (pid) => {
          killed.push(pid)
          const err = new Error('kill ESRCH') as NodeJS.ErrnoException
          err.code = 'ESRCH'
          throw err
        },
      }
    )
    expect(res.timedOut).toBe(true)
    // It DID attempt the group signal (negative pid)…
    expect(killed).toContain(-4242)
    // …but the throw means descendants may survive → unconfirmed.
    expect(res.terminationUnconfirmed).toBe(true)
  })
})

// HIGH-3 — unbounded stdout/stderr accumulation is a main-process DoS. Independent
// byte caps must stop reading, kill the tree, and flag the breach.
describe('runCli — output byte caps (HIGH-3)', () => {
  it('caps stdout, kills the child, and flags outputLimitExceeded', async () => {
    const spawn = makeFakeSpawn({ stdout: 'x'.repeat(500), never: true, pid: 99 })
    const res = await runCli(
      'flood',
      [],
      { timeoutMs: 5000, maxStdoutBytes: 100, killGraceMs: 10, killWatchdogMs: 50 },
      asSpawn(spawn.fn)
    )
    expect(res.outputLimitExceeded).toBe(true)
    expect(res.stdout.length).toBeLessThanOrEqual(100)
    expect(spawn.children[0].kill).toHaveBeenCalled()
  })

  it('caps stderr independently and flags outputLimitExceeded', async () => {
    const spawn = makeFakeSpawn({ stderr: 'e'.repeat(500), never: true, pid: 98 })
    const res = await runCli(
      'flood',
      [],
      { timeoutMs: 5000, maxStderrBytes: 100, killGraceMs: 10, killWatchdogMs: 50 },
      asSpawn(spawn.fn)
    )
    expect(res.outputLimitExceeded).toBe(true)
    expect(res.stderr.length).toBeLessThanOrEqual(100)
  })

  it('does NOT flag outputLimitExceeded for output within the cap', async () => {
    const spawn = makeFakeSpawn({ stdout: 'small', code: 0 })
    const res = await runCli('x', [], { timeoutMs: 1000, maxStdoutBytes: 1000 }, asSpawn(spawn.fn))
    expect(res.outputLimitExceeded).toBe(false)
    expect(res.stdout).toBe('small')
  })
})

// HIGH-1 — on Windows the CLIs are npm `.cmd` shims (or a bare `.exe`) that
// spawn(shell:false) CANNOT execute directly. This exercises the REAL resolver
// against a real `.cmd` fixture (no mocked spawn), the boundary all other tests
// bypass by injecting a fake spawn.
describe('Windows executable resolution (HIGH-1)', () => {
  const env = { ...process.env }

  it('resolveWindowsExecutable finds a bare-name `.cmd` on PATH and flags it as batch', () => {
    const dir = mkdtempSync(join(tmpdir(), 'cli-resolve-'))
    try {
      const cmd = join(dir, 'mytool.cmd')
      writeFileSync(cmd, '@echo off\r\necho ok\r\n')
      const resolved = resolveWindowsExecutable('mytool', { ...env, PATH: dir + delimiter + (env.PATH || '') })
      // On win32 this resolves; on other platforms PATHEXT resolution is a no-op
      // for the runner (direct exec) so we only assert the win32 behaviour here.
      if (process.platform === 'win32') {
        expect(resolved).not.toBeNull()
        expect(resolved!.isBatch).toBe(true)
        expect(resolved!.file.toLowerCase()).toBe(cmd.toLowerCase())
      }
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('resolveWindowsExecutable finds a bare-name `.exe` and does NOT flag it as batch', () => {
    const dir = mkdtempSync(join(tmpdir(), 'cli-resolve-'))
    try {
      const exe = join(dir, 'myexe.exe')
      writeFileSync(exe, 'stub') // never executed — resolver only checks existence
      const resolved = resolveWindowsExecutable('myexe', { ...env, PATH: dir + delimiter + (env.PATH || '') })
      if (process.platform === 'win32') {
        expect(resolved).not.toBeNull()
        expect(resolved!.isBatch).toBe(false)
      }
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('buildCmdInvocation wraps a .cmd for cmd.exe /d /s /c with the args', () => {
    const argv = buildCmdInvocation('C:\\tools\\mytool.cmd', ['-p', 'json'])
    expect(argv.slice(0, 3)).toEqual(['/d', '/s', '/c'])
    expect(argv[3]).toContain('mytool.cmd')
    expect(argv[3]).toContain('-p')
  })

  // The real boundary: run an actual `.cmd` shim by BARE NAME via runCli with the
  // real spawn. A bare `spawn('mytool', {shell:false})` would ENOENT here — this
  // passes only because runCli resolves the `.cmd` and routes it through cmd.exe.
  itWin('runs a real bare-name `.cmd` shim end-to-end (resolver + cmd.exe)', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'cli-run-'))
    try {
      writeFileSync(join(dir, 'resolveme.cmd'), '@echo off\r\necho RESOLVED_OK\r\n')
      const res = await runCli('resolveme', [], {
        timeoutMs: 15000,
        env: { PATH: dir + delimiter + (process.env.PATH || '') },
      })
      expect(res.spawnError).toBe(false)
      expect(res.code).toBe(0)
      expect(res.stdout).toContain('RESOLVED_OK')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  }, 20000)

  // Confidentiality boundary (MEDIUM-5): the prompt is piped via stdin and must
  // reach the child THROUGH the cmd.exe wrapper — proven with a real `.cmd`.
  itWin('forwards stdin through the cmd.exe wrapper to a real `.cmd`', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'cli-stdin-'))
    try {
      // `set /p` reads one line from stdin; echo it back so we can assert it arrived.
      writeFileSync(join(dir, 'echoin.cmd'), '@echo off\r\nset /p LINE=\r\necho GOT:%LINE%\r\n')
      const res = await runCli('echoin', [], {
        timeoutMs: 15000,
        input: 'secret-prompt-text\r\n',
        env: { PATH: dir + delimiter + (process.env.PATH || '') },
      })
      expect(res.code).toBe(0)
      expect(res.stdout).toContain('GOT:secret-prompt-text')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  }, 20000)

  itWin('runCli resolves spawnError when a bare name is not found on PATH', async () => {
    const res = await runCli('definitely-not-a-real-binary-xyz', [], {
      timeoutMs: 5000,
      env: { PATH: mkdtempSync(join(tmpdir(), 'empty-')) },
    })
    expect(res.spawnError).toBe(true)
  })
})

describe('foldMessagesToPrompt', () => {
  it('surfaces the system turn first, then role-labels the rest', () => {
    const out = foldMessagesToPrompt(
      [
        { role: 'system', content: 'be terse' },
        { role: 'user', content: 'hi' },
        { role: 'assistant', content: 'hello' },
        { role: 'user', content: 'bye' },
      ],
    )
    expect(out).toBe('System: be terse\n\nUser: hi\n\nAssistant: hello\n\nUser: bye')
  })

  it('prefers an explicit systemPrompt over an in-message system turn', () => {
    const out = foldMessagesToPrompt([{ role: 'user', content: 'x' }], 'override sys')
    expect(out).toBe('System: override sys\n\nUser: x')
  })

  it('omits the System line when there is no system content', () => {
    const out = foldMessagesToPrompt([{ role: 'user', content: 'only' }])
    expect(out).toBe('User: only')
  })
})
