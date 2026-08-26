/**
 * Recording ↔ meeting match scoring.
 *
 * The auto-correlator stores a coarse candidate list with flat placeholder
 * scores (every candidate came back as "Time overlap only 10%"), which gives the
 * "Verify Recording Match" dialog zero decidability. This module recomputes an
 * honest, discriminating score at fetch time from two cheap, explainable signals:
 *
 *   1. TIME — a symmetric fit of the recording window against each meeting window
 *      (intersection-over-union, IoU), NOT the one-sided "how much of the recording
 *      is covered" fraction. Pure containment no longer reads as a perfect match: a
 *      30-min recording swallowed by a 9h all-day event fills a sliver of that window
 *      and scores accordingly. Zero-overlap candidates never read as an overlap match;
 *      near-misses contribute a decaying proximity score; far same-day meetings
 *      score minimally and sort last. All-day / multi-hour "bridge" meetings are a
 *      WEAK signal — a recording contained in one is never a strong overlap and needs
 *      content corroboration (below) to rank at all.
 *   2. CONTENT — LLM-free lexical overlap between the transcript-derived title /
 *      topics and the meeting subject (accent/case-normalized, conservative
 *      prefix stemming so "Retrospectiva" matches "Retro").
 *
 * Overlapping candidates always rank above non-overlapping ones; within a tier,
 * the combined score decides. Every candidate carries a human-readable reason.
 */

import { countDistinctSpeakers } from './diarization-quality'

// Words that should never, on their own, drive a content match. Generic meeting
// vocabulary + Spanish/English function words.
const STOPWORDS = new Set([
  // Spanish function words
  'de', 'la', 'el', 'los', 'las', 'un', 'una', 'unos', 'unas', 'y', 'o', 'u',
  'con', 'sin', 'por', 'para', 'del', 'al', 'en', 'se', 'su', 'sus', 'lo',
  'le', 'les', 'que', 'como',
  // English function words
  'the', 'and', 'of', 'to', 'in', 'on', 'for', 'with', 'at', 'by', 'is',
  'are', 'be', 'an', 'a',
  // Generic meeting nouns — matching on these alone is not a real signal
  'meeting', 'reunion', 'call', 'sync', 'weekly', 'daily', 'session', 'sesion',
  'catchup', 'standup',
])

// Scoring weights. Tuned so a single distinctive content match can lift a
// near-miss candidate clearly above a closer-in-time candidate that shares no
// vocabulary (the reported Rec46 / "Retro Belcorp" case).
const OVERLAP_BASE = 0.5 // an overlapping meeting starts here, before its IoU-fit bonus
const IOU_ALIGNED_MIN = 0.85 // IoU at/above which the recording ≈ the meeting (aligned + same length)
const POINT_OVERLAP_SCORE = 0.75 // recording start falls inside meeting (duration unknown)
const NEAR_MISS_MINUTES = 30 // gap window that still earns proximity credit
const NEAR_MISS_MAX_SCORE = 0.25 // proximity score at zero gap, decaying to 0 at the window edge
const FAR_SAME_DAY_SCORE = 0.05 // no overlap, beyond the near-miss window
// Bridge (all-day / ≥4h) containment is a WEAK time signal: it scales with how much
// of the bridge window the recording actually fills — tiny for a real all-day event —
// and is NEVER flagged as a true overlap, so any tightly-fitting meeting outranks it.
const BRIDGE_TIME_MIN = 0.1 // floor for a recording contained in a bridge window
const BRIDGE_TIME_MAX = 0.3 // cap when the recording fills the whole bridge (unusual)
const CONTENT_PER_TOKEN = 0.4 // score per distinct matched subject token
const CONTENT_MAX = 0.6 // cap so content can't fully dominate time
const NON_OVERLAP_CAP = 0.65 // keep zero-overlap candidates visibly below overlaps
const BEST_MATCH_GAP = 0.2 // lead over the runner-up required to flag "Best match"

/**
 * A meeting this long (or flagged all-day) is a low-precision "bridge" window — a
 * recording contained in it must NOT read as a tight time match (see BRIDGE_TIME_*).
 * 4h is deliberately well below a real all-day event (≈9–24h) yet above any normal
 * timed meeting, so a genuine 3h workshop still scores on its fit.
 */
export const LONG_MEETING_MS = 4 * 60 * 60 * 1000

