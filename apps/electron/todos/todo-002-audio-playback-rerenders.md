# TODO-002: Fix useAudioPlayback 60 FPS Re-renders

**Priority**: CRITICAL - Showstopper #2
**Phase**: A
**Domain**: State Management / Audio Playback
**Audit Reference**: COMPREHENSIVE_BUG_AUDIT_WAVE2.md - State Management CRITICAL

## Problem

The `useAudioPlayback` hook causes 60 re-renders per second during audio playback due to full store subscription with destructuring. This is a severe performance issue that degrades the entire UI during playback.

## Current State

From audit findings:
- `useAudioPlayback` uses full store subscription: `const { ... } = useAppStore()`
- This causes re-render on EVERY store change
- During audio playback, progress updates trigger 60 FPS (16.67ms intervals)
- All components using `useAudioPlayback` re-render 60 times per second
- UI becomes sluggish, choppy, and unresponsive

## Root Cause

Full store subscription with destructuring:
```typescript
// WRONG - causes re-render on ANY store change
const { isPlaying, currentTime, duration } = useAppStore()
```

This subscribes to the ENTIRE store. Zustand uses `Object.is` for equality, so every state update (even unrelated) triggers a re-render.

## What's Missing

Granular selectors with proper equality checking:
```typescript
// CORRECT - only re-render when these specific fields change
const isPlaying = useAppStore((s) => s.isPlaying)
const currentTime = useAppStore((s) => s.currentTime)
const duration = useAppStore((s) => s.duration)
```

Or use `useShallow` for derived objects:
```typescript
const { isPlaying, currentTime } = useAppStore(useShallow((s) => ({
  isPlaying: s.isPlaying,
  currentTime: s.currentTime
})))
```

## Files Affected

- Location of `useAudioPlayback` hook (likely in `src/hooks/` or `src/features/audio/`)
- Any components using this hook
- Related stores (likely `useAppStore` or `useAudioStore`)

## Dependencies

- Understanding of Zustand selector patterns
- Knowledge of React re-render optimization
- See: `.claude/rules/zustand-stores.md` for selector conventions

## Acceptance Criteria

- [ ] `useAudioPlayback` uses granular selectors (NOT full store subscription)
- [ ] Components using audio playback re-render ONLY when relevant audio state changes
- [ ] Performance profiling shows <5 re-renders per second during playback
- [ ] Audio playback progress still updates smoothly (no visual regression)
- [ ] All tests pass
- [ ] Documentation updated with selector pattern example

## Testing

- Measure re-render count with React DevTools Profiler during playback
- Should see ~1 re-render per second (progress updates) not 60
- Verify no performance degradation in audio playback
- Check that pause/play/seek operations still work correctly

## Related Bugs

- State Management CRITICAL: Full store subscription with destructuring in useAudioPlayback
- This is ERROR-0004 from architecture decisions registry (if it exists)
