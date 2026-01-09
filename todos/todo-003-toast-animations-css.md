# Task 003: Add Toast Animations to CSS

**Priority:** MEDIUM
**Track:** Toast Notifications (Track C)
**Dependencies:** todo-002-toast-component-update.md
**Estimated Effort:** 30 minutes

---

## Objective

Add smooth slide-in animation for toast notifications to enhance user experience.

## Current State

**Files:**
- `apps/electron/src/index.css` or
- `apps/electron/src/styles/globals.css` (need to verify which exists)

Currently no animations defined for toasts. Toasts appear instantly without smooth transition.

## What's Missing

1. **@keyframes slide-in Animation**
   - from: translateX(100%) opacity 0 (off-screen right)
   - to: translateX(0) opacity 1 (on-screen)

2. **Animation Class**
   - .animate-slide-in class
   - Duration: 0.3s
   - Easing: ease-out

3. **Application**
   - Toast component already uses animate-slide-in class
   - Just need to define the CSS

## Implementation Requirements

### Files to Modify
- `apps/electron/src/index.css` (preferred) or
- `apps/electron/src/styles/globals.css` (if that's where styles live)

### CSS to Add
```css
@keyframes slide-in {
  from {
    transform: translateX(100%);
    opacity: 0;
  }
  to {
    transform: translateX(0);
    opacity: 1;
  }
}

.animate-slide-in {
  animation: slide-in 0.3s ease-out;
}
```

### Acceptance Criteria
- [ ] @keyframes slide-in defined
- [ ] .animate-slide-in utility class defined
- [ ] Animation duration is 0.3s
- [ ] Easing function is ease-out
- [ ] No CSS syntax errors
- [ ] Animation works in Electron app (test with toast trigger)

### Security Considerations
None - CSS only, no user input

### Testing Requirements
- Visual test: Toast slides in smoothly from right
- Visual test: Animation completes in ~300ms
- Visual test: No jank or visual glitches
- Manual test: Multiple toasts animate independently

## Dependencies
- **RECOMMENDED:** Complete Task 002 first to test animation with actual toasts

## Notes
- This is a simple task but critical for UX polish
- Could be done in parallel with Task 002 if needed
- Verify correct CSS file location before implementing
