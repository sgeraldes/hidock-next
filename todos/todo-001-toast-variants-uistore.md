# Task 001: Add Toast Variants to UIStore

**Priority:** HIGH
**Track:** Toast Notifications (Track C)
**Dependencies:** None
**Estimated Effort:** 1-2 hours

---

## Objective

Extend the UIStore to support multiple toast notification variants (success, error, info, warning) with queue management and auto-dismissal.

## Current State

**File:** `apps/electron/src/store/useUIStore.ts`

Current implementation only handles error toasts via a separate mechanism. The UIStore needs to be extended to:
- Manage a queue of toast messages
- Support multiple variant types
- Auto-dismiss toasts after 5 seconds
- Provide helper functions for easy toast creation

## What's Missing

1. **ToastMessage Interface**
   - id: string (unique identifier)
   - type: 'success' | 'error' | 'info' | 'warning'
   - message: string
   - timestamp: number

2. **State Management**
   - toasts: ToastMessage[] array in UIStore
   - addToast(type, message) action
   - removeToast(id) action

3. **Auto-Dismissal Logic**
   - setTimeout to remove toast after 5 seconds
   - Cleanup function to prevent memory leaks

4. **Convenience Helpers**
   - Export toast object with success(), error(), info(), warning() methods
   - These should call useUIStore.getState().addToast()

## Implementation Requirements

### Files to Modify
- `apps/electron/src/store/useUIStore.ts`
- `apps/electron/src/types/stores.ts` (if type definitions need updating)

### Acceptance Criteria
- [ ] ToastMessage interface defined with all required fields
- [ ] toasts array added to UIStore state
- [ ] addToast action creates unique IDs and adds to queue
- [ ] Auto-dismiss setTimeout implemented (5 seconds)
- [ ] removeToast action filters toast by ID
- [ ] Export toast helper object with 4 methods (success, error, info, warning)
- [ ] No TypeScript errors
- [ ] Follows existing Zustand patterns in the file

### Security Considerations
- No user input in toast messages (all messages are app-generated)
- IDs generated securely (no collisions)

### Testing Requirements
- Unit test: Adding toast creates correct object structure
- Unit test: Auto-dismiss removes toast after 5 seconds
- Unit test: Multiple toasts can exist simultaneously
- Unit test: Helper functions call addToast with correct type

## Dependencies
None - this task is independent

## Notes
- Reference the approved plan at `.claude/plans/melodic-jumping-kurzweil.md` for implementation details
- Follow existing Zustand patterns in useUIStore.ts
- Ensure TypeScript types are properly exported
