/**
 * Discovery sweep (Round 4b) — batch identity-merge discovery for People and Projects.
 *
 * The resolver (entity-resolver.ts) scores ONE incoming name against the corpus at
 * write time. Discovery is the inverse, run on demand from the People/Projects UI:
 * it looks at the *existing* corpus and proposes which already-stored entities are
 * probably the same person/project, so the duplicate-people problem the user hit
 * (Edu / Eduardo, Sebas / Sebastián) gets swept up after the fact.
 *
 * It never merges. It writes reviewable `identity_suggestions` rows (accept = the
 * user's click). The composite confidence is built from independent, documented
 * signals so a single strong signal (matching email) or the sum of weak ones
 * (contained name + shared role + shared meetings/topics) crosses the bar.
 *
 * Signal weights (all documented as constants below):
 *   name   NAME_WEIGHT·nameScore        up to 0.60  (fuzzy/accent/containment — reuses entity-normalize)
 *   role   ROLE_WEAK / ROLE_STRONG      +0.10 / +0.20 (normalized role-token overlap, synonym-expanded)
 *   graph  GRAPH_MAX_BOOST·closeness    up to 0.20  (meeting_contacts Jaccard + graph topic/project overlap)
 *   email  EMAIL_EXACT / EMAIL_LOCAL    +0.35 / +0.12; exact match also floors the composite (straggler auto-merge)
 *          EMAIL_CONFLICT_PENALTY       −0.25 when both have clearly different emails (contra-evidence)
 *
 * Thresholds (consistent with INTELLIGENCE.md §2):
 *   composite ≥ AUTO_MERGE_THRESHOLD (0.95) AND email-corroborated → evidence.autoMergeable = true
 *   composite ≥ SUGGEST_THRESHOLD    (0.50)                        → write an identity_suggestion
 *   below                                                          → drop
 *
 * Connector signals (outlook/slack/bamboo) are not available yet; the evidence
 * shape carries a `signals` map so a connector-derived signal slots in later.
 */

import { queryAll, queryOne, insertIdentitySuggestion, filterEligibleGraphEdgeIds } from './database'
import type { Contact, Project, IdentitySuggestion } from './database'
import { normalizeName, accentFoldedKey, fuzzyNameScore, detectAmbiguousName } from './entity-normalize'
import { nameRarity, type Rarity } from './name-rarity'

// ---------------------------------------------------------------------------
// Weights & thresholds (documented — the single source of truth for tuning)
// ---------------------------------------------------------------------------

const NAME_WEIGHT = 0.6
const ROLE_WEAK_BOOST = 0.1
const ROLE_STRONG_BOOST = 0.2
const GRAPH_MAX_BOOST = 0.2
const EMAIL_EXACT_BOOST = 0.35
const EMAIL_LOCAL_BOOST = 0.12
const EMAIL_CONFLICT_PENALTY = 0.25
/** Exact-email straggler: floor the composite here so it always clears AUTO_MERGE_THRESHOLD. */
const EMAIL_EXACT_FLOOR = 0.96
const SUGGEST_THRESHOLD = 0.5
const AUTO_MERGE_THRESHOLD = 0.95
/** Role-token Jaccard at/above this counts as a strong (not weak) role match. */
const ROLE_STRONG_JACCARD = 0.5
/** Only names this short get the suffix bucket (bounds bucket sizes; catches first-char edits). */
const SHORT_NAME_LEN = 6
/** Skip pairing inside a degenerate bucket bigger than this (guards against O(n²) blowup). */
const MAX_BUCKET = 400

export interface DiscoveryResult {
  candidatePairs: number
  suggestionsCreated: number
  autoMergeable: number
}

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

function safeQueryAll<T>(sql: string, params: unknown[] = []): T[] {
  try {
    return queryAll<T>(sql, params as any[])
  } catch {
    // graph_nodes/graph_edges may not exist before the first ingest — treat as empty.
    return []
  }
}

function clamp01(n: number): number {
  return Math.max(0, Math.min(1, n))
}

