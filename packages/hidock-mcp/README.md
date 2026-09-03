# HiDock Next MCP

Read-only local MCP access to the HiDock Next knowledge database. The server exposes:

- `hidock_search`
- `hidock_recent_meetings`
- `hidock_get_transcript`
- `hidock_actions`
- `hidock_decisions`

## Safety model

The package opens SQLite with both `readonly` and `fileMustExist`, then enables SQLite `query_only`. It exposes no SQL tool and no mutation API.

Every capture-derived result passes the same shared positive-allowlist policy used by the Electron app. It excludes personal recordings, soft-deleted recordings and captures, value-excluded recordings/captures, and hard-purged or unknown provenance. Eligibility errors return no content. Transcript text is loaded only after the requested capture passes that boundary.

Search also reuses HiDock's deterministic intent and relative-date routing. General searches read the existing `vector_embeddings` chunk corpus first (without altering or re-indexing it), with an eligibility-gated transcript fallback for databases that have not built the index yet.

## Install and build

From the repository root:

```bash
cd packages/database
npm install
npm run build

cd ../hidock-mcp
npm install
npm run build
npm test
```

Node.js 18 or newer is required. The default database path is:

```text
~/HiDock/data/hidock.db
```

Override it with `HIDOCK_DB_PATH` or `--db`:

```bash
HIDOCK_DB_PATH=/absolute/path/to/hidock.db npm start
node dist/server.js --db /absolute/path/to/hidock.db
```

The process uses MCP over standard input/output; launch it from an MCP host rather than expecting an HTTP port.

## MCP host configuration

Build the package, then add a stdio server entry to your MCP host. Use absolute paths:

```json
{
  "mcpServers": {
    "hidock-next": {
      "command": "node",
      "args": ["/absolute/path/to/hidock-next/packages/hidock-mcp/dist/server.js"],
      "env": {
        "HIDOCK_DB_PATH": "/absolute/path/to/HiDock/data/hidock.db"
      }
    }
  }
}
```

Restart or reload the MCP host and confirm the five `hidock_*` tools appear.

## Tool inputs

Dates use `YYYY-MM-DD`. List/search tools accept a `limit` from 1 to 100. Search and list tools can filter by an exact project name. `hidock_search` also understands relative phrases already supported by HiDock retrieval, such as `today`, `yesterday`, `this week`, `last week`, `this month`, and `last month` (including the existing Spanish equivalents).

`hidock_get_transcript` takes the `captureId` returned by search or recent meetings. An unknown and an ineligible capture produce the same response to avoid exposing private-library membership.

## Development checks

```bash
npm run typecheck
npm test
npm run build
```

The test suite creates temporary databases only. It never opens a HiDock device or a user's live database.
