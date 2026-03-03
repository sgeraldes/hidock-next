# Task: Load test with long recording

**Phase**: 3
**Priority**: High
**Estimated Complexity**: Medium

## Context
Verify system handles 30+ minute recordings without memory leaks. Design doc specifies stability test.

## Current State
No long-duration tests.

## What's Missing/Needed
Create load test:
- Simulate 30-minute audio stream
- Monitor memory usage over time
- Verify no leaks or crashes
- Verify performance stays stable

## Dependencies
- [ ] All Phase 2 tasks completed

## Acceptance Criteria
- [ ] Test simulates 30+ minute recording
- [ ] Memory usage monitored (heap, RSS)
- [ ] No memory leaks detected
- [ ] No crashes or errors
- [ ] Performance remains stable
- [ ] CPU usage acceptable

## Files to Create/Modify
- `electron/main/__tests__/load-test-long-recording.test.ts` - NEW
- Load testing utilities

## Testing Requirements
Run 30-minute test, monitor memory, verify stable performance