function jaccard<T>(a: Set<T>, b: Set<T>): { score: number; shared: T[] } {
  if (a.size === 0 || b.size === 0) return { score: 0, shared: [] }
  const shared: T[] = []
  for (const x of a) if (b.has(x)) shared.push(x)
  const union = a.size + b.size - shared.length
  return { score: union === 0 ? 0 : shared.length / union, shared }
}

/** Pairwise name confidence in [0,1]: exact 1.0 > accent-fold 0.9 > fuzzy 0.62–0.8 > 0. */
function pairNameScore(aName: string, bName: string): number {
  const an = normalizeName(aName)
  const bn = normalizeName(bName)
  if (!an || !bn) return 0
  if (an === bn) return 1.0
  if (accentFoldedKey(aName) === accentFoldedKey(bName)) return 0.9
  return fuzzyNameScore(an, bn)
}

type EmailRelation = 'exact' | 'local' | 'conflict' | 'none'

function emailRelation(aEmail: string | null, bEmail: string | null): EmailRelation {
  const a = (aEmail || '').trim().toLowerCase()
  const b = (bEmail || '').trim().toLowerCase()
  if (!a || !b) return 'none'
  if (a === b) return 'exact'
  const [al] = a.split('@')
  const [bl] = b.split('@')
  if (al && al === bl) return 'local'
  return 'conflict'
}

// Role-token normalization ---------------------------------------------------

const ROLE_STOPWORDS = new Set([
  'senior', 'junior', 'lead', 'staff', 'principal', 'sr', 'jr', 'ii', 'iii', 'of', 'the', 'and', 'a', 'at',
])

/** Abbreviation → canonical tokens, so "PM" ≈ "Project Manager", "Ops" ≈ "Operations". */
const ROLE_SYNONYMS: Record<string, string[]> = {
  pm: ['project', 'manager'],
  po: ['product', 'owner'],
  eng: ['engineer'],
  dev: ['developer'],
  ops: ['operations'],
  mgr: ['manager'],
  sre: ['site', 'reliability', 'engineer'],
  qa: ['quality', 'assurance'],
  hr: ['human', 'resources'],
  cto: ['chief', 'technology', 'officer'],
  ceo: ['chief', 'executive', 'officer'],
  cfo: ['chief', 'financial', 'officer'],
}

function roleTokens(role: string | null): Set<string> {
  const out = new Set<string>()
  if (!role) return out
  for (const raw of role.toLowerCase().split(/[^a-z0-9]+/)) {
    if (raw.length < 2) continue
    const expanded = ROLE_SYNONYMS[raw] ?? [raw]
    for (const t of expanded) {
      if (t.length >= 2 && !ROLE_STOPWORDS.has(t)) out.add(t)
    }
  }
  return out
}

function roleSignal(aRole: string | null, bRole: string | null): { boost: number; shared: string[] } {
  const a = roleTokens(aRole)
  const b = roleTokens(bRole)
  const { score, shared } = jaccard(a, b)
  if (shared.length === 0) return { boost: 0, shared: [] }
  return { boost: score >= ROLE_STRONG_JACCARD ? ROLE_STRONG_BOOST : ROLE_WEAK_BOOST, shared }
}

// ---------------------------------------------------------------------------
// Name base-rate (rarity) — token frequency + transcript mentions
// ---------------------------------------------------------------------------

/** First accent-folded whitespace token of a name (its base-rate token). */
function foldedFirstToken(name: string): string {
  const folded = accentFoldedKey(name)
  return folded.split(' ')[0] || folded
}

/** Distinct-entity count per folded first token across the corpus — the base rate. */
function buildTokenBearers(entities: Array<{ name: string }>): Map<string, number> {
  const counts = new Map<string, number>()
  for (const e of entities) {
    const tok = foldedFirstToken(e.name)
    if (!tok) continue
    counts.set(tok, (counts.get(tok) ?? 0) + 1)
  }
  return counts
}

/** Escape LIKE wildcards so a name is matched literally. */
function likeEscape(s: string): string {
  return s.replace(/[\\%_]/g, (m) => '\\' + m)
}

