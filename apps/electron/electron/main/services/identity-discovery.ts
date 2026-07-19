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

import {
  queryAll,
  queryOne,
  insertIdentitySuggestion,
  filterEligibleGraphEdgeIds,
  filterEligibleMembershipRows,
  filterVisibleEntityIds,
  blankIneligibleContactFields,
  blankIneligibleContactFieldsWithStatus
} from './database'
import type { Contact, Project, IdentitySuggestion, MembershipRow } from './database'
import { filterEligibleRecordingIds } from './recording-eligibility'
import { normalizeName, accentFoldedKey, fuzzyNameScore, detectAmbiguousName } from './entity-normalize'
import { nameRarity, COMMON_DELTA, RARE_DELTA, type Rarity } from './name-rarity'

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

/**
 * ADV51-3 (round-53) — VISIBILITY-filtered bearer counts. The bearer corpus (the
 * base-rate denominator that classifies a token common/rare) must count ONLY
 * entities that are visible on non-owner identity surfaces: an entity whose every
 * provenance is excluded / suppressed / legacy (already hidden from the
 * People/Projects LIST by {@link filterVisibleEntityIds}) must NOT change a token's
 * rarity — otherwise an excluded-only bearer both skews a discovery suggestion's
 * confidence AND leaks a coarse count-based inference about excluded content.
 *
 * Routes the candidate ids through the shared positive visibility boundary and
 * builds counts from the positively-VISIBLE rows only, propagating that boundary's
 * `failClosed` so a lookup failure (which yields an EMPTY visible set) fails
 * CLOSED at the rarity recompute (suppress at surfacing, reject at accept) rather
 * than trusting a zero bearerCount that could raise confidence.
 */
function buildVisibleTokenBearers(
  kind: 'contact' | 'project',
  entities: Array<{ id: string; name: string }>
): { bearers: Map<string, number>; failClosed: boolean } {
  const { visible, failClosed } = filterVisibleEntityIds(
    kind,
    entities.map((e) => e.id)
  )
  const visibleEntities = entities.filter((e) => visible.has(e.id))
  return { bearers: buildTokenBearers(visibleEntities), failClosed }
}

/** Escape LIKE wildcards so a name is matched literally. */
function likeEscape(s: string): string {
  return s.replace(/[\\%_]/g, (m) => '\\' + m)
}

/**
 * Memoized ELIGIBLE transcript mention count for a name (0 when transcripts are
 * absent).
 *
 * ADV48-1 (round-50) — the rarity scorer must count a name's transcript mentions
 * ONLY over transcripts whose source recording is eligible to surface. A raw
 * COUNT(*) over `transcripts` used to fold personal / soft-deleted / value-
 * excluded / hard-purge-orphan / legacy transcripts into a discovery suggestion's
 * confidence (via the `common` mention promotion, which docks −0.15) AND leaked a
 * coarse count-based inference about excluded content ("Common name"). Instead we
 * fetch the matching transcripts' RECORDING IDs and route them through the shared
 * fail-closed recording allowlist ({@link filterEligibleRecordingIds}), counting
 * only positively-eligible rows.
 *
 * ADV49-3 (round-51) — CARRY the failClosed signal (was silently mapped to 0). A
 * mention count of 0 is NOT conservative for rarity: 0 REMOVES the 'common'
 * penalty (−0.15), RAISING confidence — so a lookup failure returning 0 could
 * push a below-threshold suggestion over the accept bar precisely WHILE eligibility
 * cannot be verified. The counter now returns { count, failClosed } so the caller
 * can refuse to recompute (suppress at surfacing, reject at accept) on a failure
 * rather than treat an unverifiable count as a confident 0.
 */
