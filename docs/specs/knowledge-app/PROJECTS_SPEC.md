# Projects Specification (Knowledge App)

**Route:** `/projects`
**Related Numbered Spec:** [05_PROJECTS.md](../05_PROJECTS.md)
**References:** [11_CONCEPTUAL_FRAMEWORK.md](../11_CONCEPTUAL_FRAMEWORK.md)

---

## 1. Purpose

Projects (or Notebooks) group Sources, Notes, and Artifacts around a shared initiative. Projects are entities in Explore and an organizational affordance in the UI.

### Vision alignment (do not mirror the current UI)
- Projects are a *scoping and retrieval affordance* across the system (Library, Assistant, Explore).
- Project detail should function as a hub with navigable evidence links (Sources/Notes/Artifacts), not as a dashboard of opaque summaries.
- Avoid prompt-driven creation/edit flows in the target UX.

---

## 2. Scope

- List projects, select active project.
- Show project detail summary: linked knowledge captures, people, actionables.
- Allow creation/archival.

---

## 3. Data contract (minimum)

```ts
interface Project {
  id: string;
  name: string;
  description?: string;
  status: 'active' | 'archived';
  createdAt: string; // ISO
  updatedAt?: string; // ISO
  knowledgeCount: number;
  peopleCount: number;
  actionablesCount?: number;
}
```

---

## 4. Implementation requirements

- Projects must be linkable from:
  - Calendar meetings
  - Library captures (manual association or AI suggestion)
  - Assistant artifacts
- Avoid prompt-based creation in UI (no `window.prompt` in target state).

---

## 5. Acceptance criteria

- Creating a project updates sidebar immediately.
- Selecting a project never shows stale data.

## Appendix A: Migration pointers (non-normative)
- Current route implementation: `apps/electron/src/pages/Projects.tsx`.
