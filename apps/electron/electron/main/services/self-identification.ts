/**
 * Self-identification service.
 *
 * Meetings routinely open with a roll-call where people state their FULL names
 * ("Yo también Seba, eh, Santiago de la Colina", "Óscar Pereda también, por
 * favor", "les habla Pedro", "my name is Tom"). The diarizer gives us anonymous
 * "Speaker N" turns and the analysis gives a flat participant list, but nothing
 * previously BOUND a speaker label to the name that speaker states for THEMSELVES
 * — so those people stayed "Speaker 7" and their real names never became contacts.
 *
 * This service mines the diarized turns for CONFIDENT first-person self-
 * identifications and:
 *
 *   1. EXTRACTS them with a cheap lexical prefilter (so most recordings never
 *      touch an LLM) followed by a narrowly-prompted Gemini-flash pass (reusing
 *      chat-llm — NO new API key) that reports a name ONLY when the speaker names
 *      themselves, ignoring names they use for OTHER people.
 *   2. DETECTS diarization merges: if a SINGLE speaker label yields TWO OR MORE
 *      distinct first-person self-names, the diarizer merged two people into one
 *      label — we do NOT bind; we record a "speaker-merge-suspected" marker (in
 *      the generic `config` KV table) + console.warn so the per-turn/split UX and
 *      the user can see it.
 *   3. BINDS each confident label→name to a contact (resolved or created via the
 *      shared entity-resolver) through the existing assignSpeaker path, and records
 *      a 'self-identification' tiered mention-resolution (see signal-tiers.ts —
 *      just below connector-email, above calendar attendees). Manual/existing
 *      speaker bindings are NEVER overwritten.
 *
 * The pure extractor (prefilter + prompt + parse + merge analysis) is dependency-
 * free and unit-tested with the LLM mocked. The impure orchestration (DB writes,
 * lowest-priority backfill) mirrors transcript-upgrade.ts: it yields entirely to
 * the audio transcription queue so it never competes with the live backlog, and a
 * per-recording 'scanned' marker keeps re-runs from re-calling the LLM.
 *
 * NO new tables and NO schema migration: bindings use the existing
 * transcript_speakers / mention_resolutions paths and markers live in `config`.
 */

import { getChatLLMService } from './chat-llm'
import {
  queryAll,
  queryOne,
  run,
  getRecordingById,
  getSpeakerMap,
  assignSpeaker,
  resolveMention,
  getQueueItems,
  isRecordingProcessable
} from './database'
import { resolveContact } from './entity-resolver'
import { isGenericSpeakerLabel, normalizeName, accentFoldedKey } from './entity-normalize'
import { isRecordingEligible, filterEligibleRecordingIds } from './recording-eligibility'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** One diarized turn: a speaker label and the words that speaker said. */
export interface SpeakerTurn {
  speaker: string
  text: string
}

/** A single confident label→self-name binding candidate. */
export interface SelfIdentification {
  /** The transcript speaker label to bind (e.g. "Speaker 7"). */
  label: string
  /** The full name the speaker stated for themselves. */
  name: string
  /** Confidence implied by a first-person self-identification (near-certain). */
  confidence: number
}

/** A speaker label the diarizer likely merged from two people (≥2 self-names). */
export interface MergeSuspected {
  label: string
  /** The distinct self-stated names that collided on this one label. */
  names: string[]
}

/** Result of analysing a transcript's diarized turns for self-identifications. */
export interface SelfIdResult {
  identifications: SelfIdentification[]
  mergeSuspected: MergeSuspected[]
  /** Whether the LLM was actually consulted (false when the prefilter skipped it). */
  usedLLM: boolean
}

/** A raw {speaker,name} pair as reported by the LLM before merge analysis. */
export interface SelfIdEntry {
  speaker: string
  name: string
}

/** Injectable LLM for testing — returns the model's raw text (or null). */
export type SelfIdLLM = (prompt: string, systemPrompt: string) => Promise<string | null>

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Confidence a first-person self-identification implies (matches the tier). */
export const SELF_ID_CONFIDENCE = 0.97

/** Above this a resolver match is linked to an existing contact instead of created. */
const AUTO_LINK_THRESHOLD = 0.8

const MERGE_KEY_PREFIX = 'self_id:merge_suspected:'
const SCANNED_KEY_PREFIX = 'self_id:scanned:'

// ---------------------------------------------------------------------------
// Pure: lexical prefilter
// ---------------------------------------------------------------------------

/**
 * A capitalized (possibly accented) name token — the thing a self-intro cue must
 * be followed by for the prefilter to fire. Requiring a capital keeps the cue
 * specific: "soy consciente" does NOT match, "soy Santiago" does.
 */
