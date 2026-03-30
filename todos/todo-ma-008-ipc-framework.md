# Typed IPC framework with Zod validation
## Current State
Nothing exists. Pattern: apps/meeting-recorder/electron/preload/index.ts
## What to Create
- electron/main/ipc/channels.ts - channel definitions by domain
- electron/main/ipc/validation.ts - Zod schemas
- electron/main/ipc/create-handler.ts - handler wrapper with validation
- electron/main/ipc/handlers.ts - central registry
- Domain stubs: session, transcript, suggestion, notes, screenshot, settings handlers
- electron/preload/index.ts - full contextBridge
- src/types/electron-api.d.ts - renderer type declarations
## Dependencies
Task 5, Task 7
## Acceptance Criteria
- All 6 IPC domains have channels
- createHandler() validates with Zod
- contextIsolation: true, nodeIntegration: false
- window.electronAPI typed in renderer
