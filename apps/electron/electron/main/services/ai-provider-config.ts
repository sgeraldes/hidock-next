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
 * user Settings. Returns null when no usable provider is configured.
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

  // Local Ollama is a first-class completion provider. The shared provider
  // expects its base URL to include `/api`, while Settings stores the server
  // root used by the rest of the Electron app.
  if (cfg.chat.provider === 'ollama' && cfg.chat.ollamaModel) {
    const root = (cfg.embeddings?.ollamaBaseUrl || 'http://localhost:11434').replace(/\/+$/, '')
    return {
      provider: 'ollama',
      model: cfg.chat.ollamaModel,
      baseURL: root.endsWith('/api') ? root : `${root}/api`,
    }
  }

  // No valid provider configured
  return null
}

/**
 * Provider config for knowledge-graph EXTRACTION (decisions / action_items /
 * entities). Identical to getProviderConfigFromSettings() EXCEPT that, when the
 * resolved provider is Ollama, the model is overridden with
 * `chat.extractionOllamaModel` (default gemma3:12b). This keeps extraction on a
 * stronger local model without changing the assistant/chat or the value
 * classifier, which both continue to use getProviderConfigFromSettings().
 *
 * When the extraction model is unset, or the provider is Gemini (a capable
 * cloud model already), this returns the base config unchanged.
 */
export function getExtractionProviderConfig(): ProviderConfig | null {
  const base = getProviderConfigFromSettings()
  if (!base) return null
  if (base.provider !== 'ollama') return base // Gemini path: no override needed
  const cfg = getConfig()
  const extractionModel = cfg.chat.extractionOllamaModel?.trim()
  if (!extractionModel || extractionModel === base.model) return base
  return { ...base, model: extractionModel }
}
