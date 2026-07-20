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
  | 'local-onnx-embed' // in-process ONNX embeddings (Nemotron-3-Embed, no server)
  | 'claude-code' // @anthropic-ai/claude-agent-sdk   (Phase 2)
  | 'codex' // @openai/codex-sdk                (Phase 3)
  | 'gemini-cli' // @google/gemini-cli               (Phase 4)
  | 'kiro' // kiro-cli headless (AWS Kiro CLI)  (Phase 5)

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
  /**
   * Working directory for CLI-spawned brains — the agentic adapters pass this
   * through to their child process (runCli cwd). Used by the handover run so the
   * agent operates in the validated target repo, not Electron's cwd. API-only
   * brains (gemini-api, ollama) ignore it; they are never resolved for agentic
   * tasks by the router.
   */
  cwd?: string
  signal?: AbortSignal
  /**
   * ADV42-2 (round-44) — FAIL-CLOSED eligibility gate the router re-checks
   * SYNCHRONOUSLY immediately before EVERY provider attempt (the primary AND
   * each fallback attempt, after every intervening await). Returns `true` ⇒ the
   * source recording/capture is still eligible; a `false` return OR a thrown
   * error ⇒ treat the source as INELIGIBLE and ABORT the whole call without
   * attempting any (further) provider. Callers pass the SAME recording/capture
   * eligibility check they run up front so a source excluded while a primary
   * attempt is pending or failing is never re-sent to a fallback provider. A
   * missing callback means "no gate configured" (behaves exactly as before).
   * Router-only — the brain adapters ignore it.
   */
  shouldGenerate?: () => boolean
}

/**
 * Options for AIBrain.embed.
 *
 * ADV43-2 (round-45) — the fail-closed `shouldGenerate` gate threaded from the
 * BrainRouter INTO the adapter so it is re-evaluated SYNCHRONOUSLY immediately
 * before EVERY concrete provider call inside the adapter's own loop — each
 * Gemini `batchEmbedContents` batch and each Ollama per-text request. The router
 * checks it once before the primary/fallback attempt, but a single embed() call
 * fans out to many provider requests across `await`s; without the in-adapter
 * recheck an exclusion committed while an earlier batch/request is pending would
 * still let every later batch/request go out. Same contract as
 * GenerateOptions.shouldGenerate: returns EXACTLY `true` ⇒ eligible; a `false`
 * return OR any thrown error ⇒ INELIGIBLE ⇒ the adapter STOPS issuing further
 * batches/requests and fills the remaining outputs with `null` (the "no
 * embedding available" shape callers already persist as nothing). Absent ⇒ no
 * gate (legacy behaviour).
 */
export interface EmbedOptions {
  shouldGenerate?: () => boolean
  /**
   * Asymmetric-retrieval purpose. Embedding models trained for retrieval
   * (Nemotron-3-Embed, Gemini embedding) embed queries and documents
   * DIFFERENTLY — Nemotron prepends `query:` / `passage:`, Gemini sets the
   * RETRIEVAL_QUERY / RETRIEVAL_DOCUMENT task type. Callers that index
   * content pass 'passage'; callers embedding a search query pass 'query'.
   * Absent ⇒ 'passage' (the historical behaviour: everything is a document).
   */
  purpose?: 'query' | 'passage'
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
  /**
   * ADV43-1 (round-45) sweep — fail-closed eligibility gate threaded into the
   * GeminiEngine multi-call pipeline this adapter drives (Files API upload/poll,
   * per-chunk generation, retries). Same contract as elsewhere: `true` ⇒
   * eligible; `false`/throw ⇒ abort mid-pipeline (the engine throws
   * TranscriptionCancelledError). analyzeAudio is currently a capability-matrix /
   * future-routing path with no production caller; the gate is here so that when
   * it IS wired the same in-engine protection applies with no further change.
   */
  shouldGenerate?: () => boolean
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
  embed?(texts: string[], opts?: EmbedOptions): Promise<(number[] | null)[]>
  runAgentic?(task: AgenticTask): Promise<AgenticResult>
}
