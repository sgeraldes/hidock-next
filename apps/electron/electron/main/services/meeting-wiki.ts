/**
 * Meeting Wiki Exporter
 *
 * Writes one self-contained markdown file per transcribed recording to
 * `<transcriptsPath>/wiki/` — YAML frontmatter (date, title, topics, action
 * items) + summary + key points + full transcript.
 *
 * This is the plain-files knowledge base: readable by the user, by Claude
 * Code, and by any other agent without going through the app or its SQLite
 * database. Files are regenerable at any time from the database.
 */

import {
  existsSync,
  mkdirSync,
  writeFileSync,
  readdirSync,
  readFileSync,
  unlinkSync,
  statSync,
  openSync,
  readSync,
  closeSync
} from 'fs'
import { join } from 'path'
import { getTranscriptsPath } from './file-storage'
import { queryAll, queryOne } from './database'

/**
 * Bytes read from the head of a wiki page when all we need is the
 * `recording_id:` line from its YAML frontmatter (4th line of the file).
 *
 * F15: this used to be `readFileSync(path, 'utf-8').slice(0, 1000)` — i.e. the
 * ENTIRE file (often 40 KB+ of transcript) pulled into memory to look at its
 * first few lines, once per sibling page per export. See `buildWikiIndex`.
 */
const HEAD_BYTES = 4096

/** Recording ids parsed out of page heads, so the backfill never re-scans. */
interface WikiIndex {
  dir: string
  /** filename -> recording_id declared in that page's frontmatter */
  owner: Map<string, string>
}

/**
 * Read only the first `HEAD_BYTES` of a file. Returns '' when unreadable.
 *
 * A byte-length read can split a multi-byte UTF-8 character at the boundary; the
 * frontmatter we match against is ASCII and sits far from the cut, so a mangled
 * trailing character is harmless.
 */
function readHead(path: string): string {
  let fd: number | undefined
  try {
    fd = openSync(path, 'r')
    const buf = Buffer.allocUnsafe(HEAD_BYTES)
    const read = readSync(fd, buf, 0, HEAD_BYTES, 0)
    return buf.toString('utf-8', 0, read)
  } catch {
    return ''
  } finally {
    if (fd !== undefined) {
      try {
        closeSync(fd)
      } catch {
        /* fd already gone */
      }
    }
  }
}

/** Extract the `recording_id` a wiki page declares, or null. */
function ownerOf(head: string): string | null {
  const match = head.match(/^recording_id:\s*(\S+)\s*$/m)
  return match ? match[1] : null
}

/**
 * Scan the wiki directory ONCE and map every page to the recording it belongs
 * to. The backfill reuses this across all recordings instead of re-listing and
 * re-reading the directory for each one, which is what made a restart quadratic.
 */
function buildWikiIndex(dir: string): WikiIndex {
  const owner = new Map<string, string>()
  let entries: string[]
  try {
    entries = readdirSync(dir)
  } catch {
    return { dir, owner } // dir absent — nothing indexed
  }
  for (const entry of entries) {
    if (!entry.endsWith('.md')) continue
    const id = ownerOf(readHead(join(dir, entry)))
    if (id) owner.set(entry, id)
  }
  return { dir, owner }
}

interface WikiRow {
  recording_id: string
  full_text: string
  language?: string
  summary?: string
  action_items?: string
  topics?: string
  key_points?: string
  title_suggestion?: string
  word_count?: number
  filename?: string
  date_recorded?: string
  duration_seconds?: number
}

function parseJsonArray(value?: string): string[] {
  if (!value) return []
  try {
    const parsed = JSON.parse(value)
    return Array.isArray(parsed) ? parsed.map(String) : []
  } catch {
    return []
  }
}

function slugify(text: string): string {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 70)
}

function yamlEscape(value: string): string {
  return `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`
}

export function getWikiDir(): string {
  return join(getTranscriptsPath(), 'wiki')
}

function buildMarkdown(row: WikiRow): { filename: string; content: string } {
  const date = row.date_recorded ? new Date(row.date_recorded) : new Date()
  const dateStr = isNaN(date.getTime()) ? 'unknown-date' : date.toISOString().slice(0, 10)
  const title = row.title_suggestion || row.filename || row.recording_id
  const topics = parseJsonArray(row.topics)
  const actionItems = parseJsonArray(row.action_items)
  const keyPoints = parseJsonArray(row.key_points)

  const fm: string[] = ['---']
  fm.push(`title: ${yamlEscape(title)}`)
  fm.push(`date: ${dateStr}`)
  if (row.filename) fm.push(`source_file: ${yamlEscape(row.filename)}`)
  fm.push(`recording_id: ${row.recording_id}`)
  if (row.language) fm.push(`language: ${row.language}`)
  if (row.duration_seconds) fm.push(`duration_minutes: ${Math.round(row.duration_seconds / 60)}`)
  if (row.word_count) fm.push(`word_count: ${row.word_count}`)
  if (topics.length > 0) {
    fm.push('topics:')
    for (const t of topics) fm.push(`  - ${yamlEscape(t)}`)
  }
  fm.push('---')

  const sections: string[] = [fm.join('\n'), `# ${title}`]

  if (row.summary) {
    sections.push(`## Summary\n\n${row.summary}`)
  }
  if (keyPoints.length > 0) {
    sections.push(`## Key Points\n\n${keyPoints.map((k) => `- ${k}`).join('\n')}`)
  }
  if (actionItems.length > 0) {
    sections.push(`## Action Items\n\n${actionItems.map((a) => `- [ ] ${a}`).join('\n')}`)
  }
  sections.push(`## Transcript\n\n${row.full_text}`)

  return {
    filename: `${dateStr}-${slugify(title) || row.recording_id}.md`,
    content: sections.join('\n\n') + '\n'
  }
}

