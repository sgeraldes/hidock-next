/**
 * Transcript-upgrade service.
 *
 * Old-format transcripts (~200 in the corpus) were produced before the
 * speaker-turns pipeline and are stored as flat paragraphs. Re-transcribing all
 * of them from audio is expensive, so this service instead:
 *
 *   1. DETECTS which stored transcripts are flat (transcript-triage-core).
 *   2. TRIAGES each by importance from cheap content signals (LLM-free).
 *   3. REFORMATS the non-important majority with the cheapest text model
 *      (Gemini flash via chat-llm — no new API key), writing upgraded speaker
 *      turns into the `speakers` column WITHOUT overwriting full_text.
 *   4. FLAGS the important band for a (user-initiated) audio re-transcription
 *      instead of auto-enqueuing the costly job.
 *
 * NO new tables and NO schema migration: everything is computed on the fly from
 * existing columns, and the ONLY write is the reformatted turns into the
 * existing `transcripts.speakers` column. A successful reformat flips a row from
 * 'legacy' to 'reformatted' (see classifyTranscriptFormat), so the detection
 * itself is the idempotency guard — re-running never re-picks a finished row.
 *
 * The reformat worker is gated behind the audio transcription queue being idle,
 * so it is strictly lowest-priority and never competes with the live backlog.
 */

import { getChatLLMService } from './chat-llm'
import { queryAll, queryOne, run, runInTransaction, saveDatabase, getQueueItems } from './database'
import { isRecordingEligible, filterEligibleRecordingIds } from './recording-eligibility'
import {
  classifyTranscriptFormat,
  scoreImportance,
  bandForScore,
  countDecisionCues,
  buildReformatPrompt,
  splitIntoReformatBlocks,
  parseReformatResponse,
  REFORMAT_SYSTEM_PROMPT,
  type ImportanceSignals,
  type TriageStoredSegment
} from './transcript-triage-core'

/** Default importance threshold: score >= this → recommend audio re-transcription. */
export const DEFAULT_TRIAGE_THRESHOLD = 60

/** Joined transcript row carrying everything the triage needs in one query. */
interface JoinedTranscriptRow {
  transcript_id: string
  recording_id: string
  full_text: string | null
  speakers: string | null
  word_count: number | null
  action_items: string | null
  topics: string | null
  date_recorded: string | null
  meeting_id: string | null
  migrated_to_capture_id: string | null
  attendees: string | null
  organizer_email: string | null
  is_recurring: number | null
  capture_category: string | null
}

/** One transcript's triage assessment (in-memory; never persisted). */
export interface TriageAssessment {
  transcriptId: string
  recordingId: string
  formatClass: 'structured' | 'reformatted' | 'legacy'
  score: number
  band: 'recommend-retranscribe' | 'reformat'
}

export interface ScanResult {
  /** Every transcript with a stored full_text that was examined. */
  totalTranscripts: number
  /** Flat (old-format) transcripts still needing work. */
  legacyTotal: number
  /** Legacy transcripts below threshold — to be text-reformatted. */
  toReformat: number
  /** Legacy transcripts at/above threshold — flagged for re-transcription. */
  recommendedRetranscription: number
  /** Transcripts this pipeline already reformatted (flat full_text + turns). */
  alreadyReformatted: number
  threshold: number
}

export interface UpgradeStatus extends ScanResult {
  reformattingActive: boolean
}

// ---------------------------------------------------------------------------
// Data loading + signal computation
// ---------------------------------------------------------------------------

/** Load every transcript joined to its recording/meeting/capture context. */
function loadTranscriptRows(): JoinedTranscriptRow[] {
  return queryAll<JoinedTranscriptRow>(
    `SELECT t.id AS transcript_id, t.recording_id, t.full_text, t.speakers, t.word_count,
            t.action_items, t.topics,
            r.date_recorded, r.meeting_id, r.migrated_to_capture_id,
            m.attendees, m.organizer_email, m.is_recurring,
            kc.category AS capture_category
       FROM transcripts t
       LEFT JOIN recordings r ON r.id = t.recording_id
       LEFT JOIN meetings m ON m.id = r.meeting_id
       LEFT JOIN knowledge_captures kc ON kc.id = r.migrated_to_capture_id`
  )
}

