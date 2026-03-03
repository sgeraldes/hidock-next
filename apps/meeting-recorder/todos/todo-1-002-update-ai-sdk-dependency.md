# Task: Update @ai-sdk/google to latest version

**Phase**: 1
**Priority**: High
**Estimated Complexity**: Low

## Context
Need latest version of @ai-sdk/google to support Gemini 2.5/3.0 APIs. Design doc specifies updating to ^0.0.70 or later.

## Current State
`package.json` currently has `@ai-sdk/google: ^3.0.31`

## What's Missing/Needed
Update dependency version and run npm install.

## Dependencies
- No dependencies

## Acceptance Criteria
- [ ] package.json shows @ai-sdk/google at ^0.0.70 or later
- [ ] npm install completes successfully
- [ ] No breaking API changes affect existing code
- [ ] TypeScript compiles without errors

## Files to Create/Modify
- `package.json` - Update @ai-sdk/google version
- `package-lock.json` - Auto-updated by npm install

## Testing Requirements
Verify Gemini 2.5 API calls work without errors
