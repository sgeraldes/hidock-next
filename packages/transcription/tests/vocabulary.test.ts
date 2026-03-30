import { describe, it, expect } from 'vitest'
import { VocabularyCorrector, escapeRegex } from '../src/vocabulary.js'
import type { TranscriptSegment } from '../src/engines/engine-interface.js'

const seg = (text: string): TranscriptSegment => ({
  speaker: 'you',
  text,
  startTime: 0,
  endTime: 1,
  confidence: 0.9,
  source: 'mic',
})

describe('VocabularyCorrector', () => {
  it('returns segment unchanged when no corrections configured', () => {
    const vc = new VocabularyCorrector()
    const s = seg('hi dock')
    expect(vc.correct(s).text).toBe('hi dock')
  })

  it('applies a single-word correction with case insensitivity', () => {
    const vc = new VocabularyCorrector({ dock: 'Dock' })
    expect(vc.correct(seg('the dock is here')).text).toBe('the Dock is here')
    expect(vc.correct(seg('the DOCK is here')).text).toBe('the Dock is here')
    expect(vc.correct(seg('the Dock is here')).text).toBe('the Dock is here')
  })

  it('single-word correction respects word boundaries', () => {
    const vc = new VocabularyCorrector({ hi: 'HI' })
    expect(vc.correct(seg('hi there')).text).toBe('HI there')
    expect(vc.correct(seg('high there')).text).toBe('high there')
  })

  it('applies multi-word corrections with exact string replacement', () => {
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
    const vc = new VocabularyCorrector({ 'hi dock': 'HiDock' })
    const result = vc.correctAll([seg('hi dock there'), seg('hi dock again')])
    expect(result[0].text).toBe('HiDock there')
    expect(result[1].text).toBe('HiDock again')
  })

  it('correctAll returns empty array for empty input', () => {
    const vc = new VocabularyCorrector({ hi: 'hello' })
    expect(vc.correctAll([])).toEqual([])
  })

  it('skips empty string corrections', () => {
    const vc = new VocabularyCorrector({ '': 'nothing' })
    expect(vc.correct(seg('hello world')).text).toBe('hello world')
  })
})

describe('escapeRegex', () => {
  it('escapes special regex characters', () => {
    expect(escapeRegex('a.b')).toBe('a\\.b')
    expect(escapeRegex('a*b')).toBe('a\\*b')
    expect(escapeRegex('a+b')).toBe('a\\+b')
    expect(escapeRegex('a?b')).toBe('a\\?b')
    expect(escapeRegex('a^b')).toBe('a\\^b')
    expect(escapeRegex('a$b')).toBe('a\\$b')
    expect(escapeRegex('a{b}')).toBe('a\\{b\\}')
    expect(escapeRegex('a(b)')).toBe('a\\(b\\)')
    expect(escapeRegex('a|b')).toBe('a\\|b')
    expect(escapeRegex('a[b]')).toBe('a\\[b\\]')
    expect(escapeRegex('a\\b')).toBe('a\\\\b')
  })

  it('returns plain strings unchanged', () => {
    expect(escapeRegex('hello')).toBe('hello')
    expect(escapeRegex('HiDock')).toBe('HiDock')
  })
})