const NAME_TOKEN = "\\p{Lu}[\\p{L}\\p{M}'’.\\-]+"

/** Unicode-safe LEFT boundary. JS `\b` is ASCII-only, so it fails before an
 *  accented capital ("Óscar" at a turn start), which is exactly the roll-call
 *  case we need — a lookbehind for "no preceding letter" handles it. */
const LEFT_BOUNDARY = '(?<![\\p{L}\\p{M}\\d])'

/**
 * First-person self-introduction cue TEMPLATES (Spanish + English). `%N%` marks
 * the self-name position — the capitalized name token the cue must be followed by.
 * One template list is compiled two ways: a NON-capturing prefilter (cheap "should
 * we call the LLM?" gate) and a CAPTURING variant used to corroborate the LLM's
 * answer against the words actually spoken (see corroborateSelfIds).
 *
 * The cue WORD may be turn-initial (capitalized) or mid-sentence (lowercase), so
 * its leading letter is matched either-case explicitly. The regex is NOT
 * case-insensitive overall, which is what keeps NAME_TOKEN's required capital
 * meaningful (an `i` flag would let "soy consciente" match).
 */
const CUE_TEMPLATES: string[] = [
  // Spanish
  `\\b[Ss]oy\\s+(?:el\\s+|la\\s+)?%N%`,
  `\\b[Mm]e\\s+llamo\\s+%N%`,
  `\\b[Mm]i\\s+nombre\\s+es\\s+%N%`,
  `\\b(?:[Ll]es|[Ll]e|[Tt]e|[Oo]s)\\s+habla\\s+%N%`,
  `\\b[Aa]qu[ií]\\s+%N%`,
  `\\b[Yy]o\\s+(?:tambi[eé]n\\s+)?,?\\s*%N%`,
  // English
  `\\b[Ii]['’]?m\\s+%N%`,
  `\\b[Ii]\\s+am\\s+%N%`,
  `\\b[Mm]y\\s+name\\s+is\\s+%N%`,
  `\\b[Tt]his\\s+is\\s+%N%`,
  `${LEFT_BOUNDARY}%N%\\s+here\\b`,
  // Roll-call "add me too": a full name (first + last) followed by "también"/"too".
  // Requires TWO capitalized tokens, so "Dile a Óscar…" (single token) never matches.
  `${LEFT_BOUNDARY}%N%\\s+${NAME_TOKEN}\\s*,?\\s+(?:tambi[eé]n|too)\\b`
]

/**
 * Templates whose captured token is RELIABLY the speaker's own name — an explicit
 * first-person predicate ("soy X", "me llamo X", "my name is X", "X here", the
 * roll-call full name). Used to detect a CONTRADICTING self-name on a label (a
 * label that clearly states one name must never be bound to a different one).
 * Excludes the two loose cues ("Yo también <addressee>, … <name>" and "Aquí X"),
 * whose adjacent token is often an ADDRESSEE, not the self-name — capturing those
 * would risk blocking a legitimate binding, so they gate the prefilter/LLM only.
 */
const RELIABLE_CUE_TEMPLATES: Set<string> = new Set(
  CUE_TEMPLATES.filter((t) => !t.includes('[Yy]o') && !t.includes('[Aa]qu'))
)

const compileCue = (template: string, name: string): RegExp =>
  new RegExp(template.replace('%N%', name), 'u')

/** Prefilter: non-capturing, identical match semantics to the original cues. */
const SELF_ID_CUE_PATTERNS: RegExp[] = CUE_TEMPLATES.map((t) => compileCue(t, `(?:${NAME_TOKEN})`))

/** Capturing variant of only the RELIABLE cues — for contradiction detection. */
const RELIABLE_NAME_CAPTURE_PATTERNS: RegExp[] = CUE_TEMPLATES.filter((t) => RELIABLE_CUE_TEMPLATES.has(t)).map(
  (t) => compileCue(t, `(${NAME_TOKEN})`)
)

/** Any capitalized (possibly accented) name token — used to check a name was
 *  actually SPOKEN somewhere in a label's own turns (not necessarily after a cue). */
const ANY_NAME_TOKEN_RE = new RegExp(NAME_TOKEN, 'gu')

/** Whether a turn's text contains any first-person self-introduction cue.
 *  Text is NFC-normalized first so combining-accent forms ("O"+U+0301) match the
 *  same as precomposed ones. */
export function hasSelfIdCue(text: string): boolean {
  const t = (text || '').normalize('NFC').trim()
  if (!t) return false
  return SELF_ID_CUE_PATTERNS.some((re) => re.test(t))
}

