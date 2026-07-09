/**
 * SlackConnector — implements the connector-host `Connector` contract over the
 * Slack Web API (transport = native HTTP + token; see CONNECTORS.md).
 *
 * Capability surfaces:
 *  - identity: user search (People autocomplete) + contact enrichment (+confidence)
 *  - sources:  channels as living md captures (messages + image artifacts)
 *  - actions:  "Message on Slack" from a person surface
 *  - signals:  author→channel edges emitted during sync (bridged to subscribers)
 *
 * The Slack user directory is cached and lazily loaded; identity + message
 * rendering both read from it so `<@U…>` mentions resolve to names.
 */

import type {
  ActionInput,
  ActionProvider,
  ActionResult,
  Connector,
  ConnectorAction,
  ConnectorStatus,
  Contact,
  EntityRef,
  Enrichment,
  ExternalPerson,
  GraphSignal,
  IdentityProvider,
  PullResult,
  SignalProvider,
  SourceContainer,
  SourceProvider
} from './contract.js'
import type { ConnectorContext, ConnectorDescriptor, ConnectorFactory } from '@hidock/connectors'
import {
  bestName,
  channelToSourceContainer,
  userToEnrichment,
  userToExternalPerson,
  type MappingContext
} from './entity-mapping.js'
import { SlackApiError, SlackClient } from './slack-client.js'
import { syncChannel, type SyncChannelOptions } from './sync.js'
import type { SlackClientDeps, SlackConnectorConfig, SlackUser } from './types.js'

export const SLACK_CONNECTOR_TYPE = 'slack'

/**
 * OAuth scopes this connector needs. Documented for the Settings UI and the
 * host so the user knows exactly what to grant when creating the token.
 */
export const SLACK_REQUIRED_SCOPES = {
  /** Read channel message history (conversations.history / .replies). */
  history: 'channels:history',
  /** List/read channel metadata (conversations.list). */
  channels: 'channels:read',
  /** Resolve users → contacts, mentions → names, enrichment (users.list/.info). */
  users: 'users:read',
  /** Read user emails for identity matching (confidence 1.0). Optional. */
  usersEmail: 'users:read.email',
  /** Post messages for the "Message on Slack" action. Optional (actions only). */
  chatWrite: 'chat:write'
} as const

export function createSlackConnector(config: SlackConnectorConfig, deps: SlackClientDeps = {}): SlackConnector {
  return new SlackConnector(config, deps)
}

export class SlackConnector implements Connector, IdentityProvider, SourceProvider, ActionProvider, SignalProvider {
  readonly kind = 'native' as const
  readonly type = SLACK_CONNECTOR_TYPE
  readonly name = 'Slack'

  readonly capabilities: Connector['capabilities']

  private readonly client: SlackClient
  private readonly config: SlackConnectorConfig
  private status_: ConnectorStatus = { state: 'disconnected' }

  private directory: SlackUser[] | null = null
  private userNames: Map<string, string> = new Map()
  private signalListener: ((s: GraphSignal) => void) | null = null

  constructor(config: SlackConnectorConfig, deps: SlackClientDeps = {}) {
    this.config = config
    this.client = new SlackClient(config.token, deps)
    this.capabilities = {
      identity: this,
      sources: this,
      actions: this,
      signals: this
    }
    // Stable id so the host can key persisted cursors/identities across restarts.
    // Empty token → stable literal id so the host can still enumerate/register it.
    this.id = config.token ? `slack:${hashToken(config.token)}` : 'slack:unconfigured'
    if (!config.token) this.status_ = { state: 'auth-needed', message: 'token missing' }
  }

  readonly id: string

  status(): ConnectorStatus {
    return this.status_
  }

  /** Validate the token and move to connected/auth-needed. Idempotent. */
  async connect(): Promise<ConnectorStatus> {
    if (!this.config.token) {
      this.status_ = { state: 'auth-needed', message: 'token missing' }
      return this.status_
    }
    try {
      const res = await this.client.authTest()
      this.status_ = { state: 'connected', message: res.team ? `Connected to ${res.team}` : undefined }
    } catch (err) {
      this.status_ = toStatus(err)
    }
    return this.status_
  }

