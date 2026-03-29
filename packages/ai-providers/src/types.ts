import type { LanguageModel } from 'ai'

export type AIProviderKey = 'google' | 'openai' | 'anthropic' | 'bedrock' | 'ollama'

export interface GoogleProviderConfig {
  provider: 'google'
  model: string
  apiKey: string
}

export interface OpenAIProviderConfig {
  provider: 'openai'
  model: string
  apiKey: string
}

export interface AnthropicProviderConfig {
  provider: 'anthropic'
  model: string
  apiKey: string
}

export interface BedrockProviderConfig {
  provider: 'bedrock'
  model: string
  region?: string
  accessKeyId?: string
  secretAccessKey?: string
  sessionToken?: string
}

export interface OllamaProviderConfig {
  provider: 'ollama'
  model: string
  baseURL?: string
}

export type ProviderConfig =
  | GoogleProviderConfig
  | OpenAIProviderConfig
  | AnthropicProviderConfig
  | BedrockProviderConfig
  | OllamaProviderConfig

export interface ProviderResult {
  model: LanguageModel
  provider: AIProviderKey
}
