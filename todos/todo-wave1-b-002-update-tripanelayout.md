# Task: Update TriPaneLayout for Responsive Breakpoints

## Track: B (FIX-004 Responsive Breakpoints)
## Priority: MEDIUM
## Dependencies: todo-wave1-b-001-create-useMediaQuery.md

## Current State
`TriPaneLayout.tsx` renders a fixed three-pane layout regardless of screen size, causing usability issues on tablet and mobile devices.

## What's Missing
- Responsive layout adaptation based on screen size
- Tablet layout: Two-pane view (<1024px)
- Mobile layout: Single pane with tab navigation (<768px)

## Implementation Notes
**Desktop (>=1024px):**
- Current three-pane layout (left panel, center content, right assistant)

**Tablet (<1024px):**
- Collapse to two panes
- Hide right panel by default, show on toggle
- Keep left panel + center content visible

**Mobile (<768px):**
- Single pane view
- Tab navigation between: List | Detail | Assistant
- Full-width content for each view

**Use `useMediaQuery` hook** from previous task to detect breakpoints.

## Acceptance Criteria
- [ ] Import and use `useMediaQuery` hook
- [ ] Implement desktop layout (>=1024px) - existing three-pane
- [ ] Implement tablet layout (<1024px) - two-pane with toggleable right panel
- [ ] Implement mobile layout (<768px) - single pane with tab navigation
- [ ] Test transitions between breakpoints work smoothly
- [ ] Preserve user's panel size preferences when returning to desktop
- [ ] Ensure keyboard navigation (F6) still works

## Files to Modify
- `apps/electron/src/features/library/components/TriPaneLayout.tsx`

## Files to Reference
- `useMediaQuery.ts` (from previous task)
- Existing `ResizablePanel` components for desktop layout

## Related Specs
- FIX-003: Panel min constraints (ensure compatibility)
- Plan: Wave 1 - Track B

## Security Considerations
- No security implications
- Ensure state management doesn't leak across layout modes
