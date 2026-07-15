/**
 * Knowledge Graph Service — wires @hidock/knowledge-graph into the Electron app.
 *
 * Provides:
 * - Singleton KnowledgeGraphStore backed by the app's SQLite database
 * - LlmExtractor that uses @hidock/ai-providers complete()
 * - Incremental ingestion from DB transcripts and from a folder of .txt/.md files
 * - Thin query wrappers for IPC handlers
 */

import { resolve, basename, extname } from 'path'
import { readdirSync, readFileSync, existsSync, statSync } from 'fs'
import {
  KnowledgeGraphStore,
  extractGraphFromTranscript,
  ingestExtraction,
  topAttendeesForProjectOrTopic,
  topSkillDemonstrators,
  personProfile,
  meetingSummaryGraph,
  fullGraph,
  neighborhood,
  pruneGenericNodes,
  lensGraph,
  pickDefaultCenter,
  provenance,
  renameNode,
  mergeNodes,
  mergeBlastRadius,
  deleteNode,
  setNodeProps,
  nodeGraphStats,
  removeRecordingProvenance,
  pruneOrphanEdgeSources,
  DEFAULT_OVERVIEW_NODE_LIMIT,
} from '@hidock/knowledge-graph'
import type {
  GraphDb,
  LlmExtractor,
  PersonResolver,
  AttendeeResult,
  SkillDemonstratorResult,
  PersonProfile,
  MeetingGraph,
  GraphNode,
  SubGraph,
  LensGraph,
  Provenance,
} from '@hidock/knowledge-graph'
import { complete } from '@hidock/ai-providers'
import { getProviderConfigFromSettings } from './ai-provider-config'
import {
  run,
  runInTransaction,
  queryAll,
  queryOne,
  getValueExcludedRecordingIds,
  getEligibleRecordingIds,
  isRecordingGraphIngestable,
  getContactById,
  getContactByName,
  createContact,
  updateContact,
  upsertContactAlias,
  getContactAliases,
  mergeContacts,
  getMergeImpact,
} from './database'
import { getEventBus } from './event-bus'
import { resolveContact } from './entity-resolver'

// ---------------------------------------------------------------------------
// GraphDb adapter — bridges the app's database exports to the GraphDb interface
// ---------------------------------------------------------------------------

const graphDbAdapter: GraphDb = {
  run(sql: string, params?: unknown[]) {
    run(sql, (params ?? []) as any[])
  },
  queryAll<T>(sql: string, params?: unknown[]): T[] {
    return queryAll<T>(sql, (params ?? []) as any[])
  },
  queryOne<T>(sql: string, params?: unknown[]): T | undefined {
    return queryOne<T>(sql, (params ?? []) as any[])
  },
}

// ---------------------------------------------------------------------------
// Singleton store (lazy init on first use)
// ---------------------------------------------------------------------------

let _store: KnowledgeGraphStore | null = null

export function getKnowledgeGraphStore(): KnowledgeGraphStore {
  if (!_store) {
    _store = new KnowledgeGraphStore(graphDbAdapter)
  }
  // Always (re-)run schema init — idempotent (CREATE TABLE IF NOT EXISTS).
  // This ensures graph tables + tracking table exist even when the DB engine
  // has been re-initialized since the singleton was created (e.g., in tests).
  _store.initSchema()
  _ensureIngestTrackingTable()
  return _store
}

function _ensureIngestTrackingTable(): void {
  try {
    run(
      `CREATE TABLE IF NOT EXISTS graph_ingested_transcripts (
        transcript_id TEXT PRIMARY KEY,
        ingested_at TEXT NOT NULL
      )`
    )
  } catch (e) {
    console.warn('[KnowledgeGraph] Could not create graph_ingested_transcripts table:', e)
  }
}

/**
 * F17/T6 (spec-006) AR3-3(a) — graph-health pre-flight for a hard purge.
 * Called from the IPC handler layer (recording-deletion-handlers.ts) BEFORE
 * deleteCascade, so a broken graph store (corrupt DB, disk full, permission
 * denied) is caught with an honest, fast failure OUTSIDE the delete
 * transaction — never discovered only after a write transaction is already
 * open. Runs store init (idempotent DDL — now surfaces real failures per
 * AR3-3b) plus a 1-row sanity SELECT that proves the connection actually
 * works, not just that initSchema() didn't throw. Never throws to the caller;
 * the fail-closed refusal itself is the hard branch's own AR3-1 seam check
 * inside deleteRecordingCascade — this is purely an earlier, cheaper warning.
 */
export function ensureGraphReady(): { ok: boolean; error?: string } {
  try {
    const store = getKnowledgeGraphStore()
    store.db.queryOne('SELECT 1 AS ok')
    return { ok: true }
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e)
    console.error('[KnowledgeGraph] ensureGraphReady failed:', e)
    return { ok: false, error }
  }
}

// ---------------------------------------------------------------------------
// Person identity resolution (R4c — key person nodes by contact id)
// ---------------------------------------------------------------------------

/** The confidence at/above which we key a person node by contact id (the
 *  resolver's auto-link line). Below it, the node stays name-keyed. */
const REKEY_CONFIDENCE = 0.8

/**
 * A PersonResolver for graph ingest: turns a raw name into a canonical contact
 * identity when the shared entity resolver is confident enough, using meeting
 * co-occurrence as context. Returns null (→ name-keyed node) otherwise.
 */
function makePersonResolver(meetingId?: string): PersonResolver {
  return (name: string) => {
    try {
      const r = resolveContact(name, meetingId ? { meetingId } : undefined)
      if (r.id && r.confidence >= REKEY_CONFIDENCE) {
        const contact = getContactById(r.id)
        return { id: r.id, label: contact?.name ?? name }
      }
    } catch (e) {
      console.warn('[KnowledgeGraph] person resolve failed:', e)
    }
    return null
  }
}

// ---------------------------------------------------------------------------
// Ingestion from DB transcripts
// ---------------------------------------------------------------------------

interface TranscriptRow {
  id: string
  full_text: string
  recording_id: string
  date_recorded: string | null
  meeting_id: string | null
  subject: string | null
}

export interface IngestResult {
  ingested: number
  skipped: number
  errors: Array<{ transcriptId: string; error: string }>
}

export async function ingestFromDbTranscripts(): Promise<IngestResult> {
  const providerConfig = getProviderConfigFromSettings()
  if (!providerConfig) {
    throw new Error('No AI provider configured. Please set a provider API key in Settings.')
  }

  const store = getKnowledgeGraphStore()
  const llm: LlmExtractor = (prompt: string) => complete(prompt, providerConfig)

  // Get all transcripts with recording + meeting meta
  // Cross-reference (/simplify S-5, database.ts's getExcludedRecordingIds):
  // personal/deleted exclusion is composed differently here than in the RAG
  // path — filtered directly in this base query, then layered with
  // value-exclusion below (pre-filter Set + fresh point-read), rather than
  // unioned into one Set. Same net effect; deliberate, not drift.
  const rows = queryAll<TranscriptRow>(`
    SELECT
      t.id,
      t.full_text,
      t.recording_id,
      r.date_recorded,
      r.meeting_id,
      m.subject
    FROM transcripts t
    JOIN recordings r ON r.id = t.recording_id
    LEFT JOIN meetings m ON m.id = r.meeting_id
    WHERE COALESCE(r.personal, 0) = 0 AND r.deleted_at IS NULL
  `)

  const result: IngestResult = { ingested: 0, skipped: 0, errors: [] }

  // F16/spec-002 (AR-1, layer 1 of 2): cheap once-per-run PRE-FILTER. A
  // transcript whose recording is already value-excluded at run start is
  // skipped BEFORE the LLM extraction call — no LLM cost, no marker (so a
  // later rating upgrade re-ingests it on a future pass). This snapshot is
  // what bounds the cost: skipped rows are never marked, so without this
  // pre-filter every ingest pass (60s-debounced transcript-ready, boot,
  // manual) would re-run the full extraction for every excluded transcript,
  // forever. The snapshot may go stale across the loop's awaits — that is
  // layer 2's job, not this one's. Defensive try/catch (mirrors the RAG
  // union in getExcludedRecordingIds): a value-query failure degrades to
  // "no pre-filter" rather than failing the whole ingest pass — layer 2
  // still gates each row's persistence.
  let valueExcluded: Set<string>
  try {
    valueExcluded = getValueExcludedRecordingIds()
  } catch (e) {
    console.warn('[KnowledgeGraph] Value pre-filter unavailable (per-row transactional check still gates):', e)
    valueExcluded = new Set<string>()
  }

  for (const row of rows) {
    // Pre-filter (layer 1): excluded at run start — skip without extracting.
    if (valueExcluded.has(row.recording_id)) {
      result.skipped++
      console.log(
        `[KnowledgeGraph] Skipped value-excluded recording ${row.recording_id} (transcript ${row.id})`
      )
      continue
    }

    // Check if already ingested (incremental)
    const already = queryOne<{ transcript_id: string }>(
      'SELECT transcript_id FROM graph_ingested_transcripts WHERE transcript_id = ?',
      [row.id]
    )
    if (already) {
      result.skipped++
      continue
    }

    try {
      // P1 (round-3, FAIL CLOSED) — the value pre-filter Set above degrades to
      // EMPTY on a lookup error (fail-open), which would send an excluded
      // recording's full_text to the LLM. Gate the provider call on an
      // AUTHORITATIVE fresh point-read (exists AND not deleted AND not personal
      // AND not value-excluded) so a transient exclusion-lookup failure never
      // leaks content to the provider.
      if (!isRecordingGraphIngestable(row.recording_id)) {
        result.skipped++
        console.log(
          `[KnowledgeGraph] Skipped ineligible recording ${row.recording_id} before extraction (transcript ${row.id})`
        )
        continue
      }
      const meta = {
        meetingId: row.meeting_id ?? row.recording_id,
        title: row.subject ?? undefined,
        date: row.date_recorded ?? undefined,
      }
      // The LLM extraction call stays OUTSIDE the transaction (Codex
      // adversarial review AR-1) — it can take seconds and must not hold a
      // DB transaction open.
      const extraction = await extractGraphFromTranscript(row.full_text, meta, llm)

      // F16/spec-002 (AR-1, layer 2 of 2) + F18 (spec-004, Step 6): FINAL
      // eligibility is decided with a FRESH point-read at persistence time,
      // inside the SAME transaction as the graph writes + ingested-marker
      // insert — the pre-filter Set above is only a run-start snapshot and
      // can go stale across this loop's awaits. isRecordingGraphIngestable is
      // a strict superset of the old value-only check: it ALSO closes the
      // purge/soft-delete-vs-ingest race (a hard-purged or soft-deleted
      // recording is ineligible for re-ingest at this instant). A rating (or
      // existence) written any time up to this instant — including while
      // THIS row's extraction call was in flight — is honored: an ineligible
      // recording is skipped WITHOUT writing the marker (a still-live
      // exclusion is then in the NEXT run's pre-filter snapshot, so the one
      // extraction this run paid for is the last), and a recording that
      // became eligible mid-run still ingests. Wrapping ingest+marker in one
      // transaction also makes them atomic: a mid-ingest failure rolls back
      // both.
      runInTransaction(() => {
        if (!isRecordingGraphIngestable(row.recording_id)) {
          result.skipped++
          console.log(
            `[KnowledgeGraph] Skipped non-ingestable recording ${row.recording_id} (transcript ${row.id})`
          )
          return
        }

        // F18 (AR2-4): fresh in-txn marker re-check. The outer "already
        // ingested" pre-check above runs OUTSIDE this transaction, so two
        // overlapping ingest passes can both pass it before either commits.
        // This point-read — taken inside the SAME transaction as the write —
        // is what actually prevents a double-ingest / double weight-bump: the
        // second pass to reach this line sees the first pass's marker and
        // skips, rather than re-asserting every edge a second time.
        const alreadyInTxn = queryOne<{ transcript_id: string }>(
          'SELECT transcript_id FROM graph_ingested_transcripts WHERE transcript_id = ?',
          [row.id]
        )
        if (alreadyInTxn) {
          result.skipped++
          return
        }

        ingestExtraction(store, extraction, meta, {
          now: new Date().toISOString(),
          resolvePerson: makePersonResolver(row.meeting_id ?? undefined),
          recordingId: row.recording_id,
          transcriptId: row.id,
        })

        // Mark as ingested
        run(
          'INSERT OR IGNORE INTO graph_ingested_transcripts (transcript_id, ingested_at) VALUES (?, ?)',
          [row.id, new Date().toISOString()]
        )
        result.ingested++
      })
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e)
      result.errors.push({ transcriptId: row.id, error: msg })
      console.error(`[KnowledgeGraph] Failed to ingest transcript ${row.id}:`, e)
    }
  }

  // Bring any legacy name-keyed person nodes onto the contact-id identity.
  try {
    const rk = rekeyExistingPersonNodes()
    if (rk.rekeyed + rk.merged > 0) {
      console.log(`[KnowledgeGraph] Re-keyed ${rk.rekeyed} + merged ${rk.merged} person node(s) by contact id`)
    }
  } catch (e) {
    console.warn('[KnowledgeGraph] Person re-key pass failed (non-fatal):', e)
  }

  // F18 (spec-004, Step 6.3): hygiene sweep for graph_edge_sources rows
  // orphaned by a merge-collision repoint that had no keeper edge to
  // transfer onto (a self-loop collapse — see mutations.ts::mergeNodes).
  // Non-fatal; removeRecordingProvenance already tolerates orphaned rows via
  // its own JOIN, so a failure here never affects correctness.
  try {
    pruneOrphanEdgeSources(store)
  } catch (e) {
    console.warn('[KnowledgeGraph] Orphan edge-source prune failed (non-fatal):', e)
  }

  return result
}

