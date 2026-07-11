/**
 * Claude Code brain — shells out to the installed, logged-in `claude` CLI in
 * headless/print mode. Preferred over the @anthropic-ai/claude-agent-sdk here so
 * there's no new npm dependency and the existing Claude Code login session is
 * reused directly (verified installed: claude 2.1.x with an active login).
 *
 * Capabilities: generate, chat, agentic. NOT analyzeAudio, NOT embed — audio and
 * embeddings never route here (the BrainRouter enforces that, spec §B.4).
 *
 *   generate → `claude -p`   (print mode; PROMPT PIPED VIA STDIN, capture stdout)
 *   chat     → same, with history folded into the prompt
 *
 * Confidentiality: the (potentially sensitive) prompt/transcript is written to the
 * child's STDIN, never argv — so it can't be read from another process's command
 * line. Only fixed flags (`-p`, `--model <id>`) live in argv.
 *
 * Auth: probed HONESTLY via `claude auth status --json` (structured `loggedIn`),
 * NOT a bare `--version` (which only proves the binary exists, not that it's
 * usable). An ANTHROPIC_API_KEY in the env also counts as configured.
 * authStatus()/generate() NEVER throw; they resolve to a not-configured status /
 * null on any failure.
 *
 * WINDOWS EXEC PATH (root cause of the "auth status unavailable" badge): on a
 * machine where PATH resolves `claude` to a `.cmd`/`.bat`/`.ps1` PROXY shim (e.g.
 * one that re-invokes claude inside WSL, where it isn't installed), the probe ran
 * the shim → exit 127, empty stdout → the JSON parse saw nothing → we reported the
 * CLI as unusable even though the real native `claude.exe` (later on PATH) is
 * logged in. cli-runner mirrors cmd.exe/`where` semantics (first PATH dir wins,
 * shim included), so here we resolve the NATIVE `claude.exe`/`.com` ourselves and
 * hand runCli its absolute path — for BOTH the auth probe and generate, so the
 * badge and the actual work agree. Machines with only a working npm `.cmd` (no
 * native exe) are unaffected (we fall back to the bare command).
 */
import { existsSync } from 'fs'
import { delimiter, join } from 'path'
import { runCli, foldMessagesToPrompt, type SpawnFn } from './cli-runner'
import type {
  AIBrain,
  BrainAuthStatus,
  BrainCapability,
  BrainMessage,
  GenerateOptions,
} from './types'

const CAPABILITIES: ReadonlySet<BrainCapability> = new Set<BrainCapability>([
  'generate',
  'chat',
  'agentic',
])

/** Cheap, local auth-status probe (reads credential files; no model call). */
const AUTH_TIMEOUT_MS = 8_000
/** One-shot generation upper bound. */
const GENERATE_TIMEOUT_MS = 120_000

export interface ClaudeCodeBrainDeps {
  /** Injected for tests; defaults to node's child_process.spawn. */
  spawn?: SpawnFn
  /** Injected for tests; defaults to process.env. */
  env?: NodeJS.ProcessEnv
}

export class ClaudeCodeBrain implements AIBrain {
  readonly id = 'claude-code' as const
  readonly label = 'Claude Code'

  private readonly spawn?: SpawnFn
  private readonly env: NodeJS.ProcessEnv

  constructor(deps: ClaudeCodeBrainDeps = {}) {
    this.spawn = deps.spawn
    this.env = deps.env ?? process.env
  }

  capabilities(): ReadonlySet<BrainCapability> {
    return CAPABILITIES
  }

  /**
   * The `claude` command to spawn. With an injected (fake) spawn — unit tests —
   * keep the bare command so argv assertions stay stable (the fake bypasses OS
   * resolution anyway). Only the REAL spawn path needs the native-exe preference
   * that dodges a broken `.cmd`/WSL proxy shim.
   */
  private claudeCommand(): string {
    return this.spawn ? 'claude' : preferNativeWindowsCommand('claude', this.env)
  }

