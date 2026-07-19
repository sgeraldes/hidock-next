/**
 * Meeting Wiki Exporter Tests
 *
 * ISSUE-8: re-transcription that changed a recording's title left the old wiki
 * page orphaned. The filename is derived from the (mutable) title suggestion, so
 * the re-export wrote a NEW file and the stale first page lingered (live: Rec43's
 * truncated filename-slug page survived next to the real-title re-export). The
 * fix removes prior pages for the same recording_id on every export.
 *
 * @vitest-environment node
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync, readdirSync, readFileSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'

interface FakeWikiRow {
  recording_id: string
  full_text: string
  title_suggestion?: string
  filename?: string
  date_recorded?: string
}

let tmpRoot = ''
let currentRow: FakeWikiRow | null = null
/** Rows the backfill iterates; empty for the single-export tests. */
let backfillRows: { recording_id: string }[] = []
/** When set, queryOne resolves per-id (backfill tests); otherwise currentRow. */
let rowById: ((id: string) => FakeWikiRow | null) | null = null
/** fs syscall counters — the quadratic-regression assertion reads these. */
const fsCalls = { readFile: 0, readdir: 0, write: 0 }

// Count the fs calls the exporter makes, delegating to the real implementations
// so the tests still exercise a real directory.
vi.mock('fs', async (importOriginal) => {
  const real = await importOriginal<typeof import('fs')>()
  return {
    ...real,
    default: real,
    readFileSync: (...a: Parameters<typeof real.readFileSync>) => {
      fsCalls.readFile++
      return real.readFileSync(...a)
    },
    readdirSync: (...a: Parameters<typeof real.readdirSync>) => {
      fsCalls.readdir++
      return real.readdirSync(...a)
    },
    writeFileSync: (...a: Parameters<typeof real.writeFileSync>) => {
      fsCalls.write++
      return real.writeFileSync(...a)
    }
  }
})

vi.mock('../file-storage', () => ({
  getTranscriptsPath: () => tmpRoot
}))

vi.mock('../database', () => ({
  // exportMeetingWiki reads exactly one row per call; return whatever the test set.
  queryOne: (_sql: string, params: unknown[]) =>
    rowById ? rowById(params[0] as string) : currentRow,
  queryAll: () => backfillRows
}))

describe('exportMeetingWiki — stale page cleanup (ISSUE-8)', () => {
  beforeEach(() => {
    tmpRoot = mkdtempSync(join(tmpdir(), 'hidock-wiki-'))
    currentRow = null
    backfillRows = []
    rowById = null
  })

  afterEach(() => {
    rmSync(tmpRoot, { recursive: true, force: true })
  })

  const listWiki = () => readdirSync(join(tmpRoot, 'wiki')).filter((f) => f.endsWith('.md')).sort()

  it('replaces the old page when the title (and thus filename) changes', async () => {
    const { exportMeetingWiki } = await import('../meeting-wiki')

    currentRow = {
      recording_id: 'rec-1',
      full_text: 'contenido de la transcripción',
      title_suggestion: 'Primer Titulo Provisional',
      filename: 'rec1.wav',
      date_recorded: '2026-07-07T19:31:44.000Z'
    }
    const firstPath = exportMeetingWiki('rec-1')
    expect(firstPath).not.toBeNull()
    expect(listWiki()).toHaveLength(1)

    // Re-transcription produces a different, real title -> different filename.
    currentRow = { ...currentRow, title_suggestion: 'Iniciativa de Desarrollo Gateway', full_text: 'texto completo re-transcrito' }
    const secondPath = exportMeetingWiki('rec-1')
    expect(secondPath).not.toBeNull()
    expect(secondPath).not.toBe(firstPath)

    // Exactly one page remains — the new one; the stale page is gone.
    const remaining = listWiki()
    expect(remaining).toHaveLength(1)
    expect(join(tmpRoot, 'wiki', remaining[0])).toBe(secondPath)
    expect(readFileSync(secondPath!, 'utf-8')).toContain('texto completo re-transcrito')
  })

  it('overwrites in place (no duplicate) when the title is unchanged', async () => {
    const { exportMeetingWiki } = await import('../meeting-wiki')
    currentRow = {
      recording_id: 'rec-2',
      full_text: 'v1',
      title_suggestion: 'Titulo Estable',
      date_recorded: '2026-07-07T00:00:00.000Z'
    }
    const p1 = exportMeetingWiki('rec-2')
    currentRow = { ...currentRow, full_text: 'v2 actualizado' }
    const p2 = exportMeetingWiki('rec-2')
    expect(p2).toBe(p1)
    expect(listWiki()).toHaveLength(1)
    expect(readFileSync(p2!, 'utf-8')).toContain('v2 actualizado')
  })

  it('does not remove pages belonging to other recordings', async () => {
    const { exportMeetingWiki } = await import('../meeting-wiki')
    currentRow = {
      recording_id: 'rec-A',
      full_text: 'aaa',
      title_suggestion: 'Reunion A',
      date_recorded: '2026-07-01T00:00:00.000Z'
    }
    exportMeetingWiki('rec-A')
    currentRow = {
      recording_id: 'rec-B',
      full_text: 'bbb',
      title_suggestion: 'Reunion B',
      date_recorded: '2026-07-02T00:00:00.000Z'
    }
    exportMeetingWiki('rec-B')

    // Re-export A with a new title: only A's old page should go, B untouched.
    currentRow = {
      recording_id: 'rec-A',
      full_text: 'aaa v2',
      title_suggestion: 'Reunion A Renombrada',
      date_recorded: '2026-07-01T00:00:00.000Z'
    }
    exportMeetingWiki('rec-A')

    const remaining = listWiki()
    expect(remaining).toHaveLength(2)
    // B's page survives; A has exactly one (renamed) page.
    const bodies = remaining.map((f) => readFileSync(join(tmpRoot, 'wiki', f), 'utf-8'))
    expect(bodies.some((b) => b.includes('recording_id: rec-B'))).toBe(true)
    expect(bodies.filter((b) => b.includes('recording_id: rec-A'))).toHaveLength(1)
  })
})

