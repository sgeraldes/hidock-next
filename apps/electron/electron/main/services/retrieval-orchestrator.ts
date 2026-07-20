/**
 * Retrieval Orchestrator — query-aware context routing for the RAG assistant.
 *
 * Pure vector top-k cannot answer the questions users actually ask of a
 * meeting-intelligence library ("what actions do I have this week?", "main
 * topics last week", "commitments from last month + status", "report on the
 * most discussed topic"). Those need STRUCTURED, TEMPORAL retrieval:
 *
 *  - INTENT: action/commitment questions route to the distilled `actionables`
 *    table (Cerebras KB lesson: normalized/structured content beats raw
 *    transcript chunks); topic/report questions route to per-meeting digests
 *    (`knowledge_captures` titles + summaries); everything else stays
 *    vector-only. Detection is DETERMINISTIC (no extra LLM call, EN+ES).
 *
 *  - TEMPORAL GROUNDING: relative dates ("this week", "last month", "esta
 *    semana", "el mes pasado") resolve to concrete ranges against TODAY, the
 *    resolved range is injected into the prompt, and chunks inside the range
 *    get a score boost (age-decay in reverse).
 *
 * Every structured row flows through the SAME shared eligibility boundary as
 * the UI (filterEligibleActionableRows / capture+recording allowlists), so an
 * excluded recording's action items never reach the prompt.
 *
 * The module is DB-injected for unit tests; rag.ts wires the real helpers.
 */

import { getDatabase, queryAll } from './database'
import { filterEligibleActionableRows } from './actionable-eligibility'
import { filterEligibleRecordingIds, filterEligibleCaptureIds } from './recording-eligibility'

// ── Intent ──────────────────────────────────────────────────────────────────

export type RetrievalIntent = 'actions' | 'topics' | 'report' | 'general'

const ACTIONS_RE =
  /\b(action items?|actions?|to-?dos?|tasks?|commitments?|compromisos?|acciones?|tareas?|pendientes?|follow.?ups?|assigned|deadlines?|deliverables?|next steps?|pr[óo]ximos pasos)\b/i
const REPORT_RE =
  /\b(report|reporte|informe|deep.?dive|complete (?:summary|analysis)|full (?:summary|report|analysis)|prepar[ae](?:r)?\b.*\b(?:report|informe|resumen)|top \d+|most discussed|m[áa]s discutid)/i
const TOPICS_RE =
  /\b(topics?|subjects?|themes?|temas?|main points?|talked about|discussed|discussi[óo]n|what happened|qu[ée] pas[óo]|overview|resumen|summary|summarize)\b/i

/**
 * Classify the user's message. Order matters: 'actions' beats 'report' ("what
 * actions do I have… a report?" is actions-first); 'report' beats 'topics'
 * (a report request may mention "most discussed TOPIC").
 */
export function detectIntent(message: string): RetrievalIntent {
  if (ACTIONS_RE.test(message)) return 'actions'
  if (REPORT_RE.test(message)) return 'report'
  if (TOPICS_RE.test(message)) return 'topics'
  return 'general'
}

// ── Temporal grounding ──────────────────────────────────────────────────────

export interface TemporalRange {
  /** ISO date (YYYY-MM-DD), inclusive. */
  start: string
  /** ISO date (YYYY-MM-DD), inclusive. */
  end: string
  /** Human label injected into the prompt ('this week (Jul 20 – Jul 26, 2026)'). */
  label: string
}

const iso = (d: Date): string => d.toISOString().slice(0, 10)
const DAY = 24 * 60 * 60 * 1000

/** Monday-start week bounds (matches business usage in both EN and ES). */
function weekBounds(now: Date, weekOffset: number): { start: Date; end: Date } {
  const day = now.getDay() // 0=Sun
  const mondayOffset = day === 0 ? -6 : 1 - day
  const monday = new Date(now.getTime() + (mondayOffset + weekOffset * 7) * DAY)
  const sunday = new Date(monday.getTime() + 6 * DAY)
  return { start: monday, end: sunday }
}

function monthBounds(now: Date, monthOffset: number): { start: Date; end: Date } {
  const start = new Date(now.getFullYear(), now.getMonth() + monthOffset, 1)
  const end = new Date(now.getFullYear(), now.getMonth() + monthOffset + 1, 0)
  return { start, end }
}

const fmt = (d: Date): string =>
  d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })

/**
 * Resolve the FIRST relative-date expression in the message to a concrete
 * range. Returns null when the question has no temporal anchor (retrieval
 * then stays undated — no fabricated recency).
 */