/** Sets of meeting/capture ids that have at least one linked project. */
function loadProjectLinkSets(): { meetingIds: Set<string>; captureIds: Set<string> } {
  const meetingIds = new Set<string>()
  const captureIds = new Set<string>()
  try {
    for (const r of queryAll<{ meeting_id: string }>(`SELECT DISTINCT meeting_id FROM meeting_projects`)) {
      if (r.meeting_id) meetingIds.add(r.meeting_id)
    }
  } catch {
    /* table absent — no project links */
  }
  try {
    for (const r of queryAll<{ knowledge_capture_id: string }>(
      `SELECT DISTINCT knowledge_capture_id FROM knowledge_projects`
    )) {
      if (r.knowledge_capture_id) captureIds.add(r.knowledge_capture_id)
    }
  } catch {
    /* table absent */
  }
  return { meetingIds, captureIds }
}

/** Length of a JSON-array column, tolerant of null / malformed values. */
function jsonArrayLength(value: string | null): number {
  if (!value) return 0
  try {
    const parsed = JSON.parse(value)
    return Array.isArray(parsed) ? parsed.length : 0
  } catch {
    return 0
  }
}

/** Count attendees and detect whether the meeting is externally-facing (≥2
 *  distinct email domains among organizer + attendees is a good proxy for a
 *  client/external call rather than a purely internal one). */
function attendeeSignals(attendees: string | null, organizerEmail: string | null): {
  count: number
  hasExternal: boolean
} {
  const domains = new Set<string>()
  const addEmail = (email?: string | null): void => {
    const at = (email || '').split('@')[1]
    if (at) domains.add(at.toLowerCase().trim())
  }
  addEmail(organizerEmail)
  let count = 0
  if (attendees) {
    try {
      const parsed = JSON.parse(attendees)
      if (Array.isArray(parsed)) {
        count = parsed.length
        for (const a of parsed) {
          if (typeof a === 'string') addEmail(a)
          else if (a && typeof a === 'object') addEmail((a as { email?: string }).email)
        }
      }
    } catch {
      /* ignore malformed attendees */
    }
  }
  return { count, hasExternal: domains.size >= 2 }
}

/** Whole-days between a recording date and now (undefined when unparseable). */
function ageDaysFrom(dateRecorded: string | null): number | undefined {
  if (!dateRecorded) return undefined
  const t = Date.parse(dateRecorded)
  if (Number.isNaN(t)) return undefined
  return Math.max(0, Math.floor((Date.now() - t) / 86400000))
}

/** Assess one transcript: classify format + compute importance. */
function assess(
  row: JoinedTranscriptRow,
  projects: { meetingIds: Set<string>; captureIds: Set<string> },
  threshold: number
): TriageAssessment {
  const fullText = row.full_text || ''
  const formatClass = classifyTranscriptFormat({ fullText, speakers: row.speakers })
  const { count: attendeeCount, hasExternal } = attendeeSignals(row.attendees, row.organizer_email)

  const hasProjectLink =
    (row.meeting_id != null && projects.meetingIds.has(row.meeting_id)) ||
    (row.migrated_to_capture_id != null && projects.captureIds.has(row.migrated_to_capture_id))

  const signals: ImportanceSignals = {
    category: row.capture_category || undefined,
    wordCount: row.word_count ?? fullText.split(/\s+/).filter(Boolean).length,
    actionItemCount: jsonArrayLength(row.action_items),
    distinctTopicCount: jsonArrayLength(row.topics),
    attendeeCount,
    hasExternalAttendee: hasExternal,
    hasProjectLink,
    isRecurring: row.is_recurring === 1,
    ageDays: ageDaysFrom(row.date_recorded),
    decisionCueMatches: countDecisionCues(fullText)
  }

  const { score } = scoreImportance(signals)
  return {
    transcriptId: row.transcript_id,
    recordingId: row.recording_id,
    formatClass,
    score,
    band: bandForScore(score, threshold)
  }
}

/** Assess every transcript with usable text (skips empty full_text). */
function assessAll(threshold: number): TriageAssessment[] {
  const rows = loadTranscriptRows()
  const projects = loadProjectLinkSets()
  const out: TriageAssessment[] = []
  for (const row of rows) {
    if (!row.full_text || !row.full_text.trim()) continue
    out.push(assess(row, projects, threshold))
  }
  return out
}

/** Roll a list of assessments up into the scan counts. `total` is the row count. */
function tally(total: number, assessments: TriageAssessment[], threshold: number): ScanResult {
  let legacyTotal = 0
  let toReformat = 0
  let recommended = 0
  let alreadyReformatted = 0
  for (const a of assessments) {
    if (a.formatClass === 'reformatted') alreadyReformatted++
    if (a.formatClass !== 'legacy') continue
    legacyTotal++
    if (a.band === 'recommend-retranscribe') recommended++
    else toReformat++
  }
  return {
    totalTranscripts: total,
    legacyTotal,
    toReformat,
    recommendedRetranscription: recommended,
    alreadyReformatted,
    threshold
  }
}

