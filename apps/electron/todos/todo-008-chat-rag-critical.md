# TODO-008: Chat/RAG System Critical Bugs (5 bugs)

**Priority**: CRITICAL
**Phase**: A
**Domain**: Chat/RAG System
**Audit Reference**: COMPREHENSIVE_BUG_AUDIT_WAVE2.md - Chat/RAG CRITICAL

## Problem

5 CRITICAL bugs in the Chat/RAG system that break conversation history and cause data corruption:

1. **Wrong IPC channel name (wrong session ID)** - Breaks conversation history
2. **Sources stored twice for user messages** - Data duplication
3. **Race condition** - State corruption during rapid messages
4. **No error handling for invalid conversation IDs**
5. **RAG service doesn't validate session exists**

## Current State

From audit findings:
- IPC channel uses wrong session ID, breaking message history
- User messages get sources array duplicated in database
- Race condition when sending messages rapidly
- Invalid conversation IDs cause crashes instead of errors
- RAG queries don't check if session exists before searching

## Impact

- **Broken history**: Messages don't appear in conversation
- **Data corruption**: Duplicate sources in database
- **Crashes**: Invalid IDs cause unhandled errors
- **Silent failures**: RAG queries on non-existent sessions

## Files Affected

- `src/pages/Chat.tsx` - Chat UI component
- `src/store/useChatStore.ts` (or similar) - Chat state
- `electron/main/services/rag.ts` - RAG service
- `electron/main/ipc/chat-handlers.ts` - Chat IPC handlers
- `electron/main/services/database.ts` - Chat message persistence

## Dependencies

- IPC channel naming conventions
- RAG/vector store architecture
- Database schema for chat messages
- Session management

## Acceptance Criteria

### IPC Channel Fix
- [ ] IPC channel uses correct session ID
- [ ] Messages appear in correct conversation
- [ ] Test: send messages to multiple conversations, verify history

### Sources Duplication Fix
- [ ] User messages store sources only once
- [ ] Database schema validates no duplicate sources
- [ ] Test: send message with sources, verify single array in DB

### Race Condition Fix
- [ ] Rapid message sending doesn't corrupt state
- [ ] Messages arrive in correct order
- [ ] Test: send 100 messages rapidly, verify all saved correctly

### Error Handling
- [ ] Invalid conversation IDs return error, not crash
- [ ] RAG validates session exists before querying
- [ ] Clear error messages for different failure types
- [ ] Test: query non-existent session, verify error handling

### General
- [ ] All chat operations reliable
- [ ] No data corruption
- [ ] All tests pass

## Related Bugs

- Chat CRITICAL: Wrong IPC channel name (wrong session ID)
- Chat CRITICAL: Sources stored twice for user messages
- Chat CRITICAL: Race condition
- Chat HIGH: No error handling for invalid conversation IDs
- Chat HIGH: RAG service doesn't validate session exists