// ---------------------------------------------------------------------------
// Ingestion from folder (text/markdown files)
// ---------------------------------------------------------------------------

export async function ingestFromFolder(folderPath: string): Promise<IngestResult> {
  // Security: validate path (no traversal)
  if (!folderPath || typeof folderPath !== 'string') {
    throw new Error('Invalid folder path')
  }

  const resolved = resolve(folderPath)

  // Reject paths that contain traversal segments
  if (folderPath.includes('..')) {
    throw new Error('Path traversal not allowed')
  }

  if (!existsSync(resolved)) {
    throw new Error(`Folder does not exist: ${resolved}`)
  }

  if (!statSync(resolved).isDirectory()) {
    throw new Error(`Path is not a directory: ${resolved}`)
  }

  const providerConfig = getProviderConfigFromSettings()
  if (!providerConfig) {
    throw new Error('No AI provider configured. Please set a provider API key in Settings.')
  }

  const store = getKnowledgeGraphStore()
  const llm: LlmExtractor = (prompt: string) => complete(prompt, providerConfig)

  const files = readdirSync(resolved).filter((f) => {
    const ext = extname(f).toLowerCase()
    return ext === '.txt' || ext === '.md'
  })

  const result: IngestResult = { ingested: 0, skipped: 0, errors: [] }

  for (const file of files) {
    const filePath = resolve(resolved, file)
    const transcriptId = `folder:${resolved}:${file}`

    // Incremental check
    const already = queryOne<{ transcript_id: string }>(
      'SELECT transcript_id FROM graph_ingested_transcripts WHERE transcript_id = ?',
      [transcriptId]
    )
    if (already) {
      result.skipped++
      continue
    }

    try {
      const content = readFileSync(filePath, 'utf-8')
      const nameWithoutExt = basename(file, extname(file))
      const meta = {
        meetingId: transcriptId,
        title: nameWithoutExt,
        date: undefined,
      }

      const extraction = await extractGraphFromTranscript(content, meta, llm)
      ingestExtraction(store, extraction, meta, {
        now: new Date().toISOString(),
        resolvePerson: makePersonResolver(),
      })

      run(
        'INSERT OR IGNORE INTO graph_ingested_transcripts (transcript_id, ingested_at) VALUES (?, ?)',
        [transcriptId, new Date().toISOString()]
      )
      result.ingested++
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e)
      result.errors.push({ transcriptId: file, error: msg })
      console.error(`[KnowledgeGraph] Failed to ingest file ${file}:`, e)
    }
  }

  return result
}

// ---------------------------------------------------------------------------
// F18 (spec-004): per-recording graph-provenance cleanup
//
// removeRecordingProvenanceCore is the TRANSACTION-NEUTRAL removal engine
// (AR2-2): plain sequential statements, NO runInTransaction of its own. Two
// callers:
//   (a) removeRecordingFromGraph — wraps the core in ITS OWN runInTransaction,
//       for the impact dialog's dry-run and any standalone graph-reset caller.
//   (b) F17/T6's hard-purge path (NOT implemented by T4) — calls the core
//       directly, INSIDE deleteRecordingCascade's own runInTransaction,
//       passing pre-captured meetingId/transcriptIds (captured BEFORE the
//       cascade deletes the recordings/transcripts rows). That makes the graph
//       cleanup commit atomically with the rest of the purge: one commit, no
//       crash window between the cascade and the graph cleanup, no
//       pending-cleanup journal. A thrown error there aborts the WHOLE purge
//       (honest all-or-nothing) — this core function does not catch.
// ---------------------------------------------------------------------------

export interface RemoveRecordingFromGraphOptions {
  /** Compute the plan without writing anything (F17's impact dialog). */
  dryRun?: boolean
  /**
   * Pre-captured meeting id. F17/T6 calls the core AFTER
   * deleteRecordingCascade has already deleted the `recordings` row, so
   * self-resolution is no longer possible there — it must pass this. Omit for
   * dry-run / standalone use (the recording still exists; self-resolved from
   * `recordings.meeting_id ?? recordingId`, matching ingest's own meta.meetingId).
   */
  meetingId?: string
  /**
   * Pre-captured transcript ids (same reason as meetingId). Omit for
   * dry-run / standalone use — self-resolved as the union of the live
   * `transcripts` table and `graph_edge_sources.transcript_id` for this
   * recording (self-heals a stale marker left by a re-transcribed-away
   * transcript, §3.7).
   */
  transcriptIds?: string[]
}

/**
 * Every count field below — `markersRemoved` through `unattributedResidueKept`
 * (incl. `orphanNodesByType`) — is computed from a single in-memory PLAN taken
 * BEFORE any write (both here and in the package's `removeRecordingProvenance`
 * that this spreads in). When `dryRun` is true, these numbers are therefore an
 * ESTIMATE (AR2-5): accurate only if the graph stays quiescent between the dry
 * run and a later real run. Anything else that writes to the graph in between
 * (another recording's ingest or cleanup) can change them — F17's impact
 * dialog must present them as approximate ("~N graph links"), never as an
 * exact pre-count of what the real purge will do. A non-dryRun result's counts
 * are the actual committed numbers.
 */
export interface RemoveRecordingFromGraphResult {
  ok: boolean
  recordingId: string
  dryRun: boolean
  /** graph_ingested_transcripts markers removed. */
  markersRemoved: number
  edgesRemoved: number
  edgeSourceRowsRemoved: number
  meetingNodesRemoved: number
  orphanNodesRemoved: number
  orphanNodesByType: Record<string, number>
  sharedEdgesKept: number
  /** Edges kept because part of their weight is an unattributed (legacy /
   *  folder-ingest) co-assertion this recording cannot account for (CX-T4-1). */
  unattributedResidueKept: number
  /** Populated on failure; the caller inspects this — never a silent catch (CX-T3-7). */
  error?: string
}

/** A project node is protected (never GC'd) when it is linked to a real
 *  `projects` DB row — matched by name, same as projectNameIndex() elsewhere
 *  in this file (project graph nodes are name-keyed, not id-keyed). */
function isProjectNodeProtected(node: { label: string }): boolean {
  const row = queryOne<{ id: string }>('SELECT id FROM projects WHERE LOWER(name) = ?', [
    (node.label || '').toLowerCase().trim(),
  ])
  return !!row
}

/**
 * Transaction-neutral removal core (AR2-2) — see the section banner above for
 * the full contract. Resolves meetingId/transcriptIds (preferring the
 * caller's pre-captured values), deletes `graph_ingested_transcripts` markers
 * FIRST (belt-and-suspenders; the real race fix is `isRecordingGraphIngestable`
 * at ingest time), then delegates the graph surgery itself to the package's
 * `removeRecordingProvenance`. Throws on failure — callers wrap in their own
 * transaction and/or catch.
 */
export function removeRecordingProvenanceCore(
  recordingId: string,
  opts: RemoveRecordingFromGraphOptions = {}
): RemoveRecordingFromGraphResult {
  const store = getKnowledgeGraphStore()
  const dryRun = !!opts.dryRun

  let meetingId = opts.meetingId
  if (meetingId === undefined) {
    const rec = queryOne<{ meeting_id: string | null }>('SELECT meeting_id FROM recordings WHERE id = ?', [
      recordingId,
    ])
    meetingId = rec?.meeting_id ?? recordingId
  }

  const liveTranscriptIds = queryAll<{ id: string }>('SELECT id FROM transcripts WHERE recording_id = ?', [
    recordingId,
  ]).map((r) => r.id)
  const sourcedTranscriptIds = store.db
    .queryAll<{ transcript_id: string }>(
      'SELECT DISTINCT transcript_id FROM graph_edge_sources WHERE recording_id = ?',
      [recordingId]
    )
    .map((r) => r.transcript_id)
  const transcriptIds = [...new Set([...(opts.transcriptIds ?? []), ...liveTranscriptIds, ...sourcedTranscriptIds])]

  // Markers FIRST (§3.3). Plan (which markers currently exist) then execute,
  // so dryRun and a subsequent real run report the same count (AR2-5: the
  // dryRun figure is an estimate for the impact dialog; the real run's is the
  // committed count).
  let markersRemoved = 0
  if (transcriptIds.length > 0) {
    const placeholders = transcriptIds.map(() => '?').join(',')
    const existingMarkers = queryAll<{ transcript_id: string }>(
      `SELECT transcript_id FROM graph_ingested_transcripts WHERE transcript_id IN (${placeholders})`,
      transcriptIds
    )
    markersRemoved = existingMarkers.length
    if (!dryRun) {
      for (const tid of transcriptIds) {
        run('DELETE FROM graph_ingested_transcripts WHERE transcript_id = ?', [tid])
      }
    }
  }

  const removal = removeRecordingProvenance(store, recordingId, {
    dryRun,
    meetingId,
    isProjectProtected: isProjectNodeProtected,
  })

  return {
    ok: true,
    recordingId,
    dryRun,
    markersRemoved,
    ...removal,
  }
}

function emptyRemovalCounts(): Omit<
  RemoveRecordingFromGraphResult,
  'ok' | 'recordingId' | 'dryRun' | 'error'
> {
  return {
    markersRemoved: 0,
    edgesRemoved: 0,
    edgeSourceRowsRemoved: 0,
    meetingNodesRemoved: 0,
    orphanNodesRemoved: 0,
    orphanNodesByType: {},
    sharedEdgesKept: 0,
    unattributedResidueKept: 0,
  }
}

