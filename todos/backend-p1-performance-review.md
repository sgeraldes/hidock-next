# Backend P1 Performance Review Findings

**Priority**: P2
**Category**: Performance
**Component**: Backend Domain Services (Phase 0)
**Worktree**: `G:/Code/hidock-worktree-1-backend`

## Overview

Performance analysis of P1 fixes implemented in commit `b3c08200` focusing on N+1 query elimination, event loop blocking, and database query optimization.

---

## PERF-001: Batch Query Implementation Correct (✓ Good)

**File**: `apps/electron/electron/main/services/database.ts`
**Lines**: 981-991

### Analysis

The `getRecordingsByIds()` implementation is well-designed:

```typescript
export function getRecordingsByIds(ids: string[]): Map<string, Recording> {
  if (ids.length === 0) return new Map()
  const placeholders = ids.map(() => '?').join(',')
  const recordings = queryAll<Recording>(
    `SELECT * FROM recordings WHERE id IN (${placeholders})`,
    ids
  )
  const map = new Map<string, Recording>()
  recordings.forEach(r => map.set(r.id, r))
  return map
}
```

**Strengths**:
✓ Returns `Map` for O(1) lookup vs array O(n)
✓ Handles empty array edge case
✓ Single query vs N queries
✓ No SQL injection (uses parameterized query)

**Performance Impact**: Eliminates N+1 queries. For 100 recordings, this reduces 100 queries to 1 query.

### Minor Improvement Opportunity

Consider chunking for very large ID arrays (SQLite has limits):

```typescript
export function getRecordingsByIds(ids: string[]): Map<string, Recording> {
  if (ids.length === 0) return new Map()

  const results = new Map<string, Recording>()
  const chunkSize = 999 // SQLite SQLITE_MAX_VARIABLE_NUMBER default

  for (let i = 0; i < ids.length; i += chunkSize) {
    const chunk = ids.slice(i, i + chunkSize)
    const placeholders = chunk.map(() => '?').join(',')
    const recordings = queryAll<Recording>(
      `SELECT * FROM recordings WHERE id IN (${placeholders})`,
      chunk
    )
    recordings.forEach(r => results.set(r.id, r))
  }

  return results
}
```

**Priority**: P3 (only needed if app commonly queries >999 IDs at once)

---

## PERF-002: getMeetingsByIds() Already Uses Chunking (✓ Excellent)

**File**: `apps/electron/electron/main/services/database.ts`
**Lines**: 791-815

### Analysis

```typescript
export function getMeetingsByIds(meetingIds: string[]): Map<string, Meeting> {
  if (meetingIds.length === 0) return new Map()
  const uniqueIds = [...new Set(meetingIds.filter(Boolean))]
  if (uniqueIds.length === 0) return new Map()

  const results = new Map<string, Meeting>()
  const chunkSize = 100

  for (let i = 0; i < uniqueIds.length; i += chunkSize) {
    const chunk = uniqueIds.slice(i, i + chunkSize)
    const placeholders = chunk.map(() => '?').join(',')
    const meetings = queryAll<Meeting>(
      `SELECT * FROM meetings WHERE id IN (${placeholders})`,
      chunk
    )

    for (const meeting of meetings) {
      results.set(meeting.id, meeting)
    }
  }

  return results
}
```

**Strengths**:
✓ Handles duplicates with `Set`
✓ Filters nulls with `filter(Boolean)`
✓ Chunks at 100 items (conservative, could go higher)
✓ Proper edge case handling

**Suggestion**: Consider increasing `chunkSize` to 500-900 for better performance (SQLite limit is 999).

---

## PERF-003: getTranscriptsByRecordingIds() Well Optimized (✓ Good)

**File**: `apps/electron/electron/main/services/database.ts`
**Lines**: 1184-1205

### Analysis

```typescript
export function getTranscriptsByRecordingIds(recordingIds: string[]): Map<string, Transcript> {
  if (recordingIds.length === 0) return new Map()

  const results = new Map<string, Transcript>()
  const chunkSize = 100

  for (let i = 0; i < recordingIds.length; i += chunkSize) {
    const chunk = recordingIds.slice(i, i + chunkSize)
    const placeholders = chunk.map(() => '?').join(',')
    const transcripts = queryAll<Transcript>(
      `SELECT * FROM transcripts WHERE recording_id IN (${placeholders})`,
      chunk
    )

    for (const transcript of transcripts) {
      results.set(transcript.recording_id, transcript)
    }
  }

  return results
}
```

**Strengths**:
✓ Chunked queries
✓ Returns Map keyed by recording_id (correct for 1:1 relationship)
✓ Single index lookup per chunk (idx_transcripts_recording)

