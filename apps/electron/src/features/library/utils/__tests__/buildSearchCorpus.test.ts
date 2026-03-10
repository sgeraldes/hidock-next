import { describe, it, expect } from 'vitest'
import { buildDateAliases, buildSearchCorpus } from '../buildSearchCorpus'
import type { UnifiedRecording } from '@/types/unified-recording'
import type { Meeting } from '@/types'

function makeRec(overrides: Partial<UnifiedRecording> = {}): UnifiedRecording {
  return {
    id: 'rec-1',
    filename: '2025Sep25-213132-Rec53.wav',
    size: 1024,
    duration: 3600,
    dateRecorded: new Date('2025-09-25T21:31:32'),
    transcriptionStatus: 'none',
    location: 'local-only',
    localPath: '/recordings/2025Sep25-213132-Rec53.wav',
    syncStatus: 'synced',
    ...overrides,
  } as UnifiedRecording
}

function makeMeeting(overrides: Partial<Meeting> = {}): Meeting {
  return {
    id: 'meet-1',
    subject: 'Sofia - Ejercicio Connect',
    start_time: '2025-09-25T10:00:00Z',
    end_time: '2025-09-25T10:30:00Z',
    attendees: JSON.stringify([
      { name: 'Sofia Rodriguez', email: 'sofia@example.com', status: 'ACCEPTED' },
      { name: 'Santiago Gomez', email: 'santi@example.com', status: 'ACCEPTED' },
    ]),
    ...overrides,
  } as Meeting
}

describe('buildDateAliases', () => {
  const date = new Date('2025-09-25T21:31:32')
  it('includes sep25', ()        => expect(buildDateAliases(date)).toContain('sep25'))
  it('includes sep 25', ()       => expect(buildDateAliases(date)).toContain('sep 25'))
  it('includes september 25', () => expect(buildDateAliases(date)).toContain('september 25'))
  it('includes sep 2025', ()     => expect(buildDateAliases(date)).toContain('sep 2025'))
  it('includes 09/25', ()        => expect(buildDateAliases(date)).toContain('09/25'))
  it('includes 2025-09-25', ()   => expect(buildDateAliases(date)).toContain('2025-09-25'))
  it('returns empty for invalid date', () => expect(buildDateAliases(new Date('bad'))).toBe(''))
})

describe('buildSearchCorpus', () => {
  it('includes filename',              () => expect(buildSearchCorpus(makeRec())).toContain('2025sep25-213132-rec53.wav'))
  it('includes recording title',       () => expect(buildSearchCorpus(makeRec({ title: 'My Title' }))).toContain('my title'))
  it('includes meeting subject',       () => expect(buildSearchCorpus(makeRec(), makeMeeting())).toContain('sofia - ejercicio connect'))
  it('includes "sofia" token',         () => expect(buildSearchCorpus(makeRec(), makeMeeting())).toContain('sofia'))
  it('includes "connect" token',       () => expect(buildSearchCorpus(makeRec(), makeMeeting())).toContain('connect'))
  it('includes attendee names',        () => { const c = buildSearchCorpus(makeRec(), makeMeeting()); expect(c).toContain('sofia rodriguez'); expect(c).toContain('santiago gomez') })
  it('includes attendee email',        () => expect(buildSearchCorpus(makeRec(), makeMeeting())).toContain('sofia@example.com'))
  it('includes date alias sep25',      () => expect(buildSearchCorpus(makeRec())).toContain('sep25'))
  it('includes date alias sep 25',     () => expect(buildSearchCorpus(makeRec())).toContain('sep 25'))
  it('includes summary',               () => expect(buildSearchCorpus(makeRec({ summary: 'Project roadmap' }))).toContain('project roadmap'))
  it('includes category',              () => expect(buildSearchCorpus(makeRec({ category: 'brainstorm' }))).toContain('brainstorm'))
  it('is all lowercase',               () => { const c = buildSearchCorpus(makeRec(), makeMeeting()); expect(c).toBe(c.toLowerCase()) })
  it('does not crash without meeting', () => expect(() => buildSearchCorpus(makeRec())).not.toThrow())
  it('does not crash with null attendees', () => expect(() => buildSearchCorpus(makeRec(), makeMeeting({ attendees: null }))).not.toThrow())
})