/** Memoized transcript mention count for a name (0 when transcripts are absent). */
function makeMentionCounter(): (name: string) => number {
  const cache = new Map<string, number>()
  return (name: string): number => {
    const key = normalizeName(name)
    if (!key) return 0
    const hit = cache.get(key)
    if (hit !== undefined) return hit
    const rows = safeQueryAll<{ n: number }>(
      `SELECT COUNT(*) AS n FROM transcripts WHERE full_text LIKE ? ESCAPE '\\'`,
      [`%${likeEscape(name.trim())}%`]
    )
    const n = rows[0]?.n ?? 0
    cache.set(key, n)
    return n
  }
}

/**
 * Base-rate rarity for a candidate pair. The more-common of the two names' first
 * tokens drives the delta, so a match on 'Juan'/'Ale' is docked (−0.15) and one on
 * 'Yaraví' stands (+0.05). Bearer frequency classifies first; a transcript scan is
 * paid for only when the bearer count leaves the pair 'normal' (mentions can promote
 * normal → common but never override a rare/common bearer verdict).
 */
function pairRarity(
  aName: string,
  bName: string,
  bearers: Map<string, number>,
  mentionsOf: (name: string) => number
): { rarity: Rarity; delta: number } {
  const at = foldedFirstToken(aName)
  const bt = foldedFirstToken(bName)
  const token = at === bt ? at : at.length <= bt.length ? at : bt
  const bearerCount = Math.max(bearers.get(at) ?? 0, bearers.get(bt) ?? 0)
  const byBearers = nameRarity({ bearers: bearerCount, tokenLength: token.length })
  if (byBearers.rarity !== 'normal') return byBearers
  const mentions = Math.max(mentionsOf(aName), mentionsOf(bName))
  return nameRarity({ bearers: bearerCount, tokenLength: token.length, mentions })
}

// ---------------------------------------------------------------------------
// Candidate bucketing — cheap pair generation (no blind O(n²) resolver calls)
// ---------------------------------------------------------------------------

/** Bucket keys for an entity: shared email local-part, name prefix/full-fold/suffix, first token. */
function bucketKeys(name: string, email: string | null): string[] {
  const keys: string[] = []
  const folded = accentFoldedKey(name)
  const norm = normalizeName(name)
  const local = (email || '').trim().toLowerCase().split('@')[0]
  if (local) keys.push(`email:${local}`)
  if (folded.length >= 3) {
    keys.push(`pfx:${folded.slice(0, 3)}`)
    keys.push(`fold:${folded}`)
    if (folded.length <= SHORT_NAME_LEN) keys.push(`sfx:${folded.slice(-3)}`)
  } else if (folded) {
    keys.push(`fold:${folded}`)
  }
  const firstTok = norm.split(' ')[0]
  if (firstTok && firstTok.length >= 3) keys.push(`tok:${firstTok}`)
  return keys
}

/** Unordered id-pairs whose entities share ≥1 bucket key. Deduped. */
function candidatePairsFrom(entities: Array<{ id: string; name: string; email: string | null }>): Array<[number, number]> {
  const buckets = new Map<string, number[]>()
  entities.forEach((e, idx) => {
    for (const key of bucketKeys(e.name, e.email)) {
      const arr = buckets.get(key)
      if (arr) arr.push(idx)
      else buckets.set(key, [idx])
    }
  })

  const seen = new Set<string>()
  const pairs: Array<[number, number]> = []
  for (const members of buckets.values()) {
    if (members.length < 2 || members.length > MAX_BUCKET) continue
    for (let i = 0; i < members.length; i++) {
      for (let j = i + 1; j < members.length; j++) {
        const a = members[i]
        const b = members[j]
        const lo = a < b ? a : b
        const hi = a < b ? b : a
        const key = `${lo}|${hi}`
        if (seen.has(key)) continue
        seen.add(key)
        pairs.push([lo, hi])
      }
    }
  }
  return pairs
}

// ---------------------------------------------------------------------------
// Alias memory (settled pairings) — never re-ask
// ---------------------------------------------------------------------------

interface AliasKeys {
  /** `${entityId}|${aliasNorm}` for source='rejected' — a hard block. */
  rejected: Set<string>
  /** `${entityId}|${aliasNorm}` for any positive source — already known-same. */
  positive: Set<string>
}