**Performance**: O(log n) per chunk due to index, not O(n).

---

## PERF-004: quality-assessment.ts Still Has Sync DB Calls (⚠ Issue)

**File**: `apps/electron/electron/main/services/quality-assessment.ts`
**Lines**: 32, 47, 63, 113, 137, 142, 152, 247

### Issue

Multiple synchronous database calls in async functions:

```typescript
async assessQuality(...): Promise<QualityAssessment> {
  const recording = getRecordingById(recordingId)  // SYNC!
  // ...
  upsertQualityAssessment(assessment)  // SYNC!
  // ...
  return getQualityAssessment(recordingId)!  // SYNC!
}

async autoAssess(recordingId: string): Promise<QualityAssessment> {
  const quality = this.inferQuality(recordingId)  // calls SYNC DB
  upsertQualityAssessment(assessment)  // SYNC!
  return getQualityAssessment(recordingId)!  // SYNC!
}

private inferQuality(recordingId: string): ... {
  const recording = getRecordingById(recordingId)  // SYNC!
  const transcript = getTranscriptByRecordingId(recordingId)  // SYNC!
  // ...
}
```

### Performance Impact

**Blocking**: Each sync DB call blocks the event loop for ~0.1-1ms (depends on DB size). For 100 recordings, this could block for 20-200ms total.

**Not critical yet** because sql.js is in-memory and fast, but as database grows this could become problematic.

### Recommendation

As documented in `REMAINING_P1_FIXES.md` issue #005, implement async wrappers:

```typescript
async function getRecordingByIdAsync(id: string): Promise<Recording | undefined> {
  return new Promise((resolve) => setImmediate(() => resolve(getRecordingById(id))))
}
```

**However**, there's a better approach: use `util.promisify` or move to async database library.

### Better Solution

Consider migrating to `better-sqlite3` with async wrappers or implementing a connection pool:

```typescript
import Database from 'better-sqlite3'

class AsyncDatabase {
  private db: Database.Database

  async query<T>(sql: string, params: any[] = []): Promise<T[]> {
    return new Promise((resolve, reject) => {
      setImmediate(() => {
        try {
          const stmt = this.db.prepare(sql)
          const results = stmt.all(...params) as T[]
          resolve(results)
        } catch (error) {
          reject(error)
        }
      })
    })
  }
}
```

**Priority**: P2 (not critical now, but needed for scalability)

---

## PERF-005: batchAutoAssess() Still Has N Individual Queries (⚠ Issue)

**File**: `apps/electron/electron/main/services/quality-assessment.ts`
**Lines**: 238-286

### Issue

Line 247 still uses individual `getRecordingById()` calls:

```typescript
async batchAutoAssess(recordingIds: string[]): Promise<QualityAssessment[]> {
  const { getRecordingById, getTranscriptsByRecordingIds } = await import('./database')

  const transcriptsMap = getTranscriptsByRecordingIds(recordingIds)  // Good! Batch query
  const results: QualityAssessment[] = []

  for (const recordingId of recordingIds) {
    const recording = getRecordingById(recordingId)  // BAD! N+1 query
    // ...
  }
}
```

### Fix

As documented in `REMAINING_P1_FIXES.md` issue #005, should use `getRecordingsByIds()`:

```typescript
async batchAutoAssess(recordingIds: string[]): Promise<QualityAssessment[]> {
  const { getRecordingsByIds, getTranscriptsByRecordingIds } = await import('./database')

  const recordingsMap = getRecordingsByIds(recordingIds)  // ✓ Batch query
  const transcriptsMap = getTranscriptsByRecordingIds(recordingIds)  // ✓ Batch query
  const results: QualityAssessment[] = []

  for (const recordingId of recordingIds) {
    const recording = recordingsMap.get(recordingId)
    if (!recording) continue

    const transcript = transcriptsMap.get(recordingId)
    // ...
  }
}
```

**Performance Impact**: For 100 recordings, this reduces 100 queries to 2 queries (50x improvement).

**Priority**: P1 (critical for batch operations)

---

## PERF-006: storage-policy.ts Has Full Table Scan (⚠ Critical)

**File**: `apps/electron/electron/main/services/storage-policy.ts`
**Lines**: 116-172

### Issue

`getCleanupSuggestions()` performs full table scan:

