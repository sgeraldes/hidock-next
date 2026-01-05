# TODO-012: Validate Accessibility Compliance

## Status: PENDING

## Phase: 2 (Validation - NEW)

## Priority: HIGH

## Summary
Validate that Phase 5 accessibility implementation meets WCAG 2.1 AA standards. README claims Phase 5 complete but no validation evidence exists.

## Problem
- Phase 5 marked "COMPLETE" in README without validation
- No audit report or test results documented
- Screen reader compatibility unverified
- Keyboard navigation matrix not tested
- WCAG 2.1 AA compliance claims unsubstantiated

## Acceptance Criteria
- [ ] axe-core audit passes with 0 critical/serious violations
- [ ] NVDA screen reader test passes (Windows)
- [ ] VoiceOver test passes (macOS, if available)
- [ ] Keyboard navigation test matrix complete
- [ ] WCAG 2.1 AA compliance documented
- [ ] Audit report created at `docs/accessibility/library-audit-report.md`

## Implementation Steps

### Step 1: Install axe-core Testing Tools

```bash
cd apps/electron
npm install -D jest-axe
```

### Step 2: Create Accessibility Test Suite

```typescript
// apps/electron/src/__tests__/accessibility/library-a11y.test.ts
import { describe, it, expect } from 'vitest'
import { render } from '@testing-library/react'
import { axe, toHaveNoViolations } from 'jest-axe'
import { Library } from '@/features/library/components/Library'

expect.extend(toHaveNoViolations)

describe('Library Accessibility', () => {
  it('should have no accessibility violations in list view', async () => {
    const { container } = render(<Library />)
    const results = await axe(container, {
      rules: {
        // Test WCAG 2.1 AA criteria
        'color-contrast': { enabled: true },
        'focus-visible': { enabled: true },
        'heading-order': { enabled: true }
      }
    })
    expect(results).toHaveNoViolations()
  })

  it('should have no accessibility violations in grid view', async () => {
    const { container } = render(<Library initialView="grid" />)
    const results = await axe(container, {
      rules: {
        'color-contrast': { enabled: true },
        'focus-visible': { enabled: true },
        'heading-order': { enabled: true }
      }
    })
    expect(results).toHaveNoViolations()
  })

  it('should have no violations with detail drawer open', async () => {
    const { container, getByRole } = render(<Library />)
    // Open detail drawer for first item
    const firstItem = getByRole('option')
    firstItem.click()

    const results = await axe(container)
    expect(results).toHaveNoViolations()
  })
})
```

### Step 3: Keyboard Navigation Testing

Test the following keyboard interactions (based on actual `useKeyboardNavigation.ts` implementation):

| Key | Expected Behavior | Component | Status |
|-----|-------------------|-----------|--------|
| Arrow Up/Down | Navigate list items | SourceRow list | ✅ Implemented |
| Home | Jump to first item | SourceRow list | ✅ Implemented |
| End | Jump to last item | SourceRow list | ✅ Implemented |
| Tab | Move focus to next interactive element | All | ✅ Browser default |
| Shift+Tab | Move focus to previous element | All | ✅ Browser default |
| Enter | Open detail drawer for focused item | SourceRow | ✅ Implemented |
| Escape | Clear selection (if any selected) | Library container | ✅ Implemented |
| Space | Toggle selection for focused item | SourceRow | ✅ Implemented |
| Ctrl+A / Cmd+A | Select all visible items | Library container | ✅ Implemented |
| Arrow Left/Right | Navigate grid items | SourceCard grid | ❌ NOT implemented |
| Delete | Delete selected items | BulkActionsBar | ❌ NOT implemented |

**Note**: Arrow Left/Right and Delete key are NOT currently implemented in `useKeyboardNavigation.ts`. These should either be:
- Added to the hook implementation, OR
- Documented as known gaps in the audit report

### Step 4: Screen Reader Testing Checklist

#### NVDA (Windows)
- [ ] Library page announces correctly on load
- [ ] SourceRow items read title, duration, date (has `role="option"` and `tabIndex={0}`)
- [ ] SourceCard items announce correctly (⚠️ **MISSING**: needs `role="option"` and `tabIndex`)
- [ ] Selection state announced ("selected"/"not selected")
- [ ] Bulk actions bar reads count ("3 items selected")
- [ ] Filter changes announced via LiveRegion
- [ ] Detail drawer focus trapped correctly
- [ ] Error states announced appropriately
- [ ] Color contrast meets WCAG 2.1 AA (1.4.3)
- [ ] Focus indicators visible (2.4.7)
- [ ] Heading structure is logical (1.3.1)

