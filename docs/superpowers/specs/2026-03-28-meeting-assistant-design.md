# Meeting Assistant — Design Spec

**Date:** 2026-03-28
**Status:** Approved
**Origin:** Port of OpenOats (macOS Swift) to cross-platform Electron within the Hidock-Next ecosystem

## Overview

Meeting Assistant is a real-time meeting note-taker and conversation assistant that transcribes both sides of a conversation, searches a personal knowledge base to surface relevant talking points, captures screenshots for visual context, and generates structured meeting notes. It runs as a standalone Electron app within the Hidock-Next monorepo.

### Core Philosophy

- **Privacy-first**: Audio and data stay local by default. Cloud services only when explicitly configured by the user.
- **"A meeting note-taker that talks back"**: Not passive — actively surfaces relevant information during calls.
- **Everything configurable**: Zero magic numbers. Every behavior has a sensible default and is user-adjustable in Settings.

## Architecture

### Approach: Hybrid Packages (Enfoque 3)

New packages created in `packages/` from day one. Existing apps (`apps/electron`, `apps/meeting-recorder`) remain untouched. Packages are consumable by any future app in the monorepo.

### Monorepo Structure

```
Hidock-Next/
├── packages/
│   ├── audio-capture/          # Mic + system audio, cross-platform
│   │   ├── src/
│   │   │   ├── mic-capture.ts
│   │   │   ├── system-audio-capture.ts
│   │   │   ├── audio-mixer.ts
│   │   │   ├── chunk-recorder.ts
│   │   │   └── silence-detector.ts
│   │   ├── package.json
│   │   └── tsconfig.json
│   │
│   ├── transcription/          # Multi-provider ASR engine
│   │   ├── src/
│   │   │   ├── engines/
│   │   │   │   ├── cohere-engine.ts
│   │   │   │   ├── chirp3-engine.ts
│   │   │   │   └── engine-interface.ts
│   │   │   ├── pipeline.ts
│   │   │   ├── diarizer.ts
│   │   │   └── vocabulary.ts
│   │   ├── package.json
│   │   └── tsconfig.json
│   │
│   ├── ai-providers/           # Multi-LLM factory pattern
│   │   ├── src/
│   │   │   ├── provider-factory.ts
│   │   │   ├── providers/
│   │   │   └── types.ts
│   │   ├── package.json
│   │   └── tsconfig.json
│   │
│   └── calendar-sync/          # Calendar synchronization
│       ├── src/
│       │   ├── ics-parser.ts
│       │   ├── calendar-watcher.ts
│       │   └── meeting-correlator.ts
│       ├── package.json
│       └── tsconfig.json
│
├── apps/
│   ├── meeting-assistant/      # NEW APP
│   │   ├── electron/
│   │   │   ├── main/
│   │   │   │   ├── index.ts
│   │   │   │   ├── windows/
│   │   │   │   │   ├── main-window.ts
│   │   │   │   │   ├── mini-bar-window.ts
│   │   │   │   │   └── overlay-window.ts
│   │   │   │   ├── services/
│   │   │   │   │   ├── session-manager.ts
│   │   │   │   │   ├── knowledge-base.ts
│   │   │   │   │   ├── suggestion-engine.ts
│   │   │   │   │   ├── notes-generator.ts
│   │   │   │   │   ├── meeting-detector.ts
│   │   │   │   │   ├── screen-capture.ts
│   │   │   │   │   ├── credential-store.ts
│   │   │   │   │   └── database.ts
│   │   │   │   └── ipc/
│   │   │   │       ├── session-handlers.ts
│   │   │   │       ├── transcript-handlers.ts
│   │   │   │       ├── suggestion-handlers.ts
│   │   │   │       ├── notes-handlers.ts
│   │   │   │       ├── screenshot-handlers.ts
│   │   │   │       └── settings-handlers.ts
│   │   │   └── preload/
│   │   │       └── index.ts
│   │   ├── src/
│   │   │   ├── App.tsx
│   │   │   ├── pages/
│   │   │   │   ├── Dashboard.tsx
│   │   │   │   ├── Sessions.tsx
│   │   │   │   ├── Notes.tsx
│   │   │   │   ├── KnowledgeBase.tsx
│   │   │   │   └── Settings.tsx
│   │   │   ├── components/
│   │   │   │   ├── transcript/
│   │   │   │   ├── suggestions/
│   │   │   │   ├── mini-bar/
│   │   │   │   ├── overlay/
│   │   │   │   └── common/
│   │   │   ├── store/
│   │   │   └── hooks/
│   │   ├── resources/
│   │   ├── package.json
│   │   ├── electron-vite.config.ts
│   │   └── electron-builder.yml
│   │
│   ├── electron/              # Hidock-Next main (unchanged)
│   └── meeting-recorder/      # Prototype (unchanged)
```

