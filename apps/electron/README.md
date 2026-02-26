# HiDock Universal Knowledge Hub

**The fourth iteration and PRIMARY APPLICATION of HiDock Next** - A cross-platform Electron application that transforms ANY information source into actionable insights. Not just audio recordings - this is a universal knowledge extraction and management system.

## Vision: Universal Knowledge Hub

This is the **integrated vision** that unifies all previous HiDock Next iterations (Desktop device management, Web transcription, Audio Insights analysis) into a single, powerful intelligence system. The goal is to extract data, create insights, and produce results from ANY knowledge source - not just recordings, but PDFs, presentations, documents, markdown files, notes, calendar events, emails, Slack messages, and more.

## Current Features (Wave 4 Refactor)

### Knowledge Extraction & Management
- **Device Management** - Sync recordings from HiDock H1/H1E/P1 devices (integrates Desktop app capabilities)
- **AI Transcription** - Automatic transcription with Google Gemini (integrates Web app capabilities)
- **Unified Library** - Browse and manage all recordings with advanced filtering and search (integrates Audio Insights capabilities)
- **Auto-Refresh** - Real-time detection and updates when new recordings are added
- **Waveform Visualization** - Immediate audio visualization on selection

### Intelligence & Search
- **RAG Chat** - Query your meeting transcripts using natural language
- **Vector Search** - Semantic search across all meeting content
- **Calendar Sync** - Import meetings from ICS feeds and correlate with recordings

### Future Capabilities (Universal Knowledge Hub)
- **Multi-Artifact Support** - PDFs, PPTX, DOCX, MD, notes, emails, Slack messages
- **Universal Extraction** - Extract insights from any artifact type
- **Cross-Source Insights** - Connect knowledge across different information sources
- **Document Generation** - Create minutes, feedback reports, summaries from any knowledge source
- **Enhanced Intelligence** - Multi-modal AI analysis across all artifact types

## Evolution: From Device Management to Universal Knowledge Hub

HiDock Next evolved through four iterations, each building toward the ultimate vision:

1. **Desktop App (First Iteration)** - Python/CustomTkinter application focused on HiDock device management via USB (Jensen protocol). Provided file sync, device settings, and basic audio playback.

2. **Web App (Second Iteration)** - React/TypeScript browser interface using WebUSB API. Made recordings accessible anywhere without drivers, added multi-provider AI transcription.

3. **Audio Insights (Third Iteration)** - Proof-of-concept for AI-powered audio analysis and insight extraction from transcriptions.

4. **Electron App (Fourth Iteration - Current)** - The integrated vision that combines all previous capabilities into a universal knowledge hub. Currently focused on recordings, but architected for ANY artifact type.

### What Makes This Different

This is not just an "audio app" - it's the foundation of a universal knowledge extraction system:

- **Integrated Capabilities**: Combines device management (from Desktop), transcription (from Web), and insights (from Audio Insights) in one application
- **Universal Architecture**: Designed to handle recordings NOW, but built to support ANY knowledge source (documents, notes, emails, etc.) in the future
- **Knowledge-First Approach**: Organized around insights and information, not just files
- **Cross-Source Intelligence**: Will connect knowledge across different information sources
- **Extraction Pipeline**: Extract → Chunk → Embed → Analyze → Produce Results

## Quick Start

### Prerequisites

