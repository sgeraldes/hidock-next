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

import { pickKeeperRecording } from '../org-reconciler'

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