/**
 * Remove wiki page(s) previously written for `recordingId` whose filename is not
 * `keepFilename`. The filename is derived from the (mutable) title suggestion —
 * falling back to the source filename when analysis fails — so re-transcribing a
 * recording whose title changed writes a NEW file and would otherwise leave the
 * old page orphaned with stale content. Live case (ISSUE-8, Rec43): the first run
 * failed analysis (filename-slug page), the re-run produced a real title and a new
 * page, and the truncated first page lingered. Each page carries its
 * `recording_id` in the YAML frontmatter, so match on that.
 */
function removeStaleWikiPages(
  dir: string,
  recordingId: string,
  keepFilename: string,
  index?: WikiIndex
): void {
  // With an index the owners are already known; otherwise scan (single-export
  // path, where one pass over the directory is the whole cost).
  const owners = index?.owner ?? buildWikiIndex(dir).owner
  for (const [entry, owner] of owners) {
    if (entry === keepFilename || owner !== recordingId) continue
    try {
      unlinkSync(join(dir, entry))
      index?.owner.delete(entry)
      console.log(`[MeetingWiki] Removed superseded page ${entry} for ${recordingId}`)
    } catch (e) {
      console.warn(`[MeetingWiki] Could not remove ${entry} during cleanup:`, e)
    }
  }
}

/**
 * Delete every exported wiki page for a recording (privacy hard-purge). Matches
 * pages by the `recording_id` in their YAML frontmatter, so a page whose title
 * changed is still found. Returns the number of files removed. Safe to call when
 * the wiki dir does not exist.
 */
export function removeMeetingWiki(recordingId: string): number {
  const dir = getWikiDir()
  let removed = 0
  for (const [entry, owner] of buildWikiIndex(dir).owner) {
    if (owner !== recordingId) continue
    try {
      unlinkSync(join(dir, entry))
      removed++
      console.log(`[MeetingWiki] Purged wiki page ${entry} for ${recordingId}`)
    } catch (e) {
      console.warn(`[MeetingWiki] Could not purge ${entry}:`, e)
    }
  }
  return removed
}

/** Load the transcript+recording row a wiki page is rendered from. */
function loadWikiRow(recordingId: string): WikiRow | null {
  const row = queryOne<WikiRow>(
    `SELECT t.recording_id, t.full_text, t.language, t.summary, t.action_items,
            t.topics, t.key_points, t.title_suggestion, t.word_count,
            r.filename, r.date_recorded, r.duration_seconds
     FROM transcripts t
     LEFT JOIN recordings r ON r.id = t.recording_id
     WHERE t.recording_id = ?`,
    [recordingId]
  )
  if (!row || !row.full_text?.trim()) return null
  return row
}

/**
 * Write `content` to `path` unless the file already holds exactly that. Returns
 * true when the disk was actually touched.
 *
 * The page contents are a pure function of the row, so re-exporting an unchanged
 * recording rewrites byte-identical data. Skipping that keeps the boot backfill
 * from rewriting the whole wiki on every restart (needless disk churn, and it
 * bumped every page's mtime, which perturbs file watchers and backup tools). The
 * size check short-circuits the common "definitely changed" case without reading.
 */
function writeIfChanged(path: string, content: string): boolean {
  try {
    if (statSync(path).size === Buffer.byteLength(content, 'utf-8')) {
      if (readFileSync(path, 'utf-8') === content) return false
    }
  } catch {
    /* missing / unreadable — fall through and write */
  }
  writeFileSync(path, content, 'utf-8')
  return true
}

/**
 * Render one recording's page. `index`, when supplied, is reused for the stale-page
 * cleanup instead of re-scanning the directory (see `buildWikiIndex`).
 */
function exportOne(
  recordingId: string,
  dir: string,
  index?: WikiIndex
): { path: string; changed: boolean } | null {
  const row = loadWikiRow(recordingId)
  if (!row) return null

  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })

  const { filename, content } = buildMarkdown(row)
  const path = join(dir, filename)
  const changed = writeIfChanged(path, content)
  index?.owner.set(filename, recordingId)
  // Drop any earlier page for this recording that used a different (older) title.
  removeStaleWikiPages(dir, recordingId, filename, index)
  return { path, changed }
}

/** Export (or re-export) the wiki page for one recording. Returns the path. */
export function exportMeetingWiki(recordingId: string): string | null {
  return exportOne(recordingId, getWikiDir())?.path ?? null
}

