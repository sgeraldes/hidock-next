# Assistant View - Deep Functional Specification

## 1. Overview & Goals
The **Assistant** is the AI interface for the Knowledge System. It uses RAG (Retrieval-Augmented Generation) to answer user questions based on the captured meetings and documents.
**Goal**: Create a fluid, chat-like experience that builds trust by explicitly citing sources and allowing users to verify AI claims against their own data.

## 2. Views & Components

### 2.1 View Structure
Standard Chat Interface Layout:
1.  **Sidebar (History)**: List of past sessions (collapsible).
2.  **Main Stage (Thread)**: Scrollable message log.
3.  **Composer (Input)**: Sticky footer for text entry.

### 2.2 Minimal Viable Components (MVC)

#### A. Sidebar (History List)
*   **New Chat Button**: Prominent primary action.
*   **History Item**: Title (auto-generated or user-set), Date, Delete button (hover).
*   **Search History**: Filter past conversations.

#### B. Main Stage (Output)
*   **Message Bubble (User)**: Right-aligned, primary color, simple text.
*   **Message Bubble (AI)**: Left-aligned, neutral/gray background.
    *   **Text Content**: Markdown rendering (lists, code blocks).
    *   **Source Citation**: "Footnotes" or "Chips" at the bottom of the bubble linking to specific recordings.
    *   **Action Row**: Copy, Regenerate, Feedback (Thumbs up/down).
*   **Typing Indicator**: Animated dots showing "Thinking" state.

#### C. Composer (Input)
*   **Input Area**: Auto-expanding textarea (1-5 rows).
*   **Context Chip**: Pill showing "Focus: Q1 Planning Meeting" (if context is attached).
*   **Attach Button**: Paperclip icon to open Context Picker.
*   **Send Button**: Arrow icon (disabled if empty).

#### D. Context Picker (Modal)
*   **Search**: Find recordings to "attach" to the conversation context.
*   **List**: Checkable list of recordings.

## 3. Data States

| State | Visual Representation | Behavior |
| :--- | :--- | :--- |
| **New Chat** | "Empty State" with Conversation Starters (e.g., "Summarize last meeting"). | Suggestions are clickable. |
| **Loading (Init)** | Spinner in center. | Block interactions until RAG is ready. |
| **Streaming** | Message appears character-by-character (or chunk-by-chunk). | Auto-scroll to bottom. |
| **Error (System)** | Toast: "Ollama not running". | Input disabled or "Retry Connection" button. |
| **Error (Message)** | Red text in chat: "Failed to generate". | "Retry" button on message. |

## 4. Interaction Patterns

### 4.1 Input & Submission
*   **Enter**: Send message.
*   **Shift + Enter**: New line.
*   **Paste**: Accepts text.
*   **Drag & Drop**: (Future) Drop text files to add to context.

### 4.2 Citation Navigation
*   **Click Citation Chip**:
    1.  Opens **Detail View** (Side Drawer) of the cited recording.
    2.  Scrolls transcript to the *exact timestamp* (if RAG provides it).
    3.  Highlights the relevant text segment.

### 4.3 History Management
*   **Click Sidebar Item**: Swaps active conversation state.
*   **Edit Title**: Double-click sidebar item title to rename.

## 5. Visual Hierarchy

1.  **Primary**: User Input, Latest AI Response.
2.  **Secondary**: Message History, Context Chips.
3.  **Tertiary**: Timestamps, Sidebar items, "Copy" actions.

**Theme Tokens**:
-   **User Bubble**: `bg-primary`, `text-primary-foreground`
-   **AI Bubble**: `bg-muted`, `text-foreground`
-   **Citation**: `bg-background`, `border-border` (Contrast against AI bubble)

## 6. Responsiveness

| Breakpoint | Layout Change |
| :--- | :--- |
| **Desktop (>1024px)** | Sidebar visible. Chat width limited to 800px (centered) for readability. |
| **Tablet/Mobile (<1024px)** | Sidebar becomes a Drawer (Hamburger menu). Chat takes full width. |

## 7. Implementation Manual (Step-by-Step)

### Phase 1: Layout & Components
1.  **Rename**: `apps/electron/src/pages/Chat.tsx` -> `Assistant.tsx`.
2.  **Extract**: Create `components/assistant/MessageBubble.tsx`, `ChatSidebar.tsx`, `ChatInput.tsx`.
3.  **Refactor**: Move state from monolithic `Chat.tsx` to `useAssistant` hook.

### Phase 2: RAG Integration
1.  **Streaming**: Update `electronAPI.rag.chat` to support streaming responses (Server-Sent Events or callback based) if possible, to improve perceived latency.
2.  **Citations**: Update `MessageBubble` to parse `sources` JSON and render `CitationChip` components.
3.  **Linking**: Implement `onCitationClick` handler that navigates to `/library/:id`.

### Phase 3: Context Picker
1.  **Component**: Polish `ContextPicker` (currently basic dialog). Add search and filtering by date.
2.  **State**: Persist `contextIds` per conversation in the backend (already supported by API, ensure UI syncs).

### Phase 4: Polish
1.  **Markdown**: Ensure `react-markdown` or similar is used for AI responses (tables, code blocks).
2.  **Auto-Scroll**: Implement "Scroll to bottom" logic that respects user manual scrolling (don't force scroll if user is reading history).

## 8. Proposed Design Mockup Description
*   **Sidebar**: Darker shade (gray-50/900). List items are minimal text. "New Chat" is a floating button (FAB style) or top sticky button.
*   **Chat Area**: Clean white/black canvas. Messages are not full width; they have max-width (600-800px) and center alignment container to mimic modern reading apps.
*   **User Bubble**: Rounded corners, specific color (e.g., Deep Blue).
*   **AI Bubble**: More square corners, light gray. Sources appear as a row of small "Cards" below the text.
*   **Input**: Floating card at the bottom with shadow, lifting it off the page. Contains "Attach" icon (left) and "Send" icon (right).
