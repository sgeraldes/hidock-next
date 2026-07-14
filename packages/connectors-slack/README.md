# @hidock/connectors-slack

The **C2 Slack connector** for HiDock Next — a scheduled, **LLM-free** delta sync
of Slack into the intelligence layer, implementing the connector-host `Connector`
contract (Layer 2 of `apps/electron/CONNECTORS.md`).

Transport is **native HTTP + token** (not MCP): a thin, deterministic Slack Web
API client. No LLM is anywhere in the sync/retrieval path — LLM housekeeping (if
any) is the host's optional post-processing.

## Capability surfaces

| Surface | What it does |
|---|---|
| **identity** | `searchPeople(q)` for People autocomplete; `enrich(contact)` returns Slack metadata + confidence (1.0 on verified-email match, 0.5 name-only). `listPeople()` bulk-syncs users → contacts (feeds the resolver). |
| **sources** | `listContainers()` lists channels; `pull(container, since)` returns new messages as `message` (markdown) artifacts + image attachments as `image` artifacts. Threaded context preserved via `parentExternalId`. Incremental via a per-channel `ts` cursor (`oldest`, exclusive). |
| **actions** | "Message on Slack" from a person surface → `chat.postMessage`. |
| **signals** | Author→channel `person-channel` graph edges emitted during each pull (bridged to a `subscribe` listener). |

## Required Slack scopes

Create a bot (`xoxb-…`) or user (`xoxp-…`) token with:

| Scope | Needed for | Required? |
|---|---|---|
| `channels:history` | `conversations.history` / `.replies` (message sync) | yes (sources) |
| `channels:read` | `conversations.list` (channel metadata) | yes (sources) |
| `users:read` | `users.list` / `users.info` (users→contacts, mention→name, enrichment) | yes (identity) |
| `users:read.email` | reading user emails → identity match at confidence 1.0 | recommended |
| `chat:write` | `chat.postMessage` (the "Message on Slack" action) | only for actions |

For private channels and group DMs, use the `groups:*` / `im:*` / `mpim:*`
equivalents. The token is a **secret**: the host stores it in the OS keychain /
config service and passes it in at construction — it is **never** written to the
DB (`CONNECTORS.md` §Data model). Exported as `SLACK_REQUIRED_SCOPES`.

## Usage

```ts
import { createSlackConnector } from '@hidock/connectors-slack'

const slack = createSlackConnector({
  token: process.env.SLACK_TOKEN!,      // from keychain, injected by the host
  channelAllowlist: ['C123', 'C456']    // channels the user opted in to sync
})

await slack.connect()                    // validates the token (auth.test)

// sources
const channels = await slack.listContainers()
const { items, cursor, signals } = await slack.pull(channels[0], lastCursor)
// → persist `cursor`; pass it back next pull for incremental delta

// identity
const people = await slack.searchPeople('alice')
const enrichment = await slack.enrich({ id, name, email })

// actions
const actions = slack.actionsFor({ type: 'person', id, identities: [{ connectorId: slack.id, externalId: 'U1' }] })
await slack.runAction(actions[0], { text: 'hi' })
```

`pull` accepts an optional third arg `{ pageSize, maxMessages }` to bound the
first (backfill) sync.

## Rate limiting

`SlackClient` honors HTTP `429` + `Retry-After` (and body-level
`error: "ratelimited"`), backing off and retrying up to `maxRetries` (default 5),
then throwing `SlackRateLimitError`. Backoff delay is injectable (`deps.sleep`)
so tests never wait. `Retry-After` is clamped to [1s, 300s].

## Host registration

The package exports everything the host registry needs — no host-side glue in
this package:

- `slackDescriptor: ConnectorDescriptor` — Settings → Connectors metadata
  (id `slack`, transport `native`, auth setup steps, config fields
  `token` [password/secret/required] and `channelAllowlist` [text], and all four
  capability kinds).
- `slackConnectorFactory: ConnectorFactory` — `(ctx: ConnectorContext) => Connector`;
  reads the token via `ctx.getSecret('token')` (secrets live in safeStorage,
  never the DB) and the channel allowlist via `ctx.getConfig()`.

Register `slackDescriptor.id → slackConnectorFactory` in the host registry. A
connector built with no token constructs cleanly and reports `auth-needed`
(so it renders in Settings before it is configured).

## Contract reconciliation — DONE

`src/contract.ts` now **re-exports** the canonical contract from
`@hidock/connectors` (`packages/connectors/src/types.ts`, committed `b99ad7b9`),
which adopted this connector's mirror shapes verbatim — single source of truth,
zero drift. The dependency is wired as `"@hidock/connectors": "file:../connectors"`.
No other file in this package references the host package for the base contract
types.

## Development

```bash
npm install
npm run typecheck   # tsc --noEmit (strict)
npm test            # vitest — 40 tests, all Slack HTTP mocked (no network)
npm run build       # tsup → dist (esm + cjs + dts)
```
