// @vitest-environment node

/**
 * ADV25-3 (round-26) — identity:acceptSuggestion closes the accept-time TOCTOU.
 * getSuggestions revalidates on READ, but a merge card can be accepted (clicked)
 * after its supporting recording became excluded between load and click. The
 * handler re-runs the SAME revalidation immediately before the merge (no await
 * gap) and REFUSES (no merge, SUGGESTION_STALE) unless the suggestion still clears
 * the surfacing threshold. REAL handler, REAL DB.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { tmpdir } from 'os'
import { join } from 'path'
import { existsSync, rmSync } from 'fs'
import { randomUUID } from 'crypto'

const dbPath = join(tmpdir(), `hidock-adv25-accept-toctou-ipc-${process.pid}.sqlite`)
vi.mock('../../services/file-storage', () => ({ getDatabasePath: () => dbPath }))

const handlers = new Map<string, (...args: any[]) => any>()
vi.mock('electron', () => ({
  ipcMain: { handle: (channel: string, fn: (...args: any[]) => any) => { handlers.set(channel, fn) } }
}))

import { initializeDatabase, closeDatabase, run, queryOne } from '../../services/database'
import { registerIdentityHandlers } from '../identity-handlers'
import { normalizeName } from '../../services/entity-normalize'

function invoke(channel: string, ...args: any[]): Promise<any> {
  const fn = handlers.get(channel)
  if (!fn) throw new Error(`handler not registered: ${channel}`)
  return Promise.resolve(fn({} as any, ...args))
}

function createGraphTables(): void {
  run(`CREATE TABLE IF NOT EXISTS graph_nodes (
    id TEXT PRIMARY KEY, type TEXT, label TEXT, norm_key TEXT, props TEXT, created_at TEXT, updated_at TEXT)`)
  run(`CREATE TABLE IF NOT EXISTS graph_edges (
    id TEXT PRIMARY KEY, source_id TEXT, target_id TEXT, type TEXT, props TEXT, weight REAL, created_at TEXT)`)
  run(`CREATE TABLE IF NOT EXISTS graph_edge_sources (edge_id TEXT, recording_id TEXT, transcript_id TEXT)`)
}
function contact(id: string, name: string): void {
  run(
    `INSERT INTO contacts (id, name, type, first_seen_at, last_seen_at, meeting_count, created_at)
     VALUES (?, ?, 'team', '2026-01-01', '2026-01-01', 0, '2026-01-01T00:00:00Z')`,
    [id, name]
  )
}
function node(id: string, type: string, label: string, normKey: string): void {
  run(`INSERT INTO graph_nodes (id, type, label, norm_key, created_at, updated_at)
       VALUES (?, ?, ?, ?, '2026-01-01', '2026-01-01')`, [id, type, label, normKey])
}
function edge(id: string, source: string, target: string, type: string): void {
  run(`INSERT INTO graph_edges (id, source_id, target_id, type, created_at) VALUES (?, ?, ?, ?, '2026-01-01')`, [id, source, target, type])
}

/**
 * A graph-LOAD-BEARING pending suggestion pairing Edu (loser) into Eduardo
 * (keeper): composite 0.55 with graph 0.15, sharedTopics ['Falcon'] whose ABOUT
 * edge is sourced by rec-ok. While rec-ok is eligible the topic survives
 * (recomputed composite 0.60 ≥ 0.50 ⇒ acceptable); excluding rec-ok suppresses the
 * topic (0.40 < 0.50 ⇒ stale).
 */
function seed(): string {
  createGraphTables()
  contact('c-edu', 'Edu')
  contact('c-eduardo', 'Eduardo')
  node('n-edu', 'person', 'Edu', normalizeName('Edu'))
  node('n-eduardo', 'person', 'Eduardo', normalizeName('Eduardo'))
  node('n-mg', 'meeting', 'Kickoff', 'kickoff')
  node('n-falcon', 'topic', 'Falcon', 'falcon')
  edge('att-edu', 'n-edu', 'n-mg', 'ATTENDED')
  edge('att-eduardo', 'n-eduardo', 'n-mg', 'ATTENDED')
  edge('ab-falcon', 'n-mg', 'n-falcon', 'ABOUT')
  run('INSERT INTO recordings (id, filename, date_recorded) VALUES (?, ?, ?)', ['rec-ok', 'rec-ok.hda', '2026-06-01'])
  run('INSERT INTO graph_edge_sources (edge_id, recording_id) VALUES (?, ?)', ['ab-falcon', 'rec-ok'])

  const id = randomUUID()
  const ev = {
    signals: { name: 0.65, email: 0, role: 0, graph: 0.15 },
    composite: 0.55,
    sharedTopics: ['Falcon'],
    sharedMeetings: 0,
    keeperId: 'c-eduardo', keeperName: 'Eduardo', loserId: 'c-edu', loserName: 'Edu', emailMatch: 'none'
  }
  run(
    `INSERT INTO identity_suggestions (id, kind, candidate_name, target_id, confidence, evidence, status, created_at)
     VALUES (?, 'person', 'Edu', 'c-eduardo', 0.55, ?, 'pending', '2026-01-01T00:00:00Z')`,
    [id, JSON.stringify(ev)]
  )
  return id
}

function excludeRecOk(): void {
  run(
    `INSERT INTO knowledge_captures (id, title, captured_at, source_recording_id, quality_rating)
     VALUES ('cap-rec-ok', 'Cap', '2026-06-01', 'rec-ok', 'garbage')`
  )
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

describe('ADV25-3 — identity:acceptSuggestion accept-time revalidation', () => {
  it('accepts a still-eligible suggestion (merge performed)', async () => {
    const id = seed()
    const res = await invoke('identity:acceptSuggestion', id)
    expect(res.success).toBe(true)
    // Merge happened: the suggestion is accepted and the loser was folded away.
    expect(queryOne('SELECT status FROM identity_suggestions WHERE id = ?', [id])).toMatchObject({ status: 'accepted' })
    expect(queryOne('SELECT id FROM contacts WHERE id = ?', ['c-edu'])).toBeUndefined()
  })

  it('REFUSES a suggestion whose supporting recording was excluded before the click (no merge)', async () => {
    const id = seed()
    excludeRecOk() // rec-ok value-excluded ⇒ Falcon topic suppressed ⇒ stale
    const res = await invoke('identity:acceptSuggestion', id)
    expect(res.success).toBe(false)
    expect(res.error.code).toBe('SUGGESTION_STALE')
    // No merge: suggestion still pending, loser still present.
    expect(queryOne('SELECT status FROM identity_suggestions WHERE id = ?', [id])).toMatchObject({ status: 'pending' })
    expect(queryOne('SELECT id FROM contacts WHERE id = ?', ['c-edu'])).toMatchObject({ id: 'c-edu' })
  })

  it('returns NOT_FOUND for an unknown suggestion id', async () => {
    const res = await invoke('identity:acceptSuggestion', 'no-such-id')
    expect(res.success).toBe(false)
    expect(res.error.code).toBe('NOT_FOUND')
  })
})
