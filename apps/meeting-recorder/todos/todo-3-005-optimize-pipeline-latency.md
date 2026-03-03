# Task: Optimize pipeline latency

**Phase**: 3
**Priority**: High
**Estimated Complexity**: High

## Context
Reduce end-to-end latency to <500ms target. Design doc specifies latency optimization as key goal.

## Current State
Current latency unknown, likely >3 seconds due to chunking.

## What's Missing/Needed
Profile and optimize:
- Audio arrival → Chirp 3 send latency
- Chirp 3 result → Gemini analysis latency
- Gemini result → UI broadcast latency
- Identify and eliminate bottlenecks

## Dependencies
- [ ] Task: Replace chunking with streaming
- [ ] Task: Implement interim results

## Acceptance Criteria
- [ ] Latency profiled with timestamps
- [ ] Bottlenecks identified
- [ ] Optimizations implemented
- [ ] End-to-end latency < 500ms
- [ ] Performance logs show timing breakdown
- [ ] No regression in accuracy

## Files to Create/Modify
- `electron/main/services/transcription-pipeline.ts` - Add timing logs
- `electron/main/services/chirp3-provider.ts` - Optimize callbacks
- Performance profiling test file

## Testing Requirements
Measure latency with high-precision timestamps, verify <500ms
