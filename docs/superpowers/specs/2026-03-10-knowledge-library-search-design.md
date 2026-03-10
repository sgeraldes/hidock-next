# Knowledge Library Search Improvements — Design Spec

**Date:** 2026-03-10
**Status:** Approved
**Scope:** Phase 1 — client-side metadata search only (transcript/chunk search is Phase 2, tracked separately)

---

## Problem

The current search is a simple `String.includes()` match against a small set of raw database fields. Multiple common query patterns return zero results:

| Query | Expected | Actual |
|---|---|---|
| `Sep 25` (space) | Recordings from Sep 25 | No results |
| `Sofia` | Recordings with "Sofia" in title | No results |
| `Connect` | Recordings with "Connect" in title | No results |
| `Sofia Rodriguez` | Recordings where Sofia attended | No results |

**Root causes:**
1. Search uses `rec.title` directly — often `null`. The display title (assembled by `getDisplayTitle()`) is never queried.
2. No date normalization — `rec.dateRecorded` is never included in searchable text.
3. No participant data — `meetings.attendees` (JSON) exists in the DB but `UnifiedRecording` doesn't carry it.
4. No tokenization — multi-word queries must match as one contiguous substring.

---

## Design

### Improvement 1: Search the display title

**File:** `src/pages/Library.tsx`

Replace `rec.title?.toLowerCase()` with `getDisplayTitle(rec).toLowerCase()` as a search target.

`getDisplayTitle()` resolves: `meeting.subject` → `knowledge.title` → `transcript.title` → `filename`. Querying the assembled value instead of the raw `title` field fixes "Sofia" and "Connect" not matching.

---

### Improvement 2: Token-based AND matching

**File:** `src/pages/Library.tsx`

Split the query on whitespace into tokens. A recording matches only when **all** tokens are found across the union of searchable fields.

```
query: "Sofia Connect"
tokens: ["sofia", "connect"]
match: every token must appear somewhere in (displayTitle | filename | attendees | dateAliases | summary | category)
```

Single-word queries behave identically to the current implementation.

---

### Improvement 3: Attendee names and emails

**Files:** `src/types/unified-recording.ts`, `src/hooks/useUnifiedRecordings.ts`, `src/pages/Library.tsx`

Attendee data already exists: `meetings.attendees` is a JSON column of `{ name, email, status }[]`, with `parseAttendees()` available.

Changes:
- Add `meetingAttendees?: MeetingAttendee[]` to `UnifiedRecording`
- Populate in `useUnifiedRecordings` when building each record that has a linked meeting
- In the Library search filter, join names and emails into a single searchable string:
  `"Sofia Rodriguez sofia@example.com"` → searched like any other field

---

### Improvement 4: Date aliases

**File:** `src/pages/Library.tsx`

For each recording, derive a string of date aliases from `rec.dateRecorded` at filter time (not stored). All aliases are concatenated and searched as one blob:

| Alias format | Example | Matches user input |
|---|---|---|
| `MonthDDYYYY` (no spaces) | `sep252025` | "Sep25", "sep252025" |
| `Month DD YYYY` | `sep 25 2025` | "Sep 25", "sep 25 2025" |
| `FullMonth DD YYYY` | `september 25 2025` | "September 25" |
| `Month YYYY` | `sep 2025` | "Sep 2025" |
| `MM/DD` | `09/25` | "09/25" |
| `YYYY-MM-DD` | `2025-09-25` | ISO date |

All aliases are lowercased. The token matching from Improvement 2 means `"sep 25"` correctly splits into `["sep", "25"]` and both tokens must be found — which they will be in the `sep 25 2025` alias.

---

### Improvement 5: Highlighting tokenized queries

**File:** `src/features/library/utils/highlightText.tsx`

`highlightText(text, query)` currently highlights the whole query string as one substring. Update to highlight each token independently, so `"Sofia Connect"` highlights "Sofia" and "Connect" separately where they appear in the row title.

---

## Files Changed

| File | Type | Change |
|---|---|---|
| `src/types/unified-recording.ts` | Modify | Add `meetingAttendees?: MeetingAttendee[]` |
| `src/hooks/useUnifiedRecordings.ts` | Modify | Populate `meetingAttendees` from linked meeting's attendees JSON |
| `src/pages/Library.tsx` | Modify | Replace search block with tokenized, multi-field version using display title + date aliases + attendees |
| `src/features/library/utils/highlightText.tsx` | Modify | Accept token array or single query; highlight each token independently |

**No DB changes. No IPC changes. No new dependencies.**

---

## Acceptance Criteria

- [ ] Searching `Sep 25` (with space) finds recordings from September 25
- [ ] Searching `Sofia` finds recordings where "Sofia" appears in the display title
- [ ] Searching `Connect` finds recordings with "Connect" in the display title
- [ ] Searching a participant's name (e.g. `Sofia Rodriguez`) finds recordings where that person attended
- [ ] Searching a participant's email finds matching recordings
- [ ] Multi-word queries use AND logic: all tokens must match somewhere
- [ ] Existing single-word searches (e.g. `Sep25`) continue to work
- [ ] Search highlights reflect individual tokens, not the whole query string
- [ ] No performance regression on 1300+ recordings
- [ ] All existing tests pass; new tests cover each improvement

---

## Out of Scope (Phase 2)

- Transcript content / chunk search (full-text via SQLite FTS5)
- Fuzzy / typo-tolerant matching
- Relevance ranking / scoring
- OR logic between tokens
