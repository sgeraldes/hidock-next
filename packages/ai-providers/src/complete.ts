import { generateText } from 'ai'
import { createProvider } from './provider-factory.js'
import type { ProviderConfig } from './types.js'

/**
 * Generate a text completion using the specified AI provider.
 * Uses createProvider() to build the language model, then calls generateText from the 'ai' SDK.
 * Returns the generated text string.
 */
export async function complete(prompt: string, config: ProviderConfig): Promise<string> {
  if (config.provider === 'ollama') {
    // ollama-ai-provider@1 exposes LanguageModelV1, which AI SDK v6 rejects.
    // Keep local completion working through Ollama's stable REST API, matching
    // the direct REST compatibility path used by embed().
    //
    // STREAMING (stream: true): a non-streaming request holds one long HTTP
    // response open for the whole generation, which on large transcripts
    // (observed 27k+ chars on gemma3:12b) intermittently drops with
    // `TypeError: fetch failed` before the body arrives. Streaming keeps the
    // connection fed with incremental NDJSON chunks, which is far more robust
    // on long local generations; we reassemble the full text from the
    // per-token `response` fields. The return contract is unchanged (a string).
    const baseURL = (config.baseURL ?? 'http://localhost:11434/api').replace(/\/+$/, '')
    const response = await fetch(`${baseURL}/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: config.model, prompt, stream: true }),
    })
    if (!response.ok) {
      throw new Error(`Ollama completion request failed: ${response.status} ${response.statusText}`)
    }
    if (!response.body) {
      throw new Error('Ollama returned no response body')
    }

    // Ollama streams newline-delimited JSON objects, each with a `response`
    // token fragment and a final `{ done: true }`. Accumulate the fragments.
    let text = ''
    let buffer = ''
    const decoder = new TextDecoder()
    for await (const chunk of response.body as unknown as AsyncIterable<Uint8Array>) {
      buffer += decoder.decode(chunk, { stream: true })
      let newlineIndex: number
      while ((newlineIndex = buffer.indexOf('\n')) !== -1) {
        const line = buffer.slice(0, newlineIndex).trim()
        buffer = buffer.slice(newlineIndex + 1)
        if (!line) continue
        try {
          const obj = JSON.parse(line) as { response?: string; error?: string }
          if (obj.error) throw new Error(`Ollama stream error: ${obj.error}`)
          if (typeof obj.response === 'string') text += obj.response
        } catch (e) {
          // A malformed line mid-stream is skipped; a surfaced error rethrows.
          if (e instanceof Error && e.message.startsWith('Ollama stream error')) throw e
        }
      }
    }
    // Flush any trailing buffered line (no terminating newline).
    const tail = buffer.trim()
    if (tail) {
      try {
        const obj = JSON.parse(tail) as { response?: string }
        if (typeof obj.response === 'string') text += obj.response
      } catch { /* ignore a partial trailing fragment */ }
    }

    if (!text) {
      throw new Error('Ollama returned no completion text')
    }
    return text
  }

  const { model } = createProvider(config)
  const result = await generateText({ model, prompt })
  return result.text
}
