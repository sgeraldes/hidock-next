# Meeting Recorder

Standalone cross-platform meeting recorder with real-time AI transcription, summarization, and meeting intelligence. Part of the HiDock Next suite.

## Features

- **Real-time recording** with system audio and microphone capture
- **AI transcription** via multiple providers (OpenAI, Anthropic, Google, AWS Bedrock, Ollama)
- **Speaker identification** and diarization
- **Meeting summarization** with configurable AI models
- **Translation** of transcripts to other languages
- **End-of-meeting processing** — automatic summary, action items, and insights
- **Attachment support** — associate files and notes with recording sessions
- **Session history** — searchable archive of past meetings
- **System tray** integration with mini control bar
- **Cross-platform** — Windows, macOS, Linux

## Prerequisites

- Node.js 18+
- npm 9+

## Quick Start

```bash
# From the repo root
./run-recorder.sh          # Linux/macOS
run-recorder.bat           # Windows
make recorder              # via Make

# Or directly
cd apps/meeting-recorder
npm install
npm run dev
```

## Scripts

| Command | Description |
|---------|-------------|
| `npm run dev` | Start in development mode (electron-vite) |
| `npm run build` | Production build |
| `npm run preview` | Preview production build |
| `npm run test` | Run tests in watch mode |
| `npm run test:run` | Run tests once |
| `npm run typecheck` | TypeScript check (main + renderer) |
| `npm run lint` | ESLint |
| `npm run build:win` | Build Windows installer (NSIS) |
| `npm run build:mac` | Build macOS DMG |
| `npm run build:linux` | Build Linux AppImage |

## Architecture

```
electron/
  main/                    # Main process (Node.js)
    index.ts               # App bootstrap: database, IPC, windows, tray
    services/
      database.ts          # sql.js (SQLite) — sessions, transcripts, settings
      database-extras.ts   # Settings CRUD with encryption
      session-manager.ts   # Recording session lifecycle
      transcription-pipeline.ts  # Real-time AI transcription
      translation-service.ts     # Transcript translation
      summarization-service.ts   # AI summarization
      end-of-meeting-processor.ts  # Post-meeting analysis
      attachment-service.ts  # File attachments per session
      ai-provider.ts       # Unified AI SDK provider factory
      mic-detector.ts      # Cross-platform microphone detection
      audio-storage.ts     # Recording file management
      window-manager.ts    # Main + control bar windows
      tray-manager.ts      # System tray integration
    ipc/
      handlers.ts          # IPC handler registrar
      *-handlers.ts        # Domain-specific IPC channels
  preload/
    index.ts               # Context bridge (electronAPI)
src/                       # Renderer process (React)
  pages/
    Dashboard.tsx          # Active recording UI
    History.tsx            # Session archive and search
    Settings.tsx           # AI provider configuration
  components/              # Shared UI components (Radix UI + Tailwind)
  hooks/                   # React hooks
  store/                   # Zustand state management
  services/                # Client-side services
```

## Technology Stack

- **Electron** 39 + **electron-vite** for build tooling
- **React** 18 + **TypeScript** for the renderer
- **Zustand** for state management
- **Radix UI** + **Tailwind CSS** for components and styling
- **AI SDK** (`ai` package) with provider adapters for OpenAI, Anthropic, Google, Bedrock, Ollama
- **sql.js** (SQLite compiled to WASM) for local database
- **Vitest** for testing

## AI Provider Configuration

Configure your preferred AI provider in Settings. Supported providers:

| Provider | Required Setting |
|----------|-----------------|
| OpenAI | API key |
| Anthropic | API key |
| Google (Gemini) | API key |
| AWS Bedrock | Region + access credentials |
| Ollama | Base URL (local) |

## Testing

```bash
npm run test:run         # All tests (432+ passing)
npm run typecheck        # TypeScript validation
```

Tests use Vitest with jsdom for renderer tests and Node environment for main process tests. Configuration is in `vitest.config.ts`.
