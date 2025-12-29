# Actionables Specification

**Module:** Knowledge Management (The "Action" Repository of Pillar III)
**Screen:** Actionables (`/actionables`)
**Component:** `src/pages/Actionables.tsx`
**Screenshot:** ![Actionables View](../qa/screenshots/actionables_master.png)

## 1. Overview
Actionables acts as the **Artifact Repository**. It stores everything produced by the Assistant—from meeting minutes to feedback drafts. It facilitates the final stage of the knowledge lifecycle: **Execution**.

## UI Components & Behavior

| Feature | UI Element | Action | Expected Outcome | Redesign Alignment |
| :--- | :--- | :--- | :--- | :--- |
| **Output Gallery** | Thumbnail Grid | View | Displays cards for AI-generated reports, tasks, and notes. | "Thumbnail view of notes". |
| **Metadata Display** | Card Details | View | Shows category, date, and label (e.g., "AI Generated"). | "Details about them: label/category". |
| **Export** | Action Menu | Click Export | Offers PDF, Markdown, and JSON export options. | "Export Options". |
| **Source Link** | "View Source" Link | Click | Navigates back to the specific segment in Library. | "Source segment cross-reference". |

---

## 2. Component Specification

### 2.1 Lifecycle & Events
*   **Mount:** Fetches generated artifacts. Subscribes to new "Output" events from Assistant.
*   **Version Control:** Tracks user edits vs AI original content.

---

## 3. Testing Strategy

### Integration Tests
*   **Export:** Click Export PDF -> Verify file generation.
*   **Sync:** Verify "Mark as Shared" status propagates to the Graph (Explore).