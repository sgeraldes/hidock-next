# Electron App Implementation Plan

## Overview
This plan addresses critical missing features in the HiDock Electron app.

---

## 1. SMART FILE LIST CACHING (P0 - Critical)

### Problem
When disconnecting and reconnecting, the app re-fetches the entire file list from device (takes ~1 minute for 976 files), even when the file count hasn't changed.

### Solution
- Cache survives disconnect/reconnect within same app session
- Only invalidate cache when:
  1. File count changes
  2. User clicks "Refresh" button
  3. App restarts (acceptable)

### Files to Modify
- `apps/electron/src/services/hidock-device.ts`:
  - Do NOT clear cache on disconnect
  - Compare file count on reconnect - if same, use cache
  - Only clear cache on `forceRefresh` or when count differs

### Implementation
```typescript
// In handleDisconnect() - DON'T clear cache
// this.cachedRecordings = null  // REMOVE THIS
// this.cachedRecordingCount = -1  // REMOVE THIS

// In listRecordings() - already has logic, but needs to survive disconnect
```

---

## 2. DOWNLOAD TRACKING (P0 - Critical)

### Problem
"Sync All" re-downloads every file every time. No check if file already exists locally.

### Solution
- Add `synced_files` table to track original filenames that have been downloaded
- Before downloading, check if filename exists in synced_files
- Skip already-synced files

### Files to Modify
- `apps/electron/electron/main/services/database.ts`: Add `synced_files` table
- `apps/electron/electron/main/ipc/storage-handlers.ts`: Record synced files
- `apps/electron/src/services/hidock-device.ts`: Check before download
- `apps/electron/src/pages/Device.tsx`: Show "already synced" status

### Database Schema
```sql
CREATE TABLE IF NOT EXISTS synced_files (
    id TEXT PRIMARY KEY,
    original_filename TEXT NOT NULL UNIQUE,
    local_filename TEXT NOT NULL,
    file_path TEXT NOT NULL,
    synced_at TEXT DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_synced_original ON synced_files(original_filename);
```

---

## 3. AUDIO PLAYBACK (P1 - High)

### Problem
Play button exists in MeetingDetail.tsx but has no functionality.

### Solution
- Create AudioPlayer component
- Use HTML5 Audio API
- Play WAV files from local storage

### Files to Create/Modify
- `apps/electron/src/components/AudioPlayer.tsx`: New component
- `apps/electron/src/pages/MeetingDetail.tsx`: Wire up play button
- `apps/electron/electron/main/ipc/storage-handlers.ts`: Add getFilePath IPC

---

## 4. RECORDINGS BROWSER PAGE (P1 - High)

### Problem
Can't view downloaded recordings without device connection.

### Solution
- Create new Recordings page
- List all recordings from database
- Show sync status, transcript status
- Allow playback

### Files to Create/Modify
- `apps/electron/src/pages/Recordings.tsx`: New page
- `apps/electron/src/App.tsx`: Add route
- `apps/electron/src/components/Layout.tsx`: Add nav link

---

## 5. TRANSCRIPTS VIEWER (P1 - High)

### Problem
Transcripts exist in database but no dedicated UI to browse them.

### Solution
- Add transcript viewer to Recordings page
- Show full text, summary, action items
- Link to meeting if correlated

### Files to Modify
- `apps/electron/src/pages/Recordings.tsx`: Include transcript display
- `apps/electron/electron/main/ipc/database-handlers.ts`: Add getTranscripts IPC

---

## 6. CHUNKS/EMBEDDINGS VIEWER (P2 - Medium)

### Problem
Chat shows "X chunks from Y meetings" but can't see what chunks exist.

### Solution
- Add collapsible section to show indexed chunks
- Display in Chat page or dedicated Debug/Admin section

### Files to Modify
- `apps/electron/src/pages/Chat.tsx`: Add chunks viewer
- `apps/electron/electron/main/ipc/rag-handlers.ts`: Add getChunks IPC

---

## 7. CHAT PAGE ERROR HANDLING (P1 - High)

### Problem
Chat page shows blank - likely crashes on load.

### Solution
- Add error boundary
- Better loading states
- Handle Ollama not available gracefully

### Files to Modify
- `apps/electron/src/pages/Chat.tsx`: Add try-catch, error states

---

## Implementation Order

1. **Smart File List Caching** - Immediate UX improvement
2. **Download Tracking** - Prevents duplicate downloads
3. **Audio Playback** - Core functionality
4. **Recordings Browser** - View files offline
5. **Transcripts Viewer** - Part of Recordings
6. **Chat Error Handling** - Fix blank page
7. **Chunks Viewer** - Nice to have

---

## Estimated Changes

| Task | Files Changed | New Files | Complexity |
|------|--------------|-----------|------------|
| Smart Caching | 1 | 0 | Low |
| Download Tracking | 4 | 0 | Medium |
| Audio Playback | 3 | 1 | Medium |
| Recordings Page | 3 | 1 | Medium |
| Transcripts | 2 | 0 | Low |
| Chat Fix | 1 | 0 | Low |
| Chunks Viewer | 2 | 0 | Low |
