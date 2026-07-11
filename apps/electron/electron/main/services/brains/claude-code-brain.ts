/**
 * Claude Code brain — shells out to the installed, logged-in `claude` CLI in
 * headless/print mode. Preferred over the @anthropic-ai/claude-agent-sdk here so
 * there's no new npm dependency and the existing Claude Code login session is
 * reused directly (verified installed: claude 2.1.x with an active login).
 *
 * Capabilities: generate, chat, agentic. NOT analyzeAudio, NOT embed — audio and
 * embeddings never route here (the BrainRouter enforces that, spec §B.4).
 *
 *   generate → `claude -p "<prompt>"`   (print mode; capture stdout)
 *   chat     → same, with history folded into the prompt
 *
 * Auth: `claude --version` exiting 0 (CLI present + usable) — or an
 * ANTHROPIC_API_KEY in the environment — is treated as configured, per the brief.
 * authStatus()/generate() NEVER throw; they resolve to a not-configured status /
 * null on any failure.
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

/** Cheap version probe. */
const VERSION_TIMEOUT_MS = 8_000
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

  async authStatus(): Promise<BrainAuthStatus> {
    const hasApiKey = !!this.env.ANTHROPIC_API_KEY?.trim()
    try {
      const res = await runCli('claude', ['--version'], { timeoutMs: VERSION_TIMEOUT_MS, env: this.env }, this.spawn)
      if (res.code === 0) {
        const version = res.stdout.trim().split(/\r?\n/)[0] || 'installed'
        return {
          configured: true,
          method: hasApiKey ? 'api-key' : 'cli-login',
          detail: hasApiKey ? `API key + claude ${version}` : `logged in (claude ${version})`,
        }
      }
      // CLI present but errored: still usable if an API key is set.
      if (hasApiKey) {
        return { configured: true, method: 'api-key', detail: 'ANTHROPIC_API_KEY set' }
      }
      return { configured: false, method: 'none', detail: 'claude not on PATH' }
    } catch {
      return hasApiKey
        ? { configured: true, method: 'api-key', detail: 'ANTHROPIC_API_KEY set' }
        : { configured: false, method: 'none', detail: 'claude not on PATH' }
    }
  }

  async generate(messages: BrainMessage[], opts: GenerateOptions = {}): Promise<string | null> {
    const prompt = foldMessagesToPrompt(messages, opts.systemPrompt)
    if (!prompt.trim()) return null

    const args = ['-p', prompt]
    if (opts.model) args.push('--model', opts.model)

    try {
      const res = await runCli(
        'claude',
        args,
        { timeoutMs: GENERATE_TIMEOUT_MS, signal: opts.signal, env: this.env },
        this.spawn
      )
      if (res.aborted || res.timedOut || res.spawnError) return null
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
