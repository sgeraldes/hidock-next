import { describe, it, expect, vi } from 'vitest'
import { createGoogleGenerativeAI } from '@ai-sdk/google'
import { createOpenAI } from '@ai-sdk/openai'
import { createAnthropic } from '@ai-sdk/anthropic'
import { createAmazonBedrock } from '@ai-sdk/amazon-bedrock'
import { createOllama } from 'ollama-ai-provider'

// Mock all provider SDK modules before importing our code
vi.mock('@ai-sdk/google', () => ({
  createGoogleGenerativeAI: vi.fn(() => vi.fn(() => ({ provider: 'google.language-model' })))
}))

vi.mock('@ai-sdk/openai', () => ({
  createOpenAI: vi.fn(() => vi.fn(() => ({ provider: 'openai.language-model' })))
}))

vi.mock('@ai-sdk/anthropic', () => ({
  createAnthropic: vi.fn(() => vi.fn(() => ({ provider: 'anthropic.language-model' })))
}))

vi.mock('@ai-sdk/amazon-bedrock', () => ({
  createAmazonBedrock: vi.fn(() => vi.fn(() => ({ provider: 'bedrock.language-model' })))
}))

vi.mock('ollama-ai-provider', () => ({
  createOllama: vi.fn(() => vi.fn(() => ({ provider: 'ollama.language-model' })))
}))

import { createProvider } from '../src/provider-factory.js'
import type { ProviderConfig } from '../src/types.js'

describe('createProvider', () => {
  describe('google', () => {
    it('returns provider result with correct provider key', () => {
      const config: ProviderConfig = { provider: 'google', model: 'gemini-2.0-flash', apiKey: 'test-key' }
      const result = createProvider(config)
      expect(result.provider).toBe('google')
      expect(result.model).toBeDefined()
    })
  })

  describe('openai', () => {
    it('returns provider result with correct provider key', () => {
      const config: ProviderConfig = { provider: 'openai', model: 'gpt-4o', apiKey: 'test-key' }
      const result = createProvider(config)
      expect(result.provider).toBe('openai')
      expect(result.model).toBeDefined()
    })
  })

  describe('anthropic', () => {
    it('returns provider result with correct provider key', () => {
      const config: ProviderConfig = { provider: 'anthropic', model: 'claude-3-5-sonnet-20241022', apiKey: 'test-key' }
      const result = createProvider(config)
      expect(result.provider).toBe('anthropic')
      expect(result.model).toBeDefined()
    })
  })

  describe('bedrock', () => {
    it('returns provider result with correct provider key', () => {
      const config: ProviderConfig = {
        provider: 'bedrock',
        model: 'anthropic.claude-3-5-sonnet-20241022-v2:0',
        region: 'us-east-1',
        accessKeyId: 'AKIAIOSFODNN7EXAMPLE', // pragma: allowlist secret
        secretAccessKey: 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY' // pragma: allowlist secret // nosemgrep
      }
      const result = createProvider(config)
      expect(result.provider).toBe('bedrock')
      expect(result.model).toBeDefined()
    })

    it('uses default region when not provided', () => {
      const config: ProviderConfig = {
        provider: 'bedrock',
        model: 'anthropic.claude-3-5-sonnet-20241022-v2:0'
      }
      createProvider(config)
      expect(createAmazonBedrock).toHaveBeenCalledWith(
        expect.objectContaining({ region: 'us-east-1' })
      )
    })
  })

  describe('ollama', () => {
    it('returns provider result with correct provider key', () => {
      const config: ProviderConfig = { provider: 'ollama', model: 'llama3.2' }
      const result = createProvider(config)
      expect(result.provider).toBe('ollama')
      expect(result.model).toBeDefined()
    })

    it('uses default baseURL when not provided', () => {
      const config: ProviderConfig = { provider: 'ollama', model: 'llama3.2' }
      createProvider(config)
      expect(createOllama).toHaveBeenCalledWith(
        expect.objectContaining({ baseURL: 'http://localhost:11434/api' })
      )
    })
  })

  describe('unknown provider', () => {
    it('throws a descriptive error for unknown providers', () => {
      const config = { provider: 'unknown', model: 'some-model' } as unknown as ProviderConfig
      expect(() => createProvider(config)).toThrow('Unknown AI provider: unknown')
    })
  })
})
