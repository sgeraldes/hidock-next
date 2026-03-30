import { embed as aiEmbed } from 'ai'
import { createGoogleGenerativeAI } from '@ai-sdk/google'
import { createOpenAI } from '@ai-sdk/openai'
import { createAmazonBedrock } from '@ai-sdk/amazon-bedrock'
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
      // ollama-ai-provider uses EmbeddingModelV1 which AI SDK v6 rejects at runtime.
      // Call Ollama REST API directly to avoid the version mismatch.
      const baseURL = (config.baseURL ?? 'http://localhost:11434/api').replace(/\/+$/, '')
      const response = await fetch(`${baseURL}/embed`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: config.model, input: text }),
      })
      if (!response.ok) {
        throw new Error(`Ollama embedding request failed: ${response.status} ${response.statusText}`)
      }
      const data = await response.json() as { embeddings: number[][]; prompt_eval_count?: number }
      if (!data.embeddings || data.embeddings.length === 0) {
        throw new Error('Ollama returned no embeddings')
      }
      return {
        embedding: data.embeddings[0],
        usage: { tokens: data.prompt_eval_count ?? 0 },
      }
    }
    default: {
      const exhaustiveCheck: never = config.provider
      throw new Error(`Unknown AI provider: ${exhaustiveCheck}`)
    }
  }
}
