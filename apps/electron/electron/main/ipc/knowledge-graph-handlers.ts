/**
 * IPC handlers for Knowledge Graph operations.
 *
 * Channels:
 *   graph:stats          — node/edge counts by type
 *   graph:ingestAll      — ingest all DB transcripts (incremental)
 *   graph:reingestRecordings — remove graph+B1 rows for all marker-ingested recordings (dryRun supported); pair with graph:ingestAll to re-extract
 *   graph:ingestFolder   — ingest *.txt/*.md from a folder path
 *   graph:topAttendees   — top attendees for a topic/project name
 *   graph:topSkill       — top skill demonstrators
 *   graph:personProfile  — person profile (meetings, skills, action items)
 *   graph:meetingGraph   — all nodes/edges for a meeting
 */

import { ipcMain } from 'electron'
import {
  queryStats,
  ingestAllGraphSources,
  ingestFromFolder,
  queryTopAttendees,
  queryTopSkill,
  queryPersonProfile,
  queryMeetingGraph,
  queryContextGraph,
  queryNeighborhood,
  searchGraphNodes,
  rekeyExistingPersonNodes,
  pruneGenericGraphNodes,
  queryLens,
  pickLensCenter,
  queryProvenance,
  getNodeDetail,
  renameGraphEntity,
  convertNodeToContact,
  linkNodeToContact,
  setNodePronouns,
  mergeGraphPreview,
  mergeGraphNodes,
  deleteGraphNode,
  removeRecordingProvenanceCore,
} from '../services/knowledge-graph-service'

