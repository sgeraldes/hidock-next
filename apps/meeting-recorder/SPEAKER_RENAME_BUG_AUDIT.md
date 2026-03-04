# Speaker Rename Bug Audit

**Date:** 2026-03-04
**Scope:** Speaker rename + session switching pipeline — full stack (UI → state → IPC → database)
**Agents:** 3 audit agents + 1 jury agent (100% accuracy verified)

## Executive Summary

- **18 bugs found** (3 CRITICAL, 6 HIGH, 5 MEDIUM, 4 LOW)
- **Root cause of reported duplication:** Two compounding bugs (SR-001 + SR-002) — historical reload appends instead of replacing, AND dedup key includes the mutable speaker name
- **Secondary root cause:** SR-003 — store is never updated after rename, so stale data persists until session switch triggers the duplication

---

## Findings

### CRITICAL

#### SR-001 — `loadHistoricalData` appends instead of replaces
**File:Line:** `src/hooks/useTranscriptionStream.ts:42`
**What's Wrong:** `loadHistoricalData()` calls `addSegments(sessionId, mapped)` — an accumulate operation. There is no `clearSession` or equivalent before loading. On every return visit to a session, segments are appended to whatever is already in the store.
**Expected:** Historical loads should replace existing segments for the session, not append to them.
**Root Cause:** No `setSegments` (replace) action exists in the store; the only option was `addSegments`.

#### SR-002 — Deduplication key encodes mutable speaker name
**File:Line:** `src/store/useTranscriptStore.ts:75-76`
**What's Wrong:** `addSegments` deduplicates by `` `${s.speaker}:${s.text}` ``. After a rename, the store holds `"Speaker 1:Hello"`. The DB now returns `"Sebastian:Hello"`. These are different keys → both accumulate. This is the direct duplication mechanism.
**Expected:** Dedup key should use a stable immutable identifier (e.g., `startMs` which is unique per segment in a recording).
**Root Cause:** Dedup key includes mutable data.

#### SR-003 — `handleRenameSpeaker` fetches updated transcript and discards it
**File:Line:** `src/pages/Dashboard.tsx:81-96`
**What's Wrong:** After calling `renameSpeaker` IPC, the function fetches `getTranscript` into a variable `transcript` (line 90) but never uses it. The comment says "store will be updated via `useTranscriptionStream`" — but that hook's `useEffect` only fires on `sessionId` change, not on renames. The store retains stale speaker names until the user navigates away and back.
**Expected:** The fetched transcript should immediately replace the session's segments in the store.
**Root Cause:** Dead assignment — result fetched but discarded.

---

### HIGH

#### SR-004 — Live segment events have no `sessionId` filter
**File:Line:** `src/hooks/useTranscriptionStream.ts:66-96`
**What's Wrong:** `handleSegments` writes incoming live segments to `sessionId` (closed over at mount) with no guard. `handleTopics` and `handleActions` both check `data.sessionId === sessionId`. The `transcription:newSegments` event has no `sessionId` in its payload, so during rapid session switching, live segments from one session can land in another session's store entry.
**Expected:** Live segment events should carry a `sessionId` in the payload; the handler should filter on it.
**Root Cause:** Event payload design omits session identity.

#### SR-005 — `speakerRenames` local state lost on session switch
**File:Line:** `src/components/TranscriptPanel.tsx:63, 66-69`
**What's Wrong:** `speakerRenames` is a local `useState` that overlays the display name. It is unconditionally cleared when `sessionId` changes. Since the store is never updated after rename (SR-003), returning to a session shows original names — not the renamed ones — making the rename appear lost.
**Expected:** Either the store should be updated after rename (fixing SR-003), or the rename overlay should be persisted per session.
**Root Cause:** Transient local state used as the sole source of post-rename display truth.

#### SR-006 — Second rename uses stale `oldName`, IPC matches 0 rows
**File:Line:** `src/components/TranscriptPanel.tsx:308-314`
**What's Wrong:** The rename input's `onBlur`/`onKeyDown` pass `segment.speaker` (the raw store value, e.g., `"Speaker 1"`) as `oldName`. If the user renames "Speaker 1" → "Alice" (DB now has "Alice"), then clicks "Alice" to rename it again to "Bob" — the IPC call sends `renameSpeaker(sessionId, "Speaker 1", "Bob")`. But the DB `WHERE speaker_name = "Speaker 1"` matches 0 rows because the DB already has "Alice". The rename silently does nothing.
**Expected:** `oldName` should be the current effective name at time of rename, not the original store value.
**Root Cause:** `segment.speaker` is the raw store value which is never updated after rename (SR-003).

