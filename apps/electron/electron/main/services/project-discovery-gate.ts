/**
 * Project discovery gate (F12).
 *
 * The reconciler used to mint a REAL `projects` row for ANY non-empty project
 * name an analysis extracted, as long as the resolver failed to match it to an
 * existing project. That conflates two different questions: the resolver scores
 * "is this the SAME project I already know?", NOT "is this a project at all". A
 * one-off phrase the model lifted out of a single sentence scored 0 on the first
 * question and was therefore auto-created — producing zero-item dead-end
 * projects the user then has to prune.
 *
 * THREE OUTCOMES, and "don't auto-create" is deliberately NOT "discard":
 *
 *   drop   — true shape violations only: punctuation/digit junk, prose, an empty
 *            string. Nothing that could plausibly be a name. Not remembered.
 *   defer  — the DEFAULT for anything plausible-but-unproven. Recorded in the
 *            observation ledger and surfaced by getPendingProjectDiscoveries()
 *            for the user to promote. Never silently lost, never auto-created.
 *   create — requires BOTH name-like structure (positive evidence, below) AND
 *            recurrence across >= MIN_DISTINCT_SOURCES distinct sources.
 *
 * WHY STRUCTURE, NOT A BLOCKLIST. An earlier cut scored any candidate with one
 * non-blocklisted token above the create floor. That is absence-of-evidence
 * masquerading as evidence: recurring extraction noise ("budget", "deadline",
 * "customer feedback") simply sits outside whatever vocabulary the list
 * enumerates and recreates the exact problem this gate exists to kill. Auto-
 * creation now needs a POSITIVE signal — see {@link nameLikeEvidence}.
 *
 * WHY NOT THE EXTRACTOR'S OWN FLAG. The analysis hands us `{ name, is_new? }`
 * and nothing else — no entity type, no per-project confidence (the sibling
 * `meeting_confidence` scores meeting selection, not this). `is_new: true` means
 * "none of the existing projects fit, so I invented this name", which is
 * precisely the noisy case rather than corroboration; and `is_new: false` only
 * reaches this gate when the resolver already failed to find the project the
 * model claimed to be matching — a contradiction, not evidence. So the flag
 * carries no positive signal in either state and is deliberately unused.
 *
 * KNOWN LIMIT, stated rather than hidden: structure cannot separate a Title-Cased
 * common phrase ("Customer Feedback") from a Title-Cased real name ("Meridian
 * Alpha"). Recurrence plus a dismissable origin='discovered' row is the backstop.
 * The gate's job is to cut the obvious noise, not to be an oracle.
 *
 * Kept dependency-free (no DB, no electron) so the thresholds are unit-testable
 * in isolation and the reconciler stays the only place that touches storage.
 */

import { normalizeName } from './entity-normalize'

// ---------------------------------------------------------------------------
// Thresholds (the single source of truth for tuning)
// ---------------------------------------------------------------------------

/** Minimum plausibility an auto-created project name must reach. */
export const CREATE_CONFIDENCE_FLOOR = 0.6

/** Distinct meetings/recordings a name must appear in before it can be created. */
export const MIN_DISTINCT_SOURCES = 2

/**
 * Shortest normalized name worth keeping. Deliberately 2, not 3: the old 3-rule
 * ran before any Unicode-aware analysis and DROPPED real short names outright —
 * "AI", "XR", and 2-character CJK names were discarded, not deferred.
 */
const MIN_NAME_LENGTH = 2
/** Longer than this and it is prose, not a name. */
const MAX_NAME_LENGTH = 60
/** More whitespace tokens than this and it is prose, not a name. */
const MAX_NAME_TOKENS = 6

/** Anything that clears the shape rules is at least plausible — and deferred. */
const BASE_PLAUSIBLE = 0.3
/** Positive name-like structure. The ONLY way to reach the create floor. */
const NAME_EVIDENCE_BONUS = 0.35
/** 2-4 tokens reads like a real project name; a nudge, never decisive. */
const MULTI_TOKEN_BONUS = 0.05
/** Ceiling for a name built ENTIRELY of generic vocabulary — deferred forever. */
const ALL_GENERIC_CAP = 0.2

/** An acronym token: 2-6 chars of caps/digits carrying at least two capitals. */
const MIN_ACRONYM = 2
const MAX_ACRONYM = 6
/** Longest token in a caseless script still readable as a name (CJK names are short). */
const MAX_UNCASED_TOKEN = 8

/**
 * Scripts with NO case distinction, where capitalization can carry no signal at
 * all. Judging these by case would permanently drop or defer every name written
 * in them, so a compact token in one of these scripts is itself the structure we
 * can observe. Han, Kana, Hangul, Arabic, Hebrew, Thai, Devanagari — matched via
 * Unicode script escapes rather than literal ranges.
 */
const UNCASED_SCRIPT =
  /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}\p{Script=Arabic}\p{Script=Hebrew}\p{Script=Thai}\p{Script=Devanagari}]/u

