import Database from 'better-sqlite3'
import { existsSync, readFileSync } from 'fs'
import { join } from 'path'
import { randomUUID } from 'crypto'
import { getDatabasePath } from './file-storage'
import { DatabaseEngine, getTableColumns, type SqlJsDatabase } from '@hidock/database'
import { normalizeName, isGenericSpeakerLabel, detectAmbiguousName } from './entity-normalize'
import { getEventBus } from './event-bus'

const SCHEMA_VERSION = 42

const SCHEMA = `
-- Calendar events from ICS
CREATE TABLE IF NOT EXISTS meetings (
    id TEXT PRIMARY KEY,
    subject TEXT NOT NULL,
    start_time TEXT NOT NULL,
    end_time TEXT NOT NULL,
    location TEXT,
    organizer_name TEXT,
    organizer_email TEXT,
    attendees TEXT,
    description TEXT,
    is_recurring INTEGER DEFAULT 0,
    recurrence_rule TEXT,
    meeting_url TEXT,
    is_all_day INTEGER DEFAULT 0,
    all_day_date TEXT,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT DEFAULT CURRENT_TIMESTAMP
);

-- Recordings from HiDock device
CREATE TABLE IF NOT EXISTS recordings (
    id TEXT PRIMARY KEY,
    filename TEXT NOT NULL,
    original_filename TEXT,
    file_path TEXT,
    file_size INTEGER,
    duration_seconds REAL,
    date_recorded TEXT NOT NULL,
    meeting_id TEXT,
    correlation_confidence REAL,
    correlation_method TEXT,
    status TEXT DEFAULT 'pending',
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    -- Recording lifecycle columns (v6)
    location TEXT DEFAULT 'device-only',
    transcription_status TEXT DEFAULT 'none',
    on_device INTEGER DEFAULT 1,
    device_last_seen TEXT,
    on_local INTEGER DEFAULT 0,
    source TEXT DEFAULT 'hidock',
    is_imported INTEGER DEFAULT 0,
    storage_tier TEXT DEFAULT NULL CHECK(storage_tier IN (NULL, 'hot', 'warm', 'cold', 'archive')),
    -- Migration tracking columns (v11)
    migrated_to_capture_id TEXT,
    migration_status TEXT CHECK(migration_status IN ('pending', 'migrated', 'skipped', 'error')) DEFAULT 'pending',
    migrated_at TEXT,
    -- Privacy / lifecycle (v38). personal = user-marked "ignore" (kept on disk but
    -- pulled out of every AI pipeline and default surface). deleted_at = soft-delete
    -- tombstone (hidden everywhere, restorable until hard-purged). See deleteRecordingCascade.
    personal INTEGER DEFAULT 0,
    deleted_at TEXT,
    FOREIGN KEY (meeting_id) REFERENCES meetings(id)
);

-- =============================================================================
-- Core Knowledge Entity (v11)
-- =============================================================================

CREATE TABLE IF NOT EXISTS knowledge_captures (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    summary TEXT,
    category TEXT CHECK(category IN ('meeting', 'interview', '1:1', 'brainstorm', 'note', 'other')) DEFAULT 'meeting',
    status TEXT CHECK(status IN ('processing', 'ready', 'enriched')) DEFAULT 'ready',

    -- Quality assessment
    quality_rating TEXT CHECK(quality_rating IN ('valuable', 'archived', 'low-value', 'garbage', 'unrated')) DEFAULT 'unrated',
    quality_confidence REAL,
    quality_assessed_at TEXT,

    -- Storage tier and retention
    storage_tier TEXT CHECK(storage_tier IN ('hot', 'cold', 'expiring', 'deleted')) DEFAULT 'hot',
    retention_days INTEGER,
    expires_at TEXT,

    -- Meeting correlation
    meeting_id TEXT,
    correlation_confidence REAL,
    correlation_method TEXT,

    -- Source tracking (migration from recordings)
    source_recording_id TEXT,

    -- Timestamps
    captured_at TEXT NOT NULL,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
    deleted_at TEXT,

    FOREIGN KEY (meeting_id) REFERENCES meetings(id),
    FOREIGN KEY (source_recording_id) REFERENCES recordings(id)
);

-- =============================================================================
-- Audio Sources - Multi-source tracking (v11)
-- =============================================================================

CREATE TABLE IF NOT EXISTS audio_sources (
    id TEXT PRIMARY KEY,
    knowledge_capture_id TEXT NOT NULL,

    -- Source type and paths
    source_type TEXT CHECK(source_type IN ('device', 'local', 'imported', 'cloud')) NOT NULL,
    device_path TEXT,
    local_path TEXT,
    cloud_url TEXT,

    -- File metadata
    file_name TEXT NOT NULL,
    file_size INTEGER,
    duration_seconds REAL,
    format TEXT,

    -- Sync tracking
    synced_from_device_at TEXT,
    uploaded_to_cloud_at TEXT,

    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT DEFAULT CURRENT_TIMESTAMP,

    FOREIGN KEY (knowledge_capture_id) REFERENCES knowledge_captures(id) ON DELETE CASCADE
);

-- =============================================================================
-- First-Class Action Items (v11)
-- =============================================================================

CREATE TABLE IF NOT EXISTS action_items (
    id TEXT PRIMARY KEY,
    knowledge_capture_id TEXT NOT NULL,

    -- Action item content
    content TEXT NOT NULL,
    assignee TEXT,
    assignee_contact_id TEXT, -- canonical contact link (v26) — assignee stays the raw name string
    due_date TEXT,

    -- Priority and status
    priority TEXT CHECK(priority IN ('low', 'medium', 'high', 'urgent')) DEFAULT 'medium',
    status TEXT CHECK(status IN ('pending', 'in_progress', 'completed', 'cancelled')) DEFAULT 'pending',

    -- Extraction metadata
    extracted_from TEXT,
    confidence REAL,

    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT DEFAULT CURRENT_TIMESTAMP,

    FOREIGN KEY (knowledge_capture_id) REFERENCES knowledge_captures(id) ON DELETE CASCADE
);

-- =============================================================================
-- First-Class Decisions (v11)
-- =============================================================================

CREATE TABLE IF NOT EXISTS decisions (
    id TEXT PRIMARY KEY,
    knowledge_capture_id TEXT NOT NULL,

    -- Decision content
    content TEXT NOT NULL,
    context TEXT,
    participants TEXT,  -- JSON array of participant names/emails

    -- Extraction metadata
    extracted_from TEXT,
    confidence REAL,
    decided_at TEXT,

    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT DEFAULT CURRENT_TIMESTAMP,

    FOREIGN KEY (knowledge_capture_id) REFERENCES knowledge_captures(id) ON DELETE CASCADE
);

-- =============================================================================
-- First-Class Follow-ups (v11)
-- =============================================================================

CREATE TABLE IF NOT EXISTS follow_ups (
    id TEXT PRIMARY KEY,
    knowledge_capture_id TEXT NOT NULL,

    -- Follow-up content
    content TEXT NOT NULL,
    owner TEXT,
    target_date TEXT,

    -- Status and scheduling
    status TEXT CHECK(status IN ('pending', 'scheduled', 'completed', 'cancelled')) DEFAULT 'pending',
    scheduled_meeting_id TEXT,

    -- Extraction metadata
    extracted_from TEXT,
    confidence REAL,

    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT DEFAULT CURRENT_TIMESTAMP,

    FOREIGN KEY (knowledge_capture_id) REFERENCES knowledge_captures(id) ON DELETE CASCADE,
    FOREIGN KEY (scheduled_meeting_id) REFERENCES meetings(id)
);

-- =============================================================================
-- Generated Outputs (v11)
-- =============================================================================

CREATE TABLE IF NOT EXISTS outputs (
    id TEXT PRIMARY KEY,
    knowledge_capture_id TEXT NOT NULL,

    -- Template information
    template_id TEXT,
    template_name TEXT NOT NULL,

    -- Generated content
    content TEXT NOT NULL,

    -- Generation metadata
    generated_at TEXT NOT NULL,
    regenerated_count INTEGER DEFAULT 0,

    -- Export tracking
    exported_at TEXT,
    export_format TEXT,

    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT DEFAULT CURRENT_TIMESTAMP,

    FOREIGN KEY (knowledge_capture_id) REFERENCES knowledge_captures(id) ON DELETE CASCADE
);

-- Transcripts
CREATE TABLE IF NOT EXISTS transcripts (
    id TEXT PRIMARY KEY,
    recording_id TEXT NOT NULL UNIQUE,
    full_text TEXT NOT NULL,
    language TEXT DEFAULT 'es',
    summary TEXT,
    action_items TEXT,
    topics TEXT,
    key_points TEXT,
    sentiment TEXT,
    speakers TEXT,
    word_count INTEGER,
    transcription_provider TEXT,
    transcription_model TEXT,
    title_suggestion TEXT,
    question_suggestions TEXT,
    -- Meeting-timeline data (v39): windowed sentiment + event markers, both JSON.
    -- sentiment_segments: [{startSec,endSec,score:-1..1}] time-series across the recording.
    -- event_markers: [{id,kind,atSec,label,refId}] action/decision markers with audio offsets.
    sentiment_segments TEXT,
    event_markers TEXT,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (recording_id) REFERENCES recordings(id)
);

-- Embeddings for RAG
CREATE TABLE IF NOT EXISTS embeddings (
    id TEXT PRIMARY KEY,
    transcript_id TEXT NOT NULL,
    chunk_index INTEGER NOT NULL,
    chunk_text TEXT NOT NULL,
    embedding BLOB NOT NULL,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (transcript_id) REFERENCES transcripts(id)
);

-- App configuration and state
CREATE TABLE IF NOT EXISTS config (
    key TEXT PRIMARY KEY,
    value TEXT,
    updated_at TEXT DEFAULT CURRENT_TIMESTAMP
);

-- Processing queue
CREATE TABLE IF NOT EXISTS transcription_queue (
    id TEXT PRIMARY KEY,
    recording_id TEXT NOT NULL,
    status TEXT DEFAULT 'pending',
    attempts INTEGER DEFAULT 0,
    retry_count INTEGER DEFAULT 0,
    progress INTEGER DEFAULT 0,
    error_message TEXT,
    provider TEXT,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    started_at TEXT,
    completed_at TEXT,
    FOREIGN KEY (recording_id) REFERENCES recordings(id)
);

-- Transcription service mutex lock (v19)
CREATE TABLE IF NOT EXISTS transcription_service_lock (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    process_id TEXT,
    acquired_at TEXT,
    updated_at TEXT
);

-- Download queue (v20) - spec-007
-- cancel_reason (v40): origin of a 'cancelled' status — 'user' (deliberate cancel,
-- terminal-suppressed from auto-retry AND from reconciliation re-queue until a
-- manual Retry) vs 'interrupted' (disconnect/re-sync, auto-retried on reconnect).
-- NOTE: never put a semicolon character inside schema comments — the executor
-- splits statements on that character, so the remainder of a comment line
-- would run as (broken) SQL.
CREATE TABLE IF NOT EXISTS download_queue (
    id TEXT PRIMARY KEY,
    filename TEXT NOT NULL UNIQUE,
    file_size INTEGER NOT NULL,
    progress INTEGER DEFAULT 0,
    status TEXT DEFAULT 'pending' CHECK(status IN ('pending', 'downloading', 'completed', 'failed', 'cancelled')),
    error TEXT,
    started_at TEXT,
    completed_at TEXT,
    recording_date TEXT,
    cancel_reason TEXT CHECK(cancel_reason IN ('user', 'interrupted') OR cancel_reason IS NULL),
    created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

-- Conversations (v12)
CREATE TABLE IF NOT EXISTS conversations (
    id TEXT PRIMARY KEY,
    title TEXT,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT DEFAULT CURRENT_TIMESTAMP
);

-- Chat history
CREATE TABLE IF NOT EXISTS chat_messages (
    id TEXT PRIMARY KEY,
    conversation_id TEXT,
    role TEXT NOT NULL,
    content TEXT NOT NULL,
    sources TEXT,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE
);

-- Conversation context (v12)
CREATE TABLE IF NOT EXISTS conversation_context (
    id TEXT PRIMARY KEY,
    conversation_id TEXT NOT NULL,
    knowledge_capture_id TEXT NOT NULL,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE,
    FOREIGN KEY (knowledge_capture_id) REFERENCES knowledge_captures(id) ON DELETE CASCADE,
    UNIQUE(conversation_id, knowledge_capture_id)
);

-- Schema version tracking
CREATE TABLE IF NOT EXISTS schema_version (
    version INTEGER PRIMARY KEY,
    applied_at TEXT DEFAULT CURRENT_TIMESTAMP
);

-- Synced files tracking - prevents re-downloading already synced files
CREATE TABLE IF NOT EXISTS synced_files (
    id TEXT PRIMARY KEY,
    original_filename TEXT NOT NULL UNIQUE,
    local_filename TEXT NOT NULL,
    file_path TEXT NOT NULL,
    file_size INTEGER,
    synced_at TEXT DEFAULT CURRENT_TIMESTAMP
);

-- Contacts extracted from meeting attendees (renamed to People in UI)
-- Note: email is NOT UNIQUE - multiple contacts can share an email (spec-013)
CREATE TABLE IF NOT EXISTS contacts (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    email TEXT,
    type TEXT CHECK(type IN ('team', 'candidate', 'customer', 'external', 'unknown')) DEFAULT 'unknown',
    role TEXT,
    company TEXT,
    notes TEXT,
    tags TEXT, -- JSON string of tags
    first_seen_at TEXT NOT NULL,
    last_seen_at TEXT NOT NULL,
    meeting_count INTEGER DEFAULT 0,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

-- User-created projects for organizing meetings. Projects are full hubs (v29):
-- folder_path binds a project to a location on disk (repo, docs folder), url binds
-- it to a webpage. project_notes below holds its issues/risks/notes.
CREATE TABLE IF NOT EXISTS projects (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    description TEXT,
    status TEXT CHECK(status IN ('active', 'archived')) DEFAULT 'active',
    folder_path TEXT,
    url TEXT,
    -- Durable provenance (v42): 'manual' = explicit user create, 'discovered' =
    -- reconciler auto-create from a transcript mention. NULL = legacy/unknown.
    -- dismissDiscoveredProject requires 'discovered' (fail-closed): a project of
    -- unproven origin can never be tombstone-deleted through the dismiss path.
    origin TEXT CHECK(origin IN ('manual', 'discovered')),
    created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

-- Project issues / risks / free-form notes (v29). Each row is one item tracked
-- against a project. Issues and risks toggle open↔resolved, notes are informational.
CREATE TABLE IF NOT EXISTS project_notes (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL,
    kind TEXT CHECK(kind IN ('issue', 'risk', 'note')),
    content TEXT NOT NULL,
    status TEXT CHECK(status IN ('open', 'resolved')) DEFAULT 'open',
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    resolved_at TEXT,
    FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
);

-- Junction table: Meeting-Contact relationship
CREATE TABLE IF NOT EXISTS meeting_contacts (
    meeting_id TEXT NOT NULL,
    contact_id TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'attendee',
    PRIMARY KEY (meeting_id, contact_id),
    FOREIGN KEY (meeting_id) REFERENCES meetings(id) ON DELETE CASCADE,
    FOREIGN KEY (contact_id) REFERENCES contacts(id) ON DELETE CASCADE
);

-- Speaker identity map: binds a transcript speaker label (e.g. "Speaker 1")
-- to a canonical contact, per recording (v25).
CREATE TABLE IF NOT EXISTS transcript_speakers (
    id TEXT PRIMARY KEY,
    recording_id TEXT NOT NULL,
    speaker_label TEXT NOT NULL,
    contact_id TEXT NOT NULL,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(recording_id, speaker_label),
    FOREIGN KEY (recording_id) REFERENCES recordings(id) ON DELETE CASCADE,
    FOREIGN KEY (contact_id) REFERENCES contacts(id) ON DELETE CASCADE
);

-- Mention resolutions: per-recording assignment of an ambiguous bucket name
-- (a bare first name like "Sergio" that could be several people) to the real
-- contact it denotes IN THAT recording. source_name is the raw spoken/extracted
-- name and resolved_contact_id is the chosen person (NULL = marked Unclear).
-- One decision per (recording, name) so a re-analysis honors it instead of
-- re-bucketing. See detectAmbiguousName + the "Resolve per meeting" surface.
CREATE TABLE IF NOT EXISTS mention_resolutions (
    id TEXT PRIMARY KEY,
    recording_id TEXT NOT NULL,
    source_name TEXT NOT NULL,
    resolved_contact_id TEXT,
    method TEXT,
    confidence REAL,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(recording_id, source_name),
    FOREIGN KEY (recording_id) REFERENCES recordings(id) ON DELETE CASCADE,
    FOREIGN KEY (resolved_contact_id) REFERENCES contacts(id) ON DELETE SET NULL
);

-- Junction table: Meeting-Project relationship
CREATE TABLE IF NOT EXISTS meeting_projects (
    meeting_id TEXT NOT NULL,
    project_id TEXT NOT NULL,
    PRIMARY KEY (meeting_id, project_id),
    FOREIGN KEY (meeting_id) REFERENCES meetings(id) ON DELETE CASCADE,
    FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
);

-- Junction table: Knowledge-Project relationship (v26). Enables DIRECT project
-- assignment for knowledge captures / recordings with no meeting.
CREATE TABLE IF NOT EXISTS knowledge_projects (
    knowledge_capture_id TEXT NOT NULL,
    project_id TEXT NOT NULL,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (knowledge_capture_id, project_id),
    FOREIGN KEY (knowledge_capture_id) REFERENCES knowledge_captures(id) ON DELETE CASCADE,
    FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
);

-- Recording-Meeting candidates: tracks all possible meetings a recording could match
-- Allows AI to select the best match and user to override
CREATE TABLE IF NOT EXISTS recording_meeting_candidates (
    id TEXT PRIMARY KEY,
    recording_id TEXT NOT NULL,
    meeting_id TEXT NOT NULL,
    confidence_score REAL DEFAULT 0,
    match_reason TEXT,
    is_selected INTEGER DEFAULT 0,
    is_ai_selected INTEGER DEFAULT 0,
    is_user_confirmed INTEGER DEFAULT 0,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (recording_id) REFERENCES recordings(id) ON DELETE CASCADE,
    FOREIGN KEY (meeting_id) REFERENCES meetings(id) ON DELETE CASCADE,
    UNIQUE(recording_id, meeting_id)
);

-- Recording pre-assignments (v31): user's IN-ADVANCE attribution choice for a
-- recording the device is CURRENTLY capturing, keyed by the live device filename.
--   meeting_id = <id>  → force-link to this meeting when the file is downloaded
--   meeting_id = NULL  → force STANDALONE (block time-overlap auto-link)
-- Consumed (deleted) by autoLinkRecordingsToMeetings once applied.
CREATE TABLE IF NOT EXISTS recording_preassignments (
    filename TEXT PRIMARY KEY,
    meeting_id TEXT,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (meeting_id) REFERENCES meetings(id) ON DELETE CASCADE
);

-- Device files cache - persists device file list for offline viewing
CREATE TABLE IF NOT EXISTS device_files_cache (
    id TEXT PRIMARY KEY,
    filename TEXT NOT NULL UNIQUE,
    file_size INTEGER,
    duration_seconds REAL,
    date_recorded TEXT NOT NULL,
    cached_at TEXT DEFAULT CURRENT_TIMESTAMP
);

-- Quality assessments for recordings (v10)
CREATE TABLE IF NOT EXISTS quality_assessments (
    id TEXT PRIMARY KEY,
    recording_id TEXT NOT NULL UNIQUE,
    quality TEXT NOT NULL CHECK(quality IN ('high', 'medium', 'low')),
    assessment_method TEXT NOT NULL CHECK(assessment_method IN ('auto', 'manual')),
    confidence REAL DEFAULT 1.0,
    reason TEXT,
    assessed_at TEXT DEFAULT CURRENT_TIMESTAMP,
    assessed_by TEXT,
    FOREIGN KEY (recording_id) REFERENCES recordings(id) ON DELETE CASCADE
);

-- -- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_device_cache_filename ON device_files_cache(filename);
CREATE INDEX IF NOT EXISTS idx_device_cache_date ON device_files_cache(date_recorded);

CREATE INDEX IF NOT EXISTS idx_meetings_start_time ON meetings(start_time);
CREATE INDEX IF NOT EXISTS idx_recordings_date ON recordings(date_recorded);
CREATE INDEX IF NOT EXISTS idx_recordings_meeting ON recordings(meeting_id);
CREATE INDEX IF NOT EXISTS idx_recordings_status ON recordings(status);
CREATE INDEX IF NOT EXISTS idx_transcripts_recording ON transcripts(recording_id);
CREATE INDEX IF NOT EXISTS idx_embeddings_transcript ON embeddings(transcript_id);
CREATE INDEX IF NOT EXISTS idx_queue_status ON transcription_queue(status);
CREATE INDEX IF NOT EXISTS idx_synced_original ON synced_files(original_filename);
CREATE INDEX IF NOT EXISTS idx_contacts_email ON contacts(email);
CREATE INDEX IF NOT EXISTS idx_contacts_name ON contacts(name);
CREATE INDEX IF NOT EXISTS idx_projects_name ON projects(name);
CREATE INDEX IF NOT EXISTS idx_meeting_contacts_meeting ON meeting_contacts(meeting_id);
CREATE INDEX IF NOT EXISTS idx_meeting_contacts_contact ON meeting_contacts(contact_id);
CREATE INDEX IF NOT EXISTS idx_transcript_speakers_recording ON transcript_speakers(recording_id);
CREATE INDEX IF NOT EXISTS idx_mention_resolutions_recording ON mention_resolutions(recording_id);
CREATE INDEX IF NOT EXISTS idx_mention_resolutions_contact ON mention_resolutions(resolved_contact_id);
CREATE INDEX IF NOT EXISTS idx_meeting_projects_meeting ON meeting_projects(meeting_id);
CREATE INDEX IF NOT EXISTS idx_meeting_projects_project ON meeting_projects(project_id);
CREATE INDEX IF NOT EXISTS idx_project_notes_project_kind ON project_notes(project_id, kind);
CREATE INDEX IF NOT EXISTS idx_knowledge_projects_knowledge ON knowledge_projects(knowledge_capture_id);
CREATE INDEX IF NOT EXISTS idx_knowledge_projects_project ON knowledge_projects(project_id);
CREATE INDEX IF NOT EXISTS idx_recording_candidates_recording ON recording_meeting_candidates(recording_id);
CREATE INDEX IF NOT EXISTS idx_recording_candidates_meeting ON recording_meeting_candidates(meeting_id);
CREATE INDEX IF NOT EXISTS idx_recording_candidates_selected ON recording_meeting_candidates(is_selected);
CREATE INDEX IF NOT EXISTS idx_knowledge_captures_quality ON knowledge_captures(quality_rating);
CREATE INDEX IF NOT EXISTS idx_knowledge_captures_status ON knowledge_captures(status);
CREATE INDEX IF NOT EXISTS idx_knowledge_captures_category ON knowledge_captures(category);
CREATE INDEX IF NOT EXISTS idx_knowledge_title ON knowledge_captures(title);
CREATE INDEX IF NOT EXISTS idx_knowledge_summary ON knowledge_captures(summary);
CREATE INDEX IF NOT EXISTS idx_quality_recording ON quality_assessments(recording_id);
CREATE INDEX IF NOT EXISTS idx_quality_level ON quality_assessments(quality);

-- Actionables (intent to create artifacts) (v15 - unified with v11 architecture)
CREATE TABLE IF NOT EXISTS actionables (
    id TEXT PRIMARY KEY,
    type TEXT NOT NULL,
    title TEXT NOT NULL,
    description TEXT,
    source_knowledge_id TEXT NOT NULL,
    source_action_item_id TEXT,
    suggested_template TEXT,
    suggested_recipients TEXT, -- JSON array
    status TEXT CHECK(status IN ('pending', 'in_progress', 'generated', 'shared', 'dismissed')) DEFAULT 'pending',
    confidence REAL CHECK(confidence >= 0.0 AND confidence <= 1.0),
    artifact_id TEXT, -- Links to outputs table
    generated_at TEXT,
    shared_at TEXT,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (source_knowledge_id) REFERENCES knowledge_captures(id) ON DELETE CASCADE,
    FOREIGN KEY (artifact_id) REFERENCES outputs(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_actionables_source_knowledge ON actionables(source_knowledge_id);
CREATE INDEX IF NOT EXISTS idx_actionables_status ON actionables(status);

-- Alias memory (v27). Every merge, speaker assignment, and accepted/rejected
-- suggestion writes a permanent alias so a settled identity is never re-asked.
-- alias_norm is the normalized (lowercased, whitespace-collapsed) alias string,
-- and a rejected-source row blocks resolving that alias to the paired entity.
CREATE TABLE IF NOT EXISTS contact_aliases (
    id TEXT PRIMARY KEY,
    alias_norm TEXT NOT NULL UNIQUE,
    contact_id TEXT NOT NULL,
    source TEXT CHECK(source IN ('merge', 'speaker_assign', 'manual', 'inferred', 'rejected')),
    confidence REAL,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (contact_id) REFERENCES contacts(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS project_aliases (
    id TEXT PRIMARY KEY,
    alias_norm TEXT NOT NULL UNIQUE,
    project_id TEXT NOT NULL,
    source TEXT CHECK(source IN ('merge', 'speaker_assign', 'manual', 'inferred', 'rejected')),
    confidence REAL,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
);

-- Discovery tombstones (v41). Dismissing an auto-discovered project records its
-- normalized name here so a later transcript re-analysis does NOT silently
-- re-create it (dismiss→reappear loop). Deliberately NOT keyed to a project id:
-- the dismissed project row is deleted, and project_aliases cascades away with
-- it, so this standalone table is the durable memory. It blocks ONLY the
-- reconciler's auto-create path — manual creation always wins and clears the
-- tombstone (see createProject).
CREATE TABLE IF NOT EXISTS project_discovery_rejections (
    name_norm TEXT PRIMARY KEY,
    original_name TEXT NOT NULL,
    source_meeting_id TEXT,
    rejected_at TEXT DEFAULT CURRENT_TIMESTAMP
);

-- Identity suggestion queue (v27). The 0.5–0.8 resolver band lands here as
-- reviewable cards. Accept writes an alias and links, reject blocks the pairing.
CREATE TABLE IF NOT EXISTS identity_suggestions (
    id TEXT PRIMARY KEY,
    kind TEXT CHECK(kind IN ('person', 'project')),
    candidate_name TEXT,
    target_id TEXT,
    confidence REAL,
    evidence TEXT,
    status TEXT CHECK(status IN ('pending', 'accepted', 'rejected')) DEFAULT 'pending',
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(kind, candidate_name, target_id)
);

-- Merge journal (v30): one row per executed contact/project merge, written inside
-- the merge's own transaction, so a fold can be reversed. loser_snapshot is the
-- full deleted loser row. repointed_manifest is the exact set of child rows the
-- merge moved (plus the loser's own aliases and the keeper's pre-merge link set,
-- for precise restore and orphan detection). folded_fields records which keeper
-- fields the merge filled from the loser, with before/after values.
CREATE TABLE IF NOT EXISTS merge_journal (
    id TEXT PRIMARY KEY,
    kind TEXT NOT NULL CHECK(kind IN ('contact', 'project')),
    keeper_id TEXT NOT NULL,
    -- loser_id (v42): queryable loser identity for the dependency-aware
    -- newest-first unmerge guard (also inside loser_snapshot, but the guard
    -- must not JSON-parse every open journal on every unmerge).
    loser_id TEXT,
    -- seq (v42): explicit immutable merge order. rowid is an implementation
    -- detail (VACUUM and dump/restore may renumber it), so ordering guards key
    -- on this instead.
    seq INTEGER,
    loser_snapshot TEXT NOT NULL,
    repointed_manifest TEXT NOT NULL,
    folded_fields TEXT,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    undone_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_contact_aliases_contact ON contact_aliases(contact_id);
CREATE INDEX IF NOT EXISTS idx_project_aliases_project ON project_aliases(project_id);
CREATE INDEX IF NOT EXISTS idx_identity_suggestions_status ON identity_suggestions(status);
CREATE INDEX IF NOT EXISTS idx_merge_journal_kind_keeper ON merge_journal(kind, keeper_id);

-- Entity-type artifacts (C0 / v28). Every concrete imported file/blob (pdf, md,
-- txt, json, image…). A knowledge_capture can own many artifacts. Text is
-- extracted per registered entity type (artifact-types.ts), dedup by content_hash.
CREATE TABLE IF NOT EXISTS artifacts (
    id TEXT PRIMARY KEY,
    knowledge_capture_id TEXT,
    kind TEXT NOT NULL,
    mime TEXT,
    storage_path TEXT,
    size INTEGER,
    content_hash TEXT,
    extracted_text TEXT,
    metadata TEXT,
    source_connector_id TEXT,
    source_ref TEXT,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (knowledge_capture_id) REFERENCES knowledge_captures(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_artifacts_capture ON artifacts(knowledge_capture_id);
CREATE INDEX IF NOT EXISTS idx_artifacts_kind ON artifacts(kind);
CREATE INDEX IF NOT EXISTS idx_artifacts_content_hash ON artifacts(content_hash);

-- Per-turn speaker override (v37). Supersedes the label→contact default for ONE
-- transcript turn (identified by its zero-based turn_index within the rendered
-- turns). Lets a user correct a single turn without rewriting every turn that
-- shares the diarization label. See "Just this turn" in SpeakerAssignPopover.
CREATE TABLE IF NOT EXISTS turn_speaker_overrides (
    id TEXT PRIMARY KEY,
    recording_id TEXT NOT NULL,
    turn_index INTEGER NOT NULL,
    contact_id TEXT NOT NULL,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(recording_id, turn_index),
    FOREIGN KEY (recording_id) REFERENCES recordings(id) ON DELETE CASCADE,
    FOREIGN KEY (contact_id) REFERENCES contacts(id) ON DELETE CASCADE
);

-- Speaker splits (v37). Forks a diarization label into an independently
-- assignable derived label from a chosen turn onward. Fixes the merged-speaker
-- case (one label = two real people): split at the boundary, then assign each
-- half its own contact. from_turn_index is the first turn of the derived label;
-- derived_label (e.g. "Speaker 1 · B") becomes a first-class key in
-- transcript_speakers. Reversible by deleting the row ("merge back").
CREATE TABLE IF NOT EXISTS speaker_splits (
    id TEXT PRIMARY KEY,
    recording_id TEXT NOT NULL,
    base_label TEXT NOT NULL,
    from_turn_index INTEGER NOT NULL,
    derived_label TEXT NOT NULL,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(recording_id, base_label, from_turn_index),
    FOREIGN KEY (recording_id) REFERENCES recordings(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_turn_overrides_recording ON turn_speaker_overrides(recording_id);
CREATE INDEX IF NOT EXISTS idx_speaker_splits_recording ON speaker_splits(recording_id);

-- Deletion journal (v38): one row per source-delete action so a soft-delete is
-- restorable and every purge is auditable. recording_snapshot holds the full
-- recordings row (JSON) captured at delete time (used to restore a soft-delete).
-- removed_counts holds a JSON summary of derived rows removed (hard purge). A
-- hard purge is intentionally NOT restorable (privacy) — its journal row is an
-- audit trail only. restored_at is set when a soft-delete is undone.
CREATE TABLE IF NOT EXISTS deletion_journal (
    id TEXT PRIMARY KEY,
    recording_id TEXT NOT NULL,
    mode TEXT NOT NULL CHECK(mode IN ('soft', 'hard')),
    recording_snapshot TEXT,
    removed_counts TEXT,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    restored_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_recordings_personal ON recordings(personal);
CREATE INDEX IF NOT EXISTS idx_recordings_deleted_at ON recordings(deleted_at);
CREATE INDEX IF NOT EXISTS idx_deletion_journal_recording ON deletion_journal(recording_id);

`

