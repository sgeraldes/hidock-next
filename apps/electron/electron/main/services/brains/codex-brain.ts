/**
 * Codex brain — shells out to the installed, ChatGPT-logged-in `codex` CLI in
 * non-interactive exec mode. Preferred over the @openai/codex-sdk here so there's
 * no new npm dependency and the existing ChatGPT login session is reused
 * (verified installed: codex 0.144.x with an active login).
 *
 * Capabilities: generate, chat, agentic. NOT analyzeAudio, NOT embed.
 *
 *   generate → `codex exec`   (non-interactive; PROMPT PIPED VIA STDIN, capture stdout)
 *   chat     → same, with history folded into the prompt
 *
 * Confidentiality: the prompt/transcript is written to the child's STDIN, never
 * argv (`codex exec` with no positional reads instructions from stdin). Only fixed
 * flags (`exec`, `--model <id>`) live in argv.
 *
 * Auth detection prefers the codex-companion probe when present
 * (`codex-companion.mjs setup --json` → { codex.available, auth.loggedIn }); if
 * that companion isn't found or fails to parse, it falls back to the CLI's own
 * `codex login status` (structured/exit-coded auth check), NOT a version-only
 * probe — plus OPENAI_API_KEY in the env. authStatus()/generate() NEVER throw.
 */
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

const AUTH_TIMEOUT_MS = 8_000
const COMPANION_TIMEOUT_MS = 15_000
const GENERATE_TIMEOUT_MS = 180_000

export interface CodexBrainDeps {
  spawn?: SpawnFn
  env?: NodeJS.ProcessEnv
  /**
   * Absolute path to the codex-companion.mjs setup script, if known. When set and
   * present, its JSON is the authoritative auth signal. Injected for tests.
   */
  companionPath?: string
}

export class CodexBrain implements AIBrain {
  readonly id = 'codex' as const
  readonly label = 'Codex'

  private readonly spawn?: SpawnFn
  private readonly env: NodeJS.ProcessEnv
  private readonly companionPath?: string

  constructor(deps: CodexBrainDeps = {}) {
    this.spawn = deps.spawn
    this.env = deps.env ?? process.env
    this.companionPath = deps.companionPath
  }

  capabilities(): ReadonlySet<BrainCapability> {
    return CAPABILITIES
  }

  async authStatus(): Promise<BrainAuthStatus> {
    const hasApiKey = !!this.env.OPENAI_API_KEY?.trim()

    // 1. Preferred: the codex-companion setup probe (structured JSON).
    if (this.companionPath) {
      const viaCompanion = await this.authViaCompanion(hasApiKey)
      if (viaCompanion) return viaCompanion
    }

    // 2. Fallback: the CLI's own `codex login status`. This exercises the real
    //    login (unlike a version-only probe): it RAN ⇒ codex is installed; its
    //    exit code + text tell us whether a credential is actually present.
    try {
      const res = await runCli(
        'codex',
        ['login', 'status'],
        { timeoutMs: AUTH_TIMEOUT_MS, env: this.env },
        this.spawn
      )
      if (res.spawnError) {
        return hasApiKey
          ? { configured: true, method: 'api-key', detail: 'OPENAI_API_KEY set' }
          : { configured: false, method: 'none', detail: 'codex not on PATH' }
      }
      const loggedIn = res.code === 0 && /logged in/i.test(res.stdout)
      if (loggedIn) {
        const detail = res.stdout.trim().split(/\r?\n/)[0] || 'ChatGPT login active'
        return {
          configured: true,
          method: hasApiKey ? 'api-key' : 'cli-login',
          detail: hasApiKey ? 'OPENAI_API_KEY set' : detail,
        }
      }
      // codex installed but not logged in.
      if (hasApiKey) return { configured: true, method: 'api-key', detail: 'OPENAI_API_KEY set' }
      return { configured: false, method: 'none', detail: 'codex installed, not logged in' }
    } catch {
      return hasApiKey
        ? { configured: true, method: 'api-key', detail: 'OPENAI_API_KEY set' }
        : { configured: false, method: 'none', detail: 'codex not on PATH' }
    }
  }

  /** Run the codex companion and interpret its JSON. Returns null if unusable. */
  private async authViaCompanion(hasApiKey: boolean): Promise<BrainAuthStatus | null> {
    try {
      const res = await runCli(
        'node',
        [this.companionPath as string, 'setup', '--json'],
        { timeoutMs: COMPANION_TIMEOUT_MS, env: this.env },
        this.spawn
      )
      if (res.spawnError) return null
      const json = extractJson(res.stdout)
      if (!json) return null
      const available = !!(json.codex as Record<string, unknown> | undefined)?.available
      const loggedIn = !!(json.auth as Record<string, unknown> | undefined)?.loggedIn
      if (available && (loggedIn || hasApiKey)) {
        return {
          configured: true,
          method: hasApiKey ? 'api-key' : 'cli-login',
          detail: hasApiKey ? 'OPENAI_API_KEY set' : 'ChatGPT login active',
        }
      }
      if (available) {
        return { configured: false, method: 'none', detail: 'codex installed, not logged in' }
      }
      return { configured: false, method: 'none', detail: 'codex not available' }
    } catch {
      return null
    }
  }

  async generate(messages: BrainMessage[], opts: GenerateOptions = {}): Promise<string | null> {
    const prompt = foldMessagesToPrompt(messages, opts.systemPrompt)
    if (!prompt.trim()) return null

    // `codex exec` with no positional prompt reads instructions from stdin — keep
    // the prompt OUT of argv (confidentiality). Only fixed flags go in argv.
    const args = ['exec']
    if (opts.model) args.push('--model', opts.model)

    try {
      const res = await runCli(
        'codex',
        args,
        { timeoutMs: GENERATE_TIMEOUT_MS, signal: opts.signal, input: prompt, env: this.env },
        this.spawn
      )
      if (res.aborted || res.timedOut || res.spawnError || res.outputLimitExceeded) {
        if (res.outputLimitExceeded) console.error('[CodexBrain] generate aborted: output cap exceeded')
        return null
      }
      if (res.code !== 0) {
        console.error('[CodexBrain] generate failed:', res.stderr.trim() || `exit ${res.code}`)
        return null
      }
      const text = res.stdout.trim()
      return text.length > 0 ? text : null
    } catch (e) {
      console.error('[CodexBrain] generate threw unexpectedly:', e)
      return null
    }
  }

  async chat(messages: BrainMessage[], opts: GenerateOptions = {}): Promise<string | null> {
    // codex exec is stateless — fold history into one prompt.
    return this.generate(messages, opts)
  }
}

/**
 * Best-effort JSON extraction from a CLI's stdout — the companion may prefix log
 * lines before the JSON object. Returns the first parseable {...} block or null.
 */
function extractJson(stdout: string): Record<string, unknown> | null {
  const trimmed = stdout.trim()
  if (!trimmed) return null
  try {
    return JSON.parse(trimmed) as Record<string, unknown>
  } catch {
    /* fall through to brace scan */
  }
  const start = trimmed.indexOf('{')
  const end = trimmed.lastIndexOf('}')
  if (start >= 0 && end > start) {
    try {
      return JSON.parse(trimmed.slice(start, end + 1)) as Record<string, unknown>
    } catch {
      return null
    }
  }
  return null
}