### Data Flow — Active Session

```
[Calendar Sync] ──→ Meeting Detector ←── [Mic Activity Monitor]
                          │
                    session detected
                          │
                          ▼
              Session Manager (orchestrates all)
               │         │          │
               ▼         ▼          ▼
        Audio Capture  Knowledge  Screen Capture
        (mic+system)   Base       (periodic/manual)
               │         │          │
               ▼         │          ▼
        Transcription    │     Screenshot Analysis
        Pipeline         │     (LLM vision)
        (Cohere/Chirp3)  │          │
               │         │          │
               ▼         ▼          ▼
         Live Transcript + Suggestion Engine
               │                    │
               ▼                    ▼
         Mini Bar Window    Overlay Window
         (transcript)       (talking points)
               │
               ▼ (on session end)
         Notes Generator
         (categorization → template suggestion → generation)
```

### Process Boundaries

- **Main process**: Audio capture, transcription, ASR engine, database, file I/O, knowledge base, credential store, screen capture
- **Renderer process**: React UI, transcript visualization, session controls
- **Communication**: Typed IPC with Zod validation on both sides

## Audio Capture (`packages/audio-capture`)

### Platform-Specific Capture

| Component | Windows | macOS | Linux |
|-----------|---------|-------|-------|
| Microphone | `getUserMedia()` → WASAPI | `getUserMedia()` → CoreAudio | `getUserMedia()` → PulseAudio |
| System audio | Electron `setDisplayMediaRequestHandler` → WASAPI loopback | `getDisplayMedia()` → user selects | `getDisplayMedia()` → monitor source |
| Mixing | Web Audio API `AudioContext` — same on all platforms |

### Chunk Recording

- MediaRecorder with 3s timeslices
- WebM/Opus encoding
- Backpressure handling: pause if queue >15 chunks, resume at <10
- Main process ACKs each chunk; renderer tracks pending count
- Disposed state prevents zombie recorders after async operations

### Silence Detection

- FFmpeg `volumedetect` filter on each chunk
- Thresholds: max peak -45dB, mean -40dB
- Silent chunks skipped for transcription (saves ASR processing)
- Audio still saved regardless (never lose audio)

## Transcription (`packages/transcription`)

### Engine Interface

```typescript
interface TranscriptionEngine {
  transcribe(audio: Buffer, options: TranscribeOptions): AsyncIterable<TranscriptSegment>
  readonly isStreaming: boolean
  readonly isLocal: boolean
}

interface TranscriptSegment {
  speaker: string        // 'you' | 'them' | speaker name
  text: string
  startTime: number
  endTime: number
  confidence: number
  source: 'mic' | 'system'
}
```

### Engine 1 — Cohere (default, local)

- Port of mcp-ASR Python engine. Main process spawns a child process Python that loads Cohere Transcribe model.
- Communication via stdio with simple JSON-RPC (not full MCP — just request/response).
- Speaker diarization via pyannote.
- Batch-based: receives audio chunk, returns text. Latency ~2-5s per chunk.
- GPU (CUDA) with automatic CPU fallback.
- Model downloaded on first use (~2GB).

### Engine 2 — Chirp 3 (cloud, fallback)

- Google Gemini Chirp 3 streaming API.
- Built-in diarization.
- Minimal latency, requires internet.

### Automatic Engine Selection

1. Cohere model downloaded + available → Cohere local
2. No local model but internet available → Chirp 3
3. No model and no internet → notify user

### Speaker Identification

Both engines produce `TranscriptSegment`. Pipeline tags each chunk with its source before transcription:
- mic stream → `speaker: 'you'`
- system stream → `speaker: 'them'`

### Full Pipeline

```
Audio Chunk (3s)
    → Silence Detection (skip if silent)
    → Source tagging (mic/system)
    → Transcription Engine (Cohere or Chirp 3)
    → Vocabulary correction (post-process)
    → TranscriptSegment emitted via EventEmitter
    → IPC → Renderer (live transcript update)
    → Suggestion Engine trigger (every 90s of new content)
```

