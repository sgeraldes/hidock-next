# Task: Implement confidence-based word filtering in Chirp3Provider

**Phase**: 3
**Priority**: High
**Estimated Complexity**: Medium

## Context
Filter low-confidence words from transcript based on threshold. Design doc specifies quality improvement.

## Current State
All Chirp 3 words included regardless of confidence.

## What's Missing/Needed
In handleData() callback:
- Read confidenceThreshold from settings
- Filter words where word.confidence < threshold
- Rebuild transcript without low-confidence words
- Log filtered word count

## Dependencies
- [ ] Task: Add confidence threshold UI
- [ ] Task: Implement Chirp 3 streaming

## Acceptance Criteria
- [ ] Reads confidenceThreshold setting
- [ ] Filters words with confidence < threshold
- [ ] Transcript excludes low-confidence words
- [ ] Logs number of words filtered
- [ ] No syntax errors from filtering
- [ ] Unit tests verify filtering logic

## Files to Create/Modify
- `electron/main/services/chirp3-provider.ts` - Add filtering in handleData
- `electron/main/services/__tests__/chirp3-filtering.test.ts` - NEW

## Testing Requirements
Test with various thresholds (50%, 70%, 90%) and verify filtering
