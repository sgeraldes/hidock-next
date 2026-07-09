/**
 * Role display hygiene. LLM entity extraction sometimes appends analysis artifacts
 * to a person's role — parentheticals like "(mencionado)", "(mentioned)", or
 * "(inferred)" — that describe HOW the role was derived rather than the role itself.
 * These leak into the UI as "Engineer (mencionado)". This strips such parentheticals
 * at render time (and the same rule is applied when storing new roles in the backend).
 * Pure and unit-tested.
 */

/**
 * Words that, appearing inside a parenthetical, mark it as an extraction artifact
 * rather than a meaningful role qualifier (EN + ES). A parenthetical containing any
 * of these is removed whole; other parentheticals (e.g. "(Sales)") are left intact.
 */
const ARTIFACT_WORDS = [
  'mencionad[oa]s?',
  'mentioned',
  'inferred',
  'inferid[oa]s?',
  'assumed',
  'asumid[oa]s?',
  'posible',
  'possible',
  'probable',
  'likely',
  'guess(?:ed)?',
  'unverified',
  'unconfirmed',
  'no confirmad[oa]',
  'sin confirmar',
  'unknown',
  'desconocid[oa]',
  'implied',
  'implicad[oa]'
]

const ARTIFACT_PARENS = new RegExp(`\\s*\\((?:[^)]*\\b(?:${ARTIFACT_WORDS.join('|')})\\b[^)]*)\\)`, 'gi')

/**
 * Strip extraction-artifact parentheticals from a role string and tidy the leftover
 * whitespace/separators. Returns '' for empty/nullish input. Idempotent.
 *
 * @example cleanRole('Engineer (mencionado)') → 'Engineer'
 * @example cleanRole('PM · Client (inferred)') → 'PM · Client'
 * @example cleanRole('VP (Sales)') → 'VP (Sales)'   // meaningful parenthetical kept
 */
export function cleanRole(role: string | null | undefined): string {
  if (!role) return ''
  return role
    .replace(ARTIFACT_PARENS, '')
    .replace(/\s{2,}/g, ' ')
    .replace(/\s*[-–—,·|/]\s*$/, '')
    .trim()
}
