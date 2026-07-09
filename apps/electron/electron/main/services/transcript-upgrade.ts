/**
 * Transcript-upgrade service.
 *
 * Old-format transcripts (~278 in the corpus) were produced before the
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
 * State lives in the `transcript_triage` table (added to the DB schema, created
 * every boot — no SCHEMA_VERSION bump). The reformat worker is gated behind the
 * audio transcription queue being idle, so it is strictly lowest-priority and
 * never competes with the live transcription backlog.
 */

import { getChatLLMService } from './chat-llm'
import { queryAll, queryOne, run, runInTransaction, saveDatabase, getQueueItems } from './database'
import {
  detectTranscriptFormat,
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

/** One transcript's full triage assessment (in-memory; not yet persisted). */
export interface TriageAssessment {
  transcriptId: string
  recordingId: string
  isLegacy: boolean
  score: number
  band: 'recommend-retranscribe' | 'reformat'
  signals: ImportanceSignals & { breakdown: Record<string, number> }
}

export interface ScanResult {
  /** Every transcript with a stored full_text that was examined. */
  totalTranscripts: number
  /** Flat (old-format) transcripts found. */
  legacyTotal: number
  /** Legacy transcripts below threshold — to be text-reformatted. */
  toReformat: number
  /** Legacy transcripts at/above threshold — recommended for re-transcription. */
  recommendedRetranscription: number
  /** Legacy transcripts already reformatted (won't be reprocessed). */
  alreadyReformatted: number
  threshold: number
}

export interface UpgradeStatus extends ScanResult {
  reformat: { none: number; queued: number; processing: number; done: number; failed: number }
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

/** Assess one transcript: detect format + compute importance. */
function assess(
  row: JoinedTranscriptRow,
  projects: { meetingIds: Set<string>; captureIds: Set<string> },
  threshold: number
): TriageAssessment {
  const fullText = row.full_text || ''
  const detection = detectTranscriptFormat({ fullText, speakers: row.speakers })
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

  const { score, breakdown } = scoreImportance(signals)
  return {
    transcriptId: row.transcript_id,
    recordingId: row.recording_id,
    isLegacy: detection.isLegacy,
    score,
    band: bandForScore(score, threshold),
    signals: { ...signals, breakdown }
  }
}

// ---------------------------------------------------------------------------
// Public: scan (read-only) + assess-and-persist
// ---------------------------------------------------------------------------

/** Existing reformat status keyed by transcript id (so a scan won't recount
 *  transcripts already reformatted). */
function loadReformatStatus(): Map<string, string> {
  const map = new Map<string, string>()
  try {
    for (const r of queryAll<{ transcript_id: string; reformat_status: string }>(
      `SELECT transcript_id, reformat_status FROM transcript_triage`
    )) {
      map.set(r.transcript_id, r.reformat_status)
    }
  } catch {
    /* triage table absent (older boot) — treated as none */
  }
  return map
}

/**
 * READ-ONLY dry run: detect + triage every transcript and return counts. Does
 * not write to the database, so it is safe to call against the live DB.
 */
export function scanOldTranscripts(threshold = DEFAULT_TRIAGE_THRESHOLD): ScanResult {
  const rows = loadTranscriptRows()
  const projects = loadProjectLinkSets()
  const existingStatus = loadReformatStatus()

  let legacyTotal = 0
  let toReformat = 0
  let recommended = 0
  let alreadyReformatted = 0

  for (const row of rows) {
    if (!row.full_text || !row.full_text.trim()) continue
    const a = assess(row, projects, threshold)
    if (!a.isLegacy) continue
    legacyTotal++
    if (existingStatus.get(a.transcriptId) === 'done') {
      alreadyReformatted++
      continue
    }
    if (a.band === 'recommend-retranscribe') recommended++
    else toReformat++
  }

  return {
    totalTranscripts: rows.length,
    legacyTotal,
    toReformat,
    recommendedRetranscription: recommended,
    alreadyReformatted,
    threshold
  }
}

/**
 * Assess every transcript and PERSIST the triage: upsert one `transcript_triage`
 * row per transcript, set `recommended_retranscription` for the important band,
 * and mark the reformat band 'queued' (unless already done/queued). Then kick the
 * lowest-priority reformat worker. Returns the same shape as a scan.
 */
export function assessAndPersistAll(threshold = DEFAULT_TRIAGE_THRESHOLD): ScanResult {
  const rows = loadTranscriptRows()
  const projects = loadProjectLinkSets()
  const existingStatus = loadReformatStatus()

  let legacyTotal = 0
  let toReformat = 0
  let recommended = 0
  let alreadyReformatted = 0

  runInTransaction(() => {
    for (const row of rows) {
      if (!row.full_text || !row.full_text.trim()) continue
      const a = assess(row, projects, threshold)

      const prior = existingStatus.get(a.transcriptId)
      const recommendedFlag = a.isLegacy && a.band === 'recommend-retranscribe' ? 1 : 0

      // Decide the reformat status. Only flat transcripts in the reformat band
      // get queued; done/processing are preserved; everything else is 'none'.
      let reformatStatus = 'none'
      if (a.isLegacy && a.band === 'reformat') {
        reformatStatus = prior === 'done' || prior === 'processing' ? prior : 'queued'
      } else if (prior) {
        reformatStatus = prior // keep a prior status even if no longer eligible
      }

      run(
        `INSERT INTO transcript_triage
           (transcript_id, recording_id, is_legacy_format, triage_score, triage_band,
            triage_signals, recommended_retranscription, reformat_status, assessed_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
         ON CONFLICT(transcript_id) DO UPDATE SET
           recording_id = excluded.recording_id,
           is_legacy_format = excluded.is_legacy_format,
           triage_score = excluded.triage_score,
           triage_band = excluded.triage_band,
           triage_signals = excluded.triage_signals,
           recommended_retranscription = excluded.recommended_retranscription,
           reformat_status = excluded.reformat_status,
           assessed_at = CURRENT_TIMESTAMP`,
        [
          a.transcriptId,
          a.recordingId,
          a.isLegacy ? 1 : 0,
          a.score,
          a.band,
          JSON.stringify(a.signals),
          recommendedFlag,
          reformatStatus
        ]
      )

      if (!a.isLegacy) continue
      legacyTotal++
      if (prior === 'done') alreadyReformatted++
      else if (recommendedFlag) recommended++
      else toReformat++
    }
  })

  saveDatabase()

  // Fire-and-forget the lowest-priority reformat worker.
  void kickReformatProcessing()

  return {
    totalTranscripts: rows.length,
    legacyTotal,
    toReformat,
    recommendedRetranscription: recommended,
    alreadyReformatted,
    threshold
  }
}

/** Recording ids flagged for a user-initiated audio re-transcription. */
export function getRecommendedRecordingIds(): string[] {
  try {
    return queryAll<{ recording_id: string }>(
      `SELECT recording_id FROM transcript_triage WHERE recommended_retranscription = 1`
    ).map((r) => r.recording_id)
  } catch {
    return []
  }
}

/** Current upgrade status: scan counts + reformat-status breakdown. */
export function getUpgradeStatus(threshold = DEFAULT_TRIAGE_THRESHOLD): UpgradeStatus {
  const scan = scanOldTranscripts(threshold)
  const reformat = { none: 0, queued: 0, processing: 0, done: 0, failed: 0 }
  try {
    for (const r of queryAll<{ reformat_status: string; c: number }>(
      `SELECT reformat_status, COUNT(*) AS c FROM transcript_triage GROUP BY reformat_status`
    )) {
      if (r.reformat_status in reformat) {
        ;(reformat as Record<string, number>)[r.reformat_status] = r.c
      }
    }
  } catch {
    /* triage table absent */
  }
  return { ...scan, reformat, reformattingActive: reformatting }
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

/** Reformat one transcript's stored text into speaker turns via the cheap text
 *  model, writing the result into `speakers` (full_text untouched). Exported for
 *  direct unit testing with a mocked chat-llm. */
export async function reformatOne(transcriptId: string): Promise<'done' | 'failed' | 'skipped'> {
  const row = queryOne<{ full_text: string | null }>(
    `SELECT full_text FROM transcripts WHERE id = ?`,
    [transcriptId]
  )
  const fullText = row?.full_text || ''
  if (!fullText.trim()) {
    markReformat(transcriptId, 'failed', 'empty full_text')
    return 'failed'
  }

  const blocks = splitIntoReformatBlocks(fullText)
  const svc = getChatLLMService()
  const segments: TriageStoredSegment[] = []

  for (const block of blocks) {
    let response: string | null
    try {
      response = await svc.generate([{ role: 'user', content: buildReformatPrompt(block) }], {
        systemPrompt: REFORMAT_SYSTEM_PROMPT,
        temperature: 0.2,
        maxTokens: 8192
      })
    } catch (e) {
      markReformat(transcriptId, 'failed', e instanceof Error ? e.message : 'LLM call failed')
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

  // Guard: never persist an empty/degenerate result (which would render nothing).
  const usable = segments.filter((s) => s.text && s.text.trim())
  if (usable.length === 0) {
    markReformat(transcriptId, 'failed', 'no usable segments produced')
    return 'failed'
  }

  runInTransaction(() => {
    run(`UPDATE transcripts SET speakers = ? WHERE id = ?`, [JSON.stringify(usable), transcriptId])
    run(
      `UPDATE transcript_triage SET reformat_status = 'done', reformat_error = NULL, reformatted_at = CURRENT_TIMESTAMP WHERE transcript_id = ?`,
      [transcriptId]
    )
  })
  saveDatabase()
  return 'done'
}

/** Update only the triage row's reformat status (own transaction). */
function markReformat(transcriptId: string, status: string, error?: string): void {
  run(
    `UPDATE transcript_triage SET reformat_status = ?, reformat_error = ? WHERE transcript_id = ?`,
    [status, error ?? null, transcriptId]
  )
  saveDatabase()
}

/** Next queued transcript to reformat (oldest assessment first). */
function nextQueuedTranscriptId(): string | undefined {
  return queryOne<{ transcript_id: string }>(
    `SELECT transcript_id FROM transcript_triage WHERE reformat_status = 'queued' ORDER BY assessed_at ASC LIMIT 1`
  )?.transcript_id
}

/**
 * Drain the reformat queue one transcript at a time, always yielding to the audio
 * transcription backlog: while audio is busy it sleeps and re-checks, so reformat
 * work only proceeds in the gaps. Reentrancy-guarded — a second call is a no-op
 * while one drain is in flight. Never throws.
 */
export async function kickReformatProcessing(pollMs = 30000): Promise<void> {
  if (reformatting) return
  reformatting = true
  reformatStopRequested = false
  try {
    while (!reformatStopRequested) {
      const next = nextQueuedTranscriptId()
      if (!next) break
      if (audioQueueBusy()) {
        await sleep(pollMs)
        continue
      }
      try {
        run(`UPDATE transcript_triage SET reformat_status = 'processing' WHERE transcript_id = ?`, [next])
        await reformatOne(next)
      } catch (e) {
        markReformat(next, 'failed', e instanceof Error ? e.message : 'reformat failed')
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
