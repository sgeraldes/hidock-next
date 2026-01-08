# Task: Wire Actionables UI to Auto-Detected Data

## Track: C (Actionables Auto-Population)
## Priority: MEDIUM
## Dependencies: todo-wave1-c-001-actionable-detection.md, todo-wave1-c-002-actionables-handlers.md

## Current State
The Actionables page exists (`apps/electron/src/pages/Actionables.tsx`) but displays static/empty data since actionables aren't auto-populated.

## What's Missing
- Display newly detected actionables from transcription
- UI for reviewing/approving/dismissing detected actionables
- Integration with output generation workflow
- Status indicators (pending, in_progress, generated)

## Implementation Notes
**UI Requirements:**

1. **Actionables List:**
   - Show pending actionables first (AI-detected, needs review)
   - Display: type icon, title, source recording, confidence, suggested template
   - Actions: Approve (generate output), Dismiss, Edit

2. **Actionable Detail View:**
   - Full description (why detected)
   - Source recording link (navigate to Library)
   - Suggested recipients (editable)
   - Template selector (dropdown)
   - Generate button → triggers output generation

3. **Status Workflow:**
   - **Pending** (yellow badge) - "Review Suggestion"
   - **In Progress** (blue badge) - "Generating..."
   - **Generated** (green badge) - "View Output" link
   - **Dismissed** (gray badge) - Hidden by default

4. **Filters:**
   - By status: All, Pending, Generated, Dismissed
   - By type: Meeting Minutes, Interview Feedback, etc.
   - By source recording

## Acceptance Criteria
- [ ] Display all pending actionables on page load
- [ ] Show actionable type icons (meeting, interview, report, decision, action items)
- [ ] Display confidence score (visual indicator like progress bar)
- [ ] Implement "Approve" button → changes status to in_progress, triggers generation
- [ ] Implement "Dismiss" button → changes status to dismissed
- [ ] Show generated output link when status is 'generated'
- [ ] Add filters for status and type
- [ ] Link to source recording (navigate to Library page)
- [ ] Handle empty state gracefully ("No actionables detected yet")

## Files to Modify
- `apps/electron/src/pages/Actionables.tsx`
- May need: `apps/electron/src/components/ActionableCard.tsx` (if creating new component)

## Files to Reference
- `apps/electron/src/pages/Library.tsx` (for similar list/filter patterns)
- `apps/electron/src/components/ui/*` (existing UI components)

## Related Specs
- Plan: Wave 1 - Track C
- Design: Should match existing app style

## Security Considerations
- Validate actionable IDs before operations
- Sanitize display of AI-generated content (XSS prevention)
- Ensure users can't trigger generation for invalid actionables
