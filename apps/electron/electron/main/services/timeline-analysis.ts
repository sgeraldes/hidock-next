/**
 * Meeting-timeline analysis — the DATA behind the rich waveform timeline.
 *
 * Produces two per-recording artifacts, both persisted as JSON on the
 * `transcripts` row (columns added in schema v39) and exposed over IPC
 * (`recordings:getTimelineAnalysis` / `recordings:analyzeTimeline`):
 *
 *  1. sentimentSegments: {startSec,endSec,score:-1..1}[] — a time-windowed
 *     sentiment series across the recording. The transcript is coalesced into
 *     ~fixed-duration windows (from the timestamped speaker turns), then each
 *     window is scored by Gemini (the app's existing analysis provider). Score
 *     runs -1 (tense / negative / conflict) → +1 (positive / collaborative).
 *
 *  2. eventMarkers: {id,kind:'action'|'decision',atSec,label,refId}[] — the
 *     recording's action items + decisions, each fuzzy-matched against the
 *     timestamped speaker turns to recover the audio offset (atSec). Items are
 *     gathered from BOTH the first-class action_items/decisions tables (migration
 *     path) AND the fresh-transcription transcripts.action_items /
 *     transcripts.key_points JSON arrays — the latter is the only source a
 *     just-transcribed recording has, so markers now populate for real
 *     recordings, not only migrated ones. refId links a marker to its item.
 *
 * Design notes:
 *  - Pure, deterministic pieces (windowing + fuzzy matching) are separated from
 *    the Gemini call so they are unit-testable without the network. The Gemini
 *    scorer is dependency-injected (`opts.scoreWindows`) — tests pass a fake.
 *  - This module is imported by transcription.ts via dynamic import (non-fatal),
 *    so it must NOT statically import transcription.ts (would cycle).
 */

import { GoogleGenerativeAI } from '@google/generative-ai'
import { getRecordingById, resolveRecordingId, queryOne, queryAll, run } from './database'

export interface SentimentSegment {
  startSec: number
  endSec: number
  /** -1 (negative/tense) … +1 (positive/collaborative). */
  score: number
}

export type EventMarkerKind = 'action' | 'decision'

export interface EventMarker {
  /** Stable marker id (derived from refId so re-runs are idempotent). */
  id: string
  kind: EventMarkerKind
  /** Audio offset in seconds recovered from the transcript's speaker turns. */
  atSec: number
  label: string
  /** action_items / decisions row id the marker points at. */
  refId: string
}

/**
 * Coarse, renderer-actionable classification of an analysis failure. Derived
 * HERE (at the service/IPC boundary) where the raw provider error — with its
 * structured status codes and canonical English tokens — is available, so the
 * renderer never has to pattern-match possibly-localized message text.
 */
export type AnalysisErrorKind = 'auth' | 'quota' | 'rate-limit' | 'network' | 'invalid-input' | 'unknown'

export interface AnalysisError {
  kind: AnalysisErrorKind
  /** For rate-limit errors that carry a retry-after hint, in milliseconds. */
  retryAfterMs?: number
  /** Raw message, for logging/diagnostics only — NOT for classification. */
  message?: string
}

/**
 * Map a raw provider/IPC error onto an AnalysisError. Prefers structured
 * fields (numeric status / httpStatus / code) over message text; message
 * tokens are only a fallback for providers that stringify everything.
 * Unrecognized shapes are 'unknown' — consumers treat that conservatively
 * (bounded auto-retries, then manual).
 */
