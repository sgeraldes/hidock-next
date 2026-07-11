/**
 * Kiro CLI brain — shells out to the installed AWS **Kiro CLI** (`kiro-cli`, the
 * renamed Amazon Q Developer CLI) in its headless mode. Preferred over adding an
 * SDK dependency; reuses the CLI already on PATH.
 *
 * IMPORTANT — two different "Kiro" tools exist; this brain targets the CLI only:
 *   - `kiro` / `kiro.cmd`  → the Kiro **IDE** (a VS Code fork). Its `kiro chat`
 *     subcommand opens a chat panel in a GUI window (--maximize/--new-window). We
 *     NEVER invoke it — that would launch the editor.
 *   - `kiro-cli` / `kiro-cli.exe` → the headless terminal CLI. THIS is what we use.
 *
 * Capabilities: generate, chat, agentic. NOT analyzeAudio, NOT embed.
 *
 *   generate → `kiro-cli chat --no-interactive --trust-tools=`
 *              (PROMPT PIPED VIA STDIN, capture stdout)
 *   chat     → same, with history folded into the prompt (headless is stateless)
 *
 * Confidentiality: the prompt is written to the child's STDIN, never argv — the
 * same contract as the sibling CLI brains. VERIFIED on this machine:
 * `echo <prompt> | kiro-cli chat --no-interactive --trust-tools=` reads the piped
 * stdin as the question and answers on stdout (exit 0). Keeping the prompt out of
 * argv also removes the option-injection hazard of a leading-dash prompt being
 * parsed as a Kiro flag (which could otherwise defeat --trust-tools=). Only fixed
 * flags live in argv; `--trust-tools=` (empty set) trusts NO tools, so a text
 * generate/chat can never execute shell/file tools even though the CLI is agentic
 * by default (`--mode agent`).
 *
 * Output: kiro-cli decorates stdout with ANSI escapes and a `> ` answer marker
 * even when piped — parseKiroOutput() strips those (credits/timing go to stderr).
 *
 * Auth (login-first, honest):
 *   1. The CLI's own login session (`kiro-cli login`, Builder ID / IAM Identity
 *      Center) — probed via `kiro-cli whoami --format json` (cheap, local, exit 0
 *      + JSON when logged in). VERIFIED on this machine: a logged-in session
 *      authenticates headless chat with NO API key.
 *   2. KIRO_API_KEY (env, or the app's stored key) — the documented headless-CI
 *      auth (https://kiro.dev/docs/cli/headless/). Reported as a FALLBACK when no
 *      login is present, and labelled "(unverified)" because the key is never
 *      exercised against the service in this cheap probe.
 * authStatus()/generate() NEVER throw.
 */
import { runCli, foldMessagesToPrompt, type SpawnFn } from './cli-runner'
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

/** The headless CLI binary (NOT the `kiro` IDE launcher). */
const KIRO_CLI = 'kiro-cli'
/** Cheap presence/login probes. */
const PROBE_TIMEOUT_MS = 8_000
/** One-shot generation upper bound (agentic CLI; allow generous headroom). */
const GENERATE_TIMEOUT_MS = 180_000

export interface KiroCliBrainDeps {
  /** Injected for tests; defaults to node's child_process.spawn. */
  spawn?: SpawnFn
  /** Injected for tests; defaults to process.env. */
  env?: NodeJS.ProcessEnv
  /**
   * The app's stored Kiro API key (BrainCredentialStore 'kiro' → 'apiKey').
   * Injected for tests; defaults to reading the credential store.
   */
  getStoredKey?: () => string
}

export class KiroCliBrain implements AIBrain {
  readonly id = 'kiro' as const
  readonly label = 'Kiro CLI'

  private readonly spawn?: SpawnFn
  private readonly env: NodeJS.ProcessEnv
  private readonly getStoredKey: () => string

  constructor(deps: KiroCliBrainDeps = {}) {
    this.spawn = deps.spawn
    this.env = deps.env ?? process.env
    this.getStoredKey = deps.getStoredKey ?? defaultGetStoredKey
  }

  capabilities(): ReadonlySet<BrainCapability> {
    return CAPABILITIES
  }

  /** The headless API key (env var, else the app's stored key). '' when absent. */
  private resolveKey(): string {
    const fromEnv = this.env.KIRO_API_KEY?.trim()
    if (fromEnv) return fromEnv
    try {
      return this.getStoredKey()?.trim() || ''
    } catch {
      return ''
    }
  }