#### SR-007 — Speaker color changes after rename round-trip
**File:Line:** `src/components/TranscriptPanel.tsx:74, 321`
**What's Wrong:** `getSpeakerColor` uses `segment.speaker` (raw store value) and a `speakers` array derived from all segment speaker values. After rename, the DB returns "Sebastian" where it previously returned "Speaker 1". The position of "Sebastian" in the sorted speakers array differs from "Speaker 1", causing the color to change for the same person.
**Expected:** Color assignment should be stable across renames.
**Root Cause:** Color keyed on mutable speaker name, not a stable speaker identity.

#### SR-008 — `renameSpeakerInSession` count query returns wrong value
**File:Line:** `electron/main/services/database-queries.ts:341-347`
**What's Wrong:** After the `UPDATE`, the function counts `WHERE speaker_name = ? [newName]` — this returns ALL segments now bearing the new name (including ones that had it before the rename). It does not return the delta of changed rows.
**Expected:** Count should reflect the number of rows changed by the UPDATE (e.g., count `oldName` rows before UPDATE, or use a pre-UPDATE count delta).
**Root Cause:** Workaround for sql.js not returning `changes` was implemented incorrectly.

#### SR-009 — Module-level `nextSegmentId` counter produces unstable React keys
**File:Line:** `src/hooks/useTranscriptionStream.ts:4, 35, 84`
**What's Wrong:** `let nextSegmentId = 0` is a module-level counter. Every historical reload generates brand-new IDs for the same DB rows. This causes React to unmount/remount segment DOM nodes on every session revisit, breaking scroll position and highlight state. Also, the `translations` map in the store is keyed by `segmentId` — after a reload, old translation entries are orphaned forever (IDs never repeat).
**Expected:** Segment IDs should be stable — either use the DB row `id` column (which exists), or a deterministic key like `${sessionId}:${startMs}`.
**Root Cause:** Synthetic ID generation disconnected from the DB identity column.

---

### MEDIUM

#### SR-010 — `onBlur` fires IPC rename even when name is unchanged
**File:Line:** `src/components/TranscriptPanel.tsx:314`
**What's Wrong:** If the user clicks a speaker name to edit it, then clicks away without typing anything, `onBlur` calls `handleSpeakerRename(segment.speaker, currentDisplayName)`. The guard at line 148 checks `newName !== oldName` where `oldName = segment.speaker` (e.g., `"Speaker 1"`) and `newName` = the display name (e.g., `"Alice"`). Since `"Alice" !== "Speaker 1"`, the guard passes → unnecessary IPC call + `saveDatabase()`.
**Expected:** Guard should compare against the current display name, not the raw store value.

#### SR-011 — Unsafe TypeScript cast on `renameSpeaker` IPC call
**File:Line:** `src/pages/Dashboard.tsx:84`
**What's Wrong:** `(window as Record<string, unknown>).electronAPI?.session?.renameSpeaker?.(...)` bypasses TypeScript typing. If the preload API changes, no compile error surfaces. The rest of the function uses `window.electronAPI` with proper types.
**Expected:** Use `window.electronAPI.session.renameSpeaker(...)` directly.

#### SR-012 — `SpeakerList` component and `useSpeakerStore` are dead code
**File:Line:** `src/components/SpeakerList.tsx` (entire file), `src/store/useSpeakerStore.ts` (entire file)
**What's Wrong:** `SpeakerList` is never imported by any production component. `useSpeakerStore.renameSpeaker` is never called from any production code. A parallel normalized speaker identity system (`speakers` table, `session_speakers` table) exists in the DB schema and IPC but is completely disconnected from the `transcript_segments.speaker_name` column that the actual rename operation targets.
**Expected:** Either integrate or remove.

#### SR-013 — `SpeakerList.onBlur` cancels edit instead of confirming it
**File:Line:** `src/components/SpeakerList.tsx:59`
**What's Wrong:** `onBlur={() => cancelEdit()}` — clicking away from the input silently discards the rename. `TranscriptPanel`'s inline rename (line 314) confirms on blur. Inconsistent behavior.
**Expected:** `onBlur` should call `confirmEdit(speaker.id)`.

#### SR-014 — `clearSession` does not clear `translations` map → memory leak
**File:Line:** `src/store/useTranscriptStore.ts:168-183`
**What's Wrong:** `clearSession` removes entries from `segments`, `topics`, `actionItems`, `summaries`, `summaryLoading`, `interimResult` — but NOT `translations`. The `translations` map is keyed by `segmentId`. After a session is cleared and segments get new IDs on reload, the old translation entries are orphaned and never evicted.
**Expected:** `clearSession` should also remove all translation entries belonging to the cleared session's segments.

