# Implementation Plan - Complete Knowledge App Redesign

## Phase 1.5: Core Knowledge Architecture & Data Migration
- [x] Task: Define TypeScript interfaces for `KnowledgeCapture`, `AudioSource`, `ActionItem` in `apps/electron/src/types` [1b78ecd]
    - [ ] Subtask: Create interfaces mirroring the V11 schema
    - [ ] Subtask: Update `UnifiedRecording` to extend or relate to `KnowledgeCapture`
- [x] Task: Implement Backend IPC Handlers for Knowledge Captures [c7ddfc8]
    - [ ] Subtask: Create `knowledge-handlers.ts` in `electron/main/ipc`
    - [ ] Subtask: Implement `getKnowledgeCaptures`, `getKnowledgeCaptureById`, `updateKnowledgeCapture`
    - [ ] Subtask: Register handlers in `index.ts`
- [x] Task: Update Frontend `useUnifiedRecordings` Hook [1509cb0]
    - [ ] Subtask: Refactor hook to consume new `knowledge_captures` data (via IPC)
    - [ ] Subtask: Maintain backward compatibility during migration
- [x] Task: Execute V11 Database Migration [0cc1bde]
    - [ ] Subtask: Run the migration script via the Migration UI (or CLI trigger)
    - [ ] Subtask: Verify data integrity (count check, field verification)
- [x] Task: Update Library Page (formerly Recordings) [8ad05df]
    - [ ] Subtask: Update `Recordings.tsx` to display `KnowledgeCapture` data (title, quality, status)
    - [ ] Subtask: Implement quality rating UI (stars/badges)

## Phase 2: Assistant Enhancement
- [x] Task: Implement Conversation History Backend [589343d]
    - [ ] Subtask: Create `assistant-handlers.ts`
    - [ ] Subtask: Implement `getConversations`, `createConversation`, `deleteConversation`
    - [ ] Subtask: Implement `getMessages`, `addMessage`
- [x] Task: Implement Assistant UI - Sidebar & History [df90d10]
    - [ ] Subtask: Update `Chat.tsx` to include a sidebar for conversation history
    - [ ] Subtask: Implement "New Chat" and "Delete Chat" functionality
- [x] Task: Implement Context Injection Backend [764d95a]
    - [ ] Subtask: Update `chat_messages` table or create `conversation_context` table
    - [ ] Subtask: Implement logic to retrieve context content for AI prompt
- [x] Task: Implement Assistant UI - Context Picker [15be61d]
    - [ ] Subtask: Create `ContextPicker` component (modal/popover) to select Knowledge items
    - [ ] Subtask: Visualize attached context in the chat interface
- [ ] Task: Integrate Context into LLM Prompt
    - [ ] Subtask: Update `llm-service.ts` to prepend context to the system prompt or user message

## Phase 3: Organization (People & Projects)
- [ ] Task: Implement People Entity Backend
    - [ ] Subtask: Create `people-handlers.ts`
    - [ ] Subtask: Implement auto-population logic (from meeting attendees & transcript speakers)
    - [ ] Subtask: Implement `getPeople`, `getPersonById`
- [ ] Task: Implement People UI
    - [ ] Subtask: Create `People.tsx` list view
    - [ ] Subtask: Create `PersonDetail.tsx` view with knowledge map and interaction history
- [ ] Task: Implement Projects Entity Backend
    - [ ] Subtask: Create `projects-handlers.ts`
    - [ ] Subtask: Implement auto-suggestion logic (topic-based)
    - [ ] Subtask: Implement `getProjects`, `getProjectById`
- [ ] Task: Implement Projects UI
    - [ ] Subtask: Create `Projects.tsx` list view
    - [ ] Subtask: Create `ProjectDetail.tsx` view

## Phase 4: Actionables & Outputs
- [ ] Task: Implement Actionables Backend
    - [ ] Subtask: Create `actionables-handlers.ts`
    - [ ] Subtask: Implement logic to aggregate action items and generate suggestions
- [ ] Task: Implement Output Generation Backend
    - [ ] Subtask: Create `output-service.ts`
    - [ ] Subtask: Define templates (Markdown) for Minutes, Reports, etc.
    - [ ] Subtask: Implement generation logic using LLM
- [ ] Task: Implement Actionables UI
    - [ ] Subtask: Create `Actionables.tsx` dashboard (Pending, Suggestions)
    - [ ] Subtask: Create `OutputPreview` component for editing/exporting generated artifacts

## Phase 5: Intelligence
- [ ] Task: Update Explore Backend (Search)
    - [ ] Subtask: Enhance `search-handlers.ts` to index/search People and Projects
    - [ ] Subtask: Implement "Insights" queries (recurring topics)
- [ ] Task: Update Explore UI
    - [ ] Subtask: Refactor `Search.tsx` to `Explore.tsx`
    - [ ] Subtask: Implement faceted search results (Knowledge, People, Projects)
    - [ ] Subtask: Add "Insights" section to the Explore landing page
