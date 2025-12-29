# Assistant View - Comprehensive Engineering Specification

## 1. Component Architecture
The Assistant is a conversational interface utilizing RAG (Retrieval-Augmented Generation) to query the knowledge base. It requires sophisticated state management for streaming responses and context handling.

### 1.1 Component Hierarchy
```
AssistantPage (Route: /assistant)
â”œâ”€â”€ Sidebar (Collapsible, Resizable)
â”‚   â”œâ”€â”€ NewChatButton
â”‚   â”œâ”€â”€ HistoryList (Virtualized)
â”‚   â”‚   â””â”€â”€ HistoryItem
â”‚   â””â”€â”€ SearchHistoryInput
â”œâ”€â”€ ChatArea (Flex-Column)
â”‚   â”œâ”€â”€ Header (Conversation Title, Context Summary)
â”‚   â”œâ”€â”€ MessageList (Scrollable, Auto-scroll)
â”‚   â”‚   â”œâ”€â”€ UserMessageBubble
â”‚   â”‚   â””â”€â”€ AssistantMessageBubble
â”‚   â”‚       â””â”€â”€ CitationGrid
â”‚   â””â”€â”€ InputArea (Sticky Footer)
â”‚       â”œâ”€â”€ ContextChips (Attached recordings)
â”‚       â”œâ”€â”€ AutoResizingTextarea
â”‚       â””â”€â”€ SendButton / StopGenerationButton
â””â”€â”€ ContextPickerModal
```

## 2. Data Model & State

### 2.1 Types & Interfaces
```typescript
interface Message {
  id: string; // UUID
  role: 'user' | 'assistant' | 'system';
  content: string; // Markdown text
  createdAt: string; // ISO
  status: 'sending' | 'streaming' | 'sent' | 'error';
  citations?: Citation[]; // References
}

interface Citation {
  recordingId: string;
  filename: string;
  snippet: string;
  timestamp?: number; // Start time in seconds
  score: number; // Relevance 0-1
}

interface Conversation {
  id: string;
  title: string;
  updatedAt: string;
  contextIds: string[]; // Recordings pinned to this chat
}

interface AssistantState {
  // Navigation
  sidebarOpen: boolean;
  activeConversationId: string | null;
  
  // Data
  messages: Message[];
  isTyping: boolean; // True during RAG generation
  
  // Context
  attachedContext: UnifiedRecording[];
  
  // Input
  inputText: string;
}
```

## 3. Detailed Component Specifications

### 3.1 MessageList & Bubbles
*   **Auto-Scroll**: 
    *   Logic: If user is at bottom, auto-scroll on new token. If user scrolled up, show "New messages" arrow button.
*   **UserMessageBubble**:
    *   **Style**: Right-aligned, `bg-primary`, `text-primary-foreground`. Rounded-tl-lg, Rounded-tr-none.
*   **AssistantMessageBubble**:
    *   **Style**: Left-aligned, `bg-muted`.
    *   **Markdown**: Supports headers, lists, and code blocks (`react-markdown`).
    *   **Streaming**: Cursor blinks at end of text during generation.
    *   **Citations**: Rendered as a distinct row below text.
        *   *Component*: `CitationChip`.
        *   *Interaction*: Click -> Opens `LibraryDetail` at `timestamp`.

### 3.2 InputArea (Composer)
*   **Props**: `onSend: (text: string) => void`, `disabled: boolean`.
*   **Components**:
    *   `ContextBar`: Horizontal scroll of currently attached recordings (Pills with 'X' to remove).
    *   `Textarea`: Max-height 200px. `Enter` submits, `Shift+Enter` new line.
*   **State**: Local `value` state. Clears on send.

### 3.3 ContextPickerModal
*   **Trigger**: "Attach" paperclip icon in Composer.
*   **Content**: Simplified Library List (Search + Checkboxes).
*   **Behavior**:
    *   Selection updates `activeConversation.contextIds`.
    *   RAG Engine uses these IDs to filter vector search.

## 4. Interaction Patterns

### 4.1 Chat Flow
1.  **Submit**:
    *   User hits Enter.
    *   Add `UserMessage` (Optimistic).
    *   Show `AssistantMessage` (Empty, Status='streaming').
2.  **Streaming**:
    *   Backend sends chunks.
    *   Update `AssistantMessage.content` in real-time.
    *   Update `AssistantMessage.citations` once generation complete.
3.  **Error**:
    *   If RAG fails, update Status='error'.
    *   Show "Retry" button on the message bubble.

### 4.2 History Management
*   **New Chat**: Clears `messages`, resets `contextIds`, creates ID on first message send.
*   **Switching**:
    *   Click Sidebar Item -> Load `messages` for ID.
    *   Update URL `/assistant/:id`.

## 5. Visual Hierarchy & Styling

*   **Typography**:
    *   User Text: `text-sm text-white`.
    *   AI Text: `text-sm text-gray-800` (Dark: gray-100). Line-height 1.6 for readability.
*   **Spacing**:
    *   Message Gap: `gap-4` (loose).
    *   Sidebar Items: `py-2`.
*   **Feedback**:
    *   **Typing**: Three bouncing dots (`animate-bounce`).
    *   **Streaming**: Blinking cursor `|`.

## 6. Accessibility (A11y)

*   **Live Regions**: The Message List container has `aria-live="polite"` to announce incoming tokens (throttled).
*   **Focus Management**:
    *   On Send -> Keep focus in Input.
    *   On Edit Previous -> Focus moves to specific message input.
*   **Roles**:
    *   Sidebar: `role="navigation"`.
    *   Message List: `role="log"`.

## 7. Performance Targets

*   **Time to First Token (TTFT)**: < 1000ms (Local LLM dependent, but UI must respond).
*   **Rendering**: Handle Markdown rendering efficiently (memoize components to avoid re-parsing on every token).
*   **Context Switching**: Load conversation history < 200ms.

## 8. Test Plan

### 8.1 Unit Tests
*   **Markdown Rendering**: Ensure HTML is sanitized and formatted correctly.
*   **Citation Parsing**: Test extraction of `[Source: ID]` tags if used, or structured JSON parsing.

### 8.2 Integration Tests
*   **RAG Flow**: Mock `electronAPI.rag.chat`.
    *   Send "Hello" -> Verify Loading State -> Verify Streaming Updates -> Verify Final State.
*   **Context**: Attach Recording A -> Send Message -> Verify API receives Recording A ID.