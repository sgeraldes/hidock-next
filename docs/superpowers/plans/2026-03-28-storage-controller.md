# StorageController Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build `@hidock/storage-controller` — a standalone TypeScript package that exposes HiDock USB device recordings via CLI, MCP server (stdio), and library API.

**Architecture:** Three layers — USB protocol (`usb` npm package with WebUSB polyfill), core business logic (`StorageController` class), and thin interface adapters (CLI via commander, MCP via `@modelcontextprotocol/sdk`). Aggressive disk cache keyed by device serial + file count to avoid 2+ minute USB scans.

**Tech Stack:** TypeScript, `usb` (WebUSB polyfill for Node.js), `@modelcontextprotocol/sdk`, `commander`, `zod`, `tsup`, `vitest`

**Spec:** `docs/superpowers/specs/2026-03-28-storage-controller-mcp-design.md`

---

## File Structure

```
packages/storage-controller/
├── package.json
├── tsconfig.json
├── tsup.config.ts
├── vitest.config.ts
├── src/
│   ├── index.ts                    # Library exports
│   ├── cli.ts                      # CLI entry point (#!/usr/bin/env node)
│   ├── mcp.ts                      # MCP server entry point
│   ├── core/
│   │   ├── storage-controller.ts   # Main orchestrator
│   │   ├── types.ts                # Recording, StorageInfo, DeviceStatus
│   │   └── filename-parser.ts      # Parse date/time/duration from HiDock filenames
│   ├── usb/
│   │   ├── constants.ts            # VID/PID, CMD codes, endpoints
│   │   ├── jensen-message.ts       # Message construction (12-byte header + body)
│   │   ├── jensen-device.ts        # High-level: connect, listFiles, getCardInfo, downloadFile
│   │   └── file-list-parser.ts     # Parse multi-packet file list binary data
│   └── cache/
│       ├── file-cache.ts           # Read/write JSON cache to ~/.hidock/cache/
│       └── local-scanner.ts        # Scan local recordings directory
└── tests/
    ├── core/
    │   ├── storage-controller.test.ts
    │   └── filename-parser.test.ts
    ├── usb/
    │   ├── jensen-message.test.ts
    │   └── file-list-parser.test.ts
    └── cache/
        ├── file-cache.test.ts
        └── local-scanner.test.ts
```

---

## Task 1: Project Scaffolding

**Team:** Any
**Files:**
- Create: `packages/storage-controller/package.json`
- Create: `packages/storage-controller/tsconfig.json`
- Create: `packages/storage-controller/tsup.config.ts`
- Create: `packages/storage-controller/vitest.config.ts`
- Create: `packages/storage-controller/src/index.ts`

- [ ] **Step 1: Create package.json**

```bash
mkdir -p packages/storage-controller
```

Write `packages/storage-controller/package.json`:

```json
{
  "name": "@hidock/storage-controller",
  "version": "0.1.0",
  "description": "HiDock USB storage controller — CLI, MCP server, and library",
  "type": "module",
  "main": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "bin": {
    "hidock": "./dist/cli.js",
    "hidock-mcp": "./dist/mcp.js"
  },
  "exports": {
    ".": {
      "import": "./dist/index.js",
      "types": "./dist/index.d.ts"
    }
  },
  "scripts": {
    "build": "tsup",
    "dev": "tsup --watch",
    "test": "vitest run",
    "test:watch": "vitest",
    "typecheck": "tsc --noEmit",
    "lint": "eslint src/"
  },
  "engines": {
    "node": ">=18.0.0"
  },
  "license": "MIT"
}
```

- [ ] **Step 2: Install dependencies**

```bash
cd packages/storage-controller
npm install usb @modelcontextprotocol/sdk commander zod
npm install -D typescript vitest tsup @types/node
```

- [ ] **Step 3: Create tsconfig.json**

Write `packages/storage-controller/tsconfig.json`:

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "lib": ["ES2022"],
    "outDir": "./dist",
    "rootDir": "./src",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "declaration": true,
    "declarationMap": true,
    "sourceMap": true,
    "resolveJsonModule": true
  },
  "include": ["src/**/*.ts"],
  "exclude": ["node_modules", "dist", "tests"]
}
```

- [ ] **Step 4: Create tsup.config.ts**

Write `packages/storage-controller/tsup.config.ts`:

```typescript
import { defineConfig } from 'tsup'

export default defineConfig({
  entry: {
    index: 'src/index.ts',
    cli: 'src/cli.ts',
    mcp: 'src/mcp.ts'
  },
  format: ['esm'],
  target: 'node18',
  dts: { entry: 'src/index.ts' },
  splitting: true,
  sourcemap: true,
  clean: true,
  shims: true,
  banner: {
    js: '#!/usr/bin/env node'
  }
})
```

- [ ] **Step 5: Create vitest.config.ts**

Write `packages/storage-controller/vitest.config.ts`:

```typescript
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    globals: true,
    include: ['tests/**/*.test.ts']
  }
})
```

- [ ] **Step 6: Create placeholder index.ts**

Write `packages/storage-controller/src/index.ts`:

```typescript
export { StorageController } from './core/storage-controller.js'
export type { Recording, StorageInfo, DeviceStatus } from './core/types.js'
```

This will fail to compile until later tasks create the referenced modules — that's expected.

- [ ] **Step 7: Commit scaffolding**

```bash
git add packages/storage-controller/
git commit -m "feat(storage-controller): scaffold package with build tooling"
```

---

## Task 2: Types and Constants

**Team:** Any (no dependencies)
**Files:**
- Create: `packages/storage-controller/src/core/types.ts`
- Create: `packages/storage-controller/src/usb/constants.ts`

- [ ] **Step 1: Write types**

Write `packages/storage-controller/src/core/types.ts`:

```typescript
export interface Recording {
  /** Original filename on device, e.g. "2025May13-160405-Rec59.hda" */
  filename: string
  /** Parsed date/time from filename */
  date: Date | null
  /** Duration in seconds, calculated from file size and version */
  duration: number
  /** File size in bytes */
  size: number
  /** Where the file currently exists */
  source: 'device' | 'local' | 'both'
  /** Absolute path if file exists locally */
  localPath?: string
  /** Firmware version byte from file entry */
  version: number
  /** 16-byte hex signature from file entry */
  signature: string
}

export interface StorageInfo {
  totalMiB: number
  usedMiB: number
  freeMiB: number
  fileCount: number
  deviceConnected: boolean
}

export interface DeviceStatus {
  connected: boolean
  model: DeviceModel
  serialNumber: string | null
  firmwareVersion: string | null
}

export type DeviceModel = 'hidock-h1' | 'hidock-h1e' | 'hidock-p1' | 'hidock-p1-mini' | 'unknown'

/** Raw file entry parsed from USB binary data */
export interface FileEntry {
  name: string
  createDate: string
  createTime: string
  time: Date | null
  duration: number
  version: number
  length: number
  signature: string
}

/** Raw card info from device (values in MiB) */
export interface CardInfo {
  used: number
  capacity: number
  free: number
  status: string
}

/** Raw device info from device */
export interface RawDeviceInfo {
  versionCode: string
  versionNumber: number
  serialNumber: string
  model: DeviceModel
}

/** Cache file structure written to disk */
export interface CacheData {
  deviceSerial: string
  fileCount: number
  lastScanDate: string
  recordings: CachedRecording[]
}

/** Recording as stored in cache JSON (dates as ISO strings) */
export interface CachedRecording {
  filename: string
  date: string | null
  duration: number
  size: number
  version: number
  signature: string
}
```

- [ ] **Step 2: Write USB constants**

Write `packages/storage-controller/src/usb/constants.ts`:

```typescript
// Vendor IDs
export const USB_VENDOR_ID = 0x10d6          // Actions Semiconductor (older)
export const USB_ALTERNATE_VENDOR_ID = 0x3887 // HiDock (newer P1 Mini)
export const USB_VENDOR_IDS: number[] = [0x10d6, 0x3887]

// Product IDs
export const USB_PRODUCT_IDS = {
  H1: 0xaf0c,
  H1E_OLD: 0xaf0d,
  H1E: 0xb00d,
  P1_OLD: 0xaf0e,
  P1: 0xb00e,
  P1_MINI: 0xaf0f,
  H1_ALT1: 0x0100,
  H1E_ALT1: 0x0101,
  H1_ALT2: 0x0102,
  H1E_ALT2: 0x0103,
  P1_ALT: 0x2040,
  P1_MINI_ALT: 0x2041
} as const

// Product ID to model name mapping
import type { DeviceModel } from '../core/types.js'

export const PRODUCT_ID_MODEL_MAP: Record<number, DeviceModel> = {
  0xaf0c: 'hidock-h1',
  0x0100: 'hidock-h1',
  0x0102: 'hidock-h1',
  0xaf0d: 'hidock-h1e',
  0xb00d: 'hidock-h1e',
  0x0101: 'hidock-h1e',
  0x0103: 'hidock-h1e',
  0xaf0e: 'hidock-p1',
  0xb00e: 'hidock-p1',
  0x2040: 'hidock-p1',
  0xaf0f: 'hidock-p1-mini',
  0x2041: 'hidock-p1-mini'
}

// USB endpoints
export const EP_OUT = 0x01
export const EP_IN = 0x82

// Jensen protocol command codes (read-only subset)
export const CMD = {
  GET_DEVICE_INFO: 1,
  GET_FILE_LIST: 4,
  TRANSFER_FILE: 5,
  GET_FILE_COUNT: 6,
  GET_CARD_INFO: 16
} as const
```

- [ ] **Step 3: Commit**

```bash
git add packages/storage-controller/src/core/types.ts packages/storage-controller/src/usb/constants.ts
git commit -m "feat(storage-controller): add types and USB constants"
```

---

## Task 3: Filename Parser

**Team:** Team A (pure logic, no USB dependency)
**Files:**
- Create: `packages/storage-controller/src/core/filename-parser.ts`
- Create: `packages/storage-controller/tests/core/filename-parser.test.ts`

- [ ] **Step 1: Write the tests**

Write `packages/storage-controller/tests/core/filename-parser.test.ts`:

```typescript
import { describe, it, expect } from 'vitest'
import { parseFilenameDateTime, calculateDurationSeconds } from '../../src/core/filename-parser.js'

