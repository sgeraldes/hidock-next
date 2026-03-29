import { describe, it, expect } from 'vitest'
import { correlate } from '../src/meeting-correlator.js'
import type { CalendarEvent } from '../src/types.js'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeEvent(offsetMinutes: number, uid = 'evt-1'): CalendarEvent {
  const base = new Date('2025-01-15T09:00:00Z')
  const startTime = new Date(base.getTime() + offsetMinutes * 60_000)
  const endTime = new Date(startTime.getTime() + 60 * 60_000) // 1-hour event
  return {
    uid,
    title: `Meeting ${uid}`,
    startTime,
    endTime,
    attendees: []
  }
}

const RECORDING_START = new Date('2025-01-15T09:00:00Z')

// ---------------------------------------------------------------------------
// 0 matches → none
// ---------------------------------------------------------------------------

describe('correlate: no matches', () => {
  it('returns none when event list is empty', () => {
    const result = correlate(RECORDING_START, [])
    expect(result.recommendation.type).toBe('none')
  })

  it('returns none when only event is beyond suggestLinkMinutes', () => {
    const event = makeEvent(121) // just beyond default 120 min
    const result = correlate(RECORDING_START, [event])
    expect(result.recommendation.type).toBe('none')
  })
})

// ---------------------------------------------------------------------------
// 1 match within autoLinkMinutes → auto-link
// ---------------------------------------------------------------------------

describe('correlate: auto-link', () => {
  it('auto-links when single event offset is 0', () => {
    const event = makeEvent(0)
    const result = correlate(RECORDING_START, [event])
    expect(result.recommendation.type).toBe('auto-link')
    if (result.recommendation.type === 'auto-link') {
      expect(result.recommendation.match.event.uid).toBe('evt-1')
      expect(result.recommendation.match.offsetMinutes).toBe(0)
    }
  })

  it('auto-links when single event offset equals autoLinkMinutes (boundary inclusive)', () => {
    const event = makeEvent(5) // exactly at default 5-min boundary
    const result = correlate(RECORDING_START, [event])
    expect(result.recommendation.type).toBe('auto-link')
  })

  it('auto-links with custom autoLinkMinutes', () => {
    const event = makeEvent(10)
    const result = correlate(RECORDING_START, [event], { autoLinkMinutes: 10 })
    expect(result.recommendation.type).toBe('auto-link')
  })

  it('does NOT auto-link when offset is just over autoLinkMinutes', () => {
    const event = makeEvent(6) // 6 min, beyond default 5
    const result = correlate(RECORDING_START, [event])
    expect(result.recommendation.type).not.toBe('auto-link')
  })
})

// ---------------------------------------------------------------------------
// 1 match within suggestLinkMinutes → suggest
// ---------------------------------------------------------------------------

describe('correlate: suggest', () => {
  it('suggests when single event offset is within suggestLinkMinutes but beyond autoLinkMinutes', () => {
    const event = makeEvent(60)
    const result = correlate(RECORDING_START, [event])
    expect(result.recommendation.type).toBe('suggest')
    if (result.recommendation.type === 'suggest') {
      expect(result.recommendation.match.event.uid).toBe('evt-1')
    }
  })

  it('suggests at exactly suggestLinkMinutes boundary (inclusive)', () => {
    const event = makeEvent(120) // exactly at default 120-min boundary
    const result = correlate(RECORDING_START, [event])
    expect(result.recommendation.type).toBe('suggest')
  })

  it('does NOT suggest when offset is just beyond suggestLinkMinutes', () => {
    const event = makeEvent(121)
    const result = correlate(RECORDING_START, [event])
    expect(result.recommendation.type).toBe('none')
  })
})

// ---------------------------------------------------------------------------
// suggestEnabled=false → suppresses suggest
// ---------------------------------------------------------------------------

describe('correlate: suggestEnabled=false', () => {
  it('returns none instead of suggest when suggestEnabled is false', () => {
    const event = makeEvent(60) // within suggest range but not auto-link range
    const result = correlate(RECORDING_START, [event], { suggestEnabled: false })
    expect(result.recommendation.type).toBe('none')
  })

  it('still auto-links when suggestEnabled is false and offset is within autoLinkMinutes', () => {
    const event = makeEvent(3)
    const result = correlate(RECORDING_START, [event], { suggestEnabled: false })
    expect(result.recommendation.type).toBe('auto-link')
  })
})

// ---------------------------------------------------------------------------
// 2+ matches → select
// ---------------------------------------------------------------------------

describe('correlate: select', () => {
  it('returns select when two events are within suggestLinkMinutes', () => {
    const events = [makeEvent(10, 'evt-1'), makeEvent(30, 'evt-2')]
    const result = correlate(RECORDING_START, events)
    expect(result.recommendation.type).toBe('select')
    if (result.recommendation.type === 'select') {
      expect(result.recommendation.matches).toHaveLength(2)
    }
  })

  it('returns select even when both events are within autoLinkMinutes', () => {
    const events = [makeEvent(1, 'evt-1'), makeEvent(2, 'evt-2')]
    const result = correlate(RECORDING_START, events)
    expect(result.recommendation.type).toBe('select')
  })

  it('returns select for 3+ candidates', () => {
    const events = [
      makeEvent(5, 'evt-1'),
      makeEvent(20, 'evt-2'),
      makeEvent(45, 'evt-3')
    ]
    const result = correlate(RECORDING_START, events)
    expect(result.recommendation.type).toBe('select')
    if (result.recommendation.type === 'select') {
      expect(result.recommendation.matches).toHaveLength(3)
    }
  })

  it('excludes events beyond suggestLinkMinutes from select candidates', () => {
    // One event well within range, one beyond; should result in suggest not select
    const events = [makeEvent(30, 'evt-in'), makeEvent(200, 'evt-out')]
    const result = correlate(RECORDING_START, events)
    expect(result.recommendation.type).toBe('suggest')
  })
})
