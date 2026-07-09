/**
 * Recording ↔ meeting match scoring.
 *
 * The auto-correlator stores a coarse candidate list with flat placeholder
 * scores (every candidate came back as "Time overlap only 10%"), which gives the
 * "Verify Recording Match" dialog zero decidability. This module recomputes an
 * honest, discriminating score at fetch time from two cheap, explainable signals:
 *
 *   1. TIME — the actual overlap fraction of the recording window against each
 *      meeting window. Zero-overlap candidates never read as an overlap match;
 *      near-misses contribute a decaying proximity score; far same-day meetings
 *      score minimally and sort last.
 *   2. CONTENT — LLM-free lexical overlap between the transcript-derived title /
 *      topics and the meeting subject (accent/case-normalized, conservative
 *      prefix stemming so "Retrospectiva" matches "Retro").
 *
 * Overlapping candidates always rank above non-overlapping ones; within a tier,
 * the combined score decides. Every candidate carries a human-readable reason.
 */

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
const OVERLAP_BASE = 0.5 // an overlapping meeting starts here, before its fraction bonus
const POINT_OVERLAP_SCORE = 0.75 // recording start falls inside meeting (duration unknown)
const NEAR_MISS_MINUTES = 30 // gap window that still earns proximity credit
const NEAR_MISS_MAX_SCORE = 0.25 // proximity score at zero gap, decaying to 0 at the window edge
const FAR_SAME_DAY_SCORE = 0.05 // no overlap, beyond the near-miss window
const CONTENT_PER_TOKEN = 0.4 // score per distinct matched subject token
const CONTENT_MAX = 0.6 // cap so content can't fully dominate time
const NON_OVERLAP_CAP = 0.65 // keep zero-overlap candidates visibly below overlaps
const BEST_MATCH_GAP = 0.2 // lead over the runner-up required to flag "Best match"

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

  const scored = candidates.map((candidate) => {
    const mStart = Date.parse(candidate.startTime)
    const mEnd = Date.parse(candidate.endTime)

    // ---- Time signal ----
    let timeScore = 0
    let hasOverlap = false
    let timeReason = 'Same day · no overlap'

    if (recValid && Number.isFinite(mStart) && Number.isFinite(mEnd) && mEnd >= mStart) {
      const overlapMs = Math.min(recEnd, mEnd) - Math.max(recStart, mStart)

      if (durationMs > 0 && overlapMs > 0) {
        hasOverlap = true
        const fraction = clamp(overlapMs / durationMs, 0, 1)
        timeScore = OVERLAP_BASE + (1 - OVERLAP_BASE) * fraction
        timeReason =
          fraction >= 0.9
            ? 'Overlaps the entire recording'
            : `Overlaps ${Math.round(fraction * 100)}% of the recording`
      } else if (durationMs === 0 && recStart >= mStart && recStart <= mEnd) {
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
    const names = new Set<string>()
    for (const turn of parsed) {
      const name = turn && typeof turn === 'object' ? (turn as { speaker?: unknown }).speaker : undefined
      if (typeof name === 'string' && name.trim()) names.add(name.trim())
    }
    return names.size > 0 ? names.size : null
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
