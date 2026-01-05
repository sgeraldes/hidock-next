# TODO-013: Capture Performance Baseline

## Status: PENDING

## Phase: 2 (Validation - NEW)

## Priority: HIGH

## Summary
Measure current Library performance to establish baseline before Phase 6 optimizations. Without baseline metrics, we cannot measure improvement.

## Problem
- Phase 6 targets specific metrics (<100ms mount, 60fps scroll)
- No current performance data exists
- Cannot measure improvement without baseline
- Risk of performance regressions going unnoticed

## Acceptance Criteria
- [ ] Initial render time measured with 100, 1000, 5000 items
- [ ] Scroll FPS measured with 5000 items
- [ ] Filter application time measured
- [ ] View mode switch time measured
- [ ] Results documented in performance report
- [ ] Performance test harness exists for regression testing

## Implementation Steps

### Step 0: Add data-testid Attributes to Components

**Prerequisite**: Before performance tests can run, add `data-testid` attributes to Library components:

```typescript
// In apps/electron/src/pages/Library.tsx and related components
<div data-testid="library-list">...</div>
<button data-testid="location-filter">...</button>
<button data-testid="grid-view-toggle">...</button>
<div data-testid="source-card">...</div>
```

**Required test IDs**:
- `library-list` - Main recording list container
- `location-filter` - Location filter button/dropdown
- `grid-view-toggle` - Grid/list view toggle button
- `source-card` - Individual recording card in grid view

### Step 1: Create Mock Data Generator

```typescript
// apps/electron/src/__tests__/performance/mockData.ts
import { UnifiedRecording } from '@/types/unified-recording'

/**
 * Generate mock UnifiedRecording objects for performance testing.
 * Creates a mix of device-only, local-only, and both-locations recordings.
 */
export function generateMockRecordings(count: number): UnifiedRecording[] {
  return Array.from({ length: count }, (_, i) => {
    const location = ['device-only', 'local-only', 'both'][i % 3] as const
    const baseDate = new Date(Date.now() - i * 86400000)

    // Base fields common to all recording types
    const base = {
      id: `mock-${i}`,
      filename: `recording-${i + 1}.wav`,
      size: 1024 * 1024 * (i % 50 + 1), // 1-50 MB
      duration: Math.floor(Math.random() * 3600), // 0-3600 seconds
      dateRecorded: baseDate,
      transcriptionStatus: 'none' as const,
      title: `Recording ${i + 1}`,
      category: ['meeting', 'note', 'memo'][i % 3],
      quality: ['high', 'medium', 'low'][i % 3] as 'high' | 'medium' | 'low',
    }

    // Return discriminated union based on location
    if (location === 'device-only') {
      return {
        ...base,
        location: 'device-only',
        deviceFilename: `REC${String(i).padStart(4, '0')}.WAV`,
        syncStatus: i % 2 === 0 ? 'not-synced' : 'syncing',
      }
    } else if (location === 'local-only') {
      return {
        ...base,
        location: 'local-only',
        localPath: `/path/to/recordings/${base.filename}`,
        syncStatus: 'synced',
        isImported: i % 10 === 0,
      }
    } else {
      return {
        ...base,
        location: 'both',
        deviceFilename: `REC${String(i).padStart(4, '0')}.WAV`,
        localPath: `/path/to/recordings/${base.filename}`,
        syncStatus: 'synced',
      }
    }
  })
}
```

### Step 2: Create Performance Test Suite

