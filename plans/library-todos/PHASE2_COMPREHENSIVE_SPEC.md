# Phase 2: Library Integration & Enhanced Features - Comprehensive Specification

## Executive Summary

Based on extensive codebase exploration, this document specifies all remaining work needed to complete the Library feature integration. The exploration identified 5 major areas requiring attention:

1. **Audio Player** - Not working (currentTimeMs always 0)
2. **Page Connections** - Context lost on navigation to Assistant/Actionables
3. **AI Title & Question Generation** - Missing during transcription
4. **Output Generation Integration** - Actionables doesn't consume navigation state
5. **Document Type Expansion** - Architecture ready but only audio implemented

---

## TODO-015: Fix Audio Player Integration

### Priority: CRITICAL

### Problem Statement

The audio player in SourceReader shows a progress bar but it never updates. The playback time is always displayed as "0:00 / X:XX" regardless of actual playback position. Transcript segment highlighting during playback doesn't work.

### Root Cause Analysis

**Location:** `Library.tsx` line 841

```typescript
<SourceReader
  recording={selectedRecording ?? null}
  transcript={selectedTranscript}
  isPlaying={selectedRecording ? currentlyPlayingId === selectedRecording.id : false}
  currentTimeMs={0}  // <-- HARDCODED TO 0!
  onPlay={() => {...}}
  onStop={handleStopCallback}
  onSeek={(startMs, endMs) => {
    console.log('Seek to:', startMs, endMs)  // <-- DOES NOTHING!
  }}
/>
```

The `currentTimeMs` prop is hardcoded to `0` instead of reading from UIStore.
The `onSeek` callback just logs to console.

### UIStore State Available

```typescript
// apps/electron/src/store/useUIStore.ts
playbackCurrentTime: 0,      // in seconds
playbackDuration: 0,         // in seconds
isPlaying: false,
currentlyPlayingId: null,
```

### Data Flow Gap

```
OperationController --> UIStore (updates playbackCurrentTime in seconds)
UIStore --> AudioPlayer.tsx (reads correctly)
UIStore -X-> Library.tsx --> SourceReader (BROKEN - hardcoded 0)
```

### Implementation Steps

1. **Add UIStore selectors to Library.tsx:**
   ```typescript
   const playbackCurrentTime = useUIStore((state) => state.playbackCurrentTime)
   const playbackDuration = useUIStore((state) => state.playbackDuration)
   ```

2. **Convert seconds to milliseconds and pass to SourceReader:**
   ```typescript
   <SourceReader
     currentTimeMs={playbackCurrentTime * 1000}  // Convert s -> ms
     ...
   />
   ```

3. **Implement seek callback:**
   ```typescript
   onSeek={(startMs) => {
     if (selectedRecording && hasLocalPath(selectedRecording)) {
       audioControls.seek(startMs / 1000)  // Convert ms -> s for audio element
     }
   }}
   ```

4. **Fix volume control in SourceReader:**
   - Currently changes local state but doesn't affect actual audio
   - Need to expose volume control via OperationController

### Acceptance Criteria

- [ ] Progress bar updates during playback
- [ ] Current time display shows actual position
- [ ] Clicking transcript timestamp seeks to that position
- [ ] Volume slider affects actual audio volume
- [ ] Progress bar is clickable for seeking

### Files to Modify

- `apps/electron/src/pages/Library.tsx` - Add UIStore selectors, fix props
- `apps/electron/src/features/library/components/SourceReader.tsx` - Verify props work
- `apps/electron/src/components/OperationController.tsx` - Expose volume control

---

## TODO-016: Fix Assistant Page Context Integration

### Priority: HIGH

### Problem Statement

When clicking "Ask about this recording" in the Library, the user is navigated to `/assistant` with a `contextId` in state, but the Chat.tsx page completely ignores this context. The user lands on a generic chat page with no recording context loaded.

### Current Flow (Broken)

```
Library.tsx                     Chat.tsx
    |                               |
    | navigate('/assistant', {      |
    |   state: { contextId: '...' } | --> Ignores location.state!
    | })                            |     Shows empty chat
    v                               v
```

### Chat.tsx Analysis

- NO `useLocation` import
- NO access to `location.state`
- NO context loading on mount

### Implementation Steps

1. **Add location state handling to Chat.tsx:**
   ```typescript
   import { useLocation } from 'react-router-dom'

   const location = useLocation()

   useEffect(() => {
     const state = location.state as { contextId?: string } | null
     if (state?.contextId) {
       // Load the knowledge capture context
       loadContext(state.contextId)
       // Pre-populate context for chat
       setSelectedContextIds([state.contextId])
     }
   }, [location.state])
   ```