#### SR-015 — Session navigation never evicts transcript data → unbounded memory growth
**File:Line:** `src/components/SessionList.tsx:47`, `src/store/useSessionStore.ts:46`
**What's Wrong:** `switchView(session.id)` only updates the `viewingSessionId` pointer. No transcript data is cleared for the previously-viewed session. The transcript store accumulates segments for every session ever visited and never releases them.
**Expected:** Either clear segments for the previous session on navigation, or document the intentional caching behavior with a bounded eviction strategy.

---

### LOW

#### SR-016 — Clipboard copy uses transient `speakerRenames` → reverts after session switch
**File:Line:** `src/components/TranscriptPanel.tsx:129`
**What's Wrong:** `speakerRenames.get(seg.speaker) || seg.speaker` — after a session switch, `speakerRenames` is empty. Clipboard output will use original names even if the DB has renamed ones.
**Expected:** After SR-003 is fixed (store updated immediately after rename), clipboard should use `seg.speaker` from the store, which would be correct.

#### SR-017 — Normalized `speakers` table infrastructure disconnected from rename flow
**File:Line:** `electron/main/ipc/speaker-handlers.ts` (entire file)
**What's Wrong:** `speaker:create`, `speaker:list`, `speaker:getForSession`, `speaker:linkToSession` IPC handlers are all wired up in preload and main — but the actual rename operation (`renameSpeaker`) updates `transcript_segments.speaker_name` directly. The two systems never interact. The normalized system appears to be scaffolding for SPEC-003 (speaker identity management) but is not yet connected.
**Expected:** Document as future infrastructure, or connect at rename time.

#### SR-018 — Database migration loop uses stale `currentVersion` in `WHERE` clause
**File:Line:** `electron/main/services/database.ts:148-151`
**What's Wrong:** The migration loop updates `schema_version` with `WHERE version = currentVersion` where `currentVersion` is captured once before the loop. If multiple migrations run in one boot (e.g., schema goes from v0 to v3), the second UPDATE's `WHERE version = 0` matches nothing because the first migration already changed it to `1`.
**Expected:** `WHERE` clause should use `v - 1` (previous version) in each iteration.
**Note:** Currently harmless — only 1 migration exists. Will break when a 3rd schema version is added.

---

## Priority Matrix

### Phase A — CRITICAL (fix for reported bug)
| ID | What |
|----|------|
| SR-001 | Add `setSegments` (replace) action; use it in `loadHistoricalData` |
| SR-002 | Change dedup key to `startMs` or `${sessionId}:${startMs}` |
| SR-003 | In `handleRenameSpeaker`, after fetching transcript, call `setSegments` to replace store |

### Phase B — HIGH (fix next sprint)
| ID | What |
|----|------|
| SR-004 | Add `sessionId` to `transcription:newSegments` IPC payload; add guard in `handleSegments` |
| SR-005 | Resolved by Phase A (store stays accurate, no overlay needed) |
| SR-006 | Use current display name as `oldName` in rename handlers; resolved by Phase A |
| SR-007 | Resolved by Phase A (stable speaker names in store = stable colors) |
| SR-008 | Fix count query to use `COUNT(*) WHERE speaker_name = oldName` before UPDATE |
| SR-009 | Use DB row `id` as segment ID in `loadHistoricalData` mapping |

### Phase C — MEDIUM (fix in current sprint)
| ID | What |
|----|------|
| SR-010 | Guard `onBlur` against no-op: compare new value to current display name |
| SR-011 | Remove `(window as Record<string, unknown>)` cast; use typed `window.electronAPI` |
| SR-012 | Remove dead `SpeakerList` component and `useSpeakerStore`, or connect them |
| SR-013 | `SpeakerList.onBlur` → `confirmEdit()` |
| SR-014 | Add translation cleanup to `clearSession` |
| SR-015 | Document or implement session eviction strategy |

### Phase D — LOW (backlog)
| ID | What |
|----|------|
| SR-016 | Resolved by Phase A (store accurate = clipboard accurate) |
| SR-017 | Document normalized speaker system as SPEC-003 future work |
| SR-018 | Fix migration loop WHERE clause before adding 3rd schema version |

---

## Fix Sequence for the Reported Bug

These three changes together fix the duplication:

1. **Add `setSegments` to store** (`useTranscriptStore.ts`) — a replace action for historical loads
2. **Use `setSegments` in `loadHistoricalData`** (`useTranscriptionStream.ts:42`) — replace instead of append
3. **Call `setSegments` in `handleRenameSpeaker`** (`Dashboard.tsx:90-93`) — immediately update store after rename

Change 1+2 prevent accumulation on revisit. Change 3 prevents the scenario from arising in the first place (store stays accurate, no stale data to compound).
