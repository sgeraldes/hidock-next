/**
 * Test helper: a fake `child_process.spawn` for the CLI-spawning brains.
 *
 * Not a test file (no `.test.ts` suffix) so vitest doesn't collect it. Produces a
 * minimal EventEmitter-backed ChildProcess that emits canned stdout/stderr and a
 * close code, and records the spawn arguments + kill() calls so tests can assert
 * argv construction and abort/timeout handling without a real process.
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
  /** Never emit close/error (models a hang so timeout/abort can fire). */
  never?: boolean
  /** Delay (ms) before emitting close/error. Default 0 (next microtask). */
  delayMs?: number
}

export interface FakeChild extends EventEmitter {
  stdout: EventEmitter
  stderr: EventEmitter
  stdin: { write: ReturnType<typeof vi.fn>; end: ReturnType<typeof vi.fn> }
  kill: ReturnType<typeof vi.fn>
  killed: boolean
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
  lastChild: FakeChild | null
}

/**
 * Build a fake spawn. `script` may be a single script (applied to every call) or
 * a function mapping (command, args) → script, for per-command behaviour.
 */
export function makeFakeSpawn(
  script: FakeSpawnScript | ((command: string, args: string[]) => FakeSpawnScript)
): FakeSpawn {
  const state: FakeSpawn = { fn: undefined as never, calls: [], lastChild: null }

  state.fn = (command: string, args: string[], options?: unknown): FakeChild => {
    const s = typeof script === 'function' ? script(command, args) : script
    state.calls.push({ command, args, options })

    const child = new EventEmitter() as FakeChild
    child.stdout = new EventEmitter()
    child.stderr = new EventEmitter()
    child.killed = false
    child.kill = vi.fn(() => {
      child.killed = true
      return true
    })
    child.stdin = { write: vi.fn(), end: vi.fn() }
    state.lastChild = child

    const emit = () => {
      if (s.stdout) child.stdout.emit('data', Buffer.from(s.stdout))
      if (s.stderr) child.stderr.emit('data', Buffer.from(s.stderr))
      if (s.never) return
      if (s.emitError) {
        child.emit('error', new Error('ENOENT'))
      } else {
        child.emit('close', s.code === undefined ? 0 : s.code)
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
