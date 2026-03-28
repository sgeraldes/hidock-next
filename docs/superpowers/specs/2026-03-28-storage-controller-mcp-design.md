# StorageController — HiDock USB Storage as CLI + MCP Server

**Date:** 2026-03-28
**Status:** Approved
**Location:** `packages/storage-controller/`

## Overview

A standalone TypeScript package that exposes HiDock USB device recordings through three interfaces:

1. **CLI** — `hidock list`, `hidock download`, `hidock search`, etc.
2. **MCP Server** (stdio) — Any LLM can access recordings as tools
3. **Library** — `import { StorageController } from '@hidock/storage-controller'`

The package implements the Jensen USB protocol natively over Node.js `usb` (not WebUSB), with aggressive disk caching to avoid the 2+ minute full scan of 1300+ files.

**Read-only**: No delete, no format. Safe for LLM access.

## Architecture

```
┌─────────────────────────────────────────────┐
│           Interfaces (CLI / MCP)            │
│  cli.ts (commander)  │  mcp.ts (stdio)      │
├─────────────────────────────────────────────┤
│           StorageController (core)          │
│  Unifies USB + cache + local files          │
│  Exposes: list, get, download, info, search │
├──────────────────┬──────────────────────────┤
│   JensenUSB      │     FileCache            │
│   Protocol over  │     JSON on disk         │
│   node `usb`     │     ~/.hidock/cache/     │
├──────────────────┤                          │
│   LocalStorage   │     Smart invalidation   │
│   ~/HiDock Rec./ │     via file_count       │
└──────────────────┴──────────────────────────┘
```

### Layer Responsibilities

| Layer | Directory | Purpose |
|-------|-----------|---------|
| **USB** | `src/usb/` | Jensen protocol: connect, send command, receive response, parse packets. Only knows bytes and commands. |
| **Core** | `src/core/` | `StorageController` orchestrates USB + cache + local files. All business logic. |
| **Interfaces** | `src/cli.ts`, `src/mcp.ts` | Thin adapters translating CLI args or MCP tool calls to `StorageController` methods. |

## Core API

```typescript
interface Recording {
  filename: string        // "2025May13-160405-Rec59.hda"
  date: Date              // parsed from filename
  duration: number        // seconds (calculated from size + version)
  size: number            // bytes
  source: 'device' | 'local' | 'both'
  localPath?: string      // set when file exists locally
}

interface StorageInfo {
  totalMiB: number
  usedMiB: number
  freeMiB: number
  fileCount: number
  deviceConnected: boolean
}

class StorageController {
  // Queries
  list(filters?: { from?: Date, to?: Date }): Promise<Recording[]>
  get(filename: string): Promise<Recording | null>
  search(query: { date?: Date, around?: string }): Promise<Recording[]>
  info(): Promise<StorageInfo>

  // Actions
  download(filename: string, outputDir?: string): Promise<string>
  downloadAll(outputDir?: string, onProgress?: (n: number, total: number) => void): Promise<string[]>

  // Cache management
  refresh(): Promise<void>

  // Connection
  connect(): Promise<boolean>
  disconnect(): Promise<void>
  isConnected(): boolean
}
```

### `list()` Behavior

1. Device connected? → `getFileCount()` (~1 sec)
2. Count differs from cache? → Full USB re-scan, update cache
3. Count matches? → Serve cache
4. Device not connected? → Serve cache + merge local files
5. Merge: files existing in both locations marked `source: 'both'`

### `search()` Behavior

- `search({ date: new Date('2025-05-13') })` → all recordings from May 13
- `search({ around: '2025-05-13T16:00' })` → recording closest to that time

### Audio Format

HiDock saves files as `.hda` but the format is standard WAV. On download, files are saved with `.wav` extension. No conversion needed.

## CLI Interface