## Knowledge Base & Suggestion Engine

### Knowledge Base (Phase 1 — independent)

**Storage**: Configurable local folder, default `~/Documents/MeetingAssistant/knowledge/`.

**Supported sources:**
- Plain text files (.txt, .md)
- Previous session transcripts
- User notes

**Indexing:**
- Text chunked at ~500 tokens with 50-token overlap
- Each chunk embedded via configured AI provider (Ollama local or Voyage/OpenAI cloud)
- Embeddings stored in SQLite `knowledge_chunks` table (vector as blob, metadata as JSON)
- Cosine similarity search in memory (sufficient for ~10K chunks without dedicated vector DB)

**Interface:**
```typescript
interface KnowledgeBase {
  addSource(path: string): Promise<void>
  removeSource(id: string): Promise<void>
  search(query: string, topK?: number): Promise<KnowledgeChunk[]>
  reindex(): Promise<void>
}
```

### Phase 2 — Hybrid with Hidock-Next

- `KnowledgeBase` gains a second backend: query via IPC to Hidock-Next main app if running
- Results merged and re-ranked by relevance
- Interface unchanged, only adds a provider

### Suggestion Engine

Inspired by OpenOats `SuggestionEngine`:

1. **Trigger**: Every 90 seconds of new transcribed content (configurable)
2. **Context**: Last ~2 minutes of transcript + meeting metadata (title, attendees, agenda) + recent screenshot analyses
3. **Pipeline**:
   ```
   Recent transcript + screenshot analyses
       → Extract implicit query ("what is being discussed?")
       → Knowledge Base search (top 5 relevant chunks)
       → LLM prompt: "Given this meeting context and relevant notes,
         generate 2-3 useful talking points"
       → Result → Overlay Window
   ```
4. **Cooldown**: No re-generation if transcript hasn't changed substantially
5. **Dismiss**: User can dismiss individual suggestions, won't repeat

## Screen Capture

### Capture

- Electron `desktopCapturer` for screen/active window frames
- App windows excluded (already have `setContentProtection(true)`)
- Two modes:
  - **Manual**: configurable global hotkey
  - **Automatic**: periodic capture every N seconds during active session

### Storage

```
~/Documents/MeetingAssistant/sessions/{uuid}/
├── screenshots/
│   ├── 001_1711612800.png
│   ├── 002_1711612830.png
│   └── ...
├── session.json
├── transcript.jsonl
└── audio.webm
```

### LLM Analysis

- Each screenshot sent to LLM vision provider (Gemini, GPT-4o, Claude — whichever has vision capability)
- Prompt: "Describe what is being presented/shown in this screenshot in the context of a meeting"
- Analysis indexed and feeds into Suggestion Engine as additional context
- In Notes Generator, analyzed screenshots included as context: "During the meeting, the following was presented: [screenshot analyses]"

### Settings

| Setting | Default | Options |
|---------|---------|---------|
| `screenshots.enabled` | `false` | on/off |
| `screenshots.hotkey` | `CmdOrCtrl+Shift+S` | configurable |
| `screenshots.autoCapture` | `false` | on/off |
| `screenshots.autoIntervalSeconds` | `30` | 5-300 |
| `screenshots.analyzeWithLLM` | `true` | on/off |
| `screenshots.includeInNotes` | `true` | on/off |
| `screenshots.maxPerSession` | `100` | 10-500 |

## UI & Windows

### Window System

Three Electron `BrowserWindow` instances:

**1. Main Window** — primary window, hidden during active recording
- Dashboard: active session with full transcript, controls, suggestions
- Sessions: history with search and filters
- Notes: post-meeting note editor with templates
- Knowledge Base: indexed source management
- Settings: provider config, audio, hotkeys

**2. Mini Bar** — compact floating bar
- `alwaysOnTop: true`, `setContentProtection(true)` (invisible to screen share)
- Fixed size ~400x60px, draggable, position remembered
- Shows: recording state, last transcript lines, timer, stop button, screenshot button
- Click expands to main window
- Auto-appears on session start

**3. Overlay Panel** — floating suggestions panel
- `alwaysOnTop: true`, `setContentProtection(true)`
- Partial transparency, positioned at screen edge
- Shows talking points from Suggestion Engine
- Each suggestion has copy and dismiss buttons
- Auto-hides when no active suggestions
- Toggle with global hotkey

