/**
 * C3 — Microsoft 365 / Microsoft Graph connector (native transport).
 *
 * Auth: OAuth 2.0 via @azure/msal-node (PublicClientApplication). Two interactive
 * flows are supported:
 *   1. Authorization Code + PKCE via the SYSTEM BROWSER with a loopback redirect
 *      (`http://localhost:<ephemeral>`) — the DEFAULT, HiNotes-style "click and a
 *      popup asks you to allow access" experience. See `loopback-server.ts`.
 *   2. Device-code — the FALLBACK for headless/remote machines with no browser.
 *
 * A shipped DEFAULT public client id (`default-app.ts`) lets the connector work
 * with ZERO setup: if the user hasn't pasted their own Application (client) ID
 * and a default exists, the default is used and no registration walkthrough is
 * shown. Users can still bring their own app registration via the "advanced"
 * toggle. Client IDs are PUBLIC identifiers, not secrets (this is a public
 * client; security comes from PKCE + interactive consent).
 *
 * Multiple accounts: the connector is `multiInstance` — its live id comes from
 * `ctx.connectorId` (e.g. 'm365' for the first/legacy account, 'm365:<uuid>' for
 * additional ones like "Microsoft 365 — Personal" + "Microsoft 365 — Work").
 * Config, secrets, and the MSAL token cache are all namespaced by that id via the
 * injected `ConnectorContext`, so accounts never collide.
 *
 * Capabilities:
 *  - identity: /me/people search (autocomplete) + enrich (role/company/avatar).
 *  - sources:  calendar events WITH attendee emails (delta) + contacts (delta),
 *              emitted as SourceItems carrying structured ExternalMeeting /
 *              ExternalPerson `entity` payloads for the ingestion sink.
 *
 * The Graph transport + token acquisition + interactive flows are injectable
 * (`M365Deps`) so the mapping/sync logic is unit-testable without MSAL, a
 * browser, or the network.
 */
import type {
  Connector,
  ConnectorConfigField,
  ConnectorConnectOptions,
  ConnectorContext,
  ConnectorDescriptor,
  ConnectorStatus,
  ConnectorStatusState,
  Contact,
  Enrichment,
  ExternalPerson,
  PullResult,
  SourceContainer,
  SourceItem,
} from '@hidock/connectors'
import { mapGraphContact, mapGraphEvent, mapGraphPerson } from './graph-mappers'
import { DEFAULT_M365_CLIENT_ID, DEFAULT_M365_TENANT, hasDefaultM365App } from './default-app'
import { startLoopbackServer } from './loopback-server'

const GRAPH_BASE = 'https://graph.microsoft.com/v1.0'
/** Delegated scopes. Reserved scopes (openid/profile/offline_access) are added by MSAL. */
const GRAPH_SCOPES = ['User.Read', 'Calendars.Read', 'Contacts.Read', 'People.Read']

const CALENDAR_WINDOW_PAST_DAYS = 30
const CALENDAR_WINDOW_FUTURE_DAYS = 120
const MSAL_CACHE_SECRET = 'msalCache' // pragma: allowlist secret — store KEY name, not a credential
/** How long the loopback server waits for the browser redirect before giving up. */
const AUTH_CODE_TIMEOUT_MS = 5 * 60_000

const CALENDAR_CONTAINER: SourceContainer = {
  externalId: 'calendar',
  name: 'Calendar',
  kind: 'calendar',
}
const CONTACTS_CONTAINER: SourceContainer = {
  externalId: 'contacts',
  name: 'Contacts',
  kind: 'contacts',
}

export interface M365Deps {
  /**
   * Try to get a token silently (from cache). Returns null when no cached
   * account, which triggers an interactive flow. Default: MSAL acquireTokenSilent.
   */
  trySilentToken?: () => Promise<string | null>
  /** Acquire a Graph access token for API calls. Default: MSAL silent. */
  acquireToken?: () => Promise<string>
  /** Perform an authenticated Graph GET returning parsed JSON. Default: global fetch. */
  graphFetch?: (url: string, token: string) => Promise<any>
  /** Run the interactive device-code sign-in. Default: MSAL acquireTokenByDeviceCode. */
  runDeviceCode?: (onPrompt: (p: DeviceCodePrompt) => void) => Promise<void>
  /**
   * Run the interactive auth-code (system browser + loopback) sign-in. Default:
   * MSAL getAuthCodeUrl/acquireTokenByCode with PKCE + a one-shot loopback server.
   */
  runAuthCode?: (onPrompt: (p: AuthCodePrompt) => void) => Promise<void>
  /** Open a URL in the system browser. Default: electron shell.openExternal. */
  openExternal?: (url: string) => Promise<void>
}

