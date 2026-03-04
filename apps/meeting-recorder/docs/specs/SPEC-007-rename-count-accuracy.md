# SPEC-007: Speaker Rename Count Accuracy

**Created:** 2026-03-04
**Status:** Active
**Addresses:** Audit finding SR-008 (SPEAKER_RENAME_BUG_AUDIT.md)
**Components:**
- `electron/main/services/database-queries.ts`

---

## Problem Statement

`renameSpeakerInSession(sessionId, oldName, newName)` returns a count that is supposed to represent "the number of segments that were renamed". However, the count is computed incorrectly:

```sql
-- What it does (WRONG):
UPDATE transcript_segments SET speaker_name = ? WHERE session_id = ? AND speaker_name = ?
-- [newName, sessionId, oldName]

SELECT COUNT(*) FROM transcript_segments WHERE session_id = ? AND speaker_name = ?
-- [sessionId, newName]   ← counts ALL segments with newName AFTER the update
```

The post-UPDATE `SELECT` counts every segment that now has `speaker_name = newName`, including segments that already had that name before the rename operation ran.

**Example of the discrepancy:**
- Session has 5 segments named "Sebastian" and 3 named "Speaker 1".
- User renames "Speaker 1" → "Sebastian".
- The UPDATE changes 3 rows.
- The post-UPDATE count returns 8 (5 pre-existing + 3 newly renamed).
- The function returns `8`, logs "Renamed Speaker 1 to Sebastian in 8 segments" — **wrong**.
- The correct return value is `3`.

The code comment acknowledges that `sql.js` does not expose `changes` (affected rows count) directly, but the workaround chosen counts the wrong thing.

---

## Requirements

### REQ-1: Return the count of rows actually changed

1. `renameSpeakerInSession` MUST return the number of rows that had `speaker_name = oldName` and were changed to `newName` by the UPDATE — not the total count of rows with `newName` after the operation.
2. The correct approach: count rows matching `oldName` **before** the UPDATE, then return that pre-count value.
3. The pre-count query:
   ```sql
   SELECT COUNT(*) FROM transcript_segments WHERE session_id = ? AND speaker_name = ?
   -- [sessionId, oldName]
   ```
4. If `oldName` does not exist in the session, the pre-count is `0`. The UPDATE runs but changes nothing. The function returns `0`. No error is thrown.

### REQ-2: Return type and comment accuracy

1. The JSDoc comment on `renameSpeakerInSession` MUST accurately describe what is returned: "Returns the number of segments whose speaker name was changed from `oldName` to `newName`."
2. The function signature and return type (`number`) are unchanged.

### REQ-3: No other behaviour changes

1. The UPDATE query is unchanged.
2. `saveDatabase()` is still called after the UPDATE.
3. The function is still synchronous.
4. No schema changes, no IPC changes.

---

## Acceptance Criteria

- [ ] AC-1: Renaming 3 "Speaker 1" segments to "Sebastian" (when 2 "Sebastian" segments already exist) returns `3`, not `5`
- [ ] AC-2: Renaming a speaker that doesn't exist in the session returns `0`
- [ ] AC-3: Renaming when all segments already have the new name returns `0`
- [ ] AC-4: The actual segments are still renamed correctly (UPDATE is unchanged)

---

## Test Requirements

### Unit tests (`database-queries.ts`)

1. **Standard rename returns correct count** — A session with 3 "Speaker 1" segments: `renameSpeakerInSession(id, "Speaker 1", "Alice")` returns `3` and all segments now have `speaker_name = "Alice"`.
2. **Inflated count scenario** — A session with 2 "Alice" segments and 3 "Speaker 1" segments: `renameSpeakerInSession(id, "Speaker 1", "Alice")` returns `3` (not `5`). All 5 segments now have `speaker_name = "Alice"`.
3. **Non-existent speaker returns 0** — `renameSpeakerInSession(id, "Ghost", "Alice")` on a session with no "Ghost" segments returns `0`.
4. **Already-named returns 0** — `renameSpeakerInSession(id, "Alice", "Alice")` (same old and new name) returns the current count of "Alice" segments... actually no — since `WHERE speaker_name = oldName` and we change to `newName` where `oldName = newName`, all "Alice" rows match, UPDATE sets them to "Alice" (no-op), pre-count is N. Returns N. This edge case should be tested.

---

## Implementation Notes

- The fix is a two-line change: replace the post-UPDATE count query with a pre-UPDATE count query.
- Query order after fix:
  1. Pre-count: `SELECT COUNT(*) WHERE session_id = ? AND speaker_name = ?` [sessionId, **oldName**]
  2. UPDATE: `UPDATE ... SET speaker_name = ? WHERE session_id = ? AND speaker_name = ?` [newName, sessionId, oldName]
  3. `saveDatabase()`
  4. Return pre-count
- The existing unit tests for `database.ts` / `session-handlers.ts` should be checked to ensure none assert on the specific count value returned by `renameSpeakerInSession`.
