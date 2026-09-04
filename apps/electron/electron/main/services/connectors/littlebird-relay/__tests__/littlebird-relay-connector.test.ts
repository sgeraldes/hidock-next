// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ConnectorContext } from '@hidock/connectors'
import { LittlebirdRelayConnector, littlebirdRelayDescriptor } from '../littlebird-relay-connector'

afterEach(() => {
  vi.unstubAllGlobals()
})

function makeContext(overrides: Partial<{ url: string; key: string | null }> = {}): ConnectorContext {
  const url = overrides.url ?? 'https://example.supabase.co'
  const key = overrides.key === undefined ? 'sb_secret_fake' : overrides.key
  return {
    connectorId: 'littlebird-relay',
    getConfig: () => ({ supabaseUrl: url }),
    getSecret: () => key,
    setSecret: vi.fn(),
    setStatus: vi.fn(),
    log: vi.fn(),
  }
}

type StagedRow = {
  id: string
  connector_id: string
  source_ref: string
  kind: string
  payload: Record<string, unknown>
  status: string
  created_at: string
}

const ROWS: StagedRow[] = [
  {
    id: 'a',
    connector_id: 'littlebird-relay',
    source_ref: 'd-1',
    kind: 'decision',
    payload: { content: 'Switch to Ollama', title: 'Ollama switch', participants: ['Kelly'] },
    status: 'pending',
    created_at: '2026-09-04T10:00:00.000Z',
  },
  {
    id: 'b',
    connector_id: 'littlebird-relay',
    source_ref: 'r-1',
    kind: 'risk',
    payload: { content: 'Vendor SLA may slip', severity: 'high' },
    status: 'pending',
    created_at: '2026-09-04T10:01:00.000Z',
  },
]

function stubFetch(rows: StagedRow[], patched: Array<{ url: string; body: unknown }>) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, opts: any = {}) => {
      const u = new URL(url)
      if (opts.method === 'PATCH') {
        patched.push({ url, body: JSON.parse(opts.body) })
        return { ok: true, status: 200, headers: new Headers() } as any
      }
      if (u.searchParams.get('select') === 'id' && !u.searchParams.get('status')) {
        // connect() reachability check
        return { ok: true, status: 200, headers: new Headers(), json: async () => [] } as any
      }
      if (u.searchParams.get('status') === 'eq.pending') {
        // listContainers() count check
        return {
          ok: true,
          status: 200,
          headers: new Headers({ 'content-range': `0-${rows.length - 1}/${rows.length}` }),
          json: async () => [],
        } as any
      }
      // pull() query
      const gte = u.searchParams.get('created_at')
      const filtered = gte ? rows.filter((r) => r.created_at >= gte.replace('gte.', '')) : rows
      return { ok: true, status: 200, headers: new Headers(), json: async () => filtered } as any
    })
  )
}

describe('Littlebird relay connector', () => {
  it('describes a zero-auth relay source requiring Supabase config', () => {
    expect(littlebirdRelayDescriptor.id).toBe('littlebird-relay')
    expect(littlebirdRelayDescriptor.auth.kind).toBe('none')
    expect(littlebirdRelayDescriptor.capabilityKinds).toEqual(['sources'])
    const keys = littlebirdRelayDescriptor.configFields.map((f) => f.key)
    expect(keys).toEqual(['supabaseUrl', 'supabaseSecretKey'])
    expect(littlebirdRelayDescriptor.configFields.find((f) => f.key === 'supabaseSecretKey')?.secret).toBe(true)
  })

  it('reports auth-needed when Supabase config is missing', async () => {
    const connector = new LittlebirdRelayConnector(makeContext({ key: null }))
    const status = await connector.connect()
    expect(status.state).toBe('auth-needed')
  })

  it('connects and reports a pending item count from Content-Range', async () => {
    const patched: Array<{ url: string; body: unknown }> = []
    stubFetch(ROWS, patched)
    const connector = new LittlebirdRelayConnector(makeContext())

    await expect(connector.connect()).resolves.toMatchObject({ state: 'connected' })
    const containers = await connector.capabilities.sources.listContainers()
    expect(containers).toEqual([expect.objectContaining({ externalId: 'staged-items', itemCount: 2 })])
  })

  it('maps staged rows to SourceItems and advances the cursor to prevent redelivery', async () => {
    const patched: Array<{ url: string; body: unknown }> = []
    stubFetch(ROWS, patched)
    const connector = new LittlebirdRelayConnector(makeContext())
    await connector.connect()
    const container = (await connector.capabilities.sources.listContainers())[0]

    const page1 = await connector.capabilities.sources.pull(container)
    expect(page1.items).toHaveLength(2)

    const decision = page1.items.find((item) => item.externalId === 'd-1')!
    expect(decision.title).toBe('Ollama switch')
    expect(decision.kind).toBe('decision')
    expect(decision.entity).toMatchObject({ content: 'Switch to Ollama', participants: ['Kelly'] })
    expect(decision.entity).not.toHaveProperty('title')
    expect(decision.metadata).toMatchObject({ extractedFrom: 'littlebird-relay' })

    const risk = page1.items.find((item) => item.externalId === 'r-1')!
    expect(risk.entity).toMatchObject({ severity: 'high' })

    expect(page1.cursor).toBeTruthy()
    expect(page1.hasMore).toBe(false)

    // Give the fire-and-forget "mark processed" PATCH a tick to run.
    await new Promise((r) => setTimeout(r, 0))
    expect(patched).toHaveLength(1)
    expect(patched[0].body).toMatchObject({ status: 'processed' })

    const page2 = await connector.capabilities.sources.pull(container, page1.cursor)
    expect(page2.items).toEqual([])
  })

  it('returns no items when Supabase config is missing', async () => {
    const connector = new LittlebirdRelayConnector(makeContext({ key: null }))
    const container = { externalId: 'staged-items', name: 'Littlebird relay', kind: 'relay' }
    const result = await connector.capabilities.sources.pull(container)
    expect(result.items).toEqual([])
    expect(result.hasMore).toBe(false)
  })
})
