# P2-018: Migration Lock Not Multi-Process Safe

**Priority**: P2
**Status**: pending
**Category**: security
**Component**: migration-handlers.ts
**Created**: 2025-12-26
**Severity**: MEDIUM - Race condition in multi-window scenarios

## Problem

The migration lock uses a simple in-memory boolean flag, which is not safe if multiple Electron renderer processes or windows attempt migration simultaneously.

## Evidence

**Lock Implementation (lines 49-61)**:
```typescript
let migrationInProgress = false
const migrationLock = {
  acquire(): boolean {
    if (migrationInProgress) {
      return false
    }
    migrationInProgress = true
    return true
  },
  release(): void {
    migrationInProgress = false
  }
}
```

## Race Condition Scenario

1. **Process A**: Checks `migrationInProgress` → false
2. **Process B**: Checks `migrationInProgress` → false (context switch before A sets flag)
3. **Process A**: Sets `migrationInProgress = true`
4. **Process B**: Sets `migrationInProgress = true`
5. **Both processes**: Run migration simultaneously → data corruption

## Electron-Specific Risk

In Electron:
- Multiple `BrowserWindow` instances share the same main process
- IPC handlers run on main process (single-threaded), **BUT**
- If migration is ever moved to preload or renderer, this breaks
- If app is refactored to use multiple processes, this breaks

## Current Safety

Currently SAFE because:
- IPC handlers run on Node.js main thread (single-threaded)
- Only one migration can run at a time due to event loop

Future RISK:
- Worker threads
- Multiple Electron app instances
- Refactoring to distributed architecture

## Location

- File: `apps/electron/electron/main/ipc/migration-handlers.ts`
- Lines: 49-61 (lock definition), 438 (lock acquisition), 675 (lock release)

## Solutions

### Option 1: Database Advisory Lock (RECOMMENDED)

```typescript
const migrationLock = {
  acquire(): boolean {
    const db = getDatabase()
    try {
      // SQLite doesn't have native advisory locks, but we can simulate:
      db.run(`INSERT INTO config (key, value) VALUES ('migration_lock', ?)`, [Date.now()])
      return true
    } catch (error) {
      // UNIQUE constraint violation means lock already held
      return false
    }
  },
  release(): void {
    const db = getDatabase()
    db.run(`DELETE FROM config WHERE key = 'migration_lock'`)
  }
}
```

**Add to schema**:
```sql
CREATE UNIQUE INDEX IF NOT EXISTS idx_config_migration_lock
  ON config(key) WHERE key = 'migration_lock';
```

### Option 2: File-Based Lock

```typescript
import { existsSync, writeFileSync, unlinkSync } from 'fs'
import { join } from 'path'

const LOCK_FILE = join(getDatabasePath(), '..', 'migration.lock')

const migrationLock = {
  acquire(): boolean {
    if (existsSync(LOCK_FILE)) {
      // Check if lock is stale (> 1 hour old)
      const stats = statSync(LOCK_FILE)
      if (Date.now() - stats.mtimeMs > 3600000) {
        unlinkSync(LOCK_FILE)  // Remove stale lock
      } else {
        return false
      }
    }
    writeFileSync(LOCK_FILE, Date.now().toString())
    return true
  },
  release(): void {
    if (existsSync(LOCK_FILE)) {
      unlinkSync(LOCK_FILE)
    }
  }
}
```

### Option 3: Keep Current + Document Limitation

Add comment:
```typescript
// NOTE: This lock is only safe within a single Node.js process
// (Electron main thread). NOT safe for multi-process scenarios.
// If app architecture changes, replace with database or file lock.
let migrationInProgress = false
```

## Recommendation

Use **Option 1** (database advisory lock) because:
- Already have database access
- No additional file system dependencies
- Atomic check-and-set via UNIQUE constraint
- Works across processes sharing same database

## Testing Required

1. Simulate concurrent migration attempts (event emitter test)
2. Verify lock acquisition fails for second attempt
3. Test lock release on error (in finally block)
4. Test stale lock cleanup (if lock holder crashes)

## Related Issues

None - this is an independent concurrency issue
