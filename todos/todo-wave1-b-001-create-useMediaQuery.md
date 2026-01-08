# Task: Create useMediaQuery Hook for Responsive Layouts

## Track: B (FIX-004 Responsive Breakpoints)
## Priority: MEDIUM
## Dependencies: None

## Current State
No media query hook exists. The tri-pane layout doesn't adapt to different screen sizes.

## What's Missing
A reusable React hook that detects screen size breakpoints and returns boolean flags for responsive layout decisions.

## Implementation Notes
- Create hook in `apps/electron/src/hooks/useMediaQuery.ts`
- Support common breakpoints: mobile (<768px), tablet (<1024px), desktop (>=1024px)
- Use `window.matchMedia()` API for efficient media query matching
- Handle component mounting/unmounting correctly
- Return boolean or breakpoint string for easy conditional rendering

**Example API:**
```typescript
const { isMobile, isTablet, isDesktop } = useMediaQuery()
// OR
const breakpoint = useMediaQuery() // returns 'mobile' | 'tablet' | 'desktop'
```

## Acceptance Criteria
- [ ] Create `apps/electron/src/hooks/useMediaQuery.ts`
- [ ] Implement media query detection using `window.matchMedia()`
- [ ] Support breakpoints: mobile (<768px), tablet (<1024px), desktop (>=1024px)
- [ ] Add proper TypeScript types
- [ ] Handle window resize events efficiently (debounced or via matchMedia listeners)
- [ ] Clean up listeners on component unmount
- [ ] Export hook as default or named export

## Files to Create
- `apps/electron/src/hooks/useMediaQuery.ts` (NEW)

## Files to Reference
- Existing hooks in `apps/electron/src/hooks/` for patterns
- TriPaneLayout will use this hook in next task

## Related Specs
- FIX-004 spec: `.claude/specs/fix-004-responsive-breakpoints.md` (if exists)
- Plan: Wave 1 - Track B

## Security Considerations
- No direct security impact
- Ensure proper cleanup to prevent memory leaks
