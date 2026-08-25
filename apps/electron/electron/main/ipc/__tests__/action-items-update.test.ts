// @vitest-environment node

/**
 * actionItems:update / decisions:update / actionItems:getForRecording (2026-07-22)
 * — the reader event-list detail surface.
 *
 * Covers:
 *  - getForRecording returns first-class rows for an eligible recording and
 *    EMPTY lists for an ineligible one (display read boundary, fail-closed);
 *  - actionItems:update applies partial patches (content/status/dueDate/priority),
 *    validates enums, and refuses items whose source capture is excluded
 *    (same ADV38-1 gating as setAssignee);
 *  - decisions:update patches content/context with the same capture gating.
 *
 * REAL temp DB, real database.ts (better-sqlite3), real handlers end to end.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { tmpdir } from 'os'
import { join } from 'path'
import { existsSync, rmSync } from 'fs'
import { randomUUID } from 'crypto'

const dbPath = join(tmpdir(), `hidock-actionitems-update-${process.pid}.sqlite`)
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

function seedRecording(id: string, opts: { personal?: boolean; deleted?: boolean } = {}): void {
  run(
    `INSERT INTO recordings (id, filename, date_recorded, personal, deleted_at) VALUES (?, ?, '2026-01-02T10:00:00Z', ?, ?)`,
    [id, `${id}.hda`, opts.personal ? 1 : 0, opts.deleted ? '2026-07-01T00:00:00Z' : null]
  )
}
function seedCapture(id: string, recId: string | null, opts: { deleted?: boolean } = {}): void {
  run(
    `INSERT INTO knowledge_captures (id, title, captured_at, source_recording_id, quality_rating, deleted_at)
     VALUES (?, 'Cap', '2026-06-01', ?, 'unrated', ?)`,
    [id, recId, opts.deleted ? '2026-07-01T00:00:00Z' : null]
  )
}
function seedActionItem(id: string, captureId: string): void {
  run(
    `INSERT INTO action_items (id, knowledge_capture_id, content, assignee, priority, status)
     VALUES (?, ?, 'Original action content', 'Raw Name', 'medium', 'pending')`,
    [id, captureId]
  )
}
function seedDecision(id: string, captureId: string): void {
  run(
    `INSERT INTO decisions (id, knowledge_capture_id, content, context)
     VALUES (?, ?, 'Original decision content', 'Original context')`,
    [id, captureId]
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

describe('actionItems:getForRecording', () => {
  it('returns the first-class action items and decisions for an eligible recording', async () => {
    seedRecording('rec-1')
    seedCapture('cap-1', 'rec-1')
    seedActionItem(randomUUID(), 'cap-1')
    seedActionItem(randomUUID(), 'cap-1')
    seedDecision(randomUUID(), 'cap-1')

    const res = await invoke('actionItems:getForRecording', 'rec-1')
    expect(res.success).toBe(true)
    expect(res.data.actionItems).toHaveLength(2)
    expect(res.data.decisions).toHaveLength(1)
    expect(res.data.actionItems[0]).toMatchObject({ content: 'Original action content', status: 'pending' })
    expect(res.data.decisions[0]).toMatchObject({ content: 'Original decision content', context: 'Original context' })
  })

  it('returns EMPTY lists for an ineligible (personal) recording — never suppressed content', async () => {
    seedRecording('rec-x', { personal: true })
    seedCapture('cap-x', 'rec-x')
    seedActionItem(randomUUID(), 'cap-x')
    seedDecision(randomUUID(), 'cap-x')

    const res = await invoke('actionItems:getForRecording', 'rec-x')
    expect(res.success).toBe(true)
    expect(res.data).toEqual({ actionItems: [], decisions: [] })
  })
})

describe('actionItems:update', () => {
  it('applies a partial patch (status only) and returns the updated row', async () => {
    seedRecording('rec-1')
    seedCapture('cap-1', 'rec-1')
    const id = randomUUID()
    seedActionItem(id, 'cap-1')

    const res = await invoke('actionItems:update', { actionItemId: id, status: 'completed' })
    expect(res.success).toBe(true)
    expect(res.data).toMatchObject({ id, status: 'completed', content: 'Original action content' })
    expect(queryOne('SELECT status FROM action_items WHERE id = ?', [id])).toMatchObject({ status: 'completed' })
  })

  it('applies content + priority + dueDate together', async () => {
    seedRecording('rec-1')
    seedCapture('cap-1', 'rec-1')
    const id = randomUUID()
    seedActionItem(id, 'cap-1')

    const res = await invoke('actionItems:update', {
      actionItemId: id,
      content: 'Corrected action text',
      priority: 'urgent',
      dueDate: '2026-07-25'
    })
    expect(res.success).toBe(true)
    expect(res.data).toMatchObject({ content: 'Corrected action text', priority: 'urgent', due_date: '2026-07-25' })
  })

  it('rejects an invalid status enum', async () => {
    seedRecording('rec-1')
    seedCapture('cap-1', 'rec-1')
    const id = randomUUID()
    seedActionItem(id, 'cap-1')

    const res = await invoke('actionItems:update', { actionItemId: id, status: 'done' })
    expect(res.success).toBe(false)
    expect(res.error.code).toBe('VALIDATION_ERROR')
  })

  it('refuses (and does not leak content) when the source recording is excluded', async () => {
    seedRecording('rec-x', { personal: true })
    seedCapture('cap-x', 'rec-x')
    const id = randomUUID()
    seedActionItem(id, 'cap-x')

    const res = await invoke('actionItems:update', { actionItemId: id, content: 'hacked' })
    expect(res.success).toBe(false)
    expect(res.error.code).toBe('ACTIONABLE_INELIGIBLE')
    expect(JSON.stringify(res)).not.toContain('Original action content')
    expect(queryOne('SELECT content FROM action_items WHERE id = ?', [id])).toMatchObject({ content: 'Original action content' })
  })

  it('returns NOT_FOUND for a missing item', async () => {
    const res = await invoke('actionItems:update', { actionItemId: randomUUID(), content: 'x' })
    expect(res.success).toBe(false)
    expect(res.error.code).toBe('NOT_FOUND')
  })
})

describe('decisions:update', () => {
  it('patches content and context', async () => {
    seedRecording('rec-1')
    seedCapture('cap-1', 'rec-1')
    const id = randomUUID()
    seedDecision(id, 'cap-1')

    const res = await invoke('decisions:update', { decisionId: id, content: 'Corrected decision', context: 'New context' })
    expect(res.success).toBe(true)
    expect(res.data).toMatchObject({ id, content: 'Corrected decision', context: 'New context' })
  })

  it('refuses when the source recording is excluded', async () => {
    seedRecording('rec-x', { deleted: true })
    seedCapture('cap-x', 'rec-x')
    const id = randomUUID()
    seedDecision(id, 'cap-x')

    const res = await invoke('decisions:update', { decisionId: id, content: 'hacked' })
    expect(res.success).toBe(false)
    expect(res.error.code).toBe('ACTIONABLE_INELIGIBLE')
    expect(queryOne('SELECT content FROM decisions WHERE id = ?', [id])).toMatchObject({ content: 'Original decision content' })
  })
})
