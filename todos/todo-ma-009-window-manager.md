# Window manager for main, mini bar, overlay
## Current State
Nothing exists. Pattern: apps/meeting-recorder
## What to Create
- electron/main/windows/main-window.ts - 1200x800, preload, context isolation
- electron/main/windows/mini-bar-window.ts - 400x60, alwaysOnTop, contentProtection
- electron/main/windows/overlay-window.ts - alwaysOnTop, contentProtection, transparency
- electron/main/windows/index.ts - barrel + lifecycle
## Dependencies
Task 5
## Acceptance Criteria
- All 3 windows create/destroy without crashes
- setContentProtection(true) on mini bar and overlay
- alwaysOnTop on floating windows
- Dev loads from URL, prod from file
