# Assistant Component Specification

## 1. Component Overview
The **Assistant** (formerly `Chat`) is the conversational interface for the Knowledge System. It allows users to query their knowledge base using RAG (Retrieval-Augmented Generation), powered by a local LLM (Ollama). It supports multiple conversation threads and explicit context attachment.

**Path**: `apps/electron/src/pages/Chat.tsx` (To be renamed `Assistant.tsx`)

## 2. Component Interface

### Props
The component is a top-level route and accepts optional route state for initialization.
```typescript
interface LocationState {
    contextId?: string; // Optional recording ID to attach immediately on load
}
```

### State Management
| State Variable | Type | Description |
| :--- | :--- | :--- |
| `conversations` | `Conversation[]` | List of historical chat threads. |
| `activeConversation` | `Conversation \| null` | Currently selected chat thread. |
| `messages` | `Message[]` | List of messages in the active thread. |
| `contextIds` | `string[]` | IDs of specific knowledge artifacts attached to the current chat. |
| `status` | `RAGStatus` | Health check for RAG service (Ollama status, index count). |
| `chunks` | `VectorChunk[]` | Debug data for RAG chunks (optional view). |
| `sources` | `Map<string, Source[]>` | Mapping of message IDs to their cited sources. |

### Data Flow & Dependencies
-   **`electronAPI.assistant`**: CRUD for conversations, messages, and context binding.
-   **`electronAPI.rag`**:
    -   `chatLegacy`: Sends query + context to LLM and retrieves answer + sources.
    -   `status`: Checks vector DB and LLM availability.
    -   `getChunks`: Fetches raw vector chunks for debugging.
-   **`electronAPI.knowledge`**: Fetches metadata for attached context items.

## 3. Behavior & Interactions

### 3.1 Initialization
-   **On Mount**:
    1.  Checks `rag.status()` to ensure backend is ready.
    2.  Loads conversation history.
    3.  Selects most recent conversation (or creates new if empty).
-   **Route Param**: If `contextId` is provided in navigation state, it auto-creates a new chat (or uses active) and attaches that context.

### 3.2 Chat Interaction
-   **Input**: Text input with "Send" button.
-   **Submission**:
    1.  Optimistically adds User message.
    2.  Sets loading state (typing indicator).
    3.  Calls `rag.chatLegacy(conversationId, text)`.
    4.  Appends Assistant response + Sources.
-   **Auto-Scroll**: Automatically scrolls to bottom on new message.

### 3.3 Context Management
-   **Picker**: "Context" button opens a `ContextPicker` dialog.
-   **Selection**: Users can select specific recordings/meetings to "focus" the AI.
-   **Effect**: Attached `contextIds` are passed to the RAG engine to prioritize/filter retrieval.

### 3.4 Conversation History
-   **Sidebar**: Displays list of past conversations.
-   **Actions**:
    -   **Select**: Switches active thread.
    -   **Delete**: Removes thread and all associated messages.
    -   **New**: Creates a fresh conversation context.

## 4. Design & Styling

### Layout
-   **Two-Column**:
    -   **Sidebar (Left)**: History list (250px fixed or resizable).
    -   **Main (Right)**: Chat area + Input footer.

### Visual Elements
-   **Bubbles**: Distinct styles for User (Primary Color) vs Assistant (Gray/Muted).
-   **Citations**: Small pills below Assistant messages showing source titles.
-   **Status Badges**: Indicators for RAG health (Green=Ready, Yellow=Indexing/Offline).

## 5. Accessibility (A11y)

### ARIA Roles
-   **Message Log**: `role="log"` with `aria-live="polite"` (for screen readers to announce new messages).
-   **Input**: `aria-label="Ask a question"`.

### Keyboard Navigation
-   **Enter**: Submits the form (unless Shift+Enter for newline).
-   **Focus**: New chat button, History items, and Input field must be reachable.

## 6. Error Handling

| Scenario | UX Result | Recovery |
| :--- | :--- | :--- |
| **Ollama Offline** | Warning badge in header; Error message on submit. | "Reload" button or Instructions to start Ollama. |
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
