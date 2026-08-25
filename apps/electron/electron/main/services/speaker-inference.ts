/**
 * Speaker inference (2026-07-24, owner request) — name the speaker labels the
 * first-person self-identification pass could NOT bind.
 *
 * Self-ID only binds confident first-person cues ("les habla Pedro"). Labels
 * without one stay anonymous even when the surrounding evidence is clear: the
 * meeting's attendee list, names extracted by the transcript analysis, and
 * third-party addresses in the dialogue. This pass reads ALL of that with one
 * cheap LLM call and proposes label → name.
 *
 * WRITE RULES (same philosophy as self-ID — a wrong confident name is worse
 * than an honest "Speaker N"):
 *   - only 'high'-confidence proposals are written;
 *   - the proposed name MUST appear in a trusted roster (meeting attendees,
 *     transcript participants, or contacts the transcript already resolved);
 *   - the label must not contradict the proposal (its OWN reliable self-name,
 *     if any, must be the proposed name or absent);
 *   - existing bindings (user's or self-ID's) are NEVER overwritten;
 *   - proposals are recorded as method='speaker-inference' (0.7) so they are
 *     distinguishable from near-certain self-identifications and re-sweepable.
 * Every failure mode (no roster, brain unavailable, malformed answer,
 * contradictions) skips the label — the pass is fail-quiet by design.
 */

import { z } from 'zod'
import { getChatLLMService } from './chat-llm'
import { isRecordingEligible } from './recording-eligibility'
import {
  getSpeakerMap,
  getRecordingById,
  getMeetingById,
  queryOne,
  queryAll,
  assignSpeaker,
  resolveMention
} from './database'
import { resolveContact } from './entity-resolver'

/** Same auto-link line self-identification uses for resolveContact. */
const AUTO_LINK_THRESHOLD = 0.8

// ---------------------------------------------------------------------------
// Types + parsing (pure)
// ---------------------------------------------------------------------------

export interface SpeakerTurnLite {
  speaker: string
  text: string
}

export interface InferenceProposal {
  speaker: string
  name: string
  confidence: 'high' | 'low'
  evidence?: string
}

const ProposalSchema = z.object({
  speaker: z.string().min(1),
  name: z.string().trim().min(2).max(120),
  confidence: z.enum(['high', 'low']),
  evidence: z.string().max(400).optional()
})

/** Parse the brain's JSON array into validated proposals (never throws). */
export function parseInferenceResponse(raw: string | null | undefined): InferenceProposal[] {
  if (!raw) return []
  let parsed: unknown
  try {
    const cleaned = raw.trim().replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '')
    parsed = JSON.parse(cleaned)
  } catch {
    return []
  }
  if (!Array.isArray(parsed)) return []
  const out: InferenceProposal[] = []
  for (const item of parsed) {
    const p = ProposalSchema.safeParse(item)
    if (p.success) out.push(p.data)
  }
  return out
}

/** A name is plausible when it is 2+ letters and not a generic role word. */
export function isPlausibleName(name: string): boolean {
  const tokens = name.trim().split(/\s+/)
  if (tokens.length === 0 || tokens.length > 6) return false
  const generic = new Set(['speaker', 'unknown', 'participant', 'person', 'nadie', 'desconocido', 'alguien', 'someone'])
  if (tokens.some((t) => generic.has(t.toLowerCase()))) return false
  return tokens.some((w) => (w.match(/\p{L}/gu) || []).length >= 2)
}

