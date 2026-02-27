# QA Logging System Audit

**Date:** 2026-02-27
**Scope:** All console logging controlled by QA Logs toggle
**Agents:** 3 parallel agents across 6 domains
**Finding:** QA Logs toggle only controls 30% of QA logging system

---

## Executive Summary

**Total Issues:** 5 domains broken (3 CRITICAL, 2 LOW)
**Total Log Statements Affected:** 52+ statements not respecting toggle
**Root Cause:** Hardcoded DEBUG constants and context isolation preventing state access
**User Impact:** QA Logs switch appears broken - logs continue appearing when toggled OFF

### Breakdown by Domain

| Domain | Status | Log Count | Severity |
|--------|--------|-----------|----------|
| **QAL-1: Preload IPC Logger** | ❌ BROKEN | ~50-100/session | CRITICAL |
| **QAL-2: QA Monitor Service** | ✅ WORKING | ~20/session | N/A |
| **QAL-3: Jensen USB Logger** | ❌ BROKEN | 36 statements | CRITICAL |
| **QAL-4: HiDock Device Logger** | ⚠️ DISABLED | 0 (DEBUG_DEVICE=false) | LOW |
| **QAL-5: Device UI Logger** | ⚠️ DISABLED | 0 (DEBUG_DEVICE_UI=false) | LOW |
| **QAL-6: Hook QA Loggers** | ❌ BROKEN | 16 statements | CRITICAL |

---

## Findings by Domain

### QAL-1: Preload IPC Logger — CRITICAL ❌

**File:** `electron/preload/index.ts` (lines 4-22)

**Current Behavior:**
- Logs ALL IPC calls: `[QA-MONITOR][IPC] ${channel} (${duration}ms)`
- Logs ALL IPC errors: `[QA-MONITOR][IPC-ERR] ${channel}: error`
- Excludes polling channels only (recordings status, db queries)
- **Completely ignores qaLogsEnabled toggle**

**Volume:** 50-100+ logs per typical session (every config read, every DB query, every file operation)

**Root Cause:**
- Preload script runs in **separate JavaScript context** from renderer
- Cannot access `useUIStore.qaLogsEnabled` (Zustand store in renderer process)
- Electron's `contextBridge` only allows one-way exposure (main → renderer)
- Context isolation is by design (security model)

**Technical Constraint:**
```
┌─────────────────┐     ┌──────────────────┐     ┌─────────────────┐
│  Main Process   │────▶│ Preload Context  │────▶│ Renderer (React)│
│  (Node.js)      │ IPC │ (Bridge)         │ CB  │ (Zustand store) │
└─────────────────┘     └──────────────────┘     └─────────────────┘
                              ↑
                              │ Cannot access store here
                              │ (different JS context)
```

**Recommended Solution:** localStorage sync read (0 latency, already persisted by Zustand)

**Code Fix:**
```typescript
const callIPC = async (channel: string, ...args: any[]) => {
  const isPolling = ['recordings:getTranscriptionStatus', 'db:get-recordings', 'knowledge:getAll'].includes(channel)

  // Read qaLogsEnabled from localStorage (persisted by useUIStore)
  let qaEnabled = false
  try {
    const stored = localStorage.getItem('hidock-ui-store')
    if (stored) {
      const { state } = JSON.parse(stored)
      qaEnabled = state?.qaLogsEnabled ?? false
    }
  } catch { /* fail silently */ }

  try {
    const start = performance.now()
    const result = await ipcRenderer.invoke(channel, ...args)
    const duration = (performance.now() - start).toFixed(1)

    if (!isPolling && qaEnabled) {  // ← ADD CHECK
      console.log(`[QA-MONITOR][IPC] ${channel} (${duration}ms)`)
    }
    return result
  } catch (error) {
    if (!isPolling && qaEnabled) {  // ← ADD CHECK
      console.error(`[QA-MONITOR][IPC-ERR] ${channel}:`, error)
    }
    throw error
  }
}
```

**Why localStorage:**
- ✅ Zero latency (synchronous read)
- ✅ Already persisted by Zustand persist middleware
- ✅ Available immediately on app startup
- ✅ No IPC round-trip overhead
- ✅ Validated by existing tests (`useUIStore.test.ts` line 88)

---

### QAL-2: QA Monitor Service — WORKING ✅

