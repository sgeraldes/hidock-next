/**
 * Transcript-upgrade CORE tests — pure detection, scoring, prompt/parse, blocks.
 *
 * @vitest-environment node
 */

import { describe, it, expect } from 'vitest'
import {
  detectTranscriptFormat,
  storedSegmentsAreStructured,
  fullTextIsStructured,
  parseStoredSegments,
  scoreImportance,
  bandForScore,
  countDecisionCues,
  buildReformatPrompt,
  splitIntoReformatBlocks,
  parseReformatResponse,
  REFORMAT_SYSTEM_PROMPT,
  type ImportanceSignals
} from '../transcript-triage-core'

describe('detectTranscriptFormat — old-format predicate (inverse of the reader)', () => {
  it('flags a flat paragraph blob with no speakers/timestamps as legacy', () => {
    const d = detectTranscriptFormat({
      fullText: 'hola qué tal hoy vamos a revisar el presupuesto y luego seguimos con lo demás sin ninguna marca',
      speakers: null
    })
    expect(d.isLegacy).toBe(true)
    expect(d.hasStoredStructure).toBe(false)
    expect(d.hasTextStructure).toBe(false)
  })

  it('does NOT flag a transcript whose stored segments carry speaker labels', () => {
    const speakers = JSON.stringify([
      { speaker: 'Speaker 1', start: 0, text: 'hola' },
      { speaker: 'Speaker 2', start: 0, text: 'bien' }
    ])
    expect(detectTranscriptFormat({ fullText: 'hola bien', speakers }).isLegacy).toBe(false)
  })

  it('does NOT flag stored segments with non-zero start times', () => {
    const speakers = JSON.stringify([{ start: 12, text: 'hola sin etiqueta pero con tiempo' }])
    expect(detectTranscriptFormat({ fullText: 'hola', speakers }).isLegacy).toBe(false)
  })

  it('does NOT flag a legacy inline-marker chunk (Rec43 shape) — the reader can split it', () => {
    const speakers = JSON.stringify([
      { speaker: 'Speaker 1', start: 0, end: 600, text: '[00:03] Speaker 1: hola [00:09] Speaker 2: chau' }
    ])
    // The single stored segment has start 0 but its text carries inline markers.
    expect(detectTranscriptFormat({ fullText: 'hola chau', speakers: null }).isLegacy).toBe(true) // sanity: null speakers stays legacy
    expect(detectTranscriptFormat({ fullText: 'hola chau', speakers }).isLegacy).toBe(false)
  })

  it('does NOT flag when full_text has speaker-label lines (real Gemini transcript)', () => {
    const fullText = 'Speaker 1: hola qué tal\nSpeaker 2: bien y tú'
    expect(detectTranscriptFormat({ fullText, speakers: null }).isLegacy).toBe(false)
  })

  it('does NOT flag when full_text has line-start timestamps', () => {
    const fullText = '[00:03] hola\n[00:09] chau'
    expect(detectTranscriptFormat({ fullText, speakers: null }).isLegacy).toBe(false)
  })

  it('treats a reformatted transcript (speakers with labels, start 0) as no-longer-legacy', () => {
    const speakers = JSON.stringify([{ speaker: 'Speaker 1', start: 0, text: 'párrafo uno' }])
    expect(detectTranscriptFormat({ fullText: 'párrafo uno', speakers }).isLegacy).toBe(false)
  })
})

describe('parseStoredSegments / structure helpers', () => {
  it('parses valid segment JSON and rejects malformed/non-array', () => {
    expect(parseStoredSegments('[{"text":"a","start":0}]')).toHaveLength(1)
    expect(parseStoredSegments('not json')).toEqual([])
    expect(parseStoredSegments('{"text":"a"}')).toEqual([])
    expect(parseStoredSegments(null)).toEqual([])
  })

  it('storedSegmentsAreStructured detects labels, times, and inline markers', () => {
    expect(storedSegmentsAreStructured([{ speaker: 'Speaker 1', start: 0, text: 'x' }])).toBe(true)
    expect(storedSegmentsAreStructured([{ start: 5, text: 'x' }])).toBe(true)
    expect(storedSegmentsAreStructured([{ start: 0, text: '[00:03] Speaker 1: x' }])).toBe(true)
    expect(storedSegmentsAreStructured([{ start: 0, text: 'plain text no marks' }])).toBe(false)
  })

  it('fullTextIsStructured is false for a flat blob', () => {
    expect(fullTextIsStructured('esto es un bloque plano sin nada')).toBe(false)
    expect(fullTextIsStructured('Speaker 1: hola')).toBe(true)
  })
})