/**
 * Standalone/dry-run entry point: wraps `removeRecordingProvenanceCore` in its
 * own `runInTransaction` for atomicity, and never throws to the caller —
 * returns `{ ok: false, error }` on failure instead (CX-T3-7: no silent
 * catch). Used by F17's impact dialog (`dryRun: true`) and any standalone
 * graph-reset caller. The F17 hard-purge path does NOT call this function —
 * it calls `removeRecordingProvenanceCore` directly, inside
 * `deleteRecordingCascade`'s own transaction (AR2-2), so a graph failure
 * aborts the whole purge instead of leaving a partial, uncommitted cleanup.
 */
export function removeRecordingFromGraph(
  recordingId: string,
  opts: RemoveRecordingFromGraphOptions = {}
): RemoveRecordingFromGraphResult {
  const dryRun = !!opts.dryRun
  try {
    return runInTransaction(() => removeRecordingProvenanceCore(recordingId, opts))
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e)
    console.error(`[KnowledgeGraph] removeRecordingFromGraph(${recordingId}) failed:`, e)
    return {
      ok: false,
      recordingId,
      dryRun,
      ...emptyRemovalCounts(),
      error,
    }
  }
}

// ---------------------------------------------------------------------------
// Query wrappers
// ---------------------------------------------------------------------------

// RE4-3 (round-4) — the whole family of raw graph reads exposed via graph:* IPC.
// Each applies fail-closed getGroundingExclusionSet + node-visibility suppression
// so an excluded-only person/meeting/skill/label is never retrievable. See the
// {endpoint → filtered?} audit table in .claude/changes/ARF-HIGHS-CHANGES.md.

// INC1/INC2 (round-5) — eligibility for a ranking/relationship must be decided
// at the EDGE that actually carries it, evaluated fail-closed, NOT inferred from
// the resulting node's GLOBAL visibility: a person/meeting/skill whose
// contributing path is entirely excluded must not appear (even if the node has
// an eligible edge elsewhere), and counts/weights must sum over surviving edges.

export function queryTopAttendees(name: string): AttendeeResult[] {
  const store = getKnowledgeGraphStore()
  const exclusion = getGroundingExclusionSet(true) // ADV23-2: non-owner surface — suppress legacy zero-provenance edges
  if (exclusionIsNoop(exclusion)) return topAttendeesForProjectOrTopic(store, name)
  const normName = name.toLowerCase().trim()
  // Raw (person, meeting) attendance rows WITH the two connecting edge ids so
  // each contributing path can be provenance-filtered before aggregation.
  const rows = store.db.queryAll<{
    person_id: string
    person_label: string
    meeting_id: string
    ea_id: string
    ab_id: string
  }>(
    `SELECT p.id AS person_id, p.label AS person_label, m.id AS meeting_id,
            ea.id AS ea_id, ab.id AS ab_id
       FROM graph_nodes p
       JOIN graph_edges ea ON ea.source_id = p.id AND ea.type = 'ATTENDED'
       JOIN graph_nodes m  ON m.id = ea.target_id AND m.type = 'meeting'
       JOIN graph_edges ab ON ab.source_id = m.id AND ab.type = 'ABOUT'
       JOIN graph_nodes t  ON t.id = ab.target_id AND (t.type = 'topic' OR t.type = 'project')
      WHERE p.type = 'person' AND LOWER(t.norm_key) LIKE ?`,
    [`%${normName}%`]
  )
  const edgeIds = [...new Set(rows.flatMap((r) => [r.ea_id, r.ab_id]))]
  const suppressed = provenanceSuppressedEdgeIds(store, edgeIds, exclusion)
  const byPerson = new Map<string, { label: string; meetings: Set<string> }>()
  for (const r of rows) {
    // BOTH the ATTENDED and the ABOUT edge must survive for this path to count.
    if (suppressed.has(r.ea_id) || suppressed.has(r.ab_id)) continue
    let e = byPerson.get(r.person_id)
    if (!e) { e = { label: r.person_label, meetings: new Set() }; byPerson.set(r.person_id, e) }
    e.meetings.add(r.meeting_id)
  }
  return [...byPerson.entries()]
    .map(([personId, e]) => ({ person: e.label, personId, meetings: e.meetings.size }))
    .sort((a, b) => b.meetings - a.meetings)
}

export function queryTopSkill(skill: string): SkillDemonstratorResult[] {
  const store = getKnowledgeGraphStore()
  const exclusion = getGroundingExclusionSet(true) // ADV23-2: non-owner surface — suppress legacy zero-provenance edges
  if (exclusionIsNoop(exclusion)) return topSkillDemonstrators(store, skill)
  const normSkill = skill.toLowerCase().trim()
  const rows = store.db.queryAll<{ person_id: string; person_label: string; edge_id: string; weight: number }>(
    `SELECT p.id AS person_id, p.label AS person_label, e.id AS edge_id, e.weight AS weight
       FROM graph_nodes p
       JOIN graph_edges e ON e.source_id = p.id AND e.type = 'DEMONSTRATED'
       JOIN graph_nodes s ON s.id = e.target_id AND s.type = 'skill'
      WHERE p.type = 'person' AND LOWER(s.norm_key) LIKE ?`,
    [`%${normSkill}%`]
  )
  const suppressed = provenanceSuppressedEdgeIds(store, rows.map((r) => r.edge_id), exclusion)
  const byPerson = new Map<string, { label: string; weight: number }>()
  for (const r of rows) {
    if (suppressed.has(r.edge_id)) continue // demonstration edge excluded
    let e = byPerson.get(r.person_id)
    if (!e) { e = { label: r.person_label, weight: 0 }; byPerson.set(r.person_id, e) }
    e.weight += r.weight
  }
  return [...byPerson.entries()]
    .map(([personId, e]) => ({ person: e.label, personId, weight: e.weight }))
    .sort((a, b) => b.weight - a.weight)
}

export function queryPersonProfile(name: string): PersonProfile | undefined {
  const store = getKnowledgeGraphStore()
  const profile = personProfile(store, name)
  if (!profile) return undefined
  const exclusion = getGroundingExclusionSet(true) // ADV23-2: non-owner surface — suppress legacy zero-provenance edges
  if (exclusionIsNoop(exclusion)) return profile
  // An excluded-only person is not retrievable at all.
  if (!isNodeVisibleUnderExclusion(store, profile.personId, exclusion)) return undefined
  // INC2 — each relationship is filtered by ITS CONNECTING edge's provenance,
  // not the related node's global visibility (a meeting reachable via an
  // excluded ATTENDED edge is dropped even if the meeting is globally visible).
  const related = (edgeType: string): GraphNode[] => {
    const rows = store.db.queryAll<GraphNode & { __edge_id: string }>(
      `SELECT n.id, n.type, n.label, n.norm_key, n.props, n.created_at, n.updated_at, e.id AS __edge_id
         FROM graph_nodes n
         JOIN graph_edges e ON e.target_id = n.id AND e.type = ?
        WHERE e.source_id = ?`,
      [edgeType, profile.personId]
    )
    const suppressed = provenanceSuppressedEdgeIds(store, rows.map((r) => r.__edge_id), exclusion)
    return rows
      .filter((r) => !suppressed.has(r.__edge_id))
      .map(({ __edge_id, ...node }) => node as GraphNode)
  }
  return {
    ...profile,
    meetings: related('ATTENDED'),
    skills: related('DEMONSTRATED'),
    actionItems: related('OWNS'),
  }
}

export function queryMeetingGraph(meetingId: string): MeetingGraph {
  const store = getKnowledgeGraphStore()
  const graph = meetingSummaryGraph(store, meetingId)
  const exclusion = getGroundingExclusionSet(true) // ADV23-2: non-owner surface — suppress legacy zero-provenance edges
  if (exclusionIsNoop(exclusion) || !graph.meeting) return graph
  // Centered on a meeting: fail closed + never expose an excluded-only meeting.
  if (exclusion.failClosed || !isNodeVisibleUnderExclusion(store, graph.meeting.id, exclusion)) {
    return { meeting: undefined, nodes: [], edges: [] }
  }
  const suppressed = provenanceSuppressedEdgeIds(store, graph.edges.map((e) => e.id), exclusion)
  const keptEdges = graph.edges.filter((e) => !suppressed.has(e.id))
  const incident = new Set<string>([graph.meeting.id])
  for (const e of keptEdges) {
    incident.add(e.source_id)
    incident.add(e.target_id)
  }
  return { meeting: graph.meeting, nodes: graph.nodes.filter((n) => incident.has(n.id)), edges: keptEdges }
}

export function queryStats(): { nodes: number; edges: number; nodesByType: Record<string, number> } {
  const store = getKnowledgeGraphStore()
  const exclusion = getGroundingExclusionSet(true) // ADV23-2: non-owner surface — suppress legacy zero-provenance edges
  if (!exclusionIsNoop(exclusion)) {
    // RE4-3 — counts must reflect only VISIBLE (eligible) content, so an
    // excluded recording's attributed nodes/edges aren't counted. Build the
    // suppressed full graph and count survivors.
    const full = suppressExcludedFromView(toDTO(fullGraph(store)), exclusion)
    const nodesByType: Record<string, number> = {}
    for (const n of full.nodes) nodesByType[n.type] = (nodesByType[n.type] ?? 0) + 1
    return { nodes: full.nodes.length, edges: full.edges.length, nodesByType }
  }
  const nodes = store.db.queryAll<{ count: number }>('SELECT COUNT(*) AS count FROM graph_nodes')
  const edges = store.db.queryAll<{ count: number }>('SELECT COUNT(*) AS count FROM graph_edges')
  const byType = store.db.queryAll<{ type: string; count: number }>(
    'SELECT type, COUNT(*) AS count FROM graph_nodes GROUP BY type'
  )
  const nodesByType: Record<string, number> = {}
  for (const row of byType) {
    nodesByType[row.type] = row.count
  }
  return {
    nodes: nodes[0]?.count ?? 0,
    edges: edges[0]?.count ?? 0,
    nodesByType,
  }
}

export function queryListNodes(type?: string): GraphNode[] {
  const store = getKnowledgeGraphStore()
  const nodes = store.findNodes(type ? { type: type as any } : {})
  const exclusion = getGroundingExclusionSet(true) // ADV23-2: non-owner surface — suppress legacy zero-provenance edges
  if (exclusionIsNoop(exclusion)) return nodes
  return nodes.filter((n) => isNodeVisibleUnderExclusion(store, n.id, exclusion))
}

// ---------------------------------------------------------------------------
// R4c migration — re-key existing name-keyed person nodes by contact id
// ---------------------------------------------------------------------------

interface PersonNodeRow {
  id: string
  label: string
  norm_key: string
  props: string | null
}

/**
 * LLM-free surgery that brings already-ingested (name-keyed) person nodes onto
 * the contact-id identity. For each person node not yet keyed by `contact:*`,
 * resolve its label to a contact; if confident, either fold it into the
 * existing contact-keyed node (repointing edges) or relabel it in place.
 *
 * Idempotent: contact-keyed nodes are skipped, so re-running is a no-op.
 */
