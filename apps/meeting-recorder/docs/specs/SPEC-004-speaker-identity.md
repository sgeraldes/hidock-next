# SPEC-004: Speaker Identity Management

**Created:** 2026-03-04
**Status:** Backlog — Do Not Implement Yet
**Priority:** Medium
**Dependencies:** SPEC-003 (speaker rename UI, done)

## Problem Statement

Speaker names in transcripts are ephemeral (session-scoped) and generic ("Speaker 1", "Speaker 2"). There is no persistent identity layer — renaming a speaker in one conversation has no effect on other conversations, and the system cannot recognize the same person across sessions. This creates friction: users must manually rename "Speaker 1" to "Sebastian" in every single session.

## Vision

A persistent speaker identity system where:
1. Renaming "Speaker 1" to "Sebastian" in one session registers "Sebastian" as a known speaker
2. Future sessions auto-suggest "Sebastian" when the same voice pattern is detected
3. A voice fingerprint returned by the transcription AI can be matched semantically against known speakers
4. The speaker registry is searchable and editable globally

---

## Requirements

### REQ-1: Global Speaker Registry

1. When a user renames a speaker in a transcript, persist the new name to the **global speakers table** (`speakers.display_name`) in addition to updating the session's transcript segments.
2. The speakers table already exists: `id, name, display_name, created_at` — `display_name` is the user-given name; `name` is the internal/original identifier.
3. A session's speaker entry (in `session_speakers`) links a session to a registered speaker.
4. After rename, update `speakers.display_name = newName` for the matched speaker record.

### REQ-2: Speaker Autocomplete on Rename

1. When the user opens the inline edit field to rename a speaker, show a dropdown/datalist of existing known speakers from the global registry.
2. The dropdown should appear below the input with matching names as the user types.
3. Selecting a name from the dropdown assigns that identity to all matching segments in the current session.
4. This lets users type "S" and select "Sebastian" rather than typing the full name each time.

**Implementation notes:**
- Fetch known speakers via `window.electronAPI.speaker.list()` (already exists)
- Use HTML `<datalist>` for simple autocomplete, or a custom dropdown
- New IPC: `speaker:search(query)` for filtered results

### REQ-3: Voice Fingerprinting (Future — AI Layer)

1. The transcription AI (Gemini multimodal, Chirp 3) may return speaker diarization embeddings or voice characteristics alongside segments.
2. These "voice fingerprints" should be stored per speaker per session as a blob/JSON column in the `speakers` or `session_speakers` table.
3. When a new session is transcribed, extract voice fingerprints from the AI response and attempt to match against known fingerprints using cosine similarity or similar metric.
4. If a match exceeds a confidence threshold (e.g., 0.85), auto-assign the speaker identity without user intervention.
5. If below threshold, suggest the closest match to the user with a confidence indicator.

**Implementation notes:**
- Requires AI to return diarization data — not all providers support this
- Google Cloud Speech-to-Text v2 (Chirp 3) supports speaker diarization
- Fingerprint storage: `ALTER TABLE speakers ADD COLUMN voice_fingerprint TEXT` (JSON array of floats)
- Matching algorithm: cosine similarity on embedding vectors
- New IPC: `speaker:matchFingerprint(embedding)` → returns `{ speakerId, confidence }[]`

### REQ-4: Semantic Speaker Search

1. Users can search the speaker registry by name: "Find all sessions with Sebastian"
2. Future: semantic search — "Find the person who talked about quarterly targets" (voice fingerprint + transcript semantic search combined)
3. Integration point with the existing `history:search` IPC for cross-session search

### REQ-5: Speaker Profile View

1. A speaker profile shows: display name, number of sessions, total speaking time, common topics
2. Accessible from the session transcript (click speaker name → "View profile")
3. Allows bulk-renaming across all sessions

---

## Data Model Changes

```sql
-- Add voice fingerprint to speakers table
ALTER TABLE speakers ADD COLUMN voice_fingerprint TEXT;  -- JSON: float[]
ALTER TABLE speakers ADD COLUMN voice_fingerprint_updated_at TEXT;

-- Add confidence to session_speakers
ALTER TABLE session_speakers ADD COLUMN match_confidence REAL;  -- 0.0-1.0
ALTER TABLE session_speakers ADD COLUMN match_method TEXT;  -- 'manual', 'fingerprint', 'auto'
```

---

## New IPC Channels Required

| Channel | Direction | Description |
|---------|-----------|-------------|
| `speaker:search` | renderer→main | Search speakers by name |
| `speaker:updateDisplayName` | renderer→main | Rename a speaker globally |
| `speaker:storeFingerprint` | renderer→main | Save voice fingerprint for a speaker |
| `speaker:matchFingerprint` | renderer→main | Find matching speakers by fingerprint |
| `speaker:getProfile` | renderer→main | Get speaker profile (sessions, speaking time) |

---

## Implementation Phases

### Phase A (Quick Win — implement next)
- REQ-1: Wire rename → global speaker registry (update `speakers.display_name`)
- REQ-2: Autocomplete from existing speaker list

### Phase B (Medium term)
- REQ-3: Voice fingerprint storage (if AI provides diarization data)
- REQ-5: Speaker profile view

### Phase C (Long term / Research)
- REQ-3: Automatic fingerprint matching
- REQ-4: Semantic speaker search

---

## Current State

- Speaker rename UI exists (SPEC-003): click name → inline edit → Enter saves
- Rename currently updates only `transcript_segments.speaker_name` for the current session
- Global speaker registry (`speakers` table) exists but is NOT updated on rename
- No voice fingerprinting implemented
- No autocomplete on rename input

## Out of Scope for This Spec

- Real-time speaker identification during recording
- Multi-speaker simultaneous voice fingerprint matching during live sessions
- Speaker verification / authentication (security use case)