export interface DeviceCodePrompt {
  verificationUri: string
  userCode: string
  message: string
}

export interface AuthCodePrompt {
  /** The Microsoft sign-in URL opened in the system browser. */
  url: string
  message: string
}

const HAS_DEFAULT_APP = hasDefaultM365App()

/** Build the clientId/tenant config fields, adapting to whether a default ships. */
function buildConfigFields(): ConnectorConfigField[] {
  return [
    {
      key: 'clientId',
      label: 'Application (client) ID',
      type: 'text',
      // Only mandatory when there is NO shipped default to fall back to.
      required: !HAS_DEFAULT_APP,
      // When a default exists, this is part of the collapsed "advanced" path.
      advanced: HAS_DEFAULT_APP,
      placeholder: '00000000-0000-0000-0000-000000000000',
      help: HAS_DEFAULT_APP
        ? 'Optional. Leave blank to use the built-in HiDock app. Paste your own Entra app’s client ID to use your own registration.'
        : 'From your Entra app registration → Overview.',
    },
    {
      key: 'tenant',
      label: 'Directory (tenant)',
      type: 'text',
      advanced: HAS_DEFAULT_APP,
      default: DEFAULT_M365_TENANT,
      help: "Use 'common' for personal + work/school accounts, or your tenant ID / domain (e.g. contoso.onmicrosoft.com).",
    },
  ]
}

const OWN_APP_SETUP_STEPS = [
  'Go to the Microsoft Entra admin center → App registrations → New registration.',
  "Name it (e.g. 'HiDock Next'). Supported account types: choose 'Accounts in any organizational directory and personal Microsoft accounts' for tenant 'common'.",
  'Register. On the Overview page copy the Application (client) ID.',
  "Authentication → Add a platform → 'Mobile and desktop applications'. Add redirect URI 'http://localhost' (for the browser sign-in) and, optionally, 'https://login.microsoftonline.com/common/oauth2/nativeclient' (device-code fallback).",
  "Authentication → Advanced settings → set 'Allow public client flows' to Yes, then Save.",
  'API permissions → Add a permission → Microsoft Graph → Delegated permissions → add Calendars.Read, Contacts.Read, People.Read, User.Read.',
  'Paste the client ID under Advanced below, Save, then click Connect and sign in in your browser.',
]

export const m365Descriptor: ConnectorDescriptor = {
  id: 'm365',
  displayName: 'Microsoft 365',
  description:
    'Sync Outlook calendar events (with attendee emails) and contacts from Microsoft 365 via Microsoft Graph. Feeds meetings and the identity resolver.',
  transport: 'native',
  multiInstance: true,
  // With a shipped default app the walkthrough is hidden behind an advanced toggle.
  setupOptional: HAS_DEFAULT_APP,
  auth: {
    kind: 'oauth',
    docsUrl: 'https://learn.microsoft.com/entra/identity-platform/quickstart-register-app',
    setupSteps: OWN_APP_SETUP_STEPS,
  },
  configFields: buildConfigFields(),
  capabilityKinds: ['identity', 'sources'],
}

export class M365Connector implements Connector {
  readonly id: string
  readonly kind = 'native' as const
  readonly type = 'm365'
  readonly name = 'Microsoft 365'

  private state: ConnectorStatusState = 'disconnected'
  private lastError: string | undefined
  // Lazily-built MSAL client (only when default deps are used).
  private msal: import('@azure/msal-node').PublicClientApplication | null = null
  private account: import('@azure/msal-node').AccountInfo | null = null

  constructor(
    private readonly ctx: ConnectorContext,
    private readonly deps: M365Deps = {}
  ) {
    this.id = ctx.connectorId
  }

  status(): ConnectorStatus {
    return { state: this.state, message: this.lastError }
  }