### Content Protection

```typescript
miniBarWindow.setContentProtection(true)  // Windows: SetWindowDisplayAffinity
overlayWindow.setContentProtection(true)  // macOS: sharingType = .none
```

### System Tray

- Persistent icon in system tray
- Context menu: Start/Stop recording, Show/Hide mini bar, Open main window, Settings, Quit
- Tooltip shows current state (idle / recording / processing)
- Native notification on meeting detection

### Main Window Layout

```
┌─────────────────────────────────────────────┐
│  ◉ Meeting Assistant          ─ □ ✕        │
├──────────┬──────────────────────────────────┤
│          │                                  │
│ Sessions │   [Dashboard / Notes / KB]       │
│          │                                  │
│ ──────── │   Main content area              │
│ History  │   based on active section        │
│          │                                  │
│ ──────── │                                  │
│ KB       │                                  │
│          │                                  │
│ ──────── │                                  │
│ Settings │                                  │
│          │                                  │
└──────────┴──────────────────────────────────┘
```

### UI Stack

- React 18 + TypeScript
- Radix UI primitives (consistent with monorepo)
- Tailwind CSS
- Zustand for renderer state
- Lucide icons

## Persistence & Database

### SQLite Schema (better-sqlite3)

```sql
-- Settings (all configurable, zero magic numbers)
settings (
  key TEXT PRIMARY KEY,
  value TEXT,              -- JSON serialized
  type TEXT,               -- 'number' | 'boolean' | 'string' | 'enum'
  category TEXT            -- For grouping in Settings UI
)

-- Recording sessions
sessions (
  id TEXT PRIMARY KEY,
  title TEXT,
  started_at INTEGER,
  ended_at INTEGER,
  status TEXT,             -- 'recording' | 'processing' | 'completed'
  meeting_id TEXT,
  audio_path TEXT,
  transcript_path TEXT
)

-- Calendar meetings
meetings (
  id TEXT PRIMARY KEY,
  title TEXT,
  start_time INTEGER,
  end_time INTEGER,
  attendees TEXT,          -- JSON array
  location TEXT,           -- Zoom/Meet/Teams URL
  agenda TEXT,
  calendar_source TEXT
)

-- Transcript segments
transcript_segments (
  id INTEGER PRIMARY KEY,
  session_id TEXT,
  speaker TEXT,            -- 'you' | 'them' | speaker name
  text TEXT,
  start_time REAL,
  end_time REAL,
  confidence REAL,
  source TEXT               -- 'mic' | 'system'
)

-- Knowledge base chunks
knowledge_chunks (
  id INTEGER PRIMARY KEY,
  source_path TEXT,
  chunk_index INTEGER,
  text TEXT,
  embedding BLOB,
  updated_at INTEGER
)

-- Screenshots
screenshots (
  id INTEGER PRIMARY KEY,
  session_id TEXT,
  path TEXT,
  captured_at INTEGER,
  analysis TEXT,            -- JSON: LLM description
  is_manual INTEGER         -- 1 = hotkey, 0 = automatic
)

-- Generated notes
notes (
  id TEXT PRIMARY KEY,
  session_id TEXT,
  template_id TEXT,
  content TEXT,             -- Markdown
  created_at INTEGER,
  updated_at INTEGER
)

-- Note templates
note_templates (
  id TEXT PRIMARY KEY,
  name TEXT,
  prompt TEXT,
  structure TEXT,
  is_default INTEGER
)
```

### Disk Storage

```
~/Documents/MeetingAssistant/
├── sessions/{uuid}/
│   ├── session.json
│   ├── transcript.jsonl
│   ├── audio.webm
│   └── screenshots/
├── knowledge/
│   └── (user files)
├── logs/
└── database.sqlite
```

## Meeting Detection

### Calendar Sync (`packages/calendar-sync`)

| Setting | Default | Options |
|---------|---------|---------|
| `calendar.preNotificationSeconds` | `15` | 0-3600 (0 = disabled) |
| `calendar.enabled` | `true` | on/off |
| `calendar.pollIntervalMinutes` | `15` | 1-60 |
| `calendar.autoRecordOnMeeting` | `false` | If true + mic detected during scheduled meeting → record without asking |

### Mic Activity Monitor