export function rekeyExistingPersonNodes(): { rekeyed: number; merged: number; skipped: number } {
  const store = getKnowledgeGraphStore()
  const db = store.db
  const result = { rekeyed: 0, merged: 0, skipped: 0 }

  const nameKeyed = db.queryAll<PersonNodeRow>(
    "SELECT id, label, norm_key, props FROM graph_nodes WHERE type = 'person' AND norm_key NOT LIKE 'contact:%'"
  )

  for (const node of nameKeyed) {
    let contactId: string | null = null
    try {
      const r = resolveContact(node.label)
      if (r.id && r.confidence >= REKEY_CONFIDENCE) contactId = r.id
    } catch {
      contactId = null
    }
    if (!contactId) {
      result.skipped++
      continue
    }

    const contactKey = `contact:${contactId}`
    const canonicalLabel = getContactById(contactId)?.name ?? node.label
    const keeper = db.queryOne<{ id: string }>(
      "SELECT id FROM graph_nodes WHERE type = 'person' AND norm_key = ?",
      [contactKey]
    )

    if (keeper && keeper.id !== node.id) {
      // Fold this node into the existing contact-keyed node via the package's
      // mergeNodes (repoints edges, drops a colliding one after transferring
      // its graph_edge_sources rows + weight onto the survivor — AR2-1 — and
      // cleans up any resulting self-loop), then delete the loser.
      mergeNodes(store, keeper.id, node.id)
      result.merged++
    } else if (!keeper) {
      // No contact-keyed node yet — relabel this one in place. Edges reference
      // the node id (unchanged), so nothing else needs repointing.
      let props: Record<string, unknown> = {}
      if (node.props) {
        try {
          props = JSON.parse(node.props) as Record<string, unknown>
        } catch {
          props = {}
        }
      }
      props.contactId = contactId
      db.run('UPDATE graph_nodes SET norm_key = ?, label = ?, props = ?, updated_at = ? WHERE id = ?', [
        contactKey,
        canonicalLabel,
        JSON.stringify(props),
        new Date().toISOString(),
        node.id,
      ])
      result.rekeyed++
    } else {
      result.skipped++
    }
  }

  return result
}

// ---------------------------------------------------------------------------
// Context Graph — visualization + neighborhood retrieval
// ---------------------------------------------------------------------------

export interface ContextGraphNode {
  id: string
  type: string
  label: string
  degree: number
  /** Click-through target ids, present per node type. */
  contactId?: string
  meetingId?: string
  projectId?: string
}

export interface ContextGraphData {
  center: string | null
  nodes: ContextGraphNode[]
  edges: Array<{ id: string; source: string; target: string; type: string; weight: number }>
}

function parseProps(props: string | null | undefined): Record<string, unknown> {
  if (!props) return {}
  try {
    return JSON.parse(props) as Record<string, unknown>
  } catch {
    return {}
  }
}

/** Cache of lowercased project name → id, rebuilt per graph assembly (cheap). */
function projectNameIndex(): Map<string, string> {
  const rows = queryAll<{ id: string; name: string }>('SELECT id, name FROM projects')
  const m = new Map<string, string>()
  for (const r of rows) m.set((r.name || '').toLowerCase().trim(), r.id)
  return m
}

/** Enrich a raw graph node into a context DTO node with click-through ids. */
function nodeToDTO(n: GraphNode & { degree?: number }, projects: Map<string, string>): ContextGraphNode {
  const props = parseProps(n.props)
  const dto: ContextGraphNode = {
    id: n.id,
    type: n.type,
    label: n.label,
    degree: n.degree ?? 0,
  }
  if (n.type === 'person' && typeof props.contactId === 'string') dto.contactId = props.contactId
  if (n.type === 'meeting' && typeof props.meetingId === 'string') dto.meetingId = props.meetingId
  if (n.type === 'project') {
    const pid = projects.get((n.label || '').toLowerCase().trim())
    if (pid) dto.projectId = pid
  }
  return dto
}

function toDTO(sub: SubGraph): ContextGraphData {
  const projects = projectNameIndex()
  const nodes: ContextGraphNode[] = sub.nodes.map((n) => nodeToDTO(n, projects))
  const edges = sub.edges.map((e) => ({
    id: e.id,
    source: e.source_id,
    target: e.target_id,
    type: e.type,
    weight: e.weight,
  }))
  return { center: sub.center?.id ?? null, nodes, edges }
}

/**
 * The overview graph — capped to the highest-degree `limit` nodes so the initial
 * render is a digestible set of hubs, not an unreadable whole-graph hairball.
 * Defaults to {@link DEFAULT_OVERVIEW_NODE_LIMIT}; callers pass a larger cap only
 * for an explicit "show more" expansion.
 */
export function queryContextGraph(limit: number = DEFAULT_OVERVIEW_NODE_LIMIT): ContextGraphData {
  const store = getKnowledgeGraphStore()
  const exclusion = getGroundingExclusionSet(true) // ADV23-2: non-owner surface — suppress legacy zero-provenance edges
  // Fast path: nothing to suppress (healthy + empty) → original behaviour.
  if (exclusionIsNoop(exclusion)) return toDTO(fullGraph(store, limit))

  // INC-4 (round-3) — fullGraph picks the highest-degree nodes BEFORE
  // suppression, so excluded hubs would eat the slice and leave a sparse/empty
  // overview. Instead suppress on the FULL graph, then pick the top-`limit`
  // nodes by their POST-suppression (eligible) degree so the cap fills with
  // visible content.
  const full = suppressExcludedFromView(toDTO(fullGraph(store)), exclusion)
  if (full.nodes.length <= limit) return full
  const eligibleDegree = new Map<string, number>()
  for (const e of full.edges) {
    eligibleDegree.set(e.source, (eligibleDegree.get(e.source) ?? 0) + 1)
    eligibleDegree.set(e.target, (eligibleDegree.get(e.target) ?? 0) + 1)
  }
  const topNodes = [...full.nodes]
    .sort((a, b) => (eligibleDegree.get(b.id) ?? 0) - (eligibleDegree.get(a.id) ?? 0))
    .slice(0, limit)
  const keptIds = new Set(topNodes.map((n) => n.id))
  const keptEdges = full.edges.filter((e) => keptIds.has(e.source) && keptIds.has(e.target))
  return { ...full, nodes: topNodes, edges: keptEdges }
}

/**
 * One-time maintenance: prune generic "garbage" person nodes (collective/role
 * words) and their edges from the live graph. Idempotent.
 */
export function pruneGenericGraphNodes(): { removedNodes: number; removedEdges: number } {
  const store = getKnowledgeGraphStore()
  return pruneGenericNodes(store)
}

/**
 * Resolve an arbitrary entity id (graph node id, contact id, meeting id, project
 * id, or a bare name) to a graph node id, so callers can pass a domain id.
 */
export function resolveEntityToNodeId(entityId: string): string | null {
  const store = getKnowledgeGraphStore()
  const db = store.db

  // 1. Direct graph node id.
  const direct = db.queryOne<{ id: string }>('SELECT id FROM graph_nodes WHERE id = ?', [entityId])
  if (direct) return direct.id

  // 2. Person node carrying this contact id.
  const person = db.queryOne<{ id: string }>(
    "SELECT id FROM graph_nodes WHERE type = 'person' AND JSON_EXTRACT(props, '$.contactId') = ?",
    [entityId]
  )
  if (person) return person.id

  // 3. Meeting node carrying this meeting id.
  const meeting = db.queryOne<{ id: string }>(
    "SELECT id FROM graph_nodes WHERE type = 'meeting' AND JSON_EXTRACT(props, '$.meetingId') = ?",
    [entityId]
  )
  if (meeting) return meeting.id

  // 4. Project id → project name → project node (name-keyed).
  const project = queryOne<{ name: string }>('SELECT name FROM projects WHERE id = ?', [entityId])
  if (project) {
    const norm = project.name.toLowerCase().trim().replace(/\s+/g, ' ')
    const pnode = db.queryOne<{ id: string }>(
      "SELECT id FROM graph_nodes WHERE type = 'project' AND norm_key = ?",
      [norm]
    )
    if (pnode) return pnode.id
  }

  // 5. Bare name → any node whose label matches.
  const byLabel = db.queryOne<{ id: string }>('SELECT id FROM graph_nodes WHERE LOWER(label) = ?', [
    entityId.toLowerCase().trim(),
  ])
  return byLabel?.id ?? null
}

/** Neighborhood (1–3 hops) around an entity, resolved from any id form. */
export function queryNeighborhood(entityId: string, hops = 1): ContextGraphData {
  const store = getKnowledgeGraphStore()
  const nodeId = resolveEntityToNodeId(entityId)
  if (!nodeId) return { center: null, nodes: [], edges: [] }
  const exclusion = getGroundingExclusionSet(true) // ADV23-2: non-owner surface — suppress legacy zero-provenance edges
  // RE4-2 (round-4) — a centered view fails closed and never exposes an
  // excluded-only center: check center visibility BEFORE building.
  if (exclusion.failClosed || !isNodeVisibleUnderExclusion(store, nodeId, exclusion)) {
    return { center: null, nodes: [], edges: [] }
  }
  return suppressExcludedFromView(toDTO(neighborhood(store, nodeId, hops)), exclusion)
}

/** Find graph nodes whose label matches a query — powers search-to-focus. */
export function searchGraphNodes(query: string, limit = 12): ContextGraphNode[] {
  const store = getKnowledgeGraphStore()
  const q = query.trim().toLowerCase()
  if (!q) return []
  if (limit <= 0) return []
  const exclusion = getGroundingExclusionSet(true) // ADV23-2: non-owner surface — suppress legacy zero-provenance edges
  // Stable ordering across pages: LENGTH(label) then id, so OFFSET pagination
  // never revisits or skips a row (LENGTH alone is not a total order).
  const orderedQuery =
    'SELECT * FROM graph_nodes WHERE LOWER(label) LIKE ? ORDER BY LENGTH(label) ASC, id ASC LIMIT ? OFFSET ?'

  // Fast path — no exclusions active: a single ordered page of `limit` rows.
  if (exclusionIsNoop(exclusion)) {
    const rows = store.db.queryAll<GraphNode>(orderedQuery, [`%${q}%`, limit, 0])
    return toDTO({ center: undefined, nodes: rows.map((n) => ({ ...n, degree: 0 })), edges: [] }).nodes
  }

  // ADV11-MED (round-12) — express exclusion in SQL so the DB's LIMIT applies to
  // VISIBLE rows directly. Round-11 paged the ordered matches and called
  // isNodeVisibleUnderExclusion PER NODE (each firing its own incident-edge +
  // provenance queries) until `limit` visible were found — an unbounded N+1
  // synchronous main-thread scan that, under heavy/cleanup-stale exclusions,
  // could examine the whole table and freeze IPC/UI. Instead we materialize the
  // set of excluded-only node ids ONCE (a fixed, bounded number of queries — two
  // full scans, NOT one-per-node), then let SQLite skip them so a single ordered
  // page of `limit` rows is already the visible answer. No false-negative
  // truncation: a genuinely eligible node beyond the first page is still returned
  // because the DB filters before applying LIMIT.
  const hidden = computeExcludedOnlyNodeIds(store, exclusion)
  if (hidden.size === 0) {
    // Exclusions active but they suppress no NODE (e.g. only shared-source edges) —
    // the plain ordered page is already all-visible.
    const rows = store.db.queryAll<GraphNode>(orderedQuery, [`%${q}%`, limit, 0])
    return toDTO({ center: undefined, nodes: rows.map((n) => ({ ...n, degree: 0 })), edges: [] }).nodes
  }
  // ADV12-MED (round-13) — materialize the excluded-only ids in a TEMP TABLE and
  // ANTI-JOIN, instead of an `id NOT IN (?, ?, …)` list. The old build pushed
  // EVERY hidden id into one param array, so the statement's bound-variable count
  // grew with the exclusion size; better-sqlite3's MAX_VARIABLE_NUMBER is 32766,
  // so ~32.7k excluded-only nodes made the statement exceed the ceiling and graph
  // search THREW (realistic under a large excluded graph, or fail-closed
  // suppressing nearly all attributed nodes). The temp-table anti-join keeps the
  // SELECT's bound-variable count O(1) (just the LIKE pattern + LIMIT) regardless
  // of exclusion size; the inserts are batched well under the parameter ceiling.
  // LIMIT still applies to VISIBLE rows (the anti-join filters BEFORE LIMIT), so
  // there is no false-negative truncation, and the stable LENGTH(label),id
  // ordering is preserved.
  const TEMP = '_sgn_excluded_nodes'
  try {
    // Drop first in case a prior call on this (singleton, per-connection) handle
    // left the temp table behind — temp tables persist for the connection's life.
    store.db.run(`DROP TABLE IF EXISTS ${TEMP}`)
    store.db.run(`CREATE TEMP TABLE ${TEMP} (id TEXT PRIMARY KEY)`)
    const hiddenIds = [...hidden]
    // 500 bound variables per INSERT — far under the 32766 ceiling, so the
    // bound-variable count is O(1) in the batch size, not in |hidden|.
    const INSERT_CHUNK = 500
    for (let i = 0; i < hiddenIds.length; i += INSERT_CHUNK) {
      const chunk = hiddenIds.slice(i, i + INSERT_CHUNK)
      store.db.run(
        `INSERT OR IGNORE INTO ${TEMP} (id) VALUES ${chunk.map(() => '(?)').join(',')}`,
        chunk
      )
    }
    const filteredQuery =
      `SELECT n.* FROM graph_nodes n ` +
      `LEFT JOIN ${TEMP} x ON x.id = n.id ` +
      `WHERE LOWER(n.label) LIKE ? AND x.id IS NULL ` +
      `ORDER BY LENGTH(n.label) ASC, n.id ASC LIMIT ?`
    const rows = store.db.queryAll<GraphNode>(filteredQuery, [`%${q}%`, limit])
    return toDTO({ center: undefined, nodes: rows.map((n) => ({ ...n, degree: 0 })), edges: [] }).nodes
  } finally {
    // Drop so repeated searches on the singleton connection never inherit stale
    // exclusion state or collide on the fixed table name.
    store.db.run(`DROP TABLE IF EXISTS ${TEMP}`)
  }
}