// Migration functions for schema upgrades
const MIGRATIONS: Record<number, () => void> = {
  2: () => {
    // v2: Add contacts, projects, and junction tables
    // These are idempotent (CREATE TABLE IF NOT EXISTS), so safe to re-run
    console.log('Running migration to schema v2: Adding contacts and projects tables')
  },
  3: () => {
    // v3: Add recording-meeting candidates table for AI-powered matching
    console.log('Running migration to schema v3: Adding recording_meeting_candidates table')
    // The table is created in the schema, this just logs the migration
  },
  6: () => {
    // v6: Add recording lifecycle columns for unified recording management
    console.log('Running migration to schema v6: Adding recording lifecycle columns')
    const database = getDatabase()

    // Add new columns to recordings table if they don't exist
    // SQLite doesn't support IF NOT EXISTS for ALTER TABLE, so we use try-catch
    const columnsToAdd = [
      "ALTER TABLE recordings ADD COLUMN location TEXT DEFAULT 'device-only'",
      "ALTER TABLE recordings ADD COLUMN transcription_status TEXT DEFAULT 'none'",
      "ALTER TABLE recordings ADD COLUMN on_device INTEGER DEFAULT 1",
      "ALTER TABLE recordings ADD COLUMN device_last_seen TEXT",
      "ALTER TABLE recordings ADD COLUMN on_local INTEGER DEFAULT 0",
      "ALTER TABLE recordings ADD COLUMN source TEXT DEFAULT 'hidock'",
      "ALTER TABLE recordings ADD COLUMN is_imported INTEGER DEFAULT 0"
    ]

    for (const sql of columnsToAdd) {
      try {
        database.run(sql)
      } catch (e) {
        // Column likely already exists, ignore
        console.log(`Column may already exist: ${sql}`)
      }
    }

    // Update existing recordings: if they have a file_path, mark them as on_local
    try {
      database.run(`
        UPDATE recordings
        SET on_local = 1,
            location = CASE WHEN on_device = 1 THEN 'both' ELSE 'local-only' END
        WHERE file_path IS NOT NULL AND file_path != ''
      `)
    } catch (e) {
      console.warn('Failed to update existing recordings:', e)
    }

    console.log('Migration v6 complete: Recording lifecycle columns added')
  },
  7: () => {
    // v7: Recalculate durations for HDA files using correct formula (file_size / 4)
    // This fixes recordings that had incorrect duration calculated before
    console.log('Running migration to schema v7: Recalculating HDA file durations')
    const database = getDatabase()

    try {
      // Get all recordings with .hda extension and file_size available
      const recordings = database.exec(`
        SELECT id, filename, file_size, duration_seconds
        FROM recordings
        WHERE (filename LIKE '%.hda' OR filename LIKE '%.HDA')
        AND file_size IS NOT NULL
        AND file_size > 0
      `)

      if (recordings.length > 0 && recordings[0].values.length > 0) {
        let updatedCount = 0
        for (const row of recordings[0].values) {
          const [id, filename, fileSize, oldDuration] = row as [string, string, number, number | null]

          // Calculate correct duration: HDA version 1 format uses fileSize / 8000 seconds
          // This formula was verified against real recordings (e.g., 15.7MB = 32m39s)
          const newDuration = Math.round(fileSize / 8000)

          // Only update if different (or was null/0)
          if (oldDuration !== newDuration) {
            database.run(
              'UPDATE recordings SET duration_seconds = ? WHERE id = ?',
              [newDuration, id]
            )
            updatedCount++
            console.log(`[Migration v7] Updated ${filename}: ${oldDuration || 0}s -> ${newDuration}s`)
          }
        }
        console.log(`[Migration v7] Updated durations for ${updatedCount} recordings`)
      } else {
        console.log('[Migration v7] No HDA recordings found to update')
      }

      // Also update device_files_cache if present
      try {
        const cachedFiles = database.exec(`
          SELECT id, filename, file_size, duration_seconds
          FROM device_files_cache
          WHERE (filename LIKE '%.hda' OR filename LIKE '%.HDA')
          AND file_size IS NOT NULL
          AND file_size > 0
        `)

        if (cachedFiles.length > 0 && cachedFiles[0].values.length > 0) {
          for (const row of cachedFiles[0].values) {
            const [id, _filename, fileSize, oldDuration] = row as [string, string, number, number | null]
            const newDuration = Math.round(fileSize / 8000)

            if (oldDuration !== newDuration) {
              database.run(
                'UPDATE device_files_cache SET duration_seconds = ? WHERE id = ?',
                [newDuration, id]
              )
            }
          }
          console.log('[Migration v7] Updated device_files_cache durations')
        }
      } catch (e) {
        // device_files_cache may not exist
        console.log('[Migration v7] device_files_cache not found or empty')
      }
    } catch (e) {
      console.error('[Migration v7] Error recalculating durations:', e)
    }

    console.log('Migration v7 complete: HDA durations recalculated')
  },
  8: () => {
    // v8: Fix HDA duration calculation formula - v7 used /4 which was wrong, correct formula is /8000
    // This fixes recordings that got wrong duration from v7 migration
    console.log('Running migration to schema v8: Fixing HDA duration formula (v7 was wrong)')
    const database = getDatabase()

    try {
      // Get all recordings with .hda extension and file_size available
      const recordings = database.exec(`
        SELECT id, filename, file_size, duration_seconds
        FROM recordings
        WHERE (filename LIKE '%.hda' OR filename LIKE '%.HDA')
        AND file_size IS NOT NULL
        AND file_size > 0
      `)

      if (recordings.length > 0 && recordings[0].values.length > 0) {
        let updatedCount = 0
        for (const row of recordings[0].values) {
          const [id, filename, fileSize, oldDuration] = row as [string, string, number, number | null]

          // CORRECT formula: fileSize / 8000 gives seconds
          // Verified: 15.7MB file = 1959 seconds = 32m39s
          const newDuration = Math.round(fileSize / 8000)

          // Update if different
          if (oldDuration !== newDuration) {
            database.run(
              'UPDATE recordings SET duration_seconds = ? WHERE id = ?',
              [newDuration, id]
            )
            updatedCount++
            const oldMin = oldDuration ? Math.floor(oldDuration / 60) : 0
            const oldSec = oldDuration ? Math.round(oldDuration % 60) : 0
            const newMin = Math.floor(newDuration / 60)
            const newSec = Math.round(newDuration % 60)
            console.log(`[Migration v8] Fixed ${filename}: ${oldMin}m${oldSec}s -> ${newMin}m${newSec}s`)
          }
        }
        console.log(`[Migration v8] Fixed durations for ${updatedCount} recordings`)
      } else {
        console.log('[Migration v8] No HDA recordings found to fix')
      }

      // Also fix device_files_cache
      try {
        const cachedFiles = database.exec(`
          SELECT id, filename, file_size, duration_seconds
          FROM device_files_cache
          WHERE (filename LIKE '%.hda' OR filename LIKE '%.HDA')
          AND file_size IS NOT NULL
          AND file_size > 0
        `)

        if (cachedFiles.length > 0 && cachedFiles[0].values.length > 0) {
          for (const row of cachedFiles[0].values) {
            const [id, _filename, fileSize, oldDuration] = row as [string, string, number, number | null]
            const newDuration = Math.round(fileSize / 8000)

            if (oldDuration !== newDuration) {
              database.run(
                'UPDATE device_files_cache SET duration_seconds = ? WHERE id = ?',
                [newDuration, id]
              )
            }
          }
          console.log('[Migration v8] Fixed device_files_cache durations')
        }
      } catch (e) {
        console.log('[Migration v8] device_files_cache not found or empty')
      }
    } catch (e) {
      console.error('[Migration v8] Error fixing durations:', e)
    }

    console.log('Migration v8 complete: HDA durations fixed with correct formula')
  },
  9: () => {
    // v9: Force re-run HDA duration fix in case v8 didn't run due to version mismatch
    // This ensures all HDA files have correct durations using fileSize / 8000
    console.log('Running migration to schema v9: Ensuring HDA durations are correct')
    const database = getDatabase()

    try {
      // Get all HDA recordings
      const recordings = database.exec(`
        SELECT id, filename, file_size, duration_seconds
        FROM recordings
        WHERE (filename LIKE '%.hda' OR filename LIKE '%.HDA')
        AND file_size IS NOT NULL
        AND file_size > 0
      `)

      if (recordings.length > 0 && recordings[0].values.length > 0) {
        let updatedCount = 0
        for (const row of recordings[0].values) {
          const [id, filename, fileSize, oldDuration] = row as [string, string, number, number | null]

          // CORRECT formula: fileSize / 8000 gives seconds
          const newDuration = Math.round(fileSize / 8000)

          // Update if different or if the old duration seems wildly wrong (> 6 hours for any file)
          const needsUpdate = oldDuration !== newDuration || (oldDuration && oldDuration > 21600)

          if (needsUpdate) {
            database.run(
              'UPDATE recordings SET duration_seconds = ? WHERE id = ?',
              [newDuration, id]
            )
            updatedCount++
            const oldMin = oldDuration ? Math.floor(oldDuration / 60) : 0
            const oldSec = oldDuration ? Math.round(oldDuration % 60) : 0
            const newMin = Math.floor(newDuration / 60)
            const newSec = Math.round(newDuration % 60)
            console.log(`[Migration v9] Fixed ${filename}: ${oldMin}m${oldSec}s -> ${newMin}m${newSec}s`)
          }
        }
        console.log(`[Migration v9] Fixed durations for ${updatedCount} recordings`)
      } else {
        console.log('[Migration v9] No HDA recordings found')
      }

      // Also fix device_files_cache
      try {
        const cachedFiles = database.exec(`
          SELECT id, filename, file_size, duration_seconds
          FROM device_files_cache
          WHERE (filename LIKE '%.hda' OR filename LIKE '%.HDA')
          AND file_size IS NOT NULL
          AND file_size > 0
        `)

        if (cachedFiles.length > 0 && cachedFiles[0].values.length > 0) {
          for (const row of cachedFiles[0].values) {
            const [id, _filename, fileSize, oldDuration] = row as [string, string, number, number | null]
            const newDuration = Math.round(fileSize / 8000)
            const needsUpdate = oldDuration !== newDuration || (oldDuration && oldDuration > 21600)

            if (needsUpdate) {
              database.run(
                'UPDATE device_files_cache SET duration_seconds = ? WHERE id = ?',
                [newDuration, id]
              )
            }
          }
          console.log('[Migration v9] Fixed device_files_cache durations')
        }
      } catch (e) {
        console.log('[Migration v9] device_files_cache not found or empty')
      }
    } catch (e) {
      console.error('[Migration v9] Error fixing durations:', e)
    }

    console.log('Migration v9 complete: HDA durations verified/fixed')
  },
  10: () => {
    // v10: Add quality_assessments table and storage_tier column for Phase 0 architecture
    console.log('Running migration to schema v10: Adding quality assessment and storage policy support')
    const database = getDatabase()

    // Add storage_tier column to recordings table if it doesn't exist
    try {
      database.run(`
        ALTER TABLE recordings
        ADD COLUMN storage_tier TEXT DEFAULT NULL
        CHECK(storage_tier IN (NULL, 'hot', 'warm', 'cold', 'archive'))
      `)
      console.log('[Migration v10] Added storage_tier column to recordings')
    } catch (e) {
      // Column likely already exists
      console.log('[Migration v10] storage_tier column may already exist')
    }

    // Create index on storage_tier (must be done after column exists)
    try {
      database.run('CREATE INDEX IF NOT EXISTS idx_recordings_storage_tier ON recordings(storage_tier)')
      console.log('[Migration v10] Created storage_tier index')
    } catch (e) {
      console.log('[Migration v10] storage_tier index may already exist')
    }

    // quality_assessments table is created in the schema, this just logs the migration
    console.log('[Migration v10] quality_assessments table added to schema')
    console.log('Migration v10 complete: Quality assessment and storage policy tables created')
  },
  11: () => {
    // v11: Knowledge Captures architecture
    console.log('Running migration to schema v11: Knowledge Captures architecture')
    const database = getDatabase()

    try {
      // 1. Check if recordings table needs migration columns (v11)
      const recordingsInfo = database.exec("PRAGMA table_info(recordings)")
      const hasMigrationStatus = recordingsInfo[0].values.some(col => col[1] === 'migration_status')

      if (!hasMigrationStatus) {
        console.log('[Migration v11] Migration columns not found in recordings, adding them...')
        const columnsToAdd = [
          "ALTER TABLE recordings ADD COLUMN migrated_to_capture_id TEXT",
          "ALTER TABLE recordings ADD COLUMN migration_status TEXT CHECK(migration_status IN ('pending', 'migrated', 'skipped', 'error')) DEFAULT 'pending'",
          "ALTER TABLE recordings ADD COLUMN migrated_at TEXT"
        ]
        for (const sql of columnsToAdd) {
          try { database.run(sql) } catch (e) { /* ignore duplicate */ }
        }
      }

      // 2. Check if knowledge_captures table exists and has all columns
      const tableCheck = database.exec("SELECT name FROM sqlite_master WHERE type='table' AND name='knowledge_captures'")
      const tableExists = tableCheck.length > 0 && tableCheck[0].values.length > 0

      if (!tableExists) {
        console.log('[Migration v11] knowledge_captures table not found, executing full schema script...')
        const schemaPath = join(__dirname, 'migrations/v11-knowledge-captures.sql')
        if (existsSync(schemaPath)) {
          const schemaSQL = readFileSync(schemaPath, 'utf-8')
          const statements = schemaSQL.split('\n').filter(line => !line.trim().startsWith('--')).join('\n').split(';').map(s => s.trim()).filter(s => s.length > 0)
          for (const sql of statements) {
            try { database.run(sql) } catch (e) { /* ignore existing */ }
          }
        }
      } else {
        // Table exists, check for ALL columns added during redesign
        const captureInfo = database.exec("PRAGMA table_info(knowledge_captures)")
        const existingCols = captureInfo[0].values.map(col => col[1])
        
        const requiredColumns = [
          { name: 'category', def: "category TEXT CHECK(category IN ('meeting', 'interview', '1:1', 'brainstorm', 'note', 'other')) DEFAULT 'meeting'" },
          { name: 'status', def: "status TEXT CHECK(status IN ('processing', 'ready', 'enriched')) DEFAULT 'ready'" },
          { name: 'quality_rating', def: "quality_rating TEXT CHECK(quality_rating IN ('valuable', 'archived', 'low-value', 'garbage', 'unrated')) DEFAULT 'unrated'" },
          { name: 'quality_confidence', def: "quality_confidence REAL" },
          { name: 'quality_assessed_at', def: "quality_assessed_at TEXT" },
          { name: 'storage_tier', def: "storage_tier TEXT CHECK(storage_tier IN ('hot', 'cold', 'expiring', 'deleted')) DEFAULT 'hot'" },
          { name: 'retention_days', def: "retention_days INTEGER" },
          { name: 'expires_at', def: "expires_at TEXT" },
          { name: 'meeting_id', def: "meeting_id TEXT REFERENCES meetings(id)" },
          { name: 'correlation_confidence', def: "correlation_confidence REAL" },
          { name: 'correlation_method', def: "correlation_method TEXT" },
          { name: 'source_recording_id', def: "source_recording_id TEXT REFERENCES recordings(id)" }
        ]

        for (const col of requiredColumns) {
          if (!existingCols.includes(col.name)) {
            console.log(`[Migration v11] Adding missing column ${col.name} to knowledge_captures`)
            try {
              database.run(`ALTER TABLE knowledge_captures ADD COLUMN ${col.def}`)
            } catch (e) {
              console.warn(`[Migration v11] Could not add column ${col.name}: ${e}`)
            }
          }
        }
      }

      // 3. Ensure all v11 indexes exist
      const indexes = [
        "CREATE INDEX IF NOT EXISTS idx_knowledge_captures_status ON knowledge_captures(status)",
        "CREATE INDEX IF NOT EXISTS idx_knowledge_captures_category ON knowledge_captures(category)",
        "CREATE INDEX IF NOT EXISTS idx_actionables_source_knowledge ON actionables(source_knowledge_id)",
        "CREATE INDEX IF NOT EXISTS idx_actionables_status ON actionables(status)"
      ]
      for (const sql of indexes) {
        try { database.run(sql) } catch (e) { console.warn(`Index warning: ${e}`) }
      }

    } catch (error) {
      console.error('[Migration v11] Error during schema upgrade:', error)
    }

    console.log('Migration v11 complete: Schema version updated to v11')
  },
  12: () => {
    // v12: Conversation History & Context
    console.log('Running migration to schema v12: Adding conversations and conversation_context tables')
    const database = getDatabase()

    // Add conversation_id column to chat_messages if it doesn't exist
    try {
      database.run('ALTER TABLE chat_messages ADD COLUMN conversation_id TEXT REFERENCES conversations(id) ON DELETE CASCADE')
      console.log('[Migration v12] Added conversation_id column to chat_messages')
    } catch (e) {
      console.log('[Migration v12] conversation_id column may already exist')
    }

    // conversation_context and conversations tables are handled by CREATE TABLE IF NOT EXISTS in SCHEMA
    console.log('Migration v12 complete: Conversation tables and columns created')
  },
  13: () => {
    // v13: Enhanced People Entity
    console.log('Running migration to schema v13: Adding fields to contacts table')
    const database = getDatabase()

    const columnsToAdd = [
      "ALTER TABLE contacts ADD COLUMN type TEXT CHECK(type IN ('team', 'candidate', 'customer', 'external', 'unknown')) DEFAULT 'unknown'",
      "ALTER TABLE contacts ADD COLUMN role TEXT",
      "ALTER TABLE contacts ADD COLUMN company TEXT",
      "ALTER TABLE contacts ADD COLUMN tags TEXT"
    ]

    for (const sql of columnsToAdd) {
      try {
        database.run(sql)
      } catch (e) {
        console.log(`Column may already exist: ${sql}`)
      }
    }
    console.log('Migration v13 complete: Contacts table enhanced')
  },
  14: () => {
    // v14: Project Status
    console.log('Running migration to schema v14: Adding status to projects table')
    const database = getDatabase()

    try {
      database.run("ALTER TABLE projects ADD COLUMN status TEXT CHECK(status IN ('active', 'archived')) DEFAULT 'active'")
      console.log('[Migration v14] Added status column to projects')
    } catch (e) {
      console.log('[Migration v14] status column may already exist')
    }
    console.log('Migration v14 complete: Projects table enhanced')
  },
  15: () => {
    // v15: Actionables table handled by SCHEMA CREATE TABLE IF NOT EXISTS
    console.log('Running migration to schema v15: Actionables architecture')
    console.log('Migration v15 complete: Actionables table created')
  },
  16: () => {
    // v16: Add title_suggestion and question_suggestions to transcripts table
    console.log('Running migration to schema v16: Adding AI-generated title and question suggestions to transcripts')
    const database = getDatabase()

    const columnsToAdd = [
      "ALTER TABLE transcripts ADD COLUMN title_suggestion TEXT",
      "ALTER TABLE transcripts ADD COLUMN question_suggestions TEXT"
    ]

    for (const sql of columnsToAdd) {
      try {
        database.run(sql)
      } catch (e) {
        // Column likely already exists, ignore
        console.log(`Column may already exist: ${sql}`)
      }
    }

    console.log('Migration v16 complete: AI title and question suggestions added to transcripts')
  },
  17: () => {
    // v17: Add confidence column to actionables table for AI detection confidence scoring
    console.log('Running migration to schema v17: Adding confidence column to actionables')
    const database = getDatabase()

    // Check if confidence column already exists
    const tableInfo = database.exec('PRAGMA table_info(actionables)')
    if (tableInfo.length > 0 && tableInfo[0].values) {
      const columns = tableInfo[0].values.map((row: any) => row[1])
      if (!columns.includes('confidence')) {
        try {
          database.run('ALTER TABLE actionables ADD COLUMN confidence REAL CHECK(confidence >= 0.0 AND confidence <= 1.0)')
          console.log('[Migration v17] Added confidence column to actionables table')
        } catch (e) {
          console.warn('[Migration v17] Failed to add confidence column:', e)
        }
      } else {
        console.log('[Migration v17] Confidence column already exists, skipping')
      }
    }

    console.log('Migration v17 complete: Confidence column added to actionables')
  },
  18: () => {
    // v18: AI-15 — Add missing columns to chat_messages referenced by assistant mapper
    console.log('Running migration to schema v18: Adding missing chat_messages columns')
    const database = getDatabase()

    const tableInfo = database.exec('PRAGMA table_info(chat_messages)')
    if (tableInfo.length > 0 && tableInfo[0].values) {
      const columns = tableInfo[0].values.map((row: any) => row[1])

      const columnsToAdd = [
        { name: 'edited_at', sql: 'ALTER TABLE chat_messages ADD COLUMN edited_at TEXT' },
        { name: 'original_content', sql: 'ALTER TABLE chat_messages ADD COLUMN original_content TEXT' },
        { name: 'created_output_id', sql: 'ALTER TABLE chat_messages ADD COLUMN created_output_id TEXT' },
        { name: 'saved_as_insight_id', sql: 'ALTER TABLE chat_messages ADD COLUMN saved_as_insight_id TEXT' }
      ]

      for (const col of columnsToAdd) {
        if (!columns.includes(col.name)) {
          try {
            database.run(col.sql)
            console.log(`[Migration v18] Added ${col.name} column to chat_messages`)
          } catch (e) {
            console.warn(`[Migration v18] Failed to add ${col.name}:`, e)
          }
        }
      }
    }

    console.log('Migration v18 complete: chat_messages columns added')
  },
  19: () => {
    // v19: spec-005 — Add transcription service mutex lock table for atomic process ID tracking
    console.log('Running migration to schema v19: Adding transcription_service_lock table')
    const database = getDatabase()

    try {
      // Create the lock table
      database.run(`
        CREATE TABLE IF NOT EXISTS transcription_service_lock (
          id INTEGER PRIMARY KEY CHECK (id = 1),
          process_id TEXT,
          acquired_at TEXT,
          updated_at TEXT
        )
      `)

      // Initialize with a single row (process_id = NULL means unlocked)
      database.run(`
        INSERT OR IGNORE INTO transcription_service_lock (id, process_id, acquired_at, updated_at)
        VALUES (1, NULL, NULL, NULL)
      `)

      console.log('[Migration v19] transcription_service_lock table created')
    } catch (e) {
      console.warn('[Migration v19] Failed to create transcription_service_lock table:', e)
    }

    console.log('Migration v19 complete: Transcription service mutex lock added')
  },
  20: () => {
    // v20: Phase A consolidated fixes (spec-013, spec-010, spec-014, spec-007)
    console.log('Running migration to schema v20: Phase A consolidated fixes')
    const database = getDatabase()

    // 1. spec-013: Remove UNIQUE constraint on contacts.email (allows multiple NULL)
    console.log('[Migration v20] Removing UNIQUE constraint on contacts.email')
    try {
      // Check if the UNIQUE constraint exists by checking the CREATE TABLE sql
      const tableInfo = database.exec("SELECT sql FROM sqlite_master WHERE type='table' AND name='contacts'")
      const createSql = tableInfo.length > 0 && tableInfo[0].values.length > 0
        ? (tableInfo[0].values[0][0] as string)
        : ''

      if (createSql.includes('UNIQUE')) {
        // SQLite requires table recreation to remove constraints
        database.run(`
          CREATE TABLE contacts_new (
            id TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            email TEXT,
            type TEXT CHECK(type IN ('team', 'candidate', 'customer', 'external', 'unknown')) DEFAULT 'unknown',
            role TEXT,
            company TEXT,
            notes TEXT,
            tags TEXT,
            first_seen_at TEXT NOT NULL,
            last_seen_at TEXT NOT NULL,
            meeting_count INTEGER DEFAULT 0,
            created_at TEXT DEFAULT CURRENT_TIMESTAMP
          )
        `)
        database.run('INSERT INTO contacts_new SELECT * FROM contacts')
        database.run('DROP TABLE contacts')
        database.run('ALTER TABLE contacts_new RENAME TO contacts')
        console.log('[Migration v20] contacts.email UNIQUE constraint removed')
      } else {
        console.log('[Migration v20] contacts.email UNIQUE constraint already absent')
      }
    } catch (e) {
      console.warn('[Migration v20] Contacts email constraint fix failed:', e)
    }

    // 2. spec-010: Add search indexes for knowledge table
    console.log('[Migration v20] Adding search indexes')
    try {
      database.run('CREATE INDEX IF NOT EXISTS idx_knowledge_title ON knowledge_captures(title)')
      database.run('CREATE INDEX IF NOT EXISTS idx_knowledge_summary ON knowledge_captures(summary)')
      console.log('[Migration v20] Search indexes created')
    } catch (e) {
      console.warn('[Migration v20] Search index creation failed:', e)
    }

    // 3. spec-014: Add transcription queue progress columns
    console.log('[Migration v20] Adding transcription queue columns')
    const tqTableInfo = database.exec('PRAGMA table_info(transcription_queue)')
    if (tqTableInfo.length > 0 && tqTableInfo[0].values) {
      const tqColumns = tqTableInfo[0].values.map((row: any) => row[1])

      if (!tqColumns.includes('retry_count')) {
        try {
          database.run('ALTER TABLE transcription_queue ADD COLUMN retry_count INTEGER DEFAULT 0')
          console.log('[Migration v20] Added retry_count column')
        } catch (e) {
          console.warn('[Migration v20] Failed to add retry_count:', e)
        }
      }

      if (!tqColumns.includes('progress')) {
        try {
          database.run('ALTER TABLE transcription_queue ADD COLUMN progress INTEGER DEFAULT 0')
          console.log('[Migration v20] Added progress column')
        } catch (e) {
          console.warn('[Migration v20] Failed to add progress:', e)
        }
      }
    }

    // 4. spec-007: Add download_queue table
    console.log('[Migration v20] Creating download_queue table')
    try {
      database.run(`
        CREATE TABLE IF NOT EXISTS download_queue (
          id TEXT PRIMARY KEY,
          filename TEXT NOT NULL UNIQUE,
          file_size INTEGER NOT NULL,
          progress INTEGER DEFAULT 0,
          status TEXT DEFAULT 'pending' CHECK(status IN ('pending', 'downloading', 'completed', 'failed')),
          error TEXT,
          started_at TEXT,
          completed_at TEXT,
          recording_date TEXT,
          created_at TEXT DEFAULT CURRENT_TIMESTAMP
        )
      `)
      console.log('[Migration v20] download_queue table created')
    } catch (e) {
      console.warn('[Migration v20] download_queue table creation failed:', e)
    }

    console.log('Migration v20 complete: Phase A consolidated fixes applied')
  },
  21: () => {
    // v21: AUD2-001 — Backfill meeting_id in knowledge_captures from recordings
    console.log('Running migration to schema v21: Backfilling meeting_id in knowledge_captures')
    const database = getDatabase()

    try {
      // Update knowledge_captures to inherit meeting_id from their source recordings
      const sql = `
        UPDATE knowledge_captures
        SET meeting_id = (
          SELECT r.meeting_id
          FROM recordings r
          WHERE r.id = knowledge_captures.source_recording_id
          AND r.meeting_id IS NOT NULL
        ),
        correlation_method = COALESCE(correlation_method, 'recording_migration'),
        correlation_confidence = COALESCE(correlation_confidence, 1.0),
        updated_at = CURRENT_TIMESTAMP
        WHERE meeting_id IS NULL
          AND source_recording_id IS NOT NULL
          AND EXISTS (
            SELECT 1 FROM recordings r
            WHERE r.id = knowledge_captures.source_recording_id
            AND r.meeting_id IS NOT NULL
          )
      `
      database.run(sql)

      // Log how many were updated
      const updated = database.exec(`
        SELECT COUNT(*) as count
        FROM knowledge_captures
        WHERE meeting_id IS NOT NULL
          AND correlation_method = 'recording_migration'
      `)
      const count = updated.length > 0 && updated[0].values.length > 0 ? updated[0].values[0][0] : 0
      console.log(`[Migration v21] Backfilled meeting_id for ${count} knowledge captures`)
    } catch (e) {
      console.warn('[Migration v21] Failed to backfill meeting_id:', e)
    }

    console.log('Migration v21 complete: meeting_id backfill applied')
  },

  22: () => {
    // v22: SPEC-002 — Convert legacy rec_ IDs to standard UUIDs
    // recording-watcher used to generate IDs like "rec_1700000000000" which fail
    // Zod UUID validation and cause data fragmentation.
    console.log('Running migration to schema v22: Converting legacy rec_ IDs to UUIDs')
    const database = getDatabase()

    try {
      const legacyRows = database.exec("SELECT id FROM recordings WHERE id LIKE 'rec_%'")
      if (legacyRows.length === 0 || legacyRows[0].values.length === 0) {
        console.log('[Migration v22] No legacy rec_ IDs found — nothing to migrate')
        return
      }

      const legacyIds = legacyRows[0].values.map(row => row[0] as string)
      console.log(`[Migration v22] Found ${legacyIds.length} legacy rec_ IDs to migrate`)

      let migratedCount = 0
      for (const oldId of legacyIds) {
        const newId = randomUUID()

        // Update foreign keys first (transcription_queue, transcriptions, etc.)
        database.run('UPDATE transcription_queue SET recording_id = ? WHERE recording_id = ?', [newId, oldId])
        database.run('UPDATE transcripts SET recording_id = ? WHERE recording_id = ?', [newId, oldId])
        database.run('UPDATE vector_embeddings SET transcript_id = ? WHERE transcript_id = ?', [newId, oldId])
        database.run('UPDATE recording_meeting_candidates SET recording_id = ? WHERE recording_id = ?', [newId, oldId])

        // SQLite doesn't allow updating a PRIMARY KEY directly — use INSERT + DELETE
        const recRows = database.exec('SELECT * FROM recordings WHERE id = ?', [oldId])
        if (recRows.length > 0 && recRows[0].values.length > 0) {
          const columns = recRows[0].columns
          const values = [...recRows[0].values[0]]
          const idIndex = columns.indexOf('id')
          if (idIndex !== -1) {
            values[idIndex] = newId
          }
          const placeholders = columns.map(() => '?').join(', ')
          const columnList = columns.join(', ')
          database.run(`INSERT INTO recordings (${columnList}) VALUES (${placeholders})`, values)
          database.run('DELETE FROM recordings WHERE id = ?', [oldId])
          migratedCount++
        }
      }

      console.log(`[Migration v22] Migrated ${migratedCount} recordings from rec_ to UUID format`)
    } catch (e) {
      console.warn('[Migration v22] Failed to migrate legacy rec_ IDs:', e)
    }

    console.log('Migration v22 complete: legacy rec_ ID conversion applied')
  },

  23: () => {
    // v23: Fix for v22 which crashed on non-existent vector_embeddings table.
    // Re-run rec_ → UUID migration with correct table references.
    console.log('Running migration to schema v23: Re-running rec_ ID migration with corrected tables')
    const database = getDatabase()

    try {
      const legacyRows = database.exec("SELECT id FROM recordings WHERE id LIKE 'rec_%'")
      if (legacyRows.length === 0 || legacyRows[0].values.length === 0) {
        console.log('[Migration v23] No legacy rec_ IDs found — v22 may have partially succeeded or none existed')
        return
      }

      const legacyIds = legacyRows[0].values.map(row => row[0] as string)
      console.log(`[Migration v23] Found ${legacyIds.length} legacy rec_ IDs to migrate`)

      let migratedCount = 0
      for (const oldId of legacyIds) {
        const newId = randomUUID()

        database.run('UPDATE transcription_queue SET recording_id = ? WHERE recording_id = ?', [newId, oldId])
        database.run('UPDATE transcripts SET recording_id = ? WHERE recording_id = ?', [newId, oldId])
        database.run('UPDATE recording_meeting_candidates SET recording_id = ? WHERE recording_id = ?', [newId, oldId])
        database.run('UPDATE quality_assessments SET recording_id = ? WHERE recording_id = ?', [newId, oldId])
        database.run('UPDATE knowledge_captures SET source_recording_id = ? WHERE source_recording_id = ?', [newId, oldId])

        const recRows = database.exec('SELECT * FROM recordings WHERE id = ?', [oldId])
        if (recRows.length > 0 && recRows[0].values.length > 0) {
          const columns = recRows[0].columns
          const values = [...recRows[0].values[0]]
          const idIndex = columns.indexOf('id')
          if (idIndex !== -1) {
            values[idIndex] = newId
          }
          const placeholders = columns.map(() => '?').join(', ')
          const columnList = columns.join(', ')
          database.run(`INSERT INTO recordings (${columnList}) VALUES (${placeholders})`, values)
          database.run('DELETE FROM recordings WHERE id = ?', [oldId])
          migratedCount++
        }
      }

      console.log(`[Migration v23] Migrated ${migratedCount} recordings from rec_ to UUID format`)
    } catch (e) {
      console.error('[Migration v23] FAILED to migrate legacy rec_ IDs:', e)
    }
  },

  24: () => {
    console.log('Running migration to schema v24: Add cancelled status to download_queue CHECK constraint')
    const database = getDatabase()

    try {
      // SQLite cannot ALTER CHECK constraints -- must recreate the table
      // Check if migration is needed (idempotent)
      const tableInfoResult = database.exec("SELECT sql FROM sqlite_master WHERE type='table' AND name='download_queue'")
      if (tableInfoResult.length > 0 && tableInfoResult[0].values.length > 0) {
        const createSql = String(tableInfoResult[0].values[0][0])
        if (createSql.includes("'cancelled'")) {
          console.log('[Migration v24] download_queue already has cancelled status, skipping')
          return
        }
      }

      database.run(`
        CREATE TABLE IF NOT EXISTS download_queue_new (
          id TEXT PRIMARY KEY,
          filename TEXT NOT NULL UNIQUE,
          file_size INTEGER NOT NULL,
          progress INTEGER DEFAULT 0,
          status TEXT DEFAULT 'pending' CHECK(status IN ('pending', 'downloading', 'completed', 'failed', 'cancelled')),
          error TEXT,
          started_at TEXT,
          completed_at TEXT,
          recording_date TEXT,
          created_at TEXT DEFAULT CURRENT_TIMESTAMP
        )
      `)

      // Copy existing data
      database.run(`
        INSERT OR IGNORE INTO download_queue_new
        SELECT id, filename, file_size, progress, status, error, started_at, completed_at, recording_date, created_at
        FROM download_queue
      `)

      database.run('DROP TABLE IF EXISTS download_queue')
      database.run('ALTER TABLE download_queue_new RENAME TO download_queue')

      console.log('Migration v24 complete: download_queue CHECK constraint updated')
    } catch (e) {
      console.warn('[Migration v24] Failed:', e)
    }
  },

  25: () => {
    // v25: Add transcript_speakers — binds a transcript speaker label to a
    // canonical contact per recording. Idempotent (CREATE TABLE IF NOT EXISTS).
    console.log('Running migration to schema v25: Adding transcript_speakers table')
    const database = getDatabase()

    try {
      database.run(`
        CREATE TABLE IF NOT EXISTS transcript_speakers (
          id TEXT PRIMARY KEY,
          recording_id TEXT NOT NULL,
          speaker_label TEXT NOT NULL,
          contact_id TEXT NOT NULL,
          created_at TEXT DEFAULT CURRENT_TIMESTAMP,
          UNIQUE(recording_id, speaker_label),
          FOREIGN KEY (recording_id) REFERENCES recordings(id) ON DELETE CASCADE,
          FOREIGN KEY (contact_id) REFERENCES contacts(id) ON DELETE CASCADE
        )
      `)
      database.run('CREATE INDEX IF NOT EXISTS idx_transcript_speakers_recording ON transcript_speakers(recording_id)')
      console.log('Migration v25 complete: transcript_speakers table ready')
    } catch (e) {
      console.warn('[Migration v25] Failed:', e)
    }
  },

  26: () => {
    // v26: Deep editability backend.
    //  - knowledge_projects junction: DIRECT project assignment for knowledge
    //    captures / recordings that have no meeting.
    //  - action_items.assignee_contact_id: canonical contact link for assignees.
    // Idempotent: CREATE TABLE IF NOT EXISTS + guarded ALTER.
    console.log('Running migration to schema v26: knowledge_projects + action_items.assignee_contact_id')
    const database = getDatabase()

    try {
      database.run(`
        CREATE TABLE IF NOT EXISTS knowledge_projects (
          knowledge_capture_id TEXT NOT NULL,
          project_id TEXT NOT NULL,
          created_at TEXT DEFAULT CURRENT_TIMESTAMP,
          PRIMARY KEY (knowledge_capture_id, project_id),
          FOREIGN KEY (knowledge_capture_id) REFERENCES knowledge_captures(id) ON DELETE CASCADE,
          FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
        )
      `)
      database.run('CREATE INDEX IF NOT EXISTS idx_knowledge_projects_knowledge ON knowledge_projects(knowledge_capture_id)')
      database.run('CREATE INDEX IF NOT EXISTS idx_knowledge_projects_project ON knowledge_projects(project_id)')
    } catch (e) {
      console.warn('[Migration v26] knowledge_projects failed:', e)
    }

    try {
      const info = database.exec('PRAGMA table_info(action_items)')
      if (info.length > 0 && info[0].values) {
        const cols = info[0].values.map((row: unknown[]) => row[1])
        if (!cols.includes('assignee_contact_id')) {
          database.run('ALTER TABLE action_items ADD COLUMN assignee_contact_id TEXT')
        }
      }
    } catch (e) {
      console.warn('[Migration v26] action_items.assignee_contact_id failed:', e)
    }

    console.log('Migration v26 complete')
  },

  27: () => {
    // v27: Alias memory + identity suggestion queue (Round 4a).
    //  - contact_aliases / project_aliases: permanent normalized-name → entity
    //    aliases with a source + confidence (a 'rejected' row blocks a pairing).
    //  - identity_suggestions: the 0.5–0.8 resolver band as reviewable cards.
    // Idempotent: CREATE TABLE IF NOT EXISTS.
    console.log('Running migration to schema v27: alias memory + identity suggestions')
    const database = getDatabase()

    try {
      database.run(`
        CREATE TABLE IF NOT EXISTS contact_aliases (
          id TEXT PRIMARY KEY,
          alias_norm TEXT NOT NULL UNIQUE,
          contact_id TEXT NOT NULL,
          source TEXT CHECK(source IN ('merge', 'speaker_assign', 'manual', 'inferred', 'rejected')),
          confidence REAL,
          created_at TEXT DEFAULT CURRENT_TIMESTAMP,
          FOREIGN KEY (contact_id) REFERENCES contacts(id) ON DELETE CASCADE
        )
      `)
      database.run(`
        CREATE TABLE IF NOT EXISTS project_aliases (
          id TEXT PRIMARY KEY,
          alias_norm TEXT NOT NULL UNIQUE,
          project_id TEXT NOT NULL,
          source TEXT CHECK(source IN ('merge', 'speaker_assign', 'manual', 'inferred', 'rejected')),
          confidence REAL,
          created_at TEXT DEFAULT CURRENT_TIMESTAMP,
          FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
        )
      `)
      database.run(`
        CREATE TABLE IF NOT EXISTS identity_suggestions (
          id TEXT PRIMARY KEY,
          kind TEXT CHECK(kind IN ('person', 'project')),
          candidate_name TEXT,
          target_id TEXT,
          confidence REAL,
          evidence TEXT,
          status TEXT CHECK(status IN ('pending', 'accepted', 'rejected')) DEFAULT 'pending',
          created_at TEXT DEFAULT CURRENT_TIMESTAMP,
          UNIQUE(kind, candidate_name, target_id)
        )
      `)
      database.run('CREATE INDEX IF NOT EXISTS idx_contact_aliases_contact ON contact_aliases(contact_id)')
      database.run('CREATE INDEX IF NOT EXISTS idx_project_aliases_project ON project_aliases(project_id)')
      database.run('CREATE INDEX IF NOT EXISTS idx_identity_suggestions_status ON identity_suggestions(status)')
    } catch (e) {
      console.warn('[Migration v27] Failed:', e)
    }

    console.log('Migration v27 complete')
  },
  28: () => {
    // v28: Entity-type foundation (C0). `artifacts` table holds every concrete
    // imported file/blob keyed to a knowledge_capture. Idempotent: CREATE TABLE
    // IF NOT EXISTS + guarded indexes.
    console.log('Running migration to schema v28: artifacts (entity-type foundation)')
    const database = getDatabase()

    try {
      database.run(`
        CREATE TABLE IF NOT EXISTS artifacts (
          id TEXT PRIMARY KEY,
          knowledge_capture_id TEXT,
          kind TEXT NOT NULL,
          mime TEXT,
          storage_path TEXT,
          size INTEGER,
          content_hash TEXT,
          extracted_text TEXT,
          metadata TEXT,
          source_connector_id TEXT,
          source_ref TEXT,
          created_at TEXT DEFAULT CURRENT_TIMESTAMP,
          FOREIGN KEY (knowledge_capture_id) REFERENCES knowledge_captures(id) ON DELETE CASCADE
        )
      `)
      database.run('CREATE INDEX IF NOT EXISTS idx_artifacts_capture ON artifacts(knowledge_capture_id)')
      database.run('CREATE INDEX IF NOT EXISTS idx_artifacts_kind ON artifacts(kind)')
      database.run('CREATE INDEX IF NOT EXISTS idx_artifacts_content_hash ON artifacts(content_hash)')
    } catch (e) {
      console.warn('[Migration v28] Failed:', e)
    }

    console.log('Migration v28 complete')
  },
  29: () => {
    // v29: Projects as full hubs.
    //  - projects.folder_path / projects.url: bind a project to a location on
    //    disk and a webpage.
    //  - project_notes: issues / risks / notes tracked against a project.
    // Idempotent: guarded ALTER + CREATE TABLE IF NOT EXISTS.
    console.log('Running migration to schema v29: project folder_path/url + project_notes')
    const database = getDatabase()

    try {
      const info = database.exec('PRAGMA table_info(projects)')
      if (info.length > 0 && info[0].values) {
        const cols = info[0].values.map((row: unknown[]) => row[1])
        if (!cols.includes('folder_path')) {
          database.run('ALTER TABLE projects ADD COLUMN folder_path TEXT')
        }
        if (!cols.includes('url')) {
          database.run('ALTER TABLE projects ADD COLUMN url TEXT')
        }
      }
    } catch (e) {
      console.warn('[Migration v29] projects folder_path/url failed:', e)
    }

    try {
      database.run(`
        CREATE TABLE IF NOT EXISTS project_notes (
          id TEXT PRIMARY KEY,
          project_id TEXT NOT NULL,
          kind TEXT CHECK(kind IN ('issue', 'risk', 'note')),
          content TEXT NOT NULL,
          status TEXT CHECK(status IN ('open', 'resolved')) DEFAULT 'open',
          created_at TEXT DEFAULT CURRENT_TIMESTAMP,
          resolved_at TEXT,
          FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
        )
      `)
      database.run('CREATE INDEX IF NOT EXISTS idx_project_notes_project_kind ON project_notes(project_id, kind)')
    } catch (e) {
      console.warn('[Migration v29] project_notes failed:', e)
    }

    console.log('Migration v29 complete')
  },

  30: () => {
    // v30: Merge safety & reversibility. merge_journal records every executed
    // contact/project merge so it can be unmerged. Idempotent CREATE + index.
    console.log('Running migration to schema v30: merge_journal (merge reversibility)')
    const database = getDatabase()
    try {
      database.run(`
        CREATE TABLE IF NOT EXISTS merge_journal (
          id TEXT PRIMARY KEY,
          kind TEXT NOT NULL CHECK(kind IN ('contact', 'project')),
          keeper_id TEXT NOT NULL,
          loser_snapshot TEXT NOT NULL,
          repointed_manifest TEXT NOT NULL,
          folded_fields TEXT,
          created_at TEXT DEFAULT CURRENT_TIMESTAMP,
          undone_at TEXT
        )
      `)
      database.run('CREATE INDEX IF NOT EXISTS idx_merge_journal_kind_keeper ON merge_journal(kind, keeper_id)')
    } catch (e) {
      console.warn('[Migration v30] merge_journal failed:', e)
    }
    console.log('Migration v30 complete')
  },

  31: () => {
    // v31: recording_preassignments — the user's in-advance attribution choice for
    // the recording the device is currently capturing (see schema comment).
    console.log('Running migration to schema v31: recording_preassignments')
    const database = getDatabase()
    try {
      database.run(`
        CREATE TABLE IF NOT EXISTS recording_preassignments (
          filename TEXT PRIMARY KEY,
          meeting_id TEXT,
          created_at TEXT DEFAULT CURRENT_TIMESTAMP,
          FOREIGN KEY (meeting_id) REFERENCES meetings(id) ON DELETE CASCADE
        )
      `)
    } catch (e) {
      console.warn('[Migration v31] recording_preassignments failed:', e)
    }
    console.log('Migration v31 complete')
  },

  32: () => {
    // v32: all-day / holiday events. is_all_day flags a calendar-DATE event;
    // all_day_date is its timezone-independent named day (YYYY-MM-DD) so the UI
    // matches by local calendar date rather than the stored UTC instant.
    console.log('Running migration to schema v32: meetings.is_all_day + all_day_date')
    const database = getDatabase()
    const info = database.exec('PRAGMA table_info(meetings)')
    if (info.length > 0 && info[0].values) {
      const columns = info[0].values.map((row: any) => row[1])
      if (!columns.includes('is_all_day')) {
        try {
          database.run('ALTER TABLE meetings ADD COLUMN is_all_day INTEGER DEFAULT 0')
        } catch (e) {
          console.warn('[Migration v32] add is_all_day failed:', e)
        }
      }
      if (!columns.includes('all_day_date')) {
        try {
          database.run('ALTER TABLE meetings ADD COLUMN all_day_date TEXT')
        } catch (e) {
          console.warn('[Migration v32] add all_day_date failed:', e)
        }
      }
    }
    console.log('Migration v32 complete')
  },

  // v33 reserved (connectors), v34 reserved (transcript-triage) — see other agents.

  35: () => {
    // v35: mention_resolutions — per-recording assignment of an ambiguous bucket
    // name (bare first name matching several distinct people) to the real contact.
    console.log('Running migration to schema v35: mention_resolutions')
    const database = getDatabase()
    try {
      database.run(`
        CREATE TABLE IF NOT EXISTS mention_resolutions (
          id TEXT PRIMARY KEY,
          recording_id TEXT NOT NULL,
          source_name TEXT NOT NULL,
          resolved_contact_id TEXT,
          method TEXT,
          confidence REAL,
          created_at TEXT DEFAULT CURRENT_TIMESTAMP,
          UNIQUE(recording_id, source_name),
          FOREIGN KEY (recording_id) REFERENCES recordings(id) ON DELETE CASCADE,
          FOREIGN KEY (resolved_contact_id) REFERENCES contacts(id) ON DELETE SET NULL
        )
      `)
      database.run('CREATE INDEX IF NOT EXISTS idx_mention_resolutions_recording ON mention_resolutions(recording_id)')
      database.run('CREATE INDEX IF NOT EXISTS idx_mention_resolutions_contact ON mention_resolutions(resolved_contact_id)')
    } catch (e) {
      console.warn('[Migration v35] mention_resolutions failed:', e)
    }
    console.log('Migration v35 complete')
  },
  36: () => {
    // v36 (P0 DB-bloat fix): the RAG vector store persisted each embedding as a
    // JSON text array (avg ~39 KB/row for a 3072-dim vector). At ~46k rows that
    // was 1.7 GB — 90%+ of the whole database — which drove sql.js past its heap
    // ceiling and crashed the app. Compact every embedding to a binary Float32
    // BLOB (~3x smaller) and drop duplicate (recording_id, chunk_index) rows.
    // Idempotent: only rows whose embedding is still TEXT are converted, so a
    // re-run is a no-op. The engine runs VACUUM after this migration to reclaim
    // the freed pages. See vector-store.ts for the matching write/read change.
    console.log('Running migration to schema v36: compact vector_embeddings (JSON text -> Float32 BLOB) + dedupe')
    const database = getDatabase()

    // Skip cleanly if the table was never created (RAG never used on this DB).
    const exists = database.exec("SELECT name FROM sqlite_master WHERE type='table' AND name='vector_embeddings'")
    if (exists.length === 0) {
      console.log('[Migration v36] vector_embeddings table absent; nothing to compact')
      return
    }

    // 1. Dedupe: one recording indexed twice leaves duplicate (recording_id,
    // chunk_index) rows. Keep the newest (max rowid).
    try {
      run(`
        DELETE FROM vector_embeddings
        WHERE recording_id IS NOT NULL
          AND rowid NOT IN (
            SELECT MAX(rowid) FROM vector_embeddings
            WHERE recording_id IS NOT NULL
            GROUP BY recording_id, chunk_index
          )
      `)
      console.log(`[Migration v36] removed ${database.getRowsModified()} duplicate embedding rows`)
    } catch (e) {
      console.warn('[Migration v36] dedupe failed (non-fatal):', e)
    }

    // 2. Convert JSON-text embeddings to Float32 BLOBs, in bounded batches so a
    // large table never materializes fully in memory. Each UPDATE flips the row
    // from typeof 'text' to 'blob', so it drops out of the next batch's filter;
    // a row with an unparseable embedding is deleted (unusable for search) to
    // guarantee the loop terminates.
    let converted = 0
    let deleted = 0
    try {
      for (;;) {
        const res = database.exec(
          "SELECT id, embedding FROM vector_embeddings WHERE typeof(embedding) = 'text' LIMIT 500"
        )
        if (res.length === 0 || res[0].values.length === 0) break
        const rows = res[0].values as [string, string][]
        runInTransaction(() => {
          for (const [id, embedding] of rows) {
            try {
              const arr = JSON.parse(embedding)
              if (!Array.isArray(arr) || arr.length === 0) {
                run('DELETE FROM vector_embeddings WHERE id = ?', [id])
                deleted++
                continue
              }
              const buf = Buffer.from(new Float32Array(arr).buffer)
              run('UPDATE vector_embeddings SET embedding = ? WHERE id = ?', [buf, id])
              converted++
            } catch {
              // Malformed JSON — unusable chunk; drop it so the filter shrinks.
              run('DELETE FROM vector_embeddings WHERE id = ?', [id])
              deleted++
            }
          }
        })
      }
      console.log(
        `[Migration v36] compacted ${converted} embeddings to Float32 BLOB` +
          (deleted > 0 ? `, dropped ${deleted} malformed` : '') +
          ' (VACUUM reclaims the freed space)'
      )
    } catch (e) {
      console.warn('[Migration v36] embedding compaction failed (non-fatal):', e)
    }
  },

  37: () => {
    // v37: per-turn speaker overrides + speaker splits. Label-level speaker
    // assignment (transcript_speakers) rewrites EVERY turn of a diarization
    // label; when the diarizer merges two people onto one label, the user could
    // not fix it. These two tables add (a) a per-turn override that supersedes
    // the label default for a single turn, and (b) a split that forks a label
    // into an independently-assignable derived label from a turn onward.
    // Idempotent: CREATE TABLE IF NOT EXISTS + guarded index creation.
    console.log('Running migration to schema v37: turn_speaker_overrides + speaker_splits')
    const database = getDatabase()
    try {
      database.run(`
        CREATE TABLE IF NOT EXISTS turn_speaker_overrides (
          id TEXT PRIMARY KEY,
          recording_id TEXT NOT NULL,
          turn_index INTEGER NOT NULL,
          contact_id TEXT NOT NULL,
          created_at TEXT DEFAULT CURRENT_TIMESTAMP,
          UNIQUE(recording_id, turn_index),
          FOREIGN KEY (recording_id) REFERENCES recordings(id) ON DELETE CASCADE,
          FOREIGN KEY (contact_id) REFERENCES contacts(id) ON DELETE CASCADE
        )
      `)
      database.run('CREATE INDEX IF NOT EXISTS idx_turn_overrides_recording ON turn_speaker_overrides(recording_id)')
    } catch (e) {
      console.warn('[Migration v37] turn_speaker_overrides failed (non-fatal):', e)
    }
    try {
      database.run(`
        CREATE TABLE IF NOT EXISTS speaker_splits (
          id TEXT PRIMARY KEY,
          recording_id TEXT NOT NULL,
          base_label TEXT NOT NULL,
          from_turn_index INTEGER NOT NULL,
          derived_label TEXT NOT NULL,
          created_at TEXT DEFAULT CURRENT_TIMESTAMP,
          UNIQUE(recording_id, base_label, from_turn_index),
          FOREIGN KEY (recording_id) REFERENCES recordings(id) ON DELETE CASCADE
        )
      `)
      database.run('CREATE INDEX IF NOT EXISTS idx_speaker_splits_recording ON speaker_splits(recording_id)')
    } catch (e) {
      console.warn('[Migration v37] speaker_splits failed (non-fatal):', e)
    }
    console.log('Migration v37 complete')
  },
  38: () => {
    // v38: privacy source-deletion. Two per-recording lifecycle flags plus a
    // deletion journal. `personal` marks a recording "ignore" (kept on disk but
    // pulled from every AI pipeline + default surface). `deleted_at` is a
    // soft-delete tombstone (hidden everywhere, restorable). deletion_journal
    // records each delete so soft-deletes are restorable and purges are audited.
    // Idempotent: guarded ALTERs + CREATE TABLE IF NOT EXISTS.
    console.log('Running migration to schema v38: personal + deleted_at + deletion_journal')
    const database = getDatabase()
    const recCols = getTableColumns(database, 'recordings')
    if (recCols.length > 0) {
      if (!recCols.includes('personal')) {
        try { database.run('ALTER TABLE recordings ADD COLUMN personal INTEGER DEFAULT 0') } catch (e) {
          console.warn('[Migration v38] add personal failed:', e)
        }
      }
      if (!recCols.includes('deleted_at')) {
        try { database.run('ALTER TABLE recordings ADD COLUMN deleted_at TEXT') } catch (e) {
          console.warn('[Migration v38] add deleted_at failed:', e)
        }
      }
    }
    try {
      database.run(`
        CREATE TABLE IF NOT EXISTS deletion_journal (
          id TEXT PRIMARY KEY,
          recording_id TEXT NOT NULL,
          mode TEXT NOT NULL CHECK(mode IN ('soft', 'hard')),
          recording_snapshot TEXT,
          removed_counts TEXT,
          created_at TEXT DEFAULT CURRENT_TIMESTAMP,
          restored_at TEXT
        )
      `)
      database.run('CREATE INDEX IF NOT EXISTS idx_recordings_personal ON recordings(personal)')
      database.run('CREATE INDEX IF NOT EXISTS idx_recordings_deleted_at ON recordings(deleted_at)')
      database.run('CREATE INDEX IF NOT EXISTS idx_deletion_journal_recording ON deletion_journal(recording_id)')
    } catch (e) {
      console.warn('[Migration v38] deletion_journal failed (non-fatal):', e)
    }
    console.log('Migration v38 complete')
  },
  39: () => {
    // v39: meeting-timeline data. Two JSON columns on transcripts hold the
    // rich-waveform timeline: `sentiment_segments` (a time-windowed sentiment
    // series) and `event_markers` (action/decision markers with audio offsets).
    // Both are (re)computed by timeline-analysis and are safe to leave NULL until
    // analyzed. Idempotent: guarded ALTERs.
    console.log('Running migration to schema v39: transcripts.sentiment_segments + event_markers')
    const database = getDatabase()
    const cols = getTableColumns(database, 'transcripts')
    if (cols.length > 0) {
      if (!cols.includes('sentiment_segments')) {
        try { database.run('ALTER TABLE transcripts ADD COLUMN sentiment_segments TEXT') } catch (e) {
          console.warn('[Migration v39] add sentiment_segments failed:', e)
        }
      }
      if (!cols.includes('event_markers')) {
        try { database.run('ALTER TABLE transcripts ADD COLUMN event_markers TEXT') } catch (e) {
          console.warn('[Migration v39] add event_markers failed:', e)
        }
      }
    }
    console.log('Migration v39 complete')
  },

  40: () => {
    // v40: download_queue.cancel_reason — durable origin of a 'cancelled' download.
    // 'user' = deliberate cancel, terminal-suppressed from auto-retry AND from
    // reconciliation re-queue (across restarts) until a manual Retry clears it;
    // 'interrupted' = disconnect/re-sync, auto-retried on reconnect. NULL for
    // pre-v40 rows (treated as 'interrupted' for backward compatibility).
    // Idempotent: guarded ALTER.
    console.log('Running migration to schema v40: download_queue.cancel_reason')
    const database = getDatabase()
    const cols = getTableColumns(database, 'download_queue')
    if (cols.length > 0 && !cols.includes('cancel_reason')) {
      try {
        database.run('ALTER TABLE download_queue ADD COLUMN cancel_reason TEXT')
      } catch (e) {
        console.warn('[Migration v40] add cancel_reason failed:', e)
      }
    }
    console.log('Migration v40 complete')
  },

  41: () => {
    // v41: project_discovery_rejections — durable tombstones for dismissed
    // auto-discovered projects. Without this, dismissing a spurious discovery
    // (delete) left nothing behind and the next transcript re-analysis re-created
    // the same project. Keyed by normalized name (the deleted project row and its
    // cascading aliases cannot carry the memory). Idempotent: CREATE IF NOT EXISTS.
    console.log('Running migration to schema v41: project_discovery_rejections')
    const database = getDatabase()
    try {
      database.run(`
        CREATE TABLE IF NOT EXISTS project_discovery_rejections (
          name_norm TEXT PRIMARY KEY,
          original_name TEXT NOT NULL,
          source_meeting_id TEXT,
          rejected_at TEXT DEFAULT CURRENT_TIMESTAMP
        )
      `)
    } catch (e) {
      console.warn('[Migration v41] create project_discovery_rejections failed:', e)
    }
    console.log('Migration v41 complete')
  },

  42: () => {
    // v42: projects.origin — durable provenance for the dismiss-discovered path.
    // 'manual' = explicit user create, 'discovered' = reconciler auto-create.
    // Legacy rows stay NULL (unknown) and are fail-closed: dismissDiscovered
    // refuses them, so a renderer bug or direct IPC call can never tombstone-
    // delete a manually created project. Idempotent: guarded ALTER.
    console.log('Running migration to schema v42: projects.origin')
    const database = getDatabase()
    const cols = getTableColumns(database, 'projects')
    if (cols.length > 0 && !cols.includes('origin')) {
      try {
        database.run('ALTER TABLE projects ADD COLUMN origin TEXT')
      } catch (e) {
        console.warn('[Migration v42] add origin failed:', e)
      }
    }

    // merge_journal.loser_id + seq (still v42 — this version exists only on
    // this lane and was never integrated or published, so the journal columns
    // for the dependency-aware newest-first unmerge guard extend the SAME
    // migration instead of minting v43). loser_id makes the loser queryable
    // without JSON-parsing every snapshot; seq is the explicit immutable merge
    // order (rowid can be renumbered by VACUUM/dump-restore). Backfill:
    // loser_id from the snapshot's $.id, seq from rowid — rowid is monotonic
    // for rows that have never been renumbered, and any historical renumbering
    // predates the guard, so it is the best available witness of merge order.
    const journalCols = getTableColumns(database, 'merge_journal')
    if (journalCols.length > 0) {
      if (!journalCols.includes('loser_id')) {
        try {
          database.run('ALTER TABLE merge_journal ADD COLUMN loser_id TEXT')
        } catch (e) {
          console.warn('[Migration v42] add merge_journal.loser_id failed:', e)
        }
      }
      if (!journalCols.includes('seq')) {
        try {
          database.run('ALTER TABLE merge_journal ADD COLUMN seq INTEGER')
        } catch (e) {
          console.warn('[Migration v42] add merge_journal.seq failed:', e)
        }
      }
      // Backfill runs UNCONDITIONALLY (WHERE ... IS NULL makes it idempotent):
      // repairPhase may have force-added the columns on this same boot, in
      // which case the includes-guards above skip the ALTERs but legacy rows
      // still need their values.
      try {
        database.run("UPDATE merge_journal SET loser_id = json_extract(loser_snapshot, '$.id') WHERE loser_id IS NULL")
        database.run('UPDATE merge_journal SET seq = rowid WHERE seq IS NULL')
      } catch (e) {
        console.warn('[Migration v42] merge_journal backfill failed:', e)
      }
    }

    // Re-key v41 tombstones under the NFKC name normalization that ships with
    // v42. v41 wrote name_norm with the pre-NFKC normalizeName, so a tombstone
    // recorded under a decomposed (NFD) or compatibility form no longer matches
    // post-v42 lookups: re-analysis would resurrect the dismissed project, and a
    // manual re-create could never clear the stranded key. Recompute every key
    // from original_name in one transaction. NFKC collisions (two old keys
    // folding to one) are resolved deterministically: keep the NEWEST rejection
    // (latest rejected_at, ties broken by old name_norm), drop the rest — the
    // newest row is the user's most recent dismissal decision for that name.
    try {
      runInTransaction(() => {
        const rows = queryAll<{
          name_norm: string
          original_name: string
          source_meeting_id: string | null
          rejected_at: string | null
        }>(
          'SELECT name_norm, original_name, source_meeting_id, rejected_at FROM project_discovery_rejections ' +
            'ORDER BY rejected_at DESC, name_norm DESC'
        )
        let rekeyed = 0
        const winners = new Map<string, (typeof rows)[number] & { oldNorm: string }>()
        for (const row of rows) {
          const newNorm = normalizeName(row.original_name)
          if (!newNorm) continue
          // Rows are newest-first, so the first row seen per new key wins.
          if (!winners.has(newNorm)) winners.set(newNorm, { ...row, oldNorm: row.name_norm })
        }
        for (const [newNorm, row] of winners) {
          if (newNorm !== row.oldNorm) rekeyed++
        }
        if (rekeyed > 0 || winners.size !== rows.length) {
          run('DELETE FROM project_discovery_rejections')
          for (const [newNorm, row] of winners) {
            run(
              `INSERT INTO project_discovery_rejections (name_norm, original_name, source_meeting_id, rejected_at)
               VALUES (?, ?, ?, ?)`,
              [newNorm, row.original_name, row.source_meeting_id, row.rejected_at]
            )
          }
          console.log(
            `[Migration v42] re-keyed ${rekeyed} tombstone(s) to NFKC, ` +
              `dropped ${rows.length - winners.size} collision(s)`
          )
        }
      })
    } catch (e) {
      // Rethrow: the transaction has rolled back, and schema_version must NOT
      // advance to 42 on a failed rewrite — swallowing here would strand the
      // v41 keys permanently (the migration never retries once 42 is recorded).
      // The engine records each version only AFTER its migration returns, so
      // failing loudly leaves the DB at 41 and the next boot retries the
      // re-key. (The guarded ALTER above may have committed — that's fine:
      // it is idempotent and repairPhase force-adds the column anyway.)
      console.warn('[Migration v42] tombstone re-key failed:', e)
      throw e
    }
    console.log('Migration v42 complete')
  }

}