export function classifyAnalysisError(err: unknown): AnalysisError {
  const e = (err ?? {}) as { status?: unknown; httpStatus?: unknown; code?: unknown; message?: unknown }
  const message = err instanceof Error ? err.message : typeof err === 'string' ? err : String(e.message ?? '')

  const numeric = (v: unknown): number | undefined => (typeof v === 'number' && Number.isFinite(v) ? v : undefined)
  const statusFromText = message.match(/\b([45]\d\d)\b/)
  const status =
    numeric(e.status) ?? numeric(e.httpStatus) ?? numeric(e.code) ?? (statusFromText ? Number(statusFromText[1]) : undefined)

  // Retry-after hint: "retry after 12s" / "Retry-After: 30" / "retry in 1.5 seconds"
  let retryAfterMs: number | undefined
  const retryMatch = message.match(/retry(?:-|\s+)?(?:after|in)[:\s]+(\d+(?:\.\d+)?)\s*(ms|milliseconds?|s|secs?|seconds?)?/i)
  if (retryMatch) {
    const value = parseFloat(retryMatch[1])
    const unit = (retryMatch[2] || 's').toLowerCase()
    retryAfterMs = Math.round(unit.startsWith('ms') || unit.startsWith('millisecond') ? value : value * 1000)
  }

  if (status === 401 || status === 403 || /\b(api.?key|credential\w*|unauthoriz\w*|forbidden|permission.?denied)\b/i.test(message)) {
    return { kind: 'auth', message }
  }
  if (status === 429 || /\b(rate.?limit\w*|too many requests)\b/i.test(message)) {
    return { kind: 'rate-limit', retryAfterMs, message }
  }
  if (/\b(quota|resource.?exhausted|billing)\b/i.test(message)) {
    return { kind: 'quota', message }
  }
  if (status === 400 || /\binvalid\s+(argument|request|input)\b/i.test(message)) {
    return { kind: 'invalid-input', message }
  }
  if (
    (status !== undefined && status >= 500) ||
    /\b(network|fetch failed|timed?\s?out|timeout|econn\w*|enotfound|eai_again|socket|offline|unavailable)\b/i.test(message)
  ) {
    return { kind: 'network', message }
  }
  return { kind: 'unknown', message }
}

export interface TimelineAnalysis {
  sentimentSegments: SentimentSegment[]
  eventMarkers: EventMarker[]
  /**
   * Present when part of the analysis FAILED (e.g. the Gemini sentiment pass) —
   * classified where the raw error is available. Not persisted; consumers use
   * it to drive their retry policy. Absent = the run completed (even when the
   * honest result is empty).
   */
  analysisError?: AnalysisError
}

/** One coalesced window of speaker turns, ready to be scored. */
export interface SentimentWindow {
  index: number
  startSec: number
  endSec: number
  text: string
}

/** A timestamped speaker turn as stored in `transcripts.speakers`. */
export interface SpeakerTurn {
  speaker?: string
  start: number
  end: number
  text: string
}

/** An action/decision item to place on the timeline. */
export interface TimelineItem {
  id: string
  kind: EventMarkerKind
  /** Primary text (action_items.content / decisions.content / transcript JSON entry). */
  text: string
  /** Verbatim source snippet if the extractor captured one — matched first. */
  extractedFrom?: string | null
  /**
   * Raw assignee/owner name if known (first-class action_items.assignee). Used as
   * a last-resort anchor when the item text can't be matched to a turn: we place
   * the marker at the turn where the assignee is first mentioned.
   */
  assignee?: string | null
}

const EMPTY: TimelineAnalysis = { sentimentSegments: [], eventMarkers: [] }

// Tuning constants.
const DEFAULT_WINDOW_SEC = 45 // target duration of one sentiment window
const MAX_WINDOWS = 40 // cap so the Gemini response stays bounded
const MATCH_THRESHOLD = 0.34 // min fuzzy score to place an event marker
const ASSIGNEE_MATCH_THRESHOLD = 0.5 // min token overlap of assignee name vs a turn (last-resort anchor)

// ---------------------------------------------------------------------------
// Speaker-turn parsing
// ---------------------------------------------------------------------------

/**
 * Parse the `transcripts.speakers` JSON into normalized turns with numeric
 * start/end in absolute seconds. Tolerates malformed/empty input (returns []).
 */
