# HiDock Next Redesign: The "Open Notebook" Architecture

**Version:** 1.0
**Date:** 2025-12-28
**Vision:** Transforming HiDock from a "Recorder Manager" to a "Personal Knowledge Notebook".
**References:**
*   **UI Paradigm:** [Open Notebook](https://github.com/lfnovo/open-notebook) (Google NotebookLM alternative)
*   **AI Backbone:** [Esperanto](https://github.com/lfnovo/esperanto) (Unified, lightweight AI interface)

---

## 1. Core Concept: The Knowledge Workspace

The application pivots from a *list of files* to a *workspace for thinking*. The core entity is no longer a "Recording" but a "Notebook" (or Project) that contains **Sources** and **Notes**.

### 1.1 The Tri-Pane Layout
To facilitate reading, analysis, and synthesis simultaneously, the UI adopts a responsive three-pane layout:

```
┌── Source Panel ──┬── Knowledge Canvas ──┬── Assistant / Tools ──┐
│                  │                      │                       │
│ 📁 Sources       │  [Document Reader]   │  [Chat Interface]     │
│  ├─ 🎧 Audio     │  (PDF / Transcript)  │  "Summarize this"     │
│  ├─ 📄 PDF       │                      │  "Extract dates"      │
│  └─ 🔗 Web       │  [Note Board]        │                       │
│                  │  (Grid of Insights)  │  [Graph View]         │
│                  │                      │                       │
└──────────────────┴──────────────────────┴───────────────────────┘
```

*   **Left (Sources):** Hierarchical tree of raw inputs.
*   **Center (Canvas):** The working area. Switches between "Reading Mode" (viewing a source) and "Thinking Mode" (organizing notes).
*   **Right (Intelligence):** The AI co-pilot. Context-aware chat, quick actions, and knowledge graph visualization.

---

## 2. Data Model Evolution

We move from a flat structure to a relational, graph-based model.

### 2.1 Sources (Immutable Inputs)
A `Source` is raw evidence. It cannot be edited, only analyzed.
```typescript
type SourceType = 'audio' | 'video' | 'pdf' | 'markdown' | 'web_clip';

interface Source {
  id: string;
  type: SourceType;
  title: string;
  content: string; // Transcript or extracted text
  mediaUrl?: string; // For audio/video playback
  metadata: {
    duration?: number;
    author?: string;
    capturedAt: Date;
    sourceApp?: 'hidock' | 'slack' | 'upload';
  };
  embeddingId?: string; // Link to vector store
}
```

### 2.2 Notes (Mutable Insights)
A `Note` is a unit of knowledge derived from a Source or created by the user/AI.
```typescript
type NoteType = 'insight' | 'summary' | 'action_item' | 'person' | 'concept';

interface Note {
  id: string;
  type: NoteType;
  content: string; // Markdown
  tags: string[];
  citations: Array<{
    sourceId: string;
    segmentId: string; // e.g., timestamp range or text anchor
    text: string; // The quoted text
  }>;
}
```

### 2.3 The Knowledge Graph
Entities (`Person`, `Project`, `Topic`) are nodes. Relationships (`attended`, `mentioned`, `related_to`) are edges. This graph powers the "Explore" view.

---

## 3. "Esperanto-JS": The AI Backbone

To support "Any Model, Anywhere" (Cloud vs. Local), we implement the **Esperanto Architecture** in the Electron Main process. This is a lightweight, zero-dependency abstraction layer.

### 3.1 Interface Definition
```typescript
interface IAIProvider {
  id: string; // 'gemini', 'ollama', 'openai'
  
  // Core Primitives
  transcribe(audio: ArrayBuffer): Promise<string>;
  chat(messages: Message[], options?: GenerationOptions): Promise<string>;
  embed(text: string): Promise<number[]>;
  
  // Advanced (Multimodal)
  analyzeImage?(image: ArrayBuffer, prompt: string): Promise<string>;
}
```

### 3.2 The Provider Registry
A dynamic factory that instantiates the correct provider based on user config.
```typescript
class AIProviderRegistry {
  private providers = new Map<string, IAIProvider>();
  
  register(provider: IAIProvider) { ... }
  
  getActiveProvider(): IAIProvider {
    // Reads from AppConfig (e.g., 'transcription.provider')
    // Returns configured instance (Gemini or Ollama)
  }
}
```

### 3.3 Direct HTTP Strategy
Unlike heavy SDKs (LangChain, LlamaIndex), "Esperanto-JS" uses `fetch` directly.
*   **Pros:** Minimal bundle size, full control over timeouts/retries, easier debugging.
*   **Cons:** Requires maintaining API typings manually.

---

## 4. UI/UX Specifications (The "Notebook" Experience)

### 4.1 Source Management (Left Pane)
*   **Features:**
    *   **Drag & Drop Import:** Drop PDFs or Audio files to ingest.
    *   **Nestability:** Folders/Collections (e.g., "Q1 Strategy").
    *   **Status Indicators:** "Processing", "Indexed", "Error".

### 4.2 Content Rendering (Center Pane)
*   **Audio/Transcript:**
    *   Split view: Waveform on top, interactive transcript below.
    *   **Click-to-Seek:** Clicking text seeks audio.
    *   **Speaker Diarization:** Visual avatars for speakers.
*   **Document Reader:**
    *   PDF rendering with text selection.
    *   **Highlighter:** Select text -> "Add to Notes" / "Ask AI".

### 4.3 AI Output Management (Center/Right Pane)
*   **The "Note Board":** A masonry grid of generated insights (Summary card, Action Item list, Person profile).
*   **Citations:** Every AI claim has a citation link `[1]`. Hovering highlights the source text/audio segment.
*   **Tagging:** AI auto-tags content ("#urgent", "#budget"). User can refine.

---

## 5. Technical Roadmap

### Phase 1: Foundation (Current)
*   [x] Basic Electron App structure.
*   [x] "Library" list view (Audio files).
*   [x] Basic Transcription (Gemini).

### Phase 2: The Data Layer Migration (Next)
*   [ ] Refactor DB: `Recordings` -> `Sources` table.
*   [ ] Create `Notes` table.
*   [ ] Implement `Esperanto-JS` service layer in `apps/electron/electron/main`.

### Phase 3: The UI Pivot
*   [ ] Build "Three-Column" Layout component.
*   [ ] Create `SourceViewer` (Transcript/PDF).
*   [ ] Implement `NoteCard` component.

### Phase 4: Intelligence
*   [ ] Implement Vector Store (pgvector or local file-based).
*   [ ] Build RAG pipeline using `Esperanto-JS`.
*   [ ] Connect "Explore" to the Graph.