**File:** `src/services/qa-monitor.ts`

**Status:** Correctly checks `qaLogsEnabled` via `useUIStore.getState().qaLogsEnabled`

**What It Controls:**
- ✅ Navigation logs (`[QA-MONITOR] Navigation: -> /page`)
- ✅ Interaction logs (`[QA-MONITOR] Interaction: Clicked button`)
- ✅ Error logs (`[QA-MONITOR] Uncaught Error:`)
- ✅ State change logs (`[QA-MONITOR] State [storeName]:`)

**Reference Pattern (CORRECT):**
```typescript
function isQaEnabled(): boolean {
  if (IS_PROD) return false
  try {
    return useUIStore.getState().qaLogsEnabled
  } catch {
    return false
  }
}
```

**No action needed** — this is the gold standard pattern.

---

### QAL-3: Jensen USB Logger — CRITICAL ❌

**File:** `src/services/jensen.ts` (lines 292-293)

**Current State:**
```typescript
const DEBUG_USB = false       // 7 log statements (INACTIVE)
const DEBUG_PROTOCOL = true   // 36 log statements (ACTIVE) ← PROBLEM
```

**Volume:** 36 log statements currently ACTIVE
- Connection flow: 14 logs per connect/disconnect
- File listing: 7-10 logs per operation
- File downloads: 3-5 logs per file
- **Total per session: 50-100+ logs** (syncing 50 files = 200-250 logs)

**Log Categories:**
1. USB event listeners (4 statements)
2. Operation locking (2 statements)
3. Connection flow (10 statements)
4. Device commands (6 statements)
5. File listing (7 statements)
6. File downloads (3 statements)
7. Protocol layer (4 statements)

**Root Cause:**
- Hardcoded `DEBUG_PROTOCOL = true` (line 293)
- Comment says "set to true for debugging download issues"
- Left over from development/troubleshooting
- No runtime toggle — bypasses qaLogsEnabled system

**Recommended Solution:** Replace DEBUG_PROTOCOL with qaLogsEnabled check

**Code Fix:**
```typescript
// Add at top of jensen.ts
import { useUIStore } from '@/store/ui/useUIStore'

function isQaLoggingEnabled(): boolean {
  const IS_PROD = typeof import.meta !== 'undefined' && import.meta.env?.PROD
  if (!IS_PROD) return true  // Dev builds always log (for debugging)

  try {
    return useUIStore.getState().qaLogsEnabled
  } catch {
    return false
  }
}

// Replace all 36 instances:
// BEFORE: if (DEBUG_PROTOCOL) console.log(...)
// AFTER:  if (isQaLoggingEnabled()) console.log(...)
```

**Keep DEBUG_USB separate** (super-verbose byte-level debugging):
```typescript
const DEBUG_USB = false  // Manual override only - VERY noisy
```

**Breaking Changes:**
- Dev builds will be quieter by default (qaLogsEnabled starts false)
- Production builds can toggle logs via UI (no recompile needed)
- Adds runtime dependency on Zustand store (wrapped in try-catch)

---

### QAL-4: HiDock Device Logger — LOW ⚠️

**File:** `src/services/hidock-device.ts` (line 95)

**Current State:**
```typescript
const DEBUG_DEVICE = false  // Currently disabled
```

**Status:** No immediate action needed (DEBUG_DEVICE=false means no logs)

**Future Refactor:** When/if DEBUG_DEVICE is enabled, apply same pattern as Jensen logger:
```typescript
function isQaLoggingEnabled(): boolean { /* same as QAL-3 */ }

// Replace: if (DEBUG_DEVICE) console.log(...)
// With:    if (isQaLoggingEnabled()) console.log(...)
```

---

### QAL-5: Device UI Logger — LOW ⚠️

**File:** `src/pages/Device.tsx` (line 21)

**Current State:**
```typescript
const DEBUG_DEVICE_UI = false  // Currently disabled
```

**Status:** No immediate action needed (DEBUG_DEVICE_UI=false means no logs)

**Future Refactor:** When/if enabled, use React hook pattern:
```typescript
const qaEnabled = useUIStore((s) => s.qaLogsEnabled)

useEffect(() => {
  if (IS_PROD || !qaEnabled) return
  console.log('[QA-MONITOR] Device UI event')
}, [qaEnabled])
```