/** The subset of turns that carry a self-introduction cue (the LLM's input). */
export function findSelfIdCues(turns: SpeakerTurn[]): SpeakerTurn[] {
  return turns.filter((t) => t.speaker && hasSelfIdCue(t.text))
}

// ---------------------------------------------------------------------------
// Pure: LLM prompt
// ---------------------------------------------------------------------------

export const SELF_ID_SYSTEM_PROMPT = [
  'You extract SELF-identifications from meeting-transcript turns.',
  'A self-identification is a speaker stating THEIR OWN name in the first person',
  "(e.g. 'soy Ana', 'me llamo Juan', 'les habla Pedro', 'yo también, Santiago de la Colina',",
  "'I\\'m Sarah', 'my name is Tom', 'Santiago here').",
  '',
  'STRICT RULES:',
  '- Report a name ONLY when the speaker is naming THEMSELVES.',
  '- NEVER report a name the speaker uses to ADDRESS or MENTION someone else',
  "  (e.g. 'dile a Óscar', 'Óscar, ¿puedes?', 'pregúntale a María', 'gracias, Pedro').",
  '- Prefer the FULL name when stated (first + last).',
  '- If you are not confident it is a first-person self-identification, OMIT it.',
  '- A speaker may legitimately state their own name more than once — that is fine.',
  '',
  'Return ONLY a strict JSON array of objects like',
  '[{"speaker":"<label>","name":"<self-stated name>"}].',
  'Return [] when there is no confident self-identification. No prose, no code fences.'
].join('\n')

/** Build the user prompt: the cue-bearing turns, grouped by speaker label. */
export function buildSelfIdPrompt(cues: SpeakerTurn[]): string {
  const lines = cues.map((c) => `${c.speaker}: ${c.text.trim()}`)
  return [
    'Transcript turns that may contain a speaker naming themselves:',
    '',
    lines.join('\n'),
    '',
    'For each speaker label above, return the name they state for THEMSELVES (first',
    'person only). Ignore any name used for another person. JSON array only.'
  ].join('\n')
}

// ---------------------------------------------------------------------------
// Pure: parse + merge analysis
// ---------------------------------------------------------------------------

/** Strip a ```json … ``` (or bare ```) fence the model sometimes wraps JSON in. */
function stripCodeFence(raw: string): string {
  const t = raw.trim()
  const fenced = t.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i)
  return fenced ? fenced[1].trim() : t
}

/**
 * Whether a string is a plausible person name to bind (not a generic speaker
 * label, has a real alphabetic token). Conservative — a self-ID we cannot vouch
 * for is dropped rather than turned into a junk contact.
 */
export function isPlausibleSelfName(name: string): boolean {
  const t = (name || '').trim()
  if (t.length < 3) return false
  if (isGenericSpeakerLabel(t)) return false
  const tokens = t.split(/\s+/).filter((w) => /\p{L}/u.test(w))
  if (tokens.length === 0) return false
  // Require at least one token of ≥2 letters so "A." / initials-only are rejected.
  return tokens.some((w) => (w.match(/\p{L}/gu) || []).length >= 2)
}

/** Parse the LLM response into validated {speaker,name} entries (never throws). */
export function parseSelfIdResponse(raw: string | null | undefined): SelfIdEntry[] {
  if (!raw) return []
  let parsed: unknown
  try {
    parsed = JSON.parse(stripCodeFence(raw))
  } catch {
    return []
  }
  if (!Array.isArray(parsed)) return []
  const out: SelfIdEntry[] = []
  for (const item of parsed) {
    if (!item || typeof item !== 'object') continue
    const speaker = String((item as Record<string, unknown>).speaker ?? '').trim()
    const name = String((item as Record<string, unknown>).name ?? '').trim()
    if (!speaker || !name) continue
    if (!isPlausibleSelfName(name)) continue
    out.push({ speaker, name })
  }
  return out
}

/**
 * Group raw entries by speaker label and split into confident bindings vs.
 * diarization-merge suspicions. A label with exactly ONE distinct self-name is a
 * confident binding; a label with TWO OR MORE distinct self-names means the
 * diarizer merged two people onto one label — flagged, never bound.
 */
