import { generateText } from 'ai'
import { createProvider } from './provider-factory.js'
import type { ProviderConfig } from './types.js'

/**
 * Generate a text completion using the specified AI provider.
 * Uses createProvider() to build the language model, then calls generateText from the 'ai' SDK.
 * Returns the generated text string.
 */
export async function complete(prompt: string, config: ProviderConfig): Promise<string> {
  const { model } = createProvider(config)
  const result = await generateText({ model, prompt })
  return result.text
}