| Setting | Default | Options |
|---------|---------|---------|
| `mic.enabled` | `true` | on/off |
| `mic.defaultAction` | `'ask'` | `'ask'` / `'always_record'` / `'ignore'` |
| `mic.rememberChoice` | `false` | "Don't ask again" toggle |
| `mic.autoRecordWithCalendar` | `true` | If scheduled meeting + mic active → record without popup |

### Mic Detection Flow

```
Mic activated
    → Scheduled meeting + autoRecordWithCalendar?
        → Yes: record automatically, associate with meeting
        → No: mic.defaultAction?
            → 'always_record': record without asking
            → 'ask': popup "Audio detected. Record?"
                     ☐ Don't ask again (sets rememberChoice + always_record)
            → 'ignore': nothing
```

### Session ↔ Meeting Correlation

| Setting | Default | Options |
|---------|---------|---------|
| `correlation.autoLinkMinutes` | `5` | 1-120 (auto-link without asking if within this range) |
| `correlation.suggestLinkMinutes` | `120` | 1-480 (suggest linking if within this range) |
| `correlation.suggestEnabled` | `true` | on/off |

### Correlation Flow

```
Session started
    → Find nearby meetings in calendar
    → How many within suggestLinkMinutes?
        → 0: session without associated meeting
        → 1:
            → Difference < autoLinkMinutes → auto-associate
            → Difference < suggestLinkMinutes → popup: "Associate with {title} ({X min ago})?"
            → Difference > suggestLinkMinutes → don't suggest
        → 2+: ALWAYS show selection popup (never auto-link with ambiguity)
              ┌─────────────────────────────────────┐
              │  Multiple meetings detected:         │
              │                                      │
              │  ○ Sprint Planning (5 min ago)        │
              │  ○ 1:1 with María (in 10 min)        │
              │  ○ None of these                      │
              │                                      │
              │  [Associate]  [No meeting]            │
              └─────────────────────────────────────┘
```

## Notes Generator

### Intelligent Flow (no automatic defaults)

```
Session ended
    │
    ▼
1. Automatic Categorization (LLM)
   Input: full transcript + metadata (title, attendees, duration, agenda) + screenshot analyses
   Output:
   - Suggested category: "standup" | "1:1" | "client call" | "brainstorm" | "interview" | custom
   - Executive summary (3-5 lines)
   - Enriched metadata (main topics, detected decisions, preliminary action items)
    │
    ▼
2. Presentation to User
   ┌─────────────────────────────────────────┐
   │  Session completed                       │
   │                                          │
   │  Suggested category: Client Call         │
   │  Duration: 47 min | 3 participants       │
   │                                          │
   │  Summary:                                │
   │  Discussed Q3 project timeline,          │
   │  agreed to move the deadline...          │
   │                                          │
   │  Suggested template: "Client Meeting"    │
   │                                          │
   │  [Client Meeting] [Detailed Notes]       │
   │  [Action Items] [Custom...]              │
   │                                          │
   └─────────────────────────────────────────┘
    │
    ▼
3a. User selects existing template → generate notes
3b. None fits → "Custom..."
    → LLM generates custom template for THIS meeting
    → Includes relevant sections: summary, topic notes,
      action items, decisions, follow-ups
    → User can edit template before generating
    → Option to save as reusable template
    │
    ▼
4. Generated notes → editable Markdown editor
   → Copy to clipboard / export
```

### Notes Generator Settings

| Setting | Default | Options |
|---------|---------|---------|
| `notes.autoCategorize` | `true` | on/off |
| `notes.showPostSessionPrompt` | `true` | on/off (if off, only saves transcript) |
| `notes.defaultLanguage` | `'auto'` | ISO code or 'auto' (detects from transcript) |
| `notes.customTemplatesPath` | `null` | Path to additional templates |

## Error Handling

### Principle: Never lose audio or transcript during an active session.

**Audio pipeline resilience:**
- Transcription engine fails mid-session → audio continues recording. Transcribed later (batch post-session).
- LLM for suggestions fails → suggestions silently disabled, transcript continues.
- SQLite write fails → transcript appended to `.jsonl` on disk as fallback (append-only, cannot corrupt).
- Python child process (Cohere) crashes → auto-restart with exponential backoff (max 3 attempts), then fallback to Chirp 3 if available.

**User notifications:**
- Critical errors (mic lost, disk full): native notification + red indicator in mini bar
- Recoverable errors (LLM timeout, transcription retry): yellow indicator in mini bar, internal log
- Never blocking modals during active session — always non-intrusive notifications

