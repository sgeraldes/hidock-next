/**
 * Gemini (API key) brain — @google/generative-ai.
 *
 * Wraps the EXACT cloud paths previously duplicated across chat-llm.ts,
 * embeddings.ts and output-generator.ts (and inlined in transcription.ts /
 * artifact-types.ts). Behaviour is identical — same models, params, prompts.
 *
 * Capabilities: generate, chat, analyzeAudio, embed. This is the ONLY Phase-1
 * brain that can do audio or embeddings.
 *
 * Key resolution (spec §C.4): credential store `gemini-api/apiKey` first, then
 * the legacy plaintext `config.transcription.geminiApiKey` — so the existing key
 * keeps working with no migration required, and the one-time migration closes
 * the plaintext-key gap.
 */
import { GoogleGenerativeAI, TaskType } from '@google/generative-ai'
import { getConfig } from '../config'
import { getBrainCredentialStore } from './brain-credential-store'
import type {
  AIBrain,
  AudioAnalyzeInput,
  BrainAuthStatus,
  BrainCapability,
  BrainMessage,
  EmbedOptions,
  GenerateOptions,
} from './types'
import { eligibleToGenerate } from './eligibility'

const DEFAULT_MODEL = 'gemini-3.5-flash'
const GEMINI_EMBEDDING_MODEL = 'gemini-embedding-001'
const GEMINI_BATCH_LIMIT = 100

const CAPABILITIES: ReadonlySet<BrainCapability> = new Set<BrainCapability>([
  'generate',
  'chat',
  'analyzeAudio',
  'embed',
])

/**
 * Resolve the Gemini API key: encrypted credential-store value first, falling
 * back to the legacy plaintext config field. Never throws.
 */
export function resolveGeminiApiKey(): string {
  let fromStore: string | null = null
  try {
    fromStore = getBrainCredentialStore().getSecret('gemini-api', 'apiKey')
  } catch {
    fromStore = null
  }
  return (fromStore || getConfig().transcription.geminiApiKey || '').trim()
}

export class GeminiApiBrain implements AIBrain {
  readonly id = 'gemini-api' as const
  readonly label = 'Gemini (API key)'

  capabilities(): ReadonlySet<BrainCapability> {
    return CAPABILITIES
  }

  async authStatus(): Promise<BrainAuthStatus> {
    const configured = !!resolveGeminiApiKey()
    return {
      configured,
      method: 'api-key',
      detail: configured ? 'key set' : 'no API key',
    }
  }

  /**
   * One-shot text generation. Mirrors output-generator's Gemini path
   * (`getGenerativeModel({ model, systemInstruction }).generateContent(...)`)
   * and transcription's detectActionables (JSON + disabled thinking).
   *
   * generationConfig is built ONLY from provided options so callers reproduce
   * their historical request shape exactly. Throws on API error (callers own
   * their fallback semantics).
   */
  async generate(messages: BrainMessage[], opts: GenerateOptions = {}): Promise<string | null> {
    const apiKey = resolveGeminiApiKey()
    if (!apiKey) throw new Error('Gemini API key not configured')

    const config = getConfig()
    const genAI = new GoogleGenerativeAI(apiKey)
    const model = genAI.getGenerativeModel({
      model: opts.model || config.transcription.geminiModel || DEFAULT_MODEL,
      ...(opts.systemPrompt ? { systemInstruction: opts.systemPrompt } : {}),
    })

    const contents = messages
      .filter((m) => m.role !== 'system')
      .map((m) => ({
        role: m.role === 'assistant' ? 'model' : 'user',
        parts: [{ text: m.content }],
      }))

    const generationConfig: Record<string, unknown> = {}
    if (opts.temperature !== undefined) generationConfig.temperature = opts.temperature
    if (opts.maxTokens !== undefined) generationConfig.maxOutputTokens = opts.maxTokens
    if (opts.json) generationConfig.responseMimeType = 'application/json'
    if (opts.disableThinking) generationConfig.thinkingConfig = { thinkingBudget: 0 }

    const request: Record<string, unknown> = { contents }
    if (Object.keys(generationConfig).length > 0) request.generationConfig = generationConfig

    const result = await model.generateContent(
      request as never,
      opts.signal ? { signal: opts.signal } : {}
    )
    return result.response.text()
  }

