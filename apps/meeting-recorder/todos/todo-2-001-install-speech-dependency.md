# Task: Install @google-cloud/speech dependency

**Phase**: 2
**Priority**: High
**Estimated Complexity**: Low

## Context
Need Google Cloud Speech-to-Text SDK for Chirp 3 integration. Design doc section "Phase 2: Chirp 3 Integration".

## Current State
Dependency not installed.

## What's Missing/Needed
Add `@google-cloud/speech: ^6.8.0` to package.json and install.

## Dependencies
- No dependencies

## Acceptance Criteria
- [ ] package.json includes @google-cloud/speech at ^6.8.0 or later
- [ ] npm install completes successfully
- [ ] Module imports without errors: `import { SpeechClient } from '@google-cloud/speech'`
- [ ] TypeScript compiles without errors

## Files to Create/Modify
- `package.json` - Add @google-cloud/speech dependency
- `package-lock.json` - Auto-updated by npm

## Testing Requirements
Verify module can be imported and SpeechClient instantiated
