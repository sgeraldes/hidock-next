/**
 * AI Brains — public surface (H10, Phase 1).
 *
 * The provider-abstraction seam: an `AIBrain` interface, a capability-aware
 * `BrainRouter`, a `BrainRegistry`, per-brain credential storage, and the
 * Gemini-API + Ollama adapters that wrap the app's current LLM paths.
 */
export * from './types'
export { BrainRouter, getBrainRouter, resetBrainRouter } from './brain-router'
export type { ChatFailure } from './brain-router'
export { BrainRegistry, getBrainRegistry, resetBrainRegistry } from './brain-registry'
export {
  BrainCredentialStore,
  getBrainCredentialStore,
  resetBrainCredentialStore,
} from './brain-credential-store'
export { GeminiApiBrain, resolveGeminiApiKey } from './gemini-api-brain'
export { OllamaBrain } from './ollama-brain'
export { LocalOnnxEmbedBrain } from './local-onnx-embed-brain'
export { ClaudeCodeBrain, resolveClaudeCommand } from './claude-code-brain'
export { CodexBrain } from './codex-brain'
export { GeminiCliBrain, parseGeminiJson } from './gemini-cli-brain'
export { KiroCliBrain, parseKiroOutput } from './kiro-cli-brain'
export { runCli, foldMessagesToPrompt } from './cli-runner'
export type { SpawnFn, CliRunOptions, CliRunResult } from './cli-runner'