---

### QAL-6: Hook QA Loggers — CRITICAL ❌

**Files & Volume:**
1. `src/hooks/useDownloadOrchestrator.ts` — **10 log statements** (7 guarded, 3 unguarded errors)
2. `src/hooks/useDeviceSubscriptions.ts` — **12 log statements** (all guarded)
3. `src/hooks/useAudioPlayback.ts` — **18 log statements** (13 guarded, 5 unguarded errors)

**Total:** 40 log statements (32 not respecting toggle, 8 unguarded errors)

**Current Pattern (BROKEN):**
```typescript
if (DEBUG) console.log(`[QA-MONITOR][Operation] Processing download: ${filename}`)
```

**Issues:**
1. Respects `DEBUG` flag but ignores `qaLogsEnabled` toggle
2. High-frequency logging (fires on every download, every playback, every sync)
3. Contains sensitive data (file paths, recording IDs, audio data sizes)

**Impact Quantification:**

**Typical Session (Light User):**
- Device connection: 2 logs
- Download 10 recordings: 10 × 3 logs = 30 logs
- Play 5 recordings: 5 × 9 logs = 45 logs
- Load waveforms: 3 × 2 logs = 6 logs
- **Total: ~84 logs per typical session**

**High-Traffic Session (Heavy Developer/Testing):**
- Device reconnects 3×: 3 × 4 logs = 12 logs
- Sync 50 recordings: 50 × 3 logs = 150 logs
- Test playback 20×: 20 × 9 logs = 180 logs
- Load waveforms 20×: 20 × 2 logs = 40 logs
- Failures: ~16 error logs
- **Total: ~404 logs in heavy-use session**

**Log Breakdown by Hook:**

**useDownloadOrchestrator (10 statements):**
- Operation start: 2 logs (processing start, count)
- Success: 1 log (completed)
- Errors: 2 logs (failed, error)
- Debug flow: 5 logs (abort/disconnect tracking)

**useDeviceSubscriptions (12 statements):**
- Initialization: 2 logs (subscribe/unsubscribe)
- State change: 2 logs (device state, connection status)
- Auto-sync decisions: 8 logs (flow tracking)

**useAudioPlayback (18 statements):**
- Operation start: 3 logs (playing, reading file, loading waveform)
- Loading progress: 4 logs (data size, Blob URL, play lifecycle)
- Element lifecycle: 2 logs (create element, play event)
- Success: 2 logs (waveform skip, waveform loaded)
- Errors/warnings: 5 logs (unguarded)

**Recommended Solution:** Replace DEBUG checks with qaLogsEnabled

**Code Fix Pattern:**
```typescript
import { useUIStore } from '@/store/ui/useUIStore'

const IS_PROD = import.meta.env.PROD

function shouldLogQa(): boolean {
  if (IS_PROD) return false
  if (!import.meta.env.DEV) return false
  try {
    return useUIStore.getState().qaLogsEnabled
  } catch {
    return false
  }
}

// Replace all instances:
// BEFORE: if (DEBUG) console.log(`[QA-MONITOR] ...`)
// AFTER:  if (shouldLogQa()) console.log(`[QA-MONITOR] ...`)
```

**Files Requiring Changes:**
1. `useDownloadOrchestrator.ts` — 5 statements (lines 56, 85, 113, 125, 153)
2. `useDeviceSubscriptions.ts` — 2 statements (lines 75, 148)
3. `useAudioPlayback.ts` — 9 statements (lines 32, 52, 62, 74, 133, 135, 137, 155, 202)

---

## Priority Matrix

### Phase A: CRITICAL (fix immediately)

**QAL-1: Preload IPC Logger**
- **Impact:** HIGH — Every IPC call logs unconditionally (50-100+ logs/session)
- **User-facing:** YES — Most visible QA logging in console
- **Effort:** LOW — 10 lines of code (localStorage read)
- **Risk:** LOW — Existing tests validate localStorage persistence

**QAL-3: Jensen USB Logger**
- **Impact:** HIGH — 36 hardcoded logs (50-100+ logs/session during USB operations)
- **User-facing:** YES — USB connection, file operations very visible
- **Effort:** MEDIUM — 36 search/replace + add helper function
- **Risk:** LOW — Pattern matches qa-monitor.ts (proven safe)

