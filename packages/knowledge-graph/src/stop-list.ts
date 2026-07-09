/**
 * Generic-entity stop-list.
 *
 * LLM extraction sometimes emits collective or role words instead of real named
 * entities — "All attendees", "Team", "Project Manager", "todos", "el equipo".
 * Those become useless hub nodes that clutter the Context Graph. This module is
 * the single source of truth for deciding whether a label is such noise, in both
 * English and Spanish. It is intentionally CONSERVATIVE: it only matches a
 * curated set of clearly-generic terms (plus a leading article/quantifier
 * strip), never a personal name.
 */

/**
 * Curated set of clearly-generic collective / role labels (already normalized:
 * lowercase, accent-stripped, punctuation→space, whitespace-collapsed).
 */
const GENERIC_LABELS: ReadonlySet<string> = new Set<string>([
  // --- English: collective / group references ---
  'all', 'everyone', 'everybody', 'all of us', 'all of them', 'all of you',
  'the team', 'team', 'teams', 'the whole team', 'whole team', 'entire team',
  'our team', 'my team', 'the group', 'group', 'groups',
  'attendees', 'attendee', 'all attendees', 'the attendees',
  'participants', 'participant', 'all participants', 'the participants',
  'members', 'member', 'all members', 'team members', 'team member', 'all team members',
  'staff', 'the staff', 'personnel',
  'others', 'the others', 'someone', 'somebody', 'anyone', 'anybody',
  'no one', 'nobody', 'none', 'folks', 'guys', 'people', 'everyone else', 'everybody else',
  'we', 'us', 'they', 'them',
  'stakeholders', 'stakeholder', 'the stakeholders',
  'leadership', 'management', 'the management',
  // --- English: bare role words ---
  'project manager', 'the project manager', 'manager', 'the manager', 'managers',
  'team lead', 'team leader', 'the lead', 'lead', 'leads',
  'developer', 'developers', 'the developer', 'engineer', 'engineers',
  'presenter', 'the presenter', 'speaker', 'the speaker', 'host', 'the host',
  'facilitator', 'the facilitator', 'moderator',
  'unknown', 'unknown speaker', 'speaker 1', 'speaker 2', 'n a', 'na', 'tbd',
  // --- Spanish: collective / group references ---
  'todos', 'todas', 'todo el equipo', 'el equipo', 'equipo', 'equipos',
  'todo el mundo', 'el grupo', 'grupo', 'grupos', 'nuestro equipo',
  'participantes', 'los participantes', 'todos los participantes', 'participante',
  'asistentes', 'los asistentes', 'todos los asistentes', 'asistente',
  'miembros', 'los miembros', 'miembros del equipo', 'todos los miembros', 'miembro',
  'personal', 'el personal', 'los demas', 'alguien', 'nadie', 'ninguno',
  'nosotros', 'ellos', 'ellas', 'gente', 'la gente',
  'interesados', 'las partes interesadas', 'partes interesadas',
  'liderazgo', 'gestion', 'la gerencia', 'gerencia',
  // --- Spanish: bare role words ---
  'gerente', 'el gerente', 'gerente de proyecto', 'jefe de proyecto', 'jefe',
  'gerentes', 'lider', 'lider de equipo', 'lider del equipo', 'los lideres',
  'desarrollador', 'desarrolladores', 'ingeniero', 'ingenieros',
  'presentador', 'el presentador', 'orador', 'el orador', 'moderador',
  'anfitrion', 'facilitador', 'ponente', 'desconocido',
])

/**
 * Leading article/quantifier tokens. Stripping one lets "all engineers" or
 * "the developers" reduce to a term already in the set, without adding every
 * combination explicitly.
 */
const LEADING_QUANTIFIERS: ReadonlySet<string> = new Set<string>([
  'the', 'all', 'our', 'my', 'a', 'an', 'some', 'every', 'each',
  'el', 'la', 'los', 'las', 'todo', 'toda', 'todos', 'todas',
  'nuestro', 'nuestra', 'nuestros', 'nuestras', 'un', 'una', 'unos', 'unas',
])

/** Normalize a label for comparison: accent-strip, lowercase, punctuation→space, collapse. */
export function normalizeGenericLabel(label: string): string {
  return label
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '') // strip diacritics (accents, tildes)
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ') // punctuation → space
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * True when `label` is a generic collective/role word rather than a real named
 * entity (EN + ES). Conservative: matches only the curated set, optionally after
 * stripping a single leading article/quantifier. Empty/blank labels are NOT
 * treated as generic here — callers already skip empty names.
 */
export function isGenericEntityLabel(label: string | null | undefined): boolean {
  if (!label) return false
  const norm = normalizeGenericLabel(label)
  if (!norm) return false
  if (GENERIC_LABELS.has(norm)) return true

  const parts = norm.split(' ')
  if (parts.length > 1 && LEADING_QUANTIFIERS.has(parts[0])) {
    const rest = parts.slice(1).join(' ')
    if (rest && GENERIC_LABELS.has(rest)) return true
  }
  return false
}
