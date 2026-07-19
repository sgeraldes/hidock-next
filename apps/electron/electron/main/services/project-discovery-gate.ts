/**
 * Project discovery gate (F12).
 *
 * The reconciler used to mint a REAL `projects` row for ANY non-empty project
 * name an analysis extracted, as long as the resolver failed to match it to an
 * existing project (confidence < 0.5). That is the wrong default: the resolver's
 * score answers "is this the SAME project as one I already know?", NOT "is this a
 * project at all". A one-off phrase the model lifted out of a single sentence
 * ("next steps", "the migration", "weekly sync") scored 0 on the first question
 * and was therefore auto-created — producing zero-item dead-end projects the user
 * then has to prune.
 *
 * This module holds the PURE policy that decides instead. Two independent gates,
 * both of which must pass before anything is created:
 *
 *   1. NAME PLAUSIBILITY ({@link scoreProjectNameCandidate}) — does the string
 *      even look like a project *name*? Shape violations (sentence fragments,
 *      single characters, digit soup) are dropped outright; names built entirely
 *      from generic meeting/organisational vocabulary are capped below the floor.
 *
 *   2. RECURRENCE — has the name been seen in at least {@link MIN_DISTINCT_SOURCES}
 *      DISTINCT sources (meetings, or standalone recordings)? A single mention is
 *      not evidence of an ongoing project; a name that keeps coming back is. The
 *      caller supplies the count from the durable observation ledger, so
 *      re-analysing the same recording never manufactures recurrence.
 *
 * Anything that fails either gate but is not outright junk is DEFERRED: the
 * observation is remembered and surfaced as a discovery suggestion the user can
 * accept, rather than silently becoming a project. Nothing is lost — it just
 * stops being the machine's decision.
 *
 * Kept dependency-free (no DB, no electron) so the thresholds are unit-testable
 * in isolation and the reconciler stays the only place that touches storage.
 */

import { normalizeName } from './entity-normalize'

// ---------------------------------------------------------------------------
// Thresholds (the single source of truth for tuning)
// ---------------------------------------------------------------------------

/** Minimum plausibility score an auto-created project name must reach. */
export const CREATE_CONFIDENCE_FLOOR = 0.6

/** Distinct meetings/recordings a name must appear in before it can be created. */
export const MIN_DISTINCT_SOURCES = 2

/** Shortest normalized name worth considering (blocks "a", "Q3", stray initials). */
const MIN_NAME_LENGTH = 3
/** Longest normalized name worth considering — beyond this it is a sentence. */
const MAX_NAME_LENGTH = 60
/** More whitespace tokens than this and it is prose, not a name. */
const MAX_NAME_TOKENS = 6
/** A token must be at least this long to count as carrying identity. */
const MIN_DISTINCTIVE_TOKEN = 3

/** Every candidate that clears the shape rules starts here. */
const BASE_SCORE = 0.4
/** At least one token outside the generic vocabulary — the main identity signal. */
const DISTINCTIVE_TOKEN_BONUS = 0.35
/** 2–4 tokens is the shape of a real project name ("Meridian Alpha", "Atlas Migration"). */
const MULTI_TOKEN_BONUS = 0.1
/** The raw string carries an uppercase letter — a weak proper-noun signal. */
const PROPER_CASE_BONUS = 0.1
/** Ceiling for a name built ENTIRELY of generic vocabulary (kept below the floor). */
const ALL_GENERIC_CAP = 0.2

