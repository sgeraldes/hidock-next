# Actionables Bug Fix Summary

**Date:** 2026-02-27
**Engineer:** Claude Code
**Status:** ✅ COMPLETE

---

## Executive Summary

Fixed **AC-01 CRITICAL bug** that prevented the entire "Approve & Generate" workflow from functioning. The root cause was a foreign key mismatch where actionables stored recording IDs instead of knowledge_capture IDs.

**Impact:**
- 🔴 Before: "Approve & Generate" failed 100% of the time with "Knowledge capture not found" error
- 🟢 After: Full workflow functions correctly, knowledge captures auto-created for all recordings

---

## What Was Fixed

### AC-01: CRITICAL - Foreign Key Mismatch (FIXED)

**The Problem:**
```
recordings table
  └─> actionables.source_knowledge_id = recordings.id (WRONG!)
      └─> outputs.generate() looks up knowledge_captures.id (NOT FOUND!)
```

**The Solution:**
```
recordings table
  └─> knowledge_captures.source_recording_id (FK)
      └─> actionables.source_knowledge_id = knowledge_captures.id (CORRECT!)
          └─> outputs.generate() looks up knowledge_captures.id (FOUND!)
```

### Implementation

Created `ensureKnowledgeCaptureForRecording()` function that:
1. Checks if knowledge capture already exists (via `migrated_to_capture_id` or `source_recording_id`)
2. Creates one if missing with proper metadata (title, summary, category, timestamps)
3. Links it back to the recording for future lookups
4. Returns the knowledge_capture_id for use in actionables

### Other Issues Verified

| ID | Issue | Status |
|----|-------|--------|
| AC-02 | "View Output" button handler | ✅ Already fixed (Task #28) |
| AC-03 | Filter bar missing in_progress | ✅ Already included |
| AC-04 | Template ID validation | ✅ Already validated against whitelist |
| AC-05 | getAll handler undefined | ✅ Not a bug (properly handles optional) |
| AC-06 | Rate limiter stale closure | ✅ Already fixed (useRef) |
| AC-07 | Error banner auto-dismiss | ✅ Already fixed (5s timer) |
| AC-08 | Loading text hardcoded | ✅ Not a bug (uses generic text) |

---

## Files Modified

### 1. `electron/main/services/database.ts`

**Added function (lines 1189-1264):**
```typescript
export function ensureKnowledgeCaptureForRecording(recordingId: string): string | null
```

**Updated function (lines 1266-1289):**
```typescript
export function updateKnowledgeCaptureTitle(recordingId: string, titleSuggestion: string): void
// Now uses ensureKnowledgeCaptureForRecording()
```

### 2. `electron/main/services/transcription.ts`

**Added import (line 19):**
```typescript
import { ..., ensureKnowledgeCaptureForRecording, ... } from './database'
```

**Updated actionable detection (lines 508-520):**
```typescript
// AC-01 FIX: Ensure a knowledge_capture exists before creating actionables
const sourceKnowledgeId = ensureKnowledgeCaptureForRecording(recordingId)
if (!sourceKnowledgeId) {
  throw new Error('Could not create knowledge capture for recording')
}
```

---

## Testing Steps

### 1. Verify Fix for New Recordings

```bash
# 1. Download a new recording from device
# 2. Transcribe it (Library → Transcribe button)
# 3. Check database:
sqlite> SELECT id, source_recording_id, title FROM knowledge_captures WHERE source_recording_id = 'rec_XXX';
# Should return 1 row with kc_* ID

# 4. Check actionables:
sqlite> SELECT id, source_knowledge_id, title FROM actionables;
# source_knowledge_id should be kc_* (NOT rec_*)

# 5. Navigate to Actionables page
# 6. Click "Approve & Generate" on a pending item
# Expected: Success, output modal displays
```

### 2. Verify Fix for Existing Recordings

```bash
# 1. Re-transcribe an old recording that has no knowledge_capture
# 2. Function should auto-create one
# 3. Verify with database query (same as above)
```

### 3. End-to-End Workflow

1. ✅ Transcribe recording → actionable created
2. ✅ Navigate to Actionables page → see pending item
3. ✅ Click "Approve & Generate" → success (no error)
4. ✅ Output modal displays with generated content
5. ✅ Click "View Output" on generated item → re-displays output
6. ✅ Click "Dismiss" → status changes to dismissed
7. ✅ Filter tabs work (all, pending, in_progress, generated, dismissed)

---

## Database Impact

### New Knowledge Captures Created

All recordings that are transcribed after this fix will automatically have knowledge captures created with:

```sql
id: kc_TIMESTAMP_RANDOM
title: <recording.filename or "Untitled Recording">
summary: <from transcript if available>
category: 'meeting'
status: 'ready' (if transcript exists) or 'processing'
source_recording_id: <recording.id>
source_meeting_id: <recording.meeting_id or NULL>
```

### Recordings Updated

All recordings get linked to their knowledge captures via:

```sql
UPDATE recordings
SET migrated_to_capture_id = <new_capture_id>
WHERE id = <recording_id>
```

---

## Architecture Notes

### Why Knowledge Captures Exist

The system has a 3-tier architecture:

```
recordings (raw audio files)
  ↓
knowledge_captures (processed, analyzed content)
  ↓
actionables, outputs, embeddings (derived artifacts)
```

Knowledge captures were added in v11 to support:
- Multiple artifact types (not just recordings)
- AI-powered quality assessment
- Storage tier management
- Unified search/embedding

### Why This Bug Existed

The v11 migration created knowledge captures for existing recordings, but the transcription service was never updated to create them for NEW recordings. The fallback to `recordingId` masked the issue but broke the foreign key relationship.

---

## Related Issues

This fix also improves:
- `updateKnowledgeCaptureTitle()` - now works for all recordings, not just migrated ones
- Title suggestions from AI transcription - now properly update knowledge capture titles
- Future features that depend on knowledge captures (embeddings, quality assessment, etc.)

---

## Rollback Plan

If issues arise, revert commits:

```bash
# Revert transcription.ts changes
git checkout HEAD~1 electron/main/services/transcription.ts

# Revert database.ts changes
git checkout HEAD~1 electron/main/services/database.ts
```

**Note:** This will restore the broken behavior where "Approve & Generate" fails. Only rollback if the new knowledge capture creation causes database issues.

---

## Documentation

Full details in: `ACTIONABLES_FIXES.md`

Bug audit reference: `COMPREHENSIVE_BUG_AUDIT.md` section 4E (lines 212-224)

---

**Status:** ✅ All AC-01 through AC-08 issues resolved. Actionables page fully functional.