/**
 * ADV11-MED (round-12) — materialize the set of EXCLUDED-ONLY graph node ids
 * (nodes with ≥1 incident edge where EVERY incident edge is provenance-
 * suppressed) using a FIXED, bounded number of queries: one full read of
 * graph_edge_sources + one full read of graph_edges, regardless of how many
 * nodes match a search. This replaces the per-node isNodeVisibleUnderExclusion
 * N+1 so a caller can push the exclusion into SQL (`id NOT IN(...)`) and keep the
 * DB's LIMIT meaningful. The visibility decision is byte-for-byte the same as
 * isNodeVisibleUnderExclusion: a node with no incident edges, or with ≥1
 * surviving (non-suppressed / legacy zero-provenance) edge, is NOT hidden.
 */
function computeExcludedOnlyNodeIds(
  store: KnowledgeGraphStore,
  exclusion: GroundingExclusion
): Set<string> {
  const hidden = new Set<string>()
  if (exclusionIsNoop(exclusion)) return hidden

  // 1. Group provenance by edge (one full scan), then decide which edges are
  //    suppressed with the SAME rule as provenanceSuppressedEdgeIds.
  const provRows = store.db.queryAll<{ edge_id: string; recording_id: string }>(
    'SELECT edge_id, recording_id FROM graph_edge_sources WHERE recording_id IS NOT NULL'
  )
  const byEdge = new Map<string, string[]>()
  for (const r of provRows) {
    const list = byEdge.get(r.edge_id)
    if (list) list.push(r.recording_id)
    else byEdge.set(r.edge_id, [r.recording_id])
  }
  const suppressedEdges = new Set<string>()
  for (const [edgeId, recIds] of byEdge) {
    // fail-closed → every attributed edge (has provenance rows) is suppressed;
    // otherwise → suppressed only when EVERY source recording is excluded.
    if (exclusion.failClosed || recIds.every((id) => exclusion.ids.has(id))) {
      suppressedEdges.add(edgeId)
    }
  }

  // 2. Per node, count incident edges vs suppressed incident edges (one full
  //    scan). A node is hidden iff it has incident edges and ALL are suppressed.
  const incident = new Map<string, number>()
  const suppressedIncident = new Map<string, number>()
  const bump = (m: Map<string, number>, k: string): void => {
    m.set(k, (m.get(k) ?? 0) + 1)
  }
  const edges = store.db.queryAll<{ id: string; source_id: string; target_id: string }>(
    'SELECT id, source_id, target_id FROM graph_edges'
  )
  for (const e of edges) {
    // ADV23-2 (round-24) — a zero-provenance edge (no graph_edge_sources rows,
    // hence absent from byEdge) is suppressed on non-owner surfaces, exactly as
    // provenanceSuppressedEdgeIds does, so an excluded-only node computed here
    // matches isNodeVisibleUnderExclusion byte-for-byte.
    const isSup =
      suppressedEdges.has(e.id) || (!!exclusion.suppressZeroProvenance && !byEdge.has(e.id))
    for (const nodeId of [e.source_id, e.target_id]) {
      bump(incident, nodeId)
      if (isSup) bump(suppressedIncident, nodeId)
    }
  }
  for (const [nodeId, count] of incident) {
    if (count > 0 && suppressedIncident.get(nodeId) === count) hidden.add(nodeId)
  }
  return hidden
}

/**
 * Find the person/project graph node whose label is named in a block of text
 * (longest label wins). Precise substring match — powers the RAG grounding hook
 * without over-triggering on stray words. Returns null when nothing is named.
 */
export function findMentionedEntity(text: string): ContextGraphNode | null {
  const haystack = ` ${text.toLowerCase()} `
  const store = getKnowledgeGraphStore()
  const rows = store.db.queryAll<GraphNode>(
    "SELECT * FROM graph_nodes WHERE type IN ('person', 'project')"
  )
  let best: GraphNode | null = null
  for (const n of rows) {
    const label = (n.label || '').trim().toLowerCase()
    if (label.length < 3) continue
    if (haystack.includes(` ${label} `) || haystack.includes(` ${label}`) || haystack.includes(`${label} `)) {
      if (!best || label.length > best.label.trim().length) best = n
    }
  }
  if (!best) return null
  return toDTO({ center: undefined, nodes: [{ ...best, degree: 0 }], edges: [] }).nodes[0]
}

/**
 * ARF-2 / P1 (round-3, fail-closed) — the excluded-recording context for graph
 * suppression. `ids` = soft-deleted OR personal OR value-excluded recordings
 * (the EXACT predicate the vector store enforces via getExcludedRecordingIds).
 * `failClosed` = the lookup THREW: the exclusion set is UNKNOWN, so every
 * recording-attributed edge must be suppressed (only legacy zero-provenance
 * edges survive) rather than defaulting to "exclude nothing" (fail-open would
 * turn a transient DB error into unrestricted retrieval).
 */
export interface GroundingExclusion {
  ids: Set<string>
  failClosed: boolean
  /**
   * ADV23-2 (round-24) — when true, ALSO suppress ZERO-PROVENANCE (legacy pre-F18)
   * edges — edges with no graph_edge_sources rows — from the surface using this
   * context. NON-OWNER Context Graph read surfaces (views / search / topic +
   * attendee + skill + profile + stats aggregates) pass `true`: a pre-F18 edge
   * cannot be proven to NOT derive from a now-excluded recording, so it is
   * suppressed (fail-closed interim until the F21 provenance rebuild restores it
   * WITH attribution). CHAT grounding (neighborhoodFacts/buildGraphContext) keeps
   * this `false` — it handles zero-provenance separately via the answer's
   * `unresolved` provenance flag (rounds 19-20), dropping the whole graph bundle
   * from the prompt rather than suppressing edges here.
   */
  suppressZeroProvenance?: boolean
}

/**
 * Compute the grounding/view exclusion context ONCE per query (the assistant
 * path in rag.ts threads it through every neighborhoodFacts call). On a lookup
 * error it FAILS CLOSED (P1): no leak of attributed content on a transient DB
 * failure.
 */
export function getGroundingExclusionSet(suppressZeroProvenance = false): GroundingExclusion {
  try {
    // ADV9 (round-9) — derive the suppression blocklist from the POSITIVE
    // eligibility allowlist over the recording ids actually referenced by graph
    // provenance, rather than from getExcludedRecordingIds (which only reads LIVE
    // recordings). A HARD-PURGED / pending-skipGraphCleanup provenance id is gone
    // from `recordings`, so it was never in the old blocklist and its residual
    // edges kept grounding. Here it is simply NOT in the allowlist → included in
    // the suppression set. Every downstream consumer (provenanceSuppressedEdgeIds,
    // node visibility, center-reachability) keeps working unchanged.
    const store = getKnowledgeGraphStore()
    const provRows = store.db.queryAll<{ recording_id: string }>(
      'SELECT DISTINCT recording_id FROM graph_edge_sources WHERE recording_id IS NOT NULL'
    )
    const provIds = provRows.map((r) => r.recording_id).filter((x): x is string => !!x)
    if (provIds.length === 0) return { ids: new Set<string>(), failClosed: false, suppressZeroProvenance }
    const { eligible, failClosed } = getEligibleRecordingIds(provIds)
    if (failClosed) return { ids: new Set<string>(), failClosed: true, suppressZeroProvenance }
    const ids = new Set<string>()
    for (const id of provIds) if (!eligible.has(id)) ids.add(id)
    return { ids, failClosed: false, suppressZeroProvenance }
  } catch (e) {
    console.error('[KnowledgeGraph] grounding exclusion lookup FAILED — failing closed (suppressing all attributed facts):', e)
    return { ids: new Set<string>(), failClosed: true, suppressZeroProvenance }
  }
}

/**
 * True when this exclusion context can suppress nothing (healthy + empty). A
 * context that suppresses zero-provenance edges (ADV23-2 non-owner surfaces) is
 * NEVER a no-op — even with an empty excluded-recording set it must still run so
 * legacy pre-F18 edges are dropped.
 */
function exclusionIsNoop(exclusion: GroundingExclusion): boolean {
  return !exclusion.failClosed && exclusion.ids.size === 0 && !exclusion.suppressZeroProvenance
}

/** Fetch graph_edge_sources for a set of edge ids, chunked to stay under the
 *  SQL bound-parameter limit (large overview edge sets). */
function edgeProvenanceRows(
  store: KnowledgeGraphStore,
  edgeIds: string[]
): Array<{ edge_id: string; recording_id: string }> {
  const out: Array<{ edge_id: string; recording_id: string }> = []
  const CHUNK = 400
  for (let i = 0; i < edgeIds.length; i += CHUNK) {
    const chunk = edgeIds.slice(i, i + CHUNK)
    const placeholders = chunk.map(() => '?').join(',')
    out.push(
      ...store.db.queryAll<{ edge_id: string; recording_id: string }>(
        `SELECT edge_id, recording_id FROM graph_edge_sources WHERE edge_id IN (${placeholders})`,
        chunk
      )
    )
  }
  return out
}

/**
 * ARF-2 / P1 — given candidate graph edge ids, return the subset to SUPPRESS.
 * An edge with NO provenance rows (legacy pre-F18) or with ≥1 source from an
 * eligible recording is KEPT. In fail-closed mode EVERY provenance-attributed
 * edge is suppressed (the exclusion set is unknown); if the provenance read
 * ITSELF throws in fail-closed mode, every candidate edge is suppressed (we
 * cannot prove any edge eligible).
 */