  async authStatus(): Promise<BrainAuthStatus> {
    const hasApiKey = !!this.env.ANTHROPIC_API_KEY?.trim()
    try {
      // `claude auth status --json` → { loggedIn, authMethod, email, ... }. This
      // exercises the real credential store, so a logged-out/expired CLI is not
      // advertised as usable (unlike a version-only probe).
      const res = await runCli(
        this.claudeCommand(),
        ['auth', 'status', '--json'],
        { timeoutMs: AUTH_TIMEOUT_MS, env: this.env },
        this.spawn
      )

      if (res.spawnError) {
        return hasApiKey
          ? { configured: true, method: 'api-key', detail: 'ANTHROPIC_API_KEY set' }
          : { configured: false, method: 'none', detail: 'claude not on PATH' }
      }

      const status = res.code === 0 ? parseAuthJson(res.stdout) : null
      if (status?.loggedIn) {
        // Prefer the login METHOD (e.g. "claude.ai", "console.anthropic.com") for
        // the badge — that's the auth actually in use — falling back to the email.
        const method = typeof status.authMethod === 'string' && status.authMethod ? status.authMethod : ''
        const who = method
          ? ` (${method})`
          : typeof status.email === 'string' && status.email
            ? ` as ${status.email}`
            : ''
        return {
          configured: true,
          method: hasApiKey ? 'api-key' : 'cli-login',
          detail: hasApiKey ? `API key + Claude login${who}` : `Logged in${who}`,
        }
      }

      // CLI present but NOT logged in (status said so, or the probe errored).
      if (hasApiKey) {
        return { configured: true, method: 'api-key', detail: 'ANTHROPIC_API_KEY set' }
      }
      return {
        configured: false,
        method: 'none',
        detail: status ? 'claude installed, not logged in' : 'claude installed, auth status unavailable',
      }
    } catch {
      return hasApiKey
        ? { configured: true, method: 'api-key', detail: 'ANTHROPIC_API_KEY set' }
        : { configured: false, method: 'none', detail: 'claude not on PATH' }
    }
  }

  async generate(messages: BrainMessage[], opts: GenerateOptions = {}): Promise<string | null> {
    const prompt = foldMessagesToPrompt(messages, opts.systemPrompt)
    if (!prompt.trim()) return null

    // `claude -p` with a piped stdin reads the prompt from stdin — keep the prompt
    // OUT of argv (confidentiality). Only fixed flags go in argv.
    const args = ['-p']
    if (opts.model) args.push('--model', opts.model)

    try {
      const res = await runCli(
        this.claudeCommand(),
        args,
        { timeoutMs: GENERATE_TIMEOUT_MS, signal: opts.signal, input: prompt, env: this.env },
        this.spawn
      )
      if (res.aborted || res.timedOut || res.spawnError || res.outputLimitExceeded) {
        if (res.outputLimitExceeded) console.error('[ClaudeCodeBrain] generate aborted: output cap exceeded')
        return null
      }
      if (res.code !== 0) {
        console.error('[ClaudeCodeBrain] generate failed:', res.stderr.trim() || `exit ${res.code}`)
        return null
      }
      const text = res.stdout.trim()
      return text.length > 0 ? text : null
    } catch (e) {
      console.error('[ClaudeCodeBrain] generate threw unexpectedly:', e)
      return null
    }
  }

  async chat(messages: BrainMessage[], opts: GenerateOptions = {}): Promise<string | null> {
    // The claude CLI print mode is stateless — fold history into one prompt.
    return this.generate(messages, opts)
  }
}

interface ClaudeAuthJson {
  loggedIn?: boolean
  authMethod?: unknown
  email?: unknown
}

/** Parse `claude auth status --json`. Returns null on any non-JSON / parse failure. */
function parseAuthJson(stdout: string): ClaudeAuthJson | null {
  const trimmed = stdout.trim()
  if (!trimmed) return null
  try {
    return JSON.parse(trimmed) as ClaudeAuthJson
  } catch {
    const start = trimmed.indexOf('{')
    const end = trimmed.lastIndexOf('}')
    if (start >= 0 && end > start) {
      try {
        return JSON.parse(trimmed.slice(start, end + 1)) as ClaudeAuthJson
      } catch {
        return null
      }
    }
    return null
  }
}

/**
 * Prefer a NATIVE `claude.exe`/`.com` over a `.cmd`/`.bat`/`.ps1` proxy shim on
 * Windows. See the module header for why: a first-on-PATH proxy shim (e.g. WSL
 * re-invocation) breaks the auth probe even when the real native binary is logged
 * in. Scans PATH for `command.exe`/`.com` and returns its absolute path; when none
 * exists (normal `.cmd`-only npm installs) returns the bare command unchanged so
 * cli-runner's own resolution — including a working `.cmd` — still applies.
 *
 * `platform`/`fileExists` are injectable for hermetic unit tests; real callers use
 * the live `process.platform` / `fs.existsSync`.
 */
export function preferNativeWindowsCommand(
  command: string,
  env: NodeJS.ProcessEnv,
  opts: { platform?: NodeJS.Platform; fileExists?: (p: string) => boolean } = {}
): string {
  const platform = opts.platform ?? process.platform
  if (platform !== 'win32') return command
  const fileExists = opts.fileExists ?? existsSync
  // Only extensions that execute DIRECTLY — never .cmd/.bat/.ps1 wrapper shims.
  // Lowercase is fine: Windows' filesystem match is case-insensitive.
  const nativeExts = ['.exe', '.com']
  const dirs = (env.PATH || env.Path || '').split(delimiter).filter(Boolean)
  for (const dir of dirs) {
    for (const ext of nativeExts) {
      const candidate = join(dir, command + ext)
      if (fileExists(candidate)) return candidate
    }
  }
  return command
}
