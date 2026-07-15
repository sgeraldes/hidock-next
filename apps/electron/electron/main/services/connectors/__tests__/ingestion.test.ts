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
}))
vi.mock('../../artifact-service', () => ({ importArtifact: vi.fn() }))

import { externalMeetingToRow, extensionForItem, ConnectorIngestionSink, type IngestionDeps } from '../ingestion'
import type { ExternalMeeting, ExternalPerson, SourceContainer, SourceItem } from '@hidock/connectors'

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

function fakeDeps(): IngestionDeps & { upserted: any[]; contacts: ExternalPerson[]; imported: any[] } {
  const upserted: any[] = []
  const contacts: ExternalPerson[] = []
  const imported: any[] = []
  return {
    upserted,
    contacts,
    imported,
    upsertMeetings: (rows) => upserted.push(...rows),
    applyContact: (p) => {
      contacts.push(p)
      return 'created'
    },
    importArtifactFile: async (filePath, opts) => {
      imported.push({ filePath, opts })
      return { deduped: false }
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
    expect(outcome.skipped).toBe(0)

    expect(deps.upserted[0].id).toBe('m365:evt1')
    expect(deps.contacts[0].email).toBe('c@x.com')
    expect(deps.imported[0].opts).toEqual({ sourceConnectorId: 'm365', sourceRef: 'msg-1' })
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