export function resolveTemporalRange(message: string, now: Date = new Date()): TemporalRange | null {
  const m = message.toLowerCase()

  if (/\b(this week|esta semana)\b/.test(m)) {
    const { start, end } = weekBounds(now, 0)
    return { start: iso(start), end: iso(end), label: `this week (${fmt(start)} – ${fmt(end)})` }
  }
  if (/\b(last week|past week|la semana pasada|la última semana|última semana)\b/.test(m)) {
    const { start, end } = weekBounds(now, -1)
    return { start: iso(start), end: iso(end), label: `last week (${fmt(start)} – ${fmt(end)})` }
  }
  if (/\b(this month|este mes)\b/.test(m)) {
    const { start, end } = monthBounds(now, 0)
    return { start: iso(start), end: iso(end), label: `this month (${fmt(start)} – ${fmt(end)})` }
  }
  if (/\b(last month|el mes pasado|último mes)\b/.test(m)) {
    const { start, end } = monthBounds(now, -1)
    return { start: iso(start), end: iso(end), label: `last month (${fmt(start)} – ${fmt(end)})` }
  }
  if (/\b(today|hoy)\b/.test(m)) {
    return { start: iso(now), end: iso(now), label: `today (${fmt(now)})` }
  }
  if (/\b(yesterday|ayer)\b/.test(m)) {
    const y = new Date(now.getTime() - DAY)
    return { start: iso(y), end: iso(y), label: `yesterday (${fmt(y)})` }
  }
  return null
}

/**
 * The ALWAYS-INJECTED date line. Without it the model cannot reason about
 * "this week" at all (its training date is months/years stale).
 */
export function dateGroundingPart(now: Date = new Date(), range: TemporalRange | null = null): string {
  const today = now.toLocaleDateString('en-US', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  })
  const rangeLine = range ? ` The user is asking about ${range.label} (dates ${range.start} to ${range.end}, inclusive).` : ''
  return `[DATE GROUNDING: Today is ${today}.${rangeLine} Resolve every relative date in the question against this before answering.]`
}

/** Is an ISO-ish timestamp inside the range (inclusive)? Tolerant of full ISO datetimes. */
export function inRange(timestamp: string | undefined, range: TemporalRange | null): boolean {
  if (!range || !timestamp) return false
  const day = timestamp.slice(0, 10)
  return day >= range.start && day <= range.end
}

// ── Structured context: actionables ─────────────────────────────────────────

export interface StructuredParts {
  parts: string[]
  /** Provenance for the persisted-answer redaction union. */
  recordingIds: Set<string>
  captureIds: Set<string>
  rowCount: number
}

interface ActionableRow {
  id: string
  type: string
  title: string
  description: string | null
  status: string | null
  created_at: string | null
  source_knowledge_id: string | null
}

const ACTIONABLE_TYPES = "('action_items', 'follow_up_work')"

/**
 * Pending action items extracted from meetings, newest first, optionally
 * range-scoped (by extraction date). Eligibility-gated through the SAME
 * shared actionable boundary the Actionables page uses.
 */
