import { describe, it, expect, vi } from 'vitest'
import { readdirSync } from 'fs'
import { tmpdir } from 'os'

// Replace the electron-dependent modules so importing ingestion.ts doesn't pull
// in config.ts (which calls app.getPath at module load). The sink under test is
// exercised with injected deps, so these stubs are never actually invoked.
vi.mock('../../database', () => ({
  upsertMeetingsBatch: vi.fn(),
  getContactByEmail: vi.fn(),
  createContact: vi.fn(),
  updateContact: vi.fn(),
  upsertConnectorKnowledgeItem: vi.fn(),
}))
vi.mock('../../artifact-service', () => ({ importArtifact: vi.fn() }))

import {
  externalMeetingToRow,
  extensionForItem,
  sourceItemToConnectorKnowledgeItem,
  ConnectorIngestionSink,
  type IngestionDeps,
} from '../ingestion'
import type { ExternalMeeting, ExternalPerson, ExternalRisk, SourceContainer, SourceItem } from '@hidock/connectors'

const container: SourceContainer = { externalId: 'calendar', name: 'Calendar', kind: 'calendar' }

const meeting: ExternalMeeting = {
  externalId: 'evt1',
  title: 'Sync',
  start: '2026-07-09T10:00:00.000Z',
  end: '2026-07-09T11:00:00.000Z',
  organizer: { externalId: 'a@x.com', name: 'Alice', email: 'a@x.com' },
  attendees: [{ externalId: 'b@x.com', name: 'Bob', email: 'b@x.com' }],
  metadata: { seriesMasterId: 'series-1' },
  onlineJoinUrl: 'https://teams/join',
}

const person: ExternalPerson = { externalId: 'c@x.com', name: 'Carol', email: 'c@x.com', title: 'PM', company: 'Contoso' }

function fakeDeps(): IngestionDeps & {
  upserted: any[]
  contacts: ExternalPerson[]
  imported: any[]
  knowledgeItems: any[]
} {
  const upserted: any[] = []
  const contacts: ExternalPerson[] = []
  const imported: any[] = []
  const knowledgeItems: any[] = []
  return {
    upserted,
    contacts,
    imported,
    knowledgeItems,
    upsertMeetings: (rows) => upserted.push(...rows),
    applyContact: (p) => {
      contacts.push(p)
      return 'created'
    },
    importArtifactFile: async (filePath, opts) => {
      imported.push({ filePath, opts })
      return { deduped: false }
    },
    applyConnectorKnowledgeItem: (connectorId, sourceRef, item) => {
      knowledgeItems.push({ connectorId, sourceRef, item })
      return { captureId: 'kc-fake', itemId: 'item-fake', action: 'created' }
    },
  }
}

describe('externalMeetingToRow', () => {
  it('maps a meeting to a row with a deterministic id and attendee JSON', () => {
    const row = externalMeetingToRow('m365', meeting)
    expect(row.id).toBe('m365:evt1')
    expect(row.subject).toBe('Sync')
    expect(row.organizer_email).toBe('a@x.com')
    expect(JSON.parse(row.attendees!)).toEqual([{ name: 'Bob', email: 'b@x.com' }])
    expect(row.is_recurring).toBe(1) // seriesMasterId present
    expect(row.meeting_url).toBe('https://teams/join')
  })

  it('preserves omitted attendees while mapping an explicit empty list', () => {
    expect(externalMeetingToRow('m365', { ...meeting, attendees: undefined }).attendees).toBeUndefined()
    expect(externalMeetingToRow('m365', { ...meeting, attendees: [] }).attendees).toBe('[]')
  })
})

describe('extensionForItem', () => {
  it('derives extension from mime then kind', () => {
    expect(extensionForItem({ mime: 'image/png', kind: 'image' } as SourceItem)).toBe('png')
    expect(extensionForItem({ mime: 'text/markdown', kind: 'message' } as SourceItem)).toBe('md')
    expect(extensionForItem({ mime: '', kind: 'message' } as SourceItem)).toBe('md')
    expect(extensionForItem({ mime: '', kind: 'weird' } as SourceItem)).toBe('txt')
  })
})

