import { describe, it, expect, beforeEach } from 'vitest'
import { ConnectorHost } from '../src/registry'
import type {
  Connector,
  ConnectorContext,
  ConnectorDescriptor,
  ConnectorStateStore,
  IngestionOutcome,
  IngestionSink,
  PullResult,
  SourceContainer,
  SourceItem,
  StoredConnectorState,
  StoredSourceState,
} from '../src/types'

// ── In-memory store implementing the ConnectorStateStore contract ────────────
class MemoryStore implements ConnectorStateStore {
  private states = new Map<string, StoredConnectorState>()
  private secrets = new Map<string, Map<string, string>>()

  private ensure(id: string): StoredConnectorState {
    if (!this.states.has(id)) this.states.set(id, { config: {}, lastSyncAt: null, sources: {} })
    return this.states.get(id)!
  }
  getState(id: string) {
    return this.ensure(id)
  }
  getConfig(id: string) {
    return { ...this.ensure(id).config }
  }
  setConfig(id: string, config: Record<string, string | number | boolean>) {
    this.ensure(id).config = { ...this.ensure(id).config, ...config }
  }
  getSecret(id: string, key: string) {
    return this.secrets.get(id)?.get(key) ?? null
  }
  hasSecret(id: string, key: string) {
    return Boolean(this.secrets.get(id)?.get(key))
  }
  setSecret(id: string, key: string, value: string | null) {
    if (!this.secrets.has(id)) this.secrets.set(id, new Map())
    if (value === null || value === '') this.secrets.get(id)!.delete(key)
    else this.secrets.get(id)!.set(key, value)
  }
  setLastSyncAt(id: string, iso: string | null) {
    this.ensure(id).lastSyncAt = iso
  }
  getSourceState(id: string, containerId: string): StoredSourceState {
    const state = this.ensure(id)
    if (!state.sources[containerId]) state.sources[containerId] = { enabled: true, cursor: null, lastSyncAt: null }
    return state.sources[containerId]
  }
  setSourceState(id: string, containerId: string, patch: Partial<StoredSourceState>) {
    const cur = this.getSourceState(id, containerId)
    this.ensure(id).sources[containerId] = { ...cur, ...patch }
  }
}

const descriptor: ConnectorDescriptor = {
  id: 'fake',
  displayName: 'Fake',
  description: 'test',
  transport: 'native',
  auth: { kind: 'api-key' },
  configFields: [
    { key: 'baseUrl', label: 'Base URL', type: 'url', required: true, default: 'https://x' },
    { key: 'token', label: 'Token', type: 'password', secret: true, required: true },
  ],
  capabilityKinds: ['sources'],
}

// A fake connector that yields two pages then a contact + a meeting.
function makeFakeConnector(ctx: ConnectorContext, opts: { pages?: number } = {}): Connector {
  let connected = false
  const container: SourceContainer = { externalId: 'c1', name: 'Chan', kind: 'channel' }
  const pageCount = opts.pages ?? 2
  return {
    id: 'fake',
    kind: 'native',
    type: 'fake',
    name: 'Fake',
    status: () => ({ state: connected ? 'connected' : 'disconnected' }),
    connect: () => {
      connected = true
      ctx.setStatus({ state: 'connected' })
      return { state: 'connected' }
    },
    disconnect: () => {
      connected = false
    },
    capabilities: {
      sources: {
        listContainers: async () => [container],
        pull: async (_c, since): Promise<PullResult> => {
          const cursorNum = since ? Number(since) : 0
          if (cursorNum >= pageCount) return { items: [], cursor: String(cursorNum), hasMore: false }
          const items: SourceItem[] = [
            {
              externalId: `msg-${cursorNum}`,
              kind: 'message',
              mime: 'text/markdown',
              text: `hello ${cursorNum}`,
              createdAt: new Date().toISOString(),
            },
          ]
          const isLast = cursorNum + 1 >= pageCount
          return { items, cursor: String(cursorNum + 1), hasMore: !isLast }
        },
      },
    },
  }
}

class CountingSink implements IngestionSink {
  public calls = 0
  async ingest(_id: string, _c: SourceContainer, items: SourceItem[]): Promise<IngestionOutcome> {
    this.calls++
    return { meetings: 0, contacts: 0, artifacts: items.length, skipped: 0 }
  }
}

describe('ConnectorHost', () => {
  let store: MemoryStore
  let sink: CountingSink
  let host: ConnectorHost

  beforeEach(() => {
    store = new MemoryStore()
    sink = new CountingSink()
    host = new ConnectorHost({ store, sink })
    host.register(descriptor, (ctx) => makeFakeConnector(ctx))
  })

  it('lists a registered connector with redacted secret fields', () => {
    const summaries = host.list()
    expect(summaries).toHaveLength(1)
    const fields = summaries[0].fields
    const token = fields.find((f) => f.key === 'token')!
    expect(token.value).toBe('') // secret never revealed
    expect(token.hasValue).toBe(false)
    const baseUrl = fields.find((f) => f.key === 'baseUrl')!
    expect(baseUrl.value).toBe('https://x') // default applied
  })

  it('persists config + secrets via configure, redacting secrets on read-back', async () => {
    await host.configure('fake', { baseUrl: 'https://api.test', token: 'sekret' })
    expect(store.getConfig('fake').baseUrl).toBe('https://api.test')
    expect(store.hasSecret('fake', 'token')).toBe(true)
    const summary = host.summary('fake')
    expect(summary.fields.find((f) => f.key === 'token')!.hasValue).toBe(true)
    expect(summary.fields.find((f) => f.key === 'token')!.value).toBe('')
  })

  it('empty secret string on configure leaves an existing secret intact', async () => {
    await host.configure('fake', { token: 'first' })
    await host.configure('fake', { token: '' }) // redacted round-trip
    expect(store.getSecret('fake', 'token')).toBe('first')
  })

  it('connect uses the connector lifecycle and emits status', async () => {
    const seen: string[] = []
    host.onStatus((_id, s) => seen.push(s.state))
    const status = await host.connect('fake')
    expect(status.state).toBe('connected')
    expect(seen).toContain('connecting')
    expect(seen).toContain('connected')
  })

  it('syncNow pulls all pages, advances the cursor, and ingests each page', async () => {
    await host.connect('fake')
    const outcome = await host.syncNow('fake')
    // 2 pages => 2 ingest calls => 2 artifacts
    expect(sink.calls).toBe(2)
    expect(outcome.artifacts).toBe(2)
    expect(store.getSourceState('fake', 'c1').cursor).toBe('2')
    expect(store.getState('fake').lastSyncAt).not.toBeNull()
  })

  it('a config-only connector without connect() derives connectivity from required config', async () => {
    const host2 = new ConnectorHost({ store })
    const configOnly: ConnectorDescriptor = { ...descriptor, id: 'cfg' }
    host2.register(configOnly, (ctx) => {
      const c = makeFakeConnector(ctx)
      // Strip lifecycle to simulate a config-only connector.
      return { ...c, id: 'cfg', connect: undefined, disconnect: undefined }
    })
    // Missing required token → auth-needed.
    let status = await host2.connect('cfg')
    expect(status.state).toBe('auth-needed')
    // Provide required fields → connected.
    await host2.configure('cfg', { baseUrl: 'https://api', token: 't' })
    status = await host2.connect('cfg')
    expect(status.state).toBe('connected')
  })

  it('disconnect stops schedule and resets status', async () => {
    await host.connect('fake')
    host.scheduleSync('fake', 15)
    await host.disconnect('fake')
    expect(host.getStatus('fake').state).toBe('disconnected')
  })
})
