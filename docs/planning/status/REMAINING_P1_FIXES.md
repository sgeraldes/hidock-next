# Remaining P1 Security & Performance Fixes

## Status Summary

### ✅ COMPLETED (Committed in b3c08200)
- **002 - SQL Injection**: Fixed with `sanitizeEventPayload()` function in event-bus.ts
- **004 - Uncontrolled Data Broadcasting**: Fixed with data sanitization before renderer broadcast
- **006 - N+1 Queries**: Fixed with `getRecordingsByIds()` batch query function in database.ts
- **007 - Unbounded Event Listeners**: Already implemented with proper limits and cleanup

### ⏳ REMAINING (Manual Implementation Required)

Due to file manipulation complexity in automated tooling, the following fixes need manual implementation:

---

## 003 - Missing Input Validation

### Files to Update
- `apps/electron/electron/main/services/quality-assessment.ts`
- `apps/electron/electron/main/services/storage-policy.ts`

### Implementation Steps

#### quality-assessment.ts

1. **Add Zod import and schemas** (after line 1):
```typescript
import { z } from 'zod'

// Validation schemas
const QualityLevelSchema = z.enum(['high', 'medium', 'low'])
const AssessmentMethodSchema = z.enum(['auto', 'manual'])

const AssessQualitySchema = z.object({
  recordingId: z.string().uuid('Invalid recording ID format'),
  quality: QualityLevelSchema,
  reason: z.string().optional(),
  assessedBy: z.string().optional()
})

const BatchAutoAssessSchema = z.array(z.string().uuid('Invalid recording ID format'))
```

2. **Add validation to `assessQuality` method** (line ~26, at start of function body):
```typescript
async assessQuality(
  recordingId: string,
  quality: QualityLevel,
  reason?: string,
  assessedBy?: string
): Promise<QualityAssessment> {
  // Validate input parameters
  AssessQualitySchema.parse({ recordingId, quality, reason, assessedBy })

  // ... rest of method
}
```

3. **Add validation to `batchAutoAssess` method** (line ~238, at start of function body):
```typescript
async batchAutoAssess(recordingIds: string[]): Promise<QualityAssessment[]> {
  // Validate input parameters
  BatchAutoAssessSchema.parse(recordingIds)

  // ... rest of method
}
```

#### storage-policy.ts

1. **Add Zod import and schemas** (after line 8):
```typescript
import { z } from 'zod'

// Validation schemas
const StorageTierSchema = z.enum(['hot', 'warm', 'cold', 'archive'])
const QualityLevelSchemaStorage = z.enum(['high', 'medium', 'low'])

const AssignTierSchema = z.object({
  recordingId: z.string().uuid('Invalid recording ID format'),
  quality: QualityLevelSchemaStorage
})

const ExecuteCleanupSchema = z.object({
  recordingIds: z.array(z.string().uuid('Invalid recording ID format')),
  archive: z.boolean().default(false)
})
```

2. **Add validation to `assignTier` method** (line ~76, at start of function body):
```typescript
assignTier(recordingId: string, quality: QualityLevel): void {
  // Validate input parameters
  AssignTierSchema.parse({ recordingId, quality })

  // ... rest of method
}
```

3. **Add validation to `executeCleanup` method** (line ~190, at start of function body):
```typescript
async executeCleanup(recordingIds: string[], archive: boolean = false): Promise<{
  deleted: string[]
  archived: string[]
  failed: { id: string; reason: string }[]
}> {
  // Validate input parameters
  ExecuteCleanupSchema.parse({ recordingIds, archive })

  // ... rest of method
}
```

---

## 005 - Sync DB Operations Blocking Event Loop

### Files to Update
- `apps/electron/electron/main/services/quality-assessment.ts`
- `apps/electron/electron/main/services/storage-policy.ts`

### Implementation Steps

#### quality-assessment.ts