export function parseSpeakerTurns(speakersJson: string | null | undefined): SpeakerTurn[] {
  if (!speakersJson) return []
  let raw: unknown
  try {
    raw = JSON.parse(speakersJson)
  } catch {
    return []
  }
  if (!Array.isArray(raw)) return []
  const turns: SpeakerTurn[] = []
  for (const entry of raw) {
    if (!entry || typeof entry !== 'object') continue
    const e = entry as Record<string, unknown>
    const text = typeof e.text === 'string' ? e.text.trim() : ''
    if (!text) continue
    const start = toFiniteNumber(e.start)
    const end = toFiniteNumber(e.end)
    turns.push({
      speaker: typeof e.speaker === 'string' ? e.speaker : undefined,
      start: start ?? 0,
      end: end ?? start ?? 0,
      text
    })
  }
  return turns
}

function toFiniteNumber(v: unknown): number | null {
  const n = typeof v === 'number' ? v : typeof v === 'string' ? Number(v) : NaN
  return Number.isFinite(n) ? n : null
}

// ---------------------------------------------------------------------------
// Sentiment windowing (pure)
// ---------------------------------------------------------------------------

/**
 * Coalesce consecutive speaker turns into windows of ~targetWindowSec. A single
 * very long turn becomes its own window. The window count is capped at
 * MAX_WINDOWS by growing the target duration, so long recordings still yield a
 * bounded series. Deterministic — no network.
 */
export function buildSentimentWindows(
  turns: SpeakerTurn[],
  targetWindowSec: number = DEFAULT_WINDOW_SEC
): SentimentWindow[] {
  if (turns.length === 0) return []

  const first = turns[0].start
  const last = turns[turns.length - 1].end
  const totalSpan = Math.max(0, last - first)

  // Grow the window so we never exceed MAX_WINDOWS.
  let windowSec = Math.max(1, targetWindowSec)
  if (totalSpan / windowSec > MAX_WINDOWS) {
    windowSec = Math.ceil(totalSpan / MAX_WINDOWS)
  }

  const windows: SentimentWindow[] = []
  let cur: { start: number; end: number; parts: string[] } | null = null

  const flush = () => {
    if (!cur) return
    windows.push({
      index: windows.length,
      startSec: round2(cur.start),
      endSec: round2(Math.max(cur.end, cur.start)),
      text: cur.parts.join('\n')
    })
    cur = null
  }

  for (const turn of turns) {
    if (!cur) {
      cur = { start: turn.start, end: turn.end, parts: [] }
    }
    cur.parts.push(turn.speaker ? `${turn.speaker}: ${turn.text}` : turn.text)
    cur.end = Math.max(cur.end, turn.end)
    // Close the window once it has covered ~windowSec of audio.
    if (cur.end - cur.start >= windowSec) {
      flush()
    }
  }
  flush()

  return windows
}

/** Scores keyed by window index, each clamped to [-1, 1]. */
export type WindowScorer = (windows: SentimentWindow[]) => Promise<Map<number, number>>

export interface SentimentOptions {
  targetWindowSec?: number
  /** Inject a scorer (tests). Defaults to the Gemini scorer. */
  scoreWindows?: WindowScorer
  /**
   * Invoked with the RAW scorer error when sentiment scoring fails (the series
   * is then omitted). Lets analyzeTimeline classify the failure while this
   * function keeps its non-throwing contract.
   */
  onError?: (err: unknown) => void
}

/**
 * Produce the windowed sentiment series for a set of speaker turns. Windows with
 * no returned score are dropped (rather than defaulted to 0) so the series
 * reflects only what the model actually rated.
 */
