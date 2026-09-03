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
    const baseURL = (config.baseURL ?? 'http://localhost:11434/api').replace(/\/+$/, '')
    const response = await fetch(`${baseURL}/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: config.model, prompt, stream: false }),
    })
    if (!response.ok) {
      throw new Error(`Ollama completion request failed: ${response.status} ${response.statusText}`)
    }
    const data = await response.json() as { response?: string }
    if (typeof data.response !== 'string') {
      throw new Error('Ollama returned no completion text')
    }
    return data.response
  }

  const { model } = createProvider(config)
  const result = await generateText({ model, prompt })
  return result.text
}
