/**
 * Shared CLI runner for the agentic "brain" adapters (Claude Code / Codex /
 * Gemini CLI). Each of those brains prefers shelling out to its already-installed,
 * already-authenticated CLI in headless mode rather than adding an SDK dependency.
 *
 * The requirements every spawn has to honour:
 *   - a bounded timeout (never hang the main process),
 *   - honour a caller AbortSignal,
 *   - NEVER throw — a failed/absent binary resolves to a non-zero result,
 *   - be safe on Windows, where the CLIs are npm-generated `.cmd` shims (or a
 *     bare `.exe`) that `child_process.spawn` with `shell:false` CANNOT execute
 *     directly (Node ignores PATHEXT). We resolve the concrete executable and, for
 *     batch shims, invoke via `cmd.exe /d /s /c` with cross-spawn-style escaping.
 *   - bounded execution: on timeout/abort/output-cap we terminate the WHOLE
 *     process tree (a killed shim can leave the real CLI + its descendants alive),
 *     wait for the child to actually exit, escalate to a forceful tree-kill after a
 *     grace period, and only resolve once termination is confirmed (with an
 *     absolute watchdog backstop so we still never hang).
 *   - bounded memory: independent byte caps on stdout/stderr so untrusted model
 *     output during the 2-3 minute window can't exhaust the main process (DoS).
 *
 * `spawn` is injected (defaulting to node's child_process.spawn) so unit tests can
 * feed canned stdout/exit codes and assert the constructed argv without touching a
 * real process. OS-level executable resolution (win32 PATHEXT / `.cmd` handling)
 * only runs for the REAL spawn — an injected fake bypasses that boundary, so the
 * dedicated resolution test exercises it against a real `.cmd` fixture instead.
 */
import { spawn as nodeSpawn } from 'child_process'
import type { SpawnOptions, ChildProcess } from 'child_process'
import { existsSync } from 'fs'
import { join, delimiter, extname } from 'path'

/** The subset of child_process.spawn these adapters rely on (injectable for tests). */
export type SpawnFn = typeof nodeSpawn

/** Default byte caps — generous for legitimate output, bounded against a DoS. */
const DEFAULT_MAX_STDOUT_BYTES = 10 * 1024 * 1024 // 10 MiB
const DEFAULT_MAX_STDERR_BYTES = 2 * 1024 * 1024 // 2 MiB
/** Graceful→forceful escalation window on the process tree. */
const DEFAULT_KILL_GRACE_MS = 2_000
/** Absolute backstop after a termination request before resolving regardless. */
const DEFAULT_KILL_WATCHDOG_MS = 8_000

export interface CliRunOptions {
  cwd?: string
  /** Hard upper bound; on expiry the child (tree) is killed and `timedOut` is set. */
  timeoutMs: number
  signal?: AbortSignal
  /** Optional text piped to the child's stdin (then stdin is closed). */
  input?: string
  /** Extra environment overlaid on process.env. */
  env?: NodeJS.ProcessEnv
  /** Max bytes buffered from stdout before the run is aborted. Default 10 MiB. */
  maxStdoutBytes?: number
  /** Max bytes buffered from stderr before the run is aborted. Default 2 MiB. */
  maxStderrBytes?: number
  /** ms between the graceful terminate request and the forceful tree-kill. Default 2000. */
  killGraceMs?: number
  /** Absolute ms after a termination request before we resolve regardless. Default 8000. */
  killWatchdogMs?: number
}

export interface CliRunResult {
  /** Exit code, or null when the process was killed (timeout/abort/cap/watchdog). */
  code: number | null
  stdout: string
  stderr: string
  timedOut: boolean
  aborted: boolean
  /** Set when the binary could not be spawned/resolved at all (ENOENT etc.). */
  spawnError: boolean
  /** Set when stdout/stderr blew past its byte cap and the process tree was killed. */
  outputLimitExceeded: boolean
}

export interface ResolvedExecutable {
  /** Concrete file to spawn (absolute or PATH-resolved). */
  file: string
  /** True for `.cmd`/`.bat` shims that must go through cmd.exe. */
  isBatch: boolean
}

function hasPathSeparator(cmd: string): boolean {
  return cmd.includes('/') || cmd.includes('\\')
}

function isBatchFile(file: string): boolean {
  return /\.(cmd|bat)$/i.test(file)
}

/**
 * Resolve a bare command name to a concrete Windows executable using PATH +
 * PATHEXT — the resolution `child_process.spawn` does NOT do with `shell:false`.
 * Returns null when nothing is found (caller treats that as ENOENT).
 *
 * Exported for direct unit testing.
 */