2. **Implement context loading:**
   ```typescript
   const loadContext = async (contextId: string) => {
     // Fetch recording details
     const recording = await window.electronAPI.recordings.get(contextId)
     // Fetch transcript if available
     const transcript = await window.electronAPI.transcripts.getByRecordingId(contextId)
     // Show context summary in chat
     setContextSummary({
       title: recording.title || recording.filename,
       summary: transcript?.summary,
       duration: recording.duration
     })
   }
   ```

3. **Show context banner in chat UI:**
   - Display "Chatting about: [Recording Title]"
   - Show quick actions based on transcript content
   - Allow removing context to ask general questions

### Acceptance Criteria

- [ ] Navigating from Library passes context ID
- [ ] Chat.tsx reads and loads the context
- [ ] Context summary shown in chat header
- [ ] Chat queries are scoped to the selected recording
- [ ] User can clear context to ask general questions
- [ ] Back navigation returns to Library

### Files to Modify

- `apps/electron/src/pages/Chat.tsx` - Add location state handling
- `apps/electron/src/components/ChatContextBanner.tsx` - New component

---

## TODO-017: Fix Actionables Page Context Integration

### Priority: HIGH

### Problem Statement

Clicking "Generate Meeting Minutes" in Library navigates to `/actionables` with `sourceId` and `action: 'generate'`, but Actionables.tsx ignores this entirely. Users see a list of all actionables instead of triggering generation for the specific recording.

### Current Flow (Broken)

```
Library.tsx                           Actionables.tsx
    |                                       |
    | navigate('/actionables', {            |
    |   state: {                            | --> Ignores location.state!
    |     sourceId: '...',                  |     Shows all actionables
    |     action: 'generate'                |
    |   }                                   |
    | })                                    |
    v                                       v
```

### Actionables.tsx Analysis

- NO `useLocation` import
- NO access to `location.state`
- Loads ALL actionables without filtering
- No auto-trigger for generation

### Implementation Steps

1. **Add location state handling:**
   ```typescript
   import { useLocation } from 'react-router-dom'

   const location = useLocation()

   useEffect(() => {
     const state = location.state as {
       sourceId?: string
       action?: 'generate'
     } | null

     if (state?.sourceId && state?.action === 'generate') {
       handleAutoGenerate(state.sourceId)
     }
   }, [location.state])
   ```

2. **Implement auto-generate on mount:**
   ```typescript
   const handleAutoGenerate = async (sourceId: string) => {
     setGenerating(true)
     try {
       // Generate with default template (meeting_minutes)
       const result = await window.electronAPI.outputs.generate({
         templateId: 'meeting_minutes',
         knowledgeCaptureId: sourceId
       })
       // Show result
       setGeneratedOutput(result)
       setShowOutputModal(true)
     } catch (error) {
       setError(error.message)
     } finally {
       setGenerating(false)
     }
   }
   ```

3. **Add template selection UI:**
   - Show available templates: meeting_minutes, interview_feedback, project_status, action_items
   - Allow user to pick before generation
   - Remember last used template preference

4. **Show generation result:**
   - Modal with generated content
   - Copy to clipboard button
   - Save/export options
   - Link back to source recording

### Acceptance Criteria

- [ ] Navigating with `action: 'generate'` triggers output generation
- [ ] User sees loading state during generation
- [ ] Generated output displayed in modal
- [ ] Template selection available before generation
- [ ] Error handling with retry option
- [ ] Navigation back to source recording works

### Files to Modify

- `apps/electron/src/pages/Actionables.tsx` - Add location state handling
- `apps/electron/src/components/OutputModal.tsx` - New component for output display
- `apps/electron/src/components/TemplateSelector.tsx` - New component

---

## TODO-018: AI Title & Question Generation During Transcription

### Priority: MEDIUM

### Problem Statement

When transcription completes, AI should generate:
1. A brief title suggestion (a few words)
2. Context-aware suggested questions for the AssistantPanel

Currently, the AssistantPanel shows hardcoded questions and recordings often have no meaningful title.

### Current Transcription Analysis Output

```typescript
// transcription.ts lines 194-216
{
  summary: string,        // Generated
  action_items: string[], // Generated
  topics: string[],       // Generated
  key_points: string[],   // Generated
  language: string,       // Generated
  // MISSING: title_suggestion
  // MISSING: question_suggestions
}
```

### Implementation Steps

1. **Extend analysis prompt in transcription.ts:**
   ```typescript
   const analysisPrompt = `
     ... existing prompt ...

     Also generate:
     - title_suggestion: A brief, descriptive title (3-8 words) that captures the essence of this recording
     - question_suggestions: An array of 4-5 specific, context-aware questions someone might ask about this content

     The questions should be:
     - Specific to the actual content (not generic)
     - Actionable (help the user extract value)
     - Varied (cover different aspects: facts, decisions, action items, context)
   `
   ```

