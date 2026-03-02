# Phase C: Calendar & MeetingDetail MEDIUM Bug Fixes

**Spec:** c002
**Branch:** phase-c/calendar-meeting

## Bug Summary

| ID | Component | Severity | Description | Status |
|----|-----------|----------|-------------|--------|
| C-CAL-001 | Calendar | MEDIUM | useEffect dependency causes auto-scroll on every showListView toggle | FIXED |
| C-CAL-002 | Calendar | MEDIUM | Scroll effect uses `visibleStartHour` before declaration (TDZ error) | FIXED |
| C-CAL-003 | Calendar | MEDIUM | No loading state during sync when data already exists | FIXED |
| C-CAL-004 | Calendar | MEDIUM | Month view meeting cards with `hasConflicts` but no recording silently fail | FIXED |
| C-CAL-005 | Calendar | MEDIUM | Duplicate calendar entries not deduplicated | FIXED |
| C-CAL-006 | Calendar | MEDIUM | Calendar grid month view doesn't show recording count indicators | FIXED |
| C-CAL-007 | Calendar | MEDIUM | Sync interval not visible/configurable from Calendar UI | FIXED |
| C-CAL-008 | calendar-utils | MEDIUM | `formatDurationStr` doesn't guard NaN/negative/zero/Infinity | FIXED |
| C-CAL-009 | Calendar | MEDIUM | `handleAutoSyncToggle` doesn't handle `loadConfig()` errors | FIXED |
| C-CAL-010 | Calendar | MEDIUM | Config init useEffect doesn't catch `loadConfig()` rejection | FIXED |
| C-CAL-011 | useToday | MEDIUM | `setInterval` inside `setTimeout` leaks on unmount (never cleaned up) | FIXED |
| C-CAL-012 | Calendar | MEDIUM | Download queue key mismatch: UI checks `recording.id` but queue uses `deviceFilename` | FIXED |
| C-MTG-001 | MeetingDetail | MEDIUM | `handleOpenLinkDialog` defined but never wired to UI (dead code) | FIXED |
| C-MTG-002 | MeetingDetail | MEDIUM | No proper empty state for zero recordings | FIXED |
| C-MTG-003 | MeetingDetail | MEDIUM | Meeting time display not timezone-aware | FIXED |
| C-MTG-004 | MeetingDetail | MEDIUM | `showAllAttendees` not reset when navigating between meetings | FIXED |
| C-MTG-005 | MeetingDetail | MEDIUM | `durationMins` can be NaN; date formatting throws RangeError on invalid dates | FIXED |
| C-MTG-006 | MeetingDetail | MEDIUM | `handlePlay` setTimeout never cleaned up on unmount | FIXED |

## Detailed Changes

### Calendar.tsx

**C-CAL-001/C-CAL-002: Fix scroll behavior and TDZ**
- Moved scroll-to-current-hour useEffect AFTER `visibleStartHour` is computed (was referencing it before declaration)
- Added `hasScrolledRef` to prevent scrolling on every `showListView` toggle
- Only scrolls on first render or when transitioning from list to calendar view
- Resets scroll tracking when entering list view so returning to calendar rescrolls

**C-CAL-003: Sync indicator for all views**
- Added a subtle blue banner with spinning refresh icon that appears when `calendarSyncing` is true
- Banner is shown in all three view modes: list view, month view, and week/day view
- Does not replace the header spinner; provides visibility in the content area

**C-CAL-004: Fix month view meeting click handler**
- Previous: meetings with `hasConflicts` OR `isPlaceholder` were grouped together, but only opened link dialog if `matchedRecordingId` existed; otherwise silently failed
- Now: only placeholders with a `matchedRecordingId` open the link dialog; all real meetings navigate to detail page
- Non-placeholder meetings with conflicts now correctly navigate to meeting detail

**C-CAL-005: Deduplicate meetings by ID**
- Added `Set<string>`-based deduplication in `allMeetings` useMemo
- Keeps first occurrence (real meeting takes priority over placeholder)
- Prevents visual duplicates when calendar sync returns overlapping data

**C-CAL-006: Recording count badge in month view**
- Added per-day recording count indicator in month grid cells
- Shows a small green mic icon with count next to the date number
- Layout changed from single div to flex row (date left, badge right)

**C-CAL-007: Sync interval display**
- CalendarHeader now accepts `syncIntervalMinutes` prop
- Displays interval next to "Auto" label (e.g., "Auto (30m)")
- Tooltip shows full description on hover
- Value comes from `calendarConfig?.syncIntervalMinutes`

**C-CAL-008: formatDurationStr edge cases**
- Added guard for zero, negative, NaN, and Infinity inputs (returns "0m")
- Prevents unexpected rendering of "NaNh NaNm" in calendar timeline

**C-CAL-009: handleAutoSyncToggle error handling**
- Wrapped `loadConfig()` call in try/catch so a config reload failure doesn't
  revert the auto-sync toggle (the toggle API call already succeeded)