/**
 * Phase-2 structural repair (app-specific). Invoked by the engine on every boot,
 * after core tables and before migrations: force-adds any columns the current
 * code requires but an older on-disk schema may lack. Idempotent.
 */
function repairPhase(): void {
  const database = getDatabase()

  // Repair Meetings (v32): all-day flag + named calendar date. Force-add so an
  // older on-disk schema that skipped the migration still gets the columns
  // before any calendar-sync write. Idempotent.
  const meetingCols = getTableColumns(database, 'meetings')
  const meetingRepairs = [
    { name: 'is_all_day', def: 'INTEGER DEFAULT 0' },
    { name: 'all_day_date', def: 'TEXT' }
  ]
  if (meetingCols.length > 0) {
    for (const col of meetingRepairs) {
      if (!meetingCols.includes(col.name)) {
        console.log(`[Database] Repairing meetings: adding ${col.name}`)
        try { database.run(`ALTER TABLE meetings ADD COLUMN ${col.name} ${col.def}`) } catch (e) {}
      }
    }
  }

  // Repair Recordings
  const recCols = getTableColumns(database, 'recordings')
  const recordingRepairs = [
    { name: 'migrated_to_capture_id', def: "TEXT" },
    { name: 'migration_status', def: "TEXT CHECK(migration_status IN ('pending', 'migrated', 'skipped', 'error')) DEFAULT 'pending'" },
    { name: 'migrated_at', def: "TEXT" },
    // v38 privacy source-deletion columns — force-add so older on-disk schemas
    // have them before any read-site filters on personal/deleted_at.
    { name: 'personal', def: "INTEGER DEFAULT 0" },
    { name: 'deleted_at', def: "TEXT" }
  ]
  if (recCols.length > 0) {
    for (const col of recordingRepairs) {
      if (!recCols.includes(col.name)) {
        console.log(`[Database] Repairing recordings: adding ${col.name}`)
        try { database.run(`ALTER TABLE recordings ADD COLUMN ${col.name} ${col.def}`) } catch (e) {}
      }
    }
  } else {
    console.warn('[Database] recordings table unavailable during structural repair; skipping recordings repair')
  }

  // Repair Knowledge Captures
  const capCols = getTableColumns(database, 'knowledge_captures')
  const knowledgeRepairs = [
    { name: 'category', def: "category TEXT CHECK(category IN ('meeting', 'interview', '1:1', 'brainstorm', 'note', 'other')) DEFAULT 'meeting'" },
    { name: 'status', def: "status TEXT CHECK(status IN ('processing', 'ready', 'enriched')) DEFAULT 'ready'" },
    { name: 'quality_rating', def: "quality_rating TEXT CHECK(quality_rating IN ('valuable', 'archived', 'low-value', 'garbage', 'unrated')) DEFAULT 'unrated'" },
    { name: 'quality_confidence', def: "quality_confidence REAL" },
    { name: 'quality_assessed_at', def: "quality_assessed_at TEXT" },
    { name: 'storage_tier', def: "storage_tier TEXT CHECK(storage_tier IN ('hot', 'cold', 'expiring', 'deleted')) DEFAULT 'hot'" },
    { name: 'retention_days', def: "retention_days INTEGER" },
    { name: 'expires_at', def: "expires_at TEXT" },
    { name: 'meeting_id', def: "meeting_id TEXT REFERENCES meetings(id)" },
    { name: 'correlation_confidence', def: "correlation_confidence REAL" },
    { name: 'correlation_method', def: "correlation_method TEXT" },
    { name: 'source_recording_id', def: "source_recording_id TEXT REFERENCES recordings(id)" }
  ]
  if (capCols.length > 0) {
    for (const col of knowledgeRepairs) {
      if (!capCols.includes(col.name)) {
        console.log(`[Database] Repairing knowledge_captures: adding ${col.name}`)
        try { database.run(`ALTER TABLE knowledge_captures ADD COLUMN ${col.def}`) } catch (e) {}
      }
    }
  } else {
    console.warn('[Database] knowledge_captures table unavailable during structural repair; skipping capture repair')
  }

  // Repair transcription_queue (spec-014: retry persistence and real-time progress)
  const queueInfo = database.exec("PRAGMA table_info(transcription_queue)")
  if (queueInfo.length > 0 && queueInfo[0].values) {
    const queueCols = queueInfo[0].values.map(col => col[1])
    const queueRepairs = [
      { name: 'retry_count', def: 'INTEGER DEFAULT 0' },
      { name: 'progress', def: 'INTEGER DEFAULT 0' },
      { name: 'provider', def: 'TEXT' }
    ]
    for (const col of queueRepairs) {
      if (!queueCols.includes(col.name)) {
        console.log(`[Database] Repairing transcription_queue: adding ${col.name}`)
        try { database.run(`ALTER TABLE transcription_queue ADD COLUMN ${col.name} ${col.def}`) } catch (e) {}
      }
    }
  }

  // Repair download_queue (v40): cancel_reason — force-add so an older on-disk
  // schema that skipped the migration still gets it before the DownloadService
  // reads/writes cancellation origins. Idempotent.
  const dlqCols = getTableColumns(database, 'download_queue')
  if (dlqCols.length > 0 && !dlqCols.includes('cancel_reason')) {
    console.log('[Database] Repairing download_queue: adding cancel_reason')
    try { database.run('ALTER TABLE download_queue ADD COLUMN cancel_reason TEXT') } catch { /* column exists */ }
  }

  // Repair recording_preassignments (v31): force-create so an older on-disk DB
  // that skipped the migration still gets it before any preassign write. Idempotent.
  try {
    database.run(`
      CREATE TABLE IF NOT EXISTS recording_preassignments (
        filename TEXT PRIMARY KEY,
        meeting_id TEXT,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (meeting_id) REFERENCES meetings(id) ON DELETE CASCADE
      )
    `)
  } catch (e) { /* table already exists */ }

  // Repair transcript_speakers (v25): a new table has no columns to ALTER, but
  // force-create it here so an older on-disk DB that skipped the migration still
  // gets it before any assignSpeaker write. Idempotent.
  try {
    database.run(`
      CREATE TABLE IF NOT EXISTS transcript_speakers (
        id TEXT PRIMARY KEY,
        recording_id TEXT NOT NULL,
        speaker_label TEXT NOT NULL,
        contact_id TEXT NOT NULL,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(recording_id, speaker_label),
        FOREIGN KEY (recording_id) REFERENCES recordings(id) ON DELETE CASCADE,
        FOREIGN KEY (contact_id) REFERENCES contacts(id) ON DELETE CASCADE
      )
    `)
  } catch (e) { /* table already exists */ }

  // Repair mention_resolutions (v35): force-create so an older on-disk DB that
  // skipped the migration still gets it before any resolveMention write. Idempotent.
  try {
    database.run(`
      CREATE TABLE IF NOT EXISTS mention_resolutions (
        id TEXT PRIMARY KEY,
        recording_id TEXT NOT NULL,
        source_name TEXT NOT NULL,
        resolved_contact_id TEXT,
        method TEXT,
        confidence REAL,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(recording_id, source_name),
        FOREIGN KEY (recording_id) REFERENCES recordings(id) ON DELETE CASCADE,
        FOREIGN KEY (resolved_contact_id) REFERENCES contacts(id) ON DELETE SET NULL
      )
    `)
  } catch { /* table already exists */ }

  // Repair per-turn speaker overrides + speaker splits (v37): force-create so an
  // older on-disk DB that skipped the migration still gets them before any
  // setTurnOverride/splitSpeakerFrom write. Idempotent.
  try {
    database.run(`
      CREATE TABLE IF NOT EXISTS turn_speaker_overrides (
        id TEXT PRIMARY KEY,
        recording_id TEXT NOT NULL,
        turn_index INTEGER NOT NULL,
        contact_id TEXT NOT NULL,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(recording_id, turn_index),
        FOREIGN KEY (recording_id) REFERENCES recordings(id) ON DELETE CASCADE,
        FOREIGN KEY (contact_id) REFERENCES contacts(id) ON DELETE CASCADE
      )
    `)
  } catch { /* table already exists */ }
  try {
    database.run(`
      CREATE TABLE IF NOT EXISTS speaker_splits (
        id TEXT PRIMARY KEY,
        recording_id TEXT NOT NULL,
        base_label TEXT NOT NULL,
        from_turn_index INTEGER NOT NULL,
        derived_label TEXT NOT NULL,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(recording_id, base_label, from_turn_index),
        FOREIGN KEY (recording_id) REFERENCES recordings(id) ON DELETE CASCADE
      )
    `)
  } catch { /* table already exists */ }

  // Repair knowledge_projects (v26): force-create so an older on-disk DB that
  // skipped the migration still gets it before any setProjects write. Idempotent.
  try {
    database.run(`
      CREATE TABLE IF NOT EXISTS knowledge_projects (
        knowledge_capture_id TEXT NOT NULL,
        project_id TEXT NOT NULL,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (knowledge_capture_id, project_id),
        FOREIGN KEY (knowledge_capture_id) REFERENCES knowledge_captures(id) ON DELETE CASCADE,
        FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
      )
    `)
  } catch (e) { /* table already exists */ }

  // Repair alias memory + suggestion tables (v27): force-create so an older
  // on-disk DB that skipped the migration still gets them. Idempotent.
  try {
    database.run(`
      CREATE TABLE IF NOT EXISTS contact_aliases (
        id TEXT PRIMARY KEY,
        alias_norm TEXT NOT NULL UNIQUE,
        contact_id TEXT NOT NULL,
        source TEXT CHECK(source IN ('merge', 'speaker_assign', 'manual', 'inferred', 'rejected')),
        confidence REAL,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (contact_id) REFERENCES contacts(id) ON DELETE CASCADE
      )
    `)
    database.run(`
      CREATE TABLE IF NOT EXISTS project_aliases (
        id TEXT PRIMARY KEY,
        alias_norm TEXT NOT NULL UNIQUE,
        project_id TEXT NOT NULL,
        source TEXT CHECK(source IN ('merge', 'speaker_assign', 'manual', 'inferred', 'rejected')),
        confidence REAL,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
      )
    `)
    database.run(`
      CREATE TABLE IF NOT EXISTS identity_suggestions (
        id TEXT PRIMARY KEY,
        kind TEXT CHECK(kind IN ('person', 'project')),
        candidate_name TEXT,
        target_id TEXT,
        confidence REAL,
        evidence TEXT,
        status TEXT CHECK(status IN ('pending', 'accepted', 'rejected')) DEFAULT 'pending',
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(kind, candidate_name, target_id)
      )
    `)
    database.run('CREATE INDEX IF NOT EXISTS idx_contact_aliases_contact ON contact_aliases(contact_id)')
    database.run('CREATE INDEX IF NOT EXISTS idx_project_aliases_project ON project_aliases(project_id)')
    database.run('CREATE INDEX IF NOT EXISTS idx_identity_suggestions_status ON identity_suggestions(status)')
  } catch (e) { /* tables already exist */ }

  // Repair artifacts table (v28): force-create so an older on-disk DB that
  // skipped the migration still gets it before any importArtifact write. Idempotent.
  try {
    database.run(`
      CREATE TABLE IF NOT EXISTS artifacts (
        id TEXT PRIMARY KEY,
        knowledge_capture_id TEXT,
        kind TEXT NOT NULL,
        mime TEXT,
        storage_path TEXT,
        size INTEGER,
        content_hash TEXT,
        extracted_text TEXT,
        metadata TEXT,
        source_connector_id TEXT,
        source_ref TEXT,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (knowledge_capture_id) REFERENCES knowledge_captures(id) ON DELETE CASCADE
      )
    `)
    database.run('CREATE INDEX IF NOT EXISTS idx_artifacts_capture ON artifacts(knowledge_capture_id)')
    database.run('CREATE INDEX IF NOT EXISTS idx_artifacts_kind ON artifacts(kind)')
    database.run('CREATE INDEX IF NOT EXISTS idx_artifacts_content_hash ON artifacts(content_hash)')
  } catch (e) { /* table already exists */ }

  // Repair action_items (v26): force-add assignee_contact_id if missing.
  const actionItemCols = getTableColumns(database, 'action_items')
  if (actionItemCols.length > 0 && !actionItemCols.includes('assignee_contact_id')) {
    console.log('[Database] Repairing action_items: adding assignee_contact_id')
    try { database.run('ALTER TABLE action_items ADD COLUMN assignee_contact_id TEXT') } catch (e) {}
  }

  // Repair transcripts (v39): force-add the meeting-timeline JSON columns so an
  // older on-disk schema that skipped the migration still has them before any
  // timeline-analysis write. Idempotent.
  const transcriptCols = getTableColumns(database, 'transcripts')
  if (transcriptCols.length > 0) {
    for (const col of ['sentiment_segments', 'event_markers']) {
      if (!transcriptCols.includes(col)) {
        console.log(`[Database] Repairing transcripts: adding ${col}`)
        try { database.run(`ALTER TABLE transcripts ADD COLUMN ${col} TEXT`) } catch (e) {}
      }
    }
  }

  // Repair projects (v29 + v42): force-add folder_path/url and the origin
  // provenance column if missing, so an older on-disk schema that skipped a
  // migration still gets them before the reconciler or dismissDiscoveredProject
  // touches the table. Idempotent.
  const projectCols = getTableColumns(database, 'projects')
  if (projectCols.length > 0) {
    for (const col of ['folder_path', 'url']) {
      if (!projectCols.includes(col)) {
        console.log(`[Database] Repairing projects: adding ${col}`)
        try { database.run(`ALTER TABLE projects ADD COLUMN ${col} TEXT`) } catch (e) {}
      }
    }
    if (!projectCols.includes('origin')) {
      console.log('[Database] Repairing projects: adding origin')
      try { database.run('ALTER TABLE projects ADD COLUMN origin TEXT') } catch (e) { /* already exists */ }
    }
  }

  // Repair merge_journal (v42): loser_id + seq for the dependency-aware
  // newest-first unmerge guard. Force-add AND backfill so an older on-disk
  // schema that skipped the migration still gets ordered, queryable journals
  // before any unmerge runs. Idempotent (backfills are WHERE ... IS NULL).
  const journalCols = getTableColumns(database, 'merge_journal')
  if (journalCols.length > 0) {
    if (!journalCols.includes('loser_id')) {
      console.log('[Database] Repairing merge_journal: adding loser_id')
      try {
        database.run('ALTER TABLE merge_journal ADD COLUMN loser_id TEXT')
        database.run("UPDATE merge_journal SET loser_id = json_extract(loser_snapshot, '$.id') WHERE loser_id IS NULL")
      } catch { /* already exists */ }
    }
    if (!journalCols.includes('seq')) {
      console.log('[Database] Repairing merge_journal: adding seq')
      try {
        database.run('ALTER TABLE merge_journal ADD COLUMN seq INTEGER')
        database.run('UPDATE merge_journal SET seq = rowid WHERE seq IS NULL')
      } catch { /* already exists */ }
    }
  }

  // Repair project_notes (v29): force-create so an older on-disk DB that skipped
  // the migration still gets it before any note write. Idempotent.
  try {
    database.run(`
      CREATE TABLE IF NOT EXISTS project_notes (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL,
        kind TEXT CHECK(kind IN ('issue', 'risk', 'note')),
        content TEXT NOT NULL,
        status TEXT CHECK(status IN ('open', 'resolved')) DEFAULT 'open',
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        resolved_at TEXT,
        FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
      )
    `)
    database.run('CREATE INDEX IF NOT EXISTS idx_project_notes_project_kind ON project_notes(project_id, kind)')
  } catch (e) { /* table already exists */ }

  // Repair chat_messages (AI-15: columns referenced by assistant mapper)
  const chatMsgInfo = database.exec("PRAGMA table_info(chat_messages)")
  if (chatMsgInfo.length > 0 && chatMsgInfo[0].values) {
    const chatCols = chatMsgInfo[0].values.map(col => col[1])
    const chatRepairs = [
      { name: 'edited_at', def: 'TEXT' },
      { name: 'original_content', def: 'TEXT' },
      { name: 'created_output_id', def: 'TEXT' },
      { name: 'saved_as_insight_id', def: 'TEXT' }
    ]
    for (const col of chatRepairs) {
      if (!chatCols.includes(col.name)) {
        console.log(`[Database] Repairing chat_messages: adding ${col.name}`)
        try { database.run(`ALTER TABLE chat_messages ADD COLUMN ${col.name} ${col.def}`) } catch (e) {}
      }
    }
  }
}

/**
 * Shared SQLite engine, configured with this app's schema, version, migrations,
 * and structural-repair callback. Owns the sql.js lifecycle and the 4-phase boot.
 */
const engine = new DatabaseEngine({
  betterSqlite3: Database,
  dbPathProvider: getDatabasePath,
  schemaVersion: SCHEMA_VERSION,
  schema: SCHEMA,
  migrations: MIGRATIONS,
  repairPhase,
  // Safety net (P0 knowledge_captures loss): refuse any single statement that
  // would wipe >50% of these entity tables (when >20 rows), and keep the last
  // 3 daily on-boot backups before migrations run. Intentional bulk purges use
  // runWithMassDeleteAllowed().
  protectedTables: ['knowledge_captures', 'transcripts', 'recordings', 'meetings', 'contacts'],
  backupOnBoot: { keep: 3 },
})

/**
 * Run `fn` with the mass-delete tripwire suspended — for legitimate bulk deletes
 * (migrations, explicit user-confirmed purges). Restores the guard afterwards.
 */
export function runWithMassDeleteAllowed<T>(fn: () => T): T {
  return engine.runWithMassDeleteAllowed(fn)
}

/**
 * Safe database initialization. Delegates the 4-phase boot sequence
 * (core tables → structural repair → migrations → full schema/indexes) to the
 * shared @hidock/database engine, configured above with this app's schema,
 * version, migrations, and repairPhase.
 */
export async function initializeDatabase(): Promise<void> {
  await engine.initialize()
}

export function saveDatabase(): void {
  engine.saveDatabase()
}

export function getDatabase(): SqlJsDatabase {
  return engine.getDatabase()
}

export function closeDatabase(): void {
  engine.closeDatabase()
}

/**
 * Update knowledge_capture title based on title_suggestion
 * Only updates if the current title matches the filename pattern
 */
export function updateKnowledgeCaptureTitle(recordingId: string, titleSuggestion: string): void {
  try {
    // Get the recording to find the knowledge_capture
    const recording = getRecordingById(recordingId)
    if (!recording) return

    // Get the knowledge capture via migrated_to_capture_id
    const captureId = recording.migrated_to_capture_id
    if (!captureId) return

    // Get the knowledge capture
    const capture = queryOne<{ id: string; title: string }>(
      'SELECT id, title FROM knowledge_captures WHERE id = ?',
      [captureId]
    )
    if (!capture) return

    // Only update if title looks like a filename (contains .hda or similar)
    if (capture.title.includes('.') || capture.title === 'Untitled') {
      run(
        'UPDATE knowledge_captures SET title = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
        [titleSuggestion, captureId]
      )
      console.log(`Updated knowledge_capture title: "${capture.title}" -> "${titleSuggestion}"`)
    }
  } catch (error) {
    console.warn('Failed to update knowledge_capture title:', error)
  }
}

// Generic query helpers
// Generic query helpers — delegate to the shared engine.
export function queryAll<T>(sql: string, params: any[] = []): T[] {
  return engine.queryAll<T>(sql, params)
}

export function queryOne<T>(sql: string, params: any[] = []): T | undefined {
  return engine.queryOne<T>(sql, params)
}

export function run(sql: string, params: any[] = []): void {
  engine.run(sql, params)
}

// Internal run that doesn't auto-save (for use within transactions)
function runNoSave(sql: string, params: any[] = []): void {
  engine.runNoSave(sql, params)
}

/**
 * Execute a function within a database transaction.
 * Automatically handles BEGIN/COMMIT/ROLLBACK and saves only on success.
 * Use this for operations that must be atomic (all-or-nothing).
 */
export function runInTransaction<T>(fn: () => T): T {
  return engine.runInTransaction(fn)
}

export function runMany(sql: string, items: any[][]): void {
  engine.runMany(sql, items)
}

/**
 * Base UID of a meeting occurrence id: `uid::slotISO` → `uid`; a bare `uid` is
 * returned unchanged. Every occurrence of one recurring ICS series shares a base
 * uid, so this is the family key used to reconcile occurrences across id schemes.
 */
export function meetingBaseUid(id: string): string {
  const i = id.indexOf('::')
  return i === -1 ? id : id.slice(0, i)
}