#### VoiceOver (macOS)
- [ ] Same checklist as NVDA
- [ ] Rotor navigation works for headings/links

#### Known Issues to Document
- **SourceCard accessibility gap**: Unlike SourceRow which has `role="option"` and `tabIndex={0}`, SourceCard is missing these ARIA attributes. Grid view cards need:
  - `role="option"` for proper screen reader announcement
  - `tabIndex={0}` for keyboard focus
  - Similar keyboard navigation support as list view

### Step 5: Document Results

Create audit report at `docs/accessibility/library-audit-report.md`:

```markdown
# Library Component Accessibility Audit

**Date**: YYYY-MM-DD
**Auditor**: [Name/Agent]
**Standard**: WCAG 2.1 AA

## Executive Summary
[Pass/Fail with summary]

## Automated Testing Results
[jest-axe output from Vitest tests]

### WCAG 2.1 AA Criteria Tested
- **1.4.3 Contrast (Minimum)**: Color contrast ratios meet AA standards
- **2.4.7 Focus Visible**: Keyboard focus indicators are clearly visible
- **1.3.1 Info and Relationships**: Heading structure and semantic markup
- **2.1.1 Keyboard**: All functionality available via keyboard
- **4.1.2 Name, Role, Value**: ARIA attributes correctly implemented

## Manual Testing Results
### Keyboard Navigation
[Matrix results - see Step 3 for complete matrix]

#### Implemented Features
- ✅ Arrow Up/Down navigation in list view
- ✅ Home/End for jumping to first/last item
- ✅ Space to toggle selection
- ✅ Enter to open detail drawer
- ✅ Escape to clear selection
- ✅ Ctrl/Cmd+A to select all

#### Known Gaps
- ❌ Arrow Left/Right for grid view navigation
- ❌ Delete key for bulk deletion

### Screen Reader Testing
[NVDA/VoiceOver results]

## Issues Found
[List any violations with severity]

### Expected Findings
1. **SourceCard missing accessibility attributes** (Medium severity)
   - Missing `role="option"`
   - Missing `tabIndex` for keyboard focus
   - Affects grid view only (list view SourceRow is compliant)

2. **Incomplete keyboard navigation** (Low severity)
   - Grid view lacks arrow left/right navigation
   - Delete key not implemented for bulk actions

## Remediation Plan
[If issues found, steps to fix]

### Priority 1: Fix SourceCard Accessibility
Add to `SourceCard.tsx`:
- `role="option"`
- `tabIndex={0}` or appropriate focus management
- `onKeyDown` handler for keyboard interactions

### Priority 2: Complete Keyboard Navigation
Extend `useKeyboardNavigation.ts`:
- Add ArrowLeft/ArrowRight support for grid view
- Add Delete key handler for bulk deletion

## Compliance Statement
[Formal statement of compliance level]
```

---

## Test Requirements

### Automated Tests
- [ ] jest-axe scans for list view (Vitest)
- [ ] jest-axe scans for grid view (Vitest)
- [ ] jest-axe scans for detail drawer open (Vitest)
- [ ] jest-axe scans for bulk actions active (Vitest)
- [ ] WCAG 2.1 AA color contrast (1.4.3)
- [ ] Focus visible validation (2.4.7)
- [ ] Heading structure validation (1.3.1)

### Manual Tests
- [ ] Complete keyboard navigation matrix
- [ ] NVDA screen reader walkthrough
- [ ] Focus management during view switches

---

## Files to Create
- `apps/electron/src/__tests__/accessibility/library-a11y.test.ts` (Vitest + jest-axe)
- `docs/accessibility/library-audit-report.md`

## Files to Modify
- `apps/electron/package.json` (add `jest-axe` dependency)
- `plans/library-todos/README.md` (update Phase 5 status with known gaps)

## Potential Fixes Required (Based on Audit)
- `apps/electron/src/features/library/components/SourceCard.tsx` (add ARIA attributes)
- `apps/electron/src/features/library/hooks/useKeyboardNavigation.ts` (add grid navigation, Delete key)

## Dependencies
- Phase 1 must be complete (filter state persists)
- Existing accessibility components (useKeyboardNavigation, LiveRegion)

## Success Criteria
- 0 critical/serious axe-core violations
- All keyboard navigation works
- Screen reader announces all dynamic content
- Formal compliance documentation exists
