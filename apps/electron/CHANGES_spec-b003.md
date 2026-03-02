# Spec B-003: Chat/RAG Bug Fixes

## Summary

Resolved 7 HIGH-priority bugs in the Chat/RAG subsystem covering error handling, resource management, UI patterns, API design, request lifecycle, memory management, and query safety.

## Bug Fixes

### B-CHAT-001: Invalid Conversation ID Error Handling

**Files:** `electron/main/ipc/assistant-handlers.ts`, `src/pages/Chat.tsx`

- `assistant:getMessages` now returns `{ error: 'Conversation not found', messages: [] }` when conversation ID is invalid
- `handleSelectConversation` in Chat.tsx detects this error response and shows a toast notification instead of rendering a blank chat
- Refreshes conversation list automatically when an invalid conversation is detected

### B-CHAT-002: RAG Session LRU Eviction and Cleanup

**Files:** `electron/main/services/rag.ts`, `electron/main/ipc/assistant-handlers.ts`

- Replaced `Map<string, ChatContext>` with a new `LRUSessionCache` class (max 50 sessions)
- LRU cache tracks access order; evicts least recently used sessions when at capacity
- `clearSession` now also aborts any in-flight AbortController
- `assistant:deleteConversation` handler now calls `rag.clearSession(id)` to clean up the associated RAG session on delete

### B-CHAT-003: Replace Browser confirm/alert Dialogs

**Files:** `src/pages/Chat.tsx`

- Replaced `confirm('Are you sure...')` with Radix `AlertDialog` component for delete confirmation
- Added `deleteDialogOpen` and `deleteTargetId` state variables for dialog management
- Replaced all `alert(...)` calls with `toast.error(...)` / `toast.success(...)` / `toast.info(...)` from the existing toast system
- Affected locations: delete conversation, remove context, toggle context, clear all context

### B-CHAT-004: knowledge:getByIds IPC Handler

**Files:** `electron/main/ipc/knowledge-handlers.ts`, `electron/preload/index.ts`, `src/pages/Chat.tsx`

- Added `knowledge:getByIds` IPC handler with `WHERE id IN (?)` parameterized query
- Builds placeholders dynamically: `ids.map(() => '?').join(',')`
- Validates input: returns empty array for empty/non-array IDs
- Exposed via preload as `window.electronAPI.knowledge.getByIds(ids)`
- Chat.tsx `handleSelectConversation` now uses `getByIds` instead of fetching all knowledge captures and filtering client-side

### B-CHAT-005: Cancel In-Flight RAG Requests

**Files:** `electron/main/services/rag.ts`, `electron/main/services/ollama.ts`, `electron/main/ipc/rag-handlers.ts`, `electron/preload/index.ts`, `src/pages/Chat.tsx`

- Added `activeControllers: Map<string, AbortController>` to RAGService
- Each `chat()` call creates an AbortController and stores it by session ID
- Controller's signal is passed through to `ollama.chat()` and then to `fetch()`
- Added `cancelRequest(sessionId)` method that aborts the controller and returns boolean
- Added `rag:cancel` IPC handler exposed as `window.electronAPI.rag.cancel(sessionId)`
- OllamaService `chat()` method now accepts optional `signal: AbortSignal` parameter
- OllamaService catches `AbortError` separately with a clean log message
- Chat.tsx shows a "Cancel" button next to the loading indicator while processing

### B-CHAT-006: Token-Aware History Trimming

**Files:** `electron/main/services/rag.ts`

- Added `estimateTokens(text)` utility: `Math.ceil(text.length / 4)`
- Added `trimHistoryByTokens(history, maxTokens=4096)` utility that walks backwards through history, keeping most recent messages that fit within the token budget
- RAG `chat()` method now uses `trimHistoryByTokens` instead of `slice(-6)` to build the LLM message history
- Background pruning increased from `slice(-10)` to `slice(-20)` since token trimming handles the real constraint at query time
- Both utilities are exported for testing

### B-CHAT-007: Replace SELECT * with Explicit Columns

**Files:** `electron/main/ipc/assistant-handlers.ts`, `electron/main/ipc/knowledge-handlers.ts`, `electron/main/services/rag.ts`

- `assistant-handlers.ts`: Defined `CONVERSATION_COLUMNS` and `MESSAGE_COLUMNS` constants; all `SELECT *` queries replaced
- `knowledge-handlers.ts`: Defined `KNOWLEDGE_CAPTURE_COLUMNS` constant; all `SELECT *` queries replaced including the new `getByIds` handler
- `rag.ts` `globalSearch`: Replaced `SELECT *` with `SELECT id, title, summary, captured_at` for knowledge, `SELECT id, name, email, type` for contacts, and `SELECT id, name, description, status` for projects
- Fixed index-based field mapping in globalSearch that was fragile with SELECT * (previously `capturedAt: v[15]` hardcoded index, now `capturedAt: v[3]` matching explicit column order)

## Tests Added

### `electron/main/services/__tests__/rag-lru-tokens.test.ts` (11 tests)

- **estimateTokens**: Correct ceiling division, empty string, various lengths
- **trimHistoryByTokens**: Empty history, within limit, exceeding limit keeps recent, single-message exceeds, default maxTokens
- **LRU Eviction**: Evicts at capacity (50), evicts LRU not MRU, clearSession works
- **cancelRequest**: Returns false for non-existent, returns true for active session

### `electron/main/ipc/__tests__/knowledge-getByIds.test.ts` (8 tests)

- Registers handler, empty IDs, null input, multiple captures, correct placeholders, single ID, DB error handling, no SELECT * in query

### Updated test

- `electron/main/ipc/__tests__/knowledge-handlers.test.ts`: Updated assertion to verify explicit columns instead of `SELECT *`

## Test Results

All 840 tests pass across 56 test files.
