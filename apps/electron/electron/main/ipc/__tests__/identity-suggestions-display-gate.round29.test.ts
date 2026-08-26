// @vitest-environment node

/**
 * Round-29 — R28-RES-2 discovery-pairs NON-OWNER DISPLAY gate.
 *
 * identity:getSuggestions feeds the People/Projects merge queue AND the Today
 * identity-suggestion teaser (a DISPLAY-tier, non-owner surface). A name/email-only
 * discovery straggler can pair two ENTITIES that are BOTH excluded-only (transcript-
 * created contacts whose sole source recording is excluded) — already hidden from the
 * People LIST by filterVisibleEntityIds. filterSuggestionsForNonOwnerDisplay (wired
 * into the identity:getSuggestions handler) drops any suggestion whose keeper OR loser
 * entity is not visible, so an excluded-only entity/pair never surfaces its name.
 *
 * The ACCEPT path stays gated on EVIDENCE (recording provenance), NOT entity
 * visibility — verified elsewhere (identity-handlers.accept-toctou) and unaffected.
 *
 * REAL handler, REAL better-sqlite3 temp DB.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { tmpdir } from 'os'
import { join } from 'path'
import { existsSync, rmSync } from 'fs'
import { randomUUID } from 'crypto'

const dbPath = join(tmpdir(), `hidock-r29-suggestion-display-${process.pid}.sqlite`)
vi.mock('../../services/file-storage', () => ({ getDatabasePath: () => dbPath }))

const handlers = new Map<string, (...args: any[]) => any>()
vi.mock('electron', () => ({
  ipcMain: { handle: (channel: string, fn: (...args: any[]) => any) => { handlers.set(channel, fn) } }
}))

import { initializeDatabase, closeDatabase, run } from '../../services/database'
import { registerIdentityHandlers } from '../identity-handlers'

function invoke(channel: string, ...args: any[]): Promise<any> {
  const fn = handlers.get(channel)
  if (!fn) throw new Error(`handler not registered: ${channel}`)
  return Promise.resolve(fn({} as any, ...args))
}

function contact(id: string, name: string, source: string | null, recId: string | null = null): void {
  run(
    `INSERT INTO contacts (id, name, type, first_seen_at, last_seen_at, meeting_count, source, source_recording_id)
     VALUES (?, ?, 'unknown', '2026-01-01', '2026-01-01', 0, ?, ?)`,
    [id, name, source, recId]
  )
}
function recording(id: string, opts: { personal?: boolean } = {}): void {
  run(
    `INSERT INTO recordings (id, filename, date_recorded, personal) VALUES (?, ?, '2026-01-02T10:00:00Z', ?)`,
    [id, `${id}.hda`, opts.personal ? 1 : 0]
  )
}
/** A name/email-only discovery straggler (graph=0, no topics) pairing loser→keeper. */
function insertNameOnlySuggestion(keeperId: string, keeperName: string, loserId: string, loserName: string): string {
  const id = randomUUID()
  const ev = {
    signals: { name: 0.9, email: 0.35, role: 0, graph: 0 },
    composite: 0.96,
    sharedTopics: [],
    sharedMeetings: 0,
    keeperId, keeperName, loserId, loserName,
    emailMatch: 'exact'
  }
  run(
    `INSERT INTO identity_suggestions (id, kind, candidate_name, target_id, confidence, evidence, status, created_at)
     VALUES (?, 'person', ?, ?, 0.96, ?, 'pending', '2026-01-01T00:00:00Z')`,
    [id, loserName, keeperId, JSON.stringify(ev)]
  )
  return id
}

beforeEach(async () => {
  handlers.clear()
  if (existsSync(dbPath)) rmSync(dbPath, { force: true })
  await initializeDatabase()
  registerIdentityHandlers()
})
afterEach(() => {
  closeDatabase()
  if (existsSync(dbPath)) rmSync(dbPath, { force: true })
})

describe('R28-RES-2 — discovery-pairs non-owner display gate (identity:getSuggestions)', () => {
  it('suppresses a suggestion pairing two EXCLUDED-ONLY entities', async () => {
    recording('r-bad', { personal: true })
    contact('c-ghost1', 'Sergio', 'transcript', 'r-bad')
    contact('c-ghost2', 'Sergio Ramirez', 'transcript', 'r-bad')
    insertNameOnlySuggestion('c-ghost1', 'Sergio', 'c-ghost2', 'Sergio Ramirez')

    const res = await invoke('identity:getSuggestions', 'pending')
    expect(res.success).toBe(true)
    expect(res.data).toHaveLength(0)
  })

  it('suppresses a suggestion where only the LOSER entity is excluded-only', async () => {
    recording('r-bad', { personal: true })
    contact('c-known', 'Known Ken', 'calendar')
    contact('c-ghost', 'Ken', 'transcript', 'r-bad')
    insertNameOnlySuggestion('c-known', 'Known Ken', 'c-ghost', 'Ken')

    const res = await invoke('identity:getSuggestions', 'pending')
    expect(res.data).toHaveLength(0)
  })

  it('surfaces a suggestion pairing two VISIBLE (calendar) entities', async () => {
    contact('c-cal1', 'Alice', 'calendar')
    contact('c-cal2', 'Alicia', 'calendar')
    const id = insertNameOnlySuggestion('c-cal1', 'Alice', 'c-cal2', 'Alicia')

    const res = await invoke('identity:getSuggestions', 'pending')
    expect(res.data.map((s: any) => s.id)).toContain(id)
  })
})
