# TODO-003: Fix Memory Leaks in Device Reconnection and Transcription Listeners

**Priority**: CRITICAL - Showstopper #3
**Phase**: A
**Domain**: Download/Sync Pipeline + Transcription Queue
**Audit Reference**: COMPREHENSIVE_BUG_AUDIT_WAVE2.md - Download/Sync CRITICAL + Transcription CRITICAL

## Problem

Two critical memory leaks that cause crashes after repeated device connections or transcription operations:

1. **Device Reconnection**: Double-subscribes all listeners on every connection
2. **Transcription Queue**: Event listeners never unsubscribed

These leaks accumulate until the app crashes (out of memory or max listeners error).

## Current State

### Device Reconnection Memory Leak
From audit findings (Download/Sync CRITICAL):
- Device reconnection double-subscribes all listeners
- Each disconnect/reconnect cycle adds duplicate listeners
- Listeners are never cleaned up
- After 10 reconnections: 10x listeners firing on every event
- Result: Memory leak → crash

### Transcription Memory Leak
From audit findings (Transcription CRITICAL):
- Event listeners never unsubscribed
- Transcription queue listeners accumulate
- No cleanup in useEffect or component unmount
- Result: Memory leak → crash

## Root Cause

**Pattern 1: Missing useEffect cleanup**
```typescript
useEffect(() => {
  service.on('event', handler)
  // MISSING: return () => service.off('event', handler)
}, [])
```

**Pattern 2: Duplicate subscription**
```typescript
device.on('connected', () => {
  // Subscribe to events
  device.on('data', handler) // WRONG: adds new listener on every connect
})
```

**Pattern 3: Ref pattern doesn't prevent re-subscription**
```typescript
const processQueueRef = useRef(() => { /* ... */ })
useEffect(() => {
  emitter.on('event', processQueueRef.current) // Still re-subscribes!
}, [deps])
```

## What's Missing

1. **Proper cleanup functions in useEffect**
2. **Check-before-subscribe pattern**
3. **Listener registry to prevent duplicates**
4. **Abort controllers for async operations**

## Files Affected

From audit domains:
- `src/hooks/useDeviceSubscriptions.ts` (or similar)
- `src/hooks/useDownloadOrchestrator.ts`
- `src/store/features/useTranscriptionStore.ts`
- `electron/main/services/download-service.ts`
- `electron/main/services/transcription.ts`
- Any component/hook subscribing to device or transcription events

## Dependencies

- Understanding of React useEffect cleanup
- Node.js EventEmitter patterns
- Device connection lifecycle
- Transcription queue architecture

## Acceptance Criteria

### Device Reconnection Leak
- [ ] Device listeners are properly unsubscribed on disconnect
- [ ] Listeners are not duplicated on reconnect
- [ ] After 100 disconnect/reconnect cycles, listener count stays constant
- [ ] Memory usage does not grow with reconnection count
- [ ] Test: disconnect/reconnect 100 times, verify no leak

### Transcription Leak
- [ ] Transcription event listeners have cleanup functions
- [ ] Component unmount properly unsubscribes all listeners
- [ ] After 100 transcriptions, listener count stays constant
- [ ] Memory usage does not grow with transcription count
- [ ] Test: queue/process 100 transcriptions, verify no leak

### General
- [ ] All useEffect hooks with event listeners have return cleanup
- [ ] No duplicate subscriptions in service initialization
- [ ] AbortController pattern used where appropriate
- [ ] Memory profiling shows no leaks after stress testing
- [ ] All tests pass

## Testing

**Memory Leak Detection:**
```typescript
// Before fix:
for (let i = 0; i < 100; i++) {
  disconnect(); reconnect();
  console.log(device.listenerCount('data')); // Should stay constant, not grow
}

// After fix: listener count should be stable
```

**Heap Snapshot:**
- Take heap snapshot before test
- Run 100 disconnect/reconnect cycles
- Take heap snapshot after test
- Compare: retained size should not grow significantly

## Related Bugs

- Download/Sync CRITICAL: Device reconnection double-subscribes all listeners
- Transcription CRITICAL: Memory leak - event listeners never unsubscribed
- Transcription CRITICAL: Auto-transcribe queues without starting processor (related to listener issue)