// ---------------------------------------------------------------------------
// Public: scan (read-only), run (kicks reformats), flag surfacing
// ---------------------------------------------------------------------------

/**
 * READ-ONLY dry run: classify + triage every transcript and return counts. Does
 * not write anything, so it is safe to call against the live DB.
 */
export function scanOldTranscripts(threshold = DEFAULT_TRIAGE_THRESHOLD): ScanResult {
  const rows = loadTranscriptRows()
  const projects = loadProjectLinkSets()
  const assessments: TriageAssessment[] = []
  for (const row of rows) {
    if (!row.full_text || !row.full_text.trim()) continue
    assessments.push(assess(row, projects, threshold))
  }
  return tally(rows.length, assessments, threshold)
}

/**
 * Kick the upgrade: no persistence beyond the reformats themselves. Returns the
 * same counts as a scan, then fires the lowest-priority reformat worker for the
 * flat, below-threshold band. The important band is left flagged (surfaced via
 * getRecommendedRecordingIds) for a user-initiated audio re-transcription.
 */
export function runUpgrade(threshold = DEFAULT_TRIAGE_THRESHOLD): ScanResult {
  const result = scanOldTranscripts(threshold)
  void kickReformatProcessing(threshold)
  return result
}

/** Recording ids of the flat transcripts flagged for audio re-transcription. */
export function getRecommendedRecordingIds(threshold = DEFAULT_TRIAGE_THRESHOLD): string[] {
  return assessAll(threshold)
    .filter((a) => a.formatClass === 'legacy' && a.band === 'recommend-retranscribe')
    .map((a) => a.recordingId)
}

/** Transcript ids of the flat, below-threshold band — the reformat work list.
 *  RE8-1 (round-8) — the candidate list is filtered through the shared
 *  eligibility boundary FAIL-CLOSED so an excluded (personal / trashed /
 *  value-excluded) recording's transcript is never enqueued for an LLM reformat
 *  in the first place; if eligibility can't be established, the list is empty. */
function getReformatTranscriptIds(threshold: number): string[] {
  const candidates = assessAll(threshold).filter((a) => a.formatClass === 'legacy' && a.band === 'reformat')
  const { eligible, failClosed } = filterEligibleRecordingIds(candidates.map((a) => a.recordingId))
  if (failClosed) {
    console.error('[TranscriptUpgrade] reformat work list suppressed — recording eligibility unavailable (fail closed)')
    return []
  }
  return candidates.filter((a) => eligible.has(a.recordingId)).map((a) => a.transcriptId)
}

/** Current upgrade status: scan counts + whether the worker is draining. */
export function getUpgradeStatus(threshold = DEFAULT_TRIAGE_THRESHOLD): UpgradeStatus {
  return { ...scanOldTranscripts(threshold), reformattingActive: reformatting }
}

// ---------------------------------------------------------------------------
// Lowest-priority reformat worker
// ---------------------------------------------------------------------------

let reformatting = false
let reformatStopRequested = false

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))

/** True while the audio transcription queue has pending or in-flight work. The
 *  reformat worker defers entirely to it so it never competes for the API. */
function audioQueueBusy(): boolean {
  try {
    return getQueueItems('pending').length > 0 || getQueueItems('processing').length > 0
  } catch {
    return false
  }
}

/** Whether a transcript is still a flat/legacy row right now (so a drain never
 *  re-reformats one that a prior pass already upgraded). */
function isStillLegacy(transcriptId: string): boolean {
  const row = queryOne<{ full_text: string | null; speakers: string | null }>(
    `SELECT full_text, speakers FROM transcripts WHERE id = ?`,
    [transcriptId]
  )
  if (!row || !row.full_text || !row.full_text.trim()) return false
  return classifyTranscriptFormat({ fullText: row.full_text, speakers: row.speakers }) === 'legacy'
}

/**
 * Reformat one transcript's stored text into speaker turns via the cheap text
 * model, writing the result into `speakers` (full_text untouched). Exported for
 * direct unit testing with a mocked chat-llm. Returns 'done' on a successful
 * write, 'failed' on an LLM/empty error (row stays legacy and is retried on the
 * next run), or 'skipped' when the transcript has no text.
 */
