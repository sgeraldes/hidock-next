
# Knowledge Library Specification

**Module:** Knowledge Management (Pillar I: Sources)
**Screen / Route:** Library (`/library`)
**Current UI:** recordings-based library
**Current Component:** `apps/electron/src/pages/Recordings.tsx`
**Primary Hook:** `apps/electron/src/hooks/useUnifiedRecordings.ts`

---

## 1. Purpose (What the Library is)

The Library is the systems **evidence layer**: it lists and renders Sources and their processing status. The Library must make it easy to:

- ingest content (device  local)
- review content (play/read) with high performance
- trigger processing (transcription, extraction, indexing)
- supply anchors for citations (timestamps / text ranges)

This spec describes both the **current state** (UnifiedRecording-based) and the **target state** (Source/Note model from [11_CONCEPTUAL_FRAMEWORK.md](./11_CONCEPTUAL_FRAMEWORK.md)).

---

## 2. Goals / Non-goals

**Goals**
- Provide a fast, scalable list/grid of knowledge captures (device + local) with clear status.
- Make playback + transcript review reliable (no stale state when navigating back).
- Expose a consistent "process" surface (single recording or bulk).
- Provide citation anchors that other modules can deep-link to (Assistant, Actionables).

**Non-goals (for 01 spec)**
- Full tri-pane Notebook UI (covered by redesign architecture; will be implemented incrementally).
- Full-text PDF + web clip ingestion (future plugin/integration work).

---

## 3. Current UX Surface (Electron)

### 3.1 Core behaviors

| Behavior | Implementation notes |
| :--- | :--- |
| List of recordings (device + local) | Aggregated by `useUnifiedRecordings()` |
| Filters (location/category/quality/status) + search | Client-side filter over the unified list |
| Virtualized rendering | `@tanstack/react-virtual` |
| Enrichment (transcripts + calendar meeting data) | Batched fetch keyed by the set of IDs |
| Playback | Centralized via `useAudioControls()` and `useUIStore()` |
| Bulk operations | Download/process queues with progress UI |

### 3.2 Key state (current)

The current Library page tracks:

- `recordings: UnifiedRecording[]` (from hook)
- `locationFilter`, `categoryFilter`, `qualityFilter`, `statusFilter`, `searchQuery`
- `compactView` (persisted UI preference)
- `expandedTranscripts: Set<recordingId>`
- enrichment maps: `transcripts: Map<recordingId, Transcript>`, `meetings: Map<meetingId, Meeting>`

---

## 4. Target UX (Open Notebook alignment)

Target layout is described in [11_REDESIGN_ARCH.md](./11_REDESIGN_ARCH.md). Library becomes the left-pane Sources panel + the center-pane reader when a Source is selected.

Minimum target behaviors:

- hierarchical Sources (folders / notebooks)
- renderer selection by type (audio transcript vs. PDF vs. markdown)
- processing state per Source (queued/running/failed/ready)
- deep-link anchors: `sourceId + anchor` (timestamp range, text offsets)

---

## 5. Data Contracts

### 5.1 Current: `UnifiedRecording`

The Library currently uses `UnifiedRecording` from `apps/electron/src/types/unified-recording`.

Required invariants:
- A recording is either device-only, local-only, or synced.
- Playback requires `localPath` (device-only must be downloaded first).

### 5.2 Target: `Source` + anchors

The redesign model introduces immutable Sources (see [11_REDESIGN_ARCH.md](./11_REDESIGN_ARCH.md)). Library must produce stable citation anchors.

Example anchor formats (implementation may vary):

```typescript
type SourceAnchor =
  | { kind: 'audio_time'; startMs: number; endMs: number }
  | { kind: 'text_range'; startOffset: number; endOffset: number }
  | { kind: 'page_range'; startPage: number; endPage: number };

interface Citation {
  sourceId: string;
  anchor: SourceAnchor;
  quote?: string;
}
```

---

## 6. IPC / Service Responsibilities

The Library is a coordinator. Heavy work happens in services (main process).

Required IPC capabilities (current patterns already exist):

- transcripts batch fetch by recording ids
- meetings batch fetch by ids
- download service queue + progress
- processing/transcription queue + progress

Implementation rule:
- UI should never block on processing; all long-running jobs must be queued with progress reporting.

---

## 7. Error handling & UX states

- Load failure: show an actionable error state + retry (not just console logging).
- Device disconnected: disable device-only actions with a clear explanation.
- Processing failure: per-item failure state with retry and a link to logs.

---

## 8. Testing & performance

**Tests (minimum)**
- Filtering/search correctness (unit)
- Enrichment batching (integration)
- Device-only playback requires download (integration)

**Performance targets**
- Virtualized scroll remains smooth with 1000+ items
- Initial render stays responsive (no large synchronous enrichment)
