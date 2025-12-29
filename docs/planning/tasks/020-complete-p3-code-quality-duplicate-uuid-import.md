# P3-020: Duplicate UUID Import - Inconsistent UUID Generation

**Priority**: P3
**Status**: pending
**Category**: code-quality
**Component**: migration-handlers.ts
**Created**: 2025-12-26
**Severity**: LOW - Code cleanliness and consistency

## Problem

The file imports both `uuid` library and Node's `crypto.randomUUID`, but uses them inconsistently. This creates confusion and adds unnecessary dependency.

## Evidence

**Imports (lines 5-6)**:
```typescript
import { v4 as uuidv4 } from 'uuid'
import { randomUUID } from 'crypto'
```

**Usage Analysis**:
- `randomUUID` used: Line 448 (progress tracker)
- `uuidv4` used: Lines 557, 590 (migration data)

**Inconsistency**: Two different UUID generators for the same purpose.

## Impact

- Minor performance overhead (uuid package is larger than native crypto)
- Code inconsistency (which one should new code use?)
- Unnecessary dependency in package.json
- Potential for subtle bugs if UUID formats differ

## Location

- File: `apps/electron/electron/main/ipc/migration-handlers.ts`
- Lines: 5-6 (imports), 448 (randomUUID usage), 557, 590 (uuidv4 usage)

## Solution

**Option 1: Use native crypto.randomUUID everywhere (RECOMMENDED)**

```typescript
// Remove uuid import
import { randomUUID } from 'crypto'

// Replace all uuidv4() calls with randomUUID()
const captureId = randomUUID()  // Line 557
// ... etc
```

**Benefits**:
- ✅ No external dependency
- ✅ Faster (native implementation)
- ✅ Consistent API
- ✅ Smaller bundle size

**Option 2: Use uuid library everywhere**

```typescript
import { v4 as uuidv4 } from 'uuid'
// Remove crypto import

// Replace randomUUID() with uuidv4()
const trackerId = uuidv4()  // Line 448
```

**Benefits**:
- ✅ More cross-platform compatible (uuid lib supports older Node versions)
- ❌ External dependency

## Recommendation

Use **Option 1** (native `crypto.randomUUID`) because:
- Node.js 14.17+ supports it (Electron uses Node 16+)
- No external dependencies
- Better performance
- Consistent with modern Node.js practices

## Migration Steps

1. Remove `uuid` from package.json dependencies
2. Remove `import { v4 as uuidv4 } from 'uuid'` from imports
3. Replace all `uuidv4()` calls with `randomUUID()`
4. Run tests to verify UUID format compatibility

## Testing Required

1. Verify UUIDs are still valid v4 format
2. Test database insertions with new UUIDs
3. Verify no foreign key constraint violations
4. Check if any other code depends on uuid format

## Related Files

Check these files for uuid usage:
- `apps/electron/electron/main/services/database.ts` - uses `crypto.randomUUID()`
- Other migration files may also use uuid

## Compatibility Note

Both `uuid.v4()` and `crypto.randomUUID()` generate RFC4122 v4 UUIDs, so they're interchangeable. The format is identical: `xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx`
