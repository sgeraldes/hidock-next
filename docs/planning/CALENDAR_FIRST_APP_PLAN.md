# Calendar-First Meeting Intelligence App - Implementation Plan

## Overview

Transform the HiDock web app into an Electron-based, calendar-first meeting intelligence platform that:
- Automatically transcribes all recordings from HiDock device
- Stores transcripts in a local SQLite database
- Syncs with O365 calendar via ICS URL
- Provides RAG-powered chatbot to query meeting history
- Uses calendar view as the primary interface

## Architecture

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                         ELECTRON APP                                         │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  MAIN PROCESS (Node.js)                                                      │
│  ┌─────────────────────────────────────────────────────────────────────┐    │
│  │                                                                      │    │
│  │  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐               │    │
│  │  │ ICS Service  │  │ SQLite DB    │  │ Ollama       │               │    │
│  │  │              │  │ (better-     │  │ Embeddings   │               │    │
│  │  │ Fetch O365   │  │  sqlite3 +   │  │              │               │    │
│  │  │ calendar     │  │  sqlite-vec) │  │ nomic-embed  │               │    │
│  │  │ every 15min  │  │              │  │ -text        │               │    │
│  │  └──────────────┘  └──────────────┘  └──────────────┘               │    │
│  │                                                                      │    │
│  │  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐               │    │
│  │  │ Transcribe   │  │ File Manager │  │ Chat Service │               │    │
│  │  │ Queue        │  │              │  │              │               │    │
│  │  │              │  │ ~/HiDock/    │  │ Gemini or    │               │    │
│  │  │ Gemini API   │  │ recordings/  │  │ Ollama LLM   │               │    │
│  │  │ (Spanish)    │  │ transcripts/ │  │              │               │    │
│  │  └──────────────┘  └──────────────┘  └──────────────┘               │    │
│  │                                                                      │    │
│  └─────────────────────────────────────────────────────────────────────┘    │
│                                    │                                         │
│                                    │ IPC Bridge                              │
│                                    ▼                                         │
│  RENDERER PROCESS (React + Vite)                                             │
│  ┌─────────────────────────────────────────────────────────────────────┐    │
│  │                                                                      │    │
│  │  ┌─────────────────────────────────────────────────────────────┐    │    │
│  │  │                    CALENDAR VIEW (Primary)                   │    │    │
│  │  │  ┌─────────┐ ┌─────────┐ ┌─────────┐ ┌─────────┐ ┌────────┐ │    │    │
│  │  │  │   Mon   │ │   Tue   │ │   Wed   │ │   Thu   │ │  Fri   │ │    │    │
│  │  │  │         │ │ ┌─────┐ │ │         │ │ ┌─────┐ │ │        │ │    │    │
│  │  │  │ ┌─────┐ │ │ │Meet │ │ │ ┌─────┐ │ │ │Meet │ │ │┌─────┐ │ │    │    │
│  │  │  │ │Meet │ │ │ │ 🎙️  │ │ │ │Meet │ │ │ │ 🎙️  │ │ ││Meet │ │ │    │    │
│  │  │  │ │ 🎙️  │ │ │ └─────┘ │ │ │     │ │ │ └─────┘ │ ││ 🎙️  │ │ │    │    │
│  │  │  │ └─────┘ │ │         │ │ └─────┘ │ │         │ │└─────┘ │ │    │    │
│  │  │  └─────────┘ └─────────┘ └─────────┘ └─────────┘ └────────┘ │    │    │
│  │  │  🎙️ = Has recording & transcript                           │    │    │
│  │  └─────────────────────────────────────────────────────────────┘    │    │
│  │                                                                      │    │
│  │  ┌──────────────────┐  ┌──────────────────┐  ┌─────────────────┐    │    │
│  │  │ Meeting Detail   │  │ Chat Panel       │  │ Device Panel    │    │    │
│  │  │                  │  │                  │  │                 │    │    │
│  │  │ • Transcript     │  │ "What did we     │  │ HiDock WebUSB   │    │    │
│  │  │ • Summary        │  │  decide about    │  │ Connect/Sync    │    │    │
│  │  │ • Action items   │  │  Project X?"     │  │ Auto-download   │    │    │
│  │  │ • Attendees      │  │                  │  │                 │    │    │
│  │  │ • Play audio     │  │ [Answer + refs]  │  │                 │    │    │
│  │  └──────────────────┘  └──────────────────┘  └─────────────────┘    │    │
│  │                                                                      │    │
│  └─────────────────────────────────────────────────────────────────────┘    │
└─────────────────────────────────────────────────────────────────────────────┘
```

## Local Filesystem Structure

```
~/HiDock/                              # Or configurable path
├── data/
│   ├── hidock.db                      # SQLite database
│   └── hidock.db-wal                  # WAL mode for performance
├── recordings/
│   ├── 2024-12-07_0930_standup.wav
│   ├── 2024-12-07_1400_project-review.wav
│   └── ...
├── transcripts/
│   ├── 2024-12-07_0930_standup.txt
│   ├── 2024-12-07_0930_standup.json   # Structured with timestamps
│   └── ...
├── cache/
│   └── calendar.ics                   # Cached ICS file
└── config.json                        # App configuration
```

## Database Schema (SQLite)

```sql
-- Calendar events from ICS
CREATE TABLE meetings (
    id TEXT PRIMARY KEY,                -- UID from ICS
    subject TEXT NOT NULL,
    start_time DATETIME NOT NULL,
    end_time DATETIME NOT NULL,
    location TEXT,
    organizer_name TEXT,
    organizer_email TEXT,
    attendees TEXT,                     -- JSON array
    description TEXT,
    is_recurring INTEGER DEFAULT 0,
    recurrence_rule TEXT,
    meeting_url TEXT,                   -- Teams/Zoom link
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Recordings from HiDock device
CREATE TABLE recordings (
    id TEXT PRIMARY KEY,                -- UUID
    filename TEXT NOT NULL,
    original_filename TEXT,             -- From device
    file_path TEXT NOT NULL,            -- Local path
    file_size INTEGER,
    duration_seconds REAL,
    date_recorded DATETIME NOT NULL,
    meeting_id TEXT,                    -- FK to meetings (nullable)
    correlation_confidence REAL,        -- 0.0-1.0
    correlation_method TEXT,            -- 'timestamp', 'manual'
    status TEXT DEFAULT 'pending',      -- pending, transcribing, transcribed, error
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (meeting_id) REFERENCES meetings(id)
);

-- Transcripts
CREATE TABLE transcripts (
    id TEXT PRIMARY KEY,
    recording_id TEXT NOT NULL,
    full_text TEXT NOT NULL,
    language TEXT DEFAULT 'es',
    summary TEXT,
    action_items TEXT,                  -- JSON array
    topics TEXT,                        -- JSON array
    key_points TEXT,                    -- JSON array
    sentiment TEXT,
    speakers TEXT,                      -- JSON array with speaker labels
    word_count INTEGER,
    transcription_provider TEXT,        -- 'gemini'
    transcription_model TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (recording_id) REFERENCES recordings(id)
);

-- Vector embeddings for RAG (using sqlite-vec extension)
CREATE VIRTUAL TABLE embeddings USING vec0(
    id TEXT PRIMARY KEY,
    transcript_id TEXT,
    chunk_index INTEGER,
    chunk_text TEXT,
    embedding FLOAT[768]                -- nomic-embed-text dimension
);

-- Search index for full-text search
CREATE VIRTUAL TABLE transcripts_fts USING fts5(
    full_text,
    summary,
    action_items,
    topics,
    content=transcripts,
    content_rowid=rowid
);

-- App configuration and state
CREATE TABLE config (
    key TEXT PRIMARY KEY,
    value TEXT,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Processing queue
CREATE TABLE transcription_queue (
    id TEXT PRIMARY KEY,
    recording_id TEXT NOT NULL,
    status TEXT DEFAULT 'pending',      -- pending, processing, completed, failed
    attempts INTEGER DEFAULT 0,
    error_message TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    started_at DATETIME,
    completed_at DATETIME,
    FOREIGN KEY (recording_id) REFERENCES recordings(id)
);
```

## Technology Stack

| Component | Technology | Rationale |
|-----------|------------|-----------|
| **Framework** | Electron + electron-vite | Local app, Node.js access, existing React code |
| **Frontend** | React + TypeScript + Vite | Reuse existing web app code |
| **UI** | Tailwind CSS + shadcn/ui | Modern, fast, good calendar components |
| **Database** | better-sqlite3 + sqlite-vec | Fast, embedded, vector search support |
| **ICS Parsing** | ical.js | Mozilla-backed, RFC 5545 compliant |
| **Transcription** | Gemini API (gemini-2.5-flash) | Best Spanish quality |
| **Embeddings** | Ollama (nomic-embed-text) | Local, free, good quality |
| **Chat/RAG** | Gemini (default) or Ollama | User choice in settings |
| **State** | Zustand | Already used in web app |
| **Calendar UI** | @schedule-x/react or react-big-calendar | Week/month views |

## Configuration (config.json)

```json
{
  "version": "1.0.0",
  "storage": {
    "dataPath": "~/HiDock",
    "maxRecordingsGB": 50
  },
  "calendar": {
    "icsUrl": "https://outlook.office365.com/owa/calendar/..../calendar.ics",
    "syncEnabled": true,
    "syncIntervalMinutes": 15,
    "lastSyncAt": null
  },
  "transcription": {
    "provider": "gemini",
    "geminiApiKey": "...",
    "geminiModel": "gemini-2.5-flash",
    "autoTranscribe": true,
    "language": "es"
  },
  "embeddings": {
    "provider": "ollama",
    "ollamaBaseUrl": "http://localhost:11434",
    "ollamaModel": "nomic-embed-text",
    "chunkSize": 500,
    "chunkOverlap": 50
  },
  "chat": {
    "provider": "gemini",
    "geminiModel": "gemini-2.5-pro",
    "ollamaModel": "llama3.2",
    "maxContextChunks": 10
  },
  "device": {
    "autoConnect": true,
    "autoDownload": true
  },
  "ui": {
    "theme": "system",
    "defaultView": "week",
    "startOfWeek": 1
  }
}
```

---

## Implementation Phases

### Phase 1: Electron Foundation & Database
**Goal:** Set up Electron app with SQLite database and file storage

**Tasks:**
1. Create new Electron app with electron-vite template
2. Copy/adapt existing React components from web app
3. Set up better-sqlite3 with sqlite-vec extension
4. Implement database schema and migrations
5. Create file storage service (recordings/, transcripts/)
6. Build IPC bridge for renderer ↔ main communication
7. Basic settings page with config.json management

**Deliverables:**
- Working Electron app shell
- SQLite database with schema
- File storage working
- Settings page functional

### Phase 2: Calendar Integration
**Goal:** Sync O365 calendar and display in calendar view

**Tasks:**
1. Implement ICS fetching service (periodic + manual refresh)
2. Parse ICS with ical.js, handle recurring events
3. Store meetings in SQLite
4. Build calendar UI component (week view primary)
5. Add month view toggle
6. Show meeting cards with details
7. Calendar sync status indicator
8. Refresh button + auto-sync toggle in settings

**Deliverables:**
- Calendar syncing from your O365 ICS URL
- Week/month calendar view
- Meeting details panel
- Sync controls in settings

### Phase 3: Device Integration & Auto-Transcription
**Goal:** Connect HiDock, auto-download recordings, auto-transcribe

**Tasks:**
1. Port WebUSB device service from web app
2. Implement recording download to local filesystem
3. Create transcription queue system
4. Implement Gemini transcription service
5. Auto-correlate recordings to meetings (timestamp matching)
6. Background transcription worker
7. Progress indicators in UI
8. Recording status badges on calendar events

**Deliverables:**
- HiDock device connection working
- Auto-download to ~/HiDock/recordings/
- Auto-transcription queue
- Recordings linked to calendar meetings
- 🎙️ indicators on calendar for recorded meetings

### Phase 4: Meeting Detail View & Transcript Display
**Goal:** Rich meeting view with transcript, summary, action items

**Tasks:**
1. Meeting detail panel/page design
2. Display full transcript with formatting
3. AI-generated summary display
4. Action items extraction and display
5. Topics/tags display
6. Audio playback integration
7. Manual meeting-recording linking UI
8. Export transcript (txt, md, pdf)

**Deliverables:**
- Click meeting → see full details
- Transcript view with summary
- Action items list
- Audio player
- Export options

### Phase 5: RAG Chatbot
**Goal:** Query meeting history with natural language

**Tasks:**
1. Implement Ollama embedding service (nomic-embed-text)
2. Chunk transcripts and generate embeddings
3. Store embeddings in sqlite-vec
4. Implement vector similarity search
5. Build chat UI component (slide-out panel or tab)
6. Implement RAG pipeline:
   - User question → embed → retrieve relevant chunks → build prompt → LLM response
7. Add source citations (link to specific meetings)
8. Implement Gemini chat provider
9. Implement Ollama chat provider
10. Provider selection in settings

**Deliverables:**
- Chat panel with input
- Ask questions like "What did we decide about Project X?"
- Answers with meeting references
- Toggle between Gemini/Ollama

### Phase 6: Search, Summaries & Polish
**Goal:** Full-text search, weekly summaries, final polish

**Tasks:**
1. Full-text search across transcripts (FTS5)
2. Search filters (date range, person, project/topic)
3. Weekly summary generation ("What happened this week?")
4. Person-centric view (all meetings with X)
5. Notification for new recordings needing transcription
6. Performance optimization
7. Error handling and retry logic
8. App icon, installers (Windows, Mac)

**Deliverables:**
- Global search
- Weekly digest
- Filter by person/project
- Polished, installable app

---

## File Structure (apps/electron/)

```
apps/electron/
├── electron/
│   ├── main/
│   │   ├── index.ts                   # Main process entry
│   │   ├── ipc/
│   │   │   ├── handlers.ts            # IPC handler registration
│   │   │   ├── calendar.ts            # Calendar IPC handlers
│   │   │   ├── database.ts            # DB IPC handlers
│   │   │   ├── transcription.ts       # Transcription IPC handlers
│   │   │   ├── embeddings.ts          # Embeddings IPC handlers
│   │   │   ├── chat.ts                # Chat IPC handlers
│   │   │   └── device.ts              # HiDock device IPC handlers
│   │   ├── services/
│   │   │   ├── database.ts            # SQLite service
│   │   │   ├── calendar-sync.ts       # ICS fetch & parse
│   │   │   ├── transcription.ts       # Gemini transcription
│   │   │   ├── embeddings.ts          # Ollama embeddings
│   │   │   ├── chat.ts                # RAG chat service
│   │   │   ├── file-storage.ts        # File management
│   │   │   └── config.ts              # Config management
│   │   └── workers/
│   │       └── transcription-worker.ts # Background processing
│   └── preload/
│       └── index.ts                   # Preload script (context bridge)
├── src/
│   ├── App.tsx
│   ├── main.tsx
│   ├── pages/
│   │   ├── Calendar.tsx               # Primary view
│   │   ├── MeetingDetail.tsx
│   │   ├── Chat.tsx
│   │   ├── Search.tsx
│   │   ├── Device.tsx
│   │   └── Settings.tsx
│   ├── components/
│   │   ├── calendar/
│   │   │   ├── WeekView.tsx
│   │   │   ├── MonthView.tsx
│   │   │   ├── MeetingCard.tsx
│   │   │   └── CalendarHeader.tsx
│   │   ├── meeting/
│   │   │   ├── TranscriptView.tsx
│   │   │   ├── SummaryCard.tsx
│   │   │   ├── ActionItems.tsx
│   │   │   └── AudioPlayer.tsx
│   │   ├── chat/
│   │   │   ├── ChatPanel.tsx
│   │   │   ├── ChatMessage.tsx
│   │   │   └── ChatInput.tsx
│   │   ├── device/
│   │   │   ├── DeviceStatus.tsx
│   │   │   ├── RecordingsList.tsx
│   │   │   └── SyncProgress.tsx
│   │   ├── search/
│   │   │   ├── SearchBar.tsx
│   │   │   └── SearchResults.tsx
│   │   └── layout/
│   │       ├── Sidebar.tsx
│   │       ├── Header.tsx
│   │       └── Layout.tsx
│   ├── hooks/
│   │   ├── useCalendar.ts
│   │   ├── useDatabase.ts
│   │   ├── useTranscription.ts
│   │   ├── useChat.ts
│   │   └── useDevice.ts
│   ├── lib/
│   │   ├── ipc.ts                     # IPC client helpers
│   │   └── utils.ts
│   ├── store/
│   │   └── useAppStore.ts
│   └── types/
│       └── index.ts
├── resources/
│   └── icon.png
├── electron-builder.json5
├── package.json
├── tsconfig.json
├── tsconfig.node.json
└── vite.config.ts
```

---

## IPC API Design

```typescript
// Calendar
'calendar:sync' → Promise<{ meetings: Meeting[], lastSync: Date }>
'calendar:get-meetings' → Promise<Meeting[]>
'calendar:get-meeting' → Promise<Meeting>
'calendar:set-ics-url' → Promise<void>
'calendar:toggle-auto-sync' → Promise<void>

// Database
'db:query' → Promise<any[]>
'db:get-recordings' → Promise<Recording[]>
'db:get-transcripts' → Promise<Transcript[]>
'db:link-recording-to-meeting' → Promise<void>

// Transcription
'transcription:queue' → Promise<void>
'transcription:get-status' → Promise<QueueStatus>
'transcription:cancel' → Promise<void>
'transcription:retry' → Promise<void>

// Embeddings
'embeddings:generate' → Promise<void>
'embeddings:search' → Promise<ChunkResult[]>
'embeddings:status' → Promise<EmbeddingStatus>

// Chat
'chat:send' → Promise<ChatResponse>
'chat:get-history' → Promise<ChatMessage[]>
'chat:clear-history' → Promise<void>

// Device
'device:connect' → Promise<DeviceInfo>
'device:disconnect' → Promise<void>
'device:get-recordings' → Promise<DeviceRecording[]>
'device:download' → Promise<void>
'device:download-all' → Promise<void>

// Config
'config:get' → Promise<Config>
'config:set' → Promise<void>

// Files
'files:open-folder' → Promise<void>
'files:export-transcript' → Promise<string>
```

---

## Key Dependencies

```json
{
  "dependencies": {
    // Electron
    "electron": "^33.0.0",

    // Database
    "better-sqlite3": "^11.0.0",
    "sqlite-vec": "^0.1.0",

    // Calendar
    "ical.js": "^2.0.0",

    // AI
    "@google/generative-ai": "^0.21.0",
    "ollama": "^0.5.0",

    // React
    "react": "^18.0.0",
    "react-dom": "^18.0.0",
    "react-router-dom": "^6.0.0",

    // UI
    "tailwindcss": "^3.0.0",
    "@radix-ui/react-*": "various",
    "lucide-react": "^0.400.0",
    "@schedule-x/react": "^1.0.0",

    // State
    "zustand": "^4.0.0",

    // Utils
    "date-fns": "^3.0.0",
    "uuid": "^9.0.0"
  },
  "devDependencies": {
    "electron-vite": "^2.0.0",
    "electron-builder": "^24.0.0",
    "typescript": "^5.0.0",
    "vite": "^5.0.0"
  }
}
```

---

## Calendar URL (Saved)

```
https://outlook.office365.com/owa/calendar/a2b08d9dc3654277af7af87bcd47fb9a@dfx5.com/e3847de584334362b30d861f590441d212875226637484402060/calendar.ics
```

This will be stored in config.json on first run or via settings.

---

## Success Criteria

1. **Calendar View**: See week/month with all meetings from O365
2. **Recording Indicators**: Meetings with recordings show 🎙️ icon
3. **Auto-Transcription**: New recordings transcribed automatically via Gemini
4. **Meeting Details**: Click meeting → see transcript, summary, action items
5. **RAG Chat**: Ask "What happened with Project X?" and get accurate answers
6. **Weekly Summary**: Generate "This week's highlights" from all meetings
7. **Search**: Find any meeting by keyword, person, or date
8. **Local-First**: All data on local filesystem, works offline (except transcription/chat)

---

## Next Steps

1. Create `apps/electron/` directory with electron-vite template
2. Set up project structure
3. Begin Phase 1 implementation

Ready to proceed?