export function analyzeSelfId(entries: SelfIdEntry[]): {
  identifications: SelfIdentification[]
  mergeSuspected: MergeSuspected[]
} {
  // label -> normalizedName -> original display name (first seen wins)
  const byLabel = new Map<string, Map<string, string>>()
  for (const e of entries) {
    const label = e.speaker.trim()
    if (!label) continue
    const key = normalizeName(e.name)
    if (!key) continue
    let names = byLabel.get(label)
    if (!names) {
      names = new Map<string, string>()
      byLabel.set(label, names)
    }
    if (!names.has(key)) names.set(key, e.name.trim())
  }

  const identifications: SelfIdentification[] = []
  const mergeSuspected: MergeSuspected[] = []
  for (const [label, names] of byLabel) {
    const distinct = [...names.values()]
    if (distinct.length === 1) {
      identifications.push({ label, name: distinct[0], confidence: SELF_ID_CONFIDENCE })
    } else if (distinct.length >= 2) {
      mergeSuspected.push({ label, names: distinct })
    }
  }
  return { identifications, mergeSuspected }
}

// ---------------------------------------------------------------------------
// Pure: corroboration — Gemini gives NO voice fingerprint, so a "Speaker N" →
// name mapping is only ever an inference. Before we trust it enough to write a
// real name over a turn, we require the speaker's OWN words to back it. A wrong
// confident name (a different real person, often the opposite gender) is far
// worse than an honest "Speaker N", so anything not corroborated stays neutral.
// ---------------------------------------------------------------------------

/** Accent-fold a single token and strip edge punctuation the name char-class keeps
 *  (a trailing "." / "-" / apostrophe) so "Ana." and "Ana" key the same. */
function nameTokenKey(token: string): string {
  return accentFoldedKey(token).replace(/^[.'’-]+|[.'’-]+$/g, '')
}

/** Accent-folded first token of a name — the identity key we corroborate against
 *  the words spoken in a label's turns ("Óscar Pereda" and "oscar" collapse). */
function selfNameKey(name: string): string {
  const first = (name || '').trim().split(/\s+/)[0] || ''
  return nameTokenKey(first)
}

/** Self-name(s) captured by a RELIABLE first-person cue in one turn's text. Used
 *  to detect a label that clearly states a DIFFERENT name than the one proposed. */
export function reliableSelfNames(text: string): string[] {
  const t = (text || '').normalize('NFC').trim()
  if (!t) return []
  const out: string[] = []
  for (const re of RELIABLE_NAME_CAPTURE_PATTERNS) {
    const m = re.exec(t)
    if (m && m[1]) out.push(m[1].trim())
  }
  return out
}

/** Every capitalized name token spoken in one turn's text (accent-folded keys). */
function spokenNameKeys(text: string): Set<string> {
  const t = (text || '').normalize('NFC')
  const keys = new Set<string>()
  for (const m of t.matchAll(ANY_NAME_TOKEN_RE)) {
    const k = nameTokenKey(m[0])
    if (k) keys.add(k)
  }
  return keys
}

/** Per-label evidence gathered from that label's OWN turns. */
interface LabelEvidence {
  /** Keys of every capitalized name token spoken in the label's CUE-BEARING turns
   *  (the exact turns the LLM was shown). Restricting to cue turns means a third-
   *  party address in an ordinary turn ("Gracias, Mariana") is NOT taken as this
   *  speaker's own name. */
  spoken: Set<string>
  /** Keys of names the label stated for itself via a RELIABLE first-person cue. */
  reliable: Set<string>
}

function gatherLabelEvidence(turns: SpeakerTurn[]): Map<string, LabelEvidence> {
  const byLabel = new Map<string, LabelEvidence>()
  for (const turn of turns) {
    const label = (turn.speaker || '').trim()
    if (!label) continue
    if (!hasSelfIdCue(turn.text)) continue
    let ev = byLabel.get(label)
    if (!ev) {
      ev = { spoken: new Set<string>(), reliable: new Set<string>() }
      byLabel.set(label, ev)
    }
    for (const k of spokenNameKeys(turn.text)) ev.spoken.add(k)
    for (const n of reliableSelfNames(turn.text)) {
      const k = selfNameKey(n)
      if (k) ev.reliable.add(k)
    }
  }
  return byLabel
}

/** Outcome of corroborating the LLM's self-IDs against per-label spoken evidence. */
export interface CorroborationResult {
  identifications: SelfIdentification[]
  mergeSuspected: MergeSuspected[]
  /** Self-IDs the LLM proposed but the label's own words did NOT support — dropped
   *  so the turns keep their neutral "Speaker N" label instead of a wrong name. */
  uncorroborated: SelfIdentification[]
}

/**
 * Gate the LLM's self-identifications against the deterministic evidence in each
 * label's OWN turns. A proposed name is KEPT only when:
 *   (1) the name was actually spoken somewhere under that label (blocks a name
 *       attributed to the wrong speaker label, or invented outright); AND
 *   (2) the label does not RELIABLY state a DIFFERENT name (blocks a confident
 *       cross-identity mislabel — e.g. a turn that says "soy Sebastián" being
 *       bound to "Mariana"), and does not state two distinct names at once.
 * Everything else is dropped to `uncorroborated`, leaving the turns as "Speaker N".
 */