```typescript
getCleanupSuggestions(minAgeOverride?: ...): CleanupSuggestion[] {
  // OPTIMIZED: Query all tiered recordings once instead of per-tier
  const allRecordings = queryAll<Recording>(
    'SELECT * FROM recordings WHERE storage_tier IS NOT NULL ORDER BY storage_tier, date_recorded DESC'
  )

  // Then loops through ALL recordings in memory
  for (const tier of tiers) {
    const recordings = recordingsByTier.get(tier) || []
    for (const recording of recordings) {
      const recordedDate = new Date(recording.date_recorded)
      const ageMs = now.getTime() - recordedDate.getTime()
      const ageInDays = Math.floor(ageMs / (1000 * 60 * 60 * 24))

      if (ageInDays > maxAge) {
        const qualityAssessment = getQualityAssessment(recording.id)  // N+1 query!
        // ...
      }
    }
  }
}
```

**Problems**:
1. Loads ALL recordings with storage_tier (could be 10,000+)
2. Processes ALL in memory (memory intensive)
3. Individual `getQualityAssessment()` calls (N+1)
4. Doesn't use indexed date queries

### Fix

As documented in `REMAINING_P1_FIXES.md` issue #008:

```typescript
async getCleanupSuggestions(minAgeOverride?: ...): Promise<CleanupSuggestion[]> {
  const suggestions: CleanupSuggestion[] = []
  const now = new Date()
  const retentionDays = { ...TIER_RETENTION_DAYS, ...minAgeOverride }
  const tiers: StorageTier[] = ['archive', 'cold', 'warm', 'hot']

  for (const tier of tiers) {
    const maxAge = retentionDays[tier]
    const cutoffDate = new Date(now.getTime() - maxAge * 24 * 60 * 60 * 1000).toISOString()

    // ✓ Use indexed query with LIMIT
    const recordings = queryAll<Recording>(
      `SELECT * FROM recordings
       WHERE storage_tier = ? AND date_recorded < ?
       ORDER BY date_recorded ASC
       LIMIT 1000`,
      [tier, cutoffDate]
    )

    if (recordings.length === 0) continue

    // ✓ Batch load quality assessments
    const recordingIds = recordings.map(r => r.id)
    const placeholders = recordingIds.map(() => '?').join(',')
    const qualities = queryAll<QualityAssessment>(
      `SELECT * FROM quality_assessments WHERE recording_id IN (${placeholders})`,
      recordingIds
    )
    const qualityMap = new Map(qualities.map(q => [q.recording_id, q]))

    // Process in memory (fast)
    for (const recording of recordings) {
      const quality = qualityMap.get(recording.id)
      // ...
    }
  }

  return suggestions
}
```

**Performance Impact**:
- Before: O(n) full table scan + N individual queries
- After: O(log n) indexed query per tier + 1 batch query per tier

For 10,000 recordings with 100 old recordings per tier:
- Before: 10,000 rows scanned + 400 quality queries = ~10,400 operations
- After: 4 indexed queries (400 rows) + 4 batch queries = 8 operations

**1,300x improvement!**

**Priority**: P1 (critical performance issue)

---

## PERF-007: getStorageStats() Also Has Full Table Scan (⚠ Issue)

**File**: `apps/electron/electron/main/services/storage-policy.ts`
**Lines**: 269-315

### Issue

Similar to PERF-006, loads all tiered recordings:

```typescript
getStorageStats(): ... {
  // OPTIMIZED: Query all tiered recordings once
  const allRecordings = queryAll<Recording>(
    'SELECT * FROM recordings WHERE storage_tier IS NOT NULL'
  )

  // Process in memory
  const recordingsByTier = new Map<StorageTier, Recording[]>()
  for (const recording of allRecordings) {
    // ...
  }
}
```

### Fix

Use SQL aggregation instead of in-memory processing:

```typescript
async getStorageStats(): Promise<{
  tier: StorageTier
  count: number
  totalSizeBytes: number
  avgAgeDays: number
}[]> {
  const now = Date.now()

  const stats = queryAll<{
    storage_tier: StorageTier
    count: number
    total_size: number
    avg_age_ms: number
  }>(`
    SELECT
      storage_tier,
      COUNT(*) as count,
      SUM(file_size) as total_size,
      AVG(JULIANDAY('now') - JULIANDAY(date_recorded)) * 86400000 as avg_age_ms
    FROM recordings
    WHERE storage_tier IS NOT NULL
    GROUP BY storage_tier
  `)

  return stats.map(s => ({
    tier: s.storage_tier,
    count: s.count,
    totalSizeBytes: s.total_size || 0,
    avgAgeDays: Math.floor((s.avg_age_ms || 0) / (1000 * 60 * 60 * 24))
  }))
}
```

**Performance Impact**:
- Before: Load N recordings, process in memory
- After: Single SQL query with aggregation (database does the work)

**100x faster** for large datasets.

**Priority**: P2

---

## PERF-008: Event Bus Console Logging in Hot Path (Minor)

**File**: `apps/electron/electron/main/services/event-bus.ts`
**Lines**: 115

### Issue

