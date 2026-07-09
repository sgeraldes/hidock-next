/**
 * Connector host / registry (Layer 2 of CONNECTORS.md).
 *
 * Owns connector registration, lifecycle (configure/connect/disconnect),
 * status reporting, scheduled + on-demand sync, and dispatch of pulled items to
 * the ingestion sink. One interface, two transports (mcp/native) — the host
 * treats them identically. Kept free of Electron/OS deps: persistence is an
 * injected `ConnectorStateStore`, so it is fully unit-testable.
 */
import type {
  Connector,
  ConnectorConfig,
  ConnectorContext,
  ConnectorConfigFieldView,
  ConnectorDescriptor,
  ConnectorFactory,
  ConnectorStateStore,
  ConnectorStatus,
  ConnectorSummary,
  Contact,
  Enrichment,
  ExternalPerson,
  IngestionOutcome,
  IngestionSink,
  SourceContainer,
} from './types'

export type ConnectorStatusListener = (id: string, status: ConnectorStatus) => void

/** Upper bound on pages pulled in a single syncNow to avoid runaway loops. */
const MAX_SYNC_PAGES = 50

function initialStatus(lastSyncAt: string | null): ConnectorStatus {
  return { state: 'disconnected', lastSyncAt: lastSyncAt ?? undefined }
}

export interface ConnectorHostOptions {
  store: ConnectorStateStore
  sink?: IngestionSink
  /** QA-logs-aware logger; defaults to a no-op. */
  log?: (message: string, extra?: unknown) => void
}

export class ConnectorHost {
  private readonly store: ConnectorStateStore
  private sink?: IngestionSink
  private readonly log: (message: string, extra?: unknown) => void

  private factories = new Map<string, ConnectorFactory>()
  private descriptors = new Map<string, ConnectorDescriptor>()
  private instances = new Map<string, Connector>()
  private statuses = new Map<string, ConnectorStatus>()
  private timers = new Map<string, ReturnType<typeof setInterval>>()
  private listeners = new Set<ConnectorStatusListener>()

  constructor(opts: ConnectorHostOptions) {
    this.store = opts.store
    this.sink = opts.sink
    this.log = opts.log ?? (() => {})
  }

  setSink(sink: IngestionSink): void {
    this.sink = sink
  }

