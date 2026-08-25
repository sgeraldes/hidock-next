import { describe, it, expect } from 'vitest'
import {
  parsePartName,
  computeMeetingCoverage,
  rankRecordingsByMeetingCoverage
} from '../recording-match-scoring'

// The live failure: one capture ran across the end of an internal talk and the
// whole of a candidate interview, and was split into two parts. Both parts
// overlap the calendar event, but only Part 2 contains the interview.
const MEETING = { startTime: '2026-08-18T17:45:00.000Z', endTime: '2026-08-18T18:45:00.000Z' }
const PART_1 = {
  id: '9b452039',
  filename: '2026Aug18-142505-Rec91 - Part 1.flac',
  dateRecorded: '2026-08-18T17:25:05.000Z',
  durationSeconds: 1474
}
const PART_2 = {
  id: '67e19f75',
  filename: '2026Aug18-142505-Rec91 - Part 2.flac',
  dateRecorded: '2026-08-18T17:49:39.300Z',
  durationSeconds: 3340.77
}

describe('parsePartName', () => {
  it('splits "<base> - Part N" and ignores the extension', () => {
    expect(parsePartName('2026Aug18-142505-Rec91 - Part 2.flac')).toEqual({
      baseName: '2026Aug18-142505-Rec91',
      partNumber: 2
    })
  })

  it('handles double-digit parts', () => {
    expect(parsePartName('capture - Part 11.wav')?.partNumber).toBe(11)
  })

  it('returns null for a normal recording', () => {
    expect(parsePartName('2026Aug20-133311-Rec08.hda')).toBeNull()
    expect(parsePartName('Part of the meeting.wav')).toBeNull()
    expect(parsePartName(null)).toBeNull()
    expect(parsePartName('')).toBeNull()
  })
})

describe('computeMeetingCoverage', () => {
  it('scores Part 1 as a start-edge clip only', () => {
    const c = computeMeetingCoverage(PART_1, MEETING)
    // Part 1 ends 17:49:39, so it covers only the first ~4.6 min of the hour.
    expect(c.overlapSeconds).toBe(279)
    expect(c.meetingCoverage).toBeCloseTo(0.078, 3)
    expect(c.partNumber).toBe(1)
  })

  it('scores Part 2 as holding almost the whole meeting', () => {
    const c = computeMeetingCoverage(PART_2, MEETING)
    expect(c.meetingCoverage).toBeGreaterThan(0.9)
    expect(c.recordingCoverage).toBeGreaterThan(0.9)
    expect(c.partNumber).toBe(2)
  })

  it('returns zero coverage for unusable input rather than throwing', () => {
    expect(computeMeetingCoverage({ ...PART_1, durationSeconds: 0 }, MEETING).meetingCoverage).toBe(0)
    expect(computeMeetingCoverage({ ...PART_1, dateRecorded: 'nope' }, MEETING).meetingCoverage).toBe(0)
    expect(
      computeMeetingCoverage(PART_1, { startTime: MEETING.endTime, endTime: MEETING.startTime }).meetingCoverage
    ).toBe(0)
  })

  it('still reports part identity when the windows do not overlap', () => {
    const c = computeMeetingCoverage(PART_1, {
      startTime: '2026-08-19T09:00:00.000Z',
      endTime: '2026-08-19T10:00:00.000Z'
    })
    expect(c.meetingCoverage).toBe(0)
    expect(c.partNumber).toBe(1)
    expect(c.partBaseName).toBe('2026Aug18-142505-Rec91')
  })
})

describe('rankRecordingsByMeetingCoverage', () => {
  it('puts the part that actually holds the meeting first', () => {
    // Chronological input order — exactly what the DB returned before the fix.
    const ranked = rankRecordingsByMeetingCoverage([PART_1, PART_2], MEETING)
    expect(ranked[0].id).toBe('67e19f75')
    expect(ranked[0].partNumber).toBe(2)
    expect(ranked[1].id).toBe('9b452039')
  })

  it('keeps both parts so a consumer can see the meeting spans them', () => {
    const ranked = rankRecordingsByMeetingCoverage([PART_1, PART_2], MEETING)
    expect(ranked).toHaveLength(2)
    expect(ranked.every((r) => r.meetingCoverage > 0)).toBe(true)
  })

  it('falls back to chronological order for equal coverage', () => {
    const a = { id: 'a', filename: 'a.wav', dateRecorded: MEETING.startTime, durationSeconds: 3600 }
    const b = { id: 'b', filename: 'b.wav', dateRecorded: MEETING.startTime, durationSeconds: 3600 }
    expect(rankRecordingsByMeetingCoverage([b, a], MEETING).map((r) => r.id)).toEqual(['b', 'a'])
  })

  it('handles an empty list', () => {
    expect(rankRecordingsByMeetingCoverage([], MEETING)).toEqual([])
  })
})