describe('ConnectorIngestionSink routing', () => {
  it('routes meeting → upsertMeetings, contact → applyContact, other → importArtifact', async () => {
    const deps = fakeDeps()
    const sink = new ConnectorIngestionSink(deps)

    const items: SourceItem[] = [
      { externalId: 'evt1', kind: 'meeting', mime: 'application/json', createdAt: meeting.start, entity: meeting },
      { externalId: 'c@x.com', kind: 'contact', mime: 'application/json', createdAt: '2026-07-09T00:00:00Z', entity: person },
      { externalId: 'msg-1', kind: 'message', mime: 'text/markdown', text: '# hello', createdAt: '2026-07-09T00:00:00Z' },
    ]

    const outcome = await sink.ingest('m365', container, items)
    expect(outcome.meetings).toBe(1)
    expect(outcome.contacts).toBe(1)
    expect(outcome.artifacts).toBe(1)
    expect(outcome.knowledgeItems).toBe(0)
    expect(outcome.skipped).toBe(0)

    expect(deps.upserted[0].id).toBe('m365:evt1')
    expect(deps.contacts[0].email).toBe('c@x.com')
    expect(deps.imported[0].opts).toEqual({ sourceConnectorId: 'm365', sourceRef: 'msg-1', title: undefined })
  })

  it('skips artifact items with neither text nor url', async () => {
    const deps = fakeDeps()
    const sink = new ConnectorIngestionSink(deps)
    const items: SourceItem[] = [
      { externalId: 'x', kind: 'image', mime: 'image/png', createdAt: '2026-07-09T00:00:00Z' },
    ]
    // stageArtifact mkdtemps its staging dir BEFORE it knows the item is
    // unfetchable — a skipped item must not strand that dir in %TEMP%.
    const before = new Set(readdirSync(tmpdir()).filter((n) => n.startsWith('hidock-conn-')))
    const outcome = await sink.ingest('slack', container, items)
    expect(outcome.artifacts).toBe(0)
    expect(outcome.skipped).toBe(1)
    const leaked = readdirSync(tmpdir()).filter((n) => n.startsWith('hidock-conn-') && !before.has(n))
    expect(leaked).toEqual([])
  })

  it('batches multiple meetings into a single upsert call', async () => {
    const deps = fakeDeps()
    const spy = vi.spyOn(deps, 'upsertMeetings')
    const sink = new ConnectorIngestionSink(deps)
    const items: SourceItem[] = [
      { externalId: 'e1', kind: 'meeting', mime: 'application/json', createdAt: meeting.start, entity: { ...meeting, externalId: 'e1' } },
      { externalId: 'e2', kind: 'meeting', mime: 'application/json', createdAt: meeting.start, entity: { ...meeting, externalId: 'e2' } },
    ]
    const outcome = await sink.ingest('m365', container, items)
    expect(outcome.meetings).toBe(2)
    expect(spy).toHaveBeenCalledTimes(1)
    expect(spy.mock.calls[0][0]).toHaveLength(2)
  })
})

describe('ConnectorIngestionSink structured knowledge routing (v55)', () => {
  it('routes decision/action_item/risk/question kinds to applyConnectorKnowledgeItem, keyed on externalId', async () => {
    const deps = fakeDeps()
    const sink = new ConnectorIngestionSink(deps)
    const risk: ExternalRisk = { content: 'Vendor SLA may slip', severity: 'high', owner: 'Kelly' }
    const items: SourceItem[] = [
      {
        externalId: 'risk-1',
        kind: 'risk',
        mime: 'application/json',
        createdAt: '2026-07-09T00:00:00Z',
        entity: risk,
      },
    ]

    const outcome = await sink.ingest('littlebird-relay', container, items)
    expect(outcome.knowledgeItems).toBe(1)
    expect(outcome.skipped).toBe(0)
    expect(deps.knowledgeItems[0].connectorId).toBe('littlebird-relay')
    expect(deps.knowledgeItems[0].sourceRef).toBe('risk-1')
    expect(deps.knowledgeItems[0].item).toEqual({
      kind: 'risk',
      title: 'Vendor SLA may slip',
      content: 'Vendor SLA may slip',
      extractedFrom: null,
      context: null,
      owner: 'Kelly',
      mitigation: null,
      severity: 'high',
      likelihood: null,
      status: null,
      identifiedAt: null,
      certainty: null,
      evidence: null,
    })
  })
})

