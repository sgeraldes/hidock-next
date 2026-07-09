/**
 * Connector-host contract — CANONICAL (Layer 2 of CONNECTORS.md).
 *
 * A connector plugs an external system into the intelligence layer through four
 * optional capability surfaces (identity / sources / actions / signals). It may
 * implement any subset. Items emitted by a source sync are of registered
 * Layer-0 entity types; the host routes them into the EXISTING pipelines
 * (meetings → calendar-sync upsert, contacts → contacts + resolver,
 * documents/images → artifact-service).
 *
 * This file is the source of truth for the whole framework. The base shapes
 * (ConnectorStatus, ExternalPerson, SourceContainer, SourceItem, capability
 * providers, Connector) match the local mirror the Slack (C2) connector was
 * built against, so `export type { … } from '@hidock/connectors'` is a
 * zero-drift swap there. Extensions below (ExternalMeeting, descriptor/context/
 * factory, store + ingestion sink) are ADDITIVE. Keep it stable — additive
 * changes only once connectors ship.
 */

// ─────────────────────────────────────────────────────────────────────────────
// Status
// ─────────────────────────────────────────────────────────────────────────────

/** Lifecycle state of a configured connector instance. */
export type ConnectorStatusState =
  | 'disconnected'
  | 'connecting'
  | 'auth-needed'
  | 'connected'
  | 'syncing'
  | 'error'

export interface ConnectorStatus {
  state: ConnectorStatusState
  /** Human-readable detail (error text, "token missing", "Waiting for sign-in"). */
  message?: string
  /** ISO timestamp of the last successful sync, if any. */
  lastSyncAt?: string
  /**
   * Transient structured detail surfaced to the UI mid-flow. For device-code
   * auth this carries { verificationUri, userCode } so the UI can prompt.
   */
  detail?: Record<string, unknown>
}

// ─────────────────────────────────────────────────────────────────────────────
// People / identity
// ─────────────────────────────────────────────────────────────────────────────

/**
 * A person as seen in an external system — the raw material an
 * IdentityProvider feeds into People autocomplete and the resolver.
 */
export interface ExternalPerson {
  /** Stable id within the external system (e.g. Slack user id `U123`). */
  externalId: string
  name: string
  email?: string
  /** Additional known emails/aliases (additive; connectors may omit). */
  emails?: string[]
  avatarUrl?: string
  title?: string
  /** Employer / organization, when known (additive). */
  company?: string
  /** Department / team, when known (additive). */
  department?: string
  /** System-specific extras (team id, tz, is_bot…). */
  metadata?: Record<string, unknown>
}

/** A canonical contact the host asks a connector to enrich. */
export interface Contact {
  id: string
  name: string
  email?: string | null
}

/**
 * Metadata a connector contributes to a canonical contact, plus the confidence
 * that the connector's `externalId` really is this contact. A connector that
 * confirms an identity by a strong key (verified email) returns confidence 1.0.
 */
export interface Enrichment {
  connectorId: string
  externalId: string
  fields: {
    role?: string
    company?: string
    avatarUrl?: string
    presence?: string
    phone?: string
    timezone?: string
    [k: string]: unknown
  }
  /** 0..1 — 1.0 means a connector-confirmed identity (see CONNECTORS.md). */
  confidence: number
}

// ─────────────────────────────────────────────────────────────────────────────
// Structured canonical entities (additive — for connectors that emit meetings /
// contacts as first-class entities rather than artifacts, e.g. M365 calendar).
// ─────────────────────────────────────────────────────────────────────────────

/** A calendar event with real attendee emails — feeds meetings + the resolver. */
export interface ExternalMeeting {
  externalId: string
  title: string
  /** ISO-8601 start. */
  start: string
  /** ISO-8601 end. */
  end: string
  location?: string
  description?: string
  isOnline?: boolean
  onlineJoinUrl?: string
  organizer?: ExternalPerson
  attendees: ExternalPerson[]
  metadata?: Record<string, unknown>
}

