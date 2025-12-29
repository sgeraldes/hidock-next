# Backend P1 Architecture Review Findings

**Priority**: P2
**Category**: Architecture
**Component**: Backend Domain Services (Phase 0)
**Worktree**: `G:/Code/hidock-worktree-1-backend`

## Overview

Architectural analysis of Phase 0 Backend Domain Separation Services, focusing on service boundaries, event-driven patterns, and domain modeling.

---

## ARCH-001: Domain Event Bus Well Designed (✓ Excellent)

**File**: `apps/electron/electron/main/services/event-bus.ts`

### Analysis

The event bus implementation demonstrates solid architectural patterns:

**Strengths**:
1. ✓ **Clear separation**: Main process (EventEmitter) vs renderer process (IPC)
2. ✓ **Type-safe events**: Typed event interfaces (`QualityAssessedEvent`, etc.)
3. ✓ **Wildcard subscriptions**: Support for `*` listener pattern
4. ✓ **Cleanup functions**: Returns unsubscribe function from `onDomainEvent()`
5. ✓ **Singleton pattern**: Prevents multiple event bus instances
6. ✓ **Resource limits**: MAX_LISTENERS_PER_EVENT prevents memory leaks

**Event Types**:
```typescript
export type KnownDomainEvent =
  | QualityAssessedEvent
  | StorageTierAssignedEvent
  | RecordingCleanupSuggestedEvent
```

This is good Domain-Driven Design (DDD) - events represent "things that happened" in the domain.

### Minor Improvement: Event Versioning

For future-proofing, consider adding version field:

```typescript
export interface DomainEvent {
  type: string
  timestamp: string
  version: number  // Add this
  payload: any
}
```

This allows event schema evolution without breaking existing handlers.

**Priority**: P3

---

## ARCH-002: Service Dependency Injection Missing (⚠ Issue)

**Files**:
- `apps/electron/electron/main/services/quality-assessment.ts`
- `apps/electron/electron/main/services/storage-policy.ts`

### Issue

Services directly import database functions instead of using dependency injection:

```typescript
// quality-assessment.ts
import {
  getRecordingById,
  getTranscriptByRecordingId,
  getQualityAssessment,
  upsertQualityAssessment,
  // ...
} from './database'

export class QualityAssessmentService {
  async assessQuality(...) {
    const recording = getRecordingById(recordingId)  // Direct coupling
    // ...
  }
}
```

**Problems**:
1. **Hard to test**: Can't mock database in unit tests
2. **Tight coupling**: Service directly depends on database implementation
3. **Circular dependency risk**: database.ts could import services
4. **Hard to swap implementations**: Can't replace sql.js with PostgreSQL later

### Recommended Pattern

Use dependency injection:

```typescript
export interface IRecordingRepository {
  getById(id: string): Recording | undefined
  getByIds(ids: string[]): Map<string, Recording>
  save(recording: Recording): void
}

export interface IQualityAssessmentRepository {
  get(recordingId: string): QualityAssessment | undefined
  upsert(assessment: QualityAssessment): void
}

export class QualityAssessmentService {
  constructor(
    private recordingRepo: IRecordingRepository,
    private qualityRepo: IQualityAssessmentRepository,
    private eventBus: DomainEventBus
  ) {}

  async assessQuality(
    recordingId: string,
    quality: QualityLevel,
    reason?: string,
    assessedBy?: string
  ): Promise<QualityAssessment> {
    const recording = this.recordingRepo.getById(recordingId)
    if (!recording) {
      throw new Error(`Recording not found: ${recordingId}`)
    }

    const assessment = { /* ... */ }
    this.qualityRepo.upsert(assessment)
    this.eventBus.emitDomainEvent(/* ... */)

    return this.qualityRepo.get(recordingId)!
  }
}
```

**Benefits**:
- ✓ Easy to test with mocks
- ✓ Loose coupling
- ✓ Easy to swap database implementations
- ✓ Clear contracts via interfaces

**Implementation**:

```typescript
// database-repository.ts
export class SqlJsRecordingRepository implements IRecordingRepository {
  getById(id: string): Recording | undefined {
    return getRecordingById(id)
  }

  getByIds(ids: string[]): Map<string, Recording> {
    return getRecordingsByIds(ids)
  }

  save(recording: Recording): void {
    // ...
  }
}

// main.ts initialization
const recordingRepo = new SqlJsRecordingRepository()
const qualityRepo = new SqlJsQualityAssessmentRepository()
const eventBus = getEventBus()

const qualityService = new QualityAssessmentService(
  recordingRepo,
  qualityRepo,
  eventBus
)
```

