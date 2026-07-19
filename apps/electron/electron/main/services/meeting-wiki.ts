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
  renameSync,
  statSync,
  openSync,
  readSync,
  closeSync
} from 'fs'
import { join } from 'path'
import { StringDecoder } from 'string_decoder'
import { getTranscriptsPath, getCachePath } from './file-storage'
import { queryAll, queryOne, run } from './database'
import { isRecordingEligible, filterEligibleRecordingIds } from './recording-eligibility'

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
/** U+FEFF. Written as a code point so no invisible character sits in the source. */
const BOM_CODE_POINT = 0xfeff
/**
 * Hard cap on frontmatter scanning. `recording_id` is NOT guaranteed to sit near
 * the head — `title` and `source_file` come first and carry arbitrary user
 * values — so we parse forward to the closing `---` rather than assuming a fixed
 * offset. A page whose frontmatter exceeds this is malformed, and is reported as
 * an error rather than assumed unowned.
 */
const MAX_FRONTMATTER_BYTES = 256 * 1024
/**
 * Bytes read PAST the terminator when inspecting whether the block really ended
 * there. Budgeted separately from the locating cap above, so a terminator near
 * that cap still gets a full inspection window.
 */
const AFTER_TERMINATOR_SCAN_BYTES = 8192

/** Frontmatter terminator: a line containing only `---`. */
const FRONTMATTER_END_RE = /\r?\n---[ \t]*(?:\r?\n|$)/
/** A top-level `key: value` line inside the frontmatter block. */
const TOP_LEVEL_KEY_RE = /^([A-Za-z_][A-Za-z0-9_-]*):[ \t]*(.*)$/

/**
 * Written into every page we generate, as the FIRST frontmatter key.
 *
 * Ownership analysis is only safe on pages we produced. Without a marker the
 * reader had to infer "is this corrupt?" from shape alone, and any sufficiently
 * frontmatter-like body — an unfenced YAML example in someone's documentation —
 * satisfied the test and made the privacy purge cry wolf. Asking "is this ours?"
 * instead is unambiguous, and it makes foreign documents inert: they are never
 * analyzed, never flagged, never deleted.
 */
const GENERATOR_ID = 'hidock-meeting-wiki'
const WIKI_SCHEMA_VERSION = 1
/**
 * Schema versions this build will still claim as ours. Bumping
 * WIKI_SCHEMA_VERSION must ADD to this set, never replace it: a page written by
 * a newer build is still ours, and treating it as foreign would make it inert —
 * never purged, never reported.
 */
const SUPPORTED_WIKI_SCHEMAS = new Set(['1'])

interface FrontmatterEntry {
  key: string
  /** Trimmed value, for general parsing. */
  value: string
  /** Exactly as written. Identity checks compare this — see `hasIdentityHeader`. */
  raw: string
}

/** Top-level `key: value` entries of a frontmatter block, in order. */
function topLevelEntries(block: string): FrontmatterEntry[] {
  const entries: FrontmatterEntry[] = []
  for (const line of block.split(/\r?\n/)) {
    if (/^\s/.test(line)) continue // nested (list item / block value)
    const match = line.match(TOP_LEVEL_KEY_RE)
    if (match) entries.push({ key: match[1], value: match[2].trim(), raw: match[2] })
  }
  return entries
}

/** True when a double-quoted scalar closes its quote. */
function isClosedQuotedScalar(value: string): boolean {
  let i = 1
  while (i < value.length) {
    if (value[i] === '\\') {
      i += 2
      continue
    }
    if (value[i] === '"') return true
    i++
  }
  return false
}

/**
 * Does the block carry our identity header, EXACTLY as the writer emits it?
 *
 * The contract is "the first two keys are the marker", so it is enforced as
 * written rather than as "a generator key appears somewhere". Values are
 * compared as RAW LEXICAL TOKENS — no unquoting, no numeric coercion — because
 * our writer emits one specific byte sequence and anything else did not come
 * from it. `Number()` in particular accepted `01`, `1.0`, `1e0`, `+1` and `0x1`
 * as schema 1, and unquoting accepted `"hidock-meeting-wiki"`.
 *
 * Duplicate identity keys are rejected outright: if a page declares the marker
 * twice we cannot tell which claim to trust, and our writer never produces that.
 *
 * Being strict here is safe precisely because failing this check no longer means
 * "inert" — it means the page falls through to the fail-safe unmarked rule below,
 * which still attributes a clean single-id page and still reports an ambiguous one.
 */
