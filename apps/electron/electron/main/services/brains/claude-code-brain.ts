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
 *
 * IDENTITY-AWARE: preferring a later exe by basename alone could execute an
 * UNRELATED vendor's `claude.exe` (prompt leakage). So a native candidate is only
 * selected after it PROVES it is Anthropic Claude Code — its `--version` output
 * must match the CLI's signature format (`<semver> (Claude Code)`, verified on
 * this machine: `2.1.207 (Claude Code)`). Unverifiable candidates are skipped and
 * the bare command fallback applies. The resolution is cached per brain instance.
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

  /** Cached identity-verified command resolution (per instance). */
  private resolvedCommand?: Promise<string>

  /**
   * The `claude` command to spawn. With an injected (fake) spawn — unit tests —
   * keep the bare command so argv assertions stay stable (the fake bypasses OS
   * resolution anyway). Only the REAL spawn path needs the identity-verified
   * native-exe preference that dodges a broken `.cmd`/WSL proxy shim; the
   * resolution itself is separately unit-tested via resolveClaudeCommand's seams.
   */
  private claudeCommand(): Promise<string> {
    if (this.spawn) return Promise.resolve('claude')
    if (!this.resolvedCommand) this.resolvedCommand = resolveClaudeCommand(this.env)
    return this.resolvedCommand
  }

  async authStatus(): Promise<BrainAuthStatus> {
    const hasApiKey = !!this.env.ANTHROPIC_API_KEY?.trim()
    try {
      // `claude auth status --json` → { loggedIn, authMethod, email, ... }. This
      // exercises the real credential store, so a logged-out/expired CLI is not
      // advertised as usable (unlike a version-only probe).
      const res = await runCli(
        await this.claudeCommand(),
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
        await this.claudeCommand(),
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

/** `claude --version` prints `<semver> (Claude Code)` — the identity signature. */
const CLAUDE_VERSION_SIGNATURE = /\d+\.\d+\.\d+.*\bclaude code\b/is
/** Bounded identity probe (local `--version`; no network, no model call). */
const IDENTITY_PROBE_TIMEOUT_MS = 8_000

/** Injectable seams so the real selection path is unit-testable on any host. */
export interface ClaudeCommandResolveOpts {
  /** Override the platform gate (default: process.platform). */
  platform?: NodeJS.Platform
  /** Override candidate existence checks (default: fs.existsSync). */
  fileExists?: (p: string) => boolean
  /**
   * Override the identity verifier (default: run `<candidate> --version` via
   * runCli and require the Claude Code signature). MUST return false for any
   * binary that is not Anthropic Claude Code.
   */
  verify?: (candidatePath: string) => Promise<boolean>
}

/**
 * Resolve the `claude` command to spawn on Windows, dodging broken proxy shims
 * WITHOUT ever trusting a basename. See the module header for the shim story.
 *
 * Selection is IDENTITY-AWARE: a native `claude.exe`/`.com` found on PATH is only
 * preferred after `verify()` proves it is Anthropic Claude Code (its `--version`
 * output matches the known signature). An unrelated vendor's claude.exe fails the
 * signature and is SKIPPED — we then fall back to the bare `claude` command, i.e.
 * cli-runner's normal cmd.exe-like resolution (a working npm `.cmd` still runs;
 * shim-only machines are unchanged). Never throws.
 */
export async function resolveClaudeCommand(
  env: NodeJS.ProcessEnv,
  opts: ClaudeCommandResolveOpts = {}
): Promise<string> {
  const platform = opts.platform ?? process.platform
  if (platform !== 'win32') return 'claude'
  const fileExists = opts.fileExists ?? existsSync
  const verify = opts.verify ?? ((candidate: string) => verifyClaudeIdentity(candidate, env))
  // Only extensions that execute DIRECTLY — never .cmd/.bat/.ps1 wrapper shims.
  // Lowercase is fine: Windows' filesystem match is case-insensitive.
  const nativeExts = ['.exe', '.com']
  const dirs = (env.PATH || env.Path || '').split(delimiter).filter(Boolean)
  for (const dir of dirs) {
    for (const ext of nativeExts) {
      const candidate = join(dir, 'claude' + ext)
      if (!fileExists(candidate)) continue
      try {
        if (await verify(candidate)) return candidate
      } catch {
        /* unverifiable candidate — skip it */
      }
    }
  }
  return 'claude'
}

/**
 * Default identity verifier: run the candidate's own `--version` (bounded, local,
 * no model call) and require the Claude Code signature, e.g. `2.1.207 (Claude
 * Code)`. A random third-party claude.exe will not match. Never throws.
 */
async function verifyClaudeIdentity(candidatePath: string, env: NodeJS.ProcessEnv): Promise<boolean> {
  try {
    const res = await runCli(candidatePath, ['--version'], { timeoutMs: IDENTITY_PROBE_TIMEOUT_MS, env })
    return !res.spawnError && res.code === 0 && CLAUDE_VERSION_SIGNATURE.test(res.stdout)
  } catch {
    return false
  }
}