  capabilities = {
    identity: {
      searchPeople: (query: string) => this.searchPeople(query),
      enrich: (contact: Contact) => this.enrich(contact),
    },
    sources: {
      listContainers: async (): Promise<SourceContainer[]> => [CALENDAR_CONTAINER, CONTACTS_CONTAINER],
      pull: (container: SourceContainer, since?: string) => this.pull(container, since),
    },
  }

  // ── Config resolution (user value wins; shipped default is the fallback) ─────

  /** Effective client id: the user's own, else the shipped default (may be ''). */
  private resolveClientId(): string {
    const user = String(this.ctx.getConfig().clientId ?? '').trim()
    return user || DEFAULT_M365_CLIENT_ID.trim()
  }

  private resolveTenant(): string {
    return String(this.ctx.getConfig().tenant ?? '').trim() || DEFAULT_M365_TENANT
  }

  // ── Lifecycle ──────────────────────────────────────────────────────────────

  async configure(): Promise<void> {
    // Config changes (clientId/tenant) invalidate the MSAL client; rebuild lazily.
    this.msal = null
  }

  async connect(opts?: ConnectorConnectOptions): Promise<ConnectorStatus> {
    const clientId = this.resolveClientId()
    if (!clientId) {
      this.state = 'auth-needed'
      this.lastError = 'Set the Azure Application (client) ID in Settings first.'
      this.ctx.setStatus({ state: 'auth-needed', message: this.lastError })
      return this.status()
    }
    try {
      const token = this.deps.trySilentToken ? await this.deps.trySilentToken() : await this.silentTokenMsal()
      if (token) {
        this.setConnected()
        return this.status()
      }
      // No cached session. Never launch an interactive flow on a silent startup
      // resume — only when the user explicitly clicks Connect.
      if (!opts?.interactive) {
        this.state = 'auth-needed'
        this.lastError = 'Sign in with Microsoft 365 to connect.'
        this.ctx.setStatus({ state: 'auth-needed', message: this.lastError })
        return this.status()
      }
      // Interactive sign-in. Default to the browser (auth-code) flow; device-code
      // is the explicit fallback for headless machines.
      if (opts.authMode === 'device-code') {
        const runDeviceCode = this.deps.runDeviceCode ?? ((onPrompt) => this.msalDeviceCode(onPrompt))
        await runDeviceCode((prompt) => {
          this.state = 'connecting'
          this.ctx.setStatus({
            state: 'connecting',
            message: prompt.message,
            detail: {
              mode: 'device-code',
              verificationUri: prompt.verificationUri,
              userCode: prompt.userCode,
              fullMessage: prompt.message,
            },
          })
        })
      } else {
        const runAuthCode = this.deps.runAuthCode ?? ((onPrompt) => this.msalAuthCode(onPrompt))
        await runAuthCode((prompt) => {
          this.state = 'connecting'
          this.ctx.setStatus({
            state: 'connecting',
            message: prompt.message,
            detail: { mode: 'auth-code', authUrl: prompt.url, fullMessage: prompt.message },
          })
        })
      }
      this.setConnected()
      return this.status()
    } catch (err) {
      this.state = 'error'
      this.lastError = err instanceof Error ? err.message : String(err)
      this.ctx.setStatus({ state: 'error', message: this.lastError })
      throw err
    }
  }

  async disconnect(): Promise<void> {
    this.state = 'disconnected'
    this.lastError = undefined
    this.account = null
    // Clear the cached tokens so the next connect re-prompts.
    this.ctx.setSecret(MSAL_CACHE_SECRET, null)
    this.msal = null
  }

  private setConnected(): void {
    this.state = 'connected'
    this.lastError = undefined
    this.ctx.setStatus({ state: 'connected', message: undefined, detail: undefined })
  }

  // ── MSAL plumbing (default deps) ─────────────────────────────────────────────

  private pca(): import('@azure/msal-node').PublicClientApplication {
    if (this.msal) return this.msal
    // Deferred require so unit tests using injected deps never load MSAL.
    const { PublicClientApplication } = require('@azure/msal-node') as typeof import('@azure/msal-node')
    const clientId = this.resolveClientId()
    const tenant = this.resolveTenant()
    this.msal = new PublicClientApplication({
      auth: { clientId, authority: `https://login.microsoftonline.com/${tenant}` },
      cache: {
        cachePlugin: {
          beforeCacheAccess: async (cacheContext) => {
            const cached = this.ctx.getSecret(MSAL_CACHE_SECRET)
            if (cached) cacheContext.tokenCache.deserialize(cached)
          },
          afterCacheAccess: async (cacheContext) => {
            if (cacheContext.cacheHasChanged) {
              this.ctx.setSecret(MSAL_CACHE_SECRET, cacheContext.tokenCache.serialize())
            }
          },
        },
      },
    })
    return this.msal
  }