```typescript
// apps/electron/src/__tests__/performance/library-performance.test.ts
import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import { Library } from '@/pages/Library'
import { generateMockRecordings } from './mockData'
import { useUnifiedRecordings } from '@/hooks/useUnifiedRecordings'

describe('Library Performance', () => {
  const testCases = [100, 1000, 5000]

  testCases.forEach(count => {
    it(`renders ${count} items within performance budget`, async () => {
      const recordings = generateMockRecordings(count)

      // Mock the store/API to return our test data
      vi.mocked(useUnifiedRecordings).mockReturnValue({
        data: recordings,
        isLoading: false,
      })

      const start = performance.now()
      render(<Library />)

      await waitFor(() => {
        expect(screen.getByTestId('library-list')).toBeInTheDocument()
      })

      const end = performance.now()
      const renderTime = end - start

      console.log(`Render time for ${count} items: ${renderTime.toFixed(2)}ms`)

      // Phase 6 target: <100ms for 1000 items
      if (count <= 1000) {
        expect(renderTime).toBeLessThan(200) // Generous baseline
      }
    })
  })

  // NOTE: Scroll FPS tests have limitations in jsdom
  // jsdom doesn't trigger real browser rendering, so FPS measurements are synthetic
  // For accurate scroll performance testing, use Playwright with real browser
  it('measures scroll interaction timing (jsdom - limited)', async () => {
    const recordings = generateMockRecordings(5000)

    vi.mocked(useUnifiedRecordings).mockReturnValue({
      data: recordings,
      isLoading: false,
    })

    render(<Library />)

    const list = screen.getByTestId('library-list')

    // Measure frame rate during scroll simulation
    // NOTE: This is NOT real FPS - jsdom doesn't render pixels
    // Use Playwright for real browser scroll testing
    const frames: number[] = []
    let lastTime = performance.now()

    const measureFrame = () => {
      const now = performance.now()
      const fps = 1000 / (now - lastTime)
      frames.push(fps)
      lastTime = now
    }

    // Simulate scroll events
    for (let i = 0; i < 100; i++) {
      list.scrollTop += 50
      fireEvent.scroll(list)
      await new Promise(r => requestAnimationFrame(r))
      measureFrame()
    }

    const avgFps = frames.reduce((a, b) => a + b, 0) / frames.length
    console.log(`Average simulated scroll FPS: ${avgFps.toFixed(2)} (jsdom - not real rendering)`)

    // This test provides timing data but not real FPS
    // For production, implement Playwright scroll tests
  })

  it('applies filters within performance budget', async () => {
    const recordings = generateMockRecordings(1000)

    vi.mocked(useUnifiedRecordings).mockReturnValue({
      data: recordings,
      isLoading: false,
    })

    render(<Library />)

    const start = performance.now()

    // Trigger filter change
    const filterButton = screen.getByTestId('location-filter')
    fireEvent.click(filterButton)

    await waitFor(() => {
      expect(screen.getByText(/filtered/i)).toBeInTheDocument()
    })

    const end = performance.now()
    const filterTime = end - start

    console.log(`Filter application time: ${filterTime.toFixed(2)}ms`)

    // Should feel instant (<50ms)
    expect(filterTime).toBeLessThan(100)
  })

  it('switches view modes within performance budget', async () => {
    const recordings = generateMockRecordings(1000)

    vi.mocked(useUnifiedRecordings).mockReturnValue({
      data: recordings,
      isLoading: false,
    })

    render(<Library />)

    const start = performance.now()

    const gridViewButton = screen.getByTestId('grid-view-toggle')
    fireEvent.click(gridViewButton)

    await waitFor(() => {
      expect(screen.getByTestId('source-card')).toBeInTheDocument()
    })

    const end = performance.now()
    const switchTime = end - start

    console.log(`View switch time: ${switchTime.toFixed(2)}ms`)

    expect(switchTime).toBeLessThan(100)
  })
})
```

**Testing Limitation - Scroll FPS**:
- jsdom (used by Vitest) doesn't perform real browser rendering
- Cannot accurately measure scroll FPS in unit tests
- Recommendation: Implement Playwright tests for real browser scroll performance measurement
- The above test provides timing data but not true frame rates

### Step 3: Create Performance Report Template

