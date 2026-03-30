export const SCHEMA_VERSION = 2;

export const SCHEMA = `
CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    type TEXT NOT NULL DEFAULT 'string' CHECK(type IN ('string', 'number', 'boolean', 'json')),
    category TEXT NOT NULL DEFAULT 'general'
);

CREATE TABLE IF NOT EXISTS sessions (
    id TEXT PRIMARY KEY,
    title TEXT,
    started_at INTEGER NOT NULL,
    ended_at INTEGER,
    status TEXT NOT NULL DEFAULT 'recording' CHECK(status IN ('recording', 'processing', 'completed')),
    meeting_id TEXT,
    audio_path TEXT,
    transcript_path TEXT
);

CREATE TABLE IF NOT EXISTS meetings (
    id TEXT PRIMARY KEY,
    title TEXT,
    start_time INTEGER NOT NULL,
    end_time INTEGER,
    attendees TEXT,
    location TEXT,
    agenda TEXT,
    calendar_source TEXT
);

CREATE TABLE IF NOT EXISTS transcript_segments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id TEXT NOT NULL,
    speaker TEXT,
    text TEXT NOT NULL,
    start_time REAL NOT NULL,
    end_time REAL NOT NULL,
    confidence REAL,
    source TEXT NOT NULL DEFAULT 'mic' CHECK(source IN ('mic', 'system')),
    FOREIGN KEY (session_id) REFERENCES sessions(id)
);

CREATE TABLE IF NOT EXISTS knowledge_chunks (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    source_path TEXT NOT NULL,
    chunk_index INTEGER NOT NULL,
    text TEXT NOT NULL,
    embedding BLOB,
    updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS screenshots (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id TEXT NOT NULL,
    path TEXT NOT NULL,
    captured_at INTEGER NOT NULL,
    analysis TEXT,
    is_manual INTEGER NOT NULL DEFAULT 0,
    FOREIGN KEY (session_id) REFERENCES sessions(id)
);

CREATE TABLE IF NOT EXISTS notes (
    id TEXT PRIMARY KEY,
    session_id TEXT NOT NULL,
    template_id TEXT,
    content TEXT NOT NULL DEFAULT '',
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    FOREIGN KEY (session_id) REFERENCES sessions(id),
    FOREIGN KEY (template_id) REFERENCES note_templates(id)
);

CREATE TABLE IF NOT EXISTS note_templates (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    prompt TEXT NOT NULL,
    structure TEXT,
    is_default INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS kb_sources (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    path TEXT NOT NULL UNIQUE,
    status TEXT NOT NULL DEFAULT 'pending',
    chunk_count INTEGER NOT NULL DEFAULT 0,
    added_at INTEGER NOT NULL,
    indexed_at INTEGER
);

CREATE TABLE IF NOT EXISTS schema_version (
    version INTEGER PRIMARY KEY
);

CREATE INDEX IF NOT EXISTS idx_sessions_status ON sessions(status);
CREATE INDEX IF NOT EXISTS idx_sessions_meeting ON sessions(meeting_id);
CREATE INDEX IF NOT EXISTS idx_sessions_started ON sessions(started_at);
CREATE INDEX IF NOT EXISTS idx_transcript_session ON transcript_segments(session_id);
CREATE INDEX IF NOT EXISTS idx_transcript_time ON transcript_segments(start_time);
CREATE INDEX IF NOT EXISTS idx_knowledge_source ON knowledge_chunks(source_path);
CREATE INDEX IF NOT EXISTS idx_knowledge_updated ON knowledge_chunks(updated_at);
CREATE INDEX IF NOT EXISTS idx_screenshots_session ON screenshots(session_id);
CREATE INDEX IF NOT EXISTS idx_screenshots_captured ON screenshots(captured_at);
CREATE INDEX IF NOT EXISTS idx_notes_session ON notes(session_id);
CREATE INDEX IF NOT EXISTS idx_notes_template ON notes(template_id);
CREATE INDEX IF NOT EXISTS idx_meetings_time ON meetings(start_time);
CREATE INDEX IF NOT EXISTS idx_settings_category ON settings(category);
CREATE INDEX IF NOT EXISTS idx_kb_sources_path ON kb_sources(path);
CREATE INDEX IF NOT EXISTS idx_kb_sources_status ON kb_sources(status);
`;

export const DEFAULT_NOTE_TEMPLATES = [
  {
    name: "Meeting Summary",
    prompt:
      "Provide a concise summary of the meeting covering the main topics discussed, key decisions made, and overall outcomes.",
    structure:
      "## Summary\n\n## Key Decisions\n\n## Next Steps",
    is_default: 1,
  },
  {
    name: "Detailed Notes",
    prompt:
      "Create comprehensive notes capturing all discussion points, decisions, context, and nuances from the meeting.",
    structure:
      "## Overview\n\n## Discussion Points\n\n## Decisions\n\n## Action Items\n\n## Follow-ups",
    is_default: 1,
  },
  {
    name: "Action Items Only",
    prompt:
      "Extract only the action items from the meeting. For each item include the task, owner, and deadline if mentioned.",
    structure:
      "## Action Items\n\n| Task | Owner | Due Date |\n|------|-------|----------|\n",
    is_default: 1,
  },
  {
    name: "Standup",
    prompt:
      "Summarize what each participant shared for yesterday, today, and any blockers mentioned during the standup.",
    structure:
      "## Standup Summary\n\n### Yesterday\n\n### Today\n\n### Blockers",
    is_default: 1,
  },
  {
    name: "1:1",
    prompt:
      "Capture the key topics from this one-on-one meeting including feedback exchanged, goals discussed, and any personal development points.",
    structure:
      "## Topics Discussed\n\n## Feedback\n\n## Goals & Development\n\n## Action Items",
    is_default: 1,
  },
  {
    name: "Client Meeting",
    prompt:
      "Summarize this client meeting including requirements discussed, commitments made, timeline agreed upon, and follow-up items.",
    structure:
      "## Client Meeting Notes\n\n## Requirements\n\n## Commitments\n\n## Timeline\n\n## Follow-ups",
    is_default: 1,
  },
  {
    name: "Brainstorm",
    prompt:
      "Organize the ideas generated during this brainstorming session by theme, highlight the most promising ones, and note any decisions made.",
    structure:
      "## Ideas\n\n## Top Candidates\n\n## Decisions Made\n\n## Next Steps",
    is_default: 1,
  },
];