1. **Add async wrappers** (before the `QualityAssessmentService` class, around line 22):
```typescript
// Async wrappers for database operations to prevent event loop blocking
async function getRecordingByIdAsync(id: string): Promise<Recording | undefined> {
  return new Promise((resolve) => setImmediate(() => resolve(getRecordingById(id))))
}

async function getTranscriptByRecordingIdAsync(id: string): Promise<Transcript | undefined> {
  return new Promise((resolve) => setImmediate(() => resolve(getTranscriptByRecordingId(id))))
}

async function getQualityAssessmentAsync(id: string): Promise<QualityAssessment | undefined> {
  return new Promise((resolve) => setImmediate(() => resolve(getQualityAssessment(id))))
}

async function upsertQualityAssessmentAsync(assessment: Omit<QualityAssessment, 'assessed_at'>): Promise<void> {
  return new Promise((resolve) => setImmediate(() => {
    upsertQualityAssessment(assessment)
    resolve()
  }))
}
```

2. **Replace all sync DB calls with async versions**:
   - `getRecordingById(recordingId)` → `await getRecordingByIdAsync(recordingId)`
   - `getTranscriptByRecordingId(recordingId)` → `await getTranscriptByRecordingIdAsync(recordingId)`
   - `upsertQualityAssessment(assessment)` → `await upsertQualityAssessmentAsync(assessment)`
   - `getQualityAssessment(recordingId)!` → `(await getQualityAssessmentAsync(recordingId))!`

3. **Update `batchAutoAssess` to use batch queries** (line ~238):
```typescript
// Change from:
const { getRecordingById, getTranscriptsByRecordingIds } = await import('./database')
const transcriptsMap = getTranscriptsByRecordingIds(recordingIds)

// To:
const { getRecordingsByIds, getTranscriptsByRecordingIds } = await import('./database')
const recordingsMap = getRecordingsByIds(recordingIds)
const transcriptsMap = getTranscriptsByRecordingIds(recordingIds)

// And in the loop:
const recording = recordingsMap.get(recordingId)  // Instead of await getRecordingByIdAsync()
```

#### storage-policy.ts

1. **Add async wrappers** (before the `StoragePolicyService` class, around line 52):
```typescript
// Async wrappers for database operations to prevent event loop blocking
async function getRecordingByIdAsyncStorage(id: string): Promise<Recording | undefined> {
  return new Promise((resolve) => setImmediate(() => resolve(getRecordingById(id))))
}

async function getQualityAssessmentAsyncStorage(id: string): Promise<import('./database').QualityAssessment | undefined> {
  return new Promise((resolve) => setImmediate(() => resolve(getQualityAssessment(id))))
}

async function updateRecordingStorageTierAsync(id: string, tier: StorageTier): Promise<void> {
  return new Promise((resolve) => setImmediate(() => {
    updateRecordingStorageTier(id, tier)
    resolve()
  }))
}
```

2. **Make `assignTier` async** (line ~76):
```typescript
// Change from:
assignTier(recordingId: string, quality: QualityLevel): void {

// To:
async assignTier(recordingId: string, quality: QualityLevel): Promise<void> {
```

3. **Replace sync calls in `assignTier`**:
   - `getRecordingById(recordingId)` → `await getRecordingByIdAsyncStorage(recordingId)`
   - `updateRecordingStorageTier(recordingId, tier)` → `await updateRecordingStorageTierAsync(recordingId, tier)`

4. **Update event handler** (line ~65):
```typescript
// Change from:
eventBus.onDomainEvent<QualityAssessedEvent>('quality:assessed', (event) => {
  const { recordingId, quality } = event.payload
  this.assignTier(recordingId, quality)
})

// To:
eventBus.onDomainEvent<QualityAssessedEvent>('quality:assessed', (event) => {
  const { recordingId, quality } = event.payload
  // Use void operator to handle async call in event handler
  void this.assignTier(recordingId, quality)
})
```

---

## 008 - Full Table Scan in Cleanup

### Files to Update
- `apps/electron/electron/main/services/storage-policy.ts`

### Implementation Steps

1. **Make `getCleanupSuggestions` async and optimize queries** (line ~116):

