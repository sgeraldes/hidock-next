# File List Sync Fixes — Specification

## Context

The file list sync between HiDock USB device and the Electron app has been broken for months. The device connects and initializes successfully, but listing 1377 recordings fails every time with "Cannot read properties of null (reading 'length')" and retries in an infinite loop.

Root causes identified through code analysis:

1. `jensen.listFiles()` resolves its promise with `null` instead of an array
2. `listRecordings()` doesn't guard against null before accessing `.length`
3. Completion detection is broken for newer firmware (version > 327722)
4. O(N^2) re-parsing of all accumulated data on every USB packet
5. No timeout on the listFiles command means the promise can hang forever
6. **Filelist lock permanently stuck after timeout** — `expireCommand()` doesn't clean up `device.data['filelist']`, bricking all future listFiles calls
7. No retry backoff means infinite retry loops
8. Database CHECK constraint missing 'cancelled' status causes persist failures

## Affected Files

- `apps/electron/src/services/jensen.ts` — Protocol layer
- `apps/electron/src/services/hidock-device.ts` — Device service layer
- `apps/electron/src/hooks/useDeviceSubscriptions.ts` — Auto-sync trigger
- `apps/electron/electron/main/services/download-service.ts` — Download management
- `apps/electron/electron/main/services/database.ts` — Schema/migrations

## Implementation Order (from audit)

Fixes MUST be applied in this order due to dependencies:

1. **Fix 4** (timeout + lock cleanup) — prerequisite for everything; without it, a single timeout bricks file listing permanently
2. **Fix 2** (completion detection) — reduces the chance of timeouts occurring
3. **Fix 1** (null guard) — defense in depth for when null still gets through
4. **Fix 3** (O(N^2) elimination) — performance, reduces timeout risk further
5. **Fix 5** (DB constraint) — independent, can be done in parallel
6. **Fix 6** (retry backoff) — depends on Fixes 1-4 being in place first

---

## Fix 1: Null Guard in listRecordings (P0)

### Problem

`hidock-device.ts` line 1040-1041 accesses `files.length` without checking if `files` is null. The `jensen.listFiles()` promise can resolve with `null` when:
- Device disconnects during transfer (`disconnect()` calls `pending.resolve(null)`)
- `expireCommand()` fires (resolves with `null`)
- USB decode error occurs (`processBufferedData` error path)
- `handleDisconnect()` fires (resolves all pending with `null`)

**Audit note:** The TypeScript return type `Promise<FileInfo[]>` is a lie — `sendCommand` uses `pending.resolve(null)` in 4+ code paths. The type should be `Promise<FileInfo[] | null>`.

### Acceptance Criteria

- [ ] AC-1.1: When `jensen.listFiles()` returns `null`, `listRecordings()` must NOT throw
- [ ] AC-1.2: When `files` is null, `listRecordings()` must return an empty array `[]`
- [ ] AC-1.3: When `files` is null, an error must be logged with message indicating null response from device
- [ ] AC-1.4: The existing catch block behavior (returning cached recordings) must be preserved for actual exceptions
- [ ] AC-1.5: When `files` is a valid array (including empty `[]`), behavior must be unchanged
- [ ] AC-1.6: The return type of `jensen.listFiles()` must be updated to `Promise<FileInfo[] | null>` so TypeScript enforces null checks at all call sites

### Implementation Notes

Add a null/array check immediately after `await this.jensen.listFiles(...)` and before any property access:

```typescript
const files = await this.jensen.listFiles(...)
if (!files || !Array.isArray(files)) {
  this.logActivity('error', 'Device returned no file data', 'Received null response from listFiles')
  return []
}
```

---

## Fix 2: Completion Detection for Newer Firmware (P0)

### Problem

For firmware version > 327722, `listFiles()` skips `getFileCount()`, so `countTarget = 0`. The completeness check then depends entirely on `headerTotal` from the 0xFF 0xFF header in the response data. If the device doesn't include this header, `headerTotal = 0` and the completeness check NEVER passes.

The `expectedFileCount` parameter (1377) IS passed to `listFiles()` and already captured in the closure as `totalExpected` (line 1328), but is only used for progress reporting, not for completion detection.

### Acceptance Criteria

