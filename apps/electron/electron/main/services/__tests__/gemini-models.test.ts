import { describe, it, expect } from 'vitest'
import { filterTranscriptionModels, FALLBACK_GEMINI_MODELS } from '../gemini-models'

describe('filterTranscriptionModels', () => {
  it('keeps only the dedicated non-streaming transcription model', () => {
    const raw = [
      { name: 'models/gemini-3.5-transcribe', displayName: 'Gemini 3.5 Flash Transcribe' },
      { name: 'models/gemini-3.5-transcribe-live', displayName: 'Live Transcribe' },
      { name: 'models/gemini-3.5-flash', displayName: 'General Flash' },
      { name: 'models/text-embedding-004', displayName: 'Embedding', supportedGenerationMethods: ['embedContent'] },
    ]
    const out = filterTranscriptionModels(raw)
    expect(out).toEqual([{ value: 'gemini-3.5-transcribe', label: 'Gemini 3.5 Flash Transcribe' }])
  })

  it('does not require generateContent because Transcribe uses Interactions', () => {
    const out = filterTranscriptionModels([
      { name: 'models/gemini-3.5-transcribe', supportedGenerationMethods: ['interactions'] },
    ])
    expect(out).toHaveLength(1)
  })

  it('excludes explicitly-retired ids', () => {
    const retired = new Set(['gemini-3.5-transcribe'])
    const out = filterTranscriptionModels(
      [
        { name: 'models/gemini-3.5-transcribe', displayName: 'Transcribe' },
      ],
      retired
    )
    expect(out).toEqual([])
  })

  it('de-dups the dedicated model', () => {
    const out = filterTranscriptionModels([
      { name: 'models/gemini-3.5-transcribe' },
      { name: 'models/gemini-3.5-transcribe' },
    ])
    expect(out).toHaveLength(1)
  })

  it('falls back to a non-empty concrete list', () => {
    expect(FALLBACK_GEMINI_MODELS.length).toBeGreaterThan(0)
    expect(FALLBACK_GEMINI_MODELS.map((m) => m.value)).toEqual(['gemini-3.5-transcribe'])
  })

  it('handles empty/undefined input', () => {
    expect(filterTranscriptionModels(undefined)).toEqual([])
    expect(filterTranscriptionModels([])).toEqual([])
  })
})
