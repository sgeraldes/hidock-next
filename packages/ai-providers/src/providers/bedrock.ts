import { createAmazonBedrock } from '@ai-sdk/amazon-bedrock'
import type { LanguageModel } from 'ai'
import type { BedrockProviderConfig } from '../types.js'

export function createBedrockModel(config: BedrockProviderConfig): LanguageModel {
  const bedrock = createAmazonBedrock({
    region: config.region ?? 'us-east-1',
    accessKeyId: config.accessKeyId,
    secretAccessKey: config.secretAccessKey,
    sessionToken: config.sessionToken
  })
  return bedrock(config.model)
}
