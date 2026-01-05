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
npm install -D @axe-core/playwright axe-core
```

### Step 2: Create Accessibility Test Suite

```typescript
// apps/electron/src/__tests__/accessibility/library-a11y.test.ts
import { test, expect } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'

test.describe('Library Accessibility', () => {
  test('should have no accessibility violations', async ({ page }) => {
    await page.goto('/library')

    const accessibilityScanResults = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa'])
      .analyze()

    expect(accessibilityScanResults.violations).toEqual([])
  })

  test('list view should be accessible', async ({ page }) => {
    await page.goto('/library')
    await page.click('[data-testid="list-view-toggle"]')

    const results = await new AxeBuilder({ page }).analyze()
    expect(results.violations.filter(v => v.impact === 'critical')).toEqual([])
  })

  test('grid view should be accessible', async ({ page }) => {
    await page.goto('/library')
    await page.click('[data-testid="grid-view-toggle"]')

    const results = await new AxeBuilder({ page }).analyze()
    expect(results.violations.filter(v => v.impact === 'critical')).toEqual([])
  })
})
```

### Step 3: Keyboard Navigation Testing

Test the following keyboard interactions:

| Key | Expected Behavior | Component |
|-----|-------------------|-----------|
| Arrow Up/Down | Navigate list items | SourceRow list |
| Arrow Left/Right | Navigate grid items | SourceCard grid |
| Tab | Move focus to next interactive element | All |
| Shift+Tab | Move focus to previous element | All |
| Enter | Open detail drawer for focused item | SourceRow/Card |
| Escape | Close detail drawer | SourceDetailDrawer |
| Space | Toggle selection for focused item | SourceRow/Card |
| Ctrl+A | Select all visible items | Library container |
| Delete | Delete selected items (with confirmation) | BulkActionsBar |

### Step 4: Screen Reader Testing Checklist

#### NVDA (Windows)
- [ ] Library page announces correctly on load
- [ ] List items read title, duration, date
- [ ] Selection state announced ("selected"/"not selected")
- [ ] Bulk actions bar reads count ("3 items selected")
- [ ] Filter changes announced via LiveRegion
- [ ] Detail drawer focus trapped correctly
- [ ] Error states announced appropriately

#### VoiceOver (macOS)
- [ ] Same checklist as NVDA
- [ ] Rotor navigation works for headings/links

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
[axe-core output]

## Manual Testing Results
### Keyboard Navigation
[Matrix results]

### Screen Reader Testing
[NVDA/VoiceOver results]

## Issues Found
[List any violations with severity]

## Remediation Plan
[If issues found, steps to fix]

## Compliance Statement
[Formal statement of compliance level]
```

---

## Test Requirements

### Automated Tests
- [ ] axe-core scans for list view
- [ ] axe-core scans for grid view
- [ ] axe-core scans for detail drawer open
- [ ] axe-core scans for bulk actions active

### Manual Tests
- [ ] Complete keyboard navigation matrix
- [ ] NVDA screen reader walkthrough
- [ ] Focus management during view switches

---

## Files to Create
- `apps/electron/src/__tests__/accessibility/library-a11y.test.ts`
- `docs/accessibility/library-audit-report.md`

## Files to Modify
- `apps/electron/package.json` (add axe-core dependency)
- `plans/library-todos/README.md` (update Phase 5 status if issues found)

## Dependencies
- Phase 1 must be complete (filter state persists)
- Existing accessibility components (useKeyboardNavigation, LiveRegion)

## Success Criteria
- 0 critical/serious axe-core violations
- All keyboard navigation works
- Screen reader announces all dynamic content
- Formal compliance documentation exists
