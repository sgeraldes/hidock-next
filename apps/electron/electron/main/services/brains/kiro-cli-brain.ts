/**
 * Kiro CLI brain — shells out to the installed AWS **Kiro CLI** (`kiro-cli`, the
 * renamed Amazon Q Developer CLI) in its documented HEADLESS mode. Preferred over
 * adding an SDK dependency; reuses the CLI already on PATH.
 *
 * IMPORTANT — two different "Kiro" tools exist; this brain targets the CLI only:
 *   - `kiro` / `kiro.cmd`  → the Kiro **IDE** (a VS Code fork). Its `kiro chat`
 *     subcommand opens a chat panel in a GUI window (--maximize/--new-window). We
 *     NEVER invoke it — that would launch the editor.
 *   - `kiro-cli` / `kiro-cli.exe` → the headless terminal CLI. THIS is what we use.
 *
 * Capabilities: generate, chat, agentic. NOT analyzeAudio, NOT embed.
 *
 *   generate → `kiro-cli chat --no-interactive --trust-tools= "<prompt>"`
 *   chat     → same, with history folded into the prompt (headless is stateless)
 *
 * Headless invocation & auth per the official docs (https://kiro.dev/docs/cli/headless/):
 *   - `--no-interactive` runs without a terminal session; the prompt is passed as a
 *     positional argument (the doc's documented input method — NOT stdin).
 *   - `--trust-tools=` trusts NO tools, so a text `generate`/`chat` call can never
 *     execute shell/file tools (the CLI is agentic by default: `--mode agent`).
 *   - Headless REQUIRES an API key: the `KIRO_API_KEY` env var (key generated in the
 *     Kiro portal; needs a Kiro Pro/Power subscription). An interactive Builder ID /
 *     IAM Identity Center login (via `kiro-cli login`, shown by `kiro-cli whoami`) is
 *     NOT sufficient for headless mode — so authStatus reports configured ONLY when
 *     the API key is present, honestly labelling the login-but-no-key state.
 *
 * Confidentiality caveat: the documented headless input method puts the prompt in
 * argv (visible in the process list) rather than stdin; we follow the doc. On
 * win32 `kiro-cli.exe` is a native binary (no cmd.exe wrapper), so cli-runner
 * spawns it directly. authStatus()/generate() NEVER throw.
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
/** Cheap presence probe. */
const VERSION_TIMEOUT_MS = 8_000
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
    const key = this.resolveKey()

    // Presence probe — cheap `--version`; never launches a session.
    let present = false
    let version = 'installed'
    try {
      const res = await runCli(KIRO_CLI, ['--version'], { timeoutMs: VERSION_TIMEOUT_MS, env: this.env }, this.spawn)
      present = !res.spawnError && res.code === 0
      if (present) version = res.stdout.trim().split(/\r?\n/)[0] || 'installed'
    } catch {
      present = false
    }

    if (!present) {
      return { configured: false, method: 'none', detail: 'kiro-cli not on PATH' }
    }
    // Headless REQUIRES the API key — an interactive login is NOT sufficient, so
    // configured is gated on the key (honest per the headless docs).
    if (key) {
      return { configured: true, method: 'api-key', detail: `Kiro API key present + ${version}` }
    }
    return {
      configured: false,
      method: 'none',
      detail: `${version} installed — headless mode needs a Kiro API key (KIRO_API_KEY)`,
    }
  }

  async generate(messages: BrainMessage[], opts: GenerateOptions = {}): Promise<string | null> {
    const prompt = foldMessagesToPrompt(messages, opts.systemPrompt)
    if (!prompt.trim()) return null

    // Headless mode requires the API key — without it, do NOT spawn (never fall
    // back to an interactive session). Honest: no key ⇒ null, not a fake answer.
    const key = this.resolveKey()
    if (!key) return null

    // `chat --no-interactive` runs headless; `--trust-tools=` trusts NO tools so a
    // text generation can't execute shell/file tools. The prompt is the trailing
    // positional argument (the documented headless input method).
    const args = ['chat', '--no-interactive', '--trust-tools=']
    if (opts.model) args.push('--model', opts.model)
    args.push(prompt)

    // Ensure KIRO_API_KEY reaches the child (it may have come from the store).
    const env: NodeJS.ProcessEnv = this.env.KIRO_API_KEY ? this.env : { ...this.env, KIRO_API_KEY: key }

    try {
      const res = await runCli(
        KIRO_CLI,
        args,
        { timeoutMs: GENERATE_TIMEOUT_MS, signal: opts.signal, input: undefined, env },
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
      const text = res.stdout.trim()
      return text.length > 0 ? text : null
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

/** Default stored-key reader: BrainCredentialStore 'kiro' → 'apiKey'. Never throws. */
function defaultGetStoredKey(): string {
  try {
    return getBrainCredentialStore().getSecret('kiro', 'apiKey') ?? ''
  } catch {
    return ''
  }
}
