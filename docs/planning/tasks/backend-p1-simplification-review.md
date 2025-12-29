# Backend P1 Code Simplification Review

**Priority**: P3
**Category**: Code Quality
**Component**: Backend Domain Services (Phase 0)
**Worktree**: `G:/Code/hidock-worktree-1-backend`

## Overview

Code quality analysis focusing on simplification opportunities, DRY violations, and code clarity improvements.

---

## SIMP-001: Duplicate Quality Inference Logic (P2)

**File**: `apps/electron/electron/main/services/quality-assessment.ts`
**Lines**: 124-144, 147-232

### Issue

Two separate implementations of quality inference:
1. `inferQualityFromData()` - Empty method (lines 124-130)
2. `inferQualityOld()` - Full implementation (lines 147-232)
3. `inferQuality()` - Wrapper calling sync DB operations (lines 132-144)

**Problems**:
- Confusing method names: "Old" implies deprecated
- Empty method is a critical bug
- Duplicate logic paths
- Unclear which method should be used

### Simplification

Consolidate into single method:

```typescript
export class QualityAssessmentService {
  /**
   * Infer quality from recording metadata using heuristics
   */
  private inferQuality(
    recording: Recording,
    transcript?: Transcript
  ): {
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

    // Factor 1: Has transcript (40 points)
    if (hasTranscript) {
      score += 40
      reasons.push('has transcript')

      if (transcript.word_count && transcript.word_count > 100) {
        score += 10
        reasons.push('substantial transcript')
      }

      if (transcript.summary) {
        score += 5
        reasons.push('has summary')
      }
    } else {
      reasons.push('no transcript')
    }

    // Factor 2: Meeting correlation (30 points)
    if (hasMeeting) {
      score += 30
      reasons.push('linked to meeting')

      if (recording.correlation_confidence && recording.correlation_confidence > 0.8) {
        score += 10
        reasons.push('high meeting confidence')
      }
    } else {
      reasons.push('no meeting link')
    }

    // Factor 3: Duration appropriateness (20 points)
    if (duration >= 60 && duration <= 7200) {
      score += 20
      reasons.push('appropriate duration')
    } else if (duration < 60) {
      reasons.push('very short recording')
      confidence = 0.6
    } else if (duration > 7200) {
      reasons.push('very long recording')
    }

    // Factor 4: File integrity (10 points)
    if (recording.file_size && recording.file_size > 1000) {
      score += 10
      reasons.push('valid file size')
    } else {
      reasons.push('suspicious file size')
      confidence = 0.5
    }

    // Determine quality level from score
    let level: QualityLevel
    if (score >= 70) {
      level = 'high'
    } else if (score >= 40) {
      level = 'medium'
    } else {
      level = 'low'
    }

    return {
      level,
      confidence,
      reason: reasons.join(', ')
    }
  }

  // Use it consistently everywhere
  async autoAssess(recordingId: string): Promise<QualityAssessment> {
    const recording = await getRecordingByIdAsync(recordingId)
    if (!recording) {
      return { level: 'low', confidence: 1.0, reason: 'Recording not found' }
    }

    const transcript = await getTranscriptByRecordingIdAsync(recordingId)
    const quality = this.inferQuality(recording, transcript)

    // ... rest of implementation
  }

  async batchAutoAssess(recordingIds: string[]): Promise<QualityAssessment[]> {
    const recordingsMap = getRecordingsByIds(recordingIds)
    const transcriptsMap = getTranscriptsByRecordingIds(recordingIds)

    const results: QualityAssessment[] = []

    for (const recordingId of recordingIds) {
      const recording = recordingsMap.get(recordingId)
      if (!recording) continue

      const transcript = transcriptsMap.get(recordingId)
      const quality = this.inferQuality(recording, transcript)

      // ... rest of implementation
    }

    return results
  }
}
```

**Benefits**:
- ✓ Single source of truth
- ✓ Consistent quality assessment
- ✓ Clear method naming
- ✓ Easier to maintain/update algorithm

**Lines Saved**: ~50 lines

---

## SIMP-002: Repeated Event Creation Pattern (P3)

**File**: `apps/electron/electron/main/services/quality-assessment.ts`
**Lines**: 50-61, 100-111, 266-277

### Issue

Same event creation pattern repeated 3 times:

```typescript
// Pattern 1 (assessQuality)
const event: QualityAssessedEvent = {
  type: 'quality:assessed',
  timestamp: new Date().toISOString(),
  payload: {
    recordingId,
    quality,
    assessmentMethod: 'manual',
    confidence: 1.0,
    reason
  }
}
getEventBus().emitDomainEvent(event)

// Pattern 2 (autoAssess) - identical structure
const event: QualityAssessedEvent = {
  type: 'quality:assessed',
  timestamp: new Date().toISOString(),
  payload: {
    recordingId,
    quality: quality.level,
    assessmentMethod: 'auto',
    confidence: quality.confidence,
    reason: quality.reason
  }
}
getEventBus().emitDomainEvent(event)

// Pattern 3 (batchAutoAssess) - identical structure
```

### Simplification

Extract event emission to helper method:

```typescript
export class QualityAssessmentService {
  private emitQualityAssessedEvent(
    recordingId: string,
    quality: QualityLevel,
    method: AssessmentMethod,
    confidence: number,
    reason?: string
  ): void {
    const event: QualityAssessedEvent = {
      type: 'quality:assessed',
      timestamp: new Date().toISOString(),
      payload: {
        recordingId,
        quality,
        assessmentMethod: method,
        confidence,
        reason
      }
    }
    getEventBus().emitDomainEvent(event)
  }

  async assessQuality(...): Promise<QualityAssessment> {
    // ... assessment logic ...

    upsertQualityAssessment(assessment)

    // Simplified event emission
    this.emitQualityAssessedEvent(recordingId, quality, 'manual', 1.0, reason)

    return getQualityAssessment(recordingId)!
  }

  async autoAssess(...): Promise<QualityAssessment> {
    // ... assessment logic ...

    upsertQualityAssessment(assessment)

    // Simplified event emission
    this.emitQualityAssessedEvent(
      recordingId,
      quality.level,
      'auto',
      quality.confidence,
      quality.reason
    )

    return getQualityAssessment(recordingId)!
  }
}
```

**Benefits**:
- ✓ DRY - single definition
- ✓ Easier to change event structure
- ✓ Less visual noise

**Lines Saved**: ~25 lines

---

## SIMP-003: Repeated Tier Assignment Pattern (P3)

**File**: `apps/electron/electron/main/services/storage-policy.ts`
**Lines**: 90-103

### Issue

Event creation pattern similar to SIMP-002:

```typescript
const event: StorageTierAssignedEvent = {
  type: 'storage:tier-assigned',
  timestamp: new Date().toISOString(),
  payload: {
    recordingId,
    tier,
    previousTier: previousTier || undefined,
    reason: `Quality-based tier assignment: ${quality} -> ${tier}`
  }
}
getEventBus().emitDomainEvent(event)
```

### Simplification

```typescript
export class StoragePolicyService {
  private emitTierAssignedEvent(
    recordingId: string,
    tier: StorageTier,
    previousTier: StorageTier | null,
    reason: string
  ): void {
    const event: StorageTierAssignedEvent = {
      type: 'storage:tier-assigned',
      timestamp: new Date().toISOString(),
      payload: {
        recordingId,
        tier,
        previousTier: previousTier || undefined,
        reason
      }
    }
    getEventBus().emitDomainEvent(event)
  }

  assignTier(recordingId: string, quality: QualityLevel): void {
    const recording = getRecordingById(recordingId)
    if (!recording) {
      console.error(`[StoragePolicy] Recording not found: ${recordingId}`)
      return
    }

    const tier = STORAGE_POLICIES[quality]
    const previousTier = recording.storage_tier

    updateRecordingStorageTier(recordingId, tier)

    this.emitTierAssignedEvent(
      recordingId,
      tier,
      previousTier,
      `Quality-based tier assignment: ${quality} -> ${tier}`
    )

    console.log(`[StoragePolicy] Assigned tier ${tier} to recording ${recordingId} (quality: ${quality})`)
  }
}
```

---

## SIMP-004: Magic Numbers Should Be Constants (P3)

**Files**: Multiple

### Issue

Magic numbers scattered throughout code:

```typescript
// quality-assessment.ts
if (transcript.word_count && transcript.word_count > 100) {  // Why 100?
  score += 10
}

if (duration >= 60 && duration <= 7200) {  // Why 60 and 7200?
  score += 20
}

if (recording.file_size && recording.file_size > 1000) {  // Why 1000?
  score += 10
}

// database.ts
const chunkSize = 100  // Repeated multiple times

// event-bus.ts
private readonly MAX_LISTENERS_PER_EVENT = 20
this.setMaxListeners(100)
```

### Simplification

Define constants at top of file or in config:

