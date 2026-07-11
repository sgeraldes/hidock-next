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

  async authStatus(): Promise<BrainAuthStatus> {
    const hasApiKey = !!this.env.ANTHROPIC_API_KEY?.trim()
    try {
      // `claude auth status --json` → { loggedIn, authMethod, email, ... }. This
      // exercises the real credential store, so a logged-out/expired CLI is not
      // advertised as usable (unlike a version-only probe).
      const res = await runCli(
        'claude',
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
        const who = typeof status.email === 'string' && status.email ? ` as ${status.email}` : ''
        return {
          configured: true,
          method: hasApiKey ? 'api-key' : 'cli-login',
          detail: hasApiKey ? `API key + claude login${who}` : `logged in${who}`,
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
        'claude',
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

/** Parse `claude auth status --json`. Returns null on any non-JSON / parse failure. */
function parseAuthJson(stdout: string): { loggedIn?: boolean; email?: unknown } | null {
  const trimmed = stdout.trim()
  if (!trimmed) return null
  try {
    return JSON.parse(trimmed) as { loggedIn?: boolean; email?: unknown }
  } catch {
    const start = trimmed.indexOf('{')
    const end = trimmed.lastIndexOf('}')
    if (start >= 0 && end > start) {
      try {
        return JSON.parse(trimmed.slice(start, end + 1)) as { loggedIn?: boolean; email?: unknown }
      } catch {
        return null
      }
    }
    return null
  }
}
