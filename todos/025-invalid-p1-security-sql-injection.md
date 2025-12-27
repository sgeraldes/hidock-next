---
id: "025"
priority: P1
status: invalid
category: security
title: Potential SQL Injection in Database Handlers
files:
  - apps/electron/electron/main/ipc/database-handlers.ts
  - apps/electron/electron/main/services/database.ts
created: 2024-12-27
reviewed: 2024-12-27
invalidation_reason: hallucinated
---

# Potential SQL Injection in Database Handlers

## Assessment: HALLUCINATED - All Queries Use Parameterization

After reviewing `database.ts` (2131 lines), **ALL SQL queries use parameterized statements**.

### Evidence From Code Review

1. **Core query functions use parameterization** (lines 642-654):
   ```typescript
   export function queryAll<T>(sql: string, params: unknown[] = []): T[] {
     const stmt = getDatabase().prepare(sql)
     stmt.bind(params)  // PARAMETERIZED - SAFE
     const results: T[] = []
     while (stmt.step()) {
       const row = stmt.getAsObject()
       results.push(row as T)
     }
     stmt.free()
     return results
   }
   ```

2. **LIKE patterns properly escaped** (lines 1252-1265):
   ```typescript
   function escapeLikePattern(pattern: string): string {
     return pattern
       .replace(/\\/g, '\\\\')  // Escape backslash first
       .replace(/%/g, '\\%')     // Escape percent
       .replace(/_/g, '\\_')     // Escape underscore
   }
   ```

3. **All search functions use parameters**:
   ```typescript
   const rows = queryAll<RecordingRow>(
     `SELECT * FROM recordings
      WHERE filename LIKE ? ESCAPE '\\'`,
     [`%${escapeLikePattern(searchTerm)}%`]
   )
   ```

4. **database-handlers.ts is just IPC bridge**:
   - It calls database.ts functions
   - No direct SQL construction
   - Parameters pass through to parameterized queries

### What The Review Got Wrong

The todo assumed patterns like `${filename}` were used in SQL:
```typescript
// This pattern DOES NOT EXIST in the codebase:
const query = `SELECT * FROM recordings WHERE filename = '${filename}'`
```

Every query follows the safe pattern:
```typescript
queryAll(sql, [param1, param2])  // Parameterized
```

### Conclusion

**DELETE THIS TODO** - SQL injection is not possible because:
1. All queries use `stmt.bind(params)` parameterization
2. LIKE wildcards are properly escaped
3. No string interpolation in SQL construction

This is a false positive from automated security review that assumed unsafe patterns without verifying.