```typescript
// quality-assessment.ts
const QUALITY_THRESHOLDS = {
  MIN_WORD_COUNT: 100,
  MIN_DURATION_SECONDS: 60,
  MAX_DURATION_SECONDS: 7200,  // 2 hours
  MIN_FILE_SIZE_BYTES: 1000,

  SCORES: {
    HAS_TRANSCRIPT: 40,
    SUBSTANTIAL_TRANSCRIPT: 10,
    HAS_SUMMARY: 5,
    HAS_MEETING: 30,
    HIGH_MEETING_CONFIDENCE: 10,
    APPROPRIATE_DURATION: 20,
    VALID_FILE_SIZE: 10
  },

  THRESHOLDS: {
    HIGH_QUALITY: 70,
    MEDIUM_QUALITY: 40
  }
} as const

export class QualityAssessmentService {
  private inferQuality(...) {
    // ... setup ...

    if (hasTranscript) {
      score += QUALITY_THRESHOLDS.SCORES.HAS_TRANSCRIPT
      reasons.push('has transcript')

      if (transcript.word_count && transcript.word_count > QUALITY_THRESHOLDS.MIN_WORD_COUNT) {
        score += QUALITY_THRESHOLDS.SCORES.SUBSTANTIAL_TRANSCRIPT
        reasons.push('substantial transcript')
      }
    }

    if (duration >= QUALITY_THRESHOLDS.MIN_DURATION_SECONDS &&
        duration <= QUALITY_THRESHOLDS.MAX_DURATION_SECONDS) {
      score += QUALITY_THRESHOLDS.SCORES.APPROPRIATE_DURATION
      reasons.push('appropriate duration')
    }

    // Determine quality level
    if (score >= QUALITY_THRESHOLDS.THRESHOLDS.HIGH_QUALITY) {
      level = 'high'
    } else if (score >= QUALITY_THRESHOLDS.THRESHOLDS.MEDIUM_QUALITY) {
      level = 'medium'
    } else {
      level = 'low'
    }
  }
}
```

**Benefits**:
- ✓ Self-documenting code
- ✓ Easy to tune thresholds
- ✓ Centralized configuration
- ✓ Type safety with `as const`

---

## SIMP-005: Repeated Chunk Size Definition (P3)

**File**: `apps/electron/electron/main/services/database.ts`
**Lines**: 799, 1189

### Issue

`chunkSize = 100` defined multiple times:

```typescript
// getMeetingsByIds
const chunkSize = 100

// getTranscriptsByRecordingIds
const chunkSize = 100

// getContactsByEmails
const chunkSize = 100
```

### Simplification

Define once at module level:

```typescript
// database.ts - top of file
const DB_QUERY_CHUNK_SIZE = 100  // SQLite variable limit is 999, use conservative value
const SQLITE_MAX_VARIABLES = 999  // SQLite default limit

// Use consistently
export function getMeetingsByIds(meetingIds: string[]): Map<string, Meeting> {
  if (meetingIds.length === 0) return new Map()

  const results = new Map<string, Meeting>()

  for (let i = 0; i < meetingIds.length; i += DB_QUERY_CHUNK_SIZE) {
    const chunk = meetingIds.slice(i, i + DB_QUERY_CHUNK_SIZE)
    // ...
  }

  return results
}
```

**Benefits**:
- ✓ Single source of truth
- ✓ Easy to tune globally
- ✓ Documents why 100 is chosen

---

## SIMP-006: Verbose Map Building Pattern (P3)

**File**: `apps/electron/electron/main/services/database.ts`
**Multiple locations**

### Issue

Verbose map building:

```typescript
const results = new Map<string, Meeting>()

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
```

### Simplification

Extract to helper function:

```typescript
/**
 * Generic batch query helper that returns a Map
 */
function batchQueryToMap<T, K extends keyof T>(
  tableName: string,
  idColumn: string,
  ids: string[],
  keyExtractor: (item: T) => string = (item) => item[idColumn as keyof T] as string,
  chunkSize: number = DB_QUERY_CHUNK_SIZE
): Map<string, T> {
  if (ids.length === 0) return new Map()

  const results = new Map<string, T>()

  for (let i = 0; i < ids.length; i += chunkSize) {
    const chunk = ids.slice(i, i + chunkSize)
    const placeholders = chunk.map(() => '?').join(',')
    const items = queryAll<T>(
      `SELECT * FROM ${tableName} WHERE ${idColumn} IN (${placeholders})`,
      chunk
    )

    items.forEach(item => results.set(keyExtractor(item), item))
  }

  return results
}

// Usage becomes simple
export function getMeetingsByIds(meetingIds: string[]): Map<string, Meeting> {
  const uniqueIds = [...new Set(meetingIds.filter(Boolean))]
  return batchQueryToMap<Meeting, 'id'>('meetings', 'id', uniqueIds)
}

export function getRecordingsByIds(ids: string[]): Map<string, Recording> {
  return batchQueryToMap<Recording, 'id'>('recordings', 'id', ids)
}

export function getTranscriptsByRecordingIds(recordingIds: string[]): Map<string, Transcript> {
  return batchQueryToMap<Transcript, 'recording_id'>(
    'transcripts',
    'recording_id',
    recordingIds,
    (t) => t.recording_id
  )
}
```

