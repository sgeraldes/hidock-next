/**
 * Live Gemini model discovery for the transcription-model picker.
 *
 * The Settings dropdown used to be a hand-maintained array that drifted out of
 * sync with the real API (offered retired 2.5 models + TTS/Image/Live models
 * that can't transcribe, and omitted the current default). Instead we query the
 * API's ListModels endpoint with the user's key and expose only the dedicated
 * non-streaming transcription model. A concrete fallback is used when the API
 * is unreachable or no key is set, so the picker is never empty.
 *
 * Docs: https://ai.google.dev/gemini-api/docs/models
 */

export interface GeminiModelOption {
  value: string
  label: string
}

// Concrete-safe fallback (no network).
export const FALLBACK_GEMINI_MODELS: GeminiModelOption[] = [
  { value: 'gemini-3.5-transcribe', label: 'Gemini 3.5 Flash Transcribe' }
]

interface RawModel {
  name?: string
  displayName?: string
  supportedGenerationMethods?: string[]
}

/**
 * Pure filter (unit-testable): keep only audio-transcription-capable Gemini
 * model, drop Live/general-purpose models and any explicitly-retired IDs, and
 * de-duplicate the result.
 */
export function filterTranscriptionModels(
  raw: RawModel[] | undefined,
  retired: Set<string> = new Set()
): GeminiModelOption[] {
  const seen = new Set<string>()
  const out: GeminiModelOption[] = []
  for (const m of raw || []) {
    if (!m?.name) continue
    const id = m.name.replace(/^models\//, '')
    if (id !== 'gemini-3.5-transcribe') continue
    if (retired.has(id)) continue
    if (seen.has(id)) continue
    seen.add(id)
    out.push({ value: id, label: m.displayName?.trim() || id })
  }
  out.sort((a, b) => b.value.localeCompare(a.value))
  return out
}

export interface ListModelsResult {
  /** true = live list from the API; false = fallback (see reason). */
  ok: boolean
  models: GeminiModelOption[]
  reason?: 'no-key' | 'empty' | 'error' | `http-${number}`
}

/**
 * Fetch the audio-transcription-capable Gemini models available to this API key.
 * Always resolves with a non-empty `models` list (live or fallback).
 */
export async function listGeminiTranscriptionModels(
  apiKey: string | undefined,
  retired?: Set<string>
): Promise<ListModelsResult> {
  const key = (apiKey || '').trim()
  if (!key) return { ok: false, models: FALLBACK_GEMINI_MODELS, reason: 'no-key' }
  try {
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models?key=${encodeURIComponent(key)}&pageSize=200`
    )
    if (!res.ok) return { ok: false, models: FALLBACK_GEMINI_MODELS, reason: `http-${res.status}` }
    const data = (await res.json()) as { models?: RawModel[] }
    const models = filterTranscriptionModels(data.models, retired)
    if (models.length === 0) return { ok: false, models: FALLBACK_GEMINI_MODELS, reason: 'empty' }
    return { ok: true, models }
  } catch {
    return { ok: false, models: FALLBACK_GEMINI_MODELS, reason: 'error' }
  }
}