function loadAliasKeys(table: 'contact_aliases' | 'project_aliases', idCol: 'contact_id' | 'project_id'): AliasKeys {
  const rejected = new Set<string>()
  const positive = new Set<string>()
  for (const row of safeQueryAll<{ id: string; alias_norm: string; source: string | null }>(
    `SELECT ${idCol} AS id, alias_norm, source FROM ${table}`
  )) {
    const key = `${row.id}|${row.alias_norm}`
    if (row.source === 'rejected') rejected.add(key)
    else positive.add(key)
  }
  return { rejected, positive }
}

/** A pairing is settled if a rejected OR positive alias links either name to the other's id. */
function isSettled(aId: string, aName: string, bId: string, bName: string, keys: AliasKeys): boolean {
  const an = normalizeName(aName)
  const bn = normalizeName(bName)
  const kAB = `${aId}|${bn}`
  const kBA = `${bId}|${an}`
  return keys.rejected.has(kAB) || keys.rejected.has(kBA) || keys.positive.has(kAB) || keys.positive.has(kBA)
}

/** True if a suggestion row already exists for this exact pairing (any status). */
function suggestionExists(kind: 'person' | 'project', candidateName: string, targetId: string): boolean {
  const row = queryOne<{ id: string }>(
    'SELECT id FROM identity_suggestions WHERE kind = ? AND candidate_name = ? AND target_id = ?',
    [kind, candidateName, targetId]
  )
  return !!row
}

// ---------------------------------------------------------------------------
// Graph closeness — shared topic/project neighbors via the knowledge graph
// ---------------------------------------------------------------------------

// ADV24-2 (round-25) — each neighbor row carries the id of the graph edge
// (ABOUT / RELATES_TO) that produced it, so a neighbor derived SOLELY from a
// zero-provenance (legacy pre-F18) or excluded-recording edge is suppressed
// before it contributes graph confidence + sharedTopics to a persisted merge
// suggestion (see makeNeighborLoader).
const PERSON_NEIGHBORS_SQL = `
  SELECT DISTINCT t.type || ':' || t.norm_key AS key, t.label AS label, ab.id AS edge_id
  FROM graph_nodes p
  JOIN graph_edges ea ON ea.source_id = p.id AND ea.type = 'ATTENDED'
  JOIN graph_nodes m  ON m.id = ea.target_id AND m.type = 'meeting'
  JOIN graph_edges ab ON ab.source_id = m.id AND ab.type = 'ABOUT'
  JOIN graph_nodes t  ON t.id = ab.target_id AND (t.type = 'topic' OR t.type = 'project')
  WHERE p.type = 'person' AND p.norm_key = ?`

const PROJECT_NEIGHBORS_SQL = `
  SELECT DISTINCT m.type || ':' || m.norm_key AS key, m.label AS label, ab.id AS edge_id
  FROM graph_nodes pj
  JOIN graph_edges ab ON ab.target_id = pj.id AND ab.type = 'ABOUT'
  JOIN graph_nodes m  ON m.id = ab.source_id
  WHERE pj.type = 'project' AND pj.norm_key = ?
  UNION
  SELECT DISTINCT tp.type || ':' || tp.norm_key AS key, tp.label AS label, rt.id AS edge_id
  FROM graph_nodes pj
  JOIN graph_edges rt ON rt.target_id = pj.id AND rt.type = 'RELATES_TO'
  JOIN graph_nodes tp ON tp.id = rt.source_id
  WHERE pj.type = 'project' AND pj.norm_key = ?`

/**
 * Cache norm_key → (neighbor key → label) so each entity hits the graph once.
 *
 * ADV24-2 (round-25): a neighbor is kept only if ≥1 of its contributing edges is
 * VISIBLE under the shared non-owner suppression ({@link filterEligibleGraphEdgeIds}).
 * This routes discovery graph closeness + sharedTopics through the SAME
 * zero-provenance + exclusion boundary as the gated graph read fns, so an
 * excluded / legacy edge no longer inflates graph confidence or leaks a topic
 * label into a persisted merge suggestion. Fail-closed: when eligibility can't
 * resolve, filterEligibleGraphEdgeIds returns an empty allowlist ⇒ every
 * attributed/legacy neighbor is dropped.
 */
