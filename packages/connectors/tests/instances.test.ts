import { describe, it, expect, beforeEach } from 'vitest'
import { ConnectorHost } from '../src/registry'
import type {
  Connector,
  ConnectorContext,
  ConnectorDescriptor,
  ConnectorInstanceMeta,
  ConnectorStateStore,
  StoredConnectorState,
  StoredSourceState,
} from '../src/types'

// ── Memory store WITH the optional multi-instance surface ────────────────────
class InstanceStore implements ConnectorStateStore {
  private states = new Map<string, StoredConnectorState>()
  private secrets = new Map<string, Map<string, string>>()
  private meta = new Map<string, ConnectorInstanceMeta>()

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
  // Optional multi-instance surface:
  listInstanceIds() {
    return [...new Set([...this.states.keys(), ...this.meta.keys()])]
  }
  setInstanceMeta(id: string, meta: ConnectorInstanceMeta) {
    this.meta.set(id, meta)
  }
  getInstanceMeta(id: string) {
    return this.meta.get(id) ?? null
  }
  removeInstance(id: string) {
    this.states.delete(id)
    this.secrets.delete(id)
    this.meta.delete(id)
  }
}

const multiDescriptor: ConnectorDescriptor = {
  id: 'acct',
  displayName: 'Acct',
  description: 'multi-instance test',
  transport: 'native',
  auth: { kind: 'oauth' },
  configFields: [{ key: 'clientId', label: 'Client', type: 'text' }],
  capabilityKinds: ['identity'],
  multiInstance: true,
}

function makeConnector(ctx: ConnectorContext): Connector {
  let connected = false
  return {
    id: ctx.connectorId,
    kind: 'native',
    type: 'acct',
    name: 'Acct',
    status: () => ({ state: connected ? 'connected' : 'disconnected' }),
    connect: () => {
      connected = true
      ctx.setStatus({ state: 'connected' })
      return { state: 'connected' }
    },
    disconnect: () => {
      connected = false
      ctx.setSecret('token', null)
    },
    capabilities: {
      identity: {
        // Each instance returns a person tagged with its own connectorId.
        searchPeople: async (q: string) => [{ externalId: `${ctx.connectorId}:${q}`, name: q }],
        enrich: async () => null,
      },
    },
  }
}

describe('ConnectorHost — multi-instance', () => {
  let store: InstanceStore
  let host: ConnectorHost

  beforeEach(() => {
    store = new InstanceStore()
    host = new ConnectorHost({ store })
    host.register(multiDescriptor, (ctx) => makeConnector(ctx))
  })

  it('seeds a single default instance keyed by the type id', () => {
    const summaries = host.list()
    expect(summaries).toHaveLength(1)
    expect(summaries[0].instanceId).toBe('acct')
    expect(summaries[0].multiInstance).toBe(true)
    expect(summaries[0].label).toBe('Acct')
  })

  it('addInstance creates a uuid-suffixed second account with a numbered label', () => {
    const second = host.addInstance('acct', '')
    expect(second.instanceId).toMatch(/^acct:/)
    expect(second.label).toBe('Acct (2)')
    expect(host.list()).toHaveLength(2)
  })

  it('addInstance honors a user-provided label', () => {
    const s = host.addInstance('acct', 'Personal (hotmail)')
    expect(s.label).toBe('Personal (hotmail)')
    expect(host.summary(s.instanceId).label).toBe('Personal (hotmail)')
  })

  it('namespaces config + secrets per instance', async () => {
    const b = host.addInstance('acct', 'B')
    await host.configure('acct', { clientId: 'AAA' })
    await host.configure(b.instanceId, { clientId: 'BBB' })
    expect(store.getConfig('acct').clientId).toBe('AAA')
    expect(store.getConfig(b.instanceId).clientId).toBe('BBB')
  })

  it('rehydrates persisted instances (with labels) on a fresh host', async () => {
    const b = host.addInstance('acct', 'Work')
    await host.configure(b.instanceId, { clientId: 'X' })
    // New host over the SAME store must rediscover both accounts.
    const host2 = new ConnectorHost({ store })
    host2.register(multiDescriptor, (ctx) => makeConnector(ctx))
    const ids = host2.list().map((s) => s.instanceId).sort()
    expect(ids).toContain('acct')
    expect(ids).toContain(b.instanceId)
    const work = host2.summary(b.instanceId)
    expect(work.label).toBe('Work')
  })

  it('removeInstance disconnects, clears secrets, and drops the account', async () => {
    const b = host.addInstance('acct', 'B')
    await host.connect(b.instanceId)
    store.setSecret(b.instanceId, 'token', 'secret')
    await host.removeInstance(b.instanceId)
    expect(host.list().map((s) => s.instanceId)).not.toContain(b.instanceId)
    expect(store.hasSecret(b.instanceId, 'token')).toBe(false)
    expect(store.getInstanceMeta(b.instanceId)).toBeNull()
  })

  it('searchPeople aggregates across all CONNECTED instances', async () => {
    const b = host.addInstance('acct', 'B')
    await host.connect('acct')
    await host.connect(b.instanceId)
    const people = await host.searchPeople('q')
    const ids = people.map((p) => p.externalId).sort()
    expect(ids).toEqual(['acct:q', `${b.instanceId}:q`].sort())
  })

  it('refuses addInstance / removeInstance on a single-instance type', async () => {
    const single: ConnectorDescriptor = { ...multiDescriptor, id: 'solo', multiInstance: false }
    host.register(single, (ctx) => ({ ...makeConnector(ctx), id: ctx.connectorId, type: 'solo' }))
    expect(() => host.addInstance('solo')).toThrow(/multiple accounts/)
    await expect(host.removeInstance('solo')).rejects.toThrow(/removing accounts/)
  })

  it('setInstanceLabel renames an account and persists it', () => {
    const b = host.addInstance('acct', 'Old')
    const renamed = host.setInstanceLabel(b.instanceId, 'New')
    expect(renamed.label).toBe('New')
    expect(store.getInstanceMeta(b.instanceId)?.label).toBe('New')
  })
})
