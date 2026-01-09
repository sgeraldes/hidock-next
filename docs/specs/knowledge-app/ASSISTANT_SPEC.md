# Assistant Component Specification

## 1. Component Overview
The **Assistant** (formerly `Chat`) is the conversational interface for the Knowledge System. It allows users to query their knowledge base using RAG (Retrieval-Augmented Generation) with an interchangeable provider (local-first or cloud). It supports multiple conversation threads and explicit context attachment.

Invariant: responses that include actionable claims must be grounded with citations that deep-link into Library anchors (timestamp/text/page ranges).

### Vision alignment (do not mirror the current UI)
- The Assistant is a *reasoning and synthesis surface*; it must keep evidence visible and navigable.
- “Context attachment” always refers to attaching **Sources** (and optionally Notes/Entities), not “a recording screen”.
- Any non-trivial claim must include citations that deep-link into stable anchors (timecode, text range, page range).
- The UI should work even if providers/engines change; keep provider specifics behind an API boundary.

Tri-pane alignment (from [11_REDESIGN_ARCH.md](../11_REDESIGN_ARCH.md)):
- In the Notebook workspace, the Assistant is the **right pane** (“Assistant / Tools”), operating alongside the Source reader and notes.
- The standalone `/assistant` route may exist, but its primary job is still to augment the tri-pane reading/thinking loop.

## 2. Component Interface

### Props
The component is a top-level route and accepts optional route state for initialization.
```typescript
interface LocationState {
    contextId?: string; // Optional Source/Note/Entity ID to attach immediately on load
}
```

### State Management
| State Variable | Type | Description |
| :--- | :--- | :--- |
| `conversations` | `Conversation[]` | List of historical chat threads. |
| `activeConversation` | `Conversation \| null` | Currently selected chat thread. |
| `messages` | `Message[]` | List of messages in the active thread. |
| `contextIds` | `string[]` | IDs of attached context items (Sources/Notes/Entities). |
| `status` | `RAGStatus` | Health check for the configured provider (availability, index/collection readiness). |
| `chunks` | `VectorChunk[]` | Debug data for RAG chunks (optional view). |
| `sources` | `Map<string, Source[]>` | Mapping of message IDs to their cited sources. |

### Data Flow & Dependencies (target)
- **Assistant persistence API**: CRUD conversations/messages and bind/unbind context.
- **Retrieval/Chat API**: submit query (+ context IDs) and receive assistant response + citations.
- **Knowledge API**: resolve attached IDs to display names/types and open deep-links.

## 3. Behavior & Interactions

### 3.1 Initialization
-   **On Mount**:
    1.  Checks a retrieval/provider status endpoint to ensure the backend is ready.
    2.  Loads conversation history.
    3.  Selects most recent conversation (or creates new if empty).
-   **Route Param**: If `contextId` is provided in navigation state, it auto-creates a new chat (or uses active) and attaches that context.

Target behavior: check a retrieval/provider status endpoint, load conversation history, and restore the last active conversation. Provider specifics belong behind an API boundary.

### 3.2 Chat Interaction
-   **Input**: Text input with "Send" button.
-   **Submission**:
    1.  Optimistically adds User message.
    2.  Sets loading state (typing indicator).
    3.  Calls the Retrieval/Chat API with (conversationId, text, optional context IDs).
    4.  Appends Assistant response + Sources.
-   **Auto-Scroll**: Automatically scrolls to bottom on new message.

#### Streaming & cancellation
- If responses stream, the UI must remain usable while tokens arrive.
- If the user scrolls away from the bottom during streaming, do not force-scroll; show a “Jump to latest” affordance.
- Provide a “Stop” action while streaming; stopping should end generation without losing the already-received partial text.

#### Citations
- Each citation is an interactive control (button/link) that opens the referenced Source at the cited anchor.
- Opening a citation must be deterministic (no re-ranking / re-generation required to open evidence).
- Citations must be keyboard reachable and screen-reader labeled with Source title + anchor.

### 3.3 Context Management
-   **Picker**: "Context" button opens a `ContextPicker` dialog.
-   **Selection**: Users can select specific Sources (and optionally derived entities like People/Projects) to focus retrieval.
-   **Effect**: Attached `contextIds` are passed to the RAG engine to prioritize/filter retrieval.

