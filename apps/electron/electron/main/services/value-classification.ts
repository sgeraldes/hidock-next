/**
 * Content-based VALUE classification for knowledge_captures (F16 / spec-001).
 *
 * Every transcribed capture should get an LLM judgement of how much LASTING,
 * USEFUL KNOWLEDGE it holds — independent of metadata heuristics (duration,
 * meeting link, word count), which can't tell a real work call apart from an
 * accidentally-recorded 30-minute kitchen conversation. This module owns:
 *
 *  - the pure parse/map logic (parseValueClassification, mapValueToRating) —
 *    no DB, no network, fully unit-testable.
 *  - the guarded DB write (applyCaptureValueClassification) — never-downgrade
 *    + idempotent, so a re-analysis can safely refresh an AI-set rating
 *    without ever touching a user-set one.
 *  - the standalone re-classifier (classifyCaptureValue) for EXISTING captures
 *    that have no live analyze call in flight — the seam T3's backfill
 *    consumes for the ~1,900 already-transcribed captures. Makes its own,
 *    much cheaper, value-only complete() call (NOT the transcription.ts
 *    Gemini-direct SDK the live analysis call uses).
 *
 * Security: `value` is coerced to one of four enum values and `reasons` are
 * allowlist-filtered BEFORE anything is persisted or logged — transcript
 * content can never inject an arbitrary rating, reason tag, or log line. Logs
 * only ever carry a captureId + the resulting rating/reason tags (fixed
 * vocabulary) — NEVER transcript text, summary, or full_text.
 *
 * Deliberately does NOT import transcription.ts (no cycle — transcription.ts
 * imports FROM this module).
 */

import { queryOne, run, getRowsModified } from './database'
import { complete } from '@hidock/ai-providers'
import { getProviderConfigFromSettings } from './ai-provider-config'
import type { QualityRating } from '@/types/knowledge'

export type CaptureValue = 'high' | 'normal' | 'low' | 'none'

/** Fixed allowlist of reason tags the model may attach to a classification.
 *  Anything outside this list is dropped by parseValueClassification — the
 *  prompt-injection guard: transcript content can never inject an arbitrary
 *  reason string into the DB or into a UI-facing event payload. */
export const VALUE_REASON_TAGS = [
  'personal_family',
  'greeting_only_no_show',
  'background_ambient',
  'no_substance',
  'off_topic_chatter'
] as const

export type ValueReason = (typeof VALUE_REASON_TAGS)[number]

export interface ValueClassification {
  value: CaptureValue
  reasons: string[]
  confidence: number
}

const VALID_VALUES: readonly CaptureValue[] = ['high', 'normal', 'low', 'none']

/**
 * Coerce a raw (LLM-sourced) value-classification object into a safe,
 * well-typed shape. NEVER throws. Missing/invalid `value` defaults to
 * 'normal' (no gating — the safe default when the model didn't answer the
 * question, or answered it in a shape we don't recognise); unknown reason
 * tags are dropped (prompt-injection guard); confidence is clamped to [0,1]
 * (non-finite -> 0).
 */
export function parseValueClassification(raw: {
  value?: unknown
  value_reasons?: unknown
  value_confidence?: unknown
} | null | undefined): ValueClassification {
  const rawValue = raw?.value
  const value: CaptureValue =
    typeof rawValue === 'string' && (VALID_VALUES as readonly string[]).includes(rawValue)
      ? (rawValue as CaptureValue)
      : 'normal'

  const rawReasons = raw?.value_reasons
  const reasons: string[] = Array.isArray(rawReasons)
    ? rawReasons.filter(
        (r): r is string => typeof r === 'string' && (VALUE_REASON_TAGS as readonly string[]).includes(r)
      )
    : []

  const rawConfidence = raw?.value_confidence
  const numeric = typeof rawConfidence === 'number' ? rawConfidence : Number(rawConfidence)
  const confidence = Number.isFinite(numeric) ? Math.min(1, Math.max(0, numeric)) : 0

  return { value, reasons, confidence }
}

/**
 * Map a classified value onto the existing quality_rating taxonomy. Never
 * over-claims: 'high'/'normal' never assign a rating — `valuable` is reserved
 * for explicit user/AI action elsewhere (see classifyLowValueCaptures and the
 * Library's manual rating flow). Only the two "this isn't worth keeping"
 * buckets get an automatic write.
 */
export function mapValueToRating(value: CaptureValue): QualityRating | null {
  if (value === 'none') return 'garbage'
  if (value === 'low') return 'low-value'
  return null
}