function makeNeighborLoader(sql: string, paramCount: 1 | 2): (normKey: string) => Map<string, string> {
  const cache = new Map<string, Map<string, string>>()
  return (normKey: string): Map<string, string> => {
    let hit = cache.get(normKey)
    if (hit) return hit
    hit = new Map<string, string>()
    const params = paramCount === 2 ? [normKey, normKey] : [normKey]
    const rows = safeQueryAll<{ key: string; label: string | null; edge_id: string | null }>(sql, params)
    const { eligibleEdgeIds } = filterEligibleGraphEdgeIds(
      rows.map((r) => r.edge_id).filter((id): id is string => !!id)
    )
    for (const row of rows) {
      if (!row.edge_id || !eligibleEdgeIds.has(row.edge_id)) continue // suppressed edge ⇒ drop this neighbor
      if (!hit.has(row.key)) hit.set(row.key, row.label ?? row.key)
    }
    cache.set(normKey, hit)
    return hit
  }
}

// ---------------------------------------------------------------------------
// Contact discovery
// ---------------------------------------------------------------------------

export function discoverContactMerges(): DiscoveryResult {
  const result: DiscoveryResult = { candidatePairs: 0, suggestionsCreated: 0, autoMergeable: 0 }

  const contacts = queryAll<Contact>('SELECT * FROM contacts')
  if (contacts.length < 2) return result

  // Meeting sets (for graph-closeness Jaccard) — one pass.
  const meetingSets = new Map<string, Set<string>>()
  for (const row of safeQueryAll<{ contact_id: string; meeting_id: string }>(
    'SELECT contact_id, meeting_id FROM meeting_contacts'
  )) {
    let s = meetingSets.get(row.contact_id)
    if (!s) meetingSets.set(row.contact_id, (s = new Set<string>()))
    s.add(row.meeting_id)
  }
  const meetingSetFor = (id: string): Set<string> => meetingSets.get(id) ?? new Set<string>()

  const aliasKeys = loadAliasKeys('contact_aliases', 'contact_id')
  const neighborsFor = makeNeighborLoader(PERSON_NEIGHBORS_SQL, 1)
  const tokenBearers = buildTokenBearers(contacts)
  const mentionsOf = makeMentionCounter()

  // Ambiguous mention buckets ("Sergio" = several real people): never propose merging
  // a distinct surname-bearer INTO the bucket (or the bucket into one of them). Those
  // are resolved per recording, not merged. Precompute each bucket's match set once.
  const contactList = contacts.map((c) => ({ id: c.id, name: c.name }))
  const bucketMatchIds = new Map<string, Set<string>>()
  for (const c of contactList) {
    const amb = detectAmbiguousName(c.name, contactList, c.id)
    if (amb.ambiguous) bucketMatchIds.set(c.id, new Set(amb.matches.map((m) => m.id)))
  }
  const isBucketMergePair = (aId: string, bId: string): boolean =>
    !!bucketMatchIds.get(aId)?.has(bId) || !!bucketMatchIds.get(bId)?.has(aId)

  const pairs = candidatePairsFrom(contacts.map((c) => ({ id: c.id, name: c.name, email: c.email })))

  for (const [i, j] of pairs) {
    const a = contacts[i]
    const b = contacts[j]
    if (isSettled(a.id, a.name, b.id, b.name, aliasKeys)) continue
    if (isBucketMergePair(a.id, b.id)) continue
    result.candidatePairs++

    // --- signals ---
    const name = pairNameScore(a.name, b.name)
    const rel = emailRelation(a.email, b.email)
    const role = roleSignal(a.role, b.role)

    const mJac = jaccard(meetingSetFor(a.id), meetingSetFor(b.id))
    const aNeighbors = neighborsFor(normalizeName(a.name))
    const bNeighbors = neighborsFor(normalizeName(b.name))
    const tJac = jaccard(new Set(aNeighbors.keys()), new Set(bNeighbors.keys()))
    const graph = GRAPH_MAX_BOOST * clamp01(mJac.score + tJac.score)

    let emailBoost = 0
    if (rel === 'exact') emailBoost = EMAIL_EXACT_BOOST
    else if (rel === 'local') emailBoost = EMAIL_LOCAL_BOOST

    const rar = pairRarity(a.name, b.name, tokenBearers, mentionsOf)

    let composite = NAME_WEIGHT * name + role.boost + graph + emailBoost + rar.delta
    if (rel === 'conflict') composite -= EMAIL_CONFLICT_PENALTY
    composite = clamp01(composite)
    const emailCorroborated = rel === 'exact'
    if (emailCorroborated) composite = Math.max(composite, EMAIL_EXACT_FLOOR)

    if (composite < SUGGEST_THRESHOLD) continue

    // Orient keeper/loser deterministically: richer (more meetings, then has-email, then older) wins.
    const keeperIsA = preferKeeper(
      { count: a.meeting_count, hasEmail: !!a.email, created: a.created_at },
      { count: b.meeting_count, hasEmail: !!b.email, created: b.created_at }
    )
    const keeper = keeperIsA ? a : b
    const loser = keeperIsA ? b : a

    if (suggestionExists('person', loser.name, keeper.id)) continue

    const autoMergeable = composite >= AUTO_MERGE_THRESHOLD && emailCorroborated
    const sharedTopics = tJac.shared.map((k) => aNeighbors.get(k) ?? k).slice(0, 5)

    insertIdentitySuggestion('person', loser.name, keeper.id, round2(composite), {
      signals: { name: round2(name), email: round2(emailBoost), role: round2(role.boost), graph: round2(graph) },
      composite: round2(composite),
      autoMergeable,
      keeperId: keeper.id,
      keeperName: keeper.name,
      loserId: loser.id,
      loserName: loser.name,
      emailMatch: rel,
      roleOverlap: role.shared,
      sharedMeetings: mJac.shared.length,
      sharedTopics,
      ...(rar.rarity !== 'normal' ? { rarity: rar.rarity } : {}),
    })
    result.suggestionsCreated++
    if (autoMergeable) result.autoMergeable++
  }

  return result
}