/**
 * Remap incoming occurrence ids onto an existing canonical row that already
 * describes the SAME real slot under a different id (same base uid + same
 * start_time). This pins a recurring-series occurrence to the row already
 * carrying its foreign keys (recordings.meeting_id, meeting_contacts,
 * meeting_projects) instead of inserting an id-scheme twin.
 *
 * This is the sync-time half of the duplicate-occurrence fix: a stale
 * pre-expansion bare-uid row (`uid`) and a new expanded row (`uid::slotISO`)
 * describe the same meeting; without this remap, every sync would re-insert the
 * `uid::slotISO` twin next to the bare-uid row the cleanup pass keeps.
 *
 * Pure: `existing` is a snapshot of {id, start_time}. An incoming id that already
 * matches an existing row is left as-is (it will UPDATE that row in place).
 * Exported for unit testing.
 */
export function remapOccurrenceIdsToExisting<T extends { id: string; start_time: string }>(
  incoming: T[],
  existing: Array<{ id: string; start_time: string }>
): T[] {
  const existingIds = new Set(existing.map((e) => e.id))
  // (baseUid, start_time) → canonical existing id. Prefer a bare-uid row as the
  // canonical target so this matches the cleanup keeper preference and converges.
  const SEP = ' '
  const canonicalBySlot = new Map<string, string>()
  for (const e of existing) {
    const key = meetingBaseUid(e.id) + SEP + e.start_time
    const current = canonicalBySlot.get(key)
    if (current === undefined || (current.includes('::') && !e.id.includes('::'))) {
      canonicalBySlot.set(key, e.id)
    }
  }
  return incoming.map((m) => {
    if (existingIds.has(m.id)) return m
    const canonical = canonicalBySlot.get(meetingBaseUid(m.id) + SEP + m.start_time)
    return canonical && canonical !== m.id ? { ...m, id: canonical } : m
  })
}

/**
 * Batch upsert multiple meetings atomically.
 * Used by calendar sync to ensure all-or-nothing behavior.
 * If any meeting fails to upsert, the entire batch is rolled back.
 */
export function upsertMeetingsBatch(meetings: Omit<Meeting, 'created_at' | 'updated_at'>[]): void {
  if (meetings.length === 0) return

  // Reconcile occurrence ids against existing rows so a recurring occurrence
  // updates the row already holding its FKs rather than inserting a twin.
  const existingSlots = queryAll<{ id: string; start_time: string }>(
    'SELECT id, start_time FROM meetings'
  )
  const reconciled = remapOccurrenceIdsToExisting(meetings, existingSlots)

  runInTransaction(() => {
    for (const meeting of reconciled) {
      const existing = getMeetingById(meeting.id)

      if (existing) {
        runNoSave(
          `UPDATE meetings SET
            subject = ?, start_time = ?, end_time = ?, location = ?,
            organizer_name = ?, organizer_email = ?, attendees = ?,
            description = ?, is_recurring = ?, recurrence_rule = ?,
            meeting_url = ?, is_all_day = ?, all_day_date = ?, updated_at = CURRENT_TIMESTAMP
          WHERE id = ?`,
          [
            meeting.subject,
            meeting.start_time,
            meeting.end_time,
            meeting.location ?? null,
            meeting.organizer_name ?? null,
            meeting.organizer_email ?? null,
            meeting.attendees ?? null,
            meeting.description ?? null,
            meeting.is_recurring,
            meeting.recurrence_rule ?? null,
            meeting.meeting_url ?? null,
            meeting.is_all_day ?? 0,
            meeting.all_day_date ?? null,
            meeting.id
          ]
        )
      } else {
        runNoSave(
          `INSERT INTO meetings (id, subject, start_time, end_time, location, organizer_name,
            organizer_email, attendees, description, is_recurring, recurrence_rule, meeting_url,
            is_all_day, all_day_date)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            meeting.id,
            meeting.subject,
            meeting.start_time,
            meeting.end_time,
            meeting.location ?? null,
            meeting.organizer_name ?? null,
            meeting.organizer_email ?? null,
            meeting.attendees ?? null,
            meeting.description ?? null,
            meeting.is_recurring,
            meeting.recurrence_rule ?? null,
            meeting.meeting_url ?? null,
            meeting.is_all_day ?? 0,
            meeting.all_day_date ?? null
          ]
        )
      }
      // Extract contacts (uses runNoSave internally)
      extractContactsFromMeetingDataInternal(meeting)
    }
  })
}

// Meeting queries
export interface Meeting {
  id: string
  subject: string
  start_time: string
  end_time: string
  location?: string | null
  organizer_name?: string | null
  organizer_email?: string | null
  attendees?: string
  description?: string | null
  is_recurring: number
  recurrence_rule?: string
  meeting_url?: string
  /** 1 for a calendar-DATE (all-day/holiday) event, 0 otherwise (v32). */
  is_all_day?: number
  /** Named calendar day (YYYY-MM-DD) for all-day events; null for timed (v32). */
  all_day_date?: string | null
  created_at: string
  updated_at: string
}

export function getMeetings(startDate?: string, endDate?: string): Meeting[] {
  let sql = 'SELECT * FROM meetings'
  const params: string[] = []

  if (startDate && endDate) {
    sql += ' WHERE start_time >= ? AND start_time <= ?'
    params.push(startDate, endDate)
  } else if (startDate) {
    sql += ' WHERE start_time >= ?'
    params.push(startDate)
  } else if (endDate) {
    sql += ' WHERE start_time <= ?'
    params.push(endDate)
  }

  sql += ' ORDER BY start_time ASC'

  return queryAll<Meeting>(sql, params)
}

export function getMeetingById(id: string): Meeting | undefined {
  return queryOne<Meeting>('SELECT * FROM meetings WHERE id = ?', [id])
}

export function updateMeeting(id: string, updates: Partial<Pick<Meeting, 'subject' | 'start_time' | 'end_time' | 'location' | 'description' | 'organizer_name' | 'organizer_email'>>): void {
  const fields: string[] = []
  const params: unknown[] = []

  if (updates.subject !== undefined) { fields.push('subject = ?'); params.push(updates.subject); }
  if (updates.start_time !== undefined) { fields.push('start_time = ?'); params.push(updates.start_time); }
  if (updates.end_time !== undefined) { fields.push('end_time = ?'); params.push(updates.end_time); }
  if (updates.location !== undefined) { fields.push('location = ?'); params.push(updates.location); }
  if (updates.description !== undefined) { fields.push('description = ?'); params.push(updates.description); }
  if (updates.organizer_name !== undefined) { fields.push('organizer_name = ?'); params.push(updates.organizer_name); }
  if (updates.organizer_email !== undefined) { fields.push('organizer_email = ?'); params.push(updates.organizer_email); }

  if (fields.length === 0) return

  fields.push('updated_at = ?')
  params.push(new Date().toISOString())
  params.push(id)

  run(`UPDATE meetings SET ${fields.join(', ')} WHERE id = ?`, params)
}

/**
 * Batch get meetings by IDs - avoids N+1 query problem
 */
export function getMeetingsByIds(meetingIds: string[]): Map<string, Meeting> {
  if (meetingIds.length === 0) return new Map()

  // Remove duplicates and nulls
  const uniqueIds = [...new Set(meetingIds.filter(Boolean))]
  if (uniqueIds.length === 0) return new Map()

  const results = new Map<string, Meeting>()
  const chunkSize = 100

  for (let i = 0; i < uniqueIds.length; i += chunkSize) {
    const chunk = uniqueIds.slice(i, i + chunkSize)
    const placeholders = chunk.map(() => '?').join(',')
    const meetings = queryAll<Meeting>(
      `SELECT * FROM meetings WHERE id IN (${placeholders})`,
      chunk
    )

    for (const meeting of meetings) {
      results.set(meeting.id, meeting)
    }
  }

  return results
}

/**
 * Upsert a meeting and its associated contacts atomically.
 * All operations are wrapped in a single transaction for data integrity.
 */
export function upsertMeeting(meeting: Omit<Meeting, 'created_at' | 'updated_at'>): void {
  runInTransaction(() => {
    // Check if meeting exists
    const existing = getMeetingById(meeting.id)

    if (existing) {
      runNoSave(
        `UPDATE meetings SET
          subject = ?, start_time = ?, end_time = ?, location = ?,
          organizer_name = ?, organizer_email = ?, attendees = ?,
          description = ?, is_recurring = ?, recurrence_rule = ?,
          meeting_url = ?, is_all_day = ?, all_day_date = ?, updated_at = CURRENT_TIMESTAMP
        WHERE id = ?`,
        [
          meeting.subject,
          meeting.start_time,
          meeting.end_time,
          meeting.location ?? null,
          meeting.organizer_name ?? null,
          meeting.organizer_email ?? null,
          meeting.attendees ?? null,
          meeting.description ?? null,
          meeting.is_recurring,
          meeting.recurrence_rule ?? null,
          meeting.meeting_url ?? null,
          meeting.is_all_day ?? 0,
          meeting.all_day_date ?? null,
          meeting.id
        ]
      )
    } else {
      runNoSave(
        `INSERT INTO meetings (id, subject, start_time, end_time, location, organizer_name,
          organizer_email, attendees, description, is_recurring, recurrence_rule, meeting_url,
          is_all_day, all_day_date)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          meeting.id,
          meeting.subject,
          meeting.start_time,
          meeting.end_time,
          meeting.location ?? null,
          meeting.organizer_name ?? null,
          meeting.organizer_email ?? null,
          meeting.attendees ?? null,
          meeting.description ?? null,
          meeting.is_recurring,
          meeting.recurrence_rule ?? null,
          meeting.meeting_url ?? null,
          meeting.is_all_day ?? 0,
          meeting.all_day_date ?? null
        ]
      )
    }
    // Extract contacts from meeting attendees (uses runNoSave internally)
    extractContactsFromMeetingDataInternal(meeting)
  })
}

/**
 * Extract contacts from meeting attendees and organizer.
 * Internal version using runNoSave - must be called within a transaction.
 * Uses batch lookup to avoid N+1 query problem.
 */
function extractContactsFromMeetingDataInternal(meeting: Omit<Meeting, 'created_at' | 'updated_at'>): void {
  // Collect all emails for batch lookup
  const emailsToLookup: string[] = []

  if (meeting.organizer_email) {
    emailsToLookup.push(meeting.organizer_email)
  }

  let attendees: Array<{ name?: string; email?: string }> = []
  if (meeting.attendees) {
    try {
      attendees = JSON.parse(meeting.attendees)
      for (const attendee of attendees) {
        if (attendee.email) {
          emailsToLookup.push(attendee.email)
        }
      }
    } catch (e) {
      // Invalid JSON, skip attendees
    }
  }

  // Single batch query for all contacts
  const existingContacts = getContactsByEmails(emailsToLookup)

  // Handle organizer
  if (meeting.organizer_email || meeting.organizer_name) {
    const existing = meeting.organizer_email ? existingContacts.get(meeting.organizer_email) : undefined
    let contactId

    if (existing) {
      runNoSave(`UPDATE contacts SET name = COALESCE(?, name), last_seen_at = MAX(last_seen_at, ?) WHERE id = ?`,
        [meeting.organizer_name, meeting.start_time, existing.id])
      contactId = existing.id
    } else {
      contactId = crypto.randomUUID()
      runNoSave(`INSERT INTO contacts (id, name, email, first_seen_at, last_seen_at, meeting_count) VALUES (?, ?, ?, ?, ?, 1)`,
        [contactId, meeting.organizer_name || 'Unknown', meeting.organizer_email || null, meeting.start_time, meeting.start_time])
    }
    runNoSave('INSERT OR IGNORE INTO meeting_contacts (meeting_id, contact_id, role) VALUES (?, ?, ?)',
      [meeting.id, contactId, 'organizer'])
  }

  // Handle attendees (already parsed above)
  for (const attendee of attendees) {
    if (!attendee.email && !attendee.name) continue

    const existing = attendee.email ? existingContacts.get(attendee.email) : undefined
    let contactId

    if (existing) {
      runNoSave(`UPDATE contacts SET name = COALESCE(?, name), last_seen_at = MAX(last_seen_at, ?) WHERE id = ?`,
        [attendee.name, meeting.start_time, existing.id])
      contactId = existing.id
    } else {
      contactId = crypto.randomUUID()
      runNoSave(`INSERT INTO contacts (id, name, email, first_seen_at, last_seen_at, meeting_count) VALUES (?, ?, ?, ?, ?, 1)`,
        [contactId, attendee.name || attendee.email || 'Unknown', attendee.email || null, meeting.start_time, meeting.start_time])
    }
    runNoSave('INSERT OR IGNORE INTO meeting_contacts (meeting_id, contact_id, role) VALUES (?, ?, ?)',
      [meeting.id, contactId, 'attendee'])
  }
}

// Recording queries
export interface Recording {
  id: string
  filename: string
  original_filename?: string
  file_path: string | null  // NULL if not stored locally
  file_size?: number
  duration_seconds?: number
  date_recorded: string
  meeting_id?: string
  correlation_confidence?: number
  correlation_method?: string
  status: string  // Legacy field for backwards compatibility
  created_at: string
  // New lifecycle fields
  location: 'device-only' | 'local-only' | 'both' | 'deleted'
  transcription_status: 'none' | 'pending' | 'processing' | 'complete' | 'error'
  on_device: number
  device_last_seen?: string
  on_local: number
  source: 'hidock' | 'import' | 'external'
  is_imported: number
  storage_tier?: 'hot' | 'warm' | 'cold' | 'archive' | null
  // Migration fields (for Phase 0 -> Phase 1 migration)
  migration_status?: 'pending' | 'migrated' | 'skipped' | 'error' | null
  migrated_to_capture_id?: string | null
  migrated_at?: string | null
  // Privacy / lifecycle (v38)
  personal?: number  // 1 = user-marked "ignore" (kept, but out of AI + default surfaces)
  deleted_at?: string | null  // soft-delete tombstone; hidden everywhere, restorable
}

/**
 * All live recordings for the Library, newest first. Excludes soft-deleted rows
 * (deleted_at set) — those are hidden until restored or hard-purged. Personal
 * ("ignored") recordings ARE returned so the Library can show them behind a
 * filter chip; every AI pipeline uses getActiveRecordingIdsForProcessing()
 * instead, which excludes both personal and soft-deleted.
 */
export function getRecordings(): Recording[] {
  return queryAll<Recording>('SELECT * FROM recordings WHERE deleted_at IS NULL ORDER BY date_recorded DESC')
}

export function getRecordingById(id: string): Recording | undefined {
  return queryOne<Recording>('SELECT * FROM recordings WHERE id = ?', [id])
}

// =============================================================================
// Privacy source-deletion (v38): personal ("ignore") flag, soft/hard delete
// cascade, and participant recompute. See the deletion service + IPC for the
// coordinating file removal and the UI confirm dialog.
// =============================================================================

/**
 * Mark / unmark a recording as "personal" (ignored). Non-destructive and fully
 * reversible: the file and all derived rows stay, but the recording is pulled
 * from every AI pipeline (transcription queue, graph ingest, vector indexing,
 * RAG results, Today) and hidden from the Library default view. Returns the new
 * flag state, or undefined if the recording does not exist.
 */
export function setRecordingPersonal(id: string, personal: boolean): boolean | undefined {
  const rec = getRecordingById(id)
  if (!rec) return undefined
  runInTransaction(() => {
    runNoSave('UPDATE recordings SET personal = ? WHERE id = ?', [personal ? 1 : 0, id])
    if (personal) {
      // Pull it out of the transcription queue immediately (a queued personal
      // recording must not be processed). Leaves completed history intact.
      runNoSave("DELETE FROM transcription_queue WHERE recording_id = ? AND status IN ('pending', 'failed')", [id])
    }
  })
  return personal
}

/**
 * Recording ids that must be excluded from AI processing and RAG surfaces:
 * every recording flagged `personal` OR soft-deleted (`deleted_at` set). The
 * vector store filters search results against this set so that marking a
 * recording personal instantly pulls its chunks from the assistant's answers
 * WITHOUT re-indexing (reversible), and soft-deleted recordings never surface.
 */
export function getExcludedRecordingIds(): Set<string> {
  const rows = queryAll<{ id: string }>(
    'SELECT id FROM recordings WHERE personal = 1 OR deleted_at IS NOT NULL'
  )
  return new Set(rows.map((r) => r.id))
}

/** All knowledge_capture ids owned by a recording (via source link or migration). */
function getCaptureIdsForRecording(recordingId: string): string[] {
  const rec = queryOne<{ migrated_to_capture_id?: string | null }>(
    'SELECT migrated_to_capture_id FROM recordings WHERE id = ?',
    [recordingId]
  )
  const rows = queryAll<{ id: string }>(
    'SELECT id FROM knowledge_captures WHERE source_recording_id = ?',
    [recordingId]
  )
  const ids = new Set(rows.map((r) => r.id))
  if (rec?.migrated_to_capture_id) ids.add(rec.migrated_to_capture_id)
  return Array.from(ids)
}

export interface RecordingDeletionImpact {
  recordingId: string
  filename: string
  transcripts: number
  actionItems: number
  embeddings: number
  captures: number
  artifacts: number
  meetingLinks: number
  hasAudioFile: boolean
}

/**
 * Read-only count of everything a hard purge of this recording would remove, so
 * the confirm dialog can state it plainly ("transcript, N action items,
 * embeddings, and the audio file"). Counts both transcript embeddings and vector
 * chunks. Returns undefined if the recording does not exist.
 */
export function getRecordingDeletionImpact(recordingId: string): RecordingDeletionImpact | undefined {
  const rec = getRecordingById(recordingId)
  if (!rec) return undefined

  const captureIds = getCaptureIdsForRecording(recordingId)
  const capPlaceholders = captureIds.map(() => '?').join(',')

  const transcripts = queryAll<{ id: string }>(
    'SELECT id FROM transcripts WHERE recording_id = ?',
    [recordingId]
  )
  const transcriptIds = transcripts.map((t) => t.id)
  const tPlaceholders = transcriptIds.map(() => '?').join(',')

  // Resilient count: vector_embeddings is created lazily by the vector store, so
  // a count against it can hit "no such table" on a fresh DB — treat as 0.
  const count = (sql: string, params: any[]): number => {
    try {
      const row = queryOne<{ c: number }>(sql, params)
      return Number(row?.c ?? 0)
    } catch {
      return 0
    }
  }

  const transcriptEmbeddings = transcriptIds.length
    ? count(`SELECT COUNT(1) AS c FROM embeddings WHERE transcript_id IN (${tPlaceholders})`, transcriptIds)
    : 0
  const vectorChunks = count('SELECT COUNT(1) AS c FROM vector_embeddings WHERE recording_id = ?', [recordingId])
  const actionItems = captureIds.length
    ? count(`SELECT COUNT(1) AS c FROM action_items WHERE knowledge_capture_id IN (${capPlaceholders})`, captureIds)
    : 0
  const artifacts = captureIds.length
    ? count(`SELECT COUNT(1) AS c FROM artifacts WHERE knowledge_capture_id IN (${capPlaceholders})`, captureIds)
    : 0
  const meetingLinks = rec.meeting_id
    ? count('SELECT COUNT(1) AS c FROM meeting_contacts WHERE meeting_id = ?', [rec.meeting_id])
    : 0

  return {
    recordingId,
    filename: rec.filename,
    transcripts: transcripts.length,
    actionItems,
    embeddings: transcriptEmbeddings + vectorChunks,
    captures: captureIds.length,
    artifacts,
    meetingLinks,
    hasAudioFile: !!(rec.file_path && rec.on_local)
  }
}

/**
 * Recompute a meeting's participant links after a linked recording is removed.
 * A meeting_contacts row is kept only if the contact is still justified by
 * either the meeting's own calendar attendees (organizer/attendees email) OR a
 * REMAINING (non-deleted, non-excluded) recording's speaker/turn assignment for
 * that meeting. Unjustified links — those contributed solely by the removed
 * recording — are unlinked (the CONTACT itself is never deleted; shared contacts
 * that appear elsewhere keep every other link). Runs inside the caller's
 * transaction. Returns the number of links removed.
 */
function recomputeMeetingParticipants(meetingId: string, excludeRecordingId: string): number {
  const meeting = queryOne<{ organizer_email?: string | null; attendees?: string | null }>(
    'SELECT organizer_email, attendees FROM meetings WHERE id = ?',
    [meetingId]
  )
  if (!meeting) return 0

  const justifiedEmails = new Set<string>()
  if (meeting.organizer_email) justifiedEmails.add(meeting.organizer_email.toLowerCase())
  if (meeting.attendees) {
    try {
      const parsed = JSON.parse(meeting.attendees) as Array<{ email?: string }>
      for (const a of parsed) if (a?.email) justifiedEmails.add(a.email.toLowerCase())
    } catch {
      /* invalid attendees JSON — ignore */
    }
  }

  const justified = new Set<string>()
  if (justifiedEmails.size > 0) {
    const emailRows = queryAll<{ id: string; email?: string | null }>(
      'SELECT id, email FROM contacts WHERE email IS NOT NULL'
    )
    for (const c of emailRows) {
      if (c.email && justifiedEmails.has(c.email.toLowerCase())) justified.add(c.id)
    }
  }

  // Contacts still justified by remaining recordings linked to this meeting.
  const speakerContacts = queryAll<{ contact_id: string }>(
    `SELECT DISTINCT contact_id FROM transcript_speakers
      WHERE recording_id IN (
        SELECT id FROM recordings
         WHERE meeting_id = ? AND id != ? AND deleted_at IS NULL
      )`,
    [meetingId, excludeRecordingId]
  )
  for (const r of speakerContacts) justified.add(r.contact_id)
  const turnContacts = queryAll<{ contact_id: string }>(
    `SELECT DISTINCT contact_id FROM turn_speaker_overrides
      WHERE recording_id IN (
        SELECT id FROM recordings
         WHERE meeting_id = ? AND id != ? AND deleted_at IS NULL
      )`,
    [meetingId, excludeRecordingId]
  )
  for (const r of turnContacts) justified.add(r.contact_id)

  const current = queryAll<{ contact_id: string }>(
    'SELECT contact_id FROM meeting_contacts WHERE meeting_id = ?',
    [meetingId]
  )
  let removed = 0
  for (const link of current) {
    if (!justified.has(link.contact_id)) {
      runNoSave('DELETE FROM meeting_contacts WHERE meeting_id = ? AND contact_id = ?', [
        meetingId,
        link.contact_id
      ])
      recomputeContactMeetingCount(link.contact_id)
      removed++
    }
  }
  return removed
}

export interface RecordingDeletionResult {
  mode: 'soft' | 'hard'
  recordingId: string
  filename: string
  originalFilename?: string
  filePath?: string | null
  /** Artifact blob paths on disk to unlink (hard purge only). */
  artifactPaths: string[]
  removed: {
    transcripts: number
    embeddings: number
    captures: number
    actionItems: number
    artifacts: number
    speakerBindings: number
    candidates: number
    meetingLinksRemoved: number
  }
}

/**
 * Delete a recording and everything derived from it.
 *
 * Soft ({ hard: false }, the default): set `deleted_at`, snapshot the row into
 * deletion_journal, hide it everywhere. Fully reversible via restoreRecording.
 * No files are touched and no derived rows are removed — read-sites filter on
 * deleted_at, so nothing surfaces.
 *
 * Hard ({ hard: true }): irreversibly remove ALL derived DB rows (transcripts +
 * their embeddings, vector chunks, knowledge_captures and every child, first-
 * class action items/decisions/follow-ups/outputs/artifacts, speaker bindings,
 * turn overrides, splits, mention resolutions, meeting candidates,
 * pre-assignments, synced_files, transcription/quality rows), recompute the
 * linked meeting's participants from the remaining recordings, then delete the
 * recording row. Returns the on-disk paths (audio + artifact blobs) for the
 * caller to unlink. The scoped deletes touch protected tables, so the whole
 * operation runs inside runWithMassDeleteAllowed — this is an intentional,
 * bounded single-source purge, not a mass wipe.
 *
 * Returns undefined if the recording does not exist.
 */
export function deleteRecordingCascade(
  recordingId: string,
  opts: { hard?: boolean } = {}
): RecordingDeletionResult | undefined {
  const rec = getRecordingById(recordingId)
  if (!rec) return undefined

  const zero = {
    transcripts: 0,
    embeddings: 0,
    captures: 0,
    actionItems: 0,
    artifacts: 0,
    speakerBindings: 0,
    candidates: 0,
    meetingLinksRemoved: 0
  }

  if (!opts.hard) {
    const now = new Date().toISOString()
    runInTransaction(() => {
      runNoSave('UPDATE recordings SET deleted_at = ? WHERE id = ?', [now, recordingId])
      // Stop any in-flight/queued transcription for a hidden recording.
      runNoSave("DELETE FROM transcription_queue WHERE recording_id = ? AND status IN ('pending', 'failed')", [recordingId])
      runNoSave(
        `INSERT INTO deletion_journal (id, recording_id, mode, recording_snapshot, created_at)
         VALUES (?, ?, 'soft', ?, ?)`,
        [randomUUID(), recordingId, JSON.stringify(rec), now]
      )
    })
    return {
      mode: 'soft',
      recordingId,
      filename: rec.filename,
      originalFilename: rec.original_filename,
      filePath: rec.file_path,
      artifactPaths: [],
      removed: { ...zero }
    }
  }

  // Hard purge — bounded, intentional, single-source. Suspend the mass-delete
  // tripwire (deletes hit protected tables like transcripts/knowledge_captures)
  // for this scoped operation only.
  return runWithMassDeleteAllowed(() =>
    runInTransaction((): RecordingDeletionResult => {
      const captureIds = getCaptureIdsForRecording(recordingId)
      const capPlaceholders = captureIds.map(() => '?').join(',')

      const transcriptRows = queryAll<{ id: string }>(
        'SELECT id FROM transcripts WHERE recording_id = ?',
        [recordingId]
      )
      const transcriptIds = transcriptRows.map((t) => t.id)
      const tPlaceholders = transcriptIds.map(() => '?').join(',')

      const countOf = (sql: string, params: any[]): number => {
        try {
          const row = queryOne<{ c: number }>(sql, params)
          return Number(row?.c ?? 0)
        } catch {
          return 0 // e.g. vector_embeddings not yet created
        }
      }

      // Snapshot counts + on-disk artifact paths BEFORE deleting.
      const embeddingsCount =
        (transcriptIds.length
          ? countOf(`SELECT COUNT(1) AS c FROM embeddings WHERE transcript_id IN (${tPlaceholders})`, transcriptIds)
          : 0) + countOf('SELECT COUNT(1) AS c FROM vector_embeddings WHERE recording_id = ?', [recordingId])
      const actionItemsCount = captureIds.length
        ? countOf(`SELECT COUNT(1) AS c FROM action_items WHERE knowledge_capture_id IN (${capPlaceholders})`, captureIds)
        : 0
      const artifactRows = captureIds.length
        ? queryAll<{ storage_path?: string | null }>(
            `SELECT storage_path FROM artifacts WHERE knowledge_capture_id IN (${capPlaceholders})`,
            captureIds
          )
        : []
      const speakerCount = countOf('SELECT COUNT(1) AS c FROM transcript_speakers WHERE recording_id = ?', [recordingId])
      const candidateCount = countOf(
        'SELECT COUNT(1) AS c FROM recording_meeting_candidates WHERE recording_id = ?',
        [recordingId]
      )

      // 1. Transcript embeddings, then transcripts.
      if (transcriptIds.length) {
        runNoSave(`DELETE FROM embeddings WHERE transcript_id IN (${tPlaceholders})`, transcriptIds)
      }
      runNoSave('DELETE FROM transcripts WHERE recording_id = ?', [recordingId])

      // 2. Vector chunks (DB rows; the service also clears the in-memory store).
      //    Table is created lazily by the vector store, so tolerate its absence.
      try {
        runNoSave('DELETE FROM vector_embeddings WHERE recording_id = ?', [recordingId])
      } catch {
        /* vector_embeddings not yet created — nothing to remove */
      }

      // 3. Knowledge captures + every child (FKs are OFF, so delete explicitly).
      if (captureIds.length) {
        for (const child of [
          'action_items',
          'decisions',
          'follow_ups',
          'outputs',
          'audio_sources',
          'conversation_context',
          'knowledge_projects',
          'artifacts',
          'actionables'
        ]) {
          const col = child === 'actionables' ? 'source_knowledge_id' : 'knowledge_capture_id'
          runNoSave(`DELETE FROM ${child} WHERE ${col} IN (${capPlaceholders})`, captureIds)
        }
        runNoSave(`DELETE FROM knowledge_captures WHERE id IN (${capPlaceholders})`, captureIds)
      }

      // 4. Speaker/identity data keyed by recording.
      runNoSave('DELETE FROM transcript_speakers WHERE recording_id = ?', [recordingId])
      runNoSave('DELETE FROM turn_speaker_overrides WHERE recording_id = ?', [recordingId])
      runNoSave('DELETE FROM speaker_splits WHERE recording_id = ?', [recordingId])
      runNoSave('DELETE FROM mention_resolutions WHERE recording_id = ?', [recordingId])

      // 5. Meeting candidates + processing/quality rows keyed by recording.
      runNoSave('DELETE FROM recording_meeting_candidates WHERE recording_id = ?', [recordingId])
      runNoSave('DELETE FROM transcription_queue WHERE recording_id = ?', [recordingId])
      runNoSave('DELETE FROM quality_assessments WHERE recording_id = ?', [recordingId])

      // 6. Pre-assignments (keyed by device filename) + synced_files (by filename).
      runNoSave('DELETE FROM recording_preassignments WHERE filename = ?', [rec.filename])
      if (rec.original_filename) {
        runNoSave('DELETE FROM synced_files WHERE original_filename = ?', [rec.original_filename])
      }
      runNoSave('DELETE FROM synced_files WHERE local_filename = ? OR file_path = ?', [
        rec.filename,
        rec.file_path
      ])

      // 7. Recompute the linked meeting's participants from what remains.
      let meetingLinksRemoved = 0
      if (rec.meeting_id) {
        meetingLinksRemoved = recomputeMeetingParticipants(rec.meeting_id, recordingId)
      }

      // 8. Finally the recording row itself, and an audit journal entry.
      runNoSave('DELETE FROM recordings WHERE id = ?', [recordingId])
      const removed = {
        transcripts: transcriptRows.length,
        embeddings: embeddingsCount,
        captures: captureIds.length,
        actionItems: actionItemsCount,
        artifacts: artifactRows.length,
        speakerBindings: speakerCount,
        candidates: candidateCount,
        meetingLinksRemoved
      }
      runNoSave(
        `INSERT INTO deletion_journal (id, recording_id, mode, recording_snapshot, removed_counts, created_at)
         VALUES (?, ?, 'hard', ?, ?, ?)`,
        [randomUUID(), recordingId, JSON.stringify(rec), JSON.stringify(removed), new Date().toISOString()]
      )

      return {
        mode: 'hard',
        recordingId,
        filename: rec.filename,
        originalFilename: rec.original_filename,
        filePath: rec.file_path,
        artifactPaths: artifactRows
          .map((a) => a.storage_path)
          .filter((p): p is string => !!p),
        removed
      }
    })
  )
}

/**
 * Restore a soft-deleted recording (undo). Clears `deleted_at` so it surfaces
 * again everywhere, and marks the journal row restored. Returns true if a
 * soft-deleted recording was restored, false otherwise. A hard-purged recording
 * cannot be restored (its rows and files are gone) — this returns false.
 */
export function restoreRecording(recordingId: string): boolean {
  const rec = queryOne<{ deleted_at?: string | null }>(
    'SELECT deleted_at FROM recordings WHERE id = ?',
    [recordingId]
  )
  if (!rec || !rec.deleted_at) return false
  const now = new Date().toISOString()
  runInTransaction(() => {
    runNoSave('UPDATE recordings SET deleted_at = NULL WHERE id = ?', [recordingId])
    runNoSave(
      `UPDATE deletion_journal SET restored_at = ?
        WHERE recording_id = ? AND mode = 'soft' AND restored_at IS NULL`,
      [now, recordingId]
    )
  })
  return true
}

/**
 * Resolve an ID coming from the renderer to a recordings row.
 * The renderer's unified view historically fell back to synced_files.id when
 * no recordings row was matched, so IDs arriving over IPC may belong to the
 * synced_files table. Resolve those to the real recording via filename.
 */
export function resolveRecordingId(id: string): Recording | undefined {
  const direct = getRecordingById(id)
  if (direct) return direct

  const synced = queryOne<{ original_filename: string; local_filename: string; file_path: string }>(
    'SELECT original_filename, local_filename, file_path FROM synced_files WHERE id = ?',
    [id]
  )
  if (!synced) return undefined

  const byLocal = getRecordingByFilenameVariants(synced.local_filename)
  if (byLocal) return byLocal
  return getRecordingByFilenameVariants(synced.original_filename)
}

export function getRecordingsForMeeting(meetingId: string): Recording[] {
  return queryAll<Recording>('SELECT * FROM recordings WHERE meeting_id = ?', [meetingId])
}

// Batch get recordings by IDs (avoids N+1 queries)
export function getRecordingsByIds(ids: string[]): Map<string, Recording> {
  if (ids.length === 0) return new Map()
  const placeholders = ids.map(() => '?').join(',')
  const recordings = queryAll<Recording>(
    `SELECT * FROM recordings WHERE id IN (${placeholders})`,
    ids
  )
  const map = new Map<string, Recording>()
  recordings.forEach(r => map.set(r.id, r))
  return map
}


// Get recording by filename (canonical identifier)
export function getRecordingByFilename(filename: string): Recording | undefined {
  return queryOne<Recording>('SELECT * FROM recordings WHERE filename = ?', [filename])
}

// Update recording lifecycle state
export function updateRecordingLifecycle(
  id: string,
  updates: Partial<Pick<Recording, 'location' | 'on_device' | 'on_local' | 'device_last_seen' | 'file_path' | 'transcription_status'>>
): void {
  const setClauses: string[] = []
  const values: unknown[] = []

  if (updates.location !== undefined) {
    setClauses.push('location = ?')
    values.push(updates.location)
  }
  if (updates.on_device !== undefined) {
    setClauses.push('on_device = ?')
    values.push(updates.on_device)
  }
  if (updates.on_local !== undefined) {
    setClauses.push('on_local = ?')
    values.push(updates.on_local)
  }
  if (updates.device_last_seen !== undefined) {
    setClauses.push('device_last_seen = ?')
    values.push(updates.device_last_seen)
  }
  if (updates.file_path !== undefined) {
    setClauses.push('file_path = ?')
    values.push(updates.file_path)
  }
  if (updates.transcription_status !== undefined) {
    setClauses.push('transcription_status = ?')
    values.push(updates.transcription_status)
  }

  if (setClauses.length > 0) {
    values.push(id)
    run(`UPDATE recordings SET ${setClauses.join(', ')} WHERE id = ?`, values)
  }
}

// Upsert recording from device - creates or updates based on filename
export function upsertRecordingFromDevice(deviceFile: {
  filename: string
  size: number
  duration: number
  dateCreated: Date
}): Recording {
  const existing = getRecordingByFilename(deviceFile.filename)
  const now = new Date().toISOString()

  if (existing) {
    // Update device presence and refresh duration from device (may have been calculated incorrectly before)
    const newLocation = existing.on_local ? 'both' : 'device-only'
    run(
      `UPDATE recordings SET on_device = 1, device_last_seen = ?, location = ?, file_size = ?, duration_seconds = ? WHERE id = ?`,
      [now, newLocation, deviceFile.size, deviceFile.duration, existing.id]
    )
    return { ...existing, on_device: 1, device_last_seen: now, location: newLocation as Recording['location'], duration_seconds: deviceFile.duration }
  } else {
    // Create new recording entry
    const id = crypto.randomUUID()
    run(
      `INSERT INTO recordings (id, filename, file_path, file_size, duration_seconds, date_recorded,
        status, location, transcription_status, on_device, device_last_seen, on_local, source, is_imported)
       VALUES (?, ?, NULL, ?, ?, ?, 'none', 'device-only', 'none', 1, ?, 0, 'hidock', 0)`,
      [id, deviceFile.filename, deviceFile.size, deviceFile.duration, deviceFile.dateCreated.toISOString(), now]
    )
    return getRecordingById(id)!
  }
}

// Mark recordings as no longer on device
export function markRecordingsNotOnDevice(presentFilenames: string[]): void {
  if (presentFilenames.length === 0) return

  // Get all recordings marked as on_device
  const onDevice = queryAll<Recording>('SELECT * FROM recordings WHERE on_device = 1')

  for (const rec of onDevice) {
    if (!presentFilenames.includes(rec.filename)) {
      const newLocation = rec.on_local ? 'local-only' : 'deleted'
      updateRecordingLifecycle(rec.id, {
        on_device: 0,
        location: newLocation as Recording['location']
      })
    }
  }
}

// Get all recordings with unified view
export function getAllRecordingsUnified(): Recording[] {
  return queryAll<Recording>(`
    SELECT * FROM recordings
    ORDER BY date_recorded DESC
  `)
}

// Known audio extensions a recording may exist under (.hda on device, .wav/.mp3 locally)
const RECORDING_EXTENSIONS = ['hda', 'wav', 'mp3', 'm4a']

/**
 * Find a recording row by filename, tolerating extension differences.
 * Device files are .hda while downloads are saved as .wav/.mp3, so rows may
 * exist under any variant of the same base name.
 */
export function getRecordingByFilenameVariants(filename: string): Recording | undefined {
  const exact = getRecordingByFilename(filename)
  if (exact) return exact

  const base = filename.replace(/\.(hda|wav|mp3|m4a|aac|ogg|flac)$/i, '')
  for (const ext of RECORDING_EXTENSIONS) {
    const variant = `${base}.${ext}`
    if (variant === filename) continue
    const match = getRecordingByFilename(variant)
    if (match) return match
  }
  return undefined
}

// Mark recording as downloaded.
// Upserts: if no row exists yet (device scan didn't create one and the file
// watcher hasn't fired), create it here so the download path never depends on
// a race with other row-creation paths. Returns the recording id.
export function markRecordingDownloaded(
  filename: string,
  localPath: string,
  opts?: { fileSize?: number; dateRecorded?: string }
): string {
  const localBasename = localPath.replace(/^.*[\\/]/, '')
  const recording = getRecordingByFilenameVariants(filename) ?? getRecordingByFilenameVariants(localBasename)

  if (recording) {
    const newLocation = recording.on_device ? 'both' : 'local-only'
    updateRecordingLifecycle(recording.id, {
      file_path: localPath,
      on_local: 1,
      location: newLocation as Recording['location']
    })
    return recording.id
  }

  // No row exists — create one. A download implies the file was on the device.
  const id = crypto.randomUUID()
  const now = new Date().toISOString()
  run(
    `INSERT INTO recordings (id, filename, original_filename, file_path, file_size,
      duration_seconds, date_recorded, status, location, transcription_status,
      on_device, device_last_seen, on_local, source, is_imported)
     VALUES (?, ?, ?, ?, ?, NULL, ?, 'none', 'both', 'none', 1, ?, 1, 'hidock', 0)`,
    [id, localBasename, filename, localPath, opts?.fileSize ?? null, opts?.dateRecorded ?? now, now]
  )
  return id
}

