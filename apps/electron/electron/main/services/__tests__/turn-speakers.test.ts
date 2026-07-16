// @vitest-environment node

/**
 * v37 — per-turn speaker overrides + speaker splits (backend).
 *
 * Exercises the real sql.js/better-sqlite3 engine (temp-file backed) so the
 * turn-override and split logic is tested against actual SQL semantics
 * (UNIQUE upserts, derived-label bookkeeping, cascade of a merge-back onto the
 * label binding), not mocks.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { tmpdir } from 'os'
import { join } from 'path'
import { existsSync, rmSync } from 'fs'

const dbPath = join(tmpdir(), `hidock-v37-turnspeakers-${process.pid}.sqlite`)

vi.mock('../file-storage', () => ({
  getDatabasePath: () => dbPath
}))

import {
  initializeDatabase,
  closeDatabase,
  run,
  queryOne,
  queryAll,
  assignSpeaker,
  getSpeakerMap,
  setTurnOverride,
  getTurnOverrides,
  clearTurnOverride,
  getSpeakerSplits,
  splitSpeakerFrom,
  mergeSpeakerSplit,
  assignSpeakerFromHere
} from '../database'

function seedRecording(id: string, meetingId: string | null = null): void {
  run('INSERT INTO recordings (id, filename, date_recorded, meeting_id) VALUES (?, ?, ?, ?)', [
    id,
    `${id}.wav`,
    '2026-01-01T10:00:00.000Z',
    meetingId
  ])
}

function seedContact(id: string, name: string): void {
  run(
    `INSERT INTO contacts (id, name, type, first_seen_at, last_seen_at, meeting_count)
     VALUES (?, ?, 'unknown', ?, ?, 0)`,
    [id, name, '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z']
  )
}

beforeEach(async () => {
  if (existsSync(dbPath)) rmSync(dbPath, { force: true })
  await initializeDatabase()
  seedRecording('rec1')
  seedContact('memo', 'Memo')
  seedContact('seba', 'Sebastian')
})

afterEach(() => {
  closeDatabase()
  if (existsSync(dbPath)) rmSync(dbPath, { force: true })
})

describe('migration v37 objects', () => {
  it('creates the turn_speaker_overrides table', () => {
    const info = queryAll<{ name: string }>(
      "SELECT name FROM sqlite_master WHERE type='table' AND name='turn_speaker_overrides'"
    )
    expect(info).toHaveLength(1)
  })

  it('creates the speaker_splits table', () => {
    const info = queryAll<{ name: string }>("SELECT name FROM sqlite_master WHERE type='table' AND name='speaker_splits'")
    expect(info).toHaveLength(1)
  })

  it('is at schema version 45', () => {
    // F18/round-28 bumped SCHEMA_VERSION 44 -> 45 (entity-level identity provenance).
    const row = queryOne<{ version: number }>('SELECT version FROM schema_version ORDER BY version DESC LIMIT 1')
    expect(row?.version).toBe(45)
  })
})

describe('per-turn overrides', () => {
  it('sets and reads a per-turn override joined to the contact name', () => {
    setTurnOverride('rec1', 3, { contactId: 'seba' })
    const rows = getTurnOverrides('rec1')
    expect(rows).toEqual([{ turn_index: 3, contact_id: 'seba', name: 'Sebastian' }])
  })

  it('upserts on (recording, turn_index) — a second set replaces the first', () => {
    setTurnOverride('rec1', 0, { contactId: 'memo' })
    setTurnOverride('rec1', 0, { contactId: 'seba' })
    const rows = getTurnOverrides('rec1')
    expect(rows).toHaveLength(1)
    expect(rows[0].contact_id).toBe('seba')
  })

  it('creates a contact from a newName when no id is given', () => {
    const contact = setTurnOverride('rec1', 1, { newName: 'Yaraví' })
    expect(contact.name).toBe('Yaraví')
    expect(queryOne('SELECT id FROM contacts WHERE id = ?', [contact.id])).toBeTruthy()
  })

  it('clearTurnOverride removes only that turn', () => {
    setTurnOverride('rec1', 0, { contactId: 'memo' })
    setTurnOverride('rec1', 1, { contactId: 'seba' })
    clearTurnOverride('rec1', 0)
    const rows = getTurnOverrides('rec1')
    expect(rows.map((r) => r.turn_index)).toEqual([1])
  })

  it('does NOT touch the label→contact map (a sibling turn keeps its default)', () => {
    // Label default binds every turn of "Speaker 1" to Memo.
    assignSpeaker('rec1', 'Speaker 1', { contactId: 'memo' })
    // Override only turn 5 to Sebastian.
    setTurnOverride('rec1', 5, { contactId: 'seba' })

    const map = getSpeakerMap('rec1')
    expect(map).toEqual([{ speaker_label: 'Speaker 1', contact_id: 'memo', name: 'Memo' }])
    expect(getTurnOverrides('rec1')).toEqual([{ turn_index: 5, contact_id: 'seba', name: 'Sebastian' }])
  })

  it('a user correction of a wrong auto-name PERSISTS and PROPAGATES to the reader', () => {
    // A label was auto-bound to the WRONG person (Memo). The Library reader lets
    // the user reassign it; the correction must survive a re-read and be what the
    // reader resolves for that label thereafter.
    assignSpeaker('rec1', 'Speaker 2', { contactId: 'memo' }) // wrong auto-name
    expect(getSpeakerMap('rec1').find((m) => m.speaker_label === 'Speaker 2')?.name).toBe('Memo')

    // User corrects the whole label to Sebastian (the "everywhere" scope).
    assignSpeaker('rec1', 'Speaker 2', { contactId: 'seba' })

    // Persists across a fresh read of the map, and propagates as the label's name.
    const reread = getSpeakerMap('rec1').find((m) => m.speaker_label === 'Speaker 2')
    expect(reread).toEqual({ speaker_label: 'Speaker 2', contact_id: 'seba', name: 'Sebastian' })
  })
})

describe('speaker splits', () => {
  it('forks the base label into a derived label from a turn onward', () => {
    const derived = splitSpeakerFrom('rec1', 'Speaker 1', 4)
    expect(derived).toBe('Speaker 1 · B')
    expect(getSpeakerSplits('rec1')).toEqual([
      { base_label: 'Speaker 1', from_turn_index: 4, derived_label: 'Speaker 1 · B' }
    ])
  })

  it('is idempotent per boundary (re-split returns the same derived label)', () => {
    const a = splitSpeakerFrom('rec1', 'Speaker 1', 4)
    const b = splitSpeakerFrom('rec1', 'Speaker 1', 4)
    expect(a).toBe(b)
    expect(getSpeakerSplits('rec1')).toHaveLength(1)
  })

  it('assigns distinct letters to multiple boundaries on the same base label', () => {
    const first = splitSpeakerFrom('rec1', 'Speaker 1', 4)
    const second = splitSpeakerFrom('rec1', 'Speaker 1', 9)
    expect(first).toBe('Speaker 1 · B')
    expect(second).toBe('Speaker 1 · C')
  })

  it('the derived label is independently assignable via the speaker map', () => {
    const derived = splitSpeakerFrom('rec1', 'Speaker 1', 4)
    assignSpeaker('rec1', 'Speaker 1', { contactId: 'memo' }) // early turns
    assignSpeaker('rec1', derived, { contactId: 'seba' }) // later turns

    const map = getSpeakerMap('rec1')
    const byLabel = Object.fromEntries(map.map((m) => [m.speaker_label, m.name]))
    expect(byLabel['Speaker 1']).toBe('Memo')
    expect(byLabel['Speaker 1 · B']).toBe('Sebastian')
  })

  it('merge-back removes the split AND drops the derived label binding', () => {
    const derived = splitSpeakerFrom('rec1', 'Speaker 1', 4)
    assignSpeaker('rec1', derived, { contactId: 'seba' })
    expect(getSpeakerMap('rec1').some((m) => m.speaker_label === derived)).toBe(true)

    mergeSpeakerSplit('rec1', 'Speaker 1', 4)
    expect(getSpeakerSplits('rec1')).toHaveLength(0)
    // The derived binding is gone, so those turns revert to the base default.
    expect(getSpeakerMap('rec1').some((m) => m.speaker_label === derived)).toBe(false)
  })

  it('merge-back after re-split reuses letter B (no collision)', () => {
    splitSpeakerFrom('rec1', 'Speaker 1', 4)
    mergeSpeakerSplit('rec1', 'Speaker 1', 4)
    const again = splitSpeakerFrom('rec1', 'Speaker 1', 4)
    expect(again).toBe('Speaker 1 · B')
  })
})

describe('assignSpeakerFromHere', () => {
  it('splits at the turn and binds the derived label to the contact in one step', () => {
    const { derivedLabel, contact } = assignSpeakerFromHere('rec1', 'Speaker 1', 6, { contactId: 'seba' })
    expect(derivedLabel).toBe('Speaker 1 · B')
    expect(contact.name).toBe('Sebastian')

    expect(getSpeakerSplits('rec1')).toEqual([
      { base_label: 'Speaker 1', from_turn_index: 6, derived_label: 'Speaker 1 · B' }
    ])
    const map = getSpeakerMap('rec1')
    expect(map.find((m) => m.speaker_label === 'Speaker 1 · B')?.name).toBe('Sebastian')
  })
})
