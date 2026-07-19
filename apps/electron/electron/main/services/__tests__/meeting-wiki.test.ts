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
import { mkdtempSync, rmSync, readdirSync, readFileSync, writeFileSync, mkdirSync } from 'fs'
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
/** Rows the backfill iterates; empty for the single-export tests. Widened to carry
 *  full FakeWikiRow fields so the F17 eligibility tests can resolve rows straight
 *  from here (beta's perf tests still push id-only rows + a rowById resolver). */
let backfillRows: Array<{ recording_id: string } & Partial<FakeWikiRow>> = []
// RE8-P1 (round-9) — in-memory model of the `config` KV table for the wiki
// cleanup-retry ledger.
let configStore = new Map<string, string>()
// RE7-1 (round-7) — mutable exclusion so eligibility-gating tests can drive the
// shared boundary. Default: nothing excluded, not fail-closed.
let excludedResult: { ids: Set<string>; failClosed: boolean } = { ids: new Set<string>(), failClosed: false }
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

/** Lets a test point the backfill's state file at an unwritable location. */
let cacheDirOverride: string | null = null

/** Clears the in-process resume cursor, which otherwise leaks between tests. */
const resetBackfillCursor = async (): Promise<void> => {
  const { _resetBackfillCursorForTests } = await import('../meeting-wiki')
  _resetBackfillCursorForTests()
}

vi.mock('../file-storage', () => ({
  getTranscriptsPath: () => tmpRoot,
  // Per-test tmpRoot, so the backfill's resume cursor is isolated.
  getCachePath: () => cacheDirOverride ?? join(tmpRoot, 'cache')
}))