/**
 * Tokens that carry no project identity on their own — determiners, connectives,
 * and the generic organisational/meeting vocabulary an LLM reaches for when a
 * transcript never actually named a project. EN + ES, matching the bilingual
 * corpus this app runs against.
 *
 * This list is a FLOOR, not the gate: its only job is to stop an all-generic
 * phrase ("The Plan", "Weekly Sync") from borrowing Title Case as evidence.
 * Being absent from it proves nothing — that is what nameLikeEvidence is for.
 */
const GENERIC_NAME_TOKENS = new Set([
  // --- English: determiners / connectives ---
  'the', 'a', 'an', 'this', 'that', 'these', 'those', 'our', 'my', 'your', 'their', 'its',
  'and', 'or', 'of', 'for', 'with', 'to', 'in', 'on', 'at', 'by', 'from',
  // --- English: generic organisational vocabulary ---
  'project', 'projects', 'initiative', 'initiatives', 'effort', 'efforts',
  'program', 'programs', 'programme', 'programmes',
  'work', 'workstream', 'workstreams', 'task', 'tasks', 'topic', 'topics',
  'item', 'items', 'thing', 'things', 'stuff',
  'meeting', 'meetings', 'call', 'calls', 'sync', 'syncs', 'standup', 'standups', 'session', 'sessions',
  'weekly', 'daily', 'monthly', 'quarterly', 'annual', 'recurring',
  'review', 'reviews', 'discussion', 'discussions', 'update', 'updates',
  'status', 'statuses', 'agenda', 'agendas',
  'general', 'misc', 'miscellaneous', 'other', 'others', 'various', 'unknown', 'none', 'na', 'tbd', 'todo',
  'followup', 'follow', 'up', 'next', 'steps', 'step', 'plan', 'plans', 'planning',
  'new', 'old', 'current', 'upcoming', 'ongoing',
  // --- Spanish: determiners / connectives ---
  'el', 'la', 'los', 'las', 'un', 'una', 'unos', 'unas', 'este', 'esta', 'estos', 'estas',
  'nuestro', 'nuestra', 'nuestros', 'nuestras', 'mi', 'tu', 'su', 'sus',
  'y', 'o', 'de', 'del', 'para', 'con', 'en', 'por', 'sin',
  // --- Spanish: generic organisational vocabulary ---
  'proyecto', 'proyectos', 'iniciativa', 'iniciativas', 'trabajo', 'tarea', 'tareas',
  'tema', 'temas', 'asunto', 'asuntos', 'cosa', 'cosas',
  'reunion', 'reuniones', 'llamada', 'llamadas', 'sesion', 'sesiones', 'sincronizacion',
  'semanal', 'diaria', 'diario', 'mensual', 'trimestral', 'anual',
  'revision', 'revisiones', 'discusion', 'discusiones', 'actualizacion', 'actualizaciones',
  'estado', 'estados',
  'varios', 'varias', 'otro', 'otros', 'otra', 'otras', 'desconocido', 'desconocida',
  'ninguno', 'ninguna', 'pendiente', 'pendientes', 'seguimiento',
  'siguiente', 'siguientes', 'paso', 'pasos',
  'planes', 'planificacion', 'generales',
  'nuevo', 'nueva', 'nuevos', 'nuevas', 'viejo', 'vieja', 'viejos', 'viejas',
  'actual', 'actuales', 'proximo', 'proxima', 'proximos', 'proximas'
])

/** Combining-marks range U+0300-U+036F, built without literal marks in source. */
const COMBINING_MARKS = new RegExp(`[${String.fromCharCode(0x0300)}-${String.fromCharCode(0x036f)}]`, 'g')

/** Accent-folded lowercase key, so "revision" with an accent matches the generic form. */
function genericKey(token: string): string {
  return token.toLowerCase().normalize('NFD').replace(COMBINING_MARKS, '')
}

function isGeneric(token: string): boolean {
  return GENERIC_NAME_TOKENS.has(genericKey(token))
}

/** Positive structural signals that a string is a NAME rather than a phrase. */
export type NameEvidence =
  /** An acronym-shaped token: "CRM", "AI", "XR", "DFX5". */
  | 'acronym'
  /** A compact token in a caseless script, where case cannot signal anything. */
  | 'uncased-script'
  /** Multi-token with a capitalized non-generic token: "Meridian Alpha". */
  | 'proper-multi'

/**
 * Look for positive name-like structure in the RAW (un-normalized) string —
 * capitalization is the signal, so this must not run on a lowercased key.
 *
 * A single capitalized token ("Atlas", "Budget") is deliberately NOT evidence:
 * structurally the real name and the noise word are identical, and the extractor
 * is prompted for "2-5 words", so a lone capitalized word is already off-pattern.
 * Those defer to the suggestion queue rather than auto-creating.
 */