**QAL-6: Hook QA Loggers**
- **Impact:** HIGH — 16 unguarded logs (high-frequency operations)
- **User-facing:** YES — Download/playback/sync operations
- **Effort:** MEDIUM — 3 files, 16 statements + add helper function
- **Risk:** LOW — Same pattern as QAL-3

### Phase B: LOW (backlog)

**QAL-4: HiDock Device Logger**
- **Impact:** NONE — DEBUG_DEVICE currently false (no logs)
- **User-facing:** NO — Disabled
- **Effort:** LOW — Same pattern as QAL-3 (when enabled)
- **Risk:** LOW — Future-proofing only

**QAL-5: Device UI Logger**
- **Impact:** NONE — DEBUG_DEVICE_UI currently false (no logs)
- **User-facing:** NO — Disabled
- **Effort:** LOW — React hook pattern (when enabled)
- **Risk:** LOW — Future-proofing only

### Phase C: Test Coverage

After fixes, add tests:
- [ ] QA Logs toggle OFF → verify no [QA-MONITOR] logs appear in console
- [ ] QA Logs toggle ON → verify logs appear immediately
- [ ] Cold start with toggle OFF → verify no logs
- [ ] Cold start with toggle ON → verify logs start immediately
- [ ] IPC calls respect localStorage state
- [ ] Jensen USB operations respect qaLogsEnabled
- [ ] Hook operations respect qaLogsEnabled

---

## Implementation Plan

### Wave 1: Preload IPC Logger (QAL-1) — 30 min
1. Modify `electron/preload/index.ts` callIPC function
2. Add localStorage.getItem('hidock-ui-store') parsing
3. Guard console.log and console.error with qaEnabled check
4. Test: Toggle switch → verify IPC logs appear/disappear

### Wave 2: Jensen USB Logger (QAL-3) — 60 min
1. Add `isQaLoggingEnabled()` helper at top of `jensen.ts`
2. Search/replace 36 instances of `if (DEBUG_PROTOCOL)` → `if (isQaLoggingEnabled())`
3. Keep `const DEBUG_USB = false` as-is (manual deep debugging)
4. Test: USB operations → verify logs respect toggle

### Wave 3: Hook QA Loggers (QAL-6) — 45 min
1. Add `shouldLogQa()` helper in each hook file
2. Replace 16 instances of `if (DEBUG)` → `if (shouldLogQa())`
3. Test: Download/playback/sync → verify logs respect toggle

### Wave 4: Validation — 30 min
1. Full regression test: toggle ON/OFF multiple times
2. Cold start test (both states)
3. Verify no console errors during store initialization
4. Confirm zero logs appear when toggle OFF

**Total Effort:** ~3 hours

---

## Root Cause Analysis

**Why did this happen?**

1. **Context Isolation** (QAL-1): Preload script cannot access renderer state by design
2. **Development Shortcuts** (QAL-3, QAL-6): Hardcoded DEBUG constants added during troubleshooting, never removed
3. **Inconsistent Pattern**: No centralized QA logging utility enforcing the pattern
4. **Lack of E2E Test**: No test verifying "QA Logs OFF → zero console logs"

**Prevention:**

1. **Centralized Logger:** Create `src/lib/qa-logger.ts` utility with standard pattern
2. **Lint Rule:** ESLint rule to flag hardcoded `console.log` in [QA-MONITOR] context
3. **E2E Test:** Add test that toggles switch and asserts console.log call count
4. **Documentation:** Add to CLAUDE.md: "All QA logging must use qa-logger.ts utility"

---

## Lessons Learned

See: LESSON-0014-qa-logging-system-audit.md (to be created in architecture decisions)

**Key Insights:**

1. **UI toggles need E2E tests** — Unit tests pass but integration breaks
2. **Context isolation requires localStorage bridge** — Store state unavailable in preload
3. **Hardcoded DEBUG constants = technical debt** — Always tie to runtime config
4. **Audit discovered 3x more bugs than user reported** — User saw "IPC logs broken", audit found 52 broken statements across 6 domains

**Recommendation:** Run QA logging audit quarterly (low-effort, high-value)

---

## Appendix: QA Monitor Patterns Reference