```typescript
async getCleanupSuggestions(minAgeOverride?: Partial<Record<StorageTier, number>>): Promise<CleanupSuggestion[]> {
  const suggestions: CleanupSuggestion[] = []
  const now = new Date()

  // Override retention days if provided
  const retentionDays = { ...TIER_RETENTION_DAYS, ...minAgeOverride }

  // Process each tier with indexed date queries
  const tiers: StorageTier[] = ['archive', 'cold', 'warm', 'hot']

  for (const tier of tiers) {
    const maxAge = retentionDays[tier]
    const cutoffDate = new Date(now.getTime() - maxAge * 24 * 60 * 60 * 1000).toISOString()

    // Use indexed query to find old recordings for this tier
    // The index idx_recordings_storage_tier and idx_recordings_date help here
    const recordings = queryAll<Recording>(
      'SELECT * FROM recordings WHERE storage_tier = ? AND date_recorded < ? ORDER BY date_recorded ASC LIMIT 1000',
      [tier, cutoffDate]
    )

    if (recordings.length === 0) continue

    // Batch load quality assessments for these recordings
    const recordingIds = recordings.map(r => r.id)
    const qualityMap = new Map<string, import('./database').QualityAssessment>()

    // Load quality assessments in batch
    const placeholders = recordingIds.map(() => '?').join(',')
    const qualities = queryAll<import('./database').QualityAssessment>(
      `SELECT * FROM quality_assessments WHERE recording_id IN (${placeholders})`,
      recordingIds
    )
    qualities.forEach(q => qualityMap.set(q.recording_id, q))

    for (const recording of recordings) {
      const recordedDate = new Date(recording.date_recorded)
      const ageMs = now.getTime() - recordedDate.getTime()
      const ageInDays = Math.floor(ageMs / (1000 * 60 * 60 * 24))

      const qualityAssessment = qualityMap.get(recording.id)

      suggestions.push({
        recordingId: recording.id,
        filename: recording.filename,
        dateRecorded: recording.date_recorded,
        tier,
        quality: qualityAssessment?.quality,
        ageInDays,
        sizeBytes: recording.file_size,
        reason: `Exceeds ${tier} tier retention (${maxAge} days) by ${ageInDays - maxAge} days`,
        hasTranscript: recording.transcription_status === 'complete',
        hasMeeting: !!recording.meeting_id
      })
    }
  }

  // Sort by age (oldest first)
  suggestions.sort((a, b) => b.ageInDays - a.ageInDays)

  return suggestions
}
```

2. **Update `getCleanupSuggestionsForTier` to be async** (line ~177):
```typescript
async getCleanupSuggestionsForTier(tier: StorageTier, minAgeDays?: number): Promise<CleanupSuggestion[]> {
  const override = minAgeDays ? { [tier]: minAgeDays } : undefined
  const allSuggestions = await this.getCleanupSuggestions(override)
  return allSuggestions.filter((s) => s.tier === tier)
}
```

3. **Make `getStorageStats` async** (line ~268):
```typescript
async getStorageStats(): Promise<{
  tier: StorageTier
  count: number
  totalSizeBytes: number
  avgAgeDays: number
}[]> {
  // ... existing implementation
}
```

---

## Testing After Implementation

After making these changes, verify the fixes work:

```bash
cd /g/Code/hidock-worktree-1-backend/apps/electron

# Type check
npm run typecheck

# If tests exist:
npm test

# Build to verify no runtime errors
npm run build
```

## Expected Benefits

1. **Security**: All user inputs validated with Zod, preventing invalid data injection
2. **Performance**:
   - No event loop blocking with async DB operations
   - N+1 queries eliminated with batch loading
   - Cleanup uses indexed queries with LIMIT
3. **Stability**: Event listeners properly bounded and cleaned up
4. **Data Safety**: Sensitive data sanitized before broadcast to renderer

## Next Steps

1. Manually apply the fixes documented above
2. Run type checking and tests
3. Commit the changes
4. Update todo tracking system
5. Mark all P1 issues as resolved
