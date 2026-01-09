# Actionables Specification (Knowledge App)

**Route:** `/actionables`
**Related Numbered Spec:** [07_ACTIONABLES.md](../07_ACTIONABLES.md)
**References:** [11_CONCEPTUAL_FRAMEWORK.md](../11_CONCEPTUAL_FRAMEWORK.md)

---

## 1. Purpose

Actionables is the repository for **Artifacts** created by the Assistant and/or the user: tasks, minutes, drafts, reports. Artifacts must remain traceable to evidence via citations.

### Vision alignment (do not mirror the current UI)
- Actionables stores *finalized outputs*, not transient chat content.
- Every artifact must preserve citations that deep-link back into Source anchors.
- Exports must be based on persisted content (no “regen on export”).

---

## 2. Scope

- List and open artifacts.
- Export artifacts.
- Deep-link from artifact citations back into Library anchors.

---

## 3. Acceptance criteria

- An artifact can always be traced back to Sources.
- Export uses persisted content (no re-generation).

## Appendix A: Migration pointers (non-normative)
- Current route implementation: `apps/electron/src/pages/Actionables.tsx`.
