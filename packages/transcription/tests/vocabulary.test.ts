import { describe, it, expect } from 'vitest'
import { VocabularyCorrector } from '../src/vocabulary.js'
import type { TranscriptSegment } from '../src/engines/engine-interface.js'

const seg = (text: string): TranscriptSegment => ({
  speaker: 'you',
  text,
  startTime: 0,
  endTime: 1,
  confidence: 0.9,
  source: 'mic'
})

describe('VocabularyCorrector', () => {
  it('returns segment unchanged when no corrections configured', () => {
    const vc = new VocabularyCorrector()
    const s = seg('hi dock')
    expect(vc.correct(s).text).toBe('hi dock')
  })

  it('applies a single correction', () => {
    const vc = new VocabularyCorrector({ 'hi dock': 'HiDock' })
    expect(vc.correct(seg('hi dock')).text).toBe('HiDock')
  })

  it('applies multiple corrections', () => {
    const vc = new VocabularyCorrector({ 'hi dock': 'HiDock', 'a i': 'AI' })
    expect(vc.correct(seg('hi dock and a i')).text).toBe('HiDock and AI')
  })

  it('does not mutate the original segment', () => {
    const vc = new VocabularyCorrector({ foo: 'bar' })
    const original = seg('foo')
    vc.correct(original)
    expect(original.text).toBe('foo')
  })

  it('correctAll applies corrections to every segment', () => {
    const vc = new VocabularyCorrector({ hi: 'hello' })
    const result = vc.correctAll([seg('hi there'), seg('hi again')])
    expect(result[0].text).toBe('hello there')
    expect(result[1].text).toBe('hello again')
  })

  it('correctAll returns empty array for empty input', () => {
    const vc = new VocabularyCorrector({ hi: 'hello' })
    expect(vc.correctAll([])).toEqual([])
  })
})
