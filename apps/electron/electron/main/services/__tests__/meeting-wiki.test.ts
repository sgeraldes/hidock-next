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
  // exportMeetingWiki reads exactly one row per call; return whatever the test set.
  queryOne: (_sql: string, params: unknown[]) =>
    rowById ? rowById(params[0] as string) : currentRow,
  queryAll: () => backfillRows
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
    expect(removeMeetingWiki('rec-deep')).toBe(1)
    expect(listWiki()).toHaveLength(0)
  })

  it('never deletes a page whose frontmatter cannot be parsed, and says so loudly', async () => {
    const { removeMeetingWiki } = await import('../meeting-wiki')
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})

    mkdirSync(wikiDir(), { recursive: true })
    // Opens frontmatter but never closes it — ownership is undeterminable.
    writeFileSync(join(wikiDir(), 'truncated.md'), '---\ntitle: "half written"\nrecording_id: rec-x', 'utf-8')

    expect(removeMeetingWiki('rec-x')).toBe(0)
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
    expect(removeMeetingWiki('rec-spoofed')).toBe(0)
    expect(listWiki()).toHaveLength(1)
    // The real owner still resolves.
    expect(removeMeetingWiki('rec-real')).toBe(1)
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
    expect(removeMeetingWiki('rec-victim')).toBe(0)
    expect(listWiki()).toHaveLength(1)
    // ...and the real owner still resolves.
    expect(removeMeetingWiki('rec-owner')).toBe(1)
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
    expect(removeMeetingWiki('v2')).toBe(0)
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
    expect(removeMeetingWiki('rec-victim')).toBe(0)
    expect(removeMeetingWiki('rec-owner')).toBe(0)
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
      expect(removeMeetingWiki('rec-victim')).toBe(0)
      expect(removeMeetingWiki('rec-owner')).toBe(0)
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
      expect(removeMeetingWiki('rec-bom')).toBe(1)
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
      expect(removeMeetingWiki('rec-victim')).toBe(0)
      expect(listWiki()).toEqual(['legacy-sep.md'])
      // ...and the page still resolves to its true owner.
      expect(removeMeetingWiki('rec-owner')).toBe(1)
      expect(listWiki()).toHaveLength(0)
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

      expect(removeMeetingWiki('rec-marked')).toBe(1)
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
      expect(removeMeetingWiki('rec-victim')).toBe(0)
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
      expect(removeMeetingWiki('rec-owner')).toBe(1)
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
    expect(removeMeetingWiki('rec-ejemplo')).toBe(0)
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
      expect(removeMeetingWiki('rec-example')).toBe(0)
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

      expect(removeMeetingWiki('rec-late')).toBe(0)
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
