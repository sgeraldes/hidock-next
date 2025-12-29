# Actionables Specification

**Module:** Actions
**Screen:** Actionables (`/actionables`)
**Component:** `src/pages/Actionables.tsx`
**Screenshot:** ![Actionables View](../qa/screenshots/actionables_master.png)

## 1. Overview
Actionables is the **Proactive Action Center**. It aggregates "Needs Attention" items derived from knowledge (e.g., "Send meeting minutes", "Follow up") and facilitates the generation of artifacts.

## UI Components & Behavior

| Feature | UI Element | Action | Expected Outcome | Redesign Alignment |
| :--- | :--- | :--- | :--- | :--- |
| **Dashboard** | Sections | View | Grouped by "Needs Attention", "Suggestions", "Recently Generated". | "Actionables View" structure. |
| **Status Filter** | Tabs | Click "Pending", "Generated" | Filters list by item status. | Standard filter. |
| **Generation** | "Generate Now" Button | Click | Opens Output Generation flow (Template selection -> Draft -> Save). | "Output Generation Flow". |
| **Dismissal** | "Dismiss" Button | Click | Removes item from view (marks as dismissed). | User control. |
| **Empty State** | Placeholder | View | "No pending Actionables" with illustration. | Good UX practice. |

---

## 2. Component Specification

### 2.1 State Management
| State Variable | Type | Description | Persistence |
| :--- | :--- | :--- | :--- |
| `actionables` | `Actionable[]` | List of tasks. | Session |
| `statusFilter` | `'all'\|'pending'\|...` | Active tab filter. | Session |
| `loading` | `boolean` | Fetch status. | Session |

### 2.2 Lifecycle & Events
*   **Mount:** `loadActionables` -> `actionables.getAll()`.
*   **Generate:** Clicking "Generate Now" triggers API call -> Re-fetches list.

---

## 3. Detailed Behavior

### 3.1 List Rendering
*   **Grouping:** None (Flat list filtered by status).
*   **Visual Indicators:**
    *   **Pending:** Amber vertical strip.
    *   **Generated:** Green vertical strip.
*   **Metadata:** Shows `type`, `title`, `recipients` count, `createdAt`.

### 3.2 Output Generation
*   **Action:** Click "Generate Now".
*   **Logic:**
    1.  Call `outputs.generate({ templateId, sourceId })`.
    2.  Wait for completion.
    3.  `loadActionables()` to refresh status to 'generated'.
*   **Visual Feedback:** Button shows spinner (missing in current code? Check `handleGenerate` await).

---

## 4. API Contracts

### `Actionable` (Frontend Model)
```typescript
interface Actionable {
  id: string;
  type: string; // 'meeting_minutes', 'follow_up', etc.
  title: string;
  description?: string;
  status: 'pending' | 'generated' | 'dismissed';
  sourceKnowledgeId: string;
  suggestedRecipients: string[];
  createdAt: string;
}
```

### IPC Methods
*   `actionables.getAll(options)`: Returns list of items.
*   `outputs.generate(request)`: Triggers LLM generation of artifact.

---

## 5. Error Handling

*   **Generation Fail:** Logs to console. Needs user feedback (Toast).
*   **Empty State:** "No pending Actionables" card.

---

## 6. Accessibility & Styling

*   **Colors:** Status coding (Amber/Green/Blue).
*   **Layout:** Responsive cards (`flex-col sm:flex-row`).

---

## 7. Testing Strategy

### Integration Tests
*   **Render:** Verify pending items appear in "Pending" tab.
*   **Generate:** Click button -> Verify `outputs.generate` called with correct ID -> Verify list refresh.

### Performance
*   **Generation:** Can take 5-10s. UI must remain responsive (disable button).