**Logging:**
- Structured JSON logs to `~/Documents/MeetingAssistant/logs/`
- Daily rotation, configurable retention (default 30 days)
- Levels: error, warn, info, debug (configurable in settings)

## Security

### Credentials

- API keys stored via Electron `safeStorage` (DPAPI on Windows, Keychain on macOS, libsecret on Linux)
- Never on disk in plain text, never in unencrypted SQLite
- Sensitive settings (API keys) separated from general settings

### IPC Security

- Context isolation enabled (`contextIsolation: true`)
- `nodeIntegration: false` in all renderers
- Preload script exposes only necessary IPC channels via `contextBridge`
- Zod validation on both sides (main validates renderer inputs, renderer validates responses)

### Audio & Screenshots

- Files stored locally, never leave device except when sent to user-configured cloud LLM
- `setContentProtection(true)` on all floating windows
- Screenshots exclude app's own windows

### Python Child Process (Cohere)

- Path validation: only accepts files within `~/Documents/MeetingAssistant/`
- No UNC paths on Windows (inherited from mcp-ASR)
- No network access (local model)

### Dependencies

- Input validation with Zod at boundaries (IPC, file paths, settings)
- LLM-generated markdown sanitized before rendering (DOMPurify)

## Testing

### Unit Tests (Vitest)

- Each package has its own tests
- `packages/transcription`: mock Python child process, test chunk pipeline
- `packages/audio-capture`: test silence detection, backpressure logic
- `packages/ai-providers`: mock HTTP responses, test factory pattern
- `packages/calendar-sync`: test ICS parsing, time-based correlation

### Integration Tests

- Session manager: test full lifecycle (start → record → transcribe → notes)
- IPC handlers: test serialization/deserialization with Zod
- Database: test migrations and queries with SQLite in-memory

### E2E (Playwright + Electron)

- Smoke test: app starts, windows created
- Session flow: start recording → stop → verify transcript exists
- Settings: change config → verify persistence

## Build & Distribution

```yaml
# electron-builder.yml
appId: com.hidock.meeting-assistant
productName: Meeting Assistant
directories:
  output: dist
win:
  target: [nsis]
mac:
  target: [dmg]
linux:
  target: [AppImage]
extraResources:
  - from: python-asr/
    to: asr-engine/
```

**Python bundling**: Cohere engine distributed as embedded Python environment (PyInstaller or python-embed) within `extraResources`. Model downloaded on first use (not bundled — ~2GB).

## AI Providers (`packages/ai-providers`)

Reuses the Vercel AI SDK factory pattern from `apps/electron`:
- Google Gemini
- OpenAI
- Anthropic
- AWS Bedrock
- Ollama (local)

Provider selection configurable per use case (transcription vs suggestions vs notes generation vs screenshot analysis).

## Feature Parity with OpenOats

| OpenOats Feature | Meeting Assistant Equivalent |
|-----------------|------------------------------|
| Real-time dual transcription | Audio capture (mic+system) + transcription pipeline |
| WhisperKit local ASR | Cohere Transcribe local (via Python child process) |
| Knowledge base with embeddings | Knowledge base with SQLite vector store |
| Live suggestions / talking points | Suggestion engine + overlay window |
| Mini bar (floating, invisible to screenshare) | Mini bar window with `setContentProtection` |
| Meeting notes with templates | Notes generator with LLM categorization + template suggestion |
| Menu bar integration | System tray |
| Auto-saved sessions | SQLite + .jsonl + .webm auto-save |
| Customizable templates | Note templates (built-in + custom + LLM-generated) |
| Cloud LLM (OpenRouter) + Local (Ollama) | Multi-provider via ai-providers package |
| Meeting detection (CoreAudio HAL) | Mic activity monitor + calendar sync |

### New Features (beyond OpenOats)

| Feature | Description |
|---------|-------------|
| Screen capture + LLM analysis | Captures what's being presented, feeds context to suggestions and notes |
| Multi-calendar correlation with ambiguity handling | Handles multiple meetings in same timeslot |
| Cross-platform | Windows, macOS, Linux |
| Multiple ASR engines with auto-fallback | Local (Cohere) + cloud (Chirp 3) |
| Ecosystem integration (Phase 2) | Shared RAG with Hidock-Next main app |
