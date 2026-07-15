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

import { existsSync, mkdirSync, writeFileSync, readdirSync, readFileSync, unlinkSync } from 'fs'
import { join } from 'path'
import { getTranscriptsPath } from './file-storage'
import { queryAll, queryOne } from './database'
import { isRecordingEligible, filterEligibleRecordingIds } from './recording-eligibility'

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
function removeStaleWikiPages(dir: string, recordingId: string, keepFilename: string): void {
  let entries: string[]
  try {
    entries = readdirSync(dir)
  } catch {
    return // dir just created / unreadable — nothing to clean
  }
  for (const entry of entries) {
    if (!entry.endsWith('.md') || entry === keepFilename) continue
    const full = join(dir, entry)
    try {
      // recording_id sits in the frontmatter near the top; only read the head.
      const head = readFileSync(full, 'utf-8').slice(0, 1000)
      const match = head.match(/^recording_id:\s*(\S+)\s*$/m)
      if (match && match[1] === recordingId) {
        unlinkSync(full)
        console.log(`[MeetingWiki] Removed superseded page ${entry} for ${recordingId}`)
      }
    } catch (e) {
      console.warn(`[MeetingWiki] Could not inspect ${entry} for cleanup:`, e)
    }
  }
}

/**
 * Result of a wiki-page cleanup. `ok` is false when ANY unexpected filesystem
 * error occurred (an unreadable directory that IS present, or a matched page
 * that could not be deleted) — i.e. a page for the recording may STILL be on
 * disk. Callers on a privacy transition (mark-personal / soft-delete /
 * value-rating) MUST surface / retry a `!ok` result rather than reporting
 * success, because the whole point of the removal is that the page is gone.
 * A simply-absent wiki dir is `ok: true` (nothing to remove is success).
 */
export interface WikiCleanupResult {
  /** Pages actually deleted. */
  removed: number
  /** Matched pages that could not be deleted (unlink failed). */
  failed: number
  /** False when a page may still remain due to an FS error (dir unreadable / unlink failed). */
  ok: boolean
}

/**
 * Delete every exported wiki page for a recording (privacy hard-purge). Matches
 * pages by the `recording_id` in their YAML frontmatter, so a page whose title
 * changed is still found. Returns a {@link WikiCleanupResult} that surfaces FS
 * failures (RE7-P1b) instead of silently swallowing them. Safe to call when the
 * wiki dir does not exist.
 */
export function removeMeetingWiki(recordingId: string): WikiCleanupResult {
  const dir = getWikiDir()
  let entries: string[]
  try {
    entries = readdirSync(dir)
  } catch (e) {
    // ENOENT = dir absent = nothing to remove = success. Any OTHER error means a
    // page could still be present and we simply couldn't look — fail-surfaced.
    if ((e as NodeJS.ErrnoException)?.code === 'ENOENT') return { removed: 0, failed: 0, ok: true }
    console.warn(`[MeetingWiki] Could not read wiki dir to purge ${recordingId}:`, e)
    return { removed: 0, failed: 0, ok: false }
  }
  let removed = 0
  let failed = 0
  for (const entry of entries) {
    if (!entry.endsWith('.md')) continue
    const full = join(dir, entry)
    try {
      const head = readFileSync(full, 'utf-8').slice(0, 1000)
      const match = head.match(/^recording_id:\s*(\S+)\s*$/m)
      if (match && match[1] === recordingId) {
        unlinkSync(full)
        removed++
        console.log(`[MeetingWiki] Purged wiki page ${entry} for ${recordingId}`)
      }
    } catch (e) {
      // A matched-but-undeletable page is the dangerous case (page remains).
      failed++
      console.warn(`[MeetingWiki] Could not remove ${entry} for purge:`, e)
    }
  }
  return { removed, failed, ok: failed === 0 }
}

