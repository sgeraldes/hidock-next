# Library Component Performance Baseline

**Date**: 2026-01-05
**Branch**: library/phase1-filters
**Commit**: [To be filled after running tests]

## Test Environment
- Node: v20.x
- React: 18.3.1
- Vitest: 4.0.16
- Testing Library: 16.3.1
- Device: [To be filled with actual test environment]

## Overview

This document establishes the performance baseline for the Library component before Phase 6 optimizations. Tests are run using Vitest with jsdom environment and mocked data.

## Results

### Initial Render Time

| Item Count | Render Time | Target | Status |
|------------|-------------|--------|--------|
| 100        | TBD ms      | <100ms | TBD    |
| 1000       | TBD ms      | <200ms | TBD    |
| 5000       | TBD ms      | <500ms | TBD    |

**Notes**:
- Render time measured from component mount to library-list element appearing in DOM
- Uses mocked useUnifiedRecordings hook with generated UnifiedRecording data
- Virtualization via @tanstack/react-virtual is active (renders ~50 items in viewport)
- Baseline targets are generous to establish current performance level

### Scroll Performance

| Metric | Value | Target | Status |
|--------|-------|--------|--------|
| Avg FPS (5000 items) | N/A | 60fps | N/A |
| Min FPS | N/A | 30fps | N/A |
| Frame drops | N/A | 0 | N/A |

**⚠️ Testing Limitation - Scroll FPS**:
- jsdom (used by Vitest) does **not** perform real browser rendering
- Cannot accurately measure scroll FPS in unit tests
- Scroll test in suite provides timing data but **not true frame rates**
- **Recommendation**: Implement Playwright tests for real browser scroll performance measurement

### Filter Performance

| Filter Type | Application Time | Target | Status |
|-------------|-----------------|--------|--------|
| Location    | TBD ms          | <100ms | TBD    |

**Notes**:
- Filter application measured from button click to DOM update completion
- Tests location filter (all → device-only transition)
- Uses React's useTransition for non-blocking updates

### View Mode Switch

| Transition | Time | Target | Status |
|------------|------|--------|--------|
| Card → List | TBD ms | <100ms | TBD |

**Notes**:
- View mode switch measured from button click to DOM update completion
- Switches from card view (default) to compact list view
- Component re-renders with different layout

## Test Execution

### Running Performance Tests

```bash
cd apps/electron
npm run test:performance
```

### Sample Output

```
✓ src/__tests__/performance/library-performance.test.ts (5)
  ✓ Library Performance (5)
    ✓ renders 100 items within performance budget
      Render time for 100 items: XX.XXms
    ✓ renders 1000 items within performance budget
      Render time for 1000 items: XX.XXms
    ✓ renders 5000 items within performance budget
      Render time for 5000 items: XX.XXms
    ✓ applies filters within performance budget
      Filter application time: XX.XXms
    ✓ switches view modes within performance budget
      View switch time: XX.XXms
    ✓ measures scroll interaction timing (jsdom - limited)
      Average simulated scroll FPS: XX.XX (jsdom - not real rendering)
```

## Optimization Priority

Based on baseline results, prioritize:

1. **TBD** - To be filled after analyzing test results
2. **TBD** - To be filled after analyzing test results
3. **TBD** - To be filled after analyzing test results

## Comparison to Phase 6 Targets

| Target | Current | Gap | Priority |
|--------|---------|-----|----------|
| <100ms render (1000) | TBD ms | TBD ms | TBD |
| 60fps scroll | N/A* | N/A* | HIGH** |
| No UI freeze | TBD | - | TBD |

\* Scroll FPS cannot be measured in jsdom environment
\*\* Implement Playwright tests for real browser scroll performance

## Known Limitations

### jsdom Environment
- **No pixel rendering**: jsdom parses HTML/CSS but doesn't render to screen
- **No layout engine**: CSS layout calculations are simulated
- **No GPU acceleration**: Browser rendering optimizations are not tested
- **Scroll events are synthetic**: No real scrolling behavior

### Mock Data
- Generated recordings use simplified metadata
- No transcript or meeting data enrichment in tests
- File paths are placeholder strings
- Dates are generated programmatically

### Virtualization
- @tanstack/react-virtual is mocked to render subset of items
- Real virtualization behavior may differ from mock
- Scroll container measurements are simulated

## Recommendations

### For Accurate Performance Testing

1. **Implement Playwright Tests**
   - Use real browser (Chromium/Firefox/WebKit)
   - Measure actual scroll FPS with Performance API
   - Test on various screen sizes and devices
   - Capture CPU/GPU metrics during rendering

2. **Add Performance Monitoring**
   - Integrate React DevTools Profiler in development
   - Use Chrome DevTools Performance tab for production builds
   - Monitor bundle size impact of optimizations
   - Track real user metrics (if applicable)

3. **Baseline Updates**
   - Re-run tests after each major optimization
   - Document performance improvements in this file
   - Version baselines by date and commit hash
   - Maintain historical baseline data for trend analysis

## Next Steps

1. Run initial performance tests: `npm run test:performance`
2. Fill in TBD values in this document with actual measurements
3. Analyze results and identify optimization opportunities
4. Prioritize optimizations based on biggest impact
5. Implement Phase 6 optimizations (virtualization improvements, memo optimization, etc.)
6. Re-test and update baseline with improvements