export function corroborateSelfIds(
  analyzed: { identifications: SelfIdentification[]; mergeSuspected: MergeSuspected[] },
  turns: SpeakerTurn[]
): CorroborationResult {
  const evidence = gatherLabelEvidence(turns)
  const identifications: SelfIdentification[] = []
  const uncorroborated: SelfIdentification[] = []
  const mergeSuspected: MergeSuspected[] = [...analyzed.mergeSuspected]
  const merged = new Set(mergeSuspected.map((m) => m.label))

  for (const id of analyzed.identifications) {
    const ev = evidence.get(id.label) ?? { spoken: new Set<string>(), reliable: new Set<string>() }
    const key = selfNameKey(id.name)

    // A label that reliably states two or more distinct self-names is a merge —
    // two people shared one diarization label; never bind, and flag it.
    if (ev.reliable.size >= 2) {
      if (!merged.has(id.label)) {
        merged.add(id.label)
        mergeSuspected.push({ label: id.label, names: [...ev.reliable] })
      }
      uncorroborated.push(id)
      continue
    }

    // (2) The label reliably states a name, but a DIFFERENT one than proposed —
    // an identity contradiction. Keep the honest "Speaker N".
    if (ev.reliable.size === 1 && !ev.reliable.has(key)) {
      uncorroborated.push(id)
      continue
    }

    // (1) The proposed name was never spoken under this label — a wrong-label
    // attribution or an LLM invention. Keep "Speaker N".
    if (!ev.spoken.has(key)) {
      uncorroborated.push(id)
      continue
    }

    identifications.push(id)
  }

  return { identifications, mergeSuspected, uncorroborated }
}

// ---------------------------------------------------------------------------
// Pure: end-to-end extractor (LLM injectable)
// ---------------------------------------------------------------------------

/** Default LLM: the cheap Gemini-flash text model via chat-llm (no new key).
 *  ADV42-2 (round-44) — forwards an optional fail-closed `shouldGenerate` gate so
 *  the BrainRouter re-checks recording eligibility before the PRIMARY and Ollama
 *  FALLBACK attempts (the diarized turns must not reach a fallback after the
 *  recording became trashed/personal/value-excluded mid-call). */
async function defaultLLM(
  prompt: string,
  systemPrompt: string,
  shouldGenerate?: () => boolean
): Promise<string | null> {
  return getChatLLMService().generate([{ role: 'user', content: prompt }], {
    systemPrompt,
    temperature: 0,
    maxTokens: 1024,
    shouldGenerate
  })
}

/**
 * Extract confident self-identifications from diarized turns. Cheap lexical
 * prefilter first — when no turn carries a self-intro cue, the LLM is NEVER
 * called and the result is empty (usedLLM:false). Otherwise the narrowly-prompted
 * model reports first-person self-names, which are parsed, split into bindings vs.
 * merge suspicions, and then CORROBORATED against the words each label actually
 * spoke (corroborateSelfIds) — a name the speaker's own turns do not support, or
 * that contradicts a name they clearly stated, is dropped rather than bound.
 * Deterministic + testable with `deps.llm` mocked.
 */
export async function extractSelfIdentifications(
  turns: SpeakerTurn[],
  deps: { llm?: SelfIdLLM; shouldGenerate?: () => boolean } = {}
): Promise<SelfIdResult> {
  const cues = findSelfIdCues(turns)
  if (cues.length === 0) {
    return { identifications: [], mergeSuspected: [], usedLLM: false }
  }
  // ADV42-2 (round-44) — when no explicit test llm is injected, use the default
  // chat-llm path with the caller's fail-closed eligibility gate wired into the
  // BrainRouter (primary + fallback rechecks). An injected mock is used as-is.
  const llm =
    deps.llm ?? ((prompt: string, systemPrompt: string) => defaultLLM(prompt, systemPrompt, deps.shouldGenerate))
  let raw: string | null = null
  try {
    raw = await llm(buildSelfIdPrompt(cues), SELF_ID_SYSTEM_PROMPT)
  } catch (e) {
    console.warn('[SelfID] LLM extraction failed:', e instanceof Error ? e.message : e)
    return { identifications: [], mergeSuspected: [], usedLLM: true }
  }
  const entries = parseSelfIdResponse(raw)
  const analyzed = analyzeSelfId(entries)
  // Corroborate the LLM's guesses against the words each label actually spoke —
  // uncorroborated / contradicted names are dropped so those turns stay "Speaker N".
  const corroborated = corroborateSelfIds(analyzed, turns)
  return {
    identifications: corroborated.identifications,
    mergeSuspected: corroborated.mergeSuspected,
    usedLLM: true
  }
}

