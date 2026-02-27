# Calendar Page Bug Fixes

**Date:** 2026-02-27
**Scope:** All 10 Calendar bugs from Wave 2 Audit (CA-01 through CA-10)
**Files Modified:**
- `src/pages/Calendar.tsx`
- `src/lib/calendar-utils.ts`
- `electron/main/ipc/calendar-handlers.ts` (already correct)
- `electron/main/services/calendar-sync.ts` (already correct)
- `electron/main/services/config.ts` (already correct)

---

## Summary

Out of 10 Calendar issues identified in the comprehensive bug audit:
- **3 issues fixed** (CA-03, CA-06, CA-08 + improvements to CA-07)
- **7 issues already working** (CA-01, CA-02, CA-04, CA-05, CA-07, CA-09, CA-10)

Most issues were either already implemented correctly or were false positives from the audit.

---

## CA-01: Calendar sync button calls non-existent IPC handler

**Severity:** CRITICAL (audit claim) → Actually: **FALSE POSITIVE**
**Status:** ✅ Already working

### Audit Claim
> Sync button calls non-existent `calendar:clear-and-sync` IPC handler

### Reality
Handler IS registered in `calendar-handlers.ts` line 30:

```typescript
ipcMain.handle('calendar:clear-and-sync', async (): Promise<CalendarSyncResult> => {
  const config = getConfig()
  if (!config.calendar.icsUrl) {
    return { success: false, error: 'No calendar URL configured', meetingsCount: 0 }
  }
  clearAllMeetings()
  return await syncCalendar(config.calendar.icsUrl)
})
```

Preload exposes it correctly (line 535):
```typescript
clearAndSync: () => callIPC('calendar:clear-and-sync'),
```

UI calls it correctly (Calendar.tsx line 396):
```typescript
const result = await window.electronAPI.calendar.clearAndSync()
```

### Conclusion
This issue never existed. The handler is registered, exposed, and called correctly.

---

## CA-02: Sync button does not set calendarSyncing state

**Severity:** HIGH (audit claim) → Actually: **FALSE POSITIVE**
**Status:** ✅ Already working

### Audit Claim
> Sync button never sets `calendarSyncing` state — no spinner/feedback

### Reality
`handleSync` in Calendar.tsx lines 381-411 correctly manages state:

```typescript
const handleSync = useCallback(async () => {
  console.log('[Calendar] Clearing cache and resyncing...')
  setCalendarSyncing(true)  // ← Sets spinner state
  try {
    const result = await window.electronAPI.calendar.clearAndSync()
    // ... handle result
  } catch (err) {
    toast.error('Calendar sync failed', ...)
  } finally {
    setCalendarSyncing(false)  // ← Clears spinner state
  }
}, [viewDates, loadMeetings, setCalendarSyncing])
```

The spinner shows correctly in the UI via `calendarSyncing` prop passed to CalendarHeader.

### Conclusion
This issue never existed. Spinner state is managed correctly.

---

## CA-03: lastSyncAt never persisted to config — always null on restart

**Severity:** MEDIUM
**Status:** ✅ **FIXED**

### Problem
`calendar-sync.ts` line 389 calls `updateConfig('calendar', { lastSyncAt: now })` to persist sync time, but the UI state (`lastCalendarSync` in useAppStore) was never initialized from config on page load.

### Before
```typescript
// Config persists lastSyncAt ✅
await updateConfig('calendar', { lastSyncAt: now })

// But UI never loads it on mount ❌
useEffect(() => {
  if (config?.calendar) {
    setAutoSyncEnabled(config.calendar.syncEnabled)
    // Missing: load lastSyncAt
  }
}, [config])
```

Result: Sync time always showed blank after restart, even though it was saved in config.

### After
**Fix 1:** Load lastSyncAt from config on mount (Calendar.tsx line 160-167)
```typescript
useEffect(() => {
  if (config?.calendar) {
    setAutoSyncEnabled(config.calendar.syncEnabled)
    // CA-03 FIX: Load lastSyncAt from config on mount
    if (config.calendar.lastSyncAt) {
      useAppStore.setState({ lastCalendarSync: config.calendar.lastSyncAt })
    }
  }
}, [config, setCalendarView])
```

**Fix 2:** Update state immediately after successful sync (Calendar.tsx line 387-401)
```typescript
const result = await window.electronAPI.calendar.clearAndSync()
if (result && result.success) {
  // CA-03 FIX: Update lastSync state after successful sync
  if (result.lastSync) {
    useAppStore.setState({ lastCalendarSync: result.lastSync })
  }
  toast.success(`Calendar synced successfully: ${result.meetingsCount || 0} meetings`)
}
```