function provenanceSuppressedEdgeIds(
  store: KnowledgeGraphStore,
  edgeIds: string[],
  exclusion: GroundingExclusion
): Set<string> {
  const suppressed = new Set<string>()
  if (edgeIds.length === 0 || exclusionIsNoop(exclusion)) return suppressed

  let rows: Array<{ edge_id: string; recording_id: string }>
  try {
    rows = edgeProvenanceRows(store, edgeIds)
  } catch (e) {
    if (exclusion.failClosed) {
      // Can't even read provenance while already failing closed — suppress
      // every candidate edge (safe: no attributed content can leak).
      console.error('[KnowledgeGraph] provenance read failed while fail-closed — suppressing all candidate edges:', e)
      return new Set(edgeIds)
    }
    throw e
  }

  const byEdge = new Map<string, string[]>()
  for (const r of rows) {
    const list = byEdge.get(r.edge_id)
    if (list) list.push(r.recording_id)
    else byEdge.set(r.edge_id, [r.recording_id])
  }
  // Iterate the CANDIDATE edges (not just the attributed ones) so a zero-provenance
  // legacy edge can be suppressed on non-owner surfaces (ADV23-2).
  for (const edgeId of edgeIds) {
    const recIds = byEdge.get(edgeId)
    if (!recIds || recIds.length === 0) {
      // Zero-provenance legacy edge (no graph_edge_sources rows). ADV23-2
      // (round-24): suppressed on non-owner surfaces (suppressZeroProvenance);
      // kept for chat grounding (handled via the answer's unresolved flag).
      if (exclusion.suppressZeroProvenance) suppressed.add(edgeId)
      continue
    }
    // fail-closed → any attributed edge (it has provenance rows) is suppressed;
    // otherwise → suppressed only when EVERY source is excluded.
    if (exclusion.failClosed || recIds.every((id) => exclusion.ids.has(id))) {
      suppressed.add(edgeId)
    }
  }
  return suppressed
}

/**
 * P3 (round-3) — is a graph node visible under the current exclusion? A node is
 * HIDDEN only when it has ≥1 incident edge AND every incident edge is
 * provenance-suppressed (an "excluded-only" node). A node with no incident
 * edges (isolated / not recording-tied) or with ≥1 eligible edge is visible.
 * Used by the inspector/search read paths (searchGraphNodes, queryProvenance,
 * getNodeDetail, default-center) so they never expose an excluded-only node.
 */
function isNodeVisibleUnderExclusion(
  store: KnowledgeGraphStore,
  nodeId: string,
  exclusion: GroundingExclusion
): boolean {
  if (exclusionIsNoop(exclusion)) return true
  const incident = store.db.queryAll<{ id: string }>(
    'SELECT id FROM graph_edges WHERE source_id = ? OR target_id = ?',
    [nodeId, nodeId]
  )
  if (incident.length === 0) return true // isolated — not recording-attributed
  const suppressed = provenanceSuppressedEdgeIds(store, incident.map((e) => e.id), exclusion)
  return suppressed.size < incident.length // ≥1 edge survived ⇒ visible
}

/**
 * RE4-1 (round-4) — the set of nodes REACHABLE from `centerId` within `hops`
 * traversing ONLY surviving (non-suppressed) edges. Stricter than
 * isNodeVisibleUnderExclusion: a node with eligible edges ELSEWHERE but reachable
 * from this center only via an excluded edge is NOT in the set. Used to derive a
 * centered provenance/subgraph solely from survivors.
 */
function centerReachableSurvivorIds(
  store: KnowledgeGraphStore,
  centerId: string,
  hops: number,
  exclusion: GroundingExclusion
): Set<string> {
  const sub = neighborhood(store, centerId, hops)
  const suppressed = provenanceSuppressedEdgeIds(store, sub.edges.map((e) => e.id), exclusion)
  const adj = new Map<string, Set<string>>()
  const link = (a: string, b: string): void => {
    let s = adj.get(a)
    if (!s) { s = new Set(); adj.set(a, s) }
    s.add(b)
  }
  for (const e of sub.edges) {
    if (suppressed.has(e.id)) continue
    link(e.source_id, e.target_id)
    link(e.target_id, e.source_id)
  }
  const reachable = new Set<string>([centerId])
  const queue = [centerId]
  while (queue.length) {
    const cur = queue.shift() as string
    for (const nb of adj.get(cur) ?? []) {
      if (!reachable.has(nb)) {
        reachable.add(nb)
        queue.push(nb)
      }
    }
  }
  return reachable
}

/**
 * RE-4 (Codex adversarial re-review round 2) — apply the SAME provenance-aware
 * suppression used for assistant grounding to a Context Graph VIEW DTO (nodes +
 * edges): drop every edge whose provenance is entirely excluded (post-F18
 * attributed excluded recording), then prune any node ORPHANED by that removal
 * (it had incident edges, all now suppressed). The center node and nodes still
 * incident to a kept edge, and isolated nodes not touched by the removal, are
 * kept. Legacy ZERO-provenance edges are never suppressed (RE-3 ruling), so
 * pre-F18 content persists in views until a future full graph rebuild.
 * Generic over ContextGraphData / ContextLensData — extra fields (weight,
 * stratum, strata, referenceMs) pass through untouched.
 */
function suppressExcludedFromView<
  T extends {
    center: string | null
    nodes: Array<{ id: string }>
    edges: Array<{ id: string; source: string; target: string }>
  }
>(data: T, exclusion: GroundingExclusion): T {
  if (exclusionIsNoop(exclusion) || data.edges.length === 0) return data
  const suppressed = provenanceSuppressedEdgeIds(
    getKnowledgeGraphStore(),
    data.edges.map((e) => e.id),
    exclusion
  )
  if (suppressed.size === 0) return data

  const keptEdges = data.edges.filter((e) => !suppressed.has(e.id))
  const incidentToKept = new Set<string>()
  for (const e of keptEdges) {
    incidentToKept.add(e.source)
    incidentToKept.add(e.target)
  }
  const incidentToSuppressed = new Set<string>()
  for (const e of data.edges) {
    if (suppressed.has(e.id)) {
      incidentToSuppressed.add(e.source)
      incidentToSuppressed.add(e.target)
    }
  }
  const keptNodes = data.nodes.filter((n) => {
    // RE4-2 (round-4) — the center is NOT exempt from pruning. Centered callers
    // (queryNeighborhood/queryLens) pre-check center visibility and bail EMPTY
    // for an excluded-only / fail-closed center BEFORE building, so a surviving
    // center always retains ≥1 eligible incident edge here and is kept via
    // incidentToKept below; an excluded-only center is never allowed to reach
    // this function.
    if (incidentToKept.has(n.id)) return true // still connected
    // Orphaned strictly BY the removal (was only on suppressed edges) → prune.
    if (incidentToSuppressed.has(n.id)) return false
    return true // isolated node untouched by the removal → keep
  })
  return { ...data, nodes: keptNodes, edges: keptEdges }
}

/**
 * ADV18-2 (round-19) — provenance sink for graph grounding. When passed to
 * {@link neighborhoodFacts}, it accumulates the authoritative recording ids that
 * back the EMITTED fact edges (from graph_edge_sources), across every call, so
 * the RAG service can fold graph provenance into the persisted answer's union.
 * `unresolved` is set if a provenance read THREW (⇒ the answer's provenance is
 * unverifiable ⇒ fail-closed redaction on later re-read). Legacy zero-provenance
 * fact edges contribute NO recording id and do NOT set `unresolved` — they are an
 * accepted residual (RE-3 ruling: pre-F18 content can't be retracted per-record).
 */
export interface NeighborhoodFactProvenance {
  recordingIds: Set<string>
  unresolved: boolean
}

/**
 * Compact, human-readable facts about an entity's neighborhood — one line per
 * connected entity. Used to ground the assistant/RAG with graph context.
 * Returns '' when nothing is found (caller appends nothing).
 *
 * ARF-2 (Codex adversarial FINAL review, BINDING) — provenance-aware: a fact
 * (edge) is SUPPRESSED when EVERY graph_edge_sources row backing it belongs to
 * an excluded recording (soft-deleted / personal / value-excluded), so the
 * assistant is never grounded on content the UI promises is "excluded from all
 * AI processing / the Context Graph". Facts with NO provenance rows (legacy
 * pre-F18 content) or with ≥1 eligible source remain — matching the honest
 * scope of the deletion copy (legacy graph content may still appear in Context
 * Graph VIEWS until a hard purge; the assistant grounding filtered here is what
 * the promise covers for post-F18 content). `excluded` is computed once per
 * query by the caller (rag.ts) and threaded in; it defaults to a fresh read so
 * this function stays independently correct + testable.
 *
 * ADV18-2 (round-19) — when `provOut` is supplied, the recording ids backing the
 * EMITTED fact edges are collected into it so the answer's persisted provenance
 * union covers graph facts, not just vector snippets.
 */
export function neighborhoodFacts(
  entityId: string,
  hops = 1,
  maxFacts = 20,
  exclusion: GroundingExclusion = getGroundingExclusionSet(),
  provOut?: NeighborhoodFactProvenance
): string {
  // Build the RAW neighborhood directly — NOT via queryNeighborhood, which
  // (RE4-2, round-4) empties a centered VIEW on an excluded-only / fail-closed
  // center. GROUNDING has a different fail-closed policy (round-3 P1): suppress
  // attributed edges but KEEP legacy zero-provenance facts so the assistant is
  // not gutted on a transient DB error. The edge suppression below enforces it.
  const store = getKnowledgeGraphStore()
  const nodeId = resolveEntityToNodeId(entityId)
  if (!nodeId) return ''
  const data = toDTO(neighborhood(store, nodeId, hops))
  if (!data.center || data.nodes.length <= 1) return ''

  const byId = new Map(data.nodes.map((n) => [n.id, n]))
  const center = byId.get(data.center)
  if (!center) return ''

  const suppressed = provenanceSuppressedEdgeIds(
    getKnowledgeGraphStore(),
    data.edges.map((e) => e.id),
    exclusion
  )

  const lines: string[] = []
  const emittedEdgeIds: string[] = []
  for (const e of data.edges) {
    if (lines.length >= maxFacts) break
    if (suppressed.has(e.id)) continue // ARF-2 — fully-excluded provenance
    const src = byId.get(e.source)
    const tgt = byId.get(e.target)
    if (!src || !tgt) continue
    if (src.id !== center.id && tgt.id !== center.id) continue
    const rel = e.type.toLowerCase().replace(/_/g, ' ')
    lines.push(`- ${src.label} ${rel} ${tgt.label}`)
    if (provOut) emittedEdgeIds.push(e.id)
  }
  if (lines.length === 0) return ''

  // ADV18-2 — record the authoritative recording ids behind the EMITTED facts so
  // the persisted answer can be redacted if any of them is later excluded.
  // ADV19-3 (round-20) — a legacy edge with NO graph_edge_sources rows is
  // UNVERIFIABLE for CHAT grounding: we cannot prove it wasn't derived from a
  // now-excluded recording, so an answer grounded (even partly) on it must fail
  // closed on re-read. Mark the answer's provenance union `unresolved` whenever
  // ANY emitted fact edge lacks provenance rows. This is scoped to the CHAT
  // provenance sink (provOut) only — graph VIEWS keep the legacy caveat (RE-3
  // ruling) and never pass a provOut, so their behaviour is unchanged.
  if (provOut && emittedEdgeIds.length) {
    try {
      const attributedEdges = new Set<string>()
      for (const r of edgeProvenanceRows(store, emittedEdgeIds)) {
        attributedEdges.add(r.edge_id)
        if (r.recording_id) provOut.recordingIds.add(r.recording_id)
      }
      for (const edgeId of emittedEdgeIds) {
        if (!attributedEdges.has(edgeId)) {
          provOut.unresolved = true // zero-provenance legacy fact ⇒ unverifiable for chat
          break
        }
      }
    } catch (e) {
      provOut.unresolved = true
      console.error('[KnowledgeGraph] fact provenance read failed — marking answer provenance unverifiable:', e)
    }
  }

  return `Context graph — ${center.label} (${center.type}):\n${lines.join('\n')}`
}

// ---------------------------------------------------------------------------
// Context Lens — stratified, time-aware perspective + provenance
// ---------------------------------------------------------------------------

export interface ContextLensNode extends ContextGraphNode {
  /** Abstraction band: strategic | operational | people | evidence. */
  stratum: string
  /** Effective recency (epoch ms) for time ordering + age decay, or null. */
  dateMs: number | null
}

