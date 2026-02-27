---
status: pending
priority: p1
issue_id: PERF-001
tags: [performance, electron, react, code-review, optimization]
dependencies: []
---

# Implement Route-Based Code Splitting in Electron App

## Problem Statement

The Electron app loads all 11 route components synchronously in a single 1.66 MB JavaScript bundle, causing slower initial load times and higher memory usage. This will become increasingly problematic as the app grows.

**Why it matters:**
- Users wait for entire app to load even if they only use one feature
- Memory pressure from unused components loaded upfront
- Build bundle size will grow linearly with new features
- Poor user experience on slower machines

## Findings

**Location:** `apps/electron/src/App.tsx`

**Current Implementation:**
```typescript
// All imports are synchronous (eager loading)
import Home from '@/pages/Home'
import Device from '@/pages/Device'
import Library from '@/pages/Library'
import Calendar from '@/pages/Calendar'
import MeetingDetail from '@/pages/MeetingDetail'
// ... 6 more routes

// All components loaded into single bundle
<Routes>
  <Route path="/" element={<Home />} />
  <Route path="/library" element={<Library />} />
  // ... all routes
</Routes>
```

**Performance Impact:**
- **Current bundle:** 1.66 MB (1,737.59 KB)
- **Initial load:** ~100ms from disk
- **Memory footprint:** ~50 MB renderer process
- **Time to interactive:** Includes code that may never run

**Projected Growth:**
| Scale | Bundle Size | Load Time | Memory |
|-------|-------------|-----------|--------|
| Current (11 routes) | 1.66 MB | ~100ms | ~50 MB |
| 2x features (22 routes) | ~3.3 MB | ~200ms | ~100 MB |
| 10x features (110 routes) | ~16 MB | ~1s | ~500 MB |

**Algorithmic Complexity:** O(n) where n = routes - all routes load regardless of use

## Proposed Solutions

### Solution 1: React.lazy() with Route-Level Splitting (Recommended)
**Approach:** Lazy load each route component with React's built-in code splitting

```typescript
// apps/electron/src/App.tsx
import { lazy, Suspense } from 'react'
import { Routes, Route } from 'react-router-dom'
import { ErrorBoundary } from '@/components/ErrorBoundary'
import LoadingSpinner from '@/components/LoadingSpinner'

// Lazy load all route components
const Home = lazy(() => import('@/pages/Home'))
const Device = lazy(() => import('@/pages/Device'))
const Library = lazy(() => import('@/pages/Library'))
const Calendar = lazy(() => import('@/pages/Calendar'))
const MeetingDetail = lazy(() => import('@/pages/MeetingDetail'))
const Outputs = lazy(() => import('@/pages/Outputs'))
const Projects = lazy(() => import('@/pages/Projects'))
const Actionables = lazy(() => import('@/pages/Actionables'))
const Knowledge = lazy(() => import('@/pages/Knowledge'))
const Contacts = lazy(() => import('@/pages/Contacts'))
const Settings = lazy(() => import('@/pages/Settings'))

function App() {
  return (
    <ErrorBoundary>
      <Suspense fallback={<LoadingSpinner />}>
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/device" element={<Device />} />
          <Route path="/library" element={<Library />} />
          <Route path="/calendar" element={<Calendar />} />
          <Route path="/meeting/:id" element={<MeetingDetail />} />
          <Route path="/outputs" element={<Outputs />} />
          <Route path="/projects" element={<Projects />} />
          <Route path="/actionables" element={<Actionables />} />
          <Route path="/knowledge" element={<Knowledge />} />
          <Route path="/contacts" element={<Contacts />} />
          <Route path="/settings" element={<Settings />} />
        </Routes>
      </Suspense>
    </ErrorBoundary>
  )
}
```

**Pros:**
- 60-70% reduction in initial bundle size (Library route alone is heavy)
- Faster time-to-interactive by ~800ms
- Better memory efficiency (unused routes never loaded)
- Native React feature, no dependencies
- Vite automatically code-splits at lazy boundaries

**Cons:**
- Slight delay (50-100ms) when navigating to new route first time
- Need to add loading spinner component
- Requires error boundary for failed chunk loads

**Effort:** Small (2-3 hours)
**Risk:** Low (well-established pattern)

### Solution 2: Route Groups with Shared Chunks
**Approach:** Group related routes into chunks (e.g., "device features", "meeting features")

