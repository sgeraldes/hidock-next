# Explore Specification

**Module:** Knowledge Discovery
**Screen:** Explore (`/explore`)
**Component:** `src/pages/Explore.tsx`
**Screenshot:** ![Explore View](../qa/screenshots/explore_master.png)

## 1. Overview
Explore is the **Discovery Engine** for the knowledge base. It goes beyond simple keyword matching to find connections across knowledge captures, people, and projects, enabling users to "connect the dots" in their information.

## UI Components & Behavior

| Feature | UI Element | Action | Expected Outcome | Redesign Alignment |
| :--- | :--- | :--- | :--- | :--- |
| **Search Input** | Large Text Field | Type text | Initiates search (debounced 500ms). Shows spinner. | Central "Discovery" entry point. |
| **Recurring Topics** | "TrendingUp" Card | Click Topic Chip | Auto-fills search input with topic (e.g., "Amazon Connect"). | "Insights Discovery" feature. |
| **Quick Actions** | "Zap" Card | Click Action | Triggers predefined workflows ("Summarize activity", "Find tasks"). | Proactive assistance. |
| **Result Categories** | Tabs (All, Knowledge...) | Click Tab | Filters displayed results by entity type. | "Search Scope" definition. |
| **Result Cards** | Knowledge/People/Project | Click Card | Navigates to respective detail view (`/library`, `/person/:id`, `/projects`). | Cross-module navigation. |

---

## 2. Component Specification

### 2.1 State Management
| State Variable | Type | Description | Persistence |
| :--- | :--- | :--- | :--- |
| `query` | `string` | Current search text. | Session |
| `results` | `{ knowledge[], people[], projects[] }` | Categorized result set. | Session |
| `loading` | `boolean` | API fetch status. | Session |
| `activeTab` | `'all'\|'knowledge'\|...` | Visual filter for results. | Session |

### 2.2 Lifecycle & Events
*   **Search Trigger:** `useEffect` watches `query`. Debounce: 500ms.
*   **Execution:** Calls `rag.search(query, 10)` -> Maps response to categories.

---

## 3. Detailed Behavior

### 3.1 Search Logic
*   **Backend:** `rag.search` performs a hybrid or semantic search against the vector database.
*   **Response Structure:** Currently receives an array, mapped manually to categories in `handleSearch` (Mock logic in current implementation).
*   **Empty State:** "No results found" with dashed border.

### 3.2 Dashboard (Idle State)
*   **Condition:** `!results && !loading`.
*   **Content:**
    *   **Recurring Topics:** Static list (placeholder) of top entities.
    *   **Quick Actions:** Shortcuts to Assistant workflows.

---

## 4. API Contracts

### `SearchResult`
```typescript
interface SearchResult {
  id: string;
  type: 'knowledge' | 'person' | 'project';
  title: string;
  summary?: string;
  capturedAt?: string;
  score: number; // Relevance
}
```

### IPC Methods
*   `rag.search(query, limit)`: Returns `Promise<SearchResult[]>`.

---

## 5. Error Handling

*   **Search Fail:** Console error. Loading state clears. Result list remains null (Dashboard view).

---

## 6. Accessibility & Styling

*   **Focus:** Input field has `text-lg` and `shadow-lg` to emphasize importance.
*   **Visual Hierarchy:** Category headers (`text-sm font-bold uppercase`) clearly separate data types.

---

## 7. Testing Strategy

### Integration Tests
*   **Debounce:** Type "test" -> Wait 200ms -> Type "testing" -> Verify only one API call.
*   **Categorization:** Mock mixed response -> Verify Knowledge/People/Projects appear in correct sections.
*   **Navigation:** Click result -> Verify `navigate` called.

### Performance
*   **Latency:** Search results should render < 1s (Vector DB dependent).
