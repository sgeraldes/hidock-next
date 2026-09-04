/**
 * Littlebird relay connector.
 *
 * Polls the Supabase staging table a Littlebird Routine writes to (via the
 * `workbrain-relay` Vercel MCP server — see `work-brain/littlebird-relay` in
 * the personal work-brain repo) and ingests staged decisions/action items/
 * risks/questions through the normal connector host, exactly like every
 * other source. This connector never talks to Littlebird directly — it only
 * ever sees rows the relay has already staged in Supabase.
 *
 * Auth: a Supabase project URL + its Secret key (service_role-equivalent),
 * entered once in Settings -> Connectors and stored encrypted like any other
 * connector secret. The Secret key is required because the staging table has
 * Row Level Security enabled with NO policies — the Publishable/anon key has
 * zero access to it by design (see the Supabase migration
 * `create_relay_staged_items`).
 *
 * Cursor: (created_at, id) of the last row returned, exactly like
 * HiNotesConnector's (mtimeMs, name) file cursor — fetch slightly past the
 * cursor, then filter out anything not strictly after it client-side, to
 * avoid needing a compound PostgREST filter. Delivery is at-least-once, not
 * exactly-once: ingestion is safe to repeat because
 * upsertConnectorKnowledgeItem is keyed on (connector_id, source_ref), so a
 * redelivered row just re-upserts the same capture instead of duplicating.
 * Marking a row `processed` in Supabase afterwards is best-effort and purely
 * for Kelly's visibility in the Supabase table browser — it plays no part in
 * correctness.
 */
import type {
  Connector,
  ConnectorContext,
  ConnectorDescriptor,
  ConnectorStatus,
  ConnectorStatusState,
  PullResult,
  SourceContainer,
  SourceItem,
} from '@hidock/connectors'

const PAGE_SIZE = 100
const CONTAINER: SourceContainer = {
  externalId: 'staged-items',
  name: 'Littlebird relay',
  kind: 'relay',
}

interface StagedRow {
  id: string
  connector_id: string
  source_ref: string
  kind: string
  payload: Record<string, unknown>
  status: string
  created_at: string
}

interface RelayCursor {
  createdAt: string
  id: string
}

function parseCursor(value?: string): RelayCursor | null {
  if (!value) return null
  try {
    const parsed = JSON.parse(value) as Partial<RelayCursor>
    if (typeof parsed.createdAt === 'string' && typeof parsed.id === 'string') {
      return { createdAt: parsed.createdAt, id: parsed.id }
    }
  } catch {
    /* fall through */
  }
  return null
}

function afterCursor(row: StagedRow, cursor: RelayCursor | null): boolean {
  if (!cursor) return true
  if (row.created_at !== cursor.createdAt) return row.created_at > cursor.createdAt
  return row.id > cursor.id
}

export const littlebirdRelayDescriptor: ConnectorDescriptor = {
  id: 'littlebird-relay',
  displayName: 'Littlebird relay',
  description:
    'Pull decisions, action items, risks, and questions a Littlebird Routine has staged via the workbrain-relay Vercel server, and ingest them into Work Brain.',
  transport: 'native',
  setupOptional: false,
  auth: { kind: 'none' },
  configFields: [
    {
      key: 'supabaseUrl',
      label: 'Supabase project URL',
      type: 'url',
      required: true,
      placeholder: 'https://xxxxxxxx.supabase.co',
      help: 'The work-brain-relay Supabase project URL (Settings -> API Keys).',
    },
    {
      key: 'supabaseSecretKey',
      label: 'Supabase secret key',
      type: 'password',
      required: true,
      secret: true,
      help:
        'Settings -> API Keys -> Secret keys in the work-brain-relay Supabase project (starts with sb_secret_). ' +
        'NOT the Publishable key — that has no access to the staging table.',
    },
  ],
  capabilityKinds: ['sources'],
}

export class LittlebirdRelayConnector implements Connector {
  readonly id: string
  readonly kind = 'native' as const
  readonly type = 'littlebird-relay'
  readonly name = 'Littlebird relay'

  private state: ConnectorStatusState = 'disconnected'
  private message: string | undefined

  constructor(private readonly ctx: ConnectorContext) {
    this.id = ctx.connectorId
  }

  status(): ConnectorStatus {
    return { state: this.state, message: this.message }
  }

  private config(): { url: string; key: string } | null {
    const url = String(this.ctx.getConfig().supabaseUrl ?? '').trim()
    const key = this.ctx.getSecret('supabaseSecretKey')
    if (!url || !key) return null
    return { url: url.replace(/\/+$/, ''), key }
  }

