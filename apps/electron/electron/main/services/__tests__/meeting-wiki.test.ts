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

vi.mock('../file-storage', () => ({
  getTranscriptsPath: () => tmpRoot
}))

vi.mock('../database', () => ({
  // exportMeetingWiki reads exactly one row per call; return whatever the test set.
  queryOne: () => currentRow,
  queryAll: () => []
}))

describe('exportMeetingWiki — stale page cleanup (ISSUE-8)', () => {
  beforeEach(() => {
    tmpRoot = mkdtempSync(join(tmpdir(), 'hidock-wiki-'))
    currentRow = null
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