/** True for an all-day event or any meeting spanning ≥ {@link LONG_MEETING_MS}. */
export function isBridgeMeeting(m: { startTime: string; endTime: string; isAllDay?: boolean | null }): boolean {
  if (m.isAllDay) return true
  const start = Date.parse(m.startTime)
  const end = Date.parse(m.endTime)
  if (!Number.isFinite(start) || !Number.isFinite(end)) return false
  return end - start >= LONG_MEETING_MS
}

export interface MatchRecordingContext {
  /** ISO timestamp the recording started (recordings.date_recorded). */
  dateRecorded: string
  /** Known duration in seconds; when absent the recording is treated as a point in time. */
  durationSeconds?: number | null
  /** Transcript-derived text (title + topics) used for the lexical signal; null = no transcript. */
  contentText?: string | null
}

export interface MatchCandidateInput {
  meetingId: string
  subject: string
  startTime: string
  endTime: string
  /** True for an all-day calendar-DATE event (meetings.is_all_day); a WEAK time signal. */
  isAllDay?: boolean | null
}

export interface ScoredCandidate {
  meetingId: string
  /** 0..1 confidence. */
  confidenceScore: number
  /** Human-readable, comma-free reason phrase(s) joined with " · ". */
  matchReason: string
  hasOverlap: boolean
  /** True only when this candidate clearly leads the field. */
  isBestMatch: boolean
}

/**
 * Hard eligibility boundary for automatic meeting assignment.
 *
 * The candidate search intentionally has a +/-30 minute discovery buffer so a
 * nearby event can still appear in the verification UI. That buffer is not
 * evidence that the recording belonged to the event. Automatic links require
 * real temporal overlap (and reject weak all-day/long bridge containment), even
 * when an LLM finds generic topical vocabulary in both texts.
 */
export function isAutomaticMeetingLinkTemporallyEligible(
  recording: MatchRecordingContext,
  candidate: MatchCandidateInput
): boolean {
  return scoreMeetingCandidates(
    { ...recording, contentText: null },
    [candidate]
  )[0]?.hasOverlap === true
}

/** Calendar feeds often retain cancelled events as ordinary rows and encode
 * cancellation only in the subject (for example Outlook's `Cancelada:`).
 * Those events are historical context, never viable recording candidates. */
export function isCancelledMeetingSubject(subject: string): boolean {
  return /^\s*(?:cancelled|canceled|cancelad[oa]s?)\s*(?::|[-–—])/i.test(subject)
}

function stripAccents(value: string): string {
  return value.normalize('NFD').replace(/[̀-ͯ]/g, '')
}

function tokenize(text: string): string[] {
  return stripAccents(text.toLowerCase())
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((t) => t.length >= 3 && !/^\d+$/.test(t) && !STOPWORDS.has(t))
}

function uniqueTokens(text: string): string[] {
  return Array.from(new Set(tokenize(text)))
}

/**
 * Conservative token match: exact equality, or one token is a prefix of the
 * other with the shorter form ≥ 4 chars (so "retro" ↔ "retrospectiva", but not
 * "cx" ↔ anything). Deliberately no fuzzy/edit-distance matching.
 */