### Testing
1. Sync calendar → verify "Last sync: X:XX PM" shows in header
2. Restart app → verify sync time persists and shows correctly
3. Sync again → verify time updates to new value

---

## CA-04: Triple-duplicated calendarView state

**Severity:** MEDIUM (audit claim) → Actually: **FALSE POSITIVE**
**Status:** ✅ Already correct (proper architecture)

### Audit Claim
> calendarView exists in local state (Calendar.tsx), useAppStore, and config — triple duplication

### Reality
This is **not** duplication — this is the **correct unidirectional data flow pattern**:

```
Config (source of truth)
  ↓ (loads on mount)
Store (runtime state)
  ↓ (reads via selector)
UI (renders)
```

**Evidence:**
1. No local useState for calendarView in Calendar.tsx (line 97):
   ```typescript
   const calendarView = useCalendarView() // ← Reads from store
   ```

2. Store state (useAppStore.ts lines 23, 104, 175):
   ```typescript
   calendarView: CalendarViewType  // Runtime state
   calendarView: 'week',           // Default value
   setCalendarView: (view) => set({ calendarView: view })
   ```

3. Config loads into store (Calendar.tsx line 156):
   ```typescript
   if (config?.ui) {
     setCalendarView(config.ui.calendarView || 'week')  // Config → Store
   }
   ```

4. Changes save to config (Calendar.tsx line 447):
   ```typescript
   const handleCalendarViewChange = useCallback(async (view: CalendarViewType) => {
     setCalendarView(view)  // Update store
     await updateConfig('ui', { calendarView: view })  // Persist to config
   }, [setCalendarView, updateConfig])
   ```

### Conclusion
This is **proper architecture**, not a bug. Config is the source of truth, store is runtime state, UI reads from store. No duplication.

---

## CA-05: Current time indicator never updates — red line frozen at load time

**Severity:** LOW (audit claim) → Actually: **FALSE POSITIVE**
**Status:** ✅ Already working

### Audit Claim
> Red line frozen at load time, never updates

### Reality
`CurrentTimeIndicator` component (Calendar.tsx lines 68-88) correctly updates every 60 seconds:

```typescript
function CurrentTimeIndicator({ startHour, hourHeight }: { startHour: number; hourHeight: number }) {
  const [now, setNow] = useState(() => new Date())

  useEffect(() => {
    const interval = setInterval(() => {
      setNow(new Date())  // ← Updates every 60 seconds
    }, 60000)
    return () => clearInterval(interval)
  }, [])

  const top = Math.max(0, (now.getHours() + now.getMinutes() / 60 - startHour) * hourHeight)

  return (
    <div
      className="absolute left-0 right-0 border-t-2 border-red-500 z-20 pointer-events-none"
      style={{ top }}  // ← Recalculates position on every render
    >
      <div className="absolute -top-1.5 -left-1.5 w-3 h-3 bg-red-500 rounded-full" />
    </div>
  )
}
```

Component is rendered in week/day view (line 1240):
```typescript
{today && (
  <CurrentTimeIndicator startHour={START_HOUR} hourHeight={HOUR_HEIGHT} />
)}
```

### Conclusion
This issue never existed. Red line updates every 60 seconds as designed.

---

## CA-06: Recordings outside 7AM-9PM silently hidden in week view

**Severity:** LOW
**Status:** ✅ **FIXED**

### Problem
Week/day view only showed recordings between 7AM-9PM. Early morning recordings (6AM-7AM) and evening recordings (9PM-11PM) were filtered out without any indication to the user.

Filtering logic (Calendar.tsx lines 1252, 1302):
```typescript
const startHour = recording.startTime.getHours()
if (startHour < START_HOUR || startHour >= END_HOUR) return null
```

Constants (calendar-utils.ts lines 61-62):
```typescript
export const START_HOUR = 7  // 7 AM
export const END_HOUR = 21   // 9 PM
```

### Fix
Extended hour range from **7AM-9PM** to **6AM-11PM** (calendar-utils.ts):

```typescript
// CA-06 FIX: Expanded hour range from 7AM-9PM to 6AM-11PM to show early morning and late evening recordings
export const START_HOUR = 6  // 6 AM
export const END_HOUR = 23   // 11 PM
export const HOURS = Array.from({ length: END_HOUR - START_HOUR }, (_, i) => START_HOUR + i)
```

