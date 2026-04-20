# Phase 7: Integration — Functional Specification

## Objective

Wire all packages and services into a working end-to-end application where a user can start a recording session, capture audio, see live transcription, get AI suggestions, take screenshots, generate notes, and manage their session history — all without crashes, data corruption, or UI inconsistencies.

## Scope

This phase connects the existing building blocks (Phases 1-6) into a coherent user experience. No new features — only integration, bug fixing, and polish.

---

## Acceptance Criteria

Each criterion is a **user action → expected result** pair. The phase is NOT complete until ALL criteria pass in the running app with screenshot or log evidence.

### AC-1: Session Lifecycle (Happy Path)

| Step | Action | Expected Result |
|------|--------|-----------------|
| 1 | Open app | Dashboard shows "Ready to Record", stats reflect actual session count |
| 2 | Click "Start Recording" | Dashboard switches to LIVE view with timer counting up |
| 3 | Wait 10 seconds | Timer shows ~00:00:10, LIVE indicator visible |
| 4 | Click "End Session" | Dashboard returns to "Ready to Record" |
| 5 | Check "Recent Sessions" | ONE new session appears (not duplicated), status shows "Completed", duration ~10s |
| 6 | Navigate to Sessions page | Same session visible with correct date, time, and duration |
| 7 | Start another session, end it | Stats card updates: count = previous + 1, total time increases |

### AC-2: Audio Capture

| Step | Action | Expected Result |
|------|--------|-----------------|
| 1 | Click "Start Recording" | Browser requests microphone permission (dialog appears) |
| 2 | Grant mic permission | No errors in console, recording continues |
| 3 | Speak for 15+ seconds | Main process logs show audio chunks received (every ~5s) |
| 4 | End session | AudioTranscriptionBridge flushes final chunks |

### AC-3: Session Edge Cases

| Step | Action | Expected Result |
|------|--------|-----------------|
| 1 | Start recording, navigate to Sessions page | Recording continues (timer still visible in sidebar), session shows as "Recording" |
| 2 | Navigate to Settings, then back to Dashboard | LIVE view still active, timer still counting |
| 3 | End session from any page | Session properly ends, UI updates everywhere |
| 4 | Try to delete an active (recording) session | App prevents deletion OR cleanly stops recording first — must NOT leave orphaned state |
| 5 | Start session, close app (X button) | Session marked as "interrupted" on next launch, not stuck as "recording" forever |
| 6 | Reopen app after interrupted session | Dashboard shows "Ready to Record", interrupted session visible in history |

### AC-4: Dashboard Stats Accuracy

| Step | Action | Expected Result |
|------|--------|-----------------|
| 1 | Fresh app (no sessions) | Stats show "0 SESSIONS", "0m TOTAL TIME" |
| 2 | Create and complete 1 session (30s) | Stats show "1 SESSION", "~0m TOTAL TIME" (or "1m" rounded) |
| 3 | Create and complete 2nd session (60s) | Stats show "2 SESSIONS", total time increases |
| 4 | Recent sessions list | Each session appears ONCE, no duplicates, correct status |

### AC-5: Settings Cascade

| Step | Action | Expected Result |
|------|--------|-----------------|
| 1 | Open Settings > AI Provider | Current provider shown (default: ollama) |
| 2 | Change provider to "google" | Main process console shows "[Settings] Updated setting: ai.provider = google" |
| 3 | Change model | Main process console shows reconfiguration log |
| 4 | Change calendar/mic settings | MeetingDetector recreated (log visible in main process) |
| 5 | Reopen app | Settings persist — previously set values still shown |

### AC-6: Notes Page

| Step | Action | Expected Result |
|------|--------|-----------------|
| 1 | Navigate to Notes | Page renders without crash (no RangeError) |
| 2 | With sessions that have no notes | Empty state shown cleanly |
| 3 | All dates display correctly | No "Invalid Date" text anywhere |

### AC-7: All Pages Navigate Without Crash

| Step | Action | Expected Result |
|------|--------|-----------------|
| 1 | Click Dashboard | Page renders, no console errors |
| 2 | Click Sessions | Page renders with session list, no console errors |
| 3 | Click Notes | Page renders, no crash, no RangeError |
| 4 | Click Knowledge Base | Page renders, no console errors |
| 5 | Click Settings | Page renders with all categories, no console errors |
| 6 | Rapid navigation (click through all pages quickly) | No crashes, no blank pages |

### AC-8: Mini-Bar

| Step | Action | Expected Result |
|------|--------|-----------------|
| 1 | Start recording | Mini-bar window appears (floating, always-on-top) |
| 2 | Mini-bar content | Shows: session timer, stop/end button, mic indicator |
| 3 | Click stop/end on mini-bar | Recording stops, mini-bar hides |
| 4 | End session from Dashboard | Mini-bar also hides |

### AC-9: System Tray

| Step | Action | Expected Result |
|------|--------|-----------------|
| 1 | App running, no recording | Tray icon shows idle state |
| 2 | Start recording | Tray context menu shows "Stop Recording" option |
| 3 | Click "Stop Recording" in tray | Recording stops cleanly |
| 4 | Tray shows updated state | Returns to idle |

### AC-10: No Duplicate React Keys

| Step | Action | Expected Result |
|------|--------|-----------------|
| 1 | Create 3 sessions, end them all | Dashboard shows 3 sessions in "Recent Sessions" |
| 2 | Check browser console | ZERO "Encountered two children with the same key" warnings |

### AC-11: No Console Errors on Any Page

| Step | Action | Expected Result |
|------|--------|-----------------|
| 1 | Navigate all 5 pages | Zero uncaught errors in browser console |
| 2 | Start and stop a session | Zero uncaught errors in browser console |
| 3 | Change settings | Zero uncaught errors in browser console |

---

## Known Bugs to Fix (from manual testing 2026-03-31)

These bugs were found during manual testing and MUST be fixed as part of this phase:

1. **BUG-MA-01: Duplicate sessions** — Creating a session adds it twice to the store (IPC response + broadcast listener race)
2. **BUG-MA-02: "Session Invalid Date"** — Some sessions display "Invalid Date" in title
3. **BUG-MA-03: Stats show wrong count** — "0 SESSIONS" displayed when sessions exist
4. **BUG-MA-04: No mic permission requested** — useAudioCapture hook not triggering MediaRecorder
5. **BUG-MA-05: Notes page crash** — RangeError: Invalid time value at Notes.tsx:291
6. **BUG-MA-06: Settings cascade silent** — Changing AI provider produces no visible feedback
7. **BUG-MA-07: Can delete active session** — Deleting recording session leaves orphaned state, mini-bar stuck
8. **BUG-MA-08: Mini-bar has no controls** — Mini-bar shows but has no stop button or useful content
9. **BUG-MA-09: Menu breaks recording** — Clicking sidebar during recording causes issues

---

## Out of Scope

- Actual transcription accuracy (requires API keys)
- AI suggestion quality
- Calendar integration (requires calendar source)
- Distribution/packaging

---

## Verification Method

All acceptance criteria MUST be verified by:
1. Running the app (`electron-vite dev`)
2. Performing each action IN THE APP
3. Taking screenshots or capturing console output as evidence
4. Comparing actual result to expected result

**Code reading is NOT verification. Unit tests are NOT verification. Only exercising the running app counts.**