  async connect(): Promise<ConnectorStatus> {
    const cfg = this.config()
    if (!cfg) {
      this.state = 'auth-needed'
      this.message = 'Supabase project URL and secret key required'
      this.ctx.setStatus({ state: this.state, message: this.message })
      return this.status()
    }
    try {
      // Cheap reachability check: HEAD-equivalent, no rows needed.
      const res = await fetch(`${cfg.url}/rest/v1/relay_staged_items?select=id&limit=1`, {
        headers: { apikey: cfg.key, Authorization: `Bearer ${cfg.key}` },
      })
      if (!res.ok) throw new Error(`Supabase responded ${res.status}`)
      this.state = 'connected'
      this.message = undefined
      this.ctx.setStatus({ state: 'connected', message: undefined })
    } catch (err) {
      this.state = 'error'
      this.message = err instanceof Error ? err.message : String(err)
      this.ctx.setStatus({ state: 'error', message: this.message })
    }
    return this.status()
  }

  async disconnect(): Promise<void> {
    this.state = 'disconnected'
    this.message = undefined
  }

  capabilities = {
    sources: {
      listContainers: async (): Promise<SourceContainer[]> => {
        const cfg = this.config()
        if (!cfg) return [CONTAINER]
        try {
          const res = await fetch(
            `${cfg.url}/rest/v1/relay_staged_items?select=id&status=eq.pending`,
            { headers: { apikey: cfg.key, Authorization: `Bearer ${cfg.key}`, Prefer: 'count=exact' } }
          )
          const range = res.headers.get('content-range') // e.g. "0-4/5"
          const itemCount = range?.includes('/') ? Number(range.split('/')[1]) || 0 : undefined
          return [{ ...CONTAINER, itemCount }]
        } catch {
          return [CONTAINER]
        }
      },
      pull: (container: SourceContainer, since?: string) => this.pull(container, since),
    },
  }

  private async pull(container: SourceContainer, since?: string): Promise<PullResult> {
    if (container.externalId !== CONTAINER.externalId) return { items: [], hasMore: false }
    const cfg = this.config()
    if (!cfg) return { items: [], hasMore: false }

    const cursor = parseCursor(since)
    // Fetch a page past the cursor's created_at; over-fetch by one page's
    // worth to absorb the client-side tie-break filter without missing rows
    // that share the cursor's created_at timestamp.
    const params = new URLSearchParams({
      select: 'id,connector_id,source_ref,kind,payload,status,created_at',
      order: 'created_at.asc,id.asc',
      limit: String(PAGE_SIZE * 2),
    })
    if (cursor) params.set('created_at', `gte.${cursor.createdAt}`)

    const res = await fetch(`${cfg.url}/rest/v1/relay_staged_items?${params.toString()}`, {
      headers: { apikey: cfg.key, Authorization: `Bearer ${cfg.key}` },
    })
    if (!res.ok) {
      this.ctx.log('[littlebird-relay] pull failed', { status: res.status })
      return { items: [], hasMore: false }
    }
    const rows = ((await res.json()) as StagedRow[]).filter((row) => afterCursor(row, cursor))
    const page = rows.slice(0, PAGE_SIZE)

    const items: SourceItem[] = page.map((row) => {
      const { title, ...entityFields } = row.payload as { title?: string } & Record<string, unknown>
      return {
        externalId: row.source_ref,
        kind: row.kind,
        mime: 'application/json',
        title,
        createdAt: row.created_at,
        entity: entityFields as SourceItem['entity'],
        metadata: { extractedFrom: 'littlebird-relay' },
      }
    })

    // Best-effort status update for Kelly's visibility in Supabase — NOT
    // relied on for correctness (the cursor already prevents redelivery in
    // the common case, and re-ingesting a page is a safe no-op upsert if it
    // ever does happen).
    if (page.length > 0) {
      const ids = page.map((row) => row.id)
      fetch(`${cfg.url}/rest/v1/relay_staged_items?id=in.(${ids.join(',')})`, {
        method: 'PATCH',
        headers: {
          apikey: cfg.key,
          Authorization: `Bearer ${cfg.key}`,
          'Content-Type': 'application/json',
          Prefer: 'return=minimal',
        },
        body: JSON.stringify({ status: 'processed', processed_at: new Date().toISOString() }),
      }).catch((err) => this.ctx.log('[littlebird-relay] mark-processed failed (non-fatal)', err))
    }

    const last = page.at(-1)
    return {
      items,
      cursor: last ? JSON.stringify({ createdAt: last.created_at, id: last.id } satisfies RelayCursor) : since,
      hasMore: rows.length > page.length,
    }
  }
}

export function createLittlebirdRelayConnector(ctx: ConnectorContext): LittlebirdRelayConnector {
  return new LittlebirdRelayConnector(ctx)
}
