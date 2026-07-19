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
import { StringDecoder } from 'string_decoder'
import { getTranscriptsPath } from './file-storage'
import { queryAll, queryOne } from './database'

/**
 * Ownership of a wiki page, as declared by the `recording_id` in its YAML
 * frontmatter.
 *
 * `error` is deliberately distinct from `unowned`: a page we could not read or
 * whose frontmatter we could not parse must NEVER be treated as "belongs to
 * nobody". Both cleanup and the privacy purge decide what to delete from this,
 * so an unreadable page has to be reported, not silently classified.
 */
type PageOwner =
  | { kind: 'owned'; recordingId: string }
  | { kind: 'unowned' }
  | { kind: 'error'; reason: string }

/** Bytes per read while scanning for the frontmatter terminator. */
const FRONTMATTER_CHUNK_BYTES = 4096
/**
 * Hard cap on frontmatter scanning. `recording_id` is NOT guaranteed to sit near
 * the head — `title` and `source_file` come first and carry arbitrary user
 * values — so we parse forward to the closing `---` rather than assuming a fixed
 * offset. A page whose frontmatter exceeds this is malformed, and is reported as
 * an error rather than assumed unowned.
 */
const MAX_FRONTMATTER_BYTES = 256 * 1024

/** Frontmatter terminator: a line containing only `---`. */
const FRONTMATTER_END_RE = /\r?\n---[ \t]*(?:\r?\n|$)/
const RECORDING_ID_RE = /^recording_id:[ \t]*(\S+)[ \t]*$/m

/** Recording ids parsed out of page frontmatter, so the backfill never re-scans. */
interface WikiIndex {
  dir: string
  /** filename -> recording_id declared in that page's frontmatter */
  owner: Map<string, string>
  /**
   * filename -> why its ownership could not be determined. These are never
   * deleted, and callers that delete on ownership must surface them.
   */
  unreadable: Map<string, string>
}

/**
 * Determine which recording a page declares, reading only as far as the
 * frontmatter terminator.
 *
 * F15: the read used to be `readFileSync(path, 'utf-8').slice(0, 1000)` — the
 * ENTIRE file (often 40 KB+ of transcript) pulled into memory to look at a few
 * lines, once per sibling page per export. Reading incrementally to the
 * terminator keeps that win while removing the assumption that `recording_id`
 * lands inside a fixed prefix.
 *
 * The match is scoped to the frontmatter block, so a `recording_id:` line
 * appearing in transcript prose cannot be mistaken for a declaration.
 */