export function nameLikeEvidence(raw: string): NameEvidence | null {
  const tokens = (raw || '').trim().split(/\s+/).filter(Boolean)
  if (tokens.length === 0) return null

  for (const token of tokens) {
    if (isGeneric(token)) continue

    // Caseless scripts first: case-based rules are meaningless there.
    if (UNCASED_SCRIPT.test(token) && [...token].length <= MAX_UNCASED_TOKEN) {
      return 'uncased-script'
    }

    // Acronym: all caps/digits, at least two capitals ("AI", "CRM", "DFX5").
    const len = [...token].length
    if (len >= MIN_ACRONYM && len <= MAX_ACRONYM && /^[\p{Lu}\p{N}]+$/u.test(token)) {
      if ((token.match(/\p{Lu}/gu) ?? []).length >= 2) return 'acronym'
    }
  }

  // Proper-noun structure only counts alongside a second token.
  if (tokens.length >= 2) {
    for (const token of tokens) {
      if (isGeneric(token)) continue
      if ([...token].length >= 2 && /^\p{Lu}/u.test(token)) return 'proper-multi'
    }
  }

  return null
}

export interface ProjectNameQuality {
  /** Plausibility in [0,1]. 0 = structurally not a name (drop it outright). */
  score: number
  /** Machine-readable reasons, for the deferred-suggestion evidence and logs. */
  reasons: string[]
  /** Which positive structural signal (if any) was found. */
  evidence: NameEvidence | null
}

/**
 * Score how plausible a string is as a *project name*, independent of whether a
 * matching project already exists (that is the resolver's job).
 *
 * Returns 0 only for structural violations — those are extraction noise and are
 * not even worth remembering. Everything else lands in (0,1]; only a candidate
 * with {@link nameLikeEvidence} can reach {@link CREATE_CONFIDENCE_FLOOR}.
 */
export function scoreProjectNameCandidate(name: string): ProjectNameQuality {
  const raw = (name || '').trim()
  const norm = normalizeName(raw)

  // --- Shape rules: a hard 0 (extraction noise, never remembered) ------------
  const none = (reason: string): ProjectNameQuality => ({ score: 0, reasons: [reason], evidence: null })
  if (!norm) return none('empty')
  if ([...norm].length < MIN_NAME_LENGTH) return none('too-short')
  if ([...norm].length > MAX_NAME_LENGTH) return none('too-long')
  if (/[\n\r!?]/.test(raw)) return none('sentence-punctuation')
  if (!/\p{L}/u.test(norm)) return none('no-letters')

  const tokens = norm.split(' ').filter(Boolean)
  if (tokens.length > MAX_NAME_TOKENS) return none('too-many-tokens')

  // --- All-generic vocabulary: deferred forever, never auto-created ----------
  if (tokens.every((t) => isGeneric(t))) {
    return { score: ALL_GENERIC_CAP, reasons: ['all-generic-tokens'], evidence: null }
  }

  // --- Plausible by default; only positive structure lifts it to the floor ---
  const reasons: string[] = ['plausible']
  let score = BASE_PLAUSIBLE

  if (tokens.length >= 2 && tokens.length <= 4) {
    score += MULTI_TOKEN_BONUS
    reasons.push('name-shaped')
  }

  const evidence = nameLikeEvidence(raw)
  if (evidence) {
    score += NAME_EVIDENCE_BONUS
    reasons.push(`evidence:${evidence}`)
  } else {
    reasons.push('no-name-structure')
  }

  return { score: Math.min(1, Math.round(score * 100) / 100), reasons, evidence }
}

/** What the reconciler should do with an extracted project name. */
export type ProjectDiscoveryAction =
  /** Structural noise — do not create, do not remember. */
  | 'drop'
  /** Plausible but unproven — remember it and surface it as a suggestion. */
  | 'defer'
  /** Positive name structure AND corroborated recurrence — create the project. */
  | 'create'

export interface ProjectDiscoveryDecision {
  action: ProjectDiscoveryAction
  /** Name plausibility from {@link scoreProjectNameCandidate}. */
  score: number
  reasons: string[]
  /** Distinct sources the name has been observed in (including the current one). */
  distinctSources: number
}

/**
 * Combine the two gates into the final decision. Pure: the caller supplies the
 * distinct-source count from the observation ledger.
 *
 * Both bars are hard. A name without positive structure is never rescued by
 * recurrence (it stays a suggestion no matter how often it recurs — the user,
 * not the extractor, gets to promote it), and a well-formed name is never
 * created off a single mention.
 */
export function decideProjectDiscovery(opts: {
  name: string
  distinctSources: number
}): ProjectDiscoveryDecision {
  const { score, reasons } = scoreProjectNameCandidate(opts.name)
  const distinctSources = Math.max(0, opts.distinctSources)

  if (score <= 0) return { action: 'drop', score, reasons, distinctSources }
  if (score < CREATE_CONFIDENCE_FLOOR) {
    return { action: 'defer', score, reasons: [...reasons, 'below-confidence-floor'], distinctSources }
  }
  if (distinctSources < MIN_DISTINCT_SOURCES) {
    return { action: 'defer', score, reasons: [...reasons, 'single-occurrence'], distinctSources }
  }
  return { action: 'create', score, reasons: [...reasons, 'recurring'], distinctSources }
}