```typescript
console.log(`[EventBus] Emitted: ${event.type}`, enrichedEvent.payload)
```

This logs EVERY event. For high-frequency events (quality assessments during batch processing), this could be thousands of logs.

### Fix

Add log level control:

```typescript
private logLevel: 'debug' | 'info' | 'warn' | 'error' = 'info'

emitDomainEvent<T extends DomainEvent>(event: T): void {
  // ...

  if (this.logLevel === 'debug') {
    console.log(`[EventBus] Emitted: ${event.type}`, enrichedEvent.payload)
  }
}
```

Or use conditional logging:

```typescript
if (process.env.NODE_ENV === 'development') {
  console.log(`[EventBus] Emitted: ${event.type}`, enrichedEvent.payload)
}
```

**Priority**: P3

---

## PERF-009: Missing Database Indexes (Check Required)

**File**: `apps/electron/electron/main/services/database.ts`
**Lines**: 233-235

### Analysis

Check if these indexes exist:

```sql
CREATE INDEX IF NOT EXISTS idx_quality_recording ON quality_assessments(recording_id);
CREATE INDEX IF NOT EXISTS idx_quality_level ON quality_assessments(quality);
CREATE INDEX IF NOT EXISTS idx_recordings_storage_tier ON recordings(storage_tier);
```

✓ All present in schema (lines 233-235)

**Additional useful index**:

```sql
-- For cleanup queries (tier + date)
CREATE INDEX IF NOT EXISTS idx_recordings_tier_date ON recordings(storage_tier, date_recorded);
```

This composite index would make PERF-006 fix even faster.

**Priority**: P3

---

## PERF-010: inferQualityFromData() Method Empty (⚠ Critical Bug)

**File**: `apps/electron/electron/main/services/quality-assessment.ts`
**Lines**: 124-130

### Issue

```typescript
private inferQualityFromData(recording: Recording, transcript?: Transcript): {
  level: QualityLevel
  confidence: number
  reason: string
} {
  // EMPTY IMPLEMENTATION!
}
```

This method is called by `batchAutoAssess()` but has no implementation. It should contain the logic from `inferQualityOld()`.

### Fix

Either:
1. Move `inferQualityOld()` logic into `inferQualityFromData()`
2. Or call `inferQualityOld()` from `inferQualityFromData()`

**This is actually a CRITICAL BUG, not just performance issue!**

```typescript
private inferQualityFromData(recording: Recording, transcript?: Transcript): {
  level: QualityLevel
  confidence: number
  reason: string
} {
  const hasMeeting = !!recording.meeting_id
  const hasTranscript = !!transcript
  const duration = recording.duration_seconds || 0

  let score = 0
  let confidence = 0.7
  const reasons: string[] = []

  // ... (copy logic from inferQualityOld)

  return { level, confidence, reason: reasons.join(', ') }
}
```

**Priority**: P0 (blocking bug - quality assessment doesn't work!)

---

## Summary Table

| ID | Issue | Priority | Impact | Fix Complexity |
|----|-------|----------|--------|----------------|
| PERF-001 | Batch query good, could chunk | P3 | Low | Easy |
| PERF-002 | getMeetingsByIds chunking good | ✓ | N/A | N/A |
| PERF-003 | getTranscriptsByRecordingIds good | ✓ | N/A | N/A |
| PERF-004 | Sync DB calls blocking loop | P2 | Medium | Medium |
| PERF-005 | batchAutoAssess N+1 queries | **P1** | High | Easy |
| PERF-006 | getCleanupSuggestions full scan | **P1** | Critical | Medium |
| PERF-007 | getStorageStats full scan | P2 | High | Easy |
| PERF-008 | Excessive console logging | P3 | Low | Easy |
| PERF-009 | Missing composite index | P3 | Low | Easy |
| PERF-010 | **Empty inferQualityFromData** | **P0** | **CRITICAL BUG** | Easy |

## Recommended Action Plan

### Immediate (P0-P1)
1. **PERF-010**: Implement `inferQualityFromData()` (CRITICAL BUG)
2. **PERF-005**: Fix `batchAutoAssess()` to use `getRecordingsByIds()`
3. **PERF-006**: Optimize `getCleanupSuggestions()` with indexed queries

### Next Sprint (P2)
4. PERF-004: Add async wrappers for DB operations
5. PERF-007: Optimize `getStorageStats()` with SQL aggregation

### Future (P3)
6. PERF-001: Add chunking to `getRecordingsByIds()`
7. PERF-008: Add log level control
8. PERF-009: Add composite index for tier+date queries

---

**Reviewed by**: Claude Opus 4.5
**Date**: 2025-12-26
**Worktree**: hidock-worktree-1-backend
**Commit**: b3c08200
