/**
 * Progressive, confidence-scored entity resolver (Round 4a).
 *
 * One shared path for turning a raw name-string into a canonical contact/project
 * id with a confidence and the method that produced it. This is the fix for the
 * "duplicate factory": callers link at ≥0.8, queue a suggestion at 0.5–0.8, and
 * only create a new entity below 0.5 (see INTELLIGENCE.md §2).
 *
 * Tiers (highest first):
 *   1.00  exact email          (contacts only, when the name looks like an email)
 *   0.95  exact LOWER(name)
 *   0.90  alias table          (or the alias row's stored confidence)
 *   0.85  accent/diacritic-folded name
 *   0.60–0.80  fuzzy (Levenshtein ≤2 / prefix / shared word) + context boost
 *              (+0.15 when the candidate co-occurs in the meeting/project context)
 *
 * A 'rejected' alias row blocks resolving that name to the paired entity.
 * The pure scoring helpers live in ./entity-normalize and are re-exported here
 * for unit tests.
 */

import { queryAll, queryOne, getContactById, getProjectById, filterEligibleMembershipRows } from './database'
import type { MembershipRow } from './database'
import {
  normalizeName,
  accentFoldedKey,
  looksLikeEmail,
  fuzzyNameScore,
} from './entity-normalize'
import { nameRarity, type Rarity } from './name-rarity'

import {
  detectAmbiguousName,
  type AmbiguityResult,
} from './entity-normalize'

export {
  normalizeName,
  stripDiacritics,
  accentFoldedKey,
  looksLikeEmail,
  isGenericSpeakerLabel,
  levenshtein,
  fuzzyNameScore,
  isOppositeGenderSpanishPair,
  nameTokens,
  isSingleToken,
  hasSurname,
  firstNameNicknameMatch,
  detectAmbiguousName,
} from './entity-normalize'
export type { AmbiguityResult, AmbiguityMatch } from './entity-normalize'
export { nameRarity } from './name-rarity'

export interface ResolveContext {
  meetingId?: string
  projectIds?: string[]
}

export interface ResolveResult {
  id: string | null
  confidence: number
  method: string
  /** Base-rate label for a fuzzy match (present only when common/rare) — the merge
   *  card frames a 'common' match with a "verify carefully" caution. */
  rarity?: Rarity
  /** True when the name is a bare first-name/nickname bucket denoting several distinct
   *  people and no single one could be picked from context — callers must NOT auto-link
   *  or auto-merge it; it needs per-recording resolution instead. */
  ambiguous?: boolean
}

/** Confidence for a bare first name disambiguated to the sole matching meeting attendee. */
const ATTENDEE_CONTEXT_CONFIDENCE = 0.85
/** Confidence returned for an unresolvable ambiguous bucket — below SUGGEST, never links. */
const AMBIGUOUS_BUCKET_CONFIDENCE = 0.4

/** Highest fuzzy+boost confidence we allow — keeps fuzzy below the exact-email 1.0. */
const FUZZY_CAP = 0.97
/** Context co-occurrence boost added to a fuzzy base score. */
const CONTEXT_BOOST = 0.15
/** The auto-link line callers gate on; a plain (uncorroborated) fuzzy stays below it. */
const AUTO_LINK_LINE = 0.8

/** Length of the first whitespace token of a normalized name (its base-rate token). */
function firstTokenLength(norm: string): number {
  const tok = norm.split(' ')[0]
  return (tok || norm).length
}

/**
 * Fold a fuzzy match's base-rate into its confidence: a rare name's match is boosted
 * a touch, a common short token's is docked so it doesn't clear the suggest bar on
 * string similarity alone. `collisions` is how many corpus entities the name fuzzy-
 * matched — its collision probability. A plain (uncorroborated) fuzzy is kept below
 * the auto-link line so a rare-name boost never silently links without review.
 */
function applyRarity(
  best: { id: string; score: number; boosted: boolean },
  norm: string,
  collisions: number
): ResolveResult {
  const { rarity, delta } = nameRarity({ bearers: collisions, tokenLength: firstTokenLength(norm) })
  let score = Math.max(0, Math.min(best.score + delta, FUZZY_CAP))
  if (!best.boosted) score = Math.min(score, AUTO_LINK_LINE - 0.01)
  const method = best.boosted ? 'fuzzy-context' : 'fuzzy'
  return rarity === 'normal'
    ? { id: best.id, confidence: score, method }
    : { id: best.id, confidence: score, method, rarity }
}

// ---------------------------------------------------------------------------
// Context (co-occurrence) sets
// ---------------------------------------------------------------------------

// ADV27-3 (round-28) — the resolver's co-occurrence context is read DIRECTLY from
// meeting_contacts / meeting_projects, and applyTranscriptEntities feeds its own
// meeting into the resolver. An EXCLUDED recording's transcript-derived membership
// rows must NOT supply the context boost / sole-attendee signal that flips a later
// ELIGIBLE transcript from ambiguous/new into an auto-link (which would write a NEW
// durable membership attributed to the eligible recording — laundering excluded
// evidence into identity state). Every contextual membership row is therefore
// fetched WITH its per-row provenance (source, source_recording_id) and filtered
// through {@link filterEligibleMembershipRows}: only calendar/user-authored rows OR
// rows backed by a currently-eligible source recording contribute. Legacy
// (NULL-provenance) rows and a fail-closed lookup are dropped.