export function buildActionablesContext(
  range: TemporalRange | null,
  limit = 15,
  dateScoped = true
): StructuredParts {
  const empty: StructuredParts = { parts: [], recordingIds: new Set(), captureIds: new Set(), rowCount: 0 }
  const db = getDatabase()
  if (!db) return empty

  // dateScoped: PENDING means still-open — for a range that includes today
  // ("actions this week") filtering by extraction date would hide every open
  // item created earlier, answering "nothing" while hundreds sit open. Pass
  // false for current/future ranges (list open items, range-labelled) and
  // true for fully-past ranges ("commitments I took last month").
  const params: string[] = []
  let dateFilter = ''
  if (range && dateScoped) {
    dateFilter = 'AND substr(a.created_at, 1, 10) BETWEEN ? AND ?'
    params.push(range.start, range.end)
  }

  const rows = queryAll<ActionableRow & { kc_id: string | null; rec_id: string | null; kc_title: string | null; rec_date: string | null }>(
    `SELECT a.id, a.type, a.title, a.description, a.status, a.created_at, a.source_knowledge_id,
            kc.id AS kc_id, kc.title AS kc_title, r.id AS rec_id, r.date_recorded AS rec_date
     FROM actionables a
     LEFT JOIN knowledge_captures kc ON a.source_knowledge_id = kc.id
     LEFT JOIN recordings r ON kc.source_recording_id = r.id
     WHERE a.type IN ${ACTIONABLE_TYPES}
       AND COALESCE(a.status, 'pending') = 'pending'
       ${dateFilter}
     ORDER BY a.created_at DESC
     LIMIT ?`,
    [...params, String(limit * 3)] // over-fetch: the eligibility gate drops some
  )

  const eligible = filterEligibleActionableRows(rows, (r) => r.source_knowledge_id).slice(0, limit)
  if (eligible.length === 0) return empty

  const recordingIds = new Set<string>()
  const captureIds = new Set<string>()
  const lines = eligible.map((r) => {
    if (r.rec_id) recordingIds.add(r.rec_id)
    if (r.kc_id) captureIds.add(r.kc_id)
    const desc = r.description ? ` — ${r.description.slice(0, 280)}` : ''
    const where = r.kc_title ? ` (from "${r.kc_title}"${r.rec_date ? `, ${r.rec_date.slice(0, 10)}` : ''})` : ''
    const kind = r.type === 'follow_up_work' ? 'follow-up' : 'action items'
    return `- [${kind}] ${r.title}${desc}${where}`
  })

  const rangeNote = range
    ? dateScoped
      ? ` extracted ${range.label}`
      : ` (all currently OPEN — relevant ${range.label})`
    : ' (all currently OPEN)'
  return {
    parts: [
      `[STRUCTURED ACTION ITEMS${rangeNote} — answer action/task/commitment questions from THESE first, then corroborate with excerpts:]`,
      ...lines,
    ],
    recordingIds,
    captureIds,
    rowCount: eligible.length,
  }
}

// ── Structured context: meeting digests ─────────────────────────────────────

interface DigestRow {
  id: string
  title: string | null
  summary: string | null
  captured_at: string | null
  rec_id: string | null
  rec_date: string | null
  subject: string | null
}

/**
 * Per-meeting distilled digests (knowledge_captures title + summary) for
 * topic/report questions — the "normalize before embedding" lesson: the
 * distilled form answers topical questions far better than raw chunks.
 */
export function buildDigestsContext(range: TemporalRange, limit = 12): StructuredParts {
  const empty: StructuredParts = { parts: [], recordingIds: new Set(), captureIds: new Set(), rowCount: 0 }
  const db = getDatabase()
  if (!db) return empty

  const rows = queryAll<DigestRow>(
    `SELECT kc.id, kc.title, kc.summary, kc.captured_at, kc.source_recording_id AS rec_id,
            r.date_recorded AS rec_date, m.subject AS subject
     FROM knowledge_captures kc
     LEFT JOIN recordings r ON kc.source_recording_id = r.id
     LEFT JOIN meetings m ON kc.meeting_id = m.id
     WHERE kc.deleted_at IS NULL
       AND TRIM(COALESCE(kc.title, '')) != ''
       AND substr(COALESCE(r.date_recorded, kc.captured_at, ''), 1, 10) BETWEEN ? AND ?
     ORDER BY COALESCE(r.date_recorded, kc.captured_at) DESC
     LIMIT ?`,
    [range.start, range.end, String(limit * 3)]
  )

  // Capture-level + recording-level eligibility (shared boundary).
  const capIds = new Set(rows.map((r) => r.id))
  const { eligible: eligibleCaps } = filterEligibleCaptureIds(capIds)
  const recIds = new Set(rows.map((r) => r.rec_id).filter((x): x is string => !!x))
  const { eligible: eligibleRecs } = filterEligibleRecordingIds(recIds)
  const eligible = rows
    .filter((r) => eligibleCaps.has(r.id) && (!r.rec_id || eligibleRecs.has(r.rec_id)))
    .slice(0, limit)

  if (eligible.length === 0) return empty

  const recordingIds = new Set<string>()
  const captureIds = new Set<string>()
  const lines = eligible.map((r) => {
    if (r.rec_id) recordingIds.add(r.rec_id)
    captureIds.add(r.id)
    const date = (r.rec_date ?? r.captured_at ?? '').slice(0, 10)
    const summary = r.summary ? ` — ${r.summary.slice(0, 320)}` : ''
    const subject = r.subject && r.subject !== r.title ? ` [meeting: ${r.subject}]` : ''
    return `- ${date}: ${r.title}${subject}${summary}`
  })

  return {
    parts: [
      `[MEETING DIGESTS for ${range.label} — distilled per-meeting summaries; use THESE for topic/overview/report synthesis:]`,
      ...lines,
    ],
    recordingIds,
    captureIds,
    rowCount: eligible.length,
  }
}
