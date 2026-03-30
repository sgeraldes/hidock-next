# System tray with icon, context menu, state
## Current State
Nothing exists. Pattern: apps/meeting-recorder/electron/main/services/tray-manager.ts
## What to Create
- electron/main/services/tray-manager.ts - tray icon, context menu, tooltip state, click handler
## Dependencies
Task 5, Task 9
## Acceptance Criteria
- Tray icon appears on start
- Context menu: Start/Stop, Show/Hide mini bar, Open, Settings, Quit
- State updates change icon + tooltip
- Clean destroy on quit
