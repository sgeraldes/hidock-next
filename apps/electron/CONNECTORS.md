# CONNECTORS.md — External-System Connector Framework

*Design captured 2026-07-08 from Sebastián's directive. Connectors turn the app
from a self-contained recorder into a super-interconnected knowledge platform.
Companion docs: INTELLIGENCE.md (entity/graph architecture), GOAL.md (product
principles).*

## The idea

A **connector** plugs an external system into the intelligence layer through
four capability surfaces. A connector may implement any subset:

| Capability | What it does | Examples |
|---|---|---|
| **Identity enrichment** | Autocomplete + enrich canonical entities: email autocomplete in People edit from Outlook/M365; contact metadata (role, company, avatar, presence) from BambooHR/Kantata/Slack/Salesforce; resolver context (+confidence when a connector confirms an identity) | Outlook, BambooHR, Kantata, Slack, Salesforce, Android contacts |
| **Knowledge sources** | External containers become LIVING library items: a Slack channel is a capture that continuously accretes messages; a GitHub repo's md files are solution-document sources; PDFs/images are captures with extracted text/metadata; WhatsApp conversations; Android call recordings. All flow through the SAME pipeline: capture → chunks → embeddings → wiki → graph | Slack channels, GitHub repos, PDF, images (CLIP-style tagging), WhatsApp, Android, Confluence pages |
| **Actions** | Initiate outbound acts from entity surfaces: "Message on Slack" from a person hover card; "Create Jira ticket" from an action item; "Schedule in Outlook" from a follow-up | Slack, Teams, Jira, Outlook |
| **Graph signals** | Events that update entity metadata + edges without user action: GitHub commits update project metadata and contributor edges (person WORKS_ON project); Connect/call logs create person-interaction edges; Slack membership creates person-channel edges | GitHub, Amazon Connect, Slack |

## Architecture

### MCP-first
Most target systems already have MCP servers (BambooHR, Kantata, Slack run on
this machine today; Atlassian, M365, AWS exist as products). So the framework
core is an **MCP client host** in the Electron main process:

- `connector-host.ts`: manages configured connector instances; for MCP-backed
  ones, spawns/connects stdio MCP servers, lists tools, maps them to the four
  capability surfaces via a per-connector **capability manifest** (which tool
  = searchContacts, which = listChannels, which = readMessages…).
- Bespoke (non-MCP) connectors implement the same TypeScript interface
  directly: PDF, images, Android, WhatsApp, folder-watch.
- One interface, two transports.

```ts
interface Connector {
  id: string; kind: 'mcp' | 'native'
  capabilities: { identity?: IdentityProvider; sources?: SourceProvider;
                  actions?: ActionProvider; signals?: SignalProvider }
  status(): ConnectorStatus   // connected/auth-needed/error
}
interface IdentityProvider {
  searchPeople(q: string): Promise<ExternalPerson[]>          // autocomplete
  enrich(contact: Contact): Promise<Enrichment | null>        // metadata
}
interface SourceProvider {
  listContainers(): Promise<SourceContainer[]>                // channels/repos/folders
  pull(container: SourceContainer, since?: string): Promise<SourceItem[]>
}
interface ActionProvider { actionsFor(entity: EntityRef): ConnectorAction[] }
interface SignalProvider { subscribe(onSignal: (s: GraphSignal) => void): void }
```

### Data model (future migration)
- `connectors(id, kind, type, name, config JSON/*no secrets*/, status, last_sync_at)`
- `connector_sources(id, connector_id, container_ref, knowledge_capture_id,
  sync_cursor, sync_interval)` — the link that makes a Slack channel/GitHub
  repo a LIVING library item: each sync appends to the capture's content,
  re-chunks/re-embeds the delta, re-ingests to graph.
- `contact_identities(contact_id, connector_id, external_id, metadata JSON,
  confidence)` — a person's Slack id, BambooHR id, GitHub login… This is what
  lets an email from Outlook enrich the same canonical contact Kantata knows,
  and feeds the resolver (a connector-confirmed identity = confidence 1.0).
- Secrets in the OS keychain / existing config service, never in the DB.

### Sync model
Pull-based with per-source cursors and intervals (recency principle: recent
containers sync more often); debounced pipeline reuse — a synced delta flows
through the exact transcript pipeline stages (chunk → embed → graph ingest →
suggestions). Signals (GitHub webhooks/polling) go straight to the event bus
(`entity:*` events from Round 4a) so the graph updates like any other edit.

### UI
- Settings → Connectors: add/configure/authorize, per-connector status.
- Library: connector sources appear as captures with a connector badge and a
  "living" indicator (last sync, item count).
- People edit: email autocomplete dropdown fed by identity providers;
  PersonDetail shows linked identities (Slack/BambooHR/GitHub) + actions
  ("Message on Slack").
- Hover cards gain connector-fed rows (presence, title from HR system).

## Connector catalog (user-requested; build order by value/cost)

| Connector | Transport | First capabilities | Notes |
|---|---|---|---|
| **PDF** | native | sources | Cheapest full vertical; exercises pipeline with zero auth. Text extraction → capture → embeddings → graph |
| **M365/Outlook** | MCP (exists) | identity (email autocomplete), sources (mail/calendar detail) | Calendar ICS already partially in-app |
| **Slack** | MCP (exists locally) | identity, sources (channels as living captures), actions (send message) | Highest interconnection value |
| **BambooHR** | MCP (exists locally) | identity enrichment (org chart, role, tenure) | Read-only, easy |
| **Kantata** | MCP (exists locally) | identity, project metadata (budgets, assignments) | Projects graph enrichment |
| **GitHub** | MCP or API | sources (md files), signals (commits→project metadata, contributor edges) | Project truth source |
| **Jira/Confluence** | MCP (Atlassian exists) | sources (pages), actions (create issue) | |
| **Images** | native | sources | Needs vision model for tagging (Gemini multimodal already integrated — no CLIP needed) |
| **Amazon Connect / AWS** | MCP | signals, sources | |
| **Teams** | MCP (M365) | identity, actions | |
| **Android** | native (ADB/companion) | identity (contacts), sources (call recordings) | Furthest out |
| **WhatsApp** | native | sources (conversations) | Export-file based first |

## Rollout

1. **C1 — Framework + PDF connector** (after Round 4a lands; migration v28):
   connector host, interfaces, connectors/connector_sources/contact_identities
   tables, Settings UI skeleton, PDF vertical end-to-end (file → capture →
   chunks → embeddings → graph → searchable/askable).
2. **C2 — MCP client host + Slack** (channels as living captures, send-message
   action, identity metadata on hover cards).
3. **C3 — M365 identity (email autocomplete in People/attendees) + BambooHR
   enrichment.**
4. **C4 — GitHub sources + signals** (project metadata from commits).
5. Then per catalog by demand.

## Status
- [ ] C1 framework + PDF (queued behind Round 4a — shares database.ts)
- [ ] C2 MCP host + Slack
- [ ] C3 M365 + BambooHR identity
- [ ] C4 GitHub