/**
 * F15 — the boot freeze.
 *
 * The backfill ran as ONE synchronous pass, and each export re-listed the wiki
 * directory and fully read every OTHER page looking for stale ones: O(N²)
 * whole-file reads on the main process, so no renderer IPC was serviced for the
 * whole stretch and the window was reported "Not Responding". Measured on the
 * pre-fix code with 40 KB pages, all already present (i.e. every restart):
 * N=100 → 2.2 s / 9,900 reads / 397 MB; N=200 → 10.9 s / 39,800 reads / 1.6 GB.
 */
describe('backfillMeetingWiki — bounded, yielding, resumable (F15)', () => {
  const N = 60

  beforeEach(() => {
    tmpRoot = mkdtempSync(join(tmpdir(), 'hidock-wiki-bf-'))
    currentRow = null
    backfillRows = []
    // A realistic corpus: each page carries a sizeable transcript body, which is
    // what made whole-file reads so expensive.
    const body = 'palabra '.repeat(1500)
    for (let i = 0; i < N; i++) backfillRows.push({ recording_id: `rec-${String(i).padStart(3, '0')}` })
    rowById = (id) => ({
      recording_id: id,
      full_text: body,
      title_suggestion: `Reunion ${id}`,
      filename: `${id}.wav`,
      date_recorded: '2026-07-07T00:00:00.000Z'
    })
    fsCalls.readFile = 0
    fsCalls.readdir = 0
    fsCalls.write = 0
  })

  afterEach(() => {
    rowById = null
    backfillRows = []
    rmSync(tmpRoot, { recursive: true, force: true })
  })

  const listWiki = () => readdirSync(join(tmpRoot, 'wiki')).filter((f) => f.endsWith('.md')).sort()

  it('writes every page on a cold pass', async () => {
    const { backfillMeetingWiki } = await import('../meeting-wiki')
    const result = await backfillMeetingWiki()

    expect(result.written).toBe(N)
    expect(result.unchanged).toBe(0)
    expect(result.failed).toBe(0)
    expect(result.remaining).toBe(0)
    expect(listWiki()).toHaveLength(N)
  })

  it('scans the directory ONCE and stays linear in reads — the quadratic regression guard', async () => {
    const { backfillMeetingWiki } = await import('../meeting-wiki')
    await backfillMeetingWiki()

    // Second pass = the real-world restart: every page already on disk.
    fsCalls.readFile = 0
    fsCalls.readdir = 0
    const result = await backfillMeetingWiki()

    expect(result.unchanged).toBe(N)
    // One directory listing for the entire pass, not one per recording.
    expect(fsCalls.readdir).toBe(1)
    // Linear in N. The old code read N*(N-1) = 3,540 whole files for N=60; the
    // ceiling here is deliberately loose (2N) so the test pins the ORDER of
    // growth rather than an exact call count.
    expect(fsCalls.readFile).toBeLessThanOrEqual(2 * N)
  })

  it('leaves unchanged pages alone instead of rewriting the whole wiki every boot', async () => {
    const { backfillMeetingWiki } = await import('../meeting-wiki')
    await backfillMeetingWiki()

    fsCalls.write = 0
    const result = await backfillMeetingWiki()

    expect(result.written).toBe(0)
    expect(result.unchanged).toBe(N)
    expect(fsCalls.write).toBe(0)
  })

  it('rewrites a page whose content actually changed', async () => {
    const { backfillMeetingWiki } = await import('../meeting-wiki')
    await backfillMeetingWiki()

    const target = 'rec-007'
    const base = rowById!
    rowById = (id) =>
      id === target ? { ...base(id)!, full_text: 'transcripción corregida' } : base(id)

    const result = await backfillMeetingWiki()
    expect(result.written).toBe(1)
    expect(result.unchanged).toBe(N - 1)

    const changed = listWiki()
      .map((f) => readFileSync(join(tmpRoot, 'wiki', f), 'utf-8'))
      .find((b) => b.includes(`recording_id: ${target}`))
    expect(changed).toContain('transcripción corregida')
  })

  it('yields to the event loop between batches so renderer IPC is serviced mid-pass', async () => {
    const { backfillMeetingWiki } = await import('../meeting-wiki')

    // A macrotask queued alongside the backfill: it can only run if the backfill
    // actually returns to the event loop, which a synchronous pass never does.
    let ipcServiced = 0
    const ticker = setInterval(() => { ipcServiced++ }, 0)
    try {
      await backfillMeetingWiki({ batchSize: 10 })
    } finally {
      clearInterval(ticker)
    }

    expect(ipcServiced).toBeGreaterThan(0)
  })

  it('stops at the time budget and reports what it deferred', async () => {
    const { backfillMeetingWiki } = await import('../meeting-wiki')

    // Budget of 0 => the deadline has passed by the first batch boundary, so the
    // pass stops after exactly one batch.
    const result = await backfillMeetingWiki({ batchSize: 10, budgetMs: 0 })

    expect(result.written).toBe(10)
    expect(result.remaining).toBe(N - 10)
    expect(result.remainingMissing).toBe(N - 10)
    expect(listWiki()).toHaveLength(10)
  })

  it('resumes across restarts — each budgeted pass advances the pages still missing', async () => {
    const { backfillMeetingWiki } = await import('../meeting-wiki')

    // Every "boot" gets exactly one batch (budget 0 stops at the first boundary).
    // Missing-first ordering is what makes this converge: a pass never burns its
    // whole budget re-verifying what it already wrote and stalls at the same spot.
    const missingPerPass: number[] = []
    let passes = 0
    let last = await backfillMeetingWiki({ batchSize: 20, budgetMs: 0 })
    missingPerPass.push(last.remainingMissing)
    while (last.remainingMissing > 0 && passes < 10) {
      passes++
      last = await backfillMeetingWiki({ batchSize: 20, budgetMs: 0 })
      missingPerPass.push(last.remainingMissing)
    }

    // Converged, and strictly monotonically: 40 -> 20 -> 0 for N=60 in batches of 20.
    expect(last.remainingMissing).toBe(0)
    expect(missingPerPass).toEqual([40, 20, 0])
    expect(listWiki()).toHaveLength(N)

    // Every recording ended up with exactly one page, no duplicates from the
    // partial passes.
    const owners = listWiki().map((f) => {
      const head = readFileSync(join(tmpRoot, 'wiki', f), 'utf-8').slice(0, 500)
      return head.match(/^recording_id:\s*(\S+)\s*$/m)?.[1]
    })
    expect(new Set(owners).size).toBe(N)
  })

  it('still removes a superseded page when a title changed (cleanup survives the index)', async () => {
    const { backfillMeetingWiki } = await import('../meeting-wiki')
    await backfillMeetingWiki()
    expect(listWiki()).toHaveLength(N)

    const target = 'rec-042'
    const base = rowById!
    rowById = (id) =>
      id === target ? { ...base(id)!, title_suggestion: 'Titulo Completamente Nuevo' } : base(id)

    await backfillMeetingWiki()

    // Still one page per recording — the renamed page replaced the old one
    // rather than sitting next to it.
    expect(listWiki()).toHaveLength(N)
    const bodies = listWiki().map((f) => readFileSync(join(tmpRoot, 'wiki', f), 'utf-8'))
    expect(bodies.filter((b) => b.includes(`recording_id: ${target}`))).toHaveLength(1)
    expect(bodies.some((b) => b.includes('Titulo Completamente Nuevo'))).toBe(true)
  })
})