  // --- Bearer used by the host to fetch image bytes -------------------------
  private get fetchAuthorization(): string {
    return `Bearer ${this.config.token}`
  }

  private mappingContext(): MappingContext {
    return {
      connectorId: this.id,
      userNames: this.userNames,
      fetchAuthorization: this.fetchAuthorization
    }
  }

  // --- directory cache ------------------------------------------------------

  /** Load (once) and cache the Slack user directory. */
  async ensureDirectory(force = false): Promise<SlackUser[]> {
    if (this.directory && !force) return this.directory
    const users = await this.client.listUsers()
    this.directory = users
    this.userNames = new Map(users.map((u) => [u.id, bestName(u)]))
    return users
  }

  // --- IdentityProvider -----------------------------------------------------

  async searchPeople(query: string): Promise<ExternalPerson[]> {
    const users = await this.ensureDirectory()
    const q = query.trim().toLowerCase()
    const humans = users.filter((u) => !u.deleted && !u.is_bot)
    const matches = q
      ? humans.filter((u) => {
          const name = bestName(u).toLowerCase()
          const handle = (u.name ?? '').toLowerCase()
          const email = (u.profile?.email ?? '').toLowerCase()
          return name.includes(q) || handle.includes(q) || email.includes(q)
        })
      : humans
    return matches.slice(0, 25).map(userToExternalPerson)
  }

  async enrich(contact: Contact): Promise<Enrichment | null> {
    const users = await this.ensureDirectory()
    const email = contact.email?.trim().toLowerCase()
    if (email) {
      const byEmail = users.find((u) => u.profile?.email?.trim().toLowerCase() === email)
      if (byEmail) return userToEnrichment(this.id, byEmail, true)
    }
    const name = contact.name.trim().toLowerCase()
    const byName = users.find((u) => bestName(u).trim().toLowerCase() === name && !u.deleted && !u.is_bot)
    return byName ? userToEnrichment(this.id, byName, false) : null
  }

  /**
   * Bulk user→contact list (feeds the identity resolver / contact sync).
   * Excludes deleted accounts and bots.
   */
  async listPeople(): Promise<ExternalPerson[]> {
    const users = await this.ensureDirectory()
    return users.filter((u) => !u.deleted && !u.is_bot).map(userToExternalPerson)
  }

  // --- SourceProvider -------------------------------------------------------

  /** All channels the token can see (the user picks which to sync). */
  async listContainers(): Promise<SourceContainer[]> {
    const channels = await this.client.listChannels()
    return channels.map(channelToSourceContainer)
  }

  /** Channels the user opted into (config.channelAllowlist), for the scheduler. */
  async listSelectedContainers(): Promise<SourceContainer[]> {
    const allow = new Set(this.config.channelAllowlist ?? [])
    if (allow.size === 0) return []
    const all = await this.listContainers()
    return all.filter((c) => allow.has(c.externalId))
  }

  async pull(container: SourceContainer, since?: string, opts?: SyncChannelOptions): Promise<PullResult> {
    // Names resolve mentions → @display; load the directory before mapping.
    await this.ensureDirectory().catch(() => undefined)
    const result = await syncChannel(this.client, container.externalId, this.mappingContext(), since, opts)
    // Bridge pull-time signals to any push subscriber.
    if (this.signalListener && result.signals) {
      for (const s of result.signals) this.signalListener(s)
    }
    return result
  }

  // --- ActionProvider -------------------------------------------------------

  actionsFor(entity: EntityRef): ConnectorAction[] {
    if (entity.type !== 'person') return []
    const identity = entity.identities?.find((i) => i.connectorId === this.id)
    if (!identity) return []
    return [
      {
        id: `slack:message:${identity.externalId}`,
        connectorId: this.id,
        label: 'Message on Slack',
        icon: 'slack',
        // chat.postMessage with a user id as the channel opens/uses the DM.
        payload: { channel: identity.externalId, targetType: 'user' }
      }
    ]
  }