export async function deriveSentimentSegments(
  turns: SpeakerTurn[],
  opts: SentimentOptions = {}
): Promise<SentimentSegment[]> {
  const windows = buildSentimentWindows(turns, opts.targetWindowSec)
  if (windows.length === 0) return []

  const scorer = opts.scoreWindows ?? geminiWindowScorer
  let scores: Map<number, number>
  try {
    scores = await scorer(windows)
  } catch (e) {
    console.warn('[Timeline] sentiment scoring failed:', e instanceof Error ? e.message : e)
    opts.onError?.(e)
    return []
  }

  const segments: SentimentSegment[] = []
  for (const w of windows) {
    const raw = scores.get(w.index)
    if (raw === undefined || !Number.isFinite(raw)) continue
    segments.push({ startSec: w.startSec, endSec: w.endSec, score: clamp(raw, -1, 1) })
  }
  return segments
}

/**
 * The default (production) scorer: one Gemini call over all windows. Returns an
 * empty map when Gemini is not configured, so sentiment is simply omitted rather
 * than failing the whole analysis.
 */
export const geminiWindowScorer: WindowScorer = async (windows) => {
  // Lazy import so this leaf module doesn't pull in config.ts (which touches the
  // Electron `app` at load) — keeps the pure pieces testable under plain node.
  const { getConfig } = await import('./config')
  const config = getConfig()
  const apiKey = config.transcription.geminiApiKey
  if (!apiKey) return new Map()

  const genAI = new GoogleGenerativeAI(apiKey)
  const model = genAI.getGenerativeModel({ model: config.transcription.geminiModel || 'gemini-3.5-flash' })

  const windowBlock = windows
    .map((w) => `#${w.index} [${formatClock(w.startSec)}-${formatClock(w.endSec)}]\n${w.text}`)
    .join('\n\n')

  const prompt = `You are scoring the emotional sentiment of consecutive segments of a meeting transcript.
For EACH numbered segment, return a sentiment score from -1.0 to 1.0:
  -1.0 = very negative / tense / conflict / frustration
   0.0 = neutral / factual
  +1.0 = very positive / collaborative / agreement / enthusiasm
Judge the tone of the conversation in that segment, in whatever language it is written.

Respond with ONLY a JSON array, one object per segment, no prose:
[{"i": 0, "score": -0.2}, {"i": 1, "score": 0.5}]

Segments:
${windowBlock}`

  const result = await model.generateContent({
    contents: [{ role: 'user', parts: [{ text: prompt }] }],
    generationConfig: { maxOutputTokens: 4096, thinkingConfig: { thinkingBudget: 0 } } as never
  })

  let text = ''
  try {
    text = result.response.text()
  } catch {
    text = ''
  }
  return parseWindowScores(text)
}

/**
 * Parse a Gemini window-score response into a Map<index, score>. Tolerates a
 * fenced block or bare array, and ignores entries that don't parse. Exported for
 * testing the parser in isolation.
 */
export function parseWindowScores(text: string): Map<number, number> {
  const out = new Map<number, number>()
  if (!text) return out
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1]
  const arrayText = (fenced ?? text).match(/\[[\s\S]*\]/)?.[0]
  if (!arrayText) return out
  let parsed: unknown
  try {
    parsed = JSON.parse(arrayText)
  } catch {
    return out
  }
  if (!Array.isArray(parsed)) return out
  for (const entry of parsed) {
    if (!entry || typeof entry !== 'object') continue
    const e = entry as Record<string, unknown>
    const idx = toFiniteNumber(e.i ?? e.index)
    const score = toFiniteNumber(e.score ?? e.value)
    if (idx === null || score === null) continue
    out.set(Math.round(idx), clamp(score, -1, 1))
  }
  return out
}

// ---------------------------------------------------------------------------
// Event-marker fuzzy matching (pure)
// ---------------------------------------------------------------------------

/**
 * Derive event markers by fuzzy-matching each item's text against the
 * timestamped speaker turns. Deterministic — no network. The `extractedFrom`
 * snippet (verbatim from the transcript) is matched first, then falls back to
 * the item's `content`. Items whose text can't clear MATCH_THRESHOLD fall back
 * to anchoring on the turn where their `assignee` is first mentioned; only items
 * with no recoverable offset at all are dropped (with a logged count).
 */