// ─────────────────────────────────────────────────────────────────────────────
// Sources
// ─────────────────────────────────────────────────────────────────────────────

/** An external container that can become a living library capture. */
export interface SourceContainer {
  /** Stable id within the external system (e.g. Slack channel id `C123`). */
  externalId: string
  /** Display name (channel name, repo name, folder path). */
  name: string
  /** Container sub-kind for UI/badging (e.g. 'channel', 'dm', 'calendar', 'repo'). */
  kind: string
  /** Approximate item count, when cheap to know (additive). */
  itemCount?: number
  metadata?: Record<string, unknown>
}

/**
 * A single item emitted by a source sync. The host maps it onto an artifact of
 * a registered entity type (Layer 0): `kind` selects the type registration,
 * `text` becomes `extracted_text`, `url` points at a binary to fetch, and
 * `externalId` becomes `source_ref` (used for dedup + incremental replace).
 *
 * For structured canonical entities (kind 'meeting' | 'contact'), the connector
 * ALSO sets `entity`; the host then routes to calendar-sync / contacts+resolver
 * instead of artifact-service.
 */
export interface SourceItem {
  /** Stable source reference — unique per item within the container. */
  externalId: string
  /** Registered entity-type key: 'message' | 'image' | 'md' | 'meeting' | 'contact' | … */
  kind: string
  mime: string
  title?: string
  /** Renderable/extractable text (markdown for message logs). */
  text?: string
  /** For binary artifacts (images/files): a URL the host downloads. */
  url?: string
  /** Auth header value required to fetch `url`, if any (e.g. Slack bearer). */
  fetchAuthorization?: string
  /** ISO creation timestamp of the underlying item. */
  createdAt: string
  /** External id of the authoring person, if known (feeds graph edges). */
  authorExternalId?: string
  /** External ids of people referenced (@mentions) — feeds contact edges. */
  mentions?: string[]
  /** External id of a parent item (thread root) — preserves threaded context. */
  parentExternalId?: string
  /**
   * Structured canonical entity for kind 'meeting' | 'contact' (additive). When
   * present the host ingests it via calendar-sync / contacts instead of
   * artifact-service.
   */
  entity?: ExternalMeeting | ExternalPerson
  metadata?: Record<string, unknown>
}

/**
 * Result of a source pull. `items` are new artifacts/entities; `cursor` is the
 * opaque value to pass as `since` next time (the host persists it per source).
 */
export interface PullResult {
  items: SourceItem[]
  /** Opaque cursor to persist and replay as `since` on the next pull. */
  cursor?: string
  /** True if another page is immediately available (host keeps pulling). */
  hasMore?: boolean
  /** Signals emitted incidentally during the pull (e.g. membership edges). */
  signals?: GraphSignal[]
}

// ─────────────────────────────────────────────────────────────────────────────
// Actions / signals
// ─────────────────────────────────────────────────────────────────────────────

/** A reference to a canonical entity an action can target. */
export interface EntityRef {
  type: 'person' | 'project' | 'meeting' | 'knowledge' | string
  id: string
  /** Optional external identities already linked to the entity. */
  identities?: Array<{ connectorId: string; externalId: string }>
}

/** An outbound action a connector offers from an entity surface. */
export interface ConnectorAction {
  id: string
  connectorId: string
  /** Button label, e.g. "Message on Slack". */
  label: string
  /** Icon hint for the UI (connector decides; host may ignore). */
  icon?: string
  /**
   * Opaque payload the host echoes back to `runAction`. Carries the target
   * (e.g. the Slack channel/user id resolved from the entity's identities).
   */
  payload: Record<string, unknown>
}

export interface ActionInput {
  /** For a "send message" action: the message body. */
  text?: string
  [k: string]: unknown
}

export interface ActionResult {
  ok: boolean
  /** External id of the created object (e.g. message ts), if any. */
  externalId?: string
  error?: string
}