2. **Update Transcript interface:**
   ```typescript
   interface Transcript {
     // ... existing fields ...
     title_suggestion?: string
     question_suggestions?: string  // JSON array
   }
   ```

3. **Update database schema:**
   ```sql
   ALTER TABLE transcripts
   ADD COLUMN title_suggestion TEXT;
   ALTER TABLE transcripts
   ADD COLUMN question_suggestions TEXT;
   ```

4. **Update recording title if not set:**
   ```typescript
   // After transcription completes
   if (!recording.title && transcript.title_suggestion) {
     await updateRecordingTitle(recording.id, transcript.title_suggestion)
   }
   ```

5. **Update AssistantPanel to use suggestions:**
   ```typescript
   // AssistantPanel.tsx
   const questions = useMemo(() => {
     if (transcript?.question_suggestions) {
       return parseJsonArray<string>(transcript.question_suggestions)
     }
     return defaultQuestions  // Fallback to hardcoded
   }, [transcript])
   ```

### Acceptance Criteria

- [ ] Transcription generates title_suggestion
- [ ] Transcription generates 4-5 question_suggestions
- [ ] Recording title auto-populated if not set
- [ ] AssistantPanel shows dynamic questions
- [ ] Fallback to defaults if suggestions unavailable
- [ ] Questions are contextually relevant

### Files to Modify

- `apps/electron/electron/main/services/transcription.ts` - Extend prompt
- `apps/electron/src/types/index.ts` - Extend Transcript interface
- `apps/electron/electron/main/services/database.ts` - Add migration
- `apps/electron/src/features/library/components/AssistantPanel.tsx` - Use suggestions
- `apps/electron/src/pages/Library.tsx` - Handle title updates

---

## TODO-019: Document Type Expansion - Photo Descriptions

### Priority: LOW (Future)

### Problem Statement

The architecture supports multiple source types (AudioSource, PDFSource, ImageSource) but only audio is implemented. Users cannot import and describe photos.

### Architecture Readiness

```typescript
// source.ts - Types ready
export interface ImageSource extends SourceBase {
  type: 'image'
  filename: string
  localPath: string
  width: number
  height: number
  format: 'jpg' | 'png' | 'webp' | 'heic'
}
```

### Implementation Steps

1. **Add image import to Library:**
   - Extend handleAddRecording to accept images
   - File type filter: jpg, png, webp, heic

2. **Create vision service:**
   ```typescript
   // apps/electron/electron/main/services/vision.ts
   export async function describeImage(imagePath: string): Promise<{
     description: string
     objects: string[]
     text?: string  // OCR if present
     title_suggestion: string
     question_suggestions: string[]
   }> {
     const imageData = await fs.readFile(imagePath)
     const base64 = imageData.toString('base64')

     const response = await gemini.generateContent({
       model: 'gemini-pro-vision',
       contents: [{
         parts: [
           { text: VISION_PROMPT },
           { inlineData: { mimeType: 'image/jpeg', data: base64 } }
         ]
       }]
     })

     return parseVisionResponse(response)
   }
   ```

3. **Add image processing queue:**
   - Similar to transcription queue
   - Process images on import
   - Store descriptions in database

4. **Display in Library:**
   - Show thumbnail in SourceCard
   - Show description in SourceReader
   - Enable AI chat about image content

### Acceptance Criteria

- [ ] Images can be imported via Library
- [ ] Vision AI generates description
- [ ] Title and questions auto-generated
- [ ] Thumbnails shown in list
- [ ] Full image viewable in SourceReader
- [ ] Chat context includes image description

### Files to Create

- `apps/electron/electron/main/services/vision.ts`
- `apps/electron/electron/main/ipc/image-handlers.ts`

### Files to Modify

- `apps/electron/src/pages/Library.tsx` - Image import
- `apps/electron/src/features/library/components/SourceCard.tsx` - Thumbnail support
- `apps/electron/src/features/library/components/SourceReader.tsx` - Image display

---

## TODO-020: Document Type Expansion - PDF Processing

### Priority: LOW (Future)

### Problem Statement

Users cannot import and process PDF documents. The architecture is ready but no implementation exists.

### Implementation Steps

1. **Add PDF library:**
   ```bash
   npm install pdf-parse
   ```

2. **Create PDF service:**
   ```typescript
   // apps/electron/electron/main/services/pdf.ts
   export async function processPDF(filePath: string): Promise<{
     text: string
     pageCount: number
     metadata: PDFMetadata
   }> {
     const pdfBuffer = await fs.readFile(filePath)
     const data = await pdf(pdfBuffer)
     return {
       text: data.text,
       pageCount: data.numpages,
       metadata: data.info
     }
   }
   ```

