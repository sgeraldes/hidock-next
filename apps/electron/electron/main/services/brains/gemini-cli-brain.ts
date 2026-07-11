/**
 * Gemini CLI brain — shells out to the installed `gemini` CLI in headless mode.
 * Distinct from the Gemini-API brain (@google/generative-ai): this one drives the
 * `@google/gemini-cli` binary, reusing its GEMINI_API_KEY / OAuth login. Preferred
 * over adding an SDK dependency (verified installed: gemini 0.49.x).
 *
 * Capabilities: generate, chat, agentic. NOT analyzeAudio, NOT embed — the CLI has
 * no embed command, so embeddings still route to gemini-api/ollama (spec §B.4).
 *
 *   generate → `gemini -p "" --output-format json`  (PROMPT PIPED VIA STDIN) → parse .response
 *   chat     → same, with history folded into the prompt (CLI is stateless)
 *
 * Confidentiality: the prompt/transcript is written to the child's STDIN, never
 * argv. `gemini -p ""` is the headless trigger (an empty `--prompt` value); the
 * piped stdin becomes the actual prompt (verified: stdin content reaches the
 * model). Only fixed flags (`-p ""`, `--output-format json`, `--model <id>`) live
 * in argv.
 *
 * Auth (login-aware, honest): the CLI's OWN auth is detected first, then keys.
 *   1. GEMINI_API_KEY in the env            → "GEMINI_API_KEY env (unverified)"
 *   2. the app's stored Gemini key          → "app key (injected, unverified)"
 *      (credential store / config.transcription.geminiApiKey via resolveGeminiApiKey)
 *   3. the CLI's OAuth login (cheap file check for ~/.gemini/oauth_creds.json,
 *      which the `gemini` CLI writes on `gemini` interactive sign-in)
 *      → "OAuth login (stored credentials)"
 * A key is NOT exercised against the API (that would be a paid call in a "cheap,
 * cached" probe), so keys report "present" not "verified", and OAuth reports the
 * PRESENCE of stored credentials — never a claim of a verified live session
 * (honest-auth rule). Order 1→2 first because generate() injects that key into the
 * child env, so it's the auth actually used when present. authStatus()/generate()
 * NEVER throw.
 */
import { existsSync } from 'fs'
import { homedir } from 'os'
import { join } from 'path'
import { runCli, foldMessagesToPrompt, type SpawnFn } from './cli-runner'
import { resolveGeminiApiKey } from './gemini-api-brain'
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

const VERSION_TIMEOUT_MS = 8_000
const GENERATE_TIMEOUT_MS = 120_000

export interface GeminiCliBrainDeps {
  spawn?: SpawnFn
  env?: NodeJS.ProcessEnv
  /**
   * Cheap detector for the `gemini` CLI's own OAuth login (default: does
   * `~/.gemini/oauth_creds.json` exist). Injected for hermetic tests so the probe
   * never touches the real home directory.
   */
  hasOAuthLogin?: () => boolean
}

export class GeminiCliBrain implements AIBrain {
  readonly id = 'gemini-cli' as const
  readonly label = 'Gemini CLI'

  private readonly spawn?: SpawnFn
  private readonly env: NodeJS.ProcessEnv
  private readonly hasOAuthLogin: () => boolean

  constructor(deps: GeminiCliBrainDeps = {}) {
    this.spawn = deps.spawn
    this.env = deps.env ?? process.env
    this.hasOAuthLogin = deps.hasOAuthLogin ?? defaultHasOAuthLogin
  }

  capabilities(): ReadonlySet<BrainCapability> {
    return CAPABILITIES
  }

  /** The Gemini key this brain will use, from env or the app's stored key. */
  private resolveKey(): string {
    const fromEnv = this.env.GEMINI_API_KEY?.trim()
    if (fromEnv) return fromEnv
    try {
      return resolveGeminiApiKey()
    } catch {
      return ''
    }
  }

