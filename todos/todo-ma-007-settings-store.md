# Settings store with configurable defaults
## Current State
Nothing exists.
## What to Create
- electron/main/services/settings-store.ts - typed get/set/getAll/getByCategory/resetToDefaults
- electron/main/services/settings-defaults.ts - ALL defaults from spec: screenshots.* (6), calendar.* (4), mic.* (4), correlation.* (3), notes.* (4), logging.*
## Dependencies
Task 6
## Acceptance Criteria
- Every spec setting has a registered default
- get() returns default when no DB value
- set() validates type
- getByCategory() groups for UI