```bash
# Device info & storage
hidock info                          # storage info + device status
hidock status                        # connected? model? firmware?

# List recordings
hidock list                          # all recordings (cached)
hidock list --from 2025-05-01        # filter by date range
hidock list --from 2025-05-13 --to 2025-05-13  # single day
hidock list --refresh                # force USB re-scan

# Search
hidock search --date 2025-05-13              # all from that day
hidock search --around "2025-05-13T16:00"    # closest to that time

# Download
hidock download <filename>           # download one → cwd
hidock download <filename> -o ~/out  # download to specific dir
hidock download --all                # download everything
hidock download --all -o ~/backup    # bulk download to dir

# Cache
hidock cache clear                   # wipe local cache
hidock cache path                    # print cache directory
```

**Output:** Human-readable table by default. `--json` flag for structured output.

```bash
hidock list --json | jq '.[0]'
```

## MCP Server Tools

```typescript
tools: [
  {
    name: "list_recordings",
    description: "List all recordings from HiDock device and local cache",
    inputSchema: {
      from?: string,    // ISO date
      to?: string,      // ISO date
      refresh?: boolean // force USB re-scan
    }
  },
  {
    name: "search_recordings",
    description: "Find recordings by date or closest to a specific time",
    inputSchema: {
      date?: string,    // ISO date
      around?: string   // ISO datetime
    }
  },
  {
    name: "get_recording",
    description: "Get metadata for a specific recording by filename",
    inputSchema: { filename: string }
  },
  {
    name: "download_recording",
    description: "Download a recording from device to local disk, returns file path",
    inputSchema: {
      filename: string,
      outputDir?: string
    }
  },
  {
    name: "get_storage_info",
    description: "Get device storage: free/used/total space, file count, connection status",
    inputSchema: {}
  },
  {
    name: "get_device_status",
    description: "Get device connection status, model, firmware version, serial number",
    inputSchema: {}
  }
]
```

**MCP configuration** (`.mcp.json`):
```json
{
  "mcpServers": {
    "hidock": {
      "type": "stdio",
      "command": "npx",
      "args": ["@hidock/storage-controller", "mcp"]
    }
  }
}
```

## Cache Strategy

### Disk Layout

```
~/.hidock/
├── cache/
│   └── file-list-<deviceSerial>.json
└── recordings/
    ├── 2025May13-160405-Rec59.wav
    └── ...
```

### Cache File Structure

```json
{
  "deviceSerial": "a1b2c3d4...",
  "fileCount": 1300,
  "lastScanDate": "2025-05-13T18:30:00Z",
  "recordings": [
    {
      "filename": "2025May13-160405-Rec59.hda",
      "date": "2025-05-13T16:04:05",
      "duration": 342.5,
      "size": 4521984,
      "version": 5,
      "signature": "abcdef0123456789"
    }
  ]
}
```

### Invalidation Flow (no TTL)

```
list() called
  │
  ├─ Device connected?
  │   ├─ YES → getFileCount() (~1s)
  │   │         ├─ count == cache.fileCount → serve cache
  │   │         └─ count != cache.fileCount → full USB re-scan, update cache
  │   │
  │   └─ NO → cache exists?
  │            ├─ YES → serve cache + merge local files
  │            └─ NO  → scan local recordings dir only
  │
  └─ Merge: mark source = 'device' | 'local' | 'both'
```

### Multi-device Support

Cache is indexed by `deviceSerial`. Connecting a different HiDock creates a separate cache file.

### Local File Merge

Comparison by filename stem (strip extension): device has `.hda`, local has `.wav`. Same stem = same file → `source: 'both'` with `localPath` set.

## USB Layer — Jensen Protocol Port

Port of the existing `apps/electron/src/services/jensen.ts` implementation, adapted from WebUSB to Node.js `usb` package.

### Key Protocol Details

| Aspect | Value |
|--------|-------|
| Vendor IDs | `0x10D6` (Actions Semi), `0x3887` (HiDock) |
| Product IDs | See `constants.ts` — H1, H1E, P1, P1 Mini |
| Endpoints | OUT=`0x01`, IN=`0x82` |
| Message header | 12 bytes: sync(2) + cmd(2) + seq(4) + len(4) |
| Command queue | One command at a time, sequential |

### Commands Used (read-only subset)

