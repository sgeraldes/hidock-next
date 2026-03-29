import { createOllama } from 'ollama-ai-provider'
import type { LanguageModel } from 'ai'
import type { OllamaProviderConfig } from '../types.js'

export function createOllamaModel(config: OllamaProviderConfig): LanguageModel {
  const ollama = createOllama({
    baseURL: config.baseURL ?? 'http://localhost:11434/api'
  })
  return ollama(config.model) as unknown as LanguageModel
}
