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
 * CLI as unusable even though the real native `claude.exe` is logged in.
 * cli-runner mirrors cmd.exe/`where` semantics (first PATH dir wins, shim
 * included), so here we resolve the NATIVE `claude.exe` ourselves and hand runCli
 * its absolute path — for BOTH the auth probe and generate, so the badge and the
 * actual work agree. Machines with only a working npm `.cmd` (no native exe) are
 * unaffected (bare-command fallback).
 *
 * SECURITY (identity + trusted roots): native-exe discovery NEVER touches
 * arbitrary PATH directories (executing a discovered binary to identity-probe it
 * would grant code execution to any malicious exe on PATH). Discovery order:
 * explicit user-configured path (credential store 'claude-code'/'claudePath' —
 * the escape hatch; shape-validated AND identity-verified before trust, since
 * the renderer-exposed setCredential channel can write it) → TRUSTED install
 * roots only (the official installer dir %USERPROFILE%\.local\bin) → bare
 * command. EVERY discovered/configured candidate must pass the bounded
 * `--version` signature (`<semver> (Claude Code)`, verified live: `2.1.207
 * (Claude Code)`) before selection. The resolution is cached per brain instance
 * and re-resolved ONCE after a spawn error / unusable probe (stale-cache
 * recovery without retry loops).
 */
import { statSync } from 'fs'
import { homedir } from 'os'
import { join } from 'path'
import { runCli, foldMessagesToPrompt, type SpawnFn, type CliRunResult } from './cli-runner'
import { getBrainCredentialStore } from './brain-credential-store'
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
  /**
   * Injected command resolution seam (tests). Default: resolveClaudeCommand(env)
   * with a real spawn, or the bare 'claude' with an injected fake spawn (so argv
   * assertions stay stable).
   */
  resolveCommand?: () => Promise<string>
}

export class ClaudeCodeBrain implements AIBrain {
  readonly id = 'claude-code' as const
  readonly label = 'Claude Code'

  private readonly spawn?: SpawnFn
  private readonly env: NodeJS.ProcessEnv
  private readonly resolveCommand?: () => Promise<string>

  constructor(deps: ClaudeCodeBrainDeps = {}) {
    this.spawn = deps.spawn
    this.env = deps.env ?? process.env
    this.resolveCommand = deps.resolveCommand
  }

  capabilities(): ReadonlySet<BrainCapability> {
    return CAPABILITIES
  }

  /** Cached identity-verified command resolution (per instance). */
  private resolvedCommand?: Promise<string>

  /**
   * The `claude` command to spawn, cached per instance. With an injected (fake)
   * spawn and no explicit resolveCommand — unit tests — keep the bare command so
   * argv assertions stay stable (the fake bypasses OS resolution anyway). Only
   * the REAL spawn path needs the trusted-root, identity-verified native-exe
   * preference that dodges a broken `.cmd`/WSL proxy shim.
   *
   * STALENESS: the cache is invalidated (invalidateResolvedCommand) after a
   * spawn error or an unusable auth probe, and the operation re-resolves ONCE —
   * so an install/uninstall/PATH change mid-session recovers on the next call
   * without an app restart and without retry loops.
   */
  private claudeCommand(): Promise<string> {
    if (!this.resolvedCommand) {
      if (this.resolveCommand) this.resolvedCommand = this.resolveCommand()
      else if (this.spawn) this.resolvedCommand = Promise.resolve('claude')
      else this.resolvedCommand = resolveClaudeCommand(this.env)
    }
    return this.resolvedCommand
  }

  /** Drop the cached resolution so the next claudeCommand() re-resolves. */
  private invalidateResolvedCommand(): void {
    this.resolvedCommand = undefined
  }

  private async runAuthProbe(): Promise<CliRunResult> {
    const cmd = await this.claudeCommand()
    return runCli(cmd, ['auth', 'status', '--json'], { timeoutMs: AUTH_TIMEOUT_MS, env: this.env }, this.spawn)
  }

