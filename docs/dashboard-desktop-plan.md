# HiDock Dashboard Desktop Plan

Date: 2026-06-18

## Milestone 0 Decision

Create a new app at `apps/dashboard-desktop`.

Do not reuse `apps/electron` as the implementation base for this dashboard MVP. Treat it as a reference library for selected ideas and tests only.

## Why New App

The desired product is a local-first Mac dashboard for HiDock recordings and task review. The existing `apps/electron` app is a much broader "Universal Knowledge Hub" with navigation, data model, and integrations that do not match the dashboard-first scope.

Evidence from the audit:

- `apps/electron/package.json` names the app `hidock-universal-knowledge-hub` and describes a universal knowledge hub for recordings, documents, notes, emails, calendar data, and AI analysis.
- `apps/electron/src/App.tsx` redirects `/` to `/library`, not to a task dashboard.
- `apps/electron/src/components/layout/Layout.tsx` is organized around Library, Assistant, Explore, People, Projects, Calendar, Actionables, and Sync, not the requested Inbox/Mine/Watching/Done/Disregarded dashboard workflow.
- `apps/electron/electron/preload/index.ts` exposes broad renderer APIs, including `jensen:deleteFile`, `jensen:formatCard`, `storage:delete-recording`, calendar sync, migrations, RAG, integrity repair, storage cleanup, projects, contacts, outputs, and assistant functions.
- `apps/electron/electron/main/ipc/jensen-handlers.ts` registers destructive device handlers for `jensen:deleteFile` and `jensen:formatCard`.
- `apps/electron/electron/main/services/jensen.ts` implements many Jensen commands beyond the MVP, including delete, format, settings writes, realtime control, firmware/tone/UAC update handlers, Bluetooth commands, factory reset handlers, and meeting schedule commands.
- `apps/electron/electron/main/services/config.ts` defaults `device.autoDownload` to `true`, which conflicts with the Milestone 5 constraint that downloads must not happen by default unless the user enables them.
- `apps/electron/electron/main/services/database.ts` uses `sql.js`; Milestone 1 asks to add a SQLite dependency for the new app shell, and Milestone 2 needs a smaller schema centered on recordings, transcripts, summaries, tasks, task_events, sync_runs, and settings.
- The Electron USB product ID list in `apps/electron/electron/main/services/jensen.ts` omits the newer H1 PID `0xB00C`, while `apps/desktop/src/constants.py` includes it and maps it to `hidock-h1`.

The current Electron app does contain useful reference code, but reusing it directly would require subtracting a large amount of unrelated and risky behavior before the dashboard MVP could be made safe.

## Reference Code To Reuse Carefully

Use these as source references, not as drop-in app architecture:

- `apps/desktop/src/constants.py`
  - USB vendor IDs: `0x10D6`, `0x3887`.
  - H1 PID to include: `0xB00C`.
  - Interface and endpoint assumptions: interface `0`, OUT `0x01`, IN `0x82`.
  - Jensen command IDs, including read-only commands and destructive commands to exclude initially.
- `apps/desktop/src/hidock_device.py`
  - Jensen framing: `0x12 0x34`, big-endian command ID, sequence, body length, body.
  - Device info command parsing.
  - File count and file list parsing, including multi-packet file list accumulation and filename timestamp parsing.
  - Read-only streaming download mechanics for selected files.
  - HDA/WAV duration clues.
- `apps/desktop/src/desktop_device_adapter.py`
  - Device discovery across all known VID/PID pairs.
  - Retry/error behavior and storage metadata interpretation.
  - Do not port `delete_recording` or `format_storage` into the initial bridge.
- `apps/electron/electron/main/services/jensen.ts`
  - TypeScript/node-usb Jensen port, command queue, continuous read loop, parser, and tests as reference.
  - Do not expose destructive command handlers in the dashboard app.
- `apps/electron/electron/main/ipc/jensen-handlers.ts`
  - IPC validation pattern and progress event shape as reference.
  - Do not copy broad renderer access or destructive channels.
