/**
 * Gemini CLI brain — shells out to the installed `gemini` CLI in headless mode.
 * Distinct from the Gemini-API brain (@google/generative-ai): this one drives the
 * `@google/gemini-cli` binary, reusing its GEMINI_API_KEY / OAuth login. Preferred
 * over adding an SDK dependency (verified installed: gemini 0.49.x).
 *
 * Capabilities: generate, chat, agentic. NOT analyzeAudio, NOT embed — the CLI has
 * no embed command, so embeddings still route to gemini-api/ollama (spec §B.4).
 *
 *   generate → `gemini -p "<prompt>" --output-format json`  → parse .response
 *   chat     → same, with history folded into the prompt (CLI is stateless)
 *
 * Auth: configured when the `gemini` CLI is present AND a key is available —
 * GEMINI_API_KEY in the env, or the app's existing Gemini key (credential store /
 * config.transcription.geminiApiKey via resolveGeminiApiKey). authStatus()/
 * generate() NEVER throw.
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
      return { configured: true, method: 'api-key', detail: `API key + gemini ${version}` }
    }
    // CLI present but no key — may still be OAuth-logged-in; report as not
    // configured (the router won't auto-select it) but keep the reason clear.
    return { configured: false, method: 'none', detail: `gemini ${version} (no API key — run gemini to sign in)` }
  }

  async generate(messages: BrainMessage[], opts: GenerateOptions = {}): Promise<string | null> {
    const prompt = foldMessagesToPrompt(messages, opts.systemPrompt)
    if (!prompt.trim()) return null

    const args = ['-p', prompt, '--output-format', 'json']
    if (opts.model) args.push('--model', opts.model)

    // Make the app's Gemini key available to the CLI when the env lacks one.
    const key = this.resolveKey()
    const env: NodeJS.ProcessEnv =
      key && !this.env.GEMINI_API_KEY ? { ...this.env, GEMINI_API_KEY: key } : this.env

    try {
      const res = await runCli(
        'gemini',
        args,
        { timeoutMs: GENERATE_TIMEOUT_MS, signal: opts.signal, env },
        this.spawn
      )
      if (res.aborted || res.timedOut || res.spawnError) return null
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
