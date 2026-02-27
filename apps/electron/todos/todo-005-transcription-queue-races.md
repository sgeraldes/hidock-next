# TODO-005: Fix Transcription Queue Race Conditions

**Priority**: CRITICAL - Showstopper #5
**Phase**: A
**Domain**: Transcription Queue System
**Audit Reference**: COMPREHENSIVE_BUG_AUDIT_WAVE2.md - Transcription CRITICAL

## Problem

The transcription queue processor can run multiple times concurrently, causing data corruption and race conditions. Additionally, auto-transcribe queues items but never starts the processor (silent failure).

## Current State

From audit findings:
- **Race condition**: Queue processor can run multiple times concurrently
- **Data corruption**: Multiple processors modify queue state simultaneously
- **Silent failure**: Auto-transcribe queues items but processor never starts
- No mutex/lock to prevent concurrent execution
- Items can be processed twice
- Queue state becomes inconsistent

## Root Cause

**Pattern 1: No concurrency guard**
```typescript
async function processQueue() {
  // WRONG: no check if already running
  for (const item of queue) {
    await transcribe(item)
  }
}

// Called from multiple places
onDeviceSync(() => processQueue()) // Trigger 1
onManualClick(() => processQueue()) // Trigger 2
// Both run simultaneously!
```

**Pattern 2: Auto-transcribe doesn't start processor**
```typescript
function autoTranscribe(recording) {
  queue.add(recording) // WRONG: added but never processed
  // MISSING: startProcessor()
}
```

**Pattern 3: Async state updates without locking**
```typescript
async function processNext() {
  const item = queue[0]
  await transcribe(item) // WRONG: queue modified during await
  queue.shift()
}
```

## What's Missing

1. **Mutex/lock** to prevent concurrent processor execution
2. **isProcessing flag** checked before starting
3. **Auto-start processor** when items are auto-queued
4. **Atomic queue operations** (dequeue, mark in-progress, complete)
5. **Process ID tracking** to detect concurrent runs

## Files Affected

From audit domain:
- `src/store/features/useTranscriptionStore.ts` - Queue state management
- `electron/main/services/transcription.ts` - Queue processor logic
- `electron/main/ipc/recording-handlers.ts` - IPC handlers for queue operations
- Any code that calls `addToQueue()` or `processQueue()`

## Dependencies

- Understanding of async mutex patterns in TypeScript/Node.js
- Transcription service architecture
- Queue state management in Zustand store
- IPC patterns for queue operations

## Acceptance Criteria

### Race Condition Fix
- [ ] Queue processor cannot run concurrently (only 1 instance at a time)
- [ ] Mutex/lock pattern prevents duplicate execution
- [ ] `isProcessing` flag accurately reflects processor state
- [ ] Process ID tracked to detect violations
- [ ] Test: call `processQueue()` 100 times simultaneously, verify only 1 runs

### Auto-Transcribe Fix
- [ ] Adding items to queue automatically starts processor (if not running)
- [ ] Manual queue additions also start processor
- [ ] Processor continues until queue is empty
- [ ] No silent failures (items queued but never processed)
- [ ] Test: auto-add 10 items, verify all are processed

### Data Integrity
- [ ] Queue items marked "in-progress" before processing
- [ ] Failed items don't block queue
- [ ] Concurrent additions don't corrupt queue state
- [ ] Database queue table stays consistent with in-memory queue
- [ ] Test: stress test with 1000 rapid additions

### General
- [ ] All race conditions eliminated
- [ ] Queue state is always consistent
- [ ] Error handling doesn't break mutex/lock
- [ ] All tests pass

## Implementation Approach

**Mutex Pattern (Recommended):**
```typescript
class TranscriptionQueue {
  private isProcessing = false

  async processQueue() {
    if (this.isProcessing) {
      console.log('Processor already running, skipping')
      return
    }

    this.isProcessing = true
    try {
      while (this.queue.length > 0) {
        const item = this.queue.shift()
        await this.transcribe(item)
      }
    } finally {
      this.isProcessing = false
    }
  }

  addToQueue(item) {
    this.queue.push(item)
    this.processQueue() // Auto-start processor
  }
}
```

**Alternative: Async Mutex Library**
```typescript
import { Mutex } from 'async-mutex'

const processorMutex = new Mutex()

async function processQueue() {
  const release = await processorMutex.acquire()
  try {
    // Process queue
  } finally {
    release()
  }
}
```

## Testing

**Race Condition Test:**
```typescript
test('processor cannot run concurrently', async () => {
  const queue = new TranscriptionQueue()
  queue.addToQueue(item1)
  queue.addToQueue(item2)

  // Start processor 100 times simultaneously
  const promises = Array(100).fill(null).map(() => queue.processQueue())
  await Promise.all(promises)

  // Verify: items processed exactly once each
  expect(processCount(item1)).toBe(1)
  expect(processCount(item2)).toBe(1)
})
```

**Auto-Start Test:**
```typescript
test('adding items auto-starts processor', async () => {
  const queue = new TranscriptionQueue()
  const spy = jest.spyOn(queue, 'processQueue')

  queue.addToQueue(item)

  expect(spy).toHaveBeenCalled()
  await wait(1000)
  expect(queue.length).toBe(0) // Item processed
})
```

## Related Bugs

- Transcription CRITICAL: Race condition - queue processor can run multiple times concurrently
- Transcription CRITICAL: Silent failure - auto-transcribe queues without starting processor
- Transcription CRITICAL: Memory leak - event listeners never unsubscribed (see TODO-003)
