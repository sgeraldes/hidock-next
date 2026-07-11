/**
 * AI Brain provider abstraction (H10, Phase 1).
 *
 * A "brain" is a single AI provider the app can route work to. Phase 1 ships
 * two brains — Gemini (API key) and Ollama (local) — wrapping the exact code
 * paths that were previously duplicated across chat-llm.ts, embeddings.ts and
 * output-generator.ts (and inlined in transcription.ts / artifact-types.ts).
 *
 * The interface is intentionally provider-agnostic so later phases can add
 * Claude Code, Codex and Gemini-CLI adapters behind the same seam without
 * touching consumers. See docs/specs/2026-07-11-pluggable-brains-and-handover.md.
 *
 * This module is types-only (no runtime imports) so it can be imported from
 * anywhere — including config.ts — without pulling in Electron/SDK code.
 */

export type BrainId =
  | 'gemini-api' // @google/generative-ai (current cloud path)
  | 'ollama' // local (current fallback)
  | 'claude-code' // @anthropic-ai/claude-agent-sdk   (Phase 2)
  | 'codex' // @openai/codex-sdk                (Phase 3)
  | 'gemini-cli' // @google/gemini-cli               (Phase 4)

export type BrainCapability =
  | 'generate' // one-shot text generation
  | 'chat' // multi-turn conversation
  | 'analyzeAudio' // native audio input → text (transcription/analysis)
  | 'embed' // text → vector
  | 'agentic' // run a coding task in a working directory (write files)

/** Task categories consumers route through the BrainRouter. */
export type BrainTask =
  | 'transcribeAnalyze' // audio → transcript + analysis (transcription.ts)
  | 'chat' // RAG assistant (rag.ts via chat-llm)
  | 'outputs' // templated documents (output-generator.ts)
  | 'handover' // the coding-agent handoff (H9)
  | 'embed' // vector embeddings
  | 'suggestions' // titles / smart questions / actionable detection

export interface BrainMessage {
  role: 'system' | 'user' | 'assistant'
  content: string
}

export interface GenerateOptions {
  systemPrompt?: string
  temperature?: number
  maxTokens?: number
  /** Brain-specific model override. Falls back to the brain's configured default. */
  model?: string
  /** Ask for JSON output where the brain supports it (Gemini responseMimeType). */
  json?: boolean
  /**
   * Disable the model's "thinking" budget where supported. Preserves the
   * `thinkingConfig: { thinkingBudget: 0 }` hardening the app already applies to
   * its structured-JSON Gemini calls (detectActionables, analysis, vision).
   */
  disableThinking?: boolean
  signal?: AbortSignal
}

export interface AudioAnalyzeInput {
  filePath: string // local audio file on disk
  mimeType: string // e.g. 'audio/mp3' (HiDock .wav are MP3 content — see memory)
  prompt: string
  systemPrompt?: string
  model?: string
  language?: string
  context?: string
  signal?: AbortSignal
}

export interface AgenticTask {
  cwd: string // working directory / target repo
  prompt: string // instruction (the handoff)
  contextFiles?: string[] // absolute paths to attach / point the agent at
  model?: string
  signal?: AbortSignal
  onEvent?: (e: BrainAgentEvent) => void // streamed progress
}

export type BrainAgentEvent =
  | { type: 'text'; text: string }
  | { type: 'tool'; name: string; detail?: string }
  | { type: 'file'; path: string; change: 'created' | 'edited' }
  | { type: 'done'; subtype: string }
  | { type: 'error'; message: string }

export interface AgenticResult {
  finalResponse: string
  sessionId?: string // to resume the session later
  filesChanged?: string[]
}

export interface BrainAuthStatus {
  configured: boolean
  method: 'api-key' | 'cli-login' | 'oauth' | 'none'
  detail?: string // "key set", "logged in", "claude not on PATH", …
}

export interface AIBrain {
  readonly id: BrainId
  readonly label: string
  capabilities(): ReadonlySet<BrainCapability>
  /** Cheap, cached; never throws. Drives Settings status + router availability. */
  authStatus(): Promise<BrainAuthStatus>

  generate(messages: BrainMessage[], opts?: GenerateOptions): Promise<string | null>
  chat(messages: BrainMessage[], opts?: GenerateOptions): Promise<string | null>
  analyzeAudio?(input: AudioAnalyzeInput): Promise<string | null>
  embed?(texts: string[]): Promise<(number[] | null)[]>
  runAgentic?(task: AgenticTask): Promise<AgenticResult>
}
