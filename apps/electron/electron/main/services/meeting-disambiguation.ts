/**
 * LLM disambiguation for meeting candidates (2026-07-24, owner design):
 *
 *   - ONE overlapping meeting  → the time match IS the answer (deterministic
 *     tier sort already guarantees it leads — no LLM call is ever made).
 *   - MULTIPLE overlapping meetings → a cheap generation pass (Gemini-first,
 *     local Ollama fallback via the brain router) reads the transcript-derived
 *     title/summary against the candidates' subjects and picks ONE.
 *
 * Everything is fail-soft: no transcript text, no brain available, a malformed
 * answer, an answer pointing at a non-candidate, or any error → null, and the
 * caller keeps the deterministic ordering. Eligibility is enforced through the
 * shouldGenerate gate, same as every other generation path.
 */

import { getChatLLMService } from './chat-llm'
import { isRecordingEligible } from './recording-eligibility'

export interface DisambiguationCandidate {
  meetingId: string
  subject: string
  startTime: string
  endTime: string
}

export interface DisambiguationResult {
  meetingId: string
  /** One short phrase explaining the pick, for the dialog's reason line. */
  reason: string
}

/** Pure: the prompt sent to the brain (kept small — this is a cheap call). */
export function buildDisambiguationPrompt(
  context: { title: string | null; summary: string | null; dateLabel: string },
  candidates: DisambiguationCandidate[]
): string {
  const fmt = (iso: string) => {
    const d = new Date(iso)
    return Number.isFinite(d.getTime())
      ? d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
      : iso
  }
  const lines = candidates.map(
    (c, i) => `${i + 1}. "${c.subject}" (${fmt(c.startTime)} – ${fmt(c.endTime)})`
  )
  return [
    `A meeting recording was made on ${context.dateLabel}.`,
    context.title ? `The transcript is titled: "${context.title}".` : null,
    context.summary ? `Transcript summary: ${context.summary}` : null,
    '',
    'These calendar meetings overlap the recording time window:',
    ...lines,
    '',
    'Which ONE meeting does this recording belong to? Answer with ONLY the meeting number,',
    'or 0 if none of them is a plausible match. No explanation, just the number.'
  ]
    .filter((l): l is string => l !== null)
    .join('\n')
}

/** Pure: parse the brain's answer into a candidate index (0-based) or null. */
export function parseDisambiguationAnswer(answer: string, candidateCount: number): number | null {
  const match = answer.trim().match(/^(\d{1,2})\b/)
  if (!match) return null
  const n = parseInt(match[1], 10)
  if (n < 1 || n > candidateCount) return null
  return n - 1
}

/**
 * Pick the meeting an ambiguous recording belongs to. Returns null when the
 * deterministic path should stand (fewer than 2 overlaps, no transcript text,
 * brain unavailable/failed, or an unusable answer).
 */
export async function disambiguateOverlappingCandidates(
  recordingId: string,
  context: { title: string | null; summary: string | null; dateLabel: string },
  candidates: DisambiguationCandidate[]
): Promise<DisambiguationResult | null> {
  if (candidates.length < 2) return null
  if (!context.title && !context.summary) return null

  try {
    const answer = await getChatLLMService().generateText(
      buildDisambiguationPrompt(context, candidates),
      'You are a precise meeting-matching assistant. You answer with a single number only.',
      { shouldGenerate: () => isRecordingEligible(recordingId) }
    )
    if (!answer) return null
    const idx = parseDisambiguationAnswer(answer, candidates.length)
    if (idx === null) return null
    const pick = candidates[idx]
    return { meetingId: pick.meetingId, reason: `AI match: "${pick.subject}"` }
  } catch (err) {
    console.warn('[MeetingDisambiguation] LLM pick failed, keeping deterministic order:', err)
    return null
  }
}
