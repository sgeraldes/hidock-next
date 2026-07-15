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
import { mkdtempSync, rmSync, readdirSync, readFileSync, writeFileSync } from 'fs'
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
let backfillRows: FakeWikiRow[] = []
// RE8-P1 (round-9) — in-memory model of the `config` KV table for the wiki
// cleanup-retry ledger.
let configStore = new Map<string, string>()
// RE7-1 (round-7) — mutable exclusion so eligibility-gating tests can drive the
// boundary. Default: nothing excluded, not fail-closed.
let excludedResult: { ids: Set<string>; failClosed: boolean } = { ids: new Set<string>(), failClosed: false }

vi.mock('../file-storage', () => ({
  getTranscriptsPath: () => tmpRoot
}))

vi.mock('../database', () => ({
  // exportMeetingWiki reads one transcript row per call, selected by the id
  // param. When backfillRows are set, resolve per-recording; else use currentRow.
  queryOne: (_sql: string, params?: unknown[]) => {
    const id = params?.[0]
    if (backfillRows.length > 0 && id != null) return backfillRows.find((r) => r.recording_id === id) ?? null
    return currentRow
  },
  // backfillMeetingWiki enumerates transcript rows via queryAll; the wiki
  // cleanup-retry ledger (RE8-P1) reads config rows from an in-memory KV store.
  queryAll: (sql: string, params?: unknown[]) => {
    if (/FROM config WHERE key LIKE/i.test(sql)) {
      const prefix = String(params?.[0] ?? '').replace(/%$/, '')
      return [...configStore.entries()].filter(([k]) => k.startsWith(prefix)).map(([, v]) => ({ value: v }))
    }
    return backfillRows
  },
  // RE8-P1 (round-9) — reconcile/backfill write the retry ledger via run().
  run: (sql: string, params?: unknown[]) => {
    if (/INSERT OR REPLACE INTO config/i.test(sql)) configStore.set(String(params?.[0]), String(params?.[1]))
    else if (/DELETE FROM config WHERE key/i.test(sql)) configStore.delete(String(params?.[0]))
  },
  // exportMeetingWiki / backfill gate on isRecordingEligible /
  // filterEligibleRecordingIds. ADV9 (round-9): the boundary now uses the
  // POSITIVE allowlist getEligibleRecordingIds; derive it from the same source.
  getExcludedRecordingIds: () => excludedResult,
  getEligibleRecordingIds: (ids: Iterable<string>) =>
    excludedResult.failClosed
      ? { eligible: new Set<string>(), failClosed: true }
      : { eligible: new Set([...ids].filter((i) => i && !excludedResult.ids.has(i))), failClosed: false }
}))