/**
 * RE7-1 (round-7) — reconcile the on-disk wiki page with the recording's
 * eligibility. Called on a personal / soft-delete / value-exclusion TRANSITION
 * (which the transcription pipeline's re-export won't catch, since those
 * transitions don't re-run analysis): remove any already-written page for a
 * now-INELIGIBLE recording. Reversible — the boot backfill / next transcription
 * regenerates the page once the recording is eligible again. Never throws.
 */
export function reconcileWikiEligibility(recordingId: string): WikiCleanupResult | null {
  try {
    if (!isRecordingEligible(recordingId)) {
      const result = removeMeetingWiki(recordingId)
      if (result.removed > 0) {
        console.log(`[MeetingWiki] Removed ${result.removed} page(s) for now-excluded recording ${recordingId}`)
      }
      // RE7-P1b — surface a failed cleanup: a transition MUST NOT report success
      // while the page is still readable on disk. The boot backfill re-attempts
      // removal for excluded recordings, so this also self-heals on next launch.
      if (!result.ok) {
        console.warn(
          `[MeetingWiki] wiki cleanup INCOMPLETE for excluded recording ${recordingId} ` +
            `(removed=${result.removed}, failed=${result.failed}) — page may still be readable; will retry on next backfill`
        )
      }
      return result
    }
  } catch (e) {
    console.warn(`[MeetingWiki] wiki eligibility reconcile failed for ${recordingId}:`, e)
    return { removed: 0, failed: 0, ok: false }
  }
  return null // eligible — nothing to reconcile
}

/** Export (or re-export) the wiki page for one recording. Returns the path. */
export function exportMeetingWiki(recordingId: string): string | null {
  // RE7-1 (round-7) — the wiki markdown is readable by external agents/humans,
  // so an excluded (personal/soft-deleted/value-excluded) recording must never
  // get a page. Fail-closed via the shared boundary; if a page already exists
  // (written while eligible, then trashed) remove it here too.
  if (!isRecordingEligible(recordingId)) {
    removeMeetingWiki(recordingId)
    return null
  }
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

  const dir = getWikiDir()
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })

  const { filename, content } = buildMarkdown(row)
  const path = join(dir, filename)
  writeFileSync(path, content, 'utf-8')
  // Drop any earlier page for this recording that used a different (older) title.
  removeStaleWikiPages(dir, recordingId, filename)
  return path
}

/** Export wiki pages for every transcript that doesn't have one yet. */
export function backfillMeetingWiki(): { written: number; failed: number } {
  const rows = queryAll<{ recording_id: string }>(
    `SELECT recording_id FROM transcripts WHERE TRIM(COALESCE(full_text, '')) != ''`
  )
  // RE7-1 — filter candidates through the shared boundary FAIL-CLOSED: if
  // eligibility can't be established, write nothing rather than export excluded
  // transcripts to disk on boot.
  const { eligible, failClosed } = filterEligibleRecordingIds(rows.map((r) => r.recording_id))
  if (failClosed) {
    console.error('[MeetingWiki] Backfill skipped — recording eligibility unavailable (fail closed)')
    return { written: 0, failed: 0 }
  }
  let written = 0
  let failed = 0
  for (const { recording_id } of rows) {
    if (!eligible.has(recording_id)) {
      // RE7-P1a (round-8) — an excluded transcript (already personal/deleted/
      // low-value, or newly value-classified) may STILL have a stale markdown
      // page from when it was eligible. Don't merely skip — actively remove it,
      // so the plain-files knowledge base can't leak an excluded recording.
      removeMeetingWiki(recording_id)
      continue
    }
    try {
      if (exportMeetingWiki(recording_id)) written++
    } catch (e) {
      failed++
      console.error(`[MeetingWiki] Export failed for ${recording_id}:`, e)
    }
  }
  if (rows.length > 0) {
    console.log(`[MeetingWiki] Backfill: ${written} pages written, ${failed} failed (of ${rows.length})`)
  }
  return { written, failed }
}