function hasIdentityHeader(entries: FrontmatterEntry[]): boolean {
  if (entries.filter((e) => e.key === 'generator').length !== 1) return false
  if (entries.filter((e) => e.key === 'wiki_schema').length !== 1) return false

  const [generator, schema] = entries
  if (!generator || generator.key !== 'generator' || generator.raw !== GENERATOR_ID) return false
  if (!schema || schema.key !== 'wiki_schema') return false
  return SUPPORTED_WIKI_SCHEMAS.has(schema.raw)
}

/**
 * Read the `recording_id` declarations out of a completed frontmatter block.
 *
 * Parsed STRUCTURALLY, line by line at the top level, and every occurrence is
 * collected — the caller requires exactly one. Taking the first match instead
 * was the injection payoff: a page carrying two ownership lines (one smuggled in
 * through a multi-line title) would be attributed to whichever came first, and
 * the privacy purge would delete a page belonging to a different recording.
 *
 * Indented lines are list items under a key (`topics:`) and are not declarations.
 */
function parseRecordingIds(entries: FrontmatterEntry[]): string[] {
  return entries
    .filter((e) => e.key === 'recording_id')
    .map((e) => (e.value.startsWith('"') ? unquoteYamlScalar(e.value) : e.value))
    .filter((id) => id.length > 0)
}

/**
 * True when a top-level scalar in the block opens a double quote it never
 * closes — i.e. the block was cut off INSIDE a value.
 *
 * This is the fingerprint of the legacy injection: the old serializer escaped
 * `"` to `\"`, so a payload smuggled through a title could never emit a real
 * closing quote. Any `---` it injected therefore terminates the block while the
 * title's quote is still open. Recognizing that is what keeps such a page from
 * reading as an innocent "no recording_id here" file.
 */
function hasUnterminatedQuotedScalar(entries: FrontmatterEntry[]): boolean {
  return entries.some((e) => e.value.startsWith('"') && !isClosedQuotedScalar(e.value))
}

/**
 * Does the text after an early terminator look like the CONTINUATION of a
 * generated frontmatter block, rather than ordinary page body?
 *
 * Only ever consulted for MARKED pages (see `hasIdentityHeader`), and only to
 * refine the reason reported — a page of ours with no `recording_id` is an error
 * either way. Foreign documents never reach it, which is what keeps an unfenced
 * YAML example in someone's README from being read as corruption.
 */
function looksLikeFrontmatterContinuation(text: string): boolean {
  let sawRecordingId = false
  for (const line of text.split(/\r?\n/)) {
    if (/^---[ \t]*$/.test(line)) return sawRecordingId // reached the real terminator
    if (line.trim() === '') continue
    if (/^\s/.test(line)) continue // nested list item / block continuation
    const match = line.match(TOP_LEVEL_KEY_RE)
    if (!match) return false // prose — this is a page body, not a frontmatter tail
    if (match[1] === 'recording_id' && match[2].trim().length > 0) sawRecordingId = true
  }
  return false // window ran out before a terminator — not enough evidence
}

/** Decode a YAML double-quoted scalar written by `yamlEscape`. */
function unquoteYamlScalar(value: string): string {
  const body = value.replace(/^"/, '').replace(/"$/, '')
  return body.replace(/\\(u[0-9a-fA-F]{4}|.)/g, (_all, esc: string) => {
    if (esc[0] === 'u') return String.fromCodePoint(parseInt(esc.slice(1), 16))
    if (esc === 'n') return '\n'
    if (esc === 'r') return '\r'
    if (esc === 't') return '\t'
    return esc
  })
}

/** Recording ids parsed out of page frontmatter, so the backfill never re-scans. */
interface WikiIndex {
  dir: string
  /**
   * How the directory listing went, so a cleanup that REUSES this index keeps the
   * same fail-closed semantics a fresh scan would have had (RE7-P1b / RE8-P1):
   *   'ok'         — listed successfully; `owner`/`unreadable` are populated.
   *   'absent'     — ENOENT: the dir does not exist ⇒ nothing to remove ⇒ success.
   *   'unreadable' — present but unlistable (ENOTDIR / EACCES) ⇒ a purge that
   *                  reuses this index must fail-closed (the page may still be
   *                  there and we could not look).
   */
  status: 'ok' | 'absent' | 'unreadable'
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
    /**
     * Two-phase budget. The 256 KiB cap bounds the search for the terminator;
     * once it is found the cap is extended so the post-block inspection window
     * is genuinely available. Sharing one budget meant a terminator sitting near
     * the cap left no room to look past it, and a page that should have been
     * classified as corrupt read as `unowned` instead.
     */
    let readCap = MAX_FRONTMATTER_BYTES