**Priority**: P2 (important for testability and maintainability)

---

## ARCH-003: Missing Domain Model Layer (⚠ Issue)

**Files**: All service files

### Issue

Services operate directly on database DTOs instead of domain models:

```typescript
// Current: Services use database types directly
import { type Recording, type QualityAssessment } from './database'

async assessQuality(recordingId: string, ...): Promise<QualityAssessment> {
  // Returns database DTO, not domain model
}
```

**Problems**:
1. **No domain logic encapsulation**: Business rules scattered in services
2. **Anemic domain model**: Data structures without behavior
3. **Database coupling**: Domain logic tied to database schema

### Recommended Pattern

Introduce domain models with behavior:

```typescript
// domain/recording.ts
export class Recording {
  private constructor(
    private readonly id: string,
    private filename: string,
    private quality?: QualityLevel,
    private storageTier?: StorageTier,
    // ... other fields
  ) {}

  static create(data: RecordingData): Recording {
    // Validation logic
    if (!data.filename) {
      throw new Error('Filename required')
    }
    return new Recording(/* ... */)
  }

  static fromDatabase(dto: RecordingDTO): Recording {
    return new Recording(dto.id, dto.filename, /* ... */)
  }

  toDatabase(): RecordingDTO {
    return {
      id: this.id,
      filename: this.filename,
      // ...
    }
  }

  // Domain behavior
  assessQuality(quality: QualityLevel, reason: string): QualityAssessed {
    this.quality = quality

    // Return domain event
    return new QualityAssessed(this.id, quality, reason)
  }

  assignStorageTier(policy: StoragePolicy): StorageTierAssigned {
    const tier = policy.determineTier(this.quality!)
    this.storageTier = tier

    return new StorageTierAssigned(this.id, tier)
  }

  canBeDeleted(): boolean {
    return this.storageTier === 'archive' && this.ageInDays() > 30
  }

  private ageInDays(): number {
    // Calculate age
  }
}
```

**Benefits**:
- ✓ Business logic in domain model
- ✓ Single source of truth for rules
- ✓ Easier to test (no database needed)
- ✓ Clear separation of concerns

**Priority**: P2 (for long-term maintainability)

---

## ARCH-004: Event-Driven Reactive Pattern Well Implemented (✓ Good)

**File**: `apps/electron/electron/main/services/storage-policy.ts`
**Lines**: 61-71

### Analysis

The reactive event subscription pattern is well done:

```typescript
export class StoragePolicyService {
  constructor() {
    this.setupEventSubscriptions()
  }

  private setupEventSubscriptions(): void {
    const eventBus = getEventBus()

    // React to quality assessments
    eventBus.onDomainEvent<QualityAssessedEvent>('quality:assessed', (event) => {
      const { recordingId, quality } = event.payload
      this.assignTier(recordingId, quality)
    })
  }
}
```

**Strengths**:
✓ Decoupled: Quality assessment doesn't know about storage policy
✓ Reactive: Storage tier updates automatically
✓ Extensible: Easy to add new event handlers
✓ Testable: Can emit events to test reactions

**Potential Issue**: Memory leaks if service is destroyed without cleanup.

### Improvement

Store cleanup function and call in destructor:

```typescript
export class StoragePolicyService {
  private eventCleanupFunctions: Array<() => void> = []

  private setupEventSubscriptions(): void {
    const eventBus = getEventBus()

    const cleanup = eventBus.onDomainEvent<QualityAssessedEvent>(
      'quality:assessed',
      (event) => {
        const { recordingId, quality } = event.payload
        this.assignTier(recordingId, quality)
      }
    )

    this.eventCleanupFunctions.push(cleanup)
  }

  destroy(): void {
    // Unsubscribe from all events
    this.eventCleanupFunctions.forEach(cleanup => cleanup())
    this.eventCleanupFunctions = []
  }
}
```

