import type { KnowledgeGraphStore } from './graph-store.js'
import type { ExtractionResult, ExtractionMeta } from './extract.js'

/**
 * Ingest an ExtractionResult into the knowledge graph.
 * Creates/upserts all nodes and edges. People resolved by norm_key across meetings.
 */
export function ingestExtraction(
  store: KnowledgeGraphStore,
  extraction: ExtractionResult,
  meta: ExtractionMeta,
  now = ''
): void {
  // Meeting node
  const meetingId = store.upsertNode({
    type: 'meeting',
    label: meta.title ?? meta.meetingId,
    props: { meetingId: meta.meetingId, date: meta.date ?? '' },
    now,
  })

  // People: ATTENDED meeting, DEMONSTRATED skills
  for (const person of extraction.people) {
    if (!person.name.trim()) continue
    const personId = store.upsertNode({ type: 'person', label: person.name, now })
    store.upsertEdge({ sourceId: personId, targetId: meetingId, type: 'ATTENDED', now })
    store.upsertEdge({ sourceId: meetingId, targetId: personId, type: 'MENTIONED', now })

    for (const skill of person.skills ?? []) {
      if (!skill.trim()) continue
      const skillId = store.upsertNode({ type: 'skill', label: skill, now })
      store.upsertEdge({ sourceId: personId, targetId: skillId, type: 'DEMONSTRATED', now })
    }
  }

  // Topics: meeting ABOUT topic
  for (const topicLabel of extraction.topics) {
    if (!topicLabel.trim()) continue
    const topicId = store.upsertNode({ type: 'topic', label: topicLabel, now })
    store.upsertEdge({ sourceId: meetingId, targetId: topicId, type: 'ABOUT', now })
  }

  // Projects: meeting ABOUT project
  for (const projectLabel of extraction.projects) {
    if (!projectLabel.trim()) continue
    const projectId = store.upsertNode({ type: 'project', label: projectLabel, now })
    store.upsertEdge({ sourceId: meetingId, targetId: projectId, type: 'ABOUT', now })
  }

  // Decisions: MADE_IN meeting
  for (const decisionText of extraction.decisions) {
    if (!decisionText.trim()) continue
    const decisionId = store.upsertNode({ type: 'decision', label: decisionText, now })
    store.upsertEdge({ sourceId: decisionId, targetId: meetingId, type: 'MADE_IN', now })
  }

  // Action items: person OWNS action_item
  for (const ai of extraction.action_items) {
    if (!ai.text.trim()) continue
    const aiId = store.upsertNode({ type: 'action_item', label: ai.text, now })
    if (ai.owner?.trim()) {
      const ownerId = store.upsertNode({ type: 'person', label: ai.owner, now })
      store.upsertEdge({ sourceId: ownerId, targetId: aiId, type: 'OWNS', now })
    }
    store.upsertEdge({ sourceId: meetingId, targetId: aiId, type: 'ABOUT', now })
  }

  // Risks: person RAISED risk
  for (const risk of extraction.risks) {
    if (!risk.text.trim()) continue
    const riskId = store.upsertNode({ type: 'risk', label: risk.text, now })
    if (risk.raised_by?.trim()) {
      const raiserId = store.upsertNode({ type: 'person', label: risk.raised_by, now })
      store.upsertEdge({ sourceId: raiserId, targetId: riskId, type: 'RAISED', now })
    }
  }

  // Next steps: meeting HAS_NEXT_STEP
  for (const ns of extraction.next_steps) {
    if (!ns.trim()) continue
    const nsId = store.upsertNode({ type: 'next_step', label: ns, now })
    store.upsertEdge({ sourceId: meetingId, targetId: nsId, type: 'HAS_NEXT_STEP', now })
  }
}