// ---------------------------------------------------------------------------
// Impure helpers: turn loading + config markers
// ---------------------------------------------------------------------------

/** Parse a transcript `speakers` JSON column into plain {speaker,text} turns. */
export function parseSpeakerTurns(speakersJson: string | null | undefined): SpeakerTurn[] {
  if (!speakersJson) return []
  let parsed: unknown
  try {
    parsed = JSON.parse(speakersJson)
  } catch {
    return []
  }
  if (!Array.isArray(parsed)) return []
  const out: SpeakerTurn[] = []
  for (const seg of parsed) {
    if (!seg || typeof seg !== 'object') continue
    const speaker = String((seg as Record<string, unknown>).speaker ?? '').trim()
    const text = String((seg as Record<string, unknown>).text ?? '').trim()
    if (text) out.push({ speaker, text })
  }
  return out
}

function nowIso(): string {
  return new Date().toISOString()
}

function setConfigMarker(key: string, value: string): void {
  run('INSERT OR REPLACE INTO config (key, value, updated_at) VALUES (?, ?, ?)', [key, value, nowIso()])
}

function hasConfigMarker(key: string): boolean {
  return !!queryOne<{ key: string }>('SELECT key FROM config WHERE key = ?', [key])
}

function markScanned(recordingId: string): void {
  setConfigMarker(`${SCANNED_KEY_PREFIX}${recordingId}`, nowIso())
}

function isScanned(recordingId: string): boolean {
  return hasConfigMarker(`${SCANNED_KEY_PREFIX}${recordingId}`)
}

function markMergeSuspected(recordingId: string, label: string, names: string[]): void {
  setConfigMarker(`${MERGE_KEY_PREFIX}${recordingId}:${label}`, JSON.stringify({ recordingId, label, names }))
}

/**
 * All recorded speaker-merge suspicions across the corpus (for UX + reporting).
 *
 * ADV45-3 (round-47) — each marker's extracted self-names belong to a specific
 * recording (encoded in the key `${MERGE_KEY_PREFIX}${recordingId}:${label}`),
 * and a self-name is exactly the kind of excluded-recording content the deletion
 * / personal / value-exclusion promise must suppress. Selecting only `value`
 * (the prior behaviour) leaked names from trashed / personal / value-excluded /
 * hard-purged recordings via self-id:getMergeSuspected + getSelfIdStatus. Now we
 * select BOTH key and value, extract the recording id from each key, and route
 * every candidate through the shared FAIL-CLOSED recording allowlist — only
 * markers whose recording is eligible are parsed/returned; on any lookup failure
 * the set is empty (fail-closed). getSelfIdStatus derives its count from THIS
 * same filtered set.
 */
export function getMergeSuspectedMarkers(): MergeSuspected[] {
  const rows = queryAll<{ key: string; value: string | null }>(
    'SELECT key, value FROM config WHERE key LIKE ?',
    [`${MERGE_KEY_PREFIX}%`]
  )
  // recordingId is a UUID (no ':'), so the substring after the prefix up to the
  // first ':' is the recording id; the label (which may itself contain ' · ')
  // follows.
  const recIdOfKey = (key: string): string => key.slice(MERGE_KEY_PREFIX.length).split(':')[0]
  const { eligible, failClosed } = filterEligibleRecordingIds(rows.map((r) => recIdOfKey(r.key)))
  if (failClosed) return []
  const out: MergeSuspected[] = []
  for (const r of rows) {
    if (!r.value) continue
    if (!eligible.has(recIdOfKey(r.key))) continue
    try {
      const parsed = JSON.parse(r.value) as { label?: string; names?: string[] }
      if (parsed.label && Array.isArray(parsed.names)) out.push({ label: parsed.label, names: parsed.names })
    } catch {
      /* skip malformed marker */
    }
  }
  return out
}

// ---------------------------------------------------------------------------
// Impure: bind for one recording
// ---------------------------------------------------------------------------

export interface SelfIdRunResult {
  /** How many speaker labels were newly bound to a contact. */
  bound: number
  /** How many labels were flagged as diarization-merge-suspected (not bound). */
  mergeSuspected: number
  /** True when the recording was skipped (already scanned, no transcript). */
  skipped: boolean
}