  async authStatus(): Promise<BrainAuthStatus> {
    const hasApiKey = !!this.env.ANTHROPIC_API_KEY?.trim()
    try {
      // `claude auth status --json` → { loggedIn, authMethod, email, ... }. This
      // exercises the real credential store, so a logged-out/expired CLI is not
      // advertised as usable (unlike a version-only probe).
      let res = await this.runAuthProbe()
      let status = !res.spawnError && res.code === 0 ? parseAuthJson(res.stdout) : null

      // Unusable probe (couldn't spawn, non-zero exit, or unparseable output) may
      // mean the CACHED resolution went stale (exe uninstalled, shim broke, or a
      // native exe was installed after we fell back). Invalidate and re-resolve
      // ONCE — never a loop. A clean "not logged in" (code 0 + parsed JSON) is a
      // legitimate answer and is NOT retried.
      if (res.spawnError || !status) {
        this.invalidateResolvedCommand()
        res = await this.runAuthProbe()
        status = !res.spawnError && res.code === 0 ? parseAuthJson(res.stdout) : null
      }

      if (res.spawnError) {
        return hasApiKey
          ? { configured: true, method: 'api-key', detail: 'ANTHROPIC_API_KEY set' }
          : { configured: false, method: 'none', detail: 'claude not on PATH' }
      }

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
      let res = await runCli(
        await this.claudeCommand(),
        args,
        { timeoutMs: GENERATE_TIMEOUT_MS, signal: opts.signal, input: prompt, env: this.env },
        this.spawn
      )
      if (res.spawnError) {
        // The cached resolution may be stale (exe uninstalled/moved). Re-resolve
        // ONCE and retry — cheap, since a spawn error means nothing ran.
        this.invalidateResolvedCommand()
        res = await runCli(
          await this.claudeCommand(),
          args,
          { timeoutMs: GENERATE_TIMEOUT_MS, signal: opts.signal, input: prompt, env: this.env },
          this.spawn
        )
      }
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
  /** Override the candidate check (default: is an existing REGULAR file). */
  fileExists?: (p: string) => boolean
  /**
   * Override the identity verifier (default: run `<candidate> --version` via
   * runCli and require the Claude Code signature). MUST return false for any
   * binary that is not Anthropic Claude Code.
   */
  verify?: (candidatePath: string) => Promise<boolean>
  /**
   * Override the user-configured absolute path (escape hatch for nonstandard
   * installs). Default: credential store 'claude-code' → 'claudePath'.
   */
  getConfiguredPath?: () => string
  /**
   * Override the TRUSTED install roots scanned for a native exe. Default: the
   * official Claude Code native-installer directory `%USERPROFILE%\.local\bin`.
   */
  trustedRoots?: string[]
}

/**
 * Resolve the `claude` command to spawn, dodging broken proxy shims WITHOUT ever
 * executing untrusted binaries. See the module header for the shim story.
 *
 * SECURITY: candidates are NEVER discovered from arbitrary PATH positions — a
 * malicious/unrelated exe dropped anywhere on PATH would otherwise get executed
 * by the identity probe itself (the signature check runs AFTER execution, so it
 * cannot establish trust). Discovery is restricted to:
 *   1. The EXPLICIT user-configured path (credential store 'claude-code' →
 *      'claudePath') — the escape hatch for nonstandard installs. This value is
 *      NOT blindly trusted: the generic renderer-exposed brains:setCredential
 *      channel can write it, so "user consent" is not guaranteed by this code
 *      path. The override must be an ABSOLUTE path to an existing REGULAR file
 *      (UNC/network paths rejected; on win32 it must end in .exe/.com — never a
 *      wrapper shim), and must pass the SAME bounded `--version` identity
 *      signature as trusted-root candidates BEFORE being accepted. A failing
 *      override is logged and falls through — it is never executed for real work.
 *   2. TRUSTED INSTALL ROOTS only (the official native-installer dir
 *      `%USERPROFILE%\.local\bin`, where the real claude.exe lives) — a candidate
 *      found there must ADDITIONALLY pass the `--version` identity signature
 *      before being selected.
 *   3. Otherwise: the bare `claude` command — exactly what Windows would normally
 *      select (cli-runner's cmd.exe-like resolution; npm `.cmd` installs and
 *      shim-only machines unchanged).
 * Never throws.
 */
export async function resolveClaudeCommand(
  env: NodeJS.ProcessEnv,
  opts: ClaudeCommandResolveOpts = {}
): Promise<string> {
  const platform = opts.platform ?? process.platform
  const fileExists = opts.fileExists ?? isRegularFileSync
  const verify = opts.verify ?? ((candidate: string) => verifyClaudeIdentity(candidate, env))

  // 1. Explicit configured override — validated and identity-verified, never
  //    blindly executed (verify-before-trust; see the SECURITY note above).
  try {
    const configured = (opts.getConfiguredPath ?? defaultGetConfiguredClaudePath)()
    if (configured) {
      if (!isAcceptableClaudePathOverride(configured, platform)) {
        console.warn(
          '[ClaudeCodeBrain] configured claudePath rejected without execution ' +
            `(must be an absolute, non-UNC path${platform === 'win32' ? ' ending in .exe/.com' : ''}): ${configured}`
        )
      } else if (!fileExists(configured)) {
        console.warn(`[ClaudeCodeBrain] configured claudePath is not an existing regular file: ${configured}`)
      } else if (await verify(configured)) {
        return configured
      } else {
        console.warn(
          '[ClaudeCodeBrain] configured claudePath failed the Claude Code identity check ' +
            `(--version signature); ignoring it: ${configured}`
        )
      }
    }
  } catch {
    /* misbehaving override source/verifier — ignore and continue */
  }

  if (platform !== 'win32') return 'claude'

  // 2. Trusted install roots only — never arbitrary PATH directories. Only
  //    extensions that execute DIRECTLY (never .cmd/.bat/.ps1 wrapper shims);
  //    lowercase is fine, Windows' filesystem match is case-insensitive.
  const nativeExts = ['.exe', '.com']
  const roots = opts.trustedRoots ?? defaultTrustedClaudeRoots()
  for (const root of roots) {
    for (const ext of nativeExts) {
      const candidate = join(root, 'claude' + ext)
      if (!fileExists(candidate)) continue
      try {
        if (await verify(candidate)) return candidate
      } catch {
        /* unverifiable candidate — skip it */
      }
    }
  }
  // 3. Whatever Windows would normally select.
  return 'claude'
}

/**
 * Shape-validate a configured claudePath BEFORE any filesystem or execution
 * contact: absolute only (no relative segments resolved against a hostile cwd),
 * no UNC/network paths (`\\server\share`, `//host/share`), and on win32 only a
 * directly-executable native extension (.exe/.com — never .cmd/.bat/.ps1 shims).
 * Deliberately platform-parameterized (not host `path.isAbsolute`) so the rule
 * matches the platform being resolved for, deterministically on any test host.
 */
function isAcceptableClaudePathOverride(p: string, platform: NodeJS.Platform): boolean {
  if (/^[\\/]{2}/.test(p)) return false // UNC / network path
  if (platform === 'win32') {
    if (!/^[A-Za-z]:[\\/]/.test(p)) return false // absolute drive-letter path only
    return /\.(exe|com)$/i.test(p)
  }
  return p.startsWith('/')
}

/** True when the path exists AND is a regular file (not a dir/junction target trick). */
function isRegularFileSync(p: string): boolean {
  try {
    return statSync(p).isFile()
  } catch {
    return false
  }
}

/** Official Claude Code native-installer location(s). Never throws. */
function defaultTrustedClaudeRoots(): string[] {
  try {
    return [join(homedir(), '.local', 'bin')]
  } catch {
    return []
  }
}

/** User-configured absolute claude path (credential store escape hatch). */
function defaultGetConfiguredClaudePath(): string {
  try {
    return getBrainCredentialStore().getSecret('claude-code', 'claudePath')?.trim() ?? ''
  } catch {
    return ''
  }
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