  /**
   * Multi-turn conversation. Exact replica of chat-llm's `geminiChat`: model
   * from config.chat.geminiModel, assistant→model role mapping, leading-model
   * turns stripped, temperature 0.7 / maxTokens 1024 / thinking disabled by
   * default. Throws on API error (chat-llm's caller/router owns the fallback).
   */
  async chat(messages: BrainMessage[], opts: GenerateOptions = {}): Promise<string | null> {
    const apiKey = resolveGeminiApiKey()
    if (!apiKey) throw new Error('Gemini API key not configured')

    const config = getConfig()
    const genAI = new GoogleGenerativeAI(apiKey)
    const model = genAI.getGenerativeModel({
      model: opts.model || config.chat.geminiModel || DEFAULT_MODEL,
      ...(opts.systemPrompt ? { systemInstruction: opts.systemPrompt } : {}),
    })

    // Map chat history to Gemini's content format: 'assistant' → 'model'.
    // 'system' turns are dropped here (handled via systemInstruction).
    const contents = messages
      .filter((m) => m.role !== 'system')
      .map((m) => ({
        role: m.role === 'assistant' ? 'model' : 'user',
        parts: [{ text: m.content }],
      }))

    // Gemini requires the first turn to be a user turn — strip leading model turns.
    while (contents.length > 0 && contents[0].role === 'model') {
      contents.shift()
    }

    const result = await model.generateContent(
      {
        contents,
        generationConfig: {
          temperature: opts.temperature ?? 0.7,
          maxOutputTokens: opts.maxTokens ?? 1024,
          thinkingConfig: { thinkingBudget: 0 },
        } as never,
      },
      opts.signal ? { signal: opts.signal } : {}
    )
    return result.response.text()
  }

  /**
   * Batch text embeddings (`gemini-embedding-001`, 3072-dim). Exact replica of
   * embeddings.ts `geminiBatch`. Throws on API error (caller falls back to Ollama).
   *
   * ADV43-2 (round-45) — a single call fans out to one `batchEmbedContents`
   * request per 100-text slice, with an `await` between them. `opts.shouldGenerate`
   * is re-evaluated fail-closed IMMEDIATELY before EACH batch: on ineligible the
   * loop STOPS issuing further batches and fills every remaining (unembedded) text
   * with `null` — the "no embedding available" shape callers persist as nothing —
   * so an owner exclusion committed while an earlier batch was pending never sends
   * the later batches to Gemini.
   */
  async embed(texts: string[], opts: EmbedOptions = {}): Promise<(number[] | null)[]> {
    if (texts.length === 0) return []
    const apiKey = resolveGeminiApiKey()
    if (!apiKey) throw new Error('Gemini API key not configured')

    const genAI = new GoogleGenerativeAI(apiKey)
    const model = genAI.getGenerativeModel({ model: GEMINI_EMBEDDING_MODEL })

    const out: (number[] | null)[] = []
    for (let i = 0; i < texts.length; i += GEMINI_BATCH_LIMIT) {
      // Recheck before EACH batch (the concrete provider call).
      if (!eligibleToGenerate(opts.shouldGenerate)) {
        while (out.length < texts.length) out.push(null)
        return out
      }
      const slice = texts.slice(i, i + GEMINI_BATCH_LIMIT)
      // Asymmetric retrieval: queries and documents embed differently. Absent
      // purpose ⇒ DOCUMENT (the historical untyped behaviour, which the
      // gemini-embedding family treats as document-side).
      const taskType = opts.purpose === 'query' ? TaskType.RETRIEVAL_QUERY : TaskType.RETRIEVAL_DOCUMENT
      const res = await model.batchEmbedContents({
        requests: slice.map((t) => ({
          content: { role: 'user', parts: [{ text: t }] },
          taskType,
        })),
      })
      for (const emb of res.embeddings) {
        out.push(emb?.values ?? null)
      }
    }
    return out
  }

  /**
   * Native audio → transcript text. Wraps `@hidock/transcription`'s GeminiEngine
   * (the same engine transcription.ts uses), returning the concatenated
   * speaker-labelled turn text. The only Phase-1 brain that can do audio.
   *
   * NOTE: transcription.ts keeps its own richer segment-returning path (it needs
   * per-turn timestamps + speaker structure, which this string-returning contract
   * cannot express). This adapter exists for the capability matrix and future
   * generic routing. GeminiEngine is imported lazily so unrelated consumers don't
   * pull the transcription package into their import graph.
   */
  async analyzeAudio(input: AudioAnalyzeInput): Promise<string | null> {
    const apiKey = resolveGeminiApiKey()
    if (!apiKey) throw new Error('Gemini API key not configured')

    const config = getConfig()
    const { GeminiEngine } = await import('@hidock/transcription')
    const { readFile } = await import('fs/promises')
    const audioBuffer = await readFile(input.filePath)

    const engine = new GeminiEngine({
      apiKey,
      model: input.model || config.transcription.geminiModel || DEFAULT_MODEL,
      language: input.language || config.transcription.language || 'unknown',
    })

    const parts: string[] = []
    for await (const segment of engine.transcribe(audioBuffer, {
      source: 'mic',
      language: input.language || config.transcription.language,
      context: input.context || input.prompt || undefined,
      filePath: input.filePath,
      // ADV43-1 (round-45) sweep — re-checked inside the engine before each provider call.
      shouldGenerate: input.shouldGenerate,
    } as Parameters<typeof engine.transcribe>[1] & { filePath: string })) {
      const text = segment.text?.trim()
      if (text) parts.push(segment.speaker ? `${segment.speaker}: ${text}` : text)
    }

    return parts.length > 0 ? parts.join('\n') : null
  }
}