/**
 * Run the self-identification pass for one recording: load its diarized turns,
 * extract confident self-IDs (LLM-gated by the lexical prefilter), bind each
 * label→name to a contact via the shared resolver + assignSpeaker path, and
 * flag any diarization merges. Idempotent: a per-recording 'scanned' marker keeps
 * re-runs from re-calling the LLM (pass `force` to override). Existing speaker
 * bindings are treated as user/manual and never overwritten.
 */
export async function runSelfIdentificationForRecording(
  recordingId: string,
  opts: { force?: boolean; llm?: SelfIdLLM; shouldPersist?: () => boolean } = {}
): Promise<SelfIdRunResult> {
  if (!opts.force && isScanned(recordingId)) {
    return { bound: 0, mergeSuspected: 0, skipped: true }
  }

  const trow = queryOne<{ speakers: string | null }>('SELECT speakers FROM transcripts WHERE recording_id = ?', [
    recordingId
  ])
  const turns = parseSpeakerTurns(trow?.speakers)
  if (turns.length === 0) {
    markScanned(recordingId)
    return { bound: 0, mergeSuspected: 0, skipped: false }
  }

  // RE8-3 (round-8) — MANDATORY internal eligibility gate BEFORE the LLM. The
  // prior design ran this ONLY when the OPTIONAL `shouldPersist` callback was
  // supplied; the production self-id:runForRecording IPC passes only {force}, so
  // a trashed / personal / value-excluded recording's diarized turns went to the
  // LLM (and created contacts/bindings) anyway. Gate here so EVERY caller is
  // fail-closed. Skip WITHOUT marking scanned so a later restore can self-identify.
  if (!isRecordingEligible(recordingId)) {
    return { bound: 0, mergeSuspected: 0, skipped: true }
  }

  // P2 (round-3) — additional in-flight gate for the pipeline (isRecordingProcessable).
  if (opts.shouldPersist && !opts.shouldPersist()) {
    return { bound: 0, mergeSuspected: 0, skipped: true }
  }

  const result = await extractSelfIdentifications(turns, {
    llm: opts.llm,
    // ADV42-2 (round-44) — re-verify eligibility before the PRIMARY and FALLBACK
    // provider attempts inside BrainRouter (the isRecordingEligible gate above is
    // pre-await only). Fail-closed via isRecordingEligible.
    shouldGenerate: () => isRecordingEligible(recordingId)
  })

  // RE8-3 (round-8) / P2 — post-await gate ADJACENT to the writes (assignSpeaker
  // creates contacts + speaker bindings, resolveMention writes mention-resolutions,
  // markMergeSuspected + markScanned write config markers — ALL below are
  // synchronous, so this one check covers them). MANDATORY internal boundary check
  // (covers value-exclusion + fail-closed for EVERY caller) AND the optional
  // in-flight `shouldPersist`. A delete/trash/exclusion that landed while the LLM
  // ran persists nothing and leaves the recording un-scanned.
  if (!isRecordingEligible(recordingId) || (opts.shouldPersist && !opts.shouldPersist())) {
    console.log(`[SelfID] ${recordingId} became ineligible mid-analysis — no bindings/markers persisted`)
    return { bound: 0, mergeSuspected: 0, skipped: true }
  }

  const meetingId = getRecordingById(recordingId)?.meeting_id ?? undefined
  // Existing bindings are the user's / prior settled truth — never overwrite them.
  const alreadyBound = new Set(getSpeakerMap(recordingId).map((e) => e.speaker_label))

  let bound = 0
  for (const id of result.identifications) {
    if (alreadyBound.has(id.label)) continue
    try {
      const res = resolveContact(id.name, meetingId ? { meetingId } : undefined)
      const contact =
        res.id && res.confidence >= AUTO_LINK_THRESHOLD
          ? assignSpeaker(recordingId, id.label, { contactId: res.id })
          : assignSpeaker(recordingId, id.label, { newName: id.name })
      // Record a tiered mention resolution so the signal hierarchy / re-sweeps know
      // this attribution came from a near-certain self-identification.
      try {
        resolveMention(recordingId, id.name, contact.id, 'self-identification', SELF_ID_CONFIDENCE)
      } catch (e) {
        console.warn('[SelfID] mention-resolution record failed (non-fatal):', e instanceof Error ? e.message : e)
      }
      bound++
      console.log(`[SelfID] ${recordingId}: bound "${id.label}" → "${contact.name}" (self-identified)`)
    } catch (e) {
      console.warn(`[SelfID] bind failed for ${recordingId} "${id.label}":`, e instanceof Error ? e.message : e)
    }
  }

  for (const m of result.mergeSuspected) {
    markMergeSuspected(recordingId, m.label, m.names)
    console.warn(
      `[SelfID] speaker-merge-suspected for ${recordingId} label "${m.label}": ${m.names.join(' / ')} — ` +
        'diarization likely merged two people onto one label; NOT binding.'
    )
  }

  markScanned(recordingId)
  return { bound, mergeSuspected: result.mergeSuspected.length, skipped: false }
}

