// @vitest-environment node

/**
 * ADV16-5 (round-17) — outputs:getByActionableId gates the STORED generated
 * derivative through the shared actionable/capture eligibility boundary. After
 * the actionable's source recording/capture is trashed / marked personal / rated
 * low-value / soft-deleted, the stale actionable id must NOT re-expose the
 * persisted output content. REAL handler, REAL temp DB.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { tmpdir } from 'os'
import { join } from 'path'
import { existsSync, rmSync } from 'fs'

const dbPath = join(tmpdir(), `hidock-adv16-outputs-ipc-${process.pid}.sqlite`)
vi.mock('../../services/file-storage', () => ({
  getDatabasePath: () => dbPath,
  getTranscriptsPath: () => join(tmpdir(), `hidock-adv16-outputs-transcripts-${process.pid}`)
}))
// registerOutputsHandlers resolves the generator + config at registration; those
// modules touch electron.app at load, so stub them (this suite only exercises
// outputs:getByActionableId, which reads the DB directly).
vi.mock('../../services/output-generator', () => ({
  getOutputGeneratorService: () => ({ getTemplates: () => [], generate: vi.fn() })
}))
vi.mock('../../services/config', () => ({
  getConfig: () => ({ integrations: { handoffDirectory: '' } }),
  updateConfig: vi.fn().mockResolvedValue(undefined)
}))

const handlers = new Map<string, (...args: any[]) => any>()
vi.mock('electron', () => ({
  ipcMain: { handle: (channel: string, fn: (...args: any[]) => any) => { handlers.set(channel, fn) } },
  clipboard: { writeText: vi.fn() },
  dialog: {},
  BrowserWindow: {},
  shell: {}
}))

import { initializeDatabase, closeDatabase, run } from '../../services/database'
import { registerOutputsHandlers } from '../outputs-handlers'

function invoke(channel: string, ...args: any[]): Promise<any> {
  const fn = handlers.get(channel)
  if (!fn) throw new Error(`handler not registered: ${channel}`)
  return Promise.resolve(fn({} as any, ...args))
}

function seedRecording(id: string, opts: { personal?: boolean; deleted?: boolean } = {}): void {
  run('INSERT INTO recordings (id, filename, date_recorded, personal, deleted_at) VALUES (?, ?, ?, ?, ?)', [
    id, `${id}.hda`, '2026-06-01', opts.personal ? 1 : 0, opts.deleted ? '2026-07-01T00:00:00.000Z' : null
  ])
}
let capSeq = 0
function seedCapture(opts: { source?: string | null; quality?: string | null; deletedAt?: string | null } = {}): string {
  const id = `cap-${++capSeq}`
  run('INSERT INTO knowledge_captures (id, title, captured_at, source_recording_id, quality_rating, deleted_at) VALUES (?, ?, ?, ?, ?, ?)', [
    id, `Cap ${id}`, '2026-06-01', opts.source ?? null, opts.quality ?? null, opts.deletedAt ?? null
  ])
  return id
}
// outputs.knowledge_capture_id has a FK to knowledge_captures(id); reference a
// fixed placeholder capture (unrelated to the actionable's source under test).
function seedOutput(id: string, content: string): void {
  run('INSERT INTO outputs (id, knowledge_capture_id, template_id, template_name, content, generated_at) VALUES (?, ?, ?, ?, ?, ?)', [
    id, 'kc-out-placeholder', 'tpl', 'tpl', content, '2026-06-01T00:00:00Z'
  ])
}
function seedActionable(id: string, skid: string | null, artifactId: string | null): void {
  run('INSERT INTO actionables (id, type, title, source_knowledge_id, artifact_id, status) VALUES (?, ?, ?, ?, ?, ?)', [
    id, 'email', id, skid, artifactId, 'generated'
  ])
}

beforeEach(async () => {
  handlers.clear()
  capSeq = 0
  if (existsSync(dbPath)) rmSync(dbPath, { force: true })
  await initializeDatabase()
  // Placeholder capture the outputs rows' FK points at (not the source under test).
  run('INSERT INTO knowledge_captures (id, title, captured_at) VALUES (?, ?, ?)', ['kc-out-placeholder', 'Placeholder', '2026-06-01'])
  registerOutputsHandlers()
})

afterEach(() => {
  closeDatabase()
  if (existsSync(dbPath)) rmSync(dbPath, { force: true })
})

describe('ADV16-5 — outputs:getByActionableId source-eligibility gate', () => {
  it('returns the stored content for an ELIGIBLE recording-derived source', async () => {
    seedRecording('rec-ok')
    seedOutput('out-ok', '# Eligible output body')
    seedActionable('a-ok', seedCapture({ source: 'rec-ok' }), 'out-ok')

    const res = await invoke('outputs:getByActionableId', 'a-ok')
    expect(res.success).toBe(true)
    expect(res.data?.content).toBe('# Eligible output body')
  })

  it('returns the stored content for an ELIGIBLE standalone capture source', async () => {
    seedOutput('out-stand', '# Standalone output body')
    seedActionable('a-stand', seedCapture({ source: null, quality: 'valuable' }), 'out-stand')

    const res = await invoke('outputs:getByActionableId', 'a-stand')
    expect(res.success).toBe(true)
    expect(res.data?.content).toBe('# Standalone output body')
  })

  it('returns NO content when the source recording is soft-deleted', async () => {
    seedRecording('rec-del', { deleted: true })
    seedOutput('out-del', '# should not surface')
    seedActionable('a-del', seedCapture({ source: 'rec-del' }), 'out-del')

    const res = await invoke('outputs:getByActionableId', 'a-del')
    expect(res.success).toBe(true)
    expect(res.data).toBeNull()
  })

  it('returns NO content when the source recording is personal', async () => {
    seedRecording('rec-personal', { personal: true })
    seedOutput('out-personal', '# should not surface')
    seedActionable('a-personal', seedCapture({ source: 'rec-personal' }), 'out-personal')

    const res = await invoke('outputs:getByActionableId', 'a-personal')
    expect(res.success).toBe(true)
    expect(res.data).toBeNull()
  })

  it('returns NO content when the source capture is soft-deleted', async () => {
    seedRecording('rec-ok')
    seedOutput('out-softdel', '# should not surface')
    seedActionable('a-softdel', seedCapture({ source: 'rec-ok', deletedAt: '2026-07-10T00:00:00.000Z' }), 'out-softdel')

    const res = await invoke('outputs:getByActionableId', 'a-softdel')
    expect(res.success).toBe(true)
    expect(res.data).toBeNull()
  })

  it('returns NO content when the standalone capture is value-excluded (garbage/low-value)', async () => {
    seedOutput('out-garb', '# should not surface')
    seedActionable('a-garb', seedCapture({ source: null, quality: 'garbage' }), 'out-garb')

    const res = await invoke('outputs:getByActionableId', 'a-garb')
    expect(res.success).toBe(true)
    expect(res.data).toBeNull()
  })

  // NOTE: a truly "orphaned" skid (source_knowledge_id resolving to nothing) is
  // not reachable here — actionables.source_knowledge_id is NOT NULL with a FK to
  // knowledge_captures ON DELETE CASCADE, so a hard-purged capture removes its
  // actionables too. The exclusion cases above (soft-delete / value / recording)
  // are the reachable states; the helper's orphan/legacy-recording branch is
  // covered by the actionables + projects handler eligibility suites.

  it('returns null (not an error) when no output has been generated yet', async () => {
    seedRecording('rec-ok')
    seedActionable('a-none', seedCapture({ source: 'rec-ok' }), null)

    const res = await invoke('outputs:getByActionableId', 'a-none')
    expect(res.success).toBe(true)
    expect(res.data).toBeNull()
  })

  it('fails closed (no content) when the eligibility lookup throws', async () => {
    seedRecording('rec-ok')
    seedOutput('out-fail', '# should not surface')
    seedActionable('a-fail', seedCapture({ source: 'rec-ok' }), 'out-fail')
    run('PRAGMA foreign_keys = OFF')
    run('DROP TABLE recordings')

    const res = await invoke('outputs:getByActionableId', 'a-fail')
    expect(res.success).toBe(true)
    expect(res.data).toBeNull()
  })
})
