import type { ProviderConfig, ProviderResult } from './types.js'
import { createGeminiModel } from './providers/gemini.js'
import { createOpenAIModel } from './providers/openai.js'
import { createAnthropicModel } from './providers/anthropic.js'
import { createBedrockModel } from './providers/bedrock.js'
import { createOllamaModel } from './providers/ollama.js'

export function createProvider(config: ProviderConfig): ProviderResult {
  switch (config.provider) {
    case 'google':
      return { model: createGeminiModel(config), provider: 'google' }
    case 'openai':
      return { model: createOpenAIModel(config), provider: 'openai' }
    case 'anthropic':
      return { model: createAnthropicModel(config), provider: 'anthropic' }
    case 'bedrock':
      return { model: createBedrockModel(config), provider: 'bedrock' }
    case 'ollama':
      return { model: createOllamaModel(config), provider: 'ollama' }
    default: {
      const exhaustiveCheck: never = config
      throw new Error(`Unknown AI provider: ${(exhaustiveCheck as ProviderConfig).provider}`)
    }
  }
}
