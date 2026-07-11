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
 * Auth: configured when the `gemini` CLI is present AND a key is available —
 * GEMINI_API_KEY in the env, or the app's existing Gemini key (credential store /
 * config.transcription.geminiApiKey via resolveGeminiApiKey). The key is NOT
 * exercised against the API here (that would be a paid call in a "cheap, cached"
 * probe), so the status honestly reports "present" rather than "verified".
 * authStatus()/generate() NEVER throw.
 */
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
}

export class GeminiCliBrain implements AIBrain {
  readonly id = 'gemini-cli' as const
  readonly label = 'Gemini CLI'

  private readonly spawn?: SpawnFn
  private readonly env: NodeJS.ProcessEnv

  constructor(deps: GeminiCliBrainDeps = {}) {
    this.spawn = deps.spawn
    this.env = deps.env ?? process.env
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
    const key = this.resolveKey()
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
    if (key) {
      // Presence, not verification — the key isn't exercised against the API here.
      return { configured: true, method: 'api-key', detail: `API key present + gemini ${version}` }
    }
    // CLI present but no key — may still be OAuth-logged-in; report as not
    // configured (the router won't auto-select it) but keep the reason clear.
    return { configured: false, method: 'none', detail: `gemini ${version} (no API key — run gemini to sign in)` }
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
