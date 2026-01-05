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

### Step 1: Create Mock Data Generator

```typescript
// apps/electron/src/__tests__/performance/mockData.ts
import { UnifiedRecording } from '@/types/unified-recording'

export function generateMockRecordings(count: number): UnifiedRecording[] {
  return Array.from({ length: count }, (_, i) => ({
    id: `mock-${i}`,
    title: `Recording ${i + 1}`,
    duration: Math.floor(Math.random() * 3600),
    createdAt: new Date(Date.now() - i * 86400000).toISOString(),
    status: 'local',
    source: 'hidock',
    category: ['meeting', 'note', 'memo'][i % 3],
    quality: ['high', 'medium', 'low'][i % 3],
    // ... other required fields
  }))
}
```

### Step 2: Create Performance Test Suite

```typescript
// apps/electron/src/__tests__/performance/library-performance.test.ts
import { render, screen, waitFor } from '@testing-library/react'
import { Library } from '@/pages/Library'
import { generateMockRecordings } from './mockData'

describe('Library Performance', () => {
  const testCases = [100, 1000, 5000]

  testCases.forEach(count => {
    it(`renders ${count} items within performance budget`, async () => {
      const recordings = generateMockRecordings(count)

      // Mock the store/API to return our test data
      vi.mocked(useRecordings).mockReturnValue({
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

  it('maintains 60fps during scroll with 5000 items', async () => {
    const recordings = generateMockRecordings(5000)

    vi.mocked(useRecordings).mockReturnValue({
      data: recordings,
      isLoading: false,
    })

    render(<Library />)

    const list = screen.getByTestId('library-list')

    // Measure frame rate during scroll simulation
    const frames: number[] = []
    let lastTime = performance.now()

    const measureFrame = () => {
      const now = performance.now()
      const fps = 1000 / (now - lastTime)
      frames.push(fps)
      lastTime = now
    }

    // Simulate scroll
    for (let i = 0; i < 100; i++) {
      list.scrollTop += 50
      await new Promise(r => requestAnimationFrame(r))
      measureFrame()
    }

    const avgFps = frames.reduce((a, b) => a + b, 0) / frames.length
    console.log(`Average scroll FPS: ${avgFps.toFixed(2)}`)

    // Should maintain at least 30fps (60fps is ideal)
    expect(avgFps).toBeGreaterThan(30)
  })

  it('applies filters within performance budget', async () => {
    const recordings = generateMockRecordings(1000)

    vi.mocked(useRecordings).mockReturnValue({
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

    vi.mocked(useRecordings).mockReturnValue({
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
