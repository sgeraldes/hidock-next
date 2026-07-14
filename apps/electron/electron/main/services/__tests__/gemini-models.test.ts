import { describe, it, expect } from 'vitest'
import { filterTranscriptionModels, FALLBACK_GEMINI_MODELS } from '../gemini-models'

const gc = ['generateContent']

describe('filterTranscriptionModels', () => {
  it('keeps current audio-capable Gemini models and drops non-transcription ones', () => {
    const raw = [
      { name: 'models/gemini-3.5-flash', displayName: 'Gemini 3.5 Flash', supportedGenerationMethods: gc },
      { name: 'models/gemini-3.1-flash-lite', displayName: 'Gemini 3.1 Flash-Lite', supportedGenerationMethods: gc },
      { name: 'models/gemini-flash-latest', displayName: 'Gemini Flash (latest)', supportedGenerationMethods: gc },
      // must be excluded:
      { name: 'models/gemini-2.5-flash-preview-tts', displayName: 'TTS', supportedGenerationMethods: gc },
      { name: 'models/gemini-2.5-flash-image', displayName: 'Image', supportedGenerationMethods: gc },
      { name: 'models/gemini-3.1-flash-live-preview', displayName: 'Live', supportedGenerationMethods: gc },
      { name: 'models/text-embedding-004', displayName: 'Embedding', supportedGenerationMethods: ['embedContent'] },
      { name: 'models/gemini-1.5-flash', displayName: 'Old', supportedGenerationMethods: gc },
      { name: 'models/gemini-2.0-flash', displayName: 'Old 2.0', supportedGenerationMethods: gc },
      { name: 'models/gemma-3-27b-it', displayName: 'Gemma', supportedGenerationMethods: gc },
      { name: 'models/imagen-4.0', displayName: 'Imagen', supportedGenerationMethods: gc },
    ]
    const out = filterTranscriptionModels(raw)
    const ids = out.map((m) => m.value)
    expect(ids).toContain('gemini-3.5-flash')
    expect(ids).toContain('gemini-3.1-flash-lite')
    expect(ids).toContain('gemini-flash-latest')
    expect(ids).not.toContain('gemini-2.5-flash-preview-tts')
    expect(ids).not.toContain('gemini-2.5-flash-image')
    expect(ids).not.toContain('gemini-3.1-flash-live-preview')
    expect(ids).not.toContain('text-embedding-004')
    expect(ids).not.toContain('gemini-1.5-flash')
    expect(ids).not.toContain('gemini-2.0-flash')
    expect(ids).not.toContain('gemma-3-27b-it')
    expect(ids).not.toContain('imagen-4.0')
  })

  it('requires generateContent support', () => {
    const out = filterTranscriptionModels([
      { name: 'models/gemini-3.5-flash', supportedGenerationMethods: ['countTokens'] },
    ])
    expect(out).toHaveLength(0)
  })

  it('excludes explicitly-retired ids', () => {
    const retired = new Set(['gemini-2.5-flash'])
    const out = filterTranscriptionModels(
      [
        { name: 'models/gemini-2.5-flash', displayName: '2.5 Flash', supportedGenerationMethods: gc },
        { name: 'models/gemini-3.5-flash', displayName: '3.5 Flash', supportedGenerationMethods: gc },
      ],
      retired
    )
    expect(out.map((m) => m.value)).toEqual(['gemini-3.5-flash'])
  })

  it('de-dups and sorts -latest aliases first', () => {
    const out = filterTranscriptionModels([
      { name: 'models/gemini-3.5-flash', supportedGenerationMethods: gc },
      { name: 'models/gemini-3.5-flash', supportedGenerationMethods: gc },
      { name: 'models/gemini-flash-latest', supportedGenerationMethods: gc },
    ])
    expect(out).toHaveLength(2)
    expect(out[0].value).toBe('gemini-flash-latest')
  })

  it('falls back to a non-empty concrete list', () => {
    expect(FALLBACK_GEMINI_MODELS.length).toBeGreaterThan(0)
    expect(FALLBACK_GEMINI_MODELS.map((m) => m.value)).toContain('gemini-3.5-flash')
  })

  it('handles empty/undefined input', () => {
    expect(filterTranscriptionModels(undefined)).toEqual([])
    expect(filterTranscriptionModels([])).toEqual([])
  })
})
