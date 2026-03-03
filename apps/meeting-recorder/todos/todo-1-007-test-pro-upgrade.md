# Task: Test 3.0 Pro upgrade path

**Phase**: 1
**Priority**: Medium
**Estimated Complexity**: Low

## Context
Verify users can switch to Gemini 3.0 Pro without errors. Design doc specifies this as upgrade path.

## Current State
No tests for model switching.

## What's Missing/Needed
Create integration test that switches to 3.0 Pro and verifies it works.

## Dependencies
- [ ] Task: Add Gemini 3.0 Pro as model option
- [ ] Task: Update settings store

## Acceptance Criteria
- [ ] Test switches geminiModel setting to "3.0-pro"
- [ ] Test verifies model can be created without errors
- [ ] Test verifies transcription completes successfully
- [ ] Test verifies no format changes between 2.5 and 3.0
- [ ] Test passes

## Files to Create/Modify
- `electron/main/services/__tests__/ai-provider-model-switch.test.ts` - NEW
- Integration test file for end-to-end model switching

## Testing Requirements
Run test with both 2.5 Flash and 3.0 Pro to verify compatibility