  async authStatus(): Promise<BrainAuthStatus> {
    const envKey = this.env.GEMINI_API_KEY?.trim() || ''
    let storedKey = ''
    if (!envKey) {
      try {
        storedKey = resolveGeminiApiKey()
      } catch {
        storedKey = ''
      }
    }

    // Presence probe — the CLI can be authed via OAuth even without a key.
    let cliPresent = false
    let version = 'installed'
    try {
      const res = await runCli('gemini', ['--version'], { timeoutMs: VERSION_TIMEOUT_MS, env: this.env }, this.spawn)
      cliPresent = res.code === 0
      if (cliPresent) version = res.stdout.trim().split(/\r?\n/)[0] || 'installed'
    } catch {
      cliPresent = false
    }

    if (!cliPresent) {
      return { configured: false, method: 'none', detail: 'gemini not on PATH' }
    }
    // Keys first — they're what generate() injects into the child env, so they're
    // the auth actually used when present. HONEST: this cheap probe never
    // exercises the key against the API (that would be a paid call), so the badge
    // says "(unverified)" instead of reading as verified-ready.
    if (envKey) {
      return {
        configured: true,
        method: 'api-key',
        detail: `GEMINI_API_KEY env (unverified) + gemini ${version}`,
      }
    }
    if (storedKey) {
      return {
        configured: true,
        method: 'api-key',
        detail: `app key (injected, unverified) + gemini ${version}`,
      }
    }
    // No key — fall back to the CLI's own OAuth login. File-presence is honest
    // evidence of a sign-in; it is NOT a claim of a verified live session.
    if (this.hasOAuthLogin()) {
      return {
        configured: true,
        method: 'oauth',
        detail: `OAuth login (stored credentials) + gemini ${version}`,
      }
    }
    // Present but no usable auth of any kind.
    return {
      configured: false,
      method: 'none',
      detail: `gemini ${version} (no API key or OAuth login — run gemini to sign in)`,
    }
  }

  async generate(messages: BrainMessage[], opts: GenerateOptions = {}): Promise<string | null> {
    const prompt = foldMessagesToPrompt(messages, opts.systemPrompt)
    if (!prompt.trim()) return null

    // `-p ""` is the headless trigger; the prompt is piped via stdin (kept OUT of
    // argv). Only fixed flags live in argv.
    const args = ['-p', '', '--output-format', 'json']
    if (opts.model) args.push('--model', opts.model)

    // Make the app's Gemini key available to the CLI when the env lacks one.
    const key = this.resolveKey()
    const env: NodeJS.ProcessEnv =
      key && !this.env.GEMINI_API_KEY ? { ...this.env, GEMINI_API_KEY: key } : this.env

    try {
      const res = await runCli(
        'gemini',
        args,
        { timeoutMs: GENERATE_TIMEOUT_MS, signal: opts.signal, input: prompt, env },
        this.spawn
      )
      if (res.aborted || res.timedOut || res.spawnError || res.outputLimitExceeded) {
        if (res.outputLimitExceeded) console.error('[GeminiCliBrain] generate aborted: output cap exceeded')
        return null
      }
      if (res.code !== 0) {
        console.error('[GeminiCliBrain] generate failed:', res.stderr.trim() || `exit ${res.code}`)
        return null
      }
      return parseGeminiJson(res.stdout)
    } catch (e) {
      console.error('[GeminiCliBrain] generate threw unexpectedly:', e)
      return null
    }
  }

  async chat(messages: BrainMessage[], opts: GenerateOptions = {}): Promise<string | null> {
    // The CLI is stateless in -p mode — fold history into one prompt.
    return this.generate(messages, opts)
  }
}

/**
 * Default OAuth-login detector: the `@google/gemini-cli` writes its OAuth
 * credentials to `~/.gemini/oauth_creds.json` on interactive sign-in. Presence of
 * that file is cheap, offline evidence of a login (not a liveness guarantee).
 * Never throws.
 */
function defaultHasOAuthLogin(): boolean {
  try {
    return existsSync(join(homedir(), '.gemini', 'oauth_creds.json'))
  } catch {
    return false
  }
}

/**
 * Parse the `gemini --output-format json` envelope and extract the response text.
 * The envelope is `{ "response": "...", "stats": {...} }`. Falls back to the raw
 * (trimmed) stdout if the payload isn't the expected JSON shape.
 */
export function parseGeminiJson(stdout: string): string | null {
  const trimmed = stdout.trim()
  if (!trimmed) return null
  try {
    const parsed = JSON.parse(trimmed) as { response?: unknown }
    if (typeof parsed.response === 'string' && parsed.response.trim()) {
      return parsed.response.trim()
    }
    // Parsed JSON but no usable response field.
    return null
  } catch {
    // Not JSON (older CLI / plain text output) — return the raw text.
    return trimmed
  }
}