export interface WikiBackfillResult {
  /** Pages whose bytes actually changed on disk. */
  written: number
  /** Pages already current — verified and left alone. */
  unchanged: number
  failed: number
  /** Recordings not reached before the time budget ran out. */
  remaining: number
  /**
   * Of `remaining`, those that have no page on disk at all. Zero means the wiki
   * is complete and any further passes are pure re-verification — this, not
   * `remaining`, is the "is the backfill done?" signal.
   */
  remainingMissing: number
}

export interface WikiBackfillOptions {
  /** Recordings processed between event-loop yields. */
  batchSize?: number
  /**
   * Wall-clock budget for one pass. On expiry the pass stops and reports
   * `remaining`; the next boot picks up where this one left off.
   */
  budgetMs?: number
}

/** Recordings handled between yields — small enough that no batch is felt as a stall. */
const DEFAULT_BATCH_SIZE = 25
/** One boot's share of the main process; the rest carries to the next start. */
const DEFAULT_BUDGET_MS = 15000

/** Yield to the event loop so queued renderer IPC is serviced. */
function yieldToEventLoop(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0))
}

/**
 * Re-export the wiki page for every transcript, in bounded batches.
 *
 * ## Why this is async and chunked (F15)
 *
 * This ran as one synchronous pass over every transcript, and each export
 * re-listed the wiki directory and fully read every OTHER page to find stale
 * ones — O(N²) whole-file reads. Measured on the real shape (40 KB pages, every
 * page already present, i.e. what happens on EVERY restart):
 *
 *     N= 25 →    138 ms,    600 reads,   24 MB
 *     N= 50 →    673 ms,  2,450 reads,   98 MB
 *     N=100 →  2,235 ms,  9,900 reads,  397 MB
 *     N=200 → 10,910 ms, 39,800 reads, 1598 MB
 *
 * All of it synchronous on the main process, so no renderer IPC was serviced for
 * the entire stretch — the window went "Not Responding" (F15, evidence img #145).
 *
 * Now: the directory is indexed ONCE (one readdir + a 4 KB head-read per page),
 * pages whose bytes are unchanged are left alone, and the loop yields every
 * `batchSize` recordings with a per-pass time budget.
 *
 * Idempotent and resumable: the work is derived entirely from the database, so a
 * pass cut short by the budget (or by a quit) is simply resumed on the next boot.
 * Recordings with NO page yet are processed first, so a pass that runs out of
 * budget always advances the set that still needs writing — a pass never spends
 * its whole budget re-verifying pages it already wrote and then stalls at the
 * same point on every restart.
 */
export async function backfillMeetingWiki(
  options: WikiBackfillOptions = {}
): Promise<WikiBackfillResult> {
  const batchSize = Math.max(1, options.batchSize ?? DEFAULT_BATCH_SIZE)
  const budgetMs = options.budgetMs ?? DEFAULT_BUDGET_MS
  const deadline = Date.now() + budgetMs

  const rows = queryAll<{ recording_id: string }>(
    `SELECT recording_id FROM transcripts WHERE TRIM(COALESCE(full_text, '')) != ''`
  )

  const dir = getWikiDir()
  // ONE directory scan for the whole pass — the fix for the quadratic blowup.
  const index = buildWikiIndex(dir)

  // Missing pages first (see the resumability note above). Recordings that
  // already have a page are re-verified afterwards, with whatever budget is left.
  const havePage = new Set(index.owner.values())
  const missing = rows.filter((r) => !havePage.has(r.recording_id))
  const ordered = [...missing, ...rows.filter((r) => havePage.has(r.recording_id))]

  let written = 0
  let unchanged = 0
  let failed = 0
  let processed = 0

  for (const { recording_id } of ordered) {
    try {
      const result = exportOne(recording_id, dir, index)
      if (result?.changed) written++
      else if (result) unchanged++
    } catch (e) {
      failed++
      console.error(`[MeetingWiki] Export failed for ${recording_id}:`, e)
    }
    processed++

    if (processed % batchSize === 0) {
      // Give the renderer's queued IPC a turn before the next batch.
      await yieldToEventLoop()
      if (Date.now() >= deadline) break
    }
  }

  const remaining = ordered.length - processed
  // Missing-first ordering means anything still unvisited past the missing block
  // already has a page; only the unvisited tail of that block is truly missing.
  // (Counted from the partition, not from index size — the wiki can hold pages
  // for recordings that are no longer in `rows`, e.g. deleted transcripts.)
  const remainingMissing = Math.max(0, missing.length - Math.min(processed, missing.length))

  if (rows.length > 0) {
    console.log(
      `[MeetingWiki] Backfill: ${written} written, ${unchanged} already current, ` +
        `${failed} failed (of ${rows.length})` +
        (remaining > 0
          ? `; ${remaining} deferred to the next start (${remainingMissing} still without a page, ` +
            `${budgetMs}ms budget)`
          : '')
    )
  }
  return { written, unchanged, failed, remaining, remainingMissing }
}
