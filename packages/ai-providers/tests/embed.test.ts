import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mock the 'ai' package's embed function
vi.mock('ai', () => ({
  embed: vi.fn()
}))

// Mock all provider SDK modules
vi.mock('@ai-sdk/google', () => ({
  createGoogleGenerativeAI: vi.fn(() => ({
    textEmbeddingModel: vi.fn((modelId: string) => ({ _provider: 'google', _modelId: modelId, specificationVersion: 'v1' }))
  }))
}))

vi.mock('@ai-sdk/openai', () => ({
  createOpenAI: vi.fn(() => ({
    embedding: vi.fn((modelId: string) => ({ _provider: 'openai', _modelId: modelId, specificationVersion: 'v1' }))
  }))
}))

vi.mock('@ai-sdk/amazon-bedrock', () => ({
  createAmazonBedrock: vi.fn(() => ({
    embedding: vi.fn((modelId: string) => ({ _provider: 'bedrock', _modelId: modelId, specificationVersion: 'v1' }))
  }))
}))

vi.mock('ollama-ai-provider', () => ({
  createOllama: vi.fn(() => ({
    embedding: vi.fn((modelId: string) => ({ _provider: 'ollama', _modelId: modelId, specificationVersion: 'v1' }))
  }))
}))

import { embed as aiEmbed } from 'ai'
import { createGoogleGenerativeAI } from '@ai-sdk/google'
import { createOpenAI } from '@ai-sdk/openai'
import { createAmazonBedrock } from '@ai-sdk/amazon-bedrock'
import { createOllama } from 'ollama-ai-provider'
import { embed } from '../src/embed.js'
import type { EmbeddingProviderConfig } from '../src/types.js'

const mockAiEmbed = vi.mocked(aiEmbed)

const fakeEmbeddingResult = {
  embedding: [0.1, 0.2, 0.3],
  usage: { tokens: 5 },
  value: 'test',
  rawResponse: undefined,
  response: { id: 'test', timestamp: new Date(), modelId: 'test' }
}

beforeEach(() => {
  vi.clearAllMocks()
  mockAiEmbed.mockResolvedValue(fakeEmbeddingResult as ReturnType<typeof aiEmbed> extends Promise<infer T> ? T : never)
})

