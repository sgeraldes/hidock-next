# HiDock Universal Knowledge Hub - Architecture

**Version:** 1.0
**Last Updated:** 2026-01-09
**Status:** Living Document

---

## Table of Contents

1. [Overview](#1-overview)
2. [Process Architecture](#2-process-architecture)
3. [Data Architecture](#3-data-architecture)
4. [Service Layer Architecture](#4-service-layer-architecture)
5. [State Management Architecture](#5-state-management-architecture)
6. [Component Architecture](#6-component-architecture)
7. [Current Architecture (Recording-Focused)](#7-current-architecture-recording-focused)
8. [Future Architecture (Universal Knowledge Hub)](#8-future-architecture-universal-knowledge-hub)
9. [Performance Considerations](#9-performance-considerations)
10. [Security Architecture](#10-security-architecture)
11. [Technology Stack Details](#11-technology-stack-details)
12. [Design Patterns](#12-design-patterns)
13. [Testing Architecture](#13-testing-architecture)
14. [Build & Deployment Architecture](#14-build--deployment-architecture)
15. [Migration & Evolution](#15-migration--evolution)

---

## 1. Overview

### 1.1 Vision

HiDock Universal Knowledge Hub is the **fourth iteration and PRIMARY APPLICATION** of HiDock Next - a cross-platform desktop application that transforms **ANY** information source into actionable insights. While currently focused on audio recordings, it's architected to become a universal knowledge extraction and management system.

**What makes this different:**
- **Not just audio**: Designed for recordings NOW, but built for ANY artifact type (documents, notes, emails, etc.)
- **Integrated capabilities**: Combines device management (Desktop app), transcription (Web app), and AI analysis (Audio Insights)
- **Knowledge-first approach**: Organized around insights and information, not just files
- **Universal extraction**: Extract → Chunk → Embed → Analyze → Produce Results

### 1.2 High-Level Architecture

```
┌─────────────────────────────────────────────────────────────────────────┐
│                         Electron Application                             │
├─────────────────────────────┬───────────────────────────────────────────┤
│                             │                                           │
│      Main Process           │         Renderer Process                  │
│      (Node.js)              │         (Chromium/React)                  │
│                             │                                           │
│  ┌─────────────────────┐   │   ┌─────────────────────────────────┐    │
│  │   Services Layer    │   │   │     React UI Layer               │    │
│  │                     │   │   │                                   │    │
│  │  • Recording Watch  │   │   │  • Pages (Library, Device, etc.) │    │
│  │  • Device Service   │◄──┼───┤  • Components (SourceRow, etc.)  │    │
│  │  • Download Service │   │   │  • Hooks (useUnifiedRecordings)  │    │
│  │  • Transcription    │   │   │                                   │    │
│  │  • Database         │   │   └─────────────────────────────────┘    │
│  │  • Vector Store     │   │                                           │
│  │  • RAG/AI           │   │   ┌─────────────────────────────────┐    │
│  │  • Calendar Sync    │   │   │   State Management (Zustand)     │    │
│  │  • Storage Policy   │   │   │                                   │    │
│  └─────────────────────┘   │   │  • useLibraryStore (filters)     │    │
│                             │   │  • useUIStore (UI state)         │    │
│  ┌─────────────────────┐   │   │  • useAppStore (global state)    │    │
│  │   Data Layer        │   │   │  • useDeviceStore (device)       │    │
│  │                     │   │   └─────────────────────────────────┘    │
│  │  • SQLite Database  │   │                                           │
│  │  • File System      │   │                  │                        │
│  │  • USB Devices      │   │                  │                        │
│  └─────────────────────┘   │                  │                        │
│           │                 │                  │                        │
│           │                 │   IPC Bridge     │                        │
│           │◄────────────────┼──────────────────┘                        │
│           │                 │  (contextIsolation: true)                 │
└───────────┼─────────────────┴───────────────────────────────────────────┘
            │
            ▼
    ┌───────────────────┐
    │  External Systems │
    │                   │
    │  • USB Devices    │
    │  • File System    │
    │  • AI APIs        │
    │  • Ollama (RAG)   │
    └───────────────────┘
```

### 1.3 Key Design Principles

1. **Process Separation**: Main process handles data/services, renderer handles UI (security)
2. **Reactive Architecture**: IPC events drive UI updates in real-time
3. **Service-Oriented**: Business logic encapsulated in focused services
4. **Optimistic UI**: UI updates immediately, reconciles with server state
5. **Scalability-First**: Built to handle 5,000+ recordings without lag
6. **Accessibility-First**: WCAG 2.1 AA compliant with keyboard navigation and screen reader support
7. **Future-Proof**: Architecture anticipates multi-artifact support


---

## 2. Process Architecture

### 2.1 Main Process

**Entry Point:** `electron/main/index.ts`

**Responsibilities:**
- Initialize Electron application and system services
- Manage application lifecycle (startup, shutdown, updates)
- Handle IPC communication with renderer process
- Provide secure access to Node.js APIs (file system, USB, database)
- Run background services (file watching, transcription, sync)
- Manage system-level operations (window management, native menus)

**Initialization Sequence:**

```typescript
// From electron/main/index.ts
app.whenReady() →
  1. Create splash window (immediate feedback)
  2. Initialize configuration (~/HiDock/config.json)
  3. Setup file storage (~/HiDock/recordings/)
  4. Initialize SQLite database (~/HiDock/data/hidock.db)
  5. Run integrity checks (data validation)
  6. Initialize vector store (embeddings for RAG)
  7. Initialize RAG service (Ollama/Gemini)
  8. Initialize storage policy service
  9. Register IPC handlers (19 handler modules)
  10. Create main window
  11. Start background services (recording watcher, transcription processor)
  12. Close splash, show main window
```

**Key Services Running in Main Process:**

| Service | File | Purpose |
|---------|------|---------|
| Recording Watcher | `services/recording-watcher.ts` | Monitor file system for new recordings |
| Device Service | IPC handlers via `device-handlers.ts` | USB device communication (Jensen protocol) |
| Download Service | `services/download-service.ts` | 4-layer reconciliation for sync status |
| Database Service | `services/database.ts` | SQLite operations and migrations |
| Transcription Service | `services/transcription.ts` | Multi-provider AI transcription queue |
| Calendar Service | `services/calendar-sync.ts` | ICS parsing and meeting correlation |
| Vector Store | `services/vector-store.ts` | Text embeddings for semantic search |
| RAG Service | `services/rag.ts` | Retrieval-Augmented Generation for chat |
| Storage Policy | `services/storage-policy.ts` | Tiered storage management |
| Integrity Service | `services/integrity-service.ts` | Data validation and repair |
| Event Bus | `services/event-bus.ts` | Internal event coordination |

### 2.2 Renderer Process

**Entry Point:** `src/main.tsx`

**Responsibilities:**
- Render React UI components
- Handle user interactions and input
- Manage client-side state (Zustand stores)
- Request data from main process via IPC
- Display real-time updates from main process
- Provide accessible, responsive interface

**React Component Hierarchy:**

```
main.tsx (entry)
  └─ App.tsx (router, error boundary)
      ├─ Layout.tsx (navigation, header)
      └─ Routes
          ├─ Library.tsx ⭐ PRIMARY VIEW
          │   ├─ LibraryHeader (title, actions)
          │   ├─ LibraryFilters (filter controls)
          │   ├─ TriPaneLayout
          │   │   ├─ SourceRow (list items) [virtualized]
          │   │   ├─ SourceReader (center panel)
          │   │   └─ AssistantPanel (AI panel)
          │   ├─ BulkActionsBar (multi-select)
          │   └─ DeviceDisconnectBanner
          ├─ Device.tsx (device management)
          ├─ Chat.tsx (RAG-powered chat)
          ├─ Calendar.tsx (meeting timeline)
          ├─ People.tsx (contacts)
          ├─ Projects.tsx (project tags)
          ├─ Actionables.tsx (action items)
          ├─ Explore.tsx (semantic search)
          └─ Settings.tsx (configuration)
```

### 2.3 IPC Communication

**Architecture:** Unidirectional data flow with event-driven updates

**Communication Patterns:**

1. **Renderer → Main (Request/Response)**
   ```typescript
   // Renderer invokes handler
   const result = await window.electron.ipcRenderer.invoke('db:getRecordings')

   // Main process handles
   ipcMain.handle('db:getRecordings', async () => {
     return getRecordings()
   })
   ```

2. **Main → Renderer (Events)**
   ```typescript
   // Main process emits event
   mainWindow.webContents.send('recording:new', { recording })

   // Renderer listens
   window.electron.ipcRenderer.on('recording:new', (event, data) => {
     // Update UI
   })
   ```

**IPC Channel Namespaces:**

| Namespace | Handlers | Purpose |
|-----------|----------|---------|
| `app:*` | `app-handlers.ts` | App lifecycle, version info |
| `config:*` | `config-handlers.ts` | Configuration CRUD |
| `db:*` | `database-handlers.ts` | Direct database queries |
| `calendar:*` | `calendar-handlers.ts` | Calendar sync operations |
| `storage:*` | `storage-handlers.ts` | File system operations |
| `recording:*` | `recording-handlers.ts` | Recording metadata and operations |
| `rag:*` | `rag-handlers.ts` | RAG chat and search |
| `contacts:*` | `contacts-handlers.ts` | Contact management |
| `projects:*` | `projects-handlers.ts` | Project tagging |
| `outputs:*` | `outputs-handlers.ts` | Document generation |
| `quality:*` | `quality-handlers.ts` | Quality assessment |
| `migration:*` | `migration-handlers.ts` | Schema migrations |
| `device:*` | Device service (via store) | USB device operations |
| `download:*` | `download-service.ts` | Download management |
| `integrity:*` | `integrity-handlers.ts` | Data integrity checks |
| `knowledge:*` | `knowledge-handlers.ts` | Knowledge captures (v11+) |
| `assistant:*` | `assistant-handlers.ts` | AI assistant features |
| `actionables:*` | `actionables-handlers.ts` | Action item management |

**Event Channels (Main → Renderer):**

| Event | Trigger | Purpose |
|-------|---------|---------|
| `recording:new` | File watcher detects new recording | Auto-refresh library |
| `download:progress` | Download service updates | Show download progress |
| `download:complete` | File download finishes | Update UI with new file |
| `device:connected` | USB device attached | Enable device features |
| `device:disconnected` | USB device removed | Show disconnect banner |
| `transcription:progress` | Transcription updates | Show transcription progress |
| `transcription:complete` | Transcription finishes | Update transcript display |
| `migration:progress` | Schema migration updates | Show migration progress |
| `calendar:synced` | Calendar sync completes | Refresh meeting data |

### 2.4 Security Considerations

**Context Isolation:** Enabled (`contextIsolation: true`)
- Renderer process cannot directly access Node.js APIs
- Only exposed APIs via preload script (`electron/preload/index.ts`)

**Node Integration:** Disabled (`nodeIntegration: false`)
- Prevents remote code execution vulnerabilities
- Renderer runs in sandboxed environment

**Preload Script API Surface:**
```typescript
// Minimal, explicit API exposed to renderer
window.electron = {
  ipcRenderer: {
    invoke: (channel, ...args) => ipcRenderer.invoke(channel, ...args),
    on: (channel, listener) => ipcRenderer.on(channel, listener),
    off: (channel, listener) => ipcRenderer.off(channel, listener)
  }
}
```

**Content Security Policy:** Defined in `index.html`
- Restricts script sources
- Prevents inline script execution
- Blocks unsafe eval


---

## 3. Data Architecture

### 3.1 Database Layer (SQLite + better-sqlite3)

**Database Location:** `~/HiDock/data/hidock.db`  
**Schema Version:** 17 (as of 2026-01-09)  
**Migration Strategy:** Forward-only versioned migrations

**Why SQLite?**
- **Zero configuration**: No server setup required
- **Fast**: better-sqlite3 uses synchronous bindings  
- **Reliable**: ACID-compliant transactions
- **Portable**: Single file database
- **Scalable**: Handles 5,000+ recordings efficiently

**Core Schema:** See full implementation in `electron/main/services/database.ts`

Key tables:
- `meetings` - Calendar events from ICS feeds
- `recordings` - Audio file metadata with lifecycle tracking  
- `synced_files` - Device → local sync tracking
- `transcriptions` - AI-generated transcripts
- `vector_embeddings` - Text embeddings for RAG
- `contacts`, `projects` - People and tags
- `transcription_queue` - Processing queue

### 3.2 Future Schema Evolution

**V11 Migration:** Introduction of `knowledge_captures` table (universal knowledge entity)

**Future:** Multi-artifact tables for documents, notes, emails, with universal chunking and cross-artifact linking.

See `DOCS_UPDATE_SUMMARY.md` for complete future schema documentation.

---

## 4-15. Remaining Sections

Due to document size constraints, the remaining sections (4-15) are summarized below. For complete implementation details, refer to the source code files listed.

### 4. Service Layer Architecture

**Key Services** (all in `electron/main/services/`):

- **recording-watcher.ts** - File system monitoring, auto-add to database
- **download-service.ts** - 4-layer reconciliation for sync status
- **database.ts** - SQLite operations and migrations
- **transcription.ts** - Multi-provider AI transcription queue  
- **calendar-sync.ts** - ICS parsing and meeting correlation
- **vector-store.ts** - Text embeddings for RAG
- **rag.ts** - Retrieval-Augmented Generation
- **storage-policy.ts** - Tiered storage management
- **integrity-service.ts** - Data validation and repair
- **event-bus.ts** - Internal event coordination

**Future Services:** Document Parser, Note Manager, Email Connector, Slack Integration

### 5. State Management (Zustand)

**Stores** (all in `src/store/`):

- **useLibraryStore.ts** - Filters, view mode, selection (partially persisted)
- **useUIStore.ts** - Toasts, loading, modals (transient)
- **useAppStore.ts** - Global state, downloads (transient)
- **useDeviceStore.ts** - Device connection (transient)

**Why Zustand:** Minimal boilerplate, fast, persistent, TypeScript-first

### 6. Component Architecture

**Primary View:** `src/pages/Library.tsx`

**Component Hierarchy:**
- LibraryHeader, LibraryFilters, DeviceDisconnectBanner
- TriPaneLayout (SourceRow list, SourceReader, AssistantPanel)
- BulkActionsBar, BulkProgressModal, LiveRegion

**Feature Components:** SourceRow, SourceDetailDrawer, OperationController, AudioPlayer, WaveformCanvas

**UI Components:** Radix UI primitives (button, dialog, select, slider, tabs, toast, tooltip)

### 7. Current Architecture (Recording-Focused)

**Data Flow:** File System → Recording Watcher → Database → IPC Event → Zustand → useUnifiedRecordings → Library Re-render

**Key Workflows:**
- Auto-refresh on file changes
- Multi-provider transcription queue
- Waveform generation on selection
- Calendar meeting correlation (2-hour window)

### 8. Future Architecture (Universal Knowledge Hub)

**Multi-Artifact Types:** Recordings (current), Documents, Notes, Communications, Calendar, Web Artifacts

**Universal Extraction Pipeline:** ANY Artifact → Type Detection → Extract → Chunk → Embed → Analyze → Store → Index

**Evolution Phases:**
1. Recording Focus (current) ✅
2. Knowledge Captures V11 (in progress) ⏳
3. Document Support 📋
4. Note Support 📋
5. Communication Support 📋
6. Universal Knowledge Graph 📋

### 9. Performance

**Strategies:** Virtual scrolling (@tanstack/react-virtual), lazy loading, debouncing, React 18 transitions, memoization, IPC batching

**Targets:** Library render <100ms, filter change <200ms, waveform <2s, search <500ms

**Monitoring:** Benchmark tests in `src/__tests__/performance/` and `electron/main/services/__tests__/benchmark.test.ts`

### 10. Security

**IPC:** Context isolation enabled, minimal preload API surface, channel validation

**Data:** API keys in `~/HiDock/config.json` (0600), WebUSB permissions, no write outside app directory

**CSP:** Restricts script sources, prevents inline scripts

**Future:** Multi-artifact access control, OS keychain, encryption at rest, audit logging

### 11. Technology Stack

**Core:** Electron 33, React 18.3, TypeScript 5.6, Node.js 22

**Build:** electron-vite, Vite, electron-builder, Vitest

**State & Data:** Zustand, better-sqlite3, sql.js

**UI:** Tailwind CSS, Radix UI, Lucide React, @tanstack/react-virtual

**AI:** @google/generative-ai (Gemini), Ollama (local LLM), nomic-embed-text, llama3.2

**Device:** WebUSB API, Jensen Protocol

**Utilities:** ical.js, date-fns, react-markdown, zod, uuid

**Future:** pdf.js, mammoth.js, pptx-parser, imap, @slack/web-api

### 12. Design Patterns

**Architectural:** Service Layer, Repository, Observer (IPC events), Strategy (AI providers), Adapter (device interface), Factory (artifact creation)

**React:** Custom hooks (useUnifiedRecordings, useLibraryFilterManager, useTransitionFilters), compound components, minimal context

### 13. Testing

**Strategy:** Unit tests (Vitest, 80%+ coverage), component tests (@testing-library/react), integration tests, accessibility tests (jest-axe, WCAG 2.1 AA), performance tests

**Mocking:** IPC (vi.fn()), services (dependency injection), database (in-memory SQLite)

### 14. Build & Deployment

**Development:** `npm run dev` (HMR enabled)

**Production:** `npm run build`, `npm run build:win/mac/linux`

**Platforms:** Windows (NSIS .exe), macOS (.dmg, code signed), Linux (AppImage, .deb)

**Auto-Update:** electron-updater with update channels (Stable, Beta, Alpha)

### 15. Migration & Evolution

**From Previous Iterations:**
- Desktop App: USB communication, device management
- Web App: WebUSB, multi-provider transcription
- Audio Insights: AI analysis, insight extraction

**Lessons Learned:**
- Heavy GUI frameworks don't scale
- USB should be in main process
- AI analysis should be integrated
- Quality assessment is critical

---

## Key File Locations

**Main Process:**
- Entry: `electron/main/index.ts`
- Services: `electron/main/services/`
- IPC: `electron/main/ipc/`
- Database: `electron/main/services/database.ts`

**Renderer:**
- Entry: `src/main.tsx`
- Pages: `src/pages/`
- Components: `src/components/`, `src/features/library/components/`
- Hooks: `src/hooks/`, `src/features/library/hooks/`
- Stores: `src/store/`

## Related Documentation

- **Root CLAUDE.md** - Overall project guidance
- **README.md** - User-facing documentation
- **DOCS_UPDATE_SUMMARY.md** - Documentation gaps and roadmap
- **filter-architecture.md** - Detailed filter system design
- **P1_FIXES_APPLIED.md** - V11 migration documentation

---

**Document Version:** 1.0  
**Last Updated:** 2026-01-09  
**Status:** Living Document (will be updated as architecture evolves)

For detailed implementation, refer to the source code files listed throughout this document.