- `/Users/mh/Documents/HiNotes/hinotes_automation/dashboard`
  - Dashboard lane UX, filtering, due-soon strip, bulk actions, detail dialog, and local-write/read-only-remote posture.
  - Do not depend on private HiNotes APIs or the Python HTTP server.

## HiNotes Dashboard Findings

The HiNotes dashboard is a useful UX reference, not a production dependency.

It provides:

- A compact local dashboard shell with due filters, assignee filter, search, bulk lane actions, and task detail dialog.
- Lanes for `mine`, `watching`, `disregarded`, and `done`.
- Local task mutation via `/api/tasks/:id` and `/api/tasks/bulk`.
- A read-only remote posture for HiNotes pull/write-back.

Gaps for the HiDock desktop MVP:

- It has no `inbox` lane, which the requested dashboard needs.
- It is a Python `ThreadingHTTPServer` app with static JS/CSS, not Electron/React.
- It imports private HiNotes modules such as `hinotes_cloud` and repository helpers, which must not become core app dependencies.

## Proposed Architecture

Build `apps/dashboard-desktop` as a narrow Electron + TypeScript + React/Vite app.

Main process responsibilities:

- USB discovery and Jensen protocol bridge.
- Local filesystem access for selected downloads only.
- Background sync orchestration.
- SQLite database and migrations.
- Settings store.
- Logging and notifications.

Renderer responsibilities:

- Dashboard-first UI.
- Task review lanes: Inbox, Mine, Watching, Done, Disregarded.
- Recording list and detail panel.
- Search, filters, and bulk lane actions.
- Settings, including arbitrary OpenRouter model IDs and `google/gemini-3.1-flash-lite`.
- Transcript/audio views.

IPC boundary:

- Renderer never talks to USB or filesystem directly.
- Initial USB IPC must expose only safe read/list/download-selected operations:
  - discover/detect device
  - connect/disconnect
  - get device info
  - list recordings
  - read/download selected recording after user action
  - sync metadata
- Do not implement or expose delete, format, factory reset, firmware upload, tone/UAC update, settings writes, or calendar/reminder writes in the MVP bridge.

## Risks

- The current Electron app already solved some hard USB transport problems, so starting fresh must still reuse its Jensen lessons and tests to avoid re-learning protocol edge cases.
- `node-usb` behavior on macOS Apple Silicon must be validated early with a real HiDock H1, especially interface claiming and device attach/detach.
- Existing TypeScript Jensen code may contain useful fixes but also includes destructive and non-MVP command surfaces; copying it wholesale would violate the read-only bridge requirement.
- The desired H1 PID `0xB00C` is present in the Python constants but not in the current Electron TypeScript constants, so Milestone 4 must explicitly include it.
- `sql.js` in `apps/electron` is not the desired baseline if the new app needs native SQLite semantics; choose the SQLite dependency deliberately in Milestone 1.
- HiNotes dashboard private API usage is reference-only; depending on it would violate the core-app constraint.
- Auto-download defaults need careful treatment. The audited Electron config defaults auto-download to enabled, but the dashboard MVP must not download by default.

## Recommended Milestone 1 Plan

After user approval of this decision:

1. Scaffold `apps/dashboard-desktop` with Electron + React + TypeScript + Vite.
2. Make the first screen the dashboard, not a landing page.
3. Add only minimal routes/views needed for Milestone 1:
   - Dashboard
   - Recordings
   - Settings
   - Logs/status
4. Add a SQLite dependency and a thin migration runner placeholder.
5. Add a settings store with safe defaults:
   - no auto-download
   - no destructive device commands
   - no reminder/calendar writes
   - OpenRouter model ID string support
6. Add structured logging in the main process and a small renderer log/status view.
7. Add IPC scaffolding with a restricted allowlist, but no USB implementation yet beyond typed stubs if needed for the shell.
8. Validate:
   - `npm install` works for the new app.
   - build/typecheck works.
   - app launches on macOS Apple Silicon.
   - no Python runtime is required.

## Stop Condition

Milestone 0 is complete once this document is written. Do not scaffold or modify app code until the `apps/dashboard-desktop` decision is accepted.
