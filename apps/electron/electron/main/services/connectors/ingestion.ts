/**
 * Ingestion sink — routes connector-emitted SourceItems into the EXISTING
 * pipelines (CONNECTORS.md Layer 2 → Layer 1/3):
 *
 *   kind 'meeting'  → calendar-sync meeting upsert (upsertMeetingsBatch, which
 *                     also auto-extracts People from organizer + attendees).
 *   kind 'contact'  → contacts (+ the resolver via email match).
 *   everything else → artifact-service.importArtifact (text/binary staged to a
 *                     temp file), carrying source_connector_id + source_ref for
 *                     dedup + incremental replace.
 *
 * Pure mappers are exported for unit testing; the db/artifact dependencies are
 * injectable so routing can be tested without a live database.
 */
import { randomUUID } from 'crypto'
import { writeFileSync, rmSync, mkdtempSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import type {
  ExternalMeeting,
  ExternalPerson,
  IngestionOutcome,
  IngestionSink,
  SourceContainer,
  SourceItem,
} from '@hidock/connectors'
import {
  upsertMeetingsBatch,
  getContactByEmail,
  createContact,
  updateContact,
  type Meeting,
} from '../database'
import { importArtifact } from '../artifact-service'

type MeetingRow = Omit<Meeting, 'created_at' | 'updated_at'>

/** Pure: map an ExternalMeeting to a meetings-table row. Deterministic id per source. */
export function externalMeetingToRow(connectorId: string, m: ExternalMeeting): MeetingRow {
  return {
    id: `${connectorId}:${m.externalId}`,
    subject: m.title,
    start_time: m.start,
    end_time: m.end,
    location: m.location ?? null,
    organizer_name: m.organizer?.name ?? null,
    organizer_email: m.organizer?.email ?? null,
    attendees: JSON.stringify(m.attendees.map((a) => ({ name: a.name, email: a.email }))),
    description: m.description ?? null,
    is_recurring: m.metadata?.seriesMasterId ? 1 : 0,
    meeting_url: m.onlineJoinUrl,
    is_all_day: 0,
    all_day_date: null,
  }
}

/** Pick a file extension for an artifact SourceItem from its mime, then kind. */
export function extensionForItem(item: SourceItem): string {
  const mime = (item.mime || '').toLowerCase()
  if (mime.includes('png')) return 'png'
  if (mime.includes('jpeg') || mime.includes('jpg')) return 'jpg'
  if (mime.includes('gif')) return 'gif'
  if (mime.includes('webp')) return 'webp'
  if (mime.includes('pdf')) return 'pdf'
  if (mime.includes('markdown')) return 'md'
  if (mime.includes('json')) return 'json'
  if (mime.includes('plain')) return 'txt'
  const kind = (item.kind || '').toLowerCase()
  if (kind === 'image') return 'png'
  if (kind === 'md' || kind === 'message') return 'md'
  if (kind === 'pdf') return 'pdf'
  return 'txt'
}

export interface IngestionDeps {
  upsertMeetings: (rows: MeetingRow[]) => void
  /** Apply a standalone external contact; returns whether it was created/updated. */
  applyContact: (p: ExternalPerson) => 'created' | 'updated'
  importArtifactFile: (filePath: string, opts: { sourceConnectorId: string; sourceRef: string }) => Promise<unknown>
}

/** Default contact apply: enrich an email-matched contact, else create a fresh one. */
function defaultApplyContact(p: ExternalPerson): 'created' | 'updated' {
  const existing = p.email ? getContactByEmail(p.email) : undefined
  if (existing) {
    updateContact(existing.id, {
      name: existing.name || p.name,
      role: p.title ?? existing.role,
      company: p.company ?? existing.company,
    })
    return 'updated'
  }
  // v45/round-28: connector-imported people are structural (calendar/directory),
  // NOT transcript-extracted ⇒ entity source 'calendar' (always visible).
  createContact({ name: p.name, email: p.email ?? null, role: p.title ?? null, company: p.company ?? null, source: 'calendar' })
  return 'created'
}

const DEFAULT_DEPS: IngestionDeps = {
  upsertMeetings: (rows) => upsertMeetingsBatch(rows),
  applyContact: defaultApplyContact,
  importArtifactFile: (filePath, opts) => importArtifact(filePath, opts),
}

export class ConnectorIngestionSink implements IngestionSink {
  constructor(private readonly deps: IngestionDeps = DEFAULT_DEPS) {}

  async ingest(connectorId: string, _container: SourceContainer, items: SourceItem[]): Promise<IngestionOutcome> {
    const outcome: IngestionOutcome = { meetings: 0, contacts: 0, artifacts: 0, skipped: 0 }
    const meetingRows: MeetingRow[] = []

    for (const item of items) {
      try {
        if (item.kind === 'meeting' && item.entity && 'attendees' in item.entity) {
          meetingRows.push(externalMeetingToRow(connectorId, item.entity as ExternalMeeting))
        } else if (item.kind === 'contact' && item.entity && !('attendees' in item.entity)) {
          this.deps.applyContact(item.entity as ExternalPerson)
          outcome.contacts++
        } else {
          const staged = await this.stageArtifact(item)
          if (!staged) {
            outcome.skipped++
            continue
          }
          try {
            await this.deps.importArtifactFile(staged, { sourceConnectorId: connectorId, sourceRef: item.externalId })
            outcome.artifacts++
          } finally {
            try {
              rmSync(staged, { force: true })
              rmSync(join(staged, '..'), { recursive: true, force: true })
            } catch {
              /* best-effort temp cleanup */
            }
          }
        }
      } catch {
        outcome.skipped++
      }
    }

    if (meetingRows.length > 0) {
      this.deps.upsertMeetings(meetingRows)
      outcome.meetings += meetingRows.length
    }
    return outcome
  }

  /** Stage an artifact item to a temp file; returns the path or null if unfetchable. */
  private async stageArtifact(item: SourceItem): Promise<string | null> {
    const dir = mkdtempSync(join(tmpdir(), 'hidock-conn-'))
    const safeName = (item.externalId || randomUUID()).replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 64)
    const filePath = join(dir, `${safeName}.${extensionForItem(item)}`)

    if (item.text != null) {
      writeFileSync(filePath, item.text, 'utf-8')
      return filePath
    }
    if (item.url) {
      try {
        const headers: Record<string, string> = {}
        if (item.fetchAuthorization) headers.Authorization = item.fetchAuthorization
        const res = await fetch(item.url, { headers })
        if (!res.ok) return null
        writeFileSync(filePath, Buffer.from(await res.arrayBuffer()))
        return filePath
      } catch {
        return null
      }
    }
    return null
  }
}

export function createIngestionSink(deps?: IngestionDeps): ConnectorIngestionSink {
  return new ConnectorIngestionSink(deps)
}
