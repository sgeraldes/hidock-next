/**
 * Transcript-upgrade CORE — pure, dependency-free logic.
 *
 * This module holds the parts of the old-transcript triage that need no database
 * or LLM: detecting whether a stored transcript is "old-format" (a flat blob the
 * reader renders as an unstructured wall of text), scoring how important it is
 * from cheap content signals, and building/parsing the text-only reformat prompt.
 *
 * Keeping it side-effect-free makes the whole triage deterministically testable
 * without touching sql.js or the Gemini API. The DB/LLM wiring lives in
 * transcript-upgrade.ts.
 */

/** Stored transcript segment, mirroring the `speakers` JSON column shape and the
 *  renderer's StoredSegment. Times are in seconds. */
export interface TriageStoredSegment {
  speaker?: string
  start: number
  end?: number
  text: string
}

/** Minimal transcript shape the detector needs (subset of the DB row). */
export interface TranscriptContentInput {
  fullText: string
  /** Raw `speakers` column value (JSON string) or null/undefined. */
  speakers?: string | null
}

/** `[MM:SS] Speaker N:` (or `[HH:MM:SS] …`) inline turn marker — the "Rec43"
 *  legacy chunk shape that IS renderable (split at render time), so a segment
 *  carrying these is NOT considered flat. Mirrors splitInlineTurns.INLINE_TURN_RE. */
const INLINE_TURN_RE = /\[(\d{1,3}):(\d{2})(?::(\d{2}))?\]\s*(Speaker\s*\d+)\s*:/i

/** A line beginning a speaker turn: **Name:** / [Name] / Name: — mirrors the
 *  reader's SPEAKER_LINE_REGEX so detection matches what the viewer renders. */
const SPEAKER_LINE_REGEX = /^[ \t]*(?:\*\*[^*\n]+\*\*\s*:?|\[[^\]\n]+\]|[A-Z][^:\n]{0,40}?:)\s/m

/** A line-start timestamp: [MM:SS] / MM:SS / [HH:MM:SS] — mirrors the reader's
 *  parseTranscriptSegments timestamp detection. */
const LINE_TIMESTAMP_REGEX = /^\s*(\[?\d{1,2}:\d{2}(?::\d{2})?\]?)\s+\S/m

/** Safely parse the `speakers` column into a segment array (empty on any error). */
export function parseStoredSegments(speakers?: string | null): TriageStoredSegment[] {
  if (!speakers || typeof speakers !== 'string') return []
  try {
    const parsed = JSON.parse(speakers)
    if (!Array.isArray(parsed)) return []
    return parsed.filter((s): s is TriageStoredSegment => s && typeof s === 'object' && typeof s.text === 'string')
  } catch {
    return []
  }
}

/** Whether a stored-segment set would render as structured turns in the reader.
 *  Structured when any segment has a real speaker label, a non-zero start time,
 *  or an inline `[ts] Speaker N:` marker (split at render time). */
export function storedSegmentsAreStructured(segments: TriageStoredSegment[]): boolean {
  return segments.some(
    (s) =>
      (typeof s.speaker === 'string' && s.speaker.trim().length > 0) ||
      (typeof s.start === 'number' && s.start > 0) ||
      (typeof s.text === 'string' && INLINE_TURN_RE.test(s.text))
  )
}

/** Whether the plain full_text carries structure the reader can detect: a
 *  line-start timestamp or a speaker-label line. */
export function fullTextIsStructured(fullText: string): boolean {
  if (!fullText) return false
  return LINE_TIMESTAMP_REGEX.test(fullText) || SPEAKER_LINE_REGEX.test(fullText)
}

export interface FormatDetection {
  /** True when the transcript is the flat, pre-speaker-turns format. */
  isLegacy: boolean
  hasStoredStructure: boolean
  hasTextStructure: boolean
}

/**
 * Detect whether a transcript is "old-format" (flat). This is the INVERSE of the
 * reader's `hasStructure` decision: a transcript is legacy/flat only when neither
 * its stored `speakers` segments nor its `full_text` carry any turn structure —
 * exactly the case where TranscriptViewer falls back to toParagraphs().
 */
export function detectTranscriptFormat(input: TranscriptContentInput): FormatDetection {
  const segments = parseStoredSegments(input.speakers)
  const hasStoredStructure = segments.length > 0 && storedSegmentsAreStructured(segments)
  const hasTextStructure = fullTextIsStructured(input.fullText || '')
  return {
    isLegacy: !hasStoredStructure && !hasTextStructure,
    hasStoredStructure,
    hasTextStructure
  }
}