export interface ApplyResult {
  applied: boolean
  rating: QualityRating | 'unrated'
  reason?: string
}

/**
 * Guarded, idempotent, never-downgrade DB write. Writes iff the capture is
 * currently unrated/NULL OR was itself AI-set (quality_source='ai') — so a
 * re-analysis can refresh (including resetting an AI-set 'garbage'/'low-value'
 * back to 'unrated' when the content turns out to be high/normal — a
 * legitimate un-downgrade), but a user-set rating, or a legacy rating with no
 * quality_source at all, is NEVER touched. Non-throwing; logs only captureId
 * + resulting rating (no transcript text, no summary).
 */
export function applyCaptureValueClassification(captureId: string, cls: ValueClassification): ApplyResult {
  const targetRating: QualityRating | 'unrated' = mapValueToRating(cls.value) ?? 'unrated'
  const now = new Date().toISOString()

  try {
    run(
      `UPDATE knowledge_captures
          SET quality_rating = ?, quality_confidence = ?, quality_assessed_at = ?,
              quality_reasons = ?, quality_source = 'ai', updated_at = ?
        WHERE id = ?
          AND (quality_rating = 'unrated' OR quality_rating IS NULL OR quality_source = 'ai')
          AND COALESCE(quality_source, '') != 'user'`,
      [targetRating, cls.confidence, now, JSON.stringify(cls.reasons), now, captureId]
    )

    if (getRowsModified() > 0) {
      console.log(`[ValueClassification] capture=${captureId} rating=${targetRating}`)
      return { applied: true, rating: targetRating }
    }

    // Guard blocked the write (user-set, or a legacy rating with no
    // quality_source) — or the capture id doesn't exist. Report the row's
    // actual current state rather than the attempted target.
    const current = queryOne<{ quality_rating: string | null }>(
      'SELECT quality_rating FROM knowledge_captures WHERE id = ?',
      [captureId]
    )
    return {
      applied: false,
      rating: (current?.quality_rating as QualityRating | null) ?? 'unrated',
      reason: 'not-eligible'
    }
  } catch (e) {
    console.warn(`[ValueClassification] apply failed for capture=${captureId}:`, e instanceof Error ? e.message : e)
    return { applied: false, rating: 'unrated', reason: 'error' }
  }
}

export interface CaptureValueResult {
  captureId: string
  value: CaptureValue
  rating: QualityRating | 'unrated'
  reasons: string[]
  confidence: number
  changed: boolean
  skipped?: 'no-transcript' | 'already-rated' | 'no-provider'
}

interface CaptureForClassification {
  quality_rating: string | null
  quality_source: string | null
  summary: string | null
  transcript_full_text: string | null
  meeting_subject: string | null
}

// Bound the value-only prompt's token budget regardless of recording length —
// a 30-min/1-hr transcript can be tens of thousands of characters; the stored
// summary already compresses the whole recording, so a head+tail excerpt is
// just supporting context, not the sole signal.
const TRANSCRIPT_HEAD_CHARS = 6000
const TRANSCRIPT_TAIL_CHARS = 2000

/** Bound a long transcript to a head+tail excerpt. Short transcripts pass
 *  through unchanged. */
function truncateTranscript(fullText: string): string {
  const max = TRANSCRIPT_HEAD_CHARS + TRANSCRIPT_TAIL_CHARS
  if (fullText.length <= max) return fullText
  const head = fullText.slice(0, TRANSCRIPT_HEAD_CHARS)
  const tail = fullText.slice(-TRANSCRIPT_TAIL_CHARS)
  return `${head}\n\n[...transcript truncated...]\n\n${tail}`
}

/** Value-only prompt: the same language-agnostic rubric as the live path's
 *  analysisPrompt item 9, but asking ONLY for the three value fields — not
 *  the full summary/action-items/topics analysis. */
function buildValueOnlyPrompt(summary: string | null, transcriptExcerpt: string, meetingSubject: string | null): string {
  return `Judge how much LASTING, USEFUL KNOWLEDGE this recording holds — judged from the CONTENT, not its length or language. Exactly one of:
- "high": substantive work/meeting content (decisions, plans, information worth keeping)
- "normal": ordinary conversation with some useful content
- "low": little useful content — mostly small talk, ambient/background chatter, or off-topic
- "none": no useful content — a personal/family conversation, cooking/household chatter,
          only a greeting with nobody present ("hello? is anyone there?"), background noise,
          or an accidental recording
A long recording can still be "none".
${meetingSubject ? `\nMeeting subject: ${meetingSubject}` : ''}${summary ? `\nSummary: ${summary}` : ''}

Transcript excerpt:
${transcriptExcerpt}

Respond in JSON format ONLY, no other text:
{
  "value": "high|normal|low|none",
  "value_reasons": ["zero or more of EXACTLY these tags, no others: personal_family, greeting_only_no_show, background_ambient, no_substance, off_topic_chatter"],
  "value_confidence": 0.0
}`
}