/** Per-stratum totals-in-scope vs. shown after the lens node budget. */
export interface ContextLensStratumCount {
  stratum: string
  total: number
  shown: number
}

export interface ContextLensData {
  center: string | null
  nodes: ContextLensNode[]
  edges: Array<{ id: string; source: string; target: string; type: string; weight: number }>
  /** Newest activity in the lens — the reference the time chips measure back from. */
  referenceMs: number | null
  /** Per-stratum totals-vs-shown — drives the "20 of 214" truncation affordance. */
  strata: ContextLensStratumCount[]
}

/** A one-line entity descriptor for the lens center / provenance nodes. */
export interface LensCenter {
  id: string
  type: string
  label: string
  contactId?: string
  meetingId?: string
  projectId?: string
}

export interface ProvenanceDTO {
  node: (LensCenter & { dateMs: number | null }) | null
  meetings: Array<LensCenter & { dateMs: number | null }>
  people: Array<LensCenter & { dateMs: number | null }>
  projects: Array<LensCenter & { dateMs: number | null }>
  actions: Array<LensCenter & { dateMs: number | null }>
  pathIds: string[]
  narrative: string
  dateMs: number | null
}

function toLensDTO(lens: LensGraph): ContextLensData {
  const projects = projectNameIndex()
  const nodes: ContextLensNode[] = lens.nodes.map((n) => ({
    ...nodeToDTO(n, projects),
    stratum: n.stratum,
    dateMs: n.dateMs,
  }))
  const edges = lens.edges.map((e) => ({
    id: e.id,
    source: e.source_id,
    target: e.target_id,
    type: e.type,
    weight: e.weight,
  }))
  const strata: ContextLensStratumCount[] = lens.strata.map((s) => ({
    stratum: s.stratum,
    total: s.total,
    shown: s.shown,
  }))
  return { center: lens.center?.id ?? null, nodes, edges, referenceMs: lens.referenceMs, strata }
}

/**
 * A stratified, time-aware lens. `centerEntityId` accepts any id form (graph
 * node id, contact id, meeting id, project id, or bare name); null builds a
 * whole-graph lens capped to the highest-degree hubs. `windowDays` filters to
 * recent activity (null = All).
 */
export function queryLens(
  centerEntityId: string | null,
  opts: { hops?: number; cap?: number; windowDays?: number | null } = {}
): ContextLensData {
  const store = getKnowledgeGraphStore()
  const emptyLens: ContextLensData = { center: null, nodes: [], edges: [], referenceMs: null, strata: [] }
  const exclusion = getGroundingExclusionSet(true) // ADV23-2: non-owner surface — suppress legacy zero-provenance edges
  let centerNodeId: string | null = null
  if (centerEntityId) {
    centerNodeId = resolveEntityToNodeId(centerEntityId)
    if (!centerNodeId) return emptyLens
    // RE4-2 (round-4) — a CENTERED lens fails closed and never exposes an
    // excluded-only center. (A null-center whole-graph lens is not "centered";
    // it falls through to suppressExcludedFromView, which under fail-closed
    // suppresses attributed edges and keeps only legacy, like the overview.)
    if (exclusion.failClosed || !isNodeVisibleUnderExclusion(store, centerNodeId, exclusion)) {
      return emptyLens
    }
  }
  const filtered = suppressExcludedFromView(toLensDTO(lensGraph(store, centerNodeId, opts)), exclusion)
  // INC5 (round-5) — decide center retention from the POST-FILTER survivor
  // graph: the lens's windowDays / stratum node budget can drop the center's
  // ONLY eligible edge while an excluded one remains, so suppression then prunes
  // the center yet the DTO still points `center` at the now-missing node id
  // (a blank, mislabelled lens). If the center did not survive, empty out.
  if (centerNodeId && !filtered.nodes.some((n) => n.id === filtered.center)) {
    return emptyLens
  }
  return filtered
}

/**
 * The default lens center — the app owner's person node when known, else the
 * highest-degree person (the natural ego of the user's own context). Returns
 * null when the graph has no people yet.
 */
export function pickLensCenter(ownerContactId?: string | null): LensCenter | null {
  const store = getKnowledgeGraphStore()
  const node = pickDefaultCenter(store, ownerContactId ?? undefined)
  if (!node) return null
  // P3 (round-3) — never default-center an excluded-only node; fall back to
  // null so the caller builds the (already-suppressed) whole-graph lens.
  // ADV23-2 — non-owner surface: legacy zero-provenance nodes are excluded-only.
  if (!isNodeVisibleUnderExclusion(store, node.id, getGroundingExclusionSet(true))) return null
  const projects = projectNameIndex()
  const dto = nodeToDTO({ ...node, degree: 0 }, projects)
  return { id: dto.id, type: dto.type, label: dto.label, contactId: dto.contactId }
}

/**
 * Provenance for an entity: the meeting(s) it emerged from, people present, the
 * project it belongs to, downstream actions, and a one-line narrative. Accepts
 * any id form. Returns an empty provenance when the entity is unknown.
 */
export function queryProvenance(entityId: string): ProvenanceDTO {
  const store = getKnowledgeGraphStore()
  const nodeId = resolveEntityToNodeId(entityId)
  const empty: ProvenanceDTO = {
    node: null,
    meetings: [],
    people: [],
    projects: [],
    actions: [],
    pathIds: [],
    narrative: '',
    dateMs: null,
  }
  if (!nodeId) return empty
  const exclusion = getGroundingExclusionSet(true) // ADV23-2: non-owner surface — suppress legacy zero-provenance edges
  // RE4-2 — centered read: fail closed, and never expose an excluded-only center.
  if (exclusion.failClosed || !isNodeVisibleUnderExclusion(store, nodeId, exclusion)) return empty

  const prov: Provenance = provenance(store, nodeId)
  const projects = projectNameIndex()
  const mapEntity = (e: {
    id: string
    type: string
    label: string
    dateMs: number | null
  }): LensCenter & { dateMs: number | null } => {
    // Reuse click-through enrichment by looking up the full node for ids.
    const full = store.getNode(e.id)
    const base = full ? nodeToDTO({ ...full, degree: 0 }, projects) : { id: e.id, type: e.type, label: e.label, degree: 0 }
    return {
      id: base.id,
      type: base.type,
      label: base.label,
      contactId: base.contactId,
      meetingId: base.meetingId,
      projectId: base.projectId,
      dateMs: e.dateMs,
    }
  }

  // RE4-1 (round-4) — the round-3 residual (pathIds + narrative + dateMs came
  // from the UNFILTERED graph) leaked excluded NAMES via the label-derived
  // type:slug node ids and the narrative. Derive EVERYTHING solely from
  // survivors: keep only entities REACHABLE from the center via non-suppressed
  // edges (a node reachable only via an excluded edge is dropped even if it has
  // eligible edges elsewhere). pathIds rebuilt from survivors; narrative dropped
  // when anything was suppressed (it embeds excluded labels); dateMs recomputed
  // from the newest SURVIVING meeting.
  const survivors = exclusionIsNoop(exclusion)
    ? null // fast path — no suppression, keep the package result verbatim
    : centerReachableSurvivorIds(store, nodeId, 2, exclusion)
  const keep = (e: { id: string }): boolean => survivors === null || survivors.has(e.id)

  const meetings = prov.meetings.filter(keep)
  const people = prov.people.filter(keep)
  const projectsArr = prov.projects.filter(keep)
  const actions = prov.actions.filter(keep)
  const suppressedAny =
    survivors !== null &&
    (meetings.length !== prov.meetings.length ||
      people.length !== prov.people.length ||
      projectsArr.length !== prov.projects.length ||
      actions.length !== prov.actions.length)

  const pathIds =
    survivors === null
      ? prov.pathIds
      : [...new Set([nodeId, ...meetings, ...people, ...projectsArr, ...actions].map((x) => (typeof x === 'string' ? x : x.id)))]
  // Package sorts meetings newest-first; the newest SURVIVING meeting drives dateMs.
  const dateMs = survivors === null ? prov.dateMs : (meetings[0]?.dateMs ?? prov.node?.dateMs ?? null)
  const narrative = suppressedAny ? '' : prov.narrative

  return {
    node: prov.node ? mapEntity(prov.node) : null,
    meetings: meetings.map(mapEntity),
    people: people.map(mapEntity),
    projects: projectsArr.map(mapEntity),
    actions: actions.map(mapEntity),
    pathIds,
    narrative,
    dateMs,
  }
}

// ===========================================================================
// Node editing — rename-as-correction, convert/link to a contact, merge, remove
//
// The Context Graph's editing affordances. Graph surgery is delegated to the
// package's mutations; identity policy (routing a linked-person rename through
// the contact record, binding at the resolver's sovereign 'manual' tier, reusing
// the contacts merge journal) lives HERE and reuses the existing identity
// platform (entity-resolver / contact aliases / contacts merge) rather than
// duplicating it.
// ===========================================================================

/** The contact id a person node is bound to: explicit prop, or its `contact:<id>` key. */
function contactIdOfNode(node: GraphNode): string | null {
  const props = parseProps(node.props)
  if (typeof props.contactId === 'string' && props.contactId) return props.contactId
  if (node.type === 'person' && node.norm_key.startsWith('contact:')) {
    return node.norm_key.slice('contact:'.length)
  }
  return null
}

/** Detail DTO for the node inspector — what a bare label cannot show. */
export interface NodeDetailDTO {
  node: LensCenter | null
  /** True when this person node is bound to a real, saved contact. */
  linked: boolean
  contactId: string | null
  /** Preferred pronouns (from the node's props), when set. */
  pronouns: string | null
  role: string | null
  company: string | null
  email: string | null
  meetingCount: number
  firstSeenMs: number | null
  lastSeenMs: number | null
  peopleCount: number
  projectCount: number
  degree: number
  /** Known spellings folded onto this identity (contact aliases). */
  aliases: string[]
  /** One-line provenance narrative — where this entity comes from. */
  narrative: string
}

/**
 * Everything the inspector needs to answer "what IS this node?": identity
 * (linked contact vs. raw extracted name), the contact's role/org/email + known
 * aliases when linked, pronouns, graph-derived stats (meetings, first/last seen,
 * neighborhood), and the provenance narrative. Accepts any id form.
 */
export function getNodeDetail(entityId: string): NodeDetailDTO {
  const store = getKnowledgeGraphStore()
  const empty: NodeDetailDTO = {
    node: null,
    linked: false,
    contactId: null,
    pronouns: null,
    role: null,
    company: null,
    email: null,
    meetingCount: 0,
    firstSeenMs: null,
    lastSeenMs: null,
    peopleCount: 0,
    projectCount: 0,
    degree: 0,
    aliases: [],
    narrative: '',
  }
  const nodeId = resolveEntityToNodeId(entityId)
  if (!nodeId) return empty
  const node = store.getNode(nodeId)
  if (!node) return empty
  // P3 (round-3) — the inspector must not expose an excluded-only node.
  // ADV23-2 — non-owner surface: legacy zero-provenance nodes are excluded-only.
  if (!isNodeVisibleUnderExclusion(store, nodeId, getGroundingExclusionSet(true))) return empty

  const projects = projectNameIndex()
  const dto = nodeToDTO({ ...node, degree: 0 }, projects)
  const props = parseProps(node.props)
  const pronouns = typeof props.pronouns === 'string' && props.pronouns ? props.pronouns : null

  const contactId = contactIdOfNode(node)
  let role: string | null = null
  let company: string | null = null
  let email: string | null = null
  let aliases: string[] = []
  const linked = node.type === 'person' && !!contactId
  if (contactId) {
    const contact = getContactById(contactId)
    if (contact) {
      role = contact.role
      company = contact.company
      email = contact.email
      dto.contactId = contactId
    }
    try {
      aliases = getContactAliases(contactId)
        .filter((a) => a.source !== 'rejected')
        .map((a) => a.alias)
    } catch {
      aliases = []
    }
  }

  const stats = nodeGraphStats(store, nodeId)
  let narrative = ''
  try {
    narrative = provenance(store, nodeId).narrative
  } catch {
    narrative = ''
  }

  return {
    node: { id: dto.id, type: dto.type, label: dto.label, contactId: dto.contactId, meetingId: dto.meetingId, projectId: dto.projectId },
    linked,
    contactId: contactId ?? null,
    pronouns,
    role,
    company,
    email,
    meetingCount: stats.meetingCount,
    firstSeenMs: stats.firstSeenMs,
    lastSeenMs: stats.lastSeenMs,
    peopleCount: stats.peopleCount,
    projectCount: stats.projectCount,
    degree: stats.degree,
    aliases,
    narrative,
  }
}

