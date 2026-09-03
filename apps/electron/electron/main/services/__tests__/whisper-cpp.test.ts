/** @vitest-environment node */
import { describe, expect, it } from 'vitest'
import { parseWhisperJson, resolveWhisperBinary, validateWhisperConfiguration } from '../whisper-cpp'

describe('whisper.cpp adapter', () => {
  it('parses full JSON output into searchable text and timestamped segments', () => {
    const result = parseWhisperJson(JSON.stringify({
      result: { language: 'en' },
      transcription: [
        { offsets: { from: 0, to: 1250 }, text: ' First point. ' },
        { offsets: { from: 1250, to: 3000 }, text: 'Second point.' },
        { offsets: { from: 3000, to: 3100 }, text: '   ' }
      ]
    }))

    expect(result.language).toBe('en')
    expect(result.fullText).toBe('First point.\nSecond point.')
    expect(result.segments).toEqual([
      { speaker: 'Speaker', start: 0, end: 1.25, text: 'First point.' },
      { speaker: 'Speaker', start: 1.25, end: 3, text: 'Second point.' }
    ])
  })

  it('fails closed when either the executable or model is absent', () => {
    expect(resolveWhisperBinary('/definitely/missing/whisper-cli')).toBeNull()
    expect(() => validateWhisperConfiguration('/definitely/missing/whisper-cli', '/missing/model.bin'))
      .toThrow(/Whisper CLI not found/)
  })
})