describe('parseFilenameDateTime', () => {
  it('parses YYYYMonDD-HHMMSS format (e.g. 2025May13-160405-Rec59.hda)', () => {
    const result = parseFilenameDateTime('2025May13-160405-Rec59.hda')
    expect(result.date).not.toBeNull()
    expect(result.date!.getFullYear()).toBe(2025)
    expect(result.date!.getMonth()).toBe(4) // May = 4
    expect(result.date!.getDate()).toBe(13)
    expect(result.date!.getHours()).toBe(16)
    expect(result.date!.getMinutes()).toBe(4)
    expect(result.date!.getSeconds()).toBe(5)
  })

  it('parses YYYYMMDDHHMMSSREC format (e.g. 20250513160405REC001.wav)', () => {
    const result = parseFilenameDateTime('20250513160405REC001.wav')
    expect(result.date).not.toBeNull()
    expect(result.date!.getFullYear()).toBe(2025)
    expect(result.date!.getMonth()).toBe(4)
    expect(result.date!.getDate()).toBe(13)
    expect(result.date!.getHours()).toBe(16)
  })

  it('parses HDA_YYYYMMDD_HHMMSS format', () => {
    const result = parseFilenameDateTime('HDA_20250513_160405.hda')
    expect(result.date).not.toBeNull()
    expect(result.date!.getFullYear()).toBe(2025)
    expect(result.date!.getMonth()).toBe(4)
    expect(result.date!.getDate()).toBe(13)
  })

  it('returns null date for unparseable filenames', () => {
    const result = parseFilenameDateTime('random_file.hda')
    expect(result.date).toBeNull()
  })

  it('handles single-digit day (e.g. 2025Jan3-090000)', () => {
    const result = parseFilenameDateTime('2025Jan3-090000-Rec01.hda')
    expect(result.date).not.toBeNull()
    expect(result.date!.getDate()).toBe(3)
    expect(result.date!.getMonth()).toBe(0) // Jan = 0
  })
})

