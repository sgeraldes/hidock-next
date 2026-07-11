/**
 * Living knowledge graph — event-driven sync (Round 4a).
 *
 * The graph stops being a manual, name-keyed snapshot: entity mutations emit
 * domain events, and this subscriber keeps the graph in step.
 *
 *  - entity:contact-changed (rename/merge): direct, LLM-free node surgery —
 *    rename a person node's label/norm_key, or fold one person node into another
 *    and repoint its edges.
 *  - entity:transcript-ready: debounced (60s) auto-ingest of only the new
 *    transcripts (ingestFromDbTranscripts already skips ingested ones), and only
 *    when an AI provider is configured (it throws otherwise — swallowed + logged).
 *
 * Every handler is guarded so a graph failure never breaks the pipeline.
 */

import type { KnowledgeGraphStore } from '@hidock/knowledge-graph'
import { getEventBus, type ContactChangedEvent, type TranscriptReadyEvent } from './event-bus'
import { getKnowledgeGraphStore, ingestFromDbTranscripts } from './knowledge-graph-service'
import { normalizeName } from './entity-normalize'

interface GraphNodeRow {
  id: string
  label: string
  norm_key: string
}

/**
 * Rename person node `oldName` → `newName`, or fold it into an existing
 * `newName` node. Pure surgery on the given store (no LLM, no event bus) so it
 * is unit-testable against an in-memory graph.
 *
 * Returns what happened: 'noop' (nothing to do), 'renamed' (in-place relabel),
 * or 'merged' (loser folded into an existing keeper, edges repointed).
 */
export function renameOrMergePersonNode(
  store: KnowledgeGraphStore,
  oldName: string,
  newName: string
): 'noop' | 'renamed' | 'merged' {
  const db = store.db
  const oldKey = normalizeName(oldName || '')
  const newKey = normalizeName(newName || '')
  if (!oldKey || !newKey || oldKey === newKey) return 'noop'

  const loser = db.queryOne<GraphNodeRow>(
    "SELECT id, label, norm_key FROM graph_nodes WHERE type = 'person' AND norm_key = ?",
    [oldKey]
  )
  if (!loser) return 'noop'

  const keeper = db.queryOne<GraphNodeRow>(
    "SELECT id, label, norm_key FROM graph_nodes WHERE type = 'person' AND norm_key = ?",
    [newKey]
  )

  const now = new Date().toISOString()

  if (!keeper) {
    // No node at the new name — a simple in-place relabel. Edges reference the
    // node id (unchanged), so nothing else needs repointing.
    db.run('UPDATE graph_nodes SET label = ?, norm_key = ?, updated_at = ? WHERE id = ?', [
      newName,
      newKey,
      now,
      loser.id
    ])
    return 'renamed'
  }

  if (keeper.id === loser.id) return 'noop'

  // A node already exists at the new name — fold the loser into it. Repoint
  // edges (UNIQUE(source,target,type) may collide → move what fits, drop the
  // rest), then delete the loser node.
  db.run('UPDATE OR IGNORE graph_edges SET source_id = ? WHERE source_id = ?', [keeper.id, loser.id])
  db.run('DELETE FROM graph_edges WHERE source_id = ?', [loser.id])
  db.run('UPDATE OR IGNORE graph_edges SET target_id = ? WHERE target_id = ?', [keeper.id, loser.id])
  db.run('DELETE FROM graph_edges WHERE target_id = ?', [loser.id])
  db.run('DELETE FROM graph_nodes WHERE id = ?', [loser.id])
  return 'merged'
}

// ---------------------------------------------------------------------------
// Event wiring
// ---------------------------------------------------------------------------

const INGEST_DEBOUNCE_MS = 60_000
let ingestTimer: ReturnType<typeof setTimeout> | null = null
let started = false
/** Event-bus unsubscribe handles, so the feature can be stopped at runtime. */
let unsubscribers: Array<() => void> = []

/** Debounced auto-ingest of new transcripts; swallows a missing-provider error. */
function scheduleIngest(): void {
  if (ingestTimer) clearTimeout(ingestTimer)
  ingestTimer = setTimeout(() => {
    ingestTimer = null
    ingestFromDbTranscripts()
      .then((r) => {
        if (r.ingested > 0) {
          console.log(`[GraphSync] Auto-ingested ${r.ingested} new transcript(s) into the graph`)
          // Announce that the graph ACTUALLY changed — consumers caching graph
          // lookups (e.g. rag.ts's entity-detection index) invalidate on THIS,
          // not on entity:transcript-ready, which fires ~60s BEFORE the ingest
          // commits and would re-cache the old graph.
          try {
            getEventBus().emitDomainEvent({
              type: 'graph:ingested',
              timestamp: new Date().toISOString(),
              payload: { ingested: r.ingested },
            })
          } catch (e) {
            console.warn('[GraphSync] graph:ingested emit failed:', e)
          }
        }
      })
      .catch((e) => {
        // No provider configured (or a transient LLM error) — never fatal.
        console.warn('[GraphSync] Auto-ingest skipped:', e instanceof Error ? e.message : String(e))
      })
  }, INGEST_DEBOUNCE_MS)
}

/**
 * Subscribe the living-graph handlers to the domain event bus. Idempotent —
 * safe to call once at startup. Wire from index.ts like other services.
 */
export function startGraphSync(): void {
  if (started) return
  started = true
  const bus = getEventBus()

  unsubscribers.push(
    bus.onDomainEvent<ContactChangedEvent>(
      'entity:contact-changed',
      (event) => {
        try {
          const { oldName, newName } = event.payload || {}
          if (!oldName || !newName) return
          const store = getKnowledgeGraphStore()
          const outcome = renameOrMergePersonNode(store, oldName, newName)
          if (outcome !== 'noop') {
            console.log(`[GraphSync] Person node ${outcome}: "${oldName}" → "${newName}"`)
          }
        } catch (e) {
          console.warn('[GraphSync] contact-changed surgery failed:', e)
        }
      }
    )
  )

  unsubscribers.push(
    bus.onDomainEvent<TranscriptReadyEvent>(
      'entity:transcript-ready',
      () => {
        try {
          scheduleIngest()
        } catch (e) {
          console.warn('[GraphSync] transcript-ready scheduling failed:', e)
        }
      }
    )
  )

  console.log('[GraphSync] Living knowledge graph sync started')
}

/**
 * Runtime stop for the Context Graph feature (Track I). Unsubscribes from the
 * event bus and clears the pending debounced ingest so no further graph work
 * happens while the feature is disabled. Idempotent; startGraphSync() re-arms it.
 */
export function stopGraphSync(): void {
  if (!started) return
  started = false
  for (const off of unsubscribers) {
    try {
      off()
    } catch {
      /* best-effort unsubscribe */
    }
  }
  unsubscribers = []
  if (ingestTimer) {
    clearTimeout(ingestTimer)
    ingestTimer = null
  }
  console.log('[GraphSync] Living knowledge graph sync stopped')
}