// ---------------------------------------------------------------------------
// Project discovery
// ---------------------------------------------------------------------------

export function discoverProjectMerges(): DiscoveryResult {
  const result: DiscoveryResult = { candidatePairs: 0, suggestionsCreated: 0, autoMergeable: 0 }

  const projects = queryAll<Project>('SELECT * FROM projects')
  if (projects.length < 2) return result

  const meetingSets = new Map<string, Set<string>>()
  for (const row of safeQueryAll<{ project_id: string; meeting_id: string }>(
    'SELECT project_id, meeting_id FROM meeting_projects'
  )) {
    let s = meetingSets.get(row.project_id)
    if (!s) meetingSets.set(row.project_id, (s = new Set<string>()))
    s.add(row.meeting_id)
  }
  const meetingSetFor = (id: string): Set<string> => meetingSets.get(id) ?? new Set<string>()

  const aliasKeys = loadAliasKeys('project_aliases', 'project_id')
  const neighborsFor = makeNeighborLoader(PROJECT_NEIGHBORS_SQL, 2)
  const tokenBearers = buildTokenBearers(projects)
  const mentionsOf = makeMentionCounter()

  const pairs = candidatePairsFrom(projects.map((p) => ({ id: p.id, name: p.name, email: null })))

  for (const [i, j] of pairs) {
    const a = projects[i]
    const b = projects[j]
    if (isSettled(a.id, a.name, b.id, b.name, aliasKeys)) continue
    result.candidatePairs++

    const name = pairNameScore(a.name, b.name)
    const mJac = jaccard(meetingSetFor(a.id), meetingSetFor(b.id))
    const aNeighbors = neighborsFor(normalizeName(a.name))
    const bNeighbors = neighborsFor(normalizeName(b.name))
    const tJac = jaccard(new Set(aNeighbors.keys()), new Set(bNeighbors.keys()))
    const graph = GRAPH_MAX_BOOST * clamp01(mJac.score + tJac.score)

    const rar = pairRarity(a.name, b.name, tokenBearers, mentionsOf)

    // Projects have no email/role → never auto-mergeable (that gate needs email corroboration).
    const composite = clamp01(NAME_WEIGHT * name + graph + rar.delta)
    if (composite < SUGGEST_THRESHOLD) continue

    const keeperIsA = preferKeeper(
      { count: meetingSetFor(a.id).size, hasEmail: false, created: a.created_at },
      { count: meetingSetFor(b.id).size, hasEmail: false, created: b.created_at }
    )
    const keeper = keeperIsA ? a : b
    const loser = keeperIsA ? b : a

    if (suggestionExists('project', loser.name, keeper.id)) continue

    const sharedTopics = tJac.shared.map((k) => aNeighbors.get(k) ?? k).slice(0, 5)

    insertIdentitySuggestion('project', loser.name, keeper.id, round2(composite), {
      signals: { name: round2(name), email: 0, role: 0, graph: round2(graph) },
      composite: round2(composite),
      autoMergeable: false,
      keeperId: keeper.id,
      keeperName: keeper.name,
      loserId: loser.id,
      loserName: loser.name,
      emailMatch: 'none',
      roleOverlap: [],
      sharedMeetings: mJac.shared.length,
      sharedTopics,
      ...(rar.rarity !== 'normal' ? { rarity: rar.rarity } : {}),
    })
    result.suggestionsCreated++
  }

  return result
}

