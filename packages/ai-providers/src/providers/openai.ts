import { createOpenAI } from '@ai-sdk/openai'
import type { LanguageModel } from 'ai'
import type { OpenAIProviderConfig } from '../types.js'

export function createOpenAIModel(config: OpenAIProviderConfig): LanguageModel {
  const openai = createOpenAI({ apiKey: config.apiKey })
  return openai(config.model)
}