/** Local, minimal, non-throwing JSON extraction for the value-only complete()
 *  reply. Deliberately NOT the transcription.ts extractAnalysisJson (would
 *  create an import cycle) — this response is much smaller/simpler than the
 *  full analysis payload, so a fenced-block-or-brace-match + JSON.parse is
 *  enough; a malformed reply just falls through to parseValueClassification's
 *  safe default. */
function extractJsonObject(text: string): Record<string, unknown> | null {
  if (!text) return null
  const fencedInner = text.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1]
  const candidates = [fencedInner, fencedInner?.match(/\{[\s\S]*\}/)?.[0], text.match(/\{[\s\S]*\}/)?.[0]].filter(
    (c): c is string => Boolean(c)
  )
  for (const candidate of candidates) {
    try {
      return JSON.parse(candidate) as Record<string, unknown>
    } catch {
      // try the next candidate
    }
  }
  return null
}

/**
 * Standalone re-classifier for an EXISTING capture (no live analyze call in
 * flight) — the seam T3's backfill consumes for the ~1,900 already-
 * transcribed captures. STRICTER than the live path: never refreshes an
 * already-rated row (even an AI-set one) — only ever classifies a capture
 * still at the default 'unrated' state. Throws only on an unexpected failure
 * (the complete() call itself) — the backfill's per-item try/catch parks it;
 * benign cases (no transcript, already rated, no provider) return a `skipped`
 * result instead. A malformed LLM reply is non-throwing (parseValueClassification
 * degrades to 'normal' -> no rating change).
 */
export async function classifyCaptureValue(captureId: string): Promise<CaptureValueResult> {
  const row = queryOne<CaptureForClassification>(
    `SELECT kc.quality_rating AS quality_rating,
            kc.quality_source AS quality_source,
            kc.summary AS summary,
            t.full_text AS transcript_full_text,
            m.subject AS meeting_subject
       FROM knowledge_captures kc
       LEFT JOIN transcripts t ON t.recording_id = kc.source_recording_id
       LEFT JOIN meetings m ON m.id = kc.meeting_id
      WHERE kc.id = ?`,
    [captureId]
  )

  if (!row || !row.transcript_full_text || row.transcript_full_text.trim() === '') {
    return {
      captureId,
      value: 'normal',
      rating: (row?.quality_rating as QualityRating | null) ?? 'unrated',
      reasons: [],
      confidence: 0,
      changed: false,
      skipped: 'no-transcript'
    }
  }

  const isUnrated = row.quality_rating === 'unrated' || row.quality_rating === null
  if (!isUnrated || row.quality_source === 'user') {
    return {
      captureId,
      value: 'normal',
      rating: (row.quality_rating as QualityRating | null) ?? 'unrated',
      reasons: [],
      confidence: 0,
      changed: false,
      skipped: 'already-rated'
    }
  }

  const providerConfig = getProviderConfigFromSettings()
  if (!providerConfig) {
    return {
      captureId,
      value: 'normal',
      rating: 'unrated',
      reasons: [],
      confidence: 0,
      changed: false,
      skipped: 'no-provider'
    }
  }

  const transcriptExcerpt = truncateTranscript(row.transcript_full_text)
  const prompt = buildValueOnlyPrompt(row.summary, transcriptExcerpt, row.meeting_subject)

  // Deliberately NOT wrapped in try/catch: a complete() failure (network,
  // rate limit, ...) is an unexpected failure that must propagate so the
  // backfill's per-item try/catch can park it — only the JSON-parsing step
  // below is non-throwing.
  const reply = await complete(prompt, providerConfig)
  const cls = parseValueClassification(extractJsonObject(reply) ?? undefined)

  const applied = applyCaptureValueClassification(captureId, cls)

  return {
    captureId,
    value: cls.value,
    rating: applied.rating,
    reasons: cls.reasons,
    confidence: cls.confidence,
    changed: applied.applied
  }
}