  async runAction(action: ConnectorAction, input: ActionInput): Promise<ActionResult> {
    const channel = String(action.payload.channel ?? '')
    const text = input.text ?? ''
    if (!channel) return { ok: false, error: 'no target channel in action payload' }
    if (!text.trim()) return { ok: false, error: 'message text is empty' }
    try {
      const res = await this.client.postMessage(channel, text)
      return { ok: true, externalId: res.ts }
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) }
    }
  }

  // --- SignalProvider -------------------------------------------------------

  subscribe(onSignal: (s: GraphSignal) => void): void {
    this.signalListener = onSignal
  }

  unsubscribe(): void {
    this.signalListener = null
  }
}

function toStatus(err: unknown): ConnectorStatus {
  if (err instanceof SlackApiError) {
    const authErrors = new Set(['invalid_auth', 'not_authed', 'account_inactive', 'token_revoked', 'token_expired'])
    if (authErrors.has(err.code)) return { state: 'auth-needed', message: err.code }
    return { state: 'error', message: err.code }
  }
  return { state: 'error', message: err instanceof Error ? err.message : String(err) }
}

/** Small stable, non-reversible fingerprint of the token for the connector id. */
function hashToken(token: string): string {
  let h = 5381
  for (let i = 0; i < token.length; i++) h = ((h << 5) + h + token.charCodeAt(i)) >>> 0
  return h.toString(16)
}

// ─────────────────────────────────────────────────────────────────────────────
// Host registration — descriptor + context-bound factory
//
// The host registry maps `descriptor.id → factory`. The factory receives a
// ConnectorContext and reads the token via ctx.getSecret('token') (secrets live
// in safeStorage, never in the DB) and the channel allowlist via ctx.getConfig().
// The host can register this connector WITHOUT editing this package.
// ─────────────────────────────────────────────────────────────────────────────

/** Settings → Connectors metadata for Slack. */
export const slackDescriptor: ConnectorDescriptor = {
  id: SLACK_CONNECTOR_TYPE,
  displayName: 'Slack',
  description:
    'Sync selected Slack channels as living message logs (+ image attachments), map users to contacts for identity resolution, and send messages from a person surface.',
  transport: 'native',
  auth: {
    kind: 'api-key',
    setupSteps: [
      'Create a Slack app at https://api.slack.com/apps (or reuse an existing one).',
      `Add the required bot/user token scopes: ${SLACK_REQUIRED_SCOPES.history}, ${SLACK_REQUIRED_SCOPES.channels}, ${SLACK_REQUIRED_SCOPES.users} (plus ${SLACK_REQUIRED_SCOPES.usersEmail} for email-confident identity match and ${SLACK_REQUIRED_SCOPES.chatWrite} for the send-message action).`,
      'Install the app to your workspace and copy the token (xoxb-… or xoxp-…).',
      'Paste the token below and pick the channels to sync.'
    ],
    docsUrl: 'https://api.slack.com/authentication/token-types'
  },
  configFields: [
    {
      key: 'token',
      label: 'Slack token',
      type: 'password',
      required: true,
      secret: true,
      placeholder: 'xoxb-… or xoxp-…',
      help: 'Bot or user token. Stored encrypted; never written to the database.'
    },
    {
      key: 'channelAllowlist',
      label: 'Channels to sync',
      type: 'text',
      required: false,
      placeholder: 'C0123ABCD, C0456EFGH',
      help: 'Comma-separated channel IDs to sync. Leave empty to sync none until you opt channels in.'
    }
  ],
  capabilityKinds: ['identity', 'sources', 'actions', 'signals']
}

/** Parse the comma-separated `channelAllowlist` config field into ids. */
function parseAllowlist(value: unknown): string[] {
  return String(value ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
}

/**
 * Host factory: builds a Slack connector bound to a runtime ConnectorContext.
 * Register with `descriptor.id` ('slack') → this factory in the host registry.
 */
export const slackConnectorFactory: ConnectorFactory = (ctx: ConnectorContext) => {
  const token = ctx.getSecret('token') ?? ''
  const cfg = ctx.getConfig()
  return createSlackConnector({
    token,
    channelAllowlist: parseAllowlist(cfg.channelAllowlist)
  })
}
