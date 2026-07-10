import { describe, it, expect } from 'vitest'
import type { UnifiedRecording } from '@/types/unified-recording'
import {
  buildMoments,
  computePeopleToday,
  computeSourceMix,
  computeThreads,
  dayKey,
  formatDayLabel,
  groupMomentsByDay,
  recordingMomentSource,
  recordingToMoment,
  sortMomentsDesc
} from '../stream'
import type { Moment } from '../types'

const NOW = new Date('2026-07-09T15:00:00')

function localRec(overrides: Partial<UnifiedRecording> = {}): UnifiedRecording {
  return {
    id: 'r1',
    filename: 'meeting.wav',
    size: 1000,
    duration: 780, // 13 min
    dateRecorded: new Date('2026-07-09T09:30:00'),
    transcriptionStatus: 'complete',
    location: 'local-only',
    localPath: '/x/meeting.wav',
    syncStatus: 'synced',
    ...(overrides as object)
  } as UnifiedRecording
}

function deviceRec(overrides: Partial<UnifiedRecording> = {}): UnifiedRecording {
  return {
    id: 'd1',
    filename: 'REC001.wav',
    size: 2000,
    duration: 300,
    dateRecorded: new Date('2026-07-09T11:00:00'),
    transcriptionStatus: 'none',
    location: 'device-only',
    deviceFilename: 'REC001.wav',
    syncStatus: 'not-synced',
    ...(overrides as object)
  } as UnifiedRecording
}

function codeMoment(ts: string, id = 'c1'): Moment {
  return {
    id,
    source: 'code',
    timestamp: ts,
    title: 'Wire startPoll fix',
    badges: [],
    links: [],
    code: { repo: 'hidock-next', branch: 'feat/stream', commitCount: 3, openQuestion: 'gate the poll?' }
  }
}

describe('recordingMomentSource — file-type classification', () => {
  it('classifies audio, image and document sources by extension', () => {
    expect(recordingMomentSource(localRec({ filename: 'a.wav' }))).toBe('recording')
    expect(recordingMomentSource(localRec({ filename: 'shot.png' }))).toBe('image')
    expect(recordingMomentSource(localRec({ filename: 'spec.pdf' }))).toBe('document')
    expect(recordingMomentSource(localRec({ filename: 'notes.md' }))).toBe('document')
  })

  it('always treats device-backed rows as recordings regardless of extension', () => {
    expect(recordingMomentSource(deviceRec({ filename: 'weird.png' }))).toBe('recording')
  })
})

describe('recordingToMoment', () => {
  it('builds a recording moment with duration + action badges and a library open target', () => {
    const m = recordingToMoment(
      localRec({ transcript: { id: 't', actionItems: ['a', 'b'], keyPoints: ['k'] }, meetingSubject: 'Gateway sync', meetingId: 'm1' }),
      { participantsByMeeting: { m1: [{ id: 'p1', name: 'Ana' }] } }
    )
    expect(m.source).toBe('recording')
    expect(m.open).toEqual({ route: '/library', state: { selectedId: 'r1' } })
    const labels = m.badges.map((b) => b.label)
    expect(labels).toContain('13 min')
    expect(labels).toContain('2 actions')
    expect(labels).toContain('1 person')
    // meeting + person become links
    expect(m.links.some((l) => l.kind === 'meeting' && l.label === 'Gateway sync')).toBe(true)
    expect(m.links.some((l) => l.kind === 'person' && l.route === '/person/p1')).toBe(true)
    expect(m.thread?.label).toBe('Gateway sync')
  })

  it('marks device-only recordings still-on-device', () => {
    const m = recordingToMoment(deviceRec())
    expect(m.stillOnDevice).toBe(true)
    expect(m.badges.some((b) => b.tone === 'device')).toBe(true)
  })

  it('builds an image moment from an image file', () => {
    const m = recordingToMoment(localRec({ id: 'i1', filename: 'clip.png', transcriptionStatus: 'none' }))
    expect(m.source).toBe('image')
    if (m.source === 'image') expect(m.image.recordingId).toBe('i1')
  })

  it('builds a document moment with the right kind', () => {
    const m = recordingToMoment(localRec({ id: 'doc1', filename: 'design.pdf' }))
    expect(m.source).toBe('document')
    if (m.source === 'document') expect(m.document.kind).toBe('pdf')
  })
})

describe('buildMoments', () => {
  it('derives moments from recordings, merges producer extras, and drops personal', () => {
    const moments = buildMoments({
      recordings: [
        localRec({ id: 'r1', dateRecorded: new Date('2026-07-09T09:00:00') }),
        localRec({ id: 'r2', filename: 'x.pdf', dateRecorded: new Date('2026-07-09T10:00:00') }),
        localRec({ id: 'secret', personal: true })
      ],
      extra: [codeMoment('2026-07-09T12:00:00')]
    })
    const ids = moments.map((m) => m.id)
    expect(ids).toContain('rec:r1')
    expect(ids).toContain('rec:r2')
    expect(ids).toContain('c1') // producer moment present
    expect(ids).not.toContain('rec:secret') // personal filtered out
  })
})

