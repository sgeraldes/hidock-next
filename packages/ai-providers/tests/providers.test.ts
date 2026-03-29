import { describe, it, expect, vi } from 'vitest'
import { createGoogleGenerativeAI } from '@ai-sdk/google'
import { createOpenAI } from '@ai-sdk/openai'
import { createAnthropic } from '@ai-sdk/anthropic'
import { createAmazonBedrock } from '@ai-sdk/amazon-bedrock'
import { createOllama } from 'ollama-ai-provider'

vi.mock('@ai-sdk/google', () => ({
  createGoogleGenerativeAI: vi.fn((opts: { apiKey: string }) => {
    return vi.fn((modelId: string) => ({ _provider: 'google', _modelId: modelId, _apiKey: opts.apiKey }))
  })
}))

vi.mock('@ai-sdk/openai', () => ({
  createOpenAI: vi.fn((opts: { apiKey: string }) => {
    return vi.fn((modelId: string) => ({ _provider: 'openai', _modelId: modelId, _apiKey: opts.apiKey }))
  })
}))

vi.mock('@ai-sdk/anthropic', () => ({
  createAnthropic: vi.fn((opts: { apiKey: string }) => {
    return vi.fn((modelId: string) => ({ _provider: 'anthropic', _modelId: modelId, _apiKey: opts.apiKey }))
  })
}))

vi.mock('@ai-sdk/amazon-bedrock', () => ({
  createAmazonBedrock: vi.fn((opts: Record<string, string>) => {
    return vi.fn((modelId: string) => ({ _provider: 'bedrock', _modelId: modelId, _region: opts.region }))
  })
}))

vi.mock('ollama-ai-provider', () => ({
  createOllama: vi.fn((opts: { baseURL: string }) => {
    return vi.fn((modelId: string) => ({ _provider: 'ollama', _modelId: modelId, _baseURL: opts.baseURL }))
  })
}))

import { createGeminiModel } from '../src/providers/gemini.js'
import { createOpenAIModel } from '../src/providers/openai.js'
import { createAnthropicModel } from '../src/providers/anthropic.js'
import { createBedrockModel } from '../src/providers/bedrock.js'
import { createOllamaModel } from '../src/providers/ollama.js'

describe('createGeminiModel', () => {
  it('creates a model with the given apiKey and model id', () => {
    const model = createGeminiModel({ provider: 'google', model: 'gemini-2.0-flash', apiKey: 'g-key' })
    expect(model).toBeDefined()
  })

  it('passes the apiKey to the SDK', () => {
    createGeminiModel({ provider: 'google', model: 'gemini-2.0-flash', apiKey: 'my-google-key' })
    expect(createGoogleGenerativeAI).toHaveBeenCalledWith({ apiKey: 'my-google-key' })
  })
})

describe('createOpenAIModel', () => {
  it('creates a model with the given apiKey and model id', () => {
    const model = createOpenAIModel({ provider: 'openai', model: 'gpt-4o', apiKey: 'oai-key' })
    expect(model).toBeDefined()
  })

  it('passes the apiKey to the SDK', () => {
    createOpenAIModel({ provider: 'openai', model: 'gpt-4o', apiKey: 'my-openai-key' })
    expect(createOpenAI).toHaveBeenCalledWith({ apiKey: 'my-openai-key' })
  })
})

describe('createAnthropicModel', () => {
  it('creates a model with the given apiKey and model id', () => {
    const model = createAnthropicModel({ provider: 'anthropic', model: 'claude-3-5-sonnet-20241022', apiKey: 'ant-key' })
    expect(model).toBeDefined()
  })

  it('passes the apiKey to the SDK', () => {
    createAnthropicModel({ provider: 'anthropic', model: 'claude-3-5-sonnet-20241022', apiKey: 'my-anthropic-key' })
    expect(createAnthropic).toHaveBeenCalledWith({ apiKey: 'my-anthropic-key' })
  })
})

describe('createBedrockModel', () => {
  it('creates a model with the given config', () => {
    const model = createBedrockModel({
      provider: 'bedrock',
      model: 'anthropic.claude-3-5-sonnet-20241022-v2:0',
      region: 'eu-west-1',
      accessKeyId: 'AKIA123',
      secretAccessKey: 'secret'
    })
    expect(model).toBeDefined()
  })

  it('defaults region to us-east-1', () => {
    createBedrockModel({ provider: 'bedrock', model: 'some-model' })
    expect(createAmazonBedrock).toHaveBeenCalledWith(
      expect.objectContaining({ region: 'us-east-1' })
    )
  })
})

describe('createOllamaModel', () => {
  it('creates a model with the given config', () => {
    const model = createOllamaModel({ provider: 'ollama', model: 'llama3.2', baseURL: 'http://localhost:11434/api' })
    expect(model).toBeDefined()
  })

  it('defaults baseURL to http://localhost:11434/api', () => {
    createOllamaModel({ provider: 'ollama', model: 'llama3.2' })
    expect(createOllama).toHaveBeenCalledWith({ baseURL: 'http://localhost:11434/api' })
  })
})