// ---------------------------------------------------------------------------
// Recording pre-assignments (v31) — in-advance attribution for the live capture.
// Keyed by the device's in-progress filename. A NULL meeting_id means the user
// explicitly marked the recording standalone (block time-overlap auto-link).
// ---------------------------------------------------------------------------

export interface RecordingPreassignment {
  filename: string
  meeting_id: string | null
  created_at?: string
}

/** Store (or replace) the user's attribution choice for a live recording filename. */
export function setRecordingPreassignment(filename: string, meetingId: string | null): void {
  run(
    `INSERT OR REPLACE INTO recording_preassignments (filename, meeting_id, created_at)
     VALUES (?, ?, CURRENT_TIMESTAMP)`,
    [filename, meetingId]
  )
}

/** Read the attribution choice for a filename, or undefined when none is set. */
export function getRecordingPreassignment(filename: string): RecordingPreassignment | undefined {
  return queryOne<RecordingPreassignment>(
    `SELECT filename, meeting_id, created_at FROM recording_preassignments WHERE filename = ?`,
    [filename]
  )
}

/** Remove an attribution choice (also called once it has been applied on download). */
export function clearRecordingPreassignment(filename: string): void {
  run(`DELETE FROM recording_preassignments WHERE filename = ?`, [filename])
}

/** All pending attribution choices — used by the auto-linker to consume them. */
export function getAllRecordingPreassignments(): RecordingPreassignment[] {
  return queryAll<RecordingPreassignment>(
    `SELECT filename, meeting_id, created_at FROM recording_preassignments`
  )
}

// Delete recording file from local storage (keeps metadata if transcribed)
export function deleteRecordingLocal(id: string): void {
  const recording = getRecordingById(id)
  if (!recording) return

  const newLocation = recording.on_device ? 'device-only' : 'deleted'
  updateRecordingLifecycle(id, {
    file_path: null,
    on_local: 0,
    location: newLocation as Recording['location']
  })
}

export function insertRecording(recording: Omit<Recording, 'created_at'>): void {
  // Lifecycle columns (location/on_device/on_local/...) must be written explicitly:
  // the DDL defaults are device-oriented ('device-only', on_device=1, on_local=0),
  // which silently mislabels locally-created rows if these fields are dropped.
  run(
    `INSERT INTO recordings (id, filename, original_filename, file_path, file_size,
      duration_seconds, date_recorded, meeting_id, correlation_confidence,
      correlation_method, status, location, transcription_status, on_device,
      on_local, source, is_imported)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      recording.id,
      recording.filename,
      recording.original_filename ?? null,
      recording.file_path,
      recording.file_size ?? null,
      recording.duration_seconds ?? null,
      recording.date_recorded,
      recording.meeting_id ?? null,
      recording.correlation_confidence ?? null,
      recording.correlation_method ?? null,
      recording.status,
      recording.location ?? (recording.file_path ? 'local-only' : 'device-only'),
      recording.transcription_status ?? 'none',
      recording.on_device ?? (recording.file_path ? 0 : 1),
      recording.on_local ?? (recording.file_path ? 1 : 0),
      recording.source ?? 'hidock',
      recording.is_imported ?? 0
    ]
  )
}

export function updateRecordingStatus(id: string, status: string): void {
  run('UPDATE recordings SET status = ? WHERE id = ?', [status, id])
}

export function updateRecordingTranscriptionStatus(id: string, transcriptionStatus: string): void {
  run('UPDATE recordings SET transcription_status = ? WHERE id = ?', [transcriptionStatus, id])
}

/**
 * BUG B self-heal (idempotent): advance recordings.status to 'complete' for any
 * recording that already has a joined transcript with non-empty full_text but
 * whose status drifted (stuck at its insert-time default because the pipeline
 * historically only wrote transcription_status). The meeting-detail badge reads
 * recordings.status, so a drifted row showed "Not transcribed" over a real
 * transcript. Runs at boot (reconcileOrganization) and is exposed via IPC.
 *
 * Safe + idempotent: never touches deleted rows (status 'deleted' / deleted_at),
 * never re-touches rows already 'complete', and a second run heals nothing.
 * Returns the number of rows healed.
 */
export function healRecordingStatusFromTranscripts(): number {
  const before = queryOne<{ n: number }>(
    `SELECT COUNT(*) AS n FROM recordings r
       WHERE r.status IS NOT 'complete'
         AND r.status IS NOT 'deleted'
         AND r.deleted_at IS NULL
         AND EXISTS (
           SELECT 1 FROM transcripts t
            WHERE t.recording_id = r.id
              AND t.full_text IS NOT NULL
              AND TRIM(t.full_text) != ''
         )`
  )
  const count = before?.n ?? 0
  if (count === 0) return 0

  run(
    `UPDATE recordings SET status = 'complete'
       WHERE status IS NOT 'complete'
         AND status IS NOT 'deleted'
         AND deleted_at IS NULL
         AND EXISTS (
           SELECT 1 FROM transcripts t
            WHERE t.recording_id = recordings.id
              AND t.full_text IS NOT NULL
              AND TRIM(t.full_text) != ''
         )`
  )
  console.log(`[DB] healRecordingStatusFromTranscripts: advanced ${count} recording(s) to status='complete'`)
  return count
}

/**
 * Persist a recording's duration (seconds). Imported/watched local files are
 * stored with duration_seconds = NULL; the renderer decodes the audio for the
 * waveform and backfills the real duration here. Only writes when the value is
 * a positive, finite number and differs from what's stored.
 */
export function updateRecordingDuration(id: string, durationSeconds: number): void {
  if (!Number.isFinite(durationSeconds) || durationSeconds <= 0) return
  const rounded = Math.round(durationSeconds)
  const existing = queryOne<{ duration_seconds: number | null }>(
    'SELECT duration_seconds FROM recordings WHERE id = ?',
    [id]
  )
  if (existing && existing.duration_seconds === rounded) return
  run('UPDATE recordings SET duration_seconds = ? WHERE id = ?', [rounded, id])
}

/** Strip a trailing audio extension so a .wav download matches its .hda source. */
function durationBaseFilename(filename: string): string {
  return filename.replace(/\.(hda|wav|mp3|m4a|aac|ogg|flac|webm|opus|wma)$/i, '')
}

/**
 * Largest segment end-time (seconds) in a stored `transcripts.speakers` JSON
 * array of `{ start, end }` turns, used as a lower-bound duration fallback.
 * Exported for unit testing. Returns 0 when the input has no usable timing.
 */
export function maxTranscriptSegmentEnd(speakersJson: string | null | undefined): number {
  if (!speakersJson) return 0
  try {
    const segments = JSON.parse(speakersJson)
    if (!Array.isArray(segments)) return 0
    let max = 0
    for (const seg of segments) {
      const end = typeof seg?.end === 'number' ? seg.end : typeof seg?.start === 'number' ? seg.start : 0
      if (Number.isFinite(end) && end > max) max = end
    }
    return max
  } catch {
    return 0
  }
}

/**
 * One-time (idempotent) backfill of `recordings.duration_seconds` for rows the
 * download/import paths stored as NULL. Uses the cheapest reliable sources that
 * already live in the DB — no new dependency, no audio decode, works offline:
 *
 *   1. the device-file cache duration (matched by base filename), then
 *   2. the transcript's last segment end (a lower bound).
 *
 * Persisting the value makes client-side sort/filter-by-duration in the Library
 * work even when the device is disconnected (the UI reads duration_seconds into
 * UnifiedRecording.duration). Safe to run on every Library mount:
 * `updateRecordingDuration` no-ops when the value is unchanged.
 */
export function backfillRecordingDurations(): { scanned: number; updated: number } {
  const rows = queryAll<{ id: string; filename: string }>(
    `SELECT id, filename FROM recordings
     WHERE (duration_seconds IS NULL OR duration_seconds <= 0) AND deleted_at IS NULL`
  )
  if (rows.length === 0) return { scanned: 0, updated: 0 }

  // Index the device cache by base filename so .wav downloads match .hda sources.
  const cacheRows = queryAll<{ filename: string; duration_seconds: number | null }>(
    'SELECT filename, duration_seconds FROM device_files_cache WHERE duration_seconds IS NOT NULL AND duration_seconds > 0'
  )
  const cacheByBase = new Map<string, number>()
  for (const c of cacheRows) {
    if (c.duration_seconds && c.duration_seconds > 0) {
      cacheByBase.set(durationBaseFilename(c.filename), c.duration_seconds)
    }
  }

  let updated = 0
  for (const row of rows) {
    let seconds = cacheByBase.get(durationBaseFilename(row.filename)) ?? 0

    if (seconds <= 0) {
      const t = queryOne<{ speakers: string | null }>(
        'SELECT speakers FROM transcripts WHERE recording_id = ? LIMIT 1',
        [row.id]
      )
      seconds = maxTranscriptSegmentEnd(t?.speakers)
    }

    if (seconds > 0) {
      updateRecordingDuration(row.id, seconds)
      updated++
    }
  }

  if (updated > 0) {
    console.log(`[duration-backfill] populated duration_seconds for ${updated}/${rows.length} recording(s)`)
  }
  return { scanned: rows.length, updated }
}

/**
 * Conservative "low-value" classifier so the Library's clean-up filter has data.
 *
 * Deliberately narrow to avoid mislabeling anything the user might want: a
 * capture is marked `low-value` ONLY when its source recording is very short
 * (< 20s, after the duration backfill) AND it carries no meaningful transcript
 * (missing, or fewer than 20 words) AND it isn't linked to a calendar meeting.
 * Everything ambiguous stays `unrated`. Never downgrades a rating the user set
 * (only touches rows still at the default `unrated`). Idempotent.
 *
 * Returns the number of captures newly marked low-value. `valuable` is left to
 * explicit user/AI action — we don't over-claim value automatically.
 */
export function classifyLowValueCaptures(): { scanned: number; markedLowValue: number } {
  const rows = queryAll<{
    id: string
    duration_seconds: number | null
    meeting_id: string | null
    word_count: number | null
    has_transcript: number
  }>(
    `SELECT kc.id AS id,
            r.duration_seconds AS duration_seconds,
            kc.meeting_id AS meeting_id,
            t.word_count AS word_count,
            CASE WHEN t.id IS NULL THEN 0 ELSE 1 END AS has_transcript
     FROM knowledge_captures kc
     JOIN recordings r ON r.id = kc.source_recording_id
     LEFT JOIN transcripts t ON t.recording_id = kc.source_recording_id
     WHERE kc.quality_rating = 'unrated'
       AND kc.deleted_at IS NULL
       AND COALESCE(r.personal, 0) = 0`
  )
  if (rows.length === 0) return { scanned: 0, markedLowValue: 0 }

  let marked = 0
  for (const row of rows) {
    const duration = row.duration_seconds ?? 0
    const words = row.word_count ?? 0
    const isShort = duration > 0 && duration < 20
    const negligibleTranscript = row.has_transcript === 0 || words < 20
    const linkedToMeeting = !!row.meeting_id

    if (isShort && negligibleTranscript && !linkedToMeeting) {
      run(
        `UPDATE knowledge_captures
         SET quality_rating = 'low-value', quality_confidence = 0.6, quality_assessed_at = ?
         WHERE id = ? AND quality_rating = 'unrated'`,
        [new Date().toISOString(), row.id]
      )
      marked++
    }
  }

  if (marked > 0) {
    console.log(`[quality-classify] marked ${marked}/${rows.length} capture(s) low-value (short + no transcript)`)
  }
  return { scanned: rows.length, markedLowValue: marked }
}

export function linkRecordingToMeeting(
  recordingId: string,
  meetingId: string,
  confidence: number,
  method: string
): void {
  // Update the recording's meeting link
  run(
    `UPDATE recordings SET meeting_id = ?, correlation_confidence = ?, correlation_method = ? WHERE id = ?`,
    [meetingId, confidence, method, recordingId]
  )

  // AUD2-001: Propagate meeting_id to knowledge_captures that reference this recording
  run(
    `UPDATE knowledge_captures
     SET meeting_id = ?,
         correlation_confidence = ?,
         correlation_method = ?,
         updated_at = CURRENT_TIMESTAMP
     WHERE source_recording_id = ?
       AND (meeting_id IS NULL OR meeting_id != ?)`,
    [meetingId, confidence, method, recordingId, meetingId]
  )
}

// Transcript queries
export interface Transcript {
  id: string
  recording_id: string
  full_text: string
  language: string
  summary?: string
  action_items?: string
  topics?: string
  key_points?: string
  sentiment?: string
  speakers?: string
  word_count?: number
  transcription_provider?: string
  transcription_model?: string
  title_suggestion?: string
  question_suggestions?: string
  created_at: string
}

export function getTranscriptByRecordingId(recordingId: string): Transcript | undefined {
  return queryOne<Transcript>('SELECT * FROM transcripts WHERE recording_id = ?', [recordingId])
}

/**
 * Batch get transcripts by recording IDs - avoids N+1 query problem
 */
export function getTranscriptsByRecordingIds(recordingIds: string[]): Map<string, Transcript> {
  if (recordingIds.length === 0) return new Map()

  // SQLite has a limit on SQL query length, so batch in chunks of 100
  const results = new Map<string, Transcript>()
  const chunkSize = 100

  for (let i = 0; i < recordingIds.length; i += chunkSize) {
    const chunk = recordingIds.slice(i, i + chunkSize)
    const placeholders = chunk.map(() => '?').join(',')
    const transcripts = queryAll<Transcript>(
      `SELECT * FROM transcripts WHERE recording_id IN (${placeholders})`,
      chunk
    )

    for (const transcript of transcripts) {
      results.set(transcript.recording_id, transcript)
    }
  }

  return results
}

export function insertTranscript(transcript: Omit<Transcript, 'created_at'>): void {
  run(
    `INSERT OR REPLACE INTO transcripts (id, recording_id, full_text, language, summary, action_items,
      topics, key_points, sentiment, speakers, word_count, transcription_provider, transcription_model,
      title_suggestion, question_suggestions)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      transcript.id,
      transcript.recording_id,
      transcript.full_text,
      transcript.language,
      transcript.summary ?? null,
      transcript.action_items ?? null,
      transcript.topics ?? null,
      transcript.key_points ?? null,
      transcript.sentiment ?? null,
      transcript.speakers ?? null,
      transcript.word_count ?? null,
      transcript.transcription_provider ?? null,
      transcript.transcription_model ?? null,
      transcript.title_suggestion ?? null,
      transcript.question_suggestions ?? null
    ]
  )
}

/**
 * Escape special LIKE pattern characters to prevent SQL injection via wildcards.
 * In SQLite LIKE, % matches any sequence and _ matches any single character.
 * We escape them with \ and specify ESCAPE '\' in the query.
 */
export function escapeLikePattern(pattern: string): string {
  return pattern
    .replace(/\\/g, '\\\\')  // Escape backslash first
    .replace(/%/g, '\\%')     // Escape percent
    .replace(/_/g, '\\_')     // Escape underscore
}

// Full-text search (simple LIKE-based for sql.js)
export function searchTranscripts(query: string): Transcript[] {
  const escaped = escapeLikePattern(query)
  return queryAll<Transcript>(
    `SELECT * FROM transcripts WHERE full_text LIKE ? ESCAPE '\\' OR summary LIKE ? ESCAPE '\\' OR topics LIKE ? ESCAPE '\\'`,
    [`%${escaped}%`, `%${escaped}%`, `%${escaped}%`]
  )
}

/** One transcript excerpt where a name literally occurs — the primary source a
 *  reviewer reads to decide identity. */
export interface MentionSnippet {
  recordingId: string
  title: string
  date: string | null
  snippet: string
}

/** Result of {@link getMentionSnippets}: capped excerpts + the FULL set of recording
 *  ids whose transcript contains the name (so co-presence can be intersected exactly). */
export interface MentionResult {
  snippets: MentionSnippet[]
  recordingIds: string[]
}

/** Collapse whitespace and cut a ~`radius`-char window around the first case-insensitive
 *  hit of `name`, adding ellipses. Falls back to the head of the text if no hit. */
export function extractSnippet(text: string, name: string, radius = 60): string {
  const clean = (text || '').replace(/\s+/g, ' ').trim()
  if (!clean) return ''
  const idx = clean.toLowerCase().indexOf(name.trim().toLowerCase())
  if (idx < 0) {
    return clean.length > radius * 2 ? clean.slice(0, radius * 2) + '…' : clean
  }
  const start = Math.max(0, idx - radius)
  const end = Math.min(clean.length, idx + name.trim().length + radius)
  return (start > 0 ? '…' : '') + clean.slice(start, end) + (end < clean.length ? '…' : '')
}

/**
 * Primary-source evidence for a candidate name: transcript excerpts where the name
 * literally occurs (capped at `limit`, newest first) plus the full set of recording
 * ids that contain it. LIKE wildcards in the name are escaped ({@link escapeLikePattern}).
 * The renderer intersects two names' `recordingIds` to detect co-presence (both names
 * in one conversation → likely different people).
 */
export function getMentionSnippets(name: string, limit = 2): MentionResult {
  const trimmed = (name || '').trim()
  if (!trimmed) return { snippets: [], recordingIds: [] }
  const pattern = `%${escapeLikePattern(trimmed)}%`

  const idRows = queryAll<{ recording_id: string }>(
    `SELECT recording_id FROM transcripts WHERE full_text LIKE ? ESCAPE '\\'`,
    [pattern]
  )
  const recordingIds = idRows.map((r) => r.recording_id)

  const cap = Math.max(1, Math.min(Math.floor(limit) || 2, 10))
  const rows = queryAll<{ recording_id: string; full_text: string; title: string | null; date: string | null }>(
    `SELECT t.recording_id AS recording_id, t.full_text AS full_text,
            COALESCE(t.title_suggestion, m.subject, r.filename) AS title,
            r.date_recorded AS date
       FROM transcripts t
       JOIN recordings r ON r.id = t.recording_id
       LEFT JOIN meetings m ON m.id = r.meeting_id
      WHERE t.full_text LIKE ? ESCAPE '\\'
      ORDER BY r.date_recorded DESC
      LIMIT ?`,
    [pattern, cap]
  )

  const snippets = rows.map((row) => ({
    recordingId: row.recording_id,
    title: row.title ?? 'Untitled recording',
    date: row.date,
    snippet: extractSnippet(row.full_text, trimmed)
  }))
  return { snippets, recordingIds }
}

// Embedding queries
export interface Embedding {
  id: string
  transcript_id: string
  chunk_index: number
  chunk_text: string
  embedding: Uint8Array
  created_at: string
}

export function insertEmbedding(embedding: Omit<Embedding, 'created_at'>): void {
  run(
    `INSERT INTO embeddings (id, transcript_id, chunk_index, chunk_text, embedding) VALUES (?, ?, ?, ?, ?)`,
    [embedding.id, embedding.transcript_id, embedding.chunk_index, embedding.chunk_text, embedding.embedding]
  )
}

export function getEmbeddingsForTranscript(transcriptId: string): Embedding[] {
  return queryAll<Embedding>('SELECT * FROM embeddings WHERE transcript_id = ? ORDER BY chunk_index', [transcriptId])
}

export function getAllEmbeddings(): Embedding[] {
  return queryAll<Embedding>('SELECT * FROM embeddings')
}

// Queue queries
export interface QueueItem {
  id: string
  recording_id: string
  status: string
  attempts: number
  retry_count: number
  progress: number
  error_message?: string
  provider?: string
  created_at: string
  started_at?: string
  completed_at?: string
}

export function addToQueue(recordingId: string, provider?: string): string {
  // Honor the privacy flags at the single enqueue chokepoint: a personal
  // ("ignored") or soft-deleted recording is never transcribed. Every path
  // (auto-transcribe, manual, bulk backlog) funnels through here.
  const rec = queryOne<{ personal?: number; deleted_at?: string | null }>(
    'SELECT personal, deleted_at FROM recordings WHERE id = ?',
    [recordingId]
  )
  if (rec && (rec.personal === 1 || rec.deleted_at)) {
    console.log(`[Transcription] Skipping enqueue of personal/deleted recording ${recordingId}`)
    return ''
  }
  const id = crypto.randomUUID()
  run(
    'INSERT INTO transcription_queue (id, recording_id, provider) VALUES (?, ?, ?)',
    [id, recordingId, provider ?? null]
  )
  return id
}

export function getQueueItems(status?: string): (QueueItem & { filename?: string; date_recorded?: string })[] {
  // Recency-first: newest recording (date_recorded) first, so a fresh recording
  // preempts a month-old backlog. Tiebreak FIFO by queue created_at. The
  // transcription service re-orders pending items to hoist user-explicit
  // requests ahead of this backlog (see orderPendingForProcessing); the
  // date_recorded column is returned so it can do so without a second query.
  const sql = `
    SELECT tq.*, r.filename, r.date_recorded
    FROM transcription_queue tq
    LEFT JOIN recordings r ON tq.recording_id = r.id
    ${status ? 'WHERE tq.status = ?' : ''}
    ORDER BY r.date_recorded DESC, tq.created_at ASC`
  if (status) {
    return queryAll<QueueItem & { filename?: string; date_recorded?: string }>(sql, [status])
  }
  return queryAll<QueueItem & { filename?: string; date_recorded?: string }>(sql)
}

export function updateQueueItem(id: string, status: string, errorMessage?: string): void {
  if (status === 'processing') {
    run('UPDATE transcription_queue SET status = ?, started_at = CURRENT_TIMESTAMP, attempts = attempts + 1 WHERE id = ?', [
      status,
      id
    ])
  } else if (status === 'completed' || status === 'failed') {
    run('UPDATE transcription_queue SET status = ?, completed_at = CURRENT_TIMESTAMP, error_message = ? WHERE id = ?', [
      status,
      errorMessage ?? null,
      id
    ])
  } else if (status === 'pending') {
    // When retrying, increment retry_count and reset progress
    run('UPDATE transcription_queue SET status = ?, retry_count = retry_count + 1, progress = 0 WHERE id = ?', [status, id])
  } else {
    run('UPDATE transcription_queue SET status = ? WHERE id = ?', [status, id])
  }
}

export function updateQueueProgress(id: string, progress: number): void {
  // Clamp progress between 0 and 100
  const clampedProgress = Math.max(0, Math.min(100, Math.round(progress)))
  run('UPDATE transcription_queue SET progress = ? WHERE id = ?', [clampedProgress, id])
}

export function removeFromQueue(id: string): void {
  run('DELETE FROM transcription_queue WHERE id = ?', [id])
}

export function removeFromQueueByRecordingId(recordingId: string): void {
  run('DELETE FROM transcription_queue WHERE recording_id = ?', [recordingId])
}

export function cancelPendingTranscriptions(): number {
  const pending = getQueueItems('pending')
  const processing = getQueueItems('processing')
  run("DELETE FROM transcription_queue WHERE status = 'pending'")
  run("UPDATE transcription_queue SET status = 'cancelled' WHERE status = 'processing'")
  for (const item of pending) {
    updateRecordingTranscriptionStatus(item.recording_id, 'none')
  }
  for (const item of processing) {
    updateRecordingTranscriptionStatus(item.recording_id, 'none')
  }
  return pending.length + processing.length
}

// Chat queries
export interface ChatMessage {
  id: string
  role: 'user' | 'assistant'
  content: string
  sources?: string
  created_at: string
}

export function getChatHistory(limit = 50): ChatMessage[] {
  return queryAll<ChatMessage>('SELECT * FROM chat_messages ORDER BY created_at DESC LIMIT ?', [limit]).reverse()
}

export function addChatMessage(role: 'user' | 'assistant', content: string, sources?: string): string {
  const id = crypto.randomUUID()
  run('INSERT INTO chat_messages (id, role, content, sources) VALUES (?, ?, ?, ?)', [id, role, content, sources ?? null])
  return id
}

export function clearChatHistory(): void {
  run('DELETE FROM chat_messages', [])
}

// Synced files queries - track which device files have been downloaded
export interface SyncedFile {
  id: string
  original_filename: string
  local_filename: string
  file_path: string
  file_size?: number
  synced_at: string
}

export function isFileSynced(originalFilename: string): boolean {
  const result = queryOne<{ count: number }>('SELECT COUNT(*) as count FROM synced_files WHERE original_filename = ?', [
    originalFilename
  ])
  return (result?.count ?? 0) > 0
}

export function getSyncedFile(originalFilename: string): SyncedFile | undefined {
  return queryOne<SyncedFile>('SELECT * FROM synced_files WHERE original_filename = ?', [originalFilename])
}

export function getAllSyncedFiles(): SyncedFile[] {
  return queryAll<SyncedFile>('SELECT * FROM synced_files ORDER BY synced_at DESC')
}

export function addSyncedFile(
  originalFilename: string,
  localFilename: string,
  filePath: string,
  fileSize?: number
): string {
  const id = crypto.randomUUID()
  run(
    'INSERT OR REPLACE INTO synced_files (id, original_filename, local_filename, file_path, file_size) VALUES (?, ?, ?, ?, ?)',
    [id, originalFilename, localFilename, filePath, fileSize ?? null]
  )
  return id
}

export function removeSyncedFile(originalFilename: string): void {
  run('DELETE FROM synced_files WHERE original_filename = ?', [originalFilename])
}

/**
 * Clear all synced file records from the database.
 * Used when cleaning up wrongly-named files for re-download.
 */
export function clearAllSyncedFiles(): number {
  const countBefore = queryOne<{ count: number }>('SELECT COUNT(*) as count FROM synced_files')?.count ?? 0
  run('DELETE FROM synced_files')
  console.log(`Cleared ${countBefore} synced file records from database`)
  return countBefore
}

// Get all synced filenames as a Set for quick lookup
export function getSyncedFilenames(): Set<string> {
  const files = queryAll<{ original_filename: string }>('SELECT original_filename FROM synced_files')
  return new Set(files.map((f) => f.original_filename))
}

// =============================================================================
// Device files cache queries - persist device file list for offline viewing
// =============================================================================

export interface DeviceCacheEntry {
  id: string
  filename: string
  file_size?: number
  duration_seconds?: number
  date_recorded: string
  cached_at: string
}

export function getDeviceFilesCache(): DeviceCacheEntry[] {
  return queryAll<DeviceCacheEntry>('SELECT * FROM device_files_cache ORDER BY date_recorded DESC')
}

export function saveDeviceFilesCache(files: Array<{
  filename: string
  size?: number
  file_size?: number
  duration_seconds?: number
  date_recorded: string
}>): void {
  // Clear existing cache
  run('DELETE FROM device_files_cache')

  // Insert new cache entries
  for (const file of files) {
    const id = `cache_${file.filename.replace(/[^a-zA-Z0-9]/g, '_')}`
    // Accept both 'size' and 'file_size' for flexibility
    const fileSize = file.size ?? file.file_size ?? null
    run(
      `INSERT OR REPLACE INTO device_files_cache (id, filename, file_size, duration_seconds, date_recorded)
       VALUES (?, ?, ?, ?, ?)`,
      [id, file.filename, fileSize, file.duration_seconds ?? null, file.date_recorded]
    )
  }
}

export function clearDeviceFilesCache(): void {
  run('DELETE FROM device_files_cache')
}

/**
 * Clear all meetings from the database atomically.
 * Use this to force a complete re-sync from ICS source.
 * Also clears recording→meeting links to prevent orphaned foreign keys.
 */
export function clearAllMeetings(): void {
  runInTransaction(() => {
    // Clear meeting-contact links (has ON DELETE CASCADE but explicit is safer)
    runNoSave('DELETE FROM meeting_contacts')
    // Clear recording-meeting candidates (has ON DELETE CASCADE)
    runNoSave('DELETE FROM recording_meeting_candidates')
    // Clear recording→meeting links to prevent orphaned FKs
    // This preserves the recordings but removes their meeting association
    runNoSave('UPDATE recordings SET meeting_id = NULL, correlation_confidence = NULL, correlation_method = NULL WHERE meeting_id IS NOT NULL')
    // Finally clear meetings
    runNoSave('DELETE FROM meetings')
  })
  console.log('[Database] Cleared all meetings and associated links')
}

/**
 * Clear all cached data (meetings + device cache) to force fresh sync.
 * Use when timezone or duration calculations have been fixed.
 */
export function clearAllCachedData(): void {
  clearDeviceFilesCache()
  clearAllMeetings()
  console.log('[Database] Cleared all cached data (device files + meetings)')
}

// =============================================================================
// Contact queries
// =============================================================================

export interface Contact {
  id: string
  name: string
  email: string | null
  type: string
  role: string | null
  company: string | null
  notes: string | null
  tags: string | null // JSON string
  first_seen_at: string
  last_seen_at: string
  meeting_count: number
  created_at: string
}

export type ContactRole = 'organizer' | 'attendee'

export interface MeetingContact {
  meeting_id: string
  contact_id: string
  role: ContactRole
}

export function getContacts(search?: string, type?: string, limit = 100, offset = 0): { contacts: Contact[]; total: number } {
  let countSql = 'SELECT COUNT(*) as count FROM contacts'
  let sql = 'SELECT * FROM contacts'
  const params: unknown[] = []
  const whereClauses: string[] = []

  if (search) {
    const escaped = escapeLikePattern(search)
    whereClauses.push("(name LIKE ? ESCAPE '\\' OR email LIKE ? ESCAPE '\\' OR company LIKE ? ESCAPE '\\' OR role LIKE ? ESCAPE '\\')")
    params.push(`%${escaped}%`, `%${escaped}%`, `%${escaped}%`, `%${escaped}%`)
  }

  if (type && type !== 'all') {
    whereClauses.push('type = ?')
    params.push(type)
  }

  if (whereClauses.length > 0) {
    const whereClause = ' WHERE ' + whereClauses.join(' AND ')
    countSql += whereClause
    sql += whereClause
  }

  sql += ' ORDER BY meeting_count DESC, last_seen_at DESC LIMIT ? OFFSET ?'

  const countResult = queryOne<{ count: number }>(countSql, params)
  const contacts = queryAll<Contact>(sql, [...params, limit, offset])

  return { contacts, total: countResult?.count ?? 0 }
}

export function getContactById(id: string): Contact | undefined {
  return queryOne<Contact>('SELECT * FROM contacts WHERE id = ?', [id])
}

/** Graph-neighborhood context for a person: closest co-attendees + topics/projects. */
export interface PersonContext {
  /** Co-attendee display names, most-shared-meetings first. */
  people: string[]
  /** Topic/project labels closest to the person. */
  topics: string[]
}

/** queryAll that returns [] if the graph tables are absent (pre-first-ingest). */
function safeGraphQuery<T>(sql: string, params: unknown[]): T[] {
  try {
    return queryAll<T>(sql, params)
  } catch {
    return []
  }
}

/**
 * Compact graph-neighborhood context for the identity merge card (B7 symmetric
 * context): the people this person most co-attends meetings with, and the
 * topics/projects closest to them. Accepts a contact id OR a raw name (resolver-band
 * candidates carry only a name). One cheap query set — resolve, co-attendees, then
 * topics via the knowledge graph (person node → ATTENDED → meeting → ABOUT → topic/
 * project), falling back to meeting_projects transitively before the graph exists.
 */
export function getPersonContext(idOrName: string, limit = 4): PersonContext {
  const raw = (idOrName || '').trim()
  if (!raw) return { people: [], topics: [] }
  const cap = Math.max(1, Math.min(Math.floor(limit) || 4, 10))

  // Resolve to a contact id + display name: id first, then exact normalized name.
  let contact = getContactById(raw)
  if (!contact) {
    const norm = raw.toLowerCase().replace(/\s+/g, ' ')
    contact = queryOne<Contact>('SELECT * FROM contacts WHERE LOWER(name) = ? LIMIT 1', [norm])
  }
  const contactId = contact?.id ?? null
  const normKey = (contact?.name ?? raw).toLowerCase().trim().replace(/\s+/g, ' ')

  const people = contactId
    ? queryAll<{ name: string }>(
        `SELECT c.name AS name, COUNT(*) AS shared
           FROM meeting_contacts mc1
           JOIN meeting_contacts mc2 ON mc2.meeting_id = mc1.meeting_id AND mc2.contact_id <> mc1.contact_id
           JOIN contacts c ON c.id = mc2.contact_id
          WHERE mc1.contact_id = ?
          GROUP BY mc2.contact_id
          ORDER BY shared DESC, c.name ASC
          LIMIT ?`,
        [contactId, cap]
      )
        .map((r) => r.name)
        .filter(Boolean)
    : []

  // Topics via the graph; fall back to the person's meeting projects when empty.
  let topics = safeGraphQuery<{ label: string }>(
    `SELECT DISTINCT t.label AS label
       FROM graph_nodes p
       JOIN graph_edges ea ON ea.source_id = p.id AND ea.type = 'ATTENDED'
       JOIN graph_nodes m  ON m.id = ea.target_id AND m.type = 'meeting'
       JOIN graph_edges ab ON ab.source_id = m.id AND ab.type = 'ABOUT'
       JOIN graph_nodes t  ON t.id = ab.target_id AND (t.type = 'topic' OR t.type = 'project')
      WHERE p.type = 'person' AND p.norm_key = ?
      LIMIT ?`,
    [normKey, cap]
  )
    .map((r) => r.label)
    .filter(Boolean)

  if (topics.length === 0 && contactId) {
    topics = safeGraphQuery<{ label: string }>(
      `SELECT DISTINCT pr.name AS label
         FROM meeting_contacts mc
         JOIN meeting_projects mp ON mp.meeting_id = mc.meeting_id
         JOIN projects pr ON pr.id = mp.project_id
        WHERE mc.contact_id = ?
        LIMIT ?`,
      [contactId, cap]
    )
      .map((r) => r.label)
      .filter(Boolean)
  }

  return { people, topics }
}

export function getContactByEmail(email: string): Contact | undefined {
  return queryOne<Contact>('SELECT * FROM contacts WHERE email = ?', [email])
}

/**
 * Batch get contacts by emails - avoids N+1 query problem.
 * Returns a Map of email -> Contact for quick lookup.
 */
export function getContactsByEmails(emails: string[]): Map<string, Contact> {
  if (emails.length === 0) return new Map()

  // Remove duplicates and nulls
  const uniqueEmails = [...new Set(emails.filter(Boolean))]
  if (uniqueEmails.length === 0) return new Map()

  const results = new Map<string, Contact>()
  const chunkSize = 100

  for (let i = 0; i < uniqueEmails.length; i += chunkSize) {
    const chunk = uniqueEmails.slice(i, i + chunkSize)
    const placeholders = chunk.map(() => '?').join(',')
    const contacts = queryAll<Contact>(
      `SELECT * FROM contacts WHERE email IN (${placeholders})`,
      chunk
    )

    for (const contact of contacts) {
      if (contact.email) {
        results.set(contact.email, contact)
      }
    }
  }

  return results
}

export function upsertContact(contact: Omit<Contact, 'created_at'>): Contact {
  const existing = contact.email ? getContactByEmail(contact.email) : undefined

  if (existing) {
    // Update existing contact
    run(
      `UPDATE contacts SET
        name = COALESCE(?, name),
        last_seen_at = ?,
        meeting_count = meeting_count + 1
      WHERE id = ?`,
      [contact.name, contact.last_seen_at, existing.id]
    )
    return { ...existing, name: contact.name, last_seen_at: contact.last_seen_at, meeting_count: existing.meeting_count + 1 }
  } else {
    // Insert new contact
    run(
      `INSERT INTO contacts (id, name, email, type, role, company, notes, tags, first_seen_at, last_seen_at, meeting_count)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        contact.id,
        contact.name,
        contact.email,
        contact.type || 'unknown',
        contact.role || null,
        contact.company || null,
        contact.notes || null,
        contact.tags || null,
        contact.first_seen_at,
        contact.last_seen_at,
        contact.meeting_count
      ]
    )
    return { ...contact, created_at: new Date().toISOString() } as Contact
  }
}

/**
 * Create a brand-new contact from explicit user input (the "Add Person" dialog).
 * Unlike {@link upsertContact} — which folds attendee sightings into an existing
 * email-matched row and bumps meeting_count — this always inserts a fresh row
 * with meeting_count 0, since a manually added person has no interactions yet.
 */
export function createContact(input: {
  name: string
  email?: string | null
  type?: string
  role?: string | null
  company?: string | null
  notes?: string | null
}): Contact {
  const id = randomUUID()
  const now = new Date().toISOString()
  const contact: Contact = {
    id,
    name: input.name,
    email: input.email ?? null,
    type: input.type || 'unknown',
    role: input.role ?? null,
    company: input.company ?? null,
    notes: input.notes ?? null,
    tags: null,
    first_seen_at: now,
    last_seen_at: now,
    meeting_count: 0,
    created_at: now
  }
  run(
    `INSERT INTO contacts (id, name, email, type, role, company, notes, tags, first_seen_at, last_seen_at, meeting_count)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      contact.id,
      contact.name,
      contact.email,
      contact.type,
      contact.role,
      contact.company,
      contact.notes,
      contact.tags,
      contact.first_seen_at,
      contact.last_seen_at,
      contact.meeting_count
    ]
  )
  return contact
}

export function updateContact(id: string, updates: Partial<Contact>): void {
  const fields: string[] = []
  const params: unknown[] = []

  if (updates.name !== undefined) { fields.push('name = ?'); params.push(updates.name); }
  if (updates.email !== undefined) { fields.push('email = ?'); params.push(updates.email); }
  if (updates.type !== undefined) { fields.push('type = ?'); params.push(updates.type); }
  if (updates.role !== undefined) { fields.push('role = ?'); params.push(updates.role); }
  if (updates.company !== undefined) { fields.push('company = ?'); params.push(updates.company); }
  if (updates.notes !== undefined) { fields.push('notes = ?'); params.push(updates.notes); }
  if (updates.tags !== undefined) { fields.push('tags = ?'); params.push(updates.tags); }

  if (fields.length === 0) return

  params.push(id)
  run(`UPDATE contacts SET ${fields.join(', ')} WHERE id = ?`, params)
}

export function updateContactNotes(id: string, notes: string | null): void {
  run('UPDATE contacts SET notes = ? WHERE id = ?', [notes, id])
}

export function getMeetingsForContact(contactId: string): Meeting[] {
  return queryAll<Meeting>(
    `SELECT m.* FROM meetings m
     JOIN meeting_contacts mc ON m.id = mc.meeting_id
     WHERE mc.contact_id = ?
     ORDER BY m.start_time DESC`,
    [contactId]
  )
}