3. **Extend transcription-like analysis:**
   - Extract text from PDF
   - Run through same Gemini analysis (summary, action items, etc.)
   - Generate title and questions

4. **Add to vector store:**
   - Chunk PDF text
   - Generate embeddings
   - Enable RAG search

### Acceptance Criteria

- [ ] PDFs can be imported via Library
- [ ] Text extracted from PDFs
- [ ] Analysis generates summary, action items, etc.
- [ ] PDF searchable via RAG
- [ ] Page navigation in SourceReader

---

## TODO-021: Bidirectional Page Links

### Priority: MEDIUM

### Problem Statement

Navigation between pages is mostly one-way. Users cannot easily navigate back to source recordings from Assistant, Calendar, or other pages.

### Missing Links

| From | To | Current | Needed |
|------|-----|---------|--------|
| Chat | Library | None | "View source recording" |
| Actionables | Library | None | "View source recording" |
| MeetingDetail | Library | Partial | Link to associated recordings |
| Calendar | Library | None | "View recordings for this day" |
| People | Library | None | "View recordings with this person" |

### Implementation Steps

1. **Add back-links to Chat:**
   - When context is loaded, show source recording info
   - "View Recording" button navigates to Library with source selected

2. **Add back-links to Actionables:**
   - Actionable items show source recording
   - Click to navigate to Library with source selected

3. **Enhance MeetingDetail:**
   - Show list of associated recordings
   - "View in Library" navigates with recording selected

4. **Calendar integration:**
   - Day view shows recording count
   - Click shows Library filtered by date

5. **People integration:**
   - Person detail shows recordings where they're an attendee
   - Click navigates to Library with filter

### Acceptance Criteria

- [ ] All major pages have navigation back to Library
- [ ] Library can receive selected source via navigation state
- [ ] Filters apply when navigating from other pages
- [ ] Navigation history supports back button

---

## Implementation Priority Matrix

| TODO | Priority | Effort | Dependencies | User Impact |
|------|----------|--------|--------------|-------------|
| 015 | CRITICAL | Low | None | Audio player broken |
| 016 | HIGH | Medium | None | Chat context lost |
| 017 | HIGH | Medium | None | Generate action broken |
| 018 | MEDIUM | Medium | None | Better UX |
| 021 | MEDIUM | High | 016, 017 | Better navigation |
| 019 | LOW | High | None | New feature |
| 020 | LOW | High | 019 | New feature |

## Recommended Execution Order

### Phase 2A: Critical Fixes (TODO-015, 016, 017)
- Fix audio player first (most visible bug)
- Fix Chat context (second most visible)
- Fix Actionables context (enables "Generate" action)

### Phase 2B: AI Enhancements (TODO-018)
- Add title/question generation during transcription
- Update AssistantPanel to use suggestions

### Phase 2C: Navigation (TODO-021)
- Add bidirectional links between pages
- Implement Library filtering from navigation state

### Phase 2D: Document Expansion (TODO-019, 020)
- Add image description support
- Add PDF processing support
- These are optional/future enhancements

---

## Test Requirements

### TODO-015 Tests
- Unit: UIStore selector returns correct values
- Unit: Second-to-millisecond conversion
- Integration: Seek updates audio position
- E2E: Play recording, verify progress updates

### TODO-016 Tests
- Unit: Location state parsing
- Integration: Context loads on mount
- E2E: Navigate from Library, verify context shown

### TODO-017 Tests
- Unit: Generation triggered on mount with action
- Integration: Output generator called correctly
- E2E: Click Generate, verify output modal appears

### TODO-018 Tests
- Unit: Prompt includes title/question generation
- Unit: JSON parsing of suggestions
- Integration: Database stores new fields
- E2E: Transcribe recording, verify suggestions appear

---

## Risk Assessment

### High Risk
- **Audio Player Fix:** OperationController is complex; changes could affect other playback consumers
- **Transcription Prompt Changes:** Could affect quality of existing analysis

### Medium Risk
- **Chat Context Loading:** Race conditions if context loads slowly
- **Actionables Auto-Generate:** Error handling for failed generations

### Low Risk
- **Navigation State Parsing:** Standard React Router pattern
- **UI Updates:** AssistantPanel already handles dynamic content

---

## Dependencies

### External
- Google Gemini API (transcription, analysis)
- Ollama (local LLM for RAG)

### Internal
- UIStore for playback state
- OperationController for audio controls
- electronAPI for IPC communication

### Libraries (for future TODOs)
- pdf-parse for PDF processing
- No new dependencies for TODO-015 through 018
