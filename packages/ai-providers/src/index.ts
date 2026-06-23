export { createProvider } from './provider-factory.js'
export { embed } from './embed.js'
export { complete } from './complete.js'
export { createGeminiModel } from './providers/gemini.js'
export { createOpenAIModel } from './providers/openai.js'
export { createAnthropicModel } from './providers/anthropic.js'
export { createBedrockModel } from './providers/bedrock.js'
export { createOllamaModel } from './providers/ollama.js'
export type {
  AIProviderKey,
  ProviderConfig,
  ProviderResult,
  GoogleProviderConfig,
  OpenAIProviderConfig,
  AnthropicProviderConfig,
  BedrockProviderConfig,
  OllamaProviderConfig,
  EmbeddingProviderConfig,
  EmbeddingResult
} from './types.js'