export function getContactsForMeeting(meetingId: string): Contact[] {
  return queryAll<Contact>(
    `SELECT c.* FROM contacts c
     JOIN meeting_contacts mc ON c.id = mc.contact_id
     WHERE mc.meeting_id = ?`,
    [meetingId]
  )
}

export function deleteContact(id: string): void {
  // Remove junction table entries first, then the contact
  run('DELETE FROM meeting_contacts WHERE contact_id = ?', [id])
  run('DELETE FROM contacts WHERE id = ?', [id])
}

export function linkContactToMeeting(meetingId: string, contactId: string, role: ContactRole): void {
  run(
    'INSERT OR IGNORE INTO meeting_contacts (meeting_id, contact_id, role) VALUES (?, ?, ?)',
    [meetingId, contactId, role]
  )
}

/** Parse a contact.tags JSON string into a string array (empty on malformed). */
function parseContactTags(tags: string | null | undefined): string[] {
  if (!tags) return []
  try {
    const parsed = JSON.parse(tags)
    return Array.isArray(parsed) ? parsed.filter((t) => typeof t === 'string') : []
  } catch {
    return []
  }
}

/** Recompute a contact's meeting_count from its meeting_contacts links. */
function recomputeContactMeetingCount(contactId: string): void {
  runNoSave(
    'UPDATE contacts SET meeting_count = (SELECT COUNT(1) FROM meeting_contacts WHERE contact_id = ?) WHERE id = ?',
    [contactId, contactId]
  )
}

// =============================================================================
// Merge journal & unmerge (v30) — makes contact/project folds reversible
// =============================================================================

export type MergeKind = 'contact' | 'project'

/** A repointed junction row (the role is kept where the table carries one). */
interface RepointedLink {
  key: string // the "other" PK column value (meeting_id / knowledge_capture_id)
  role?: string
}

/** Contact-merge manifest: everything the fold touched, enough to reverse it. */
interface ContactMergeManifest {
  meetingContacts: { repointed: RepointedLink[]; collided: RepointedLink[] }
  transcriptSpeakers: { repointed: string[] } // transcript_speakers.id values moved
  createdAliasNorms: string[] // aliases the merge created (loser-name → keeper)
  loserAliases: Array<{ alias_norm: string; source: string | null; confidence: number | null }>
  keeperBefore: { meetingIds: string[]; speakerIds: string[] }
}

/** Project-merge manifest. */
interface ProjectMergeManifest {
  meetingProjects: { repointed: string[]; collided: string[] } // meeting_id values
  knowledgeProjects: { repointed: string[]; collided: string[] } // knowledge_capture_id values
  createdAliasNorms: string[]
  loserAliases: Array<{ alias_norm: string; source: string | null; confidence: number | null }>
  keeperBefore: { meetingIds: string[]; knowledgeIds: string[] }
}

/** A keeper link that appeared after the merge — the user must review it by hand. */
export interface OrphanLink {
  table: 'meeting_contacts' | 'transcript_speakers' | 'meeting_projects' | 'knowledge_projects'
  key: string
  label: string
  date: string | null
}

/** Result of an unmerge: what was restored + links the user must reassign manually. */
export interface UnmergeResult {
  loserId: string
  loserName: string
  restored: {
    meetingLinks: number
    speakerLinks: number
    knowledgeLinks: number
    aliases: number
    fieldsRestored: number
    skipped: number // manifest rows that no longer exist / were reassigned since merge
  }
  orphanedSinceMerge: OrphanLink[]
}

/** A merge-journal row surfaced to the UI (loser name parsed from the snapshot). */
export interface MergeJournalEntry {
  id: string
  kind: MergeKind
  keeperId: string
  loserId: string
  loserName: string
  createdAt: string
  undoneAt: string | null
  linkCount: number // repointed links recorded — a rough "size" of the merge
}

interface MergeJournalRow {
  id: string
  kind: MergeKind
  keeper_id: string
  /** Queryable loser identity (v42). Null only on pre-backfill legacy rows. */
  loser_id: string | null
  /** Explicit immutable merge order (v42). Null only on pre-backfill legacy rows. */
  seq: number | null
  loser_snapshot: string
  repointed_manifest: string
  folded_fields: string | null
  created_at: string
  undone_at: string | null
}

/**
 * Count the links that anchor an entity, used by the high-stakes merge gate:
 * merging two heavily-linked entities is the expensive mistake, so the UI warns
 * (and requires typing the loser's name) when BOTH sides exceed the threshold.
 * Contacts: meeting_contacts + transcript_speakers. Projects: meeting_projects +
 * knowledge_projects.
 */
export function getEntityLinkCount(kind: MergeKind, id: string): number {
  if (kind === 'contact') {
    const mc = queryOne<{ n: number }>('SELECT COUNT(1) AS n FROM meeting_contacts WHERE contact_id = ?', [id])
    const ts = queryOne<{ n: number }>('SELECT COUNT(1) AS n FROM transcript_speakers WHERE contact_id = ?', [id])
    return (mc?.n ?? 0) + (ts?.n ?? 0)
  }
  const mp = queryOne<{ n: number }>('SELECT COUNT(1) AS n FROM meeting_projects WHERE project_id = ?', [id])
  const kp = queryOne<{ n: number }>('SELECT COUNT(1) AS n FROM knowledge_projects WHERE project_id = ?', [id])
  return (mp?.n ?? 0) + (kp?.n ?? 0)
}

/** Link counts for both sides of a proposed merge (for the pre-merge warning). */
export function getMergeImpact(kind: MergeKind, keeperId: string, loserId: string): { keeper: number; loser: number } {
  return { keeper: getEntityLinkCount(kind, keeperId), loser: getEntityLinkCount(kind, loserId) }
}

/**
 * Merge two contacts into one. The keeper survives; the loser's relationships
 * are repointed and its useful fields folded in, then the loser row is deleted.
 * Runs atomically in a single transaction, which also writes a merge_journal row
 * so the fold can be reversed via {@link unmergeContacts}.
 *
 * Folding rules (keeper wins): email/role/company/notes filled from the loser
 * only when the keeper's is empty; type taken from the loser only when the
 * keeper's is 'unknown'; tags = union; first/last_seen widened to span both;
 * meeting_count recomputed from the merged meeting links.
 *
 * @throws if the ids are equal or either contact does not exist.
 */
export function mergeContacts(keeperId: string, loserId: string): Contact {
  if (keeperId === loserId) {
    throw new Error('Cannot merge a contact into itself')
  }

  let loserName = ''
  let keeperName = ''
  const merged = runInTransaction(() => {
    const keeper = queryOne<Contact>('SELECT * FROM contacts WHERE id = ?', [keeperId])
    const loser = queryOne<Contact>('SELECT * FROM contacts WHERE id = ?', [loserId])
    if (!keeper) throw new Error(`Keeper contact ${keeperId} not found`)
    if (!loser) throw new Error(`Loser contact ${loserId} not found`)
    loserName = loser.name
    keeperName = keeper.name

    // --- Capture the manifest BEFORE mutating, so unmerge can reverse exactly. ---
    const keeperMeetingIds = queryAll<{ meeting_id: string }>(
      'SELECT meeting_id FROM meeting_contacts WHERE contact_id = ?',
      [keeperId]
    ).map((r) => r.meeting_id)
    const keeperMeetingSet = new Set(keeperMeetingIds)
    const loserLinks = queryAll<{ meeting_id: string; role: string }>(
      'SELECT meeting_id, role FROM meeting_contacts WHERE contact_id = ?',
      [loserId]
    )
    const mcRepointed: RepointedLink[] = []
    const mcCollided: RepointedLink[] = []
    for (const l of loserLinks) {
      if (keeperMeetingSet.has(l.meeting_id)) mcCollided.push({ key: l.meeting_id, role: l.role })
      else mcRepointed.push({ key: l.meeting_id, role: l.role })
    }
    const keeperSpeakerIds = queryAll<{ id: string }>(
      'SELECT id FROM transcript_speakers WHERE contact_id = ?',
      [keeperId]
    ).map((r) => r.id)
    const loserSpeakerIds = queryAll<{ id: string }>(
      'SELECT id FROM transcript_speakers WHERE contact_id = ?',
      [loserId]
    ).map((r) => r.id)
    const loserAliases = queryAll<{ alias_norm: string; source: string | null; confidence: number | null }>(
      'SELECT alias_norm, source, confidence FROM contact_aliases WHERE contact_id = ?',
      [loserId]
    )
    const createdAliasNorm = normalizeName(loser.name)

    // Record the loser's name as a permanent alias of the keeper (v27) so a
    // future mention of that name resolves straight to the survivor.
    upsertContactAliasNoSave(keeperId, loser.name, 'merge', 1.0)

    // Repoint meeting_contacts (PK: meeting_id, contact_id). Move links that
    // won't collide with the keeper's, then drop leftover collisions.
    runNoSave('UPDATE OR IGNORE meeting_contacts SET contact_id = ? WHERE contact_id = ?', [keeperId, loserId])
    runNoSave('DELETE FROM meeting_contacts WHERE contact_id = ?', [loserId])

    // Repoint transcript_speakers. Its UNIQUE is (recording_id, speaker_label),
    // unaffected by contact_id, so a plain update never collides.
    runNoSave('UPDATE transcript_speakers SET contact_id = ? WHERE contact_id = ?', [keeperId, loserId])

    // Fold fields onto the keeper.
    const notEmpty = (v: string | null | undefined) => !!(v && v.trim())
    const email = notEmpty(keeper.email) ? keeper.email : loser.email ?? null
    const role = notEmpty(keeper.role) ? keeper.role : loser.role ?? null
    const company = notEmpty(keeper.company) ? keeper.company : loser.company ?? null
    const notes = notEmpty(keeper.notes) ? keeper.notes : loser.notes ?? null
    const type = keeper.type && keeper.type !== 'unknown' ? keeper.type : loser.type || 'unknown'
    const tags = [...new Set([...parseContactTags(keeper.tags), ...parseContactTags(loser.tags)])]
    const tagsJson = tags.length ? JSON.stringify(tags) : null
    const firstSeen = [keeper.first_seen_at, loser.first_seen_at].filter(Boolean).sort()[0] ?? keeper.first_seen_at
    const lastSeen = [keeper.last_seen_at, loser.last_seen_at].filter(Boolean).sort().slice(-1)[0] ?? keeper.last_seen_at

    // Diff keeper's before/after so unmerge can restore only the folded fields
    // (and only when the keeper still holds the folded value — no clobbering edits).
    const foldedFields = diffFoldedFields(
      {
        email: keeper.email,
        role: keeper.role,
        company: keeper.company,
        notes: keeper.notes,
        type: keeper.type,
        tags: keeper.tags,
        first_seen_at: keeper.first_seen_at,
        last_seen_at: keeper.last_seen_at
      },
      { email, role, company, notes, type, tags: tagsJson, first_seen_at: firstSeen, last_seen_at: lastSeen }
    )

    runNoSave(
      `UPDATE contacts SET email = ?, role = ?, company = ?, notes = ?, type = ?, tags = ?,
         first_seen_at = ?, last_seen_at = ? WHERE id = ?`,
      [email, role, company, notes, type, tagsJson, firstSeen, lastSeen, keeperId]
    )

    runNoSave('DELETE FROM contacts WHERE id = ?', [loserId])
    recomputeContactMeetingCount(keeperId)

    const manifest: ContactMergeManifest = {
      meetingContacts: { repointed: mcRepointed, collided: mcCollided },
      transcriptSpeakers: { repointed: loserSpeakerIds },
      createdAliasNorms: createdAliasNorm ? [createdAliasNorm] : [],
      loserAliases,
      keeperBefore: { meetingIds: keeperMeetingIds, speakerIds: keeperSpeakerIds }
    }
    writeMergeJournalNoSave('contact', keeperId, loser.id, loser, manifest, foldedFields)

    return queryOne<Contact>('SELECT * FROM contacts WHERE id = ?', [keeperId])!
  })

  // Living knowledge graph (v27): fold the loser's person node into the keeper's.
  // Emitted after the tx commits; graph-sync does label-level surgery (no LLM).
  try {
    getEventBus().emitDomainEvent({
      type: 'entity:contact-changed',
      timestamp: new Date().toISOString(),
      payload: { contactId: keeperId, change: 'merged', oldName: loserName, newName: keeperName }
    })
  } catch (e) {
    console.warn('[mergeContacts] contact-changed emit failed:', e)
  }

  return merged
}

/**
 * Diff a keeper's pre-merge column values against the folded (post-merge) values,
 * returning only the fields the merge actually changed, as { field: {from, to} }.
 * Unmerge restores `from` — but only where the keeper still holds `to` (so a newer
 * user edit is never clobbered). Values are compared/stored as their raw SQL form.
 */
function diffFoldedFields(
  before: Record<string, string | null>,
  after: Record<string, string | null>
): Record<string, { from: string | null; to: string | null }> {
  const folded: Record<string, { from: string | null; to: string | null }> = {}
  for (const key of Object.keys(after)) {
    const from = before[key] ?? null
    const to = after[key] ?? null
    if (from !== to) folded[key] = { from, to }
  }
  return folded
}

/** Insert a merge_journal row inside the merge's transaction (no auto-save). */
function writeMergeJournalNoSave(
  kind: MergeKind,
  keeperId: string,
  loserId: string,
  loserRow: unknown,
  manifest: ContactMergeManifest | ProjectMergeManifest,
  foldedFields: Record<string, { from: string | null; to: string | null }>
): void {
  // seq: explicit immutable merge order (v42) — assigned monotonically at write
  // time so the newest-first unmerge guard never depends on rowid or timestamps.
  runNoSave(
    `INSERT INTO merge_journal (id, kind, keeper_id, loser_id, seq, loser_snapshot, repointed_manifest, folded_fields, created_at)
     VALUES (?, ?, ?, ?, (SELECT COALESCE(MAX(seq), 0) + 1 FROM merge_journal), ?, ?, ?, ?)`,
    [
      randomUUID(),
      kind,
      keeperId,
      loserId,
      JSON.stringify(loserRow),
      JSON.stringify(manifest),
      Object.keys(foldedFields).length ? JSON.stringify(foldedFields) : null,
      new Date().toISOString()
    ]
  )
}

/**
 * Typed ordering failure for unmerge: a newer, still-open merge depends on one
 * of this journal's entities. Carries the blocking journal's id (and its
 * loser's display name when parseable) so the IPC layer can surface a precise,
 * actionable rejection instead of a generic database error.
 */
export class MergeOrderConflictError extends Error {
  constructor(
    public readonly blockingJournalId: string,
    public readonly blockingLoserName: string | null,
    message: string
  ) {
    super(message)
    this.name = 'MergeOrderConflictError'
  }
}

/**
 * Dependency-aware newest-first guard, shared by {@link unmergeContacts} and
 * {@link unmergeProjects}. Journals are delta-based: folded_fields records the
 * change from the state the PREVIOUS merge left behind, and a merge's manifest
 * assumes its keeper/loser rows exist exactly as the merges before it arranged
 * them. Undoing a journal while a NEWER open journal touches either of its
 * entities therefore corrupts state two ways:
 *   - same keeper: an older restore rewinds folded fields (origin, tags) out
 *     from under the newer merge's still-folded data (provenance laundering);
 *   - keeper-of-keeper chains: J1 = A->D, then J2 = D->E deletes D. Unmerging
 *     J1 first "recreates" A against a keeper that no longer exists, skipping
 *     every link move, while J2's snapshot of D still contains A's folded data
 *     — duplication and misattribution on the later unwind.
 * Blocking on ANY newer open journal (same kind) that shares the keeper or the
 * loser id makes newest-first unwinding always legal and everything else
 * rejected — correctness by induction, no delta reconstruction. Ordering keys
 * on the explicit immutable seq column, never rowid.
 */
function assertNewestFirstUnmerge(row: MergeJournalRow): void {
  const loserId = row.loser_id ?? ((): string | null => {
    try {
      return (JSON.parse(row.loser_snapshot) as { id?: string }).id ?? null
    } catch {
      return null
    }
  })()
  const newer = queryOne<{ id: string; loser_snapshot: string }>(
    `SELECT id, loser_snapshot FROM merge_journal
     WHERE kind = ? AND undone_at IS NULL AND seq > ?
       AND (keeper_id = ? OR keeper_id = ? OR loser_id = ? OR loser_id = ?)
     ORDER BY seq DESC LIMIT 1`,
    [row.kind, row.seq ?? 0, row.keeper_id, loserId, row.keeper_id, loserId]
  )
  if (!newer) return
  let blockingName: string | null = null
  try {
    blockingName = (JSON.parse(newer.loser_snapshot) as { name?: string }).name ?? null
  } catch {
    /* name stays null */
  }
  throw new MergeOrderConflictError(
    newer.id,
    blockingName,
    `Merges must be undone newest-first: undo the newer merge${
      blockingName ? ` of "${blockingName}"` : ''
    } (${newer.id}) before this one`
  )
}

/** Restore keeper columns to their pre-merge values, only where unchanged since. */
function restoreFoldedFields(table: 'contacts' | 'projects', keeperId: string, foldedJson: string | null): number {
  if (!foldedJson) return 0
  let folded: Record<string, { from: string | null; to: string | null }>
  try {
    folded = JSON.parse(foldedJson)
  } catch {
    return 0
  }
  const current = queryOne<Record<string, string | null>>(`SELECT * FROM ${table} WHERE id = ?`, [keeperId])
  if (!current) return 0
  let restored = 0
  for (const [field, { from, to }] of Object.entries(folded)) {
    // Only revert if the keeper still holds exactly the folded value — otherwise
    // the user edited this field after the merge and we must not clobber it.
    if ((current[field] ?? null) === to) {
      runNoSave(`UPDATE ${table} SET ${field} = ? WHERE id = ?`, [from, keeperId])
      restored++
    }
  }
  return restored
}

/** Fetch and validate an un-undone journal row of the given kind. @throws otherwise. */
function loadOpenJournal(journalId: string, kind: MergeKind): MergeJournalRow {
  const row = queryOne<MergeJournalRow>('SELECT * FROM merge_journal WHERE id = ?', [journalId])
  if (!row) throw new Error(`Merge journal entry ${journalId} not found`)
  if (row.kind !== kind) throw new Error(`Journal entry ${journalId} is a ${row.kind} merge, not ${kind}`)
  if (row.undone_at) throw new Error('This merge has already been unmerged')
  return row
}

/**
 * Reverse a contact merge recorded in merge_journal. In one transaction:
 *   1. Recreate the loser row from the snapshot (fails if its id is taken again).
 *   2. Restore the loser's own aliases (they cascaded away when it was deleted).
 *   3. Repoint the manifest's moved rows back keeper→loser; re-insert the loser
 *      links the merge dropped as collisions. Manifest rows that no longer exist
 *      (deleted or reassigned since the merge) are skipped and counted.
 *   4. Delete the alias the merge created, restore folded keeper fields (only
 *      where the keeper still holds the folded value), recompute both counts.
 *   5. Report keeper links that appeared AFTER the merge (not in the keeper's
 *      pre-merge set) — the "a meeting got wrongly attached, reassign it" list.
 *   6. Stamp undone_at.
 *
 * @throws if the journal id is unknown, already undone, or the loser id is taken.
 */
export function unmergeContacts(journalId: string): UnmergeResult {
  return runInTransaction(() => {
    const row = loadOpenJournal(journalId, 'contact')
    const keeperId = row.keeper_id

    // Dependency-aware newest-first guard (v42): contacts share the delta-based
    // merge_journal model, so out-of-order undo corrupts cumulative folded
    // fields (tags union, widened seen-spans) and hits the same
    // keeper-of-keeper hole as projects. One shared guard for both kinds.
    assertNewestFirstUnmerge(row)

    const loser = JSON.parse(row.loser_snapshot) as Contact
    const manifest = JSON.parse(row.repointed_manifest) as ContactMergeManifest

    if (queryOne('SELECT 1 FROM contacts WHERE id = ?', [loser.id])) {
      throw new Error(`Cannot unmerge: a contact with id ${loser.id} already exists`)
    }

    // 1. Recreate the loser row from the snapshot.
    runNoSave(
      `INSERT INTO contacts (id, name, email, type, role, company, notes, tags, first_seen_at, last_seen_at, meeting_count, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        loser.id,
        loser.name,
        loser.email ?? null,
        loser.type ?? 'unknown',
        loser.role ?? null,
        loser.company ?? null,
        loser.notes ?? null,
        loser.tags ?? null,
        loser.first_seen_at,
        loser.last_seen_at,
        0,
        loser.created_at
      ]
    )

    // 2. Restore the loser's own aliases (skip any whose norm is now taken).
    let aliasesRestored = 0
    for (const a of manifest.loserAliases ?? []) {
      if (queryOne('SELECT 1 FROM contact_aliases WHERE alias_norm = ?', [a.alias_norm])) continue
      runNoSave(
        `INSERT INTO contact_aliases (id, alias_norm, contact_id, source, confidence, created_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [randomUUID(), a.alias_norm, loser.id, a.source, a.confidence, new Date().toISOString()]
      )
      aliasesRestored++
    }

    let meetingLinks = 0
    let speakerLinks = 0
    let skipped = 0

    // 3a. Move repointed meeting_contacts back keeper→loser (skip if gone).
    for (const l of manifest.meetingContacts.repointed) {
      const exists = queryOne('SELECT 1 FROM meeting_contacts WHERE meeting_id = ? AND contact_id = ?', [l.key, keeperId])
      if (!exists) {
        skipped++
        continue
      }
      runNoSave('UPDATE OR IGNORE meeting_contacts SET contact_id = ? WHERE meeting_id = ? AND contact_id = ?', [
        loser.id,
        l.key,
        keeperId
      ])
      meetingLinks++
    }
    // 3b. Re-insert the loser links the merge dropped as collisions (keeper keeps its own).
    for (const l of manifest.meetingContacts.collided) {
      if (!queryOne('SELECT 1 FROM meetings WHERE id = ?', [l.key])) {
        skipped++
        continue
      }
      runNoSave('INSERT OR IGNORE INTO meeting_contacts (meeting_id, contact_id, role) VALUES (?, ?, ?)', [
        l.key,
        loser.id,
        l.role ?? 'attendee'
      ])
      meetingLinks++
    }

    // 3c. Move repointed transcript_speakers back (skip if row gone or reassigned).
    for (const tsId of manifest.transcriptSpeakers.repointed) {
      const cur = queryOne<{ contact_id: string }>('SELECT contact_id FROM transcript_speakers WHERE id = ?', [tsId])
      if (!cur || cur.contact_id !== keeperId) {
        skipped++
        continue
      }
      runNoSave('UPDATE transcript_speakers SET contact_id = ? WHERE id = ?', [loser.id, tsId])
      speakerLinks++
    }

    // 4. Delete the alias(es) the merge created, restore folded keeper fields.
    for (const norm of manifest.createdAliasNorms ?? []) {
      runNoSave('DELETE FROM contact_aliases WHERE alias_norm = ? AND contact_id = ? AND source = ?', [
        norm,
        keeperId,
        'merge'
      ])
    }
    const fieldsRestored = restoreFoldedFields('contacts', keeperId, row.folded_fields)

    recomputeContactMeetingCount(keeperId)
    recomputeContactMeetingCount(loser.id)

    // 5. Orphan report: keeper links not present before the merge (added since).
    const beforeMeetings = new Set(manifest.keeperBefore.meetingIds)
    const beforeSpeakers = new Set(manifest.keeperBefore.speakerIds)
    const orphanedSinceMerge: OrphanLink[] = []
    const nowMeetings = queryAll<{ meeting_id: string; subject: string | null; start_time: string | null }>(
      `SELECT mc.meeting_id, m.subject, m.start_time
       FROM meeting_contacts mc LEFT JOIN meetings m ON m.id = mc.meeting_id
       WHERE mc.contact_id = ?`,
      [keeperId]
    )
    for (const r of nowMeetings) {
      if (!beforeMeetings.has(r.meeting_id)) {
        orphanedSinceMerge.push({
          table: 'meeting_contacts',
          key: r.meeting_id,
          label: r.subject || 'Untitled meeting',
          date: r.start_time
        })
      }
    }
    const nowSpeakers = queryAll<{ id: string; recording_id: string; speaker_label: string }>(
      'SELECT id, recording_id, speaker_label FROM transcript_speakers WHERE contact_id = ?',
      [keeperId]
    )
    for (const r of nowSpeakers) {
      if (!beforeSpeakers.has(r.id)) {
        orphanedSinceMerge.push({
          table: 'transcript_speakers',
          key: r.id,
          label: `${r.speaker_label} in recording ${r.recording_id}`,
          date: null
        })
      }
    }

    // 6. Mark the journal undone.
    runNoSave('UPDATE merge_journal SET undone_at = ? WHERE id = ?', [new Date().toISOString(), journalId])

    return {
      loserId: loser.id,
      loserName: loser.name,
      restored: { meetingLinks, speakerLinks, knowledgeLinks: 0, aliases: aliasesRestored, fieldsRestored, skipped },
      orphanedSinceMerge
    }
  })
}

// =============================================================================
// Transcript speaker identity (v25)
// =============================================================================

export interface SpeakerMapEntry {
  speaker_label: string
  contact_id: string
  name: string
}

/** Speaker-label → contact map for a recording (joined to the contact name). */
export function getSpeakerMap(recordingId: string): SpeakerMapEntry[] {
  return queryAll<SpeakerMapEntry>(
    `SELECT ts.speaker_label, ts.contact_id, c.name
     FROM transcript_speakers ts
     JOIN contacts c ON c.id = ts.contact_id
     WHERE ts.recording_id = ?
     ORDER BY ts.speaker_label`,
    [recordingId]
  )
}

/**
 * Bind a transcript speaker label to a contact. Provide either an existing
 * contactId or a newName (upserted by case-insensitive name). Writes the map
 * row (replacing any prior binding for the label) and, when the recording is
 * linked to a meeting, links the contact to that meeting. Returns the contact.
 *
 * @throws if neither contactId nor newName is usable, or contactId is unknown.
 */
export function assignSpeaker(
  recordingId: string,
  speakerLabel: string,
  opts: { contactId?: string; newName?: string }
): Contact {
  return runInTransaction(() => {
    let contact: Contact | undefined

    if (opts.contactId) {
      contact = queryOne<Contact>('SELECT * FROM contacts WHERE id = ?', [opts.contactId])
      if (!contact) throw new Error(`Contact ${opts.contactId} not found`)
    } else if (opts.newName && opts.newName.trim()) {
      const name = opts.newName.trim()
      contact = queryOne<Contact>('SELECT * FROM contacts WHERE LOWER(name) = LOWER(?)', [name])
      if (!contact) {
        const id = randomUUID()
        const now = new Date().toISOString()
        runNoSave(
          `INSERT INTO contacts (id, name, type, first_seen_at, last_seen_at, meeting_count)
           VALUES (?, ?, 'unknown', ?, ?, 0)`,
          [id, name, now, now]
        )
        contact = queryOne<Contact>('SELECT * FROM contacts WHERE id = ?', [id])!
      }
    } else {
      throw new Error('assignSpeaker requires a contactId or a newName')
    }

    // UNIQUE(recording_id, speaker_label) makes this an upsert of the binding.
    runNoSave(
      'INSERT OR REPLACE INTO transcript_speakers (id, recording_id, speaker_label, contact_id) VALUES (?, ?, ?, ?)',
      [randomUUID(), recordingId, speakerLabel, contact.id]
    )

    // Alias memory (v27): a non-generic speaker label ("Javier", not "Speaker 2")
    // is a real name the user just bound — remember it as an alias of the contact.
    if (!isGenericSpeakerLabel(speakerLabel)) {
      upsertContactAliasNoSave(contact.id, speakerLabel, 'speaker_assign', 0.95)
    }

    const rec = queryOne<{ meeting_id?: string | null }>('SELECT meeting_id FROM recordings WHERE id = ?', [recordingId])
    if (rec?.meeting_id) {
      runNoSave('INSERT OR IGNORE INTO meeting_contacts (meeting_id, contact_id, role) VALUES (?, ?, ?)', [
        rec.meeting_id,
        contact.id,
        'attendee'
      ])
      recomputeContactMeetingCount(contact.id)
    }

    return queryOne<Contact>('SELECT * FROM contacts WHERE id = ?', [contact.id])!
  })
}

/** Remove a speaker-label → contact binding for a recording. */
export function unassignSpeaker(recordingId: string, speakerLabel: string): void {
  run('DELETE FROM transcript_speakers WHERE recording_id = ? AND speaker_label = ?', [recordingId, speakerLabel])
}

// =============================================================================
// Per-turn speaker overrides + speaker splits (v37)
// =============================================================================

export interface TurnOverrideEntry {
  turn_index: number
  contact_id: string
  name: string
}

export interface SpeakerSplitEntry {
  base_label: string
  from_turn_index: number
  derived_label: string
}

/**
 * Resolve a contact from either an existing id or a (case-insensitively upserted)
 * name. Composes inside an enclosing transaction (uses runNoSave). Mirrors the
 * contact-resolution used by assignSpeaker so per-turn overrides and splits bind
 * identities the same way. @throws if neither is usable or the id is unknown.
 */
function resolveContactForBinding(opts: { contactId?: string; newName?: string }): Contact {
  if (opts.contactId) {
    const contact = queryOne<Contact>('SELECT * FROM contacts WHERE id = ?', [opts.contactId])
    if (!contact) throw new Error(`Contact ${opts.contactId} not found`)
    return contact
  }
  if (opts.newName && opts.newName.trim()) {
    const name = opts.newName.trim()
    const existing = queryOne<Contact>('SELECT * FROM contacts WHERE LOWER(name) = LOWER(?)', [name])
    if (existing) return existing
    const id = randomUUID()
    const now = new Date().toISOString()
    runNoSave(
      `INSERT INTO contacts (id, name, type, first_seen_at, last_seen_at, meeting_count)
       VALUES (?, ?, 'unknown', ?, ?, 0)`,
      [id, name, now, now]
    )
    return queryOne<Contact>('SELECT * FROM contacts WHERE id = ?', [id])!
  }
  throw new Error('A contactId or a newName is required')
}

/** Per-turn override map for a recording (turn_index → contact), joined to the name. */
export function getTurnOverrides(recordingId: string): TurnOverrideEntry[] {
  return queryAll<TurnOverrideEntry>(
    `SELECT tso.turn_index, tso.contact_id, c.name
     FROM turn_speaker_overrides tso
     JOIN contacts c ON c.id = tso.contact_id
     WHERE tso.recording_id = ?
     ORDER BY tso.turn_index`,
    [recordingId]
  )
}

/**
 * Bind a single transcript turn to a contact, superseding the label→contact
 * default for that turn only ("Just this turn"). Provide an existing contactId
 * or a newName to upsert. Upserts on (recording_id, turn_index). Returns the
 * contact. When the recording is linked to a meeting, links the contact to it.
 */
export function setTurnOverride(
  recordingId: string,
  turnIndex: number,
  opts: { contactId?: string; newName?: string }
): Contact {
  return runInTransaction(() => {
    const contact = resolveContactForBinding(opts)
    runNoSave(
      'INSERT OR REPLACE INTO turn_speaker_overrides (id, recording_id, turn_index, contact_id) VALUES (?, ?, ?, ?)',
      [randomUUID(), recordingId, turnIndex, contact.id]
    )
    const rec = queryOne<{ meeting_id?: string | null }>('SELECT meeting_id FROM recordings WHERE id = ?', [recordingId])
    if (rec?.meeting_id) {
      runNoSave('INSERT OR IGNORE INTO meeting_contacts (meeting_id, contact_id, role) VALUES (?, ?, ?)', [
        rec.meeting_id,
        contact.id,
        'attendee'
      ])
      recomputeContactMeetingCount(contact.id)
    }
    return queryOne<Contact>('SELECT * FROM contacts WHERE id = ?', [contact.id])!
  })
}

/** Remove a per-turn override, reverting the turn to its label/split default. */
export function clearTurnOverride(recordingId: string, turnIndex: number): void {
  run('DELETE FROM turn_speaker_overrides WHERE recording_id = ? AND turn_index = ?', [recordingId, turnIndex])
}

/** All speaker splits for a recording, ordered so the render can pick the last
 * boundary at or before a turn. */
export function getSpeakerSplits(recordingId: string): SpeakerSplitEntry[] {
  return queryAll<SpeakerSplitEntry>(
    `SELECT base_label, from_turn_index, derived_label
     FROM speaker_splits
     WHERE recording_id = ?
     ORDER BY base_label, from_turn_index`,
    [recordingId]
  )
}

/** The next unused split suffix letter (B, C, D…) for a base label's derived
 * labels, so a merge-back + re-split never collides with a live binding. */
function nextSplitLetter(usedDerived: string[], baseLabel: string): string {
  const used = new Set(usedDerived)
  for (let code = 66 /* 'B' */; code < 91 /* 'Z'+1 */; code++) {
    const candidate = `${baseLabel} · ${String.fromCharCode(code)}`
    if (!used.has(candidate)) return candidate
  }
  // Exhausted A–Z (26 splits on one label is implausible): fall back to a uuid.
  return `${baseLabel} · ${randomUUID().slice(0, 4)}`
}

/**
 * Fork a diarization label into a new derived label from `fromTurnIndex` onward.
 * Turns at or after the boundary that share `baseLabel` render (and are assigned)
 * under the returned derived label, leaving earlier turns on the base label.
 * Idempotent per boundary: an existing split at (recording, base, index) returns
 * its derived label unchanged. Returns the derived label.
 */
export function splitSpeakerFrom(recordingId: string, baseLabel: string, fromTurnIndex: number): string {
  return runInTransaction(() => {
    const existing = queryOne<{ derived_label: string }>(
      'SELECT derived_label FROM speaker_splits WHERE recording_id = ? AND base_label = ? AND from_turn_index = ?',
      [recordingId, baseLabel, fromTurnIndex]
    )
    if (existing) return existing.derived_label

    const priorDerived = queryAll<{ derived_label: string }>(
      'SELECT derived_label FROM speaker_splits WHERE recording_id = ? AND base_label = ?',
      [recordingId, baseLabel]
    ).map((r) => r.derived_label)
    const derivedLabel = nextSplitLetter(priorDerived, baseLabel)

    runNoSave(
      'INSERT INTO speaker_splits (id, recording_id, base_label, from_turn_index, derived_label) VALUES (?, ?, ?, ?, ?)',
      [randomUUID(), recordingId, baseLabel, fromTurnIndex, derivedLabel]
    )
    return derivedLabel
  })
}

/**
 * Undo a split ("merge back"): remove the split boundary and drop any speaker
 * binding attached to its derived label, so the affected turns revert to the
 * base label's default.
 */
export function mergeSpeakerSplit(recordingId: string, baseLabel: string, fromTurnIndex: number): void {
  runInTransaction(() => {
    const row = queryOne<{ derived_label: string }>(
      'SELECT derived_label FROM speaker_splits WHERE recording_id = ? AND base_label = ? AND from_turn_index = ?',
      [recordingId, baseLabel, fromTurnIndex]
    )
    runNoSave('DELETE FROM speaker_splits WHERE recording_id = ? AND base_label = ? AND from_turn_index = ?', [
      recordingId,
      baseLabel,
      fromTurnIndex
    ])
    if (row) {
      runNoSave('DELETE FROM transcript_speakers WHERE recording_id = ? AND speaker_label = ?', [
        recordingId,
        row.derived_label
      ])
    }
  })
}

/**
 * "From here on": split the label at `fromTurnIndex` and bind the resulting
 * derived label to a contact in one atomic step. Returns the derived label and
 * the bound contact.
 */
export function assignSpeakerFromHere(
  recordingId: string,
  baseLabel: string,
  fromTurnIndex: number,
  opts: { contactId?: string; newName?: string }
): { derivedLabel: string; contact: Contact } {
  return runInTransaction(() => {
    const derivedLabel = splitSpeakerFrom(recordingId, baseLabel, fromTurnIndex)
    const contact = assignSpeaker(recordingId, derivedLabel, opts)
    return { derivedLabel, contact }
  })
}

// =============================================================================
// Meeting attendee editing (v25)
// =============================================================================

/**
 * Regenerate a meeting's attendees JSON as a projection of its meeting_contacts
 * links (organizer-role rows excluded — the organizer lives in its own columns).
 * Uses runNoSave so it can compose inside an enclosing transaction.
 */
function regenerateMeetingAttendeesJson(meetingId: string): void {
  const rows = queryAll<{ name: string; email: string | null }>(
    `SELECT c.name, c.email
     FROM meeting_contacts mc
     JOIN contacts c ON c.id = mc.contact_id
     WHERE mc.meeting_id = ? AND mc.role != 'organizer'
     ORDER BY c.name`,
    [meetingId]
  )
  const attendees = rows.map((r) => ({ name: r.name, email: r.email ?? undefined }))
  runNoSave('UPDATE meetings SET attendees = ?, updated_at = ? WHERE id = ?', [
    JSON.stringify(attendees),
    new Date().toISOString(),
    meetingId
  ])
}

/**
 * Add an attendee to a meeting. Upserts the contact (matched by email first,
 * then by case-insensitive name), propagating a newly-supplied email onto a
 * name-matched contact that lacked one — and mirror-upgrading an email-matched
 * placeholder's name (matching org-reconciler's upsertContactsFromMeetings).
 * Links the contact via meeting_contacts and regenerates the attendees JSON.
 *
 * @throws if the meeting is missing or neither name nor email is provided.
 */