function readPageOwner(path: string): PageOwner {
  let fd: number | undefined
  try {
    fd = openSync(path, 'r')
    const decoder = new StringDecoder('utf8')
    const buf = Buffer.allocUnsafe(FRONTMATTER_CHUNK_BYTES)
    let text = ''
    let consumed = 0
    let atEof = false

    while (consumed < MAX_FRONTMATTER_BYTES) {
      const bytes = readSync(fd, buf, 0, FRONTMATTER_CHUNK_BYTES, consumed)
      if (bytes === 0) {
        text += decoder.end()
        atEof = true
        break
      }
      consumed += bytes
      text += decoder.write(buf.subarray(0, bytes))

      // Not one of our pages at all (no opening delimiter) — leave it alone.
      if (text.length >= 4 && !/^---\r?\n/.test(text)) return { kind: 'unowned' }

      const end = text.search(FRONTMATTER_END_RE)
      if (end !== -1) {
        const frontmatter = text.slice(0, end)
        const match = frontmatter.match(RECORDING_ID_RE)
        return match ? { kind: 'owned', recordingId: match[1] } : { kind: 'unowned' }
      }
    }

    if (text.length < 4 || !/^---\r?\n/.test(text)) return { kind: 'unowned' }
    return {
      kind: 'error',
      reason: atEof
        ? 'frontmatter is not terminated'
        : `frontmatter exceeds ${MAX_FRONTMATTER_BYTES} bytes`
    }
  } catch (e) {
    return { kind: 'error', reason: e instanceof Error ? e.message : String(e) }
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

/**
 * Scan the wiki directory ONCE and map every page to the recording it belongs
 * to. The backfill reuses this across all recordings instead of re-listing and
 * re-reading the directory for each one, which is what made a restart quadratic.
 *
 * The index is a fast PRE-FILTER only. It can go stale — a yielded backfill lets
 * other exporters write between batches — so every deletion re-reads the page's
 * ownership immediately beforehand (see `unlinkIfStillOwnedBy`).
 */
function buildWikiIndex(dir: string): WikiIndex {
  const owner = new Map<string, string>()
  const unreadable = new Map<string, string>()
  let entries: string[]
  try {
    entries = readdirSync(dir)
  } catch {
    return { dir, owner, unreadable } // dir absent — nothing indexed
  }
  for (const entry of entries) {
    if (!entry.endsWith('.md')) continue
    const result = readPageOwner(join(dir, entry))
    if (result.kind === 'owned') owner.set(entry, result.recordingId)
    else if (result.kind === 'error') unreadable.set(entry, result.reason)
  }
  return { dir, owner, unreadable }
}

/**
 * Delete `entry` only if it STILL declares `recordingId` at this instant.
 *
 * The caller's ownership knowledge may be seconds old (the backfill yields
 * between batches, and `exportMeetingWiki` runs independently when a
 * transcription finishes). If a page were replaced in that window — same
 * filename, different recording — deleting on the cached answer would destroy a
 * page that was just written for a DIFFERENT recording. Re-reading immediately
 * before the unlink closes that window.
 */
function unlinkIfStillOwnedBy(
  dir: string,
  entry: string,
  recordingId: string,
  index?: WikiIndex
): boolean {
  const full = join(dir, entry)
  const current = readPageOwner(full)

  if (current.kind === 'error') {
    console.warn(`[MeetingWiki] Not deleting ${entry}: ownership unverifiable (${current.reason})`)
    index?.owner.delete(entry)
    index?.unreadable.set(entry, current.reason)
    return false
  }
  if (current.kind !== 'owned' || current.recordingId !== recordingId) {
    // Reclassified since the index was built — leave it and correct the index.
    index?.owner.delete(entry)
    if (current.kind === 'owned') index?.owner.set(entry, current.recordingId)
    return false
  }

  try {
    unlinkSync(full)
    index?.owner.delete(entry)
    return true
  } catch (e) {
    console.warn(`[MeetingWiki] Could not remove ${entry}:`, e)
    return false
  }
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
  // With an index the candidates are already known; otherwise scan (single-export
  // path, where one pass over the directory is the whole cost). Either way the
  // index is only a pre-filter — `unlinkIfStillOwnedBy` re-verifies each page.
  const active = index ?? buildWikiIndex(dir)
  const candidates = [...active.owner].filter(
    ([entry, owner]) => entry !== keepFilename && owner === recordingId
  )
  for (const [entry] of candidates) {
    if (unlinkIfStillOwnedBy(dir, entry, recordingId, index)) {
      console.log(`[MeetingWiki] Removed superseded page ${entry} for ${recordingId}`)
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
  const index = buildWikiIndex(dir)
  let removed = 0
  for (const [entry, owner] of [...index.owner]) {
    if (owner !== recordingId) continue
    if (unlinkIfStillOwnedBy(dir, entry, recordingId, index)) {
      removed++
      console.log(`[MeetingWiki] Purged wiki page ${entry} for ${recordingId}`)
    }
  }

  // A privacy purge that could not read every page may have LEFT content behind.
  // Silence would imply a clean purge, so say so loudly — this is the one place
  // where "we could not tell" has to reach the user's logs.
  if (index.unreadable.size > 0) {
    console.error(
      `[MeetingWiki] Purge for ${recordingId} could not verify ${index.unreadable.size} page(s); ` +
        `they were NOT removed and may still contain this recording's content: ` +
        [...index.unreadable].map(([f, why]) => `${f} (${why})`).join(', ')
    )
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
   * Recordings that still have NO page on disk when the pass ended — whether
   * unvisited or attempted-and-failed. Zero means the wiki is complete and any
   * further pass is pure re-verification; this, not `remaining`, is the "is the
   * backfill done?" signal. Derived from what actually materialized, never from
   * how many rows were walked past.
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
  /** Abandon the pass after this many failures (see FAILURE_LIMIT). */
  maxFailures?: number
}

/** Recordings handled between yields — small enough that no batch is felt as a stall. */
const DEFAULT_BATCH_SIZE = 25
/** One boot's share of the main process; the rest carries to the next start. */
const DEFAULT_BUDGET_MS = 15000
/**
 * Failures tolerated in a single pass before giving up. Failures do not consume
 * the time budget (see below), so without a cap a wholly broken destination —
 * disk full, permissions revoked — would grind through every row on every boot.
 */
const DEFAULT_FAILURE_LIMIT = 50

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
 * Now: the directory is indexed ONCE (one readdir + one frontmatter read per
 * page), pages whose bytes are unchanged are left alone, and the loop yields
 * every `batchSize` recordings with a per-pass time budget.
 *
 * ## Idempotent, resumable, and starvation-free
 *
 * The work is derived entirely from the database, so a pass cut short by the
 * budget (or by a quit) resumes on the next boot. Two rules keep that resumption
 * honest:
 *
 *  - Recordings with NO page yet go FIRST, so a budget-limited pass always
 *    advances the set that still needs writing rather than spending its budget
 *    re-verifying pages it already wrote.
 *  - A FAILING recording does not consume the budget: the time it burned is
 *    refunded to the deadline. Otherwise a handful of slow failures parked at the
 *    head of the missing set would exhaust the budget at the same boundary on
 *    every boot and the recordings behind them would never be attempted at all.
 *    `maxFailures` bounds the pass so a wholly broken destination still ends.
 *
 * `remainingMissing` is computed from pages that actually materialized, never
 * from how many rows were walked past — a failure must not read as progress.
 */
export async function backfillMeetingWiki(
  options: WikiBackfillOptions = {}
): Promise<WikiBackfillResult> {
  const batchSize = Math.max(1, options.batchSize ?? DEFAULT_BATCH_SIZE)
  const budgetMs = options.budgetMs ?? DEFAULT_BUDGET_MS
  const failureLimit = Math.max(1, options.maxFailures ?? DEFAULT_FAILURE_LIMIT)
  let deadline = Date.now() + budgetMs

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

  // Recordings from the missing set that ended this pass with a page (or with
  // nothing exportable). This — not `processed` — is what closes out the work.
  const resolvedMissing = new Set<string>()
  const stillMissing = new Set(missing.map((r) => r.recording_id))

  let written = 0
  let unchanged = 0
  let failed = 0
  let processed = 0

  for (const { recording_id } of ordered) {
    const startedAt = Date.now()
    try {
      const result = exportOne(recording_id, dir, index)
      if (result?.changed) written++
      else if (result) unchanged++
      // A null result means there is nothing exportable for this recording; it is
      // resolved, not pending, or it would be "missing" forever.
      if (stillMissing.has(recording_id)) resolvedMissing.add(recording_id)
    } catch (e) {
      failed++
      console.error(`[MeetingWiki] Export failed for ${recording_id}:`, e)
      // Refund the failure's time so failures cannot monopolize the head of
      // every pass and starve the recordings behind them.
      deadline += Date.now() - startedAt
      if (failed >= failureLimit) {
        console.error(
          `[MeetingWiki] Backfill stopped after ${failed} failures; ` +
            `the destination looks unwritable. Remaining work resumes next start.`
        )
        processed++
        break
      }
    }
    processed++

    if (processed % batchSize === 0) {
      // Give the renderer's queued IPC a turn before the next batch.
      await yieldToEventLoop()
      if (Date.now() >= deadline) break
    }
  }

  const remaining = ordered.length - processed
  const remainingMissing = missing.length - resolvedMissing.size

  if (rows.length > 0) {
    console.log(
      `[MeetingWiki] Backfill: ${written} written, ${unchanged} already current, ` +
        `${failed} failed (of ${rows.length})` +
        (remaining > 0 || remainingMissing > 0
          ? `; ${remaining} deferred to the next start (${remainingMissing} still without a page, ` +
            `${budgetMs}ms budget)`
          : '')
    )
  }
  return { written, unchanged, failed, remaining, remainingMissing }
}