**Benefits**:
- ✓ DRY - eliminate 50+ lines of repetition
- ✓ Consistent behavior
- ✓ Single place to fix bugs
- ✓ Type-safe with generics

**Lines Saved**: ~60 lines

---

## SIMP-007: Console.log Should Use Structured Logging (P3)

**Files**: All service files

### Issue

Inconsistent console logging:

```typescript
console.log('[StoragePolicy] Assigned tier...')
console.log(`[EventBus] Emitted: ${event.type}`, enrichedEvent.payload)
console.error('[StoragePolicy] Recording not found:', recordingId)
console.warn('[EventBus] Max listeners reached...')
```

**Problems**:
- Inconsistent prefixes
- No log levels control
- Hard to filter in production
- No structured data for log aggregation

### Simplification

Create simple logger utility:

```typescript
// utils/logger.ts
export enum LogLevel {
  Debug = 0,
  Info = 1,
  Warn = 2,
  Error = 3
}

class Logger {
  constructor(
    private context: string,
    private minLevel: LogLevel = LogLevel.Info
  ) {}

  debug(message: string, data?: any): void {
    if (this.minLevel <= LogLevel.Debug) {
      console.log(`[${this.context}] ${message}`, data || '')
    }
  }

  info(message: string, data?: any): void {
    if (this.minLevel <= LogLevel.Info) {
      console.log(`[${this.context}] ${message}`, data || '')
    }
  }

  warn(message: string, data?: any): void {
    if (this.minLevel <= LogLevel.Warn) {
      console.warn(`[${this.context}] ${message}`, data || '')
    }
  }

  error(message: string, error?: Error | any): void {
    if (this.minLevel <= LogLevel.Error) {
      console.error(`[${this.context}] ${message}`, error || '')
    }
  }

  child(subContext: string): Logger {
    return new Logger(`${this.context}:${subContext}`, this.minLevel)
  }
}

export function createLogger(context: string): Logger {
  const level = process.env.LOG_LEVEL
    ? LogLevel[process.env.LOG_LEVEL as keyof typeof LogLevel]
    : LogLevel.Info
  return new Logger(context, level)
}

// Usage in services
const logger = createLogger('StoragePolicy')

export class StoragePolicyService {
  assignTier(recordingId: string, quality: QualityLevel): void {
    const recording = getRecordingById(recordingId)
    if (!recording) {
      logger.error('Recording not found', { recordingId })
      return
    }

    // ...

    logger.info(`Assigned tier ${tier} to recording`, { recordingId, quality, tier })
  }
}
```

**Benefits**:
- ✓ Centralized log level control
- ✓ Structured logging (easy to parse)
- ✓ Easy to swap implementations (Winston, Pino, etc.)
- ✓ Child loggers for context

---

## SIMP-008: Repeated Error Handling Pattern (P3)

**File**: `apps/electron/electron/main/services/quality-assessment.ts`
**Lines**: 280-283

### Issue

Try-catch with console.error repeated:

```typescript
for (const recordingId of recordingIds) {
  try {
    // ... processing ...
  } catch (error) {
    console.error(`Failed to assess recording ${recordingId}:`, error)
  }
}
```

### Simplification

Extract to utility:

```typescript
async function processWithErrorLogging<T, R>(
  items: T[],
  processor: (item: T) => Promise<R>,
  logger: Logger,
  itemDescriptor: (item: T) => string
): Promise<R[]> {
  const results: R[] = []

  for (const item of items) {
    try {
      const result = await processor(item)
      results.push(result)
    } catch (error) {
      logger.error(`Failed to process ${itemDescriptor(item)}`, error)
    }
  }

  return results
}

// Usage
async batchAutoAssess(recordingIds: string[]): Promise<QualityAssessment[]> {
  const recordingsMap = getRecordingsByIds(recordingIds)
  const transcriptsMap = getTranscriptsByRecordingIds(recordingIds)

  return processWithErrorLogging(
    recordingIds,
    async (recordingId) => {
      const recording = recordingsMap.get(recordingId)
      if (!recording) throw new Error('Recording not found')

      const transcript = transcriptsMap.get(recordingId)
      const quality = this.inferQuality(recording, transcript)

      const assessment = { /* ... */ }
      upsertQualityAssessment(assessment)
      this.emitQualityAssessedEvent(/* ... */)

      return getQualityAssessment(recordingId)!
    },
    logger,
    (id) => `recording ${id}`
  )
}
```