    /** Pull the next chunk in; returns false at EOF or at the current cap. */
    const readMore = (): boolean => {
      if (atEof || consumed >= readCap) return false
      const bytes = readSync(fd as number, buf, 0, FRONTMATTER_CHUNK_BYTES, consumed)
      if (bytes === 0) {
        text += decoder.end()
        atEof = true
        return false
      }
      consumed += bytes
      text += decoder.write(buf.subarray(0, bytes))
      // A UTF-8 BOM is invisible to the eye but breaks a literal `^---` test,
      // which used to make every BOM-prefixed page read as "not ours".
      if (consumed === bytes && text.charCodeAt(0) === BOM_CODE_POINT) text = text.slice(1)
      return true
    }

    let end = -1
    /** First index AFTER the terminator line — where the page body starts. */
    let bodyStart = -1
    while (readMore()) {
      // Not one of our pages at all (no opening delimiter) — leave it alone.
      if (text.length >= 4 && !/^---\r?\n/.test(text)) return { kind: 'unowned' }
      const match = FRONTMATTER_END_RE.exec(text)
      if (match) {
        end = match.index
        bodyStart = match.index + match[0].length
        break
      }
    }

    if (text.length < 4 || !/^---\r?\n/.test(text)) return { kind: 'unowned' }
    if (end === -1) {
      return {
        kind: 'error',
        reason: atEof
          ? 'frontmatter is not terminated'
          : `frontmatter exceeds ${MAX_FRONTMATTER_BYTES} bytes`
      }
    }

    const entries = topLevelEntries(text.slice(0, end))
    const ids = parseRecordingIds(entries)
    const unterminated = hasUnterminatedQuotedScalar(entries)

    // --- UNMARKED pages: fail-safe by construction -------------------------
    //
    // We used to ask "does this match a known corruption fingerprint?" and
    // enumerate the shapes the old writer could produce. That is unwinnable —
    // every round surfaced another combination, and the last one attributed an
    // injected id to a page whose REAL owner then lost it to a purge.
    //
    // So the question is inverted: is this block unambiguously clean? Only a
    // provably well-formed block may be acted on. Everything else is reported
    // and retained, without us needing to predict how it got mangled.
    if (!hasIdentityHeader(entries)) {
      if (unterminated) {
        return {
          kind: 'error',
          reason: 'frontmatter block ends inside an unterminated quoted value'
        }
      }
      // Well-formed and silent about ownership: an ordinary foreign document.
      if (ids.length === 0) return { kind: 'unowned' }
      if (ids.length === 1) return { kind: 'owned', recordingId: ids[0] }
      // Well-formed but self-contradictory. Rare for a genuine document, and a
      // page asserting recording ids we cannot reconcile is worth surfacing.
      return {
        kind: 'error',
        reason: `frontmatter declares ${ids.length} recording_id values (${ids.join(', ')})`
      }
    }

    // --- MARKED pages: known to be ours, so integrity IS our business ------

    if (ids.length === 1) return { kind: 'owned', recordingId: ids[0] }
    if (ids.length > 1) {
      return {
        kind: 'error',
        reason: `frontmatter declares ${ids.length} recording_id values (${ids.join(', ')})`
      }
    }
    if (unterminated) {
      return {
        kind: 'error',
        reason: 'frontmatter block ends inside an unterminated quoted value'
      }
    }

