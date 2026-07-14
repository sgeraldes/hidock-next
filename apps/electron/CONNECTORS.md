# CONNECTORS.md — Entity Types & External-System Connectors

*Design captured 2026-07-08 from Sebastián's directive (layering corrected
same day). Companion docs: INTELLIGENCE.md (entity/graph architecture),
GOAL.md (product principles).*

## Layering (the architecture, not just connections)

```
Layer 0 — ENTITY TYPES (format extensions)          ← the foundation
  pdf, image, svg, md, txt, json, wav/mp3 (audio), video, docx/pptx…
  Each type registers: storage layout, metadata schema, text/content
  extraction, chunking strategy, preview/renderer, optional enrichment.

Layer 1 — PIPELINE (type-dispatched, deterministic)
  ingest → extract (per type) → chunk → embed → graph → suggestions.
  NO LLM in the retrieval/sync path. LLMs are optional post-processing
  stages (cleaning, summarization, image description) — never the
  mechanism that fetches or stores.

Layer 2 — CONNECTORS (feeders)
  MCP-backed or native. A connector syncs external containers on a
  schedule (cursors, deltas, cheap deterministic API pagination) and
  emits ITEMS OF REGISTERED ENTITY TYPES. Slack emits md-like message
  logs AND images; GitHub emits md files; Android emits audio + contacts.
  Connectors DEPEND on entity types — a connector cannot deliver a
  format the type registry doesn't know how to store/extract/render.

Layer 3 — INTELLIGENCE (existing)
  canonical entities, resolver, aliases, suggestions, living graph.
```

**Why this split matters:** bringing Slack is not "an MCP." It is (a) a
scheduled, LLM-free sync loop pulling message deltas and files, (b) mapping
them onto entity types the library already understands (md conversation logs,
image attachments with their own storage/metadata), and (c) only THEN optional
LLM housekeeping. The type system is shared; ten connectors reuse the same
image handling.

### Entity-type registry (Layer 0 data model)
- `artifact_types` are code-registered (not DB): `{kind, mimes[], store(),
  extractText(), chunk(), preview(), enrich?()}`.
- `artifacts(id, knowledge_capture_id, kind, mime, storage_path, size,
  content_hash, extracted_text, metadata JSON, source_connector_id?,
  source_ref?, created_at)` — every concrete file/blob. A capture can own
  many artifacts (a Slack channel capture owns thousands of message-log
  segments + image artifacts; a recording capture owns its wav + transcript).
- Storage layout: `<dataRoot>/artifacts/<kind>/<hash-prefix>/<id>.<ext>`;
  dedup by content_hash.
- Enrichment examples (optional, queued, budgeted): image → Gemini multimodal
  description/tags; pdf → structure-aware section extraction; audio →
  existing transcription pipeline (audio is just the first entity type that
  was ever implemented).

## Connectors (Layer 2)

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

0. **C0 — Entity-type foundation** (after Round 4a lands; migration v28):
   artifact type registry + `artifacts` table + storage layout + type-
   dispatched extract/chunk stages. First registered types: md, txt, pdf,
   image (audio already exists as the legacy path — refactor it INTO the
   registry, don't duplicate). Library renders artifacts per type.
1. **C1 — PDF + image verticals end-to-end** (drop a PDF/image into the
   library → artifact → extraction (pdf text; image via Gemini multimodal
   description) → chunks → embeddings → graph → searchable/askable).
2. **C2 — Connector host + Slack** (scheduled LLM-free delta sync via the
   local MCP server; channels as living md captures + image artifacts;
   send-message action; identity metadata on hover cards).
3. **C3 — M365 identity (email autocomplete in People/attendees) + BambooHR
   enrichment.**
4. **C4 — GitHub sources + signals** (md files; commits → project metadata +
   contributor edges).
5. Then per catalog by demand.

## Status
- [x] C0 entity-type foundation (artifact registry + `artifacts` table + `importArtifact`)
- [ ] C1 PDF + image verticals
- [x] C2 connector host + Slack — `@hidock/connectors` (contract + `ConnectorHost`
      registry + injected `ConnectorStateStore`); Slack in `@hidock/connectors-slack`;
      host wiring + ingestion sink + `connectors:*` IPC + Settings → Connectors UI in
      `apps/electron`. BambooHR/Kantata identity still pending.
- [x] C3 M365 identity + sources — `services/connectors/m365` (MSAL device-code,
      calendar+contacts delta sync with attendee emails, `/me/people` search+enrich).
      BambooHR enrichment still pending.
- [ ] C4 GitHub

### Implementation notes (C2/C3, landed 2026-07-09)
- Placement: **shared contract + registry** live in `packages/connectors`
  (Electron-free; persistence is an injected `ConnectorStateStore`). App-specific
  pieces (store, ingestion sink, M365 connector, IPC, UI) live in
  `apps/electron/electron/main/services/connectors` + `ipc/connectors-handlers.ts`.
- Secrets: Electron `safeStorage` (DPAPI/Keychain) via `connectors.json`, never the DB.
- `SourceItem.entity` (optional) carries structured meeting/contact for the sink;
  Slack emits message/image items → artifact-service. One emission type, two routes.
- M365 needs the user to register their own Entra app (public client; "Allow public
  client flows" = Yes; delegated Calendars.Read/Contacts.Read/People.Read/User.Read).
  There is no safe well-known public client id to piggyback — the Settings UI walks
  them through the registration.