---

## SIMP-009: Partition Logic Repeated (P3)

**File**: `apps/electron/electron/main/services/storage-policy.ts`
**Lines**: 129-136, 285-292

### Issue

Same "partition by tier" pattern used twice:

```typescript
// Pattern 1
const recordingsByTier = new Map<StorageTier, Recording[]>()
for (const recording of allRecordings) {
  const tier = recording.storage_tier as StorageTier
  if (!recordingsByTier.has(tier)) {
    recordingsByTier.set(tier, [])
  }
  recordingsByTier.get(tier)!.push(recording)
}

// Pattern 2 - identical
```

### Simplification

Generic groupBy utility:

```typescript
// utils/array-helpers.ts
export function groupBy<T, K extends string | number>(
  items: T[],
  keyExtractor: (item: T) => K
): Map<K, T[]> {
  const groups = new Map<K, T[]>()

  for (const item of items) {
    const key = keyExtractor(item)
    if (!groups.has(key)) {
      groups.set(key, [])
    }
    groups.get(key)!.push(item)
  }

  return groups
}

// Usage
const recordingsByTier = groupBy(
  allRecordings,
  (r) => r.storage_tier as StorageTier
)
```

---

## SIMP-010: Optional Chaining Could Simplify Checks (P3)

**Multiple locations**

### Issue

Verbose null checks:

```typescript
// Current
if (sanitized.payload && typeof sanitized.payload === 'object') {
  if (sanitized.payload.reason && typeof sanitized.payload.reason === 'string') {
    // ...
  }
}

// Current
const meetingDurationSeconds = (meetingEnd - meetingStart) / 1000
```

### Simplification

```typescript
// Simplified with optional chaining
if (sanitized.payload?.reason && typeof sanitized.payload.reason === 'string') {
  // ...
}

// Simplified with nullish coalescing
const quality = qualityAssessment?.quality ?? 'unknown'
```

---

## Summary Table

| ID | Issue | Lines Saved | Priority | Complexity |
|----|-------|-------------|----------|------------|
| SIMP-001 | Duplicate quality inference | ~50 | P2 | Low |
| SIMP-002 | Repeated event creation | ~25 | P3 | Low |
| SIMP-003 | Repeated tier assignment | ~10 | P3 | Low |
| SIMP-004 | Magic numbers | N/A | P3 | Low |
| SIMP-005 | Repeated chunk size | ~5 | P3 | Easy |
| SIMP-006 | Verbose map building | ~60 | P3 | Low |
| SIMP-007 | Structured logging | N/A | P3 | Low |
| SIMP-008 | Repeated error handling | ~15 | P3 | Low |
| SIMP-009 | Partition logic | ~10 | P3 | Easy |
| SIMP-010 | Optional chaining | ~20 | P3 | Easy |

**Total Lines Saved**: ~195 lines

## Recommended Action Plan

### High Priority (P2)
1. **SIMP-001**: Consolidate quality inference logic (fixes critical bug too)

### Medium Priority (P3) - Quick Wins
2. SIMP-005: Extract chunk size constant
3. SIMP-009: Add groupBy utility
4. SIMP-010: Use optional chaining where appropriate

### Medium Priority (P3) - Refactoring
5. SIMP-002: Extract event emission helpers
6. SIMP-006: Create batchQueryToMap helper
7. SIMP-004: Extract magic numbers to constants

### Lower Priority (P3) - Infrastructure
8. SIMP-007: Implement structured logging
9. SIMP-008: Create error handling utilities

## Benefits Summary

Implementing these simplifications will:
- ✓ Reduce code by ~195 lines
- ✓ Improve maintainability
- ✓ Make code more testable
- ✓ Reduce duplication
- ✓ Improve readability
- ✓ Fix critical bug (SIMP-001)

---

**Reviewed by**: Claude Opus 4.5
**Date**: 2025-12-26
**Worktree**: hidock-worktree-1-backend
**Commit**: b3c08200