function tokensMatch(a: string, b: string): boolean {
  if (a === b) return true
  const [shorter, longer] = a.length <= b.length ? [a, b] : [b, a]
  return shorter.length >= 4 && longer.startsWith(shorter)
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

function round2(value: number): number {
  return Math.round(value * 100) / 100
}

export function scoreMeetingCandidates(
  recording: MatchRecordingContext,
  candidates: MatchCandidateInput[]
): ScoredCandidate[] {
  const recStart = Date.parse(recording.dateRecorded)
  const durationMs =
    recording.durationSeconds && recording.durationSeconds > 0 ? recording.durationSeconds * 1000 : 0
  const recEnd = durationMs > 0 ? recStart + durationMs : recStart
  const recValid = Number.isFinite(recStart)
  const recTokens = recording.contentText ? uniqueTokens(recording.contentText) : []

  const scored = candidates.filter((candidate) => !isCancelledMeetingSubject(candidate.subject)).map((candidate) => {
    const mStart = Date.parse(candidate.startTime)
    const mEnd = Date.parse(candidate.endTime)

    // ---- Time signal ----
    let timeScore = 0
    let hasOverlap = false
    let timeReason = 'Same day · no overlap'

    if (recValid && Number.isFinite(mStart) && Number.isFinite(mEnd) && mEnd >= mStart) {
      const overlapMs = Math.min(recEnd, mEnd) - Math.max(recStart, mStart)
      const meetingDurationMs = mEnd - mStart
      const bridge = isBridgeMeeting({
        startTime: candidate.startTime,
        endTime: candidate.endTime,
        isAllDay: candidate.isAllDay
      })
      const timedOverlap = durationMs > 0 && overlapMs > 0
      const pointInside = durationMs === 0 && recStart >= mStart && recStart <= mEnd

      if (bridge && (timedOverlap || pointInside)) {
        // All-day / multi-hour bridge: containment is a WEAK signal. Score by the
        // fraction of the (huge) window the recording fills — tiny in practice — and
        // NEVER flag it as a real overlap, so any tightly-fitting meeting outranks it.
        // It only surfaces when content corroborates (below) and nothing tighter fits.
        hasOverlap = false
        const fillFraction = meetingDurationMs > 0 ? clamp(durationMs / meetingDurationMs, 0, 1) : 0
        timeScore = BRIDGE_TIME_MIN + (BRIDGE_TIME_MAX - BRIDGE_TIME_MIN) * fillFraction
        const hours = Math.max(1, Math.round(meetingDurationMs / 3_600_000))
        const kind = candidate.isAllDay ? `${hours}h all-day event` : `${hours}h event`
        timeReason =
          durationMs > 0
            ? `Fills ${Math.max(1, Math.round(fillFraction * 100))}% of a ${kind} — weak`
            : `Falls inside a ${kind} — weak`
      } else if (timedOverlap) {
        hasOverlap = true
        const recCoverage = clamp(overlapMs / durationMs, 0, 1)
        // Symmetric fit: intersection over union of the two windows. A recording that
        // fills a meeting (aligned start, matching length) scores ~1; one merely
        // contained in a much longer meeting scores far lower even at recCoverage 1.
        const unionMs = Math.max(recEnd, mEnd) - Math.min(recStart, mStart)
        const iou = unionMs > 0 ? clamp(overlapMs / unionMs, 0, 1) : 0
        timeScore = OVERLAP_BASE + (1 - OVERLAP_BASE) * iou
        if (recCoverage >= 0.9) {
          timeReason =
            iou >= IOU_ALIGNED_MIN
              ? 'Aligned start · matches the meeting length'
              : 'Overlaps the entire recording'
        } else {
          timeReason = `Overlaps ${Math.round(recCoverage * 100)}% of the recording`
        }
      } else if (pointInside) {
        hasOverlap = true
        timeScore = POINT_OVERLAP_SCORE
        timeReason = 'Recording started during this meeting'
      } else {
        // No overlap — score by proximity to the nearest meeting edge.
        const gapMs = recEnd <= mStart ? mStart - recEnd : recStart - mEnd
        const gapMin = Math.max(0, Math.round(gapMs / 60000))
        if (gapMin <= NEAR_MISS_MINUTES) {
          timeScore = NEAR_MISS_MAX_SCORE * (1 - gapMin / NEAR_MISS_MINUTES)
          timeReason =
            recEnd <= mStart
              ? `Meeting starts ${gapMin} min after recording ends`
              : `Meeting ended ${gapMin} min before recording starts`
        } else {
          timeScore = FAR_SAME_DAY_SCORE
          timeReason = 'Same day · no overlap'
        }
      }
    }

    // ---- Content signal ----
    let contentScore = 0
    const matchedTerms: string[] = []
    if (recTokens.length > 0) {
      for (const subjectToken of uniqueTokens(candidate.subject)) {
        if (recTokens.some((rt) => tokensMatch(rt, subjectToken))) {
          matchedTerms.push(subjectToken)
        }
      }
      if (matchedTerms.length > 0) {
        contentScore = Math.min(CONTENT_MAX, CONTENT_PER_TOKEN * matchedTerms.length)
      }
    }
    const contentReason =
      matchedTerms.length > 0
        ? `Title mentions ${matchedTerms
            .slice(0, 2)
            .map((t) => `"${t}"`)
            .join(', ')}`
        : null

    let confidence = clamp(timeScore + contentScore, 0, 1)
    if (!hasOverlap) confidence = Math.min(confidence, NON_OVERLAP_CAP)

    const reasonParts = [timeReason]
    if (contentReason) reasonParts.push(contentReason)

    return {
      meetingId: candidate.meetingId,
      confidenceScore: round2(confidence),
      matchReason: reasonParts.join(' · '),
      hasOverlap,
      isBestMatch: false,
    }
  })

  // Overlapping candidates always sort above non-overlapping ones; ties break on score.
  scored.sort((a, b) => {
    const overlapDelta = (b.hasOverlap ? 1 : 0) - (a.hasOverlap ? 1 : 0)
    return overlapDelta !== 0 ? overlapDelta : b.confidenceScore - a.confidenceScore
  })

  // Flag a single clear leader for visual preselection.
  const top = scored[0]
  const runnerUp = scored[1]
  if (top && top.confidenceScore > 0 && (!runnerUp || top.confidenceScore - runnerUp.confidenceScore >= BEST_MATCH_GAP)) {
    top.isBestMatch = true
  }

  return scored
}

// ---------------------------------------------------------------------------
// Transcript context helpers (kept here so they're unit-testable in isolation)
// ---------------------------------------------------------------------------

/** Minimal transcript shape the context helpers read. */
export interface TranscriptContextInput {
  title_suggestion?: string | null
  summary?: string | null
  topics?: string | null
  speakers?: string | null
}

function firstSentence(text: string): string | null {
  const trimmed = text.trim()
  if (!trimmed) return null
  const match = trimmed.match(/^(.+?[.!?])(?:\s|$)/)
  if (match) return match[1]
  if (trimmed.length > 100) {
    const breakPoint = trimmed.lastIndexOf(' ', 100)
    return trimmed.slice(0, breakPoint > 0 ? breakPoint : 100) + '…'
  }
  return trimmed
}

/** Parse a topics field that may be a JSON array, or a comma/plain string, into space-joined text. */
function topicsToText(topics: string | null | undefined): string {
  if (!topics) return ''
  try {
    const parsed = JSON.parse(topics)
    if (Array.isArray(parsed)) return parsed.filter((t) => typeof t === 'string').join(' ')
  } catch {
    /* not JSON — fall through to raw */
  }
  return topics
}

/** Transcript-derived headline title (never the filename); null when unavailable. */
export function deriveTranscriptTitle(transcript: TranscriptContextInput | undefined | null): string | null {
  if (!transcript) return null
  if (transcript.title_suggestion && transcript.title_suggestion.trim()) {
    return transcript.title_suggestion.trim()
  }
  if (transcript.summary && transcript.summary.trim()) {
    return firstSentence(transcript.summary)
  }
  return null
}

/** Short summary text for the dialog header; null when unavailable. */
export function deriveTranscriptSummary(transcript: TranscriptContextInput | undefined | null): string | null {
  if (!transcript?.summary) return null
  const trimmed = transcript.summary.trim()
  return trimmed || null
}

/** Distinct speaker count from the stored speaker-turn JSON; null when unparseable/absent. */
export function countTranscriptSpeakers(transcript: TranscriptContextInput | undefined | null): number | null {
  if (!transcript?.speakers) return null
  try {
    const parsed = JSON.parse(transcript.speakers)
    if (!Array.isArray(parsed) || parsed.length === 0) return null
    const names: string[] = []
    for (const turn of parsed) {
      const name = turn && typeof turn === 'object' ? (turn as { speaker?: unknown }).speaker : undefined
      if (typeof name === 'string' && name.trim()) names.push(name.trim())
    }
    // Scheme-aware: a transcript carrying BOTH stable "Voice XXXXXX" labels and
    // residual raw "SPEAKER_00" labels must not read as twice as many people.
    const { speakerCount } = countDistinctSpeakers(names)
    return speakerCount > 0 ? speakerCount : null
  } catch {
    return null
  }
}

/** Text used for the lexical content signal (title + topics); null when there's nothing to match on. */
export function buildContentText(transcript: TranscriptContextInput | undefined | null): string | null {
  if (!transcript) return null
  const parts: string[] = []
  if (transcript.title_suggestion) parts.push(transcript.title_suggestion)
  const topics = topicsToText(transcript.topics)
  if (topics) parts.push(topics)
  const joined = parts.join(' ').trim()
  return joined || null
}

// --- Split-recording ("- Part N") meeting coverage --------------------------
//
// When the device does not stop between back-to-back meetings, ONE capture
// covers the tail of meeting A plus the whole of meeting B, and is later split
// into "<base> - Part 1" / "<base> - Part 2". Both parts legitimately overlap
// the calendar event and both get linked, so the meeting genuinely spans them.
//
// The harm was never the link - it was that consumers had no way to tell WHICH
// part holds the meeting. getRecordingsForMeeting returned them in unspecified
// (effectively insertion) order, so anything taking [0] got Part 1: a 25-minute
// clip whose overlap with the event is the 4 minutes before the conversation
// actually started, while the real 56-minute interview sat in Part 2. A
// downstream tool concluded the interview never happened.
//
// So: rank by how much of the MEETING each part actually covers, and publish
// the fraction so a consumer can see "this meeting spans Part 1 and Part 2".

/** `<base> - Part N` decomposition, or null when the name is not a split part. */
export interface RecordingPartName {
  baseName: string
  partNumber: number
}

const PART_SUFFIX = /^(?<base>.+?)\s+-\s+Part\s+(?<part>\d+)$/i

/** Parse a split-part filename. Extension is ignored; `null` when not a part. */
export function parsePartName(filename: string | null | undefined): RecordingPartName | null {
  if (!filename) return null
  const withoutExt = filename.replace(/\.[^.\\/]+$/, '')
  const match = PART_SUFFIX.exec(withoutExt.trim())
  const groups = match?.groups
  if (!groups) return null
  const partNumber = Number(groups.part)
  if (!Number.isFinite(partNumber) || partNumber < 1) return null
  return { baseName: groups.base.trim(), partNumber }
}

export interface CoverageRecordingInput {
  filename?: string | null
  dateRecorded: string
  durationSeconds?: number | null
}

export interface CoverageMeetingInput {
  startTime: string
  endTime: string
}

export interface MeetingCoverage {
  /** Seconds of the meeting window this recording actually spans. */
  overlapSeconds: number
  /** Share of the MEETING covered by this recording (0..1). The ranking signal. */
  meetingCoverage: number
  /** Share of the RECORDING that falls inside the meeting (0..1). */
  recordingCoverage: number
  /** Part number when the filename is `<base> - Part N`, else null. */
  partNumber: number | null
  /** Base name shared with sibling parts, else null. */
  partBaseName: string | null
}

const EMPTY_COVERAGE: MeetingCoverage = {
  overlapSeconds: 0,
  meetingCoverage: 0,
  recordingCoverage: 0,
  partNumber: null,
  partBaseName: null
}

/** How much of `meeting` this recording covers, and its split-part identity. */
export function computeMeetingCoverage(
  recording: CoverageRecordingInput,
  meeting: CoverageMeetingInput
): MeetingCoverage {
  const part = parsePartName(recording.filename)
  const partFields = {
    partNumber: part?.partNumber ?? null,
    partBaseName: part?.baseName ?? null
  }

  const recStart = Date.parse(recording.dateRecorded)
  const meetStart = Date.parse(meeting.startTime)
  const meetEnd = Date.parse(meeting.endTime)
  const durationSeconds = recording.durationSeconds ?? 0
  if (
    !Number.isFinite(recStart) ||
    !Number.isFinite(meetStart) ||
    !Number.isFinite(meetEnd) ||
    meetEnd <= meetStart ||
    durationSeconds <= 0
  ) {
    return { ...EMPTY_COVERAGE, ...partFields }
  }

  const recEnd = recStart + durationSeconds * 1000
  const overlapMs = Math.max(0, Math.min(recEnd, meetEnd) - Math.max(recStart, meetStart))
  const meetingMs = meetEnd - meetStart
  const recordingMs = recEnd - recStart
  return {
    overlapSeconds: Math.round(overlapMs / 1000),
    meetingCoverage: round3(overlapMs / meetingMs),
    recordingCoverage: round3(overlapMs / recordingMs),
    ...partFields
  }
}

function round3(value: number): number {
  return Math.round(value * 1000) / 1000
}

/**
 * Order recordings so the one that actually holds the meeting comes FIRST.
 *
 * Primary key is meeting coverage (descending) - the part containing the bulk
 * of the meeting wins over one that merely clips its start edge. Ties fall back
 * to chronological order so non-split recordings keep their familiar ordering.
 */
export function rankRecordingsByMeetingCoverage<
  T extends CoverageRecordingInput
>(recordings: T[], meeting: CoverageMeetingInput): Array<T & MeetingCoverage> {
  return recordings
    .map((recording) => ({ ...recording, ...computeMeetingCoverage(recording, meeting) }))
    .sort(
      (a, b) =>
        b.meetingCoverage - a.meetingCoverage ||
        Date.parse(a.dateRecorded) - Date.parse(b.dateRecorded)
    )
}