// ---------------------------------------------------------------------------
// ADV24-2 (round-25) — read-time revalidation of PERSISTED merge suggestions
// ---------------------------------------------------------------------------

interface SuggestionEvidence {
  signals?: { name?: number; email?: number; role?: number; graph?: number }
  composite?: number
  sharedTopics?: string[]
  sharedMeetings?: number
  keeperId?: string
  keeperName?: string
  loserId?: string
  loserName?: string
  emailMatch?: EmailRelation
  [k: string]: unknown
}

/** Shared-meeting id set for one entity (person → meeting_contacts, project → meeting_projects). */
function meetingSetForEntity(kind: 'person' | 'project', id: string): Set<string> {
  const table = kind === 'person' ? 'meeting_contacts' : 'meeting_projects'
  const idCol = kind === 'person' ? 'contact_id' : 'project_id'
  return new Set(
    safeQueryAll<{ meeting_id: string }>(`SELECT meeting_id FROM ${table} WHERE ${idCol} = ?`, [id]).map(
      (r) => r.meeting_id
    )
  )
}

/**
 * ADV24-2 (round-25) — revalidate PENDING identity suggestions at SURFACING time
 * (identity:getSuggestions → the People/Projects merge queue). A suggestion's
 * graph-derived evidence (sharedTopics + the `graph` confidence signal) was
 * computed from ABOUT / RELATES_TO edges that may have since become excluded
 * (their source recording trashed / personal / value-excluded / hard-purged) or
 * that are legacy zero-provenance — either way they must NOT keep leaking topic
 * labels or influencing a user-approved merge. This mirrors the chat-provenance
 * model: NON-DESTRUCTIVE read-time suppression (no status write), so an
 * eligibility restoration (un-trash) automatically re-surfaces the suggestion.
 *
 * For each pending suggestion whose evidence carried a graph/topic component:
 *   • recompute the ELIGIBLE shared topics via the suppressed neighbor loaders
 *     (zero-provenance / excluded edges already dropped) and redact
 *     evidence.sharedTopics to that subset;
 *   • recompute the graph signal = GRAPH_MAX_BOOST·clamp01(mJac + eligible-tJac)
 *     (meeting overlap is a structural, non-graph signal and is preserved) and
 *     re-derive the composite = oldComposite − oldGraph + newGraph;
 *   • DROP the suggestion when the recomputed composite falls below
 *     SUGGEST_THRESHOLD (its graph/topic evidence was load-bearing and is now
 *     fully suppressed). Email-exact stragglers keep their floor.
 * Fail-closed: any per-suggestion recompute error suppresses that pending
 * suggestion. Non-pending rows (history) pass through unchanged.
 */