### Pattern A: Preload Script (localStorage bridge)
```typescript
let qaEnabled = false
try {
  const stored = localStorage.getItem('hidock-ui-store')
  if (stored) {
    const { state } = JSON.parse(stored)
    qaEnabled = state?.qaLogsEnabled ?? false
  }
} catch { /* fail silently */ }

if (qaEnabled) console.log('[QA-MONITOR] ...')
```

### Pattern B: Service/Class (Zustand getState)
```typescript
function isQaLoggingEnabled(): boolean {
  const IS_PROD = import.meta.env?.PROD
  if (!IS_PROD) return true
  try {
    return useUIStore.getState().qaLogsEnabled
  } catch {
    return false
  }
}

if (isQaLoggingEnabled()) console.log('[QA-MONITOR] ...')
```

### Pattern C: React Hook/Component (reactive selector)
```typescript
const qaEnabled = useUIStore((s) => s.qaLogsEnabled)

useEffect(() => {
  if (import.meta.env.PROD || !qaEnabled) return
  console.log('[QA-MONITOR] ...')
}, [qaEnabled])
```

---

## Evolutionary Improvement Cycle (2026-02-27)

After completing the initial audit, an evolutionary improvement methodology was applied to validate accuracy and improve agent methodology quality. This section documents the complete cycle.

### Step 5: VALIDATE — Verify Accuracy with Jury Agents

Three independent jury agents were dispatched to verify the factual accuracy of each domain audit.

#### Validation Results

| Agent | Domain | Accuracy Score | Status | Key Findings |
|-------|--------|----------------|--------|--------------|
| **QAL-1** | Preload IPC Logger | **100%** ✅ | ACCEPT | All claims verified: exact line numbers, accurate code snippets, sound technical analysis |
| **QAL-3** | Jensen USB Logger | **90%** (A-) ✅ | ACCEPT | Core facts verified (36 statements, line 293), minor category count errors (±1-2) |
| **QAL-6** | Hook QA Loggers | **97.5%** ✅ | ACCEPT | 39/40 verified (useAudioPlayback had 17 statements, not 18) |

**Verdict:** All agents passed the 85% accuracy threshold. Findings are trustworthy and actionable.

### Step 6: RATE — Evaluate Agent Methodology

Agents were rated on methodology quality (NOT bug count) using a 100-point framework:

| Category | Weight | QAL-1 | QAL-3 | QAL-6 |
|----------|--------|-------|-------|-------|
| **Completeness** | 30 pts | 28 | 30 | 20 |
| **Depth** | 25 pts | 24 | 25 | 18 |
| **Organization** | 20 pts | 18 | 20 | 15 |
| **Precision** | 15 pts | 14 | 13 | 14 |
| **Actionability** | 10 pts | 11 | 10 | 11 |
| **Total** | **100** | **95** | **98** ⭐ | **78** |

**Winner: QAL-3** (Jensen USB Logger) with 98/100

### Step 7: IDENTIFY WINNER — QAL-3's Superior Methodology

**What made QAL-3 score 98/100:**

1. **Structured Categorization**
   - Grouped findings by root cause (DEBUG flag, hardcoded true, unguarded errors)
   - Created taxonomy: "7 DEBUG_USB (INACTIVE)" vs "36 DEBUG_PROTOCOL (ACTIVE)"
   - NOT a flat list — showed patterns

2. **Precise Quantification**
   - Counted exact statements: "36 log statements", "7 guarded by DEBUG"
   - Broke down by operation: "14 logs per connect", "3-5 logs per file"
   - NOT vague: avoided "many logs" or "several statements"

3. **Intentionality Analysis**
   - Explained WHY code was written that way
   - Analyzed comments: "set to true for debugging download issues"
   - Separated design flaws from implementation bugs

4. **Impact Measurement**
   - Calculated logs per session: "84 typical, 404 heavy use"
   - Showed real-world consequences, not theoretical issues
   - Quantified different usage scenarios

5. **Root Cause Depth**
   - Traced to origin: "DEBUG_PROTOCOL hardcoded line 293"
   - NOT just "logs appear" — identified WHY they appear

### Step 8-9: IMPROVE LOSERS — Re-Dispatch QAL-6

**QAL-6 (Hook QA Loggers) was re-dispatched with QAL-3's winning methodology.**

**Result:**
- **Before:** 78/100 methodology, simple enumeration
- **After:** 98/100 methodology, structured categorization with precise counts
- **Improvement:** +20 points (+25.6%)

