/**
 * Org Reconciler — keeper-selection tests
 *
 * pickKeeperRecording is the pure decision rule behind mergeDuplicateRecordings:
 * given a group of duplicate recording rows for the same audio, which one do we
 * keep? These tests pin the preference order (transcript > .wav > file_path >
 * newest) without needing a database.
 */

import { describe, it, expect, vi } from 'vitest'

// pickKeeperRecording is pure, but importing org-reconciler pulls in ./database,
// which reaches for electron's app.getPath at load. Stub the DB module so the
// import graph stays offline.
vi.mock('../database', () => ({
  queryAll: vi.fn(() => []),
  queryOne: vi.fn(() => undefined),
  run: vi.fn(),
  runInTransaction: vi.fn((fn: () => unknown) => fn())
}))

import { pickKeeperRecording, selectAutoLinkMeeting, MIN_AUTO_LINK_FIT, type AutoLinkWindow } from '../org-reconciler'

describe('pickKeeperRecording', () => {
  it('keeps the row with a transcript even over a .wav without one', () => {
    const keeper = pickKeeperRecording([
      { id: 'hda', filename: 'Rec89.hda', hasTranscript: true, file_path: null },
      { id: 'wav', filename: 'Rec89.wav', hasTranscript: false, file_path: '/x/Rec89.wav' }
    ])
    expect(keeper.id).toBe('hda')
  })

  it('prefers the .wav row when neither has a transcript', () => {
    const keeper = pickKeeperRecording([
      { id: 'hda', filename: 'Rec89.hda', hasTranscript: false, file_path: '/x/Rec89.hda' },
      { id: 'wav', filename: 'Rec89.wav', hasTranscript: false, file_path: '/x/Rec89.wav' }
    ])
    expect(keeper.id).toBe('wav')
  })

  it('prefers a row with file_path set when transcript and extension tie', () => {
    const keeper = pickKeeperRecording([
      { id: 'nopath', filename: 'Rec89.wav', hasTranscript: false, file_path: null },
      { id: 'path', filename: 'Rec89.wav', hasTranscript: false, file_path: '/x/Rec89.wav' }
    ])
    expect(keeper.id).toBe('path')
  })

  it('falls back to the most recent created_at', () => {
    const keeper = pickKeeperRecording([
      { id: 'old', filename: 'Rec89.wav', hasTranscript: false, file_path: '/x/a.wav', created_at: '2026-01-01T00:00:00Z' },
      { id: 'new', filename: 'Rec89.wav', hasTranscript: false, file_path: '/x/b.wav', created_at: '2026-06-01T00:00:00Z' }
    ])
    expect(keeper.id).toBe('new')
  })

  it('does not mutate the input array order', () => {
    const rows = [
      { id: 'wav', filename: 'Rec89.wav', hasTranscript: false, file_path: '/x/Rec89.wav' },
      { id: 'hda', filename: 'Rec89.hda', hasTranscript: true, file_path: null }
    ]
    pickKeeperRecording(rows)
    expect(rows.map((r) => r.id)).toEqual(['wav', 'hda'])
  })
})

/**
 * selectAutoLinkMeeting is the pure auto-link policy: fit-based, bridge-excluding.
 * These pin the anti-over-attribution rules without a database.
 */
describe('selectAutoLinkMeeting', () => {
  const ms = (iso: string) => Date.parse(iso)
  // A 20-min recording, 2:00–2:20 PM UTC.
  const recStart = ms('2026-06-04T14:00:00Z')
  const recEnd = ms('2026-06-04T14:20:00Z')

  const bridgeAllDay: AutoLinkWindow = {
    id: 'warroom',
    start: ms('2026-06-04T10:00:00Z'),
    end: ms('2026-06-04T19:00:00Z'),
    isAllDay: true
  }
  const bridgeLong: AutoLinkWindow = {
    id: 'offsite',
    start: ms('2026-06-04T09:00:00Z'),
    end: ms('2026-06-04T15:00:00Z') // 6h, no flag — still a bridge by duration
  }
  const tightParallel: AutoLinkWindow = {
    id: 'apigw',
    start: ms('2026-06-04T14:00:00Z'),
    end: ms('2026-06-04T14:25:00Z')
  }

  it('declines to auto-link when the only overlap is an all-day bridge', () => {
    const d = selectAutoLinkMeeting(recStart, recEnd, [bridgeAllDay])
    expect(d.id).toBeNull()
    expect(d).toMatchObject({ id: null, declinedBridge: true })
  })

  it('declines to auto-link to a plain ≥4h bridge as well', () => {
    const d = selectAutoLinkMeeting(recStart, recEnd, [bridgeLong])
    expect(d.id).toBeNull()
    expect(d).toMatchObject({ id: null, declinedBridge: true })
  })

  it('picks the tightly-fitting parallel meeting over a containing all-day bridge', () => {
    const d = selectAutoLinkMeeting(recStart, recEnd, [bridgeAllDay, tightParallel])
    expect(d.id).toBe('apigw')
  })

  it('prefers the higher-fit meeting among two non-bridge overlaps', () => {
    const loose: AutoLinkWindow = {
      id: 'loose',
      start: ms('2026-06-04T14:00:00Z'),
      end: ms('2026-06-04T15:30:00Z') // 90-min, non-bridge
    }
    const d = selectAutoLinkMeeting(recStart, recEnd, [loose, tightParallel])
    expect(d.id).toBe('apigw') // union fit 0.8 beats loose's ~0.22
  })

  it('declines a sliver overlap that does not clear the minimum fit', () => {
    // Recording overlaps only the tail of a 3h meeting → fit well under the floor.
    const tail: AutoLinkWindow = {
      id: 'tail',
      start: ms('2026-06-04T16:00:00Z'),
      end: ms('2026-06-04T17:00:00Z')
    }
    const rStart = ms('2026-06-04T16:50:00Z')
    const rEnd = ms('2026-06-04T18:50:00Z') // 2h recording, only 10 min inside
    const d = selectAutoLinkMeeting(rStart, rEnd, [tail])
    expect(d.id).toBeNull()
    expect(d).toMatchObject({ declinedBridge: false })
  })

  it('exposes a sane minimum-fit constant', () => {
    expect(MIN_AUTO_LINK_FIT).toBeGreaterThan(0)
    expect(MIN_AUTO_LINK_FIT).toBeLessThan(1)
  })
})