/** Contact ids that co-occur with the given context: attendees of the meeting,
 *  and people sharing any project with the meeting or the explicit projectIds.
 *  Only ELIGIBLE membership rows contribute (see the note above). */
function coOccurringContactIds(ctx?: ResolveContext): Set<string> {
  const ids = new Set<string>()
  if (!ctx) return ids

  const addEligible = (rows: Array<MembershipRow & { contact_id: string }>): void => {
    for (const r of filterEligibleMembershipRows(rows).eligible) ids.add(r.contact_id)
  }

  if (ctx.meetingId) {
    addEligible(
      queryAll<MembershipRow & { contact_id: string }>(
        'SELECT contact_id, source, source_recording_id FROM meeting_contacts WHERE meeting_id = ?',
        [ctx.meetingId]
      )
    )
    addEligible(
      queryAll<MembershipRow & { contact_id: string }>(
        `SELECT DISTINCT mc.contact_id AS contact_id, mc.source AS source, mc.source_recording_id AS source_recording_id
         FROM meeting_contacts mc
         JOIN meeting_projects mp ON mc.meeting_id = mp.meeting_id
         WHERE mp.project_id IN (SELECT project_id FROM meeting_projects WHERE meeting_id = ?)`,
        [ctx.meetingId]
      )
    )
  }

  if (ctx.projectIds && ctx.projectIds.length > 0) {
    const placeholders = ctx.projectIds.map(() => '?').join(',')
    addEligible(
      queryAll<MembershipRow & { contact_id: string }>(
        `SELECT DISTINCT mc.contact_id AS contact_id, mc.source AS source, mc.source_recording_id AS source_recording_id
         FROM meeting_contacts mc
         JOIN meeting_projects mp ON mc.meeting_id = mp.meeting_id
         WHERE mp.project_id IN (${placeholders})`,
        ctx.projectIds
      )
    )
  }

  return ids
}

/** Project ids that co-occur with the context: projects linked to the meeting
 *  (ELIGIBLE membership rows only) plus the explicit projectIds. */
function coOccurringProjectIds(ctx?: ResolveContext): Set<string> {
  const ids = new Set<string>()
  if (!ctx) return ids
  if (ctx.meetingId) {
    const rows = queryAll<MembershipRow & { project_id: string }>(
      'SELECT project_id, source, source_recording_id FROM meeting_projects WHERE meeting_id = ?',
      [ctx.meetingId]
    )
    for (const r of filterEligibleMembershipRows(rows).eligible) ids.add(r.project_id)
  }
  // Explicit projectIds are caller-supplied structural context (not a
  // transcript-derived membership) — kept as-is.
  for (const p of ctx.projectIds ?? []) ids.add(p)
  return ids
}

// ---------------------------------------------------------------------------
// Contact resolution
// ---------------------------------------------------------------------------