export function deriveEventMarkers(items: TimelineItem[], turns: SpeakerTurn[]): EventMarker[] {
  if (items.length === 0 || turns.length === 0) return []

  // Pre-tokenize turns once.
  const turnTokens = turns.map((t) => new Set(tokenize(t.text)))
  const turnNorm = turns.map((t) => normalize(t.text))

  const markers: EventMarker[] = []
  let dropped = 0
  for (const item of items) {
    const queries = [item.extractedFrom, item.text].filter(
      (q): q is string => typeof q === 'string' && q.trim().length > 0
    )
    let best = { score: 0, turnIdx: -1 }
    for (const query of queries) {
      const qNorm = normalize(query)
      const qTokens = tokenize(query)
      if (qTokens.length === 0) continue
      const qTokenSet = new Set(qTokens)
      for (let i = 0; i < turns.length; i++) {
        const score = matchScore(qNorm, qTokenSet, turnNorm[i], turnTokens[i])
        if (score > best.score) best = { score, turnIdx: i }
      }
      // A verbatim snippet match is authoritative — stop at a strong hit.
      if (best.score >= 0.95) break
    }

    let turnIdx = best.turnIdx >= 0 && best.score >= MATCH_THRESHOLD ? best.turnIdx : -1

    // Last-resort anchor: place the marker where the assignee is first mentioned.
    // Better an approximate offset for a real action item than silently dropping it.
    if (turnIdx < 0 && item.assignee && item.assignee.trim()) {
      turnIdx = findAssigneeTurn(item.assignee, turnTokens)
    }

    if (turnIdx >= 0) {
      markers.push({
        id: `mk_${item.kind}_${item.id}`,
        kind: item.kind,
        atSec: round2(turns[turnIdx].start),
        label: buildLabel(item.text),
        refId: item.id
      })
    } else {
      dropped++
    }
  }
  if (dropped > 0) {
    console.log(`[Timeline] deriveEventMarkers: ${markers.length} placed, ${dropped} dropped (no recoverable offset)`)
  }
  // Chronological order is the most useful default for a timeline consumer.
  markers.sort((a, b) => a.atSec - b.atSec)
  return markers
}

/**
 * Find the earliest turn whose tokens sufficiently cover the assignee name.
 * Returns -1 if the assignee is never clearly mentioned. Short single-token
 * names (e.g. "Ana") still match on an exact token hit.
 */
function findAssigneeTurn(assignee: string, turnTokens: Array<Set<string>>): number {
  const nameTokens = tokenize(assignee)
  if (nameTokens.length === 0) return -1
  for (let i = 0; i < turnTokens.length; i++) {
    let overlap = 0
    for (const tok of nameTokens) {
      if (turnTokens[i].has(tok)) overlap++
    }
    if (overlap / nameTokens.length >= ASSIGNEE_MATCH_THRESHOLD) return i
  }
  return -1
}

/**
 * Containment-oriented similarity of a query against one turn:
 *  - 1.0 if the (long enough) normalized query is a substring of the turn.
 *  - else |query∩turn tokens| / |query tokens| (how much of the item the turn covers).
 */
function matchScore(qNorm: string, qTokens: Set<string>, turnNorm: string, turnTokens: Set<string>): number {
  if (qNorm.length >= 8 && turnNorm.includes(qNorm)) return 1
  if (qTokens.size === 0) return 0
  let overlap = 0
  for (const tok of qTokens) {
    if (turnTokens.has(tok)) overlap++
  }
  return overlap / qTokens.size
}