export function addMeetingAttendee(meetingId: string, payload: { name?: string; email?: string }): Contact {
  return runInTransaction(() => {
    const meeting = queryOne<{ id: string }>('SELECT id FROM meetings WHERE id = ?', [meetingId])
    if (!meeting) throw new Error(`Meeting ${meetingId} not found`)

    const email = payload.email?.trim().toLowerCase() || null
    const name = payload.name?.trim() || null
    if (!email && !name) throw new Error('addMeetingAttendee requires a name or an email')

    let contact: Contact | undefined
    if (email) {
      contact = queryOne<Contact>('SELECT * FROM contacts WHERE LOWER(email) = ?', [email])
    }
    if (!contact && name) {
      contact = queryOne<Contact>('SELECT * FROM contacts WHERE LOWER(name) = LOWER(?)', [name])
    }

    if (!contact) {
      const id = randomUUID()
      const now = new Date().toISOString()
      runNoSave(
        `INSERT INTO contacts (id, name, email, type, first_seen_at, last_seen_at, meeting_count)
         VALUES (?, ?, ?, 'unknown', ?, ?, 0)`,
        [id, name || (email ? email.split('@')[0] : 'Unknown'), email, now, now]
      )
      contact = queryOne<Contact>('SELECT * FROM contacts WHERE id = ?', [id])!
    } else {
      // Propagate newly-supplied identity onto the matched contact.
      const patch: string[] = []
      const params: unknown[] = []
      if (email && !(contact.email && contact.email.trim())) {
        patch.push('email = ?')
        params.push(email)
      }
      const placeholderName = contact.email ? contact.email.split('@')[0] : null
      const nameIsPlaceholder = !contact.name || (placeholderName !== null && contact.name === placeholderName)
      if (name && name !== contact.name && nameIsPlaceholder) {
        patch.push('name = ?')
        params.push(name)
      }
      if (patch.length > 0) {
        params.push(contact.id)
        runNoSave(`UPDATE contacts SET ${patch.join(', ')} WHERE id = ?`, params)
        contact = queryOne<Contact>('SELECT * FROM contacts WHERE id = ?', [contact.id])!
      }
    }

    runNoSave('INSERT OR IGNORE INTO meeting_contacts (meeting_id, contact_id, role) VALUES (?, ?, ?)', [
      meetingId,
      contact.id,
      'attendee'
    ])
    regenerateMeetingAttendeesJson(meetingId)
    recomputeContactMeetingCount(contact.id)

    return queryOne<Contact>('SELECT * FROM contacts WHERE id = ?', [contact.id])!
  })
}

/** Remove an attendee link from a meeting and regenerate its attendees JSON. */
export function removeMeetingAttendee(meetingId: string, contactId: string): void {
  runInTransaction(() => {
    runNoSave('DELETE FROM meeting_contacts WHERE meeting_id = ? AND contact_id = ?', [meetingId, contactId])
    regenerateMeetingAttendeesJson(meetingId)
    recomputeContactMeetingCount(contactId)
  })
}

// =============================================================================
// Project queries
// =============================================================================

export interface Project {
  id: string
  name: string
  description: string | null
  status: string
  folder_path: string | null
  url: string | null
  /**
   * Durable provenance (v42): 'manual' (explicit user create) or 'discovered'
   * (reconciler auto-create from a transcript). null = legacy/unknown — treated
   * as NOT dismissable (fail-closed).
   */
  origin: 'manual' | 'discovered' | null
  created_at: string
}

/** One issue / risk / note tracked against a project (v29). */
export interface ProjectNote {
  id: string
  project_id: string
  kind: 'issue' | 'risk' | 'note'
  content: string
  status: 'open' | 'resolved'
  created_at: string
  resolved_at: string | null
}

export interface MeetingProject {
  meeting_id: string
  project_id: string
}

export function getProjects(search?: string, limit = 100, offset = 0, status?: string): { projects: Project[]; total: number } {
  let countSql = 'SELECT COUNT(*) as count FROM projects'
  let sql = 'SELECT * FROM projects'
  const params: unknown[] = []
  const whereClauses: string[] = []

  if (search) {
    const escaped = escapeLikePattern(search)
    whereClauses.push("(name LIKE ? ESCAPE '\\' OR description LIKE ? ESCAPE '\\')")
    params.push(`%${escaped}%`, `%${escaped}%`)
  }

  if (status && status !== 'all') {
    whereClauses.push('status = ?')
    params.push(status)
  }

  if (whereClauses.length > 0) {
    const whereClause = ' WHERE ' + whereClauses.join(' AND ')
    countSql += whereClause
    sql += whereClause
  }

  sql += ' ORDER BY created_at DESC LIMIT ? OFFSET ?'

  const countResult = queryOne<{ count: number }>(countSql, params)
  const projects = queryAll<Project>(sql, [...params, limit, offset])

  return { projects, total: countResult?.count ?? 0 }
}

export function getProjectById(id: string): Project | undefined {
  return queryOne<Project>('SELECT * FROM projects WHERE id = ?', [id])
}

export function createProject(project: Omit<Project, 'created_at' | 'folder_path' | 'url' | 'origin'>): Project {
  // This function IS the manual path — it stamps origin='manual' itself so no
  // caller can accidentally (or deliberately) mint a dismissable project here.
  run(
    "INSERT INTO projects (id, name, description, status, origin) VALUES (?, ?, ?, ?, 'manual')",
    [project.id, project.name, project.description, project.status || 'active']
  )
  // Manual beats rejection: an explicit create clears any discovery tombstone for
  // this name, so future transcript mentions resolve and link to it normally.
  clearProjectDiscoveryRejection(project.name)
  return { ...project, folder_path: null, url: null, origin: 'manual', created_at: new Date().toISOString() }
}

// ---------------------------------------------------------------------------
// Project discovery tombstones (v41)
// ---------------------------------------------------------------------------
// Dismissing an auto-discovered project must be durable: deleting the row alone
// let the next transcript re-analysis silently re-create it. These helpers give
// the reconciler's auto-create path a memory keyed by normalized name. Manual
// creation clears the tombstone (createProject above), so "manual beats
// rejection" holds.

/** Record that a discovered project name was dismissed (upsert — latest wins). */
export function addProjectDiscoveryRejection(name: string, sourceMeetingId?: string | null): void {
  const norm = normalizeName(name)
  if (!norm) return
  run(
    `INSERT INTO project_discovery_rejections (name_norm, original_name, source_meeting_id, rejected_at)
     VALUES (?, ?, ?, ?)
     ON CONFLICT(name_norm) DO UPDATE SET
       original_name = excluded.original_name,
       source_meeting_id = excluded.source_meeting_id,
       rejected_at = excluded.rejected_at`,
    [norm, name, sourceMeetingId ?? null, new Date().toISOString()]
  )
}

/** True when this name was dismissed as a spurious discovery (blocks auto-create only). */
export function isProjectDiscoveryRejected(name: string): boolean {
  const norm = normalizeName(name)
  if (!norm) return false
  return !!queryOne<{ name_norm: string }>(
    'SELECT name_norm FROM project_discovery_rejections WHERE name_norm = ?',
    [norm]
  )
}

/** Remove a tombstone (called on explicit manual create — manual beats rejection). */
export function clearProjectDiscoveryRejection(name: string): void {
  const norm = normalizeName(name)
  if (!norm) return
  run('DELETE FROM project_discovery_rejections WHERE name_norm = ?', [norm])
}

/** Typed failure reasons for {@link dismissDiscoveredProject}. */
export class DismissDiscoveredError extends Error {
  constructor(public readonly code: 'NOT_FOUND' | 'NOT_DISCOVERED', message: string) {
    super(message)
    this.name = 'DismissDiscoveredError'
  }
}

/**
 * Dismiss an auto-discovered project: verify provenance, record the durable
 * tombstone, and delete the row — all in ONE transaction.
 *
 * Provenance is enforced HERE, in the database layer, not in the renderer: the
 * row's origin (v42) must be exactly 'discovered'. 'manual' and NULL (legacy/
 * unknown) are rejected fail-closed, so a stale UI, a bug, or a compromised
 * renderer invoking the IPC channel directly can never cascade-delete a
 * manually created project through this path. (Plain projects:delete remains
 * the explicit, tombstone-free removal for any project.)
 */
export function dismissDiscoveredProject(id: string): void {
  runInTransaction(() => {
    const project = queryOne<Project>('SELECT * FROM projects WHERE id = ?', [id])
    if (!project) {
      throw new DismissDiscoveredError('NOT_FOUND', `Project with ID ${id} not found`)
    }
    if (project.origin !== 'discovered') {
      throw new DismissDiscoveredError(
        'NOT_DISCOVERED',
        'Only auto-discovered projects can be dismissed. This project was created manually ' +
          '(or predates provenance tracking) — delete it explicitly instead.'
      )
    }
    const sourceMeeting = queryOne<{ meeting_id: string }>(
      'SELECT mp.meeting_id FROM meeting_projects mp JOIN meetings m ON m.id = mp.meeting_id ' +
        'WHERE mp.project_id = ? ORDER BY m.start_time DESC LIMIT 1',
      [id]
    )
    addProjectDiscoveryRejection(project.name, sourceMeeting?.meeting_id ?? null)
    run('DELETE FROM projects WHERE id = ?', [id])
  })
}

export interface ProjectUpdateFields {
  name?: string
  description?: string | null
  status?: string
  folderPath?: string | null
  url?: string | null
}

export function updateProject(id: string, fields: ProjectUpdateFields): void {
  const updates: string[] = []
  const params: unknown[] = []

  if (fields.name !== undefined) {
    updates.push('name = ?')
    params.push(fields.name)
  }
  if (fields.description !== undefined) {
    updates.push('description = ?')
    params.push(fields.description)
  }
  if (fields.status !== undefined) {
    updates.push('status = ?')
    params.push(fields.status)
  }
  if (fields.folderPath !== undefined) {
    updates.push('folder_path = ?')
    params.push(fields.folderPath)
  }
  if (fields.url !== undefined) {
    updates.push('url = ?')
    params.push(fields.url)
  }

  if (updates.length > 0) {
    params.push(id)
    run(`UPDATE projects SET ${updates.join(', ')} WHERE id = ?`, params)
  }
}

export function deleteProject(id: string): void {
  // Junction table entries will be cascade deleted due to FK constraint
  run('DELETE FROM projects WHERE id = ?', [id])
}

export function getMeetingsForProject(projectId: string): Meeting[] {
  return queryAll<Meeting>(
    `SELECT m.* FROM meetings m
     JOIN meeting_projects mp ON m.id = mp.meeting_id
     WHERE mp.project_id = ?
     ORDER BY m.start_time DESC`,
    [projectId]
  )
}

export function getProjectsForMeeting(meetingId: string): Project[] {
  return queryAll<Project>(
    `SELECT p.* FROM projects p
     JOIN meeting_projects mp ON p.id = mp.project_id
     WHERE mp.meeting_id = ?`,
    [meetingId]
  )
}

export function tagMeetingToProject(meetingId: string, projectId: string): void {
  run(
    'INSERT OR IGNORE INTO meeting_projects (meeting_id, project_id) VALUES (?, ?)',
    [meetingId, projectId]
  )
}

export function untagMeetingFromProject(meetingId: string, projectId: string): void {
  run('DELETE FROM meeting_projects WHERE meeting_id = ? AND project_id = ?', [meetingId, projectId])
}

/**
 * Get knowledge capture IDs associated with a project. Unions two paths:
 *  1. transitive: project -> meeting_projects -> meetings -> recordings -> knowledge_captures
 *  2. direct: project -> knowledge_projects -> knowledge_captures (v26)
 * DISTINCT + UNION dedupes captures reachable by both paths.
 */
export function getKnowledgeIdsForProject(projectId: string): string[] {
  const rows = queryAll<{ id: string }>(
    `SELECT DISTINCT kc.id FROM knowledge_captures kc
     JOIN recordings r ON kc.source_recording_id = r.id
     JOIN meeting_projects mp ON r.meeting_id = mp.meeting_id
     WHERE mp.project_id = ?
     UNION
     SELECT knowledge_capture_id AS id FROM knowledge_projects WHERE project_id = ?`,
    [projectId, projectId]
  )
  return rows.map(r => r.id)
}

/**
 * Get person/contact IDs associated with a project via its meetings.
 * Path: project -> meeting_projects -> meeting_contacts -> contacts
 */
export function getPersonIdsForProject(projectId: string): string[] {
  const rows = queryAll<{ contact_id: string }>(
    `SELECT DISTINCT mc.contact_id FROM meeting_contacts mc
     JOIN meeting_projects mp ON mc.meeting_id = mp.meeting_id
     WHERE mp.project_id = ?`,
    [projectId]
  )
  return rows.map(r => r.contact_id)
}

/**
 * Merge two projects into one. Mirrors mergeContacts: the keeper survives; the
 * loser's meeting_projects and knowledge_projects links are repointed (OR IGNORE
 * to skip collisions, then leftovers dropped), useful fields folded in
 * (keeper wins, null-fill from loser), and the loser row deleted. One tx.
 *
 * @throws if the ids are equal or either project does not exist.
 */
export function mergeProjects(keeperId: string, loserId: string): Project {
  if (keeperId === loserId) {
    throw new Error('Cannot merge a project into itself')
  }

  return runInTransaction(() => {
    const keeper = queryOne<Project>('SELECT * FROM projects WHERE id = ?', [keeperId])
    const loser = queryOne<Project>('SELECT * FROM projects WHERE id = ?', [loserId])
    if (!keeper) throw new Error(`Keeper project ${keeperId} not found`)
    if (!loser) throw new Error(`Loser project ${loserId} not found`)

    // --- Capture the manifest BEFORE mutating, so unmerge can reverse exactly. ---
    const keeperMeetingIds = queryAll<{ meeting_id: string }>(
      'SELECT meeting_id FROM meeting_projects WHERE project_id = ?',
      [keeperId]
    ).map((r) => r.meeting_id)
    const keeperMeetingSet = new Set(keeperMeetingIds)
    const mpRepointed: string[] = []
    const mpCollided: string[] = []
    for (const r of queryAll<{ meeting_id: string }>('SELECT meeting_id FROM meeting_projects WHERE project_id = ?', [
      loserId
    ])) {
      if (keeperMeetingSet.has(r.meeting_id)) mpCollided.push(r.meeting_id)
      else mpRepointed.push(r.meeting_id)
    }
    const keeperKnowledgeIds = queryAll<{ knowledge_capture_id: string }>(
      'SELECT knowledge_capture_id FROM knowledge_projects WHERE project_id = ?',
      [keeperId]
    ).map((r) => r.knowledge_capture_id)
    const keeperKnowledgeSet = new Set(keeperKnowledgeIds)
    const kpRepointed: string[] = []
    const kpCollided: string[] = []
    for (const r of queryAll<{ knowledge_capture_id: string }>(
      'SELECT knowledge_capture_id FROM knowledge_projects WHERE project_id = ?',
      [loserId]
    )) {
      if (keeperKnowledgeSet.has(r.knowledge_capture_id)) kpCollided.push(r.knowledge_capture_id)
      else kpRepointed.push(r.knowledge_capture_id)
    }
    const loserAliases = queryAll<{ alias_norm: string; source: string | null; confidence: number | null }>(
      'SELECT alias_norm, source, confidence FROM project_aliases WHERE project_id = ?',
      [loserId]
    )
    const createdAliasNorm = normalizeName(loser.name)

    // Record the loser's name as a permanent alias of the keeper (v27).
    upsertProjectAliasNoSave(keeperId, loser.name, 'merge', 1.0)

    // Repoint meeting_projects (PK: meeting_id, project_id).
    runNoSave('UPDATE OR IGNORE meeting_projects SET project_id = ? WHERE project_id = ?', [keeperId, loserId])
    runNoSave('DELETE FROM meeting_projects WHERE project_id = ?', [loserId])

    // Repoint knowledge_projects (PK: knowledge_capture_id, project_id).
    runNoSave('UPDATE OR IGNORE knowledge_projects SET project_id = ? WHERE project_id = ?', [keeperId, loserId])
    runNoSave('DELETE FROM knowledge_projects WHERE project_id = ?', [loserId])

    // Fold fields onto the keeper (keeper wins; null-fill from loser).
    const notEmpty = (v: string | null | undefined) => !!(v && v.trim())
    const description = notEmpty(keeper.description) ? keeper.description : loser.description ?? null
    const status = notEmpty(keeper.status) ? keeper.status : loser.status || 'active'
    // Provenance dominance (v42): the merged row now contains BOTH projects'
    // data, so it may only stay 'discovered' (dismissable) when both inputs were
    // 'discovered'. 'manual' dominates ('manual' merged either way is guarded),
    // and NULL (legacy/unknown) dominates 'discovered' — fail-closed: data of
    // unproven origin must never become tombstone-deletable through a merge.
    // Journaled in folded_fields, so unmerge restores the keeper's own origin.
    const origin: Project['origin'] =
      keeper.origin === 'manual' || loser.origin === 'manual'
        ? 'manual'
        : keeper.origin === 'discovered' && loser.origin === 'discovered'
          ? 'discovered'
          : null
    const foldedFields = diffFoldedFields(
      { description: keeper.description, status: keeper.status, origin: keeper.origin },
      { description, status, origin }
    )

    runNoSave('UPDATE projects SET description = ?, status = ?, origin = ? WHERE id = ?', [
      description,
      status,
      origin,
      keeperId
    ])
    runNoSave('DELETE FROM projects WHERE id = ?', [loserId])

    const manifest: ProjectMergeManifest = {
      meetingProjects: { repointed: mpRepointed, collided: mpCollided },
      knowledgeProjects: { repointed: kpRepointed, collided: kpCollided },
      createdAliasNorms: createdAliasNorm ? [createdAliasNorm] : [],
      loserAliases,
      keeperBefore: { meetingIds: keeperMeetingIds, knowledgeIds: keeperKnowledgeIds }
    }
    writeMergeJournalNoSave('project', keeperId, loser.id, loser, manifest, foldedFields)

    return queryOne<Project>('SELECT * FROM projects WHERE id = ?', [keeperId])!
  })
}

/**
 * Reverse a project merge recorded in merge_journal. Mirrors {@link unmergeContacts}:
 * recreate the loser project + its aliases, repoint the manifest's meeting_projects
 * and knowledge_projects back, re-insert dropped collisions, delete the merge-created
 * alias, restore folded keeper fields, and report keeper links added since the merge.
 *
 * @throws if the journal id is unknown, already undone, or the loser id is taken.
 */
export function unmergeProjects(journalId: string): UnmergeResult {
  return runInTransaction(() => {
    const row = loadOpenJournal(journalId, 'project')
    const keeperId = row.keeper_id

    // Dependency-aware newest-first guard (v42): rejects this unmerge while any
    // newer open project journal touches this journal's keeper OR loser — the
    // same-keeper provenance-laundering case AND keeper-of-keeper chains
    // (A->D then D->E), where D no longer exists and an early J1 undo would
    // recreate A linkless while J2's snapshot of D still holds A's folded data.
    assertNewestFirstUnmerge(row)

    const loser = JSON.parse(row.loser_snapshot) as Project
    const manifest = JSON.parse(row.repointed_manifest) as ProjectMergeManifest

    if (queryOne('SELECT 1 FROM projects WHERE id = ?', [loser.id])) {
      throw new Error(`Cannot unmerge: a project with id ${loser.id} already exists`)
    }

    // 1. Recreate the loser project from the snapshot (origin preserved — an
    // unmerged discovered project stays dismissable, a manual one stays guarded).
    runNoSave(
      `INSERT INTO projects (id, name, description, status, folder_path, url, origin, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        loser.id,
        loser.name,
        loser.description ?? null,
        loser.status ?? 'active',
        loser.folder_path ?? null,
        loser.url ?? null,
        loser.origin ?? null,
        loser.created_at
      ]
    )

    // 2. Restore the loser's own aliases (skip any whose norm is now taken).
    let aliasesRestored = 0
    for (const a of manifest.loserAliases ?? []) {
      if (queryOne('SELECT 1 FROM project_aliases WHERE alias_norm = ?', [a.alias_norm])) continue
      runNoSave(
        `INSERT INTO project_aliases (id, alias_norm, project_id, source, confidence, created_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [randomUUID(), a.alias_norm, loser.id, a.source, a.confidence, new Date().toISOString()]
      )
      aliasesRestored++
    }

    let meetingLinks = 0
    let knowledgeLinks = 0
    let skipped = 0

    // 3a. Move repointed meeting_projects back keeper→loser (skip if gone).
    for (const meetingId of manifest.meetingProjects.repointed) {
      if (!queryOne('SELECT 1 FROM meeting_projects WHERE meeting_id = ? AND project_id = ?', [meetingId, keeperId])) {
        skipped++
        continue
      }
      runNoSave('UPDATE OR IGNORE meeting_projects SET project_id = ? WHERE meeting_id = ? AND project_id = ?', [
        loser.id,
        meetingId,
        keeperId
      ])
      meetingLinks++
    }
    // 3b. Re-insert dropped meeting_projects collisions for the loser.
    for (const meetingId of manifest.meetingProjects.collided) {
      if (!queryOne('SELECT 1 FROM meetings WHERE id = ?', [meetingId])) {
        skipped++
        continue
      }
      runNoSave('INSERT OR IGNORE INTO meeting_projects (meeting_id, project_id) VALUES (?, ?)', [meetingId, loser.id])
      meetingLinks++
    }

    // 3c. Move repointed knowledge_projects back keeper→loser (skip if gone).
    for (const kcId of manifest.knowledgeProjects.repointed) {
      if (
        !queryOne('SELECT 1 FROM knowledge_projects WHERE knowledge_capture_id = ? AND project_id = ?', [kcId, keeperId])
      ) {
        skipped++
        continue
      }
      runNoSave(
        'UPDATE OR IGNORE knowledge_projects SET project_id = ? WHERE knowledge_capture_id = ? AND project_id = ?',
        [loser.id, kcId, keeperId]
      )
      knowledgeLinks++
    }
    // 3d. Re-insert dropped knowledge_projects collisions for the loser.
    for (const kcId of manifest.knowledgeProjects.collided) {
      if (!queryOne('SELECT 1 FROM knowledge_captures WHERE id = ?', [kcId])) {
        skipped++
        continue
      }
      runNoSave('INSERT OR IGNORE INTO knowledge_projects (knowledge_capture_id, project_id) VALUES (?, ?)', [
        kcId,
        loser.id
      ])
      knowledgeLinks++
    }

    // 4. Delete the alias(es) the merge created, restore folded keeper fields.
    for (const norm of manifest.createdAliasNorms ?? []) {
      runNoSave('DELETE FROM project_aliases WHERE alias_norm = ? AND project_id = ? AND source = ?', [
        norm,
        keeperId,
        'merge'
      ])
    }
    const fieldsRestored = restoreFoldedFields('projects', keeperId, row.folded_fields)

    // 5. Orphan report: keeper links not present before the merge (added since).
    const beforeMeetings = new Set(manifest.keeperBefore.meetingIds)
    const beforeKnowledge = new Set(manifest.keeperBefore.knowledgeIds)
    const orphanedSinceMerge: OrphanLink[] = []
    const nowMeetings = queryAll<{ meeting_id: string; subject: string | null; start_time: string | null }>(
      `SELECT mp.meeting_id, m.subject, m.start_time
       FROM meeting_projects mp LEFT JOIN meetings m ON m.id = mp.meeting_id
       WHERE mp.project_id = ?`,
      [keeperId]
    )
    for (const r of nowMeetings) {
      if (!beforeMeetings.has(r.meeting_id)) {
        orphanedSinceMerge.push({
          table: 'meeting_projects',
          key: r.meeting_id,
          label: r.subject || 'Untitled meeting',
          date: r.start_time
        })
      }
    }
    const nowKnowledge = queryAll<{ knowledge_capture_id: string }>(
      'SELECT knowledge_capture_id FROM knowledge_projects WHERE project_id = ?',
      [keeperId]
    )
    for (const r of nowKnowledge) {
      if (!beforeKnowledge.has(r.knowledge_capture_id)) {
        orphanedSinceMerge.push({
          table: 'knowledge_projects',
          key: r.knowledge_capture_id,
          label: `Knowledge capture ${r.knowledge_capture_id}`,
          date: null
        })
      }
    }

    // 6. Mark the journal undone.
    runNoSave('UPDATE merge_journal SET undone_at = ? WHERE id = ?', [new Date().toISOString(), journalId])

    return {
      loserId: loser.id,
      loserName: loser.name,
      restored: { meetingLinks, speakerLinks: 0, knowledgeLinks, aliases: aliasesRestored, fieldsRestored, skipped },
      orphanedSinceMerge
    }
  })
}

/**
 * Merge-journal entries for an entity (keeper), newest first. By default only
 * open (not-yet-undone) merges are returned — the ones that can still be undone.
 */
export function getMergeJournal(kind: MergeKind, keeperId: string, includeUndone = false): MergeJournalEntry[] {
  const rows = queryAll<MergeJournalRow>(
    `SELECT * FROM merge_journal WHERE kind = ? AND keeper_id = ?
     ${includeUndone ? '' : 'AND undone_at IS NULL'}
     ORDER BY created_at DESC`,
    [kind, keeperId]
  )
  return rows.map((r) => {
    let loserName = 'Unknown'
    let loserId = ''
    let linkCount = 0
    try {
      const loser = JSON.parse(r.loser_snapshot) as { id?: string; name?: string }
      loserName = loser.name ?? 'Unknown'
      loserId = loser.id ?? ''
    } catch {
      /* keep defaults */
    }
    try {
      const m = JSON.parse(r.repointed_manifest)
      if (kind === 'contact') {
        const mm = m as ContactMergeManifest
        linkCount =
          (mm.meetingContacts?.repointed?.length ?? 0) +
          (mm.meetingContacts?.collided?.length ?? 0) +
          (mm.transcriptSpeakers?.repointed?.length ?? 0)
      } else {
        const pm = m as ProjectMergeManifest
        linkCount =
          (pm.meetingProjects?.repointed?.length ?? 0) +
          (pm.meetingProjects?.collided?.length ?? 0) +
          (pm.knowledgeProjects?.repointed?.length ?? 0) +
          (pm.knowledgeProjects?.collided?.length ?? 0)
      }
    } catch {
      /* keep default */
    }
    return {
      id: r.id,
      kind: r.kind,
      keeperId: r.keeper_id,
      loserId,
      loserName,
      createdAt: r.created_at,
      undoneAt: r.undone_at,
      linkCount
    }
  })
}

/**
 * Replace the full set of projects directly assigned to a knowledge capture (v26).
 * Deletes existing knowledge_projects rows for the capture and inserts the new
 * set in one transaction. Passing an empty array clears all direct assignments.
 */
export function setKnowledgeProjects(knowledgeCaptureId: string, projectIds: string[]): void {
  runInTransaction(() => {
    runNoSave('DELETE FROM knowledge_projects WHERE knowledge_capture_id = ?', [knowledgeCaptureId])
    const seen = new Set<string>()
    for (const projectId of projectIds) {
      if (seen.has(projectId)) continue
      seen.add(projectId)
      runNoSave('INSERT OR IGNORE INTO knowledge_projects (knowledge_capture_id, project_id) VALUES (?, ?)', [
        knowledgeCaptureId,
        projectId
      ])
    }
  })
}

/** Projects directly assigned to a knowledge capture via knowledge_projects (v26). */
export function getProjectsForKnowledge(knowledgeCaptureId: string): Project[] {
  return queryAll<Project>(
    `SELECT p.* FROM projects p
     JOIN knowledge_projects kp ON p.id = kp.project_id
     WHERE kp.knowledge_capture_id = ?
     ORDER BY p.name`,
    [knowledgeCaptureId]
  )
}

// =============================================================================
// Project notes: issues / risks / notes (v29)
// =============================================================================

/** Notes for a project, optionally filtered by kind. Open items first, newest first. */
export function getProjectNotes(projectId: string, kind?: 'issue' | 'risk' | 'note'): ProjectNote[] {
  if (kind) {
    return queryAll<ProjectNote>(
      `SELECT * FROM project_notes WHERE project_id = ? AND kind = ?
       ORDER BY (status = 'open') DESC, created_at DESC`,
      [projectId, kind]
    )
  }
  return queryAll<ProjectNote>(
    `SELECT * FROM project_notes WHERE project_id = ?
     ORDER BY (status = 'open') DESC, created_at DESC`,
    [projectId]
  )
}

/** Add a note to a project. Returns the created row. */
export function addProjectNote(projectId: string, kind: 'issue' | 'risk' | 'note', content: string): ProjectNote {
  const id = randomUUID()
  const createdAt = new Date().toISOString()
  run(
    `INSERT INTO project_notes (id, project_id, kind, content, status, created_at)
     VALUES (?, ?, ?, ?, 'open', ?)`,
    [id, projectId, kind, content, createdAt]
  )
  return queryOne<ProjectNote>('SELECT * FROM project_notes WHERE id = ?', [id])!
}

/**
 * Update a project note's content and/or status. Setting status to 'resolved'
 * stamps resolved_at; reopening clears it. Returns the updated row.
 *
 * @throws if the note does not exist.
 */
export function updateProjectNote(
  id: string,
  fields: { content?: string; status?: 'open' | 'resolved' }
): ProjectNote {
  const existing = queryOne<ProjectNote>('SELECT * FROM project_notes WHERE id = ?', [id])
  if (!existing) throw new Error(`Project note ${id} not found`)

  const updates: string[] = []
  const params: unknown[] = []

  if (fields.content !== undefined) {
    updates.push('content = ?')
    params.push(fields.content)
  }
  if (fields.status !== undefined) {
    updates.push('status = ?')
    params.push(fields.status)
    updates.push('resolved_at = ?')
    params.push(fields.status === 'resolved' ? new Date().toISOString() : null)
  }

  if (updates.length > 0) {
    params.push(id)
    run(`UPDATE project_notes SET ${updates.join(', ')} WHERE id = ?`, params)
  }

  return queryOne<ProjectNote>('SELECT * FROM project_notes WHERE id = ?', [id])!
}

/** Delete a project note. */
export function deleteProjectNote(id: string): void {
  run('DELETE FROM project_notes WHERE id = ?', [id])
}

/**
 * Actionables whose source knowledge links to a project (v29). Reuses the same
 * two-path union as getKnowledgeIdsForProject (transitive project→meeting→
 * recording→capture, plus direct knowledge_projects), then selects actionables
 * on source_knowledge_id. Newest first.
 */
export function getActionablesForProject(projectId: string): Record<string, unknown>[] {
  return queryAll<Record<string, unknown>>(
    `SELECT DISTINCT a.* FROM actionables a
     WHERE a.source_knowledge_id IN (
       SELECT kc.id FROM knowledge_captures kc
       JOIN recordings r ON kc.source_recording_id = r.id
       JOIN meeting_projects mp ON r.meeting_id = mp.meeting_id
       WHERE mp.project_id = ?
       UNION
       SELECT knowledge_capture_id FROM knowledge_projects WHERE project_id = ?
     )
     ORDER BY a.created_at DESC`,
    [projectId, projectId]
  )
}

// =============================================================================
// Action item assignee → contact (v26)
// =============================================================================

export interface ActionItem {
  id: string
  knowledge_capture_id: string
  content: string
  assignee: string | null
  assignee_contact_id: string | null
  due_date: string | null
  priority: string
  status: string
}

/**
 * Bind (or clear) the canonical contact for an action item's assignee (v26).
 * The raw `assignee` name string is left untouched — this only sets the id link.
 * Pass null to clear the binding. Returns the updated row.
 *
 * @throws if the action item does not exist.
 */
export function setActionItemAssignee(actionItemId: string, contactId: string | null): ActionItem {
  const item = queryOne<ActionItem>('SELECT * FROM action_items WHERE id = ?', [actionItemId])
  if (!item) throw new Error(`Action item ${actionItemId} not found`)
  run('UPDATE action_items SET assignee_contact_id = ?, updated_at = ? WHERE id = ?', [
    contactId,
    new Date().toISOString(),
    actionItemId
  ])
  return queryOne<ActionItem>('SELECT * FROM action_items WHERE id = ?', [actionItemId])!
}

/**
 * Resolve a contact by case-insensitive exact name (v26). Backs graph:resolvePerson
 * so the renderer's name-based resolution has a direct path instead of scanning
 * the full contact roster. Returns the first match or undefined.
 */
export function getContactByName(name: string): Contact | undefined {
  return queryOne<Contact>('SELECT * FROM contacts WHERE LOWER(name) = LOWER(?) LIMIT 1', [name])
}

// =============================================================================
// Alias memory + identity suggestions (v27, Round 4a)
// =============================================================================

export type AliasSource = 'merge' | 'speaker_assign' | 'manual' | 'inferred' | 'rejected'