describe('exportMeetingWiki — stale page cleanup (ISSUE-8)', () => {
  beforeEach(() => {
    tmpRoot = mkdtempSync(join(tmpdir(), 'hidock-wiki-'))
    currentRow = null
    backfillRows = []
    configStore = new Map<string, string>()
    excludedResult = { ids: new Set<string>(), failClosed: false }
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
 * RE7-1 (round-7) — the meeting wiki is an EXPORT surface. A personal /
 * soft-deleted / value-excluded recording must never keep a published wiki page,
 * and export must refuse to (re)create one. All routed through the shared
 * fail-closed eligibility boundary.
 */
describe('meeting-wiki — eligibility gating (RE7-1)', () => {
  beforeEach(() => {
    tmpRoot = mkdtempSync(join(tmpdir(), 'hidock-wiki-'))
    currentRow = null
    backfillRows = []
    configStore = new Map<string, string>()
    excludedResult = { ids: new Set<string>(), failClosed: false }
  })
  afterEach(() => {
    rmSync(tmpRoot, { recursive: true, force: true })
  })

  const listWiki = () => {
    try {
      return readdirSync(join(tmpRoot, 'wiki')).filter((f) => f.endsWith('.md')).sort()
    } catch {
      return []
    }
  }

  it('exportMeetingWiki refuses and removes the page when the recording became excluded', async () => {
    const { exportMeetingWiki } = await import('../meeting-wiki')

    // First export while eligible → one page exists.
    currentRow = {
      recording_id: 'rec-x',
      full_text: 'texto',
      title_suggestion: 'Reunion Sensible',
      date_recorded: '2026-07-07T00:00:00.000Z'
    }
    expect(exportMeetingWiki('rec-x')).not.toBeNull()
    expect(listWiki()).toHaveLength(1)

    // Recording is now excluded (personal / trashed / low-value). Re-export must
    // refuse AND scrub the previously published page.
    excludedResult = { ids: new Set(['rec-x']), failClosed: false }
    expect(exportMeetingWiki('rec-x')).toBeNull()
    expect(listWiki()).toHaveLength(0)
  })

  it('exportMeetingWiki fails closed when eligibility cannot be verified', async () => {
    const { exportMeetingWiki } = await import('../meeting-wiki')
    currentRow = {
      recording_id: 'rec-y',
      full_text: 'texto',
      title_suggestion: 'Reunion',
      date_recorded: '2026-07-07T00:00:00.000Z'
    }
    excludedResult = { ids: new Set<string>(), failClosed: true }
    expect(exportMeetingWiki('rec-y')).toBeNull()
    expect(listWiki()).toHaveLength(0)
  })

  it('reconcileWikiEligibility removes an existing page on a transition to excluded', async () => {
    const { exportMeetingWiki, reconcileWikiEligibility } = await import('../meeting-wiki')
    currentRow = {
      recording_id: 'rec-z',
      full_text: 'texto',
      title_suggestion: 'Reunion Z',
      date_recorded: '2026-07-07T00:00:00.000Z'
    }
    expect(exportMeetingWiki('rec-z')).not.toBeNull()
    expect(listWiki()).toHaveLength(1)

    // Simulate the transition (markPersonal / soft-delete / low value-rating).
    excludedResult = { ids: new Set(['rec-z']), failClosed: false }
    reconcileWikiEligibility('rec-z')
    expect(listWiki()).toHaveLength(0)
  })

  it('backfillMeetingWiki skips excluded recordings and fails closed as a whole on an unverifiable lookup', async () => {
    const { backfillMeetingWiki } = await import('../meeting-wiki')

    backfillRows = [
      { recording_id: 'r-ok', full_text: 'a', title_suggestion: 'A', date_recorded: '2026-07-01T00:00:00.000Z' },
      { recording_id: 'r-bad', full_text: 'b', title_suggestion: 'B', date_recorded: '2026-07-02T00:00:00.000Z' }
    ]
    // r-bad excluded → only r-ok is written.
    excludedResult = { ids: new Set(['r-bad']), failClosed: false }
    const partial = backfillMeetingWiki()
    expect(partial.written).toBe(1)
    expect(listWiki()).toHaveLength(1)

    // Wipe and re-run with an unverifiable lookup → nothing is written at all.
    rmSync(join(tmpRoot, 'wiki'), { recursive: true, force: true })
    excludedResult = { ids: new Set<string>(), failClosed: true }
    const closed = backfillMeetingWiki()
    expect(closed.written).toBe(0)
    expect(listWiki()).toHaveLength(0)
  })

  it('RE7-P1a (round-8) — backfill REMOVES a stale page for a now-excluded recording (not just skips)', async () => {
    const { exportMeetingWiki, backfillMeetingWiki } = await import('../meeting-wiki')

    // A page exists from when the recording was eligible.
    currentRow = { recording_id: 'r-stale', full_text: 'contenido', title_suggestion: 'Reunion Vieja', date_recorded: '2026-07-01T00:00:00.000Z' }
    expect(exportMeetingWiki('r-stale')).not.toBeNull()
    expect(listWiki()).toHaveLength(1)

    // The recording is now excluded (e.g. newly value-classified low-value). A
    // backfill pass must actively remove the stale markdown, not merely skip it.
    backfillRows = [{ recording_id: 'r-stale', full_text: 'contenido', title_suggestion: 'Reunion Vieja', date_recorded: '2026-07-01T00:00:00.000Z' }]
    excludedResult = { ids: new Set(['r-stale']), failClosed: false }
    backfillMeetingWiki()
    expect(listWiki()).toHaveLength(0)
  })
})

/**
 * RE7-P1b (round-8) — removeMeetingWiki must surface filesystem failures via its
 * result instead of swallowing them, so a privacy transition cannot report
 * success while an excluded recording's page is still readable on disk.
 */
describe('removeMeetingWiki — cleanup result (RE7-P1b)', () => {
  beforeEach(() => {
    tmpRoot = mkdtempSync(join(tmpdir(), 'hidock-wiki-'))
    currentRow = null
    backfillRows = []
    configStore = new Map<string, string>()
    excludedResult = { ids: new Set<string>(), failClosed: false }
  })
  afterEach(() => {
    rmSync(tmpRoot, { recursive: true, force: true })
  })

  it('reports ok:true with a removed count when the page is deleted', async () => {
    const { exportMeetingWiki, removeMeetingWiki } = await import('../meeting-wiki')
    currentRow = { recording_id: 'r1', full_text: 'x', title_suggestion: 'T', date_recorded: '2026-07-01T00:00:00.000Z' }
    expect(exportMeetingWiki('r1')).not.toBeNull()

    const result = removeMeetingWiki('r1')
    expect(result).toEqual({ removed: 1, failed: 0, ok: true })
  })

  it('reports ok:true (nothing to remove) when the wiki dir is absent', async () => {
    const { removeMeetingWiki } = await import('../meeting-wiki')
    // No page ever written → wiki dir does not exist → success, nothing removed.
    expect(removeMeetingWiki('ghost')).toEqual({ removed: 0, failed: 0, ok: true })
  })
})

/**
 * RE8-P1 (round-9) — a transition (mark-personal / soft-delete / value-rating)
 * whose wiki cleanup FAILS must not silently drop it: reconcileWikiEligibility
 * enqueues a persistent retry, and a later sweep removes the page.
 */
describe('meeting-wiki — cleanup-retry ledger (RE8-P1)', () => {
  beforeEach(() => {
    tmpRoot = mkdtempSync(join(tmpdir(), 'hidock-wiki-'))
    currentRow = null
    backfillRows = []
    configStore = new Map<string, string>()
    excludedResult = { ids: new Set<string>(), failClosed: false }
  })
  afterEach(() => {
    rmSync(tmpRoot, { recursive: true, force: true })
  })

  it('a failed transition cleanup is enqueued, then cleared by a later retry', async () => {
    const { reconcileWikiEligibility, retryPendingWikiCleanups } = await import('../meeting-wiki')

    // Force removeMeetingWiki to fail (ok:false): put a FILE where the wiki
    // directory is expected, so readdirSync throws ENOTDIR (not ENOENT).
    writeFileSync(join(tmpRoot, 'wiki'), 'blocking file')
    excludedResult = { ids: new Set(['rec-fail']), failClosed: false }

    const result = reconcileWikiEligibility('rec-fail')
    expect(result?.ok).toBe(false) // cleanup could not complete
    // …and was ENQUEUED for retry rather than reported as success.
    expect(configStore.has('wiki_cleanup_pending:rec-fail')).toBe(true)

    // Unblock the directory; a later sweep now succeeds and clears the entry.
    rmSync(join(tmpRoot, 'wiki'), { force: true })
    const swept = retryPendingWikiCleanups()
    expect(swept.cleared).toBe(1)
    expect(configStore.has('wiki_cleanup_pending:rec-fail')).toBe(false)
  })

  it('retry drops a pending entry once the recording is eligible again (no purge needed)', async () => {
    const { retryPendingWikiCleanups } = await import('../meeting-wiki')
    // Pre-seed a pending entry for a recording that is now eligible again.
    configStore.set('wiki_cleanup_pending:rec-back', 'rec-back')
    excludedResult = { ids: new Set<string>(), failClosed: false } // rec-back eligible

    const swept = retryPendingWikiCleanups()
    expect(swept.cleared).toBe(1)
    expect(configStore.has('wiki_cleanup_pending:rec-back')).toBe(false)
  })
})