interface MentionCount {
  count: number
  /** True when the eligibility lookup could not complete → the count is unverified. */
  failClosed: boolean
}
function makeMentionCounter(): (name: string) => MentionCount {
  const cache = new Map<string, MentionCount>()
  return (name: string): MentionCount => {
    const key = normalizeName(name)
    if (!key) return { count: 0, failClosed: false }
    const hit = cache.get(key)
    if (hit !== undefined) return hit
    // ADV51-2 (round-53) — the transcript CORPUS query must fail CLOSED too. A prior
    // `safeQueryAll` swallowed a transcript SELECT exception into an EMPTY result,
    // which then returned { count: 0, failClosed: FALSE } — a trusted zero that
    // REMOVES the 'common' penalty and RAISES confidence while the mention corpus is
    // unverifiable (round 51 only propagated the ELIGIBILITY-lookup failure, not the
    // corpus-query failure). `transcripts` is a core table that always exists, so a
    // throw here is a genuine fault: STRICT queryAll inside an explicit try/catch ⇒
    // any exception yields { count: 0, failClosed: TRUE } so the caller suppresses at
    // surfacing + rejects at accept rather than trusting the zero.
    let rows: Array<{ recording_id: string | null }>
    try {
      rows = queryAll<{ recording_id: string | null }>(
        `SELECT recording_id FROM transcripts WHERE full_text LIKE ? ESCAPE '\\'`,
        [`%${likeEscape(name.trim())}%`]
      )
    } catch (e) {
      console.error('[identity-discovery] mention-count transcript query failed — failing closed:', e)
      const failed: MentionCount = { count: 0, failClosed: true }
      cache.set(key, failed)
      return failed
    }
    let result: MentionCount = { count: 0, failClosed: false }
    if (rows.length > 0) {
      const recIds = rows.map((r) => r.recording_id).filter((id): id is string => !!id)
      const { eligible, failClosed } = filterEligibleRecordingIds(recIds)
      if (failClosed) {
        // Do NOT return a confident 0 — signal the failure up so the caller refuses
        // to recompute rarity/confidence from an unverifiable count.
        result = { count: 0, failClosed: true }
      } else {
        let n = 0
        for (const r of rows) {
          if (r.recording_id && eligible.has(r.recording_id)) n++
        }
        result = { count: n, failClosed: false }
      }
    }
    cache.set(key, result)
    return result
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
  mentionsOf: (name: string) => MentionCount,
  // ADV50-2 (round-52) — true when the bearer corpus could not be verified. An
  // unverifiable corpus makes bearerCount an untrustworthy 0, so EVERY branch below
  // must carry failClosed (the rare early-return especially, where a long token would
  // otherwise raise confidence without ever consulting the mention counter).
  bearersFailClosed = false
): { rarity: Rarity; delta: number; failClosed: boolean } {
  const at = foldedFirstToken(aName)
  const bt = foldedFirstToken(bName)
  const token = at === bt ? at : at.length <= bt.length ? at : bt
  const bearerCount = Math.max(bearers.get(at) ?? 0, bearers.get(bt) ?? 0)
  const byBearers = nameRarity({ bearers: bearerCount, tokenLength: token.length })
  // Bearer count already decided rare/common ⇒ the mention count is not consulted.
  // Still propagate a BEARER failClosed: a bearerCount of 0 from a FAILED corpus query
  // must not be trusted to classify the pair rare/common (ADV50-2).
  if (byBearers.rarity !== 'normal') return { ...byBearers, failClosed: bearersFailClosed }
  // ADV49-3 (round-51) — the mention count IS consulted; propagate its failClosed
  // (and the bearer failClosed) so the caller refuses to recompute confidence when
  // EITHER corpus is unverifiable.
  const mA = mentionsOf(aName)
  const mB = mentionsOf(bName)
  const mentions = Math.max(mA.count, mB.count)
  const failClosed = bearersFailClosed || mA.failClosed || mB.failClosed
  return { ...nameRarity({ bearers: bearerCount, tokenLength: token.length, mentions }), failClosed }
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

  // Meeting sets (for graph-closeness Jaccard) — one pass, PER-ROW provenance.
  //
  // ADV26-2/-3 (round-27) — meeting_contacts rows are written by BOTH calendar
  // sync AND applyTranscriptEntities, for the SAME meeting. Round-26 gated at the
  // MEETING level, which LAUNDERED transcript-derived rows on a calendar meeting.
  // Fetch each row WITH its per-row provenance and gate the ROW through the shared
  // {@link filterEligibleMembershipRows}: a row counts toward mJac only when it is
  // calendar/user-authored OR backed by an eligible source recording. Legacy
  // (NULL-provenance) rows and a fail-closed lookup are dropped. Computed ONCE over
  // the whole corpus so an excluded recording can't inflate the shared-meeting
  // Jaccard and push a merge suggestion over threshold.
  const allMcRows = safeQueryAll<MembershipRow & { contact_id: string; meeting_id: string }>(
    'SELECT contact_id, meeting_id, source, source_recording_id FROM meeting_contacts'
  )
  const meetingSets = new Map<string, Set<string>>()
  for (const row of filterEligibleMembershipRows(allMcRows).eligible) {
    let s = meetingSets.get(row.contact_id)
    if (!s) meetingSets.set(row.contact_id, (s = new Set<string>()))
    s.add(row.meeting_id)
  }
  const meetingSetFor = (id: string): Set<string> => meetingSets.get(id) ?? new Set<string>()

  const aliasKeys = loadAliasKeys('contact_aliases', 'contact_id')
  const neighborsFor = makeNeighborLoader(PERSON_NEIGHBORS_SQL, 1)
  // ADV51-3 (round-53) — count bearers only over VISIBLE contacts (excluded-only /
  // suppressed / legacy entities must not skew a token's base rate). failClosed is
  // carried into pairRarity; at SCAN it is not itself blocking (the authoritative
  // fail-closed gate is the surface/accept recompute), but propagating it keeps a
  // fault from being treated as a confident zero downstream.
  const { bearers: tokenBearers, failClosed: bearersFailClosed } = buildVisibleTokenBearers(
    'contact',
    contacts.map((c) => ({ id: c.id, name: c.name }))
  )
  const mentionsOf = makeMentionCounter()

  // ADV51-1 (round-53) — sanitize each contact's `role` through the shared field-
  // provenance boundary BEFORE it feeds roleSignal/roleOverlap: a transcript-derived
  // role whose source recording is now excluded (or a legacy/untrusted NULL-provenance
  // role) contributes NOTHING to the role signal. At SCAN a blanked role simply lowers
  // the role boost (conservative); the authoritative role recompute runs at surface +
  // accept (revalidateSuggestionsForSurfacing / isSuggestionEligibleForAccept).
  const sanitizedRoleById = new Map<string, string | null>()
  for (const c of blankIneligibleContactFields(contacts)) sanitizedRoleById.set(c.id, c.role ?? null)

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
    // ADV51-1 (round-53) — sanitized roles (excluded/legacy role ⇒ blanked ⇒ no boost).
    const role = roleSignal(sanitizedRoleById.get(a.id) ?? null, sanitizedRoleById.get(b.id) ?? null)

    const mJac = jaccard(meetingSetFor(a.id), meetingSetFor(b.id))
    const aNeighbors = neighborsFor(normalizeName(a.name))
    const bNeighbors = neighborsFor(normalizeName(b.name))
    const tJac = jaccard(new Set(aNeighbors.keys()), new Set(bNeighbors.keys()))
    const graph = GRAPH_MAX_BOOST * clamp01(mJac.score + tJac.score)

    let emailBoost = 0
    if (rel === 'exact') emailBoost = EMAIL_EXACT_BOOST
    else if (rel === 'local') emailBoost = EMAIL_LOCAL_BOOST

    // ADV49-3 (round-51) — at DISCOVERY scan a rarity mention-count lookup failure
    // is not itself security-critical: pairRarity already returns the conservative
    // bearer-based rarity (mentions treated as 0, no benefit granted), and every
    // suggestion created here is revalidated at surface/accept, where a failClosed
    // rarity recompute SUPPRESSES/REJECTS it. So scan keeps creating on the other
    // signals (email/name/graph) rather than dropping a valid email-matched pair.
    // ADV51-3 (round-53) — carry the bearer-corpus failClosed for consistency.
    const rar = pairRarity(a.name, b.name, tokenBearers, mentionsOf, bearersFailClosed)

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

  // ADV26-2 (round-27) — same PER-ROW provenance gating as contact discovery:
  // meeting_projects rows are transcript-derived (or manual), so only rows that are
  // calendar/user-authored OR backed by an eligible source recording may inflate
  // mJac (see {@link filterEligibleMembershipRows}). Computed once over the corpus.
  const allMpRows = safeQueryAll<MembershipRow & { project_id: string; meeting_id: string }>(
    'SELECT project_id, meeting_id, source, source_recording_id FROM meeting_projects'
  )
  const meetingSets = new Map<string, Set<string>>()
  for (const row of filterEligibleMembershipRows(allMpRows).eligible) {
    let s = meetingSets.get(row.project_id)
    if (!s) meetingSets.set(row.project_id, (s = new Set<string>()))
    s.add(row.meeting_id)
  }
  const meetingSetFor = (id: string): Set<string> => meetingSets.get(id) ?? new Set<string>()

  const aliasKeys = loadAliasKeys('project_aliases', 'project_id')
  const neighborsFor = makeNeighborLoader(PROJECT_NEIGHBORS_SQL, 2)
  // ADV51-3 (round-53) — visibility-filtered bearer counts (see contact discovery).
  const { bearers: tokenBearers, failClosed: bearersFailClosed } = buildVisibleTokenBearers(
    'project',
    projects.map((p) => ({ id: p.id, name: p.name }))
  )
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

    // ADV49-3 (round-51) — scan keeps its conservative bearer-based rarity on a
    // failClosed mention lookup (see the contact-discovery site above); the
    // surface/accept recompute is the authoritative fail-closed gate.
    // ADV51-3 (round-53) — carry the bearer-corpus failClosed for consistency.
    const rar = pairRarity(a.name, b.name, tokenBearers, mentionsOf, bearersFailClosed)

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
  roleOverlap?: string[]
  sharedMeetings?: number
  keeperId?: string
  keeperName?: string
  loserId?: string
  loserName?: string
  emailMatch?: EmailRelation
  rarity?: Rarity
  [k: string]: unknown
}

/** The composite delta a persisted rarity label contributed at creation time. */
function rarityDelta(r: Rarity | undefined | null): number {
  if (r === 'common') return COMMON_DELTA
  if (r === 'rare') return RARE_DELTA
  return 0
}

/**
 * ADV48-1 (round-50) — recompute a surfaced suggestion's rarity + confidence from
 * the ELIGIBLE mention count, correcting a persisted `rarity` that was derived
 * (partly) from now-excluded transcripts BEFORE it is displayed or accepted.
 *
 * The write path bakes the rarity delta (common −0.15 / rare +0.05) into the
 * persisted composite and stores the `rarity` LABEL. That label + its delta may
 * have come from a transcript-mention COUNT that included personal / soft-deleted
 * / value-excluded / hard-purge-orphan / legacy transcripts (the pre-fix
 * makeMentionCounter). Now that the counter is eligibility-filtered, re-derive
 * rarity over the SAME corpus bearers + the ELIGIBLE mention count and re-key the
 * composite: newComposite = oldComposite − oldRarityDelta + newRarityDelta. Because
 * eligibility-filtering can only REMOVE mentions, rarity can only move toward
 * rare/normal (delta upward) — so a survivor never drops below the bar here; the
 * fix corrects an inflated "Common name" label + its confidence penalty.
 *
 * bearers (contacts/projects) are exclusion-independent, so a genuinely common
 * name (≥3 bearers) stays 'common'. The email-exact floor is preserved.
 *
 * ADV49-3 (round-51) — returns NULL to SUPPRESS the suggestion when the rarity
 * mention count could not be verified (failClosed): a bare 0 there would REMOVE
 * the 'common' penalty and RAISE confidence precisely while eligibility can't be
 * checked, so the caller must drop it at surfacing and (via
 * {@link isSuggestionEligibleForAccept}) reject it at accept. Only a CONFIRMED
 * (non-failClosed) count recomputes confidence. A non-failClosed recompute error
 * still leaves the suggestion untouched (never raises confidence).
 */
function makeRarityRecomputer(): (s: IdentitySuggestion, ev: SuggestionEvidence) => IdentitySuggestion | null {
  const mentionsOf = makeMentionCounter() // ELIGIBLE mentions (ADV48-1)
  const bearersCache = new Map<'person' | 'project', { bearers: Map<string, number>; failClosed: boolean }>()
  // ADV50-2 (round-52) — the bearer corpus lookup must NOT swallow a query failure
  // into an EMPTY map. An empty map yields bearerCount 0, which for a long token makes
  // pairRarity classify the pair RARE (+0.05) WITHOUT consulting the mention counter,
  // RAISING persisted confidence + authorizing display/accept precisely during a DB
  // fault (the ADV49-3 hole, on the BEARER input). contacts/projects are core tables
  // that ALWAYS exist (unlike the graph tables that safeQueryAll deliberately treats
  // as empty pre-ingest), so a throw here is a genuine fault: catch-and-FLAG it so the
  // recompute fails closed (suppress at surfacing, reject at accept), never silently 0.
  const bearersFor = (kind: 'person' | 'project'): { bearers: Map<string, number>; failClosed: boolean } => {
    const hit = bearersCache.get(kind)
    if (hit) return hit
    const table = kind === 'person' ? 'contacts' : 'projects'
    let result: { bearers: Map<string, number>; failClosed: boolean }
    try {
      // ADV51-3 (round-53) — select id+name and count ONLY positively-VISIBLE rows
      // (an excluded-only / suppressed / legacy entity must not skew the base rate).
      // Propagate the visibility boundary's failClosed so an unverifiable corpus
      // suppresses the recompute (a bare-0 bearerCount would classify a long token
      // RARE (+0.05) and raise confidence during a DB fault — the ADV50-2 hole, now
      // also closed against the entity-visibility lookup).
      const rows = queryAll<{ id: string; name: string }>(`SELECT id, name FROM ${table}`)
      const { visible, failClosed } = filterVisibleEntityIds(
        kind === 'person' ? 'contact' : 'project',
        rows.map((r) => r.id)
      )
      result = { bearers: buildTokenBearers(rows.filter((r) => visible.has(r.id))), failClosed }
    } catch (e) {
      console.error(`[identity-discovery] bearer corpus lookup (${table}) failed — failing closed:`, e)
      result = { bearers: new Map<string, number>(), failClosed: true }
    }
    bearersCache.set(kind, result)
    return result
  }

  return (s: IdentitySuggestion, ev: SuggestionEvidence): IdentitySuggestion | null => {
    try {
      const keeperName = ev.keeperName ?? ''
      const loserName = ev.loserName ?? s.candidate_name ?? ''
      if (!keeperName || !loserName) return s // can't recompute ⇒ leave as-is

      const bf = bearersFor(s.kind)
      const newRar = pairRarity(keeperName, loserName, bf.bearers, mentionsOf, bf.failClosed)
      // ADV49-3 (round-51) / ADV50-2 (round-52) — the rarity could not be verified
      // because the mention count OR the bearer corpus lookup failed. Do NOT recompute
      // confidence upward from an untrustworthy 0; SUPPRESS the suggestion (dropped at
      // surfacing, and rejected at accept via isSuggestionEligibleForAccept).
      if (newRar.failClosed) return null
      const oldRar = (ev.rarity as Rarity | undefined) ?? undefined
      const oldDelta = rarityDelta(oldRar)
      const newDelta = newRar.delta

      // No change to the rarity label AND no delta shift ⇒ nothing to correct.
      if (newDelta === oldDelta && (oldRar ?? 'normal') === newRar.rarity) return s

      const oldComposite = Number(ev.composite ?? s.confidence ?? 0)
      let newComposite = clamp01(oldComposite - oldDelta + newDelta)
      if (ev.emailMatch === 'exact') newComposite = Math.max(newComposite, EMAIL_EXACT_FLOOR)

      const nextEv: SuggestionEvidence = { ...ev, composite: round2(newComposite) }
      if (newRar.rarity !== 'normal') nextEv.rarity = newRar.rarity
      else delete nextEv.rarity

      return { ...s, confidence: round2(newComposite), evidence: JSON.stringify(nextEv) }
    } catch (e) {
      console.error('[identity-discovery] rarity recompute failed — leaving suggestion untouched:', e)
      return s
    }
  }
}

/**
 * ADV51-1 (round-53) — recompute a persisted suggestion's ROLE component from the
 * CURRENT field-level provenance of the keeper + loser contacts. A role boost /
 * roleOverlap baked in at creation whose source recording is now excluded (or which
 * is a legacy/untrusted NULL-provenance role) must contribute NOTHING at surface +
 * accept. Each contact's role provenance is fetched once and routed through the
 * shared field sanitizer ({@link blankIneligibleContactFieldsWithStatus}):
 *   • role blanked (excluded source OR legacy/untrusted) ⇒ boost 0 / no overlap;
 *   • role still eligible ⇒ the recomputed roleSignal (unchanged if roles unchanged);
 *   • field eligibility UNVERIFIABLE (lookup failClosed) ⇒ { failClosed: true } so the
 *     caller SUPPRESSES the suggestion at surfacing and REJECTS it at accept.
 * Role is a PERSON-only signal (projects carry role 0 / no overlap) and only a
 * suggestion that actually BAKED a role component is recomputed — a suggestion with
 * no role boost/overlap is a no-op (never fabricates a boost that could raise
 * confidence).
 */
interface ContactRoleRow {
  id: string
  role: string | null
  role_source_recording_id: string | null
  role_origin: string | null
  source: string | null
}
function makeRoleRecomputer(): (
  s: IdentitySuggestion,
  ev: SuggestionEvidence
) => { boost: number; shared: string[]; failClosed: boolean } {
  const cache = new Map<string, ContactRoleRow | null>()
  const fetchContact = (id: string): ContactRoleRow | null => {
    if (cache.has(id)) return cache.get(id) ?? null
    let row: ContactRoleRow | null = null
    try {
      row =
        queryOne<ContactRoleRow>(
          'SELECT id, role, role_source_recording_id, role_origin, source FROM contacts WHERE id = ?',
          [id]
        ) ?? null
    } catch (e) {
      console.error('[identity-discovery] role-recompute contact lookup failed:', e)
      row = null
    }
    cache.set(id, row)
    return row
  }
  return (s, ev) => {
    const oldBoost = Number(ev.signals?.role ?? 0)
    const oldShared = Array.isArray(ev.roleOverlap)
      ? (ev.roleOverlap as unknown[]).filter((x): x is string => typeof x === 'string')
      : []
    // Role is PERSON-only; a project suggestion carries no role component.
    if (s.kind !== 'person') return { boost: oldBoost, shared: oldShared, failClosed: false }
    // No role component was baked into this suggestion ⇒ nothing to recompute (must
    // not fabricate a boost that would RAISE confidence).
    if (!(oldBoost > 0) && oldShared.length === 0) return { boost: 0, shared: [], failClosed: false }
    const keeperId = ev.keeperId ?? s.target_id
    const loserId = ev.loserId ?? null
    // A discovery role suggestion always carries BOTH entity ids; without them the
    // role provenance can't be re-verified ⇒ conservatively drop the boost (never
    // raises confidence — the composite recompute lowers it toward the other signals).
    if (!keeperId || !loserId) return { boost: 0, shared: [], failClosed: false }
    const keeper = fetchContact(keeperId)
    const loser = fetchContact(loserId)
    // Either entity gone (hard-purged) ⇒ its role evidence is gone ⇒ no boost.
    if (!keeper || !loser) return { boost: 0, shared: [], failClosed: false }
    const { contacts: sanitized, failClosed } = blankIneligibleContactFieldsWithStatus([keeper, loser])
    // Field eligibility could not be verified ⇒ suppress (surface) + reject (accept).
    if (failClosed) return { boost: oldBoost, shared: oldShared, failClosed: true }
    const rec = roleSignal(sanitized[0]?.role ?? null, sanitized[1]?.role ?? null)
    return { boost: rec.boost, shared: rec.shared, failClosed: false }
  }
}

/**
 * ADV26-2 (round-27) — the ELIGIBLE shared-meeting id set for one entity, gated at
 * the membership ROW: the entity's meeting_contacts / meeting_projects rows,
 * filtered through {@link filterEligibleMembershipRows} so only calendar/user-
 * authored rows OR rows backed by an eligible source recording count. Used at
 * read-time mJac recompute so an excluded / hard-purged recording's
 * transcript-derived membership no longer keeps a merge suggestion above threshold
 * — even when the parent meeting carries calendar metadata. Fail-closed.
 */
function eligibleMeetingSetForEntity(kind: 'person' | 'project', id: string): Set<string> {
  const table = kind === 'person' ? 'meeting_contacts' : 'meeting_projects'
  const idCol = kind === 'person' ? 'contact_id' : 'project_id'
  const rows = safeQueryAll<MembershipRow & { meeting_id: string }>(
    `SELECT meeting_id, source, source_recording_id FROM ${table} WHERE ${idCol} = ?`,
    [id]
  )
  return new Set(filterEligibleMembershipRows(rows).eligible.map((r) => r.meeting_id))
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
  // ADV48-1 (round-50) — corrects a persisted `rarity`/confidence that was derived
  // (partly) from now-excluded transcript mentions, before the survivor is displayed.
  const recomputeRarity = makeRarityRecomputer()
  // ADV51-1 (round-53) — corrects/suppresses a persisted `role` boost + roleOverlap
  // whose source recording became excluded (or that is a legacy/untrusted role).
  const recomputeRole = makeRoleRecomputer()

  for (const s of suggestions) {
    if (s.status !== 'pending') {
      out.push(s)
      continue
    }

    let ev: SuggestionEvidence
    let evMalformed = false
    try {
      ev = s.evidence ? (JSON.parse(s.evidence) as SuggestionEvidence) : {}
    } catch {
      ev = {}
      evMalformed = true
    }
    // ADV25-5 (round-26) — a suggestion whose evidence blob is PRESENT but
    // unparseable cannot be revalidated (we can't even tell whether it carries a
    // graph/topic component). Fail-closed: suppress it from surfacing rather than
    // returning it unvalidated. Non-destructive — the DB row remains, so a fixed /
    // re-derived evidence blob re-surfaces it. (A null evidence is legitimately "no
    // evidence" and passes through below as a non-graph suggestion.)
    if (evMalformed) continue

    const oldGraph = Number(ev.signals?.graph ?? 0)
    const hadTopics = Array.isArray(ev.sharedTopics) && ev.sharedTopics.length > 0
    // No graph/topic component ⇒ this is NOT a discovery graph suggestion.
    if (oldGraph <= 0 && !hadTopics) {
      // ADV26-1 (round-27) — a TRANSCRIPT-created suggestion (applyTranscriptEntities)
      // carries NO graph/topic evidence, so round-26 passed it through UNVALIDATED:
      // a suggestion whose source recording was later trashed / personal /
      // value-excluded / hard-purged still surfaced and could be accepted. Revalidate
      // it through the recording allowlist using the authoritative source recording
      // id(s) persisted on the row (source_recording_ids). Discovery (graph) rows are
      // handled by the graph path above/below; they keep NULL provenance.
      const src = parseSourceRecordingIds(s.source_recording_ids)
      if (src !== null) {
        // Post-v44 transcript suggestion — gate by its source recording(s).
        if (src.length === 0) continue // no eligible source recorded ⇒ suppress
        const { eligible, failClosed } = filterEligibleRecordingIds(src)
        if (failClosed) continue // fail-closed
        if (!src.some((id) => eligible.has(id))) continue // all sources excluded/purged ⇒ suppress
        // ADV49-3 (round-51) — a NULL from the rarity recompute means the mention
        // count could not be verified ⇒ suppress (do not surface).
        const recomputed = recomputeRarity(s, ev)
        if (recomputed) out.push(recomputed)
        continue
      }
      // NULL provenance + no graph. A DISCOVERY straggler always carries a `signals`
      // block (email/name only); a legacy TRANSCRIPT suggestion does not. Suppress
      // the legacy/missing-provenance transcript suggestions fail-closed (ADV26-1);
      // let genuine discovery stragglers through (they have no recording attribution).
      if (ev.signals) {
        // ADV51-1 (round-53) — recompute the ROLE component from current field
        // provenance (excluded/legacy role ⇒ no boost; unverifiable ⇒ suppress).
        const roleRec = recomputeRole(s, ev)
        if (roleRec.failClosed) continue
        const oldRole = Number(ev.signals.role ?? 0)
        let comp = clamp01(Number(ev.composite ?? s.confidence ?? 0) - oldRole + roleRec.boost)
        if (ev.emailMatch === 'exact') comp = Math.max(comp, EMAIL_EXACT_FLOOR)
        ev.signals = { ...ev.signals, role: round2(roleRec.boost) }
        ev.roleOverlap = roleRec.shared
        ev.composite = round2(comp)
        // Role evidence was load-bearing and is now gone ⇒ drop below the bar.
        if (comp < SUGGEST_THRESHOLD) continue
        const recomputed = recomputeRarity({ ...s, confidence: round2(comp), evidence: JSON.stringify(ev) }, ev)
        if (recomputed) out.push(recomputed) // ADV49-3 — null ⇒ suppress (unverifiable rarity)
      }
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
        ? jaccard(eligibleMeetingSetForEntity(kind, keeperId), eligibleMeetingSetForEntity(kind, loserId!))
        : { score: 0, shared: [] as string[] }
      const newGraph = GRAPH_MAX_BOOST * clamp01(mJac.score + tJac.score)

      const oldComposite = Number(ev.composite ?? s.confidence ?? 0)
      let newComposite = clamp01(oldComposite - oldGraph + newGraph)

      // ADV51-1 (round-53) — recompute the ROLE component from current field
      // provenance too (a transcript-derived role whose source recording is now
      // excluded contributes nothing; an unverifiable role provenance suppresses).
      const roleRec = recomputeRole(s, ev)
      if (roleRec.failClosed) continue
      const oldRole = Number(ev.signals?.role ?? 0)
      newComposite = clamp01(newComposite - oldRole + roleRec.boost)
      if (ev.emailMatch === 'exact') newComposite = Math.max(newComposite, EMAIL_EXACT_FLOOR)

      ev.sharedTopics = eligibleSharedTopics
      ev.roleOverlap = roleRec.shared
      ev.signals = { ...(ev.signals ?? {}), graph: round2(newGraph), role: round2(roleRec.boost) }
      ev.composite = round2(newComposite)
      if (canRecompute) ev.sharedMeetings = mJac.shared.length
      // Ensure the rarity recompute below can resolve both names (may have been
      // filled from a DB lookup / candidate_name when absent from the blob).
      if (!ev.keeperName && keeperName) ev.keeperName = keeperName
      if (!ev.loserName && loserName) ev.loserName = loserName

      // ADV25-5 (round-26) — drop EVERY graph-bearing suggestion whose CONSERVATIVE
      // recomputed composite falls below the surfacing bar, regardless of whether a
      // resolvable loserId let us recompute meeting overlap. Without a loserId,
      // newGraph already treats meeting overlap as 0 (a conservative LOWER bound
      // that never raises confidence), and eligible topics are already suppressed —
      // so a below-threshold composite here means the load-bearing graph/topic
      // evidence is gone and the row must not surface. The email-exact floor above
      // still protects a legitimate email straggler.
      if (newComposite < SUGGEST_THRESHOLD) continue

      // Pass the graph-updated evidence on the base row so a rarity no-op still
      // preserves the sharedTopics redaction + graph-signal rewrite. ADV49-3
      // (round-51) — a NULL means the rarity mention count was unverifiable ⇒
      // suppress this suggestion from surfacing.
      const recomputed = recomputeRarity({ ...s, confidence: round2(newComposite), evidence: JSON.stringify(ev) }, ev)
      if (recomputed) out.push(recomputed)
    } catch (e) {
      // Fail-closed: a recompute error suppresses this pending suggestion.
      console.error('[identity-discovery] suggestion revalidation failed — suppressing (fail-closed):', e)
      continue
    }
  }
  return out
}

/**
 * ADV25-3 (round-26) — accept-time TOCTOU guard. identity:getSuggestions
 * revalidates on READ, but a card can be accepted (clicked) after its supporting
 * recording was excluded / hard-purged between load and click. Re-run the EXACT
 * same revalidation ({@link revalidateSuggestionsForSurfacing}) against current
 * provenance + eligibility and report whether the suggestion STILL clears
 * SUGGEST_THRESHOLD. The caller (identity:acceptSuggestion) MUST refuse the merge
 * when this returns false, with NO await between this check and the merge so the
 * eligibility check and the merge are atomic on the single-threaded main process.
 * Fail-closed: a suppressed/dropped, malformed, or below-threshold suggestion
 * returns false.
 */
export function isSuggestionEligibleForAccept(s: IdentitySuggestion): boolean {
  const survivors = revalidateSuggestionsForSurfacing([s])
  const survivor = survivors.find((x) => x.id === s.id)
  if (!survivor) return false
  return Number(survivor.confidence ?? 0) >= SUGGEST_THRESHOLD
}

/**
 * R28-RES-2 (round-29) — NON-OWNER DISPLAY gate for the surfaced merge queue.
 *
 * {@link revalidateSuggestionsForSurfacing} gates a suggestion's graph/topic/
 * recording EVIDENCE, but a name/email-only DISCOVERY straggler (graph=0, no
 * source_recording_ids) can pair two ENTITIES that are BOTH suppressed on non-owner
 * surfaces — transcript-created contacts/projects whose every source recording is
 * excluded (an "excluded-only entity", already hidden from the People/Projects LIST
 * by {@link filterVisibleEntityIds} at contacts:getAll/projects:getAll). Such a
 * suggestion would still surface both entity NAMES on a NON-OWNER surface: the Today
 * identity-suggestion teaser (a DISPLAY-tier surface) and the People/Projects merge
 * queue. Drop any suggestion whose keeper OR loser entity is not visible so an
 * excluded-only entity/pair never surfaces its name there.
 *
 * A suggestion with no resolvable loser ENTITY (a transcript-created suggestion
 * proposing a candidate NAME into an existing keeper) is gated only on the keeper —
 * its candidate name's recording eligibility is already enforced by
 * {@link revalidateSuggestionsForSurfacing} via source_recording_ids (ADV26-1).
 *
 * FAIL-CLOSED: a visibility-lookup exception yields an empty visible set → the
 * affected suggestions are suppressed.
 *
 * DISPLAY tier ONLY. The ACCEPT action ({@link isSuggestionEligibleForAccept} →
 * identity:acceptSuggestion) is OWNER-management and stays gated on EVIDENCE
 * eligibility (recording provenance), NOT entity visibility — the owner may merge
 * their own entities. It is intentionally NOT routed through this gate.
 */
export function filterSuggestionsForNonOwnerDisplay(suggestions: IdentitySuggestion[]): IdentitySuggestion[] {
  if (suggestions.length === 0) return suggestions
  const contactIds = new Set<string>()
  const projectIds = new Set<string>()
  const resolved = suggestions.map((s) => {
    let ev: SuggestionEvidence = {}
    try {
      ev = s.evidence ? (JSON.parse(s.evidence) as SuggestionEvidence) : {}
    } catch {
      ev = {}
    }
    const keeperId = ev.keeperId ?? s.target_id
    const loserId = ev.loserId ?? null
    const set = s.kind === 'person' ? contactIds : projectIds
    if (keeperId) set.add(keeperId)
    if (loserId) set.add(loserId)
    return { s, kind: s.kind, keeperId, loserId }
  })
  const visibleContacts = filterVisibleEntityIds('contact', contactIds).visible
  const visibleProjects = filterVisibleEntityIds('project', projectIds).visible
  const out: IdentitySuggestion[] = []
  for (const { s, kind, keeperId, loserId } of resolved) {
    const visible = kind === 'person' ? visibleContacts : visibleProjects
    if (keeperId && !visible.has(keeperId)) continue
    if (loserId && !visible.has(loserId)) continue
    out.push(s)
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

/**
 * v44/round-27 — parse the identity_suggestions.source_recording_ids column.
 * Returns `null` when the column is NULL/absent (a DISCOVERY/graph or legacy
 * suggestion with no per-suggestion recording provenance), or a (possibly empty)
 * string[] for a TRANSCRIPT-created suggestion whose provenance is KNOWN. A
 * malformed blob is treated as an EMPTY known-provenance array (fail-closed: a
 * transcript suggestion we can't attribute has no eligible source ⇒ suppressed).
 */
function parseSourceRecordingIds(raw: string | null | undefined): string[] | null {
  if (raw == null) return null
  try {
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed.filter((id): id is string => typeof id === 'string' && !!id) : []
  } catch {
    return []
  }
}
