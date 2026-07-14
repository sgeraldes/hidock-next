/**
 * Live Gemini model discovery for the transcription-model picker.
 *
 * The Settings dropdown used to be a hand-maintained array that drifted out of
 * sync with the real API (offered retired 2.5 models + TTS/Image/Live models
 * that can't transcribe, and omitted the current default). Instead we query the
 * API's ListModels endpoint with the user's key and keep only the general
 * multimodal models that actually accept audio for transcription. A concrete
 * fallback (preferring the rolling `-latest` aliases) is used when the API is
 * unreachable or no key is set, so the picker is never empty.
 *
 * Docs: https://ai.google.dev/gemini-api/docs/models
 */

export interface GeminiModelOption {
  value: string
  label: string
}

// Names that are NOT general audio-transcription models even though they may
// expose generateContent: text-to-speech, image/video generation, embeddings,
// attributed-QA, the Live (audio-to-audio) API, and non-Gemini families.
const EXCLUDE_NAME = /tts|image|imagen|veo|embedding|embed|aqa|vision|native-audio|[-_]live\b|[-_]live[-_]|learnlm|gemma/i

// Superseded generations we never want to surface (1.0/1.5/2.0 + bare pro).
const OLD_GEN = /gemini-1\.0|gemini-1\.5|gemini-2\.0|^gemini-pro$|^gemini-pro-vision/

// Concrete-safe fallback (no network). Leads with the rolling `-latest` aliases
// (per the user's preference) plus the confirmed current concrete IDs so a
// transcription call can never 404 on a stale hard-coded name.
export const FALLBACK_GEMINI_MODELS: GeminiModelOption[] = [
  { value: 'gemini-flash-latest', label: 'Gemini Flash (latest)' },
  { value: 'gemini-3.5-flash', label: 'Gemini 3.5 Flash' },
  { value: 'gemini-flash-lite-latest', label: 'Gemini Flash-Lite (latest)' },
  { value: 'gemini-3.1-flash-lite', label: 'Gemini 3.1 Flash-Lite' },
  { value: 'gemini-pro-latest', label: 'Gemini Pro (latest)' }
]

interface RawModel {
  name?: string
  displayName?: string
  supportedGenerationMethods?: string[]
}

/**
 * Pure filter (unit-testable): keep only audio-transcription-capable Gemini
 * models, drop TTS/image/embedding/live/old-gen and any explicitly-retired IDs,
 * de-dup, and sort `-latest` aliases first then newest version.
 */
export function filterTranscriptionModels(
  raw: RawModel[] | undefined,
  retired: Set<string> = new Set()
): GeminiModelOption[] {
  const seen = new Set<string>()
  const out: GeminiModelOption[] = []
  for (const m of raw || []) {
    if (!m?.name) continue
    if (!(m.supportedGenerationMethods || []).includes('generateContent')) continue
    const id = m.name.replace(/^models\//, '')
    if (!id.startsWith('gemini-')) continue
    if (EXCLUDE_NAME.test(id)) continue
    if (OLD_GEN.test(id)) continue
    if (retired.has(id)) continue
    if (seen.has(id)) continue
    seen.add(id)
    out.push({ value: id, label: m.displayName?.trim() || id })
  }
  out.sort((a, b) => {
    const aLatest = a.value.endsWith('-latest') ? 0 : 1
    const bLatest = b.value.endsWith('-latest') ? 0 : 1
    if (aLatest !== bLatest) return aLatest - bLatest
    // newer version strings sort first (reverse lexicographic is a good proxy)
    return b.value.localeCompare(a.value)
  })
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