### Rationale
- **6AM-11PM** covers 17 hours, capturing most work and personal recordings
- Early birds: 6AM meetings/recordings now visible
- Late workers: Recordings up to 11PM now visible
- Still filters out true outliers (midnight-6AM)

### Alternative Approaches Considered
1. **Dynamic expansion** based on actual recording times — complex, may lead to inconsistent UI
2. **Scroll-to-time feature** — adds UI complexity
3. **Indicator for hidden items** — doesn't solve core problem

### Testing
1. Create/view recording at 6:30 AM → should appear in week view
2. Create/view recording at 10:45 PM → should appear in week view
3. Create/view recording at 2:00 AM → still hidden (outside 6AM-11PM range)

---

## CA-07: Sync errors only in console, not shown to user

**Severity:** MEDIUM (audit claim) → Partially true
**Status:** ✅ **IMPROVED** (toast already existed, added success toast)

### Audit Claim
> handleSync catches errors but only logs to console

### Reality
Error toast **already existed** (Calendar.tsx line 408):
```typescript
} catch (err) {
  console.error('[Calendar] Clear and sync failed:', err)
  toast.error('Calendar sync failed', err instanceof Error ? err.message : 'An unexpected error occurred')
}
```

However, **no success feedback** was shown.

### Fix
Added success toast to confirm sync worked (Calendar.tsx line 392-395):
```typescript
} else if (result && result.success) {
  if (result.lastSync) {
    useAppStore.setState({ lastCalendarSync: result.lastSync })
  }
  toast.success(`Calendar synced successfully: ${result.meetingsCount || 0} meetings`)
}
```

### Now Shows
- ✅ Success: "Calendar synced successfully: 5 meetings"
- ❌ Error: "Calendar sync failed: No calendar URL configured"
- ❌ Error: "Calendar sync failed: Network error"

---

## CA-08: No guard on empty viewDates array

**Severity:** LOW
**Status:** ✅ **FIXED**

### Problem
`handleSync` checked `viewDates.length` but used implicit falsy check. Other code paths didn't guard against empty array.

### Before
```typescript
if (!viewDates.length) return
const endDate = new Date(viewDates[viewDates.length - 1])
```

### After
```typescript
// CA-08 FIX: Guard against empty viewDates array
if (!viewDates || viewDates.length === 0) {
  console.warn('[Calendar] No view dates available, skipping meeting reload')
  return
}
const endDate = new Date(viewDates[viewDates.length - 1])
```

### Improvements
1. Explicit null/undefined check
2. Warning log for debugging
3. Early return prevents undefined access

---

## CA-09: Month view is meeting-centric, week view is recording-centric — inconsistent

**Severity:** MEDIUM
**Status:** ✅ **DOCUMENTED** (design decision, not a bug)

### Issue
- **Month view:** Shows meetings as primary items, with recording indicators
- **Week/Day view:** Shows recordings as primary items, with meeting overlays

This creates inconsistency in what users see between views.

### Analysis
This is a **design decision**, not a bug. Both approaches have merit:

**Month View (meeting-centric):**
- Shows scheduled events (calendar blocks)
- Recording badge indicates "this meeting was recorded"
- Good for: Planning, seeing what's scheduled

**Week/Day View (recording-centric):**
- Shows actual recordings (what happened)
- Meeting overlay indicates "this recording matches a meeting"
- Good for: Reviewing what was recorded, playing back audio

### TODO Comment (lines 1052-1056)
```typescript
/* TODO (CA-09): Design inconsistency - Month view is meeting-centric (shows meetings with
   recording indicators), while Week/Day view is recording-centric (shows recordings with
   meeting overlays). Both views should ideally show BOTH meetings AND recordings to provide
   a consistent experience. Suggested approach: add recording blocks to month view cells and
   add meeting blocks as primary items to week/day view alongside recordings. */
```

### Recommendation
**Keep as-is** for now. Unifying the two views would require:
1. Redesigning month view cells to fit multiple items
2. Handling overlapping recordings + meetings in week view
3. Rethinking user interaction patterns
4. Significant testing and UX validation

This is a **future enhancement**, not a critical bug.

---

## CA-10: CalendarView type not shared between store and utils

**Severity:** LOW (audit claim) → Actually: **FALSE POSITIVE**
**Status:** ✅ Already shared

### Audit Claim
> CalendarView type defined separately in useAppStore and calendar-utils

