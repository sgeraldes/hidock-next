# Spec B-002: Calendar (5 HIGH bugs) - Changes Summary

## B-CAL-001: Uncontrolled state mutation via raw `useAppStore.setState()`

**Problem:** Calendar.tsx directly called `useAppStore.setState({ lastCalendarSync: ... })` and
`useAppStore.setState({ calendarSyncing: ... })` bypassing proper store action patterns.

**Fix:**
- Added `setLastCalendarSync(lastSync)` and `setCalendarSyncing(syncing)` named actions to `useAppStore`
- Added corresponding granular selector hooks: `useSetLastCalendarSync()` and `useSetCalendarSyncing()`
- Replaced all 3 raw `useAppStore.setState()` calls in Calendar.tsx with named action calls

**Files modified:**
- `src/store/useAppStore.ts` - Added actions to interface and implementation, added selector exports
- `src/pages/Calendar.tsx` - Replaced raw setState with named actions

## B-CAL-002: Missing cleanup of calendar auto-sync interval

**Problem:** The calendar auto-sync `setInterval` was never cleaned up when the app quit,
potentially leaving a dangling timer.

**Fix:**
- Changed `stopAutoSync()` from a private function to an exported function in `calendar-handlers.ts`
- Imported and called `stopAutoSync()` in the `before-quit` handler in `index.ts`

**Files modified:**
- `electron/main/ipc/calendar-handlers.ts` - Exported `stopAutoSync()`
- `electron/main/index.ts` - Imported and called `stopAutoSync()` in before-quit handler

## B-CAL-003: Hour range hard-coded (8-18)

**Problem:** The calendar timeline always showed a fixed hour range (most recently 6-23),
hiding recordings and meetings that fell outside those bounds.

**Fix:**
- Created `computeVisibleHourRange(recordings, meetings, defaultStart, defaultEnd)` pure function
  in `calendar-utils.ts` that examines actual event times and expands the range with 1-hour padding
- Returns `{ startHour, endHour, hours[] }` for the dynamic range
- Calendar.tsx now uses `useMemo` to compute the visible range from `calendarRecordings` and
  `meetingOverlays`, then uses `visibleStartHour`, `visibleEndHour`, and `visibleHours` throughout
- All position calculations, hour grid lines, time labels, and visibility filters use the dynamic range
- Legacy `START_HOUR`/`END_HOUR`/`HOURS` constants preserved as aliases for backward compatibility

**Files modified:**
- `src/lib/calendar-utils.ts` - Added `computeVisibleHourRange()`, `VisibleHourRange` type,
  `DEFAULT_START_HOUR`/`DEFAULT_END_HOUR` constants
- `src/pages/Calendar.tsx` - Replaced static hour constants with dynamic computed range

**Tests added:**
- `src/lib/__tests__/calendar-utils.test.ts` (10 tests) covering:
  - Default range with no events
  - Early morning recording expansion
  - Late night meeting expansion
  - Clamping to 0-24 bounds
  - Events within default range (no expansion needed)
  - Exact hour boundaries
  - Correct hours array generation
  - Simultaneous early and late expansion
  - Custom default range

## B-CAL-004: Error handler swallows details

**Problem:** Calendar sync errors were caught and returned as generic string messages with
no structured information for user-facing error handling.

**Fix:**
- Added `CalendarErrorCategory` type: `'network' | 'parse' | 'database' | 'validation' | 'unknown'`
- Added `categorizeCalendarError(error)` function that classifies errors by pattern matching
  on error messages (fetch errors, ECONNREFUSED, SQLITE, ICAL parse, URL validation, etc.)
- Added `errorCategory` field to `CalendarSyncResult` interface (both main and renderer types)
- `syncCalendar()` now includes `errorCategory` in failure responses
- URL validation failures now explicitly tagged as `'validation'` category

**Files modified:**
- `electron/main/services/calendar-sync.ts` - Added `categorizeCalendarError()`, `CalendarErrorCategory`,
  updated `CalendarSyncResult`, updated `syncCalendar()` catch block
- `src/types/index.ts` - Added `CalendarErrorCategory` type, updated `CalendarSyncResult`

**Tests added:**
- `electron/main/services/__tests__/calendar-sync-errors.test.ts` (22 tests) covering:
  - Network errors (fetch, ECONNREFUSED, ENOTFOUND, ETIMEDOUT, HTTP status, ERR_NETWORK)
  - Parse errors (ICAL, SyntaxError, invalid ical, Unexpected token)
  - Database errors (Database error, SQLITE, constraint)
  - Validation errors (URL, HTTPS, blocked, Private IP)
  - Unknown errors (generic, non-Error objects, null)
  - Message preservation

## B-CAL-005: Whole config object as dependency causes excess re-renders

**Problem:** Calendar.tsx destructured `{ config, loadConfig, updateConfig }` from `useConfigStore()`,
subscribing to the entire config store. Any config change (even unrelated sections) triggered
Calendar re-renders.

**Fix:**
- Replaced `const { config, loadConfig, updateConfig } = useConfigStore()` with granular selectors:
  - `useConfigStore((s) => s.config?.calendar)` for calendar config
  - `useConfigStore((s) => s.config?.ui)` for UI config
  - `useConfigStore((s) => s.loadConfig)` for the load action
  - `useConfigStore((s) => s.updateConfig)` for the update action
- Updated all references from `config?.ui?.X` to `uiConfig?.X` and `config?.calendar?.X` to
  `calendarConfig?.X`
- Updated `useEffect` dependency arrays to use `uiConfig` and `calendarConfig` instead of `config`

**Files modified:**
- `src/pages/Calendar.tsx` - Replaced whole config destructure with granular selectors

## Test Results

All 56 test files pass with 853 tests, including the 32 new tests.