/** Upsert (INSERT OR REPLACE on the UNIQUE alias_norm) a contact alias, no auto-save. */
function upsertContactAliasNoSave(contactId: string, aliasName: string, source: AliasSource, confidence: number): void {
  const norm = normalizeName(aliasName)
  if (!norm) return
  runNoSave(
    `INSERT OR REPLACE INTO contact_aliases (id, alias_norm, contact_id, source, confidence, created_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [randomUUID(), norm, contactId, source, confidence, new Date().toISOString()]
  )
}

/** Upsert a contact alias (auto-saves). Public entry for callers outside a tx. */
export function upsertContactAlias(contactId: string, aliasName: string, source: AliasSource, confidence: number): void {
  const norm = normalizeName(aliasName)
  if (!norm) return
  run(
    `INSERT OR REPLACE INTO contact_aliases (id, alias_norm, contact_id, source, confidence, created_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [randomUUID(), norm, contactId, source, confidence, new Date().toISOString()]
  )
}

/** A stored alias for a contact (the "Also known as" names folded onto a person). */
export interface ContactAlias {
  alias: string
  source: AliasSource | null
  confidence: number | null
  created_at: string
}

/**
 * Every "also known as" alias for a contact, newest first, excluding rejected
 * ('Different person…') blocks — those are negative memory, not a name the
 * person is known by. Backs identity:getAliases for the PersonDetail chip row.
 * Returns [] if the table is absent (pre-v27 on-disk DB) rather than throwing.
 */
export function getContactAliases(contactId: string): ContactAlias[] {
  const id = (contactId || '').trim()
  if (!id) return []
  try {
    return queryAll<ContactAlias>(
      `SELECT alias_norm AS alias, source, confidence, created_at
         FROM contact_aliases
        WHERE contact_id = ? AND (source IS NULL OR source <> 'rejected')
        ORDER BY created_at DESC`,
      [id]
    )
  } catch {
    return []
  }
}

/** Upsert a project alias, no auto-save (for use inside a transaction). */
function upsertProjectAliasNoSave(projectId: string, aliasName: string, source: AliasSource, confidence: number): void {
  const norm = normalizeName(aliasName)
  if (!norm) return
  runNoSave(
    `INSERT OR REPLACE INTO project_aliases (id, alias_norm, project_id, source, confidence, created_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [randomUUID(), norm, projectId, source, confidence, new Date().toISOString()]
  )
}

/** Upsert a project alias (auto-saves). */
export function upsertProjectAlias(projectId: string, aliasName: string, source: AliasSource, confidence: number): void {
  const norm = normalizeName(aliasName)
  if (!norm) return
  run(
    `INSERT OR REPLACE INTO project_aliases (id, alias_norm, project_id, source, confidence, created_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [randomUUID(), norm, projectId, source, confidence, new Date().toISOString()]
  )
}

export interface IdentitySuggestion {
  id: string
  kind: 'person' | 'project'
  candidate_name: string
  target_id: string
  confidence: number | null
  evidence: string | null
  status: 'pending' | 'accepted' | 'rejected'
  created_at: string
}

/**
 * Queue an identity suggestion (the 0.5–0.8 resolver band). INSERT OR IGNORE on
 * UNIQUE(kind, candidate_name, target_id) so a settled pairing is never re-queued
 * — a prior 'rejected'/'accepted' row for the same pairing wins. Uses run() so it
 * composes with applyTranscriptEntities' existing run()-based transaction.
 */
export function insertIdentitySuggestion(
  kind: 'person' | 'project',
  candidateName: string,
  targetId: string,
  confidence: number,
  evidence: Record<string, unknown>
): void {
  run(
    `INSERT OR IGNORE INTO identity_suggestions (id, kind, candidate_name, target_id, confidence, evidence, status, created_at)
     VALUES (?, ?, ?, ?, ?, ?, 'pending', ?)`,
    [randomUUID(), kind, candidateName, targetId, confidence, JSON.stringify(evidence ?? {}), new Date().toISOString()]
  )
}

/** List identity suggestions, optionally filtered by status. Highest confidence first. */
export function getIdentitySuggestions(status?: 'pending' | 'accepted' | 'rejected'): IdentitySuggestion[] {
  if (status) {
    return queryAll<IdentitySuggestion>(
      'SELECT * FROM identity_suggestions WHERE status = ? ORDER BY confidence DESC, created_at DESC',
      [status]
    )
  }
  return queryAll<IdentitySuggestion>('SELECT * FROM identity_suggestions ORDER BY confidence DESC, created_at DESC')
}

/** Outcome of accepting a suggestion — the row plus undo/cascade metadata. */
export interface AcceptSuggestionResult extends IdentitySuggestion {
  /** merge_journal id when the accept merged two existing entities (undo handle); null for alias-only accepts. */
  mergeJournalId: string | null
  /** How many other pending suggestions were auto-rejected because the merge deleted their loser/keeper. */
  supersededCount: number
}

/** Every merge_journal id for a keeper — snapshot before a merge to spot the row it writes. */
function mergeJournalIdsFor(kind: MergeKind, keeperId: string): Set<string> {
  return new Set(
    queryAll<{ id: string }>('SELECT id FROM merge_journal WHERE kind = ? AND keeper_id = ?', [kind, keeperId]).map(
      (r) => r.id
    )
  )
}

/**
 * Auto-reject the OTHER pending suggestions a just-completed merge rendered moot:
 * any suggestion that targets the now-deleted `loserId` (its keeper is gone) or
 * proposes merging that same loser again (evidence.loserId). Flips them to
 * 'rejected' with evidence.superseded=true — a status change ONLY, never a
 * rejected-alias block, so a legitimate future pairing is not poisoned. Excludes
 * `exceptId` (the suggestion being accepted). Caller runs this inside a transaction.
 */
export function supersedeSuggestionsForMergedLoser(
  kind: 'person' | 'project',
  loserId: string,
  exceptId: string
): number {
  const table = kind === 'person' ? 'contacts' : 'projects'
  const pending = queryAll<IdentitySuggestion>(
    "SELECT * FROM identity_suggestions WHERE status = 'pending' AND kind = ? AND id != ?",
    [kind, exceptId]
  )
  let superseded = 0
  for (const s of pending) {
    let ev: Record<string, unknown> = {}
    try {
      ev = s.evidence ? (JSON.parse(s.evidence) as Record<string, unknown>) : {}
    } catch {
      ev = {}
    }
    // Keeper-death cascade: also drop a suggestion whose keeper (target_id) is gone —
    // a merge may have absorbed the keeper itself, not just the reviewed loser.
    const targetGone = !queryOne<{ id: string }>(`SELECT id FROM ${table} WHERE id = ?`, [s.target_id])
    if (s.target_id !== loserId && ev.loserId !== loserId && !targetGone) continue
    ev.superseded = true
    runNoSave("UPDATE identity_suggestions SET status = 'rejected', evidence = ? WHERE id = ?", [
      JSON.stringify(ev),
      s.id
    ])
    superseded++
  }
  return superseded
}

/**
 * Keeper-death cascade for merges performed OUTSIDE the accept flow (the "merge into
 * someone else" third door, a direction swap, or a group-canonical batch). Any of
 * those can absorb a suggestion's keeper (target_id) into a different entity, leaving
 * sibling suggestions pointing at a keeper row that no longer exists. This flips every
 * such orphaned pending suggestion to 'rejected' with evidence.superseded=true (status
 * only — no rejected-alias block, so a legitimate future pairing is not poisoned).
 * Standalone + transactional; returns the number superseded.
 */
export function supersedeOrphanedSuggestions(kind?: 'person' | 'project'): number {
  return runInTransaction(() => {
    const pending = kind
      ? queryAll<IdentitySuggestion>("SELECT * FROM identity_suggestions WHERE status = 'pending' AND kind = ?", [kind])
      : queryAll<IdentitySuggestion>("SELECT * FROM identity_suggestions WHERE status = 'pending'")
    let superseded = 0
    for (const s of pending) {
      const table = s.kind === 'person' ? 'contacts' : 'projects'
      if (queryOne<{ id: string }>(`SELECT id FROM ${table} WHERE id = ?`, [s.target_id])) continue
      let ev: Record<string, unknown> = {}
      try {
        ev = s.evidence ? (JSON.parse(s.evidence) as Record<string, unknown>) : {}
      } catch {
        ev = {}
      }
      ev.superseded = true
      runNoSave("UPDATE identity_suggestions SET status = 'rejected', evidence = ? WHERE id = ?", [
        JSON.stringify(ev),
        s.id
      ])
      superseded++
    }
    return superseded
  })
}

/**
 * Accept an identity suggestion. Two shapes:
 *
 *  - **Discovery** (evidence carries a `loserId` for a real, still-present entity):
 *    the suggestion pairs two existing entities (keeper = `target_id`), so accepting
 *    MERGES the loser into the keeper via {@link mergeContacts}/{@link mergeProjects}.
 *    The merge writes a merge_journal row — its id is returned as `mergeJournalId`
 *    so the UI can offer Undo — and any sibling suggestions the merge invalidated are
 *    superseded ({@link supersedeSuggestionsForMergedLoser}).
 *
 *  - **Alias** (no resolvable loser — a raw mention): write `candidate_name` as a
 *    'manual' alias (confidence 1.0) of the target and attach the evidence meeting.
 *    `mergeJournalId` is null.
 *
 * Sets the suggestion status to 'accepted'.
 *
 * @throws if the suggestion does not exist.
 */
export function acceptIdentitySuggestion(id: string): AcceptSuggestionResult {
  const s = queryOne<IdentitySuggestion>('SELECT * FROM identity_suggestions WHERE id = ?', [id])
  if (!s) throw new Error(`Identity suggestion ${id} not found`)

  let evidence: { meetingId?: string; loserId?: string } = {}
  try {
    evidence = s.evidence ? JSON.parse(s.evidence) : {}
  } catch {
    // malformed evidence — treat as a bare alias accept
  }

  const jkind: MergeKind = s.kind === 'person' ? 'contact' : 'project'
  const loserId = evidence.loserId
  const table = s.kind === 'person' ? 'contacts' : 'projects'
  const loserExists =
    !!loserId &&
    loserId !== s.target_id &&
    !!queryOne<{ id: string }>(`SELECT id FROM ${table} WHERE id = ?`, [loserId])

  if (loserExists) {
    const before = mergeJournalIdsFor(jkind, s.target_id)
    if (s.kind === 'person') mergeContacts(s.target_id, loserId!)
    else mergeProjects(s.target_id, loserId!)
    const after = queryAll<{ id: string }>(
      'SELECT id FROM merge_journal WHERE kind = ? AND keeper_id = ? ORDER BY created_at DESC',
      [jkind, s.target_id]
    )
    const mergeJournalId = after.find((r) => !before.has(r.id))?.id ?? null

    const { row, supersededCount } = runInTransaction(() => {
      const count = supersedeSuggestionsForMergedLoser(s.kind, loserId!, id)
      runNoSave("UPDATE identity_suggestions SET status = 'accepted' WHERE id = ?", [id])
      return { row: queryOne<IdentitySuggestion>('SELECT * FROM identity_suggestions WHERE id = ?', [id])!, supersededCount: count }
    })
    return { ...row, mergeJournalId, supersededCount }
  }

  const row = runInTransaction(() => {
    const meetingId = evidence.meetingId
    if (s.kind === 'person') {
      upsertContactAliasNoSave(s.target_id, s.candidate_name, 'manual', 1.0)
      if (meetingId) {
        runNoSave('INSERT OR IGNORE INTO meeting_contacts (meeting_id, contact_id, role) VALUES (?, ?, ?)', [
          meetingId,
          s.target_id,
          'attendee'
        ])
        recomputeContactMeetingCount(s.target_id)
      }
    } else {
      upsertProjectAliasNoSave(s.target_id, s.candidate_name, 'manual', 1.0)
      if (meetingId) {
        runNoSave('INSERT OR IGNORE INTO meeting_projects (meeting_id, project_id) VALUES (?, ?)', [
          meetingId,
          s.target_id
        ])
      }
    }
    runNoSave("UPDATE identity_suggestions SET status = 'accepted' WHERE id = ?", [id])
    return queryOne<IdentitySuggestion>('SELECT * FROM identity_suggestions WHERE id = ?', [id])!
  })
  return { ...row, mergeJournalId: null, supersededCount: 0 }
}

/**
 * Reject an identity suggestion: write a 'rejected' alias so the resolver never
 * links that name to that entity again, and set the suggestion status to
 * 'rejected'. One transaction.
 *
 * @throws if the suggestion does not exist.
 */
export function rejectIdentitySuggestion(id: string): IdentitySuggestion {
  return runInTransaction(() => {
    const s = queryOne<IdentitySuggestion>('SELECT * FROM identity_suggestions WHERE id = ?', [id])
    if (!s) throw new Error(`Identity suggestion ${id} not found`)

    if (s.kind === 'person') {
      upsertContactAliasNoSave(s.target_id, s.candidate_name, 'rejected', 0)
    } else {
      upsertProjectAliasNoSave(s.target_id, s.candidate_name, 'rejected', 0)
    }

    runNoSave("UPDATE identity_suggestions SET status = 'rejected' WHERE id = ?", [id])
    return queryOne<IdentitySuggestion>('SELECT * FROM identity_suggestions WHERE id = ?', [id])!
  })
}

// =============================================================================
// Ambiguous mention buckets + per-recording resolution
// =============================================================================
//
// A bare first name ("Sergio") linked to dozens of recordings is not a person — it
// is an unresolved bucket denoting several real people (detectAmbiguousName). These
// helpers surface those buckets and let a recording's mention be pinned to the real
// contact it means, one recording at a time, without a corpus-wide merge/alias.

export interface AmbiguousCandidate {
  id: string
  name: string
}

/** A recording that mentions a bucket name, with the system's best guess at who it is. */
export interface BucketRecording {
  recordingId: string
  title: string
  date: string | null
  meetingId: string | null
  /** False when the recording is not linked to any meeting (link it first). */
  meetingLinked: boolean
  /** Whether the linked meeting carries CALENDAR attendee data (attendees/organizer
   *  email). Currently false for all meetings until the M365 connector backfills —
   *  the card uses this to be honest that context is transcript-derived. */
  meetingHasCalendarAttendees: boolean
  /** Best-guess real contact for THIS recording (null when unclear). */
  bestGuessId: string | null
  bestGuessName: string | null
  /** How the best guess was derived (see signal-tiers.ts for the hierarchy). */
  method: 'attendee-email' | 'speaker-map' | 'attendee-context' | 'unclear'
  /** Human phrase for the signal ("Hurtado was an attendee"). */
  signal: string
  /** Existing stored decision: contact id, or null when explicitly marked Unclear. */
  resolvedContactId: string | null
  /** The method of the existing stored decision (drives upgrade-only re-sweeps). */
  resolvedMethod: string | null
  resolved: boolean
}

export interface BucketResolution {
  contactId: string
  name: string
  candidates: AmbiguousCandidate[]
  recordings: BucketRecording[]
}

export interface AmbiguousBucket {
  contactId: string
  name: string
  candidates: AmbiguousCandidate[]
  recordingCount: number
  resolvedCount: number
  pendingCount: number
}

/** Build placeholders (?, ?, …) for an IN clause of `n` items. */
function inPlaceholders(n: number): string {
  return new Array(n).fill('?').join(',')
}

/** Compute the full per-recording resolution view for one bucket contact. */
function buildBucketResolution(
  contact: { id: string; name: string },
  allContacts: Array<{ id: string; name: string }>
): BucketResolution {
  const amb = detectAmbiguousName(contact.name, allContacts, contact.id)
  const candidates: AmbiguousCandidate[] = amb.matches.map((m) => ({ id: m.id, name: m.name }))
  const candNameById = new Map(candidates.map((c) => [c.id, c.name]))
  const candIds = candidates.map((c) => c.id)
  const nameKey = normalizeName(contact.name)

  const recRows =
    candIds.length === 0
      ? []
      : queryAll<{ recordingId: string; filename: string | null; date: string | null; meetingId: string | null; subject: string | null }>(
          `SELECT DISTINCT r.id AS recordingId, r.filename AS filename, r.date_recorded AS date,
                  r.meeting_id AS meetingId, m.subject AS subject
             FROM recordings r
             JOIN meetings m ON m.id = r.meeting_id
             JOIN meeting_contacts mc ON mc.meeting_id = m.id
            WHERE mc.contact_id = ?
              AND COALESCE(r.personal, 0) = 0 AND r.deleted_at IS NULL
            ORDER BY r.date_recorded DESC`,
          [contact.id]
        )

  const recIds = recRows.map((r) => r.recordingId)
  const meetingIds = [...new Set(recRows.map((r) => r.meetingId).filter((x): x is string => !!x))]

  // Which of these meetings carry CALENDAR attendee data (attendees JSON / organizer
  // email) vs transcript-derived people only. Drives the attendee-email (tier 2) vs
  // attendee-context (tier 4) distinction and the card's honest "no attendee list"
  // message. Currently empty for all meetings until M365 backfills (see signal-tiers).
  const calendarMeetings = new Set<string>()
  if (meetingIds.length > 0) {
    for (const row of queryAll<{ id: string; attendees: string | null; organizer_email: string | null }>(
      `SELECT id, attendees, organizer_email FROM meetings WHERE id IN (${inPlaceholders(meetingIds.length)})`,
      meetingIds
    )) {
      const hasOrganizer = !!(row.organizer_email && row.organizer_email.trim())
      let hasAttendees = false
      try {
        const parsed = row.attendees ? (JSON.parse(row.attendees) as unknown[]) : []
        hasAttendees = Array.isArray(parsed) && parsed.length > 0
      } catch {
        hasAttendees = false
      }
      if (hasOrganizer || hasAttendees) calendarMeetings.add(row.id)
    }
  }

  // Batch the three signal sources so the whole bucket costs a fixed number of queries.
  const speakerByRec = new Map<string, Set<string>>() // recording → candidate ids named as speakers
  if (recIds.length > 0 && candIds.length > 0) {
    for (const row of queryAll<{ recording_id: string; contact_id: string }>(
      `SELECT DISTINCT recording_id, contact_id FROM transcript_speakers
        WHERE recording_id IN (${inPlaceholders(recIds.length)}) AND contact_id IN (${inPlaceholders(candIds.length)})`,
      [...recIds, ...candIds]
    )) {
      let s = speakerByRec.get(row.recording_id)
      if (!s) speakerByRec.set(row.recording_id, (s = new Set()))
      s.add(row.contact_id)
    }
  }

  const attendeeByMeeting = new Map<string, Set<string>>() // meeting → candidate ids attending
  if (meetingIds.length > 0 && candIds.length > 0) {
    for (const row of queryAll<{ meeting_id: string; contact_id: string }>(
      `SELECT meeting_id, contact_id FROM meeting_contacts
        WHERE meeting_id IN (${inPlaceholders(meetingIds.length)}) AND contact_id IN (${inPlaceholders(candIds.length)})`,
      [...meetingIds, ...candIds]
    )) {
      let s = attendeeByMeeting.get(row.meeting_id)
      if (!s) attendeeByMeeting.set(row.meeting_id, (s = new Set()))
      s.add(row.contact_id)
    }
  }

  const resolutionByRec = new Map<string, { contactId: string | null; method: string | null }>()
  if (recIds.length > 0) {
    for (const row of queryAll<{ recording_id: string; resolved_contact_id: string | null; method: string | null }>(
      `SELECT recording_id, resolved_contact_id, method FROM mention_resolutions
        WHERE source_name = ? AND recording_id IN (${inPlaceholders(recIds.length)})`,
      [nameKey, ...recIds]
    )) {
      resolutionByRec.set(row.recording_id, { contactId: row.resolved_contact_id, method: row.method })
    }
  }

  const lastName = (n: string): string => {
    const toks = (n || '').trim().split(/\s+/)
    return toks.length > 1 ? toks[toks.length - 1] : n
  }

  const recordings: BucketRecording[] = recRows.map((r) => {
    const meetingLinked = !!r.meetingId
    const calendarBacked = !!r.meetingId && calendarMeetings.has(r.meetingId)
    const spoken = speakerByRec.get(r.recordingId)
    let bestGuessId: string | null = null
    let method: BucketRecording['method'] = 'unclear'
    let signal: string

    if (!meetingLinked) {
      signal = 'Not linked to a meeting — link it first for automatic resolution.'
    } else {
      signal = 'No attendee or speaker signal — assign manually.'
    }

    if (spoken && spoken.size === 1) {
      // A user-confirmed speaker map is stronger than transcript co-presence.
      bestGuessId = [...spoken][0]
      method = 'speaker-map'
      signal = `${lastName(candNameById.get(bestGuessId) || '')} named as a speaker`
    } else {
      const attending = r.meetingId ? attendeeByMeeting.get(r.meetingId) : undefined
      if (attending && attending.size === 1) {
        bestGuessId = [...attending][0]
        const who = lastName(candNameById.get(bestGuessId) || '')
        if (calendarBacked) {
          method = 'attendee-email'
          signal = `${who} was a calendar attendee`
        } else {
          // Meeting people are transcript-derived (no calendar attendees yet) — honest.
          method = 'attendee-context'
          signal = `${who} was in this meeting (from transcript)`
        }
      } else if (attending && attending.size > 1) {
        signal = `${attending.size} candidates in this meeting — ambiguous`
      } else if (meetingLinked && !calendarBacked) {
        signal = 'No attendee list for this meeting — connect Microsoft 365 for automatic resolution.'
      }
    }

    const stored = resolutionByRec.get(r.recordingId)
    const decided = stored !== undefined

    return {
      recordingId: r.recordingId,
      title: r.subject || r.filename || r.recordingId,
      date: r.date,
      meetingId: r.meetingId,
      meetingLinked,
      meetingHasCalendarAttendees: calendarBacked,
      bestGuessId,
      bestGuessName: bestGuessId ? candNameById.get(bestGuessId) ?? null : null,
      method,
      signal,
      resolvedContactId: decided ? stored!.contactId : null,
      resolvedMethod: decided ? stored!.method : null,
      resolved: decided
    }
  })

  return { contactId: contact.id, name: contact.name, candidates, recordings }
}

/** Every contact that is an ambiguous mention bucket, with resolution progress. */
export function getAmbiguousBuckets(): AmbiguousBucket[] {
  const contacts = queryAll<{ id: string; name: string }>('SELECT id, name FROM contacts')
  const buckets: AmbiguousBucket[] = []
  for (const c of contacts) {
    const amb = detectAmbiguousName(c.name, contacts, c.id)
    if (!amb.ambiguous) continue
    const res = buildBucketResolution(c, contacts)
    const resolvedCount = res.recordings.filter((r) => r.resolved).length
    buckets.push({
      contactId: c.id,
      name: c.name,
      candidates: res.candidates,
      recordingCount: res.recordings.length,
      resolvedCount,
      pendingCount: res.recordings.length - resolvedCount
    })
  }
  // Most recordings first — the biggest buckets are the most valuable to split.
  buckets.sort((a, b) => b.recordingCount - a.recordingCount)
  return buckets
}

/** Set of contact ids that are ambiguous buckets (for callers that must skip merges). */
export function getAmbiguousBucketIds(): Set<string> {
  const contacts = queryAll<{ id: string; name: string }>('SELECT id, name FROM contacts')
  const ids = new Set<string>()
  for (const c of contacts) {
    if (detectAmbiguousName(c.name, contacts, c.id).ambiguous) ids.add(c.id)
  }
  return ids
}

/** Full per-recording resolution view for one bucket contact, or null if not a bucket. */
export function getBucketResolution(contactId: string): BucketResolution | null {
  const contacts = queryAll<{ id: string; name: string }>('SELECT id, name FROM contacts')
  const contact = contacts.find((c) => c.id === contactId)
  if (!contact) return null
  const amb = detectAmbiguousName(contact.name, contacts, contact.id)
  if (!amb.ambiguous) return null
  return buildBucketResolution(contact, contacts)
}

/** A stored per-recording mention decision (decided=false ⇒ resolve normally). */
export interface MentionDecision {
  decided: boolean
  /** Resolved contact id, or null when the user explicitly marked it Unclear. */
  contactId: string | null
}

/** Look up a stored per-recording resolution for a raw mention name. */
export function getMentionResolution(recordingId: string, sourceName: string): MentionDecision {
  const row = queryOne<{ resolved_contact_id: string | null }>(
    'SELECT resolved_contact_id FROM mention_resolutions WHERE recording_id = ? AND source_name = ?',
    [recordingId, normalizeName(sourceName)]
  )
  return row ? { decided: true, contactId: row.resolved_contact_id } : { decided: false, contactId: null }
}

/** Upsert a per-recording mention resolution inside an existing transaction (no save). */
export function recordMentionResolutionNoSave(
  recordingId: string,
  sourceName: string,
  contactId: string | null,
  method: string,
  confidence: number
): void {
  const key = normalizeName(sourceName)
  if (!recordingId || !key) return
  runNoSave(
    `INSERT OR REPLACE INTO mention_resolutions
       (id, recording_id, source_name, resolved_contact_id, method, confidence, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [randomUUID(), recordingId, key, contactId, method, confidence, new Date().toISOString()]
  )
}

/**
 * Assign (or clear) the real contact a bucket mention denotes in one recording.
 * Stores the decision and, when a contact is chosen, links that recording's meeting
 * to them so the attribution follows. `contactId = null` records an explicit
 * "Unclear" so the sweep and re-analysis leave that recording alone. Auto-saves.
 */
export function resolveMention(
  recordingId: string,
  sourceName: string,
  contactId: string | null,
  method = 'manual',
  confidence = 1.0
): void {
  runInTransaction(() => {
    recordMentionResolutionNoSave(recordingId, sourceName, contactId, method, confidence)
    if (contactId) {
      const rec = queryOne<{ meeting_id: string | null }>('SELECT meeting_id FROM recordings WHERE id = ?', [
        recordingId
      ])
      if (rec?.meeting_id) {
        runNoSave('INSERT OR IGNORE INTO meeting_contacts (meeting_id, contact_id, role) VALUES (?, ?, ?)', [
          rec.meeting_id,
          contactId,
          'attendee'
        ])
        recomputeContactMeetingCount(contactId)
      }
    }
  })
}

/**
 * Get all transcript topics for a project's meetings in a single JOIN query.
 * Eliminates N+1: project -> meeting_projects -> recordings -> transcripts
 * Returns the raw topics JSON strings (caller parses them).
 */
export function getTopicsForProjectMeetings(projectId: string): string[] {
  const rows = queryAll<{ topics: string }>(
    `SELECT t.topics FROM transcripts t
     JOIN recordings r ON t.recording_id = r.id
     JOIN meeting_projects mp ON r.meeting_id = mp.meeting_id
     WHERE mp.project_id = ? AND t.topics IS NOT NULL`,
    [projectId]
  )
  return rows.map(r => r.topics)
}

// =============================================================================
// Recording-Meeting Candidate queries (AI-powered matching)
// =============================================================================

export interface RecordingMeetingCandidate {
  id: string
  recording_id: string
  meeting_id: string
  confidence_score: number
  match_reason: string | null
  is_selected: boolean
  is_ai_selected: boolean
  is_user_confirmed: boolean
  created_at: string
}

/**
 * Find all meetings that overlap with a recording's time window
 * Uses a buffer of 30 minutes before and after the recording
 */
export function findCandidateMeetingsForRecording(recordingId: string): Meeting[] {
  const recording = getRecordingById(recordingId)
  if (!recording) return []

  const recStart = new Date(recording.date_recorded)
  const durationMs = (recording.duration_seconds || 30 * 60) * 1000
  const recEnd = new Date(recStart.getTime() + durationMs)

  // Buffer: 30 min before recording start, 30 min after recording end
  const bufferMs = 30 * 60 * 1000
  const windowStart = new Date(recStart.getTime() - bufferMs).toISOString()
  const windowEnd = new Date(recEnd.getTime() + bufferMs).toISOString()

  // Find meetings that overlap with this time window
  return queryAll<Meeting>(
    `SELECT * FROM meetings
     WHERE (start_time <= ? AND end_time >= ?)
        OR (start_time >= ? AND start_time <= ?)
        OR (end_time >= ? AND end_time <= ?)
     ORDER BY start_time`,
    [windowEnd, windowStart, windowStart, windowEnd, windowStart, windowEnd]
  )
}

/**
 * Add a candidate meeting for a recording
 */
export function addRecordingMeetingCandidate(
  recordingId: string,
  meetingId: string,
  confidenceScore: number,
  matchReason: string,
  isAiSelected: boolean = false
): string {
  const id = crypto.randomUUID()
  run(
    `INSERT OR REPLACE INTO recording_meeting_candidates
      (id, recording_id, meeting_id, confidence_score, match_reason, is_selected, is_ai_selected)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [id, recordingId, meetingId, confidenceScore, matchReason, isAiSelected ? 1 : 0, isAiSelected ? 1 : 0]
  )

  // If AI selected, also update the recording's meeting_id
  if (isAiSelected) {
    linkRecordingToMeeting(recordingId, meetingId, confidenceScore, 'ai_transcript_match')
  }

  return id
}

/**
 * Get all candidate meetings for a recording
 */
export function getCandidatesForRecording(recordingId: string): Array<RecordingMeetingCandidate & { meeting: Meeting }> {
  const candidates = queryAll<RecordingMeetingCandidate>(
    `SELECT * FROM recording_meeting_candidates WHERE recording_id = ? ORDER BY confidence_score DESC`,
    [recordingId]
  )

  return candidates.map(c => ({
    ...c,
    is_selected: !!c.is_selected,
    is_ai_selected: !!c.is_ai_selected,
    is_user_confirmed: !!c.is_user_confirmed,
    meeting: getMeetingById(c.meeting_id)!
  })).filter(c => c.meeting)
}

/**
 * User selects a different meeting for a recording (override AI selection)
 */
export function selectMeetingForRecording(recordingId: string, meetingId: string): void {
  // Clear previous selection
  run('UPDATE recording_meeting_candidates SET is_selected = 0 WHERE recording_id = ?', [recordingId])

  // Set new selection
  run(
    `UPDATE recording_meeting_candidates SET is_selected = 1, is_user_confirmed = 1 WHERE recording_id = ? AND meeting_id = ?`,
    [recordingId, meetingId]
  )

  // Update the recording's meeting_id
  linkRecordingToMeeting(recordingId, meetingId, 1.0, 'user_override')
}

/**
 * Get recording with its matched meeting and duration comparison
 */
export interface RecordingWithMeetingMatch extends Recording {
  meeting?: Meeting
  duration_match: 'shorter' | 'longer' | 'matched' | 'no_meeting'
  duration_difference_seconds: number
  has_conflicts: boolean
  conflict_count: number
}

export function getRecordingWithMatchInfo(recordingId: string): RecordingWithMeetingMatch | undefined {
  const recording = getRecordingById(recordingId)
  if (!recording) return undefined

  const meeting = recording.meeting_id ? getMeetingById(recording.meeting_id) : undefined
  const candidates = getCandidatesForRecording(recordingId)

  let durationMatch: 'shorter' | 'longer' | 'matched' | 'no_meeting' = 'no_meeting'
  let durationDifference = 0

  if (meeting && recording.duration_seconds) {
    const meetingStart = new Date(meeting.start_time).getTime()
    const meetingEnd = new Date(meeting.end_time).getTime()
    const meetingDurationSeconds = (meetingEnd - meetingStart) / 1000

    durationDifference = recording.duration_seconds - meetingDurationSeconds

    // 5 minute tolerance
    if (Math.abs(durationDifference) < 300) {
      durationMatch = 'matched'
    } else if (durationDifference < 0) {
      durationMatch = 'shorter'
    } else {
      durationMatch = 'longer'
    }
  }

  return {
    ...recording,
    meeting,
    duration_match: durationMatch,
    duration_difference_seconds: durationDifference,
    has_conflicts: candidates.length > 1,
    conflict_count: candidates.length
  }
}

// =============================================================================
// Recording-Meeting Linking Functions (UI Dialog Support)
// =============================================================================

export interface MeetingCandidateWithDetails {
  id: string
  recordingId: string
  meetingId: string
  subject: string
  startTime: string
  endTime: string
  confidenceScore: number
  matchReason: string | null
  isAiSelected: boolean
  isUserConfirmed: boolean
  /** True for an all-day meeting — a WEAK time signal in match scoring. */
  isAllDay: boolean
}

export function getCandidatesForRecordingWithDetails(recordingId: string): MeetingCandidateWithDetails[] {
  if (!recordingId || typeof recordingId !== 'string') return []

  const sql = `
    SELECT c.id, c.recording_id, c.meeting_id, c.confidence_score, c.match_reason,
      c.is_ai_selected, c.is_user_confirmed, m.subject, m.start_time, m.end_time, m.is_all_day
    FROM recording_meeting_candidates c
    JOIN meetings m ON m.id = c.meeting_id
    WHERE c.recording_id = ?
    ORDER BY c.confidence_score DESC LIMIT 20
  `

  try {
    const rows = queryAll<{
      id: string; recording_id: string; meeting_id: string; confidence_score: number
      match_reason: string | null; is_ai_selected: number; is_user_confirmed: number
      subject: string; start_time: string; end_time: string; is_all_day: number | null
    }>(sql, [recordingId])

    return rows.map(r => ({
      id: r.id, recordingId: r.recording_id, meetingId: r.meeting_id,
      subject: r.subject, startTime: r.start_time, endTime: r.end_time,
      confidenceScore: r.confidence_score, matchReason: r.match_reason,
      isAiSelected: r.is_ai_selected === 1, isUserConfirmed: r.is_user_confirmed === 1,
      isAllDay: (r.is_all_day ?? 0) === 1
    }))
  } catch (error) {
    console.error('Failed to get candidates for recording:', error)
    return []
  }
}

export function getMeetingsNearDate(date: string): Meeting[] {
  if (!date || typeof date !== 'string') return []
  const targetDate = new Date(date)
  if (isNaN(targetDate.getTime())) return []

  const bufferMs = 12 * 60 * 60 * 1000
  const startWindow = new Date(targetDate.getTime() - bufferMs)
  const endWindow = new Date(targetDate.getTime() + bufferMs)

  try {
    return queryAll<Meeting>(
      `SELECT * FROM meetings WHERE start_time >= ? AND start_time <= ?
       ORDER BY ABS(JULIANDAY(start_time) - JULIANDAY(?)) LIMIT 20`,
      [startWindow.toISOString(), endWindow.toISOString(), targetDate.toISOString()]
    )
  } catch (error) {
    console.error('Failed to get meetings near date:', error)
    return []
  }
}

export function selectMeetingForRecordingByUser(recordingId: string, meetingId: string | null): void {
  const db = getDatabase()
  if (!recordingId || typeof recordingId !== 'string') throw new Error('Invalid recording ID')

  try {
    db.run('BEGIN TRANSACTION')
    if (meetingId !== null && !getMeetingById(meetingId)) {
      throw new Error(`Meeting ${meetingId} no longer exists`)
    }
    run('UPDATE recording_meeting_candidates SET is_selected = 0 WHERE recording_id = ?', [recordingId])

    if (meetingId === null) {
      run(`UPDATE recordings SET meeting_id = NULL, correlation_confidence = NULL,
           correlation_method = 'user_standalone' WHERE id = ?`, [recordingId])
    } else {
      run(`UPDATE recording_meeting_candidates SET is_selected = 1, is_user_confirmed = 1
           WHERE recording_id = ? AND meeting_id = ?`, [recordingId, meetingId])
      linkRecordingToMeeting(recordingId, meetingId, 1.0, 'user_override')
    }
    db.run('COMMIT')
    saveDatabase()
  } catch (error) {
    db.run('ROLLBACK')
    throw error
  }
}

export function resetStuckTranscriptions(): { recordingsReset: number; queueItemsReset: number } {
  const db = getDatabase()
  db.run("UPDATE recordings SET transcription_status = 'none' WHERE transcription_status IN ('processing', 'pending')")
  const recordingsReset = db.getRowsModified()
  db.run("UPDATE transcription_queue SET status = 'pending' WHERE status = 'processing'")
  const queueItemsReset = db.getRowsModified()
  console.log(`[Database] Reset stuck transcriptions: ${recordingsReset} recordings, ${queueItemsReset} queue items`)
  return { recordingsReset, queueItemsReset }
}

// =============================================================================
// Quality Assessment queries (v10)
// =============================================================================

export interface QualityAssessment {
  id: string
  recording_id: string
  quality: 'high' | 'medium' | 'low'
  assessment_method: 'auto' | 'manual'
  confidence: number
  reason?: string
  assessed_at: string
  assessed_by?: string
}

export function getQualityAssessment(recordingId: string): QualityAssessment | undefined {
  return queryOne<QualityAssessment>('SELECT * FROM quality_assessments WHERE recording_id = ?', [recordingId])
}

export function upsertQualityAssessment(assessment: Omit<QualityAssessment, 'assessed_at'>): void {
  const existing = getQualityAssessment(assessment.recording_id)

  if (existing) {
    run(
      `UPDATE quality_assessments SET
        quality = ?, assessment_method = ?, confidence = ?, reason = ?, assessed_by = ?
      WHERE recording_id = ?`,
      [
        assessment.quality,
        assessment.assessment_method,
        assessment.confidence,
        assessment.reason ?? null,
        assessment.assessed_by ?? null,
        assessment.recording_id
      ]
    )
  } else {
    run(
      `INSERT INTO quality_assessments (id, recording_id, quality, assessment_method, confidence, reason, assessed_by)
      VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [
        assessment.id,
        assessment.recording_id,
        assessment.quality,
        assessment.assessment_method,
        assessment.confidence,
        assessment.reason ?? null,
        assessment.assessed_by ?? null
      ]
    )
  }
}

export function getRecordingsByQuality(quality: 'high' | 'medium' | 'low'): Recording[] {
  return queryAll<Recording>(
    `SELECT r.* FROM recordings r
     JOIN quality_assessments qa ON r.id = qa.recording_id
     WHERE qa.quality = ?
     ORDER BY r.date_recorded DESC`,
    [quality]
  )
}

export function updateRecordingStorageTier(
  recordingId: string,
  tier: 'hot' | 'warm' | 'cold' | 'archive' | null
): void {
  run('UPDATE recordings SET storage_tier = ? WHERE id = ?', [tier, recordingId])
}

export function getRecordingsByStorageTier(tier: 'hot' | 'warm' | 'cold' | 'archive'): Recording[] {
  return queryAll<Recording>(
    'SELECT * FROM recordings WHERE storage_tier = ? ORDER BY date_recorded DESC',
    [tier]
  )
}

// =============================================================================
// Async wrappers for database operations (prevents main thread blocking)
// =============================================================================

/**
 * Async wrapper for getRecordingById - yields to event loop using setImmediate
 * Use this in non-batch operations to prevent blocking the main thread
 */
export async function getRecordingByIdAsync(id: string): Promise<Recording | undefined> {
  return new Promise((resolve) => {
    setImmediate(() => resolve(getRecordingById(id)))
  })
}

/**
 * Async wrapper for getTranscriptByRecordingId - yields to event loop using setImmediate
 */
export async function getTranscriptByRecordingIdAsync(recordingId: string): Promise<Transcript | undefined> {
  return new Promise((resolve) => {
    setImmediate(() => resolve(getTranscriptByRecordingId(recordingId)))
  })
}

/**
 * Async wrapper for queryAll - yields to event loop using setImmediate
 */
export async function queryAllAsync<T>(sql: string, params: unknown[] = []): Promise<T[]> {
  return new Promise((resolve) => {
    setImmediate(() => resolve(queryAll<T>(sql, params)))
  })
}

/**
 * Async wrapper for upsertQualityAssessment - yields to event loop using setImmediate
 */
export async function upsertQualityAssessmentAsync(assessment: Omit<QualityAssessment, 'assessed_at'>): Promise<void> {
  return new Promise((resolve) => {
    setImmediate(() => {
      upsertQualityAssessment(assessment)
      resolve()
    })
  })
}

/**
 * Async wrapper for getQualityAssessment - yields to event loop using setImmediate
 */
export async function getQualityAssessmentAsync(recordingId: string): Promise<QualityAssessment | undefined> {
  return new Promise((resolve) => {
    setImmediate(() => resolve(getQualityAssessment(recordingId)))
  })
}

/**
 * Async wrapper for updateRecordingStorageTier - yields to event loop using setImmediate
 */
export async function updateRecordingStorageTierAsync(
  recordingId: string,
  tier: 'hot' | 'warm' | 'cold' | 'archive' | null
): Promise<void> {
  return new Promise((resolve) => {
    setImmediate(() => {
      updateRecordingStorageTier(recordingId, tier)
      resolve()
    })
  })
}

// =============================================================================
// Transcription Service Mutex Lock (spec-005)
// =============================================================================

/**
 * Clear any stale transcription lock left by a previous app instance.
 * Must be called once on startup before the transcription processor starts.
 * The lock is per-process-run (process_id includes Date.now()), so any lock
 * present at startup is guaranteed stale — the process that held it is dead.
 */
export function clearStaleTranscriptionLock(): void {
  const database = getDatabase()
  const now = new Date().toISOString()

  // Ensure the lock row exists (handles edge case where migration didn't insert it)
  database.run(
    `INSERT OR IGNORE INTO transcription_service_lock (id, process_id, acquired_at, updated_at) VALUES (1, NULL, NULL, ?)`,
    [now]
  )

  // Unconditionally clear the lock
  database.run(
    `UPDATE transcription_service_lock SET process_id = NULL, acquired_at = NULL, updated_at = ? WHERE id = 1`,
    [now]
  )

  console.log('[Transcription] Stale lock cleared on startup')
}

/**
 * Atomically acquire the transcription service lock.
 * Uses a database transaction to ensure only one process can acquire the lock.
 * @param processId Unique process identifier
 * @returns true if lock acquired, false if already locked
 */
export function acquireTranscriptionLock(processId: string): boolean {
  const database = getDatabase()
  const now = new Date().toISOString()

  // Check current lock status before attempting to acquire
  const currentStatus = database.exec('SELECT process_id, acquired_at FROM transcription_service_lock WHERE id = 1')
  const currentProcessId = currentStatus.length > 0 && currentStatus[0].values.length > 0
    ? currentStatus[0].values[0][0]
    : null

  // If already locked by another process, check for stale lock (held > 5 minutes)
  if (currentProcessId !== null) {
    const acquiredAt = currentStatus[0].values[0][1] as string | null
    const STALE_LOCK_TIMEOUT_MS = 5 * 60 * 1000
    if (acquiredAt) {
      const lockAge = Date.now() - new Date(acquiredAt).getTime()
      if (lockAge > STALE_LOCK_TIMEOUT_MS) {
        console.warn(`[Transcription] Force-clearing stale lock held by ${currentProcessId} for ${Math.round(lockAge / 1000)}s`)
        database.run(
          `UPDATE transcription_service_lock SET process_id = NULL, acquired_at = NULL, updated_at = ? WHERE id = 1`,
          [now]
        )
        // Fall through to acquire
      } else {
        return false
      }
    } else {
      return false
    }
  }

  // Atomic check-and-set using UPDATE with WHERE clause
  // If process_id is NULL, set it to our processId
  database.run(
    `UPDATE transcription_service_lock
     SET process_id = ?, acquired_at = ?, updated_at = ?
     WHERE id = 1 AND process_id IS NULL`,
    [processId, now, now]
  )

  // Verify we acquired the lock by checking again
  const verifyStatus = database.exec('SELECT process_id FROM transcription_service_lock WHERE id = 1')
  const newProcessId = verifyStatus.length > 0 && verifyStatus[0].values.length > 0
    ? verifyStatus[0].values[0][0]
    : null

  return newProcessId === processId
}

/**
 * Release the transcription service lock.
 * @param processId The process ID that currently holds the lock
 * @returns true if lock released, false if not held by this process
 */
export function releaseTranscriptionLock(processId: string): boolean {
  const database = getDatabase()

  // Check if we currently hold the lock
  const currentStatus = database.exec('SELECT process_id FROM transcription_service_lock WHERE id = 1')
  const currentProcessId = currentStatus.length > 0 && currentStatus[0].values.length > 0
    ? currentStatus[0].values[0][0]
    : null

  if (currentProcessId !== processId) {
    return false // Not our lock to release
  }

  // Release the lock
  database.run(
    `UPDATE transcription_service_lock
     SET process_id = NULL, acquired_at = NULL, updated_at = ?
     WHERE id = 1 AND process_id = ?`,
    [new Date().toISOString(), processId]
  )

  // Verify lock was released
  const verifyStatus = database.exec('SELECT process_id FROM transcription_service_lock WHERE id = 1')
  const newProcessId = verifyStatus.length > 0 && verifyStatus[0].values.length > 0
    ? verifyStatus[0].values[0][0]
    : null

  return newProcessId === null
}

/**
 * Get the current transcription lock status.
 * @returns Lock status with process_id and timestamps
 */
export function getTranscriptionLockStatus(): {
  processId: string | null
  acquiredAt: string | null
  updatedAt: string | null
} {
  const database = getDatabase()
  const row = database.exec('SELECT process_id, acquired_at, updated_at FROM transcription_service_lock WHERE id = 1')

  if (row.length > 0 && row[0].values.length > 0) {
    const [processId, acquiredAt, updatedAt] = row[0].values[0] as [string | null, string | null, string | null]
    return { processId, acquiredAt, updatedAt }
  }

  return { processId: null, acquiredAt: null, updatedAt: null }
}
