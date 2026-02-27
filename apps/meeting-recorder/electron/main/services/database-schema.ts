export const SCHEMA_VERSION = 2;

export const SCHEMA = `
CREATE TABLE IF NOT EXISTS sessions (
    id TEXT PRIMARY KEY,
    status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active', 'inactive', 'interrupted', 'processing', 'complete')),
    started_at TEXT NOT NULL,
    ended_at TEXT,
    meeting_type_id TEXT,
    title TEXT,
    summary TEXT,
    audio_path TEXT,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS recordings (
    id TEXT PRIMARY KEY,
    session_id TEXT NOT NULL,
    filename TEXT NOT NULL,
    file_path TEXT NOT NULL,
    duration_ms INTEGER DEFAULT 0,
    sample_rate INTEGER DEFAULT 16000,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    status TEXT NOT NULL DEFAULT 'recording' CHECK(status IN ('recording', 'stopped', 'interrupted')),
    last_chunk_index INTEGER DEFAULT 0,
    FOREIGN KEY (session_id) REFERENCES sessions(id)
);

CREATE TABLE IF NOT EXISTS transcript_segments (
    id TEXT PRIMARY KEY,
    session_id TEXT NOT NULL,
    speaker_name TEXT,
    text TEXT NOT NULL,
    start_ms INTEGER NOT NULL,
    end_ms INTEGER NOT NULL,
    sentiment TEXT,
    confidence REAL,
    language TEXT,
    chunk_index INTEGER NOT NULL,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (session_id) REFERENCES sessions(id)
);

CREATE TABLE IF NOT EXISTS speakers (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    display_name TEXT,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS session_speakers (
    session_id TEXT NOT NULL,
    speaker_id TEXT NOT NULL,
    PRIMARY KEY (session_id, speaker_id),
    FOREIGN KEY (session_id) REFERENCES sessions(id),
    FOREIGN KEY (speaker_id) REFERENCES speakers(id)
);

CREATE TABLE IF NOT EXISTS meetings (
    id TEXT PRIMARY KEY,
    session_id TEXT NOT NULL,
    subject TEXT,
    attendees_json TEXT,
    notes TEXT,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (session_id) REFERENCES sessions(id)
);

CREATE TABLE IF NOT EXISTS attachments (
    id TEXT PRIMARY KEY,
    session_id TEXT NOT NULL,
    type TEXT NOT NULL CHECK(type IN ('screenshot', 'note', 'file')),
    filename TEXT,
    file_path TEXT,
    mime_type TEXT,
    content_text TEXT,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (session_id) REFERENCES sessions(id)
);

CREATE TABLE IF NOT EXISTS action_items (
    id TEXT PRIMARY KEY,
    session_id TEXT NOT NULL,
    text TEXT NOT NULL,
    assignee TEXT,
    status TEXT NOT NULL DEFAULT 'open' CHECK(status IN ('open', 'done')),
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (session_id) REFERENCES sessions(id)
);

CREATE TABLE IF NOT EXISTS talking_points (
    id TEXT PRIMARY KEY,
    session_id TEXT NOT NULL,
    topic TEXT NOT NULL,
    first_mentioned_ms INTEGER NOT NULL,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (session_id) REFERENCES sessions(id)
);

CREATE TABLE IF NOT EXISTS meeting_types (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    description TEXT,
    prompt_template TEXT,
    icon TEXT,
    is_default INTEGER DEFAULT 0,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    encrypted INTEGER DEFAULT 0
);

CREATE TABLE IF NOT EXISTS schema_version (
    version INTEGER PRIMARY KEY
);

CREATE INDEX IF NOT EXISTS idx_recordings_session ON recordings(session_id);
CREATE INDEX IF NOT EXISTS idx_transcript_session ON transcript_segments(session_id);
CREATE INDEX IF NOT EXISTS idx_transcript_chunk ON transcript_segments(session_id, chunk_index);
CREATE INDEX IF NOT EXISTS idx_attachments_session ON attachments(session_id);
CREATE INDEX IF NOT EXISTS idx_action_items_session ON action_items(session_id);
CREATE INDEX IF NOT EXISTS idx_talking_points_session ON talking_points(session_id);
CREATE INDEX IF NOT EXISTS idx_sessions_status ON sessions(status);
`;

export const DEFAULT_MEETING_TYPES = [
  {
    name: "General Meeting",
    description: "Standard meeting format",
    icon: "calendar",
    prompt:
      "Provide a comprehensive meeting summary including key decisions, discussion points, and next steps.",
  },
  {
    name: "Standup",
    description: "Daily standup / scrum",
    icon: "clock",
    prompt:
      "Summarize what each participant did yesterday, plans for today, and any blockers mentioned.",
  },
  {
    name: "1:1",
    description: "One-on-one meeting",
    icon: "users",
    prompt:
      "Summarize the key topics discussed, any feedback given, action items, and career development points.",
  },
  {
    name: "Interview",
    description: "Job interview",
    icon: "user-check",
    prompt:
      "Summarize the candidate responses, interviewer questions, technical assessments, and overall impressions.",
  },
  {
    name: "Brainstorm",
    description: "Brainstorming session",
    icon: "lightbulb",
    prompt:
      "List all ideas generated, group them by theme, highlight the most promising ones, and note any decisions made.",
  },
  {
    name: "Client Call",
    description: "External client meeting",
    icon: "phone",
    prompt:
      "Summarize client requirements, commitments made, timeline discussed, and follow-up items.",
  },
  {
    name: "All-Hands",
    description: "Company-wide meeting",
    icon: "building",
    prompt:
      "Summarize key announcements, company updates, Q&A highlights, and any action items for the team.",
  },
];
