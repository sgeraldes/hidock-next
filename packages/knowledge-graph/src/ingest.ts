import type { KnowledgeGraphStore, UpsertEdgeInput } from './graph-store.js'
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

  /** Upsert an edge and, when provenance ids are present, record the source. */
  const linkEdge = (input: UpsertEdgeInput): string => {
    const edgeId = store.upsertEdge(input)
    if (prov) store.recordEdgeSource(edgeId, prov.recordingId, prov.transcriptId, now)
    return edgeId
  }

  /** Upsert a person node, keyed by contact id when the resolver matches. */
  const upsertPerson = (name: string): string => {
    const resolved = resolvePerson?.(name) ?? null
    if (resolved) {
      return store.upsertNode({
        type: 'person',
        label: resolved.label ?? name,
        key: `contact:${resolved.id}`,
        props: { contactId: resolved.id },
        now,
      })
    }
    return store.upsertNode({ type: 'person', label: name, now })
  }

  // Meeting node — F18: keyed by `meeting:<meta.meetingId>` (mirrors the
  // `contact:<id>` identity pattern) so recurring occurrences with the same
  // display title no longer fold into one node. Label stays the display
  // title; props.meetingId is unchanged (meetingSummaryGraph resolves by it).
  const meetingId = store.upsertNode({
    type: 'meeting',
    label: meta.title ?? meta.meetingId,
    key: `meeting:${meta.meetingId}`,
    props: { meetingId: meta.meetingId, date: meta.date ?? '' },
    now,
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
      const skillId = store.upsertNode({ type: 'skill', label: skill, now })
      linkEdge({ sourceId: personId, targetId: skillId, type: 'DEMONSTRATED', now })
    }
  }

  // Topics: meeting ABOUT topic
  for (const topicLabel of extraction.topics) {
    if (!topicLabel.trim()) continue
    const topicId = store.upsertNode({ type: 'topic', label: topicLabel, now })
    linkEdge({ sourceId: meetingId, targetId: topicId, type: 'ABOUT', now })
  }

  // Projects: meeting ABOUT project
  for (const projectLabel of extraction.projects) {
    if (!projectLabel.trim()) continue
    const projectId = store.upsertNode({ type: 'project', label: projectLabel, now })
    linkEdge({ sourceId: meetingId, targetId: projectId, type: 'ABOUT', now })
  }

  // Decisions: MADE_IN meeting
  for (const decisionText of extraction.decisions) {
    if (!decisionText.trim()) continue
    const decisionId = store.upsertNode({ type: 'decision', label: decisionText, now })
    linkEdge({ sourceId: decisionId, targetId: meetingId, type: 'MADE_IN', now })
  }

  // Action items: person OWNS action_item
  for (const ai of extraction.action_items) {
    if (!ai.text.trim()) continue
    const aiId = store.upsertNode({ type: 'action_item', label: ai.text, now })
    if (ai.owner?.trim() && !isGenericEntityLabel(ai.owner)) {
      const ownerId = upsertPerson(ai.owner)
      linkEdge({ sourceId: ownerId, targetId: aiId, type: 'OWNS', now })
    }
    linkEdge({ sourceId: meetingId, targetId: aiId, type: 'ABOUT', now })
  }

  // Risks: person RAISED risk
  for (const risk of extraction.risks) {
    if (!risk.text.trim()) continue
    const riskId = store.upsertNode({ type: 'risk', label: risk.text, now })
    if (risk.raised_by?.trim() && !isGenericEntityLabel(risk.raised_by)) {
      const raiserId = upsertPerson(risk.raised_by)
      linkEdge({ sourceId: raiserId, targetId: riskId, type: 'RAISED', now })
    }
  }

  // Next steps: meeting HAS_NEXT_STEP
  for (const ns of extraction.next_steps) {
    if (!ns.trim()) continue
    const nsId = store.upsertNode({ type: 'next_step', label: ns, now })
    linkEdge({ sourceId: meetingId, targetId: nsId, type: 'HAS_NEXT_STEP', now })
  }
}