describe('embed', () => {
  describe('google', () => {
    it('calls textEmbeddingModel with the model id', async () => {
      const config: EmbeddingProviderConfig = { provider: 'google', model: 'text-embedding-004', apiKey: 'g-key' }
      const result = await embed('hello world', config)
      expect(result.embedding).toEqual([0.1, 0.2, 0.3])
      expect(result.usage).toEqual({ tokens: 5 })
    })

    it('passes the apiKey to createGoogleGenerativeAI', async () => {
      const config: EmbeddingProviderConfig = { provider: 'google', model: 'text-embedding-004', apiKey: 'my-g-key' }
      await embed('test', config)
      expect(createGoogleGenerativeAI).toHaveBeenCalledWith({ apiKey: 'my-g-key' })
    })

    it('passes the model to aiEmbed', async () => {
      const config: EmbeddingProviderConfig = { provider: 'google', model: 'text-embedding-004', apiKey: 'g-key' }
      await embed('test text', config)
      expect(mockAiEmbed).toHaveBeenCalledWith(
        expect.objectContaining({ value: 'test text' })
      )
    })
  })

  describe('openai', () => {
    it('returns embedding and usage', async () => {
      const config: EmbeddingProviderConfig = { provider: 'openai', model: 'text-embedding-3-small', apiKey: 'oai-key' }
      const result = await embed('hello world', config)
      expect(result.embedding).toEqual([0.1, 0.2, 0.3])
      expect(result.usage).toEqual({ tokens: 5 })
    })

    it('passes the apiKey to createOpenAI', async () => {
      const config: EmbeddingProviderConfig = { provider: 'openai', model: 'text-embedding-3-small', apiKey: 'my-oai-key' }
      await embed('test', config)
      expect(createOpenAI).toHaveBeenCalledWith({ apiKey: 'my-oai-key' })
    })

    it('calls openai.embedding() with the model id', async () => {
      const mockEmbeddingFn = vi.fn((modelId: string) => ({ _provider: 'openai', _modelId: modelId }))
      vi.mocked(createOpenAI).mockReturnValueOnce({ embedding: mockEmbeddingFn } as ReturnType<typeof createOpenAI>)
      const config: EmbeddingProviderConfig = { provider: 'openai', model: 'text-embedding-3-large', apiKey: 'oai-key' }
      await embed('test', config)
      expect(mockEmbeddingFn).toHaveBeenCalledWith('text-embedding-3-large')
    })
  })

  describe('anthropic', () => {
    it('throws an error explaining embeddings are not supported', async () => {
      const config: EmbeddingProviderConfig = { provider: 'anthropic', model: 'claude-3-5-sonnet-20241022', apiKey: 'ant-key' }
      await expect(embed('test', config)).rejects.toThrow(
        'Anthropic does not support embeddings. Use OpenAI or Ollama instead.'
      )
    })

    it('does not call aiEmbed for anthropic', async () => {
      const config: EmbeddingProviderConfig = { provider: 'anthropic', model: 'claude-3', apiKey: 'ant-key' }
      await expect(embed('test', config)).rejects.toThrow()
      expect(mockAiEmbed).not.toHaveBeenCalled()
    })
  })

  describe('bedrock', () => {
    it('returns embedding and usage', async () => {
      const config: EmbeddingProviderConfig = { provider: 'bedrock', model: 'amazon.titan-embed-text-v1', region: 'us-east-1' }
      const result = await embed('hello world', config)
      expect(result.embedding).toEqual([0.1, 0.2, 0.3])
      expect(result.usage).toEqual({ tokens: 5 })
    })

    it('passes region to createAmazonBedrock', async () => {
      const config: EmbeddingProviderConfig = { provider: 'bedrock', model: 'amazon.titan-embed-text-v1', region: 'eu-west-1' }
      await embed('test', config)
      expect(createAmazonBedrock).toHaveBeenCalledWith({ region: 'eu-west-1' })
    })

    it('defaults region to us-east-1 when not provided', async () => {
      const config: EmbeddingProviderConfig = { provider: 'bedrock', model: 'amazon.titan-embed-text-v1' }
      await embed('test', config)
      expect(createAmazonBedrock).toHaveBeenCalledWith({ region: 'us-east-1' })
    })

    it('calls bedrock.embedding() with the model id', async () => {
      const mockEmbeddingFn = vi.fn((modelId: string) => ({ _provider: 'bedrock', _modelId: modelId }))
      vi.mocked(createAmazonBedrock).mockReturnValueOnce({ embedding: mockEmbeddingFn } as ReturnType<typeof createAmazonBedrock>)
      const config: EmbeddingProviderConfig = { provider: 'bedrock', model: 'amazon.titan-embed-text-v2:0' }
      await embed('test', config)
      expect(mockEmbeddingFn).toHaveBeenCalledWith('amazon.titan-embed-text-v2:0')
    })
  })

  describe('ollama', () => {
    it('returns embedding and usage', async () => {
      const config: EmbeddingProviderConfig = { provider: 'ollama', model: 'nomic-embed-text', baseURL: 'http://localhost:11434/api' }
      const result = await embed('hello world', config)
      expect(result.embedding).toEqual([0.1, 0.2, 0.3])
      expect(result.usage).toEqual({ tokens: 5 })
    })

    it('passes baseURL to createOllama', async () => {
      const config: EmbeddingProviderConfig = { provider: 'ollama', model: 'nomic-embed-text', baseURL: 'http://custom-host:11434/api' }
      await embed('test', config)
      expect(createOllama).toHaveBeenCalledWith({ baseURL: 'http://custom-host:11434/api' })
    })

    it('defaults baseURL to http://localhost:11434/api when not provided', async () => {
      const config: EmbeddingProviderConfig = { provider: 'ollama', model: 'nomic-embed-text' }
      await embed('test', config)
      expect(createOllama).toHaveBeenCalledWith({ baseURL: 'http://localhost:11434/api' })
    })

    it('calls ollama.embedding() with the model id', async () => {
      const mockEmbeddingFn = vi.fn((modelId: string) => ({ _provider: 'ollama', _modelId: modelId }))
      vi.mocked(createOllama).mockReturnValueOnce({ embedding: mockEmbeddingFn } as ReturnType<typeof createOllama>)
      const config: EmbeddingProviderConfig = { provider: 'ollama', model: 'mxbai-embed-large' }
      await embed('test', config)
      expect(mockEmbeddingFn).toHaveBeenCalledWith('mxbai-embed-large')
    })
  })
})