describe('sourceItemToConnectorKnowledgeItem', () => {
  it('falls back to a truncated content as title when the item has none', () => {
    const item: SourceItem = {
      externalId: 'q-1',
      kind: 'question',
      mime: 'application/json',
      createdAt: '2026-07-09T00:00:00Z',
      entity: { content: 'Who owns the migration cutover date?', raisedBy: 'Kelly' },
    }
    const mapped = sourceItemToConnectorKnowledgeItem(item)
    expect(mapped.kind).toBe('question')
    expect(mapped.title).toBe('Who owns the migration cutover date?')
    expect(mapped.raisedBy).toBe('Kelly')
  })

  // v56 — certainty/evidence passthrough
  it('passes certainty and evidence through for a decision', () => {
    const item: SourceItem = {
      externalId: 'd-1',
      kind: 'decision',
      mime: 'application/json',
      title: 'Ollama switch',
      createdAt: '2026-09-04T00:00:00Z',
      entity: {
        content: 'Switch to Ollama',
        certainty: 'proposed',
        evidence: 'Slack thread #eng, msg 1699',
        supersededBy: null,
      },
    }
    const mapped = sourceItemToConnectorKnowledgeItem(item)
    expect(mapped.certainty).toBe('proposed')
    expect(mapped.evidence).toBe('Slack thread #eng, msg 1699')
    expect(mapped.supersededBy).toBeNull()
  })

  it('defaults certainty and evidence to null when the source omits them, for every kind', () => {
    const decision = sourceItemToConnectorKnowledgeItem({
      externalId: 'd-2', kind: 'decision', mime: 'application/json', createdAt: '2026-09-04T00:00:00Z',
      entity: { content: 'A decision' },
    })
    const action = sourceItemToConnectorKnowledgeItem({
      externalId: 'a-1', kind: 'action_item', mime: 'application/json', createdAt: '2026-09-04T00:00:00Z',
      entity: { content: 'An action' },
    })
    const risk = sourceItemToConnectorKnowledgeItem({
      externalId: 'r-2', kind: 'risk', mime: 'application/json', createdAt: '2026-09-04T00:00:00Z',
      entity: { content: 'A risk' },
    })
    const question = sourceItemToConnectorKnowledgeItem({
      externalId: 'q-3', kind: 'question', mime: 'application/json', createdAt: '2026-09-04T00:00:00Z',
      entity: { content: 'A question' },
    })
    for (const mapped of [decision, action, risk, question]) {
      expect(mapped.certainty ?? null).toBeNull()
      expect(mapped.evidence ?? null).toBeNull()
    }
  })

  it('passes certainty and evidence through for a risk and a question', () => {
    const risk = sourceItemToConnectorKnowledgeItem({
      externalId: 'r-1',
      kind: 'risk',
      mime: 'application/json',
      createdAt: '2026-09-04T00:00:00Z',
      entity: { content: 'Vendor SLA may slip', severity: 'high', certainty: 'assumed', evidence: 'Vendor email 2026-09-01' },
    })
    expect(risk.certainty).toBe('assumed')
    expect(risk.evidence).toBe('Vendor email 2026-09-01')

    const question = sourceItemToConnectorKnowledgeItem({
      externalId: 'q-2',
      kind: 'question',
      mime: 'application/json',
      createdAt: '2026-09-04T00:00:00Z',
      entity: { content: 'Who owns cutover date?', certainty: 'confirmed', evidence: 'Meeting transcript, 14:02' },
    })
    expect(question.certainty).toBe('confirmed')
    expect(question.evidence).toBe('Meeting transcript, 14:02')
  })
})
