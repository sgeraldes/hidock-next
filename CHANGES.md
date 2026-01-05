# TODO-016: Fix Chat Context Integration

## Summary
Fixed the Chat/Assistant page to properly receive and use recording context when navigating from the Library page via "Ask about this recording" button.

## Problem
The Chat.tsx component was not reading the `location.state.contextId` passed from Library navigation, resulting in users landing on a generic chat page without any recording context.

## Solution Implemented

### 1. Added Navigation Hooks and Imports
- Imported `useLocation` and `useNavigate` from react-router-dom
- Added `FileAudio` icon for context banner UI

### 2. Added State Management
```typescript
const [contextRecording, setContextRecording] = useState<KnowledgeCapture | null>(null)
const [contextLoading, setContextLoading] = useState(false)
const [contextError, setContextError] = useState<string | null>(null)
```

### 3. Implemented Context Loading
Created `loadRecordingContext` function that:
- Validates the knowledge capture exists via `window.electronAPI.knowledge.getById()`
- Sets error state if recording not found
- Auto-creates a new conversation if none exists
- Attaches the context to the conversation via `assistant.addContext()`
- Updates the contextIds and contextItems state

### 4. Added Location State Handling
```typescript
useEffect(() => {
  const state = location.state as { contextId?: string } | null
  if (state?.contextId) {
    loadRecordingContext(state.contextId)
  }
}, [location.state])
```

### 5. Added UI Components

#### Context Loading Banner
Shows a loading spinner when fetching recording context

#### Recording Context Banner
- Displays when a recording context is active
- Shows recording title with FileAudio icon
- Includes "Clear context" button to remove the context

#### Error Banner
- Shows when context fails to load or recording not found
- Displays error message with AlertCircle icon
- Includes "Return to Library" button for easy navigation

### 6. Context Integration
The context is automatically included in chat queries because:
1. The `loadRecordingContext` function calls `assistant.addContext()` to attach the knowledge capture to the conversation
2. The `handleSubmit` function passes the conversation ID to `rag.chatLegacy()`
3. The backend RAG service uses the conversation's attached contexts for query scoping

## Files Modified
- `apps/electron/src/pages/Chat.tsx` - Main implementation

## Acceptance Criteria Met
- [x] Chat.tsx reads location.state.contextId
- [x] Recording context loaded on mount
- [x] Context banner shows recording title
- [x] Chat queries scoped to selected recording (via conversation context)
- [x] Clear context button works
- [x] Invalid context shows error with return option
- [x] Loading state shown during context loading

## Testing Notes
To test the implementation:
1. Navigate to Library page
2. Select a recording with a knowledge capture
3. Click "Ask about this recording"
4. Verify:
   - Navigation to /assistant occurs
   - Loading indicator briefly appears
   - Context banner shows with recording title
   - Send a message and verify response is contextual
   - Click "Clear context" and verify banner disappears
   - Test with invalid context ID to see error banner

## Technical Details
- Context is managed through the conversation's attached context IDs
- The backend RAG service automatically uses these contexts when generating responses
- State is properly managed to avoid race conditions
- Error handling includes user-friendly messages and navigation options
- Loading states prevent UI flashing and provide feedback

## Commit
- Commit SHA: 06789942
- Branch: feature/todo-016-chat-context