// ---------------------------------------------------------------------------
// Importance scoring (LLM-free)
// ---------------------------------------------------------------------------

/** Lexical cues signalling decisions / commitments / deliverables. Corpus is
 *  mostly Spanish; English equivalents included. Matched case-insensitively as
 *  substrings, so inflected forms ("acordamos", "acordado") are covered by stems. */
export const DECISION_CUES: string[] = [
  // Spanish — decisions & agreement
  'decidim', 'decidid', 'decisión', 'decision', 'acord', 'acuerdo', 'aprob',
  'compromet', 'compromiso', 'confirmad', 'quedamos en',
  // Spanish — commitments, deadlines & deliverables
  'deadline', 'fecha límite', 'fecha limite', 'plazo', 'entregable', 'entrega',
  'hito', 'próximos pasos', 'proximos pasos', 'siguiente paso', 'pendiente',
  'responsable', 'encargad', 'tarea',
  // Spanish — commercial / contractual
  'firma', 'firmar', 'firmad', 'contrato', 'propuesta', 'presupuesto',
  'cotización', 'cotizacion', 'factura', 'pago', 'cliente',
  // English
  'agreed', 'we decided', 'action item', 'next step', 'deliverable',
  'milestone', 'sign off', 'sign-off', 'proposal', 'budget', 'contract', 'owner'
]

export interface ImportanceSignals {
  /** knowledge_captures.category / meeting category, lowercased ('' if none). */
  category?: string
  wordCount?: number
  actionItemCount?: number
  distinctTopicCount?: number
  attendeeCount?: number
  hasExternalAttendee?: boolean
  hasProjectLink?: boolean
  isRecurring?: boolean
  /** Days since the recording (undefined = unknown → treated as old). */
  ageDays?: number
  /** Number of DECISION_CUES matches found in the transcript text. */
  decisionCueMatches?: number
}

export interface ImportanceResult {
  score: number
  breakdown: Record<string, number>
}

/** Points for the capture category (interview / client-facing rank highest,
 *  recurring internal meetings lowest). */
function categoryPoints(category: string | undefined, isRecurring: boolean | undefined): number {
  const c = (category || '').toLowerCase()
  let base: number
  switch (c) {
    case 'interview':
      base = 25
      break
    case 'meeting':
      base = 18
      break
    case '1:1':
      base = 15
      break
    case 'brainstorm':
      base = 12
      break
    case 'other':
      base = 8
      break
    case 'note':
      base = 4
      break
    default:
      base = 10
  }
  // Recurring internal cadence calls are the least likely to be worth a costly
  // re-transcription — halve their category weight.
  if (isRecurring) base = Math.round(base * 0.5)
  return base
}

/** Count how many DECISION_CUES appear in the text (each cue counted once). */
export function countDecisionCues(text: string): number {
  if (!text) return 0
  const hay = text.toLowerCase()
  let n = 0
  for (const cue of DECISION_CUES) {
    if (hay.includes(cue)) n++
  }
  return n
}

/**
 * Score a transcript's importance 0–100 from cheap signals. Higher = more worth
 * a full audio re-transcription; lower = fine to just reformat the existing text.
 * Returns the clamped score and the per-signal contribution for transparency.
 */
export function scoreImportance(signals: ImportanceSignals): ImportanceResult {
  const breakdown: Record<string, number> = {}

  breakdown.category = categoryPoints(signals.category, signals.isRecurring)

  // Longer transcripts carry more substance (log-ish, capped at 15 ≈ 3000 words).
  breakdown.length = Math.min(15, Math.round((signals.wordCount ?? 0) / 200))

  breakdown.actionItems = Math.min(15, (signals.actionItemCount ?? 0) * 3)
  breakdown.topics = Math.min(10, (signals.distinctTopicCount ?? 0) * 2)
  breakdown.decisions = Math.min(15, (signals.decisionCueMatches ?? 0) * 3)
  breakdown.project = signals.hasProjectLink ? 10 : 0
  breakdown.external = signals.hasExternalAttendee ? 10 : 0
  breakdown.attendees = Math.min(5, signals.attendeeCount ?? 0)

  // Recency: recent calls are likelier to matter now.
  const age = signals.ageDays
  breakdown.recency =
    age == null ? 2 : age <= 30 ? 10 : age <= 90 ? 6 : age <= 180 ? 3 : 1

  const raw = Object.values(breakdown).reduce((a, b) => a + b, 0)
  return { score: Math.max(0, Math.min(100, raw)), breakdown }
}

