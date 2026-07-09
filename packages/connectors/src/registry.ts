/**
 * Connector host / registry (Layer 2 of CONNECTORS.md).
 *
 * Owns connector registration, lifecycle (configure/connect/disconnect),
 * status reporting, scheduled + on-demand sync, and dispatch of pulled items to
 * the ingestion sink. One interface, two transports (mcp/native) — the host
 * treats them identically. Kept free of Electron/OS deps: persistence is an
 * injected `ConnectorStateStore`, so it is fully unit-testable.
 *
 * Instances vs types
 * ------------------
 * A connector TYPE is a registered (descriptor, factory) pair keyed by
 * `descriptor.id` ('m365', 'slack'). A connector INSTANCE is a live configured
 * account, keyed by an INSTANCE id. For single-instance types the instance id
 * equals the type id (backward-compatible). Multi-instance types
 * (`descriptor.multiInstance`) may have N accounts: the first/legacy account
 * keeps the plain type id, extras use `<type>:<uuid>`. All per-instance state
 * (config, secrets, MSAL cache, status, cursors) is namespaced by instance id
 * in the store, so accounts never collide. Every public method's `id` parameter
 * is an INSTANCE id.
 */
import type {
  Connector,
  ConnectorConfig,
  ConnectorContext,
  ConnectorConfigFieldView,
  ConnectorConnectOptions,
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

/** Random suffix for a new instance id. Prefers the Web Crypto UUID (Node 18+). */
function newInstanceSuffix(): string {
  const g = globalThis as { crypto?: { randomUUID?: () => string } }
  if (typeof g.crypto?.randomUUID === 'function') return g.crypto.randomUUID()
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
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

  // Keyed by TYPE (descriptor.id).
  private factories = new Map<string, ConnectorFactory>()
  private descriptors = new Map<string, ConnectorDescriptor>()

  // Keyed by INSTANCE id.
  private instanceType = new Map<string, string>()
  private instanceLabels = new Map<string, string>()
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
    this.loadInstances(descriptor)
  }

  /** Rehydrate a type's instances from the store (or seed the default instance). */
  private loadInstances(descriptor: ConnectorDescriptor): void {
    const type = descriptor.id
    if (descriptor.multiInstance) {
      const persisted = this.store.listInstanceIds?.() ?? []
      const own = persisted.filter((id) => this.idBelongsToType(id, type))
      if (own.length === 0) {
        // Seed the default/legacy instance keyed by the type id. This preserves
        // any pre-existing single-instance state written under `type` and gives
        // the UI a first account to Connect without an explicit "Add account".
        this.registerInstance(type, type, descriptor.displayName)
      } else {
        for (const id of own) {
          const meta = this.store.getInstanceMeta?.(id)
          this.registerInstance(id, type, meta?.label ?? descriptor.displayName)
        }
      }
    } else {
      this.registerInstance(type, type, descriptor.displayName)
    }
  }

  private idBelongsToType(id: string, type: string): boolean {
    return id === type || id.startsWith(`${type}:`)
  }

  private registerInstance(instanceId: string, type: string, label: string): void {
    this.instanceType.set(instanceId, type)
    this.instanceLabels.set(instanceId, label)
    if (!this.statuses.has(instanceId)) {
      this.statuses.set(instanceId, initialStatus(this.store.getState(instanceId).lastSyncAt))
    }
  }

  /** True if `id` is a known connector type OR a known instance id. */
  hasConnector(id: string): boolean {
    return this.factories.has(id) || this.instanceType.has(id)
  }

  listDescriptors(): ConnectorDescriptor[] {
    return [...this.descriptors.values()]
  }

  /** All live instance ids, in registration/insertion order. */
  listInstances(): string[] {
    return [...this.instanceType.keys()]
  }

  private descriptorFor(id: string): ConnectorDescriptor | undefined {
    const type = this.instanceType.get(id)
    return type ? this.descriptors.get(type) : undefined
  }

  private labelFor(id: string): string {
    const meta = this.store.getInstanceMeta?.(id)
    return meta?.label ?? this.instanceLabels.get(id) ?? this.descriptorFor(id)?.displayName ?? id
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
    const descriptor = this.descriptorFor(id)
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
      const type = this.instanceType.get(id)
      const factory = type ? this.factories.get(type) : undefined
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
    const descriptor = this.descriptorFor(id)
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
    return this.listInstances().map((id) => this.summary(id))
  }

  summary(id: string): ConnectorSummary {
    const descriptor = this.descriptorFor(id)
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
    return {
      descriptor,
      instanceId: id,
      label: this.labelFor(id),
      multiInstance: Boolean(descriptor.multiInstance),
      status: this.getStatus(id),
      fields: this.fieldViews(id),
      sources,
    }
  }

  /**
   * Add a new account (instance) for a multi-instance connector type. Returns
   * the summary for the freshly created instance (state 'disconnected').
   */
  addInstance(type: string, label?: string): ConnectorSummary {
    const descriptor = this.descriptors.get(type)
    if (!descriptor) throw new Error(`Unknown connector type: ${type}`)
    if (!descriptor.multiInstance) throw new Error(`Connector '${type}' does not support multiple accounts`)
    const instanceId = this.instanceType.has(type) ? `${type}:${newInstanceSuffix()}` : type
    const finalLabel = (label && label.trim()) || this.nextDefaultLabel(descriptor)
    this.registerInstance(instanceId, type, finalLabel)
    // Persist so the account survives a restart even before any config/secret.
    this.store.setInstanceMeta?.(instanceId, { type, label: finalLabel })
    this.patchStatus(instanceId, { state: 'disconnected', message: undefined })
    return this.summary(instanceId)
  }

  /** Suggest a label for the Nth account of a type ("Name", "Name (2)", …). */
  private nextDefaultLabel(descriptor: ConnectorDescriptor): string {
    const count = this.listInstances().filter((id) => this.instanceType.get(id) === descriptor.id).length
    return count === 0 ? descriptor.displayName : `${descriptor.displayName} (${count + 1})`
  }

  /** Rename an instance (multi-instance accounts). */
  setInstanceLabel(id: string, label: string): ConnectorSummary {
    if (!this.instanceType.has(id)) throw new Error(`Unknown connector instance: ${id}`)
    const trimmed = label.trim() || this.instanceLabels.get(id) || id
    this.instanceLabels.set(id, trimmed)
    const type = this.instanceType.get(id)!
    this.store.setInstanceMeta?.(id, { type, label: trimmed })
    return this.summary(id)
  }

  /** Remove an account (instance) of a multi-instance connector type. */
  async removeInstance(id: string): Promise<void> {
    const type = this.instanceType.get(id)
    if (!type) throw new Error(`Unknown connector instance: ${id}`)
    const descriptor = this.descriptors.get(type)
    if (!descriptor?.multiInstance) throw new Error(`Connector '${type}' does not support removing accounts`)
    await this.disconnect(id) // stops schedule + inst.disconnect (clears its secrets)
    this.instances.delete(id)
    this.statuses.delete(id)
    this.instanceType.delete(id)
    this.instanceLabels.delete(id)
    this.store.removeInstance?.(id)
  }

  /**
   * Apply UI-submitted values. Secret fields route to the encrypted secret
   * store; the rest to plain config. Empty secret strings are treated as
   * "leave unchanged" so redacted round-trips don't wipe stored secrets.
   */
  async configure(id: string, values: Record<string, string | number | boolean>): Promise<void> {
    const descriptor = this.descriptorFor(id)
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
    const descriptor = this.descriptorFor(id)
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

  async connect(id: string, opts?: ConnectorConnectOptions): Promise<ConnectorStatus> {
    const inst = this.instance(id)
    this.patchStatus(id, { state: 'connecting', message: 'Connecting…' })
    try {
      if (inst.connect) {
        const status = await inst.connect(opts)
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

  /** Aggregate autocomplete across all connected identity-capable instances. */
  async searchPeople(query: string, limit = 10): Promise<ExternalPerson[]> {
    const results: ExternalPerson[] = []
    for (const id of this.instanceType.keys()) {
      const inst = this.instances.get(id)
      const identity = inst?.capabilities.identity
      if (!identity) continue
      if (this.getStatus(id).state !== 'connected') continue
      try {
        results.push(...(await identity.searchPeople(query)))
      } catch (err) {
        this.log(`[connector:${id}] searchPeople failed`, err)
      }
      if (results.length >= limit) break
    }
    return results.slice(0, limit)
  }

  /** First non-null enrichment across connected identity instances. */
  async enrich(contact: Contact): Promise<Enrichment | null> {
    for (const id of this.instanceType.keys()) {
      const inst = this.instances.get(id)
      const identity = inst?.capabilities.identity
      if (!identity) continue
      if (this.getStatus(id).state !== 'connected') continue
      try {
        const enriched = await identity.enrich(contact)
        if (enriched) return enriched
      } catch (err) {
        this.log(`[connector:${id}] enrich failed`, err)
      }
    }
    return null
  }

  dispose(): void {
    for (const id of [...this.timers.keys()]) this.stopSchedule(id)
    this.instances.clear()
  }
}
