# SQLite database service with full schema
## Current State
Nothing exists. Pattern: apps/meeting-recorder/electron/main/services/database.ts
## What to Create
- electron/main/services/database.ts - init, save, close
- electron/main/services/database-schema.ts - 8 tables: settings, sessions, meetings, transcript_segments, knowledge_chunks, screenshots, notes, note_templates
- electron/main/services/database-queries.ts - CRUD per table
- electron/main/services/database-types.ts - TS types per table row
## Dependencies
Task 5
## Acceptance Criteria
- All 8 tables from spec with exact columns
- knowledge_chunks.embedding is BLOB
- Default note templates seeded
- All CRUD functions type-check
