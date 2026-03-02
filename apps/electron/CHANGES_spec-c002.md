# Phase C: Calendar & MeetingDetail MEDIUM Bug Fixes

**Spec:** c002
**Branch:** phase-c/calendar-meeting
**Commit:** fix(calendar,meeting): resolve ~10 MEDIUM bugs (Phase C)

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
| C-MTG-001 | MeetingDetail | MEDIUM | `handleOpenLinkDialog` defined but never wired to UI (dead code) | FIXED |
| C-MTG-002 | MeetingDetail | MEDIUM | No proper empty state for zero recordings | FIXED |
| C-MTG-003 | MeetingDetail | MEDIUM | Meeting time display not timezone-aware | FIXED |

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

**Other Calendar fixes:**
- Suppressed TS6133 for unused `today` from `useToday()` hook (needed for midnight re-render)

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

### CalendarHeader.tsx

- Added `syncIntervalMinutes?: number` to CalendarHeaderProps
- Updated auto-sync label to show interval when available

### Tests

- Added 10 new tests to `calendar-utils.test.ts`:
  - `matchRecordingsToMeetings`: overlapping match, orphan recordings, no recordings, manual link priority
  - `buildCalendarRecordings`: linked meetings, overlay hasRecording flags
  - `createPlaceholderMeetings`: placeholder creation from orphans
  - `groupByDay`: grouping, empty days, items outside view dates
- All 965 tests pass (66 test files)

## Files Changed

| File | Changes |
|------|---------|
| `src/pages/Calendar.tsx` | Scroll fix, sync indicators, dedup, month view badges, meeting click fix |
| `src/pages/MeetingDetail.tsx` | Empty state, timezone display, link dialog wiring |
| `src/components/calendar/CalendarHeader.tsx` | Sync interval display |
| `src/lib/__tests__/calendar-utils.test.ts` | 10 new unit tests |

## Verification

```
npx vitest run
# 66 test files, 965 tests passed, 0 failed
```
