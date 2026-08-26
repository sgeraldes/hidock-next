/**
 * Provider-config resolution for the shared @hidock/ai-providers complete() seam.
 *
 * Extracted verbatim (spec-001 step 9) from the private providerConfigFromSettings()
 * that used to live in knowledge-graph-service.ts, so any caller that needs a
 * complete()-compatible ProviderConfig — the standalone value classifier
 * (value-classification.ts), knowledge-graph-service.ts's transcript ingestion,
 * and (later) T3's backfill runner — can resolve one without importing the
 * knowledge-graph module. Pure function of getConfig(); no side effects.
 */

import { getConfig } from './config'
import type { ProviderConfig } from '@hidock/ai-providers'

/**
 * Resolve the AI provider config for the app's shared complete() seam, from
 * user Settings. Returns null when no usable provider is configured (no
 * Gemini API key, or chat.provider isn't 'gemini').
 */
export function getProviderConfigFromSettings(): ProviderConfig | null {
  const cfg = getConfig()

  // Use gemini if api key is set
  if (cfg.chat.provider === 'gemini' && cfg.transcription.geminiApiKey) {
    return {
      provider: 'google',
      model: cfg.chat.geminiModel || 'gemini-3.5-flash',
      apiKey: cfg.transcription.geminiApiKey,
    }
  }

  // No valid provider configured
  return null
}