export type TriageBand = 'recommend-retranscribe' | 'reformat'

/** Band a score into "recommend a costly re-transcription" vs "just reformat". */
export function bandForScore(score: number, threshold = 60): TriageBand {
  return score >= threshold ? 'recommend-retranscribe' : 'reformat'
}

// ---------------------------------------------------------------------------
// Text-only reformat prompt + response parsing
// ---------------------------------------------------------------------------

/** System instruction for the cheap text-reformat pass. Conservative by design:
 *  no invented content, no translation, no summarising, no invented names. */
export const REFORMAT_SYSTEM_PROMPT = `You restructure an existing raw transcript into readable speaker turns. STRICT RULES:
- Do NOT invent, add, remove, translate, or summarise any content. Preserve the original wording and language exactly.
- Only split the text into turns and add paragraph structure.
- Where the speaker CLEARLY changes, start a new turn. Label distinct voices "Speaker 1", "Speaker 2", etc.
- If you are unsure who is speaking, use "Speaker?". NEVER invent real names.
- If the whole transcript is clearly one person, label every turn "Speaker 1".
Respond with ONLY a JSON array of objects: [{"speaker": "Speaker 1", "text": "..."}]. No prose, no code fences.`

/** Build the user prompt carrying the transcript to reformat. */
export function buildReformatPrompt(fullText: string): string {
  return `Restructure this transcript into speaker turns following the rules. Transcript:\n\n${fullText}`
}

/**
 * Split a long transcript into blocks that each fit a single cheap-model call,
 * so an hour-long flat transcript can be reformatted without the output being
 * truncated by the token cap. Splits on paragraph/newline boundaries first, then
 * sentences, then a hard character cut for pathological single-sentence blobs.
 * Returns [] for empty input and [text] when it already fits.
 */
export function splitIntoReformatBlocks(text: string, maxChars = 12000): string[] {
  const clean = (text || '').trim()
  if (!clean) return []
  if (clean.length <= maxChars) return [clean]

  const blocks: string[] = []
  let cur = ''
  const flush = (): void => {
    if (cur.trim()) blocks.push(cur.trim())
    cur = ''
  }
  const pushChunk = (chunk: string): void => {
    // Hard-cut a chunk that alone exceeds the budget.
    let rest = chunk
    while (rest.length > maxChars) {
      flush()
      blocks.push(rest.slice(0, maxChars).trim())
      rest = rest.slice(maxChars)
    }
    if (cur.length + rest.length > maxChars) flush()
    cur += rest
  }

  for (const para of clean.split(/\n{2,}|\n/).map((p) => p.trim()).filter(Boolean)) {
    if (para.length > maxChars) {
      flush()
      for (const sentence of para.match(/[^.!?]+(?:[.!?]+|$)/g) ?? [para]) {
        if (cur.length + sentence.length > maxChars) flush()
        pushChunk(sentence)
      }
      continue
    }
    if (cur.length + para.length + 1 > maxChars) flush()
    cur += (cur ? '\n' : '') + para
  }
  flush()
  return blocks
}

/**
 * Parse the reformat model's response into stored segments. Tolerates a fenced
 * ```json block or a bare array, repairs a trailing comma, and drops any object
 * without usable text. Every segment gets start=0 (no timestamps are available
 * from a text-only pass) and a trimmed speaker label. Returns [] when nothing
 * usable can be recovered (caller then leaves the transcript unchanged).
 */
export function parseReformatResponse(response: string): TriageStoredSegment[] {
  if (!response) return []
  const fenced = response.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1]
  const arrayText = (fenced ?? response).match(/\[[\s\S]*\]/)?.[0]
  if (!arrayText) return []

  let parsed: unknown
  try {
    parsed = JSON.parse(arrayText)
  } catch {
    try {
      parsed = JSON.parse(arrayText.replace(/,\s*([\]}])/g, '$1'))
    } catch {
      return []
    }
  }
  if (!Array.isArray(parsed)) return []

  const out: TriageStoredSegment[] = []
  for (const raw of parsed) {
    if (!raw || typeof raw !== 'object') continue
    const obj = raw as { speaker?: unknown; text?: unknown }
    const text = typeof obj.text === 'string' ? obj.text.trim() : ''
    if (!text) continue
    const speaker = typeof obj.speaker === 'string' && obj.speaker.trim() ? obj.speaker.trim() : undefined
    out.push({ speaker, start: 0, text })
  }
  return out
}
