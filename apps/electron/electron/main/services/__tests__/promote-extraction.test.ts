// @vitest-environment node
/**
 * Tests for promoteExtractionToFirstClassTables (Fix B1).
 *
 * Fix B1 closes the gap between knowledge-graph extraction (which populates
 * graph_nodes) and the first-class `decisions` / `action_items` tables that the
 * hidock-mcp server reads. On a device-first library the migration path never
 * runs, so those tables stayed empty and the Empirical bridge saw nothing even
 * though extraction produced real decisions/actions.
 *
 * These exercise the promote helper against a REAL temp-file better-sqlite3 DB
 * (the app's own schema via initializeDatabase), asserting: decisions + actions
 * land keyed by knowledge_capture_id; owner → assignee; no capture ⇒ no-op;
 * only-provided fields are written (confidence/context/participants/due_date
 * left NULL — never fabricated); and content-dedup makes a second promote a
 * no-op (idempotent re-ingest / migration overlap).
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest'
import { tmpdir } from 'os'
import { join } from 'path'
import { existsSync, rmSync } from 'fs'
import { randomUUID } from 'crypto'

const paths = vi.hoisted(() => ({ db: '' }))
paths.db = join(tmpdir(), `hidock-promote-test-${process.pid}-${Date.now()}.db`)
vi.mock('../file-storage', () => ({ getDatabasePath: () => paths.db }))

import {
  initializeDatabase,
  closeDatabase,
  run,
  queryAll,
  queryOne,
  promoteExtractionToFirstClassTables,
} from '../database'

/** Insert a recording + its knowledge_capture (the FK target promotion needs). */
function seedRecordingWithCapture(opts: { personal?: number } = {}): { recordingId: string; captureId: string } {
  const recordingId = randomUUID()
  const captureId = randomUUID()
  const now = new Date().toISOString()
  run(
    `INSERT INTO recordings (id, filename, date_recorded, personal) VALUES (?, ?, ?, ?)`,
    [recordingId, `rec-${recordingId}.hda`, '2026-06-01T10:00:00.000Z', opts.personal ?? 0]
  )
  run(
    `INSERT INTO knowledge_captures (id, title, captured_at, created_at, updated_at, source_recording_id)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [captureId, 'Test capture', now, now, now, recordingId]
  )
  return { recordingId, captureId }
}

const extraction = {
  people: [],
  topics: [],
  projects: [],
  decisions: ['Ship EVA25 behind a feature flag', 'Adopt Postgres for the datastore'],
  action_items: [
    { text: 'Kelly to get data governance sign-off', owner: 'Kelly' },
    { text: 'Follow up on the Thor FTA split' }, // no owner
  ],
  risks: [],
  next_steps: [],
}

describe('promoteExtractionToFirstClassTables', () => {
  beforeAll(() => { initializeDatabase() })
  afterAll(() => {
    closeDatabase()
    for (const p of [paths.db, `${paths.db}-wal`, `${paths.db}-shm`]) if (existsSync(p)) rmSync(p)
  })
  beforeEach(() => {
    run('DELETE FROM action_items')
    run('DELETE FROM decisions')
    run('DELETE FROM knowledge_captures')
    run('DELETE FROM recordings')
  })

  it('promotes decisions and action_items keyed by the recording\'s capture', () => {
    const { recordingId, captureId } = seedRecordingWithCapture()

    const res = promoteExtractionToFirstClassTables(recordingId, extraction, {
      meetingDate: '2026-06-01T10:00:00.000Z',
      extractedFrom: 'transcript:t1',
    })
    expect(res.decisionsInserted).toBe(2)
    expect(res.actionItemsInserted).toBe(2)

    const decisions = queryAll<{ content: string; knowledge_capture_id: string; decided_at: string | null; extracted_from: string | null; confidence: number | null; context: string | null; participants: string | null }>(
      'SELECT * FROM decisions WHERE knowledge_capture_id = ? ORDER BY content', [captureId]
    )
    expect(decisions.map((d) => d.content).sort()).toEqual(
      ['Adopt Postgres for the datastore', 'Ship EVA25 behind a feature flag']
    )
    // decided_at + extracted_from carried; the thin fields are NULL, not invented.
    for (const d of decisions) {
      expect(d.knowledge_capture_id).toBe(captureId)
      expect(d.decided_at).toBe('2026-06-01T10:00:00.000Z')
      expect(d.extracted_from).toBe('transcript:t1')
      expect(d.confidence).toBeNull()
      expect(d.context).toBeNull()
      expect(d.participants).toBeNull()
    }

    const actions = queryAll<{ content: string; assignee: string | null; due_date: string | null; confidence: number | null; priority: string; status: string }>(
      'SELECT * FROM action_items WHERE knowledge_capture_id = ? ORDER BY content', [captureId]
    )
    const kelly = actions.find((a) => a.content.includes('data governance'))!
    const noOwner = actions.find((a) => a.content.includes('Thor FTA'))!
    expect(kelly.assignee).toBe('Kelly')     // owner → assignee
    expect(noOwner.assignee).toBeNull()       // missing owner → NULL, not invented
    for (const a of actions) {
      expect(a.due_date).toBeNull()           // never fabricated
      expect(a.confidence).toBeNull()
      expect(a.priority).toBe('medium')       // schema default
      expect(a.status).toBe('pending')        // schema default
    }
  })

  it('is a no-op when the recording has no knowledge_capture', () => {
    const recordingId = randomUUID()
    run(`INSERT INTO recordings (id, filename, date_recorded, personal) VALUES (?, ?, ?, 0)`,
      [recordingId, 'orphan.hda', '2026-06-01T10:00:00.000Z'])
    const res = promoteExtractionToFirstClassTables(recordingId, extraction)
    expect(res).toEqual({ decisionsInserted: 0, actionItemsInserted: 0, decisionsSkipped: 0, actionItemsSkipped: 0 })
    expect(queryOne<{ n: number }>('SELECT COUNT(*) n FROM decisions')!.n).toBe(0)
    expect(queryOne<{ n: number }>('SELECT COUNT(*) n FROM action_items')!.n).toBe(0)
  })

  it('dedups by normalized content so a second promote adds nothing', () => {
    const { recordingId, captureId } = seedRecordingWithCapture()
    promoteExtractionToFirstClassTables(recordingId, extraction)

    // Second pass with the SAME content (and a punctuation/case variant) inserts nothing.
    const res2 = promoteExtractionToFirstClassTables(recordingId, {
      ...extraction,
      decisions: ['ship eva25 behind a feature flag!', 'Adopt Postgres for the datastore'],
      action_items: [{ text: 'Kelly to get data governance sign-off', owner: 'Kelly' }],
    })
    expect(res2.decisionsInserted).toBe(0)
    expect(res2.actionItemsInserted).toBe(0)
    expect(res2.decisionsSkipped).toBe(2)
    expect(res2.actionItemsSkipped).toBe(1)

    expect(queryOne<{ n: number }>('SELECT COUNT(*) n FROM decisions WHERE knowledge_capture_id = ?', [captureId])!.n).toBe(2)
    expect(queryOne<{ n: number }>('SELECT COUNT(*) n FROM action_items WHERE knowledge_capture_id = ?', [captureId])!.n).toBe(2)
  })

  it('skips blank entries without inserting', () => {
    const { recordingId } = seedRecordingWithCapture()
    const res = promoteExtractionToFirstClassTables(recordingId, {
      decisions: ['', '   '],
      action_items: [{ text: '' }, { text: '  ', owner: 'X' }],
    })
    expect(res.decisionsInserted).toBe(0)
    expect(res.actionItemsInserted).toBe(0)
    expect(res.decisionsSkipped).toBe(2)
    expect(res.actionItemsSkipped).toBe(2)
  })
})
