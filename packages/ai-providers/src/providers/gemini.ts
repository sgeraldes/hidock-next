import { createGoogleGenerativeAI } from '@ai-sdk/google'
import type { LanguageModel } from 'ai'
import type { GoogleProviderConfig } from '../types.js'

export function createGeminiModel(config: GoogleProviderConfig): LanguageModel {
  const google = createGoogleGenerativeAI({ apiKey: config.apiKey })
  return google(config.model)
}