export function revalidateSuggestionsForSurfacing(suggestions: IdentitySuggestion[]): IdentitySuggestion[] {
  const out: IdentitySuggestion[] = []
  // Fresh (uncached) suppressed neighbor loaders for this surfacing pass.
  const personNeighbors = makeNeighborLoader(PERSON_NEIGHBORS_SQL, 1)
  const projectNeighbors = makeNeighborLoader(PROJECT_NEIGHBORS_SQL, 2)

  for (const s of suggestions) {
    if (s.status !== 'pending') {
      out.push(s)
      continue
    }

    let ev: SuggestionEvidence
    try {
      ev = s.evidence ? (JSON.parse(s.evidence) as SuggestionEvidence) : {}
    } catch {
      ev = {}
    }

    const oldGraph = Number(ev.signals?.graph ?? 0)
    const hadTopics = Array.isArray(ev.sharedTopics) && ev.sharedTopics.length > 0
    // No graph/topic component ⇒ nothing recording-attributed to revalidate.
    if (oldGraph <= 0 && !hadTopics) {
      out.push(s)
      continue
    }

    try {
      const kind = s.kind
      const keeperId = ev.keeperId ?? s.target_id
      const loserId = ev.loserId ?? null
      const keeperName =
        ev.keeperName ??
        queryOne<{ name: string }>(
          `SELECT name FROM ${kind === 'person' ? 'contacts' : 'projects'} WHERE id = ?`,
          [s.target_id]
        )?.name ??
        ''
      const loserName = ev.loserName ?? s.candidate_name

      const neighborsFor = kind === 'person' ? personNeighbors : projectNeighbors
      const aN = neighborsFor(normalizeName(keeperName))
      const bN = neighborsFor(normalizeName(loserName))
      const tJac = jaccard(new Set(aN.keys()), new Set(bN.keys()))
      const eligibleSharedTopics = tJac.shared.map((k) => aN.get(k) ?? k).slice(0, 5)

      // Meeting overlap is structural (not a provenance-bearing graph edge) → preserved.
      // Only recomputable when we know both ids; otherwise treat as unknown (0) which
      // conservatively lowers confidence (never raises it).
      const canRecompute = !!loserId
      const mJac = canRecompute
        ? jaccard(meetingSetForEntity(kind, keeperId), meetingSetForEntity(kind, loserId!))
        : { score: 0, shared: [] as string[] }
      const newGraph = GRAPH_MAX_BOOST * clamp01(mJac.score + tJac.score)

      const oldComposite = Number(ev.composite ?? s.confidence ?? 0)
      let newComposite = clamp01(oldComposite - oldGraph + newGraph)
      if (ev.emailMatch === 'exact') newComposite = Math.max(newComposite, EMAIL_EXACT_FLOOR)

      ev.sharedTopics = eligibleSharedTopics
      ev.signals = { ...(ev.signals ?? {}), graph: round2(newGraph) }
      ev.composite = round2(newComposite)
      if (canRecompute) ev.sharedMeetings = mJac.shared.length

      // Drop only when we could fully recompute AND the graph/topic evidence was
      // load-bearing (composite now below the surfacing bar). Without a resolvable
      // loserId we can't separate meeting from topic contribution, so we keep the
      // row but with topics already redacted (no leak).
      if (canRecompute && newComposite < SUGGEST_THRESHOLD) continue

      out.push({ ...s, confidence: round2(newComposite), evidence: JSON.stringify(ev) })
    } catch (e) {
      // Fail-closed: a recompute error suppresses this pending suggestion.
      console.error('[identity-discovery] suggestion revalidation failed — suppressing (fail-closed):', e)
      continue
    }
  }
  return out
}

// ---------------------------------------------------------------------------
// small utilities
// ---------------------------------------------------------------------------

/** True when `a` should be the keeper: more links, then has-email, then older created_at. */
function preferKeeper(
  a: { count: number; hasEmail: boolean; created: string },
  b: { count: number; hasEmail: boolean; created: string }
): boolean {
  if (a.count !== b.count) return a.count > b.count
  if (a.hasEmail !== b.hasEmail) return a.hasEmail
  // Older (lexicographically-smaller ISO timestamp) wins; stable tiebreak keeps re-runs deterministic.
  return (a.created || '') <= (b.created || '')
}

function round2(n: number): number {
  return Math.round(n * 100) / 100
}