describe('scoreImportance — signal weighting', () => {
  const rich: ImportanceSignals = {
    category: 'interview',
    wordCount: 4000,
    actionItemCount: 6,
    distinctTopicCount: 8,
    attendeeCount: 5,
    hasExternalAttendee: true,
    hasProjectLink: true,
    isRecurring: false,
    ageDays: 10,
    decisionCueMatches: 6
  }

  it('scores a rich, external, recent interview at/above threshold', () => {
    const { score, breakdown } = scoreImportance(rich)
    expect(score).toBeGreaterThanOrEqual(60)
    expect(breakdown.category).toBe(25)
    expect(breakdown.external).toBe(10)
    expect(bandForScore(score)).toBe('recommend-retranscribe')
  })

  it('scores a short, internal, old note well below threshold', () => {
    const poor: ImportanceSignals = {
      category: 'note',
      wordCount: 120,
      actionItemCount: 0,
      distinctTopicCount: 0,
      attendeeCount: 0,
      hasExternalAttendee: false,
      hasProjectLink: false,
      isRecurring: false,
      ageDays: 400,
      decisionCueMatches: 0
    }
    const { score } = scoreImportance(poor)
    expect(score).toBeLessThan(60)
    expect(bandForScore(score)).toBe('reformat')
  })

  it('halves the category weight for a recurring meeting', () => {
    const once = scoreImportance({ category: 'meeting', isRecurring: false })
    const recurring = scoreImportance({ category: 'meeting', isRecurring: true })
    expect(once.breakdown.category).toBe(18)
    expect(recurring.breakdown.category).toBe(9)
  })

  it('clamps the score to 0..100', () => {
    const { score } = scoreImportance(rich)
    expect(score).toBeLessThanOrEqual(100)
    expect(score).toBeGreaterThanOrEqual(0)
  })

  it('bandForScore respects a custom threshold', () => {
    expect(bandForScore(50, 40)).toBe('recommend-retranscribe')
    expect(bandForScore(50, 80)).toBe('reformat')
  })
})

describe('countDecisionCues — Spanish + English commitment lexicon', () => {
  it('counts distinct decision/commitment cues (Spanish-heavy corpus)', () => {
    const text = 'Al final decidimos avanzar. Acordamos la fecha límite y firmamos el contrato. El presupuesto fue aprobado.'
    // decidim, acord, fecha límite, firma, contrato, presupuesto, aprob → 7
    expect(countDecisionCues(text)).toBeGreaterThanOrEqual(6)
  })

  it('returns 0 for chit-chat with no commitments', () => {
    expect(countDecisionCues('hola qué tal cómo estuvo el fin de semana')).toBe(0)
  })
})

describe('reformat prompt + response parsing', () => {
  it('builds a prompt that embeds the transcript and pairs with the strict system prompt', () => {
    const p = buildReformatPrompt('un texto plano')
    expect(p).toContain('un texto plano')
    expect(REFORMAT_SYSTEM_PROMPT).toContain('NEVER invent real names')
  })

  it('parses a fenced JSON array of turns', () => {
    const resp = '```json\n[{"speaker":"Speaker 1","text":"hola"},{"speaker":"Speaker 2","text":"chau"}]\n```'
    const segs = parseReformatResponse(resp)
    expect(segs).toHaveLength(2)
    expect(segs[0]).toMatchObject({ speaker: 'Speaker 1', start: 0, text: 'hola' })
  })

  it('parses a bare array and repairs a trailing comma', () => {
    expect(parseReformatResponse('[{"text":"solo"},]')).toEqual([{ speaker: undefined, start: 0, text: 'solo' }])
  })

  it('drops objects with no usable text and returns [] for non-arrays', () => {
    // First object has a speaker but no text (dropped); second is blank (dropped);
    // only the third survives — and it carries no speaker label.
    expect(parseReformatResponse('[{"speaker":"Speaker 1"},{"text":"  "},{"text":"real"}]')).toEqual([
      { speaker: undefined, start: 0, text: 'real' }
    ])
    // A labelled turn with text keeps its speaker.
    expect(parseReformatResponse('[{"speaker":"Speaker 2","text":"hola"}]')).toEqual([
      { speaker: 'Speaker 2', start: 0, text: 'hola' }
    ])
    expect(parseReformatResponse('{"text":"x"}')).toEqual([])
    expect(parseReformatResponse('')).toEqual([])
  })
})

describe('splitIntoReformatBlocks', () => {
  it('returns a single block when the text already fits', () => {
    expect(splitIntoReformatBlocks('corto', 100)).toEqual(['corto'])
    expect(splitIntoReformatBlocks('', 100)).toEqual([])
  })

  it('splits a long transcript into blocks that each respect the char budget', () => {
    const para = 'Esta es una frase de prueba. '.repeat(50) // ~1450 chars
    const text = Array(6).fill(para).join('\n\n') // ~8700 chars
    const blocks = splitIntoReformatBlocks(text, 2000)
    expect(blocks.length).toBeGreaterThan(1)
    for (const b of blocks) expect(b.length).toBeLessThanOrEqual(2000)
    // No content dropped: joined length is within a small delta of the source.
    const joined = blocks.join(' ').replace(/\s+/g, ' ').trim()
    expect(joined.length).toBeGreaterThan(text.replace(/\s+/g, ' ').trim().length * 0.95)
  })

  it('hard-cuts a single oversized sentence with no boundaries', () => {
    const blob = 'x'.repeat(5000)
    const blocks = splitIntoReformatBlocks(blob, 1000)
    expect(blocks.length).toBe(5)
    for (const b of blocks) expect(b.length).toBeLessThanOrEqual(1000)
  })
})
