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
  ownDateMs,
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
  GraphNode,
  SubGraph,
  LensGraph,
  Provenance,
  NodeGraphStats,
} from '@hidock/knowledge-graph'
import { complete } from '@hidock/ai-providers'
import {
  run,
  runInTransaction,
  queryAll,
  queryOne,
  getValueExcludedRecordingIds,
  getEligibleRecordingIds,
  getRecordingsForMeeting,
  isRecordingGraphIngestable,
  getContactById,
  blankIneligibleContactFields,
  filterVisibleEntityIds,
  getContactByName,
  createContact,
  updateContact,
  upsertContactAlias,
  getContactAliases,
  mergeContacts,
  mergeProjects,
  getMergeImpact,
  getIdentitySuggestionById,
  acceptIdentitySuggestion,
  mergeJournalIdsFor,
  finalizeAcceptedMerge,
} from './database'
import type { Contact, Project, IdentitySuggestion, AcceptSuggestionResult, MergeKind } from './database'
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
  // ADV52-1 (round-54): expose the engine's RE-ENTRANT transaction primitive so
  // the package's mergeNodes runs atomically on the shared DB. Re-entrant means a
  // mergeNodes called while an outer transaction is already open (e.g. inside an
  // ingest/removeRecordingProvenance runInTransaction) joins that transaction
  // rather than issuing a nested BEGIN — and a COMMIT persists (better-sqlite3 +
  // WAL) only on success, so a rolled-back merge is never written to disk.
  runInTransaction<T>(fn: () => T): T {
    return runInTransaction(fn)
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
      // forKeying (ADV30-2): resolve a person node's stable contact-id norm_key,
      // PREFERRING a VISIBLE same-name contact and NEVER keying to a suppressed one
      // (a keyed node becomes graph-visible via the eligible recording's edges, which
      // would leak the suppressed contact's fields). Only-suppressed ⇒ null ⇒ the
      // node stays name-keyed.
      const r = resolveContact(name, { forKeying: true, ...(meetingId ? { meetingId } : {}) })
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
  // ADV55-1 (round-57): lazy-load provider config so importing this service (now done
  // by org-reconciler for the contact-merge composite) does NOT eagerly pull config.ts,
  // which reads app.getPath('home') at MODULE LOAD. Keeping it lazy lets the graph
  // service be imported in a plain Node context without an Electron `app` mock, while
  // ingestion (which needs the provider) still resolves it here.
  const { getProviderConfigFromSettings } = await import('./ai-provider-config')
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

  // Lazy-load — see ingestFromDbTranscripts (ADV55-1): avoids an eager config.ts load.
  const { getProviderConfigFromSettings } = await import('./ai-provider-config')
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

/**
 * ADV34-3 sweep (round-36) — the profile's related entities are returned as
 * SANITIZED ContextGraphNode DTOs (via the shared {@link nodeToDTO}), NOT raw
 * GraphNode objects: personProfile previously leaked raw norm_key + props + row
 * timestamps on the graph:personProfile IPC surface. (The related nodes are
 * meetings/skills/actions — never person — so they carry no contactId; the DTO
 * strips norm_key/props regardless.)
 */
export interface PersonProfileDTO {
  personId: string
  personLabel: string
  meetings: ContextGraphNode[]
  skills: ContextGraphNode[]
  actionItems: ContextGraphNode[]
}

export function queryPersonProfile(name: string): PersonProfileDTO | undefined {
  const store = getKnowledgeGraphStore()
  const profile = personProfile(store, name)
  if (!profile) return undefined
  const projects = projectNameIndex()
  const sanitize = (nodes: GraphNode[]): ContextGraphNode[] => {
    const vis = visibleContactIdSet(nodes)
    return nodes.map((n) => nodeToDTO({ ...n, degree: 0 }, projects, vis))
  }
  const exclusion = getGroundingExclusionSet(true) // ADV23-2: non-owner surface — suppress legacy zero-provenance edges
  if (exclusionIsNoop(exclusion)) {
    return {
      personId: profile.personId,
      personLabel: profile.personLabel,
      meetings: sanitize(profile.meetings),
      skills: sanitize(profile.skills),
      actionItems: sanitize(profile.actionItems),
    }
  }
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
    personId: profile.personId,
    personLabel: profile.personLabel,
    meetings: sanitize(related('ATTENDED')),
    skills: sanitize(related('DEMONSTRATED')),
    actionItems: sanitize(related('OWNS')),
  }
}

/**
 * Sanitized meeting-graph DTO returned on the graph:meetingGraph IPC surface.
 * ADV34-1 (round-36) — nodes (and the meeting node) are ContextGraphNode DTOs
 * mapped through the shared contact-visibility-aware {@link nodeToDTO}, NOT raw
 * GraphNode objects: a node visible via an eligible meeting edge but keyed to a
 * SUPPRESSED contact must never leak its `norm_key` (`contact:<id>`) or
 * `props.contactId` on this non-owner surface. Edges keep the package's
 * source_id/target_id shape (they carry no contact-identity leak).
 */
export interface MeetingGraphDTO {
  meeting: ContextGraphNode | null
  nodes: ContextGraphNode[]
  edges: Array<{ id: string; source_id: string; target_id: string; type: string; weight: number }>
}

