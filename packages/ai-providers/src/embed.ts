import { embed as aiEmbed } from 'ai'
import { createGoogleGenerativeAI } from '@ai-sdk/google'
import { createOpenAI } from '@ai-sdk/openai'
import { createAmazonBedrock } from '@ai-sdk/amazon-bedrock'
import { createOllama } from 'ollama-ai-provider'
import type { EmbeddingProviderConfig, EmbeddingResult } from './types.js'

export async function embed(text: string, config: EmbeddingProviderConfig): Promise<EmbeddingResult> {
  switch (config.provider) {
    case 'google': {
      const google = createGoogleGenerativeAI({ apiKey: config.apiKey })
      const model = google.textEmbeddingModel(config.model)
      const result = await aiEmbed({ model, value: text })
      return { embedding: result.embedding, usage: { tokens: result.usage.tokens } }
    }
    case 'openai': {
      const openai = createOpenAI({ apiKey: config.apiKey })
      const model = openai.embedding(config.model)
      const result = await aiEmbed({ model, value: text })
      return { embedding: result.embedding, usage: { tokens: result.usage.tokens } }
    }
    case 'anthropic': {
      throw new Error('Anthropic does not support embeddings. Use OpenAI or Ollama instead.')
    }
    case 'bedrock': {
      const bedrock = createAmazonBedrock({ region: config.region ?? 'us-east-1' })
      const model = bedrock.embedding(config.model)
      const result = await aiEmbed({ model, value: text })
      return { embedding: result.embedding, usage: { tokens: result.usage.tokens } }
    }
    case 'ollama': {
      const ollama = createOllama({ baseURL: config.baseURL ?? 'http://localhost:11434/api' })
      // ollama-ai-provider returns EmbeddingModelV1 which predates EmbeddingModelV2/V3;
      // cast to maintain compatibility (same pattern as createOllamaModel in providers/ollama.ts)
      const model = ollama.embedding(config.model) as unknown as Parameters<typeof aiEmbed>[0]['model']
      const result = await aiEmbed({ model, value: text })
      return { embedding: result.embedding, usage: { tokens: result.usage.tokens } }
    }
    default: {
      const exhaustiveCheck: never = config.provider
      throw new Error(`Unknown AI provider: ${exhaustiveCheck}`)
    }
  }
}