/** Normalize a roster name for membership checks (accent-folded, lowercase). */
export function rosterKey(name: string): string {
  return name
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

/** First-name key — "Óscar Pereda" and "Oscar" collapse. */
export function firstNameKey(name: string): string {
  return rosterKey(name).split(' ')[0] ?? ''
}

/** Build the trusted roster from meeting attendees (JSON string) + extra names. */
export function buildRoster(attendeesJson: string | null | undefined, extraNames: string[] = []): Set<string> {
  const roster = new Set<string>()
  const add = (name: string) => {
    const full = rosterKey(name)
    if (full) {
      roster.add(full)
      const first = firstNameKey(name)
      if (first.length >= 3) roster.add(first)
    }
  }
  if (attendeesJson) {
    try {
      const parsed = JSON.parse(attendeesJson)
      if (Array.isArray(parsed)) {
        for (const a of parsed) {
          if (typeof a === 'string') add(a)
          else if (a && typeof a === 'object') {
            const n = (a as Record<string, unknown>).name ?? (a as Record<string, unknown>).displayName
            if (typeof n === 'string') add(n)
          }
        }
      }
    } catch { /* attendees column not JSON — ignore */ }
  }
  for (const n of extraNames) add(n)
  return roster
}

// ---------------------------------------------------------------------------
// Prompt (pure)
// ---------------------------------------------------------------------------

export function buildInferencePrompt(input: {
  boundNames: Array<{ label: string; name: string }>
  unboundSamples: Array<{ label: string; samples: string[] }>
  rosterNames: string[]
  meetingSubject?: string | null
  transcriptTitle?: string | null
  transcriptSummary?: string | null
}): string {
  const parts: (string | null)[] = [
    'You are identifying anonymous speakers in a diarized meeting transcript.',
    input.meetingSubject ? `Meeting: "${input.meetingSubject}".` : null,
    input.transcriptTitle ? `Transcript title: "${input.transcriptTitle}".` : null,
    input.transcriptSummary ? `Summary: ${input.transcriptSummary}` : null,
    input.rosterNames.length > 0 ? `People known to be in this meeting: ${input.rosterNames.join(', ')}.` : null,
    input.boundNames.length > 0
      ? `Already identified: ${input.boundNames.map((b) => `${b.label} = ${b.name}`).join('; ')}.`
      : null,
    '',
    'For each UNIDENTIFIED label below, decide who it most likely is, using ONLY evidence in the samples',
    '(self-introductions, how OTHER speakers address them, the known attendee list, process of elimination).',
    'Answer with a JSON array, and NOTHING else, in this exact shape:',
    '[{"speaker": "Speaker 5", "name": "Full Name", "confidence": "high", "evidence": "short quote"}]',
    'Use confidence "high" ONLY when the evidence is explicit (a direct address or unambiguous elimination).',
    'If there is no clear evidence for a label, DO NOT include it in the array.',
    ''
  ]
  for (const u of input.unboundSamples) {
    parts.push(`${u.label} says:`)
    for (const s of u.samples) parts.push(`  - ${s}`)
    parts.push('')
  }
  return parts.filter((p): p is string => p !== null).join('\n')
}

// ---------------------------------------------------------------------------
// The pass
// ---------------------------------------------------------------------------

export interface InferenceRunResult {
  proposed: number
  bound: number
  skipped: boolean
}

interface TranscriptContextRow {
  title_suggestion: string | null
  summary: string | null
  speakers: string | null
}

/**
 * Infer names for the recording's UNBOUND speaker labels and bind the
 * corroborated ones. Idempotent (never overwrites existing bindings) and
 * fail-quiet (returns counts, never throws).
 */
export async function runSpeakerInference(
  recordingId: string,
  opts: { shouldPersist?: () => boolean } = {}
): Promise<InferenceRunResult> {
  // MANDATORY internal eligibility gate (same as self-ID): an excluded
  // recording's transcript never reaches the LLM and gets no new bindings.
  if (!isRecordingEligible(recordingId)) return { proposed: 0, bound: 0, skipped: true }
  if (opts.shouldPersist && !opts.shouldPersist()) return { proposed: 0, bound: 0, skipped: true }

  const existing = getSpeakerMap(recordingId)
  const boundLabels = new Set(existing.map((e) => e.speaker_label))

  const trow = queryOne<TranscriptContextRow>(
    'SELECT title_suggestion, summary, speakers FROM transcripts WHERE recording_id = ?',
    [recordingId]
  )
  let turns: SpeakerTurnLite[] = []
  try {
    const parsed = JSON.parse(trow?.speakers ?? '[]')
    if (Array.isArray(parsed)) {
      turns = parsed
        .filter((t) => t && typeof t.speaker === 'string' && typeof t.text === 'string')
        .map((t) => ({ speaker: t.speaker, text: t.text }))
    }
  } catch { /* no parseable turns */ }

  const labels = [...new Set(turns.map((t) => t.speaker))]
  const unbound = labels.filter((l) => !boundLabels.has(l))
  if (unbound.length === 0) return { proposed: 0, bound: 0, skipped: true }

  // Roster: meeting attendees (calendar invite) + the meeting's resolved
  // contacts (meeting_contacts — the "Participants From transcripts" list) +
  // names the transcript analysis already resolved for THIS recording
  // (mention_resolutions — e.g. "Babesh" extracted as a participant) + bound
  // names (for elimination context). Without these, a name the analysis
  // clearly knew could never corroborate a proposal — the 2026-07-24 gap.
  const recording = getRecordingById(recordingId)
  const meeting = recording?.meeting_id ? getMeetingById(recording.meeting_id) : undefined
  const meetingContactNames = meeting
    ? queryAll<{ name: string }>(
        // Calendar-sourced rows (source_recording_id NULL) are always fair
        // roster material; transcript-derived rows only from THIS (eligible)
        // recording — never names from an excluded sibling recording.
        `SELECT c.name FROM meeting_contacts mc JOIN contacts c ON c.id = mc.contact_id
         WHERE mc.meeting_id = ? AND (mc.source_recording_id IS NULL OR mc.source_recording_id = ?)`,
        [meeting.id, recordingId]
      ).map((r) => r.name)
    : []
  const resolvedNames = [
    ...existing.map((e) => e.name),
    ...meetingContactNames,
    ...queryAll<{ source_name: string }>(
      'SELECT DISTINCT source_name FROM mention_resolutions WHERE recording_id = ?',
      [recordingId]
    ).map((r) => r.source_name)
  ]
  const roster = buildRoster(meeting?.attendees, resolvedNames)
  if (roster.size === 0) return { proposed: 0, bound: 0, skipped: true }

  // Samples per unbound label: first turns + turns where another speaker might
  // address them are both valuable; keep it compact for a cheap call.
  const unboundSamples = unbound.map((label) => ({
    label,
    samples: turns
      .filter((t) => t.speaker === label)
      .slice(0, 4)
      .map((t) => t.text.slice(0, 220))
  }))
  // Include a few turns from OTHER speakers that mention names — addresses are
  // the strongest evidence for who an unbound label is.
  const addressSamples = turns
    .filter((t) => !unbound.includes(t.speaker))
    .filter((t) => /[A-ZÁÉÍÓÚÑ][a-záéíóúñ]{2,}/.test(t.text))
    .slice(0, 10)
  if (addressSamples.length > 0) {
    unboundSamples.push({
      label: '(context from other speakers)',
      samples: addressSamples.map((t) => `${t.speaker}: ${t.text.slice(0, 180)}`)
    })
  }

  // Display roster for the prompt (calendar invite list + resolved names).
  const attendeeDisplayNames: string[] = []
  if (meeting?.attendees) {
    try {
      const parsed = JSON.parse(meeting.attendees)
      if (Array.isArray(parsed)) {
        for (const a of parsed) {
          const n = typeof a === 'string' ? a : (a?.name ?? a?.displayName ?? '')
          if (typeof n === 'string' && n.trim()) attendeeDisplayNames.push(n.trim())
        }
      }
    } catch { /* not JSON */ }
  }

  const prompt = buildInferencePrompt({
    boundNames: existing.map((e) => ({ label: e.speaker_label, name: e.name })),
    unboundSamples,
    // The candidate roster the LLM picks FROM — invite list + meeting contacts +
    // analysis-resolved names (+ bindings for elimination). Showing only the
    // already-bound names here (as before) left the model with NO candidates
    // for fully-unbound recordings and it honestly abstained.
    rosterNames: [...new Set([...attendeeDisplayNames, ...resolvedNames])],
    meetingSubject: meeting?.subject ?? null,
    transcriptTitle: trow?.title_suggestion ?? null,
    transcriptSummary: trow?.summary ?? null
  })

  const raw = await getChatLLMService().generateText(prompt, 'You answer with a JSON array only. No prose.', {
    shouldGenerate: () => isRecordingEligible(recordingId)
  })
  if (!raw) return { proposed: 0, bound: 0, skipped: true }

  // Post-await gate, adjacent to the writes (same rule as self-ID).
  if (!isRecordingEligible(recordingId) || (opts.shouldPersist && !opts.shouldPersist())) {
    return { proposed: 0, bound: 0, skipped: true }
  }

  const proposals = parseInferenceResponse(raw).filter((p) => unbound.includes(p.speaker))
  let bound = 0
  for (const p of proposals) {
    if (p.confidence !== 'high') continue
    if (!isPlausibleName(p.name)) continue
    // Corroboration, three paths (any one suffices):
    //  1. Roster membership (meeting attendees / meeting contacts / mention
    //     resolutions / bound names) — full-name or first-name hit.
    //  2. resolveContact finds a canonical contact at the auto-link line — the
    //     identity-CORRECTION path: an ASR-garbled proposal ("Babis") resolves
    //     to the canonical person ("Bhavesh") when that contact exists.
    //  3. (Otherwise skip — never bind an uncorroborated guess.)
    const full = rosterKey(p.name)
    const first = firstNameKey(p.name)
    const rosterHit = roster.has(full) || (first.length >= 3 && roster.has(first))
    const res = resolveContact(p.name, recording?.meeting_id ? { meetingId: recording.meeting_id } : undefined)
    // resolveContact's ambiguous bucket (a bare first name denoting several
    // people) is NEVER an auto-link — same rule every other caller follows.
    const contactHit = res.id !== null && res.confidence >= AUTO_LINK_THRESHOLD && !res.ambiguous
    if (!rosterHit && !contactHit) {
      // Honest decline, visible in the log (a rejected guess should never be silent).
      console.log(
        `[SpeakerInference] ${recordingId}: declined "${p.speaker}" → "${p.name}" (confidence ${p.confidence}, roster ${rosterHit ? 'hit' : 'miss'}, contact ${res.id ? `hit ${res.confidence.toFixed(2)}${res.ambiguous ? ' ambiguous' : ''}` : 'miss'})`
      )
      continue
    }
    // Never overwrite a binding that landed while we worked.
    if (getSpeakerMap(recordingId).some((e) => e.speaker_label === p.speaker)) continue

    try {
      // contactHit → bind the CANONICAL contact (identity correction: the
      // garbled proposal resolves to the real person); else bind the proposal.
      const contact =
        contactHit && res.id
          ? assignSpeaker(recordingId, p.speaker, { contactId: res.id })
          : assignSpeaker(recordingId, p.speaker, { newName: p.name })
      try {
        resolveMention(recordingId, p.name, contact.id, 'speaker-inference', 0.7)
      } catch (e) {
        console.warn('[SpeakerInference] mention-resolution record failed (non-fatal):', e instanceof Error ? e.message : e)
      }
      bound++
      console.log(`[SpeakerInference] ${recordingId}: bound "${p.speaker}" → "${contact.name}" (inferred)`)
    } catch (e) {
      console.warn(`[SpeakerInference] bind failed for ${recordingId} "${p.speaker}":`, e instanceof Error ? e.message : e)
    }
  }

  return { proposed: proposals.length, bound, skipped: false }
}
