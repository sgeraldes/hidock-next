# Task: Test word confidence filtering

**Phase**: 2
**Priority**: Medium
**Estimated Complexity**: Medium

## Context
Verify Chirp 3 word confidence scores are used to filter low-quality words. Design doc specifies <70% threshold.

## Current State
No test for confidence filtering.

## What's Missing/Needed
Unit test:
- Mock Chirp 3 results with varied confidence scores
- Verify words with <70% confidence filtered
- Verify words with ≥70% confidence retained
- Verify transcript quality improves

## Dependencies
- [ ] Task: Implement Chirp 3 streaming

## Acceptance Criteria
- [ ] Test provides mock words with confidence scores
- [ ] Test verifies low-confidence words (<70%) removed
- [ ] Test verifies high-confidence words (≥70%) kept
- [ ] Test verifies filtering logic is correct
- [ ] Test passes

## Files to Create/Modify
- `electron/main/services/__tests__/chirp3-confidence.test.ts` - NEW
- `electron/main/services/chirp3-provider.ts` - May need filtering logic

## Testing Requirements
Mock word-level data with confidence scores and verify filtering