vi.mock('../database', () => ({
  // exportMeetingWiki / backfill read one transcript row per call, selected by id.
  // Prefer an explicit rowById resolver (beta's backfill perf/resume tests); else
  // resolve a full row from backfillRows (F17 tests); else the single currentRow.
  queryOne: (_sql: string, params?: unknown[]) => {
    const id = params?.[0] as string | undefined
    if (rowById && id != null) return rowById(id)
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
  // filterEligibleRecordingIds (from ./recording-eligibility, which reads the
  // POSITIVE allowlist getEligibleRecordingIds from here). Derive both from the
  // same mutable exclusion set.
  getExcludedRecordingIds: () => excludedResult,
  getEligibleRecordingIds: (ids: Iterable<string>) =>
    excludedResult.failClosed
      ? { eligible: new Set<string>(), failClosed: true }
      : { eligible: new Set([...ids].filter((i) => i && !excludedResult.ids.has(i))), failClosed: false }
}))

describe('exportMeetingWiki — stale page cleanup (ISSUE-8)', () => {
  beforeEach(async () => {
    tmpRoot = mkdtempSync(join(tmpdir(), 'hidock-wiki-'))
    cacheDirOverride = null
    // The resume cursor is also held in memory, so it must be cleared between
    // tests or one test's rotation leaks into the next.
    await resetBackfillCursor()
    currentRow = null
    backfillRows = []
    rowById = null
    configStore = new Map<string, string>()
    excludedResult = { ids: new Set<string>(), failClosed: false }
  })

  afterEach(() => {
    rmSync(tmpRoot, { recursive: true, force: true })
  })

  // Tolerates an absent dir: a pass that writes nothing never creates it.
  const listWiki = (): string[] => {
    try {
      return readdirSync(join(tmpRoot, 'wiki')).filter((f) => f.endsWith('.md')).sort()
    } catch {
      return []
    }
  }

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
 * Ownership drives DESTRUCTIVE work — stale-page cleanup and the privacy
 * hard-purge — so "which recording does this page belong to?" must never be
 * answered by a guess. Adversarial review flagged the original bounded 4 KB
 * head-read: recording_id is preceded by arbitrary title/source_file values, so
 * it is not guaranteed to sit in any fixed prefix.
 */
describe('wiki page ownership — safe for deletion (adversarial review #1)', () => {
  beforeEach(async () => {
    tmpRoot = mkdtempSync(join(tmpdir(), 'hidock-wiki-own-'))
    cacheDirOverride = null
    // The resume cursor is also held in memory, so it must be cleared between
    // tests or one test's rotation leaks into the next.
    await resetBackfillCursor()
    currentRow = null
    backfillRows = []
    rowById = null
    configStore = new Map<string, string>()
    excludedResult = { ids: new Set<string>(), failClosed: false }
  })

  afterEach(() => {
    rmSync(tmpRoot, { recursive: true, force: true })
    vi.restoreAllMocks()
  })

  const wikiDir = () => join(tmpRoot, 'wiki')
  const listWiki = (): string[] => {
    try {
      return readdirSync(wikiDir()).filter((f) => f.endsWith('.md')).sort()
    } catch {
      return []
    }
  }

  it('attributes a page whose recording_id sits far past any fixed head window', async () => {
    const { exportMeetingWiki, removeMeetingWiki } = await import('../meeting-wiki')

    // A title long enough to push `recording_id` well beyond a 4 KB prefix — the
    // exact case the bounded head-read would have silently missed.
    currentRow = {
      recording_id: 'rec-deep',
      full_text: 'contenido',
      title_suggestion: 'T'.repeat(9000),
      date_recorded: '2026-07-07T00:00:00.000Z'
    }
    expect(exportMeetingWiki('rec-deep')).not.toBeNull()
    expect(listWiki()).toHaveLength(1)

    // The purge must find it. Missing it here would leave purged content on disk.
    expect(removeMeetingWiki('rec-deep').removed).toBe(1)
    expect(listWiki()).toHaveLength(0)
  })

  it('never deletes a page whose frontmatter cannot be parsed, and says so loudly', async () => {
    const { removeMeetingWiki } = await import('../meeting-wiki')
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})

    mkdirSync(wikiDir(), { recursive: true })
    // Opens frontmatter but never closes it — ownership is undeterminable.
    writeFileSync(join(wikiDir(), 'truncated.md'), '---\ntitle: "half written"\nrecording_id: rec-x', 'utf-8')

    expect(removeMeetingWiki('rec-x').removed).toBe(0)
    // Left on disk rather than deleted on a guess...
    expect(listWiki()).toEqual(['truncated.md'])
    // ...and the purge reports that it could not be verified, so a caller is
    // never told a privacy purge was clean when it was not.
    expect(error).toHaveBeenCalled()
    const logged = error.mock.calls.map((c) => String(c[0])).join(' ')
    expect(logged).toContain('could not verify')
    expect(logged).toContain('truncated.md')
  })

  it('ignores a recording_id line that appears in transcript prose, not frontmatter', async () => {
    const { exportMeetingWiki, removeMeetingWiki } = await import('../meeting-wiki')

    currentRow = {
      recording_id: 'rec-real',
      // A transcript that quotes a frontmatter-looking line.
      full_text: 'el agente escribió:\nrecording_id: rec-spoofed\ny continuó',
      title_suggestion: 'Reunion Real',
      date_recorded: '2026-07-07T00:00:00.000Z'
    }
    exportMeetingWiki('rec-real')
    expect(listWiki()).toHaveLength(1)

    // Purging the id that only appears in the body must not touch the page.
    expect(removeMeetingWiki('rec-spoofed').removed).toBe(0)
    expect(listWiki()).toHaveLength(1)
    // The real owner still resolves.
    expect(removeMeetingWiki('rec-real').removed).toBe(1)
  })

  /**
   * Re-review #1: title_suggestion is model output over user transcripts. A
   * title containing a newline used to write a SECOND `recording_id:` line into
   * the frontmatter ahead of the real one — and the reader took the first match,
   * so purging the injected id deleted a page belonging to another recording.
   */
  it('a multi-line title cannot smuggle an ownership line into the frontmatter', async () => {
    const { exportMeetingWiki, removeMeetingWiki } = await import('../meeting-wiki')

    currentRow = {
      recording_id: 'rec-owner',
      full_text: 'contenido',
      // The payload: close the quoted scalar, claim another recording, and try
      // to terminate the frontmatter early.
      title_suggestion: 'Reunion"\nrecording_id: rec-victim\n---\ntrailing',
      date_recorded: '2026-07-07T00:00:00.000Z'
    }
    exportMeetingWiki('rec-owner')
    const pages = listWiki()
    expect(pages).toHaveLength(1)

    const body = readFileSync(join(wikiDir(), pages[0]), 'utf-8')
    // The whole title is one escaped scalar on one line.
    expect(body).toContain('\\nrecording_id: rec-victim\\n---')
    // Exactly one real ownership line exists.
    expect(body.split(/\r?\n/).filter((l) => /^recording_id:/.test(l))).toEqual([
      'recording_id: rec-owner'
    ])

    // Destructive cleanup cannot be redirected to the injected id...
    expect(removeMeetingWiki('rec-victim').removed).toBe(0)
    expect(listWiki()).toHaveLength(1)
    // ...and the real owner still resolves.
    expect(removeMeetingWiki('rec-owner').removed).toBe(1)
    expect(listWiki()).toHaveLength(0)
  })

  it('escapes every YAML line break, not just LF', async () => {
    const { exportMeetingWiki, removeMeetingWiki } = await import('../meeting-wiki')

    currentRow = {
      recording_id: 'rec-sep',
      full_text: 'contenido',
      // CR, NEL, LINE SEPARATOR and PARAGRAPH SEPARATOR are all YAML breaks.
      title_suggestion: 'A\rrecording_id: v1recording_id: v2 recording_id: v3 x',
      date_recorded: '2026-07-07T00:00:00.000Z'
    }
    exportMeetingWiki('rec-sep')

    const body = readFileSync(join(wikiDir(), listWiki()[0]), 'utf-8')
    expect(body.split(/\r?\n/).filter((l) => /^recording_id:/.test(l))).toEqual([
      'recording_id: rec-sep'
    ])
    expect(removeMeetingWiki('v2').removed).toBe(0)
    expect(listWiki()).toHaveLength(1)
  })

  it('treats a page with two ownership claims as unverifiable, never as owned by the first', async () => {
    const { removeMeetingWiki } = await import('../meeting-wiki')
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})

    // A legacy page written before frontmatter values were escaped. `date` must
    // follow `title` — that pair is the old writer's fingerprint, and without it
    // the page is simply someone else's document.
    mkdirSync(wikiDir(), { recursive: true })
    writeFileSync(
      join(wikiDir(), 'legacy.md'),
      '---\ntitle: "Reunion"\ndate: 2026-07-07\nrecording_id: rec-victim\nrecording_id: rec-owner\n---\n\n# Reunion\n',
      'utf-8'
    )

    // Neither claim may be acted on.
    expect(removeMeetingWiki('rec-victim').removed).toBe(0)
    expect(removeMeetingWiki('rec-owner').removed).toBe(0)
    expect(listWiki()).toEqual(['legacy.md'])
    expect(error.mock.calls.map((c) => String(c[0])).join(' ')).toContain('2 recording_id values')
  })

  /**
   * Re-review #1: every page ALREADY on disk was produced by the old
   * serializer, which escaped only `\` and `"`. Those pages are the exact
   * population the legacy handling exists to protect, and they must never read
   * as a plain "no recording_id here" file — that answer makes the privacy
   * purge silently retain the real owner's content AND report nothing.
   */
  describe('pages written by the OLD serializer', () => {
    /** Verbatim reproduction of the pre-fix escaper. */
    const legacyEscape = (v: string): string =>
      `"${v.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`

    /** Verbatim reproduction of the pre-fix frontmatter writer. */
    const legacyPage = (title: string, recordingId: string, opts: { bom?: boolean } = {}): string => {
      const fm = [
        '---',
        `title: ${legacyEscape(title)}`,
        'date: 2026-07-07',
        `recording_id: ${recordingId}`,
        '---'
      ].join('\n')
      return `${opts.bom ? '﻿' : ''}${fm}\n\n# ${title}\n\ncontenido\n`
    }

    const write = (name: string, body: string): void => {
      mkdirSync(wikiDir(), { recursive: true })
      writeFileSync(join(wikiDir(), name), body, 'utf-8')
    }

    it('an embedded --- makes the page unverifiable, not silently unowned', async () => {
      const { removeMeetingWiki } = await import('../meeting-wiki')
      const error = vi.spyOn(console, 'error').mockImplementation(() => {})

      // The hole: the injected terminator cuts the block before the real
      // recording_id, so the block parses to ZERO ids.
      write('legacy-term.md', legacyPage('x\n---\nrecording_id: rec-victim', 'rec-owner'))

      // Neither the injected id nor the real one may be acted on...
      expect(removeMeetingWiki('rec-victim').removed).toBe(0)
      expect(removeMeetingWiki('rec-owner').removed).toBe(0)
      expect(listWiki()).toEqual(['legacy-term.md'])
      // ...and the retained content IS reported, rather than passing as a clean purge.
      const logged = error.mock.calls.map((c) => String(c[0])).join(' ')
      expect(logged).toContain('could not verify')
      expect(logged).toContain('legacy-term.md')
    })

    it('reads a BOM-prefixed page normally instead of writing it off as foreign', async () => {
      const { removeMeetingWiki } = await import('../meeting-wiki')
      write('legacy-bom.md', legacyPage('Reunion Normal', 'rec-bom', { bom: true }))

      // A BOM used to fail the opening-delimiter test, so the page read as
      // unowned and survived its own purge.
      expect(removeMeetingWiki('rec-bom').removed).toBe(1)
      expect(listWiki()).toHaveLength(0)
    })

    it.each([
      ['CR', '\r'],
      ['NEL (U+0085)', ''],
      ['LS (U+2028)', ' '],
      ['PS (U+2029)', ' ']
    ])('a %s in a legacy title cannot redirect the purge', async (_label, sep) => {
      const { removeMeetingWiki } = await import('../meeting-wiki')
      write('legacy-sep.md', legacyPage(`x${sep}recording_id: rec-victim${sep}y`, 'rec-owner'))

      // The injected claim is never honored...
      expect(removeMeetingWiki('rec-victim').removed).toBe(0)
      expect(listWiki()).toEqual(['legacy-sep.md'])
      // ...and the page still resolves to its true owner.
      expect(removeMeetingWiki('rec-owner').removed).toBe(1)
      expect(listWiki()).toHaveLength(0)
    })

    /**
     * Re-review #1: the old serializer allowed a RAW newline in titles. A title
     * containing one followed by `recording_id:` — with no injected terminator —
     * leaves an unterminated `title`, then the injected id, then the writer's
     * real id. Requiring `entries.length === 1` for the truncated case
     * classified that genuine legacy page as FOREIGN, and foreign pages with
     * multiple ids resolve to `unowned`: the file was RETAINED through BOTH
     * owners' privacy purges with nothing reported at all.
     */
    it('a legacy multiline title (no terminator) is reported, never silently retained', async () => {
      const { removeMeetingWiki } = await import('../meeting-wiki')
      const error = vi.spyOn(console, 'error').mockImplementation(() => {})

      write('legacy-multiline.md', legacyPage('x\nrecording_id: rec-victim', 'rec-owner'))

      // Sanity: this really is the three-entry shape, not a truncated block.
      const body = readFileSync(join(wikiDir(), 'legacy-multiline.md'), 'utf-8')
      expect(body).toContain('title: "x\nrecording_id: rec-victim"')
      expect(body).toContain('recording_id: rec-owner')

      // Neither owner's purge may delete it — it is unverifiable...
      expect(removeMeetingWiki('rec-victim').removed).toBe(0)
      expect(removeMeetingWiki('rec-owner').removed).toBe(0)
      expect(listWiki()).toEqual(['legacy-multiline.md'])

      // ...and BOTH purges must say so, rather than reporting a clean sweep
      // while private transcript content stays on disk.
      const logged = error.mock.calls.map((c) => String(c[0]))
      const reports = logged.filter((m) => m.includes('could not verify'))
      expect(reports).toHaveLength(2)
      expect(reports.every((m) => m.includes('legacy-multiline.md'))).toBe(true)
      // The block is not provably clean — that alone is enough to refuse it.
      expect(reports[0]).toContain('unterminated quoted value')
    })

    /**
     * Final review: an old title of `x\nrecording_id: rec-victim\n---` produces
     * two entries before an EARLY terminator with no surviving `date`. Every
     * shape-fingerprint arm returned false, the page became foreign, and its
     * single injected id was attributed to rec-victim — so purging rec-victim
     * DELETED THE REAL OWNER'S PAGE. Enumerating shapes could not close this;
     * requiring the block to be provably clean does.
     */
    it('an injected id before an early terminator cannot redirect a deletion', async () => {
      const { removeMeetingWiki } = await import('../meeting-wiki')
      const error = vi.spyOn(console, 'error').mockImplementation(() => {})

      write('legacy-early-id.md', legacyPage('x\nrecording_id: rec-victim\n---', 'rec-owner'))

      // The injected claim must NOT delete the real owner's page...
      expect(removeMeetingWiki('rec-victim').removed).toBe(0)
      expect(listWiki()).toEqual(['legacy-early-id.md'])
      // ...and neither may the real owner's own purge act on it blindly.
      expect(removeMeetingWiki('rec-owner').removed).toBe(0)
      expect(listWiki()).toEqual(['legacy-early-id.md'])

      const reports = error.mock.calls
        .map((c) => String(c[0]))
        .filter((m) => m.includes('could not verify'))
      expect(reports).toHaveLength(2)
      expect(reports.every((m) => m.includes('legacy-early-id.md'))).toBe(true)
      expect(reports.every((m) => m.includes('unterminated quoted value'))).toBe(true)
    })

    it('a non-id injected key before an early terminator is reported, not silently kept', async () => {
      const { removeMeetingWiki } = await import('../meeting-wiki')
      const error = vi.spyOn(console, 'error').mockImplementation(() => {})

      // Same cut, but the smuggled key is not an ownership claim. Previously the
      // page simply survived its real owner's purge with nothing reported.
      write('legacy-early-key.md', legacyPage('x\nfoo: bar\n---', 'rec-owner'))

      expect(removeMeetingWiki('rec-owner').removed).toBe(0)
      expect(listWiki()).toEqual(['legacy-early-key.md'])
      const logged = error.mock.calls.map((c) => String(c[0])).join(' ')
      expect(logged).toContain('could not verify')
      expect(logged).toContain('legacy-early-key.md')
    })

    it('a clean legacy page (no marker) is still owned and purgeable', async () => {
      const { removeMeetingWiki } = await import('../meeting-wiki')
      const error = vi.spyOn(console, 'error').mockImplementation(() => {})

      write('legacy-clean.md', legacyPage('Reunion de Equipo', 'rec-clean'))

      // Well-formed with exactly one claim — no marker needed to act on it.
      expect(removeMeetingWiki('rec-clean').removed).toBe(1)
      expect(listWiki()).toHaveLength(0)
      expect(error).not.toHaveBeenCalled()
    })

    it('a NEW page carries the generator marker and round-trips', async () => {
      const { exportMeetingWiki, removeMeetingWiki } = await import('../meeting-wiki')

      currentRow = {
        recording_id: 'rec-marked',
        full_text: 'contenido',
        title_suggestion: 'Reunion Marcada',
        date_recorded: '2026-07-07T00:00:00.000Z'
      }
      exportMeetingWiki('rec-marked')

      const body = readFileSync(join(wikiDir(), listWiki()[0]), 'utf-8')
      const lines = body.split(/\r?\n/)
      // Identity FIRST, ahead of every user- and model-derived value, so a value
      // that truncates the block cannot take the marker with it.
      expect(lines[0]).toBe('---')
      expect(lines[1]).toBe('generator: hidock-meeting-wiki')
      expect(lines[2]).toBe('wiki_schema: 1')

      expect(removeMeetingWiki('rec-marked').removed).toBe(1)
      expect(listWiki()).toHaveLength(0)
    })

    it('a NEW page whose title truncates the block is still recognized as ours', async () => {
      const { exportMeetingWiki } = await import('../meeting-wiki')
      const error = vi.spyOn(console, 'error').mockImplementation(() => {})

      // The current writer escapes this, so it cannot happen through export —
      // but simulate the block being cut mid-title to prove the marker survives
      // in front of it and still routes the page into the ours-branch.
      currentRow = {
        recording_id: 'rec-cut',
        full_text: 'contenido',
        title_suggestion: 'Normal',
        date_recorded: '2026-07-07T00:00:00.000Z'
      }
      exportMeetingWiki('rec-cut')
      const name = listWiki()[0]
      writeFileSync(
        join(wikiDir(), name),
        '---\ngenerator: hidock-meeting-wiki\nwiki_schema: 1\ntitle: "cortado\n---\nrecording_id: rec-victim"\n---\n',
        'utf-8'
      )

      const { removeMeetingWiki } = await import('../meeting-wiki')
      // Not attributed to the injected id, and reported rather than ignored.
      expect(removeMeetingWiki('rec-victim').removed).toBe(0)
      expect(listWiki()).toEqual([name])
      expect(error.mock.calls.map((c) => String(c[0])).join(' ')).toContain('could not verify')
    })

    it('re-exporting a legacy injected page repairs it', async () => {
      const { exportMeetingWiki, removeMeetingWiki } = await import('../meeting-wiki')

      const title = 'x\n---\nrecording_id: rec-victim'
      // Same filename the new writer derives from this title, so the repair
      // lands on the existing page rather than beside it.
      write('2026-07-07-x-recording-id-rec-victim.md', legacyPage(title, 'rec-owner'))

      currentRow = {
        recording_id: 'rec-owner',
        full_text: 'contenido',
        title_suggestion: title,
        date_recorded: '2026-07-07T00:00:00.000Z'
      }
      exportMeetingWiki('rec-owner')

      // After the rewrite the page is attributable again and purges cleanly.
      expect(removeMeetingWiki('rec-owner').removed).toBe(1)
      expect(listWiki()).toHaveLength(0)
    })
  })

  /**
   * Re-review #2: classifying ANY `recording_id:` line after the block as
   * corruption meant ordinary body prose landed in the unreadable list, and
   * every privacy purge then warned that content might remain. A report that
   * cries wolf is a report the user stops reading.
   */
  it('does not flag a foreign page whose BODY merely mentions recording_id', async () => {
    const { removeMeetingWiki } = await import('../meeting-wiki')
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})

    mkdirSync(wikiDir(), { recursive: true })
    writeFileSync(
      join(wikiDir(), 'mis-notas.md'),
      [
        '---',
        'title: "Mis notas"',
        '---',
        '',
        '# Mis notas',
        '',
        'El formato de la pagina es asi:',
        '',
        'recording_id: rec-ejemplo',
        '',
        'y despues sigue el texto.',
        ''
      ].join('\n'),
      'utf-8'
    )

    // A page with no declaration of its own is simply not ours: never deleted...
    expect(removeMeetingWiki('rec-ejemplo').removed).toBe(0)
    expect(listWiki()).toEqual(['mis-notas.md'])
    // ...and NOT reported as unverifiable, which would make every purge noisy.
    expect(error).not.toHaveBeenCalled()
  })

  /**
   * Re-review: corruption analysis is only meaningful on pages WE generated.
   * Inferring it from shape meant any sufficiently frontmatter-like body — an
   * unfenced YAML example in someone's documentation — read as corruption and
   * made the privacy purge warn about content that was never ours. Foreign pages
   * are now inert: never analyzed, never flagged, never deleted.
   */
  describe('foreign pages are inert', () => {
    const foreign = async (name: string, body: string): Promise<string> => {
      const { removeMeetingWiki } = await import('../meeting-wiki')
      const error = vi.spyOn(console, 'error').mockImplementation(() => {})
      mkdirSync(wikiDir(), { recursive: true })
      writeFileSync(join(wikiDir(), name), body, 'utf-8')

      // Never deleted...
      expect(removeMeetingWiki('rec-example').removed).toBe(0)
      expect(listWiki()).toEqual([name])
      return error.mock.calls.map((c) => String(c[0])).join(' ')
    }

    it('an UNFENCED frontmatter example right after the real terminator', async () => {
      // The exact shape that defeated the structural heuristic: a declaration
      // followed by a `---`, with no prose in front of it to force an early exit.
      const logged = await foreign(
        'docs-unfenced.md',
        [
          '---',
          'title: "Como escribir una pagina"',
          '---',
          'recording_id: rec-example',
          'date: 2026-07-07',
          '---',
          '',
          'Ese es el formato.',
          ''
        ].join('\n')
      )
      expect(logged).toBe('')
    })

    it('a FENCED example', async () => {
      const logged = await foreign(
        'docs-fenced.md',
        [
          '---',
          'title: "Guia"',
          '---',
          '',
          '# Guia',
          '',
          '```yaml',
          'recording_id: rec-example',
          '```',
          ''
        ].join('\n')
      )
      expect(logged).toBe('')
    })

    /**
     * Re-review #2: `marked` was returned for ANY top-level generator key,
     * regardless of position, schema value, or duplicates — so a page that
     * merely documents this format entered the ours-only corruption analysis.
     * The contract is "the first two keys are the marker"; these pin it.
     */
    it.each([
      [
        'marker with no schema key',
        ['---', 'generator: hidock-meeting-wiki', 'title: "Sin schema"', '---']
      ],
      [
        'reordered identity pair',
        ['---', 'wiki_schema: 1', 'generator: hidock-meeting-wiki', 'title: "Al reves"', '---']
      ],
      [
        'unsupported schema value',
        ['---', 'generator: hidock-meeting-wiki', 'wiki_schema: 7', 'title: "Futuro"', '---']
      ],
      [
        'duplicate conflicting generator keys',
        [
          '---',
          'generator: hidock-meeting-wiki',
          'wiki_schema: 1',
          'generator: something-else',
          'title: "Ambiguo"',
          '---'
        ]
      ],
      [
        'marker present but not first',
        [
          '---',
          'title: "Primero el titulo"',
          'generator: hidock-meeting-wiki',
          'wiki_schema: 1',
          '---'
        ]
      ],
      // Identity values are matched as RAW LEXICAL TOKENS. Unquoting and
      // Number() coercion previously let all of these into ours-analysis, though
      // the writer emits none of them.
      [
        'quoted generator value',
        ['---', 'generator: "hidock-meeting-wiki"', 'wiki_schema: 1', '---']
      ],
      [
        'quoted schema value',
        ['---', 'generator: hidock-meeting-wiki', 'wiki_schema: "1"', '---']
      ],
      [
        'padded schema value',
        ['---', 'generator: hidock-meeting-wiki', 'wiki_schema: 1   ', '---']
      ],
      [
        'leading-zero schema value',
        ['---', 'generator: hidock-meeting-wiki', 'wiki_schema: 01', '---']
      ],
      [
        'decimal schema value',
        ['---', 'generator: hidock-meeting-wiki', 'wiki_schema: 1.0', '---']
      ],
      [
        'exponent schema value',
        ['---', 'generator: hidock-meeting-wiki', 'wiki_schema: 1e0', '---']
      ],
      [
        'signed schema value',
        ['---', 'generator: hidock-meeting-wiki', 'wiki_schema: +1', '---']
      ],
      [
        'hex schema value',
        ['---', 'generator: hidock-meeting-wiki', 'wiki_schema: 0x1', '---']
      ]
    ])('is foreign: %s', async (_label, frontmatter) => {
      // Each of these has zero recording_id declarations, so if it were wrongly
      // treated as ours it would be flagged as a generated page missing its id.
      const logged = await foreign('identity.md', `${frontmatter.join('\n')}\n\n# Pagina\n`)
      expect(logged).toBe('')
    })

    it('a page that DOCUMENTS the marker format in its body', async () => {
      const logged = await foreign(
        'docs-format.md',
        [
          '---',
          'title: "Formato de las paginas wiki"',
          '---',
          '',
          '# Formato',
          '',
          'Cada pagina empieza asi:',
          '',
          'generator: hidock-meeting-wiki',
          'wiki_schema: 1',
          'recording_id: rec-example',
          '---',
          ''
        ].join('\n')
      )
      expect(logged).toBe('')
    })

    it('a QUOTED example', async () => {
      const logged = await foreign(
        'docs-quoted.md',
        [
          '---',
          'title: "Guia"',
          '---',
          '',
          'Se declara asi: `recording_id: rec-example`',
          '',
          '> recording_id: rec-example',
          ''
        ].join('\n')
      )
      expect(logged).toBe('')
    })
  })

  /**
   * Re-review #3: the post-block inspection window shared the 256 KiB budget
   * used to LOCATE the terminator, so a terminator near that cap left no room to
   * look past it and a malformed page read as `unowned` — the very outcome the
   * classification rule exists to prevent.
   */
  describe('terminator sitting at the byte cap', () => {
    const MAX_FRONTMATTER_BYTES = 256 * 1024

    /**
     * One of OUR pages (carrying the generator marker) whose frontmatter block
     * ends ~8 bytes before the locating cap, with a frontmatter-shaped tail
     * placing `recording_id:` at `offset` bytes past it.
     */
    const pageWithLateTerminator = (offset: number): string => {
      const head = '---\ngenerator: hidock-meeting-wiki\nwiki_schema: 1\nnote: "'
      const close = '"\n---\n'
      const padding = 'x'.repeat(MAX_FRONTMATTER_BYTES - head.length - close.length - 8)
      // Whole filler LINES only — slicing mid-line would splice the filler into
      // the recording_id line and change what is being tested.
      let tail = ''
      for (let i = 0; tail.length < offset; i++) tail += `pad${i}: filler\n`
      return head + padding + close + tail + 'recording_id: rec-late\n---\n'
    }

    /** The purge report carries the reason each page could not be verified. */
    const purgeReport = async (name: string, body: string): Promise<string> => {
      const { removeMeetingWiki } = await import('../meeting-wiki')
      const error = vi.spyOn(console, 'error').mockImplementation(() => {})
      mkdirSync(wikiDir(), { recursive: true })
      writeFileSync(join(wikiDir(), name), body, 'utf-8')

      expect(removeMeetingWiki('rec-late').removed).toBe(0)
      expect(listWiki()).toEqual([name])
      return error.mock.calls.map((c) => String(c[0])).join(' ')
    }

    it.each([0, 2000, 7000])(
      'still detects a continuation %i bytes past the cap-adjacent terminator',
      async (offset) => {
        const logged = await purgeReport('late.md', pageWithLateTerminator(offset))

        expect(logged).toContain('could not verify')
        // The SPECIFIC reason proves the post-block window was actually read —
        // without the two-phase budget this page reports the generic reason below.
        expect(logged).toContain('continues past the terminator')
      }
    )

    it('falls back to the generic reason beyond the documented 8 KiB window', async () => {
      const logged = await purgeReport('far.md', pageWithLateTerminator(9000))

      // Still unverifiable (it is our page and declares no recording_id), but the
      // continuation is NOT claimed — the window is a bounded, documented limit
      // rather than an unbounded scan of every page.
      expect(logged).toContain('declares no recording_id')
      expect(logged).not.toContain('continues past the terminator')
    })
  })

  it('re-checks ownership at delete time — a page rewritten mid-pass is NOT destroyed', async () => {
    const { backfillMeetingWiki } = await import('../meeting-wiki')

    // Page written for rec-A under the title "Shared".
    const shared = '2026-07-07-shared.md'
    backfillRows = [{ recording_id: 'rec-A' }]
    rowById = () => ({
      recording_id: 'rec-A',
      full_text: 'contenido A',
      title_suggestion: 'Shared',
      date_recorded: '2026-07-07T00:00:00.000Z'
    })
    await backfillMeetingWiki()
    expect(listWiki()).toEqual([shared])

    // Next pass: the index is built while `shared` still belongs to rec-A. Before
    // rec-A is processed, another exporter (a transcription finishing during one
    // of the backfill's yields) replaces that same filename with rec-B's page.
    // Deleting on the cached answer here would destroy rec-B's fresh page.
    rowById = () => {
      writeFileSync(
        join(wikiDir(), shared),
        '---\ntitle: "Shared"\nrecording_id: rec-B\n---\n\n# Shared\n\ncontenido B\n',
        'utf-8'
      )
      // rec-A now renders under a NEW title, so cleanup targets the old filename.
      return {
        recording_id: 'rec-A',
        full_text: 'contenido A',
        title_suggestion: 'Renamed A',
        date_recorded: '2026-07-07T00:00:00.000Z'
      }
    }
    await backfillMeetingWiki()

    // rec-B's page survived; rec-A got its renamed page alongside it.
    expect(listWiki()).toContain(shared)
    expect(readFileSync(join(wikiDir(), shared), 'utf-8')).toContain('recording_id: rec-B')
    expect(listWiki()).toHaveLength(2)
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

  beforeEach(async () => {
    tmpRoot = mkdtempSync(join(tmpdir(), 'hidock-wiki-bf-'))
    cacheDirOverride = null
    // The resume cursor is also held in memory, so it must be cleared between
    // tests or one test's rotation leaks into the next.
    await resetBackfillCursor()
    currentRow = null
    backfillRows = []
    configStore = new Map<string, string>()
    excludedResult = { ids: new Set<string>(), failClosed: false }
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

  // Tolerates an absent dir: a pass that writes nothing never creates it.
  const listWiki = (): string[] => {
    try {
      return readdirSync(join(tmpRoot, 'wiki')).filter((f) => f.endsWith('.md')).sort()
    } catch {
      return []
    }
  }

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

  it('reuses the single pass-wide scan when cleaning up excluded recordings too (F15 mixed-corpus guard)', async () => {
    // The all-eligible guard above cannot catch a re-scan on the EXCLUDED-cleanup
    // path: each excluded recording used to call removeMeetingWiki, which re-listed
    // and re-read the whole directory (O(excluded × pages)) — the exact quadratic
    // boot freeze F15 removed, hidden from the guard because it had no excluded rows.
    const { backfillMeetingWiki } = await import('../meeting-wiki')
    vi.spyOn(console, 'log').mockImplementation(() => {})

    // Cold pass writes a page for all N (all eligible).
    await backfillMeetingWiki()
    expect(listWiki()).toHaveLength(N)

    // Now exclude HALF of them — each still has a stale page on disk the backfill
    // must remove. Reset the resume cursor so the pass revisits everything.
    await resetBackfillCursor()
    const excluded = new Set<string>()
    for (let i = 0; i < N; i += 2) excluded.add(`rec-${String(i).padStart(3, '0')}`)
    excludedResult = { ids: excluded, failClosed: false }

    fsCalls.readFile = 0
    fsCalls.readdir = 0
    const result = await backfillMeetingWiki()

    // Assert the scan count BEFORE listWiki() (which itself lists the directory):
    // ONE listing for the entire pass — eligible re-verify AND excluded cleanup.
    expect(fsCalls.readdir).toBe(1)
    expect(fsCalls.readFile).toBeLessThanOrEqual(2 * N)
    expect(result.failed).toBe(0)

    // The excluded half's stale pages are gone; the eligible half remain.
    expect(listWiki()).toHaveLength(N - excluded.size)
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

  it('a persistently failing page does not starve the pages behind it', async () => {
    const { backfillMeetingWiki } = await import('../meeting-wiki')
    vi.spyOn(console, 'error').mockImplementation(() => {})

    // Fake clock: the failing export burns 100ms of "wall time" per attempt.
    // With a 50ms budget, charging that to the deadline would end the pass at the
    // first batch boundary — on this boot and on every boot after it, since the
    // failing row stays at the head of the missing set.
    let clock = 1_000_000
    vi.spyOn(Date, 'now').mockImplementation(() => clock)

    backfillRows = []
    for (let i = 0; i < 10; i++) backfillRows.push({ recording_id: `rec-${i}` })
    rowById = (id) => {
      if (id === 'rec-0') {
        clock += 100
        throw new Error('EACCES: permission denied')
      }
      return {
        recording_id: id,
        full_text: 'contenido',
        title_suggestion: `Reunion ${id}`,
        date_recorded: '2026-07-07T00:00:00.000Z'
      }
    }

    const result = await backfillMeetingWiki({ batchSize: 1, budgetMs: 50 })

    // The nine healthy pages behind the failure were all written in this pass.
    expect(result.failed).toBe(1)
    expect(result.written).toBe(9)
    expect(listWiki()).toHaveLength(9)
    // ...and the failure is still reported as outstanding work, not as progress.
    expect(result.remainingMissing).toBe(1)
  })

  it('counts a failed page as still missing, never as progress', async () => {
    const { backfillMeetingWiki } = await import('../meeting-wiki')
    vi.spyOn(console, 'error').mockImplementation(() => {})

    const base = rowById!
    rowById = (id) => {
      if (id === 'rec-000' || id === 'rec-001') throw new Error('ENOSPC: no space left')
      return base(id)
    }

    const result = await backfillMeetingWiki()

    expect(result.failed).toBe(2)
    expect(result.remaining).toBe(0) // every row was visited
    // But two pages genuinely do not exist, so the wiki is NOT complete.
    expect(result.remainingMissing).toBe(2)
    expect(listWiki()).toHaveLength(N - 2)
  })

  /**
   * Re-review #2: refunding failure time fixed budget consumption, but the loop
   * still BREAKS at maxFailures — and the missing-first ordering is rebuilt
   * identically on every boot, so a block of persistent failures at the head hit
   * the cutoff in the same place forever and the healthy tail was never reached.
   */
  it('healthy rows behind a wall of persistent failures are written on a later pass', async () => {
    const { backfillMeetingWiki } = await import('../meeting-wiki')
    vi.spyOn(console, 'error').mockImplementation(() => {})

    // 50 rows that always fail, sitting ahead of 10 healthy ones — exactly the
    // failure count that trips the default cutoff.
    const base = rowById!
    const doomed = new Set<string>()
    for (let i = 0; i < 50; i++) doomed.add(`rec-${String(i).padStart(3, '0')}`)
    rowById = (id) => {
      if (doomed.has(id)) throw new Error('EACCES: permission denied')
      return base(id)
    }

    // Pass 1 burns its whole attempt budget on the failures and writes nothing.
    const first = await backfillMeetingWiki({ maxFailures: 50 })
    expect(first.failed).toBe(50)
    expect(first.written).toBe(0)
    expect(listWiki()).toHaveLength(0)

    // Pass 2 (a later boot) puts the known-bad ids BEHIND the untried ones, so
    // the healthy rows are reached instead of starving forever.
    const second = await backfillMeetingWiki({ maxFailures: 50 })
    expect(second.written).toBe(N - 50)
    expect(listWiki()).toHaveLength(N - 50)
  })

  /**
   * Re-review #2: a capped set of remembered failures cannot guarantee progress.
   * Above the cap each pass drops a different group, the dropped ids read as
   * never-attempted again, and the passes rotate through groups forever without
   * reaching the healthy rows. The resume cursor is a POSITION, so it advances
   * past every group it attempts regardless of how many failures exist.
   */
  it('healthy rows behind MORE than 500 persistent failures are eventually written', async () => {
    const { backfillMeetingWiki } = await import('../meeting-wiki')
    vi.spyOn(console, 'error').mockImplementation(() => {})

    // 550 permanently failing recordings, then 2 healthy ones. Ids are zero
    // padded so the sort order matches the intended sequence.
    const total = 552
    backfillRows = []
    for (let i = 0; i < total; i++) backfillRows.push({ recording_id: `r-${String(i).padStart(4, '0')}` })
    const healthy = new Set(['r-0550', 'r-0551'])
    rowById = (id) => {
      if (!healthy.has(id)) throw new Error('EACCES: permission denied')
      return {
        recording_id: id,
        full_text: 'contenido',
        title_suggestion: `Reunion ${id}`,
        date_recorded: '2026-07-07T00:00:00.000Z'
      }
    }

    // Each "boot" stops at the 50-failure cutoff. With a capped failure SET this
    // never terminates; with a cursor it must reach the healthy tail.
    let passes = 0
    while (passes < 20 && listWiki().length < 2) {
      await backfillMeetingWiki({ maxFailures: 50 })
      passes++
    }

    expect(listWiki()).toHaveLength(2)
    // 550 failures at 50 per pass = 11 passes spent purely on failures before the
    // healthy tail is reachable. The lower bound proves the scenario really is
    // the multi-pass one and did not converge by accident.
    expect(passes).toBeGreaterThanOrEqual(11)
    expect(passes).toBeLessThanOrEqual(13)
  })

  /**
   * Re-review #1: progress used to live ONLY in the state file, and write
   * failures were swallowed. With an unwritable cache path every pass reloaded
   * "no cursor", retried the same sorted prefix, hit maxFailures in the same
   * place, and never reached the healthy rows — the starvation returning
   * whenever the cache path is unwritable while the wiki destination is not.
   */
  it('advances within the session even when the resume point cannot be persisted', async () => {
    const { backfillMeetingWiki } = await import('../meeting-wiki')
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})

    // Point the state file at a path under a FILE, so mkdir/write both fail.
    const blocker = join(tmpRoot, 'blocker')
    writeFileSync(blocker, 'not a directory', 'utf-8')
    cacheDirOverride = join(blocker, 'cache')

    const base = rowById!
    const doomed = new Set<string>()
    for (let i = 0; i < 50; i++) doomed.add(`rec-${String(i).padStart(3, '0')}`)
    rowById = (id) => {
      if (doomed.has(id)) throw new Error('EACCES: permission denied')
      return base(id)
    }

    const first = await backfillMeetingWiki({ maxFailures: 50 })
    expect(first.failed).toBe(50)
    expect(listWiki()).toHaveLength(0)

    // Second pass in the SAME process: the in-memory cursor carries the position
    // even though nothing reached disk, so the healthy tail is reached.
    const second = await backfillMeetingWiki({ maxFailures: 50 })
    expect(second.written).toBe(N - 50)
    expect(listWiki()).toHaveLength(N - 50)

    // And the inability to persist is reported, not swallowed.
    const logged = error.mock.calls.map((c) => String(c[0])).join(' ')
    expect(logged).toContain('DEGRADED')
    expect(logged).toContain('restart will begin from the start')
  })

  it('persists the resume point atomically, leaving no temp file behind', async () => {
    const { backfillMeetingWiki } = await import('../meeting-wiki')
    await backfillMeetingWiki()

    const cacheDir = join(tmpRoot, 'cache')
    const entries = readdirSync(cacheDir)
    expect(entries).toContain('meeting-wiki-backfill.json')
    // A crash mid-write must not leave a truncated file that parses as "no
    // cursor"; the write goes to a temp path and is renamed into place.
    expect(entries.filter((f) => f.endsWith('.tmp'))).toEqual([])
  })

  it('resumes past the failures it already attempted rather than retrying them first', async () => {
    const { backfillMeetingWiki } = await import('../meeting-wiki')
    vi.spyOn(console, 'error').mockImplementation(() => {})

    const attempted: string[][] = []
    const base = rowById!
    rowById = (id) => {
      attempted[attempted.length - 1].push(id)
      throw new Error('EACCES: permission denied')
    }
    void base

    attempted.push([])
    await backfillMeetingWiki({ maxFailures: 5 })
    attempted.push([])
    await backfillMeetingWiki({ maxFailures: 5 })

    // The second pass starts where the first stopped — no overlap.
    expect(attempted[0]).toHaveLength(5)
    expect(attempted[1]).toHaveLength(5)
    expect(attempted[1].some((id) => attempted[0].includes(id))).toBe(false)
  })

  it('a recovered recording is written on the next pass and stops being outstanding', async () => {
    const { backfillMeetingWiki } = await import('../meeting-wiki')
    vi.spyOn(console, 'error').mockImplementation(() => {})

    const base = rowById!
    let brokenDisk = true
    rowById = (id) => {
      if (brokenDisk && id === 'rec-000') throw new Error('ENOSPC: no space left')
      return base(id)
    }

    const first = await backfillMeetingWiki()
    expect(first.failed).toBe(1)
    expect(first.remainingMissing).toBe(1)

    // The transient condition clears; the quarantined recording recovers.
    brokenDisk = false
    const second = await backfillMeetingWiki()
    expect(second.failed).toBe(0)
    expect(second.remainingMissing).toBe(0)
    expect(listWiki()).toHaveLength(N)

    // And a third pass finds nothing outstanding — it left the retry list.
    const third = await backfillMeetingWiki()
    expect(third.written).toBe(0)
    expect(third.unchanged).toBe(N)
  })

  it('gives up after the failure limit rather than grinding through a dead destination', async () => {
    const { backfillMeetingWiki } = await import('../meeting-wiki')
    vi.spyOn(console, 'error').mockImplementation(() => {})

    rowById = () => {
      throw new Error('EROFS: read-only file system')
    }

    const result = await backfillMeetingWiki({ batchSize: 5, maxFailures: 6 })

    expect(result.failed).toBe(6)
    expect(result.written).toBe(0)
    // Stopped early: the rest is deferred to the next start rather than retried
    // N times against a destination that is clearly not accepting writes.
    expect(result.remaining).toBe(N - 6)
    expect(result.remainingMissing).toBe(N)
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

/**
 * RE7-1 (round-7) — the meeting wiki is an EXPORT surface. A personal /
 * soft-deleted / value-excluded recording must never keep a published wiki page,
 * and export must refuse to (re)create one. All routed through the shared
 * fail-closed eligibility boundary.
 */
describe('meeting-wiki — eligibility gating (RE7-1)', () => {
  beforeEach(async () => {
    tmpRoot = mkdtempSync(join(tmpdir(), 'hidock-wiki-'))
    cacheDirOverride = null
    await resetBackfillCursor()
    currentRow = null
    backfillRows = []
    rowById = null
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
    const partial = await backfillMeetingWiki()
    expect(partial.written).toBe(1)
    expect(listWiki()).toHaveLength(1)

    // Wipe and re-run with an unverifiable lookup → nothing is written at all.
    rmSync(join(tmpRoot, 'wiki'), { recursive: true, force: true })
    excludedResult = { ids: new Set<string>(), failClosed: true }
    const closed = await backfillMeetingWiki()
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
    await backfillMeetingWiki()
    expect(listWiki()).toHaveLength(0)
  })
})

/**
 * RE7-P1b (round-8) — removeMeetingWiki must surface filesystem failures via its
 * result instead of swallowing them, so a privacy transition cannot report
 * success while an excluded recording's page is still readable on disk.
 */
describe('removeMeetingWiki — cleanup result (RE7-P1b)', () => {
  beforeEach(async () => {
    tmpRoot = mkdtempSync(join(tmpdir(), 'hidock-wiki-'))
    cacheDirOverride = null
    await resetBackfillCursor()
    currentRow = null
    backfillRows = []
    rowById = null
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
  beforeEach(async () => {
    tmpRoot = mkdtempSync(join(tmpdir(), 'hidock-wiki-'))
    cacheDirOverride = null
    await resetBackfillCursor()
    currentRow = null
    backfillRows = []
    rowById = null
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

  it('a BACKFILL cleanup that fails is counted, left unresolved, and enqueued for a durable retry', async () => {
    // The boot backfill's excluded-recording branch used to DISCARD
    // removeMeetingWiki's result and mark the item resolved regardless — so a
    // failed unlink / unreadable dir left a stale, readable page while the pass
    // reported failed=0, remainingMissing=0, and enqueued nothing to retry.
    const { backfillMeetingWiki, retryPendingWikiCleanups } = await import('../meeting-wiki')
    vi.spyOn(console, 'warn').mockImplementation(() => {})

    // An excluded recording whose page cannot be removed: a FILE sits where the
    // wiki directory belongs, so the listing throws ENOTDIR (present-but-unreadable
    // ⇒ fail-closed), standing in for a wiki dir unreadable at boot.
    writeFileSync(join(tmpRoot, 'wiki'), 'blocking file')
    backfillRows = [
      { recording_id: 'rec-stuck', full_text: 'x', title_suggestion: 'T', date_recorded: '2026-07-01T00:00:00.000Z' }
    ]
    excludedResult = { ids: new Set(['rec-stuck']), failClosed: false }

    const result = await backfillMeetingWiki()

    // The failed cleanup is COUNTED (not silently resolved with failed=0)…
    expect(result.failed).toBe(1)
    // …the recording is left UNRESOLVED (its page may still be readable on disk)…
    expect(result.remainingMissing).toBe(1)
    // …and a durable retry was ENQUEUED so a later sweep removes the page.
    expect(configStore.has('wiki_cleanup_pending:rec-stuck')).toBe(true)

    // Unblock the directory; the enqueued retry now completes and clears the entry.
    rmSync(join(tmpRoot, 'wiki'), { force: true })
    const swept = retryPendingWikiCleanups()
    expect(swept.cleared).toBe(1)
    expect(configStore.has('wiki_cleanup_pending:rec-stuck')).toBe(false)
  })
})