- Node.js 18+
- Ollama (for RAG chat) - [Install Ollama](https://ollama.ai)
- Google Gemini API key (for transcription)

### Installation

```bash
cd apps/electron
npm install
```

### Setup Ollama

```bash
# Start Ollama service
ollama serve

# Pull required models
ollama pull nomic-embed-text  # For embeddings
ollama pull llama3.2          # For chat
```

### Run Development

```bash
npm run dev
```

### Build for Production

```bash
npm run build:win    # Windows
npm run build:mac    # macOS
npm run build:linux  # Linux
```

## Architecture

### Current Architecture (Recording-Focused)

```
apps/electron/
├── electron/
│   ├── main/              # Main process (Node.js backend)
│   │   ├── index.ts       # App entry point
│   │   ├── ipc/           # IPC handlers (device, downloads, migrations)
│   │   └── services/      # Core services
│   │       ├── recording-watcher.ts   # Auto-refresh file monitoring
│   │       ├── device-service.ts      # USB device communication
│   │       ├── download-service.ts    # 4-layer sync reconciliation
│   │       └── database.ts            # SQLite knowledge storage
│   └── preload/           # Context bridge
├── src/                   # Renderer process (React frontend)
│   ├── pages/             # Application pages
│   │   ├── Library.tsx    # Unified Knowledge Library (main view)
│   │   ├── Device.tsx     # Device management interface
│   │   └── Chat.tsx       # RAG-powered chat
│   ├── components/        # UI components
│   │   ├── SourceRow.tsx         # Knowledge item display
│   │   ├── MiddlePanel.tsx       # Action buttons & metadata
│   │   └── OperationController.tsx # Audio playback & waveform
│   ├── hooks/             # State management hooks
│   │   └── useUnifiedRecordings.ts # Recording aggregation
│   ├── services/          # Frontend services
│   └── store/             # Zustand global state
│       └── useLibraryStore.ts    # Library filters & preferences
└── resources/             # App icons
```

### Future Architecture (Universal Knowledge Hub)

```
Knowledge Library (Multi-Artifact)
├── Recordings (current implementation)
│   ├── Device recordings (H1/H1E/P1 via USB)
│   ├── Local audio files
│   └── Synced/downloaded recordings
├── Documents (planned)
│   ├── PDF files
│   ├── Word documents (DOCX)
│   └── PowerPoint presentations (PPTX)
├── Notes (planned)
│   ├── Markdown files
│   └── Plain text notes
├── Communications (planned)
│   ├── Email messages
│   └── Slack conversations
├── Calendar (partial)
│   └── Meeting events with correlations
└── Web Artifacts (planned)
    ├── Bookmarks
    └── Saved articles

Each artifact type will support:
- AI-powered extraction and chunking
- Cross-artifact search and linking
- Unified metadata schema
- Insight generation and correlation
- Vector embeddings for semantic search
```

## Pages

| Page | Description | Status |
|------|-------------|--------|
| Library | Unified Knowledge Library - view all recordings with filtering, search, and organization | Current (Wave 4) |
| Device | HiDock device connection and file sync (integrates Desktop app functionality) | Current |
| Chat | RAG-powered chat to query transcripts using natural language | Current |
| Calendar | Week/month view with meeting list and correlation with recordings | Current |
| Recordings | Browse downloaded recordings with playback and waveform visualization | Current |
| Contacts | View people from meetings, add notes, see meeting history | Current |
| Projects | Create projects, tag meetings, view topics | Current |
| Outputs | Generate documents (minutes, feedback, reports) from transcripts | Current |
| Search | Full-text and semantic search across all knowledge content | Current |
| Settings | Configuration (API keys, calendar URL, etc.) | Current |
| Documents | Multi-format document viewer and extractor (PDF, DOCX, PPTX) | Planned |
| Notes | Markdown and text note management with linking | Planned |
| Communications | Email and Slack message integration | Planned |
| Insights | Cross-artifact knowledge discovery and correlation | Planned |

## Configuration

App data is stored in `~/HiDock/`:

```
~/HiDock/
├── config.json        # Application settings
├── data/
│   └── hidock.db      # SQLite database
├── recordings/        # Downloaded audio files
└── transcripts/       # Generated transcripts
```

### Settings

| Setting | Description |
|---------|-------------|
| Calendar ICS URL | URL to your calendar ICS feed |
| Auto-sync | Enable automatic calendar refresh |
| Gemini API Key | Google Gemini API key for transcription |
| Ollama URL | Local Ollama server URL (default: http://localhost:11434) |
| Chat Provider | Choose between Ollama or Gemini for chat |

## Database Schema

### Current Schema (Recording-Focused)

| Table | Description |
|-------|-------------|
| recordings | Audio file metadata and status |
| synced_files | Track downloaded device files |
| transcripts | AI-generated transcriptions |
| meetings | Calendar events from ICS sync |
| contacts | People extracted from meeting attendees |
| projects | User-created project tags |
| meeting_contacts | Junction table linking meetings to contacts |
| meeting_projects | Junction table linking meetings to projects |
| vector_embeddings | Text chunks with embeddings for RAG search |
| transcription_queue | Processing queue for transcription jobs |
| chat_messages | RAG chat history |

### Future Schema (Universal Knowledge Hub)

Additional tables for multi-artifact support:

| Table | Description |
|-------|-------------|
| artifacts | Universal artifact metadata (recordings, documents, notes, etc.) |
| artifact_types | Type definitions for all knowledge sources |
| documents | PDF, DOCX, PPTX file metadata |
| notes | Markdown and text note content |
| communications | Email and Slack message metadata |
| artifact_chunks | Text chunks from any artifact type |
| artifact_embeddings | Vector embeddings for all artifact types |
| artifact_links | Cross-references between artifacts |
| insights | AI-generated insights across artifacts |
| knowledge_captures | Consolidated knowledge entries |
| action_items | Extracted action items from any source |

## Technology Stack

### Core Framework
- **Electron 33** - Cross-platform desktop framework
- **React 18** - UI framework with hooks
- **TypeScript** - Type safety throughout

### Build & Development
- **electron-vite** - Fast build tool with HMR
- **Vite** - Frontend bundler
- **Vitest** - Unit testing framework

### State & Data
- **Zustand** - Lightweight state management
- **better-sqlite3** - Fast SQLite database (via Electron main process)
- **IPC** - Inter-process communication for data flow

### UI & Styling
- **Tailwind CSS** - Utility-first styling
- **Radix UI** - Accessible component primitives
- **Lucide React** - Icon library

### AI & Intelligence
- **Google Gemini API** - AI transcription and chat
- **Ollama** - Local LLM for privacy-focused RAG
- **Vector Embeddings** - Semantic search capabilities

### Device Communication
- **node-usb** - USB device communication (HiDock devices)
- **Jensen Protocol** - HiDock device protocol implementation

### Utilities
- **ical.js** - ICS calendar parsing
- **date-fns** - Date manipulation
- **react-markdown** - Markdown rendering
- **zod** - Runtime type validation

### Future Stack Extensions
- **pdf.js** - PDF parsing and extraction
- **mammoth.js** - DOCX conversion
- **pptx-parser** - PowerPoint extraction
- **email-parser** - Email message processing

## Scripts

```bash
npm run dev          # Development with hot reload
npm run build        # Build for production
npm run build:win    # Build Windows executable
npm run build:mac    # Build macOS app
npm run build:linux  # Build Linux AppImage
npm run lint         # Run ESLint
npm run typecheck    # TypeScript type checking
```

## Troubleshooting

### RAG Chat Not Working

1. Ensure Ollama is running: `ollama serve`
2. Check models are installed: `ollama list`
3. Verify Ollama URL in Settings matches your setup

### Transcription Failing

1. Add your Gemini API key in Settings
2. Check recordings are in supported format (WAV, MP3, M4A)
3. Ensure audio file is not corrupted

### Calendar Not Syncing

1. Verify ICS URL is accessible (test in browser)
2. Check auto-sync is enabled in Settings
3. Try manual sync from Calendar page

### Device Not Connecting

1. Ensure HiDock device is connected via USB
2. Try disconnecting and reconnecting the device
3. Check the Device page for connection status

## License

MIT License - See [LICENSE](../../LICENSE) for details.
