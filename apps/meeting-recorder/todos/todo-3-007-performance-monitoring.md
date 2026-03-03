# Task: Performance monitoring and logging

**Phase**: 3
**Priority**: Medium
**Estimated Complexity**: Low

## Context
Add QA logs for performance debugging. Design doc specifies logging for optimization.

## Current State
Limited performance logging.

## What's Missing/Needed
Add QA logs for:
- Audio chunk arrival timestamps
- Chirp 3 streaming latency
- Gemini analysis time
- Result broadcast latency
- Total end-to-end timing

## Dependencies
- [ ] All Phase 2-3 tasks near completion

## Acceptance Criteria
- [ ] QA logs respect qaLogsEnabled toggle
- [ ] Logs show timestamps for each stage
- [ ] Logs calculate latency deltas
- [ ] Logs include chunk/segment IDs
- [ ] No performance impact from logging
- [ ] Logs help identify bottlenecks

## Files to Create/Modify
- `electron/main/services/transcription-pipeline.ts` - Add timing logs
- `electron/main/services/chirp3-provider.ts` - Add timing logs
- `src/hooks/useAudioCapture.ts` - Add timing logs

## Testing Requirements
Verify QA logs appear when enabled, measure timing accuracy
