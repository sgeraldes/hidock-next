// @vitest-environment node

/**
 * knowledge:update — REAL-engine behavioral test for the manual-rating path
 * (F16/spec-001 step 7 + CX-T1-2 fix round).
 *
 * The sibling knowledge-handlers.test.ts wholesale-mocks the database module
 * and can only assert SQL strings; this file registers the real handler
 * against the real better-sqlite3 engine on a temp DB and proves the actual
 * row semantics: a manual quality edit stamps quality_source='user' +
 * quality_assessed_at, CLEARS stale AI quality_reasons, and records
 * quality_confidence = 1.0 — so the Library never displays old AI reason
 * tags as if they justified the user's new rating, and the AI classifier's
 * never-downgrade guard permanently leaves the row alone.
 *
 * Never opens F:\HiDock-Next-Data — temp/fixture DBs only.
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest'
import { tmpdir } from 'os'
import { join } from 'path'
import { existsSync, rmSync } from 'fs'

const paths = vi.hoisted(() => ({ db: '' }))
paths.db = join(tmpdir(), `hidock-khdbtest-${process.pid}-${Date.now()}.db`)

vi.mock('../../services/file-storage', () => ({
  getDatabasePath: () => paths.db
}))

// Capture the registered IPC handlers; everything else about electron is
// irrelevant to this handler module.
const handlers: Record<string, (...args: unknown[]) => unknown> = {}
vi.mock('electron', () => ({
  ipcMain: {
    handle: (channel: string, handler: (...args: unknown[]) => unknown) => {
      handlers[channel] = handler
    }
  }
}))

// value-classification.ts (imported in the guard-integration test below) reads
// the confidence floor via getConfig(); the real config.ts needs electron's
// app/safeStorage at module scope, so mock it minimally instead.
vi.mock('../../services/config', () => ({
  getConfig: () => ({ transcription: { valueClassificationMinConfidence: 0.6 } })
}))

import { initializeDatabase, closeDatabase, run, queryOne, runWithMassDeleteAllowed } from '../../services/database'
import { registerKnowledgeHandlers } from '../knowledge-handlers'

function cleanupDbFiles(base: string): void {
  for (const suffix of ['', '-wal', '-shm', '.tmp']) {
    if (existsSync(`${base}${suffix}`)) rmSync(`${base}${suffix}`, { force: true })
  }
}

function wipeData(): void {
  runWithMassDeleteAllowed(() => {
    for (const table of ['knowledge_captures', 'recordings']) {
      try {
        run(`DELETE FROM ${table}`)
      } catch {
        /* ignore */
      }
    }
  })
}

function seedAiRatedCapture(id: string): void {
  run(
    `INSERT INTO knowledge_captures
       (id, title, captured_at, quality_rating, quality_confidence, quality_assessed_at, quality_reasons, quality_source)
     VALUES (?, ?, ?, 'garbage', 0.7, '2026-01-01T10:00:00.000Z', ?, 'ai')`,
    [id, `Capture ${id}`, '2026-01-01T10:00:00.000Z', JSON.stringify(['personal_family', 'background_ambient'])]
  )
}

function getCaptureRow(id: string) {
  return queryOne<{
    quality_rating: string | null
    quality_confidence: number | null
    quality_assessed_at: string | null
    quality_reasons: string | null
    quality_source: string | null
  }>(
    'SELECT quality_rating, quality_confidence, quality_assessed_at, quality_reasons, quality_source FROM knowledge_captures WHERE id = ?',
    [id]
  )
}

describe('knowledge:update — manual rating clears stale AI metadata (real engine, CX-T1-2)', () => {
  beforeAll(async () => {
    cleanupDbFiles(paths.db)
    await initializeDatabase()
    registerKnowledgeHandlers()
  })

  afterAll(() => {
    try {
      closeDatabase()
    } catch {
      /* ignore */
    }
    cleanupDbFiles(paths.db)
  })

  beforeEach(() => {
    wipeData()
  })

  it('re-rating an AI-classified capture clears reasons, sets confidence 1.0 and source user', async () => {
    seedAiRatedCapture('cap-manual')
    // Sanity: the seed really carries AI metadata.
    const before = getCaptureRow('cap-manual')
    expect(before?.quality_source).toBe('ai')
    expect(before?.quality_confidence).toBeCloseTo(0.7)
    expect(JSON.parse(before!.quality_reasons!)).toEqual(['personal_family', 'background_ambient'])

    const result = await handlers['knowledge:update']({}, 'cap-manual', { quality: 'valuable' })

    expect(result).toEqual({ success: true })
    const after = getCaptureRow('cap-manual')
    expect(after?.quality_rating).toBe('valuable')
    expect(after?.quality_source).toBe('user')
    expect(after?.quality_confidence).toBe(1.0)
    expect(after?.quality_reasons).toBeNull()
    expect(after?.quality_assessed_at).toBeTruthy()
    // assessed_at was refreshed, not carried over from the AI stamp.
    expect(after?.quality_assessed_at).not.toBe('2026-01-01T10:00:00.000Z')
  })

  it('the user-stamped row is then permanently immune to the AI classifier (integration with never-downgrade guard)', async () => {
    seedAiRatedCapture('cap-immune')
    await handlers['knowledge:update']({}, 'cap-immune', { quality: 'valuable' })

    // A later AI re-analysis (high confidence, would otherwise downgrade)
    // must be blocked by the guard now that quality_source='user'.
    const { applyCaptureValueClassification } = await import('../../services/value-classification')
    const applied = applyCaptureValueClassification('cap-immune', {
      value: 'none',
      reasons: ['no_substance'],
      confidence: 0.95
    })

    expect(applied.applied).toBe(false)
    const row = getCaptureRow('cap-immune')
    expect(row?.quality_rating).toBe('valuable')
    expect(row?.quality_source).toBe('user')
    expect(row?.quality_reasons).toBeNull()
    expect(row?.quality_confidence).toBe(1.0)
  })

  it('a non-quality update leaves existing AI metadata untouched', async () => {
    seedAiRatedCapture('cap-titleonly')

    await handlers['knowledge:update']({}, 'cap-titleonly', { title: 'Renamed' })

    const row = getCaptureRow('cap-titleonly')
    expect(row?.quality_rating).toBe('garbage')
    expect(row?.quality_source).toBe('ai')
    expect(row?.quality_confidence).toBeCloseTo(0.7)
    expect(JSON.parse(row!.quality_reasons!)).toEqual(['personal_family', 'background_ambient'])
  })
})