export interface RenameEntityResult {
  outcome: 'noop' | 'renamed' | 'merged'
  /** 'contact' when the rename propagated through the contact record app-wide;
   *  'graph' when it was a graph-only correction of a name-only node. */
  scope: 'contact' | 'graph'
  nodeId: string | null
}

/**
 * Correct an entity's name (Jiarabi → Yaraví). NOT an alias — a canonical rename.
 * A linked person is renamed through its CONTACT record (updateContact + the
 * entity:contact-changed event), so the correction propagates everywhere the app
 * uses that contact. A name-only node is corrected directly in the graph (rename,
 * or fold into an existing node already under the correct spelling).
 */
export function renameGraphEntity(entityId: string, newLabel: string): RenameEntityResult {
  const store = getKnowledgeGraphStore()
  const label = (newLabel || '').trim()
  const nodeId = resolveEntityToNodeId(entityId)
  if (!nodeId || !label) return { outcome: 'noop', scope: 'graph', nodeId: nodeId ?? null }
  const node = store.getNode(nodeId)
  if (!node) return { outcome: 'noop', scope: 'graph', nodeId: null }

  const contactId = contactIdOfNode(node)
  if (node.type === 'person' && contactId) {
    const contact = getContactById(contactId)
    if (contact) {
      const oldName = contact.name
      if (normalizeGraphLabel(oldName) === normalizeGraphLabel(label)) {
        return { outcome: 'noop', scope: 'contact', nodeId }
      }
      updateContact(contactId, { name: label })
      // The contact-keyed graph node's label is display-only (its key stays
      // contact:<id>); refresh it in place so the graph shows the correction now.
      run('UPDATE graph_nodes SET label = ?, updated_at = ? WHERE id = ?', [
        label,
        new Date().toISOString(),
        nodeId,
      ])
      try {
        getEventBus().emitDomainEvent({
          type: 'entity:contact-changed',
          timestamp: new Date().toISOString(),
          payload: { contactId, change: 'updated', oldName, newName: label },
        })
      } catch (e) {
        console.warn('[knowledge-graph] rename contact-changed emit failed:', e)
      }
      return { outcome: 'renamed', scope: 'contact', nodeId }
    }
  }

  const res = renameNode(store, nodeId, label)
  return { outcome: res.outcome, scope: 'graph', nodeId: res.nodeId }
}

/** normalizeName lives app-side; a local copy matching the graph key rule. */
function normalizeGraphLabel(label: string): string {
  return (label || '').toLowerCase().trim().replace(/\s+/g, ' ')
}

/**
 * Bind a graph node to a contact at the resolver's sovereign 'manual' tier: write
 * a manual alias (so future extractions of this spelling resolve to the contact)
 * and re-key the node onto the contact identity — folding it into an existing
 * contact-keyed node when one already exists.
 */
function bindNodeToContact(nodeId: string, contactId: string): { outcome: 'linked' | 'merged'; nodeId: string } {
  const store = getKnowledgeGraphStore()
  const node = store.getNode(nodeId)
  if (!node) return { outcome: 'linked', nodeId }
  const canonicalName = getContactById(contactId)?.name ?? node.label

  // Sovereign manual bind so the resolver links this spelling from now on.
  try {
    upsertContactAlias(contactId, node.label, 'manual', 1.0)
  } catch (e) {
    console.warn('[knowledge-graph] manual alias write failed:', e)
  }

  const contactKey = `contact:${contactId}`
  const keeper = queryOne<{ id: string }>(
    "SELECT id FROM graph_nodes WHERE type = 'person' AND norm_key = ?",
    [contactKey]
  )
  const now = new Date().toISOString()

  if (keeper && keeper.id !== nodeId) {
    mergeNodes(store, keeper.id, nodeId)
    run('UPDATE graph_nodes SET label = ?, updated_at = ? WHERE id = ?', [canonicalName, now, keeper.id])
    setNodeProps(store, keeper.id, { contactId })
    return { outcome: 'merged', nodeId: keeper.id }
  }

  run('UPDATE graph_nodes SET norm_key = ?, label = ?, updated_at = ? WHERE id = ?', [
    contactKey,
    canonicalName,
    now,
    nodeId,
  ])
  setNodeProps(store, nodeId, { contactId })
  return { outcome: 'linked', nodeId }
}

export interface LinkContactResult {
  contactId: string
  outcome: 'linked' | 'merged'
  nodeId: string
  /** True when an existing contact was reused instead of a new one being created. */
  reusedExisting?: boolean
}

/**
 * "This node IS person X." Bind an extracted person node to an existing contact
 * (manual/sovereign tier). Reuses the contacts identity platform — no new store.
 */
export function linkNodeToContact(entityId: string, contactId: string): LinkContactResult {
  const nodeId = resolveEntityToNodeId(entityId)
  if (!nodeId) throw new Error('Node not found')
  const contact = getContactById(contactId)
  if (!contact) throw new Error('Contact not found')
  const r = bindNodeToContact(nodeId, contactId)
  return { contactId, outcome: r.outcome, nodeId: r.nodeId }
}

/**
 * Convert a name-only person node into a real contact: create the contact (or
 * reuse an exact-name match), then bind the node at the sovereign manual tier.
 * This is the fix for "there is no contact behind Jiarabi today."
 */
export function convertNodeToContact(
  entityId: string,
  opts?: { role?: string | null; company?: string | null; email?: string | null }
): LinkContactResult {
  const store = getKnowledgeGraphStore()
  const nodeId = resolveEntityToNodeId(entityId)
  if (!nodeId) throw new Error('Node not found')
  const node = store.getNode(nodeId)
  if (!node) throw new Error('Node not found')
  if (node.type !== 'person') throw new Error('Only person nodes can become contacts')

  const existingContactId = contactIdOfNode(node)
  if (existingContactId && getContactById(existingContactId)) {
    // Already a contact — nothing to create; treat as a no-op link.
    return { contactId: existingContactId, outcome: 'linked', nodeId, reusedExisting: true }
  }

  // Reuse an exact-name contact rather than minting a twin.
  const existing = getContactByName(node.label)
  if (existing) {
    const r = bindNodeToContact(nodeId, existing.id)
    return { contactId: existing.id, outcome: r.outcome, nodeId: r.nodeId, reusedExisting: true }
  }

  // contacts.type is CHECK-constrained: team|candidate|customer|external|unknown.
  // An extracted person is an 'external' contact.
  const contact = createContact({
    name: node.label,
    type: 'external',
    role: opts?.role ?? null,
    company: opts?.company ?? null,
    email: opts?.email ?? null,
  })
  const r = bindNodeToContact(nodeId, contact.id)
  return { contactId: contact.id, outcome: r.outcome, nodeId: r.nodeId, reusedExisting: false }
}

/** Set (or clear, with '') a person node's pronouns. Stored on the node props. */
export function setNodePronouns(entityId: string, pronouns: string): boolean {
  const store = getKnowledgeGraphStore()
  const nodeId = resolveEntityToNodeId(entityId)
  if (!nodeId) return false
  const value = (pronouns || '').trim()
  return setNodeProps(store, nodeId, { pronouns: value ? value : null })
}

export interface MergePreviewDTO {
  a: { id: string; label: string; type: string; edges: number } | null
  b: { id: string; label: string; type: string; edges: number } | null
  shared: number
  resulting: number
  /** True when BOTH nodes are linked contacts — the merge folds contacts (undoable). */
  contactMerge: boolean
  /** Contact link counts for a contact-merge, so the UI can gate a heavy merge. */
  contactImpact?: { keeper: number; loser: number }
}

/** Preview merging two nodes: the blast radius (what collapses) BEFORE committing. */
export function mergeGraphPreview(keeperEntityId: string, loserEntityId: string): MergePreviewDTO {
  const store = getKnowledgeGraphStore()
  const keeperId = resolveEntityToNodeId(keeperEntityId)
  const loserId = resolveEntityToNodeId(loserEntityId)
  if (!keeperId || !loserId) {
    return { a: null, b: null, shared: 0, resulting: 0, contactMerge: false }
  }
  const blast = mergeBlastRadius(store, keeperId, loserId)
  const keeperNode = store.getNode(keeperId)
  const loserNode = store.getNode(loserId)
  const keeperContact = keeperNode ? contactIdOfNode(keeperNode) : null
  const loserContact = loserNode ? contactIdOfNode(loserNode) : null
  const contactMerge = !!keeperContact && !!loserContact && keeperContact !== loserContact
  let contactImpact: { keeper: number; loser: number } | undefined
  if (contactMerge && keeperContact && loserContact) {
    try {
      contactImpact = getMergeImpact('contact', keeperContact, loserContact)
    } catch {
      contactImpact = undefined
    }
  }
  return { a: blast.a, b: blast.b, shared: blast.shared, resulting: blast.resulting, contactMerge, contactImpact }
}

export interface MergeNodesResultDTO {
  keeperId: string
  movedEdges: number
  /** 'contact' when the underlying contacts were merged (journaled, undoable);
   *  'graph' when only the graph nodes were folded. */
  path: 'contact' | 'graph'
}

/**
 * Merge the LOSER node into the KEEPER. When both are linked contacts, the
 * contacts are merged through the existing journaled contacts flow (undoable),
 * then their graph nodes are folded. Otherwise the graph nodes are folded directly.
 */
export function mergeGraphNodes(keeperEntityId: string, loserEntityId: string): MergeNodesResultDTO {
  const store = getKnowledgeGraphStore()
  const keeperId = resolveEntityToNodeId(keeperEntityId)
  const loserId = resolveEntityToNodeId(loserEntityId)
  if (!keeperId || !loserId) throw new Error('Node not found')
  if (keeperId === loserId) throw new Error('Cannot merge a node into itself')

  const keeperNode = store.getNode(keeperId)
  const loserNode = store.getNode(loserId)
  const keeperContact = keeperNode ? contactIdOfNode(keeperNode) : null
  const loserContact = loserNode ? contactIdOfNode(loserNode) : null

  if (keeperContact && loserContact && keeperContact !== loserContact) {
    // Real, journaled contacts merge (undoable) — then fold the graph nodes.
    mergeContacts(keeperContact, loserContact)
    const r = mergeNodes(store, keeperId, loserId)
    return { keeperId: r.keeperId, movedEdges: r.movedEdges, path: 'contact' }
  }

  const r = mergeNodes(store, keeperId, loserId)
  return { keeperId: r.keeperId, movedEdges: r.movedEdges, path: 'graph' }
}

/** Remove a junk node from the graph (and its edges). Idempotent. */
export function deleteGraphNode(entityId: string): { removed: boolean; removedEdges: number } {
  const store = getKnowledgeGraphStore()
  const nodeId = resolveEntityToNodeId(entityId)
  if (!nodeId) return { removed: false, removedEdges: 0 }
  return deleteNode(store, nodeId)
}