/** An event that updates entity metadata/edges without user action. */
export interface GraphSignal {
  connectorId: string
  /** e.g. 'person-channel', 'person-interaction', 'commit'. */
  type: string
  /** Free-form edge/metadata payload consumed by the graph ingest. */
  data: Record<string, unknown>
  at: string
}

// ─────────────────────────────────────────────────────────────────────────────
// Capability surfaces
// ─────────────────────────────────────────────────────────────────────────────

export interface IdentityProvider {
  /** Autocomplete: people matching a free-text query. */
  searchPeople(query: string): Promise<ExternalPerson[]>
  /** Enrich a canonical contact with external metadata + confidence. */
  enrich(contact: Contact): Promise<Enrichment | null>
}

export interface SourceProvider {
  /** Containers available to sync (channels/repos/folders/calendars). */
  listContainers(): Promise<SourceContainer[]>
  /**
   * Pull items from a container. `since` is the connector's own cursor from the
   * previous sync (opaque to the host); implementations return only newer items.
   */
  pull(container: SourceContainer, since?: string): Promise<PullResult>
}

export interface ActionProvider {
  /** Actions this connector offers for a given entity. */
  actionsFor(entity: EntityRef): ConnectorAction[]
  /** Execute an action previously returned by `actionsFor`. */
  runAction(action: ConnectorAction, input: ActionInput): Promise<ActionResult>
}

export interface SignalProvider {
  subscribe(onSignal: (s: GraphSignal) => void): void
  unsubscribe(): void
}

export interface ConnectorCapabilities {
  identity?: IdentityProvider
  sources?: SourceProvider
  actions?: ActionProvider
  signals?: SignalProvider
}

// ─────────────────────────────────────────────────────────────────────────────
// Connector + descriptor + runtime context
// ─────────────────────────────────────────────────────────────────────────────

export type ConnectorTransport = 'mcp' | 'native'

export type ConnectorAuthKind = 'none' | 'device-code' | 'oauth' | 'api-key' | 'mcp'

export interface ConnectorAuthDescriptor {
  kind: ConnectorAuthKind
  /** Ordered, human-readable setup steps (e.g. Azure app registration). */
  setupSteps?: string[]
  docsUrl?: string
}

export interface ConnectorConfigField {
  key: string
  label: string
  type: 'text' | 'password' | 'url' | 'number' | 'boolean'
  required?: boolean
  placeholder?: string
  /** Stored encrypted via safeStorage; never returned to the renderer in clear. */
  secret?: boolean
  help?: string
  /** Default value applied when the field is unset. */
  default?: string | number | boolean
}

export type ConnectorCapabilityKind = 'identity' | 'sources' | 'actions' | 'signals'

/**
 * UI + registration metadata for a connector. The registry maps descriptor.id →
 * factory; the descriptor drives Settings → Connectors. A connector INSTANCE
 * (below) carries the same id and the live capabilities/status.
 */
export interface ConnectorDescriptor {
  /** Stable id, e.g. 'm365', 'slack'. Matches the Connector instance's id. */
  id: string
  displayName: string
  description: string
  transport: ConnectorTransport
  auth: ConnectorAuthDescriptor
  /** Config fields rendered in Settings (secrets flagged). */
  configFields: ConnectorConfigField[]
  /** Which capability surfaces this connector offers. */
  capabilityKinds: ConnectorCapabilityKind[]
}

/** Flat map of a connector's config values. */
export type ConnectorConfig = Record<string, string | number | boolean>

export interface ConnectorConnectOptions {
  /** True for a user-initiated connect that may drive an interactive flow. */
  interactive?: boolean
}