export function resolveWindowsExecutable(command: string, env: NodeJS.ProcessEnv): ResolvedExecutable | null {
  const pathext = (env.PATHEXT || '.COM;.EXE;.BAT;.CMD')
    .split(';')
    .map((e) => e.trim())
    .filter(Boolean)

  // Already an explicit path and/or has an extension.
  if (hasPathSeparator(command) || extname(command)) {
    if (existsSync(command)) return { file: command, isBatch: isBatchFile(command) }
    if (!extname(command)) {
      for (const ext of pathext) {
        const candidate = command + ext
        if (existsSync(candidate)) return { file: candidate, isBatch: isBatchFile(candidate) }
      }
    }
    return null
  }

  // Bare name: search each PATH dir with each PATHEXT extension.
  const dirs = (env.PATH || env.Path || '').split(delimiter).filter(Boolean)
  for (const dir of dirs) {
    for (const ext of pathext) {
      const candidate = join(dir, command + ext)
      if (existsSync(candidate)) return { file: candidate, isBatch: isBatchFile(candidate) }
    }
  }
  return null
}

// cmd.exe / CommandLineToArgvW escaping, ported from the vetted `cross-spawn`
// implementation (https://github.com/moxystudio/node-cross-spawn). We only ever
// put FIXED flags (and an occasional model id) in argv — the prompt/transcript is
// piped via stdin — so this escaping is defence-in-depth, not the primary channel.
const CMD_META = /([()\][%!^"`<>&|;, *?])/g

function escapeCmdCommand(arg: string): string {
  return arg.replace(CMD_META, '^$1')
}

function escapeCmdArgument(arg: string, doubleEscape: boolean): string {
  let out = `${arg}`
  // Double up backslashes before a quote, then escape the quote.
  out = out.replace(/(\\*)"/g, '$1$1\\"')
  // Double up trailing backslashes (they precede the closing quote).
  out = out.replace(/(\\*)$/, '$1$1')
  out = `"${out}"`
  out = out.replace(CMD_META, '^$1')
  if (doubleEscape) out = out.replace(CMD_META, '^$1')
  return out
}

/**
 * Build the `cmd.exe` argv for running a `.cmd`/`.bat` shim with the given args.
 * Pair with `windowsVerbatimArguments: true` so Node passes the pre-escaped line
 * through untouched.
 */
export function buildCmdInvocation(file: string, args: string[]): string[] {
  const doubleEscape = isBatchFile(file)
  const parts = [escapeCmdCommand(file), ...args.map((a) => escapeCmdArgument(a, doubleEscape))]
  return ['/d', '/s', '/c', `"${parts.join(' ')}"`]
}

function taskkillPath(): string {
  const root = process.env.SystemRoot || process.env.windir || 'C:\\Windows'
  return join(root, 'System32', 'taskkill.exe')
}

/**
 * Spawn a CLI, collect stdout/stderr, and resolve (never reject) with the result.
 * A spawn failure, timeout, abort, or output-cap breach all resolve to a
 * well-formed result the caller can branch on — so authStatus()/generate() stay
 * throw-free.
 */
export function runCli(
  command: string,
  args: string[],
  opts: CliRunOptions,
  spawnFn: SpawnFn = nodeSpawn
): Promise<CliRunResult> {
  return new Promise<CliRunResult>((resolve) => {
    const maxStdoutBytes = opts.maxStdoutBytes ?? DEFAULT_MAX_STDOUT_BYTES
    const maxStderrBytes = opts.maxStderrBytes ?? DEFAULT_MAX_STDERR_BYTES
    const killGraceMs = opts.killGraceMs ?? DEFAULT_KILL_GRACE_MS
    const killWatchdogMs = opts.killWatchdogMs ?? DEFAULT_KILL_WATCHDOG_MS

    let settled = false
    let stdout = ''
    let stderr = ''
    let stdoutBytes = 0
    let stderrBytes = 0
    let timedOut = false
    let aborted = false
    let outputLimitExceeded = false
    let terminating = false

    let graceTimer: ReturnType<typeof setTimeout> | undefined
    let watchdog: ReturnType<typeof setTimeout> | undefined

    const done = (spawnError: boolean, code: number | null) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      if (graceTimer) clearTimeout(graceTimer)
      if (watchdog) clearTimeout(watchdog)
      if (opts.signal) opts.signal.removeEventListener('abort', onAbort)
      resolve({ code, stdout, stderr, timedOut, aborted, spawnError, outputLimitExceeded })
    }

    // Resolve a spawn/resolution failure that happens BEFORE the timer/abort
    // listener are wired up (no child, nothing to clean up) — a direct resolve
    // avoids touching the not-yet-initialized `timer`.
    const resolveSpawnFailure = () => {
      if (settled) return
      settled = true
      resolve({
        code: null,
        stdout: '',
        stderr: '',
        timedOut: false,
        aborted: false,
        spawnError: true,
        outputLimitExceeded: false,
      })
    }

    // Already-aborted signal: don't even spawn.
    if (opts.signal?.aborted) {
      resolve({
        code: null,
        stdout: '',
        stderr: '',
        timedOut: false,
        aborted: true,
        spawnError: false,
        outputLimitExceeded: false,
      })
      return
    }

    const effectiveEnv = opts.env ? { ...process.env, ...opts.env } : process.env

    // Resolve the concrete executable (win32 + real spawn only). An injected fake
    // spawn deliberately bypasses OS resolution so tests assert on the bare argv.
    let spawnFile = command
    let spawnArgs = args
    const spawnOptions: SpawnOptions = {
      cwd: opts.cwd,
      windowsHide: true,
      shell: false,
      env: effectiveEnv,
      stdio: ['pipe', 'pipe', 'pipe'],
    }

    if (spawnFn === nodeSpawn && process.platform === 'win32') {
      const resolved = resolveWindowsExecutable(command, effectiveEnv)
      if (!resolved) {
        // Nothing on PATH — behave exactly like an ENOENT spawn failure.
        resolveSpawnFailure()
        return
      }
      if (resolved.isBatch) {
        spawnFile = effectiveEnv.ComSpec || process.env.ComSpec || 'cmd.exe'
        spawnArgs = buildCmdInvocation(resolved.file, args)
        ;(spawnOptions as SpawnOptions & { windowsVerbatimArguments?: boolean }).windowsVerbatimArguments = true
      } else {
        spawnFile = resolved.file
      }
    }

    let child: ChildProcess
    try {
      child = spawnFn(spawnFile, spawnArgs, spawnOptions)
    } catch {
      resolveSpawnFailure()
      return
    }

    const forceKillTree = () => {
      try {
        child.kill('SIGKILL')
      } catch {
        /* already gone */
      }
      const pid = child.pid
      if (pid && process.platform === 'win32') {
        // A killed .cmd shim can leave the real CLI (and its children) running —
        // taskkill /T tears down the whole tree. Fire-and-forget.
        try {
          const killer = spawnFn(taskkillPath(), ['/pid', String(pid), '/t', '/f'], {
            windowsHide: true,
            stdio: 'ignore',
          })
          killer.on?.('error', () => {})
        } catch {
          /* best-effort */
        }
      } else if (pid && process.platform !== 'win32') {
        try {
          // Negative pid targets the whole process group where available.
          process.kill(-pid, 'SIGKILL')
        } catch {
          /* group kill unsupported / already gone */
        }
      }
    }

    const beginTermination = () => {
      if (terminating) return
      terminating = true
      // 1. Ask nicely.
      try {
        child.kill()
      } catch {
        /* already gone */
      }
      // 2. Escalate to a forceful tree-kill if it ignores the signal.
      graceTimer = setTimeout(forceKillTree, killGraceMs)
      // 3. Absolute backstop: if the child never emits 'close', resolve anyway so
      //    we never hang the main process.
      watchdog = setTimeout(() => {
        forceKillTree()
        done(false, null)
      }, killWatchdogMs)
    }

    const timer = setTimeout(() => {
      timedOut = true
      beginTermination()
    }, opts.timeoutMs)

    const onAbort = () => {
      aborted = true
      beginTermination()
    }
    if (opts.signal) opts.signal.addEventListener('abort', onAbort, { once: true })

    child.stdout?.on('data', (d: Buffer) => {
      if (outputLimitExceeded) return
      const before = stdoutBytes
      stdoutBytes += d.length
      if (stdoutBytes > maxStdoutBytes) {
        const remaining = Math.max(0, maxStdoutBytes - before)
        stdout += d.subarray(0, remaining).toString()
        outputLimitExceeded = true
        beginTermination()
        return
      }
      stdout += d.toString()
    })
    child.stderr?.on('data', (d: Buffer) => {
      if (outputLimitExceeded) return
      const before = stderrBytes
      stderrBytes += d.length
      if (stderrBytes > maxStderrBytes) {
        const remaining = Math.max(0, maxStderrBytes - before)
        stderr += d.subarray(0, remaining).toString()
        outputLimitExceeded = true
        beginTermination()
        return
      }
      stderr += d.toString()
    })

    child.on('error', () => {
      // Spawn/runtime error (ENOENT, etc.) — treat as a non-fatal spawn failure.
      done(true, null)
    })

    child.on('close', (code: number | null) => {
      done(false, code)
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