**Priority**: P3 (app doesn't currently destroy services, but good practice)

---

## ARCH-005: Missing Service Interfaces (⚠ Issue)

**Files**: All service files

### Issue

No interfaces defined for services:

```typescript
export class QualityAssessmentService {
  // Implementation directly exported
}

export function getQualityAssessmentService(): QualityAssessmentService {
  // Returns concrete class
}
```

**Problems**:
1. Can't mock services in tests
2. Tight coupling between consumers and implementations
3. Hard to provide alternate implementations

### Recommended Pattern

Define interfaces:

```typescript
// quality-assessment-service.interface.ts
export interface IQualityAssessmentService {
  assessQuality(
    recordingId: string,
    quality: QualityLevel,
    reason?: string,
    assessedBy?: string
  ): Promise<QualityAssessment>

  autoAssess(recordingId: string): Promise<QualityAssessment>

  batchAutoAssess(recordingIds: string[]): Promise<QualityAssessment[]>

  getQuality(recordingId: string): QualityAssessment | undefined

  getByQuality(quality: QualityLevel): Recording[]
}

// quality-assessment-service.ts
export class QualityAssessmentService implements IQualityAssessmentService {
  // Implementation
}

// Factory returns interface
export function getQualityAssessmentService(): IQualityAssessmentService {
  // ...
}
```

**Benefits**:
- ✓ Easy to create mock implementations
- ✓ Consumers depend on abstractions, not concretions
- ✓ Can provide different implementations (e.g., caching, logging decorators)

**Priority**: P2

---

## ARCH-006: Singleton Pattern May Cause Testing Issues (⚠ Issue)

**Files**:
- `apps/electron/electron/main/services/event-bus.ts` (line 172-179)
- `apps/electron/electron/main/services/quality-assessment.ts` (line 313-320)
- `apps/electron/electron/main/services/storage-policy.ts` (line 347-354)

### Issue

All services use singleton pattern:

```typescript
let qualityAssessmentServiceInstance: QualityAssessmentService | null = null

export function getQualityAssessmentService(): QualityAssessmentService {
  if (!qualityAssessmentServiceInstance) {
    qualityAssessmentServiceInstance = new QualityAssessmentService()
  }
  return qualityAssessmentServiceInstance
}
```

**Problems**:
1. **Hard to test**: Singleton persists between tests, causing state leakage
2. **Hard to reset**: No way to clear singleton for fresh state
3. **Circular dependencies**: Singletons can create dependency cycles
4. **Implicit dependencies**: Hidden dependencies via `getInstance()` calls

### Better Pattern

Use a service container/factory:

```typescript
// service-container.ts
export class ServiceContainer {
  private services = new Map<string, any>()

  register<T>(name: string, factory: () => T): void {
    this.services.set(name, { factory, instance: null })
  }

  get<T>(name: string): T {
    const service = this.services.get(name)
    if (!service) {
      throw new Error(`Service not registered: ${name}`)
    }

    if (!service.instance) {
      service.instance = service.factory()
    }

    return service.instance
  }

  reset(): void {
    // Clear all instances for testing
    this.services.forEach(s => s.instance = null)
  }

  dispose(): void {
    // Cleanup all services
    this.services.forEach(s => {
      if (s.instance?.dispose) {
        s.instance.dispose()
      }
    })
    this.services.clear()
  }
}

// main.ts
const container = new ServiceContainer()

container.register('eventBus', () => new DomainEventBus())
container.register('qualityService', () =>
  new QualityAssessmentService(
    container.get('recordingRepo'),
    container.get('qualityRepo'),
    container.get('eventBus')
  )
)

// Usage
const qualityService = container.get<IQualityAssessmentService>('qualityService')
```

**Benefits**:
- ✓ Explicit dependencies
- ✓ Easy to reset for tests
- ✓ Central service lifecycle management
- ✓ Can provide different instances per context

**Priority**: P2

---

## ARCH-007: Missing Error Handling Strategy (⚠ Issue)

**Files**: All service files

### Issue

No consistent error handling:

```typescript
async assessQuality(...): Promise<QualityAssessment> {
  const recording = getRecordingById(recordingId)
  if (!recording) {
    throw new Error(`Recording not found: ${recordingId}`)  // Generic Error
  }
  // ...
}

async batchAutoAssess(recordingIds: string[]): Promise<QualityAssessment[]> {
  for (const recordingId of recordingIds) {
    try {
      // ...
    } catch (error) {
      console.error(`Failed to assess recording ${recordingId}:`, error)  // Silent failure
    }
  }
}
```

**Problems**:
1. Inconsistent error types (generic `Error` vs custom errors)
2. Silent failures in batch operations
3. No error propagation strategy
4. No error context (e.g., which operation, what data)

### Recommended Pattern

Define domain-specific errors:

```typescript
// errors/domain-errors.ts
export class DomainError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly context?: Record<string, any>
  ) {
    super(message)
    this.name = this.constructor.name
  }
}

export class RecordingNotFoundError extends DomainError {
  constructor(recordingId: string) {
    super(
      `Recording not found: ${recordingId}`,
      'RECORDING_NOT_FOUND',
      { recordingId }
    )
  }
}

export class QualityAssessmentError extends DomainError {
  constructor(message: string, recordingId: string, cause?: Error) {
    super(
      message,
      'QUALITY_ASSESSMENT_FAILED',
      { recordingId, cause }
    )
  }
}

// Service usage
async assessQuality(...): Promise<QualityAssessment> {
  const recording = getRecordingById(recordingId)
  if (!recording) {
    throw new RecordingNotFoundError(recordingId)
  }

  try {
    // ...
  } catch (error) {
    throw new QualityAssessmentError(
      'Failed to assess recording quality',
      recordingId,
      error instanceof Error ? error : undefined
    )
  }
}
```

**Benefits**:
- ✓ Type-safe error handling
- ✓ Rich error context
- ✓ Easy to add error tracking (Sentry, etc.)
- ✓ Consistent error structure

**Priority**: P2

---

## ARCH-008: Storage Policy Service Has Business Logic (✓ Good Design)

**File**: `apps/electron/electron/main/services/storage-policy.ts`

### Analysis

The storage policy mapping is well-designed:

```typescript
export const STORAGE_POLICIES: Record<QualityLevel, StorageTier> = {
  high: 'hot',
  medium: 'warm',
  low: 'cold'
}

export const TIER_RETENTION_DAYS: Record<StorageTier, number> = {
  hot: 365,
  warm: 180,
  cold: 90,
  archive: 30
}
```

**Strengths**:
✓ Declarative configuration
✓ Easy to modify policies
✓ Type-safe with Record types
✓ Exported constants can be used by UI

**Potential Enhancement**: Make policies configurable per user/organization:

```typescript
export interface StoragePolicyConfig {
  tierMapping: Record<QualityLevel, StorageTier>
  retentionDays: Record<StorageTier, number>
}

export class StoragePolicyService {
  constructor(private config: StoragePolicyConfig) {
    // ...
  }

  assignTier(recordingId: string, quality: QualityLevel): void {
    const tier = this.config.tierMapping[quality]  // Use configurable policy
    // ...
  }
}
```

**Priority**: P3 (nice-to-have for enterprise features)

---

## ARCH-009: Missing Aggregate Boundaries (⚠ Issue)

**Observation**: Services work with individual entities (Recording, QualityAssessment) rather than aggregates.

### Issue

In Domain-Driven Design, related entities should be grouped into aggregates with a single root:

```typescript
// Current: Separate entities
Recording
  ├─ QualityAssessment (separate service)
  └─ StorageTier (separate service)

// Recommended: Aggregate
RecordingAggregate (root)
  ├─ Recording (identity)
  ├─ QualityAssessment (value object)
  ├─ StorageTier (value object)
  └─ Transcript (entity)
```

### Recommended Pattern

```typescript
export class RecordingAggregate {
  private recording: Recording
  private quality?: QualityAssessment
  private transcript?: Transcript
  private events: DomainEvent[] = []

  constructor(recording: Recording) {
    this.recording = recording
  }

  assessQuality(quality: QualityLevel, reason: string): void {
    this.quality = { quality, reason, /* ... */ }

    // Record event (not emit yet)
    this.events.push(new QualityAssessedEvent(/* ... */))

    // Update storage tier based on quality
    this.updateStorageTier()
  }

  private updateStorageTier(): void {
    if (!this.quality) return

    const tier = STORAGE_POLICIES[this.quality.quality]
    this.recording.storageTier = tier

    this.events.push(new StorageTierAssignedEvent(/* ... */))
  }

  getUncommittedEvents(): DomainEvent[] {
    return [...this.events]
  }

  clearEvents(): void {
    this.events = []
  }
}

// Repository pattern
export interface IRecordingAggregateRepository {
  getById(id: string): RecordingAggregate
  save(aggregate: RecordingAggregate): void
}

// Service becomes simpler
export class QualityAssessmentService {
  async assessQuality(recordingId: string, quality: QualityLevel): Promise<void> {
    const aggregate = this.recordingRepo.getById(recordingId)

    aggregate.assessQuality(quality, reason)

    this.recordingRepo.save(aggregate)

    // Emit all domain events after successful save
    const events = aggregate.getUncommittedEvents()
    events.forEach(event => this.eventBus.emitDomainEvent(event))
    aggregate.clearEvents()
  }
}
```

**Benefits**:
- ✓ Transaction boundary enforcement
- ✓ Consistency within aggregate
- ✓ Events emitted after successful persistence
- ✓ Business rules encapsulated in aggregate

**Priority**: P3 (advanced DDD pattern, not critical for current scale)

---

## ARCH-010: Lack of Command/Query Separation (CQRS) (⚠ Observation)

**Files**: All service files

### Observation

Services mix commands (change state) and queries (read state):

```typescript
export class QualityAssessmentService {
  // Commands (write)
  async assessQuality(...): Promise<QualityAssessment>  // Returns data?
  async autoAssess(...): Promise<QualityAssessment>

  // Queries (read)
  getQuality(recordingId: string): QualityAssessment | undefined
  getByQuality(quality: QualityLevel): Recording[]
}
```

### Recommended Pattern (Optional)

For larger applications, consider CQRS:

```typescript
// Commands (write model)
export interface IQualityAssessmentCommands {
  assessQuality(cmd: AssessQualityCommand): Promise<void>
  autoAssess(cmd: AutoAssessCommand): Promise<void>
}

// Queries (read model)
export interface IQualityAssessmentQueries {
  getAssessment(recordingId: string): QualityAssessmentView | undefined
  getRecordingsByQuality(quality: QualityLevel): RecordingView[]
}

// Command handlers
export class AssessQualityCommandHandler {
  async handle(cmd: AssessQualityCommand): Promise<void> {
    // Update write model
    // Emit events
    // Don't return data
  }
}

// Query handlers
export class GetAssessmentQueryHandler {
  async handle(query: GetAssessmentQuery): Promise<QualityAssessmentView> {
    // Read from optimized read model (could be denormalized)
    return this.readModel.getAssessment(query.recordingId)
  }
}
```

**Benefits**:
- ✓ Optimized read/write models
- ✓ Scalability (separate read/write databases)
- ✓ Clear intent (command vs query)

**Priority**: P4 (overkill for current scale, mention for awareness)

---

## Summary Table

| ID | Issue | Priority | Impact | Complexity |
|----|-------|----------|--------|------------|
| ARCH-001 | Event bus well designed | ✓ | N/A | N/A |
| ARCH-002 | Missing dependency injection | P2 | High | Medium |
| ARCH-003 | Missing domain model layer | P2 | Medium | High |
| ARCH-004 | Event-driven pattern good | ✓ | N/A | N/A |
| ARCH-005 | Missing service interfaces | P2 | Medium | Low |
| ARCH-006 | Singleton testing issues | P2 | Medium | Medium |
| ARCH-007 | No error handling strategy | P2 | Medium | Low |
| ARCH-008 | Storage policy well designed | ✓ | N/A | N/A |
| ARCH-009 | Missing aggregate boundaries | P3 | Low | High |
| ARCH-010 | No CQRS separation | P4 | Low | High |

## Recommended Action Plan

### High Priority (P2) - Next Sprint
1. **ARCH-002**: Implement dependency injection for repositories
2. **ARCH-005**: Define service interfaces
3. **ARCH-006**: Replace singletons with service container
4. **ARCH-007**: Define domain error classes

### Medium Priority (P3) - Future
5. ARCH-001: Add event versioning
6. ARCH-004: Add service cleanup/destroy methods
7. ARCH-008: Make storage policies configurable

### Low Priority (P4) - Consider for Scale
8. ARCH-003: Introduce rich domain models (when business logic grows)
9. ARCH-009: Implement aggregate pattern (when transactions become complex)
10. ARCH-010: Consider CQRS (when read/write scalability needed)

## Architecture Strengths

The current architecture demonstrates several good patterns:
- ✓ Event-driven reactive programming
- ✓ Clear service boundaries
- ✓ Type-safe event system
- ✓ Declarative policy configuration

Main areas for improvement are:
- Dependency management (injection, interfaces)
- Domain modeling (rich models vs anemic DTOs)
- Error handling consistency
- Testability (singletons, mocks)

---

**Reviewed by**: Claude Opus 4.5
**Date**: 2025-12-26
**Worktree**: hidock-worktree-1-backend
**Commit**: b3c08200
