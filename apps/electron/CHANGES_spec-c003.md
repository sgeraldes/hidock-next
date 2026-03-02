# Phase C: Chat/RAG MEDIUM Bug Fixes

**Spec:** c003
**Date:** 2026-03-02
**Status:** Complete

## Summary

Resolved 7 genuine MEDIUM-severity bugs in the Chat/RAG system. Skipped 6 items that are feature requests rather than bugs (search within conversation, export conversation, chat sidebar resize, RAG context window config, chat provider state sync which is backend-handled, and loading state which was already implemented in Phase A/B).

## Bugs Fixed

### 1. Atomic Chat Settings Save (Settings.tsx)

**Bug:** `handleSaveChat` saved chat and embeddings config sections sequentially with two separate API calls. If the first succeeded but the second failed, the config would be left in an inconsistent state.

**Fix:** Changed to `Promise.all([...])` to save both sections atomically. Added config reload on failure to ensure consistency.

**File:** `src/pages/Settings.tsx` (lines 258-259 -> Promise.all)

### 2. Chat Input Auto-Focus (Chat.tsx)

**Bug:** The chat input field was never auto-focused on mount or when switching conversations, requiring users to manually click the input every time.

**Fix:** Added `inputRef` with `useRef<HTMLInputElement>` and a `useEffect` that focuses the input after initialization completes and whenever `activeConversation` changes. Uses a small timeout to let DOM settle.

**File:** `src/pages/Chat.tsx`

### 3. Character Count/Limit on Input (Chat.tsx)

**Bug:** No character limit or counter on the message input, allowing unbounded input that could cause issues with the RAG backend.

**Fix:** Added `MAX_INPUT_LENGTH = 4000` constant, `maxLength` attribute on input, character counter display (`{length}/{max}`), and visual warning (red text) when approaching the limit (>90%).

**File:** `src/pages/Chat.tsx`

### 4. Conversation List Not Sorted by Recent (Chat.tsx)

**Bug:** `loadConversations` used the API response order directly without sorting. Only the post-submit handler sorted conversations.

**Fix:** Added `.sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())` to `loadConversations` so conversations are always displayed most-recent-first on initial load.

**File:** `src/pages/Chat.tsx` (loadConversations function)

### 5. Relative Timestamps (Chat.tsx)

**Bug:** Message timestamps used `formatDateTime` which shows absolute dates like "Mon, Mar 1 at 02:30 PM". For recent messages, relative times ("2m ago", "1h ago") are far more useful.

**Fix:** Replaced `formatDateTime(message.createdAt)` with `getRelativeTime(message.createdAt)` (already existed in `lib/utils.ts`). Added `title` attribute with full date for hover. Also added relative timestamps to conversation sidebar items.

**Files:** `src/pages/Chat.tsx`, `src/lib/utils.ts` (used existing `getRelativeTime`)

### 6. Markdown Rendering in AI Responses (Chat.tsx)

**Bug:** AI assistant messages rendered as plain text with `<p className="whitespace-pre-wrap">`, losing all formatting (bold, italic, lists, code blocks) from the AI response.

**Fix:** Added `ReactMarkdown` (already installed as dependency) for assistant messages. User messages remain plain text. Uses `prose prose-sm dark:prose-invert` Tailwind typography classes consistent with the Actionables page pattern.

**File:** `src/pages/Chat.tsx`

### 7. Retry Button for Failed Messages (Chat.tsx)

**Bug:** When an AI response failed, the error message was displayed as a regular assistant message with no way to retry. Users had to retype their question.

**Fix:** Added `failedMessageIds` state (Set) to track which messages are error responses. Failed messages get a red border and a "Retry" button. The retry handler finds the preceding user message, removes the failed response, and re-submits the original query.

**File:** `src/pages/Chat.tsx` (handleRetry callback, failedMessageIds state)

## Items Skipped (Feature Requests)

- **No search within conversation** - New feature, not a bug
- **RAG context window not configurable** - Backend configuration concern
- **Chat sidebar width not resizable** - UI enhancement, not a bug
- **No export conversation feature** - New feature, not a bug
- **Chat provider state not synced with config store** - Not a real bug; the backend reads config directly, and the Settings page correctly syncs local state from the config store
- **No loading state for AI response generation** - Already fixed in Phase A/B (B-CHAT-005)

## Tests Added

### `src/pages/__tests__/Chat.test.tsx`
- Updated mock data with varied timestamps for sorting tests
- **should sort conversations by most recent first** - Verifies conversation ordering
- **should display character count for input field** - Verifies counter shows 0/4000
- **should update character count when typing** - Verifies counter updates on input
- **should render relative timestamps in conversation sidebar** - Verifies "Just now" text
- **should render messages with markdown formatting** - Verifies ReactMarkdown renders bold/italic

### `src/lib/__tests__/utils.test.ts` (NEW)
- Full test suite for `getRelativeTime` (just now, minutes, hours, days, weeks+)
- Tests for `formatDateTime`, `formatDuration`, `formatBytes`, `validateId`

## Test Results

All 978 tests pass across 67 test files.