- [ ] AC-2.1: When `expectedFileCount > 0` is provided, the handler must use it as a completion target
- [ ] AC-2.2: The completion check must include `totalExpected` as a third OR condition: `(countTarget > 0 && files.length >= countTarget) || (headerTotal > 0 && files.length >= headerTotal) || (totalExpected > 0 && files.length >= totalExpected)`
- [ ] AC-2.3: `headerTotal` from the device response must still take priority when available (it's the most authoritative source)
- [ ] AC-2.4: When `expectedFileCount` is 0 or not provided, behavior must be unchanged (fall through to empty-body signal)
- [ ] AC-2.5: The empty-body end-of-list handler must still work as a fallback completion signal
- [ ] AC-2.6: Existing tests in `jensen.test.ts` must continue to pass

### Implementation Notes

Use the already-computed `totalExpected` variable (line 1328) — it already incorporates the fallback chain `expectedFileCount ?? fileCount?.count ?? 0`. Do NOT reference `expectedFileCount` directly in the completion check; `totalExpected` handles the fallback logic.

In the handler's completeness check (~line 1362), change:
```typescript
// BEFORE
if ((countTarget > 0 && files.length >= countTarget) || (headerTotal > 0 && files.length >= headerTotal)) {

// AFTER
if ((countTarget > 0 && files.length >= countTarget) || (headerTotal > 0 && files.length >= headerTotal) || (totalExpected > 0 && files.length >= totalExpected)) {
```

---

## Fix 3: Eliminate O(N^2) Re-parsing (P0)

### Problem

The GET_FILE_LIST handler re-parses ALL accumulated data on every packet by calling `flattenChunks()` + `parseFileListFlat()` on the entire accumulator. For 1377 files (~82KB of data), this means re-parsing 82KB potentially hundreds of times. This causes:
- Multi-minute delays for large file lists
- CPU starvation that can cause USB read loop timeouts
- Apparent "hangs" in the UI
- Repeated allocation of large `Uint8Array` buffers in `flattenChunks`

### Acceptance Criteria

- [ ] AC-3.1: The handler must only parse NEW data from the latest packet, not re-parse all accumulated data
- [ ] AC-3.2: A running file count must be maintained across handler invocations instead of re-counting from scratch
- [ ] AC-3.3: The 0xFF 0xFF header must still be detected and parsed from the first packet
- [ ] AC-3.4: File list results must be identical to the current implementation (same files, same order, same filtering)
- [ ] AC-3.5: The `onProgress` callback must report accurate file counts
- [ ] AC-3.6: The `onNewFiles` callback must still emit only newly-discovered files (with incremental parsing, these are naturally just the files parsed from the current packet)
- [ ] AC-3.7: For a device with 1377 files, the listing operation must complete in under 30 seconds (currently takes 2+ minutes). This is a CPU/parsing benchmark; USB I/O time is unchanged.
- [ ] AC-3.8: The incremental parser must handle file entries that span two packets (partial records). Unparsed tail bytes must be preserved for the next invocation.
- [ ] AC-3.9: Already-parsed chunks may be discarded to reduce memory usage (the accumulator should not grow unboundedly)

### Implementation Notes

Change the handler to maintain incremental state. The accumulator (`device.data[key]`) stores an object instead of a plain `Uint8Array[]`:

```typescript
interface FileListState {
  buffer: Uint8Array    // Single growing buffer (or tail bytes from last parse)
  bufferLen: number     // Valid bytes in buffer
  files: FileInfo[]     // Running file list
  headerTotal: number   // From 0xFF 0xFF header (0 if not seen)
  headerParsed: boolean // Whether the header has been checked
}
```

On each packet:
1. Append `msg.body` to `buffer` (or concatenate with unparsed tail)
2. Parse from position 0 of the NEW data (including any leftover tail from previous packet)
3. If a record is incomplete, save the tail bytes for next time
4. Append parsed files to `state.files`
5. Emit `onNewFiles` with only the newly-parsed files
6. Check completion against running count

---

## Fix 4: Add Timeout and Fix Filelist Lock (P0 — HIGHEST PRIORITY)

### Problem

Two interrelated issues:

1. `listFiles()` sends the GET_FILE_LIST command with `timeout = undefined`, meaning the promise can hang forever if the handler never returns a truthy value.

2. **CRITICAL (discovered by audit):** `expireCommand()` resolves with `null` but does NOT clean up `device.data['filelist']`. After a timeout, the filelist lock (`this.data['filelist'] != null` at line 1314) remains set. ALL subsequent `listFiles()` calls return `[]` immediately without even attempting USB communication. **The device is permanently bricked from file listing until disconnect.**

This is the single most impactful bug — it turns a transient timeout into a permanent failure.

### Acceptance Criteria

- [ ] AC-4.1: `listFiles()` must have a maximum timeout of 120 seconds
- [ ] AC-4.2: When the timeout fires, the promise must resolve with whatever files have been parsed so far (partial result), not null
- [ ] AC-4.3: On timeout, `device.data['filelist']` MUST be set to `null` to release the filelist lock. Without this, all future `listFiles()` calls are permanently blocked.
- [ ] AC-4.4: A timeout must be logged as a warning, not an error (the partial result may still be useful)
- [ ] AC-4.5: The timeout must not interfere with normal completion — if files complete before 120s, the timeout must be cancelled
- [ ] AC-4.6: The dynamically registered GET_FILE_LIST handler must be cleaned up on timeout (to prevent stale handler processing post-timeout packets)

### Implementation Notes

The generic `expireCommand()` cannot do command-specific cleanup. Use a `listFiles`-specific timeout wrapper:

```typescript
async listFiles(...): Promise<FileInfo[]> {
  // ... existing setup ...

  // Create the command promise
  const commandPromise = this.sendCommand<FileInfo[]>(
    new JensenMessage(CMD.GET_FILE_LIST), undefined, 'listFiles')

  // Racing timeout that extracts partial results
  const TIMEOUT_MS = 120_000
  const timeoutPromise = new Promise<FileInfo[]>((resolve) => {
    setTimeout(() => {
      // Extract partial results before cleanup
      const acc = this.data[key] as Uint8Array[] | null
      this.data[key] = null  // CRITICAL: release the filelist lock
      if (acc && acc.length > 0) {
        const { files } = this.parseFileListFlat(this.flattenChunks(acc))
        console.warn(`[Jensen] listFiles timeout — returning ${files.length} partial files`)
        resolve(files.filter(f => f.time !== null))
      } else {
        console.warn('[Jensen] listFiles timeout — no data accumulated')
        resolve([])
      }
    }, TIMEOUT_MS)
  })

  return Promise.race([commandPromise, timeoutPromise])
}
```

**Note:** `downloadFile()` has the same no-timeout issue (line 1458) but is mitigated by the main-process stall detector. Consider adding a generous timeout (e.g., 30 min) there too, but it's not in scope for this fix.

---

## Fix 5: Database CHECK Constraint for 'cancelled' Status (P1)

### Problem

The `download_queue` table was created in migration v20 with:
```sql
status TEXT CHECK(status IN ('pending', 'downloading', 'completed', 'failed'))
```

But `DownloadService.cancelAll()` and `cancel()` set `item.status = 'cancelled'`, then call `persistQueueItem()` which does INSERT OR REPLACE. The 'cancelled' status violates the CHECK constraint, causing every persist to fail with:
```
CHECK constraint failed: status IN ('pending', 'downloading', 'completed', 'failed')
```

This means:
- Cancel state is never persisted to database
- On restart, cancelled items are loaded as their previous status (pending/downloading)
- Queue state is inconsistent between memory and database

**Audit finding:** `cancelActiveDownloads()` (line 678) uses `'failed'` not `'cancelled'`, which is inconsistent with the naming but avoids the CHECK constraint bug. This is a separate design issue.

### Acceptance Criteria

- [ ] AC-5.1: Migration v24 must recreate the `download_queue` table with CHECK constraint including 'cancelled'
- [ ] AC-5.2: `SCHEMA_VERSION` must be bumped to 24
- [ ] AC-5.3: The migration must be idempotent (safe to run multiple times)
- [ ] AC-5.4: The Phase 2 structural repair block must include a `download_queue` CHECK constraint check
- [ ] AC-5.5: After migration, `persistQueueItem()` with status='cancelled' must succeed without errors
- [ ] AC-5.6: Existing queue items with other statuses must not be affected by migration
- [ ] AC-5.7: SQLite does not support ALTER CHECK — the migration must recreate the table (CREATE new -> copy data -> DROP old -> RENAME)
- [ ] AC-5.8: The Phase 1 SCHEMA constant (CREATE TABLE for `download_queue` at ~line 301) must also be updated to include 'cancelled' in the CHECK constraint. This affects fresh installs that don't run migrations.

### Implementation Notes

SQLite cannot ALTER a CHECK constraint. The migration must:
1. Create a new table `download_queue_new` with the updated CHECK
2. Copy all data from `download_queue` to `download_queue_new`
3. Drop `download_queue`
4. Rename `download_queue_new` to `download_queue`

Precedent: migration v20 (lines 1062-1097) already demonstrates this pattern for the `contacts` table.

**Also update:**
- Phase 1 SCHEMA constant (~line 301-312): Change CHECK to include 'cancelled'
- Phase 2 structural repair: Add download_queue CHECK constraint verification

**Data safety:** The INSERT-SELECT during migration will fail if any row has a status not in the new CHECK. Since the only possible statuses are the 4 in the old CHECK (cancelled items were never persisted due to the bug), this is safe.

---

## Fix 6: Retry Backoff for File List (P2)

### Problem

When `listRecordings()` fails, the auto-sync in `useDeviceSubscriptions` and the initial sync check both retry immediately. With the current bugs, this creates an infinite loop of 2-minute-then-fail cycles that blocks the USB bus and prevents any other device operations.

**Audit findings:**
- `autoSyncTriggeredRef` is NOT set on `listRecordings()` failure (useDeviceSubscriptions.ts:105-106), allowing the next `status=ready` event to trigger another attempt immediately
- The `finally` block in `listRecordings()` sets `listRecordingsLastCompleted = Date.now()` even on failure, masking failures from the debounce mechanism
- Combined with Fix 4's filelist lock bug, a single timeout causes all subsequent calls to return `[]` instantly — the backoff never triggers because the call "succeeds" (returns `[]`)

**Dependency:** Fix 4 MUST be applied first. Without filelist lock cleanup, the backoff would gate calls that always return `[]` instantly.

### Acceptance Criteria

- [ ] AC-6.1: After a `listRecordings()` failure, there must be a minimum 10-second delay before the next attempt
- [ ] AC-6.2: After 3 consecutive failures, the delay must increase to 60 seconds
- [ ] AC-6.3: After 5 consecutive failures, auto-retry must stop and log an error suggesting device reconnection
- [ ] AC-6.4: A successful `listRecordings()` must reset the failure counter and delay
- [ ] AC-6.5: Manual user-initiated refresh (forceRefresh=true) must bypass the backoff and retry immediately
- [ ] AC-6.6: The backoff state must reset on device disconnect/reconnect (both in `handleDisconnect()` and `autoSyncTriggeredRef` in the hook)
- [ ] AC-6.7: `listRecordingsLastCompleted` must only be set on SUCCESS, not in the `finally` block (failures should not reset the debounce timer)
- [ ] AC-6.8: A partial result from timeout (Fix 4) with >0 files should be treated as success for backoff purposes; an empty result or null should be treated as failure

### Implementation Notes

Add to `HiDockDeviceService`:
```typescript
private listRecordingsFailureCount: number = 0
private listRecordingsLastFailure: number = 0
```

In `listRecordings()`:
- Before the USB call: check `listRecordingsFailureCount` and `Date.now() - listRecordingsLastFailure` against the backoff schedule. Return cached data if within backoff window (unless `forceRefresh`).
- On success: reset `listRecordingsFailureCount = 0`
- On failure: increment `listRecordingsFailureCount`, set `listRecordingsLastFailure = Date.now()`

In `handleDisconnect()`:
- Reset `listRecordingsFailureCount = 0` and `listRecordingsLastFailure = 0`

Move `listRecordingsLastCompleted = Date.now()` from `finally` to the success path only.

---

## Audit Bug Catalog

Bugs discovered during the audit that are NOT covered by the 6 fixes above:

| ID | Severity | Description | File:Line |
|----|----------|-------------|-----------|
| FLS-INC-01 | HIGH | `downloadFile()` has same no-timeout issue as `listFiles()` | `jensen.ts:1458` |
| FLS-INC-02 | MEDIUM | `cancelActiveDownloads()` uses 'failed' instead of 'cancelled', inconsistent naming | `download-service.ts:683` |
| FLS-INC-03 | MEDIUM | `onNewFiles` callback is never passed by `listRecordings()` — streaming display feature is defined but unused | `hidock-device.ts:1026` |
| FLS-INC-04 | LOW | `flattenChunks()` allocates new `Uint8Array` and copies all data every time it's called | `jensen.ts:1664-1673` |

These should be tracked separately but are not blocking for the 6 fixes.

---

## Testing Strategy

### Unit Tests (jensen.test.ts)

- Test `listFiles` handler with null msg (decode error path)
- Test `listFiles` completion with `expectedFileCount` (new AC-2.2 condition)
- Test `listFiles` completion with `headerTotal` (existing path)
- Test `listFiles` completion with empty-body terminator (fallback)
- Test `listFiles` timeout returns partial results (Fix 4)
- Test `listFiles` timeout cleans up filelist lock (Fix 4, AC-4.3)
- Test incremental parsing produces same results as full re-parse (Fix 3)
- Test incremental parsing handles partial records spanning packets (AC-3.8)

### Unit Tests (hidock-device.test.ts)

- Test `listRecordings` with null response from `jensen.listFiles`
- Test `listRecordings` retry backoff (10s, 60s, stop at 5)
- Test `listRecordings` backoff reset on success
- Test `listRecordings` backoff bypass with `forceRefresh=true`
- Test `listRecordings` backoff reset on disconnect
- Test `listRecordingsLastCompleted` only set on success, not failure

### Database Migration Test

- Verify schema v24 migration succeeds on existing database
- Verify 'cancelled' status can be persisted after migration
- Verify existing data survives migration
- Verify fresh database (no migrations) has correct CHECK constraint
- Verify migration is idempotent

### Integration Test

- Verify full flow: connect -> init -> listFiles with mock USB data for 1377 files -> completion
- Verify timeout behavior with slow/stalled mock USB
- Verify filelist lock is released after timeout, subsequent call works