// ---------------------------------------------------------------------------
// Impure: read-only scan + lowest-priority backfill
// ---------------------------------------------------------------------------

export interface SelfIdScanResult {
  /** Transcripts examined (those with a non-empty speakers column). */
  totalWithSpeakers: number
  /** Not-yet-scanned transcripts whose turns carry a self-intro cue (LLM work). */
  pendingWithCues: number
  /** Not-yet-scanned transcripts with no cue (would be marked scanned, no LLM). */
  pendingNoCue: number
  /** Transcripts already processed by a prior pass. */
  alreadyScanned: number
}

export interface SelfIdStatus extends SelfIdScanResult {
  backfillActive: boolean
  mergeSuspectedTotal: number
}

interface TranscriptSpeakersRow {
  recording_id: string
  speakers: string | null
}

/** All transcripts that carry diarized speaker turns. */
function loadTranscriptsWithSpeakers(): TranscriptSpeakersRow[] {
  return queryAll<TranscriptSpeakersRow>(
    "SELECT recording_id, speakers FROM transcripts WHERE speakers IS NOT NULL AND speakers != ''"
  )
}

/**
 * READ-ONLY dry run: classify every transcript by whether the self-ID pass still
 * has work to do. Uses only the cheap lexical prefilter — no LLM — so it is safe
 * to call against the live DB.
 */
export function scanSelfIdentifications(): SelfIdScanResult {
  const rows = loadTranscriptsWithSpeakers()
  let pendingWithCues = 0
  let pendingNoCue = 0
  let alreadyScanned = 0
  for (const row of rows) {
    if (isScanned(row.recording_id)) {
      alreadyScanned++
      continue
    }
    const turns = parseSpeakerTurns(row.speakers)
    if (findSelfIdCues(turns).length > 0) pendingWithCues++
    else pendingNoCue++
  }
  return {
    totalWithSpeakers: rows.length,
    pendingWithCues,
    pendingNoCue,
    alreadyScanned
  }
}

export function getSelfIdStatus(): SelfIdStatus {
  return {
    ...scanSelfIdentifications(),
    backfillActive: backfilling,
    mergeSuspectedTotal: getMergeSuspectedMarkers().length
  }
}

let backfilling = false
let backfillStopRequested = false

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))

/** True while the audio transcription queue has pending or in-flight work. The
 *  backfill defers entirely to it so it never competes for the API. */
function audioQueueBusy(): boolean {
  try {
    return getQueueItems('pending').length > 0 || getQueueItems('processing').length > 0
  } catch {
    return false
  }
}

/**
 * Drain the self-identification backlog one recording at a time, always yielding
 * to the audio transcription queue: while audio is busy it sleeps and re-checks,
 * so this work only proceeds in the gaps. The list is snapshotted once at the
 * start; each recording re-checks its 'scanned' marker before doing LLM work.
 * Reentrancy-guarded — a second call is a no-op while one drain is in flight.
 * Never throws. Returns how many recordings were processed.
 */
export async function backfillSelfIdentifications(pollMs = 30000): Promise<number> {
  if (backfilling) return 0
  backfilling = true
  backfillStopRequested = false
  let processed = 0
  try {
    const ids = loadTranscriptsWithSpeakers()
      .map((r) => r.recording_id)
      .filter((id) => !isScanned(id))
    let i = 0
    while (i < ids.length && !backfillStopRequested) {
      if (audioQueueBusy()) {
        await sleep(pollMs)
        continue
      }
      const id = ids[i]
      i++
      if (isScanned(id)) continue
      try {
        // P2 (round-3) — the id list was snapshotted at the start; a recording
        // trashed/personal/purged since then must not have its turns sent to
        // the provider or any binding/marker persisted.
        await runSelfIdentificationForRecording(id, { shouldPersist: () => isRecordingProcessable(id) })
        processed++
      } catch (e) {
        console.warn(`[SelfID] backfill failed for ${id}:`, e instanceof Error ? e.message : e)
      }
    }
  } finally {
    backfilling = false
  }
  return processed
}

/** Ask the backfill worker to stop after the current item (shutdown/tests). */
export function stopSelfIdBackfill(): void {
  backfillStopRequested = true
}

/** Test-only: whether the backfill worker is currently draining. */
export function isBackfilling(): boolean {
  return backfilling
}
