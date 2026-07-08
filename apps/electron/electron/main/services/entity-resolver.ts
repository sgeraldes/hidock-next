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

import { queryAll, queryOne, getContactById, getProjectById } from './database'
import {
  normalizeName,
  accentFoldedKey,
  looksLikeEmail,
  fuzzyNameScore,
} from './entity-normalize'

export {
  normalizeName,
  stripDiacritics,
  accentFoldedKey,
  looksLikeEmail,
  isGenericSpeakerLabel,
  levenshtein,
  fuzzyNameScore,
} from './entity-normalize'

export interface ResolveContext {
  meetingId?: string
  projectIds?: string[]
}

export interface ResolveResult {
  id: string | null
  confidence: number
  method: string
}

/** Highest fuzzy+boost confidence we allow — keeps fuzzy below the exact-email 1.0. */
const FUZZY_CAP = 0.97
/** Context co-occurrence boost added to a fuzzy base score. */
const CONTEXT_BOOST = 0.15

// ---------------------------------------------------------------------------
// Context (co-occurrence) sets
// ---------------------------------------------------------------------------

/** Contact ids that co-occur with the given context: attendees of the meeting,
 *  and people sharing any project with the meeting or the explicit projectIds. */
function coOccurringContactIds(ctx?: ResolveContext): Set<string> {
  const ids = new Set<string>()
  if (!ctx) return ids

  if (ctx.meetingId) {
    for (const r of queryAll<{ contact_id: string }>(
      'SELECT contact_id FROM meeting_contacts WHERE meeting_id = ?',
      [ctx.meetingId]
    )) {
      ids.add(r.contact_id)
    }
    for (const r of queryAll<{ contact_id: string }>(
      `SELECT DISTINCT mc.contact_id FROM meeting_contacts mc
       JOIN meeting_projects mp ON mc.meeting_id = mp.meeting_id
       WHERE mp.project_id IN (SELECT project_id FROM meeting_projects WHERE meeting_id = ?)`,
      [ctx.meetingId]
    )) {
      ids.add(r.contact_id)
    }
  }

  if (ctx.projectIds && ctx.projectIds.length > 0) {
    const placeholders = ctx.projectIds.map(() => '?').join(',')
    for (const r of queryAll<{ contact_id: string }>(
      `SELECT DISTINCT mc.contact_id FROM meeting_contacts mc
       JOIN meeting_projects mp ON mc.meeting_id = mp.meeting_id
       WHERE mp.project_id IN (${placeholders})`,
      ctx.projectIds
    )) {
      ids.add(r.contact_id)
    }
  }

  return ids
}

/** Project ids that co-occur with the context: projects linked to the meeting
 *  plus the explicit projectIds. */
function coOccurringProjectIds(ctx?: ResolveContext): Set<string> {
  const ids = new Set<string>()
  if (!ctx) return ids
  if (ctx.meetingId) {
    for (const r of queryAll<{ project_id: string }>(
      'SELECT project_id FROM meeting_projects WHERE meeting_id = ?',
      [ctx.meetingId]
    )) {
      ids.add(r.project_id)
    }
  }
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

  // Tier 1 — exact email (only when the name is itself an email).
  if (looksLikeEmail(raw)) {
    const c = queryOne<{ id: string }>('SELECT id FROM contacts WHERE LOWER(email) = ? LIMIT 1', [raw.toLowerCase()])
    if (c && !blocked(c.id)) return { id: c.id, confidence: 1.0, method: 'email' }
  }

  // Tier 2 — exact case-insensitive name.
  const exact = queryOne<{ id: string }>('SELECT id FROM contacts WHERE LOWER(name) = ? LIMIT 1', [norm])
  if (exact && !blocked(exact.id)) return { id: exact.id, confidence: 0.95, method: 'exact-name' }

  // Tier 3 — positive alias.
  if (aliasRow && aliasRow.source !== 'rejected') {
    const c = getContactById(aliasRow.contact_id)
    if (c && !blocked(c.id)) {
      return { id: c.id, confidence: aliasRow.confidence ?? 0.9, method: 'alias' }
    }
  }

  const candidates = queryAll<{ id: string; name: string }>('SELECT id, name FROM contacts')
  const foldedTarget = accentFoldedKey(raw)

  // Tier 4 — accent/diacritic-folded name (Oscar ~ Óscar).
  for (const c of candidates) {
    if (blocked(c.id)) continue
    const cNorm = normalizeName(c.name)
    if (cNorm !== norm && accentFoldedKey(c.name) === foldedTarget) {
      return { id: c.id, confidence: 0.85, method: 'accent' }
    }
  }

  // Tier 5 — fuzzy + context boost.
  const coOcc = coOccurringContactIds(ctx)
  let best: { id: string; score: number; boosted: boolean } | null = null
  for (const c of candidates) {
    if (blocked(c.id)) continue
    const cNorm = normalizeName(c.name)
    if (cNorm === norm) continue
    const base = fuzzyNameScore(norm, cNorm)
    if (base <= 0) continue
    const boosted = coOcc.has(c.id)
    const score = Math.min(base + (boosted ? CONTEXT_BOOST : 0), FUZZY_CAP)
    if (!best || score > best.score) best = { id: c.id, score, boosted }
  }
  if (best) {
    return { id: best.id, confidence: best.score, method: best.boosted ? 'fuzzy-context' : 'fuzzy' }
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

  // Tier 4 — fuzzy + context boost.
  const coOcc = coOccurringProjectIds(ctx)
  let best: { id: string; score: number; boosted: boolean } | null = null
  for (const p of candidates) {
    if (blocked(p.id)) continue
    const pNorm = normalizeName(p.name)
    if (pNorm === norm) continue
    const base = fuzzyNameScore(norm, pNorm)
    if (base <= 0) continue
    const boosted = coOcc.has(p.id)
    const score = Math.min(base + (boosted ? CONTEXT_BOOST : 0), FUZZY_CAP)
    if (!best || score > best.score) best = { id: p.id, score, boosted }
  }
  if (best) {
    return { id: best.id, confidence: best.score, method: best.boosted ? 'fuzzy-context' : 'fuzzy' }
  }

  return { id: null, confidence: 0, method: 'none' }
}
