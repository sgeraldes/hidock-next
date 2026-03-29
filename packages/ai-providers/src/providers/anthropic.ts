import { createAnthropic } from '@ai-sdk/anthropic'
import type { LanguageModel } from 'ai'
import type { AnthropicProviderConfig } from '../types.js'

export function createAnthropicModel(config: AnthropicProviderConfig): LanguageModel {
  const anthropic = createAnthropic({ apiKey: config.apiKey })
  return anthropic(config.model)
}