  /** Returns an access token via MSAL silent flow, or null if no cached account. */
  private async silentTokenMsal(): Promise<string | null> {
    const pca = this.pca()
    const accounts = await pca.getTokenCache().getAllAccounts()
    const account = this.account ?? accounts[0]
    if (!account) return null
    try {
      const result = await pca.acquireTokenSilent({ account, scopes: GRAPH_SCOPES })
      this.account = account
      return result?.accessToken ?? null
    } catch {
      return null
    }
  }

  private async msalDeviceCode(onPrompt: (p: DeviceCodePrompt) => void): Promise<void> {
    const pca = this.pca()
    const result = await pca.acquireTokenByDeviceCode({
      scopes: GRAPH_SCOPES,
      deviceCodeCallback: (resp) =>
        onPrompt({ verificationUri: resp.verificationUri, userCode: resp.userCode, message: resp.message }),
    })
    if (!result) throw new Error('Device-code sign-in was cancelled or timed out.')
    this.account = result.account ?? null
  }

  /**
   * Authorization Code + PKCE via the system browser. Binds a one-shot loopback
   * server, opens the Microsoft sign-in page, and exchanges the returned code.
   */
  private async msalAuthCode(onPrompt: (p: AuthCodePrompt) => void): Promise<void> {
    const pca = this.pca()
    const { CryptoProvider } = require('@azure/msal-node') as typeof import('@azure/msal-node')
    const crypto = new CryptoProvider()
    const { verifier, challenge } = await crypto.generatePkceCodes()
    const server = await startLoopbackServer()
    try {
      const authUrl = await pca.getAuthCodeUrl({
        scopes: GRAPH_SCOPES,
        redirectUri: server.redirectUri,
        codeChallenge: challenge,
        codeChallengeMethod: 'S256',
        prompt: 'select_account',
      })
      onPrompt({ url: authUrl, message: 'Opening your browser to sign in to Microsoft 365…' })
      const openExternal = this.deps.openExternal ?? ((url: string) => this.defaultOpenExternal(url))
      await openExternal(authUrl)
      const result = await server.waitForCode(AUTH_CODE_TIMEOUT_MS)
      if (result.error) throw new Error(result.errorDescription || result.error)
      if (!result.code) throw new Error('No authorization code returned from the Microsoft sign-in.')
      const tokenResult = await pca.acquireTokenByCode({
        scopes: GRAPH_SCOPES,
        redirectUri: server.redirectUri,
        code: result.code,
        codeVerifier: verifier,
      })
      this.account = tokenResult?.account ?? null
    } finally {
      server.close()
    }
  }

  private async defaultOpenExternal(url: string): Promise<void> {
    // Deferred require so unit tests never load electron.
    const { shell } = require('electron') as typeof import('electron')
    await shell.openExternal(url)
  }

  private async acquireToken(): Promise<string> {
    if (this.deps.acquireToken) return this.deps.acquireToken()
    const token = await this.silentTokenMsal()
    if (!token) throw new Error('Not connected — sign in with Microsoft 365 first.')
    return token
  }

  // ── Graph transport ─────────────────────────────────────────────────────────

