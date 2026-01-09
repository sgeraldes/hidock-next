# Task 002: Update Toast Component with All Variants

**Priority:** HIGH
**Track:** Toast Notifications (Track C)
**Dependencies:** todo-001-toast-variants-uistore.md
**Estimated Effort:** 2-3 hours

---

## Objective

Update the Toast component to display all toast variants (success, error, info, warning) with appropriate icons, colors, and styling.

## Current State

**File:** `apps/electron/src/components/Toast.tsx`

Current implementation only shows error toasts:
- Uses AlertCircle icon
- Red background (bg-red-600)
- Fixed error message display
- No support for multiple toast types

## What's Missing

1. **Icon Mapping**
   - success → CheckCircle (lucide-react)
   - error → AlertCircle (lucide-react)
   - info → Info (lucide-react)
   - warning → AlertTriangle (lucide-react)

2. **Color Mapping**
   - success → bg-green-600
   - error → bg-red-600
   - info → bg-blue-600
   - warning → bg-yellow-600

3. **Multiple Toast Display**
   - Iterate over toasts array from UIStore
   - Display all toasts stacked vertically
   - Each toast independently dismissible

4. **Integration with New UIStore**
   - Read toasts from useUIStore()
   - Use removeToast action for close button
   - Remove old error-only logic

## Implementation Requirements

### Files to Modify
- `apps/electron/src/components/Toast.tsx`

### New Imports Required
```typescript
import { CheckCircle, AlertCircle, Info, AlertTriangle, X } from 'lucide-react'
import { useUIStore } from '@/store/useUIStore'
```

### Acceptance Criteria
- [ ] TOAST_ICONS constant defined mapping type to icon component
- [ ] TOAST_COLORS constant defined mapping type to color class
- [ ] Component reads toasts array from UIStore
- [ ] Component reads removeToast action from UIStore
- [ ] Renders all toasts in fixed bottom-4 right-4 z-50 container
- [ ] Each toast shows correct icon and color based on type
- [ ] Each toast has close button (X) that calls removeToast
- [ ] Toasts stack vertically with space-y-2
- [ ] No TypeScript errors
- [ ] Component handles empty toasts array gracefully

### Security Considerations
- All toast messages come from app (not user input)
- XSS protection via React's automatic escaping

### Testing Requirements
- Component test: Renders success toast with green background
- Component test: Renders error toast with red background
- Component test: Renders info toast with blue background
- Component test: Renders warning toast with yellow background
- Component test: Multiple toasts stack correctly
- Component test: Close button removes specific toast
- Visual test: All 4 variants display correctly in Electron app

## Dependencies
- **BLOCKS:** Task 001 must be completed first (UIStore changes)

## Notes
- Reference the approved plan for exact implementation code
- Ensure accessibility (proper ARIA labels if needed)
- Keep existing styling patterns (px-4 py-3 rounded-lg shadow-lg)