export function registerKnowledgeGraphHandlers(): void {
  ipcMain.handle('graph:stats', async () => {
    try {
      return { success: true, data: queryStats() }
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e)
      console.error('[graph:stats] Error:', e)
      return { success: false, error: msg }
    }
  })

  ipcMain.handle('graph:ingestAll', async () => {
    try {
      const result = await ingestAllGraphSources()
      return { success: true, data: result }
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e)
      console.error('[graph:ingestAll] Error:', e)
      return { success: false, error: msg }
    }
  })

  // graph:reingestRecordings — REMOVAL half of a re-ingest. For every recording
  // whose transcript currently carries a graph_ingested_transcripts marker
  // (scope derived live, never hardcoded), it:
  //   1. runs removeRecordingProvenanceCore(rid) — the tested surgical graph
  //      removal (protects shared edges, GCs orphan nodes by type, scrubs
  //      merge-journal snapshots). Markers included.
  //   2. deletes that recording's capture's rows from the first-class
  //      decisions / action_items tables (B1 promote output — NOT touched by
  //      removeRecordingProvenanceCore, which predates B1).
  // Each recording's two steps run in one transaction. With dryRun:true nothing
  // is written and the same scope + per-recording counts are reported (the
  // provenance core's own dryRun estimate). Re-extraction is a SEPARATE explicit
  // graph:ingestAll call, so the caller can verify the cleaned state in between.
  ipcMain.handle('graph:reingestRecordings', async (_event, arg: unknown) => {
    try {
      // Lazy import: pulling database.ts at module load drags config.ts ->
      // app.getPath() in, which some unit tests' electron mock doesn't provide.
      const { run, queryAll, runInTransaction } = await import('../services/database')
      const dryRun = !!(arg && typeof arg === 'object' && (arg as { dryRun?: unknown }).dryRun)

      // Scope: recordings with a live ingest marker (via their transcript).
      const scope = queryAll<{ recording_id: string; capture_id: string | null }>(
        `SELECT DISTINCT t.recording_id AS recording_id, kc.id AS capture_id
           FROM graph_ingested_transcripts git
           JOIN transcripts t ON t.id = git.transcript_id
           LEFT JOIN knowledge_captures kc ON kc.source_recording_id = t.recording_id
          ORDER BY t.recording_id`,
        []
      )

      let markersRemoved = 0
      let graphEdgesRemoved = 0
      let edgeSourceRowsRemoved = 0
      let orphanNodesRemoved = 0
      let sharedEdgesKept = 0
      let decisionsRemoved = 0
      let actionItemsRemoved = 0
      const perRecording: Array<Record<string, unknown>> = []

      for (const rec of scope) {
        const rid = rec.recording_id
        const captureId = rec.capture_id

        // Count B1 rows (both dry-run and real need the count for reporting).
        const decCount = captureId
          ? (queryAll<{ n: number }>('SELECT COUNT(*) AS n FROM decisions WHERE knowledge_capture_id = ?', [captureId])[0]?.n ?? 0)
          : 0
        const actCount = captureId
          ? (queryAll<{ n: number }>('SELECT COUNT(*) AS n FROM action_items WHERE knowledge_capture_id = ?', [captureId])[0]?.n ?? 0)
          : 0

        const apply = (): ReturnType<typeof removeRecordingProvenanceCore> => {
          const removal = removeRecordingProvenanceCore(rid, { dryRun })
          if (!dryRun && captureId) {
            run('DELETE FROM decisions WHERE knowledge_capture_id = ?', [captureId])
            run('DELETE FROM action_items WHERE knowledge_capture_id = ?', [captureId])
          }
          return removal
        }
        // Real run: removal + B1 delete atomic per recording. Dry run: no txn needed.
        const removal = dryRun ? apply() : runInTransaction(apply)

        markersRemoved += removal.markersRemoved
        graphEdgesRemoved += removal.edgesRemoved
        edgeSourceRowsRemoved += removal.edgeSourceRowsRemoved
        orphanNodesRemoved += removal.orphanNodesRemoved
        sharedEdgesKept += removal.sharedEdgesKept
        decisionsRemoved += decCount
        actionItemsRemoved += actCount
        perRecording.push({
          recordingId: rid,
          captureId,
          markersRemoved: removal.markersRemoved,
          edgesRemoved: removal.edgesRemoved,
          orphanNodesRemoved: removal.orphanNodesRemoved,
          sharedEdgesKept: removal.sharedEdgesKept,
          decisionsRemoved: decCount,
          actionItemsRemoved: actCount,
        })
      }

      return {
        success: true,
        data: {
          dryRun,
          recordingsInScope: scope.length,
          recordingIds: scope.map((r) => r.recording_id),
          totals: {
            markersRemoved,
            graphEdgesRemoved,
            edgeSourceRowsRemoved,
            orphanNodesRemoved,
            sharedEdgesKept,
            decisionsRemoved,
            actionItemsRemoved,
          },
          perRecording,
        },
      }
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e)
      console.error('[graph:reingestRecordings] Error:', e)
      return { success: false, error: msg }
    }
  })

  ipcMain.handle('graph:ingestFolder', async (_event, folderPath: unknown) => {
    try {
      if (!folderPath || typeof folderPath !== 'string') {
        return { success: false, error: 'folderPath must be a non-empty string' }
      }
      // Reject traversal attempts at the IPC layer
      if ((folderPath as string).includes('..')) {
        return { success: false, error: 'Path traversal not allowed' }
      }
      const result = await ingestFromFolder(folderPath as string)
      return { success: true, data: result }
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e)
      console.error('[graph:ingestFolder] Error:', e)
      return { success: false, error: msg }
    }
  })

  ipcMain.handle('graph:topAttendees', async (_event, name: unknown) => {
    try {
      if (!name || typeof name !== 'string') {
        return { success: false, error: 'name must be a non-empty string' }
      }
      return { success: true, data: queryTopAttendees(name as string) }
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e)
      console.error('[graph:topAttendees] Error:', e)
      return { success: false, error: msg }
    }
  })

  ipcMain.handle('graph:topSkill', async (_event, skill: unknown) => {
    try {
      if (!skill || typeof skill !== 'string') {
        return { success: false, error: 'skill must be a non-empty string' }
      }
      return { success: true, data: queryTopSkill(skill as string) }
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e)
      console.error('[graph:topSkill] Error:', e)
      return { success: false, error: msg }
    }
  })

  ipcMain.handle('graph:personProfile', async (_event, name: unknown) => {
    try {
      if (!name || typeof name !== 'string') {
        return { success: false, error: 'name must be a non-empty string' }
      }
      return { success: true, data: queryPersonProfile(name as string) }
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e)
      console.error('[graph:personProfile] Error:', e)
      return { success: false, error: msg }
    }
  })

  ipcMain.handle('graph:meetingGraph', async (_event, meetingId: unknown) => {
    try {
      if (!meetingId || typeof meetingId !== 'string') {
        return { success: false, error: 'meetingId must be a non-empty string' }
      }
      return { success: true, data: queryMeetingGraph(meetingId as string) }
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e)
      console.error('[graph:meetingGraph] Error:', e)
      return { success: false, error: msg }
    }
  })

  // graph:listNodes IPC REMOVED (ADV33-1, round 35): the handler returned raw
  // GraphNode objects (norm_key `contact:<id>` + props.contactId) after only an
  // edge-visibility check, so a graph-visible node backed by a SUPPRESSED contact
  // leaked that contact's id — bypassing the round-34 nodeToDTO fail-closed boundary.
  // The IPC had no renderer consumer (dead surface), so it is removed entirely
  // rather than re-DTO'd (round-13 dead-surface-removal lesson). The underlying
  // queryListNodes() export stays — it is still used internally by rag.ts grounding,
  // which never returns raw nodes to a non-owner surface.

  // graph:resolvePerson IPC REMOVED (ADV34-2, round 36): the handler called raw
  // getContactByName and returned the COMPLETE Contact (id/email/role/company/
  // notes/tags/provenance) with NO visibility filter, so an exact name for a
  // transcript-origin contact backed only by an excluded/hard-purged recording
  // leaked everything. It had no renderer consumer (dead surface), so it is
  // removed entirely rather than re-DTO'd (round-13 dead-surface-removal lesson).

  // -------------------------------------------------------------------------
  // Context Graph — interactive visualization + neighborhood retrieval
  // -------------------------------------------------------------------------

  ipcMain.handle('contextGraph:getGraph', async (_event, limit?: unknown) => {
    try {
      const cap = typeof limit === 'number' && limit > 0 ? Math.min(limit, 2000) : undefined
      return { success: true, data: queryContextGraph(cap) }
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e)
      console.error('[contextGraph:getGraph] Error:', e)
      return { success: false, error: msg }
    }
  })

  ipcMain.handle('contextGraph:getNeighborhood', async (_event, entityId: unknown, hops?: unknown) => {
    try {
      if (!entityId || typeof entityId !== 'string') {
        return { success: false, error: 'entityId must be a non-empty string' }
      }
      const h = typeof hops === 'number' ? hops : 1
      return { success: true, data: queryNeighborhood(entityId as string, h) }
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e)
      console.error('[contextGraph:getNeighborhood] Error:', e)
      return { success: false, error: msg }
    }
  })

  ipcMain.handle('contextGraph:search', async (_event, query: unknown) => {
    try {
      if (!query || typeof query !== 'string') {
        return { success: false, error: 'query must be a non-empty string' }
      }
      return { success: true, data: searchGraphNodes(query as string) }
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e)
      console.error('[contextGraph:search] Error:', e)
      return { success: false, error: msg }
    }
  })

  ipcMain.handle('contextGraph:rekey', async () => {
    try {
      return { success: true, data: rekeyExistingPersonNodes() }
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e)
      console.error('[contextGraph:rekey] Error:', e)
      return { success: false, error: msg }
    }
  })

  // Stratified, time-aware lens — a scoped, reasoning-level perspective. centerId
  // null → whole-graph lens (top-degree hubs). windowDays null → no time filter.
  ipcMain.handle(
    'contextGraph:getLens',
    async (_event, centerId?: unknown, hops?: unknown, windowDays?: unknown, cap?: unknown) => {
      try {
        const center = typeof centerId === 'string' && centerId.trim() ? centerId.trim() : null
        const h = typeof hops === 'number' && hops > 0 ? Math.min(hops, 3) : 2
        const w =
          windowDays === null || windowDays === undefined
            ? null
            : typeof windowDays === 'number' && windowDays > 0
              ? windowDays
              : null
        const c = typeof cap === 'number' && cap > 0 ? Math.min(cap, 400) : undefined
        return { success: true, data: queryLens(center, { hops: h, windowDays: w, cap: c }) }
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e)
        console.error('[contextGraph:getLens] Error:', e)
        return { success: false, error: msg }
      }
    }
  )

  // The default lens center: the owner's person node (when known) or the
  // highest-degree person. Optional ownerContactId biases the choice.
  ipcMain.handle('contextGraph:defaultCenter', async (_event, ownerContactId?: unknown) => {
    try {
      const owner = typeof ownerContactId === 'string' && ownerContactId.trim() ? ownerContactId.trim() : null
      return { success: true, data: pickLensCenter(owner) }
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e)
      console.error('[contextGraph:defaultCenter] Error:', e)
      return { success: false, error: msg }
    }
  })

  // Provenance trail for an entity — the evidence path + narrative behind it.
  ipcMain.handle('contextGraph:provenance', async (_event, entityId: unknown) => {
    try {
      if (!entityId || typeof entityId !== 'string') {
        return { success: false, error: 'entityId must be a non-empty string' }
      }
      return { success: true, data: queryProvenance(entityId as string) }
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e)
      console.error('[contextGraph:provenance] Error:', e)
      return { success: false, error: msg }
    }
  })

  // -------------------------------------------------------------------------
  // Node editing — discoverability + rename/convert/link/merge/remove
  // -------------------------------------------------------------------------

  // Rich detail for the node inspector: identity (linked vs. extracted), contact
  // facts + aliases, graph stats, and the provenance narrative.
  ipcMain.handle('contextGraph:nodeDetail', async (_event, entityId: unknown) => {
    try {
      if (!entityId || typeof entityId !== 'string') {
        return { success: false, error: 'entityId must be a non-empty string' }
      }
      return { success: true, data: getNodeDetail(entityId) }
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e)
      console.error('[contextGraph:nodeDetail] Error:', e)
      return { success: false, error: msg }
    }
  })

  // Correct an entity's name (canonical rename, not an alias). Propagates through
  // the contact record when linked; graph-only for a name-only node.
  ipcMain.handle('contextGraph:rename', async (_event, entityId: unknown, newLabel: unknown) => {
    try {
      if (!entityId || typeof entityId !== 'string') {
        return { success: false, error: 'entityId must be a non-empty string' }
      }
      if (!newLabel || typeof newLabel !== 'string' || !newLabel.trim()) {
        return { success: false, error: 'newLabel must be a non-empty string' }
      }
      return { success: true, data: renameGraphEntity(entityId, newLabel) }
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e)
      console.error('[contextGraph:rename] Error:', e)
      return { success: false, error: msg }
    }
  })

  // Turn a name-only person node into a real contact (or reuse an exact match),
  // binding it at the resolver's sovereign manual tier.
  ipcMain.handle('contextGraph:convertToContact', async (_event, entityId: unknown, opts?: unknown) => {
    try {
      if (!entityId || typeof entityId !== 'string') {
        return { success: false, error: 'entityId must be a non-empty string' }
      }
      const o = (opts && typeof opts === 'object' ? opts : {}) as {
        role?: string | null
        company?: string | null
        email?: string | null
      }
      return { success: true, data: convertNodeToContact(entityId, o) }
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e)
      console.error('[contextGraph:convertToContact] Error:', e)
      return { success: false, error: msg }
    }
  })

  // "This node IS person X" — bind an extracted node to an existing contact.
  ipcMain.handle('contextGraph:linkContact', async (_event, entityId: unknown, contactId: unknown) => {
    try {
      if (!entityId || typeof entityId !== 'string') {
        return { success: false, error: 'entityId must be a non-empty string' }
      }
      if (!contactId || typeof contactId !== 'string') {
        return { success: false, error: 'contactId must be a non-empty string' }
      }
      return { success: true, data: linkNodeToContact(entityId, contactId) }
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e)
      console.error('[contextGraph:linkContact] Error:', e)
      return { success: false, error: msg }
    }
  })

  // Set (or clear) a person node's pronouns.
  ipcMain.handle('contextGraph:setPronouns', async (_event, entityId: unknown, pronouns: unknown) => {
    try {
      if (!entityId || typeof entityId !== 'string') {
        return { success: false, error: 'entityId must be a non-empty string' }
      }
      const p = typeof pronouns === 'string' ? pronouns : ''
      return { success: true, data: setNodePronouns(entityId, p) }
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e)
      console.error('[contextGraph:setPronouns] Error:', e)
      return { success: false, error: msg }
    }
  })

  // Preview a two-node merge (blast radius) before committing.
  ipcMain.handle('contextGraph:mergePreview', async (_event, keeperId: unknown, loserId: unknown) => {
    try {
      if (!keeperId || typeof keeperId !== 'string' || !loserId || typeof loserId !== 'string') {
        return { success: false, error: 'keeperId and loserId must be non-empty strings' }
      }
      return { success: true, data: mergeGraphPreview(keeperId, loserId) }
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e)
      console.error('[contextGraph:mergePreview] Error:', e)
      return { success: false, error: msg }
    }
  })

  // Commit a two-node merge (loser folded into keeper; contacts merge when both linked).
  ipcMain.handle('contextGraph:mergeNodes', async (_event, keeperId: unknown, loserId: unknown) => {
    try {
      if (!keeperId || typeof keeperId !== 'string' || !loserId || typeof loserId !== 'string') {
        return { success: false, error: 'keeperId and loserId must be non-empty strings' }
      }
      return { success: true, data: mergeGraphNodes(keeperId, loserId) }
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e)
      console.error('[contextGraph:mergeNodes] Error:', e)
      return { success: false, error: msg }
    }
  })

  // Remove a junk node (and its edges) from the graph.
  ipcMain.handle('contextGraph:deleteNode', async (_event, entityId: unknown) => {
    try {
      if (!entityId || typeof entityId !== 'string') {
        return { success: false, error: 'entityId must be a non-empty string' }
      }
      return { success: true, data: deleteGraphNode(entityId) }
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e)
      console.error('[contextGraph:deleteNode] Error:', e)
      return { success: false, error: msg }
    }
  })

  // Prune generic "garbage" nodes (collective/role words) + their edges. Idempotent.
  ipcMain.handle('contextGraph:prune', async () => {
    try {
      return { success: true, data: pruneGenericGraphNodes() }
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e)
      console.error('[contextGraph:prune] Error:', e)
      return { success: false, error: msg }
    }
  })

  console.log('Knowledge Graph IPC handlers registered')
}
