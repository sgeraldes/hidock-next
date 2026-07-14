import { describe, it, expect } from 'vitest'
import type { StoredSegment } from '../../components/TranscriptViewer'
import { splitStoredSegmentOnInlineTurns, expandInlineStoredSegments } from '../splitInlineTurns'

describe('splitStoredSegmentOnInlineTurns', () => {
  it('splits a legacy chunk segment with inline [MM:SS] Speaker N: markers (the Rec43 shape)', () => {
    // A whole chunk stored as ONE segment, markers embedded in the text.
    const segment: StoredSegment = {
      speaker: 'Speaker 1',
      start: 0,
      end: 600,
      text: '[00:03] Speaker 1: hola qué tal [00:09] Speaker 2: bien y tú [05:32] Speaker 3: aquí llego tarde'
    }
    const out = splitStoredSegmentOnInlineTurns(segment)
    expect(out).toHaveLength(3)
    expect(out[0]).toMatchObject({ speaker: 'Speaker 1', start: 3, text: 'hola qué tal' })
    expect(out[1]).toMatchObject({ speaker: 'Speaker 2', start: 9, text: 'bien y tú' })
    expect(out[2]).toMatchObject({ speaker: 'Speaker 3', start: 332, text: 'aquí llego tarde' })
  })

  it('chains ends within the split group and gives the last turn the original end', () => {
    const segment: StoredSegment = {
      speaker: 'Speaker 1',
      start: 0,
      end: 600,
      text: '[00:03] Speaker 1: uno [00:09] Speaker 2: dos'
    }
    const out = splitStoredSegmentOnInlineTurns(segment)
    expect(out[0].end).toBe(out[1].start) // 9
    expect(out[out.length - 1].end).toBe(600) // inherits original end
  })

  it('passes a well-formed segment (no inline markers) through unchanged', () => {
    const segment: StoredSegment = { speaker: 'Speaker 1', start: 3, end: 7, text: 'Hola, buenos días.' }
    const out = splitStoredSegmentOnInlineTurns(segment)
    expect(out).toHaveLength(1)
    expect(out[0]).toBe(segment) // same reference — truly untouched
  })

  it('supports inline HH:MM:SS markers', () => {
    const segment: StoredSegment = {
      speaker: 'Speaker 1',
      start: 0,
      text: '[00:00:03] Speaker 1: early [01:02:03] Speaker 2: much later'
    }
    const out = splitStoredSegmentOnInlineTurns(segment)
    expect(out).toHaveLength(2)
    expect(out[0].start).toBe(3)
    expect(out[1].start).toBe(3723)
  })

  it('offsets a marker time that is LESS than the segment start (later chunk stored relative)', () => {
    // A chunk-2 segment mis-stored at start 600 with chunk-relative marker times.
    const segment: StoredSegment = {
      speaker: 'Speaker 2',
      start: 600,
      end: 900,
      text: '[00:10] Speaker 2: continua [00:40] Speaker 1: responde'
    }
    const out = splitStoredSegmentOnInlineTurns(segment)
    expect(out).toHaveLength(2)
    expect(out[0].start).toBe(610) // 600 + 10
    expect(out[1].start).toBe(640) // 600 + 40
  })

  it('keeps text before the first marker as a leading turn with the original speaker', () => {
    const segment: StoredSegment = {
      speaker: 'Speaker 1',
      start: 12,
      text: 'introducción sin marca [00:20] Speaker 2: con marca'
    }
    const out = splitStoredSegmentOnInlineTurns(segment)
    expect(out).toHaveLength(2)
    expect(out[0]).toMatchObject({ speaker: 'Speaker 1', start: 12, text: 'introducción sin marca' })
    expect(out[1]).toMatchObject({ speaker: 'Speaker 2', start: 20, text: 'con marca' })
  })

  it('collapses continuation whitespace/newlines within a split turn', () => {
    const segment: StoredSegment = {
      start: 0,
      text: '[00:05] Speaker 1: primera línea\nsegunda línea [00:20] Speaker 2: fin'
    }
    const out = splitStoredSegmentOnInlineTurns(segment)
    expect(out[0].text).toBe('primera línea segunda línea')
    expect(out[1].text).toBe('fin')
  })
})

describe('expandInlineStoredSegments', () => {
  it('expands legacy segments while leaving well-formed ones unchanged', () => {
    const legacy: StoredSegment = {
      speaker: 'Speaker 1',
      start: 0,
      end: 600,
      text: '[00:03] Speaker 1: hola [00:09] Speaker 2: chau'
    }
    const wellFormed: StoredSegment = { speaker: 'Speaker 2', start: 601, end: 605, text: 'siguiente chunk limpio' }
    const out = expandInlineStoredSegments([legacy, wellFormed])
    expect(out).toHaveLength(3)
    expect(out.map((s) => s.text)).toEqual(['hola', 'chau', 'siguiente chunk limpio'])
    // The well-formed segment is the exact same object (not reconstructed).
    expect(out[2]).toBe(wellFormed)
  })

  it('returns segments with no markers verbatim', () => {
    const segs: StoredSegment[] = [
      { speaker: 'Speaker 1', start: 3, end: 7, text: 'Hola.' },
      { speaker: 'Speaker 2', start: 7, end: 12, text: 'Buenos días.' }
    ]
    expect(expandInlineStoredSegments(segs)).toEqual(segs)
  })
})