```markdown
# Library Component Performance Baseline

**Date**: YYYY-MM-DD
**Branch**: library/phase1-filters
**Commit**: [hash]

## Test Environment
- Node: v20.x
- React: 18.x
- Device: [CPU/RAM specs]

## Results

### Initial Render Time

| Item Count | Render Time | Target | Status |
|------------|-------------|--------|--------|
| 100        | XXXms       | <50ms  | ✅/❌  |
| 1000       | XXXms       | <100ms | ✅/❌  |
| 5000       | XXXms       | <200ms | ✅/❌  |

### Scroll Performance

| Metric | Value | Target | Status |
|--------|-------|--------|--------|
| Avg FPS (5000 items) | XX fps | 60fps | ✅/❌ |
| Min FPS | XX fps | 30fps | ✅/❌ |
| Frame drops | XX | 0 | ✅/❌ |

### Filter Performance

| Filter Type | Application Time | Target | Status |
|-------------|-----------------|--------|--------|
| Location    | XXXms           | <50ms  | ✅/❌  |
| Category    | XXXms           | <50ms  | ✅/❌  |
| Search      | XXXms           | <100ms | ✅/❌  |

### View Mode Switch

| Transition | Time | Target | Status |
|------------|------|--------|--------|
| List → Grid | XXXms | <100ms | ✅/❌ |
| Grid → List | XXXms | <100ms | ✅/❌ |

## Optimization Priority

Based on baseline results, prioritize:

1. [Highest impact optimization]
2. [Second priority]
3. [Third priority]

## Comparison to Phase 6 Targets

| Target | Current | Gap | Priority |
|--------|---------|-----|----------|
| <100ms render (1000) | XXXms | XXms | HIGH/MED/LOW |
| 60fps scroll | XXfps | XXfps | HIGH/MED/LOW |
| No UI freeze | Yes/No | - | HIGH/MED/LOW |
```

### Step 4: Run Tests and Document

```bash
# Run performance tests
cd apps/electron
npm run test:performance

# Generate report
npm run test:performance -- --reporter=json > performance-baseline.json
```

---

## Test Requirements

### Automated Tests
- [ ] Render time benchmarks (100, 1000, 5000 items)
- [ ] Scroll FPS measurement
- [ ] Filter application timing
- [ ] View mode switch timing

### CI Integration
- [ ] Performance tests run on PR
- [ ] Fail build if regression >20%
- [ ] Baseline storage strategy implemented
- [ ] Environment normalization configured

**Baseline Storage Strategy**:
1. **Initial Baseline Capture**
   - Run performance tests on main branch
   - Store baseline metrics in `docs/performance/baseline.json`
   - Commit baseline to repository

2. **Baseline Updates**
   - Update baseline when intentional improvements are made
   - Require manual review/approval for baseline changes
   - Version baselines by date/commit hash

3. **PR Comparison**
   - Load baseline from `docs/performance/baseline.json`
   - Compare PR metrics against baseline
   - Fail if any metric regresses >20% from baseline
   - Report percentage difference in CI output

**Environment Normalization**:
1. **CI Runner Consistency**
   - Pin GitHub Actions runner type (e.g., ubuntu-latest with specific specs)
   - Document runner CPU/RAM for baseline correlation

2. **Resource Isolation**
   - Run performance tests in isolated step (no parallel jobs)
   - Clear caches/temp data before test run
   - Disable CPU throttling if possible

3. **Variance Handling**
   - Run each test 3 times, take median value
   - Allow ±10% variance for flaky network/disk I/O
   - Flag >10% variance as unstable test

4. **Baseline Format**
   ```json
   {
     "version": "1.0.0",
     "capturedAt": "2025-01-05T10:00:00Z",
     "commit": "abc123",
     "environment": {
       "node": "20.x",
       "runner": "ubuntu-latest",
       "cpu": "2-core",
       "ram": "7GB"
     },
     "metrics": {
       "render_100": { "median": 45, "p95": 55 },
       "render_1000": { "median": 95, "p95": 120 },
       "render_5000": { "median": 180, "p95": 220 },
       "filter_apply": { "median": 25, "p95": 40 },
       "view_switch": { "median": 50, "p95": 70 }
     }
   }
   ```

---

## Files to Create
- `apps/electron/src/__tests__/performance/mockData.ts`
- `apps/electron/src/__tests__/performance/library-performance.test.ts`
- `docs/performance/library-baseline.md`

## Files to Modify
- `apps/electron/package.json` (add test:performance script)
- `apps/electron/vitest.config.ts` (performance test config)

## Dependencies
- Phase 1 must be complete (Library.tsx stable)
- Mock data generator needed

## Success Criteria
- Baseline metrics documented
- Performance test harness works
- CI integration configured
- Clear comparison to Phase 6 targets
