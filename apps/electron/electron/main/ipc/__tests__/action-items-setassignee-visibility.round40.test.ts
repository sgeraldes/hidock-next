// @vitest-environment node

/**
 * ADV38-1 (round-40) — actionItems:setAssignee must NOT (a) read/update/return the
 * content of an action item whose SOURCE CAPTURE (and thus its source recording) is
 * excluded, nor (b) persist a SUPPRESSED contact as the assignee. Root cause: the
 * pre-fix handler validated only raw row existence (+ raw getContactById), so a
 * renderer holding a STALE action-item id could mark its source recording
 * personal / soft-delete it / rate it low-value, then call setAssignee and receive
 * the FULL excluded row (content + assignee) and/or persist a hidden contact.
 *
 * FIX: before clearing or assigning — in ONE synchronous transaction —
 *   • the item's knowledge_capture_id must pass filterEligibleCaptureIds
 *     (inherits the source recording's personal/deleted/value/purge exclusion), and
 *   • a non-null contactId must pass filterVisibleEntityIds('contact').
 * Fail-closed on any lookup error ⇒ refuse, return NOTHING sensitive.
 *
 * REAL temp DB, real database.ts (better-sqlite3), real handler end to end.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { tmpdir } from 'os'
import { join } from 'path'
import { existsSync, rmSync } from 'fs'
import { randomUUID } from 'crypto'

const dbPath = join(tmpdir(), `hidock-r40-setassignee-${process.pid}.sqlite`)
vi.mock('../../services/file-storage', () => ({ getDatabasePath: () => dbPath }))

const handlers = new Map<string, (...args: any[]) => any>()
vi.mock('electron', () => ({
  ipcMain: { handle: (channel: string, fn: (...args: any[]) => any) => { handlers.set(channel, fn) } }
}))

import { initializeDatabase, closeDatabase, run, queryOne } from '../../services/database'
import { registerActionItemsHandlers } from '../action-items-handlers'

function invoke(channel: string, ...args: any[]): Promise<any> {
  const fn = handlers.get(channel)
  if (!fn) throw new Error(`handler not registered: ${channel}`)
  return Promise.resolve(fn({} as any, ...args))
}

// --- seed helpers -----------------------------------------------------------

function seedRecording(id: string, opts: { personal?: boolean; deleted?: boolean } = {}): void {
  run(
    `INSERT INTO recordings (id, filename, date_recorded, personal, deleted_at) VALUES (?, ?, '2026-01-02T10:00:00Z', ?, ?)`,
    [id, `${id}.hda`, opts.personal ? 1 : 0, opts.deleted ? '2026-07-01T00:00:00Z' : null]
  )
}
function seedCapture(
  id: string,
  opts: { recId?: string | null; quality?: string; deleted?: boolean } = {}
): void {
  run(
    `INSERT INTO knowledge_captures (id, title, captured_at, source_recording_id, quality_rating, deleted_at)
     VALUES (?, 'Cap', '2026-06-01', ?, ?, ?)`,
    [id, opts.recId ?? null, opts.quality ?? 'unrated', opts.deleted ? '2026-07-01T00:00:00Z' : null]
  )
}
function seedActionItem(id: string, captureId: string): void {
  run(
    `INSERT INTO action_items (id, knowledge_capture_id, content, assignee, priority, status)
     VALUES (?, ?, 'SECRET action item content', 'Raw Name', 'medium', 'pending')`,
    [id, captureId]
  )
}
function seedContact(id: string, name: string, source: string | null, recId: string | null = null): void {
  run(
    `INSERT INTO contacts (id, name, type, first_seen_at, last_seen_at, meeting_count, source, source_recording_id, created_at)
     VALUES (?, ?, 'unknown', '2026-01-01', '2026-01-01', 0, ?, ?, '2026-01-01T00:00:00Z')`,
    [id, name, source, recId]
  )
}

beforeEach(async () => {
  handlers.clear()
  if (existsSync(dbPath)) rmSync(dbPath, { force: true })
  await initializeDatabase()
  registerActionItemsHandlers()
})
afterEach(() => {
  closeDatabase()
  if (existsSync(dbPath)) rmSync(dbPath, { force: true })
})

// ---------------------------------------------------------------------------
// (a) Excluded SOURCE ⇒ refused, no update, no content returned
// ---------------------------------------------------------------------------

describe('actionItems:setAssignee — source-capture eligibility gate', () => {
  async function expectRefusedNoUpdate(
    setup: () => { itemId: string },
    expectCode = 'ACTIONABLE_INELIGIBLE'
  ): Promise<void> {
    const cid = randomUUID()
    seedContact(cid, 'Visible Person', 'user') // a valid, visible contact
    const { itemId } = setup()
    const res = await invoke('actionItems:setAssignee', { actionItemId: itemId, contactId: cid })
    expect(res.success).toBe(false)
    expect(res.error.code).toBe(expectCode)
    // No payload / no content leaked.
    expect(res.data).toBeUndefined()
    expect(JSON.stringify(res)).not.toContain('SECRET action item content')
    // The binding was NOT persisted.
    const row = queryOne<{ assignee_contact_id: string | null }>(
      'SELECT assignee_contact_id FROM action_items WHERE id = ?',
      [itemId]
    )
    expect(row?.assignee_contact_id ?? null).toBeNull()
  }

  it('source recording PERSONAL ⇒ refused, no update, no content', () =>
    expectRefusedNoUpdate(() => {
      const rec = randomUUID(), cap = randomUUID(), item = randomUUID()
      seedRecording(rec, { personal: true })
      seedCapture(cap, { recId: rec })
      seedActionItem(item, cap)
      return { itemId: item }
    }))

  it('source recording SOFT-DELETED ⇒ refused', () =>
    expectRefusedNoUpdate(() => {
      const rec = randomUUID(), cap = randomUUID(), item = randomUUID()
      seedRecording(rec, { deleted: true })
      seedCapture(cap, { recId: rec })
      seedActionItem(item, cap)
      return { itemId: item }
    }))

  it('recording-derived capture VALUE-EXCLUDED via recording exclusion ⇒ refused', () =>
    expectRefusedNoUpdate(() => {
      // A recording-derived capture inherits the recording's exclusion; use a
      // deleted recording to force ineligibility of the derived capture.
      const rec = randomUUID(), cap = randomUUID(), item = randomUUID()
      seedRecording(rec, { deleted: true })
      seedCapture(cap, { recId: rec, quality: 'valuable' })
      seedActionItem(item, cap)
      return { itemId: item }
    }))

  it('STANDALONE capture rated low-value (value-excluded) ⇒ refused', () =>
    expectRefusedNoUpdate(() => {
      const cap = randomUUID(), item = randomUUID()
      seedCapture(cap, { recId: null, quality: 'low-value' }) // standalone, value-excluded
      seedActionItem(item, cap)
      return { itemId: item }
    }))

  it('capture SOFT-DELETED ⇒ refused', () =>
    expectRefusedNoUpdate(() => {
      const cap = randomUUID(), item = randomUUID()
      seedCapture(cap, { recId: null, quality: 'valuable', deleted: true })
      seedActionItem(item, cap)
      return { itemId: item }
    }))

  it('capture HARD-PURGED (orphan capture id) ⇒ refused (not-found)', async () => {
    // action_items.knowledge_capture_id references a capture that does not exist.
    // (Simulate via a raw insert bypassing the FK by disabling FK enforcement is
    // unnecessary — instead point at a missing capture through an existing item
    // whose capture row we delete.)
    const cap = randomUUID(), item = randomUUID(), cid = randomUUID()
    seedContact(cid, 'Visible', 'user')
    seedCapture(cap, { recId: null, quality: 'valuable' })
    seedActionItem(item, cap)
    // Remove the capture row directly (leaves an orphaned action item id).
    run('DELETE FROM knowledge_captures WHERE id = ?', [cap])
    const res = await invoke('actionItems:setAssignee', { actionItemId: item, contactId: cid })
    expect(res.success).toBe(false)
    // Item may cascade-delete (NOT_FOUND) or survive as orphan (ACTIONABLE_INELIGIBLE);
    // either way it is refused and nothing is returned.
    expect(['NOT_FOUND', 'ACTIONABLE_INELIGIBLE']).toContain(res.error.code)
    expect(JSON.stringify(res)).not.toContain('SECRET action item content')
  })

  it('non-existent action item ⇒ NOT_FOUND', async () => {
    const res = await invoke('actionItems:setAssignee', { actionItemId: randomUUID(), contactId: null })
    expect(res.success).toBe(false)
    expect(res.error.code).toBe('NOT_FOUND')
  })
})

// ---------------------------------------------------------------------------
// (b) Suppressed contact ⇒ refused
// ---------------------------------------------------------------------------

describe('actionItems:setAssignee — contact visibility gate', () => {
  it('SUPPRESSED contactId (transcript entity backed by excluded recording) ⇒ CONTACT_INELIGIBLE, not persisted', async () => {
    const rec = randomUUID(), cap = randomUUID(), item = randomUUID()
    seedRecording(rec) // eligible recording backing the capture
    seedCapture(cap, { recId: rec, quality: 'valuable' })
    seedActionItem(item, cap)
    // Suppressed contact: transcript-sourced, its sole source recording deleted.
    const recDel = randomUUID(), hidden = randomUUID()
    seedRecording(recDel, { deleted: true })
    seedContact(hidden, 'Ghost', 'transcript', recDel)

    const res = await invoke('actionItems:setAssignee', { actionItemId: item, contactId: hidden })
    expect(res.success).toBe(false)
    expect(res.error.code).toBe('CONTACT_INELIGIBLE')
    const row = queryOne<{ assignee_contact_id: string | null }>(
      'SELECT assignee_contact_id FROM action_items WHERE id = ?',
      [item]
    )
    expect(row?.assignee_contact_id ?? null).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// Happy path + clear
// ---------------------------------------------------------------------------

describe('actionItems:setAssignee — eligible item + visible contact', () => {
  it('eligible item + VISIBLE contact ⇒ assigned, returns updated row', async () => {
    const rec = randomUUID(), cap = randomUUID(), item = randomUUID(), cid = randomUUID()
    seedRecording(rec)
    seedCapture(cap, { recId: rec, quality: 'valuable' })
    seedActionItem(item, cap)
    seedContact(cid, 'Real Person', 'user')

    const res = await invoke('actionItems:setAssignee', { actionItemId: item, contactId: cid })
    expect(res.success).toBe(true)
    expect(res.data.assignee_contact_id).toBe(cid)
    const row = queryOne<{ assignee_contact_id: string | null }>(
      'SELECT assignee_contact_id FROM action_items WHERE id = ?',
      [item]
    )
    expect(row?.assignee_contact_id).toBe(cid)
  })

  it('eligible item + null contact ⇒ clears the binding', async () => {
    const rec = randomUUID(), cap = randomUUID(), item = randomUUID(), cid = randomUUID()
    seedRecording(rec)
    seedCapture(cap, { recId: rec, quality: 'valuable' })
    seedActionItem(item, cap)
    seedContact(cid, 'Real Person', 'user')
    await invoke('actionItems:setAssignee', { actionItemId: item, contactId: cid })

    const res = await invoke('actionItems:setAssignee', { actionItemId: item, contactId: null })
    expect(res.success).toBe(true)
    expect(res.data.assignee_contact_id ?? null).toBeNull()
    const row = queryOne<{ assignee_contact_id: string | null }>(
      'SELECT assignee_contact_id FROM action_items WHERE id = ?',
      [item]
    )
    expect(row?.assignee_contact_id ?? null).toBeNull()
  })

  it('STANDALONE valuable capture (no source recording) ⇒ assignable', async () => {
    const cap = randomUUID(), item = randomUUID(), cid = randomUUID()
    seedCapture(cap, { recId: null, quality: 'valuable' })
    seedActionItem(item, cap)
    seedContact(cid, 'Real Person', 'user')
    const res = await invoke('actionItems:setAssignee', { actionItemId: item, contactId: cid })
    expect(res.success).toBe(true)
    expect(res.data.assignee_contact_id).toBe(cid)
  })
})

// ---------------------------------------------------------------------------
// Fail-closed: eligibility lookup failure ⇒ refuse (no content, no write)
// ---------------------------------------------------------------------------

describe('actionItems:setAssignee — fail-closed on lookup error', () => {
  it('capture-eligibility lookup FAILURE ⇒ refused, no update, no content', async () => {
    const rec = randomUUID(), cap = randomUUID(), item = randomUUID(), cid = randomUUID()
    seedRecording(rec)
    seedCapture(cap, { recId: rec, quality: 'valuable' })
    seedActionItem(item, cap)
    seedContact(cid, 'Real Person', 'user')
    // Break the capture-eligibility lookup so filterEligibleCaptureIds fails closed.
    run('DROP TABLE knowledge_captures')
    const res = await invoke('actionItems:setAssignee', { actionItemId: item, contactId: cid })
    expect(res.success).toBe(false)
    // getActionItemById reads action_items (intact) → item resolves; capture lookup
    // then fails closed ⇒ ACTIONABLE_INELIGIBLE. (Either refusal code is acceptable.)
    expect(['ACTIONABLE_INELIGIBLE', 'NOT_FOUND', 'DATABASE_ERROR']).toContain(res.error.code)
    expect(JSON.stringify(res)).not.toContain('SECRET action item content')
  })

  it('contact-visibility lookup FAILURE ⇒ CONTACT_INELIGIBLE, not persisted', async () => {
    const rec = randomUUID(), cap = randomUUID(), item = randomUUID(), cid = randomUUID()
    seedRecording(rec)
    seedCapture(cap, { recId: rec, quality: 'valuable' })
    seedActionItem(item, cap)
    seedContact(cid, 'Real Person', 'user')
    // Break the contact-visibility lookup so filterVisibleEntityIds fails closed.
    run('DROP TABLE meeting_contacts')
    const res = await invoke('actionItems:setAssignee', { actionItemId: item, contactId: cid })
    expect(res.success).toBe(false)
    expect(res.error.code).toBe('CONTACT_INELIGIBLE')
    const row = queryOne<{ assignee_contact_id: string | null }>(
      'SELECT assignee_contact_id FROM action_items WHERE id = ?',
      [item]
    )
    expect(row?.assignee_contact_id ?? null).toBeNull()
  })
})
