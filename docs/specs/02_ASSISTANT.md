# Knowledge Assistant Specification

**Module:** AI Intelligence
**Screen:** Assistant (`/assistant`)
**Component:** `src/pages/Chat.tsx`
**Screenshot:** ![Assistant View](../qa/screenshots/assistant_master.png)

## 1. Overview
The Assistant is a **Knowledge-Powered AI** interface implementing a RAG (Retrieval-Augmented Generation) pipeline. It allows users to query their knowledge base, maintaining conversation history and allowing manual context injection.

## UI Components & Behavior

| Feature | UI Element | Action | Expected Outcome | Redesign Alignment |
| :--- | :--- | :--- | :--- | :--- |
| **Chat Interface** | Message List | Scroll | Displays history of User and Assistant messages. Renders Markdown. | "Conversation History" feature. |
| **Input** | Text Area | Type + Enter | Sends message. Shows "Thinking..." state. Streams response token-by-token. | Standard Chat UI. |
| **Context Injection** | "Context" Dropdown | Select Recording/Meeting | Scopes RAG retrieval to specific items (e.g., "Summarize *this* meeting"). | "Context Injection" core feature. |
| **New Session** | "New Chat" Button | Click | Clears current message history. Resets context selection. | "Branch/Reset" functionality. |
| **Artifact Generation** | (Planned) Output Button | Click "Create Output" | (Future) Generates structured document from chat content. | Phase 2: "Create output from conversation". |

---

## 2. Component Specification

### 2.1 State Management
| State Variable | Type | Description | Persistence |
| :--- | :--- | :--- | :--- |
| `activeConversation` | `Conversation \| null` | Currently selected chat session. | Session |
| `messages` | `Message[]` | Message history for current session. | Session (DB-backed) |
| `contextIds` | `string[]` | IDs of manually attached knowledge items. | Session (DB-backed) |
| `status` | `RAGStatus` | Ollama/Index readiness status. | Polled |
| `input` | `string` | Current user query text. | Session |

### 2.2 Lifecycle & Events
*   **Mount:** Checks `rag.status()` -> Loads `conversations` list -> Selects most recent conversation.
*   **Polling:** Periodically checks RAG status to enable/disable input.
*   **Message:** `handleSubmit` creates conversation (if new) -> Adds User Msg -> Calls RAG -> Adds Assistant Msg.

---

## 3. Detailed Behavior

### 3.1 Chat Interaction
*   **Submission:**
    *   **Action:** Enter or Click Send.
    *   **Pre-check:** If no `activeConversation`, call `assistant.createConversation`.
    *   **Flow:**
        1.  `assistant.addMessage(user)` (Optimistic UI update).
        2.  `rag.chatLegacy(conversationId, text)`.
        3.  `assistant.addMessage(assistant, response.answer, response.sources)`.
    *   **Loading:** Show "Thinking..." bubble while awaiting RAG.

### 3.2 Context Management
*   **Picker:**
    *   **Action:** Click "Context" button -> Opens `ContextPicker` dialog.
    *   **Selection:** Multi-select Recordings/Meetings.
    *   **Outcome:** Calls `assistant.addContext` / `removeContext`. Updates `contextIds`.
    *   **Visual:** Attached items appear as chips in the header.

### 3.3 Source Attribution
*   **Logic:** `getMessageSources` parses `message.sources` JSON.
*   **Display:** Assistant messages show "Used 3 references" chips. Hovering reveals specific document titles.

---

## 4. API Contracts

### `RAGChatResponse`
```typescript
interface RAGChatResponse {
  answer: string;
  sources: Array<{
    content: string;
    meetingId?: string;
    subject?: string;
    score: number;
  }>;
  error?: string;
}
```

### IPC Methods
*   `assistant.getConversations()`: Returns list of past chats.
*   `assistant.getMessages(id)`: Returns full history.
*   `assistant.addContext(convId, itemId)`: Links knowledge to session.
*   `rag.chatLegacy(sessionId, message)`: Core RAG execution.

---

## 5. Error Handling

*   **Ollama Offline:** `rag.status()` returns `ollamaAvailable: false` -> Input disabled with warning "Ollama offline".
*   **Generation Fail:** RAG returns `error` string -> Displayed as a red System Message in chat.
*   **Empty History:** Shows "Welcome" state with suggestion chips ("Summarize recent meetings").

---

## 6. Accessibility & Styling

*   **Keyboard:** `Enter` to send (prevented if `Shift+Enter`). Auto-focus input on load.
*   **Scrolling:** `messagesEndRef` auto-scrolls to bottom on new message. `behavior: 'smooth'`.
*   **Tokens:** `bg-muted` for User bubbles, `bg-background` for Assistant. Markdown rendering for bold/lists.

---

## 7. Testing Strategy

### Unit Tests
*   Test `handleSubmit` flow (conversation creation vs existing).
*   Test `getMessageSources` parsing logic.

### Integration Tests
*   **Chat Flow:** Mock `rag.chatLegacy` -> Send "Hello" -> Verify User bubble appears -> Verify Assistant bubble appears with mock response.
*   **Context:** Click Context -> Select Item -> Verify `assistant.addContext` called.

### Performance
*   **Latency:** Time-to-first-token (TTFT) depends on local LLM. UI must remain responsive.
*   **Rendering:** Large histories (100+ msgs) should not lag input typing.