describe('grouping + sorting', () => {
  it('groups moments by local day, newest day and newest moment first', () => {
    const moments = buildMoments({
      recordings: [
        localRec({ id: 'a', dateRecorded: new Date('2026-07-09T09:00:00') }),
        localRec({ id: 'b', dateRecorded: new Date('2026-07-09T14:00:00') }),
        localRec({ id: 'c', dateRecorded: new Date('2026-07-08T18:00:00') })
      ]
    })
    const days = groupMomentsByDay(moments, NOW)
    expect(days.map((d) => d.key)).toEqual(['2026-07-09', '2026-07-08'])
    expect(days[0].label).toBe('Today')
    expect(days[1].label).toBe('Yesterday')
    // within the first day, 14:00 sorts before 09:00
    expect(days[0].moments.map((m) => m.id)).toEqual(['rec:b', 'rec:a'])
    expect(days[0].capturedCount).toBe(2)
  })

  it('counts still-on-device moments per day', () => {
    const days = groupMomentsByDay(buildMoments({ recordings: [deviceRec(), localRec()] }), NOW)
    expect(days[0].onDeviceCount).toBe(1)
  })

  it('sortMomentsDesc is stable and newest-first', () => {
    const a = codeMoment('2026-07-09T09:00:00', 'a')
    const b = codeMoment('2026-07-09T10:00:00', 'b')
    expect(sortMomentsDesc([a, b]).map((m) => m.id)).toEqual(['b', 'a'])
  })

  it('formatDayLabel produces relative and absolute labels', () => {
    expect(formatDayLabel(new Date('2026-07-09T00:00:00'), NOW)).toBe('Today')
    expect(formatDayLabel(new Date('2026-07-08T00:00:00'), NOW)).toBe('Yesterday')
    expect(formatDayLabel(new Date('2026-07-06T00:00:00'), NOW)).toMatch(/July 6/)
    expect(dayKey(new Date('2026-07-09T23:59:00'))).toBe('2026-07-09')
  })
})

describe('right-rail rollups', () => {
  it('computeSourceMix counts per source over the 7-day window and excludes older', () => {
    const moments = buildMoments({
      recordings: [
        localRec({ id: 'a', filename: 'a.wav', dateRecorded: new Date('2026-07-09T09:00:00') }),
        localRec({ id: 'b', filename: 'b.pdf', dateRecorded: new Date('2026-07-08T09:00:00') }),
        localRec({ id: 'c', filename: 'c.png', dateRecorded: new Date('2026-07-05T09:00:00') }),
        localRec({ id: 'old', filename: 'old.wav', dateRecorded: new Date('2026-06-01T09:00:00') })
      ],
      extra: [codeMoment('2026-07-07T09:00:00')]
    })
    const mix = computeSourceMix(moments, NOW, 7)
    const bySource = Object.fromEntries(mix.map((e) => [e.source, e.count]))
    expect(bySource.recording).toBe(1) // 'a' (the June 'old' one is excluded)
    expect(bySource.document).toBe(1)
    expect(bySource.image).toBe(1)
    expect(bySource.code).toBe(1)
    expect(mix.every((e) => e.count > 0)).toBe(true)
  })

  it('computeThreads groups this-week moments by meeting/project thread', () => {
    const moments = buildMoments({
      recordings: [
        localRec({ id: 'a', meetingId: 'm1', meetingSubject: 'Gateway sync', dateRecorded: new Date('2026-07-09T09:00:00') }),
        localRec({ id: 'b', meetingId: 'm1', meetingSubject: 'Gateway sync', filename: 'b.pdf', dateRecorded: new Date('2026-07-08T09:00:00') }),
        localRec({ id: 'c', meetingId: 'm2', meetingSubject: 'Retro', dateRecorded: new Date('2026-07-08T09:00:00') })
      ]
    })
    const threads = computeThreads(moments, NOW)
    expect(threads[0]).toMatchObject({ label: 'Gateway sync', count: 2 })
    expect(threads[0].sources).toEqual(expect.arrayContaining(['recording', 'document']))
    expect(threads.map((t) => t.label)).toContain('Retro')
  })

  it('computePeopleToday aggregates people in today moments with action counts', () => {
    const moments = buildMoments({
      recordings: [
        localRec({ id: 'a', meetingId: 'm1', dateRecorded: new Date('2026-07-09T09:00:00'), transcript: { id: 't', actionItems: ['x', 'y'] } }),
        localRec({ id: 'b', meetingId: 'm1', dateRecorded: new Date('2026-07-09T10:00:00') }),
        localRec({ id: 'yday', meetingId: 'm1', dateRecorded: new Date('2026-07-08T10:00:00') })
      ],
      context: { participantsByMeeting: { m1: [{ id: 'p1', name: 'Ana' }] } }
    })
    const people = computePeopleToday(moments, NOW)
    expect(people).toHaveLength(1)
    expect(people[0]).toMatchObject({ id: 'p1', name: 'Ana', momentCount: 2, actionCount: 2 })
  })

  it('returns empty rollups for an empty stream', () => {
    expect(computeSourceMix([], NOW)).toEqual([])
    expect(computeThreads([], NOW)).toEqual([])
    expect(computePeopleToday([], NOW)).toEqual([])
    expect(groupMomentsByDay([], NOW)).toEqual([])
  })
})