  onStatus(listener: ConnectorStatusListener): () => void {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  register(descriptor: ConnectorDescriptor, factory: ConnectorFactory): void {
    this.descriptors.set(descriptor.id, descriptor)
    this.factories.set(descriptor.id, factory)
    if (!this.statuses.has(descriptor.id)) {
      this.statuses.set(descriptor.id, initialStatus(this.store.getState(descriptor.id).lastSyncAt))
    }
  }

  hasConnector(id: string): boolean {
    return this.factories.has(id)
  }

  listDescriptors(): ConnectorDescriptor[] {
    return [...this.descriptors.values()]
  }

  private context(id: string): ConnectorContext {
    return {
      connectorId: id,
      getConfig: () => this.effectiveConfig(id),
      getSecret: (key) => this.store.getSecret(id, key),
      setSecret: (key, value) => this.store.setSecret(id, key, value),
      setStatus: (patch) => this.patchStatus(id, patch),
      log: (message, extra) => this.log(`[connector:${id}] ${message}`, extra),
    }
  }

  /** Config merged with descriptor field defaults. */
  private effectiveConfig(id: string): ConnectorConfig {
    const descriptor = this.descriptors.get(id)
    const stored = this.store.getConfig(id)
    const merged: ConnectorConfig = {}
    for (const field of descriptor?.configFields ?? []) {
      if (field.secret) continue
      const val = stored[field.key]
      if (val !== undefined) merged[field.key] = val
      else if (field.default !== undefined) merged[field.key] = field.default
    }
    for (const [k, v] of Object.entries(stored)) {
      if (!(k in merged)) merged[k] = v
    }
    return merged
  }

  private instance(id: string): Connector {
    let inst = this.instances.get(id)
    if (!inst) {
      const factory = this.factories.get(id)
      if (!factory) throw new Error(`Unknown connector: ${id}`)
      inst = factory(this.context(id))
      this.instances.set(id, inst)
      this.statuses.set(id, { ...this.statuses.get(id), ...inst.status() })
    }
    return inst
  }

  private patchStatus(id: string, patch: Partial<ConnectorStatus>): void {
    const current = this.statuses.get(id) ?? initialStatus(null)
    const next: ConnectorStatus = { ...current, ...patch }
    this.statuses.set(id, next)
    for (const l of this.listeners) {
      try {
        l(id, next)
      } catch (err) {
        this.log('status listener threw', err)
      }
    }
  }

  getStatus(id: string): ConnectorStatus {
    // The host's patched status is authoritative: connectors report changes via
    // ctx.setStatus. A connector's own status() only seeds the initial value at
    // instantiation (see instance()).
    return this.statuses.get(id) ?? initialStatus(this.store.getState(id).lastSyncAt)
  }

  private fieldViews(id: string): ConnectorConfigFieldView[] {
    const descriptor = this.descriptors.get(id)
    const stored = this.store.getConfig(id)
    return (descriptor?.configFields ?? []).map((field) => {
      if (field.secret) {
        return { ...field, value: '', hasValue: this.store.hasSecret(id, field.key) }
      }
      const value = stored[field.key] ?? field.default ?? ''
      return { ...field, value, hasValue: value !== '' && value !== undefined }
    })
  }

  list(): ConnectorSummary[] {
    return this.listDescriptors().map((d) => this.summary(d.id))
  }

  summary(id: string): ConnectorSummary {
    const descriptor = this.descriptors.get(id)
    if (!descriptor) throw new Error(`Unknown connector: ${id}`)
    const state = this.store.getState(id)
    const inst = this.instances.get(id)
    const hasSources = inst ? Boolean(inst.capabilities.sources) : descriptor.capabilityKinds.includes('sources')
    const sources = hasSources
      ? Object.entries(state.sources).map(([cid, s]) => ({
          externalId: cid,
          name: cid,
          kind: 'unknown',
          enabled: s.enabled,
          lastSyncAt: s.lastSyncAt,
        }))
      : undefined
    return { descriptor, status: this.getStatus(id), fields: this.fieldViews(id), sources }
  }

  /**
   * Apply UI-submitted values. Secret fields route to the encrypted secret
   * store; the rest to plain config. Empty secret strings are treated as
   * "leave unchanged" so redacted round-trips don't wipe stored secrets.
   */
  async configure(id: string, values: Record<string, string | number | boolean>): Promise<void> {
    const descriptor = this.descriptors.get(id)
    if (!descriptor) throw new Error(`Unknown connector: ${id}`)
    const plain: ConnectorConfig = {}
    for (const field of descriptor.configFields) {
      if (!(field.key in values)) continue
      const raw = values[field.key]
      if (field.secret) {
        const str = typeof raw === 'string' ? raw : String(raw)
        if (str !== '') this.store.setSecret(id, field.key, str)
      } else {
        plain[field.key] = raw
      }
    }
    if (Object.keys(plain).length > 0) this.store.setConfig(id, plain)
    const inst = this.instances.get(id)
    if (inst?.configure) await inst.configure(this.effectiveConfig(id))
  }

  /** True when all required (non-secret) fields have values and required secrets are set. */
  private requiredConfigSatisfied(id: string): boolean {
    const descriptor = this.descriptors.get(id)
    if (!descriptor) return false
    const config = this.effectiveConfig(id)
    for (const field of descriptor.configFields) {
      if (!field.required) continue
      if (field.secret) {
        if (!this.store.hasSecret(id, field.key)) return false
      } else {
        const v = config[field.key]
        if (v === undefined || v === '') return false
      }
    }
    return true
  }

  async connect(id: string): Promise<ConnectorStatus> {
    const inst = this.instance(id)
    this.patchStatus(id, { state: 'connecting', message: 'Connecting…' })
    try {
      if (inst.connect) {
        const status = await inst.connect()
        this.patchStatus(id, status)
      } else {
        // Config-only connector: connectivity derives from required config.
        const ok = this.requiredConfigSatisfied(id)
        this.patchStatus(id, ok
          ? { state: 'connected', message: undefined }
          : { state: 'auth-needed', message: 'Configuration incomplete' })
      }
      return this.getStatus(id)
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      this.patchStatus(id, { state: 'error', message })
      throw err
    }
  }

  async disconnect(id: string): Promise<void> {
    const inst = this.instances.get(id)
    this.stopSchedule(id)
    if (inst?.disconnect) await inst.disconnect()
    this.patchStatus(id, { state: 'disconnected', message: undefined, detail: undefined })
  }

  async listContainers(id: string): Promise<SourceContainer[]> {
    const inst = this.instance(id)
    if (!inst.capabilities.sources) return []
    return inst.capabilities.sources.listContainers()
  }

  setSourceEnabled(id: string, containerId: string, enabled: boolean): void {
    this.store.setSourceState(id, containerId, { enabled })
  }

  private async syncContainer(
    id: string,
    inst: Connector,
    container: SourceContainer
  ): Promise<IngestionOutcome> {
    const outcome: IngestionOutcome = { meetings: 0, contacts: 0, artifacts: 0, skipped: 0 }
    const sources = inst.capabilities.sources
    if (!sources) return outcome
    const sourceState = this.store.getSourceState(id, container.externalId)
    let cursor = sourceState.cursor ?? undefined
    for (let page = 0; page < MAX_SYNC_PAGES; page++) {
      const result = await sources.pull(container, cursor)
      if (result.items.length > 0 && this.sink) {
        const partial = await this.sink.ingest(id, container, result.items)
        outcome.meetings += partial.meetings
        outcome.contacts += partial.contacts
        outcome.artifacts += partial.artifacts
        outcome.skipped += partial.skipped
      }
      if (result.cursor !== undefined) cursor = result.cursor
      if (!result.hasMore) break
    }
    this.store.setSourceState(id, container.externalId, {
      cursor: cursor ?? null,
      lastSyncAt: new Date().toISOString(),
    })
    return outcome
  }

  /** Sync one container (if id given) or all enabled containers. */
  async syncNow(id: string, containerId?: string): Promise<IngestionOutcome> {
    const inst = this.instance(id)
    const total: IngestionOutcome = { meetings: 0, contacts: 0, artifacts: 0, skipped: 0 }
    if (!inst.capabilities.sources) return total
    this.patchStatus(id, { state: 'syncing', message: 'Syncing…' })
    try {
      const containers = await inst.capabilities.sources.listContainers()
      const targets = containerId
        ? containers.filter((c) => c.externalId === containerId)
        : containers.filter((c) => this.store.getSourceState(id, c.externalId).enabled)
      for (const container of targets) {
        const partial = await this.syncContainer(id, inst, container)
        total.meetings += partial.meetings
        total.contacts += partial.contacts
        total.artifacts += partial.artifacts
        total.skipped += partial.skipped
      }
      const nowIso = new Date().toISOString()
      this.store.setLastSyncAt(id, nowIso)
      this.patchStatus(id, { state: 'connected', lastSyncAt: nowIso, message: undefined })
      this.log(`[connector:${id}] sync complete`, total)
      return total
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      this.patchStatus(id, { state: 'error', message })
      throw err
    }
  }

  scheduleSync(id: string, intervalMinutes: number): void {
    this.stopSchedule(id)
    const ms = Math.max(1, intervalMinutes) * 60_000
    const timer = setInterval(() => {
      void this.syncNow(id).catch((err) => this.log(`scheduled sync failed for ${id}`, err))
    }, ms)
    if (typeof timer.unref === 'function') timer.unref()
    this.timers.set(id, timer)
  }

  stopSchedule(id: string): void {
    const timer = this.timers.get(id)
    if (timer) {
      clearInterval(timer)
      this.timers.delete(id)
    }
  }

  /** Aggregate autocomplete across all connected identity-capable connectors. */
  async searchPeople(query: string, limit = 10): Promise<ExternalPerson[]> {
    const results: ExternalPerson[] = []
    for (const descriptor of this.descriptors.values()) {
      const inst = this.instances.get(descriptor.id)
      const identity = inst?.capabilities.identity
      if (!identity) continue
      if (this.getStatus(descriptor.id).state !== 'connected') continue
      try {
        results.push(...(await identity.searchPeople(query)))
      } catch (err) {
        this.log(`[connector:${descriptor.id}] searchPeople failed`, err)
      }
      if (results.length >= limit) break
    }
    return results.slice(0, limit)
  }

  /** First non-null enrichment across connected identity connectors. */
  async enrich(contact: Contact): Promise<Enrichment | null> {
    for (const descriptor of this.descriptors.values()) {
      const inst = this.instances.get(descriptor.id)
      const identity = inst?.capabilities.identity
      if (!identity) continue
      if (this.getStatus(descriptor.id).state !== 'connected') continue
      try {
        const enriched = await identity.enrich(contact)
        if (enriched) return enriched
      } catch (err) {
        this.log(`[connector:${descriptor.id}] enrich failed`, err)
      }
    }
    return null
  }

  dispose(): void {
    for (const id of [...this.timers.keys()]) this.stopSchedule(id)
    this.instances.clear()
  }
}
