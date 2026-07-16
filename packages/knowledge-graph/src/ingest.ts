import type { KnowledgeGraphStore, UpsertEdgeInput } from './graph-store.js'
import type { NodeType } from './schema.js'
import type { ExtractionResult, ExtractionMeta } from './extract.js'
import { isGenericEntityLabel } from './stop-list.js'

/**
 * Resolves a raw person name to a canonical contact identity. Injected by the
 * host (Electron wires it to the entity resolver); tests may omit it. Returning
 * `null` (or omitting the resolver) keeps the historical name-keyed behaviour.
 */
export type PersonResolver = (name: string) => { id: string; label?: string } | null

export interface IngestOptions {
  now?: string
  /** Resolve a person name → contact id so nodes are keyed by identity, not name. */
  resolvePerson?: PersonResolver
  /**
   * F18 (spec-004): the recording + transcript this ingest is attributing
   * edges to. When BOTH are supplied, every upserted edge gets a
   * `graph_edge_sources` row via `store.recordEdgeSource` — the provenance
   * that lets a hard-deleted recording's graph traces be removed precisely
   * (see `removeRecordingProvenance`). Omit both for a source with no
   * recording/transcript identity (e.g. folder ingest) — those edges are
   * intentionally left unattributed.
   */
  recordingId?: string
  transcriptId?: string
}

/**
 * Ingest an ExtractionResult into the knowledge graph.
 * Creates/upserts all nodes and edges. People are resolved to a stable identity:
 * with a `resolvePerson`, a matched person is keyed by `contact:<id>` (every name
 * variant folds into one node); otherwise the name is the key (legacy behaviour).
 *
 * The 4th argument accepts either a `now` string (legacy call sites) or an
 * `IngestOptions` object carrying `now` + `resolvePerson` (+ F18 provenance ids).
 */