export function resolveContact(name: string, ctx?: ResolveContext): ResolveResult {
  const raw = (name || '').trim()
  if (!raw) return { id: null, confidence: 0, method: 'empty' }
  const norm = normalizeName(raw)

  // Alias row for this exact name (positive or a 'rejected' block).
  const aliasRow = queryOne<{ contact_id: string; source: string | null; confidence: number | null }>(
    'SELECT contact_id, source, confidence FROM contact_aliases WHERE alias_norm = ?',
    [norm]
  )
  const rejectedId = aliasRow && aliasRow.source === 'rejected' ? aliasRow.contact_id : null
  const blocked = (id: string): boolean => rejectedId !== null && id === rejectedId

  const hasPositiveAlias = !!aliasRow && aliasRow.source !== 'rejected'

  // Tier 1 — exact email (only when the name is itself an email).
  if (looksLikeEmail(raw)) {
    const c = queryOne<{ id: string }>('SELECT id FROM contacts WHERE LOWER(email) = ? LIMIT 1', [raw.toLowerCase()])
    if (c && !blocked(c.id)) return { id: c.id, confidence: 1.0, method: 'email' }
  }

  const candidates = queryAll<{ id: string; name: string }>('SELECT id, name FROM contacts')

  // Ambiguous-bucket guard — runs BEFORE the exact-name/alias tiers so a literal
  // "Sergio" contact is never auto-linked as if it were a real person when the name
  // fits several distinct surname-bearing people. A user-settled positive alias for
  // this exact spelling still wins (checked next); a rejected alias only blocks its
  // one target. With meeting context we split by attendee: exactly one matching
  // attendee resolves to them; zero or several keep it in the bucket, flagged.
  if (!hasPositiveAlias) {
    const amb: AmbiguityResult = detectAmbiguousName(raw, candidates)
    if (amb.ambiguous) {
      const attendees = coOccurringContactIds(ctx)
      const present = amb.matches.filter((m) => attendees.has(m.id) && !blocked(m.id))
      if (present.length === 1) {
        return { id: present[0].id, confidence: ATTENDEE_CONTEXT_CONFIDENCE, method: 'attendee-context' }
      }
      const bucket = queryOne<{ id: string }>('SELECT id FROM contacts WHERE LOWER(name) = ? LIMIT 1', [norm])
      return {
        id: bucket && !blocked(bucket.id) ? bucket.id : null,
        confidence: AMBIGUOUS_BUCKET_CONFIDENCE,
        method: 'ambiguous-bucket',
        ambiguous: true,
      }
    }
  }

  // Tier 2 — exact case-insensitive name.
  const exact = queryOne<{ id: string }>('SELECT id FROM contacts WHERE LOWER(name) = ? LIMIT 1', [norm])
  if (exact && !blocked(exact.id)) return { id: exact.id, confidence: 0.95, method: 'exact-name' }

  // Tier 3 — positive alias.
  if (hasPositiveAlias) {
    const c = getContactById(aliasRow!.contact_id)
    if (c && !blocked(c.id)) {
      return { id: c.id, confidence: aliasRow!.confidence ?? 0.9, method: 'alias' }
    }
  }

  const foldedTarget = accentFoldedKey(raw)

  // Tier 4 — accent/diacritic-folded name (Oscar ~ Óscar).
  for (const c of candidates) {
    if (blocked(c.id)) continue
    const cNorm = normalizeName(c.name)
    if (cNorm !== norm && accentFoldedKey(c.name) === foldedTarget) {
      return { id: c.id, confidence: 0.85, method: 'accent' }
    }
  }

  // Tier 5 — fuzzy + context boost, then a name base-rate adjustment.
  const coOcc = coOccurringContactIds(ctx)
  let best: { id: string; score: number; boosted: boolean } | null = null
  let collisions = 0
  for (const c of candidates) {
    if (blocked(c.id)) continue
    const cNorm = normalizeName(c.name)
    if (cNorm === norm) continue
    const base = fuzzyNameScore(norm, cNorm)
    if (base <= 0) continue
    collisions++
    const boosted = coOcc.has(c.id)
    const score = Math.min(base + (boosted ? CONTEXT_BOOST : 0), FUZZY_CAP)
    if (!best || score > best.score) best = { id: c.id, score, boosted }
  }
  if (best) {
    return applyRarity(best, norm, collisions)
  }

  return { id: null, confidence: 0, method: 'none' }
}

// ---------------------------------------------------------------------------
// Project resolution (no email tier)
// ---------------------------------------------------------------------------

export function resolveProject(name: string, ctx?: ResolveContext): ResolveResult {
  const raw = (name || '').trim()
  if (!raw) return { id: null, confidence: 0, method: 'empty' }
  const norm = normalizeName(raw)

  const aliasRow = queryOne<{ project_id: string; source: string | null; confidence: number | null }>(
    'SELECT project_id, source, confidence FROM project_aliases WHERE alias_norm = ?',
    [norm]
  )
  const rejectedId = aliasRow && aliasRow.source === 'rejected' ? aliasRow.project_id : null
  const blocked = (id: string): boolean => rejectedId !== null && id === rejectedId

  // Tier 1 — exact case-insensitive name.
  const exact = queryOne<{ id: string }>('SELECT id FROM projects WHERE LOWER(name) = ? LIMIT 1', [norm])
  if (exact && !blocked(exact.id)) return { id: exact.id, confidence: 0.95, method: 'exact-name' }

  // Tier 2 — positive alias.
  if (aliasRow && aliasRow.source !== 'rejected') {
    const p = getProjectById(aliasRow.project_id)
    if (p && !blocked(p.id)) {
      return { id: p.id, confidence: aliasRow.confidence ?? 0.9, method: 'alias' }
    }
  }

  const candidates = queryAll<{ id: string; name: string }>('SELECT id, name FROM projects')
  const foldedTarget = accentFoldedKey(raw)

  // Tier 3 — accent/diacritic-folded name.
  for (const p of candidates) {
    if (blocked(p.id)) continue
    const pNorm = normalizeName(p.name)
    if (pNorm !== norm && accentFoldedKey(p.name) === foldedTarget) {
      return { id: p.id, confidence: 0.85, method: 'accent' }
    }
  }

  // Tier 4 — fuzzy + context boost, then a name base-rate adjustment.
  const coOcc = coOccurringProjectIds(ctx)
  let best: { id: string; score: number; boosted: boolean } | null = null
  let collisions = 0
  for (const p of candidates) {
    if (blocked(p.id)) continue
    const pNorm = normalizeName(p.name)
    if (pNorm === norm) continue
    const base = fuzzyNameScore(norm, pNorm)
    if (base <= 0) continue
    collisions++
    const boosted = coOcc.has(p.id)
    const score = Math.min(base + (boosted ? CONTEXT_BOOST : 0), FUZZY_CAP)
    if (!best || score > best.score) best = { id: p.id, score, boosted }
  }
  if (best) {
    return applyRarity(best, norm, collisions)
  }

  return { id: null, confidence: 0, method: 'none' }
}