  private async graphGet(pathOrUrl: string): Promise<any> {
    const token = await this.acquireToken()
    if (this.deps.graphFetch) return this.deps.graphFetch(pathOrUrl, token)
    const url = pathOrUrl.startsWith('http') ? pathOrUrl : `${GRAPH_BASE}${pathOrUrl}`
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${token}`, Prefer: 'outlook.timezone="UTC"' },
    })
    if (!res.ok) {
      const body = await res.text().catch(() => '')
      throw new Error(`Graph GET ${res.status} ${res.statusText}: ${body.slice(0, 300)}`)
    }
    return res.json()
  }

  // ── Sources ──────────────────────────────────────────────────────────────────

  private calendarInitialUrl(): string {
    const start = new Date(Date.now() - CALENDAR_WINDOW_PAST_DAYS * 86_400_000).toISOString()
    const end = new Date(Date.now() + CALENDAR_WINDOW_FUTURE_DAYS * 86_400_000).toISOString()
    const select = 'subject,start,end,location,onlineMeeting,isOnlineMeeting,organizer,attendees,bodyPreview,webLink,showAs,seriesMasterId'
    return `/me/calendarView/delta?startDateTime=${encodeURIComponent(start)}&endDateTime=${encodeURIComponent(end)}&$select=${select}`
  }

  private async pull(container: SourceContainer, since?: string): Promise<PullResult> {
    if (container.externalId === 'calendar') return this.pullCalendar(since)
    if (container.externalId === 'contacts') return this.pullContacts(since)
    return { items: [], hasMore: false }
  }

  private async pullCalendar(since?: string): Promise<PullResult> {
    const url = since ?? this.calendarInitialUrl()
    const page = await this.graphGet(url)
    const items: SourceItem[] = []
    for (const ev of page.value ?? []) {
      if (ev['@removed']) continue // deletions: skip (no artifact churn)
      const meeting = mapGraphEvent(ev)
      items.push({
        externalId: meeting.externalId || String(ev.id ?? ''),
        kind: 'meeting',
        mime: 'application/vnd.hidock.meeting+json',
        title: meeting.title,
        text: meeting.description,
        createdAt: meeting.start || new Date().toISOString(),
        entity: meeting,
        metadata: { container: 'calendar' },
      })
    }
    return this.deltaResult(items, page)
  }

  private async pullContacts(since?: string): Promise<PullResult> {
    const url = since ?? '/me/contacts/delta?$select=displayName,givenName,surname,emailAddresses,companyName,jobTitle,department,mobilePhone'
    const page = await this.graphGet(url)
    const items: SourceItem[] = []
    for (const c of page.value ?? []) {
      if (c['@removed']) continue
      const person = mapGraphContact(c)
      if (!person.email) continue // contacts without an email can't feed the resolver
      items.push({
        externalId: person.externalId,
        kind: 'contact',
        mime: 'application/vnd.hidock.contact+json',
        title: person.name,
        createdAt: new Date().toISOString(),
        entity: person,
        metadata: { container: 'contacts' },
      })
    }
    return this.deltaResult(items, page)
  }

  /** Translate Graph delta paging (@odata.nextLink / @odata.deltaLink) → PullResult. */
  private deltaResult(items: SourceItem[], page: any): PullResult {
    const next: string | undefined = page['@odata.nextLink']
    const delta: string | undefined = page['@odata.deltaLink']
    return { items, cursor: next ?? delta, hasMore: Boolean(next) }
  }

  // ── Identity ─────────────────────────────────────────────────────────────────

  private async searchPeople(query: string): Promise<ExternalPerson[]> {
    const q = query.trim()
    if (!q) return []
    const select = 'displayName,scoredEmailAddresses,personType,jobTitle,companyName,department'
    const page = await this.graphGet(
      `/me/people?$search=${encodeURIComponent(`"${q}"`)}&$top=10&$select=${select}`
    )
    return (page.value ?? []).map(mapGraphPerson)
  }

  private async enrich(contact: Contact): Promise<Enrichment | null> {
    const query = contact.email || contact.name
    if (!query) return null
    let people: ExternalPerson[]
    try {
      people = await this.searchPeople(query)
    } catch {
      return null
    }
    if (people.length === 0) return null
    const emailMatch = contact.email
      ? people.find((p) => p.email?.toLowerCase() === contact.email!.toLowerCase())
      : undefined
    const match = emailMatch ?? people[0]
    return {
      connectorId: this.id,
      externalId: match.externalId,
      fields: {
        role: match.title,
        company: match.company,
        department: match.department,
        avatarUrl: match.avatarUrl,
      },
      // A verified email match is a connector-confirmed identity (see CONNECTORS.md).
      confidence: emailMatch ? 1.0 : 0.6,
    }
  }
}

export function createM365Connector(ctx: ConnectorContext, deps?: M365Deps): M365Connector {
  return new M365Connector(ctx, deps)
}