  async authStatus(): Promise<BrainAuthStatus> {
    const hasKey = !!this.resolveKey()

    // LOGIN-FIRST: `kiro-cli whoami --format json` is a cheap, local session probe
    // (exit 0 + JSON when logged in). It doubles as the presence probe — if it
    // spawned at all, the CLI is installed.
    try {
      const res = await runCli(
        KIRO_CLI,
        ['whoami', '--format', 'json'],
        { timeoutMs: PROBE_TIMEOUT_MS, env: this.env },
        this.spawn
      )
      if (res.spawnError) {
        // CLI absent → nothing can run headless chat; not configured.
        return { configured: false, method: 'none', detail: 'kiro-cli not on PATH' }
      }
      const who = res.code === 0 ? parseWhoami(res.stdout) : null
      if (who) {
        const label = [who.accountType, who.email].filter(Boolean).join(', ')
        return {
          configured: true,
          method: 'cli-login',
          detail: label ? `Kiro login active (${label})` : 'Kiro login active',
        }
      }
      // Installed but not logged in → the documented headless API key is the
      // fallback. Honest: the key is present, NOT verified against the service.
      if (hasKey) {
        return { configured: true, method: 'api-key', detail: 'Kiro API key present (unverified)' }
      }
      return {
        configured: false,
        method: 'none',
        detail: 'kiro-cli installed, not logged in (run kiro-cli login, or set KIRO_API_KEY)',
      }
    } catch {
      return { configured: false, method: 'none', detail: 'kiro-cli not on PATH' }
    }
  }

  async generate(messages: BrainMessage[], opts: GenerateOptions = {}): Promise<string | null> {
    const prompt = foldMessagesToPrompt(messages, opts.systemPrompt)
    if (!prompt.trim()) return null

    // `chat --no-interactive` runs headless (it fails fast instead of prompting
    // when unauthenticated — never opens a session/GUI); `--trust-tools=` trusts
    // NO tools so a text generation can't execute shell/file tools. The prompt is
    // PIPED VIA STDIN — never argv (confidentiality + no option injection).
    const args = ['chat', '--no-interactive', '--trust-tools=']
    if (opts.model) args.push('--model', opts.model)

    // Make the app's stored key available to the child when the env lacks one
    // (harmless when the login session is the effective auth).
    const key = this.resolveKey()
    const env: NodeJS.ProcessEnv =
      key && !this.env.KIRO_API_KEY ? { ...this.env, KIRO_API_KEY: key } : this.env

    try {
      const res = await runCli(
        KIRO_CLI,
        args,
        { timeoutMs: GENERATE_TIMEOUT_MS, signal: opts.signal, input: prompt, env },
        this.spawn
      )
      if (res.aborted || res.timedOut || res.spawnError || res.outputLimitExceeded) {
        if (res.outputLimitExceeded) console.error('[KiroCliBrain] generate aborted: output cap exceeded')
        return null
      }
      if (res.code !== 0) {
        console.error('[KiroCliBrain] generate failed:', res.stderr.trim() || `exit ${res.code}`)
        return null
      }
      return parseKiroOutput(res.stdout)
    } catch (e) {
      console.error('[KiroCliBrain] generate threw unexpectedly:', e)
      return null
    }
  }

  async chat(messages: BrainMessage[], opts: GenerateOptions = {}): Promise<string | null> {
    // Headless chat is stateless — fold history into one prompt.
    return this.generate(messages, opts)
  }
}

/**
 * Clean kiro-cli's decorated stdout into plain answer text. Even when piped, the
 * CLI emits ANSI color/cursor escapes and prefixes the answer with a `> ` marker
 * (observed on this machine: `\x1b[38;5;141m> \x1b[0mOK`). Returns null when
 * nothing remains. Exported for direct unit testing.
 */
export function parseKiroOutput(stdout: string): string | null {
  // eslint-disable-next-line no-control-regex
  const noAnsi = stdout.replace(/\x1b\[[0-9;?]*[a-zA-Z]/g, '')
  let text = noAnsi.trim()
  if (text.startsWith('>')) text = text.slice(1).trimStart()
  return text.length > 0 ? text : null
}

/**
 * Parse `kiro-cli whoami --format json`. The JSON object can be followed by
 * plain-text profile lines on stdout (observed), so extract the first {...}
 * block. Returns null when no parseable login info is present (treated as
 * "not logged in").
 */
function parseWhoami(stdout: string): { accountType?: string; email?: string } | null {
  const trimmed = stdout.trim()
  if (!trimmed) return null
  const start = trimmed.indexOf('{')
  const end = trimmed.indexOf('}', start)
  if (start < 0 || end <= start) return null
  try {
    const parsed = JSON.parse(trimmed.slice(start, end + 1)) as Record<string, unknown>
    return {
      accountType: typeof parsed.accountType === 'string' ? parsed.accountType : undefined,
      email: typeof parsed.email === 'string' ? parsed.email : undefined,
    }
  } catch {
    return null
  }
}

/** Default stored-key reader: BrainCredentialStore 'kiro' → 'apiKey'. Never throws. */
function defaultGetStoredKey(): string {
  try {
    return getBrainCredentialStore().getSecret('kiro', 'apiKey') ?? ''
  } catch {
    return ''
  }
}