export function ingestExtraction(
  store: KnowledgeGraphStore,
  extraction: ExtractionResult,
  meta: ExtractionMeta,
  optionsOrNow: string | IngestOptions = ''
): void {
  const options: IngestOptions =
    typeof optionsOrNow === 'string' ? { now: optionsOrNow } : optionsOrNow
  const now = options.now ?? ''
  const resolvePerson = options.resolvePerson

  // F18: provenance is recorded only when BOTH ids are present (a DB-transcript
  // ingest); folder ingest (no recordingId) intentionally writes no rows.
  const prov =
    options.recordingId && options.transcriptId
      ? { recordingId: options.recordingId, transcriptId: options.transcriptId }
      : null

  // ADV35-1 (round-37) — NODE-LEVEL provenance for the ISOLATED-node case (a risk
  // extracted without a raiser has NO edge, hence no edge-provenance to suppress by
  // after its recording is excluded). A recording-backed ingest stamps every node
  // 'derived' + source_recording_id so an edgeless one can still be suppressed;
  // folder ingest (no recordingId) has no recording to exclude, so its nodes are
  // 'manual' (always visible on non-owner surfaces). Stamped on INSERT only —
  // upsertNode keeps the first origin for a node that later accretes from another
  // recording (edge-provenance then governs the connected case).
  const nodeProvenance: { origin: 'derived' | 'manual'; sourceRecordingId: string | null } =
    options.recordingId
      ? { origin: 'derived', sourceRecordingId: options.recordingId }
      : { origin: 'manual', sourceRecordingId: null }

  /** Upsert an edge and, when provenance ids are present, record the source. */
  const linkEdge = (input: UpsertEdgeInput): string => {
    const edgeId = store.upsertEdge(input)
    if (prov) store.recordEdgeSource(edgeId, prov.recordingId, prov.transcriptId, now)
    return edgeId
  }

  /** Upsert any extraction node with the shared node-level provenance stamp. */
  const upsertDerivedNode = (input: {
    type: NodeType
    label: string
    key?: string
    props?: Record<string, unknown>
  }): string =>
    store.upsertNode({
      ...input,
      now,
      origin: nodeProvenance.origin,
      sourceRecordingId: nodeProvenance.sourceRecordingId,
    })

  /** Upsert a person node, keyed by contact id when the resolver matches. */
  const upsertPerson = (name: string): string => {
    const resolved = resolvePerson?.(name) ?? null
    if (resolved) {
      return upsertDerivedNode({
        type: 'person',
        label: resolved.label ?? name,
        key: `contact:${resolved.id}`,
        props: { contactId: resolved.id },
      })
    }
    return upsertDerivedNode({ type: 'person', label: name })
  }

  // Meeting node — F18: keyed by `meeting:<meta.meetingId>` (mirrors the
  // `contact:<id>` identity pattern) so recurring occurrences with the same
  // display title no longer fold into one node. Label stays the display
  // title; props.meetingId is unchanged (meetingSummaryGraph resolves by it).
  const meetingId = upsertDerivedNode({
    type: 'meeting',
    label: meta.title ?? meta.meetingId,
    key: `meeting:${meta.meetingId}`,
    props: { meetingId: meta.meetingId, date: meta.date ?? '' },
  })

  // People: ATTENDED meeting, DEMONSTRATED skills
  for (const person of extraction.people) {
    // Skip generic collective/role words ("All attendees", "Team", "el equipo")
    // — extraction noise that would otherwise become useless hub nodes.
    if (!person.name.trim() || isGenericEntityLabel(person.name)) continue
    const personId = upsertPerson(person.name)
    linkEdge({ sourceId: personId, targetId: meetingId, type: 'ATTENDED', now })
    linkEdge({ sourceId: meetingId, targetId: personId, type: 'MENTIONED', now })

    for (const skill of person.skills ?? []) {
      if (!skill.trim()) continue
      const skillId = upsertDerivedNode({ type: 'skill', label: skill })
      linkEdge({ sourceId: personId, targetId: skillId, type: 'DEMONSTRATED', now })
    }
  }

  // Topics: meeting ABOUT topic
  for (const topicLabel of extraction.topics) {
    if (!topicLabel.trim()) continue
    const topicId = upsertDerivedNode({ type: 'topic', label: topicLabel })
    linkEdge({ sourceId: meetingId, targetId: topicId, type: 'ABOUT', now })
  }

  // Projects: meeting ABOUT project
  for (const projectLabel of extraction.projects) {
    if (!projectLabel.trim()) continue
    const projectId = upsertDerivedNode({ type: 'project', label: projectLabel })
    linkEdge({ sourceId: meetingId, targetId: projectId, type: 'ABOUT', now })
  }

  // Decisions: MADE_IN meeting
  for (const decisionText of extraction.decisions) {
    if (!decisionText.trim()) continue
    const decisionId = upsertDerivedNode({ type: 'decision', label: decisionText })
    linkEdge({ sourceId: decisionId, targetId: meetingId, type: 'MADE_IN', now })
  }

  // Action items: person OWNS action_item
  for (const ai of extraction.action_items) {
    if (!ai.text.trim()) continue
    const aiId = upsertDerivedNode({ type: 'action_item', label: ai.text })
    if (ai.owner?.trim() && !isGenericEntityLabel(ai.owner)) {
      const ownerId = upsertPerson(ai.owner)
      linkEdge({ sourceId: ownerId, targetId: aiId, type: 'OWNS', now })
    }
    linkEdge({ sourceId: meetingId, targetId: aiId, type: 'ABOUT', now })
  }

  // Risks: person RAISED risk
  for (const risk of extraction.risks) {
    if (!risk.text.trim()) continue
    const riskId = upsertDerivedNode({ type: 'risk', label: risk.text })
    if (risk.raised_by?.trim() && !isGenericEntityLabel(risk.raised_by)) {
      const raiserId = upsertPerson(risk.raised_by)
      linkEdge({ sourceId: raiserId, targetId: riskId, type: 'RAISED', now })
    }
  }

  // Next steps: meeting HAS_NEXT_STEP
  for (const ns of extraction.next_steps) {
    if (!ns.trim()) continue
    const nsId = upsertDerivedNode({ type: 'next_step', label: ns })
    linkEdge({ sourceId: meetingId, targetId: nsId, type: 'HAS_NEXT_STEP', now })
  }
}