export interface Connector {
  id: string
  kind: ConnectorTransport
  /** Connector type discriminator for the registry, e.g. 'slack'. */
  type: string
  /** Display name for Settings → Connectors. */
  name: string
  capabilities: ConnectorCapabilities
  status(): ConnectorStatus
  /**
   * Lifecycle (all optional — a config-only connector like Slack may omit them;
   * the host then derives connectivity from required config/secrets presence).
   *
   * `connect(opts)`: pass `{ interactive: true }` for a user-initiated sign-in
   * (may drive an interactive flow such as device-code). Omit / `false` for a
   * silent startup resume — a connector MUST NOT launch an interactive prompt
   * in the non-interactive case (report 'auth-needed' instead).
   */
  configure?(config: ConnectorConfig): Promise<void> | void
  connect?(opts?: ConnectorConnectOptions): Promise<ConnectorStatus> | ConnectorStatus
  disconnect?(): Promise<void> | void
}

/**
 * Injected into a connector at construction. Gives it config/secret access and
 * a way to report status — WITHOUT coupling it to the store or IPC layer.
 */
export interface ConnectorContext {
  readonly connectorId: string
  /** Current config values (merged with descriptor defaults). */
  getConfig(): ConnectorConfig
  /** Read a secret value (decrypted), or null if unset. */
  getSecret(key: string): string | null
  /** Persist (or clear, with null) a secret value, encrypted at rest. */
  setSecret(key: string, value: string | null): void
  /** Merge a status patch and emit a status-change event. */
  setStatus(patch: Partial<ConnectorStatus>): void
  /** Structured log honoring the QA-logs toggle. */
  log(message: string, extra?: unknown): void
}

/** Factory that builds a connector bound to a runtime context. */
export type ConnectorFactory = (ctx: ConnectorContext) => Connector

// ─────────────────────────────────────────────────────────────────────────────
// Persistence abstraction (implemented by the host app; keeps this package
// free of Electron/OS dependencies)
// ─────────────────────────────────────────────────────────────────────────────

export interface StoredSourceState {
  enabled: boolean
  cursor: string | null
  lastSyncAt: string | null
}

export interface StoredConnectorState {
  config: ConnectorConfig
  lastSyncAt: string | null
  sources: Record<string, StoredSourceState>
}

export interface ConnectorStateStore {
  getState(id: string): StoredConnectorState
  getConfig(id: string): ConnectorConfig
  setConfig(id: string, config: ConnectorConfig): void
  getSecret(id: string, key: string): string | null
  hasSecret(id: string, key: string): boolean
  setSecret(id: string, key: string, value: string | null): void
  setLastSyncAt(id: string, iso: string | null): void
  getSourceState(id: string, containerId: string): StoredSourceState
  setSourceState(id: string, containerId: string, patch: Partial<StoredSourceState>): void
}

// ─────────────────────────────────────────────────────────────────────────────
// Ingestion — how emitted items reach existing pipelines
// ─────────────────────────────────────────────────────────────────────────────

/**
 * The host routes pulled items to a sink. The real sink wires meetings →
 * calendar-sync, contacts → contacts+resolver, documents/images →
 * artifact-service. Connectors never call the sink directly.
 */
export interface IngestionSink {
  ingest(connectorId: string, container: SourceContainer, items: SourceItem[]): Promise<IngestionOutcome>
}

export interface IngestionOutcome {
  meetings: number
  contacts: number
  artifacts: number
  skipped: number
}

// ─────────────────────────────────────────────────────────────────────────────
// UI-facing summaries (serializable across IPC)
// ─────────────────────────────────────────────────────────────────────────────

export interface ConnectorConfigFieldView extends ConnectorConfigField {
  /** Current value; secrets are redacted to ''. */
  value: string | number | boolean
  /** Whether a secret value is currently set (without revealing it). */
  hasValue?: boolean
}

export interface ConnectorSourceView extends SourceContainer {
  enabled: boolean
  lastSyncAt: string | null
}

export interface ConnectorSummary {
  descriptor: ConnectorDescriptor
  status: ConnectorStatus
  /** Config fields with current (redacted-for-secrets) values. */
  fields: ConnectorConfigFieldView[]
  /** Known syncable sources for this connector, if it has a SourceProvider. */
  sources?: ConnectorSourceView[]
}