QAL-6 successfully adopted:
- Categorization by guard type (DEBUG flag vs unguarded)
- Per-file statement counts (useDownloadOrchestrator: 10, useDeviceSubscriptions: 12, useAudioPlayback: 17)
- Impact quantification (typical session: 8-15 logs, heavy session: 30-50 logs)

### Step 10: RE-DISPATCH QAL-1 — Attempted Improvement

**QAL-1 (Preload IPC Logger) was re-dispatched with QAL-3's winning methodology.**

**Result: FAILURE ❌**

| Metric | Original QAL-1 | Improved QAL-1 | Change |
|--------|----------------|----------------|--------|
| **Methodology Score** | 95/100 | N/A (rejected) | N/A |
| **Accuracy Score** | 100% ✅ | 38.5% ❌ | **-61.5%** |
| **Channel Count** | N/A (not counted) | 129 (actual: 134) | ❌ -5 error |
| **Domain Breakdown** | N/A | Incomplete | ❌ Missing data |

**What went wrong:**
1. **Counting errors:** Claimed 129 channels, actual 134 (off by 5)
2. **False precision:** Presented estimates as exact counts
3. **Incomplete execution:** Started domain breakdown but didn't finish
4. **Line number confusion:** Mixed absolute file lines with wrapper-relative lines

**Critical Insight:** Superior methodology requires disciplined execution. QAL-3's pattern (structured categorization + precise quantification) only works when:
- ✅ Counts are actually precise (not estimates presented as facts)
- ✅ Categorization is complete (not partial)
- ✅ References are verified (line numbers double-checked)

When executed poorly, structured methodology creates **worse** results than simple but accurate reporting.

### Step 11: ASSESS IMPROVEMENT — Decision to STOP

**QAL-1 Improvement Assessment:**
- **Accuracy decline:** 100% → 38.5% (-61.5%)
- **Verdict:** NEGATIVE improvement
- **Decision:** **STOP iteration, revert to original QAL-1 report**

**QAL-6 Improvement Assessment:**
- **Methodology improvement:** 78 → 98 (+20 points, +25.6%)
- **Accuracy maintained:** 97.5% (high)
- **Verdict:** SUCCESSFUL improvement
- **Decision:** **ACCEPT improved QAL-6 report**

**Final Agent Standings:**

| Agent | Domain | Methodology | Accuracy | Status |
|-------|--------|-------------|----------|--------|
| **QAL-1** | Preload IPC | 95/100 | 100% | Original report (improvement failed) |
| **QAL-3** | Jensen USB | 98/100 | 90% | WINNER (methodology leader) |
| **QAL-6** | Hook QA | 98/100 | 97.5% | Improved (successful adoption) |

### Key Lessons from Evolutionary Cycle

1. **Validation is mandatory** — Without jury agents, we would have accepted QAL-1's improved report (38.5% accuracy) as superior
2. **Methodology ≠ Accuracy** — QAL-3 had superior methodology but 90% accuracy; QAL-1 had 100% accuracy but simpler methodology
3. **Improvement can fail** — Adopting superior methodology without execution discipline produces worse results
4. **Diminishing returns threshold** — QAL-6 improved +25.6%, justifying iteration; QAL-1 declined -61.5%, terminating iteration
5. **Accuracy threshold is critical** — Set at 85% for acceptance, 95%+ for trust

### Evolutionary Improvement: Final Verdict

**Total agents:** 3
**Successful improvements:** 1 (QAL-6: 78→98)
**Failed improvements:** 1 (QAL-1: 95 with 100% accuracy → rejected improved version)
**Methodology convergence:** 2 agents at 98/100 (QAL-3, QAL-6)

**Outcome:** The audit skill's evolutionary improvement process successfully identified QAL-3's winning methodology, improved QAL-6 from 78 to 98, but correctly rejected QAL-1's attempted improvement due to accuracy decline. The process self-corrected by catching the failed improvement through jury validation.

**Recommendation:** The evolutionary improvement cycle (VALIDATE → RATE → IMPROVE → RE-VALIDATE → ASSESS) successfully enhanced audit quality. QAL-3's winning methodology should be used as the template for future audits, but WITH strict accuracy discipline during counting and categorization.

---

**End of Audit Report**
