/**
 * Shared CLI runner for the agentic "brain" adapters (Claude Code / Codex /
 * Gemini CLI). Each of those brains prefers shelling out to its already-installed,
 * already-authenticated CLI in headless mode rather than adding an SDK dependency.
 *
 * The three requirements the brief pins down for every spawn:
 *   - a bounded timeout (never hang the main process),
 *   - honour a caller AbortSignal (wired straight to child.kill()),
 *   - NEVER throw — a failed/absent binary resolves to a non-zero result.
 *
 * `spawn` is injected (defaulting to node's child_process.spawn) so unit tests can
 * feed canned stdout/exit codes and assert the constructed argv without touching a
 * real process. Cross-platform safe: uses windowsHide and shell:false everywhere.
 */
import { spawn as nodeSpawn } from 'child_process'
import type { SpawnOptions } from 'child_process'

/** The subset of child_process.spawn these adapters rely on (injectable for tests). */
export type SpawnFn = typeof nodeSpawn

export interface CliRunOptions {
  cwd?: string
  /** Hard upper bound; on expiry the child is killed and `timedOut` is set. */
  timeoutMs: number
  signal?: AbortSignal
  /** Optional text piped to the child's stdin (then stdin is closed). */
  input?: string
  /** Extra environment overlaid on process.env. */
  env?: NodeJS.ProcessEnv
}

export interface CliRunResult {
  /** Exit code, or null when the process was killed (timeout/abort/signal). */
  code: number | null
  stdout: string
  stderr: string
  timedOut: boolean
  aborted: boolean
  /** Set when the binary could not be spawned at all (ENOENT etc.). */
  spawnError: boolean
}

/**
 * Spawn a CLI, collect stdout/stderr, and resolve (never reject) with the result.
 * A spawn failure, timeout, or abort all resolve to a well-formed result the
 * caller can branch on — so authStatus()/generate() stay throw-free.
 */
export function runCli(
  command: string,
  args: string[],
  opts: CliRunOptions,
  spawnFn: SpawnFn = nodeSpawn
): Promise<CliRunResult> {
  return new Promise<CliRunResult>((resolve) => {
    let settled = false
    let stdout = ''
    let stderr = ''
    let timedOut = false
    let aborted = false

    // Already-aborted signal: don't even spawn.
    if (opts.signal?.aborted) {
      resolve({ code: null, stdout: '', stderr: '', timedOut: false, aborted: true, spawnError: false })
      return
    }

    const spawnOptions: SpawnOptions = {
      cwd: opts.cwd,
      windowsHide: true,
      shell: false,
      env: opts.env ? { ...process.env, ...opts.env } : process.env,
      stdio: ['pipe', 'pipe', 'pipe'],
    }

    let child: ReturnType<SpawnFn>
    try {
      child = spawnFn(command, args, spawnOptions)
    } catch {
      resolve({ code: null, stdout: '', stderr: '', timedOut: false, aborted: false, spawnError: true })
      return
    }

    const cleanup = () => {
      clearTimeout(timer)
      if (opts.signal) opts.signal.removeEventListener('abort', onAbort)
    }

    const finish = (result: CliRunResult) => {
      if (settled) return
      settled = true
      cleanup()
      resolve(result)
    }

    const kill = () => {
      try {
        child.kill()
      } catch {
        /* already gone */
      }
    }

    const timer = setTimeout(() => {
      timedOut = true
      kill()
      finish({ code: null, stdout, stderr, timedOut: true, aborted: false, spawnError: false })
    }, opts.timeoutMs)

    const onAbort = () => {
      aborted = true
      kill()
      finish({ code: null, stdout, stderr, timedOut, aborted: true, spawnError: false })
    }

    if (opts.signal) opts.signal.addEventListener('abort', onAbort, { once: true })

    child.stdout?.on('data', (d: Buffer) => {
      stdout += d.toString()
    })
    child.stderr?.on('data', (d: Buffer) => {
      stderr += d.toString()
    })

    child.on('error', () => {
      // Spawn/runtime error (ENOENT, etc.) — treat as a non-fatal spawn failure.
      finish({ code: null, stdout, stderr, timedOut, aborted, spawnError: true })
    })

    child.on('close', (code: number | null) => {
      finish({ code, stdout, stderr, timedOut, aborted, spawnError: false })
    })

    if (opts.input !== undefined && child.stdin) {
      try {
        child.stdin.write(opts.input)
        child.stdin.end()
      } catch {
        /* stdin may already be closed; ignore */
      }
    }
  })
}

/**
 * Fold a chat message list into a single prompt string for CLIs that take one
 * positional prompt (no native multi-turn). System turns are surfaced first,
 * then each turn is role-labelled so the model keeps speaker context.
 */
export function foldMessagesToPrompt(messages: { role: string; content: string }[], systemPrompt?: string): string {
  const parts: string[] = []
  const system = systemPrompt ?? messages.find((m) => m.role === 'system')?.content
  if (system) parts.push(`System: ${system}`)
  for (const m of messages) {
    if (m.role === 'system') continue
    const label = m.role === 'assistant' ? 'Assistant' : 'User'
    parts.push(`${label}: ${m.content}`)
  }
  return parts.join('\n\n')
}