export function queryMeetingGraph(meetingId: string): MeetingGraphDTO {
  const store = getKnowledgeGraphStore()
  const graph = meetingSummaryGraph(store, meetingId)
  const empty: MeetingGraphDTO = { meeting: null, nodes: [], edges: [] }
  if (!graph.meeting) return empty
  const exclusion = getGroundingExclusionSet(true) // ADV23-2: non-owner surface — suppress legacy zero-provenance edges

  let keptNodes = graph.nodes
  let keptEdges = graph.edges
  if (!exclusionIsNoop(exclusion)) {
    // Centered on a meeting: fail closed + never expose an excluded-only meeting.
    if (exclusion.failClosed || !isNodeVisibleUnderExclusion(store, graph.meeting.id, exclusion)) {
      return empty
    }
    const suppressed = provenanceSuppressedEdgeIds(store, graph.edges.map((e) => e.id), exclusion)
    keptEdges = graph.edges.filter((e) => !suppressed.has(e.id))
    const incident = new Set<string>([graph.meeting.id])
    for (const e of keptEdges) {
      incident.add(e.source_id)
      incident.add(e.target_id)
    }
    keptNodes = graph.nodes.filter((n) => incident.has(n.id))
  }

  // ADV34-1 (round-36) — route the meeting node AND every surviving node through
  // the shared nodeToDTO (with a batched fail-closed visibleContactIdSet), so a
  // person node keyed to a suppressed contact never returns its contactId, and no
  // raw norm_key/props leaves this surface — on the healthy path too (raw nodes
  // were previously returned wholesale).
  const projects = projectNameIndex()
  const visibleContacts = visibleContactIdSet([graph.meeting, ...keptNodes])
  return {
    meeting: nodeToDTO({ ...graph.meeting, degree: 0 }, projects, visibleContacts),
    nodes: keptNodes.map((n) => nodeToDTO({ ...n, degree: 0 }, projects, visibleContacts)),
    edges: keptEdges.map((e) => ({
      id: e.id,
      source_id: e.source_id,
      target_id: e.target_id,
      type: e.type,
      weight: e.weight,
    })),
  }
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

  // ADV47-1 (round-49): this AUTOMATIC maintenance rekey/merge (runs after every
  // transcript ingestion) is a MUTATION — it repoints edges / deletes / rewrites
  // node identity — so it must pass the SAME execution-time node-visibility /
  // mutability boundary the interactive mutations (bindNodeToContact,
  // mergeGraphNodes) use. Round-35 mis-classified it owner-cleanup-safe; "owner
  // cleanup" only exempts pure REMOVAL, never a rewrite/merge that changes
  // identity or topology. Compute the fail-closed exclusion snapshot ONCE for the
  // whole scan (same source the read/mutation guards use).
  const exclusion = getGroundingExclusionSet(true)

  for (const node of nameKeyed) {
    // BEFORE resolving/merging/rewriting: a name-keyed node whose only provenance
    // is now personal / deleted / value-excluded / hard-purged (or a legacy
    // zero-provenance node on this non-owner boundary) is NOT visible. Merging it
    // into a contact-keyed node or rewriting its identity would repoint its HIDDEN
    // edges or delete the hidden node, so restoring the recording later would
    // resurface its facts under a CHANGED / accent-mismatched identity. Fail
    // closed: an excluded-only source OR a visibility-lookup failure ⇒ SKIP the
    // node entirely (no resolve, no merge, no rewrite).
    const sourceNode = store.getNode(node.id)
    if (!isNodeMutable(store, node.id, sourceNode, exclusion)) {
      result.skipped++
      continue
    }

    let contactId: string | null = null
    try {
      const r = resolveContact(node.label, { forKeying: true })
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
      // ADV47-1: don't fold a node into a keeper that is itself suppressed — the
      // merge TARGET must be visible/eligible under the same snapshot (mirrors the
      // round-33/34 merge guards + bindNodeToContact's implicit-keeper check).
      // Fail closed: a hidden / excluded-only / lookup-failing keeper ⇒ SKIP.
      if (!isNodeMergeEligible(store, keeper.id, store.getNode(keeper.id), exclusion)) {
        result.skipped++
        continue
      }
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

/**
 * ADV32-1 (round-34) — batch-resolve which person-node backing contactIds are
 * VISIBLE on non-owner surfaces, so the SHARED {@link nodeToDTO} mapper can
 * sanitize contactId for EVERY DTO reader (overview / neighborhood / lens /
 * provenance / default-center / search / list) at a single choke-point, WITHOUT a
 * per-node DB round-trip. A node can be graph-visible via an ELIGIBLE recording's
 * edge while its BACKING contact is SUPPRESSED (its own source recording excluded /
 * hard-purged, or a keying collision to an older suppressed same-name row) — edge
 * suppression only proves the node has surviving EVIDENCE, not that its contact
 * IDENTITY may be exposed. Routed through the shared FAIL-CLOSED entity-visibility
 * boundary; a lookup failure ⇒ empty set ⇒ every contactId omitted.
 */
function visibleContactIdSet(nodes: Array<Pick<GraphNode, 'type' | 'props'>>): Set<string> {
  const ids: string[] = []
  for (const n of nodes) {
    if (n.type !== 'person') continue
    const props = parseProps(n.props)
    if (typeof props.contactId === 'string' && props.contactId) ids.push(props.contactId)
  }
  if (ids.length === 0) return new Set<string>()
  const { visible, failClosed } = filterVisibleEntityIds('contact', ids)
  return failClosed ? new Set<string>() : visible
}

/**
 * Enrich a raw graph node into a context DTO node with click-through ids.
 * `visibleContactIds` is the batch-resolved allowlist of backing contactIds that
 * may be exposed on this non-owner surface (see {@link visibleContactIdSet}): a
 * person node whose contactId is NOT in the set has its contactId OMITTED
 * (ADV32-1, fail-closed) so a suppressed legacy contact never leaks through ANY of
 * the DTO readers that funnel through this shared mapper.
 */
function nodeToDTO(
  n: GraphNode & { degree?: number },
  projects: Map<string, string>,
  visibleContactIds: Set<string>
): ContextGraphNode {
  const props = parseProps(n.props)
  const dto: ContextGraphNode = {
    id: n.id,
    type: n.type,
    label: n.label,
    degree: n.degree ?? 0,
  }
  if (n.type === 'person' && typeof props.contactId === 'string' && visibleContactIds.has(props.contactId)) {
    dto.contactId = props.contactId
  }
  if (n.type === 'meeting' && typeof props.meetingId === 'string') dto.meetingId = props.meetingId
  if (n.type === 'project') {
    const pid = projects.get((n.label || '').toLowerCase().trim())
    if (pid) dto.projectId = pid
  }
  return dto
}

function toDTO(sub: SubGraph): ContextGraphData {
  const projects = projectNameIndex()
  const visibleContactIds = visibleContactIdSet(sub.nodes)
  const nodes: ContextGraphNode[] = sub.nodes.map((n) => nodeToDTO(n, projects, visibleContactIds))
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
 * isNodeVisibleUnderExclusion: a node with ≥1 surviving (non-suppressed / legacy
 * zero-provenance) edge is NOT hidden; a node with all-suppressed incident edges IS
 * hidden; and (ADV35-1, round-37) an ISOLATED node is decided by NODE-LEVEL
 * provenance ({@link classifyIsolatedNodeVisible}) — a derived orphan of an
 * excluded/purged recording is hidden, a manual/structural orphan stays visible,
 * and a legacy (origin-NULL) orphan is hidden UNLESS it has positive backing
 * ({@link legacyNodeBackingVisible}), regardless of its node type (ADV36-1).
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

  // 3. ADV35-1 (round-37) — ISOLATED nodes (no incident edge, hence absent from
  //    `incident`) are not decided by edge-provenance. Scan all nodes, and for each
  //    isolated one apply the NODE-LEVEL provenance rule. Batch the derived-source
  //    eligibility lookup ONCE (not per node) to preserve this function's bounded,
  //    non-N+1 contract.
  const allNodes = store.db.queryAll<NodeProvenanceRow & { id: string }>(
    'SELECT id, type, origin, source_recording_id, label, norm_key, props FROM graph_nodes'
  )
  const isolatedDerivedSourceIds = new Set<string>()
  let hasLegacyIsolated = false
  for (const n of allNodes) {
    if (incident.has(n.id)) continue // has edges — decided above
    if (n.origin === 'derived' && n.source_recording_id && !exclusion.failClosed) {
      isolatedDerivedSourceIds.add(n.source_recording_id)
    } else if (n.origin !== 'derived' && n.origin !== 'manual' && n.origin !== 'structural') {
      hasLegacyIsolated = true // origin NULL ⇒ needs a positive-backing lookup
    }
  }
  const { eligible: eligibleIsolatedSources, failClosed: isolatedFailClosed } =
    isolatedDerivedSourceIds.size > 0
      ? getEligibleRecordingIds(isolatedDerivedSourceIds)
      : { eligible: new Set<string>(), failClosed: false }
  const sourceEligible = (recId: string): boolean =>
    !isolatedFailClosed && eligibleIsolatedSources.has(recId)
  // ADV36-1 (round-38) — build the project name index ONCE (only if a legacy
  // isolated node needs the positive-backing lookup) so legacyNodeBackingVisible
  // does not re-scan `projects` per node.
  const projectIndex = hasLegacyIsolated ? projectNameIndex() : undefined
  for (const n of allNodes) {
    if (incident.has(n.id)) continue
    if (!classifyIsolatedNodeVisible(n, exclusion, sourceEligible, () => legacyNodeBackingVisible(n, projectIndex)))
      hidden.add(n.id)
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

interface NodeProvenanceRow {
  type: string
  origin: string | null
  source_recording_id: string | null
  label: string
  norm_key: string
  props: string | null
}

/** The node fields a legacy backing lookup needs (subset of {@link NodeProvenanceRow}). */
type LegacyBackingRow = Pick<NodeProvenanceRow, 'type' | 'label' | 'norm_key' | 'props'>

/**
 * ADV36-1 (round-38) — POSITIVE backing check for a LEGACY (origin-NULL) ISOLATED
 * node. Node TYPE is NOT provenance: ingestExtraction creates recording-DERIVED
 * person / meeting / project nodes too, so the round-37 "structural kind ⇒ visible"
 * heuristic fails OPEN (a legacy transcript-derived person/meeting/project leaked
 * its label with no eligible backing). A legacy edgeless node is therefore visible
 * ONLY when it resolves to a still-visible backing row:
 *   • person  ⇒ its backing CONTACT is visible (filterVisibleEntityIds 'contact',
 *     via props.contactId or the `contact:<id>` norm_key);
 *   • meeting ⇒ an ELIGIBLE meeting/recording backs it (getEligibleRecordingIds
 *     over the meeting's recordings + the meetingId itself as a candidate recording id);
 *   • project ⇒ its backing PROJECT is visible (filterVisibleEntityIds 'project',
 *     resolved by name);
 *   • any other (purely DERIVED) kind — risk/topic/skill/decision/action_item/
 *     next_step — has NO structural backing ⇒ SUPPRESS.
 * Fail-closed: an unresolvable backing id, a suppressed/ineligible backing row, or
 * any lookup failure ⇒ NOT visible.
 */
function legacyNodeBackingVisible(row: LegacyBackingRow, projectIndex?: Map<string, string>): boolean {
  const props = parseProps(row.props)
  if (row.type === 'person') {
    let contactId: string | null = null
    if (typeof props.contactId === 'string' && props.contactId) contactId = props.contactId
    else if (row.norm_key.startsWith('contact:')) contactId = row.norm_key.slice('contact:'.length)
    if (!contactId) return false
    const { visible, failClosed } = filterVisibleEntityIds('contact', [contactId])
    return !failClosed && visible.has(contactId)
  }
  if (row.type === 'meeting') {
    let meetingId: string | null = null
    if (typeof props.meetingId === 'string' && props.meetingId) meetingId = props.meetingId
    else if (row.norm_key.startsWith('meeting:')) meetingId = row.norm_key.slice('meeting:'.length)
    if (!meetingId) return false
    // meetingId may itself be a recordingId (ingest keys meeting nodes by
    // `recordings.meeting_id ?? recordingId`), so probe it directly too.
    const recIds = new Set<string>([meetingId])
    try {
      for (const rec of getRecordingsForMeeting(meetingId)) recIds.add(rec.id)
    } catch (e) {
      console.error('[KnowledgeGraph] legacy meeting backing lookup failed — fail-closed:', e)
      return false
    }
    const { eligible, failClosed } = getEligibleRecordingIds(recIds)
    return !failClosed && eligible.size > 0
  }
  if (row.type === 'project') {
    const idx = projectIndex ?? projectNameIndex()
    const pid = idx.get((row.label || '').toLowerCase().trim())
    if (!pid) return false
    const { visible, failClosed } = filterVisibleEntityIds('project', [pid])
    return !failClosed && visible.has(pid)
  }
  return false // derived-only kind ⇒ no structural backing ⇒ suppress (fail-closed)
}

/**
 * ADV35-1 (round-37) / ADV36-1 (round-38) — PURE isolated-node visibility rule,
 * shared by the per-node {@link isIsolatedNodeVisible} (point reads / views /
 * mutation guard) and the batched {@link computeExcludedOnlyNodeIds} (search) so
 * they never drift. Given a node's provenance row, a predicate for whether a derived
 * source recording is currently eligible, and a lazy callback resolving legacy
 * POSITIVE backing:
 *   • origin 'manual'/'structural' ⇒ VISIBLE (user/folder/calendar — not tied to a
 *     recording, nothing to exclude);
 *   • origin 'derived' ⇒ visible ONLY if its source_recording_id resolves ELIGIBLE
 *     (no source id, an ineligible/hard-purged source, or a fail-closed context ⇒
 *     SUPPRESSED);
 *   • origin NULL (legacy) ⇒ visible ONLY if it has POSITIVE backing
 *     ({@link legacyNodeBackingVisible}) — NO type heuristic (round-38 fix).
 */
function classifyIsolatedNodeVisible(
  row: NodeProvenanceRow,
  exclusion: GroundingExclusion,
  sourceEligible: (recId: string) => boolean,
  legacyBackingVisible: () => boolean
): boolean {
  if (row.origin === 'manual' || row.origin === 'structural') return true
  if (row.origin === 'derived') {
    if (!row.source_recording_id) return false // derived but unassociable ⇒ suppress
    if (exclusion.failClosed) return false // fail-closed context suppresses attributed content
    return sourceEligible(row.source_recording_id)
  }
  // origin NULL = LEGACY pre-v47. Require POSITIVE backing (no type heuristic —
  // person/meeting/project are derived too, ADV36-1).
  return legacyBackingVisible()
}

/**
 * ADV35-1 (round-37) — visibility for a single ISOLATED (zero-incident-edge) node.
 * An isolated node has NO graph_edge_sources rows, so edge-provenance can't suppress
 * it; the NODE-LEVEL provenance rule ({@link classifyIsolatedNodeVisible}) decides.
 * A missing node row ⇒ not visible (fail-closed).
 */
function isIsolatedNodeVisible(
  store: KnowledgeGraphStore,
  nodeId: string,
  exclusion: GroundingExclusion
): boolean {
  const row = store.db.queryOne<NodeProvenanceRow>(
    'SELECT type, origin, source_recording_id, label, norm_key, props FROM graph_nodes WHERE id = ?',
    [nodeId]
  )
  if (!row) return false // gone ⇒ not visible (fail-closed)
  return classifyIsolatedNodeVisible(
    row,
    exclusion,
    (recId) => {
      const { eligible, failClosed } = getEligibleRecordingIds([recId])
      return !failClosed && eligible.has(recId)
    },
    () => legacyNodeBackingVisible(row)
  )
}

/**
 * P3 (round-3) — is a graph node visible under the current exclusion? A node with
 * ≥1 incident edge is HIDDEN only when EVERY incident edge is provenance-suppressed
 * (an "excluded-only" node). ADV35-1 (round-37): a node with ZERO incident edges is
 * no longer blanket-visible — an ISOLATED DERIVED node (e.g. an edgeless risk) has
 * no edge-provenance to suppress by, so its NODE-LEVEL provenance decides (see
 * {@link isIsolatedNodeVisible}); manual/structural isolated nodes stay visible.
 * Used by the inspector/search read paths (searchGraphNodes, queryProvenance,
 * getNodeDetail, default-center, queryListNodes) AND the mutation guard
 * (isNodeMutable) so they never expose / mutate an excluded-only or
 * excluded-derived-orphan node.
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
  if (incident.length === 0) return isIsolatedNodeVisible(store, nodeId, exclusion) // node-level provenance
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
  const store = getKnowledgeGraphStore()
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
    // ADV35-1 (round-37) — isolated within this view (touched by NO edge here, e.g.
    // an edgeless risk in the overview, or a fullGraph-limit-truncated node). No
    // longer blanket-kept: re-verify through the shared boundary, which decides an
    // isolated node by NODE-LEVEL provenance (derived-orphan of an excluded/purged
    // recording ⇒ suppressed; manual/structural ⇒ kept).
    return isNodeVisibleUnderExclusion(store, n.id, exclusion)
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
  const visibleContactIds = visibleContactIdSet(lens.nodes)
  const nodes: ContextLensNode[] = lens.nodes.map((n) => ({
    ...nodeToDTO(n, projects, visibleContactIds),
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
  // ADV32-1 (round-34) — sanitize contactId through the shared fail-closed set so a
  // default-centered node keyed to a suppressed contact never exposes its id.
  const dto = nodeToDTO({ ...node, degree: 0 }, projects, visibleContactIdSet([node]))
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
  // ADV32-1 (round-34) — batch-resolve the visible backing contactIds ONCE for
  // every entity this provenance may map, so mapEntity's shared nodeToDTO sanitizes
  // contactId fail-closed (a person keyed to a suppressed contact never leaks its
  // id here) without a per-entity visibility lookup.
  const provFullNodes = [prov.node, ...prov.meetings, ...prov.people, ...prov.projects, ...prov.actions]
    .filter((e): e is NonNullable<typeof e> => !!e)
    .map((e) => store.getNode(e.id))
    .filter((n): n is NonNullable<typeof n> => !!n)
  const visibleContacts = visibleContactIdSet(provFullNodes)
  const mapEntity = (e: {
    id: string
    type: string
    label: string
    dateMs: number | null
  }): LensCenter & { dateMs: number | null } => {
    // Reuse click-through enrichment by looking up the full node for ids.
    const full = store.getNode(e.id)
    const base = full ? nodeToDTO({ ...full, degree: 0 }, projects, visibleContacts) : { id: e.id, type: e.type, label: e.label, degree: 0 }
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

/**
 * ADV30-2 (round-32) — is this contact currently VISIBLE on non-owner surfaces?
 * A person node can be visible via an eligible recording's edges while its BACKING
 * contact is SUPPRESSED (its own source recording excluded / hard-purged, or a keying
 * collision to an older suppressed same-name row). Non-owner graph surfaces must not
 * expose or mutate such a contact. Routed through the shared entity-visibility
 * boundary; FAIL-CLOSED (a lookup error ⇒ not visible).
 */
function isContactVisible(contactId: string): boolean {
  const { visible, failClosed } = filterVisibleEntityIds('contact', [contactId])
  return !failClosed && visible.has(contactId)
}

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
 * ADV31-3 (round-33) — the inspector's node STATISTICS derived from an
 * EXCLUSION-FILTERED one-hop subgraph. Package {@link nodeGraphStats} traverses
 * the RAW store, so its meeting/person/project counts, degree and first/last-seen
 * dates include personal/deleted/value-excluded (and legacy zero-provenance)
 * edges. getNodeDetail is a NON-OWNER surface: every statistic must derive from
 * ONLY the edges that survive the SAME provenance suppression the other Context
 * Graph reads use ({@link provenanceSuppressedEdgeIds}) and the neighbors still
 * reachable from the center via a surviving edge. Fail-closed: on a suppression
 * lookup failure the exclusion is failClosed ⇒ every attributed edge is
 * suppressed ⇒ minimal stats (never the raw store's numbers). Mirrors the
 * package's counting rules (degree = surviving incident edges; meeting dates from
 * surviving meeting neighbors) over the filtered survivor set.
 */
function exclusionFilteredNodeStats(
  store: KnowledgeGraphStore,
  nodeId: string,
  exclusion: GroundingExclusion
): NodeGraphStats {
  const empty: NodeGraphStats = {
    meetingCount: 0,
    firstSeenMs: null,
    lastSeenMs: null,
    peopleCount: 0,
    projectCount: 0,
    degree: 0,
  }
  const sub = neighborhood(store, nodeId, 1)
  if (!sub.center) return empty
  // No filtering to do (healthy + empty exclusion, or no edges) → mirror raw.
  const suppressed =
    sub.edges.length === 0
      ? new Set<string>()
      : provenanceSuppressedEdgeIds(store, sub.edges.map((e) => e.id), exclusion)

  // Neighbors still connected to the CENTER via a surviving (non-suppressed) edge,
  // and the center's surviving-incident degree.
  const survivingNeighbors = new Set<string>()
  let degree = 0
  for (const e of sub.edges) {
    if (suppressed.has(e.id)) continue
    if (e.source_id === nodeId || e.target_id === nodeId) {
      degree++
      const other = e.source_id === nodeId ? e.target_id : e.source_id
      if (other !== nodeId) survivingNeighbors.add(other)
    }
  }

  const byId = new Map(sub.nodes.map((n) => [n.id, n]))
  let meetingCount = 0
  let peopleCount = 0
  let projectCount = 0
  let firstSeenMs: number | null = null
  let lastSeenMs: number | null = null
  for (const id of survivingNeighbors) {
    const n = byId.get(id)
    if (!n) continue
    if (n.type === 'meeting') {
      meetingCount++
      const d = ownDateMs(n)
      if (d != null) {
        if (firstSeenMs == null || d < firstSeenMs) firstSeenMs = d
        if (lastSeenMs == null || d > lastSeenMs) lastSeenMs = d
      }
    } else if (n.type === 'person') {
      peopleCount++
    } else if (n.type === 'project') {
      projectCount++
    }
  }
  return { meetingCount, firstSeenMs, lastSeenMs, peopleCount, projectCount, degree }
}

/**
 * ADV31-3 / RE4-1 (round-33) — the inspector's one-line provenance narrative with
 * excluded-neighbor LABELS removed. Package {@link provenance} builds the narrative
 * from a RAW 2-hop neighborhood and embeds neighbor meeting/person labels; on this
 * NON-OWNER surface an excluded neighbor's name must not appear. Reuses the exact
 * queryProvenance (RE4-1) rule: derive the survivor set via
 * {@link centerReachableSurvivorIds} and DROP the narrative entirely when ANY
 * neighbor was suppressed (a partial narrative could still leak an excluded name).
 * Fail-closed: a failClosed exclusion suppresses every attributed neighbor.
 */
function provenanceSuppressedNarrative(
  store: KnowledgeGraphStore,
  nodeId: string,
  exclusion: GroundingExclusion
): string {
  const prov = provenance(store, nodeId)
  if (exclusionIsNoop(exclusion)) return prov.narrative
  const survivors = centerReachableSurvivorIds(store, nodeId, 2, exclusion)
  const keep = (e: { id: string }): boolean => survivors.has(e.id)
  const suppressedAny =
    prov.meetings.some((m) => !keep(m)) ||
    prov.people.some((p) => !keep(p)) ||
    prov.projects.some((p) => !keep(p)) ||
    prov.actions.some((a) => !keep(a))
  return suppressedAny ? '' : prov.narrative
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
  // ADV31-3 (round-33) — compute the exclusion ONCE and reuse it for the node
  // visibility gate AND the exclusion-filtered statistics below.
  const exclusion = getGroundingExclusionSet(true)
  if (!isNodeVisibleUnderExclusion(store, nodeId, exclusion)) return empty

  const projects = projectNameIndex()
  // ADV32-1 (round-34): the shared nodeToDTO now sanitizes contactId through the
  // fail-closed visibleContactIdSet, so the DTO no longer carries a suppressed id.
  const dto = nodeToDTO({ ...node, degree: 0 }, projects, visibleContactIdSet([node]))
  // ADV30-2 (round-32): defence-in-depth — the inspector re-derives contactId below
  // under isContactVisible (which also covers the `contact:<id>` node key, not just
  // props.contactId), so clear any prop-derived value first. Harmless when the
  // shared mapper already omitted it.
  if (dto.contactId) dto.contactId = undefined
  const props = parseProps(node.props)
  const pronouns = typeof props.pronouns === 'string' && props.pronouns ? props.pronouns : null

  // ADV30-2 (round-32): the node can be visible via an eligible recording's edges
  // (passed isNodeVisibleUnderExclusion above) while its BACKING contact is SUPPRESSED
  // on non-owner surfaces (own source recording excluded / hard-purged, or a keying
  // collision to an older suppressed same-name row). Gate the contact id through the
  // shared entity-visibility boundary (fail-closed): when suppressed, expose NEITHER
  // contactId NOR any contact-derived field (company/email/role/aliases).
  const rawContactId = contactIdOfNode(node)
  const contactId = rawContactId && isContactVisible(rawContactId) ? rawContactId : null
  let role: string | null = null
  let company: string | null = null
  let email: string | null = null
  let aliases: string[] = []
  const linked = node.type === 'person' && !!contactId
  if (contactId) {
    const contact = getContactById(contactId)
    if (contact) {
      // ADV29-2 (round-31) — graph inspector is a NON-OWNER surface: blank a
      // transcript-enriched role whose source recording is ineligible (fail-closed),
      // even though the node/contact stays visible via an eligible recording.
      const [safe] = blankIneligibleContactFields([contact])
      role = safe.role
      company = safe.company
      email = safe.email
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

  // ADV31-3 (round-33): inspector statistics from an EXCLUSION-FILTERED one-hop
  // subgraph — NOT the raw store (nodeGraphStats), which would count excluded
  // (personal/deleted/value-excluded/legacy-zero-provenance) neighbors and edges.
  const stats = exclusionFilteredNodeStats(store, nodeId, exclusion)
  let narrative = ''
  try {
    // RE4-1 / ADV31-3 (round-33): the narrative embeds neighbor meeting/person
    // LABELS. Derive it from the SAME exclusion-suppressed subgraph the stats use,
    // so an excluded neighbor's name never reaches this non-owner surface. When the
    // node has no surviving neighbor evidence, emit no narrative.
    narrative = provenanceSuppressedNarrative(store, nodeId, exclusion)
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

  // ADV33-2 (round-35): execution-time NODE-visibility recheck (TOCTOU). Refuse a
  // rename of a node that became personal / deleted / value-excluded / hard-purged /
  // zero-provenance AFTER the inspector loaded — a contact-scoped rename would emit
  // entity:contact-changed and re-expose a now-hidden node's identity everywhere.
  // Fail-closed no-op. ONE exclusion snapshot drives this guard AND the implicit
  // collision-keeper guard below so they are consistent (ADV34-3).
  const exclusion = getGroundingExclusionSet(true)
  if (!isNodeMutable(store, nodeId, node, exclusion)) return { outcome: 'noop', scope: 'graph', nodeId }

  const contactId = contactIdOfNode(node)
  if (node.type === 'person' && contactId) {
    // ADV30-2 (round-32): refuse a contact-scoped rename when the backing contact is
    // SUPPRESSED on non-owner surfaces — renaming through updateContact + the
    // contact-changed event would mutate/re-expose a hidden excluded contact from a
    // non-owner graph action. Fail-closed no-op.
    if (!isContactVisible(contactId)) {
      return { outcome: 'noop', scope: 'contact', nodeId }
    }
    const contact = getContactById(contactId)
    if (contact) {
      const oldName = contact.name
      if (normalizeGraphLabel(oldName) === normalizeGraphLabel(label)) {
        return { outcome: 'noop', scope: 'contact', nodeId }
      }
      // ADV54-1 (round-56): a contact-scoped rename is a CROSS-LAYER composite — the
      // RELATIONAL contacts.name update PLUS the display-only GRAPH graph_nodes.label
      // refresh. Run as separate auto-commits, a graph-phase failure left the contact
      // renamed while the graph node kept the stale label — relational/graph identity
      // diverge. Wrap BOTH writes in ONE re-entrant runInTransaction so they roll back
      // together, and emit entity:contact-changed only AFTER the commit so listeners
      // never observe a rename that rolled back.
      runInTransaction(() => {
        updateContact(contactId, { name: label })
        // The contact-keyed graph node's label is display-only (its key stays
        // contact:<id>); refresh it in place so the graph shows the correction now.
        run('UPDATE graph_nodes SET label = ?, updated_at = ? WHERE id = ?', [
          label,
          new Date().toISOString(),
          nodeId,
        ])
      })
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

  // ADV34-3 (round-36): a graph-only rename runs through the package's renameNode,
  // which SILENTLY MERGES this node into an existing same-(type, norm_key) node when
  // the new label collides — folding the VISIBLE source's edges into that keeper and
  // DELETING the source. Round-35 validated only the requested node. Resolve the
  // implicit collision keeper and require it to pass merge-eligibility under the SAME
  // exclusion snapshot; if the keeper is excluded-only / hidden (or the lookup fails),
  // REFUSE before any graph change so a stale rename cannot fold a visible source into
  // a suppressed keeper.
  const newKey = normalizeGraphLabel(label)
  if (newKey !== node.norm_key) {
    const keeper = store.db.queryOne<{ id: string }>(
      'SELECT id FROM graph_nodes WHERE type = ? AND norm_key = ? AND id != ?',
      [node.type, newKey, nodeId]
    )
    if (keeper && !isNodeMergeEligible(store, keeper.id, store.getNode(keeper.id), exclusion)) {
      return { outcome: 'noop', scope: 'graph', nodeId }
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

  const contactKey = `contact:${contactId}`
  const keeper = queryOne<{ id: string }>(
    "SELECT id FROM graph_nodes WHERE type = 'person' AND norm_key = ?",
    [contactKey]
  )

  // ADV34-3 (round-36): when a contact-keyed node ALREADY carries this identity,
  // the bind SILENTLY MERGES the source into that keeper (repoints its edges,
  // deletes the visible source). Round-35's execution-time guard covered only the
  // explicit source. Resolve the IMPLICIT keeper and require BOTH the source and
  // the keeper to pass the SAME merge-eligibility check under ONE current exclusion
  // snapshot BEFORE any alias write or graph change: if the keeper is excluded-only /
  // hidden (or the visibility lookup fails), REFUSE with NO state mutation — a stale
  // bind must never fold a visible source into a suppressed keeper.
  const exclusion = getGroundingExclusionSet(true)
  if (!isNodeMutable(store, nodeId, node, exclusion)) {
    throw new Error('Node not available')
  }
  if (keeper && keeper.id !== nodeId) {
    if (!isNodeMergeEligible(store, keeper.id, store.getNode(keeper.id), exclusion)) {
      throw new Error('Node not available')
    }
  }

  // ADV54-1 (round-56): the manual bind is a CROSS-LAYER composite — a RELATIONAL
  // contact_aliases write (upsertContactAlias) PLUS GRAPH re-key/merge (mergeNodes /
  // graph_nodes UPDATE / setNodeProps). Round-35..55 ran these as SEPARATE
  // auto-commits, so a graph-phase failure (DB I/O, schema, statement error) left the
  // sovereign manual alias committed while the caller reported failure — the resolver
  // would then link this spelling through a bind the app NEVER completed, corrupting
  // identity provenance. Wrap the whole mutation in ONE re-entrant runInTransaction
  // (upsertContactAlias/run/mergeNodes/setNodeProps all write through the SAME engine)
  // so the alias and the graph rekey roll back together. The alias write NO LONGER
  // swallows failures — a swallowed alias error would defeat the atomicity (the graph
  // would rekey without the resolver alias); let it propagate to trigger the rollback.
  return runInTransaction(() => {
    // Sovereign manual bind so the resolver links this spelling from now on.
    upsertContactAlias(contactId, node.label, 'manual', 1.0)

    const now = new Date().toISOString()

    if (keeper && keeper.id !== nodeId) {
      mergeNodes(store, keeper.id, nodeId)
      run('UPDATE graph_nodes SET label = ?, updated_at = ? WHERE id = ?', [canonicalName, now, keeper.id])
      setNodeProps(store, keeper.id, { contactId })
      return { outcome: 'merged' as const, nodeId: keeper.id }
    }

    run('UPDATE graph_nodes SET norm_key = ?, label = ?, updated_at = ? WHERE id = ?', [
      contactKey,
      canonicalName,
      now,
      nodeId,
    ])
    setNodeProps(store, nodeId, { contactId })
    return { outcome: 'linked' as const, nodeId }
  })
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
  const store = getKnowledgeGraphStore()
  const nodeId = resolveEntityToNodeId(entityId)
  if (!nodeId) throw new Error('Node not found')
  const node = store.getNode(nodeId)
  if (!node) throw new Error('Node not found')
  // ADV33-2 (round-35): execution-time NODE-visibility recheck (TOCTOU). Refuse
  // binding a node that became personal / deleted / value-excluded / hard-purged /
  // zero-provenance AFTER the inspector loaded — the bind writes a manual alias +
  // re-keys the node onto the contact identity, re-exposing a now-hidden node.
  // Fail-closed refusal BEFORE the target-contact visibility check.
  if (!isNodeMutable(store, nodeId, node)) throw new Error('Node not available')
  const contact = getContactById(contactId)
  if (!contact) throw new Error('Contact not found')
  // ADV30-2 (round-32): refuse binding a (visible) graph node to a SUPPRESSED contact.
  // The bind writes a manual alias + re-keys the node onto the contact identity,
  // which makes the hidden excluded contact graph-visible and exposes its fields.
  // Fail-closed refusal.
  if (!isContactVisible(contactId)) throw new Error('Contact not available')
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

  // ADV33-2 (round-35): execution-time NODE-visibility recheck (TOCTOU). The
  // inspector may have loaded this node while it was visible, but by the time the
  // user clicks "convert" the node's source recording could have become
  // personal / deleted / value-excluded / hard-purged (all its edges now suppressed).
  // Converting a now-HIDDEN node would mint a source='user' contact that is ALWAYS
  // visible — permanently laundering excluded-derived identity. Refuse fail-closed
  // (missing node or fail-closed exclusion lookup ⇒ refuse) BEFORE any create/bind.
  if (!isNodeMutable(store, nodeId, node)) throw new Error('Node not available')

  const existingContactId = contactIdOfNode(node)
  // ADV31-1 (round-33): only REUSE the node's existing backing contact when it is
  // VISIBLE. A node can be graph-visible via an eligible recording's edges while its
  // backing contact is SUPPRESSED (own source excluded / hard-purged, or a keying
  // collision to an older suppressed same-name row). Returning it here would expose
  // the suppressed id AND skip creating the promised fresh visible contact. When the
  // binding is suppressed, IGNORE it and fall through to the visible-only exact-name
  // logic below, which creates/binds a FRESH VISIBLE contact (bindNodeToContact
  // re-keys the node off the suppressed identity). Fail-closed: isContactVisible
  // treats a lookup error as not-visible.
  if (existingContactId && getContactById(existingContactId) && isContactVisible(existingContactId)) {
    // Already a VISIBLE contact — nothing to create; treat as a no-op link.
    return { contactId: existingContactId, outcome: 'linked', nodeId, reusedExisting: true }
  }

  // Reuse an exact-name contact rather than minting a twin — but only a VISIBLE one.
  // ADV30-2 (round-32): a SUPPRESSED same-name contact must not be reused/re-exposed
  // by binding a visible node to it; fall through to create a fresh (visible) contact.
  const existing = getContactByName(node.label)
  if (existing && isContactVisible(existing.id)) {
    const r = bindNodeToContact(nodeId, existing.id)
    return { contactId: existing.id, outcome: r.outcome, nodeId: r.nodeId, reusedExisting: true }
  }

  // contacts.type is CHECK-constrained: team|candidate|customer|external|unknown.
  // An extracted person is an 'external' contact.
  // ADV54-1 (round-56): fresh-create is a CROSS-LAYER composite — createContact
  // commits an always-visible source='user' contact (RELATIONAL) and bindNodeToContact
  // then writes the manual alias + re-keys/merges the GRAPH node. Run separately, a
  // graph-phase failure inside bindNodeToContact propagated as failure to the IPC but
  // left the always-visible contact (and possibly its manual alias) persisted — future
  // extraction would resolve through a conversion the app reported as FAILED, laundering
  // identity provenance. Wrap create+bind in ONE outer runInTransaction; bindNodeToContact's
  // own runInTransaction is RE-ENTRANT and JOINS this one, so a throw anywhere rolls the
  // contact create back too. Eligibility/visibility guards stay BEFORE the transaction.
  return runInTransaction(() => {
    const contact = createContact({
      name: node.label,
      type: 'external',
      role: opts?.role ?? null,
      company: opts?.company ?? null,
      email: opts?.email ?? null,
    })
    const r = bindNodeToContact(nodeId, contact.id)
    return { contactId: contact.id, outcome: r.outcome, nodeId: r.nodeId, reusedExisting: false }
  })
}

/** Set (or clear, with '') a person node's pronouns. Stored on the node props. */
export function setNodePronouns(entityId: string, pronouns: string): boolean {
  const store = getKnowledgeGraphStore()
  const nodeId = resolveEntityToNodeId(entityId)
  if (!nodeId) return false
  // ADV33-2 (round-35): execution-time NODE-visibility recheck (TOCTOU). Refuse
  // mutating props on a node that became personal / deleted / value-excluded /
  // hard-purged / zero-provenance AFTER the inspector loaded. Fail-closed no-op.
  const node = store.getNode(nodeId)
  if (!isNodeMutable(store, nodeId, node)) return false
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
  /**
   * ADV32-2 (round-34) — true when the preview is REFUSED because a node is not
   * visible under exclusion or its backing contact is suppressed on this non-owner
   * surface (mirrors {@link mergeGraphNodes}' refusal). No labels/counts are
   * exposed when blocked, and the commit will refuse too.
   */
  blocked?: boolean
}

/**
 * ADV33-2 (round-35) — the SHARED execution-time NODE-visibility guard for EVERY
 * point graph mutation (convert / rename / link / pronouns / merge). At EXECUTION
 * time — NOT inspector-load time — the target node must still be VISIBLE under the
 * CURRENT exclusion set: a node that became personal / deleted / value-excluded /
 * hard-purged, or whose incident edges are now ALL provenance-suppressed / legacy
 * zero-provenance, is NOT mutable. This closes the TOCTOU where a stale mutation
 * (worst case: convertNodeToContact minting an always-visible source='user' contact)
 * could promote, rename, re-bind, or fold a now-HIDDEN node and thereby launder
 * excluded-derived identity. Fail-closed: a missing node OR a fail-closed exclusion
 * lookup ⇒ NOT mutable (refuse; no state change). Backing-CONTACT visibility is
 * mutation-specific (convert's fall-through-to-fresh, rename's contact path, link's
 * target, merge's both nodes) and enforced at each call site / by isNodeMergeEligible.
 */
function isNodeMutable(
  store: KnowledgeGraphStore,
  nodeId: string,
  node: GraphNode | undefined,
  exclusion: GroundingExclusion = getGroundingExclusionSet(true)
): boolean {
  if (!node) return false
  if (exclusion.failClosed) return false
  return isNodeVisibleUnderExclusion(store, nodeId, exclusion)
}

/**
 * ADV31-2 / ADV32-2 (round-34) — merge eligibility for a node on a NON-OWNER
 * surface, SHARED by {@link mergeGraphPreview} and {@link mergeGraphNodes} so the
 * preview and the commit AGREE. Builds on the shared {@link isNodeMutable}
 * execution-time NODE-visibility guard and additionally requires that, when the node
 * is contact-backed, its BACKING contact is visible (merge folds edges into a
 * contact-keyed keeper / calls mergeContacts, so a suppressed backing contact must
 * refuse the whole merge). Fail-closed: a missing node, an excluded-only node, a
 * suppressed backing contact, or a visibility-lookup failure ⇒ NOT eligible.
 */
function isNodeMergeEligible(
  store: KnowledgeGraphStore,
  nodeId: string,
  node: GraphNode | undefined,
  exclusion: GroundingExclusion
): boolean {
  if (!isNodeMutable(store, nodeId, node, exclusion)) return false
  if (!node) return false // narrowing (isNodeMutable already refused a missing node)
  const contact = contactIdOfNode(node)
  if (contact && !isContactVisible(contact)) return false
  return true
}

/**
 * ADV32-2 (round-34) — the merge blast radius computed over ONLY the edges that
 * SURVIVE provenance suppression, so a non-owner preview's per-node edge counts,
 * shared count and resulting count never include personal / deleted / value-excluded
 * or legacy zero-provenance edges. Mirrors the package's mergeBlastRadius counting
 * (neighbor-relative keys; a↔b relations collapse to self-loops and are dropped) but
 * filters suppressed edges FIRST. Used only when exclusions are active; the healthy
 * fast path keeps calling the package primitive.
 */
function exclusionFilteredBlastRadius(
  store: KnowledgeGraphStore,
  keeperId: string,
  loserId: string,
  exclusion: GroundingExclusion
): Pick<MergePreviewDTO, 'a' | 'b' | 'shared' | 'resulting'> {
  const keeper = store.getNode(keeperId)
  const loser = store.getNode(loserId)
  const survivingKeys = (nodeId: string): Set<string> => {
    const rows = store.db.queryAll<{ id: string; source_id: string; target_id: string; type: string }>(
      'SELECT id, source_id, target_id, type FROM graph_edges WHERE source_id = ? OR target_id = ?',
      [nodeId, nodeId]
    )
    const suppressed =
      rows.length === 0 ? new Set<string>() : provenanceSuppressedEdgeIds(store, rows.map((r) => r.id), exclusion)
    const keys = new Set<string>()
    for (const r of rows) {
      if (suppressed.has(r.id)) continue
      if (r.source_id === nodeId) keys.add(`out:${r.type}:${r.target_id}`)
      if (r.target_id === nodeId) keys.add(`in:${r.type}:${r.source_id}`)
    }
    return keys
  }
  const aKeys = keeper ? survivingKeys(keeperId) : new Set<string>()
  const bKeys = loser ? survivingKeys(loserId) : new Set<string>()
  let shared = 0
  const union = new Set<string>(aKeys)
  for (const k of bKeys) {
    if (aKeys.has(k)) shared++
    union.add(k)
  }
  let selfLoops = 0
  for (const k of union) if (k.endsWith(`:${keeperId}`) || k.endsWith(`:${loserId}`)) selfLoops++
  const resulting = Math.max(0, union.size - selfLoops)
  const toBlast = (n: GraphNode | undefined, keys: Set<string>) =>
    n ? { id: n.id, label: n.label, type: n.type, edges: keys.size } : null
  return { a: toBlast(keeper, aKeys), b: toBlast(loser, bKeys), shared, resulting }
}

/** Preview merging two nodes: the blast radius (what collapses) BEFORE committing. */
export function mergeGraphPreview(keeperEntityId: string, loserEntityId: string): MergePreviewDTO {
  const store = getKnowledgeGraphStore()
  const keeperId = resolveEntityToNodeId(keeperEntityId)
  const loserId = resolveEntityToNodeId(loserEntityId)
  if (!keeperId || !loserId) {
    return { a: null, b: null, shared: 0, resulting: 0, contactMerge: false }
  }
  const keeperNode = store.getNode(keeperId)
  const loserNode = store.getNode(loserId)
  // ADV32-2 (round-34): the preview is a NON-OWNER surface and must MATCH the
  // commit. mergeBlastRadius runs over the RAW graph, so previously the labels +
  // per-node edge counts + shared/resulting counts included EXCLUDED and legacy
  // zero-provenance edges, and an excluded-only / suppressed-contact node was still
  // previewable even though mergeGraphNodes REFUSES it. Refuse fail-closed here
  // under the SAME shared eligibility check the commit uses (node visible under
  // exclusion AND backing contact visible) so no raw label/count for a blocked
  // merge reaches the display.
  const exclusion = getGroundingExclusionSet(true)
  if (
    !isNodeMergeEligible(store, keeperId, keeperNode, exclusion) ||
    !isNodeMergeEligible(store, loserId, loserNode, exclusion)
  ) {
    return { a: null, b: null, shared: 0, resulting: 0, contactMerge: false, blocked: true }
  }
  // Both nodes + backing contacts are visible — compute the blast radius from
  // SURVIVING edges only so excluded relations don't inflate the counts (the
  // package primitive is safe on the healthy fast path with no active exclusions).
  const blast = exclusionIsNoop(exclusion)
    ? mergeBlastRadius(store, keeperId, loserId)
    : exclusionFilteredBlastRadius(store, keeperId, loserId, exclusion)
  const keeperContact = keeperNode ? contactIdOfNode(keeperNode) : null
  const loserContact = loserNode ? contactIdOfNode(loserNode) : null
  // Both backing contacts are already proven VISIBLE by isNodeMergeEligible above,
  // so a distinct pair is a genuine (undoable) contact merge.
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

  // ADV31-2 (round-33) + ADV32-2 (round-34): REFUSE the ENTIRE merge fail-closed
  // whenever EITHER node is not visible under exclusion OR its backing contact is
  // SUPPRESSED — the SAME shared eligibility check mergeGraphPreview enforces, so
  // preview and commit AGREE. The round-32 code merely skipped the journaled
  // mergeContacts but still FELL THROUGH to an unconditional graph-only mergeNodes —
  // which deletes the loser node and folds ALL its edges (incl. EXCLUDED provenance)
  // into the keeper. From a non-owner surface that destructively mutates
  // suppressed-contact-backed / excluded-only graph state, and if the excluded
  // recording is later restored its facts reappear under the WRONG identity.
  // Fail-closed: a missing/excluded-only node or a visibility-lookup failure ⇒ no
  // node or edge changes.
  const exclusion = getGroundingExclusionSet(true)
  if (!isNodeMergeEligible(store, keeperId, keeperNode, exclusion)) {
    throw new Error('Node not available')
  }
  if (!isNodeMergeEligible(store, loserId, loserNode, exclusion)) {
    throw new Error('Node not available')
  }

  const keeperContact = keeperNode ? contactIdOfNode(keeperNode) : null
  const loserContact = loserNode ? contactIdOfNode(loserNode) : null

  if (keeperContact && loserContact && keeperContact !== loserContact) {
    // Both backing contacts are VISIBLE (checked above) — real, journaled contacts
    // merge (undoable), then fold the graph nodes. Both graph nodes are known
    // present + eligible here (keeperId/loserId came FROM the store and passed the
    // guards above), so the shared cross-layer core ALWAYS folds them.
    //
    // ADV53-1 (round-55): the composite must be CROSS-LAYER failure-atomic. The
    // relational merge (rows + undo-journal) and the graph fold share ONE rollback
    // boundary via mergeContactsFoldingNodes's runInTransaction (see there for the
    // re-entrancy contract). ADV55-1 (round-57): factored into that shared core so the
    // People-UI / reconciler contact-id entry point (mergeContactsWithGraph) gets the
    // SAME atomic fold instead of depending on the post-commit name event.
    const { movedEdges } = mergeContactsFoldingNodes(keeperContact, loserContact, keeperId, loserId)
    return { keeperId, movedEdges, path: 'contact' as const }
  }

  const r = mergeNodes(store, keeperId, loserId)
  return { keeperId: r.keeperId, movedEdges: r.movedEdges, path: 'graph' }
}

/**
 * Resolve a CONTACT id to its backing person NODE id, the way the merge/rekey code
 * keys contact nodes: the canonical `contact:<id>` norm_key first (what
 * rekeyExistingPersonNodes + bindNodeToContact look up), then a legacy person node
 * still carrying the id only in props.contactId. Returns null when the contact has
 * no backing person node yet — the graph fold is then a no-op (the contact merge
 * still proceeds atomically). Name-only legacy nodes (norm_key = a name, no
 * contactId prop) intentionally do NOT resolve here; those are folded by graph-sync's
 * post-commit name-event fallback, which resolves by normalized name.
 */
function resolveContactToNodeId(contactId: string): string | null {
  const store = getKnowledgeGraphStore()
  const db = store.db
  const byKey = db.queryOne<{ id: string }>(
    "SELECT id FROM graph_nodes WHERE type = 'person' AND norm_key = ?",
    [`contact:${contactId}`]
  )
  if (byKey) return byKey.id
  const byProp = db.queryOne<{ id: string }>(
    "SELECT id FROM graph_nodes WHERE type = 'person' AND JSON_EXTRACT(props, '$.contactId') = ?",
    [contactId]
  )
  return byProp?.id ?? null
}

/**
 * Cross-layer atomic core: merge the relational CONTACTS (journaled, undoable) AND
 * fold their backing person NODES in ONE re-entrant runInTransaction, so a throw in
 * either phase rolls BOTH back (a single rollback boundary). mergeContacts's inner
 * runInTransaction and mergeNodes's runInGraphTransaction (→ graphDbAdapter
 * .runInTransaction → engine.runInTransaction) are RE-ENTRANT: with a transaction
 * already open they JOIN it (no illegal nested BEGIN) and defer to the outer
 * COMMIT/ROLLBACK.
 *
 * The node fold runs only when BOTH contacts resolve to DISTINCT person nodes; a
 * contact with no backing node (or a still-name-keyed legacy node) folds as a no-op
 * and the contact merge still commits — unlike the inspector path, which starts FROM
 * nodes and refuses a missing one.
 *
 * Event timing (ADV55-1 / round-57): mergeContacts emits `entity:contact-changed`
 * AFTER its inner (joined) transaction returns but BEFORE this outer COMMIT, and the
 * EventEmitter dispatch is synchronous — so graph-sync's `merged` handler runs
 * mid-transaction. That handler resolves nodes by NORMALIZED NAME, so for
 * contact-keyed nodes (norm_key `contact:<id>`) it finds nothing and no-ops; the
 * authoritative fold is THIS in-transaction mergeNodes. For legacy name-keyed nodes
 * the handler performs the (now same-transaction) fold and resolveContactToNodeId
 * returns null here, so there is no double-fold. The event is still emitted for its
 * other subscribers (rag reindex, UI refresh).
 */
function mergeContactsFoldingNodes(
  keeperContactId: string,
  loserContactId: string,
  keeperNodeId: string | null,
  loserNodeId: string | null
): { contact: Contact; movedEdges: number } {
  const store = getKnowledgeGraphStore()
  return runInTransaction(() => {
    const contact = mergeContacts(keeperContactId, loserContactId)
    let movedEdges = 0
    if (keeperNodeId && loserNodeId && keeperNodeId !== loserNodeId) {
      // Resolve AFTER the contact merge is harmless: the loser's GRAPH node persists
      // (only its contact ROW was deleted), so its `contact:<id>` key still folds.
      const r = mergeNodes(store, keeperNodeId, loserNodeId)
      movedEdges = r.movedEdges
    }
    return { contact, movedEdges }
  })
}

/**
 * People-UI + reconciler entry point (ADV55-1 / round-57): merge two CONTACTS by id
 * AND fold their backing graph person nodes ATOMICALLY. Resolves each contact to its
 * `contact:<id>` node (see resolveContactToNodeId) and shares mergeContactsFoldingNodes
 * with mergeGraphNodes' contact branch, so the loser's graph node, edges, and
 * graph_edge_sources provenance are repointed onto the keeper inside the same
 * transaction as the relational merge — no longer stranded under the deleted loser
 * contact id and no longer dependent on the best-effort post-commit name event
 * (which no-ops for contact-keyed nodes and is skipped when graph sync is disabled).
 *
 * Callers must apply their own visibility/eligibility gates on BOTH ids first (the
 * contacts:merge IPC's fail-closed boundary; the org-reconciler dedup partition).
 */
export function mergeContactsWithGraph(keeperContactId: string, loserContactId: string): Contact {
  const keeperNodeId = resolveContactToNodeId(keeperContactId)
  const loserNodeId = resolveContactToNodeId(loserContactId)
  return mergeContactsFoldingNodes(keeperContactId, loserContactId, keeperNodeId, loserNodeId).contact
}

/**
 * Resolve a PROJECT id to its backing graph project NODE id. Project nodes are
 * NAME-KEYED (unlike person nodes, which carry `contact:<id>`): the graph keys a
 * project node by its normalized name (`type='project' AND norm_key = normalize(name)`
 * — see resolveEntityToNodeId step 4 and the graph key rule normalizeGraphLabel).
 * Returns null when the project has no backing node (a project that never surfaced
 * in an ingested transcript), so the graph fold is a graceful no-op and the relational
 * merge still proceeds. Uses the SAME normalizer the project-node keying uses.
 */
function resolveProjectToNodeId(projectId: string): string | null {
  const store = getKnowledgeGraphStore()
  const project = queryOne<{ name: string }>('SELECT name FROM projects WHERE id = ?', [projectId])
  if (!project) return null
  const norm = normalizeGraphLabel(project.name)
  if (!norm) return null
  const node = store.db.queryOne<{ id: string }>(
    "SELECT id FROM graph_nodes WHERE type = 'project' AND norm_key = ?",
    [norm]
  )
  return node?.id ?? null
}

/**
 * Cross-layer atomic core for a PROJECT merge: merge the relational PROJECTS
 * (journaled, undoable) AND fold their backing project NODES in ONE re-entrant
 * runInTransaction, so a throw in either phase rolls BOTH back (a single rollback
 * boundary). Mirrors mergeContactsFoldingNodes; mergeProjects's inner runInTransaction
 * and mergeNodes's runInGraphTransaction are RE-ENTRANT and JOIN the open transaction.
 *
 * The node fold runs only when BOTH projects resolve to DISTINCT project nodes; a
 * project with no backing node folds as a no-op and the project merge still commits.
 * The project nodes are NAME-KEYED, so BOTH must be resolved to their node ids BEFORE
 * mergeProjects runs (which deletes the loser project ROW — after that the loser's
 * name→id lookup would fail, but its GRAPH node persists under the old name and still
 * folds).
 */
function mergeProjectsFoldingNodes(
  keeperProjectId: string,
  loserProjectId: string,
  keeperNodeId: string | null,
  loserNodeId: string | null
): { project: Project; movedEdges: number } {
  const store = getKnowledgeGraphStore()
  return runInTransaction(() => {
    const project = mergeProjects(keeperProjectId, loserProjectId)
    let movedEdges = 0
    if (keeperNodeId && loserNodeId && keeperNodeId !== loserNodeId) {
      const r = mergeNodes(store, keeperNodeId, loserNodeId)
      movedEdges = r.movedEdges
    }
    return { project, movedEdges }
  })
}

/**
 * Projects entry point (ADV56-3 / round-58): merge two PROJECTS by id AND fold their
 * backing graph project nodes ATOMICALLY. mergeProjects (relational-only) deletes the
 * loser project WITHOUT touching its NAME-KEYED graph node, so the loser's project
 * node + edges + graph_edge_sources stayed reachable under a project that no longer
 * existed relationally. Resolving BOTH project nodes by NAME and folding them inside
 * the same transaction as the relational merge closes that strand — the direct analogue
 * of the round-57 contact composite.
 *
 * Callers must apply their own visibility/eligibility gates on BOTH ids first (the
 * projects:merge IPC's fail-closed filterVisibleEntityIds boundary; the suggestion-accept
 * eligibility gate).
 */
export function mergeProjectsWithGraph(keeperProjectId: string, loserProjectId: string): Project {
  // Resolve BOTH nodes by NAME BEFORE the relational merge deletes the loser row.
  const keeperNodeId = resolveProjectToNodeId(keeperProjectId)
  const loserNodeId = resolveProjectToNodeId(loserProjectId)
  return mergeProjectsFoldingNodes(keeperProjectId, loserProjectId, keeperNodeId, loserNodeId).project
}

/**
 * Accept an identity suggestion — graph-aware, atomic entry point (ADV56-1 / round-58).
 *
 * This is the sole PRODUCTION entry for identity:acceptSuggestion. Two failures the
 * bare database.ts acceptIdentitySuggestion had on a RESOLVABLE-LOSER accept:
 *   1. It called bare mergeContacts/mergeProjects, so the loser's graph node/edges/
 *      graph_edge_sources were STRANDED (same bug as ADV55-1 / ADV56-3).
 *   2. It merged in one transaction and wrote the supersede + status='accepted' in a
 *      SEPARATE transaction — a failure in the second left the identity merged but the
 *      suggestion pending (a retry then took a different path).
 *
 * The resolvable-loser branch here routes the merge through the graph-aware composite
 * (mergeContactsWithGraph / mergeProjectsWithGraph — which fold the graph node in the
 * SAME transaction as the relational merge) AND wraps {merge + journal-id capture +
 * supersede + status write} in ONE re-entrant runInTransaction, so the whole accept is
 * all-or-nothing across BOTH layers. The bare-ALIAS branch (no resolvable loser) is
 * single-transaction and graph-neutral already, so it delegates to database.ts's
 * acceptIdentitySuggestion unchanged.
 *
 * Callers apply the accept-time eligibility gate (isSuggestionEligibleForAccept) BEFORE
 * this, exactly as the IPC does.
 */
export function acceptIdentitySuggestionWithGraph(id: string): AcceptSuggestionResult {
  const s = getIdentitySuggestionById(id)
  if (!s) throw new Error(`Identity suggestion ${id} not found`)

  let evidence: { loserId?: string } = {}
  try {
    evidence = s.evidence ? (JSON.parse(s.evidence) as { loserId?: string }) : {}
  } catch {
    evidence = {}
  }

  const jkind: MergeKind = s.kind === 'person' ? 'contact' : 'project'
  const loserId = evidence.loserId
  const table = s.kind === 'person' ? 'contacts' : 'projects'
  const loserExists =
    !!loserId &&
    loserId !== s.target_id &&
    !!queryOne<{ id: string }>(`SELECT id FROM ${table} WHERE id = ?`, [loserId])

  if (!loserExists) {
    // Alias accept — graph-neutral, already single-transaction in database.ts.
    return acceptIdentitySuggestion(id)
  }

  // Resolvable-loser accept: atomic merge (graph-aware) + supersede + status write.
  return runInTransaction(() => {
    const before = mergeJournalIdsFor(jkind, s.target_id)
    if (s.kind === 'person') mergeContactsWithGraph(s.target_id, loserId!)
    else mergeProjectsWithGraph(s.target_id, loserId!)
    const { mergeJournalId, supersededCount } = finalizeAcceptedMerge(s as IdentitySuggestion, loserId!, jkind, before)
    const row = getIdentitySuggestionById(id)!
    return { ...row, mergeJournalId, supersededCount }
  })
}

/** Remove a junk node from the graph (and its edges). Idempotent. */
export function deleteGraphNode(entityId: string): { removed: boolean; removedEdges: number } {
  const store = getKnowledgeGraphStore()
  const nodeId = resolveEntityToNodeId(entityId)
  if (!nodeId) return { removed: false, removedEdges: 0 }
  return deleteNode(store, nodeId)
}