Context picker requirements:
- Must support search.
- Must support multi-select with clear selected state.
- Must communicate the type of each item (Source/Person/Project/Note) using existing tokens only.

### 3.4 Conversation History
-   **Sidebar**: Displays list of past conversations.
-   **Actions**:
    -   **Select**: Switches active thread.
    -   **Delete**: Removes thread and all associated messages.
    -   **New**: Creates a fresh conversation context.

### 3.5 Recommended component structure (implementation guidance)

This section is non-normative UI breakdown meant to prevent ambiguity during implementation.

- **Two-column layout**
    - **Sidebar**: New chat, conversation history (virtualized if large), optional history search.
    - **Main**: header (conversation title + context summary), message list (scrollable), composer.
- **Composer**
    - Context chips (attached Sources/Entities) with remove action.
    - Auto-resizing textarea.
    - Send button and Stop button (visible while streaming).
- **Message rendering**
    - Assistant messages may contain Markdown.
    - Render Markdown safely (no raw HTML injection) and keep rendering efficient during streaming.
    - Citations render as a compact list/grid below the assistant message, and open Source detail at the cited anchor.

## 4. Design & Styling

### Layout
-   **Two-Column**:
    -   **Sidebar (Left)**: History list (250px fixed or resizable).
    -   **Main (Right)**: Chat area + Input footer.

### Visual Elements
-   **Bubbles**: Distinct styles for User (Primary Color) vs Assistant (Gray/Muted).
-   **Citations**: Small pills below Assistant messages showing source titles.
-   **Status Badges**: Indicators for RAG health using existing theme tokens only (avoid bespoke status colors).

## 5. Accessibility (A11y)

### ARIA Roles
-   **Message Log**: `role="log"` with `aria-live="polite"`.
-   **Streaming announcements**: Do not announce every token; announce at message boundaries (e.g., “Assistant response started/finished”) or throttle updates.
-   **Input**: `aria-label="Ask a question"`.

### Focus management
- On send: keep focus in the input.
- When switching conversations: keep focus in the sidebar list if the user initiated the switch there; otherwise focus the input.
- Dialogs (Context picker, delete confirmations) must trap focus and close on Escape.

### Keyboard Navigation
- **Composer**: Enter sends; Shift+Enter inserts newline.
- **Conversation list**: ArrowUp/ArrowDown navigates; Enter selects; Delete triggers delete (with confirmation).
- **Citations**: Tab focuses citation controls; Enter activates.
- **Escape**: Closes dialogs and cancels transient UI (e.g., context picker).

## 6. Error Handling

| Scenario | UX Result | Recovery |
| :--- | :--- | :--- |
| **Provider Offline** | Warning badge in header; Error message on submit. | "Reload" button or instructions to start/enable the configured provider. |
| **RAG Failure** | Assistant replies with specific error text. | User can retry query. |
| **Init Failed** | Full-screen error state. | Page reload button. |

## 7. Testing Requirements

### Unit Tests
-   **Message Rendering**: Verify User/Assistant distinction and Source rendering.
-   **Context Toggle**: Verify adding/removing context updates state.

### Integration Tests
-   **Chat Flow**: Mock RAG response; Verify user input -> loading -> response cycle.
-   **History**: Verify switching conversations loads correct message set.
-   **Persistence**: Verify creating a new chat updates the sidebar list.

### Performance
-   **Latency**: UI must remain responsive during RAG generation (which can take seconds).
-   **List**: Efficient rendering for long conversation histories.

Recommended targets:
- **Time to First Token**: <$1\,\text{s}$ when streaming is enabled (provider-dependent; UI must respond instantly regardless).
- **Markdown rendering**: avoid full re-parse on every streamed token (memoize/render incrementally where possible).

## Appendix A: Migration pointers (non-normative)
- Current route implementation: `apps/electron/src/pages/Chat.tsx` (candidate rename: `Assistant.tsx`).
- Current IPC namespaces used by the app: `electronAPI.assistant`, `electronAPI.rag` (`chatLegacy`, `status`, `getChunks`), `electronAPI.knowledge`.