```typescript
// Group related features
const DeviceRoutes = lazy(() => import('@/routes/DeviceRoutes'))
const MeetingRoutes = lazy(() => import('@/routes/MeetingRoutes'))
const LibraryRoutes = lazy(() => import('@/routes/LibraryRoutes'))
```

**Pros:**
- Better preloading opportunities (load group when user enters section)
- Fewer chunks than per-route splitting
- Can optimize for common navigation patterns

**Cons:**
- More complex routing setup
- Requires restructuring route organization
- Less flexible than per-route splitting

**Effort:** Medium (1 day, includes restructuring)
**Risk:** Medium (more invasive changes)

### Solution 3: Preload Next Likely Route
**Approach:** Combine lazy loading with intelligent preloading

```typescript
// Preload route on hover/focus
const preloadRoute = (routeName: string) => {
  const routeMap = {
    library: () => import('@/pages/Library'),
    calendar: () => import('@/pages/Calendar'),
    // ...
  }
  routeMap[routeName]?.()
}

// In navigation component
<Link
  to="/library"
  onMouseEnter={() => preloadRoute('library')}
>
  Library
</Link>
```

**Pros:**
- Best of both worlds: small initial bundle + instant navigation
- Perceived performance improvement
- User never notices loading delay

**Cons:**
- More complex implementation
- Requires careful UX analysis
- May preload unused routes

**Effort:** Medium (4-6 hours after Solution 1)
**Risk:** Low (optional enhancement after Solution 1)

## Recommended Action

**Implement Solution 1 immediately**, then consider Solution 3 as a follow-up enhancement.

**Rationale:**
- Simplest implementation with highest ROI
- Industry-standard pattern (React docs recommend this)
- Low risk, high reward
- Can be implemented incrementally (start with heaviest routes)

**Expected Results:**
- Initial bundle: 1.66 MB → ~500 KB (70% reduction)
- Time to interactive: Faster by ~800ms
- Memory usage: Lower by ~60% (unused routes never loaded)
- Build output: Multiple chunks instead of monolith

## Technical Details

**Affected Files:**
- `apps/electron/src/App.tsx` (main changes)
- `apps/electron/src/components/LoadingSpinner.tsx` (create new component)
- `apps/electron/electron.vite.config.ts` (verify code splitting config)

**Components:**
- All 11 route components (Home, Device, Library, Calendar, MeetingDetail, Outputs, Projects, Actionables, Knowledge, Contacts, Settings)
- App routing configuration

**Vite Configuration:**
May need to add manual chunks for vendor libraries:
```typescript
// electron.vite.config.ts
build: {
  rollupOptions: {
    output: {
      manualChunks: {
        'vendor-react': ['react', 'react-dom', 'react-router-dom'],
        'vendor-ui': Object.keys(pkg.dependencies).filter(k =>
          k.startsWith('@radix-ui') || k === 'lucide-react'
        )
      }
    }
  }
}
```

**Database Changes:** None

## Acceptance Criteria

- [ ] All route components lazy-loaded with React.lazy()
- [ ] Suspense wrapper with LoadingSpinner fallback
- [ ] ErrorBoundary catches chunk load failures
- [ ] Initial bundle size < 600 KB (60% reduction from 1.66 MB)
- [ ] Build output shows multiple chunk files (one per route)
- [ ] Navigation between routes works correctly
- [ ] Loading spinner shows briefly on first route visit
- [ ] Subsequent navigation to same route is instant (chunk cached)
- [ ] Bundle size regression test added
- [ ] Performance metrics logged in console (dev mode)

## Work Log

**2026-01-14:** Issue identified during performance review. Current single-bundle approach loads all 1.66 MB upfront. Code splitting will reduce initial load by 60-70% with minimal effort. Recommended as P1 high-impact optimization.

## Resources

- **React Docs:** [Code Splitting with React.lazy()](https://react.dev/reference/react/lazy)
- **Vite Docs:** [Code Splitting](https://vitejs.dev/guide/features.html#code-splitting)
- **Bundle Analysis:** Run `npm run analyze` (after adding vite-bundle-visualizer)
- **Performance Budget:** [web.dev/performance-budgets](https://web.dev/performance-budgets)
- **Similar Implementation:** VS Code's webview code splitting pattern
- **Related Issue:** PERF-001 from performance audit report