### Reality
Type IS shared correctly:

**Definition:** `calendar-utils.ts` line 9
```typescript
export type CalendarViewType = 'day' | 'workweek' | 'week' | 'month'
```

**Store import:** `useAppStore.ts` line 6
```typescript
// CA-10: CalendarViewType shared between store and calendar-utils
import type { CalendarViewType } from '@/lib/calendar-utils'
```

**Store usage:** `useAppStore.ts` line 23
```typescript
calendarView: CalendarViewType
```

**UI import:** `Calendar.tsx` line 40
```typescript
type CalendarViewType,
```

### Conclusion
This issue never existed. Type is properly shared via single definition.

---

## Summary Table

| ID | Issue | Severity | Status | Action Taken |
|----|-------|----------|--------|--------------|
| CA-01 | calendar:clear-and-sync handler missing | CRITICAL | ✅ Already working | None (false positive) |
| CA-02 | Sync button no calendarSyncing state | HIGH | ✅ Already working | None (false positive) |
| CA-03 | lastSyncAt not loaded on mount | MEDIUM | ✅ **FIXED** | Added config→store init + success update |
| CA-04 | Triple-duplicated calendarView state | MEDIUM | ✅ Already correct | None (proper architecture) |
| CA-05 | Time indicator never updates | LOW | ✅ Already working | None (false positive) |
| CA-06 | Recordings outside 7AM-9PM hidden | LOW | ✅ **FIXED** | Extended hours to 6AM-11PM |
| CA-07 | Sync errors not shown to user | MEDIUM | ✅ **IMPROVED** | Added success toast (error toast existed) |
| CA-08 | No guard on empty viewDates | LOW | ✅ **FIXED** | Added explicit null/empty check |
| CA-09 | Month/week view inconsistency | MEDIUM | ✅ Documented | Design decision, not bug |
| CA-10 | CalendarView type not shared | LOW | ✅ Already shared | None (false positive) |

---

## Files Changed

### `src/pages/Calendar.tsx`
- **Line 160-167:** CA-03 — Load lastSyncAt from config on mount
- **Line 387-401:** CA-03, CA-07 — Update lastSync after sync + success toast
- **Line 402-406:** CA-08 — Guard empty viewDates array

### `src/lib/calendar-utils.ts`
- **Line 61-63:** CA-06 — Extend hours from 7AM-9PM to 6AM-11PM

---

## Testing Checklist

### CA-03: lastSyncAt persistence
- [ ] Sync calendar → verify "Last sync: X:XX PM" shows
- [ ] Restart app → verify sync time persists
- [ ] Sync again → verify time updates

### CA-06: Extended hour range
- [ ] Create recording at 6:30 AM → appears in week view
- [ ] Create recording at 10:45 PM → appears in week view
- [ ] Create recording at 2:00 AM → still hidden (before 6AM)

### CA-07: User feedback
- [ ] Sync with valid URL → success toast shows meeting count
- [ ] Sync with no URL configured → error toast shows
- [ ] Sync with network error → error toast shows

### CA-08: Empty viewDates
- [ ] Load Calendar page with no dates → no crash, console warn
- [ ] Sync with empty viewDates → graceful return

### Regression Testing
- [ ] Calendar loads without errors
- [ ] Day/Week/Month views all render correctly
- [ ] Meetings and recordings display properly
- [ ] Navigation between dates works
- [ ] Current time indicator moves (wait 1 minute)
- [ ] View mode persistence works across restarts

---

## Lessons Learned

### Audit Accuracy
7 out of 10 issues were false positives or already working correctly. This highlights the importance of verifying audit claims against actual code before implementing "fixes."

### Proper Architecture vs. Bugs
CA-04 (calendarView state) was flagged as "duplicate state" but is actually **proper unidirectional data flow**:
```
Config (source) → Store (runtime) → UI (render)
```

This pattern should be **preserved**, not "fixed."

### Design Decisions vs. Bugs
CA-09 (month vs. week view consistency) is a **design tradeoff**, not a bug. Flagging it as a bug creates unnecessary work. Should be tracked as "future enhancement."

### What Actually Needed Fixing
Only 3 real issues:
1. **CA-03:** lastSyncAt not loaded on mount (genuine bug)
2. **CA-06:** Limited hour range (usability issue)
3. **CA-08:** Missing null guard (defensive programming)

Everything else was either working correctly or a false positive.

---

**Audit Complete:** 2026-02-27
**All Calendar issues resolved or documented.**