export async function reformatOne(transcriptId: string): Promise<'done' | 'failed' | 'skipped'> {
  const row = queryOne<{ full_text: string | null; recording_id: string | null }>(
    `SELECT full_text, recording_id FROM transcripts WHERE id = ?`,
    [transcriptId]
  )
  const fullText = row?.full_text || ''
  if (!fullText.trim()) return 'skipped'

  // RE8-1 (round-8) — MANDATORY internal eligibility gate. reformatOne is called
  // by BOTH the worker (filtered list) and any direct caller; the transcript's
  // full_text is about to be sent to the chat LLM, so gate it here so no caller
  // can bypass it. Fail-closed: an unresolved/excluded recording sends nothing.
  const recordingId = row?.recording_id || ''
  if (!recordingId || !isRecordingEligible(recordingId)) return 'skipped'

  const blocks = splitIntoReformatBlocks(fullText)
  const svc = getChatLLMService()
  const segments: TriageStoredSegment[] = []

  for (const block of blocks) {
    // Re-check before EVERY provider call: a trash/personal/value-exclusion that
    // lands mid-run must stop further LLM sends for this transcript immediately.
    if (!isRecordingEligible(recordingId)) return 'skipped'
    let response: string | null
    try {
      response = await svc.generate([{ role: 'user', content: buildReformatPrompt(block) }], {
        systemPrompt: REFORMAT_SYSTEM_PROMPT,
        temperature: 0.2,
        maxTokens: 8192,
        // ADV42-2 (round-44) — the pre-loop check above guards entry into the
        // router; also gate the router's PRIMARY and FALLBACK attempts so a
        // trash/personal/value-exclusion committed while the Gemini attempt is
        // pending/failing never reaches the Ollama fallback for this block.
        shouldGenerate: () => isRecordingEligible(recordingId)
      })
    } catch (e) {
      console.warn(
        `[TranscriptUpgrade] reformat LLM call failed for ${transcriptId}:`,
        e instanceof Error ? e.message : e
      )
      return 'failed'
    }
    const parsed = parseReformatResponse(response || '')
    if (parsed.length === 0) {
      // A block the model couldn't structure — keep its text as one plain turn so
      // no content is lost, rather than failing the whole transcript.
      segments.push({ speaker: undefined, start: 0, text: block.trim() })
    } else {
      segments.push(...parsed)
    }
  }

  const usable = segments.filter((s) => s.text && s.text.trim())
  // Never persist a degenerate result. Also require at least one speaker label —
  // an all-unlabelled, start-0 result would still render as a flat blob and would
  // NOT flip the row out of 'legacy', so it would be re-picked forever.
  if (usable.length === 0 || !usable.some((s) => s.speaker && s.speaker.trim())) {
    console.warn(`[TranscriptUpgrade] reformat produced no structured turns for ${transcriptId}; leaving as-is`)
    return 'failed'
  }

  // Final re-check ADJACENT to persistence (no await between here and the write):
  // a recording trashed/excluded during the LLM round-trips must not get an
  // upgraded transcript persisted.
  if (!isRecordingEligible(recordingId)) return 'skipped'

  runInTransaction(() => {
    run(`UPDATE transcripts SET speakers = ? WHERE id = ?`, [JSON.stringify(usable), transcriptId])
  })
  saveDatabase()
  return 'done'
}

/**
 * Drain the reformat work list one transcript at a time, always yielding to the
 * audio transcription backlog: while audio is busy it sleeps and re-checks, so
 * reformat work only proceeds in the gaps. The list is snapshotted once at the
 * start; each item is re-verified as still-legacy right before processing.
 * Reentrancy-guarded — a second call is a no-op while one drain is in flight.
 * Never throws.
 */
export async function kickReformatProcessing(
  threshold = DEFAULT_TRIAGE_THRESHOLD,
  pollMs = 30000
): Promise<void> {
  if (reformatting) return
  reformatting = true
  reformatStopRequested = false
  try {
    const ids = getReformatTranscriptIds(threshold)
    let i = 0
    while (i < ids.length && !reformatStopRequested) {
      if (audioQueueBusy()) {
        await sleep(pollMs)
        continue
      }
      const id = ids[i]
      i++
      try {
        if (isStillLegacy(id)) await reformatOne(id)
      } catch (e) {
        console.warn(`[TranscriptUpgrade] reformat failed for ${id}:`, e instanceof Error ? e.message : e)
      }
    }
  } finally {
    reformatting = false
  }
}

/** Ask the reformat worker to stop after the current item (used on shutdown/tests). */
export function stopReformatProcessing(): void {
  reformatStopRequested = true
}

/** Test-only: whether the reformat worker is currently draining. */
export function isReformatting(): boolean {
  return reformatting
}