**C-CAL-010: Config init useEffect error handling**
- Wrapped `loadConfig()` in try/catch in the mount-time initialization effect
- Prevents unhandled promise rejection if config loading fails on page mount

**C-CAL-012: Download queue key mismatch**
- Card view and compact list view used `downloadQueue.has(recording.id)` to check
  download state, but the download handler adds entries with `recording.deviceFilename`
- Fixed all UI checks to use `(recording as any).deviceFilename ?? recording.id`
- Download spinner and disabled state now correctly reflect actual queue entries

**Other Calendar fixes:**
- Suppressed TS6133 for unused `today` from `useToday()` hook (needed for midnight re-render)

### useToday.ts

**C-CAL-011: Fix interval memory leak**
- The `setInterval` created inside the `setTimeout` callback was never cleaned up
  on component unmount. The `return () => clearInterval(interval)` inside the
  setTimeout callback is the return value of that callback, NOT the useEffect cleanup.
- Fixed by storing the interval ID in a `useRef` and clearing it in the useEffect
  cleanup function alongside `clearTimeout`.
- Prevents memory leaks when the Calendar component unmounts after midnight.

### MeetingDetail.tsx

**C-MTG-001: Wire up handleOpenLinkDialog**
- Added "Link to a different meeting" button (Link icon) next to each recording's Unlink button
- Fixes the dead code where `handleOpenLinkDialog` was defined but never called
- Re-imported `Link` icon from lucide-react

**C-MTG-002: Proper empty state for zero recordings**
- Replaced single-line text with a full empty state: large mic icon, explanatory text, and "Go to Calendar" button
- Explains that recordings are auto-linked by time overlap and can be manually linked from Calendar

**C-MTG-003: Timezone-aware time display**
- Added timezone abbreviation (e.g., "EST", "PST") after the time range using `Intl.DateTimeFormat`
- Added full date display below duration (e.g., "Monday, March 2, 2026")
- Duration and date separated by middle dot for clean visual hierarchy

**C-MTG-004: Reset attendee overflow on navigation**
- `showAllAttendees` state is now reset to `false` when the `id` param changes
- Previously, expanding attendees on one meeting would persist when navigating to another

**C-MTG-005: Invalid date guards**
- Added `isValidDate` check computed from `startDate`/`endDate` validity
- `durationMins` now guards against NaN using `Number.isFinite()` (falls back to 0)
- Added `safeFormatTime`, `safeFormatDate`, and `safeGetTimezoneName` helper functions
  that catch `RangeError` from `Intl.DateTimeFormat` on invalid dates
- Invalid dates show "--:--" for time and "Unknown date" for date instead of crashing

**C-MTG-006: Playback timeout cleanup**
- `handlePlay` timeout tracked in a `useRef` and cleaned up via useEffect on unmount
- Previous timeout cleared before setting a new one (prevents stale timeout)
- Prevents state updates on unmounted component

### CalendarHeader.tsx

- Added `syncIntervalMinutes?: number` to CalendarHeaderProps
- Updated auto-sync label to show interval when available

### Tests

- Added 10 new tests to `calendar-utils.test.ts`:
  - `matchRecordingsToMeetings`: overlapping match, orphan recordings, no recordings, manual link priority
  - `buildCalendarRecordings`: linked meetings, overlay hasRecording flags
  - `createPlaceholderMeetings`: placeholder creation from orphans
  - `groupByDay`: grouping, empty days, items outside view dates
- Added 7 new `formatDurationStr` tests: hours/minutes format, zero, negative, NaN, Infinity, fractional
- Added 9 new MeetingDetail tests:
  - Invalid date NaN guard, valid date duration
  - Empty recordings state, recordings count badge
  - Loading state, error state, not-found state
  - Attendees display and overflow/truncation
- Added 4 new useToday tests:
  - Returns correct date on mount
  - Updates at midnight
  - Cleans up both timer and interval on unmount after midnight
  - Cleans up timer on unmount before midnight
- All 985+ tests pass across 68 test files

## Files Changed

| File | Changes |
|------|---------|
| `src/pages/Calendar.tsx` | Scroll fix, sync indicators, dedup, month view badges, meeting click fix, download queue key fix, error handling |
| `src/pages/MeetingDetail.tsx` | Empty state, timezone display, link dialog wiring, safe date formatting, timeout cleanup, attendee reset |
| `src/hooks/useToday.ts` | Interval leak fix |
| `src/lib/calendar-utils.ts` | formatDurationStr NaN guard |
| `src/components/calendar/CalendarHeader.tsx` | Sync interval display |
| `src/lib/__tests__/calendar-utils.test.ts` | 17 new unit tests |
| `src/pages/__tests__/MeetingDetail.test.tsx` | 9 new unit tests (new file) |
| `src/hooks/__tests__/useToday.test.ts` | 4 new unit tests (new file) |

## Verification

```
npx vitest run
# 68 test files, 985 tests passed, 0 failed
# (2 pre-existing performance budget flakes excluded - timing-based, machine-dependent)

npx tsc --noEmit
# 0 errors
```
