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
 * Provider_Config_Resolver — the single resolver used by knowledge-graph
 * EXTRACTION (decisions / action_items / entities). This function is the
 * authoritative graph-extraction resolver and MUST remain so (Req 6.1).
 *
 * Model isolation (Req 6):
 * - Graph extraction resolves its Ollama model from `chat.extractionOllamaModel`
 *   (`gemma3:12b` in the live config) (Req 6.2). The stronger local model keeps
 *   extraction faithful without touching the assistant/chat model.
 * - The assistant / RAG chat resolves from `chat.ollamaModel` (`llama3.2`) via
 *   getProviderConfigFromSettings() and is NOT touched here (Req 6.3).
 * - The value-classification path also keeps using getProviderConfigFromSettings()
 *   (its existing configuration path) and is unaffected by this resolver (Req 6.4).
 * - Because extraction reads `chat.extractionOllamaModel` and chat reads
 *   `chat.ollamaModel` from separate keys, changing the extraction model never
 *   alters the chat model, and vice versa (Req 6.5).
 *
 * Documented fallback (Req 6.6): when `chat.extractionOllamaModel` is absent or
 * blank, extraction falls back to the base Ollama model (`chat.ollamaModel`) —
 * exactly the fallback documented on the config field. We intentionally do NOT
 * fabricate a hard-coded extraction default here; the base config's model is the
 * documented fallback so a single source of truth governs the chat model.
 *
 * Documented Gemini branch (Req 6.7): when the configured provider is Gemini, the
 * base resolver already returns a capable cloud model (`chat.geminiModel`), so
 * extraction applies no Ollama override and returns the base config unchanged.
 * This is the explicit, documented Gemini behaviour — extraction and chat share
 * the same Gemini model because there is no separate Gemini extraction key.
 *
 * Pure function of getConfig(); no side effects. Returns null when no usable
 * provider is configured (mirrors getProviderConfigFromSettings()).
 */
export function getExtractionProviderConfig(): ProviderConfig | null {
  const base = getProviderConfigFromSettings()
  if (!base) return null
  // Gemini branch (Req 6.7): no Ollama extraction override on the cloud path.
  if (base.provider !== 'ollama') return base
  const cfg = getConfig()
  const extractionModel = cfg.chat.extractionOllamaModel?.trim()
  // Documented fallback (Req 6.6): absent/blank extraction model → base
  // `chat.ollamaModel`. Also no-op when the extraction model equals the base
  // model, so the returned config is identical to chat's in that case.
  if (!extractionModel || extractionModel === base.model) return base
  // Graph-extraction override (Req 6.2, 6.5): swap ONLY the model; the base
  // provider/baseURL (and thus the chat resolution) are left untouched.
  return { ...base, model: extractionModel }
}
