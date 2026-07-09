/**
 * Connector-host contract — LOCAL MIRROR (verified against the canonical file).
 *
 * These interfaces mirror the contract in the connector-host package
 * `@hidock/connectors` (`packages/connectors/src/types.ts`), owned by the C3
 * host agent. As of 2026-07-09 that canonical file has LANDED and this mirror
 * was checked against it: the base shapes used by this connector are ZERO-DRIFT
 * (the host's header states it was aligned to this very mirror). The host adds
 * only additive optional fields (ExternalPerson.emails/company/department,
 * SourceContainer.itemCount, SourceItem.entity, PullResult.hasMore,
 * ConnectorStatus.detail, ConnectorStatusState 'connecting', and optional
 * Connector.configure/connect/disconnect) — none of which this connector relies
 * on, so its emissions remain valid under the canonical types.
 *
 * The mirror is kept (rather than a hard build-time dependency) so this package
 * stays independently green while `@hidock/connectors` is still uncommitted /
 * unbuilt and under active development. RECONCILIATION when it publishes is a
 * single-file swap — replace every declaration below with:
 *
 *     export type {
 *       ConnectorStatusState, ConnectorStatus, ExternalPerson, Contact,
 *       Enrichment, SourceContainer, SourceItem, PullResult, EntityRef,
 *       ConnectorAction, ActionInput, ActionResult, GraphSignal,
 *       IdentityProvider, SourceProvider, ActionProvider, SignalProvider,
 *       ConnectorCapabilities, Connector
 *     } from '@hidock/connectors'
 *
 * plus adding `"@hidock/connectors": "file:../connectors"` to dependencies.
 * The rest of the connector imports ONLY from './contract.js', so no other file
 * changes. Any future non-additive drift is reported, not silently absorbed.
 */

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
  /** Human-readable detail (error text, "token missing", …). */
  message?: string
  /** ISO timestamp of the last successful sync, if any. */
  lastSyncAt?: string
  /** Transient structured detail surfaced to the UI mid-flow (additive). */
  detail?: Record<string, unknown>
}

/**
 * A person as seen in an external system — the raw material an
 * IdentityProvider feeds into People autocomplete and the resolver.
 */
export interface ExternalPerson {
  /** Stable id within the external system (e.g. Slack user id `U123`). */
  externalId: string
  name: string
  email?: string
  avatarUrl?: string
  title?: string
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

/** An external container that can become a living library capture. */
export interface SourceContainer {
  /** Stable id within the external system (e.g. Slack channel id `C123`). */
  externalId: string
  /** Display name (channel name, repo name, folder path). */
  name: string
  /** Container sub-kind for UI/badging (e.g. 'channel', 'dm', 'repo'). */
  kind: string
  metadata?: Record<string, unknown>
}

/**
 * A single item emitted by a source sync. The host maps it onto an artifact of
 * a registered entity type (Layer 0): `kind` selects the type registration,
 * `text` becomes `extracted_text`, `url` points at a binary to fetch, and
 * `externalId` becomes `source_ref` (used for dedup + incremental replace).
 */
export interface SourceItem {
  /** Stable source reference — unique per item within the container. */
  externalId: string
  /** Registered entity-type key: 'message' | 'image' | 'md' | … */
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
  metadata?: Record<string, unknown>
}

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

/** An event that updates entity metadata/edges without user action. */
export interface GraphSignal {
  connectorId: string
  /** e.g. 'person-channel', 'person-interaction'. */
  type: string
  /** Free-form edge/metadata payload consumed by the graph ingest. */
  data: Record<string, unknown>
  at: string
}

export interface IdentityProvider {
  /** Autocomplete: people matching a free-text query. */
  searchPeople(query: string): Promise<ExternalPerson[]>
  /** Enrich a canonical contact with external metadata + confidence. */
  enrich(contact: Contact): Promise<Enrichment | null>
}

export interface SourceProvider {
  /** Containers available to sync (channels/repos/folders). */
  listContainers(): Promise<SourceContainer[]>
  /**
   * Pull items from a container. `since` is the connector's own cursor from the
   * previous sync (opaque to the host); implementations return only newer items.
   */
  pull(container: SourceContainer, since?: string): Promise<PullResult>
}

/**
 * Result of a source pull. `items` are new artifacts; `cursor` is the opaque
 * value to pass as `since` next time (the host persists it per source).
 */
export interface PullResult {
  items: SourceItem[]
  /** Opaque cursor to persist and replay as `since` on the next pull. */
  cursor?: string
  /** Signals emitted incidentally during the pull (e.g. membership edges). */
  signals?: GraphSignal[]
}

export interface ActionProvider {
  /** Actions this connector offers for a given entity. */
  actionsFor(entity: EntityRef): ConnectorAction[]
  /** Execute an action previously returned by `actionsFor`. */
  runAction(action: ConnectorAction, input: ActionInput): Promise<ActionResult>
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

export interface Connector {
  id: string
  kind: 'mcp' | 'native'
  /** Connector type discriminator for the registry, e.g. 'slack'. */
  type: string
  /** Display name for Settings → Connectors. */
  name: string
  capabilities: ConnectorCapabilities
  status(): ConnectorStatus
}
