-- V11 Schema Migration: Knowledge Captures Architecture
-- Transforms from recordings-centric to knowledge-first model
--
-- This migration introduces:
-- - knowledge_captures: Primary knowledge entity with quality/retention management
-- - audio_sources: Multi-source audio file tracking (device/local/cloud)
-- - action_items: First-class action items extracted from transcripts
-- - decisions: First-class decisions extracted from transcripts
-- - follow_ups: First-class follow-ups with scheduling
-- - outputs: Generated documents from templates
--
-- Migration strategy:
-- - Adds migration tracking columns to recordings table
-- - New tables coexist with existing schema
-- - Data migration handled by separate migration service

-- =============================================================================
-- Core Knowledge Entity
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
-- Audio Sources - Multi-source tracking
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
-- First-Class Action Items
-- =============================================================================

CREATE TABLE IF NOT EXISTS action_items (
    id TEXT PRIMARY KEY,
    knowledge_capture_id TEXT NOT NULL,

    -- Action item content
    content TEXT NOT NULL,
    assignee TEXT,
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
-- First-Class Decisions
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
-- First-Class Follow-ups
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
-- Generated Outputs
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

-- =============================================================================
-- Actionables (intent to create artifacts)
-- =============================================================================

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
    artifact_id TEXT, -- Links to outputs table
    generated_at TEXT,
    shared_at TEXT,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (source_knowledge_id) REFERENCES knowledge_captures(id) ON DELETE CASCADE,
    FOREIGN KEY (artifact_id) REFERENCES outputs(id) ON DELETE SET NULL
);

-- =============================================================================
-- Indexes for Performance
-- =============================================================================

-- Knowledge captures indexes
CREATE INDEX IF NOT EXISTS idx_knowledge_captures_captured_at ON knowledge_captures(captured_at);
CREATE INDEX IF NOT EXISTS idx_knowledge_captures_meeting_id ON knowledge_captures(meeting_id);
CREATE INDEX IF NOT EXISTS idx_knowledge_captures_source_recording ON knowledge_captures(source_recording_id);
CREATE INDEX IF NOT EXISTS idx_knowledge_captures_quality ON knowledge_captures(quality_rating);
CREATE INDEX IF NOT EXISTS idx_knowledge_captures_status ON knowledge_captures(status);
CREATE INDEX IF NOT EXISTS idx_knowledge_captures_category ON knowledge_captures(category);
CREATE INDEX IF NOT EXISTS idx_knowledge_captures_storage_tier ON knowledge_captures(storage_tier);
CREATE INDEX IF NOT EXISTS idx_knowledge_captures_expires_at ON knowledge_captures(expires_at);
CREATE INDEX IF NOT EXISTS idx_knowledge_captures_deleted_at ON knowledge_captures(deleted_at);

-- Audio sources indexes
CREATE INDEX IF NOT EXISTS idx_audio_sources_capture_id ON audio_sources(knowledge_capture_id);
CREATE INDEX IF NOT EXISTS idx_audio_sources_source_type ON audio_sources(source_type);
CREATE INDEX IF NOT EXISTS idx_audio_sources_file_name ON audio_sources(file_name);

-- Action items indexes
CREATE INDEX IF NOT EXISTS idx_action_items_capture_id ON action_items(knowledge_capture_id);
CREATE INDEX IF NOT EXISTS idx_action_items_status ON action_items(status);
CREATE INDEX IF NOT EXISTS idx_action_items_priority ON action_items(priority);
CREATE INDEX IF NOT EXISTS idx_action_items_due_date ON action_items(due_date);
CREATE INDEX IF NOT EXISTS idx_action_items_assignee ON action_items(assignee);

-- Decisions indexes
CREATE INDEX IF NOT EXISTS idx_decisions_capture_id ON decisions(knowledge_capture_id);
CREATE INDEX IF NOT EXISTS idx_decisions_decided_at ON decisions(decided_at);

-- Follow-ups indexes
CREATE INDEX IF NOT EXISTS idx_follow_ups_capture_id ON follow_ups(knowledge_capture_id);
CREATE INDEX IF NOT EXISTS idx_follow_ups_status ON follow_ups(status);
CREATE INDEX IF NOT EXISTS idx_follow_ups_target_date ON follow_ups(target_date);
CREATE INDEX IF NOT EXISTS idx_follow_ups_owner ON follow_ups(owner);
CREATE INDEX IF NOT EXISTS idx_follow_ups_meeting_id ON follow_ups(scheduled_meeting_id);

-- Outputs indexes
CREATE INDEX IF NOT EXISTS idx_outputs_capture_id ON outputs(knowledge_capture_id);
CREATE INDEX IF NOT EXISTS idx_outputs_template_id ON outputs(template_id);
CREATE INDEX IF NOT EXISTS idx_outputs_generated_at ON outputs(generated_at);

-- Actionables indexes
CREATE INDEX IF NOT EXISTS idx_actionables_source_knowledge ON actionables(source_knowledge_id);
CREATE INDEX IF NOT EXISTS idx_actionables_status ON actionables(status);

-- =============================================================================
-- Migration Tracking Columns for Recordings
-- =============================================================================

-- Add migration tracking columns to existing recordings table
-- These track the migration from recordings to knowledge_captures
ALTER TABLE recordings ADD COLUMN migrated_to_capture_id TEXT;
ALTER TABLE recordings ADD COLUMN migration_status TEXT CHECK(migration_status IN ('pending', 'migrated', 'skipped', 'error')) DEFAULT 'pending';
ALTER TABLE recordings ADD COLUMN migrated_at TEXT;

-- Index for migration queries
CREATE INDEX IF NOT EXISTS idx_recordings_migration_status ON recordings(migration_status);
CREATE INDEX IF NOT EXISTS idx_recordings_migrated_capture ON recordings(migrated_to_capture_id);