| Command | Code | Purpose |
|---------|------|---------|
| `GET_DEVICE_INFO` | 1 | Firmware, serial, model |
| `GET_FILE_LIST` | 4 | Multi-packet file listing with metadata |
| `TRANSFER_FILE` | 5 | Streaming file download |
| `GET_FILE_COUNT` | 6 | Quick count for cache validation |
| `GET_CARD_INFO` | 16 | Storage: free/used/total in MiB |

### File Entry Wire Format

```
[1 byte]  version
[3 bytes] nameLen (big-endian)
[N bytes] filename (ASCII)
[4 bytes] fileLength (big-endian)
[6 bytes] padding
[16 bytes] signature (hex)
```

### Duration Calculation (version-dependent)

```
v1:    size / 8000
v5:    size / (12000 / compression_factor)
other: size / (16000 * 2 / 4)
```

## Package Configuration

### Dependencies

```json
{
  "name": "@hidock/storage-controller",
  "dependencies": {
    "usb": "^2.17.0",
    "@modelcontextprotocol/sdk": "^1.x",
    "commander": "^12.x",
    "zod": "^3.x"
  },
  "devDependencies": {
    "typescript": "^5.6.x",
    "vitest": "^2.x",
    "tsup": "^8.x"
  }
}
```

### Build

- **Bundler:** tsup
- **Entry points:** `src/cli.ts`, `src/mcp.ts`, `src/index.ts`
- **Output:** `dist/cli.js` (bin), `dist/mcp.js` (bin), `dist/index.js` (library)
- **Target:** Node.js 18+
- **Format:** ESM

### package.json

```json
{
  "name": "@hidock/storage-controller",
  "bin": {
    "hidock": "./dist/cli.js",
    "hidock-mcp": "./dist/mcp.js"
  },
  "main": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "exports": {
    ".": "./dist/index.js"
  }
}
```

### Three Usage Modes

1. **CLI**: `npx @hidock/storage-controller list`
2. **MCP**: `hidock-mcp` or `hidock mcp` subcommand
3. **Library**: `import { StorageController } from '@hidock/storage-controller'`

## File Structure

```
packages/storage-controller/
├── package.json
├── tsconfig.json
├── tsup.config.ts
├── vitest.config.ts
├── src/
│   ├── index.ts              # Library exports
│   ├── cli.ts                # CLI entry point (commander)
│   ├── mcp.ts                # MCP server entry point (stdio)
│   ├── core/
│   │   ├── storage-controller.ts   # Main orchestrator
│   │   ├── types.ts                # Recording, StorageInfo, etc.
│   │   └── filename-parser.ts      # Parse date/time from HiDock filenames
│   ├── usb/
│   │   ├── jensen-protocol.ts      # Message format, send/receive
│   │   ├── jensen-device.ts        # High-level device operations
│   │   ├── constants.ts            # VID/PID, command codes, endpoints
│   │   └── usb-transport.ts        # node `usb` wrapper (open, claim, transfer)
│   └── cache/
│       ├── file-cache.ts           # Read/write JSON cache
│       └── local-scanner.ts        # Scan local recordings directory
└── tests/
    ├── core/
    │   ├── storage-controller.test.ts
    │   └── filename-parser.test.ts
    ├── usb/
    │   ├── jensen-protocol.test.ts
    │   └── jensen-device.test.ts
    └── cache/
        ├── file-cache.test.ts
        └── local-scanner.test.ts
```

## Testing Strategy

- **Unit tests:** Mock `usb` package. Test protocol parsing, cache logic, filename parsing, duration calculation.
- **Integration tests (optional):** Require physical HiDock device. Marked with `@device` tag, skipped in CI.
- **Framework:** Vitest

## Error Handling

| Scenario | Behavior |
|----------|----------|
| No device connected | Serve from cache/local files. `info()` returns `deviceConnected: false` |
| Device disconnects mid-operation | Throw with descriptive error. Cache remains valid. |
| Cache file corrupted | Delete and re-scan on next operation |
| USB permission denied | Clear error message with platform-specific fix instructions (udev rules on Linux, etc.) |
| No cache and no device | Return empty list, suggest connecting device |