function normalize(s: string): string {
  return s
    .normalize('NFD')
    .replace(/\p{M}/gu, '') // strip combining marks (diacritics)
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function tokenize(s: string): string[] {
  return normalize(s)
    .split(' ')
    .filter((t) => t.length >= 3)
}

function buildLabel(text: string): string {
  const clean = text.replace(/\s+/g, ' ').trim()
  return clean.length <= 80 ? clean : `${clean.slice(0, 77)}...`
}

// ---------------------------------------------------------------------------
// DB wiring (production)
// ---------------------------------------------------------------------------

interface TranscriptRow {
  recording_id: string
  speakers: string | null
  sentiment_segments: string | null
  event_markers: string | null
}

interface TranscriptItemsRow {
  action_items: string | null
  key_points: string | null
}

/**
 * The action/decision items for a recording, gathered from EVERY source a real
 * recording actually has:
 *
 *  1. First-class `action_items` + `decisions` tables (populated by the
 *     knowledge-capture migration path) — keyed by knowledge_capture_id.
 *  2. The freshly-transcribed `transcripts.action_items` and
 *     `transcripts.key_points` JSON string arrays. This is the ONLY source a
 *     just-transcribed recording has — the migration tables stay empty on a
 *     device-first library, which is why markers used to come out empty.
 *
 * Items are de-duplicated by (kind + normalized text) so a migrated recording
 * that has both a first-class row and the same transcript-JSON entry yields a
 * single marker. First-class rows win (they carry a stable refId + assignee).
 *
 * `transcripts.action_items` → action markers; `transcripts.key_points`
 * ("Key points or decisions made", per the analysis prompt) → decision markers.
 */
export function getTimelineItemsForRecording(recordingId: string): TimelineItem[] {
  const canonical = getRecordingById(recordingId) ?? resolveRecordingId(recordingId)
  const id = canonical?.id ?? recordingId

  const items: TimelineItem[] = []
  const seen = new Set<string>() // dedupe key: `${kind} ${normalizedText}`

  const add = (item: TimelineItem): void => {
    const key = `${item.kind} ${normalize(item.text)}`
    if (!item.text.trim() || seen.has(key)) return
    seen.add(key)
    items.push(item)
  }

  // --- Source 1: first-class action_items / decisions via knowledge_capture ---
  const captureIds = new Set<string>()
  const bySource = queryOne<{ id: string }>(
    'SELECT id FROM knowledge_captures WHERE source_recording_id = ?',
    [id]
  )
  if (bySource?.id) captureIds.add(bySource.id)
  if (canonical?.migrated_to_capture_id) captureIds.add(canonical.migrated_to_capture_id)

  if (captureIds.size > 0) {
    const placeholders = Array.from(captureIds).map(() => '?').join(', ')
    const ids = Array.from(captureIds)

    const actions = queryAll<{ id: string; content: string; extracted_from: string | null; assignee: string | null }>(
      `SELECT id, content, extracted_from, assignee FROM action_items WHERE knowledge_capture_id IN (${placeholders})`,
      ids
    )
    const decisions = queryAll<{ id: string; content: string; extracted_from: string | null }>(
      `SELECT id, content, extracted_from FROM decisions WHERE knowledge_capture_id IN (${placeholders})`,
      ids
    )
    for (const a of actions) {
      add({ id: a.id, kind: 'action', text: a.content, extractedFrom: a.extracted_from, assignee: a.assignee })
    }
    for (const d of decisions) {
      add({ id: d.id, kind: 'decision', text: d.content, extractedFrom: d.extracted_from })
    }
  }

  // --- Source 2: fresh-transcription JSON arrays on the transcript row ---
  const trow = queryOne<TranscriptItemsRow>(
    'SELECT action_items, key_points FROM transcripts WHERE recording_id = ?',
    [id]
  )
  if (trow) {
    parseStringArray(trow.action_items).forEach((text, i) => {
      add({ id: `txa_${i}`, kind: 'action', text })
    })
    parseStringArray(trow.key_points).forEach((text, i) => {
      add({ id: `txk_${i}`, kind: 'decision', text })
    })
  }

  return items
}

/**
 * Parse a `transcripts.action_items` / `key_points` JSON column into a string[].
 * Both are persisted as a JSON array of plain strings. Tolerates null/malformed
 * input (returns []) and coerces non-string entries away.
 */
function parseStringArray(json: string | null | undefined): string[] {
  if (!json) return []
  let raw: unknown
  try {
    raw = JSON.parse(json)
  } catch {
    return []
  }
  if (!Array.isArray(raw)) return []
  const out: string[] = []
  for (const entry of raw) {
    if (typeof entry === 'string' && entry.trim()) out.push(entry.trim())
  }
  return out
}

export interface AnalyzeProgress {
  stage: 'sentiment' | 'markers' | 'complete'
  progress: number
}

/**
 * Read the persisted timeline analysis for a recording. Returns empty arrays if
 * the recording / transcript doesn't exist or hasn't been analyzed yet.
 */
export function getTimelineAnalysis(recordingId: string): TimelineAnalysis {
  const canonical = getRecordingById(recordingId) ?? resolveRecordingId(recordingId)
  const id = canonical?.id ?? recordingId
  const row = queryOne<TranscriptRow>(
    'SELECT recording_id, speakers, sentiment_segments, event_markers FROM transcripts WHERE recording_id = ?',
    [id]
  )
  if (!row) return { ...EMPTY }
  return {
    sentimentSegments: parseJsonArray<SentimentSegment>(row.sentiment_segments),
    eventMarkers: parseJsonArray<EventMarker>(row.event_markers)
  }
}

/**
 * Run the sentiment + marker derivation for ONE recording, persist both onto the
 * transcript row, and return the fresh shape. Idempotent — safe to re-run
 * (recomputes and overwrites). Non-throwing for the "no transcript" case
 * (returns empty arrays); real DB write errors propagate to the caller.
 */
export async function analyzeTimeline(
  recordingId: string,
  onProgress?: (p: AnalyzeProgress) => void,
  sentimentOpts?: SentimentOptions
): Promise<TimelineAnalysis> {
  const canonical = getRecordingById(recordingId) ?? resolveRecordingId(recordingId)
  const id = canonical?.id ?? recordingId

  const row = queryOne<TranscriptRow>(
    'SELECT recording_id, speakers, sentiment_segments, event_markers FROM transcripts WHERE recording_id = ?',
    [id]
  )
  if (!row) return { ...EMPTY }

  const turns = parseSpeakerTurns(row.speakers)

  onProgress?.({ stage: 'sentiment', progress: 10 })
  // Capture + classify a scorer failure (deriveSentimentSegments itself never
  // throws) so consumers get a structured errorKind instead of guessing from
  // message text. The caller's own onError, if any, still runs.
  let analysisError: AnalysisError | undefined
  const callerOnError = sentimentOpts?.onError
  const sentimentSegments = await deriveSentimentSegments(turns, {
    ...sentimentOpts,
    onError: (err) => {
      analysisError = classifyAnalysisError(err)
      callerOnError?.(err)
    }
  })

  onProgress?.({ stage: 'markers', progress: 70 })
  const items = getTimelineItemsForRecording(id)
  const eventMarkers = deriveEventMarkers(items, turns)

  run('UPDATE transcripts SET sentiment_segments = ?, event_markers = ? WHERE recording_id = ?', [
    JSON.stringify(sentimentSegments),
    JSON.stringify(eventMarkers),
    id
  ])

  onProgress?.({ stage: 'complete', progress: 100 })
  return analysisError ? { sentimentSegments, eventMarkers, analysisError } : { sentimentSegments, eventMarkers }
}

function parseJsonArray<T>(json: string | null | undefined): T[] {
  if (!json) return []
  try {
    const parsed = JSON.parse(json)
    return Array.isArray(parsed) ? (parsed as T[]) : []
  } catch {
    return []
  }
}

// ---------------------------------------------------------------------------
// small helpers
// ---------------------------------------------------------------------------

function clamp(n: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, n))
}

function round2(n: number): number {
  return Math.round(n * 100) / 100
}

function formatClock(sec: number): string {
  const s = Math.max(0, Math.round(sec))
  const m = Math.floor(s / 60)
  const r = s % 60
  return `${m}:${r.toString().padStart(2, '0')}`
}