describe('calculateDurationSeconds', () => {
  it('calculates v1 duration: size / 8000', () => {
    expect(calculateDurationSeconds(80000, 1)).toBe(10)
  })

  it('calculates v2 duration (48kHz)', () => {
    const headerSize = 44
    const fileSize = headerSize + 24000 // 24000 payload bytes
    // effectiveBps = (48000 * 2 * 1) / 4 = 24000
    expect(calculateDurationSeconds(fileSize, 2)).toBe(1)
  })

  it('calculates v3 duration (24kHz)', () => {
    const headerSize = 44
    const fileSize = headerSize + 12000
    // effectiveBps = (24000 * 2 * 1) / 4 = 12000
    expect(calculateDurationSeconds(fileSize, 3)).toBe(1)
  })

  it('calculates v5 duration', () => {
    // size / (12000 / 4) = size / 3000
    expect(calculateDurationSeconds(3000, 5)).toBe(1)
  })

  it('calculates default version duration', () => {
    // size / ((16000 * 2 * 1) / 4) = size / 8000
    expect(calculateDurationSeconds(8000, 99)).toBe(1)
  })

  it('returns 0 for v2/v3 files smaller than WAV header', () => {
    expect(calculateDurationSeconds(40, 2)).toBe(0)
    expect(calculateDurationSeconds(10, 3)).toBe(0)
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd packages/storage-controller && npx vitest run tests/core/filename-parser.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 3: Implement filename-parser.ts**

Write `packages/storage-controller/src/core/filename-parser.ts`:

```typescript
const MONTH_NAMES: Record<string, number> = {
  Jan: 0, Feb: 1, Mar: 2, Apr: 3, May: 4, Jun: 5,
  Jul: 6, Aug: 7, Sep: 8, Oct: 9, Nov: 10, Dec: 11
}

const WAV_HEADER_SIZE = 44
const CHANNELS = 2
const BYTES_PER_SAMPLE = 1
const CORRECTION_FACTOR = 4

export interface ParsedFilename {
  date: Date | null
  createDate: string
  createTime: string
}

export function parseFilenameDateTime(filename: string): ParsedFilename {
  // Format 1: 2025May13-160405-Rec59.hda (YYYYMonDD-HHMMSS)
  const monthNameMatch = filename.match(
    /(\d{4})(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)(\d{1,2})-(\d{2})(\d{2})(\d{2})/
  )
  if (monthNameMatch) {
    const [, year, monthName, day, hour, minute, second] = monthNameMatch
    const month = MONTH_NAMES[monthName]
    const createDate = `${year}-${String(month + 1).padStart(2, '0')}-${day.padStart(2, '0')}`
    const createTime = `${hour}:${minute}:${second}`
    const date = new Date(parseInt(year), month, parseInt(day), parseInt(hour), parseInt(minute), parseInt(second))
    return { date, createDate, createTime }
  }

  // Format 2: YYYYMMDDHHMMSSREC pattern (e.g., 20250513160405REC001.wav)
  const oldWavMatch = filename.match(/^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})REC/)
  if (oldWavMatch) {
    const [, year, month, day, hour, minute, second] = oldWavMatch
    const createDate = `${year}-${month}-${day}`
    const createTime = `${hour}:${minute}:${second}`
    const date = new Date(parseInt(year), parseInt(month) - 1, parseInt(day), parseInt(hour), parseInt(minute), parseInt(second))
    return { date, createDate, createTime }
  }

  // Format 3: HDA_YYYYMMDD_HHMMSS or generic numeric
  const numericMatch = filename.match(/(\d{4})[-_]?(\d{2})[-_]?(\d{2})[-_](\d{2})(\d{2})(\d{2})?/)
  if (numericMatch) {
    const [, year, month, day, hour, minute, second = '00'] = numericMatch
    const createDate = `${year}-${month}-${day}`
    const createTime = `${hour}:${minute}:${second}`
    const date = new Date(parseInt(year), parseInt(month) - 1, parseInt(day), parseInt(hour), parseInt(minute), parseInt(second))
    return { date, createDate, createTime }
  }

  return { date: null, createDate: '', createTime: '' }
}

export function calculateDurationSeconds(fileLength: number, fileVersion: number): number {
  if (fileVersion === 1) {
    return Math.round(fileLength / 8000)
  } else if (fileVersion === 2) {
    const effectiveBps = (48000 * CHANNELS * BYTES_PER_SAMPLE) / CORRECTION_FACTOR
    return fileLength > WAV_HEADER_SIZE ? Math.round((fileLength - WAV_HEADER_SIZE) / effectiveBps) : 0
  } else if (fileVersion === 3) {
    const effectiveBps = (24000 * CHANNELS * BYTES_PER_SAMPLE) / CORRECTION_FACTOR
    return fileLength > WAV_HEADER_SIZE ? Math.round((fileLength - WAV_HEADER_SIZE) / effectiveBps) : 0
  } else if (fileVersion === 5) {
    return Math.round(fileLength / (12000 / CORRECTION_FACTOR))
  } else {
    return Math.round(fileLength / ((16000 * CHANNELS * BYTES_PER_SAMPLE) / CORRECTION_FACTOR))
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd packages/storage-controller && npx vitest run tests/core/filename-parser.test.ts
```

Expected: All PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/storage-controller/src/core/filename-parser.ts packages/storage-controller/tests/core/filename-parser.test.ts
git commit -m "feat(storage-controller): filename parser with date extraction and duration calculation"
```

---

## Task 4: Jensen Message Protocol

**Team:** Team B (can run in parallel with Task 3)
**Files:**
- Create: `packages/storage-controller/src/usb/jensen-message.ts`
- Create: `packages/storage-controller/tests/usb/jensen-message.test.ts`

- [ ] **Step 1: Write the tests**

Write `packages/storage-controller/tests/usb/jensen-message.test.ts`:

```typescript
import { describe, it, expect } from 'vitest'
import { JensenMessage, parseResponseHeader } from '../../src/usb/jensen-message.js'

describe('JensenMessage', () => {
  it('creates a message with sync markers 0x12 0x34', () => {
    const msg = new JensenMessage(1)
    const bytes = msg.make()
    expect(bytes[0]).toBe(0x12)
    expect(bytes[1]).toBe(0x34)
  })

  it('encodes command ID as big-endian 16-bit', () => {
    const msg = new JensenMessage(4) // GET_FILE_LIST
    const bytes = msg.make()
    expect(bytes[2]).toBe(0x00) // high byte
    expect(bytes[3]).toBe(0x04) // low byte
  })

  it('encodes sequence ID as big-endian 32-bit', () => {
    const msg = new JensenMessage(1).sequence(256)
    const bytes = msg.make()
    expect(bytes[4]).toBe(0x00)
    expect(bytes[5]).toBe(0x00)
    expect(bytes[6]).toBe(0x01)
    expect(bytes[7]).toBe(0x00)
  })

  it('encodes body length as big-endian 32-bit', () => {
    const msg = new JensenMessage(5).body([0x41, 0x42, 0x43]) // "ABC"
    const bytes = msg.make()
    // Length bytes at position 8-11
    expect(bytes[8]).toBe(0x00)
    expect(bytes[9]).toBe(0x00)
    expect(bytes[10]).toBe(0x00)
    expect(bytes[11]).toBe(0x03)
    // Body
    expect(bytes[12]).toBe(0x41)
    expect(bytes[13]).toBe(0x42)
    expect(bytes[14]).toBe(0x43)
  })

  it('produces 12-byte header for empty body', () => {
    const msg = new JensenMessage(1)
    expect(msg.make().byteLength).toBe(12)
  })

  it('chains body and sequence fluently', () => {
    const msg = new JensenMessage(5).body([1, 2]).sequence(10)
    const bytes = msg.make()
    expect(bytes.byteLength).toBe(14) // 12 header + 2 body
  })
})

describe('parseResponseHeader', () => {
  it('parses a valid 12-byte header', () => {
    // Construct: sync=0x12,0x34, cmd=0x00,0x01, seq=0,0,0,5, len=0,0,0,3
    const data = new Uint8Array([0x12, 0x34, 0x00, 0x01, 0x00, 0x00, 0x00, 0x05, 0x00, 0x00, 0x00, 0x03])
    const header = parseResponseHeader(data)
    expect(header).not.toBeNull()
    expect(header!.command).toBe(1)
    expect(header!.sequence).toBe(5)
    expect(header!.bodyLength).toBe(3)
  })

  it('returns null for invalid sync markers', () => {
    const data = new Uint8Array([0xFF, 0xFF, 0x00, 0x01, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00])
    expect(parseResponseHeader(data)).toBeNull()
  })

  it('returns null for data shorter than 12 bytes', () => {
    const data = new Uint8Array([0x12, 0x34, 0x00, 0x01])
    expect(parseResponseHeader(data)).toBeNull()
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd packages/storage-controller && npx vitest run tests/usb/jensen-message.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 3: Implement jensen-message.ts**

Write `packages/storage-controller/src/usb/jensen-message.ts`:

```typescript
export interface ResponseHeader {
  command: number
  sequence: number
  bodyLength: number
}

export class JensenMessage {
  command: number
  private msgBody: number[] = []
  private index: number = 0

  constructor(command: number) {
    this.command = command
  }

  body(data: number[]): this {
    this.msgBody = data
    return this
  }

  sequence(seq: number): this {
    this.index = seq
    return this
  }

  make(): Uint8Array {
    const buffer = new Uint8Array(12 + this.msgBody.length)
    let pos = 0

    // Sync markers
    buffer[pos++] = 0x12
    buffer[pos++] = 0x34

    // Command (16-bit big-endian)
    buffer[pos++] = (this.command >> 8) & 0xff
    buffer[pos++] = this.command & 0xff

    // Sequence (32-bit big-endian)
    buffer[pos++] = (this.index >> 24) & 0xff
    buffer[pos++] = (this.index >> 16) & 0xff
    buffer[pos++] = (this.index >> 8) & 0xff
    buffer[pos++] = this.index & 0xff

    // Body length (32-bit big-endian)
    const len = this.msgBody.length
    buffer[pos++] = (len >> 24) & 0xff
    buffer[pos++] = (len >> 16) & 0xff
    buffer[pos++] = (len >> 8) & 0xff
    buffer[pos++] = len & 0xff

    // Body
    for (let i = 0; i < this.msgBody.length; i++) {
      buffer[pos++] = this.msgBody[i] & 0xff
    }

    return buffer
  }
}

export function parseResponseHeader(data: Uint8Array): ResponseHeader | null {
  if (data.length < 12) return null
  if (data[0] !== 0x12 || data[1] !== 0x34) return null

  const command = ((data[2] & 0xff) << 8) | (data[3] & 0xff)
  const sequence =
    ((data[4] & 0xff) << 24) |
    ((data[5] & 0xff) << 16) |
    ((data[6] & 0xff) << 8) |
    (data[7] & 0xff)
  const bodyLength =
    ((data[8] & 0xff) << 24) |
    ((data[9] & 0xff) << 16) |
    ((data[10] & 0xff) << 8) |
    (data[11] & 0xff)

  return { command, sequence, bodyLength }
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd packages/storage-controller && npx vitest run tests/usb/jensen-message.test.ts
```

Expected: All PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/storage-controller/src/usb/jensen-message.ts packages/storage-controller/tests/usb/jensen-message.test.ts
git commit -m "feat(storage-controller): Jensen message protocol — build and parse USB packets"
```

---

## Task 5: File List Binary Parser

**Team:** Team A (depends on Task 2 types, Task 3 filename-parser)
**Files:**
- Create: `packages/storage-controller/src/usb/file-list-parser.ts`
- Create: `packages/storage-controller/tests/usb/file-list-parser.test.ts`

- [ ] **Step 1: Write the tests**

Write `packages/storage-controller/tests/usb/file-list-parser.test.ts`:

```typescript
import { describe, it, expect } from 'vitest'
import { parseFileListEntry, parseFileListBuffer } from '../../src/usb/file-list-parser.js'

// Helper: build a binary file entry
function buildEntry(filename: string, fileLength: number, version: number = 5): Uint8Array {
  const nameBytes = new TextEncoder().encode(filename)
  const nameLen = nameBytes.length
  const signature = new Uint8Array(16).fill(0xab)
  const padding = new Uint8Array(6).fill(0)

  // Total: 1 (version) + 3 (nameLen) + nameLen + 4 (fileLength) + 6 (padding) + 16 (sig)
  const entry = new Uint8Array(1 + 3 + nameLen + 4 + 6 + 16)
  let pos = 0

  entry[pos++] = version

  // nameLen as 3-byte big-endian
  entry[pos++] = (nameLen >> 16) & 0xff
  entry[pos++] = (nameLen >> 8) & 0xff
  entry[pos++] = nameLen & 0xff

  entry.set(nameBytes, pos)
  pos += nameLen

  // fileLength as 4-byte big-endian
  entry[pos++] = (fileLength >> 24) & 0xff
  entry[pos++] = (fileLength >> 16) & 0xff
  entry[pos++] = (fileLength >> 8) & 0xff
  entry[pos++] = fileLength & 0xff

  entry.set(padding, pos)
  pos += 6

  entry.set(signature, pos)

  return entry
}

describe('parseFileListEntry', () => {
  it('parses a single file entry', () => {
    const buffer = buildEntry('2025May13-160405-Rec59.hda', 3000, 5)
    const result = parseFileListEntry(buffer, 0)
    expect(result).not.toBeNull()
    expect(result!.entry.name).toBe('2025May13-160405-Rec59.hda')
    expect(result!.entry.length).toBe(3000)
    expect(result!.entry.version).toBe(5)
    expect(result!.entry.duration).toBe(1) // 3000 / 3000 = 1
    expect(result!.entry.time).not.toBeNull()
  })

  it('returns null for truncated data', () => {
    const buffer = new Uint8Array([5, 0, 0]) // too short
    expect(parseFileListEntry(buffer, 0)).toBeNull()
  })
})

describe('parseFileListBuffer', () => {
  it('parses multiple entries from concatenated buffer', () => {
    const entry1 = buildEntry('2025May13-160405-Rec59.hda', 3000, 5)
    const entry2 = buildEntry('2025May14-090000-Rec60.hda', 6000, 5)
    const combined = new Uint8Array(entry1.length + entry2.length)
    combined.set(entry1, 0)
    combined.set(entry2, entry1.length)

    const entries = parseFileListBuffer(combined)
    expect(entries).toHaveLength(2)
    expect(entries[0].name).toBe('2025May13-160405-Rec59.hda')
    expect(entries[1].name).toBe('2025May14-090000-Rec60.hda')
  })

  it('returns empty array for empty buffer', () => {
    expect(parseFileListBuffer(new Uint8Array(0))).toHaveLength(0)
  })

  it('skips null characters in filename', () => {
    // The parser should filter out null bytes like the original
    const entry = buildEntry('test\x00file.hda', 1000, 5)
    const entries = parseFileListBuffer(entry)
    expect(entries).toHaveLength(1)
    expect(entries[0].name).toBe('testfile.hda')
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd packages/storage-controller && npx vitest run tests/usb/file-list-parser.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 3: Implement file-list-parser.ts**

Write `packages/storage-controller/src/usb/file-list-parser.ts`:

```typescript
import type { FileEntry } from '../core/types.js'
import { parseFilenameDateTime, calculateDurationSeconds } from '../core/filename-parser.js'

export interface ParseResult {
  entry: FileEntry
  bytesConsumed: number
}

/**
 * Parse a single file entry from the binary buffer starting at `offset`.
 * Returns the parsed entry and how many bytes were consumed, or null if
 * the buffer is truncated (incomplete entry).
 *
 * Wire format per entry:
 *   [1] version
 *   [3] nameLen (big-endian)
 *   [N] filename (ASCII, may contain null bytes to filter)
 *   [4] fileLength (big-endian)
 *   [6] padding
 *   [16] signature (hex)
 */
export function parseFileListEntry(data: Uint8Array, offset: number): ParseResult | null {
  let pos = offset

  // version (1 byte)
  if (pos + 4 > data.length) return null
  const version = data[pos++] & 0xff

  // nameLen (3 bytes big-endian)
  if (pos + 3 > data.length) return null
  const nameLen =
    ((data[pos] & 0xff) << 16) |
    ((data[pos + 1] & 0xff) << 8) |
    (data[pos + 2] & 0xff)
  pos += 3

  // filename
  if (pos + nameLen > data.length) return null
  const nameChars: string[] = []
  for (let i = 0; i < nameLen; i++) {
    const ch = data[pos++] & 0xff
    if (ch > 0) nameChars.push(String.fromCharCode(ch))
  }

  // fileLength (4 bytes big-endian)
  if (pos + 4 > data.length) return null
  const fileLength =
    ((data[pos] & 0xff) << 24) |
    ((data[pos + 1] & 0xff) << 16) |
    ((data[pos + 2] & 0xff) << 8) |
    (data[pos + 3] & 0xff)
  pos += 4

  // padding (6 bytes)
  if (pos + 6 > data.length) return null
  pos += 6

  // signature (16 bytes)
  if (pos + 16 > data.length) return null
  const sigParts: string[] = []
  for (let i = 0; i < 16; i++) {
    const hex = (data[pos++] & 0xff).toString(16)
    sigParts.push(hex.length === 1 ? '0' + hex : hex)
  }

  const filename = nameChars.join('')
  const { date, createDate, createTime } = parseFilenameDateTime(filename)
  const duration = calculateDurationSeconds(fileLength, version)

  return {
    entry: {
      name: filename,
      createDate,
      createTime,
      time: date,
      duration,
      version,
      length: fileLength,
      signature: sigParts.join('')
    },
    bytesConsumed: pos - offset
  }
}

/**
 * Parse all file entries from a concatenated binary buffer.
 * Stops when the buffer is exhausted or an incomplete entry is found.
 */
export function parseFileListBuffer(data: Uint8Array): FileEntry[] {
  const entries: FileEntry[] = []
  let pos = 0

  while (pos < data.length) {
    const result = parseFileListEntry(data, pos)
    if (!result) break
    entries.push(result.entry)
    pos += result.bytesConsumed
  }

  return entries
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd packages/storage-controller && npx vitest run tests/usb/file-list-parser.test.ts
```

Expected: All PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/storage-controller/src/usb/file-list-parser.ts packages/storage-controller/tests/usb/file-list-parser.test.ts
git commit -m "feat(storage-controller): binary file list parser for Jensen protocol"
```

---

## Task 6: File Cache

**Team:** Team A (pure logic, no USB)
**Files:**
- Create: `packages/storage-controller/src/cache/file-cache.ts`
- Create: `packages/storage-controller/tests/cache/file-cache.test.ts`

- [ ] **Step 1: Write the tests**

Write `packages/storage-controller/tests/cache/file-cache.test.ts`:

```typescript
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { FileCache } from '../../src/cache/file-cache.js'
import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

let cacheDir: string
let cache: FileCache

beforeEach(() => {
  cacheDir = mkdtempSync(join(tmpdir(), 'hidock-test-'))
  cache = new FileCache(cacheDir)
})

afterEach(() => {
  rmSync(cacheDir, { recursive: true, force: true })
})

describe('FileCache', () => {
  it('returns null for nonexistent cache', () => {
    expect(cache.load('device123')).toBeNull()
  })

  it('saves and loads cache data', () => {
    const data = {
      deviceSerial: 'device123',
      fileCount: 2,
      lastScanDate: new Date().toISOString(),
      recordings: [
        { filename: 'test.hda', date: '2025-05-13T16:00:00', duration: 60, size: 8000, version: 5, signature: 'abc' }
      ]
    }
    cache.save(data)
    const loaded = cache.load('device123')
    expect(loaded).not.toBeNull()
    expect(loaded!.fileCount).toBe(2)
    expect(loaded!.recordings).toHaveLength(1)
    expect(loaded!.recordings[0].filename).toBe('test.hda')
  })

  it('separates cache by device serial', () => {
    cache.save({ deviceSerial: 'dev-a', fileCount: 1, lastScanDate: '', recordings: [] })
    cache.save({ deviceSerial: 'dev-b', fileCount: 2, lastScanDate: '', recordings: [] })
    expect(cache.load('dev-a')!.fileCount).toBe(1)
    expect(cache.load('dev-b')!.fileCount).toBe(2)
  })

  it('clears cache for a specific device', () => {
    cache.save({ deviceSerial: 'dev-a', fileCount: 1, lastScanDate: '', recordings: [] })
    cache.clear('dev-a')
    expect(cache.load('dev-a')).toBeNull()
  })

  it('clears all caches', () => {
    cache.save({ deviceSerial: 'dev-a', fileCount: 1, lastScanDate: '', recordings: [] })
    cache.save({ deviceSerial: 'dev-b', fileCount: 2, lastScanDate: '', recordings: [] })
    cache.clearAll()
    expect(cache.load('dev-a')).toBeNull()
    expect(cache.load('dev-b')).toBeNull()
  })

  it('handles corrupted cache file gracefully', () => {
    const fs = await import('node:fs')
    const filePath = join(cacheDir, 'file-list-corrupt.json')
    fs.writeFileSync(filePath, '{{{invalid json}}}')
    // The cache sanitizes serial to filename, but this tests general robustness
    expect(cache.load('corrupt')).toBeNull()
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd packages/storage-controller && npx vitest run tests/cache/file-cache.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 3: Implement file-cache.ts**

Write `packages/storage-controller/src/cache/file-cache.ts`:

```typescript
import { readFileSync, writeFileSync, mkdirSync, rmSync, readdirSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import type { CacheData } from '../core/types.js'

export class FileCache {
  private cacheDir: string

  constructor(cacheDir: string) {
    this.cacheDir = cacheDir
  }

  private filePath(deviceSerial: string): string {
    // Sanitize serial for use as filename
    const safe = deviceSerial.replace(/[^a-zA-Z0-9_-]/g, '_')
    return join(this.cacheDir, `file-list-${safe}.json`)
  }

  load(deviceSerial: string): CacheData | null {
    const path = this.filePath(deviceSerial)
    try {
      const raw = readFileSync(path, 'utf-8')
      const data = JSON.parse(raw) as CacheData
      if (!data.deviceSerial || !Array.isArray(data.recordings)) return null
      return data
    } catch {
      return null
    }
  }

  save(data: CacheData): void {
    mkdirSync(this.cacheDir, { recursive: true })
    const path = this.filePath(data.deviceSerial)
    writeFileSync(path, JSON.stringify(data, null, 2), 'utf-8')
  }

  clear(deviceSerial: string): void {
    const path = this.filePath(deviceSerial)
    try {
      rmSync(path)
    } catch {
      // File doesn't exist — fine
    }
  }

  clearAll(): void {
    if (!existsSync(this.cacheDir)) return
    const files = readdirSync(this.cacheDir)
    for (const file of files) {
      if (file.startsWith('file-list-') && file.endsWith('.json')) {
        try {
          rmSync(join(this.cacheDir, file))
        } catch {
          // Ignore
        }
      }
    }
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd packages/storage-controller && npx vitest run tests/cache/file-cache.test.ts
```

Expected: All PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/storage-controller/src/cache/file-cache.ts packages/storage-controller/tests/cache/file-cache.test.ts
git commit -m "feat(storage-controller): disk-based file cache with per-device isolation"
```

---

## Task 7: Local Scanner

**Team:** Team A (pure filesystem, no USB)
**Files:**
- Create: `packages/storage-controller/src/cache/local-scanner.ts`
- Create: `packages/storage-controller/tests/cache/local-scanner.test.ts`

- [ ] **Step 1: Write the tests**

Write `packages/storage-controller/tests/cache/local-scanner.test.ts`:

```typescript
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { LocalScanner } from '../../src/cache/local-scanner.js'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

let scanDir: string

beforeEach(() => {
  scanDir = mkdtempSync(join(tmpdir(), 'hidock-scan-'))
})

afterEach(() => {
  rmSync(scanDir, { recursive: true, force: true })
})

describe('LocalScanner', () => {
  it('finds .wav files in directory', () => {
    writeFileSync(join(scanDir, '2025May13-160405-Rec59.wav'), Buffer.alloc(8000))
    const scanner = new LocalScanner(scanDir)
    const files = scanner.scan()
    expect(files).toHaveLength(1)
    expect(files[0].filename).toBe('2025May13-160405-Rec59.wav')
    expect(files[0].localPath).toBe(join(scanDir, '2025May13-160405-Rec59.wav'))
    expect(files[0].source).toBe('local')
    expect(files[0].size).toBe(8000)
  })

  it('also finds .hda files', () => {
    writeFileSync(join(scanDir, 'test.hda'), Buffer.alloc(1000))
    const scanner = new LocalScanner(scanDir)
    const files = scanner.scan()
    expect(files).toHaveLength(1)
  })

  it('ignores non-audio files', () => {
    writeFileSync(join(scanDir, 'notes.txt'), 'hello')
    writeFileSync(join(scanDir, 'test.wav'), Buffer.alloc(100))
    const scanner = new LocalScanner(scanDir)
    const files = scanner.scan()
    expect(files).toHaveLength(1)
  })

  it('returns empty array for nonexistent directory', () => {
    const scanner = new LocalScanner('/nonexistent/path')
    expect(scanner.scan()).toEqual([])
  })

  it('parses date from filename', () => {
    writeFileSync(join(scanDir, '2025May13-160405-Rec59.wav'), Buffer.alloc(3000))
    const scanner = new LocalScanner(scanDir)
    const files = scanner.scan()
    expect(files[0].date).not.toBeNull()
    expect(files[0].date!.getFullYear()).toBe(2025)
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd packages/storage-controller && npx vitest run tests/cache/local-scanner.test.ts
```

Expected: FAIL.

- [ ] **Step 3: Implement local-scanner.ts**

Write `packages/storage-controller/src/cache/local-scanner.ts`:

```typescript
import { readdirSync, statSync, existsSync } from 'node:fs'
import { join, extname } from 'node:path'
import type { Recording } from '../core/types.js'
import { parseFilenameDateTime } from '../core/filename-parser.js'

const AUDIO_EXTENSIONS = new Set(['.wav', '.hda'])

export class LocalScanner {
  private directory: string

  constructor(directory: string) {
    this.directory = directory
  }

  scan(): Recording[] {
    if (!existsSync(this.directory)) return []

    const recordings: Recording[] = []

    let files: string[]
    try {
      files = readdirSync(this.directory)
    } catch {
      return []
    }

    for (const file of files) {
      const ext = extname(file).toLowerCase()
      if (!AUDIO_EXTENSIONS.has(ext)) continue

      const fullPath = join(this.directory, file)
      let size: number
      try {
        size = statSync(fullPath).size
      } catch {
        continue
      }

      const { date } = parseFilenameDateTime(file)

      recordings.push({
        filename: file,
        date,
        duration: 0, // Cannot calculate without version byte — only device knows
        size,
        source: 'local',
        localPath: fullPath,
        version: 0,
        signature: ''
      })
    }

    return recordings
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd packages/storage-controller && npx vitest run tests/cache/local-scanner.test.ts
```

Expected: All PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/storage-controller/src/cache/local-scanner.ts packages/storage-controller/tests/cache/local-scanner.test.ts
git commit -m "feat(storage-controller): local recordings directory scanner"
```

---

## Task 8: Jensen Device (USB Communication)

**Team:** Team B (depends on Task 4 jensen-message, Task 5 file-list-parser)
**Files:**
- Create: `packages/storage-controller/src/usb/jensen-device.ts`
- Create: `packages/storage-controller/tests/usb/jensen-device.test.ts`

This is the largest module — it wraps the USB protocol into high-level async methods. Tests mock the `usb` package's `WebUSB` class.

- [ ] **Step 1: Write the tests**

Write `packages/storage-controller/tests/usb/jensen-device.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mock the usb package before importing jensen-device
vi.mock('usb', () => {
  const mockDevice = {
    vendorId: 0x10d6,
    productId: 0xaf0c,
    open: vi.fn().mockResolvedValue(undefined),
    close: vi.fn().mockResolvedValue(undefined),
    selectConfiguration: vi.fn().mockResolvedValue(undefined),
    claimInterface: vi.fn().mockResolvedValue(undefined),
    selectAlternateInterface: vi.fn().mockResolvedValue(undefined),
    transferOut: vi.fn().mockResolvedValue({ status: 'ok', bytesWritten: 12 }),
    transferIn: vi.fn().mockResolvedValue({ status: 'ok', data: new DataView(new ArrayBuffer(0)) })
  }

  return {
    WebUSB: vi.fn().mockImplementation(() => ({
      getDevices: vi.fn().mockResolvedValue([mockDevice]),
      requestDevice: vi.fn().mockResolvedValue(mockDevice)
    }))
  }
})

import { JensenDevice } from '../../src/usb/jensen-device.js'

describe('JensenDevice', () => {
  let device: JensenDevice

  beforeEach(() => {
    device = new JensenDevice()
  })

  it('starts disconnected', () => {
    expect(device.isConnected()).toBe(false)
  })

  it('getModel returns unknown when not connected', () => {
    expect(device.getModel()).toBe('unknown')
  })

  it('getSerialNumber returns null when not connected', () => {
    expect(device.getSerialNumber()).toBeNull()
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd packages/storage-controller && npx vitest run tests/usb/jensen-device.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 3: Implement jensen-device.ts**

Write `packages/storage-controller/src/usb/jensen-device.ts`:

```typescript
import { WebUSB } from 'usb'
import { JensenMessage, parseResponseHeader } from './jensen-message.js'
import { parseFileListBuffer } from './file-list-parser.js'
import { CMD, USB_VENDOR_IDS, EP_OUT, EP_IN, PRODUCT_ID_MODEL_MAP } from './constants.js'
import type { DeviceModel, FileEntry, CardInfo, RawDeviceInfo } from '../core/types.js'

/// <reference types="w3c-web-usb" />

const webusb = new WebUSB({ allowAllDevices: true })

export class JensenDevice {
  private device: USBDevice | null = null
  private sequenceId = 0
  private _model: DeviceModel = 'unknown'
  private _serialNumber: string | null = null
  private _firmwareVersion: string | null = null

  isConnected(): boolean {
    return this.device !== null
  }

  getModel(): DeviceModel {
    return this._model
  }

  getSerialNumber(): string | null {
    return this._serialNumber
  }

  getFirmwareVersion(): string | null {
    return this._firmwareVersion
  }

  async connect(): Promise<boolean> {
    // Try auto-connect to previously authorized device
    const devices = await webusb.getDevices()
    const found = devices.find((d) =>
      USB_VENDOR_IDS.includes(d.vendorId)
    )

    if (found) {
      return this.openDevice(found)
    }

    // Fall back to device picker (will throw in headless mode)
    try {
      const picked = await webusb.requestDevice({
        filters: USB_VENDOR_IDS.map((vendorId) => ({ vendorId }))
      })
      return this.openDevice(picked)
    } catch {
      return false
    }
  }

  async disconnect(): Promise<void> {
    if (this.device) {
      try {
        await this.device.close()
      } catch {
        // Already closed
      }
      this.device = null
      this._model = 'unknown'
      this._serialNumber = null
      this._firmwareVersion = null
      this.sequenceId = 0
    }
  }

  async getDeviceInfo(timeout = 10000): Promise<RawDeviceInfo | null> {
    const response = await this.sendAndReceive(CMD.GET_DEVICE_INFO, [], timeout)
    if (!response || response.body.length < 4) return null

    const body = response.body
    const versionCode = `${body[1]}.${body[2]}.${body[3]}`
    const versionNumber = (body[0] << 24) | (body[1] << 16) | (body[2] << 8) | body[3]

    let serialNumber = ''
    if (body.length >= 20) {
      const snBytes = body.slice(4, 20)
      serialNumber = Array.from(snBytes).map((b) => b.toString(16).padStart(2, '0')).join('')
    }

    this._serialNumber = serialNumber
    this._firmwareVersion = versionCode

    return { versionCode, versionNumber, serialNumber, model: this._model }
  }

  async getFileCount(timeout = 10000): Promise<number> {
    const response = await this.sendAndReceive(CMD.GET_FILE_COUNT, [], timeout)
    if (!response || response.body.length < 4) return 0

    return (
      ((response.body[0] & 0xff) << 24) |
      ((response.body[1] & 0xff) << 16) |
      ((response.body[2] & 0xff) << 8) |
      (response.body[3] & 0xff)
    )
  }

  async getCardInfo(timeout = 10000): Promise<CardInfo | null> {
    const response = await this.sendAndReceive(CMD.GET_CARD_INFO, [], timeout)
    if (!response || response.body.length < 12) return null

    const b = response.body
    const free = ((b[0] & 0xff) << 24) | ((b[1] & 0xff) << 16) | ((b[2] & 0xff) << 8) | (b[3] & 0xff)
    const capacity = ((b[4] & 0xff) << 24) | ((b[5] & 0xff) << 16) | ((b[6] & 0xff) << 8) | (b[7] & 0xff)
    const statusRaw = ((b[8] & 0xff) << 24) | ((b[9] & 0xff) << 16) | ((b[10] & 0xff) << 8) | (b[11] & 0xff)

    return {
      used: capacity - free,
      capacity,
      free,
      status: statusRaw.toString(16)
    }
  }

  async listFiles(timeout = 120000): Promise<FileEntry[]> {
    // Send GET_FILE_LIST and collect all response packets
    const msg = new JensenMessage(CMD.GET_FILE_LIST).sequence(this.sequenceId++)
    const packet = msg.make()

    await this.device!.transferOut(EP_OUT, packet)

    // Collect multi-packet response with carry buffer
    const allData: Uint8Array[] = []
    const deadline = Date.now() + timeout
    let carryBuffer = new Uint8Array(0)

    while (Date.now() < deadline) {
      let result: USBInTransferResult
      try {
        result = await this.device!.transferIn(EP_IN & 0x7f, 51200)
      } catch {
        break
      }

      if (!result.data || result.data.byteLength === 0) continue

      const chunk = new Uint8Array(result.data.buffer, result.data.byteOffset, result.data.byteLength)

      // Prepend carry buffer
      const working = new Uint8Array(carryBuffer.length + chunk.length)
      working.set(carryBuffer, 0)
      working.set(chunk, carryBuffer.length)
      carryBuffer = new Uint8Array(0)

      // Find all complete Jensen messages in working buffer
      let pos = 0
      while (pos + 12 <= working.length) {
        // Look for sync markers
        if (working[pos] !== 0x12 || working[pos + 1] !== 0x34) {
          pos++
          continue
        }

        const header = parseResponseHeader(working.subarray(pos))
        if (!header) { pos++; continue }

        const totalLen = 12 + header.bodyLength
        if (pos + totalLen > working.length) {
          // Incomplete message — save as carry
          carryBuffer = working.subarray(pos)
          pos = working.length
          break
        }

        // Check if this is our file list response
        if (header.command === CMD.GET_FILE_LIST) {
          if (header.bodyLength === 0) {
            // Empty body = end of transmission
            const combined = concatArrays(allData)
            return parseFileListBuffer(combined)
          }
          allData.push(working.subarray(pos + 12, pos + totalLen))
        }

        pos += totalLen
      }

      // Save leftover as carry
      if (pos < working.length && carryBuffer.length === 0) {
        carryBuffer = working.subarray(pos)
      }
    }

    // Timeout — parse what we have
    const combined = concatArrays(allData)
    return parseFileListBuffer(combined)
  }

  async downloadFile(
    filename: string,
    fileSize: number,
    onChunk?: (data: Uint8Array) => void,
    timeout = 300000
  ): Promise<Uint8Array | null> {
    const body: number[] = []
    for (let i = 0; i < filename.length; i++) {
      body.push(filename.charCodeAt(i))
    }

    const msg = new JensenMessage(CMD.TRANSFER_FILE).body(body).sequence(this.sequenceId++)
    await this.device!.transferOut(EP_OUT, msg.make())

    const chunks: Uint8Array[] = []
    let received = 0
    const deadline = Date.now() + timeout
    let carryBuffer = new Uint8Array(0)

    while (received < fileSize && Date.now() < deadline) {
      let result: USBInTransferResult
      try {
        result = await this.device!.transferIn(EP_IN & 0x7f, 51200)
      } catch {
        break
      }

      if (!result.data || result.data.byteLength === 0) continue

      const chunk = new Uint8Array(result.data.buffer, result.data.byteOffset, result.data.byteLength)

      // Prepend carry buffer
      const working = new Uint8Array(carryBuffer.length + chunk.length)
      working.set(carryBuffer, 0)
      working.set(chunk, carryBuffer.length)
      carryBuffer = new Uint8Array(0)

      // Parse Jensen messages
      let pos = 0
      while (pos + 12 <= working.length) {
        if (working[pos] !== 0x12 || working[pos + 1] !== 0x34) {
          pos++
          continue
        }

        const header = parseResponseHeader(working.subarray(pos))
        if (!header) { pos++; continue }

        const totalLen = 12 + header.bodyLength
        if (pos + totalLen > working.length) {
          carryBuffer = working.subarray(pos)
          pos = working.length
          break
        }

        if (header.command === CMD.TRANSFER_FILE && header.bodyLength > 0) {
          const payload = working.slice(pos + 12, pos + totalLen)
          chunks.push(payload)
          received += payload.length
          onChunk?.(payload)
        }

        pos += totalLen
      }

      if (pos < working.length && carryBuffer.length === 0) {
        carryBuffer = working.subarray(pos)
      }
    }

    if (received < fileSize) return null

    return concatArrays(chunks)
  }

  // --- Private methods ---

  private async openDevice(device: USBDevice): Promise<boolean> {
    try {
      await device.open()
      await device.selectConfiguration(1)
      await device.claimInterface(0)
      await device.selectAlternateInterface(0, 0)
    } catch (e) {
      console.error('[JensenDevice] Failed to open device:', e)
      return false
    }

    this.device = device
    this._model = PRODUCT_ID_MODEL_MAP[device.productId] ?? 'unknown'
    this.sequenceId = 0

    return true
  }

  private async sendAndReceive(
    command: number,
    body: number[] = [],
    timeout = 10000
  ): Promise<{ command: number; body: Uint8Array } | null> {
    if (!this.device) return null

    const msg = new JensenMessage(command).body(body).sequence(this.sequenceId++)
    await this.device.transferOut(EP_OUT, msg.make())

    const deadline = Date.now() + timeout
    let carryBuffer = new Uint8Array(0)

    while (Date.now() < deadline) {
      let result: USBInTransferResult
      try {
        result = await this.device.transferIn(EP_IN & 0x7f, 51200)
      } catch {
        return null
      }

      if (!result.data || result.data.byteLength === 0) continue

      const chunk = new Uint8Array(result.data.buffer, result.data.byteOffset, result.data.byteLength)

      const working = new Uint8Array(carryBuffer.length + chunk.length)
      working.set(carryBuffer, 0)
      working.set(chunk, carryBuffer.length)
      carryBuffer = new Uint8Array(0)

      let pos = 0
      while (pos + 12 <= working.length) {
        if (working[pos] !== 0x12 || working[pos + 1] !== 0x34) {
          pos++
          continue
        }

        const header = parseResponseHeader(working.subarray(pos))
        if (!header) { pos++; continue }

        const totalLen = 12 + header.bodyLength
        if (pos + totalLen > working.length) {
          carryBuffer = working.subarray(pos)
          pos = working.length
          break
        }

        if (header.command === command) {
          return {
            command: header.command,
            body: working.subarray(pos + 12, pos + totalLen)
          }
        }

        pos += totalLen
      }

      if (pos < working.length && carryBuffer.length === 0) {
        carryBuffer = working.subarray(pos)
      }
    }

    return null
  }
}

function concatArrays(arrays: Uint8Array[]): Uint8Array {
  const totalLen = arrays.reduce((sum, a) => sum + a.length, 0)
  const result = new Uint8Array(totalLen)
  let offset = 0
  for (const arr of arrays) {
    result.set(arr, offset)
    offset += arr.length
  }
  return result
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd packages/storage-controller && npx vitest run tests/usb/jensen-device.test.ts
```

Expected: All PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/storage-controller/src/usb/jensen-device.ts packages/storage-controller/tests/usb/jensen-device.test.ts
git commit -m "feat(storage-controller): Jensen USB device — connect, list, download, card info"
```

---

## Task 9: StorageController Core

**Team:** Any (depends on Tasks 6, 7, 8)
**Files:**
- Create: `packages/storage-controller/src/core/storage-controller.ts`
- Create: `packages/storage-controller/tests/core/storage-controller.test.ts`

- [ ] **Step 1: Write the tests**

Write `packages/storage-controller/tests/core/storage-controller.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

// Mock JensenDevice
vi.mock('../../src/usb/jensen-device.js', () => ({
  JensenDevice: vi.fn().mockImplementation(() => ({
    isConnected: vi.fn().mockReturnValue(false),
    connect: vi.fn().mockResolvedValue(false),
    disconnect: vi.fn().mockResolvedValue(undefined),
    getModel: vi.fn().mockReturnValue('unknown'),
    getSerialNumber: vi.fn().mockReturnValue(null),
    getFirmwareVersion: vi.fn().mockReturnValue(null),
    getDeviceInfo: vi.fn().mockResolvedValue(null),
    getFileCount: vi.fn().mockResolvedValue(0),
    getCardInfo: vi.fn().mockResolvedValue(null),
    listFiles: vi.fn().mockResolvedValue([]),
    downloadFile: vi.fn().mockResolvedValue(null)
  }))
}))

import { StorageController } from '../../src/core/storage-controller.js'

let baseDir: string

beforeEach(() => {
  baseDir = mkdtempSync(join(tmpdir(), 'hidock-ctrl-'))
})

afterEach(() => {
  rmSync(baseDir, { recursive: true, force: true })
})

describe('StorageController', () => {
  it('returns empty list when no device and no cache', async () => {
    const ctrl = new StorageController({
      cacheDir: join(baseDir, 'cache'),
      recordingsDir: join(baseDir, 'recordings')
    })
    const recordings = await ctrl.list()
    expect(recordings).toEqual([])
  })

  it('scans local recordings when no device connected', async () => {
    const recDir = join(baseDir, 'recordings')
    mkdirSync(recDir, { recursive: true })
    writeFileSync(join(recDir, '2025May13-160405-Rec59.wav'), Buffer.alloc(3000))

    const ctrl = new StorageController({
      cacheDir: join(baseDir, 'cache'),
      recordingsDir: recDir
    })
    const recordings = await ctrl.list()
    expect(recordings).toHaveLength(1)
    expect(recordings[0].source).toBe('local')
    expect(recordings[0].filename).toBe('2025May13-160405-Rec59.wav')
  })

  it('reports deviceConnected: false in info() when disconnected', async () => {
    const ctrl = new StorageController({
      cacheDir: join(baseDir, 'cache'),
      recordingsDir: join(baseDir, 'recordings')
    })
    const info = await ctrl.info()
    expect(info.deviceConnected).toBe(false)
  })

  it('filters by date range', async () => {
    const recDir = join(baseDir, 'recordings')
    mkdirSync(recDir, { recursive: true })
    writeFileSync(join(recDir, '2025May13-160405-Rec59.wav'), Buffer.alloc(100))
    writeFileSync(join(recDir, '2025Jun01-090000-Rec60.wav'), Buffer.alloc(100))

    const ctrl = new StorageController({
      cacheDir: join(baseDir, 'cache'),
      recordingsDir: recDir
    })
    const filtered = await ctrl.list({
      from: new Date(2025, 4, 13), // May 13
      to: new Date(2025, 4, 13)    // May 13
    })
    expect(filtered).toHaveLength(1)
    expect(filtered[0].filename).toBe('2025May13-160405-Rec59.wav')
  })

  it('search by date returns all recordings for that day', async () => {
    const recDir = join(baseDir, 'recordings')
    mkdirSync(recDir, { recursive: true })
    writeFileSync(join(recDir, '2025May13-090000-Rec01.wav'), Buffer.alloc(100))
    writeFileSync(join(recDir, '2025May13-160405-Rec02.wav'), Buffer.alloc(100))
    writeFileSync(join(recDir, '2025May14-120000-Rec03.wav'), Buffer.alloc(100))

    const ctrl = new StorageController({
      cacheDir: join(baseDir, 'cache'),
      recordingsDir: recDir
    })
    const results = await ctrl.search({ date: new Date(2025, 4, 13) })
    expect(results).toHaveLength(2)
  })

  it('search around finds closest recording', async () => {
    const recDir = join(baseDir, 'recordings')
    mkdirSync(recDir, { recursive: true })
    writeFileSync(join(recDir, '2025May13-090000-Rec01.wav'), Buffer.alloc(100))
    writeFileSync(join(recDir, '2025May13-160405-Rec02.wav'), Buffer.alloc(100))

    const ctrl = new StorageController({
      cacheDir: join(baseDir, 'cache'),
      recordingsDir: recDir
    })
    const results = await ctrl.search({ around: '2025-05-13T15:00:00' })
    expect(results).toHaveLength(1)
    // 15:00 is closer to 16:04 than to 09:00
    expect(results[0].filename).toBe('2025May13-160405-Rec02.wav')
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd packages/storage-controller && npx vitest run tests/core/storage-controller.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 3: Implement storage-controller.ts**

Write `packages/storage-controller/src/core/storage-controller.ts`:

```typescript
import { join } from 'node:path'
import { homedir } from 'node:os'
import { writeFileSync, mkdirSync } from 'node:fs'
import { JensenDevice } from '../usb/jensen-device.js'
import { FileCache } from '../cache/file-cache.js'
import { LocalScanner } from '../cache/local-scanner.js'
import type {
  Recording, StorageInfo, DeviceStatus,
  CacheData, CachedRecording, FileEntry
} from './types.js'

export interface StorageControllerOptions {
  cacheDir?: string
  recordingsDir?: string
}

const DEFAULT_HIDOCK_DIR = join(homedir(), '.hidock')

export class StorageController {
  private device: JensenDevice
  private cache: FileCache
  private localScanner: LocalScanner
  private recordingsDir: string

  constructor(options: StorageControllerOptions = {}) {
    const cacheDir = options.cacheDir ?? join(DEFAULT_HIDOCK_DIR, 'cache')
    this.recordingsDir = options.recordingsDir ?? join(DEFAULT_HIDOCK_DIR, 'recordings')

    this.device = new JensenDevice()
    this.cache = new FileCache(cacheDir)
    this.localScanner = new LocalScanner(this.recordingsDir)
  }

  async connect(): Promise<boolean> {
    const success = await this.device.connect()
    if (success) {
      await this.device.getDeviceInfo()
    }
    return success
  }

  async disconnect(): Promise<void> {
    await this.device.disconnect()
  }

  isConnected(): boolean {
    return this.device.isConnected()
  }

  async list(filters?: { from?: Date; to?: Date }): Promise<Recording[]> {
    let recordings: Recording[]

    if (this.device.isConnected()) {
      recordings = await this.listFromDevice()
    } else {
      recordings = this.listFromCacheAndLocal()
    }

    if (filters?.from || filters?.to) {
      recordings = this.filterByDateRange(recordings, filters.from, filters.to)
    }

    return recordings.sort((a, b) => {
      const aTime = a.date?.getTime() ?? 0
      const bTime = b.date?.getTime() ?? 0
      return bTime - aTime // newest first
    })
  }

  async get(filename: string): Promise<Recording | null> {
    const all = await this.list()
    return all.find((r) => r.filename === filename || this.stemMatch(r.filename, filename)) ?? null
  }

  async search(query: { date?: Date; around?: string }): Promise<Recording[]> {
    const all = await this.list()

    if (query.date) {
      const targetDay = this.dayStart(query.date)
      const nextDay = new Date(targetDay.getTime() + 86400000)
      return all.filter((r) => {
        if (!r.date) return false
        return r.date >= targetDay && r.date < nextDay
      })
    }

    if (query.around) {
      const target = new Date(query.around)
      if (isNaN(target.getTime())) return []

      const withDates = all.filter((r) => r.date !== null)
      if (withDates.length === 0) return []

      let closest = withDates[0]
      let closestDiff = Math.abs(closest.date!.getTime() - target.getTime())

      for (const r of withDates) {
        const diff = Math.abs(r.date!.getTime() - target.getTime())
        if (diff < closestDiff) {
          closest = r
          closestDiff = diff
        }
      }

      return [closest]
    }

    return all
  }

  async info(): Promise<StorageInfo> {
    if (!this.device.isConnected()) {
      return {
        totalMiB: 0,
        usedMiB: 0,
        freeMiB: 0,
        fileCount: 0,
        deviceConnected: false
      }
    }

    const cardInfo = await this.device.getCardInfo()
    const fileCount = await this.device.getFileCount()

    return {
      totalMiB: cardInfo?.capacity ?? 0,
      usedMiB: cardInfo?.used ?? 0,
      freeMiB: cardInfo?.free ?? 0,
      fileCount,
      deviceConnected: true
    }
  }

  async status(): Promise<DeviceStatus> {
    return {
      connected: this.device.isConnected(),
      model: this.device.getModel(),
      serialNumber: this.device.getSerialNumber(),
      firmwareVersion: this.device.getFirmwareVersion()
    }
  }

  async download(filename: string, outputDir?: string): Promise<string> {
    const targetDir = outputDir ?? this.recordingsDir
    mkdirSync(targetDir, { recursive: true })

    // Find file metadata (need size for download)
    const all = await this.list()
    const recording = all.find((r) => r.filename === filename || this.stemMatch(r.filename, filename))

    if (!recording) throw new Error(`Recording not found: ${filename}`)

    // If already local, return existing path
    if (recording.localPath) return recording.localPath

    if (!this.device.isConnected()) {
      throw new Error('Device not connected and file not available locally')
    }

    const data = await this.device.downloadFile(recording.filename, recording.size)
    if (!data) throw new Error(`Download failed: ${filename}`)

    // Save as .wav (HDA files are standard WAV)
    const stem = recording.filename.replace(/\.[^.]+$/, '')
    const outputPath = join(targetDir, `${stem}.wav`)
    writeFileSync(outputPath, data)

    return outputPath
  }

  async downloadAll(
    outputDir?: string,
    onProgress?: (n: number, total: number) => void
  ): Promise<string[]> {
    const recordings = await this.list()
    const paths: string[] = []

    for (let i = 0; i < recordings.length; i++) {
      onProgress?.(i, recordings.length)
      const path = await this.download(recordings[i].filename, outputDir)
      paths.push(path)
    }

    onProgress?.(recordings.length, recordings.length)
    return paths
  }

  async refresh(): Promise<void> {
    if (!this.device.isConnected()) {
      throw new Error('Cannot refresh: device not connected')
    }

    const serial = this.device.getSerialNumber()
    if (serial) this.cache.clear(serial)

    await this.listFromDevice()
  }

  // --- Private methods ---

  private async listFromDevice(): Promise<Recording[]> {
    const serial = this.device.getSerialNumber() ?? 'unknown'
    const cached = this.cache.load(serial)
    const currentCount = await this.device.getFileCount()

    // Smart invalidation: count matches cache → serve cache
    if (cached && cached.fileCount === currentCount && currentCount > 0) {
      const deviceRecordings = cached.recordings.map((r) => this.cachedToRecording(r, 'device'))
      return this.mergeWithLocal(deviceRecordings)
    }

    // Full USB scan
    const entries = await this.device.listFiles()
    const recordings = entries.map((e) => this.entryToRecording(e))

    // Update cache
    const cacheData: CacheData = {
      deviceSerial: serial,
      fileCount: currentCount,
      lastScanDate: new Date().toISOString(),
      recordings: recordings.map((r) => this.recordingToCached(r))
    }
    this.cache.save(cacheData)

    return this.mergeWithLocal(recordings)
  }

  private listFromCacheAndLocal(): Recording[] {
    // Try to load any cache (we don't know which device)
    const localFiles = this.localScanner.scan()

    // Without a known serial, we can't load cache — just return local files
    // In practice, after first connect the serial is known
    return localFiles
  }

  private mergeWithLocal(deviceRecordings: Recording[]): Recording[] {
    const localFiles = this.localScanner.scan()
    const localByFileStem = new Map<string, Recording>()

    for (const local of localFiles) {
      const stem = this.fileStem(local.filename)
      localByFileStem.set(stem, local)
    }

    const merged: Recording[] = []
    const matchedStems = new Set<string>()

    for (const rec of deviceRecordings) {
      const stem = this.fileStem(rec.filename)
      const local = localByFileStem.get(stem)
      if (local) {
        merged.push({ ...rec, source: 'both', localPath: local.localPath })
        matchedStems.add(stem)
      } else {
        merged.push({ ...rec, source: 'device' })
      }
    }

    // Add local-only files
    for (const local of localFiles) {
      const stem = this.fileStem(local.filename)
      if (!matchedStems.has(stem)) {
        merged.push(local)
      }
    }

    return merged
  }

  private filterByDateRange(recordings: Recording[], from?: Date, to?: Date): Recording[] {
    return recordings.filter((r) => {
      if (!r.date) return false
      if (from && r.date < this.dayStart(from)) return false
      if (to && r.date >= new Date(this.dayStart(to).getTime() + 86400000)) return false
      return true
    })
  }

  private fileStem(filename: string): string {
    return filename.replace(/\.[^.]+$/, '')
  }

  private stemMatch(a: string, b: string): boolean {
    return this.fileStem(a) === this.fileStem(b)
  }

  private dayStart(date: Date): Date {
    return new Date(date.getFullYear(), date.getMonth(), date.getDate())
  }

  private entryToRecording(entry: FileEntry): Recording {
    return {
      filename: entry.name,
      date: entry.time,
      duration: entry.duration,
      size: entry.length,
      source: 'device',
      version: entry.version,
      signature: entry.signature
    }
  }

  private cachedToRecording(cached: CachedRecording, source: 'device' | 'local' | 'both'): Recording {
    return {
      filename: cached.filename,
      date: cached.date ? new Date(cached.date) : null,
      duration: cached.duration,
      size: cached.size,
      source,
      version: cached.version,
      signature: cached.signature
    }
  }

  private recordingToCached(recording: Recording): CachedRecording {
    return {
      filename: recording.filename,
      date: recording.date?.toISOString() ?? null,
      duration: recording.duration,
      size: recording.size,
      version: recording.version,
      signature: recording.signature
    }
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd packages/storage-controller && npx vitest run tests/core/storage-controller.test.ts
```

Expected: All PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/storage-controller/src/core/storage-controller.ts packages/storage-controller/tests/core/storage-controller.test.ts
git commit -m "feat(storage-controller): core StorageController with cache, merge, search"
```

---

## Task 10: CLI Interface

**Team:** Any (depends on Task 9)
**Files:**
- Create: `packages/storage-controller/src/cli.ts`

- [ ] **Step 1: Implement cli.ts**

Write `packages/storage-controller/src/cli.ts`:

```typescript
#!/usr/bin/env node

import { Command } from 'commander'
import { StorageController } from './core/storage-controller.js'
import type { Recording } from './core/types.js'

const program = new Command()

program
  .name('hidock')
  .description('HiDock USB storage controller — access recordings from CLI')
  .version('0.1.0')

// Shared option
function addJsonOption(cmd: Command): Command {
  return cmd.option('--json', 'Output as JSON')
}

program
  .command('list')
  .description('List all recordings')
  .option('--from <date>', 'Filter from date (ISO format)')
  .option('--to <date>', 'Filter to date (ISO format)')
  .option('--refresh', 'Force USB re-scan (ignore cache)')
  .option('--json', 'Output as JSON')
  .action(async (opts) => {
    const ctrl = new StorageController()
    if (opts.refresh) {
      const connected = await ctrl.connect()
      if (!connected) {
        console.error('No HiDock device found. Showing cached/local recordings.')
      } else {
        await ctrl.refresh()
      }
    }

    const filters: { from?: Date; to?: Date } = {}
    if (opts.from) filters.from = new Date(opts.from)
    if (opts.to) filters.to = new Date(opts.to)

    const recordings = await ctrl.list(filters)

    if (opts.json) {
      console.log(JSON.stringify(recordings, null, 2))
    } else {
      printRecordingsTable(recordings)
    }

    await ctrl.disconnect()
  })

program
  .command('search')
  .description('Search recordings by date')
  .option('--date <date>', 'All recordings from this date (ISO)')
  .option('--around <datetime>', 'Recording closest to this datetime (ISO)')
  .option('--json', 'Output as JSON')
  .action(async (opts) => {
    const ctrl = new StorageController()

    const query: { date?: Date; around?: string } = {}
    if (opts.date) query.date = new Date(opts.date)
    if (opts.around) query.around = opts.around

    const results = await ctrl.search(query)

    if (opts.json) {
      console.log(JSON.stringify(results, null, 2))
    } else {
      printRecordingsTable(results)
    }

    await ctrl.disconnect()
  })

program
  .command('download [filename]')
  .description('Download recording(s) from device')
  .option('-o, --output <dir>', 'Output directory')
  .option('--all', 'Download all recordings')
  .option('--json', 'Output as JSON')
  .action(async (filename, opts) => {
    const ctrl = new StorageController()
    const connected = await ctrl.connect()

    if (!connected && !filename) {
      console.error('No HiDock device found.')
      process.exit(1)
    }

    if (opts.all) {
      console.log('Downloading all recordings...')
      const paths = await ctrl.downloadAll(opts.output, (n, total) => {
        process.stdout.write(`\r  ${n}/${total} files`)
      })
      console.log('')
      if (opts.json) {
        console.log(JSON.stringify(paths, null, 2))
      } else {
        console.log(`Downloaded ${paths.length} files.`)
      }
    } else if (filename) {
      const path = await ctrl.download(filename, opts.output)
      if (opts.json) {
        console.log(JSON.stringify({ path }, null, 2))
      } else {
        console.log(`Downloaded: ${path}`)
      }
    } else {
      console.error('Provide a filename or use --all')
      process.exit(1)
    }

    await ctrl.disconnect()
  })

program
  .command('info')
  .description('Show device storage info')
  .option('--json', 'Output as JSON')
  .action(async (opts) => {
    const ctrl = new StorageController()
    await ctrl.connect()

    const info = await ctrl.info()

    if (opts.json) {
      console.log(JSON.stringify(info, null, 2))
    } else {
      if (!info.deviceConnected) {
        console.log('Device: not connected')
      } else {
        console.log(`Storage: ${info.usedMiB} MiB used / ${info.totalMiB} MiB total (${info.freeMiB} MiB free)`)
        console.log(`Files:   ${info.fileCount}`)
      }
    }

    await ctrl.disconnect()
  })

program
  .command('status')
  .description('Show device connection status')
  .option('--json', 'Output as JSON')
  .action(async (opts) => {
    const ctrl = new StorageController()
    await ctrl.connect()

    const st = await ctrl.status()

    if (opts.json) {
      console.log(JSON.stringify(st, null, 2))
    } else {
      console.log(`Connected:  ${st.connected}`)
      console.log(`Model:      ${st.model}`)
      console.log(`Serial:     ${st.serialNumber ?? 'N/A'}`)
      console.log(`Firmware:   ${st.firmwareVersion ?? 'N/A'}`)
    }

    await ctrl.disconnect()
  })

const cacheCmd = program
  .command('cache')
  .description('Cache management')

cacheCmd
  .command('clear')
  .description('Clear the file list cache')
  .action(() => {
    const ctrl = new StorageController()
    // Access cache dir via internal — for CLI we just delete the dir contents
    const { join } = require('node:path')
    const { homedir } = require('node:os')
    const { FileCache } = require('./cache/file-cache.js')
    const cache = new FileCache(join(homedir(), '.hidock', 'cache'))
    cache.clearAll()
    console.log('Cache cleared.')
  })

cacheCmd
  .command('path')
  .description('Print cache directory path')
  .action(() => {
    const { join } = require('node:path')
    const { homedir } = require('node:os')
    console.log(join(homedir(), '.hidock', 'cache'))
  })

// MCP subcommand — delegates to mcp.ts
program
  .command('mcp')
  .description('Start MCP server (stdio transport)')
  .action(async () => {
    // Dynamic import to avoid loading MCP deps unless needed
    const { startMcpServer } = await import('./mcp.js')
    await startMcpServer()
  })

program.parse()

// --- Helpers ---

function printRecordingsTable(recordings: Recording[]): void {
  if (recordings.length === 0) {
    console.log('No recordings found.')
    return
  }

  console.log(`${'Filename'.padEnd(40)} ${'Date'.padEnd(20)} ${'Duration'.padEnd(10)} ${'Size'.padEnd(12)} Source`)
  console.log('-'.repeat(95))

  for (const r of recordings) {
    const date = r.date ? r.date.toISOString().replace('T', ' ').substring(0, 19) : 'unknown'
    const duration = formatDuration(r.duration)
    const size = formatSize(r.size)
    console.log(`${r.filename.padEnd(40)} ${date.padEnd(20)} ${duration.padEnd(10)} ${size.padEnd(12)} ${r.source}`)
  }

  console.log(`\n${recordings.length} recording(s)`)
}

function formatDuration(seconds: number): string {
  const m = Math.floor(seconds / 60)
  const s = Math.round(seconds % 60)
  return `${m}:${s.toString().padStart(2, '0')}`
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}
```

- [ ] **Step 2: Build and verify CLI boots**

```bash
cd packages/storage-controller && npm run build && node dist/cli.js --help
```

Expected: Shows help output with all commands.

- [ ] **Step 3: Commit**

```bash
git add packages/storage-controller/src/cli.ts
git commit -m "feat(storage-controller): CLI interface with list, search, download, info, status"
```

---

## Task 11: MCP Server

**Team:** Any (depends on Task 9)
**Files:**
- Create: `packages/storage-controller/src/mcp.ts`

- [ ] **Step 1: Implement mcp.ts**

Write `packages/storage-controller/src/mcp.ts`:

```typescript
#!/usr/bin/env node

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { z } from 'zod'
import { StorageController } from './core/storage-controller.js'

const controller = new StorageController()

function text(value: unknown): { content: Array<{ type: 'text'; text: string }> } {
  return { content: [{ type: 'text' as const, text: JSON.stringify(value, null, 2) }] }
}

export async function startMcpServer(): Promise<void> {
  const server = new McpServer({
    name: 'hidock-storage',
    version: '0.1.0'
  })

  server.registerTool(
    'list_recordings',
    {
      title: 'List Recordings',
      description: 'List all recordings from HiDock device and local cache. Returns filename, date, duration, size, and source (device/local/both).',
      inputSchema: z.object({
        from: z.string().optional().describe('Filter from date (ISO format, e.g. 2025-05-01)'),
        to: z.string().optional().describe('Filter to date (ISO format, e.g. 2025-05-13)'),
        refresh: z.boolean().optional().describe('Force USB re-scan, ignoring cache')
      })
    },
    async (args) => {
      if (args.refresh) {
        try {
          await controller.connect()
          await controller.refresh()
        } catch {
          // Continue with cached data
        }
      }

      const filters: { from?: Date; to?: Date } = {}
      if (args.from) filters.from = new Date(args.from)
      if (args.to) filters.to = new Date(args.to)

      const recordings = await controller.list(filters)
      return text(recordings)
    }
  )

  server.registerTool(
    'search_recordings',
    {
      title: 'Search Recordings',
      description: 'Find recordings by date or find the recording closest to a specific time.',
      inputSchema: z.object({
        date: z.string().optional().describe('ISO date — returns all recordings from that day'),
        around: z.string().optional().describe('ISO datetime — returns the single recording closest to that time')
      })
    },
    async (args) => {
      const query: { date?: Date; around?: string } = {}
      if (args.date) query.date = new Date(args.date)
      if (args.around) query.around = args.around

      const results = await controller.search(query)
      return text(results)
    }
  )

  server.registerTool(
    'get_recording',
    {
      title: 'Get Recording',
      description: 'Get metadata for a specific recording by filename.',
      inputSchema: z.object({
        filename: z.string().describe('The recording filename (e.g. 2025May13-160405-Rec59.hda)')
      })
    },
    async (args) => {
      const recording = await controller.get(args.filename)
      if (!recording) return text({ error: `Recording not found: ${args.filename}` })
      return text(recording)
    }
  )

  server.registerTool(
    'download_recording',
    {
      title: 'Download Recording',
      description: 'Download a recording from the HiDock device to local disk. Returns the file path. Files are saved as .wav (HDA files are standard WAV format).',
      inputSchema: z.object({
        filename: z.string().describe('The recording filename to download'),
        outputDir: z.string().optional().describe('Output directory (defaults to ~/.hidock/recordings/)')
      })
    },
    async (args) => {
      try {
        if (!controller.isConnected()) {
          await controller.connect()
        }
        const path = await controller.download(args.filename, args.outputDir)
        return text({ success: true, path })
      } catch (e) {
        const message = e instanceof Error ? e.message : 'Download failed'
        return text({ success: false, error: message })
      }
    }
  )

  server.registerTool(
    'get_storage_info',
    {
      title: 'Get Storage Info',
      description: 'Get device storage information: free/used/total space in MiB, file count, and connection status.',
      inputSchema: z.object({})
    },
    async () => {
      if (!controller.isConnected()) {
        try { await controller.connect() } catch { /* continue */ }
      }
      const info = await controller.info()
      return text(info)
    }
  )

  server.registerTool(
    'get_device_status',
    {
      title: 'Get Device Status',
      description: 'Get device connection status, model name, firmware version, and serial number.',
      inputSchema: z.object({})
    },
    async () => {
      if (!controller.isConnected()) {
        try { await controller.connect() } catch { /* continue */ }
      }
      const status = await controller.status()
      return text(status)
    }
  )

  const transport = new StdioServerTransport()
  await server.connect(transport)
}

// If run directly (not imported by CLI)
const isDirectRun = process.argv[1]?.endsWith('mcp.js') || process.argv[1]?.endsWith('mcp')
if (isDirectRun) {
  startMcpServer().catch((err) => {
    console.error('MCP server failed to start:', err)
    process.exit(1)
  })
}
```

- [ ] **Step 2: Build and verify MCP server loads**

```bash
cd packages/storage-controller && npm run build && echo '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"test","version":"1.0"}}}' | node dist/mcp.js
```

Expected: JSON response with server capabilities.

- [ ] **Step 3: Commit**

```bash
git add packages/storage-controller/src/mcp.ts
git commit -m "feat(storage-controller): MCP server with 6 tools over stdio transport"
```

---

## Task 12: Wire Up Exports and Final Build

**Team:** Any (depends on all previous tasks)
**Files:**
- Modify: `packages/storage-controller/src/index.ts`
- Modify: `packages/storage-controller/tsup.config.ts` (fix banner to only apply to bin entries)

- [ ] **Step 1: Update index.ts with all exports**

Write `packages/storage-controller/src/index.ts`:

```typescript
// Core
export { StorageController } from './core/storage-controller.js'
export type { StorageControllerOptions } from './core/storage-controller.js'
export type {
  Recording,
  StorageInfo,
  DeviceStatus,
  DeviceModel,
  FileEntry,
  CardInfo,
  CacheData,
  CachedRecording,
  RawDeviceInfo
} from './core/types.js'

// Utilities (for advanced consumers)
export { parseFilenameDateTime, calculateDurationSeconds } from './core/filename-parser.js'
export { FileCache } from './cache/file-cache.js'
export { LocalScanner } from './cache/local-scanner.js'
```

- [ ] **Step 2: Fix tsup.config.ts — shebang only on bin entries**

Write `packages/storage-controller/tsup.config.ts`:

```typescript
import { defineConfig } from 'tsup'

export default defineConfig([
  // Library entry (no shebang)
  {
    entry: { index: 'src/index.ts' },
    format: ['esm'],
    target: 'node18',
    dts: true,
    splitting: false,
    sourcemap: true,
    clean: true
  },
  // CLI and MCP bin entries (with shebang)
  {
    entry: {
      cli: 'src/cli.ts',
      mcp: 'src/mcp.ts'
    },
    format: ['esm'],
    target: 'node18',
    dts: false,
    splitting: false,
    sourcemap: true,
    banner: {
      js: '#!/usr/bin/env node'
    }
  }
])
```

- [ ] **Step 3: Full build and typecheck**

```bash
cd packages/storage-controller && npm run build && npx tsc --noEmit
```

Expected: No errors.

- [ ] **Step 4: Run all tests**

```bash
cd packages/storage-controller && npx vitest run
```

Expected: All tests pass.

- [ ] **Step 5: Verify CLI and MCP both work**

```bash
# CLI
node dist/cli.js --help
node dist/cli.js list --json
node dist/cli.js info --json

# MCP server starts without error (ctrl+C to stop)
node dist/mcp.js &
sleep 1 && kill %1
```

- [ ] **Step 6: Commit**

```bash
git add packages/storage-controller/
git commit -m "feat(storage-controller): wire up exports, fix build config, all tests passing"
```

---

## Task Dependency Graph

```
Task 1 (scaffolding)
  └─> Task 2 (types + constants)
        ├─> Task 3 (filename-parser)     [Team A]
        │     └─> Task 5 (file-list-parser) [Team A]
        │           └─> Task 8 (jensen-device) [Team B]
        ├─> Task 4 (jensen-message)      [Team B]
        │     └─> Task 8 (jensen-device) [Team B]
        ├─> Task 6 (file-cache)          [Team A]
        └─> Task 7 (local-scanner)       [Team A]
              └─> Task 9 (StorageController) [depends on 6,7,8]
                    ├─> Task 10 (CLI)
                    ├─> Task 11 (MCP server)
                    └─> Task 12 (final wiring)
```

**Parallelizable groups:**
- **After Task 2:** Tasks 3+6+7 (Team A) can run in parallel with Task 4 (Team B)
- **After Task 3:** Task 5 (Team A)
- **After Tasks 4+5:** Task 8 (Team B)
- **After Task 9:** Tasks 10+11 can run in parallel
