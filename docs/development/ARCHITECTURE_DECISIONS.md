# HiDock-Next Expert: Architectural Decision Registry

**Purpose:** Capture software development decisions, architecture patterns, errors encountered, and lessons learned. This registry serves as the "second opinion" during development to prevent repeating past mistakes and ensure consistency with established patterns.

**Maintainer:** HiDock-Next Expert Agent
**Created:** 2026-01-11
**Last Updated:** 2026-01-12

---

## How to Use This Registry

### Before Development (Consultation Phase)
1. Read relevant sections before starting implementation
2. Check for established patterns in the same area
3. Verify decisions align with existing architecture
4. Ask "Has this problem been solved before?"

### After Development (Update Phase)
1. Document new architectural decisions made
2. Record errors encountered and their solutions
3. Capture lessons learned for future reference
4. Update patterns when new conventions emerge

---

## Table of Contents

1. [Core Architecture Decisions](#core-architecture-decisions)
2. [Data Model Patterns](#data-model-patterns)
3. [UI/UX Conventions](#uiux-conventions)
4. [Common Errors & Solutions](#common-errors--solutions)
5. [Technology Choices](#technology-choices)
6. [Testing Strategies](#testing-strategies)

---

## Core Architecture Decisions

### CAD-002: Inline Row Expansion with Virtualizer
**Date:** 2026-01-12
**Context:** Phase 2 - Inline Row Expansion
**Decision:** Use CSS Grid animation combined with proper virtualizer re-measurement for expandable rows

**Details:**
- **Approach:** Expand content inline within the virtualized list, not in a separate panel
- **Animation:** CSS Grid `grid-template-rows: 0fr → 1fr` for smooth expand/collapse
- **Virtualizer:** @tanstack/react-virtual with dynamic height via `measureElement`
- **State Management:** Zustand store with `expandedRowIds` Set for multi-expansion support

**Implementation Pattern:**
```tsx
// SourceRow.tsx - Single wrapper div (NOT Fragment) for proper measurement
return (
  <div>
    <div className="source-row-content">...</div>
    {isExpanded && (
      <div className="source-row__expand-container expanded">
        <SourceRowExpanded ... />
      </div>
    )}
  </div>
)

// Library.tsx - Re-measure after expansion state changes
useEffect(() => {
  requestAnimationFrame(() => {
    rowVirtualizer.measure()
  })
}, [expandedRowIds, rowVirtualizer])
```

**Critical Lessons:**
1. **No CSS animation duration** - Animations break virtualizer height measurement
2. **Single wrapper div** - React Fragments break `measureElement` ref
3. **requestAnimationFrame** - Required before `measure()` for accurate DOM measurement
4. **Theme-aware styling** - Use `bg-muted` not hard-coded colors

**Files:**
- `apps/electron/src/features/library/components/SourceRow.tsx`
- `apps/electron/src/features/library/components/SourceRowExpanded.tsx`
- `apps/electron/src/pages/Library.tsx`
- `apps/electron/src/index.css`

---

### CAD-001: Generic Artifact Title Architecture
**Date:** 2026-01-11
**Context:** Phase 1 - Fix Row Visibility
**Decision:** Use `title` as the universal, highest-priority display name for all content types

**Details:**
- **Field:** `recording.title` (in UnifiedRecording), `source.title` (in SourceBase), etc.
- **Purpose:** Generic artifact title that applies to recordings, notes, documents, presentations, or any other piece of content
- **Priority:** `title` > `filename` (filename is the fallback)
- **Initialization:** Initially same as filename, but updated when:
  - AI generates a better title (via transcription/analysis)
  - Human manually renames the artifact
  - Knowledge is obtained about the content's true purpose

**Established Pattern:**
```typescript
// CORRECT pattern (used throughout codebase)
{recording.title || recording.filename}
{source.title || source.filename}
```

**Anti-patterns:**
```typescript
// WRONG: Using filename as primary
{recording.filename}

// WRONG: Complex fallback chains with wrong hierarchy
{recording.transcript?.title_suggestion || meeting?.subject || recording.title || recording.filename}
```

**Why:**
- `title` is semantic and content-aware (describes WHAT it is)
- `filename` is technical and location-aware (describes WHERE it is)
- `meeting.subject` is calendar metadata (wrong conceptual level)
- `transcript.title_suggestion` is a suggestion, not the actual title (wrong ownership)

**Files Using This Pattern:**
- `apps/electron/src/features/library/components/SourceCard.tsx:108`
- `apps/electron/src/features/library/components/SourceReader.tsx:61`
- `apps/electron/src/features/library/utils/adapters.ts:53,98`

**Violated By:**
- ~~`apps/electron/src/features/library/components/SourceRow.tsx:87`~~ ✅ FIXED in Phase 1 (2026-01-12)

---

## Data Model Patterns

### DMP-001: UnifiedRecording Type Structure
**Date:** 2026-01-11
**Location:** `apps/electron/src/types/unified-recording.ts`

**Key Fields (in priority order for display):**
1. `title: string | undefined` - Generic artifact title (AI or human-edited)
2. `filename: string` - Technical filename (immutable)
3. `meetingId: string | undefined` - Link to associated meeting
4. `transcriptionStatus: TranscriptionStatus` - Processing state
5. `dateRecorded: Date` - Capture timestamp

**Relationships:**
- May link to `Meeting` (via `meetingId`) for calendar metadata
- May link to `Transcript` (via implicit relation) for AI-generated content
- May link to `KnowledgeCapture` (via `knowledgeCaptureId`) for organized knowledge

**Display Priority:**
```typescript
Primary: recording.title || recording.filename
Secondary: formatDateTime(dateRecorded) + duration + meeting.subject
```

### DMP-002: Source Type Hierarchy
**Date:** 2026-01-11
**Location:** `apps/electron/src/features/library/types/source.ts`

**Base Interface:** `SourceBase`
- All source types inherit from this
- Required field: `title: string` (NOT optional at this level)
- All sources MUST have a display title

**Source Types:**
- `AudioSource` (recordings)
- `PDFSource` (documents)
- `MarkdownSource` (notes)
- `ImageSource` (screenshots, photos)
- `WebClipSource` (saved web content)

**Consistency Rule:** All display logic should use `source.title || source.filename` pattern

---

## UI/UX Conventions

### UX-001: Responsive Container Queries for Panels
**Date:** 2026-01-11
**Context:** Phase 1 - SourceRow responsive behavior
**Decision:** Use `@tailwindcss/container-queries` for panel-aware responsive behavior

**Why Container Queries (not viewport media queries):**
- Left panel width: 20-35% of viewport (190-350px actual width)
- Viewport media queries would break at wrong widths
- Container queries respond to panel size, not screen size

**Established Breakpoints:**
```css
@[200px]  /* Minimum width to show buttons */
@[300px]  /* Show badge text, show filename */
@[400px]  /* Show button labels, increase spacing */
```

**Pattern:**
```tsx
<div className="@container">
  <span className="hidden @[400px]:inline">Label</span>
</div>
```

**Files Using This Pattern:**
- `apps/electron/tailwind.config.js` (plugin enabled)
- `apps/electron/src/features/library/components/SourceRow.tsx` ✅ Implemented in Phase 1 (2026-01-12)

### UX-002: Responsive Content Priority
**Date:** 2026-01-11
**Context:** Phase 1 - Content visibility at narrow widths

**Priority Order (Most to Least Important):**
1. **Title/Description** - ALWAYS visible, max space allocation
2. **Status Badges** - ALWAYS visible, icon-only at narrow
3. **Date/Duration** - Can wrap to second line
4. **Filename** - Minimum 15 characters visible, hidden below 300px
5. **Action Buttons** - Hide labels below 400px, hide completely below 200px (show on hover)

**Implementation:**
- Content: `flex-basis: 150px` (guarantees minimum space)
- Badges: Icon-only below 300px
- Buttons: Progressive hiding with hover fallback

---

## Common Errors & Solutions

### ERR-001: Conflicting Tailwind Classes
**Date:** 2026-01-11
**Error:** Conflicting `min-width` classes on same element
**Example:**
```tsx
// WRONG: Both min-w-0 and min-w-[100px] on same element
<div className="min-w-0 flex-1 min-w-[100px]">
```

**Why This Happens:**
- Tailwind applies both classes, but only last one in CSS cascade wins
- Creates unpredictable behavior depending on CSS generation order

**Solution:**
```tsx
// CORRECT: Use flex-basis with inline style instead
<div className="flex-1 flex-shrink-0" style={{flexBasis: '150px'}}>
```

**Lesson:** When you need minimum space guarantees with flex, use `flex-basis` in inline styles, not conflicting utility classes.

### ERR-002: Premature Implementation Without Approval
**Date:** 2026-01-11
**Error:** Implemented container query changes before plan approval
**Impact:** User frustration, wasted effort, need to revert/replan

**What Happened:**
1. Made changes to `tailwind.config.js` and `SourceRow.tsx`
2. Added `@container`, changed breakpoints, added `min-w-[100px]`
3. User had not approved the plan yet
4. Changes were based on wrong understanding of requirements

**Solution:**
- ALWAYS wait for explicit approval before implementation
- Use plan mode to get sign-off on approach
- Don't assume implied approval from conversation

**Lesson:** "I hate that you implemented it without me approving the plan" - Plan mode exists for a reason. Use it.

### ERR-003: Wrong Architecture Understanding
**Date:** 2026-01-11
**Error:** Thought `transcript.title_suggestion` was the primary title field
**Impact:** Plan was based on wrong data model

**What Happened:**
1. Assumed LLM-generated title was stored in `transcript.title_suggestion`
2. Created complex fallback chain: `title_suggestion || meeting.subject || title || filename`
3. User corrected: "It is not title recording or meeting subject. The most important field should be called something like source.title or artifact.title"

**Actual Architecture:**
- `title` is the generic artifact title (AI or human-edited)
- `transcript.title_suggestion` is just a suggestion (not the canonical title)
- Simple pattern: `title || filename`

**Solution:**
1. Explore codebase for existing usage patterns
2. Find similar components using the same data
3. Verify with user before assuming complex logic

**Lesson:** When unsure about data model, look at how other components use the same types. Consistency is key.

### ERR-004: Virtualizer Row Overlap with Animated Expansion
**Date:** 2026-01-12
**Error:** Expanded rows overlapped with rows below them in virtualized list
**Impact:** CRITICAL - Made entire feature unusable

**What Happened:**
1. Implemented CSS Grid animation (`transition: grid-template-rows 200ms`)
2. Expanded content animated smoothly
3. BUT virtualizer measured height DURING animation, not after
4. Virtual rows positioned based on mid-animation height
5. Result: Rows overlapped visually

**Root Cause:**
- `@tanstack/react-virtual` calls `measureElement` immediately
- CSS animation means DOM height is changing over 200ms
- Virtualizer gets wrong height, positions next rows incorrectly

**Solution:**
```css
/* REMOVE animation - instant height change */
.source-row__expand-container {
  display: grid;
  grid-template-rows: 0fr;
  /* NO transition property */
}
.source-row__expand-container.expanded {
  grid-template-rows: 1fr;
}
```

```tsx
// Re-measure after expansion state changes
useEffect(() => {
  requestAnimationFrame(() => {
    rowVirtualizer.measure()
  })
}, [expandedRowIds, rowVirtualizer])
```

**Lesson:** With virtualized lists, animation and dynamic measurement are incompatible. Choose one. If you need smooth UX, consider alternatives like opacity fade instead of height animation.

### ERR-005: React Fragment Breaks Virtualizer measureElement
**Date:** 2026-01-12
**Error:** Virtualizer couldn't measure row height properly
**Impact:** Row heights were wrong, causing overlap

**What Happened:**
1. SourceRow returned `<>...</>` (React Fragment) as root
2. Virtualizer's `measureElement` ref was attached to Fragment
3. Fragments have no DOM node, so `getBoundingClientRect()` fails
4. Virtualizer fell back to estimated height (wrong)

**Solution:**
```tsx
// WRONG - Fragment has no DOM node
return (
  <>
    <div className="row-content">...</div>
    <div className="expanded-content">...</div>
  </>
)

// CORRECT - Single wrapper div for measureElement
return (
  <div>
    <div className="row-content">...</div>
    <div className="expanded-content">...</div>
  </div>
)
```

**Lesson:** When using virtualization with `measureElement`, ALWAYS use a single wrapper element as root. Never use React Fragments.

### ERR-006: Hard-coded Colors Don't Match Theme
**Date:** 2026-01-12
**Error:** Used inline styles with hard-coded colors (#e5e7eb)
**Impact:** Colors didn't match dark/light theme system

**What Happened:**
1. Tailwind classes weren't applying (suspected HMR issue)
2. Tried inline styles: `style={{backgroundColor: '#e5e7eb'}}`
3. Colors looked wrong in dark mode
4. User pointed out inconsistency with rest of app

**Solution:**
Use theme-aware Tailwind classes:
```tsx
// WRONG - hard-coded color
<div style={{backgroundColor: '#e5e7eb'}}>

// CORRECT - theme-aware
<div className="bg-muted shadow-md">
```

**Lesson:** NEVER use hard-coded colors. Always use Tailwind theme classes (`bg-muted`, `bg-background`, `bg-card`, etc.) that respect the color scheme.

### ERR-007: Git Rebase Instead of Merge
**Date:** 2026-01-12
**Error:** Used `git rebase origin/main` when user explicitly asked to "pull changes from main"
**Impact:** User frustration, had to reset and redo properly

**What Happened:**
1. User said: "pull changes from main"
2. I ran: `git rebase origin/main`
3. This rewrote branch history instead of creating a merge commit
4. User was furious: "rebase? why rebase? explain this to me"

**Solution:**
1. Reset to before rebase: `git reset --hard <commit-before-rebase>`
2. Proper merge: `git fetch origin main && git merge origin/main`

**Lesson:**
- "pull changes" means MERGE, not rebase
- NEVER rebase unless explicitly requested
- A hook has been added to prevent accidental rebase

---

## Technology Choices

### TECH-001: Tailwind Container Queries Plugin
**Date:** 2026-01-11
**Package:** `@tailwindcss/container-queries`
**Reason:** Enable panel-aware responsive behavior

**Installation:**
```bash
npm install @tailwindcss/container-queries
```

**Configuration:**
```javascript
// tailwind.config.js
module.exports = {
  plugins: [
    require('@tailwindcss/container-queries')
  ]
}
```

**Usage:**
```tsx
<div className="@container">
  <span className="hidden @[400px]:inline">Responsive</span>
</div>
```

**Why This Choice:**
- Panels have variable widths (20-35% of viewport)
- Viewport media queries insufficient
- Container queries solve the "component doesn't know parent size" problem

---

## Testing Strategies

### TEST-001: Electron App Automated Testing
**Date:** 2026-01-11
**Requirement:** MANDATORY automated testing for all Electron app changes

**Tools:**
- Electron MCP server (for app control)
- Screenshot capture (for visual verification)
- Console inspection (for runtime error detection)

**Required Steps:**
1. Start app using Electron MCP
2. Take screenshots at multiple widths
3. Execute test interactions (clicks, inputs, navigation)
4. Check console for errors using `browser_console_messages`
5. Verify network requests completed successfully
6. Test the actual feature implemented

**Documentation:**
- ALL testing must be documented in QA reports
- NEVER say "manual testing recommended" without automated testing
- Stop hook will BLOCK completion if testing is missing

**Lesson:** "Manual testing delays are unacceptable. The app MUST actually run before claiming success."

---

## Technical Debt

### TD-001: SourceRow Responsive Fine-Tuning
**Date:** 2026-01-12
**Context:** Phase 1 - Fix Row Visibility
**Status:** NEEDS FINE-TUNING
**Priority:** Medium

**What Was Implemented:**
- ✅ Primary text uses `recording.title || recording.filename` pattern
- ✅ Content container uses `flex-basis: 150px` for minimum space
- ✅ Button container hidden below 200px (`hidden @[200px]:flex`)
- ✅ Button gap responsive (3px narrow, 6px wide)
- ✅ Transcription badge icon-only at narrow widths
- ✅ All button labels hide at @[400px] breakpoint

**What Needs Fine-Tuning:**
1. **Breakpoint calibration** - Current breakpoints (@[200px], @[300px], @[400px]) may need adjustment based on real-world usage
2. **Hover behavior for buttons** - Buttons below 200px should show on row hover (not yet implemented)
3. **Visual polish** - Spacing and alignment may need minor adjustments after user testing

**Files Affected:**
- `apps/electron/src/features/library/components/SourceRow.tsx`

**Acceptance Criteria for Resolution:**
- User confirms breakpoints feel natural across panel widths
- Hover behavior works as expected
- No visual regressions at any width

---

## Notes for Future Development

### Architectural Principles
1. **Consistency over cleverness** - Follow established patterns
2. **Generic over specific** - Use `title` for all content types, not type-specific fields
3. **Simple over complex** - Prefer `title || filename` over long fallback chains
4. **Container-aware over viewport-aware** - Use container queries for component responsiveness

### When Adding New Features
1. **Check this registry first** - Has this problem been solved?
2. **Find similar components** - How do they solve it?
3. **Verify with user** - Don't assume complex logic
4. **Document decisions** - Update this registry

### When Encountering Errors
1. **Document the error** - Add to ERR-### section
2. **Document the solution** - What fixed it?
3. **Document the lesson** - How to avoid it next time?

---

**End of Registry**

*This is a living document. Update after every significant decision or error.*
