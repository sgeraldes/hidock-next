# T5 — F17: Honest deletion UX (labels, scopes, Trash) (Phase 3)

## Objective
Every delete affordance says exactly what it does; soft-deleted items have a visible restore path beyond the 8-second Undo toast.

## Current state (verified facts)
- SourceRow.tsx ~:271-293 menu: label logic `device-only → "Delete from device" | local-only → "Delete from computer" | else → "Delete everywhere"`; second item "Delete permanently…" for non-device-only. SourceReader.tsx ~:1050-1059 mirrors it. Library.tsx handlers: handleDelete routes non-device-only to SOFT delete (deleteCascade(id,false)) — so "Delete everywhere" performs a reversible hide (label lies); handleDeletePermanent → deletionImpact fetch → deleteCascade(id,true), dialog says device copy untouched.
- Soft delete → `deleted_at` tombstone; restore ONLY via the transient Undo toast (recordings:restore IPC exists). No Trash view — soft-deleted rows are invisible everywhere (read sites filter deleted_at).
- deletion_journal rows: soft + hard, with full recording snapshot JSON.

## What's missing
1. **Labels + scope copy** (both menus + dialogs):
   - Soft: "Move to Trash" with subtitle/tooltip "Hide + stop AI processing. Restorable. Keeps files."
   - Device: "Delete from device" (unchanged) — ALSO add it for synced rows (today only device-only rows offer it; a synced row can't remove its device copy from the Library at all). Gate on deviceConnected.
   - Hard: "Delete permanently…" with subtitle "Remove file + all derived data from this computer".
   - Confirm dialogs restate scope in plain words (existing deletionImpact wiring stays; extend with graph counts once Phase 2 lands — see T7).
2. **Trash surface**: minimal restore path — a Library filter/toggle "Trash" (or Filters panel entry) listing soft-deleted captures with per-row Restore + Delete permanently. Reuse existing unified-recordings pipeline (needs a way to include deleted rows on demand — find where deleted_at is filtered and add an opt-in query flag; keep default surfaces unchanged).
3. A11y + tripwires: keep H17 invariants (no horizontal scroll, full-width separators); menu items keyboard-accessible; destructive items keep destructive styling.
4. Tests: label logic per location state; Trash filter shows only tombstoned; restore round-trip; menus render for synced rows with device item gated on connection.

## Dependencies
- None hard; T7 extends the same dialogs with graph/device actions — coordinate copy strings.

## Constraints
- Renderer-only where possible; IPC additions follow zod-validated handler patterns; fixture/temp DBs in tests; non-interactive commands.