/**
 * Tokens that carry no project identity on their own — determiners, connectives,
 * and the generic organisational/meeting vocabulary an LLM reaches for when a
 * transcript never actually named a project. EN + ES, matching the bilingual
 * corpus this app runs against.
 *
 * A name is only capped when EVERY token is in here: "Migration Plan" keeps
 * "migration" and passes, "the plan" does not. Membership is checked on
 * accent-folded lowercase tokens.
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
  'estado', 'estados', 'agenda', 'agendas',
  'varios', 'varias', 'otro', 'otros', 'otra', 'otras', 'desconocido', 'desconocida',
  'ninguno', 'ninguna', 'pendiente', 'pendientes', 'seguimiento',
  'siguiente', 'siguientes', 'paso', 'pasos',
  'plan', 'planes', 'planificacion', 'general', 'generales',
  'nuevo', 'nueva', 'nuevos', 'nuevas', 'viejo', 'vieja', 'viejos', 'viejas',
  'actual', 'actuales', 'proximo', 'proxima', 'proximos', 'proximas'
])

/** Combining-marks range U+0300–U+036F, built without literal marks in source. */
const COMBINING_MARKS = new RegExp(`[${String.fromCharCode(0x0300)}-${String.fromCharCode(0x036f)}]`, 'g')

/** Accent-folded lowercase token key, so "revisión" matches the generic "revision". */
function foldToken(token: string): string {
  return token.normalize('NFD').replace(COMBINING_MARKS, '')
}

export interface ProjectNameQuality {
  /** Plausibility in [0,1]. 0 = structurally not a name (drop it outright). */
  score: number
  /** Machine-readable reasons, for the deferred-suggestion evidence and logs. */
  reasons: string[]
}

/**
 * Score how plausible a string is as a *project name*, independent of whether a
 * matching project already exists (that is the resolver's job).
 *
 * Returns 0 for structural violations — those are extraction noise and are not
 * even worth remembering. Everything else lands in (0,1]; the caller compares
 * against {@link CREATE_CONFIDENCE_FLOOR}.
 */
export function scoreProjectNameCandidate(name: string): ProjectNameQuality {
  const raw = (name || '').trim()
  const norm = normalizeName(raw)
  const reasons: string[] = []

  // --- Shape rules: a hard 0 (extraction noise, never remembered) ------------
  if (!norm) return { score: 0, reasons: ['empty'] }
  if (norm.length < MIN_NAME_LENGTH) return { score: 0, reasons: ['too-short'] }
  if (norm.length > MAX_NAME_LENGTH) return { score: 0, reasons: ['too-long'] }
  if (/[\n\r!?]/.test(raw)) return { score: 0, reasons: ['sentence-punctuation'] }
  if (!/\p{L}/u.test(norm)) return { score: 0, reasons: ['no-letters'] }

  const tokens = norm.split(' ').filter(Boolean)
  if (tokens.length > MAX_NAME_TOKENS) return { score: 0, reasons: ['too-many-tokens'] }

  // --- Identity signal: at least one token outside the generic vocabulary ----
  const distinctive = tokens.filter(
    (t) => t.length >= MIN_DISTINCTIVE_TOKEN && !GENERIC_NAME_TOKENS.has(foldToken(t))
  )

  if (distinctive.length === 0) {
    // Every token is generic — "the project", "next steps", "weekly sync".
    // Capped below the floor so it can only ever become a suggestion.
    return { score: ALL_GENERIC_CAP, reasons: ['all-generic-tokens'] }
  }

  let score = BASE_SCORE
  score += DISTINCTIVE_TOKEN_BONUS
  reasons.push('distinctive-token')

  if (tokens.length >= 2 && tokens.length <= 4) {
    score += MULTI_TOKEN_BONUS
    reasons.push('name-shaped')
  }
  if (/\p{Lu}/u.test(raw)) {
    score += PROPER_CASE_BONUS
    reasons.push('proper-case')
  }

  return { score: Math.min(1, Math.round(score * 100) / 100), reasons }
}

/** What the reconciler should do with an extracted project name. */
export type ProjectDiscoveryAction =
  /** Structural noise — do not create, do not remember. */
  | 'drop'
  /** Plausible but uncorroborated — remember it and surface it as a suggestion. */
  | 'defer'
  /** Clears the confidence floor AND the recurrence bar — create the project. */
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
 * Both bars are hard. A weak name is never rescued by recurrence (it stays a
 * suggestion no matter how often it recurs — the user, not the extractor, gets to
 * promote it), and a strong name is never created off a single mention.
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
