# Explore Specification (Knowledge App)

**Route:** `/explore`
**Related Numbered Spec:** [03_EXPLORE.md](../03_EXPLORE.md)
**References:** [11_CONCEPTUAL_FRAMEWORK.md](../11_CONCEPTUAL_FRAMEWORK.md), [11_REDESIGN_ARCH.md](../11_REDESIGN_ARCH.md)

---

## 1. Purpose

Explore is the discovery surface for **derived knowledge**: entities (People/Projects/Topics/Decisions) and their relationships, plus global search across Sources and Notes.

### Vision alignment (do not mirror the current UI)
- Explore is for *discovery and navigation*, not for editing raw evidence.
- Results must deep-link into stable anchors (Library/Source reader, entity detail, or project scope) rather than dumping users into generic lists.
- Avoid UI assumptions tied to today’s file/recording representations; treat “Source” as the primary evidence unit.

Tri-pane alignment (from [11_REDESIGN_ARCH.md](../11_REDESIGN_ARCH.md)):
- Explore powers the **knowledge graph / discovery tools** that can appear in the right pane (“Assistant / Tools”) or as a full-page surface.

---

## 2. Scope

**In scope**
- Global search experience (keyword + semantic) across Sources/Notes and derived entities.
- Entity navigation entry points (People/Projects details).
- Trend summaries (recent activity, top topics) based on derived metadata.

**Out of scope**
- Full interactive graph rendering (can be incremental; a list/dashboard is acceptable as an intermediate).

---

## 3. User flows

- Search: type query → see mixed results (knowledge captures + people + projects) → open result.
- Browse: see dashboard widgets (recent Sources, top people/topics) → click widget item → navigates to filtered search/results.

---

## 3.1 Interaction model (keyboard-first)

### Search input
- Typing triggers debounced search; new keystrokes cancel in-flight requests.
- Escape clears the query (or collapses results back to the dashboard when query becomes empty).
- Optional shortcut: `Ctrl/Cmd+K` focuses the search input (do not conflict with OS/global shortcuts).

### Results navigation
- Results render as a single navigable list; each result row is an interactive control.
- Keyboard:
  - `ArrowDown/ArrowUp` moves focus through results.
  - `Enter` opens the focused result.
  - `Tab` cycles through focusable controls without trapping.
- When a result opens, the destination surface must receive enough params to deep-link to a meaningful anchor (not a generic landing page).

### Tabs (if present)
- Tabs are optional; if present they must be accessible (`role="tablist"`, tabs with `role="tab"`, panels with `role="tabpanel"`).
- Tab switching must not reset the query.

---

## 3.2 Recommended structure (implementation guidance)

- **Dashboard mode (empty query)**
  - Widgets: recent Sources, top people, top topics.
  - Clicking a widget item sets the query (or navigates to a filtered results state) and transitions into results mode.
- **Results mode (non-empty query)**
  - Mixed result list (Sources + entities) with optional tabs for type filters.
  - Each result shows: title, optional subtitle, and an optional snippet with query highlighting.

---

## 4. Data contracts (minimum)

Explore consumes a normalized result shape; underlying storage can be SQLite FTS, embeddings, or both.

```ts
type SearchResultType = 'knowledge' | 'person' | 'project' | 'topic';

interface SearchResult {
  type: SearchResultType;
  id: string;
  title: string;
  subtitle?: string;
  snippet?: string;
  score?: number;
  deepLink?: { route: string; params?: Record<string, string> };
}
```

---

## 5. Implementation requirements

- Use design tokens only (no bespoke colors).
- Search must be debounced and cancelable.
- Respect reduced-motion preferences (`prefers-reduced-motion`): transitions must not be required for comprehension.
- Opening a result must deep-link into the correct surface:
  - knowledge → Library (Source)
  - person → Person detail
  - project → Project detail

Recommended budgets:
- **Debounce**: ~300ms.
- **Rendering**: virtualize results if the list is large (e.g., >50 rows).
- **Perceived latency**: UI remains responsive even if search is slow; show progress state.

---

## 6. Acceptance criteria

- Search returns results within a responsive UI budget (no blocking renders).
- Results are navigable by keyboard.
- A result click always routes somewhere meaningful (no dead ends).

## Appendix A: Migration pointers (non-normative)
- Current route implementation: `apps/electron/src/pages/Explore.tsx`.
