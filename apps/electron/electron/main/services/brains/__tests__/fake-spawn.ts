/**
 * Test helper: a fake `child_process.spawn` for the CLI-spawning brains.
 *
 * Not a test file (no `.test.ts` suffix) so vitest doesn't collect it. Produces a
 * minimal EventEmitter-backed ChildProcess that emits canned stdout/stderr and a
 * close code, and records the spawn arguments + kill() calls so tests can assert
 * argv construction and abort/timeout handling without a real process.
 *
 * By default a `kill()` makes the child emit `close` (models a well-behaved
 * process that dies on signal), so timeout/abort resolve promptly. Set
 * `ignoreKill` to model a STUBBORN process that ignores termination — used to
 * exercise the runner's grace→forceful tree-kill escalation.
 */
import { EventEmitter } from 'events'
import { vi } from 'vitest'

export interface FakeSpawnScript {
  stdout?: string
  stderr?: string
  /** Exit code emitted via 'close'. Use null to model a kill. Ignored if never/emitError. */
  code?: number | null
  /** Emit an 'error' event (ENOENT etc.) instead of closing. */
  emitError?: boolean
  /** Never emit close/error on its own (models a hang so timeout/abort can fire). */
  never?: boolean
  /** Ignore kill() — the child does NOT die on signal (models a stubborn process). */
  ignoreKill?: boolean
  /** Fake pid, so the runner's Windows tree-kill (taskkill /pid) path can run. */
  pid?: number
  /** Delay (ms) before emitting close/error. Default 0 (next microtask). */
  delayMs?: number
}

export interface FakeChild extends EventEmitter {
  stdout: EventEmitter
  stderr: EventEmitter
  stdin: { write: ReturnType<typeof vi.fn>; end: ReturnType<typeof vi.fn> }
  kill: ReturnType<typeof vi.fn>
  killed: boolean
  killSignals: (string | undefined)[]
  pid?: number
}

export interface FakeSpawnCall {
  command: string
  args: string[]
  options: unknown
}

export interface FakeSpawn {
  // Signature-compatible enough with child_process.spawn for the runner's use.
  fn: (command: string, args: string[], options?: unknown) => FakeChild
  calls: FakeSpawnCall[]
  children: FakeChild[]
  lastChild: FakeChild | null
}

/**
 * Build a fake spawn. `script` may be a single script (applied to every call) or
 * a function mapping (command, args) → script, for per-command behaviour.
 */
export function makeFakeSpawn(
  script: FakeSpawnScript | ((command: string, args: string[]) => FakeSpawnScript)
): FakeSpawn {
  const state: FakeSpawn = { fn: undefined as never, calls: [], children: [], lastChild: null }

  state.fn = (command: string, args: string[], options?: unknown): FakeChild => {
    const s = typeof script === 'function' ? script(command, args) : script
    state.calls.push({ command, args, options })

    const child = new EventEmitter() as FakeChild
    child.stdout = new EventEmitter()
    child.stderr = new EventEmitter()
    child.killed = false
    child.killSignals = []
    child.pid = s.pid
    let closed = false
    const emitClose = (code: number | null) => {
      if (closed) return
      closed = true
      child.emit('close', code)
    }
    child.kill = vi.fn((signal?: string) => {
      child.killSignals.push(signal)
      child.killed = true
      // A well-behaved process dies on signal → emits close. A stubborn one
      // (ignoreKill) does not, so the runner must escalate.
      if (!s.ignoreKill) Promise.resolve().then(() => emitClose(null))
      return true
    })
    child.stdin = { write: vi.fn(), end: vi.fn() }
    state.lastChild = child
    state.children.push(child)

    const emit = () => {
      if (s.stdout) child.stdout.emit('data', Buffer.from(s.stdout))
      if (s.stderr) child.stderr.emit('data', Buffer.from(s.stderr))
      if (s.never) return
      if (s.emitError) {
        child.emit('error', new Error('ENOENT'))
      } else {
        emitClose(s.code === undefined ? 0 : s.code)
      }
    }

    if (s.delayMs && s.delayMs > 0) {
      setTimeout(emit, s.delayMs)
    } else {
      // Defer to next microtask so listeners attach first.
      Promise.resolve().then(emit)
    }

    return child
  }

  return state
}
