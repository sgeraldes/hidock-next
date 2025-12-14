# HiDock Meeting Intelligence

Cross-platform Electron application for managing HiDock device recordings with calendar integration, AI transcription, and RAG-powered chat.

## Features

- **Calendar Sync** - Import meetings from ICS feeds (Google Calendar, Outlook, etc.)
- **RAG Chat** - Query your meeting transcripts using natural language
- **AI Transcription** - Automatic transcription with Google Gemini
- **Device Management** - Sync recordings from HiDock H1/H1E/P1 devices
- **Recordings Browser** - View and play downloaded recordings with transcripts
- **Vector Search** - Semantic search across all meeting content

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

```
apps/electron/
├── electron/
│   ├── main/              # Main process (Node.js backend)
│   │   ├── index.ts       # App entry point
│   │   ├── ipc/           # IPC handlers
│   │   └── services/      # Core services
│   └── preload/           # Context bridge
├── src/                   # Renderer process (React frontend)
│   ├── pages/             # Application pages
│   ├── components/        # UI components
│   ├── services/          # Device communication
│   └── store/             # Zustand state
└── resources/             # App icons
```

## Pages

| Page | Description |
|------|-------------|
| Calendar | Week/month view with meeting list |
| Chat | RAG-powered chat to query transcripts |
| Device | HiDock device connection and file sync |
| Recordings | Browse downloaded recordings with playback |
| Contacts | View people from meetings, add notes, see meeting history |
| Projects | Create projects, tag meetings, view topics |
| Outputs | Generate documents (minutes, feedback, reports) from transcripts |
| Search | Full-text search across transcripts |
| Settings | Configuration (API keys, calendar URL, etc.) |

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

| Table | Description |
|-------|-------------|
| meetings | Calendar events from ICS sync |
| recordings | Audio files synced from device |
| transcripts | AI-generated transcripts |
| contacts | People extracted from meeting attendees |
| projects | User-created project tags |
| meeting_contacts | Junction table linking meetings to contacts |
| meeting_projects | Junction table linking meetings to projects |
| vector_embeddings | Text chunks with embeddings for RAG |
| transcription_queue | Processing queue |
| chat_messages | RAG chat history |
| synced_files | Track downloaded device files |

## Technology Stack

- **Electron 33** - Cross-platform desktop framework
- **React 18** - UI framework
- **TypeScript** - Type safety
- **electron-vite** - Build tool
- **Zustand** - State management
- **SQL.js** - SQLite database
- **Tailwind CSS** - Styling
- **Radix UI** - UI components
- **ical.js** - ICS parsing
- **Ollama** - Local LLM
- **Google Gemini** - AI transcription

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
