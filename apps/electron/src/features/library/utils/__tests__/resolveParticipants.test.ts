/**
 * Unit tests for resolveParticipants — the pure resolution that makes the
 * Participants list track transcript speaker corrections (label bindings,
 * per-turn overrides, splits) exactly like the transcript viewer.
 */

import { describe, it, expect } from 'vitest'
import type { StoredSegment } from '../../components/TranscriptViewer'
import {
  resolveParticipants,
  effectiveLabelFor,
  isRawSpeakerLabel,
  type ResolveSpeakerContext,
} from '../resolveParticipants'

const emptyCtx = (over: Partial<ResolveSpeakerContext> = {}): ResolveSpeakerContext => ({
  splits: [],
  speakerMap: new Map(),
  turnOverrides: new Map(),
  mergeHints: new Set(),
  ...over,
})

const seg = (speaker: string, start: number, text = 'x'): StoredSegment => ({ speaker, start, end: start + 1, text })

describe('isRawSpeakerLabel', () => {
  it('matches un-named diarization labels', () => {
    expect(isRawSpeakerLabel('Speaker 1')).toBe(true)
    expect(isRawSpeakerLabel('speaker_2')).toBe(true)
    expect(isRawSpeakerLabel('SPEAKER 03')).toBe(true)
  })
  it('does not match real names', () => {
    expect(isRawSpeakerLabel('Eduardo')).toBe(false)
    expect(isRawSpeakerLabel('Speaker Series')).toBe(false)
  })
})

describe('effectiveLabelFor', () => {
  it('returns the base label when no split applies', () => {
    expect(effectiveLabelFor('Speaker 1', 3, [])).toBe('Speaker 1')
  })
  it('returns the latest split-derived label at or before the turn', () => {
    const splits = [{ baseLabel: 'Speaker 1', fromIndex: 2, derivedLabel: 'Speaker 1 · B' }]
    expect(effectiveLabelFor('Speaker 1', 1, splits)).toBe('Speaker 1')
    expect(effectiveLabelFor('Speaker 1', 2, splits)).toBe('Speaker 1 · B')
    expect(effectiveLabelFor('Speaker 1', 5, splits)).toBe('Speaker 1 · B')
  })
})

describe('resolveParticipants', () => {
  it('returns distinct raw speakers in first-seen order with turn counts', () => {
    const segments = [seg('Speaker 1', 0), seg('Speaker 2', 1), seg('Speaker 1', 2)]
    const out = resolveParticipants(segments, emptyCtx())
    expect(out.map((p) => p.name)).toEqual(['Speaker 1', 'Speaker 2'])
    expect(out[0].turnCount).toBe(2)
    expect(out[0].firstTurnIndex).toBe(0)
    expect(out[1].turnCount).toBe(1)
  })

  it('applies a label→contact binding (rename everywhere)', () => {
    const segments = [seg('Speaker 1', 0), seg('Speaker 1', 1)]
    const ctx = emptyCtx({ speakerMap: new Map([['Speaker 1', { contactId: 'eduardo', name: 'Eduardo' }]]) })
    const out = resolveParticipants(segments, ctx)
    expect(out).toHaveLength(1)
    expect(out[0].name).toBe('Eduardo')
    expect(out[0].contactId).toBe('eduardo')
  })

  it('collapses two labels bound to the same contact into one participant', () => {
    const segments = [seg('Speaker 1', 0), seg('Speaker 2', 1)]
    const ctx = emptyCtx({
      speakerMap: new Map([
        ['Speaker 1', { contactId: 'x', name: 'Xavier' }],
        ['Speaker 2', { contactId: 'x', name: 'Xavier' }],
      ]),
    })
    const out = resolveParticipants(segments, ctx)
    expect(out).toHaveLength(1)
    expect(out[0].contactId).toBe('x')
    expect(out[0].turnCount).toBe(2)
  })

  it('lets a per-turn override supersede the label for that turn', () => {
    const segments = [seg('Speaker 1', 0), seg('Speaker 1', 1)]
    const ctx = emptyCtx({
      speakerMap: new Map([['Speaker 1', { contactId: 'a', name: 'Ana' }]]),
      turnOverrides: new Map([[1, { contactId: 'b', name: 'Bruno' }]]),
    })
    const out = resolveParticipants(segments, ctx)
    // Turn 0 → Ana (label), turn 1 → Bruno (override): two distinct participants.
    expect(out.map((p) => p.name).sort()).toEqual(['Ana', 'Bruno'])
  })

  it('respects a split (from a turn onward the derived label resolves separately)', () => {
    const segments = [seg('Speaker 1', 0), seg('Speaker 1', 1), seg('Speaker 1', 2)]
    const ctx = emptyCtx({
      splits: [{ baseLabel: 'Speaker 1', fromIndex: 1, derivedLabel: 'Speaker 1 · B' }],
      speakerMap: new Map([['Speaker 1 · B', { contactId: 'b', name: 'Bianca' }]]),
    })
    const out = resolveParticipants(segments, ctx)
    // Turn 0 stays "Speaker 1"; turns 1-2 become Bianca.
    expect(out.map((p) => p.name).sort()).toEqual(['Bianca', 'Speaker 1'])
    const bianca = out.find((p) => p.name === 'Bianca')!
    expect(bianca.turnCount).toBe(2)
  })

  it('flags merge-suspected labels', () => {
    const segments = [seg('Speaker 1', 0)]
    const ctx = emptyCtx({ mergeHints: new Set(['Speaker 1']) })
    const out = resolveParticipants(segments, ctx)
    expect(out[0].mergeSuspected).toBe(true)
  })

  it('ignores blank speakers and empty text', () => {
    const segments: StoredSegment[] = [
      { speaker: '', start: 0, end: 1, text: 'a' },
      { speaker: 'Speaker 1', start: 1, end: 2, text: '   ' },
      seg('Speaker 2', 2),
    ]
    const out = resolveParticipants(segments, emptyCtx())
    expect(out.map((p) => p.name)).toEqual(['Speaker 2'])
  })
})
