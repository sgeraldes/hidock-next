# Specification: Complete Knowledge App Redesign

## 1. Overview
This track implements the comprehensive redesign of the HiDock Next Knowledge System as defined in `plans/knowledge-app-redesign.md`. The goal is to transform the app from a simple device manager into a knowledge-first system that organizes, connects, and generates insights from audio captures.

## 2. Core Components

### 2.1 Knowledge Architecture (Phase 1.5)
- **Data Model:** Migrate from `recordings` table to `knowledge_captures` (entity renaming and schema expansion).
- **Quality & Retention:** Implement quality ratings (Valuable, Low-Value, Archived) and retention policies.
- **Backend Handlers:** Create IPC handlers for the new knowledge entities.

### 2.2 Assistant Enhancement (Phase 2)
- **Conversation History:** Persist chat sessions with titles and timestamps.
- **Context Injection:** Allow users to attach specific knowledge captures to a conversation context.
- **Artifacts:** Generate outputs (summaries, reports) directly from chat.
- **Insights:** Save chat responses as new knowledge items.

### 2.3 Organization (Phase 3)
- **People Entity:** Auto-populated from meeting attendees and transcript speakers.
    - View: List of people, detail view with interaction history and knowledge map.
- **Projects Entity:** Auto-suggested groupings of knowledge based on topics and titles.
    - View: List of projects, detail view with aggregated knowledge and action items.

### 2.4 Actionables (Phase 4)
- **Actionables Hub:** A new view for pending tasks and suggested outputs.
- **Output Generation:** Template-based generation of documents (Meeting Minutes, Interview Feedback, Status Reports).
- **Auto-Suggestions:** Proactive suggestions for outputs based on meeting type (e.g., "Send minutes" for team meetings).

### 2.5 Intelligence (Phase 5)
- **Explore (Search):** Advanced search across all entities (Knowledge, People, Projects).
- **Insights Discovery:** "Insights Mode" to find recurring topics and collaboration patterns.
- **Cross-Entity Connections:** Visualization of relationships between people, projects, and knowledge.

## 3. Implementation Requirements

### 3.1 Backend (Electron/Node.js)
- **Database:** SQLite schema updates (migrations) for all new entities.
- **IPC:** Secure IPC handlers for CRUD operations and complex queries.
- **Services:**
    - `KnowledgeService`: Core logic for captures.
    - `AssistantService`: Chat management and context handling.
    - `OrganizationService`: Logic for auto-populating People and Projects.
    - `ActionableService`: Logic for suggestions and template generation.

### 3.2 Frontend (React)
- **Pages:** Update/Create `Library`, `Assistant`, `People`, `Projects`, `Actionables`, `Explore`.
- **Components:** Reusable UI components for knowledge cards, chat interface, entity lists, and document previews.
- **State Management:** Zustand stores for new entities.

### 3.3 Testing
- **Unit Tests:** For all new services and utility functions.
- **Integration Tests:** For database operations and IPC handlers.
- **UI Tests:** For critical user flows (e.g., generating an output, searching).

## 4. Success Criteria
- **Data Integrity:** Successful migration of existing recordings to knowledge captures without data loss.
- **Functionality:** All new views (People, Projects, Actionables) are populated and interactive.
- **AI Integration:** Assistant correctly uses injected context to answer questions.
- **Performance:** UI remains responsive with large knowledge bases (>1000 items).