    // Zero declarations on a page we generated is itself the anomaly — the
    // writer always emits exactly one. Phase two extends the read budget so the
    // inspection window is available even when the terminator sat right at the
    // locating cap; it only refines the reason reported.
    readCap = consumed + AFTER_TERMINATOR_SCAN_BYTES
    while (text.length < bodyStart + AFTER_TERMINATOR_SCAN_BYTES && readMore()) {
      /* pull the inspection window in */
    }
    // Sliced from AFTER the terminator line, not from the terminator itself —
    // otherwise the structural check sees `---` as its first line and bails.
    const continues = looksLikeFrontmatterContinuation(
      text.slice(bodyStart, bodyStart + AFTER_TERMINATOR_SCAN_BYTES)
    )
    return {
      kind: 'error',
      reason: continues
        ? 'the frontmatter block continues past the terminator it appeared to end at'
        : 'a generated page declares no recording_id'
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
  } catch (e) {
    // Distinguish a truly ABSENT dir (ENOENT — nothing to index, a clean success
    // for any cleanup that reuses this index) from a PRESENT-but-unlistable one
    // (ENOTDIR / EACCES), which a privacy purge MUST treat as failure: the page
    // may still be on disk and we could not look (RE7-P1b / RE8-P1). Carrying the
    // status on the index lets removeMeetingWiki keep those fail-closed semantics
    // while the backfill reuses ONE index instead of re-scanning per recording.
    const status = (e as NodeJS.ErrnoException)?.code === 'ENOENT' ? 'absent' : 'unreadable'
    return { dir, status, owner, unreadable }
  }
  for (const entry of entries) {
    if (!entry.endsWith('.md')) continue
    const result = readPageOwner(join(dir, entry))
    if (result.kind === 'owned') owner.set(entry, result.recordingId)
    else if (result.kind === 'error') unreadable.set(entry, result.reason)
  }
  return { dir, status: 'ok', owner, unreadable }
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

/**
 * Serialize a string as a YAML double-quoted scalar that CANNOT span lines.
 *
 * This is a security boundary, not formatting. `title_suggestion`, `language`
 * and `topics` are model output derived from user transcripts, and the previous
 * version escaped only backslashes and quotes — a value containing a newline
 * followed by `recording_id: <other-recording>` wrote a SECOND ownership line
 * into the frontmatter, ahead of the real one, and the privacy purge would then
 * delete a page belonging to a different recording. No malice required: the
 * model just has to emit a multi-line title.
 *
 * So every character that YAML treats as a line break — LF, CR, NEL (U+0085),
 * LS (U+2028), PS (U+2029) — plus all other control characters are emitted as
 * escape sequences. The result is guaranteed to be one line.
 */
function yamlEscape(value: string): string {
  let out = '"'
  for (const char of value) {
    const code = char.codePointAt(0) as number
    if (char === '\\') out += '\\\\'
    else if (char === '"') out += '\\"'
    else if (char === '\n') out += '\\n'
    else if (char === '\r') out += '\\r'
    else if (char === '\t') out += '\\t'
    else if (
      code < 0x20 || // C0 controls
      code === 0x7f || // DEL
      (code >= 0x80 && code <= 0x9f) || // C1 controls, incl. NEL (0x85)
      code === 0x2028 || // LINE SEPARATOR
      code === 0x2029 // PARAGRAPH SEPARATOR
    ) {
      out += `\\u${code.toString(16).padStart(4, '0')}`
    } else {
      out += char
    }
  }
  return out + '"'
}

/**
 * Identifiers safe to emit as a bare YAML scalar. Anything else is quoted and
 * escaped — `recording_id` comes from the database, and a bare value carrying a
 * line break would be the same injection as above on the one key that decides
 * which recording a page belongs to.
 */
const BARE_SCALAR_RE = /^[A-Za-z0-9._:@-]+$/

function yamlScalar(value: string): string {
  return BARE_SCALAR_RE.test(value) ? value : yamlEscape(value)
}

/** Emit a finite number, or nothing when the value is not usable. */
function yamlNumber(value: unknown): string | null {
  const n = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(n) ? String(n) : null
}

/** Collapse a value to a single line for use in body prose (headings). */
function singleLine(value: string): string {
  return value.replace(/\s+/g, ' ').trim()
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

  // Every interpolated value below is escaped or numerically coerced. A raw
  // interpolation here is an ownership-injection hole — see yamlEscape.
  const fm: string[] = ['---']
  // Identity FIRST, before any user- or model-derived value. If a value ever
  // truncates the block, whatever survives still carries the marker, so the page
  // is still recognized as ours and gets the corruption analysis instead of
  // being mistaken for someone else's document.
  fm.push(`generator: ${GENERATOR_ID}`)
  fm.push(`wiki_schema: ${WIKI_SCHEMA_VERSION}`)
  fm.push(`title: ${yamlEscape(title)}`)
  fm.push(`date: ${dateStr}`)
  if (row.filename) fm.push(`source_file: ${yamlEscape(row.filename)}`)
  fm.push(`recording_id: ${yamlScalar(row.recording_id)}`)
  if (row.language) fm.push(`language: ${yamlScalar(row.language)}`)
  const durationMinutes = row.duration_seconds ? yamlNumber(row.duration_seconds) : null
  if (durationMinutes !== null) fm.push(`duration_minutes: ${Math.round(Number(durationMinutes) / 60)}`)
  const wordCount = row.word_count ? yamlNumber(row.word_count) : null
  if (wordCount !== null) fm.push(`word_count: ${wordCount}`)
  if (topics.length > 0) {
    fm.push('topics:')
    for (const t of topics) fm.push(`  - ${yamlEscape(t)}`)
  }
  fm.push('---')

  const sections: string[] = [fm.join('\n'), `# ${singleLine(title) || row.recording_id}`]

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
  /** Matched pages that could not be verifiably removed (unlink failed, or ownership unreadable). */
  failed: number
  /** False when a page may still remain due to an FS error (dir unreadable / unlink failed). */
  ok: boolean
}

/**
 * Delete every exported wiki page for a recording (privacy hard-purge). Matches
 * pages by the `recording_id` in their YAML frontmatter (via the ownership
 * index), so a page whose title changed is still found. Returns a
 * {@link WikiCleanupResult} that surfaces FS failures (RE7-P1b): `failed` counts
 * pages that matched but could not be verifiably removed — unlink failures plus
 * pages whose ownership could not be read (which may still hold this recording's
 * content). Safe to call when the wiki dir does not exist.
 */
export function removeMeetingWiki(recordingId: string): WikiCleanupResult {
  // Standalone purge (transition reconcile / retry sweep / re-export): build the
  // index once — its `status` carries the ENOENT-vs-unreadable distinction, so the
  // separate readdir probe this used to do is no longer needed — and delegate to
  // the shared cleanup core.
  return removeMeetingWikiUsingIndex(recordingId, buildWikiIndex(getWikiDir()))
}

/**
 * Cleanup core shared by the standalone {@link removeMeetingWiki} and the boot
 * backfill. The backfill passes its PASS-WIDE index so an excluded recording's
 * page is removed WITHOUT a fresh per-recording directory scan — a re-scan per
 * excluded recording was O(excluded × pages) of synchronous readdir + whole-page
 * ownership reads, reintroducing the very F15 boot freeze the single-scan index
 * exists to prevent. Each candidate is still ownership-revalidated immediately
 * before the unlink (`unlinkIfStillOwnedBy` re-reads the page's frontmatter), so
 * reusing a possibly-stale index never deletes a page that now belongs to a
 * DIFFERENT recording.
 *
 * Fail-closed semantics survive index reuse via the index `status`: 'absent'
 * (ENOENT) = nothing to remove = success; 'unreadable' (present but unlistable) =
 * the page may still be there and we could not look = failure (RE7-P1b / RE8-P1).
 */
function removeMeetingWikiUsingIndex(recordingId: string, index: WikiIndex): WikiCleanupResult {
  // ENOENT — truly nothing on disk to purge (a clean success).
  if (index.status === 'absent') return { removed: 0, failed: 0, ok: true }
  // Present-but-unlistable — a privacy purge must report failure (the recording's
  // page may still be there and we could not look).
  if (index.status === 'unreadable') {
    console.warn(`[MeetingWiki] Could not read wiki dir to purge ${recordingId} (present but unlistable) — fail-closed`)
    return { removed: 0, failed: 0, ok: false }
  }
  const dir = index.dir
  let removed = 0
  let unlinkFailed = 0
  for (const [entry, owner] of [...index.owner]) {
    if (owner !== recordingId) continue
    if (unlinkIfStillOwnedBy(dir, entry, recordingId, index)) {
      removed++
      console.log(`[MeetingWiki] Purged wiki page ${entry} for ${recordingId}`)
    } else if (index.owner.get(entry) === recordingId) {
      // Still ours after the pre-delete re-read, yet the unlink did not take —
      // the page remains on disk. (A page that was reclassified or is foreign is
      // dropped from index.owner and is NOT counted here; a page that became
      // unreadable is moved to index.unreadable and counted via its size below.)
      unlinkFailed++
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

  // An unreadable page may still contain this recording's content, so it counts
  // as an incomplete purge (fail-closed) alongside any outright unlink failure.
  const failed = unlinkFailed + index.unreadable.size
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
      // RE8-P1 (round-9) — a transition (mark-personal / soft-delete /
      // value-rating) MUST NOT report success while the page is still readable
      // on disk. On a failed cleanup, ENQUEUE a persistent retry (mirrors the
      // hard-purge pending-cleanup ledger) so the page is removed by a later
      // sweep even if this attempt failed; on success, clear any stale entry.
      if (!result.ok) {
        console.warn(
          `[MeetingWiki] wiki cleanup INCOMPLETE for excluded recording ${recordingId} ` +
            `(removed=${result.removed}, failed=${result.failed}) — page may still be readable; enqueued for retry`
        )
        enqueueWikiCleanupRetry(recordingId)
      } else {
        clearWikiCleanupRetry(recordingId)
      }
      return result
    }
  } catch (e) {
    console.warn(`[MeetingWiki] wiki eligibility reconcile failed for ${recordingId}:`, e)
    return { removed: 0, failed: 0, ok: false }
  }
  return null // eligible — nothing to reconcile
}

const WIKI_CLEANUP_RETRY_PREFIX = 'wiki_cleanup_pending:'

/** RE8-P1 — record that an excluded recording's wiki page could not be removed,
 *  so a later sweep retries it. Persisted in the generic `config` KV table (no
 *  schema change), mirroring the hard-purge pending-cleanup ledger. Never throws. */
function enqueueWikiCleanupRetry(recordingId: string): void {
  try {
    run('INSERT OR REPLACE INTO config (key, value, updated_at) VALUES (?, ?, ?)', [
      `${WIKI_CLEANUP_RETRY_PREFIX}${recordingId}`,
      recordingId,
      new Date().toISOString()
    ])
  } catch (e) {
    console.warn(`[MeetingWiki] could not enqueue wiki-cleanup retry for ${recordingId}:`, e)
  }
}

/** Clear a pending wiki-cleanup retry (page removed, or recording eligible again). */
function clearWikiCleanupRetry(recordingId: string): void {
  try {
    run('DELETE FROM config WHERE key = ?', [`${WIKI_CLEANUP_RETRY_PREFIX}${recordingId}`])
  } catch (e) {
    console.warn(`[MeetingWiki] could not clear wiki-cleanup retry for ${recordingId}:`, e)
  }
}

/**
 * RE8-P1 (round-9) — retry every enqueued wiki-cleanup: for each pending
 * recording, if it is STILL ineligible remove its page (clearing the entry only
 * when the removal succeeds); if it became eligible again, drop the entry. Runs
 * as part of the boot backfill and is safe to call anytime. Returns how many
 * pending entries were cleared. Never throws.
 *
 * F15 (post-merge review) — the sweep shares ONE ownership index across every
 * pending id instead of letting each call `removeMeetingWiki`, which re-listed
 * and re-read the WHOLE wiki directory per id. After a transient failure enqueued
 * N durable retries, that was O(N × pages) of synchronous main-process readdir +
 * whole-page reads on the boot recovery path — reintroducing the very F15 freeze
 * the single-scan backfill index exists to prevent. When called from
 * {@link backfillMeetingWiki} the pass-wide `index` is passed in and reused, so
 * the entire boot (cleanup sweep + backfill) does a SINGLE directory listing;
 * otherwise the index is built lazily on first need, so an all-eligible-again
 * sweep still touches the disk zero times. Each candidate is ownership-revalidated
 * immediately before its unlink (`unlinkIfStillOwnedBy`), so a shared,
 * possibly-stale index never removes a page that now belongs to a DIFFERENT
 * recording, and per-id fail-closed semantics survive index reuse via the index
 * `status` (see `removeMeetingWikiUsingIndex`).
 */
export function retryPendingWikiCleanups(index?: WikiIndex): { cleared: number; stillPending: number } {
  let cleared = 0
  let stillPending = 0
  let rows: Array<{ value: string | null }>
  try {
    rows = queryAll<{ value: string | null }>('SELECT value FROM config WHERE key LIKE ?', [`${WIKI_CLEANUP_RETRY_PREFIX}%`])
  } catch (e) {
    console.warn('[MeetingWiki] could not read pending wiki cleanups:', e)
    return { cleared: 0, stillPending: 0 }
  }
  // Reuse the backfill's pass-wide index when supplied; otherwise build one ONCE,
  // lazily, the first time a still-ineligible id actually needs a removal. Never
  // scans when every pending id turned eligible again. `buildWikiIndex` never
  // throws (readdir errors are captured as an index `status`).
  let sweepIndex = index
  for (const r of rows) {
    const recordingId = r.value
    if (!recordingId) continue
    try {
      if (isRecordingEligible(recordingId)) {
        clearWikiCleanupRetry(recordingId) // eligible again — nothing to purge
        cleared++
        continue
      }
      if (!sweepIndex) sweepIndex = buildWikiIndex(getWikiDir())
      const result = removeMeetingWikiUsingIndex(recordingId, sweepIndex)
      if (result.ok) {
        clearWikiCleanupRetry(recordingId)
        cleared++
      } else {
        stillPending++
      }
    } catch (e) {
      console.warn(`[MeetingWiki] wiki-cleanup retry failed for ${recordingId}:`, e)
      stillPending++
    }
  }
  return { cleared, stillPending }
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
  // RE7-1 (round-7) — the wiki markdown is readable by external agents/humans,
  // so an excluded (personal/soft-deleted/value-excluded) recording must never
  // get a page. Fail-closed via the shared boundary; if a page already exists
  // (written while eligible, then trashed) remove it here too.
  if (!isRecordingEligible(recordingId)) {
    removeMeetingWiki(recordingId)
    return null
  }
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
 * Where the backfill resumes.
 *
 * ## Why a cursor and not a failure list
 *
 * A remembered set of failed ids does NOT guarantee progress once it is capped,
 * and capping is unavoidable for an unbounded set. With more failures than the
 * cap, each pass drops a different group off the end; the dropped ids read as
 * "never attempted" again, jump back to the front, and the passes rotate through
 * groups forever without ever reaching the healthy rows behind them.
 *
 * A position is bounded by construction. `missing` is sorted by recording id —
 * a total order that is stable across passes — and each pass starts at the first
 * id strictly after the resume point, wrapping at the end. Every pass attempts at
 * least one recording and records the LAST id it attempted, including when it
 * stops at the failure limit, so the resume point strictly advances past every
 * group it just tried.
 *
 * ## What that guarantees, exactly
 *
 * - **Within one process**: progress is monotonic unconditionally. The cursor is
 *   held in memory, so it advances even when nothing can be written to disk, and
 *   every writable recording is reached within one wrap.
 * - **Across restarts**: monotonic only while the state file is writable. If
 *   persistence is failing, a restart begins from the start of the sorted order
 *   again — so a prefix that exhausts `maxFailures` would be retried each time.
 *   That degraded state is reported rather than swallowed; it is a real gap, not
 *   a guarantee.
 */
const BACKFILL_STATE_FILE = 'meeting-wiki-backfill.json'

/**
 * Latest cursor for THIS process. Survives a failed write, which is the whole
 * point: without it a persistence failure silently reset progress to the start
 * on every pass and reinstated the starvation the cursor exists to prevent.
 */
let sessionResumeAfterId: string | null = null
/** Set once persistence starts failing, so the warning is logged once. */
let persistenceDegraded = false

function backfillStatePath(): string {
  return join(getCachePath(), BACKFILL_STATE_FILE)
}

function loadResumeAfterId(): string | null {
  // In-memory first: it is at least as advanced as anything on disk, and it is
  // the only copy that exists when persistence is unavailable.
  if (sessionResumeAfterId !== null) return sessionResumeAfterId
  try {
    const parsed = JSON.parse(readFileSync(backfillStatePath(), 'utf-8')) as {
      resumeAfterId?: unknown
    }
    if (typeof parsed?.resumeAfterId === 'string') {
      sessionResumeAfterId = parsed.resumeAfterId
      return sessionResumeAfterId
    }
    return null
  } catch {
    return null // absent or unreadable — start from the top
  }
}

function saveResumeAfterId(resumeAfterId: string): void {
  // Record in memory FIRST: this must hold even if every disk operation below
  // fails, so a pass in this process always advances past what it attempted.
  sessionResumeAfterId = resumeAfterId

  const target = backfillStatePath()
  const temp = `${target}.tmp`
  try {
    const dir = getCachePath()
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
    // Write-then-rename: a crash mid-write must not leave a truncated state file
    // that parses as "no cursor" and silently restarts the rotation.
    writeFileSync(temp, JSON.stringify({ resumeAfterId }), 'utf-8')
    renameSync(temp, target)
    if (persistenceDegraded) {
      persistenceDegraded = false
      console.log('[MeetingWiki] Backfill resume point is persistable again.')
    }
  } catch (e) {
    try {
      if (existsSync(temp)) unlinkSync(temp)
    } catch {
      /* best effort */
    }
    if (!persistenceDegraded) {
      persistenceDegraded = true
      console.error(
        `[MeetingWiki] DEGRADED: cannot persist the backfill resume point to ${target}. ` +
          'Passes in this session still advance, but a restart will begin from the start ' +
          'of the list again — recordings behind a persistently failing block may not be ' +
          'reached until the cache path is writable:',
        e
      )
    }
  }
}

/** Test-only: forget the in-process cursor and the degraded flag. */
export function _resetBackfillCursorForTests(): void {
  sessionResumeAfterId = null
  persistenceDegraded = false
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
  const dir = getWikiDir()
  // ONE directory scan for the ENTIRE boot — the fix for the quadratic blowup.
  // Built here, before the cleanup-retry sweep, so BOTH the sweep and the pass
  // below share this single listing. Letting retryPendingWikiCleanups build its
  // own (per-id) scans was O(pending × pages) of synchronous FS work on the boot
  // recovery path — the F15 freeze on exactly that path (post-merge review).
  const index = buildWikiIndex(dir)

  // RE8-P1 (round-9) — first drain any wiki-cleanup retries enqueued by a failed
  // transition cleanup, so an excluded recording's page is removed on boot even
  // if the mark-personal / soft-delete / value-rating attempt failed earlier.
  // Reuses the pass-wide index (no scans of its own); any page it removes is also
  // dropped from `index.owner`, so the pass below sees the post-cleanup state.
  retryPendingWikiCleanups(index)
  const batchSize = Math.max(1, options.batchSize ?? DEFAULT_BATCH_SIZE)
  const budgetMs = options.budgetMs ?? DEFAULT_BUDGET_MS
  const failureLimit = Math.max(1, options.maxFailures ?? DEFAULT_FAILURE_LIMIT)
  let deadline = Date.now() + budgetMs

  const rows = queryAll<{ recording_id: string }>(
    `SELECT recording_id FROM transcripts WHERE TRIM(COALESCE(full_text, '')) != ''`
  )
  // RE7-1 — filter candidates through the shared boundary FAIL-CLOSED: if
  // eligibility can't be established, write nothing rather than export excluded
  // transcripts to disk on boot.
  const { eligible, failClosed } = filterEligibleRecordingIds(rows.map((r) => r.recording_id))
  if (failClosed) {
    console.error('[MeetingWiki] Backfill skipped — recording eligibility unavailable (fail closed)')
    return { written: 0, unchanged: 0, failed: 0, remaining: 0, remainingMissing: 0 }
  }

  // Recordings with no page yet go first, rotated so each pass starts past
  // whatever the last one attempted (see the resume-cursor note above).
  // Recordings that already have a page are re-verified afterwards, with
  // whatever budget is left.
  const havePage = new Set(index.owner.values())
  const isMissing = (id: string): boolean => !havePage.has(id)
  const missingSorted = rows
    .filter((r) => isMissing(r.recording_id))
    .sort((a, b) => (a.recording_id < b.recording_id ? -1 : a.recording_id > b.recording_id ? 1 : 0))

  const resumeAfterId = loadResumeAfterId()
  let rotateAt = 0
  if (resumeAfterId !== null) {
    const next = missingSorted.findIndex((r) => r.recording_id > resumeAfterId)
    rotateAt = next === -1 ? 0 : next // past the end -> wrap to the start
  }
  const missing = [...missingSorted.slice(rotateAt), ...missingSorted.slice(0, rotateAt)]
  const ordered = [...missing, ...rows.filter((r) => !isMissing(r.recording_id))]
  /** Last missing recording this pass touched; becomes the next resume point. */
  let lastAttemptedMissingId: string | null = null

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
    // Recorded BEFORE the attempt, and for failures too: the resume point must
    // advance past everything this pass tried, or a failing group pins it.
    if (stillMissing.has(recording_id)) lastAttemptedMissingId = recording_id

    if (!eligible.has(recording_id)) {
      // RE7-P1a (round-8) — an excluded transcript (already personal/deleted/
      // low-value, or newly value-classified) may STILL have a stale markdown
      // page from when it was eligible. Don't merely skip — actively remove it,
      // so the plain-files knowledge base can't leak an excluded recording.
      //
      // F15 (post-merge review): reuse the PASS-WIDE `index` instead of letting
      // removeMeetingWiki re-scan the directory per excluded recording — that
      // re-scan was O(excluded × pages) of synchronous readdir + page reads and
      // reintroduced the boot freeze the single-scan index exists to prevent.
      //
      // RE8-P1 (post-merge review): INSPECT the cleanup result. Discarding it
      // marked every excluded recording resolved with failed=0 even when the page
      // could NOT be removed (unreadable dir / unlink failed), leaving a readable
      // stale page while the backfill reported remainingMissing=0. On success it
      // is resolved (and any stale retry cleared); on failure it is counted, left
      // UNRESOLVED so remainingMissing reflects the outstanding work, and enqueued
      // for a durable retry — mirroring reconcileWikiEligibility.
      const cleanup = removeMeetingWikiUsingIndex(recording_id, index)
      if (cleanup.ok) {
        clearWikiCleanupRetry(recording_id)
        // It will never get a page, so it counts as resolved rather than still-missing.
        if (stillMissing.has(recording_id)) resolvedMissing.add(recording_id)
      } else {
        failed++
        enqueueWikiCleanupRetry(recording_id)
        console.warn(
          `[MeetingWiki] Backfill could not remove the stale page for excluded ${recording_id} ` +
            `(failed=${cleanup.failed}) — left unresolved and enqueued for retry`
        )
      }
    } else {
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

  // Advance the resume point past everything this pass attempted.
  if (lastAttemptedMissingId !== null) saveResumeAfterId(lastAttemptedMissingId)

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
