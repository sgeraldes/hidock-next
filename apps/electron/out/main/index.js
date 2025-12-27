"use strict";
const electron = require("electron");
const path = require("path");
const utils = require("@electron-toolkit/utils");
const initSqlJs = require("sql.js");
const fs = require("fs");
const ICAL = require("ical.js");
const zod = require("zod");
const generativeAi = require("@google/generative-ai");
const uuid = require("uuid");
const events = require("events");
const crypto$1 = require("crypto");
const DEFAULT_CONFIG = {
  version: "1.0.0",
  storage: {
    dataPath: path.join(electron.app.getPath("home"), "HiDock"),
    maxRecordingsGB: 50
  },
  calendar: {
    icsUrl: "",
    syncEnabled: true,
    syncIntervalMinutes: 15,
    lastSyncAt: null
  },
  transcription: {
    provider: "gemini",
    geminiApiKey: "",
    geminiModel: "gemini-2.0-flash",
    autoTranscribe: true,
    language: "es"
  },
  embeddings: {
    provider: "ollama",
    ollamaBaseUrl: "http://localhost:11434",
    ollamaModel: "nomic-embed-text",
    chunkSize: 500,
    chunkOverlap: 50
  },
  chat: {
    provider: "gemini",
    geminiModel: "gemini-2.0-flash",
    ollamaModel: "llama3.2",
    maxContextChunks: 10
  },
  device: {
    autoConnect: true,
    autoDownload: true
  },
  ui: {
    theme: "system",
    defaultView: "week",
    startOfWeek: 1
    // Monday
  }
};
let config = { ...DEFAULT_CONFIG };
function getConfigPath() {
  return path.join(electron.app.getPath("userData"), "config.json");
}
function getDataPath() {
  return config.storage.dataPath;
}
async function initializeConfig() {
  const configPath = getConfigPath();
  try {
    if (fs.existsSync(configPath)) {
      const fileContent = fs.readFileSync(configPath, "utf-8");
      const savedConfig = JSON.parse(fileContent);
      config = deepMerge(DEFAULT_CONFIG, savedConfig);
    } else {
      await saveConfig(DEFAULT_CONFIG);
    }
  } catch (error2) {
    console.error("Error loading config:", error2);
    config = { ...DEFAULT_CONFIG };
  }
}
function getConfig() {
  return { ...config };
}
async function saveConfig(newConfig) {
  config = deepMerge(config, newConfig);
  const configPath = getConfigPath();
  const configDir = path.join(configPath, "..");
  if (!fs.existsSync(configDir)) {
    fs.mkdirSync(configDir, { recursive: true });
  }
  fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
}
async function updateConfig(section, values) {
  const updatedSection = { ...config[section], ...values };
  await saveConfig({ [section]: updatedSection });
}
function deepMerge(target, source) {
  const result = { ...target };
  for (const key in source) {
    if (Object.prototype.hasOwnProperty.call(source, key)) {
      const sourceValue = source[key];
      const targetValue = result[key];
      if (sourceValue !== null && typeof sourceValue === "object" && !Array.isArray(sourceValue) && targetValue !== null && typeof targetValue === "object" && !Array.isArray(targetValue)) {
        result[key] = deepMerge(targetValue, sourceValue);
      } else if (sourceValue !== void 0) {
        result[key] = sourceValue;
      }
    }
  }
  return result;
}
function validatePath(basePath, userPath) {
  const normalizedBase = path.normalize(path.resolve(basePath));
  const resolvedPath = path.normalize(path.resolve(basePath, userPath));
  if (!resolvedPath.startsWith(normalizedBase)) {
    throw new Error(`Invalid path: path traversal detected. Path must stay within ${normalizedBase}`);
  }
  return resolvedPath;
}
function validateFilename(filename) {
  if (!filename || typeof filename !== "string") {
    throw new Error("Invalid filename: filename is required");
  }
  const sanitized = filename.replace(/[\\/:*?"<>|]/g, "");
  if (filename.includes("..") || filename !== sanitized || !sanitized.length) {
    throw new Error("Invalid filename: contains illegal characters or path traversal attempt");
  }
  if (sanitized.length > 255) {
    throw new Error("Invalid filename: exceeds maximum length of 255 characters");
  }
  return sanitized;
}
async function initializeFileStorage() {
  const dataPath = getDataPath();
  const directories = [
    dataPath,
    path.join(dataPath, "data"),
    path.join(dataPath, "recordings"),
    path.join(dataPath, "transcripts"),
    path.join(dataPath, "cache")
  ];
  for (const dir of directories) {
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
      console.log(`Created directory: ${dir}`);
    }
  }
}
function getRecordingsPath() {
  return path.join(getDataPath(), "recordings");
}
function getTranscriptsPath() {
  return path.join(getDataPath(), "transcripts");
}
function getCachePath() {
  return path.join(getDataPath(), "cache");
}
function getDatabasePath() {
  return path.join(getDataPath(), "data", "hidock.db");
}
async function saveRecording(filename, data, meetingSubject) {
  const recordingsPath = getRecordingsPath();
  validateFilename(path.basename(filename));
  const date = /* @__PURE__ */ new Date();
  const datePrefix = date.toISOString().split("T")[0];
  const timePrefix = date.toTimeString().slice(0, 5).replace(":", "");
  const subjectPart = "";
  let ext = path.extname(filename) || ".wav";
  if (ext.toLowerCase() === ".hda") {
    ext = ".wav";
  }
  const cleanFilename = `${datePrefix}_${timePrefix}${subjectPart}${ext}`;
  const filePath = validatePath(recordingsPath, cleanFilename);
  fs.writeFileSync(filePath, data);
  return filePath;
}
function getRecordingFiles() {
  const recordingsPath = getRecordingsPath();
  if (!fs.existsSync(recordingsPath)) {
    return [];
  }
  return fs.readdirSync(recordingsPath).filter((file) => {
    const ext = path.extname(file).toLowerCase();
    return [".wav", ".mp3", ".m4a", ".ogg", ".webm", ".hda"].includes(ext);
  }).map((file) => path.join(recordingsPath, file));
}
function getStorageInfo() {
  const dataPath = getDataPath();
  const recordingsPath = getRecordingsPath();
  const transcriptsPath = getTranscriptsPath();
  const cachePath = getCachePath();
  const databasePath = getDatabasePath();
  let totalSizeBytes = 0;
  let recordingsCount = 0;
  if (fs.existsSync(recordingsPath)) {
    const files = fs.readdirSync(recordingsPath);
    recordingsCount = files.length;
    for (const file of files) {
      const filePath = path.join(recordingsPath, file);
      const stats = fs.statSync(filePath);
      totalSizeBytes += stats.size;
    }
  }
  if (fs.existsSync(transcriptsPath)) {
    const files = fs.readdirSync(transcriptsPath);
    for (const file of files) {
      const filePath = path.join(transcriptsPath, file);
      const stats = fs.statSync(filePath);
      totalSizeBytes += stats.size;
    }
  }
  if (fs.existsSync(databasePath)) {
    const stats = fs.statSync(databasePath);
    totalSizeBytes += stats.size;
  }
  return {
    dataPath,
    recordingsPath,
    transcriptsPath,
    cachePath,
    databasePath,
    totalSizeBytes,
    recordingsCount
  };
}
function deleteRecording(filePath) {
  try {
    const recordingsPath = getRecordingsPath();
    const transcriptsPath = getTranscriptsPath();
    const normalizedPath = path.normalize(path.resolve(filePath));
    const normalizedRecordings = path.normalize(path.resolve(recordingsPath));
    const normalizedTranscripts = path.normalize(path.resolve(transcriptsPath));
    if (!normalizedPath.startsWith(normalizedRecordings) && !normalizedPath.startsWith(normalizedTranscripts)) {
      console.error("Attempted to delete file outside allowed directories:", filePath);
      return false;
    }
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
      return true;
    }
    return false;
  } catch (error2) {
    console.error("Error deleting recording:", error2);
    return false;
  }
}
function readRecordingFile(filePath) {
  try {
    const recordingsPath = getRecordingsPath();
    const transcriptsPath = getTranscriptsPath();
    const normalizedPath = path.normalize(path.resolve(filePath));
    const normalizedRecordings = path.normalize(path.resolve(recordingsPath));
    const normalizedTranscripts = path.normalize(path.resolve(transcriptsPath));
    if (!normalizedPath.startsWith(normalizedRecordings) && !normalizedPath.startsWith(normalizedTranscripts)) {
      console.error("Attempted to read file outside allowed directories:", filePath);
      return null;
    }
    if (fs.existsSync(filePath)) {
      return fs.readFileSync(filePath);
    }
    return null;
  } catch (error2) {
    console.error("Error reading recording file:", error2);
    return null;
  }
}
let db = null;
let dbPath = "";
const SCHEMA_VERSION = 11;
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
    FOREIGN KEY (meeting_id) REFERENCES meetings(id)
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
    error_message TEXT,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    started_at TEXT,
    completed_at TEXT,
    FOREIGN KEY (recording_id) REFERENCES recordings(id)
);

-- Chat history
CREATE TABLE IF NOT EXISTS chat_messages (
    id TEXT PRIMARY KEY,
    role TEXT NOT NULL,
    content TEXT NOT NULL,
    sources TEXT,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP
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

-- Contacts extracted from meeting attendees
CREATE TABLE IF NOT EXISTS contacts (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    email TEXT UNIQUE,
    notes TEXT,
    first_seen_at TEXT NOT NULL,
    last_seen_at TEXT NOT NULL,
    meeting_count INTEGER DEFAULT 0,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

-- User-created projects for organizing meetings
CREATE TABLE IF NOT EXISTS projects (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    description TEXT,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP
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

-- Junction table: Meeting-Project relationship
CREATE TABLE IF NOT EXISTS meeting_projects (
    meeting_id TEXT NOT NULL,
    project_id TEXT NOT NULL,
    PRIMARY KEY (meeting_id, project_id),
    FOREIGN KEY (meeting_id) REFERENCES meetings(id) ON DELETE CASCADE,
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
CREATE INDEX IF NOT EXISTS idx_meeting_projects_meeting ON meeting_projects(meeting_id);
CREATE INDEX IF NOT EXISTS idx_meeting_projects_project ON meeting_projects(project_id);
CREATE INDEX IF NOT EXISTS idx_recording_candidates_recording ON recording_meeting_candidates(recording_id);
CREATE INDEX IF NOT EXISTS idx_recording_candidates_meeting ON recording_meeting_candidates(meeting_id);
CREATE INDEX IF NOT EXISTS idx_recording_candidates_selected ON recording_meeting_candidates(is_selected);
CREATE INDEX IF NOT EXISTS idx_quality_recording ON quality_assessments(recording_id);
CREATE INDEX IF NOT EXISTS idx_quality_level ON quality_assessments(quality);

`;
const MIGRATIONS = {
  2: () => {
    console.log("Running migration to schema v2: Adding contacts and projects tables");
  },
  3: () => {
    console.log("Running migration to schema v3: Adding recording_meeting_candidates table");
  },
  6: () => {
    console.log("Running migration to schema v6: Adding recording lifecycle columns");
    const database2 = getDatabase();
    const columnsToAdd = [
      "ALTER TABLE recordings ADD COLUMN location TEXT DEFAULT 'device-only'",
      "ALTER TABLE recordings ADD COLUMN transcription_status TEXT DEFAULT 'none'",
      "ALTER TABLE recordings ADD COLUMN on_device INTEGER DEFAULT 1",
      "ALTER TABLE recordings ADD COLUMN device_last_seen TEXT",
      "ALTER TABLE recordings ADD COLUMN on_local INTEGER DEFAULT 0",
      "ALTER TABLE recordings ADD COLUMN source TEXT DEFAULT 'hidock'",
      "ALTER TABLE recordings ADD COLUMN is_imported INTEGER DEFAULT 0"
    ];
    for (const sql of columnsToAdd) {
      try {
        database2.run(sql);
      } catch (e) {
        console.log(`Column may already exist: ${sql}`);
      }
    }
    try {
      database2.run(`
        UPDATE recordings
        SET on_local = 1,
            location = CASE WHEN on_device = 1 THEN 'both' ELSE 'local-only' END
        WHERE file_path IS NOT NULL AND file_path != ''
      `);
    } catch (e) {
      console.warn("Failed to update existing recordings:", e);
    }
    console.log("Migration v6 complete: Recording lifecycle columns added");
  },
  7: () => {
    console.log("Running migration to schema v7: Recalculating HDA file durations");
    const database2 = getDatabase();
    try {
      const recordings = database2.exec(`
        SELECT id, filename, file_size, duration_seconds
        FROM recordings
        WHERE (filename LIKE '%.hda' OR filename LIKE '%.HDA')
        AND file_size IS NOT NULL
        AND file_size > 0
      `);
      if (recordings.length > 0 && recordings[0].values.length > 0) {
        let updatedCount = 0;
        for (const row of recordings[0].values) {
          const [id, filename, fileSize, oldDuration] = row;
          const newDuration = Math.round(fileSize / 8e3);
          if (oldDuration !== newDuration) {
            database2.run(
              "UPDATE recordings SET duration_seconds = ? WHERE id = ?",
              [newDuration, id]
            );
            updatedCount++;
            console.log(`[Migration v7] Updated ${filename}: ${oldDuration || 0}s -> ${newDuration}s`);
          }
        }
        console.log(`[Migration v7] Updated durations for ${updatedCount} recordings`);
      } else {
        console.log("[Migration v7] No HDA recordings found to update");
      }
      try {
        const cachedFiles = database2.exec(`
          SELECT id, filename, file_size, duration_seconds
          FROM device_files_cache
          WHERE (filename LIKE '%.hda' OR filename LIKE '%.HDA')
          AND file_size IS NOT NULL
          AND file_size > 0
        `);
        if (cachedFiles.length > 0 && cachedFiles[0].values.length > 0) {
          for (const row of cachedFiles[0].values) {
            const [id, _filename, fileSize, oldDuration] = row;
            const newDuration = Math.round(fileSize / 8e3);
            if (oldDuration !== newDuration) {
              database2.run(
                "UPDATE device_files_cache SET duration_seconds = ? WHERE id = ?",
                [newDuration, id]
              );
            }
          }
          console.log("[Migration v7] Updated device_files_cache durations");
        }
      } catch (e) {
        console.log("[Migration v7] device_files_cache not found or empty");
      }
    } catch (e) {
      console.error("[Migration v7] Error recalculating durations:", e);
    }
    console.log("Migration v7 complete: HDA durations recalculated");
  },
  8: () => {
    console.log("Running migration to schema v8: Fixing HDA duration formula (v7 was wrong)");
    const database2 = getDatabase();
    try {
      const recordings = database2.exec(`
        SELECT id, filename, file_size, duration_seconds
        FROM recordings
        WHERE (filename LIKE '%.hda' OR filename LIKE '%.HDA')
        AND file_size IS NOT NULL
        AND file_size > 0
      `);
      if (recordings.length > 0 && recordings[0].values.length > 0) {
        let updatedCount = 0;
        for (const row of recordings[0].values) {
          const [id, filename, fileSize, oldDuration] = row;
          const newDuration = Math.round(fileSize / 8e3);
          if (oldDuration !== newDuration) {
            database2.run(
              "UPDATE recordings SET duration_seconds = ? WHERE id = ?",
              [newDuration, id]
            );
            updatedCount++;
            const oldMin = oldDuration ? Math.floor(oldDuration / 60) : 0;
            const oldSec = oldDuration ? Math.round(oldDuration % 60) : 0;
            const newMin = Math.floor(newDuration / 60);
            const newSec = Math.round(newDuration % 60);
            console.log(`[Migration v8] Fixed ${filename}: ${oldMin}m${oldSec}s -> ${newMin}m${newSec}s`);
          }
        }
        console.log(`[Migration v8] Fixed durations for ${updatedCount} recordings`);
      } else {
        console.log("[Migration v8] No HDA recordings found to fix");
      }
      try {
        const cachedFiles = database2.exec(`
          SELECT id, filename, file_size, duration_seconds
          FROM device_files_cache
          WHERE (filename LIKE '%.hda' OR filename LIKE '%.HDA')
          AND file_size IS NOT NULL
          AND file_size > 0
        `);
        if (cachedFiles.length > 0 && cachedFiles[0].values.length > 0) {
          for (const row of cachedFiles[0].values) {
            const [id, _filename, fileSize, oldDuration] = row;
            const newDuration = Math.round(fileSize / 8e3);
            if (oldDuration !== newDuration) {
              database2.run(
                "UPDATE device_files_cache SET duration_seconds = ? WHERE id = ?",
                [newDuration, id]
              );
            }
          }
          console.log("[Migration v8] Fixed device_files_cache durations");
        }
      } catch (e) {
        console.log("[Migration v8] device_files_cache not found or empty");
      }
    } catch (e) {
      console.error("[Migration v8] Error fixing durations:", e);
    }
    console.log("Migration v8 complete: HDA durations fixed with correct formula");
  },
  9: () => {
    console.log("Running migration to schema v9: Ensuring HDA durations are correct");
    const database2 = getDatabase();
    try {
      const recordings = database2.exec(`
        SELECT id, filename, file_size, duration_seconds
        FROM recordings
        WHERE (filename LIKE '%.hda' OR filename LIKE '%.HDA')
        AND file_size IS NOT NULL
        AND file_size > 0
      `);
      if (recordings.length > 0 && recordings[0].values.length > 0) {
        let updatedCount = 0;
        for (const row of recordings[0].values) {
          const [id, filename, fileSize, oldDuration] = row;
          const newDuration = Math.round(fileSize / 8e3);
          const needsUpdate = oldDuration !== newDuration || oldDuration && oldDuration > 21600;
          if (needsUpdate) {
            database2.run(
              "UPDATE recordings SET duration_seconds = ? WHERE id = ?",
              [newDuration, id]
            );
            updatedCount++;
            const oldMin = oldDuration ? Math.floor(oldDuration / 60) : 0;
            const oldSec = oldDuration ? Math.round(oldDuration % 60) : 0;
            const newMin = Math.floor(newDuration / 60);
            const newSec = Math.round(newDuration % 60);
            console.log(`[Migration v9] Fixed ${filename}: ${oldMin}m${oldSec}s -> ${newMin}m${newSec}s`);
          }
        }
        console.log(`[Migration v9] Fixed durations for ${updatedCount} recordings`);
      } else {
        console.log("[Migration v9] No HDA recordings found");
      }
      try {
        const cachedFiles = database2.exec(`
          SELECT id, filename, file_size, duration_seconds
          FROM device_files_cache
          WHERE (filename LIKE '%.hda' OR filename LIKE '%.HDA')
          AND file_size IS NOT NULL
          AND file_size > 0
        `);
        if (cachedFiles.length > 0 && cachedFiles[0].values.length > 0) {
          for (const row of cachedFiles[0].values) {
            const [id, _filename, fileSize, oldDuration] = row;
            const newDuration = Math.round(fileSize / 8e3);
            const needsUpdate = oldDuration !== newDuration || oldDuration && oldDuration > 21600;
            if (needsUpdate) {
              database2.run(
                "UPDATE device_files_cache SET duration_seconds = ? WHERE id = ?",
                [newDuration, id]
              );
            }
          }
          console.log("[Migration v9] Fixed device_files_cache durations");
        }
      } catch (e) {
        console.log("[Migration v9] device_files_cache not found or empty");
      }
    } catch (e) {
      console.error("[Migration v9] Error fixing durations:", e);
    }
    console.log("Migration v9 complete: HDA durations verified/fixed");
  },
  10: () => {
    console.log("Running migration to schema v10: Adding quality assessment and storage policy support");
    const database2 = getDatabase();
    try {
      database2.run(`
        ALTER TABLE recordings
        ADD COLUMN storage_tier TEXT DEFAULT NULL
        CHECK(storage_tier IN (NULL, 'hot', 'warm', 'cold', 'archive'))
      `);
      console.log("[Migration v10] Added storage_tier column to recordings");
    } catch (e) {
      console.log("[Migration v10] storage_tier column may already exist");
    }
    try {
      database2.run("CREATE INDEX IF NOT EXISTS idx_recordings_storage_tier ON recordings(storage_tier)");
      console.log("[Migration v10] Created storage_tier index");
    } catch (e) {
      console.log("[Migration v10] storage_tier index may already exist");
    }
    console.log("[Migration v10] quality_assessments table added to schema");
    console.log("Migration v10 complete: Quality assessment and storage policy tables created");
  },
  11: () => {
    console.log("Running migration to schema v11: Knowledge Captures architecture");
    console.log("[Migration v11] Knowledge captures tables will be created by manual migration");
    console.log("Migration v11 complete: Schema version updated to v11");
  }
};
function runMigrations(currentVersion) {
  for (let v = currentVersion + 1; v <= SCHEMA_VERSION; v++) {
    const migration = MIGRATIONS[v];
    if (migration) {
      console.log(`Running migration to v${v}...`);
      migration();
    }
    getDatabase().run("INSERT OR REPLACE INTO schema_version (version) VALUES (?)", [v]);
  }
}
async function initializeDatabase() {
  dbPath = getDatabasePath();
  try {
    const SQL = await initSqlJs();
    if (fs.existsSync(dbPath)) {
      const fileBuffer = fs.readFileSync(dbPath);
      db = new SQL.Database(fileBuffer);
    } else {
      db = new SQL.Database();
    }
    db.run(SCHEMA);
    const versionResult = db.exec("SELECT version FROM schema_version ORDER BY version DESC LIMIT 1");
    const currentVersion = versionResult.length > 0 && versionResult[0].values.length > 0 ? versionResult[0].values[0][0] : 0;
    if (currentVersion < SCHEMA_VERSION) {
      runMigrations(currentVersion);
      console.log(`Database migrated from v${currentVersion} to v${SCHEMA_VERSION}`);
    } else if (currentVersion === 0) {
      db.run("INSERT INTO schema_version (version) VALUES (?)", [SCHEMA_VERSION]);
    }
    saveDatabase();
    console.log(`Database initialized at ${dbPath} (schema v${SCHEMA_VERSION})`);
  } catch (error2) {
    console.error("Failed to initialize database:", error2);
    throw error2;
  }
}
function saveDatabase() {
  if (db && dbPath) {
    const data = db.export();
    const buffer = Buffer.from(data);
    fs.writeFileSync(dbPath, buffer);
  }
}
function getDatabase() {
  if (!db) {
    throw new Error("Database not initialized");
  }
  return db;
}
function closeDatabase() {
  if (db) {
    saveDatabase();
    db.close();
    db = null;
  }
}
function queryAll(sql, params = []) {
  const stmt = getDatabase().prepare(sql);
  stmt.bind(params);
  const results = [];
  while (stmt.step()) {
    const row = stmt.getAsObject();
    results.push(row);
  }
  stmt.free();
  return results;
}
function queryOne(sql, params = []) {
  const results = queryAll(sql, params);
  return results[0];
}
function run(sql, params = []) {
  getDatabase().run(sql, params);
  saveDatabase();
}
function runNoSave(sql, params = []) {
  getDatabase().run(sql, params);
}
function runInTransaction(fn) {
  const database2 = getDatabase();
  database2.run("BEGIN TRANSACTION");
  try {
    const result = fn();
    database2.run("COMMIT");
    saveDatabase();
    return result;
  } catch (error2) {
    database2.run("ROLLBACK");
    throw error2;
  }
}
function upsertMeetingsBatch(meetings) {
  if (meetings.length === 0) return;
  runInTransaction(() => {
    for (const meeting of meetings) {
      const existing = getMeetingById(meeting.id);
      if (existing) {
        runNoSave(
          `UPDATE meetings SET
            subject = ?, start_time = ?, end_time = ?, location = ?,
            organizer_name = ?, organizer_email = ?, attendees = ?,
            description = ?, is_recurring = ?, recurrence_rule = ?,
            meeting_url = ?, updated_at = CURRENT_TIMESTAMP
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
            meeting.id
          ]
        );
      } else {
        runNoSave(
          `INSERT INTO meetings (id, subject, start_time, end_time, location, organizer_name,
            organizer_email, attendees, description, is_recurring, recurrence_rule, meeting_url)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
            meeting.meeting_url ?? null
          ]
        );
      }
      extractContactsFromMeetingDataInternal(meeting);
    }
  });
}
function getMeetings(startDate, endDate) {
  let sql = "SELECT * FROM meetings";
  const params = [];
  if (startDate && endDate) {
    sql += " WHERE start_time >= ? AND start_time <= ?";
    params.push(startDate, endDate);
  } else if (startDate) {
    sql += " WHERE start_time >= ?";
    params.push(startDate);
  } else if (endDate) {
    sql += " WHERE start_time <= ?";
    params.push(endDate);
  }
  sql += " ORDER BY start_time ASC";
  return queryAll(sql, params);
}
function getMeetingById(id) {
  return queryOne("SELECT * FROM meetings WHERE id = ?", [id]);
}
function extractContactsFromMeetingDataInternal(meeting) {
  const emailsToLookup = [];
  if (meeting.organizer_email) {
    emailsToLookup.push(meeting.organizer_email);
  }
  let attendees = [];
  if (meeting.attendees) {
    try {
      attendees = JSON.parse(meeting.attendees);
      for (const attendee of attendees) {
        if (attendee.email) {
          emailsToLookup.push(attendee.email);
        }
      }
    } catch (e) {
    }
  }
  const existingContacts = getContactsByEmails(emailsToLookup);
  if (meeting.organizer_email || meeting.organizer_name) {
    const existing = meeting.organizer_email ? existingContacts.get(meeting.organizer_email) : void 0;
    let contactId;
    if (existing) {
      runNoSave(
        `UPDATE contacts SET name = COALESCE(?, name), last_seen_at = MAX(last_seen_at, ?) WHERE id = ?`,
        [meeting.organizer_name, meeting.start_time, existing.id]
      );
      contactId = existing.id;
    } else {
      contactId = crypto.randomUUID();
      runNoSave(
        `INSERT INTO contacts (id, name, email, first_seen_at, last_seen_at, meeting_count) VALUES (?, ?, ?, ?, ?, 1)`,
        [contactId, meeting.organizer_name || "Unknown", meeting.organizer_email || null, meeting.start_time, meeting.start_time]
      );
    }
    runNoSave(
      "INSERT OR IGNORE INTO meeting_contacts (meeting_id, contact_id, role) VALUES (?, ?, ?)",
      [meeting.id, contactId, "organizer"]
    );
  }
  for (const attendee of attendees) {
    if (!attendee.email && !attendee.name) continue;
    const existing = attendee.email ? existingContacts.get(attendee.email) : void 0;
    let contactId;
    if (existing) {
      runNoSave(
        `UPDATE contacts SET name = COALESCE(?, name), last_seen_at = MAX(last_seen_at, ?) WHERE id = ?`,
        [attendee.name, meeting.start_time, existing.id]
      );
      contactId = existing.id;
    } else {
      contactId = crypto.randomUUID();
      runNoSave(
        `INSERT INTO contacts (id, name, email, first_seen_at, last_seen_at, meeting_count) VALUES (?, ?, ?, ?, ?, 1)`,
        [contactId, attendee.name || attendee.email || "Unknown", attendee.email || null, meeting.start_time, meeting.start_time]
      );
    }
    runNoSave(
      "INSERT OR IGNORE INTO meeting_contacts (meeting_id, contact_id, role) VALUES (?, ?, ?)",
      [meeting.id, contactId, "attendee"]
    );
  }
}
function getRecordings() {
  return queryAll("SELECT * FROM recordings ORDER BY date_recorded DESC");
}
function getRecordingById(id) {
  return queryOne("SELECT * FROM recordings WHERE id = ?", [id]);
}
function getRecordingsForMeeting(meetingId) {
  return queryAll("SELECT * FROM recordings WHERE meeting_id = ?", [meetingId]);
}
function getRecordingsByIds(ids) {
  if (ids.length === 0) return /* @__PURE__ */ new Map();
  const placeholders = ids.map(() => "?").join(",");
  const recordings = queryAll(
    `SELECT * FROM recordings WHERE id IN (${placeholders})`,
    ids
  );
  const map = /* @__PURE__ */ new Map();
  recordings.forEach((r) => map.set(r.id, r));
  return map;
}
function getRecordingByFilename(filename) {
  return queryOne("SELECT * FROM recordings WHERE filename = ?", [filename]);
}
function updateRecordingLifecycle(id, updates) {
  const setClauses = [];
  const values = [];
  if (updates.location !== void 0) {
    setClauses.push("location = ?");
    values.push(updates.location);
  }
  if (updates.on_device !== void 0) {
    setClauses.push("on_device = ?");
    values.push(updates.on_device);
  }
  if (updates.on_local !== void 0) {
    setClauses.push("on_local = ?");
    values.push(updates.on_local);
  }
  if (updates.device_last_seen !== void 0) {
    setClauses.push("device_last_seen = ?");
    values.push(updates.device_last_seen);
  }
  if (updates.file_path !== void 0) {
    setClauses.push("file_path = ?");
    values.push(updates.file_path);
  }
  if (updates.transcription_status !== void 0) {
    setClauses.push("transcription_status = ?");
    values.push(updates.transcription_status);
  }
  if (setClauses.length > 0) {
    values.push(id);
    run(`UPDATE recordings SET ${setClauses.join(", ")} WHERE id = ?`, values);
  }
}
function markRecordingDownloaded(filename, localPath) {
  const recording = getRecordingByFilename(filename);
  if (recording) {
    const newLocation = recording.on_device ? "both" : "local-only";
    updateRecordingLifecycle(recording.id, {
      file_path: localPath,
      on_local: 1,
      location: newLocation
    });
  }
}
function deleteRecordingLocal(id) {
  const recording = getRecordingById(id);
  if (!recording) return;
  const newLocation = recording.on_device ? "device-only" : "deleted";
  updateRecordingLifecycle(id, {
    file_path: null,
    on_local: 0,
    location: newLocation
  });
}
function insertRecording(recording) {
  run(
    `INSERT INTO recordings (id, filename, original_filename, file_path, file_size,
      duration_seconds, date_recorded, meeting_id, correlation_confidence,
      correlation_method, status)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
      recording.status
    ]
  );
}
function updateRecordingStatus(id, status) {
  run("UPDATE recordings SET status = ? WHERE id = ?", [status, id]);
}
function linkRecordingToMeeting(recordingId, meetingId, confidence, method) {
  run(
    `UPDATE recordings SET meeting_id = ?, correlation_confidence = ?, correlation_method = ? WHERE id = ?`,
    [meetingId, confidence, method, recordingId]
  );
}
function getTranscriptByRecordingId(recordingId) {
  return queryOne("SELECT * FROM transcripts WHERE recording_id = ?", [recordingId]);
}
function getTranscriptsByRecordingIds(recordingIds) {
  if (recordingIds.length === 0) return /* @__PURE__ */ new Map();
  const results = /* @__PURE__ */ new Map();
  const chunkSize = 100;
  for (let i = 0; i < recordingIds.length; i += chunkSize) {
    const chunk = recordingIds.slice(i, i + chunkSize);
    const placeholders = chunk.map(() => "?").join(",");
    const transcripts = queryAll(
      `SELECT * FROM transcripts WHERE recording_id IN (${placeholders})`,
      chunk
    );
    for (const transcript of transcripts) {
      results.set(transcript.recording_id, transcript);
    }
  }
  return results;
}
function insertTranscript(transcript) {
  run(
    `INSERT INTO transcripts (id, recording_id, full_text, language, summary, action_items,
      topics, key_points, sentiment, speakers, word_count, transcription_provider, transcription_model)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      transcript.id,
      transcript.recording_id,
      transcript.full_text,
      transcript.language,
      transcript.summary ?? null,
      transcript.action_items ?? null,
      transcript.topics ?? null,
      transcript.key_points ?? null,
      null,
      null,
      transcript.word_count ?? null,
      transcript.transcription_provider ?? null,
      transcript.transcription_model ?? null
    ]
  );
}
function escapeLikePattern(pattern) {
  return pattern.replace(/\\/g, "\\\\").replace(/%/g, "\\%").replace(/_/g, "\\_");
}
function searchTranscripts(query) {
  const escaped = escapeLikePattern(query);
  return queryAll(
    `SELECT * FROM transcripts WHERE full_text LIKE ? ESCAPE '\\' OR summary LIKE ? ESCAPE '\\' OR topics LIKE ? ESCAPE '\\'`,
    [`%${escaped}%`, `%${escaped}%`, `%${escaped}%`]
  );
}
function addToQueue(recordingId) {
  const id = crypto.randomUUID();
  run("INSERT INTO transcription_queue (id, recording_id) VALUES (?, ?)", [id, recordingId]);
  return id;
}
function getQueueItems(status) {
  if (status) {
    return queryAll("SELECT * FROM transcription_queue WHERE status = ? ORDER BY created_at", [status]);
  }
  return queryAll("SELECT * FROM transcription_queue ORDER BY created_at");
}
function updateQueueItem(id, status, errorMessage) {
  if (status === "processing") {
    run("UPDATE transcription_queue SET status = ?, started_at = CURRENT_TIMESTAMP, attempts = attempts + 1 WHERE id = ?", [
      status,
      id
    ]);
  } else if (status === "completed" || status === "failed") {
    run("UPDATE transcription_queue SET status = ?, completed_at = CURRENT_TIMESTAMP, error_message = ? WHERE id = ?", [
      status,
      errorMessage ?? null,
      id
    ]);
  } else {
    run("UPDATE transcription_queue SET status = ? WHERE id = ?", [status, id]);
  }
}
function getChatHistory(limit = 50) {
  return queryAll("SELECT * FROM chat_messages ORDER BY created_at DESC LIMIT ?", [limit]).reverse();
}
function addChatMessage(role, content, sources) {
  const id = crypto.randomUUID();
  run("INSERT INTO chat_messages (id, role, content, sources) VALUES (?, ?, ?, ?)", [id, role, content, sources ?? null]);
  return id;
}
function clearChatHistory() {
  run("DELETE FROM chat_messages", []);
}
function isFileSynced(originalFilename) {
  const result = queryOne("SELECT COUNT(*) as count FROM synced_files WHERE original_filename = ?", [
    originalFilename
  ]);
  return (result?.count ?? 0) > 0;
}
function getSyncedFile(originalFilename) {
  return queryOne("SELECT * FROM synced_files WHERE original_filename = ?", [originalFilename]);
}
function getAllSyncedFiles() {
  return queryAll("SELECT * FROM synced_files ORDER BY synced_at DESC");
}
function addSyncedFile(originalFilename, localFilename, filePath, fileSize) {
  const id = crypto.randomUUID();
  run(
    "INSERT OR REPLACE INTO synced_files (id, original_filename, local_filename, file_path, file_size) VALUES (?, ?, ?, ?, ?)",
    [id, originalFilename, localFilename, filePath, fileSize ?? null]
  );
  return id;
}
function removeSyncedFile(originalFilename) {
  run("DELETE FROM synced_files WHERE original_filename = ?", [originalFilename]);
}
function getSyncedFilenames() {
  const files = queryAll("SELECT original_filename FROM synced_files");
  return new Set(files.map((f) => f.original_filename));
}
function getContacts(search, limit = 100, offset = 0) {
  let countSql = "SELECT COUNT(*) as count FROM contacts";
  let sql = "SELECT * FROM contacts";
  const params = [];
  if (search) {
    const escaped = escapeLikePattern(search);
    const searchClause = " WHERE name LIKE ? ESCAPE '\\' OR email LIKE ? ESCAPE '\\'";
    countSql += searchClause;
    sql += searchClause;
    params.push(`%${escaped}%`, `%${escaped}%`);
  }
  sql += " ORDER BY meeting_count DESC, last_seen_at DESC LIMIT ? OFFSET ?";
  const countResult = queryOne(countSql, params);
  const contacts = queryAll(sql, [...params, limit, offset]);
  return { contacts, total: countResult?.count ?? 0 };
}
function getContactById(id) {
  return queryOne("SELECT * FROM contacts WHERE id = ?", [id]);
}
function getContactsByEmails(emails) {
  if (emails.length === 0) return /* @__PURE__ */ new Map();
  const uniqueEmails = [...new Set(emails.filter(Boolean))];
  if (uniqueEmails.length === 0) return /* @__PURE__ */ new Map();
  const results = /* @__PURE__ */ new Map();
  const chunkSize = 100;
  for (let i = 0; i < uniqueEmails.length; i += chunkSize) {
    const chunk = uniqueEmails.slice(i, i + chunkSize);
    const placeholders = chunk.map(() => "?").join(",");
    const contacts = queryAll(
      `SELECT * FROM contacts WHERE email IN (${placeholders})`,
      chunk
    );
    for (const contact of contacts) {
      if (contact.email) {
        results.set(contact.email, contact);
      }
    }
  }
  return results;
}
function updateContactNotes(id, notes) {
  run("UPDATE contacts SET notes = ? WHERE id = ?", [notes, id]);
}
function getMeetingsForContact(contactId) {
  return queryAll(
    `SELECT m.* FROM meetings m
     JOIN meeting_contacts mc ON m.id = mc.meeting_id
     WHERE mc.contact_id = ?
     ORDER BY m.start_time DESC`,
    [contactId]
  );
}
function getContactsForMeeting(meetingId) {
  return queryAll(
    `SELECT c.* FROM contacts c
     JOIN meeting_contacts mc ON c.id = mc.contact_id
     WHERE mc.meeting_id = ?`,
    [meetingId]
  );
}
function getProjects(search, limit = 100, offset = 0) {
  let countSql = "SELECT COUNT(*) as count FROM projects";
  let sql = "SELECT * FROM projects";
  const params = [];
  if (search) {
    const escaped = escapeLikePattern(search);
    const searchClause = " WHERE name LIKE ? ESCAPE '\\' OR description LIKE ? ESCAPE '\\'";
    countSql += searchClause;
    sql += searchClause;
    params.push(`%${escaped}%`, `%${escaped}%`);
  }
  sql += " ORDER BY created_at DESC LIMIT ? OFFSET ?";
  const countResult = queryOne(countSql, params);
  const projects = queryAll(sql, [...params, limit, offset]);
  return { projects, total: countResult?.count ?? 0 };
}
function getProjectById(id) {
  return queryOne("SELECT * FROM projects WHERE id = ?", [id]);
}
function createProject(project) {
  run(
    "INSERT INTO projects (id, name, description) VALUES (?, ?, ?)",
    [project.id, project.name, project.description]
  );
  return { ...project, created_at: (/* @__PURE__ */ new Date()).toISOString() };
}
function updateProject(id, name, description) {
  const updates = [];
  const params = [];
  if (name !== void 0) {
    updates.push("name = ?");
    params.push(name);
  }
  if (description !== void 0) {
    updates.push("description = ?");
    params.push(description);
  }
  if (updates.length > 0) {
    params.push(id);
    run(`UPDATE projects SET ${updates.join(", ")} WHERE id = ?`, params);
  }
}
function deleteProject(id) {
  run("DELETE FROM projects WHERE id = ?", [id]);
}
function getMeetingsForProject(projectId) {
  return queryAll(
    `SELECT m.* FROM meetings m
     JOIN meeting_projects mp ON m.id = mp.meeting_id
     WHERE mp.project_id = ?
     ORDER BY m.start_time DESC`,
    [projectId]
  );
}
function getProjectsForMeeting(meetingId) {
  return queryAll(
    `SELECT p.* FROM projects p
     JOIN meeting_projects mp ON p.id = mp.project_id
     WHERE mp.meeting_id = ?`,
    [meetingId]
  );
}
function tagMeetingToProject(meetingId, projectId) {
  run(
    "INSERT OR IGNORE INTO meeting_projects (meeting_id, project_id) VALUES (?, ?)",
    [meetingId, projectId]
  );
}
function untagMeetingFromProject(meetingId, projectId) {
  run("DELETE FROM meeting_projects WHERE meeting_id = ? AND project_id = ?", [meetingId, projectId]);
}
function findCandidateMeetingsForRecording(recordingId) {
  const recording = getRecordingById(recordingId);
  if (!recording) return [];
  const recStart = new Date(recording.date_recorded);
  const durationMs = (recording.duration_seconds || 30 * 60) * 1e3;
  const recEnd = new Date(recStart.getTime() + durationMs);
  const bufferMs = 30 * 60 * 1e3;
  const windowStart = new Date(recStart.getTime() - bufferMs).toISOString();
  const windowEnd = new Date(recEnd.getTime() + bufferMs).toISOString();
  return queryAll(
    `SELECT * FROM meetings
     WHERE (start_time <= ? AND end_time >= ?)
        OR (start_time >= ? AND start_time <= ?)
        OR (end_time >= ? AND end_time <= ?)
     ORDER BY start_time`,
    [windowEnd, windowStart, windowStart, windowEnd, windowStart, windowEnd]
  );
}
function addRecordingMeetingCandidate(recordingId, meetingId, confidenceScore, matchReason, isAiSelected = false) {
  const id = crypto.randomUUID();
  run(
    `INSERT OR REPLACE INTO recording_meeting_candidates
      (id, recording_id, meeting_id, confidence_score, match_reason, is_selected, is_ai_selected)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [id, recordingId, meetingId, confidenceScore, matchReason, isAiSelected ? 1 : 0, isAiSelected ? 1 : 0]
  );
  if (isAiSelected) {
    linkRecordingToMeeting(recordingId, meetingId, confidenceScore, "ai_transcript_match");
  }
  return id;
}
function getQualityAssessment(recordingId) {
  return queryOne("SELECT * FROM quality_assessments WHERE recording_id = ?", [recordingId]);
}
function upsertQualityAssessment(assessment) {
  const existing = getQualityAssessment(assessment.recording_id);
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
    );
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
    );
  }
}
function getRecordingsByQuality(quality) {
  return queryAll(
    `SELECT r.* FROM recordings r
     JOIN quality_assessments qa ON r.id = qa.recording_id
     WHERE qa.quality = ?
     ORDER BY r.date_recorded DESC`,
    [quality]
  );
}
function updateRecordingStorageTier(recordingId, tier) {
  run("UPDATE recordings SET storage_tier = ? WHERE id = ?", [tier, recordingId]);
}
function getRecordingsByStorageTier(tier) {
  return queryAll(
    "SELECT * FROM recordings WHERE storage_tier = ? ORDER BY date_recorded DESC",
    [tier]
  );
}
async function getRecordingByIdAsync(id) {
  return new Promise((resolve) => {
    setImmediate(() => resolve(getRecordingById(id)));
  });
}
async function getTranscriptByRecordingIdAsync(recordingId) {
  return new Promise((resolve) => {
    setImmediate(() => resolve(getTranscriptByRecordingId(recordingId)));
  });
}
async function upsertQualityAssessmentAsync(assessment) {
  return new Promise((resolve) => {
    setImmediate(() => {
      upsertQualityAssessment(assessment);
      resolve();
    });
  });
}
async function getQualityAssessmentAsync(recordingId) {
  return new Promise((resolve) => {
    setImmediate(() => resolve(getQualityAssessment(recordingId)));
  });
}
async function updateRecordingStorageTierAsync(recordingId, tier) {
  return new Promise((resolve) => {
    setImmediate(() => {
      updateRecordingStorageTier(recordingId, tier);
      resolve();
    });
  });
}
const database = /* @__PURE__ */ Object.freeze(/* @__PURE__ */ Object.defineProperty({
  __proto__: null,
  addChatMessage,
  addRecordingMeetingCandidate,
  addSyncedFile,
  addToQueue,
  clearChatHistory,
  closeDatabase,
  createProject,
  deleteProject,
  deleteRecordingLocal,
  findCandidateMeetingsForRecording,
  getAllSyncedFiles,
  getChatHistory,
  getContactById,
  getContacts,
  getContactsByEmails,
  getContactsForMeeting,
  getDatabase,
  getMeetingById,
  getMeetings,
  getMeetingsForContact,
  getMeetingsForProject,
  getProjectById,
  getProjects,
  getProjectsForMeeting,
  getQualityAssessment,
  getQualityAssessmentAsync,
  getQueueItems,
  getRecordingByFilename,
  getRecordingById,
  getRecordingByIdAsync,
  getRecordings,
  getRecordingsByIds,
  getRecordingsByQuality,
  getRecordingsByStorageTier,
  getRecordingsForMeeting,
  getSyncedFile,
  getSyncedFilenames,
  getTranscriptByRecordingId,
  getTranscriptByRecordingIdAsync,
  getTranscriptsByRecordingIds,
  initializeDatabase,
  insertRecording,
  insertTranscript,
  isFileSynced,
  linkRecordingToMeeting,
  markRecordingDownloaded,
  queryAll,
  queryOne,
  removeSyncedFile,
  run,
  runInTransaction,
  saveDatabase,
  searchTranscripts,
  tagMeetingToProject,
  untagMeetingFromProject,
  updateContactNotes,
  updateProject,
  updateQueueItem,
  updateRecordingLifecycle,
  updateRecordingStatus,
  updateRecordingStorageTier,
  updateRecordingStorageTierAsync,
  upsertMeetingsBatch,
  upsertQualityAssessment,
  upsertQualityAssessmentAsync
}, Symbol.toStringTag, { value: "Module" }));
function registerConfigHandlers() {
  electron.ipcMain.handle("config:get", async () => {
    return getConfig();
  });
  electron.ipcMain.handle("config:set", async (_, newConfig) => {
    await saveConfig(newConfig);
    return getConfig();
  });
  electron.ipcMain.handle(
    "config:update-section",
    async (_, section, values) => {
      await updateConfig(section, values);
      return getConfig();
    }
  );
  electron.ipcMain.handle("config:get-value", async (_, key) => {
    const config2 = getConfig();
    return config2[key];
  });
}
function registerDatabaseHandlers() {
  electron.ipcMain.handle("db:get-meetings", async (_, startDate, endDate) => {
    return getMeetings(startDate, endDate);
  });
  electron.ipcMain.handle("db:get-meeting", async (_, id) => {
    return getMeetingById(id);
  });
  electron.ipcMain.handle("db:get-recordings", async () => {
    return getRecordings();
  });
  electron.ipcMain.handle("db:get-recording", async (_, id) => {
    return getRecordingById(id);
  });
  electron.ipcMain.handle("db:get-recordings-for-meeting", async (_, meetingId) => {
    return getRecordingsForMeeting(meetingId);
  });
  electron.ipcMain.handle("db:update-recording-status", async (_, id, status) => {
    updateRecordingStatus(id, status);
    return getRecordingById(id);
  });
  electron.ipcMain.handle(
    "db:link-recording-to-meeting",
    async (_, recordingId, meetingId, confidence, method) => {
      linkRecordingToMeeting(recordingId, meetingId, confidence, method);
      return getRecordingById(recordingId);
    }
  );
  electron.ipcMain.handle("db:get-transcript", async (_, recordingId) => {
    return getTranscriptByRecordingId(recordingId);
  });
  electron.ipcMain.handle("db:search-transcripts", async (_, query) => {
    return searchTranscripts(query);
  });
  electron.ipcMain.handle("db:get-queue", async (_, status) => {
    return getQueueItems(status);
  });
  electron.ipcMain.handle("db:get-chat-history", async (_, limit) => {
    return getChatHistory(limit);
  });
  electron.ipcMain.handle("db:add-chat-message", async (_, role, content, sources) => {
    const id = addChatMessage(role, content, sources);
    return { id, role, content, sources };
  });
  electron.ipcMain.handle("db:clear-chat-history", async () => {
    clearChatHistory();
    return true;
  });
  electron.ipcMain.handle("db:get-meeting-details", async (_, meetingId) => {
    const meeting = getMeetingById(meetingId);
    if (!meeting) return null;
    const recordings = getRecordingsForMeeting(meetingId);
    const recordingsWithTranscripts = recordings.map((recording) => ({
      ...recording,
      transcript: getTranscriptByRecordingId(recording.id)
    }));
    return {
      meeting,
      recordings: recordingsWithTranscripts
    };
  });
  electron.ipcMain.handle("db:is-file-synced", async (_, originalFilename) => {
    return isFileSynced(originalFilename);
  });
  electron.ipcMain.handle("db:get-synced-file", async (_, originalFilename) => {
    return getSyncedFile(originalFilename);
  });
  electron.ipcMain.handle("db:get-all-synced-files", async () => {
    return getAllSyncedFiles();
  });
  electron.ipcMain.handle("db:add-synced-file", async (_, originalFilename, localFilename, filePath, fileSize) => {
    return addSyncedFile(originalFilename, localFilename, filePath, fileSize);
  });
  electron.ipcMain.handle("db:remove-synced-file", async (_, originalFilename) => {
    removeSyncedFile(originalFilename);
    return true;
  });
  electron.ipcMain.handle("db:get-synced-filenames", async () => {
    const set = getSyncedFilenames();
    return Array.from(set);
  });
}
const WINDOWS_TIMEZONE_OFFSETS = {
  // Americas
  "Pacific Standard Time": -8 * 3600,
  "Mountain Standard Time": -7 * 3600,
  "Central Standard Time": -6 * 3600,
  "Central Standard Time (Mexico)": -6 * 3600,
  "Central America Standard Time": -6 * 3600,
  // Guatemala, Costa Rica, etc.
  "Eastern Standard Time": -5 * 3600,
  "SA Pacific Standard Time": -5 * 3600,
  // Colombia, Peru, Ecuador
  "Venezuela Standard Time": -4 * 3600,
  "SA Western Standard Time": -4 * 3600,
  // Bolivia, Guyana
  "Atlantic Standard Time": -4 * 3600,
  "Paraguay Standard Time": -4 * 3600,
  "Pacific SA Standard Time": -3 * 3600,
  // Chile (Santiago)
  "SA Eastern Standard Time": -3 * 3600,
  // Brazil (Brasilia), French Guiana
  "Argentina Standard Time": -3 * 3600,
  "E. South America Standard Time": -3 * 3600,
  // Brazil (Brasilia)
  "Greenland Standard Time": -3 * 3600,
  "Montevideo Standard Time": -3 * 3600,
  // Uruguay
  "Newfoundland Standard Time": -3.5 * 3600,
  // Europe & Africa
  "GMT Standard Time": 0,
  "Greenwich Standard Time": 0,
  "UTC": 0,
  "W. Europe Standard Time": 1 * 3600,
  "Central Europe Standard Time": 1 * 3600,
  "Central European Standard Time": 1 * 3600,
  "Romance Standard Time": 1 * 3600,
  // France, Belgium, Spain
  "W. Central Africa Standard Time": 1 * 3600,
  "E. Europe Standard Time": 2 * 3600,
  "GTB Standard Time": 2 * 3600,
  // Greece, Turkey, Bulgaria
  "FLE Standard Time": 2 * 3600,
  // Finland, Lithuania, Estonia
  "South Africa Standard Time": 2 * 3600,
  "Israel Standard Time": 2 * 3600,
  "Egypt Standard Time": 2 * 3600,
  "Jordan Standard Time": 3 * 3600,
  "Arabic Standard Time": 3 * 3600,
  // Iraq
  "Arab Standard Time": 3 * 3600,
  // Kuwait, Riyadh
  "E. Africa Standard Time": 3 * 3600,
  "Russian Standard Time": 3 * 3600,
  "Iran Standard Time": 3.5 * 3600,
  // Asia & Pacific
  "Arabian Standard Time": 4 * 3600,
  // Abu Dhabi, Dubai
  "Azerbaijan Standard Time": 4 * 3600,
  "Georgian Standard Time": 4 * 3600,
  "Afghanistan Standard Time": 4.5 * 3600,
  "West Asia Standard Time": 5 * 3600,
  // Pakistan
  "Pakistan Standard Time": 5 * 3600,
  "India Standard Time": 5.5 * 3600,
  "Sri Lanka Standard Time": 5.5 * 3600,
  "Nepal Standard Time": 5.75 * 3600,
  "Central Asia Standard Time": 6 * 3600,
  // Kazakhstan
  "Bangladesh Standard Time": 6 * 3600,
  "Myanmar Standard Time": 6.5 * 3600,
  "SE Asia Standard Time": 7 * 3600,
  // Thailand, Vietnam
  "North Asia Standard Time": 7 * 3600,
  "China Standard Time": 8 * 3600,
  "Singapore Standard Time": 8 * 3600,
  "W. Australia Standard Time": 8 * 3600,
  "Taipei Standard Time": 8 * 3600,
  "Korea Standard Time": 9 * 3600,
  "Tokyo Standard Time": 9 * 3600,
  "AUS Central Standard Time": 9.5 * 3600,
  "Cen. Australia Standard Time": 9.5 * 3600,
  "AUS Eastern Standard Time": 10 * 3600,
  "E. Australia Standard Time": 10 * 3600,
  "West Pacific Standard Time": 10 * 3600,
  "Tasmania Standard Time": 10 * 3600,
  "Central Pacific Standard Time": 11 * 3600,
  "New Zealand Standard Time": 12 * 3600,
  "Fiji Standard Time": 12 * 3600,
  "Tonga Standard Time": 13 * 3600,
  // Additional common names
  "Customized Time Zone": -5 * 3600
  // Default to something reasonable
};
function validateCalendarUrl(url) {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
      return { valid: false, error: "Only HTTP/HTTPS URLs are allowed for calendar sync" };
    }
    if (parsed.protocol === "file:") {
      return { valid: false, error: "File URLs are not allowed for calendar sync" };
    }
    const hostname = parsed.hostname.toLowerCase();
    const isLocalhost = hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1" || hostname === "[::1]" || hostname.endsWith(".local");
    if (isLocalhost) {
      const isDev = process.env.NODE_ENV === "development";
      if (!isDev) {
        return { valid: false, error: "Localhost URLs are not allowed for calendar sync in production" };
      }
    }
    const privateIPPatterns = [
      /^10\./,
      // 10.0.0.0/8
      /^172\.(1[6-9]|2[0-9]|3[0-1])\./,
      // 172.16.0.0/12
      /^192\.168\./,
      // 192.168.0.0/16
      /^169\.254\./,
      // Link-local 169.254.0.0/16
      /^0\./,
      // 0.0.0.0/8
      /^100\.(6[4-9]|[7-9][0-9]|1[0-2][0-9])\./
      // CGNAT 100.64.0.0/10
    ];
    for (const pattern of privateIPPatterns) {
      if (pattern.test(hostname)) {
        return { valid: false, error: "Private IP addresses are not allowed for calendar sync" };
      }
    }
    const blockedHostnames = [
      "169.254.169.254",
      // AWS/GCP metadata
      "metadata.google.internal",
      "metadata.gcp.internal"
    ];
    if (blockedHostnames.includes(hostname)) {
      return { valid: false, error: "This URL is blocked for security reasons" };
    }
    if (parsed.protocol === "http:" && !isLocalhost) {
      const allowedHttpHosts = [
        "calendar.google.com",
        "outlook.office365.com",
        "outlook.live.com"
      ];
      if (!allowedHttpHosts.some((h) => hostname === h || hostname.endsWith("." + h))) {
        return { valid: false, error: "HTTPS is required for calendar URLs (HTTP is only allowed for major calendar providers)" };
      }
    }
    return { valid: true };
  } catch (e) {
    return { valid: false, error: "Invalid URL format" };
  }
}
function yieldToEventLoop() {
  return new Promise((resolve) => setTimeout(resolve, 0));
}
function registerTimezones(vcalendar) {
  const vtimezones = vcalendar.getAllSubcomponents("vtimezone");
  for (const vtimezone of vtimezones) {
    try {
      const tzid = vtimezone.getFirstPropertyValue("tzid");
      if (tzid && typeof tzid === "string") {
        const existing = ICAL.TimezoneService.get(tzid);
        if (!existing) {
          const tz = new ICAL.Timezone(vtimezone);
          ICAL.TimezoneService.register(tzid, tz);
          console.log(`[Calendar] Registered timezone: ${tzid}`);
        }
      }
    } catch (e) {
      console.warn("[Calendar] Failed to register timezone:", e);
    }
  }
}
function safeToJSDate(icalTime, tzidHint) {
  if (!icalTime) return null;
  try {
    if (icalTime.isDate) {
      return new Date(icalTime.year, icalTime.month - 1, icalTime.day, 0, 0, 0, 0);
    }
    const zone = icalTime.zone;
    if (!zone || zone.tzid === "floating" || zone === ICAL.Timezone.localTimezone) {
      if (tzidHint && WINDOWS_TIMEZONE_OFFSETS[tzidHint] !== void 0) {
        const utcOffset = WINDOWS_TIMEZONE_OFFSETS[tzidHint];
        const localTimeAsUtc = Date.UTC(
          icalTime.year,
          icalTime.month - 1,
          icalTime.day,
          icalTime.hour,
          icalTime.minute,
          icalTime.second
        );
        const utcTime = localTimeAsUtc - utcOffset * 1e3;
        const jsDate = new Date(utcTime);
        console.log(`[Calendar] Fallback timezone conversion: ${icalTime.year}-${icalTime.month}-${icalTime.day} ${icalTime.hour}:${icalTime.minute} (${tzidHint}, offset=${utcOffset}s) -> UTC: ${jsDate.toISOString()} (local: ${jsDate.toLocaleTimeString()})`);
        return jsDate;
      }
      return new Date(
        icalTime.year,
        icalTime.month - 1,
        icalTime.day,
        icalTime.hour,
        icalTime.minute,
        icalTime.second
      );
    }
    if (zone === ICAL.Timezone.utcTimezone || zone.tzid === "UTC") {
      return new Date(Date.UTC(
        icalTime.year,
        icalTime.month - 1,
        icalTime.day,
        icalTime.hour,
        icalTime.minute,
        icalTime.second
      ));
    }
    try {
      const utcOffset = zone.utcOffset(icalTime);
      const localTimeAsUtc = Date.UTC(
        icalTime.year,
        icalTime.month - 1,
        icalTime.day,
        icalTime.hour,
        icalTime.minute,
        icalTime.second
      );
      const utcTime = localTimeAsUtc - utcOffset * 1e3;
      const jsDate = new Date(utcTime);
      console.debug(`[Calendar] Time conversion: ${icalTime.year}-${icalTime.month}-${icalTime.day} ${icalTime.hour}:${icalTime.minute} (${zone.tzid}, offset=${utcOffset}s) -> UTC: ${jsDate.toISOString()} (local: ${jsDate.toLocaleTimeString()})`);
      return jsDate;
    } catch (offsetError) {
      console.warn(`[Calendar] Failed to get UTC offset for ${zone.tzid}, falling back to toUnixTime:`, offsetError);
      const unixTime = icalTime.toUnixTime();
      const jsDate = new Date(unixTime * 1e3);
      const yearDiff = Math.abs(jsDate.getFullYear() - icalTime.year);
      if (yearDiff > 1) {
        console.warn(`[Calendar] toUnixTime() conversion failed for ${zone.tzid} (year off by ${yearDiff}), using local time interpretation`);
        return new Date(
          icalTime.year,
          icalTime.month - 1,
          icalTime.day,
          icalTime.hour,
          icalTime.minute,
          icalTime.second
        );
      }
      return jsDate;
    }
  } catch (e) {
    console.warn("[Calendar] Error converting time, using local:", e);
    return new Date(
      icalTime.year,
      icalTime.month - 1,
      icalTime.day,
      icalTime.hour || 0,
      icalTime.minute || 0,
      icalTime.second || 0
    );
  }
}
async function syncCalendar(icsUrl) {
  console.log("Starting calendar sync...");
  try {
    const validation = validateCalendarUrl(icsUrl);
    if (!validation.valid) {
      return {
        success: false,
        meetingsCount: 0,
        error: validation.error
      };
    }
    const response = await fetch(icsUrl);
    if (!response.ok) {
      throw new Error(`Failed to fetch calendar: ${response.status} ${response.statusText}`);
    }
    const icsData = await response.text();
    const cachePath = path.join(getCachePath(), "calendar.ics");
    fs.writeFileSync(cachePath, icsData, "utf-8");
    await yieldToEventLoop();
    const meetings = await parseICSAsync(icsData);
    await yieldToEventLoop();
    try {
      upsertMeetingsBatch(meetings);
    } catch (dbError) {
      console.error("Failed to save meetings to database:", dbError);
      throw new Error(`Database error: ${dbError instanceof Error ? dbError.message : "Unknown error"}`);
    }
    const now = (/* @__PURE__ */ new Date()).toISOString();
    console.log(`Calendar sync complete: ${meetings.length} meetings`);
    return {
      success: true,
      meetingsCount: meetings.length,
      lastSync: now
    };
  } catch (error2) {
    console.error("Calendar sync failed:", error2);
    return {
      success: false,
      meetingsCount: 0,
      error: error2 instanceof Error ? error2.message : "Unknown error"
    };
  }
}
async function parseICSAsync(icsData) {
  const jcalData = ICAL.parse(icsData);
  const vcalendar = new ICAL.Component(jcalData);
  registerTimezones(vcalendar);
  const vevents = vcalendar.getAllSubcomponents("vevent");
  const meetings = [];
  const YIELD_INTERVAL = 5;
  for (let eventIndex = 0; eventIndex < vevents.length; eventIndex++) {
    if (eventIndex > 0 && eventIndex % YIELD_INTERVAL === 0) {
      await yieldToEventLoop();
    }
    const vevent = vevents[eventIndex];
    const event = new ICAL.Event(vevent);
    if (event.status === "CANCELLED") {
      continue;
    }
    const uid = event.uid;
    const summary = event.summary || "Untitled Meeting";
    const dtStartProp = vevent.getFirstProperty("dtstart");
    const dtEndProp = vevent.getFirstProperty("dtend");
    const startTzid = dtStartProp?.getParameter("tzid");
    const endTzid = dtEndProp?.getParameter("tzid");
    const startDate = safeToJSDate(event.startDate, startTzid);
    const endDate = safeToJSDate(event.endDate, endTzid);
    if (!uid || !startDate || !endDate) {
      continue;
    }
    const location = event.location || void 0;
    const description = event.description || void 0;
    const organizerProp = vevent.getFirstProperty("organizer");
    let organizerName;
    let organizerEmail;
    if (organizerProp) {
      organizerName = organizerProp.getParameter("cn");
      const mailto = organizerProp.getFirstValue();
      if (typeof mailto === "string" && mailto.startsWith("mailto:")) {
        organizerEmail = mailto.substring(7);
      }
    }
    const attendeeProps = vevent.getAllProperties("attendee");
    const attendees = [];
    for (const attendee of attendeeProps) {
      const name = attendee.getParameter("cn");
      const mailto = attendee.getFirstValue();
      const partstat = attendee.getParameter("partstat");
      let email;
      if (typeof mailto === "string" && mailto.startsWith("mailto:")) {
        email = mailto.substring(7);
      }
      if (name || email) {
        attendees.push({ name, email, status: partstat });
      }
    }
    const rrule = vevent.getFirstPropertyValue("rrule");
    const isRecurring = !!rrule;
    let recurrenceRule;
    if (rrule && typeof rrule.toString === "function") {
      recurrenceRule = rrule.toString();
    }
    let meetingUrl;
    const urlPatterns = [
      /https:\/\/teams\.microsoft\.com\/[^\s<>]+/i,
      /https:\/\/[\w-]+\.zoom\.us\/[^\s<>]+/i,
      /https:\/\/meet\.google\.com\/[^\s<>]+/i,
      /https:\/\/[\w-]+\.webex\.com\/[^\s<>]+/i
    ];
    const textToSearch = `${description || ""} ${location || ""}`;
    for (const pattern of urlPatterns) {
      const match = textToSearch.match(pattern);
      if (match) {
        meetingUrl = match[0];
        break;
      }
    }
    if (isRecurring && event.isRecurrenceException !== true) {
      try {
        const iterator = event.iterator();
        const maxOccurrences = 100;
        const futureLimit = /* @__PURE__ */ new Date();
        futureLimit.setMonth(futureLimit.getMonth() + 6);
        let count = 0;
        let next = iterator.next();
        while (next && count < maxOccurrences) {
          const occurrenceDate = safeToJSDate(next, startTzid);
          const pastLimit = /* @__PURE__ */ new Date();
          pastLimit.setMonth(pastLimit.getMonth() - 1);
          if (occurrenceDate && occurrenceDate >= pastLimit && occurrenceDate <= futureLimit) {
            const duration = endDate.getTime() - startDate.getTime();
            const occurrenceEnd = new Date(occurrenceDate.getTime() + duration);
            meetings.push({
              id: `${uid}_${occurrenceDate.toISOString()}`,
              subject: summary,
              start_time: occurrenceDate.toISOString(),
              end_time: occurrenceEnd.toISOString(),
              location,
              organizer_name: organizerName,
              organizer_email: organizerEmail,
              attendees: attendees.length > 0 ? JSON.stringify(attendees) : void 0,
              description,
              is_recurring: 1,
              recurrence_rule: recurrenceRule,
              meeting_url: meetingUrl
            });
          }
          next = iterator.next();
          count++;
        }
      } catch (e) {
        console.warn("Failed to expand recurring event:", e);
        meetings.push({
          id: uid,
          subject: summary,
          start_time: startDate.toISOString(),
          end_time: endDate.toISOString(),
          location,
          organizer_name: organizerName,
          organizer_email: organizerEmail,
          attendees: attendees.length > 0 ? JSON.stringify(attendees) : void 0,
          description,
          is_recurring: 1,
          recurrence_rule: recurrenceRule,
          meeting_url: meetingUrl
        });
      }
    } else {
      meetings.push({
        id: uid,
        subject: summary,
        start_time: startDate.toISOString(),
        end_time: endDate.toISOString(),
        location,
        organizer_name: organizerName,
        organizer_email: organizerEmail,
        attendees: attendees.length > 0 ? JSON.stringify(attendees) : void 0,
        description,
        is_recurring: 0,
        recurrence_rule: void 0,
        meeting_url: meetingUrl
      });
    }
  }
  return meetings;
}
function getLastSyncTime() {
  const config2 = getConfig();
  return config2.calendar.lastSyncAt;
}
const QualityLevelSchema = zod.z.enum(["high", "medium", "low"]);
zod.z.enum(["manual", "auto", "ai"]);
zod.z.object({
  recordingId: zod.z.string().uuid("Recording ID must be a valid UUID"),
  quality: QualityLevelSchema,
  reason: zod.z.string().max(1e3).optional(),
  assessedBy: zod.z.string().max(200).optional()
});
zod.z.object({
  quality: QualityLevelSchema
});
zod.z.object({
  recordingIds: zod.z.array(zod.z.string().uuid()).min(1).max(1e3)
});
const StorageTierSchema = zod.z.enum(["hot", "warm", "cold", "archive"]);
const MinAgeOverrideSchema = zod.z.record(
  StorageTierSchema,
  zod.z.number().int().nonnegative()
).optional();
zod.z.object({
  tier: StorageTierSchema
});
zod.z.object({
  minAgeOverride: MinAgeOverrideSchema
});
zod.z.object({
  tier: StorageTierSchema,
  minAgeDays: zod.z.number().int().min(0).max(36500).optional()
});
zod.z.object({
  recordingIds: zod.z.array(zod.z.string().uuid()).min(1).max(1e3),
  archive: zod.z.boolean().default(false)
});
zod.z.object({
  recordingId: zod.z.string().uuid(),
  quality: QualityLevelSchema
});
const RecordingIdSchema = zod.z.string().uuid("Recording ID must be a valid UUID");
const GetRecordingByIdSchema = zod.z.object({
  id: RecordingIdSchema
});
const DeleteRecordingSchema = zod.z.object({
  id: RecordingIdSchema
});
const LinkRecordingToMeetingSchema = zod.z.object({
  recordingId: RecordingIdSchema,
  meetingId: zod.z.string().uuid("Meeting ID must be a valid UUID")
});
const UnlinkRecordingFromMeetingSchema = zod.z.object({
  recordingId: RecordingIdSchema
});
const TranscribeRecordingSchema = zod.z.object({
  recordingId: RecordingIdSchema
});
const OpenFolderSchema = zod.z.object({
  folder: zod.z.enum(["recordings", "transcripts", "data"])
});
const ReadRecordingFileSchema = zod.z.object({
  filePath: zod.z.string().min(1).max(500)
});
const DeleteRecordingFileSchema = zod.z.object({
  filePath: zod.z.string().min(1).max(500)
});
const SaveRecordingSchema = zod.z.object({
  filename: zod.z.string().min(1).max(255),
  data: zod.z.array(zod.z.number().int().min(0).max(255))
});
const SetIcsUrlSchema = zod.z.object({
  url: zod.z.string().url("Must be a valid URL").max(2e3)
});
const ToggleAutoSyncSchema = zod.z.object({
  enabled: zod.z.boolean()
});
const SetSyncIntervalSchema = zod.z.object({
  minutes: zod.z.number().int().min(1).max(1440)
  // 1 minute to 24 hours
});
class ValidationError extends Error {
  constructor(message) {
    super(message);
    this.name = "ValidationError";
  }
}
function validateRecordingId(id) {
  const result = RecordingIdSchema.safeParse(id);
  if (!result.success) {
    throw new ValidationError(result.error.issues[0]?.message || "Invalid recording ID");
  }
  return result.data;
}
function validateRecordingIds(ids) {
  const result = zod.z.array(zod.z.string().uuid()).min(1).max(1e3).safeParse(ids);
  if (!result.success) {
    throw new ValidationError(result.error.issues[0]?.message || "Invalid recording IDs array");
  }
  return result.data;
}
function validateQualityLevel(quality) {
  const result = QualityLevelSchema.safeParse(quality);
  if (!result.success) {
    throw new ValidationError(result.error.issues[0]?.message || "Invalid quality level");
  }
  return result.data;
}
function validateStorageTier(tier) {
  const result = StorageTierSchema.safeParse(tier);
  if (!result.success) {
    throw new ValidationError(result.error.issues[0]?.message || "Invalid storage tier");
  }
  return result.data;
}
function validateOptionalString(value, maxLength = 1e4) {
  const result = zod.z.string().max(maxLength).optional().safeParse(value);
  if (!result.success) {
    throw new ValidationError(result.error.issues[0]?.message || "Invalid string");
  }
  return result.data;
}
function validateBoolean(value) {
  const result = zod.z.boolean().safeParse(value);
  if (!result.success) {
    throw new ValidationError(result.error.issues[0]?.message || "Invalid boolean");
  }
  return result.data;
}
function validateNumber(value, min, max) {
  let schema = zod.z.number();
  schema = schema.min(min);
  schema = schema.max(max);
  const result = schema.safeParse(value);
  if (!result.success) {
    throw new ValidationError(result.error.issues[0]?.message || "Invalid number");
  }
  return result.data;
}
function validateMinAgeOverride(override) {
  const result = MinAgeOverrideSchema.safeParse(override);
  if (!result.success) {
    throw new ValidationError(result.error.issues[0]?.message || "Invalid min age override");
  }
  return result.data;
}
let syncInterval = null;
function registerCalendarHandlers() {
  electron.ipcMain.handle("calendar:sync", async () => {
    const config22 = getConfig();
    if (!config22.calendar.icsUrl) {
      return {
        success: false,
        error: "No calendar URL configured",
        meetingsCount: 0
      };
    }
    return await syncCalendar(config22.calendar.icsUrl);
  });
  electron.ipcMain.handle("calendar:get-last-sync", async () => {
    return getLastSyncTime();
  });
  electron.ipcMain.handle("calendar:set-url", async (_, url) => {
    try {
      const result = SetIcsUrlSchema.safeParse({ url });
      if (!result.success) {
        return { success: false, error: result.error.issues[0]?.message || "Invalid URL" };
      }
      await updateConfig("calendar", { icsUrl: result.data.url });
      return { success: true, data: getConfig().calendar };
    } catch (error2) {
      const message = error2 instanceof Error ? error2.message : "Unknown error";
      return { success: false, error: message };
    }
  });
  electron.ipcMain.handle("calendar:toggle-auto-sync", async (_, enabled) => {
    try {
      const result = ToggleAutoSyncSchema.safeParse({ enabled });
      if (!result.success) {
        return { success: false, error: result.error.issues[0]?.message || "Invalid enabled value" };
      }
      await updateConfig("calendar", { syncEnabled: result.data.enabled });
      if (result.data.enabled) {
        startAutoSync();
      } else {
        stopAutoSync();
      }
      return { success: true, data: getConfig().calendar };
    } catch (error2) {
      const message = error2 instanceof Error ? error2.message : "Unknown error";
      return { success: false, error: message };
    }
  });
  electron.ipcMain.handle("calendar:set-interval", async (_, minutes) => {
    try {
      const result = SetSyncIntervalSchema.safeParse({ minutes });
      if (!result.success) {
        return { success: false, error: result.error.issues[0]?.message || "Invalid interval" };
      }
      await updateConfig("calendar", { syncIntervalMinutes: result.data.minutes });
      const config22 = getConfig();
      if (config22.calendar.syncEnabled) {
        stopAutoSync();
        startAutoSync();
      }
      return { success: true, data: getConfig().calendar };
    } catch (error2) {
      const message = error2 instanceof Error ? error2.message : "Unknown error";
      return { success: false, error: message };
    }
  });
  electron.ipcMain.handle("calendar:get-settings", async () => {
    return getConfig().calendar;
  });
  const config2 = getConfig();
  if (config2.calendar.syncEnabled && config2.calendar.icsUrl) {
    startAutoSync();
  }
}
function startAutoSync() {
  stopAutoSync();
  const config2 = getConfig();
  const intervalMs = config2.calendar.syncIntervalMinutes * 60 * 1e3;
  console.log(`Starting calendar auto-sync every ${config2.calendar.syncIntervalMinutes} minutes`);
  if (config2.calendar.icsUrl) {
    syncCalendar(config2.calendar.icsUrl).catch((err) => {
      console.error("Initial calendar sync failed:", err);
    });
  }
  syncInterval = setInterval(async () => {
    const currentConfig = getConfig();
    if (currentConfig.calendar.icsUrl) {
      try {
        await syncCalendar(currentConfig.calendar.icsUrl);
      } catch (err) {
        console.error("Calendar sync failed:", err);
      }
    }
  }, intervalMs);
}
function stopAutoSync() {
  if (syncInterval) {
    clearInterval(syncInterval);
    syncInterval = null;
    console.log("Calendar auto-sync stopped");
  }
}
function registerStorageHandlers() {
  electron.ipcMain.handle("storage:get-info", async () => {
    try {
      return { success: true, data: getStorageInfo() };
    } catch (error2) {
      const message = error2 instanceof Error ? error2.message : "Unknown error";
      return { success: false, error: message };
    }
  });
  electron.ipcMain.handle("storage:open-folder", async (_, folder) => {
    try {
      const result = OpenFolderSchema.safeParse({ folder });
      if (!result.success) {
        return { success: false, error: result.error.issues[0]?.message || "Invalid folder type" };
      }
      let path2;
      switch (result.data.folder) {
        case "recordings":
          path2 = getRecordingsPath();
          break;
        case "transcripts":
          path2 = getTranscriptsPath();
          break;
        case "data":
          path2 = getStorageInfo().dataPath;
          break;
      }
      await electron.shell.openPath(path2);
      return { success: true, data: true };
    } catch (error2) {
      const message = error2 instanceof Error ? error2.message : "Unknown error";
      return { success: false, error: message };
    }
  });
  electron.ipcMain.handle("storage:read-recording", async (_, filePath) => {
    try {
      const result = ReadRecordingFileSchema.safeParse({ filePath });
      if (!result.success) {
        return { success: false, error: result.error.issues[0]?.message || "Invalid file path" };
      }
      const buffer = readRecordingFile(result.data.filePath);
      if (buffer) {
        return { success: true, data: buffer.toString("base64") };
      }
      return { success: false, error: "File not found" };
    } catch (error2) {
      const message = error2 instanceof Error ? error2.message : "Unknown error";
      return { success: false, error: message };
    }
  });
  electron.ipcMain.handle("storage:delete-recording", async (_, filePath) => {
    try {
      const result = DeleteRecordingFileSchema.safeParse({ filePath });
      if (!result.success) {
        return { success: false, error: result.error.issues[0]?.message || "Invalid file path" };
      }
      const deleted = deleteRecording(result.data.filePath);
      return { success: true, data: deleted };
    } catch (error2) {
      const message = error2 instanceof Error ? error2.message : "Unknown error";
      return { success: false, error: message };
    }
  });
  electron.ipcMain.handle("storage:save-recording", async (_, filename, data) => {
    try {
      const result = SaveRecordingSchema.safeParse({ filename, data });
      if (!result.success) {
        return { success: false, error: result.error.issues[0]?.message || "Invalid save recording request" };
      }
      const buffer = Buffer.from(result.data.data);
      const filePath = await saveRecording(result.data.filename, buffer);
      const dateMatch = result.data.filename.match(/^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})/);
      let dateRecorded;
      if (dateMatch) {
        const [, year, month, day, hour, minute, second] = dateMatch;
        dateRecorded = `${year}-${month}-${day}T${hour}:${minute}:${second}`;
      } else {
        dateRecorded = (/* @__PURE__ */ new Date()).toISOString();
      }
      const recordingId = `rec_${result.data.filename.replace(/[^a-zA-Z0-9]/g, "_")}`;
      const recording = {
        id: recordingId,
        filename: result.data.filename,
        original_filename: result.data.filename,
        file_path: filePath,
        file_size: buffer.length,
        duration_seconds: void 0,
        // Will be calculated after processing
        date_recorded: dateRecorded,
        meeting_id: void 0,
        correlation_confidence: void 0,
        correlation_method: void 0,
        status: "pending"
      };
      insertRecording(recording);
      const recordingDate = new Date(dateRecorded);
      const startRange = new Date(recordingDate.getTime() - 2 * 60 * 60 * 1e3);
      const endRange = new Date(recordingDate.getTime() + 2 * 60 * 60 * 1e3);
      const meetings = getMeetings(startRange.toISOString(), endRange.toISOString());
      for (const meeting of meetings) {
        const meetingStart = new Date(meeting.start_time);
        const meetingEnd = new Date(meeting.end_time);
        if (recordingDate >= meetingStart && recordingDate <= meetingEnd) {
          linkRecordingToMeeting(recordingId, meeting.id, 0.9, "time_overlap");
          break;
        }
      }
      addToQueue(recordingId);
      addSyncedFile(result.data.filename, result.data.filename, filePath, buffer.length);
      console.log(`Recording saved and queued for transcription: ${result.data.filename}`);
      return { success: true, data: filePath };
    } catch (error2) {
      const message = error2 instanceof Error ? error2.message : "Unknown error";
      return { success: false, error: message };
    }
  });
}
const AUDIO_EXTENSIONS = [".wav", ".mp3", ".m4a", ".ogg", ".webm", ".hda"];
let watcher = null;
let mainWindow$2 = null;
let isWatching = false;
function setMainWindow(win) {
  mainWindow$2 = win;
}
function startRecordingWatcher() {
  if (isWatching) {
    console.log("Recording watcher already running");
    return;
  }
  const recordingsPath = getRecordingsPath();
  if (!fs.existsSync(recordingsPath)) {
    console.log("Recordings path does not exist:", recordingsPath);
    return;
  }
  console.log("Starting recording watcher at:", recordingsPath);
  scanExistingRecordings();
  watcher = fs.watch(recordingsPath, { persistent: true }, (eventType, filename) => {
    if (eventType === "rename" && filename) {
      const ext = path.extname(filename).toLowerCase();
      if (AUDIO_EXTENSIONS.includes(ext)) {
        const filePath = path.join(recordingsPath, filename);
        setTimeout(() => {
          if (fs.existsSync(filePath)) {
            processNewRecording(filePath);
          }
        }, 1e3);
      }
    }
  });
  isWatching = true;
  console.log("Recording watcher started");
}
function stopRecordingWatcher() {
  if (watcher) {
    watcher.close();
    watcher = null;
    isWatching = false;
    console.log("Recording watcher stopped");
  }
}
async function scanExistingRecordings() {
  const recordingsPath = getRecordingsPath();
  if (!fs.existsSync(recordingsPath)) return;
  const files = fs.readdirSync(recordingsPath);
  for (const file of files) {
    const ext = path.extname(file).toLowerCase();
    if (!AUDIO_EXTENSIONS.includes(ext)) continue;
    const filePath = path.join(recordingsPath, file);
    const recordingId = generateRecordingId(filePath);
    const existing = getRecordingById(recordingId);
    if (!existing) {
      await processNewRecording(filePath);
    }
  }
}
function generateRecordingId(filePath) {
  const filename = path.basename(filePath);
  return `rec_${filename.replace(/[^a-zA-Z0-9]/g, "_")}`;
}
async function processNewRecording(filePath) {
  try {
    const filename = path.basename(filePath);
    const stats = fs.statSync(filePath);
    const recordingId = generateRecordingId(filePath);
    const existing = getRecordingById(recordingId);
    if (existing) {
      console.log("Recording already in database:", filename);
      return;
    }
    console.log("Processing new recording:", filename);
    const dateMatch = filename.match(/^(\d{4}-\d{2}-\d{2})_(\d{4})/);
    let dateRecorded;
    if (dateMatch) {
      const [, date, time] = dateMatch;
      const hours = time.slice(0, 2);
      const minutes = time.slice(2, 4);
      dateRecorded = `${date}T${hours}:${minutes}:00`;
    } else {
      dateRecorded = stats.mtime.toISOString();
    }
    const recording = {
      id: recordingId,
      filename,
      original_filename: filename,
      file_path: filePath,
      file_size: stats.size,
      duration_seconds: void 0,
      // Will be updated after processing
      date_recorded: dateRecorded,
      meeting_id: void 0,
      correlation_confidence: void 0,
      correlation_method: void 0,
      status: "pending"
    };
    insertRecording(recording);
    console.log("Recording added to database:", recordingId);
    correlateWithMeeting(recordingId, new Date(dateRecorded));
    addToQueue(recordingId);
    console.log("Recording added to transcription queue:", recordingId);
    notifyRenderer$1("recording:new", { recording });
  } catch (error2) {
    console.error("Error processing recording:", error2);
  }
}
function correlateWithMeeting(recordingId, recordingDate) {
  try {
    const startRange = new Date(recordingDate.getTime() - 2 * 60 * 60 * 1e3);
    const endRange = new Date(recordingDate.getTime() + 2 * 60 * 60 * 1e3);
    const meetings = getMeetings(startRange.toISOString(), endRange.toISOString());
    if (meetings.length === 0) {
      console.log("No meetings found for correlation");
      return;
    }
    let bestMatch = null;
    for (const meeting of meetings) {
      const meetingStart = new Date(meeting.start_time);
      const meetingEnd = new Date(meeting.end_time);
      if (recordingDate >= meetingStart && recordingDate <= meetingEnd) {
        const confidence = 0.9;
        if (!bestMatch || confidence > bestMatch.confidence) {
          bestMatch = {
            meetingId: meeting.id,
            confidence,
            method: "time_overlap"
          };
        }
      } else {
        const timeDiff = Math.min(
          Math.abs(recordingDate.getTime() - meetingStart.getTime()),
          Math.abs(recordingDate.getTime() - meetingEnd.getTime())
        );
        if (timeDiff <= 15 * 60 * 1e3) {
          const confidence = 0.7 - timeDiff / (30 * 60 * 1e3) * 0.3;
          if (!bestMatch || confidence > bestMatch.confidence) {
            bestMatch = {
              meetingId: meeting.id,
              confidence,
              method: "time_proximity"
            };
          }
        }
      }
    }
    if (bestMatch && bestMatch.confidence >= 0.5) {
      linkRecordingToMeeting(
        recordingId,
        bestMatch.meetingId,
        bestMatch.confidence,
        bestMatch.method
      );
      console.log(
        `Linked recording ${recordingId} to meeting ${bestMatch.meetingId} (confidence: ${bestMatch.confidence})`
      );
    }
  } catch (error2) {
    console.error("Error correlating recording with meeting:", error2);
  }
}
function notifyRenderer$1(channel, data) {
  if (mainWindow$2 && !mainWindow$2.isDestroyed()) {
    mainWindow$2.webContents.send(channel, data);
  }
}
function getWatcherStatus() {
  return {
    isWatching,
    path: getRecordingsPath()
  };
}
const OLLAMA_BASE_URL = "http://localhost:11434";
const EMBEDDING_MODEL = "nomic-embed-text";
const CHAT_MODEL = "llama3.2";
class OllamaService {
  baseUrl;
  embeddingModel;
  chatModel;
  constructor(baseUrl = OLLAMA_BASE_URL, embeddingModel = EMBEDDING_MODEL, chatModel = CHAT_MODEL) {
    this.baseUrl = baseUrl;
    this.embeddingModel = embeddingModel;
    this.chatModel = chatModel;
  }
  async isAvailable() {
    try {
      const response = await fetch(`${this.baseUrl}/api/tags`);
      return response.ok;
    } catch {
      return false;
    }
  }
  async listModels() {
    try {
      const response = await fetch(`${this.baseUrl}/api/tags`);
      if (!response.ok) return [];
      const data = await response.json();
      return data.models?.map((m) => m.name) || [];
    } catch {
      return [];
    }
  }
  async hasModel(modelName) {
    const models = await this.listModels();
    return models.some((m) => m.startsWith(modelName));
  }
  async pullModel(modelName) {
    try {
      const response = await fetch(`${this.baseUrl}/api/pull`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: modelName, stream: false })
      });
      return response.ok;
    } catch {
      return false;
    }
  }
  async ensureModels() {
    const hasEmbedding = await this.hasModel(this.embeddingModel);
    const hasChat = await this.hasModel(this.chatModel);
    const results = { embedding: hasEmbedding, chat: hasChat };
    if (!hasEmbedding) {
      console.log(`Pulling embedding model: ${this.embeddingModel}`);
      results.embedding = await this.pullModel(this.embeddingModel);
    }
    if (!hasChat) {
      console.log(`Pulling chat model: ${this.chatModel}`);
      results.chat = await this.pullModel(this.chatModel);
    }
    return results;
  }
  async generateEmbedding(text) {
    try {
      const response = await fetch(`${this.baseUrl}/api/embeddings`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: this.embeddingModel,
          prompt: text
        })
      });
      if (!response.ok) {
        console.error("Ollama embedding error:", response.statusText);
        return null;
      }
      const data = await response.json();
      return data.embedding;
    } catch (error2) {
      console.error("Failed to generate embedding:", error2);
      return null;
    }
  }
  async generateEmbeddings(texts) {
    const embeddings = [];
    for (const text of texts) {
      const embedding = await this.generateEmbedding(text);
      embeddings.push(embedding);
    }
    return embeddings;
  }
  async chat(messages, options = {}) {
    try {
      const fullMessages = [...messages];
      if (options.systemPrompt) {
        fullMessages.unshift({ role: "system", content: options.systemPrompt });
      }
      const response = await fetch(`${this.baseUrl}/api/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: this.chatModel,
          messages: fullMessages,
          stream: false,
          options: {
            temperature: options.temperature ?? 0.7,
            num_predict: options.maxTokens ?? 1024
          }
        })
      });
      if (!response.ok) {
        console.error("Ollama chat error:", response.statusText);
        return null;
      }
      const data = await response.json();
      return data.message.content;
    } catch (error2) {
      console.error("Failed to chat with Ollama:", error2);
      return null;
    }
  }
  async generate(prompt, systemPrompt) {
    return this.chat([{ role: "user", content: prompt }], { systemPrompt });
  }
}
let ollamaInstance = null;
function getOllamaService() {
  if (!ollamaInstance) {
    ollamaInstance = new OllamaService();
  }
  return ollamaInstance;
}
function cosineSimilarity(a, b) {
  if (a.length !== b.length) return 0;
  let dotProduct = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    dotProduct += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  const denominator = Math.sqrt(normA) * Math.sqrt(normB);
  return denominator === 0 ? 0 : dotProduct / denominator;
}
function chunkText(text, chunkSize = 500, overlap = 50) {
  const chunks = [];
  const sentences = text.split(/[.!?]+/).filter((s) => s.trim().length > 0);
  let currentChunk = "";
  for (const sentence of sentences) {
    const trimmed = sentence.trim();
    if (currentChunk.length + trimmed.length > chunkSize && currentChunk.length > 0) {
      chunks.push(currentChunk.trim());
      const words = currentChunk.split(" ");
      const overlapWords = words.slice(-Math.ceil(overlap / 10));
      currentChunk = overlapWords.join(" ") + " " + trimmed;
    } else {
      currentChunk += (currentChunk.length > 0 ? ". " : "") + trimmed;
    }
  }
  if (currentChunk.trim().length > 0) {
    chunks.push(currentChunk.trim());
  }
  return chunks;
}
class VectorStore {
  documents = /* @__PURE__ */ new Map();
  initialized = false;
  async initialize() {
    if (this.initialized) return;
    const db2 = getDatabase();
    db2.run(`
      CREATE TABLE IF NOT EXISTS vector_embeddings (
        id TEXT PRIMARY KEY,
        content TEXT NOT NULL,
        embedding TEXT NOT NULL,
        meeting_id TEXT,
        recording_id TEXT,
        chunk_index INTEGER,
        timestamp TEXT,
        subject TEXT,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP
      )
    `);
    db2.run(`CREATE INDEX IF NOT EXISTS idx_vector_embeddings_meeting ON vector_embeddings(meeting_id)`);
    db2.run(`CREATE INDEX IF NOT EXISTS idx_vector_embeddings_recording ON vector_embeddings(recording_id)`);
    await this.loadFromDatabase();
    this.initialized = true;
    console.log(`Vector store initialized with ${this.documents.size} documents`);
  }
  async loadFromDatabase() {
    const db2 = getDatabase();
    const rows = db2.exec("SELECT * FROM vector_embeddings");
    if (rows.length === 0) return;
    const columns = rows[0].columns;
    for (const row of rows[0].values) {
      const doc = {};
      columns.forEach((col, i) => {
        doc[col] = row[i];
      });
      const vectorDoc = {
        id: doc["id"],
        content: doc["content"],
        embedding: JSON.parse(doc["embedding"]),
        metadata: {
          meetingId: doc["meeting_id"],
          recordingId: doc["recording_id"],
          chunkIndex: doc["chunk_index"],
          timestamp: doc["timestamp"],
          subject: doc["subject"]
        }
      };
      this.documents.set(vectorDoc.id, vectorDoc);
    }
  }
  async addDocument(content, metadata) {
    const ollama = getOllamaService();
    const embedding = await ollama.generateEmbedding(content);
    if (!embedding) {
      console.error("Failed to generate embedding for document");
      return null;
    }
    const id = `${metadata.recordingId || "doc"}_${metadata.chunkIndex}_${Date.now()}`;
    const doc = {
      id,
      content,
      embedding,
      metadata
    };
    this.documents.set(id, doc);
    const db2 = getDatabase();
    db2.run(
      `INSERT OR REPLACE INTO vector_embeddings
       (id, content, embedding, meeting_id, recording_id, chunk_index, timestamp, subject)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        id,
        content,
        JSON.stringify(embedding),
        metadata.meetingId || null,
        metadata.recordingId || null,
        metadata.chunkIndex,
        metadata.timestamp || null,
        metadata.subject || null
      ]
    );
    return id;
  }
  async indexTranscript(transcript, metadata) {
    if (metadata.recordingId) {
      const existing = Array.from(this.documents.values()).filter(
        (d) => d.metadata.recordingId === metadata.recordingId
      );
      if (existing.length > 0) {
        console.log(`Transcript ${metadata.recordingId} already indexed`);
        return 0;
      }
    }
    const chunks = chunkText(transcript);
    let indexed = 0;
    for (let i = 0; i < chunks.length; i++) {
      const chunk = chunks[i];
      const id = await this.addDocument(chunk, {
        ...metadata,
        chunkIndex: i
      });
      if (id) indexed++;
    }
    console.log(`Indexed ${indexed} chunks for transcript`);
    return indexed;
  }
  async search(query, topK = 5) {
    const ollama = getOllamaService();
    const queryEmbedding = await ollama.generateEmbedding(query);
    if (!queryEmbedding) {
      console.error("Failed to generate query embedding");
      return [];
    }
    const results = [];
    for (const doc of this.documents.values()) {
      const score = cosineSimilarity(queryEmbedding, doc.embedding);
      results.push({ document: doc, score });
    }
    results.sort((a, b) => b.score - a.score);
    return results.slice(0, topK);
  }
  async searchByMeeting(meetingId) {
    return Array.from(this.documents.values()).filter((d) => d.metadata.meetingId === meetingId).sort((a, b) => a.metadata.chunkIndex - b.metadata.chunkIndex);
  }
  async deleteByRecording(recordingId) {
    let deleted = 0;
    const db2 = getDatabase();
    for (const [id, doc] of this.documents.entries()) {
      if (doc.metadata.recordingId === recordingId) {
        this.documents.delete(id);
        deleted++;
      }
    }
    db2.run("DELETE FROM vector_embeddings WHERE recording_id = ?", [recordingId]);
    return deleted;
  }
  getDocumentCount() {
    return this.documents.size;
  }
  getMeetingCount() {
    const meetingIds = /* @__PURE__ */ new Set();
    for (const doc of this.documents.values()) {
      if (doc.metadata.meetingId) {
        meetingIds.add(doc.metadata.meetingId);
      }
    }
    return meetingIds.size;
  }
  getAllDocuments() {
    return Array.from(this.documents.values());
  }
}
let vectorStoreInstance = null;
function getVectorStore() {
  if (!vectorStoreInstance) {
    vectorStoreInstance = new VectorStore();
  }
  return vectorStoreInstance;
}
let mainWindow$1 = null;
let isProcessing = false;
let processingInterval = null;
function setMainWindowForTranscription(win) {
  mainWindow$1 = win;
}
function startTranscriptionProcessor() {
  if (processingInterval) {
    console.log("Transcription processor already running");
    return;
  }
  console.log("Starting transcription processor");
  processingInterval = setInterval(() => {
    processQueue();
  }, 1e4);
  processQueue();
}
function stopTranscriptionProcessor() {
  if (processingInterval) {
    clearInterval(processingInterval);
    processingInterval = null;
    console.log("Transcription processor stopped");
  }
}
async function processQueue() {
  if (isProcessing) return;
  const config2 = getConfig();
  if (!config2.transcription.geminiApiKey) {
    return;
  }
  const pendingItems = getQueueItems("pending");
  if (pendingItems.length === 0) return;
  isProcessing = true;
  for (const item of pendingItems) {
    try {
      updateQueueItem(item.id, "processing");
      notifyRenderer("transcription:started", { queueItemId: item.id, recordingId: item.recording_id });
      await transcribeRecording(item.recording_id);
      updateQueueItem(item.id, "completed");
      notifyRenderer("transcription:completed", { queueItemId: item.id, recordingId: item.recording_id });
    } catch (error2) {
      const errorMessage = error2 instanceof Error ? error2.message : "Unknown error";
      console.error("Transcription failed:", errorMessage);
      updateQueueItem(item.id, "failed", errorMessage);
      notifyRenderer("transcription:failed", {
        queueItemId: item.id,
        recordingId: item.recording_id,
        error: errorMessage
      });
      if (item.attempts >= 3) {
        console.log(`Recording ${item.recording_id} failed after ${item.attempts} attempts`);
      }
    }
  }
  isProcessing = false;
}
async function transcribeRecording(recordingId) {
  const recording = getRecordingById(recordingId);
  if (!recording) {
    throw new Error(`Recording not found: ${recordingId}`);
  }
  if (!fs.existsSync(recording.file_path)) {
    throw new Error(`Recording file not found: ${recording.file_path}`);
  }
  const config2 = getConfig();
  if (!config2.transcription.geminiApiKey) {
    throw new Error("Gemini API key not configured");
  }
  console.log(`Transcribing: ${recording.filename}`);
  updateRecordingStatus(recordingId, "transcribing");
  const audioBuffer = fs.readFileSync(recording.file_path);
  const base64Audio = audioBuffer.toString("base64");
  const ext = path.extname(recording.file_path).toLowerCase();
  const mimeTypes = {
    ".wav": "audio/wav",
    ".mp3": "audio/mp3",
    ".m4a": "audio/mp4",
    ".ogg": "audio/ogg",
    ".webm": "audio/webm",
    ".hda": "audio/wav"
    // HiDock Audio format - treat as WAV
  };
  const mimeType = mimeTypes[ext] || "audio/wav";
  const genAI = new generativeAi.GoogleGenerativeAI(config2.transcription.geminiApiKey);
  const model = genAI.getGenerativeModel({ model: config2.transcription.geminiModel || "gemini-2.0-flash-exp" });
  const candidateMeetings = findCandidateMeetingsForRecording(recordingId);
  console.log(`Found ${candidateMeetings.length} candidate meetings for recording ${recordingId}`);
  let meetingContext = "";
  if (candidateMeetings.length > 0) {
    meetingContext = `

POSSIBLE MEETING CONTEXT (use this to improve transcription accuracy):
${candidateMeetings.map((m, i) => `
Meeting ${i + 1}: "${m.subject}"
  Time: ${new Date(m.start_time).toLocaleString()} - ${new Date(m.end_time).toLocaleString()}
  ${m.organizer_name ? `Organizer: ${m.organizer_name}` : ""}
  ${m.location ? `Location: ${m.location}` : ""}
  ${m.description ? `Description: ${m.description.slice(0, 200)}...` : ""}
`).join("\n")}`;
  }
  const transcriptionPrompt = `Transcribe this audio recording.
The audio may be in Spanish or English - transcribe in the original language.
Provide a clean, accurate transcription of all speech.
If there are multiple speakers, try to indicate speaker changes with "Speaker 1:", "Speaker 2:", etc.
${meetingContext}
Return ONLY the transcription, no additional commentary.`;
  const transcriptionResult = await model.generateContent([
    {
      inlineData: {
        mimeType,
        data: base64Audio
      }
    },
    { text: transcriptionPrompt }
  ]);
  const fullText = transcriptionResult.response.text();
  let meetingSelectionSection = "";
  if (candidateMeetings.length > 1) {
    meetingSelectionSection = `
5. IMPORTANT - Meeting Selection: Based on the transcript content, determine which meeting this recording most likely belongs to.
   Analyze mentions of topics, people, projects, or context clues to select the best match.

   Available meetings:
${candidateMeetings.map((m, i) => `   ${i + 1}. "${m.subject}" (ID: ${m.id})`).join("\n")}

   Include in your response:
   "selected_meeting_id": "the meeting ID that best matches",
   "meeting_confidence": 0.0 to 1.0 (how confident you are),
   "selection_reason": "why you selected this meeting"`;
  } else if (candidateMeetings.length === 1) {
    meetingSelectionSection = `
5. Meeting Match: This recording appears to be from the meeting "${candidateMeetings[0].subject}".
   Verify this makes sense based on the content.
   "selected_meeting_id": "${candidateMeetings[0].id}",
   "meeting_confidence": 0.0 to 1.0,
   "selection_reason": "your reasoning"`;
  }
  const analysisPrompt = `Analyze this meeting transcript and provide:
1. A brief summary (2-3 sentences)
2. A list of action items mentioned (as a JSON array of strings)
3. Key topics discussed (as a JSON array of strings)
4. Key points or decisions made (as a JSON array of strings)
${meetingSelectionSection}

Transcript:
${fullText}

Respond in JSON format:
{
  "summary": "...",
  "action_items": ["...", "..."],
  "topics": ["...", "..."],
  "key_points": ["...", "..."],
  "language": "es" or "en"${candidateMeetings.length > 0 ? `,
  "selected_meeting_id": "...",
  "meeting_confidence": 0.0,
  "selection_reason": "..."` : ""}
}`;
  const analysisResult = await model.generateContent(analysisPrompt);
  const analysisText = analysisResult.response.text();
  let analysis = {};
  try {
    const jsonMatch = analysisText.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      analysis = JSON.parse(jsonMatch[0]);
    }
  } catch (e) {
    console.warn("Failed to parse analysis JSON:", e);
    analysis = { summary: "Analysis failed", language: "unknown" };
  }
  if (candidateMeetings.length > 0) {
    for (const meeting of candidateMeetings) {
      const isSelected = analysis.selected_meeting_id === meeting.id;
      const confidence = isSelected ? analysis.meeting_confidence || 0.5 : 0.1;
      const reason = isSelected ? analysis.selection_reason || "Time overlap" : "Time overlap only";
      addRecordingMeetingCandidate(recordingId, meeting.id, confidence, reason, isSelected);
    }
    if (analysis.selected_meeting_id) {
      const selectedMeeting = candidateMeetings.find((m) => m.id === analysis.selected_meeting_id);
      if (selectedMeeting) {
        linkRecordingToMeeting(
          recordingId,
          selectedMeeting.id,
          analysis.meeting_confidence || 0.5,
          "ai_transcript_match"
        );
        console.log(`AI matched recording to meeting: "${selectedMeeting.subject}" (confidence: ${analysis.meeting_confidence})`);
      }
    }
  }
  const wordCount = fullText.split(/\s+/).filter((w) => w.length > 0).length;
  const transcript = {
    id: `trans_${recordingId}`,
    recording_id: recordingId,
    full_text: fullText,
    language: analysis.language || "unknown",
    summary: analysis.summary,
    action_items: analysis.action_items ? JSON.stringify(analysis.action_items) : void 0,
    topics: analysis.topics ? JSON.stringify(analysis.topics) : void 0,
    key_points: analysis.key_points ? JSON.stringify(analysis.key_points) : void 0,
    word_count: wordCount,
    transcription_provider: "gemini",
    transcription_model: "gemini-2.0-flash-exp"
  };
  insertTranscript(transcript);
  updateRecordingStatus(recordingId, "transcribed");
  try {
    const vectorStore = getVectorStore();
    const meetingId = recording.meeting_id;
    let meetingSubject;
    if (meetingId) {
      const meeting = getMeetingById(meetingId);
      meetingSubject = meeting?.subject;
    }
    const indexedCount = await vectorStore.indexTranscript(fullText, {
      meetingId: meetingId || void 0,
      recordingId,
      timestamp: recording.created_at,
      subject: meetingSubject
    });
    console.log(`Indexed ${indexedCount} chunks into vector store`);
  } catch (e) {
    console.warn("Failed to index transcript into vector store:", e);
  }
  console.log(`Transcription complete: ${recording.filename} (${wordCount} words)`);
}
async function transcribeManually(recordingId) {
  try {
    notifyRenderer("transcription:started", { recordingId });
    await transcribeRecording(recordingId);
    notifyRenderer("transcription:completed", { recordingId });
  } catch (error2) {
    const errorMessage = error2 instanceof Error ? error2.message : "Unknown error";
    notifyRenderer("transcription:failed", { recordingId, error: errorMessage });
    throw error2;
  }
}
function getTranscriptionStatus() {
  const pending = getQueueItems("pending");
  const processing = getQueueItems("processing");
  return {
    isProcessing,
    pendingCount: pending.length,
    processingCount: processing.length
  };
}
function notifyRenderer(channel, data) {
  if (mainWindow$1 && !mainWindow$1.isDestroyed()) {
    mainWindow$1.webContents.send(channel, data);
  }
}
function registerRecordingHandlers() {
  electron.ipcMain.handle("recordings:getAll", async () => {
    try {
      return getRecordings();
    } catch (error2) {
      console.error("recordings:getAll error:", error2);
      return [];
    }
  });
  electron.ipcMain.handle("recordings:getById", async (_, id) => {
    try {
      const result = GetRecordingByIdSchema.safeParse({ id });
      if (!result.success) {
        console.error("recordings:getById validation error:", result.error);
        return void 0;
      }
      return getRecordingById(result.data.id);
    } catch (error2) {
      console.error("recordings:getById error:", error2);
      return void 0;
    }
  });
  electron.ipcMain.handle(
    "recordings:getForMeeting",
    async (_, meetingId) => {
      try {
        const result = GetRecordingByIdSchema.safeParse({ id: meetingId });
        if (!result.success) {
          console.error("recordings:getForMeeting validation error:", result.error);
          return [];
        }
        const recordings = getRecordingsForMeeting(result.data.id);
        return recordings.map((recording) => ({
          ...recording,
          transcript: getTranscriptByRecordingId(recording.id)
        }));
      } catch (error2) {
        console.error("recordings:getForMeeting error:", error2);
        return [];
      }
    }
  );
  electron.ipcMain.handle("recordings:getAllWithTranscripts", async () => {
    try {
      const recordings = getRecordings();
      return recordings.map((recording) => ({
        ...recording,
        transcript: getTranscriptByRecordingId(recording.id)
      }));
    } catch (error2) {
      console.error("recordings:getAllWithTranscripts error:", error2);
      return [];
    }
  });
  electron.ipcMain.handle("recordings:delete", async (_, id) => {
    try {
      const result = DeleteRecordingSchema.safeParse({ id });
      if (!result.success) {
        console.error("recordings:delete validation error:", result.error);
        return false;
      }
      const recording = getRecordingById(result.data.id);
      if (recording) {
        const deleted = deleteRecording(recording.file_path);
        if (deleted) {
          updateRecordingStatus(result.data.id, "deleted");
        }
        return deleted;
      }
      return false;
    } catch (error2) {
      console.error("recordings:delete error:", error2);
      return false;
    }
  });
  electron.ipcMain.handle(
    "recordings:linkToMeeting",
    async (_, recordingId, meetingId) => {
      try {
        const result = LinkRecordingToMeetingSchema.safeParse({ recordingId, meetingId });
        if (!result.success) {
          console.error("recordings:linkToMeeting validation error:", result.error);
          throw new Error(result.error.issues[0]?.message || "Invalid request");
        }
        linkRecordingToMeeting(result.data.recordingId, result.data.meetingId, 1, "manual");
      } catch (error2) {
        console.error("recordings:linkToMeeting error:", error2);
        throw error2;
      }
    }
  );
  electron.ipcMain.handle("recordings:unlinkFromMeeting", async (_, recordingId) => {
    try {
      const result = UnlinkRecordingFromMeetingSchema.safeParse({ recordingId });
      if (!result.success) {
        console.error("recordings:unlinkFromMeeting validation error:", result.error);
        throw new Error(result.error.issues[0]?.message || "Invalid request");
      }
      linkRecordingToMeeting(result.data.recordingId, "", 0, "");
    } catch (error2) {
      console.error("recordings:unlinkFromMeeting error:", error2);
      throw error2;
    }
  });
  electron.ipcMain.handle(
    "recordings:getTranscript",
    async (_, recordingId) => {
      try {
        const result = GetRecordingByIdSchema.safeParse({ id: recordingId });
        if (!result.success) {
          console.error("recordings:getTranscript validation error:", result.error);
          return void 0;
        }
        return getTranscriptByRecordingId(result.data.id);
      } catch (error2) {
        console.error("recordings:getTranscript error:", error2);
        return void 0;
      }
    }
  );
  electron.ipcMain.handle("recordings:transcribe", async (_, recordingId) => {
    try {
      const result = TranscribeRecordingSchema.safeParse({ recordingId });
      if (!result.success) {
        console.error("recordings:transcribe validation error:", result.error);
        throw new Error(result.error.issues[0]?.message || "Invalid request");
      }
      await transcribeManually(result.data.recordingId);
    } catch (error2) {
      console.error("recordings:transcribe error:", error2);
      throw error2;
    }
  });
  electron.ipcMain.handle(
    "recordings:getWatcherStatus",
    async () => {
      return getWatcherStatus();
    }
  );
  electron.ipcMain.handle("recordings:startWatcher", async () => {
    startRecordingWatcher();
  });
  electron.ipcMain.handle("recordings:stopWatcher", async () => {
    stopRecordingWatcher();
  });
  electron.ipcMain.handle(
    "recordings:getTranscriptionStatus",
    async () => {
      return getTranscriptionStatus();
    }
  );
  electron.ipcMain.handle("recordings:startTranscriptionProcessor", async () => {
    startTranscriptionProcessor();
  });
  electron.ipcMain.handle("recordings:stopTranscriptionProcessor", async () => {
    stopTranscriptionProcessor();
  });
  electron.ipcMain.handle("recordings:scanFolder", async () => {
    return getRecordingFiles();
  });
  console.log("Recording IPC handlers registered");
}
const SYSTEM_PROMPT = `You are a helpful meeting assistant that answers questions based on meeting transcripts.

Your capabilities:
- Summarize discussions and decisions from meetings
- Find action items and follow-ups mentioned in meetings
- Identify key topics and themes across meetings
- Answer specific questions about what was discussed

Guidelines:
- Only answer based on the meeting transcripts provided as context
- If the context doesn't contain relevant information, say so honestly
- Be concise but thorough
- Reference specific meetings when relevant
- If asked about something not in the transcripts, acknowledge the limitation

Context from meeting transcripts will be provided with each question.`;
class RAGService {
  contexts = /* @__PURE__ */ new Map();
  async isReady() {
    const ollama = getOllamaService();
    const vectorStore = getVectorStore();
    const ollamaAvailable = await ollama.isAvailable();
    if (!ollamaAvailable) {
      return { ready: false, reason: "Ollama is not running. Start Ollama to use the chat feature." };
    }
    const docCount = vectorStore.getDocumentCount();
    if (docCount === 0) {
      return {
        ready: false,
        reason: "No meeting transcripts indexed yet. Record some meetings first."
      };
    }
    return { ready: true };
  }
  async initialize() {
    const ollama = getOllamaService();
    const vectorStore = getVectorStore();
    const available = await ollama.isAvailable();
    if (!available) {
      console.log("Ollama not available, RAG service will be limited");
      return false;
    }
    const models = await ollama.ensureModels();
    if (!models.embedding || !models.chat) {
      console.log("Required Ollama models not available");
      return false;
    }
    await vectorStore.initialize();
    console.log("RAG service initialized");
    return true;
  }
  async chat(sessionId, message, meetingFilter) {
    const ollama = getOllamaService();
    const vectorStore = getVectorStore();
    let context = this.contexts.get(sessionId);
    if (!context) {
      context = { conversationHistory: [] };
      this.contexts.set(sessionId, context);
    }
    if (meetingFilter) {
      context.meetingId = meetingFilter;
    }
    let searchResults;
    if (context.meetingId) {
      const docs = await vectorStore.searchByMeeting(context.meetingId);
      const queryEmbedding = await ollama.generateEmbedding(message);
      if (queryEmbedding) {
        searchResults = docs.map((doc) => ({
          document: doc,
          score: 0.8
          // Default score for filtered results
        }));
      } else {
        searchResults = docs.map((doc) => ({ document: doc, score: 0.8 }));
      }
      searchResults = searchResults.slice(0, 5);
    } else {
      searchResults = await vectorStore.search(message, 5);
    }
    const contextParts = [];
    const sources = [];
    for (const result of searchResults) {
      if (result.score < 0.3) continue;
      const { document: doc, score } = result;
      const meetingInfo = doc.metadata.subject ? `Meeting: ${doc.metadata.subject}` : doc.metadata.meetingId ? `Meeting ID: ${doc.metadata.meetingId}` : "Unknown meeting";
      const dateInfo = doc.metadata.timestamp ? ` (${new Date(doc.metadata.timestamp).toLocaleDateString()})` : "";
      contextParts.push(`[${meetingInfo}${dateInfo}]
${doc.content}`);
      sources.push({
        content: doc.content.substring(0, 200) + (doc.content.length > 200 ? "..." : ""),
        meetingId: doc.metadata.meetingId,
        subject: doc.metadata.subject,
        timestamp: doc.metadata.timestamp,
        score
      });
    }
    const contextText = contextParts.length > 0 ? `Here are relevant excerpts from meeting transcripts:

${contextParts.join("\n\n---\n\n")}` : "No relevant meeting transcripts found for this query.";
    const userMessage = `Context:
${contextText}

Question: ${message}`;
    context.conversationHistory.push({ role: "user", content: message });
    const messages = [
      ...context.conversationHistory.slice(-6),
      // Keep last 3 exchanges
      { role: "user", content: userMessage }
    ];
    const answer = await ollama.chat(messages, {
      systemPrompt: SYSTEM_PROMPT,
      temperature: 0.7,
      maxTokens: 1024
    });
    if (!answer) {
      return {
        answer: "",
        sources: [],
        error: "Failed to generate response. Please try again."
      };
    }
    context.conversationHistory.push({ role: "assistant", content: answer });
    if (context.conversationHistory.length > 20) {
      context.conversationHistory = context.conversationHistory.slice(-10);
    }
    return { answer, sources };
  }
  async summarizeMeeting(meetingId) {
    const ollama = getOllamaService();
    const vectorStore = getVectorStore();
    const docs = await vectorStore.searchByMeeting(meetingId);
    if (docs.length === 0) {
      return null;
    }
    const transcript = docs.map((d) => d.content).join("\n\n");
    const db2 = getDatabase();
    const meetingRows = db2.exec("SELECT subject FROM meetings WHERE id = ?", [meetingId]);
    const subject = meetingRows[0]?.values[0]?.[0];
    const prompt = `Please provide a concise summary of this meeting${subject ? ` about "${subject}"` : ""}. Include:
1. Main topics discussed
2. Key decisions made
3. Action items (if any)
4. Important points or conclusions

Meeting transcript:
${transcript.substring(0, 8e3)}`;
    return ollama.generate(prompt);
  }
  async findActionItems(meetingId) {
    const ollama = getOllamaService();
    const vectorStore = getVectorStore();
    let docs;
    if (meetingId) {
      docs = await vectorStore.searchByMeeting(meetingId);
    } else {
      const results = await vectorStore.search(
        "action items tasks to-do follow up assigned responsibility deadline",
        10
      );
      docs = results.map((r) => r.document);
    }
    if (docs.length === 0) {
      return "No meeting transcripts found.";
    }
    const transcript = docs.map((d) => d.content).join("\n\n");
    const prompt = `Extract all action items, tasks, and follow-ups from these meeting transcripts. For each item include:
- What needs to be done
- Who is responsible (if mentioned)
- Deadline (if mentioned)

Format as a numbered list.

Meeting transcripts:
${transcript.substring(0, 8e3)}`;
    return ollama.generate(prompt);
  }
  clearSession(sessionId) {
    this.contexts.delete(sessionId);
  }
  getStats() {
    const vectorStore = getVectorStore();
    return {
      documentCount: vectorStore.getDocumentCount(),
      meetingCount: vectorStore.getMeetingCount(),
      sessionCount: this.contexts.size
    };
  }
}
let ragInstance = null;
function getRAGService() {
  if (!ragInstance) {
    ragInstance = new RAGService();
  }
  return ragInstance;
}
function success(data) {
  return { success: true, data };
}
function error(code, message, details) {
  return { success: false, error: { code, message, details } };
}
const UUIDSchema = zod.z.string().uuid();
const DateTimeSchema = zod.z.string().datetime({ offset: true }).or(zod.z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/));
zod.z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const NonEmptyStringSchema = zod.z.string().min(1).max(1e3);
const OptionalStringSchema = zod.z.string().max(1e4).nullable().optional();
zod.z.number().int().positive();
zod.z.number().int().nonnegative();
const PaginationSchema = zod.z.object({
  limit: zod.z.number().int().min(1).max(100).optional().default(50),
  offset: zod.z.number().int().min(0).optional().default(0)
});
const SearchPaginationSchema = PaginationSchema.extend({
  search: zod.z.string().max(200).optional()
});
const RAGFilterSchema = zod.z.discriminatedUnion("type", [
  zod.z.object({ type: zod.z.literal("none") }),
  zod.z.object({ type: zod.z.literal("meeting"), meetingId: UUIDSchema }),
  zod.z.object({ type: zod.z.literal("contact"), contactId: UUIDSchema }),
  zod.z.object({ type: zod.z.literal("project"), projectId: UUIDSchema }),
  zod.z.object({
    type: zod.z.literal("dateRange"),
    startDate: DateTimeSchema,
    endDate: DateTimeSchema
  })
]);
zod.z.object({
  sessionId: zod.z.string().min(1).max(100),
  message: zod.z.string().min(1).max(1e4),
  filter: RAGFilterSchema.optional()
});
const OutputTemplateIdSchema$1 = zod.z.enum([
  "meeting_minutes",
  "interview_feedback",
  "project_status",
  "action_items"
]);
zod.z.object({
  templateId: OutputTemplateIdSchema$1,
  meetingId: UUIDSchema.optional(),
  projectId: UUIDSchema.optional(),
  contactId: UUIDSchema.optional()
}).refine(
  (data) => data.meetingId || data.projectId || data.contactId,
  { message: "At least one of meetingId, projectId, or contactId must be provided" }
);
const MeetingStatusSchema = zod.z.enum(["all", "recorded", "transcribed"]);
zod.z.object({
  startDate: DateTimeSchema.optional(),
  endDate: DateTimeSchema.optional(),
  contactId: UUIDSchema.optional(),
  projectId: UUIDSchema.optional(),
  status: MeetingStatusSchema.optional(),
  search: zod.z.string().max(200).optional(),
  limit: zod.z.number().int().min(1).max(500).optional().default(100),
  offset: zod.z.number().int().min(0).optional().default(0)
});
function extractMeetingIdsFromFilter(filter) {
  switch (filter.type) {
    case "none":
      return void 0;
    case "meeting":
      return [filter.meetingId];
    case "contact":
      return getMeetingsForContact(filter.contactId).map((m) => m.id);
    case "project":
      return getMeetingsForProject(filter.projectId).map((m) => m.id);
    case "dateRange":
      return void 0;
    default:
      return void 0;
  }
}
function registerRAGHandlers() {
  const rag = getRAGService();
  const vectorStore = getVectorStore();
  const ollama = getOllamaService();
  electron.ipcMain.handle("rag:status", async () => {
    try {
      const ollamaAvailable = await ollama.isAvailable();
      const docCount = vectorStore.getDocumentCount();
      const meetingCount = vectorStore.getMeetingCount();
      return success({
        ollamaAvailable,
        documentCount: docCount,
        meetingCount,
        ready: ollamaAvailable && docCount > 0
      });
    } catch (err) {
      console.error("rag:status error:", err);
      return error("INTERNAL_ERROR", "Failed to get RAG status", err);
    }
  });
  electron.ipcMain.handle(
    "rag:chat",
    async (_event, request) => {
      try {
        if (!request || typeof request !== "object") {
          return error("VALIDATION_ERROR", "Invalid request");
        }
        const { sessionId, message, filter } = request;
        if (!sessionId || typeof sessionId !== "string") {
          return error("VALIDATION_ERROR", "Session ID is required");
        }
        if (!message || typeof message !== "string") {
          return error("VALIDATION_ERROR", "Message is required");
        }
        let meetingFilter;
        if (filter) {
          const parsedFilter = RAGFilterSchema.safeParse(filter);
          if (!parsedFilter.success) {
            return error("VALIDATION_ERROR", "Invalid filter", parsedFilter.error.format());
          }
          const meetingIds = extractMeetingIdsFromFilter(parsedFilter.data);
          if (meetingIds && meetingIds.length > 0) {
            meetingFilter = meetingIds[0];
          }
        }
        const response = await rag.chat(sessionId, message, meetingFilter);
        if (response.error) {
          return error("INTERNAL_ERROR", response.error);
        }
        return success({
          answer: response.answer,
          sources: response.sources
        });
      } catch (err) {
        console.error("rag:chat error:", err);
        return error("INTERNAL_ERROR", "Failed to process chat message", err);
      }
    }
  );
  electron.ipcMain.handle(
    "rag:chat-legacy",
    async (_event, { sessionId, message, meetingFilter }) => {
      return rag.chat(sessionId, message, meetingFilter);
    }
  );
  electron.ipcMain.handle("rag:summarize-meeting", async (_event, meetingId) => {
    try {
      if (!meetingId || typeof meetingId !== "string") {
        return error("VALIDATION_ERROR", "Meeting ID is required");
      }
      const summary = await rag.summarizeMeeting(meetingId);
      if (!summary) {
        return error("NOT_FOUND", "No transcripts found for this meeting");
      }
      return success(summary);
    } catch (err) {
      console.error("rag:summarize-meeting error:", err);
      return error("INTERNAL_ERROR", "Failed to summarize meeting", err);
    }
  });
  electron.ipcMain.handle("rag:find-action-items", async (_event, meetingId) => {
    try {
      const actionItems = await rag.findActionItems(meetingId);
      if (!actionItems) {
        return error("NOT_FOUND", "No action items found");
      }
      return success(actionItems);
    } catch (err) {
      console.error("rag:find-action-items error:", err);
      return error("INTERNAL_ERROR", "Failed to find action items", err);
    }
  });
  electron.ipcMain.handle("rag:clear-session", async (_event, sessionId) => {
    try {
      if (!sessionId || typeof sessionId !== "string") {
        return error("VALIDATION_ERROR", "Session ID is required");
      }
      rag.clearSession(sessionId);
      return success(void 0);
    } catch (err) {
      console.error("rag:clear-session error:", err);
      return error("INTERNAL_ERROR", "Failed to clear session", err);
    }
  });
  electron.ipcMain.handle("rag:stats", async () => {
    return rag.getStats();
  });
  electron.ipcMain.handle(
    "rag:index-transcript",
    async (_event, {
      transcript,
      metadata
    }) => {
      const count = await vectorStore.indexTranscript(transcript, metadata);
      return { indexed: count };
    }
  );
  electron.ipcMain.handle(
    "rag:search",
    async (_event, { query, limit = 5 }) => {
      const results = await vectorStore.search(query, limit);
      return results.map((r) => ({
        content: r.document.content,
        meetingId: r.document.metadata.meetingId,
        subject: r.document.metadata.subject,
        score: r.score
      }));
    }
  );
  electron.ipcMain.handle("rag:get-chunks", async () => {
    const documents = vectorStore.getAllDocuments();
    return documents.map((doc) => ({
      id: doc.id,
      content: doc.content,
      meetingId: doc.metadata.meetingId,
      recordingId: doc.metadata.recordingId,
      chunkIndex: doc.metadata.chunkIndex,
      subject: doc.metadata.subject,
      timestamp: doc.metadata.timestamp,
      embeddingDimensions: doc.embedding.length
    }));
  });
  console.log("RAG IPC handlers registered");
}
function registerAppHandlers() {
  electron.ipcMain.handle("app:restart", async () => {
    if (utils.is.dev) {
      const windows = electron.BrowserWindow.getAllWindows();
      if (windows.length > 0) {
        windows[0].webContents.reload();
      }
    } else {
      electron.app.relaunch();
      electron.app.exit(0);
    }
  });
  electron.ipcMain.handle("app:info", async () => {
    return {
      version: electron.app.getVersion(),
      name: electron.app.getName(),
      isPackaged: electron.app.isPackaged,
      platform: process.platform
    };
  });
  console.log("App IPC handlers registered");
}
const GetContactsRequestSchema = SearchPaginationSchema;
const GetContactByIdRequestSchema = zod.z.object({
  id: UUIDSchema
});
const UpdateContactRequestSchema = zod.z.object({
  id: UUIDSchema,
  notes: OptionalStringSchema
});
const ContactRoleSchema = zod.z.enum(["organizer", "attendee"]);
zod.z.object({
  meeting_id: UUIDSchema,
  contact_id: UUIDSchema,
  role: ContactRoleSchema
});
zod.z.object({
  id: UUIDSchema,
  name: zod.z.string().min(1).max(500),
  email: zod.z.string().email().max(500).nullable().optional(),
  notes: OptionalStringSchema,
  first_seen_at: zod.z.string(),
  last_seen_at: zod.z.string(),
  meeting_count: zod.z.number().int().nonnegative().default(0)
});
function registerContactsHandlers() {
  electron.ipcMain.handle(
    "contacts:getAll",
    async (_, request) => {
      try {
        const parsed = GetContactsRequestSchema.safeParse(request ?? {});
        if (!parsed.success) {
          return error("VALIDATION_ERROR", "Invalid request parameters", parsed.error.format());
        }
        const { search, limit, offset } = parsed.data;
        const result = getContacts(search, limit, offset);
        return success(result);
      } catch (err) {
        console.error("contacts:getAll error:", err);
        return error("DATABASE_ERROR", "Failed to fetch contacts", err);
      }
    }
  );
  electron.ipcMain.handle(
    "contacts:getById",
    async (_, id) => {
      try {
        const parsed = GetContactByIdRequestSchema.safeParse({ id });
        if (!parsed.success) {
          return error("VALIDATION_ERROR", "Invalid contact ID", parsed.error.format());
        }
        const contact = getContactById(parsed.data.id);
        if (!contact) {
          return error("NOT_FOUND", `Contact with ID ${parsed.data.id} not found`);
        }
        const meetings = getMeetingsForContact(parsed.data.id);
        let totalMeetingTimeMinutes = 0;
        for (const meeting of meetings) {
          const start = new Date(meeting.start_time).getTime();
          const end = new Date(meeting.end_time).getTime();
          totalMeetingTimeMinutes += Math.round((end - start) / 6e4);
        }
        return success({
          contact,
          meetings,
          totalMeetingTimeMinutes
        });
      } catch (err) {
        console.error("contacts:getById error:", err);
        return error("DATABASE_ERROR", "Failed to fetch contact", err);
      }
    }
  );
  electron.ipcMain.handle(
    "contacts:update",
    async (_, request) => {
      try {
        const parsed = UpdateContactRequestSchema.safeParse(request);
        if (!parsed.success) {
          return error("VALIDATION_ERROR", "Invalid update request", parsed.error.format());
        }
        const { id, notes } = parsed.data;
        const contact = getContactById(id);
        if (!contact) {
          return error("NOT_FOUND", `Contact with ID ${id} not found`);
        }
        updateContactNotes(id, notes ?? null);
        return success({ ...contact, notes: notes ?? null });
      } catch (err) {
        console.error("contacts:update error:", err);
        return error("DATABASE_ERROR", "Failed to update contact", err);
      }
    }
  );
  electron.ipcMain.handle(
    "contacts:getForMeeting",
    async (_, meetingId) => {
      try {
        if (typeof meetingId !== "string") {
          return error("VALIDATION_ERROR", "Meeting ID must be a string");
        }
        const contacts = getContactsForMeeting(meetingId);
        return success(contacts);
      } catch (err) {
        console.error("contacts:getForMeeting error:", err);
        return error("DATABASE_ERROR", "Failed to fetch contacts for meeting", err);
      }
    }
  );
}
const GetProjectsRequestSchema = SearchPaginationSchema;
const GetProjectByIdRequestSchema = zod.z.object({
  id: UUIDSchema
});
const CreateProjectRequestSchema = zod.z.object({
  name: NonEmptyStringSchema,
  description: OptionalStringSchema
});
const UpdateProjectRequestSchema = zod.z.object({
  id: UUIDSchema,
  name: NonEmptyStringSchema.optional(),
  description: OptionalStringSchema
}).refine(
  (data) => data.name !== void 0 || data.description !== void 0,
  { message: "At least one field (name or description) must be provided" }
);
const DeleteProjectRequestSchema = zod.z.object({
  id: UUIDSchema
});
const TagMeetingRequestSchema = zod.z.object({
  meetingId: UUIDSchema,
  projectId: UUIDSchema
});
const UntagMeetingRequestSchema = zod.z.object({
  meetingId: UUIDSchema,
  projectId: UUIDSchema
});
zod.z.object({
  id: UUIDSchema,
  name: NonEmptyStringSchema,
  description: OptionalStringSchema
});
zod.z.object({
  meeting_id: UUIDSchema,
  project_id: UUIDSchema
});
function registerProjectsHandlers() {
  electron.ipcMain.handle(
    "projects:getAll",
    async (_, request) => {
      try {
        const parsed = GetProjectsRequestSchema.safeParse(request ?? {});
        if (!parsed.success) {
          return error("VALIDATION_ERROR", "Invalid request parameters", parsed.error.format());
        }
        const { search, limit, offset } = parsed.data;
        const result = getProjects(search, limit, offset);
        return success(result);
      } catch (err) {
        console.error("projects:getAll error:", err);
        return error("DATABASE_ERROR", "Failed to fetch projects", err);
      }
    }
  );
  electron.ipcMain.handle(
    "projects:getById",
    async (_, id) => {
      try {
        const parsed = GetProjectByIdRequestSchema.safeParse({ id });
        if (!parsed.success) {
          return error("VALIDATION_ERROR", "Invalid project ID", parsed.error.format());
        }
        const project = getProjectById(parsed.data.id);
        if (!project) {
          return error("NOT_FOUND", `Project with ID ${parsed.data.id} not found`);
        }
        const meetings = getMeetingsForProject(parsed.data.id);
        const topicsSet = /* @__PURE__ */ new Set();
        for (const meeting of meetings) {
          const recordings = getRecordingsForMeeting(meeting.id);
          for (const recording of recordings) {
            const transcript = getTranscriptByRecordingId(recording.id);
            if (transcript?.topics) {
              try {
                const meetingTopics = JSON.parse(transcript.topics);
                meetingTopics.forEach((topic) => topicsSet.add(topic));
              } catch {
              }
            }
          }
        }
        return success({
          project,
          meetings,
          topics: Array.from(topicsSet)
        });
      } catch (err) {
        console.error("projects:getById error:", err);
        return error("DATABASE_ERROR", "Failed to fetch project", err);
      }
    }
  );
  electron.ipcMain.handle(
    "projects:create",
    async (_, request) => {
      try {
        const parsed = CreateProjectRequestSchema.safeParse(request);
        if (!parsed.success) {
          return error("VALIDATION_ERROR", "Invalid create request", parsed.error.format());
        }
        const project = createProject({
          id: crypto.randomUUID(),
          name: parsed.data.name,
          description: parsed.data.description ?? null
        });
        return success(project);
      } catch (err) {
        console.error("projects:create error:", err);
        return error("DATABASE_ERROR", "Failed to create project", err);
      }
    }
  );
  electron.ipcMain.handle(
    "projects:update",
    async (_, request) => {
      try {
        const parsed = UpdateProjectRequestSchema.safeParse(request);
        if (!parsed.success) {
          return error("VALIDATION_ERROR", "Invalid update request", parsed.error.format());
        }
        const { id, name, description } = parsed.data;
        const project = getProjectById(id);
        if (!project) {
          return error("NOT_FOUND", `Project with ID ${id} not found`);
        }
        updateProject(id, name, description);
        return success({
          ...project,
          name: name ?? project.name,
          description: description !== void 0 ? description : project.description
        });
      } catch (err) {
        console.error("projects:update error:", err);
        return error("DATABASE_ERROR", "Failed to update project", err);
      }
    }
  );
  electron.ipcMain.handle(
    "projects:delete",
    async (_, id) => {
      try {
        const parsed = DeleteProjectRequestSchema.safeParse({ id });
        if (!parsed.success) {
          return error("VALIDATION_ERROR", "Invalid project ID", parsed.error.format());
        }
        const project = getProjectById(parsed.data.id);
        if (!project) {
          return error("NOT_FOUND", `Project with ID ${parsed.data.id} not found`);
        }
        deleteProject(parsed.data.id);
        return success(void 0);
      } catch (err) {
        console.error("projects:delete error:", err);
        return error("DATABASE_ERROR", "Failed to delete project", err);
      }
    }
  );
  electron.ipcMain.handle(
    "projects:tagMeeting",
    async (_, request) => {
      try {
        const parsed = TagMeetingRequestSchema.safeParse(request);
        if (!parsed.success) {
          return error("VALIDATION_ERROR", "Invalid tag request", parsed.error.format());
        }
        const { meetingId, projectId } = parsed.data;
        const meeting = getMeetingById(meetingId);
        if (!meeting) {
          return error("NOT_FOUND", `Meeting with ID ${meetingId} not found`);
        }
        const project = getProjectById(projectId);
        if (!project) {
          return error("NOT_FOUND", `Project with ID ${projectId} not found`);
        }
        tagMeetingToProject(meetingId, projectId);
        return success(void 0);
      } catch (err) {
        console.error("projects:tagMeeting error:", err);
        return error("DATABASE_ERROR", "Failed to tag meeting to project", err);
      }
    }
  );
  electron.ipcMain.handle(
    "projects:untagMeeting",
    async (_, request) => {
      try {
        const parsed = UntagMeetingRequestSchema.safeParse(request);
        if (!parsed.success) {
          return error("VALIDATION_ERROR", "Invalid untag request", parsed.error.format());
        }
        const { meetingId, projectId } = parsed.data;
        untagMeetingFromProject(meetingId, projectId);
        return success(void 0);
      } catch (err) {
        console.error("projects:untagMeeting error:", err);
        return error("DATABASE_ERROR", "Failed to untag meeting from project", err);
      }
    }
  );
  electron.ipcMain.handle(
    "projects:getForMeeting",
    async (_, meetingId) => {
      try {
        if (typeof meetingId !== "string") {
          return error("VALIDATION_ERROR", "Meeting ID must be a string");
        }
        const projects = getProjectsForMeeting(meetingId);
        return success(projects);
      } catch (err) {
        console.error("projects:getForMeeting error:", err);
        return error("DATABASE_ERROR", "Failed to fetch projects for meeting", err);
      }
    }
  );
}
const OUTPUT_TEMPLATES = {
  meeting_minutes: {
    id: "meeting_minutes",
    name: "Meeting Minutes",
    description: "Formal meeting minutes with attendees, agenda, discussion, decisions, and action items",
    prompt: `Generate formal meeting minutes from this transcript.

Structure the output as:
## Meeting Minutes
**Date:** [date]
**Attendees:** [list]

### Agenda
[inferred from discussion]

### Discussion
[key points discussed]

### Decisions Made
[numbered list]

### Action Items
[who, what, when]

Transcript:
{transcript}`
  },
  interview_feedback: {
    id: "interview_feedback",
    name: "Interview Feedback",
    description: "Structured candidate assessment for interview debriefs",
    prompt: `Generate interview feedback from this transcript.

Structure the output as:
## Interview Feedback
**Candidate:** [name if mentioned]
**Date:** [date]
**Interviewers:** [list]

### Technical Skills
[assessment with evidence]

### Communication
[assessment with evidence]

### Culture Fit
[assessment with evidence]

### Strengths
[bullet points]

### Areas of Concern
[bullet points]

### Recommendation
[Hire / No Hire / Maybe with reasoning]

Transcript:
{transcript}`
  },
  project_status: {
    id: "project_status",
    name: "Project Status Report",
    description: "Progress summary with blockers and next steps",
    prompt: `Generate a project status report from these meeting transcripts.

Structure the output as:
## Project Status Report
**Project:** {project_name}
**Period:** [date range]

### Summary
[2-3 sentence overview]

### Progress
[what was accomplished]

### Blockers
[current impediments]

### Next Steps
[planned actions]

### Key Decisions
[decisions made in these meetings]

Transcripts:
{transcripts}`
  },
  action_items: {
    id: "action_items",
    name: "Action Items Summary",
    description: "Consolidated list of action items from meeting(s)",
    prompt: `Extract all action items from this transcript.

Format as:
## Action Items

| Owner | Action | Due Date | Status |
|-------|--------|----------|--------|
| [name] | [task] | [date if mentioned] | Pending |

Be specific about who owns each action. If no owner mentioned, mark as "TBD".

Transcript:
{transcript}`
  }
};
function getTemplates() {
  return Object.values(OUTPUT_TEMPLATES);
}
function getTemplate(id) {
  return OUTPUT_TEMPLATES[id];
}
class OutputGeneratorService {
  /**
   * Get all available output templates
   */
  getTemplates() {
    return getTemplates();
  }
  /**
   * Get a specific template
   */
  getTemplate(id) {
    return getTemplate(id);
  }
  /**
   * Generate output using a template
   */
  async generate(options) {
    const { templateId, meetingId, projectId, contactId } = options;
    const template = getTemplate(templateId);
    if (!template) {
      throw new Error(`Template not found: ${templateId}`);
    }
    let transcripts = [];
    let contextInfo = {};
    if (meetingId) {
      const meeting = getMeetingById(meetingId);
      if (!meeting) {
        throw new Error(`Meeting not found: ${meetingId}`);
      }
      const recordings = getRecordingsForMeeting(meetingId);
      for (const recording of recordings) {
        const transcript = getTranscriptByRecordingId(recording.id);
        if (transcript?.full_text) {
          transcripts.push(transcript.full_text);
        }
      }
      contextInfo = {
        meeting_subject: meeting.subject,
        meeting_date: new Date(meeting.start_time).toLocaleDateString(),
        attendees: meeting.attendees || ""
      };
    } else if (projectId) {
      const project = getProjectById(projectId);
      if (!project) {
        throw new Error(`Project not found: ${projectId}`);
      }
      const meetings = getMeetingsForProject(projectId);
      for (const meeting of meetings) {
        const recordings = getRecordingsForMeeting(meeting.id);
        for (const recording of recordings) {
          const transcript = getTranscriptByRecordingId(recording.id);
          if (transcript?.full_text) {
            transcripts.push(`[Meeting: ${meeting.subject}]
${transcript.full_text}`);
          }
        }
      }
      contextInfo = {
        project_name: project.name,
        project_description: project.description || "",
        meeting_count: String(meetings.length)
      };
    } else if (contactId) {
      const contact = getContactById(contactId);
      if (!contact) {
        throw new Error(`Contact not found: ${contactId}`);
      }
      const meetings = getMeetingsForContact(contactId);
      for (const meeting of meetings) {
        const recordings = getRecordingsForMeeting(meeting.id);
        for (const recording of recordings) {
          const transcript = getTranscriptByRecordingId(recording.id);
          if (transcript?.full_text) {
            transcripts.push(`[Meeting: ${meeting.subject}]
${transcript.full_text}`);
          }
        }
      }
      contextInfo = {
        contact_name: contact.name,
        contact_email: contact.email || "",
        meeting_count: String(meetings.length)
      };
    }
    if (transcripts.length === 0) {
      throw new Error("No transcripts available for the selected context");
    }
    let prompt = template.prompt;
    prompt = prompt.replace("{transcript}", transcripts.join("\n\n---\n\n"));
    prompt = prompt.replace("{transcripts}", transcripts.join("\n\n---\n\n"));
    for (const [key, value] of Object.entries(contextInfo)) {
      prompt = prompt.replace(`{${key}}`, value);
    }
    const ollama = getOllamaService();
    const isAvailable = await ollama.isAvailable();
    if (!isAvailable) {
      throw new Error("Ollama is not available. Please start Ollama to generate outputs.");
    }
    const systemPrompt = `You are a professional document writer. Generate clear, well-structured documents based on meeting transcripts. Be concise but thorough. Use the exact format requested.`;
    const content = await ollama.generate(prompt, systemPrompt);
    if (!content) {
      throw new Error("Failed to generate output. Please try again.");
    }
    return {
      content,
      templateId,
      generatedAt: (/* @__PURE__ */ new Date()).toISOString()
    };
  }
}
let generatorInstance = null;
function getOutputGeneratorService() {
  if (!generatorInstance) {
    generatorInstance = new OutputGeneratorService();
  }
  return generatorInstance;
}
const OutputTemplateIdSchema = zod.z.enum([
  "meeting_minutes",
  "interview_feedback",
  "project_status",
  "action_items"
]);
const GenerateOutputRequestSchema = zod.z.object({
  templateId: OutputTemplateIdSchema,
  meetingId: UUIDSchema.optional(),
  projectId: UUIDSchema.optional(),
  contactId: UUIDSchema.optional()
}).refine(
  (data) => data.meetingId || data.projectId || data.contactId,
  { message: "At least one of meetingId, projectId, or contactId must be provided" }
);
function registerOutputsHandlers() {
  const generator = getOutputGeneratorService();
  electron.ipcMain.handle(
    "outputs:getTemplates",
    async () => {
      try {
        const templates = generator.getTemplates();
        return success(templates);
      } catch (err) {
        console.error("outputs:getTemplates error:", err);
        return error("INTERNAL_ERROR", "Failed to get templates", err);
      }
    }
  );
  electron.ipcMain.handle(
    "outputs:generate",
    async (_, request) => {
      try {
        const parsed = GenerateOutputRequestSchema.safeParse(request);
        if (!parsed.success) {
          return error("VALIDATION_ERROR", "Invalid generate request", parsed.error.format());
        }
        const result = await generator.generate(parsed.data);
        return success({
          content: result.content,
          templateId: result.templateId,
          generatedAt: result.generatedAt
        });
      } catch (err) {
        console.error("outputs:generate error:", err);
        if (err instanceof Error) {
          if (err.message.includes("not available")) {
            return error("OLLAMA_UNAVAILABLE", err.message);
          }
          if (err.message.includes("not found")) {
            return error("NOT_FOUND", err.message);
          }
          if (err.message.includes("No transcripts")) {
            return error("NOT_FOUND", err.message);
          }
        }
        return error("INTERNAL_ERROR", "Failed to generate output", err);
      }
    }
  );
  electron.ipcMain.handle(
    "outputs:copyToClipboard",
    async (_, content) => {
      try {
        if (typeof content !== "string") {
          return error("VALIDATION_ERROR", "Content must be a string");
        }
        electron.clipboard.writeText(content);
        return success(void 0);
      } catch (err) {
        console.error("outputs:copyToClipboard error:", err);
        return error("INTERNAL_ERROR", "Failed to copy to clipboard", err);
      }
    }
  );
  electron.ipcMain.handle(
    "outputs:saveToFile",
    async (event, content, suggestedName) => {
      try {
        if (typeof content !== "string") {
          return error("VALIDATION_ERROR", "Content must be a string");
        }
        const win = electron.BrowserWindow.fromWebContents(event.sender);
        if (!win) {
          return error("INTERNAL_ERROR", "No window found");
        }
        const defaultName = typeof suggestedName === "string" ? suggestedName : `output-${(/* @__PURE__ */ new Date()).toISOString().slice(0, 10)}.md`;
        const result = await electron.dialog.showSaveDialog(win, {
          defaultPath: defaultName,
          filters: [
            { name: "Markdown", extensions: ["md"] },
            { name: "Text", extensions: ["txt"] },
            { name: "All Files", extensions: ["*"] }
          ]
        });
        if (result.canceled || !result.filePath) {
          return error("VALIDATION_ERROR", "Save cancelled by user");
        }
        fs.writeFileSync(result.filePath, content, "utf-8");
        return success(result.filePath);
      } catch (err) {
        console.error("outputs:saveToFile error:", err);
        return error("INTERNAL_ERROR", "Failed to save file", err);
      }
    }
  );
  console.log("Output IPC handlers registered");
}
function sanitizeEventPayload(event) {
  const sanitized = JSON.parse(JSON.stringify(event));
  if (sanitized.payload) {
    delete sanitized.payload.internal;
    delete sanitized.payload.systemData;
    if (sanitized.payload.reason && typeof sanitized.payload.reason === "string") {
      sanitized.payload.reason = sanitized.payload.reason.replace(/[A-Za-z]:[\\/][^\s]+/g, "[path]");
    }
    if (sanitized.payload.assessedBy && typeof sanitized.payload.assessedBy === "string") {
      if (sanitized.payload.assessedBy.includes("@")) {
        sanitized.payload.assessedBy = "user";
      }
    }
  }
  return sanitized;
}
class DomainEventBus extends events.EventEmitter {
  mainWindow = null;
  listenerCount = /* @__PURE__ */ new Map();
  MAX_LISTENERS_PER_EVENT = 20;
  constructor() {
    super();
    this.setMaxListeners(100);
  }
  /**
   * Set the main window for broadcasting events to renderer
   */
  setMainWindow(window) {
    this.mainWindow = window;
  }
  /**
   * Emit a domain event to both internal listeners and renderer process
   */
  emitDomainEvent(event) {
    const enrichedEvent = {
      ...event,
      timestamp: event.timestamp || (/* @__PURE__ */ new Date()).toISOString()
    };
    this.emit(event.type, enrichedEvent);
    this.emit("*", enrichedEvent);
    if (this.mainWindow && !this.mainWindow.isDestroyed()) {
      const sanitized = sanitizeEventPayload(enrichedEvent);
      this.mainWindow.webContents.send("domain-event", sanitized);
    }
    console.log(`[EventBus] Emitted: ${event.type}`, enrichedEvent.payload);
  }
  /**
   * Subscribe to a specific domain event type
   */
  onDomainEvent(eventType, handler) {
    const currentCount = this.listenerCount.get(eventType) || 0;
    if (currentCount >= this.MAX_LISTENERS_PER_EVENT) {
      console.warn(`[EventBus] Max listeners (${this.MAX_LISTENERS_PER_EVENT}) reached for event ${eventType}`);
      const listeners = this.listeners(eventType);
      if (listeners.length > 0) {
        this.off(eventType, listeners[0]);
        this.listenerCount.set(eventType, currentCount - 1);
      }
    }
    this.on(eventType, handler);
    this.listenerCount.set(eventType, (this.listenerCount.get(eventType) || 0) + 1);
    return () => {
      this.off(eventType, handler);
      const count = this.listenerCount.get(eventType) || 0;
      this.listenerCount.set(eventType, Math.max(0, count - 1));
    };
  }
  /**
   * Subscribe to all domain events
   */
  onAnyDomainEvent(handler) {
    const currentCount = this.listenerCount.get("*") || 0;
    if (currentCount >= this.MAX_LISTENERS_PER_EVENT) {
      console.warn(`[EventBus] Max listeners (${this.MAX_LISTENERS_PER_EVENT}) reached for wildcard events`);
      const listeners = this.listeners("*");
      if (listeners.length > 0) {
        this.off("*", listeners[0]);
        this.listenerCount.set("*", currentCount - 1);
      }
    }
    this.on("*", handler);
    this.listenerCount.set("*", (this.listenerCount.get("*") || 0) + 1);
    return () => {
      this.off("*", handler);
      const count = this.listenerCount.get("*") || 0;
      this.listenerCount.set("*", Math.max(0, count - 1));
    };
  }
}
let eventBusInstance = null;
function getEventBus() {
  if (!eventBusInstance) {
    eventBusInstance = new DomainEventBus();
  }
  return eventBusInstance;
}
function setMainWindowForEventBus(window) {
  getEventBus().setMainWindow(window);
}
class QualityAssessmentService {
  /**
   * Assess the quality of a recording manually
   */
  async assessQuality(recordingId, quality, reason, assessedBy) {
    const recording = await getRecordingByIdAsync(recordingId);
    if (!recording) {
      throw new Error(`Recording not found: ${recordingId}`);
    }
    const assessment = {
      id: uuid.v4(),
      recording_id: recordingId,
      quality,
      assessment_method: "manual",
      confidence: 1,
      // Manual assessments have full confidence
      reason,
      assessed_by: assessedBy
    };
    await upsertQualityAssessmentAsync(assessment);
    const event = {
      type: "quality:assessed",
      timestamp: (/* @__PURE__ */ new Date()).toISOString(),
      payload: {
        recordingId,
        quality,
        assessmentMethod: "manual",
        confidence: 1,
        reason
      }
    };
    getEventBus().emitDomainEvent(event);
    return await getQualityAssessmentAsync(recordingId);
  }
  /**
   * Get quality assessment for a recording
   */
  getQuality(recordingId) {
    return getQualityAssessment(recordingId);
  }
  /**
   * Get all recordings with a specific quality level
   */
  getByQuality(quality) {
    return getRecordingsByQuality(quality);
  }
  /**
   * Automatically assess quality based on heuristics
   * This is called when a recording is transcribed or manually triggered
   */
  async autoAssess(recordingId) {
    const quality = await this.inferQualityAsync(recordingId);
    const assessment = {
      id: uuid.v4(),
      recording_id: recordingId,
      quality: quality.level,
      assessment_method: "auto",
      confidence: quality.confidence,
      reason: quality.reason,
      assessed_by: "system"
    };
    await upsertQualityAssessmentAsync(assessment);
    const event = {
      type: "quality:assessed",
      timestamp: (/* @__PURE__ */ new Date()).toISOString(),
      payload: {
        recordingId,
        quality: quality.level,
        assessmentMethod: "auto",
        confidence: quality.confidence,
        reason: quality.reason
      }
    };
    getEventBus().emitDomainEvent(event);
    return await getQualityAssessmentAsync(recordingId);
  }
  /**
   * Infer quality from recording metadata using heuristics
   * Factors considered:
   * - Has transcript
   * - Has meeting correlation
   * - Duration (meetings should be reasonable length)
   * - File size (corruption indicator)
   */
  inferQualityFromData(recording, transcript) {
    const hasMeeting = !!recording.meeting_id;
    const hasTranscript = !!transcript;
    const duration = recording.duration_seconds || 0;
    let score = 0;
    let confidence = 0.7;
    const reasons = [];
    if (hasTranscript) {
      score += 40;
      reasons.push("has transcript");
      if (transcript.word_count && transcript.word_count > 100) {
        score += 10;
        reasons.push("substantial transcript");
      }
      if (transcript.summary) {
        score += 5;
        reasons.push("has summary");
      }
    } else {
      reasons.push("no transcript");
    }
    if (hasMeeting) {
      score += 30;
      reasons.push("linked to meeting");
      if (recording.correlation_confidence && recording.correlation_confidence > 0.8) {
        score += 10;
        reasons.push("high meeting confidence");
      }
    } else {
      reasons.push("no meeting link");
    }
    if (duration >= 60 && duration <= 7200) {
      score += 20;
      reasons.push("appropriate duration");
    } else if (duration < 60) {
      reasons.push("very short recording");
      confidence = 0.6;
    } else if (duration > 7200) {
      reasons.push("very long recording");
    }
    if (recording.file_size && recording.file_size > 1e3) {
      score += 10;
      reasons.push("valid file size");
    } else {
      reasons.push("suspicious file size");
      confidence = 0.5;
    }
    let level;
    if (score >= 70) {
      level = "high";
    } else if (score >= 40) {
      level = "medium";
    } else {
      level = "low";
    }
    const reason = reasons.join(", ");
    return { level, confidence, reason };
  }
  /**
   * Async version of inferQuality - yields to event loop to prevent blocking
   */
  async inferQualityAsync(recordingId) {
    const recording = await getRecordingByIdAsync(recordingId);
    if (!recording) {
      return { level: "low", confidence: 1, reason: "Recording not found" };
    }
    const transcript = await getTranscriptByRecordingIdAsync(recordingId);
    return this.inferQualityFromData(recording, transcript);
  }
  inferQuality(recordingId) {
    const recording = getRecordingById(recordingId);
    if (!recording) {
      return { level: "low", confidence: 1, reason: "Recording not found" };
    }
    const transcript = getTranscriptByRecordingId(recordingId);
    return this.inferQualityFromData(recording, transcript);
  }
  // Legacy implementation - kept for backwards compatibility
  inferQualityOld(recordingId) {
    const recording = getRecordingById(recordingId);
    if (!recording) {
      return { level: "low", confidence: 1, reason: "Recording not found" };
    }
    const transcript = getTranscriptByRecordingId(recordingId);
    const hasMeeting = !!recording.meeting_id;
    const hasTranscript = !!transcript;
    const duration = recording.duration_seconds || 0;
    let score = 0;
    let confidence = 0.7;
    const reasons = [];
    if (hasTranscript) {
      score += 40;
      reasons.push("has transcript");
      if (transcript.word_count && transcript.word_count > 100) {
        score += 10;
        reasons.push("substantial transcript");
      }
      if (transcript.summary) {
        score += 5;
        reasons.push("has summary");
      }
    } else {
      reasons.push("no transcript");
    }
    if (hasMeeting) {
      score += 30;
      reasons.push("linked to meeting");
      if (recording.correlation_confidence && recording.correlation_confidence > 0.8) {
        score += 10;
        reasons.push("high meeting confidence");
      }
    } else {
      reasons.push("no meeting link");
    }
    if (duration >= 60 && duration <= 7200) {
      score += 20;
      reasons.push("appropriate duration");
    } else if (duration < 60) {
      reasons.push("very short recording");
      confidence = 0.6;
    } else if (duration > 7200) {
      reasons.push("very long recording");
    }
    if (recording.file_size && recording.file_size > 1e3) {
      score += 10;
      reasons.push("valid file size");
    } else {
      reasons.push("suspicious file size");
      confidence = 0.5;
    }
    let level;
    if (score >= 70) {
      level = "high";
    } else if (score >= 40) {
      level = "medium";
    } else {
      level = "low";
    }
    const reason = reasons.join(", ");
    return { level, confidence, reason };
  }
  /**
   * Batch auto-assess multiple recordings
   * Useful for initial import or re-assessment
   */
  async batchAutoAssess(recordingIds) {
    const { getRecordingsByIds: getRecordingsByIds2, getTranscriptsByRecordingIds: getTranscriptsByRecordingIds2 } = await Promise.resolve().then(() => database);
    const recordingsMap = getRecordingsByIds2(recordingIds);
    const transcriptsMap = getTranscriptsByRecordingIds2(recordingIds);
    const results = [];
    for (const recordingId of recordingIds) {
      try {
        const recording = recordingsMap.get(recordingId);
        if (!recording) continue;
        const transcript = transcriptsMap.get(recordingId);
        const quality = this.inferQualityFromData(recording, transcript);
        const assessment = {
          id: uuid.v4(),
          recording_id: recordingId,
          quality: quality.level,
          assessment_method: "auto",
          confidence: quality.confidence,
          reason: quality.reason,
          assessed_by: "system"
        };
        upsertQualityAssessment(assessment);
        const event = {
          type: "quality:assessed",
          timestamp: (/* @__PURE__ */ new Date()).toISOString(),
          payload: {
            recordingId,
            quality: quality.level,
            assessmentMethod: "auto",
            confidence: quality.confidence,
            reason: quality.reason
          }
        };
        getEventBus().emitDomainEvent(event);
        results.push(getQualityAssessment(recordingId));
      } catch (error2) {
        console.error(`Failed to assess recording ${recordingId}:`, error2);
      }
    }
    return results;
  }
  /**
   * Re-assess all recordings that don't have quality assessments
   */
  async assessUnassessed() {
    const { queryAll: queryAll2 } = await Promise.resolve().then(() => database);
    const unassessed = queryAll2(`
      SELECT r.* FROM recordings r
      LEFT JOIN quality_assessments qa ON r.id = qa.recording_id
      WHERE qa.id IS NULL
      ORDER BY r.date_recorded DESC
    `);
    console.log(`[QualityAssessment] Found ${unassessed.length} unassessed recordings`);
    const assessments = await this.batchAutoAssess(unassessed.map((r) => r.id));
    console.log(`[QualityAssessment] Assessed ${assessments.length} recordings`);
    return assessments.length;
  }
}
let qualityAssessmentServiceInstance = null;
function getQualityAssessmentService() {
  if (!qualityAssessmentServiceInstance) {
    qualityAssessmentServiceInstance = new QualityAssessmentService();
  }
  return qualityAssessmentServiceInstance;
}
const STORAGE_POLICIES = {
  high: "hot",
  // High-quality: keep readily accessible
  medium: "warm",
  // Medium-quality: accessible but can be slower
  low: "cold"
  // Low-quality: archive or cleanup candidate
};
const TIER_RETENTION_DAYS = {
  hot: 365,
  // Keep high-quality for 1 year
  warm: 180,
  // Medium-quality for 6 months
  cold: 90,
  // Low-quality for 3 months
  archive: 30
  // Archive for 1 month before suggesting deletion
};
class StoragePolicyService {
  constructor() {
    this.setupEventSubscriptions();
  }
  /**
   * Setup event subscriptions for reactive tier assignment
   */
  setupEventSubscriptions() {
    const eventBus = getEventBus();
    eventBus.onDomainEvent("quality:assessed", async (event) => {
      const { recordingId, quality } = event.payload;
      await this.assignTierAsync(recordingId, quality);
    });
    console.log("[StoragePolicyService] Event subscriptions initialized");
  }
  /**
   * Assign storage tier based on quality level (async version - prevents main thread blocking)
   */
  async assignTierAsync(recordingId, quality) {
    const recording = await getRecordingByIdAsync(recordingId);
    if (!recording) {
      console.error(`[StoragePolicy] Recording not found: ${recordingId}`);
      return;
    }
    const tier = STORAGE_POLICIES[quality];
    const previousTier = recording.storage_tier;
    await updateRecordingStorageTierAsync(recordingId, tier);
    const event = {
      type: "storage:tier-assigned",
      timestamp: (/* @__PURE__ */ new Date()).toISOString(),
      payload: {
        recordingId,
        tier,
        previousTier: previousTier || void 0,
        reason: `Quality-based tier assignment: ${quality} -> ${tier}`
      }
    };
    getEventBus().emitDomainEvent(event);
    console.log(`[StoragePolicy] Assigned tier ${tier} to recording ${recordingId} (quality: ${quality})`);
  }
  /**
   * Assign storage tier based on quality level (sync version - use assignTierAsync for non-blocking)
   */
  assignTier(recordingId, quality) {
    const recording = getRecordingById(recordingId);
    if (!recording) {
      console.error(`[StoragePolicy] Recording not found: ${recordingId}`);
      return;
    }
    const tier = STORAGE_POLICIES[quality];
    const previousTier = recording.storage_tier;
    updateRecordingStorageTier(recordingId, tier);
    const event = {
      type: "storage:tier-assigned",
      timestamp: (/* @__PURE__ */ new Date()).toISOString(),
      payload: {
        recordingId,
        tier,
        previousTier: previousTier || void 0,
        reason: `Quality-based tier assignment: ${quality} -> ${tier}`
      }
    };
    getEventBus().emitDomainEvent(event);
    console.log(`[StoragePolicy] Assigned tier ${tier} to recording ${recordingId} (quality: ${quality})`);
  }
  /**
   * Get recordings by storage tier
   */
  getByTier(tier) {
    return getRecordingsByStorageTier(tier);
  }
  /**
   * Get cleanup suggestions based on retention policies
   * Returns recordings that exceed their tier's retention period
   */
  getCleanupSuggestions(minAgeOverride) {
    const suggestions = [];
    const now = /* @__PURE__ */ new Date();
    const retentionDays = { ...TIER_RETENTION_DAYS, ...minAgeOverride };
    const tiers = ["archive", "cold", "warm", "hot"];
    for (const tier of tiers) {
      const maxAge = retentionDays[tier];
      const cutoffDate = new Date(now.getTime() - maxAge * 24 * 60 * 60 * 1e3).toISOString();
      const recordings = queryAll(
        `SELECT * FROM recordings 
         WHERE storage_tier = ? AND date_recorded < ?
         ORDER BY date_recorded ASC
         LIMIT 1000`,
        [tier, cutoffDate]
      );
      if (recordings.length === 0) continue;
      const recordingIds = recordings.map((r) => r.id);
      const placeholders = recordingIds.map(() => "?").join(",");
      const qualities = queryAll(
        `SELECT recording_id, quality FROM quality_assessments WHERE recording_id IN (${placeholders})`,
        recordingIds
      );
      const qualityMap = new Map(qualities.map((q) => [q.recording_id, q.quality]));
      for (const recording of recordings) {
        const recordedDate = new Date(recording.date_recorded);
        const ageMs = now.getTime() - recordedDate.getTime();
        const ageInDays = Math.floor(ageMs / (1e3 * 60 * 60 * 24));
        suggestions.push({
          recordingId: recording.id,
          filename: recording.filename,
          dateRecorded: recording.date_recorded,
          tier,
          quality: qualityMap.get(recording.id),
          ageInDays,
          sizeBytes: recording.file_size,
          reason: `Exceeds ${tier} tier retention (${maxAge} days) by ${ageInDays - maxAge} days`,
          hasTranscript: recording.transcription_status === "complete",
          hasMeeting: !!recording.meeting_id
        });
      }
    }
    suggestions.sort((a, b) => b.ageInDays - a.ageInDays);
    return suggestions;
  }
  /**
   * Get cleanup suggestions for a specific tier
   */
  getCleanupSuggestionsForTier(tier, minAgeDays) {
    const override = minAgeDays ? { [tier]: minAgeDays } : void 0;
    const allSuggestions = this.getCleanupSuggestions(override);
    return allSuggestions.filter((s) => s.tier === tier);
  }
  /**
   * Execute cleanup for a list of recording IDs
   * This will:
   * - Delete local files
   * - Update recording location to 'deleted' or 'device-only'
   * - Optionally archive tier to next lower tier instead of deletion
   */
  async executeCleanup(recordingIds, archive = false) {
    const deleted = [];
    const archived = [];
    const failed = [];
    for (const recordingId of recordingIds) {
      try {
        const recording = getRecordingById(recordingId);
        if (!recording) {
          failed.push({ id: recordingId, reason: "Recording not found" });
          continue;
        }
        if (archive) {
          const currentTier = recording.storage_tier;
          const nextTier = this.getNextLowerTier(currentTier);
          if (nextTier) {
            updateRecordingStorageTier(recordingId, nextTier);
            archived.push(recordingId);
            console.log(`[StoragePolicy] Archived ${recordingId} from ${currentTier} to ${nextTier}`);
          } else {
            failed.push({ id: recordingId, reason: "Already at lowest tier" });
          }
        } else {
          const { deleteRecordingLocal: deleteRecordingLocal2 } = await Promise.resolve().then(() => database);
          deleteRecordingLocal2(recordingId);
          deleted.push(recordingId);
          console.log(`[StoragePolicy] Deleted local file for ${recordingId}`);
        }
      } catch (error2) {
        failed.push({
          id: recordingId,
          reason: error2 instanceof Error ? error2.message : "Unknown error"
        });
      }
    }
    if (deleted.length > 0 || archived.length > 0) {
      const event = {
        type: "storage:cleanup-suggested",
        timestamp: (/* @__PURE__ */ new Date()).toISOString(),
        payload: {
          recordingIds: [...deleted, ...archived],
          tier: "archive",
          reason: `Cleanup executed: ${deleted.length} deleted, ${archived.length} archived`
        }
      };
      getEventBus().emitDomainEvent(event);
    }
    return { deleted, archived, failed };
  }
  /**
   * Get the next lower storage tier
   */
  getNextLowerTier(currentTier) {
    const tierOrder = ["hot", "warm", "cold", "archive"];
    const currentIndex = currentTier ? tierOrder.indexOf(currentTier) : -1;
    if (currentIndex === -1 || currentIndex === tierOrder.length - 1) {
      return null;
    }
    return tierOrder[currentIndex + 1];
  }
  /**
   * Get storage statistics by tier
   */
  getStorageStats() {
    const tiers = ["hot", "warm", "cold", "archive"];
    const stats = [];
    const now = /* @__PURE__ */ new Date();
    const allRecordings = queryAll(
      "SELECT * FROM recordings WHERE storage_tier IS NOT NULL"
    );
    const recordingsByTier = /* @__PURE__ */ new Map();
    for (const recording of allRecordings) {
      const tier = recording.storage_tier;
      if (!recordingsByTier.has(tier)) {
        recordingsByTier.set(tier, []);
      }
      recordingsByTier.get(tier).push(recording);
    }
    for (const tier of tiers) {
      const recordings = recordingsByTier.get(tier) || [];
      const totalSize = recordings.reduce((sum, r) => sum + (r.file_size || 0), 0);
      const ages = recordings.map((r) => {
        const recordedDate = new Date(r.date_recorded);
        const ageMs = now.getTime() - recordedDate.getTime();
        return Math.floor(ageMs / (1e3 * 60 * 60 * 24));
      });
      const avgAge = ages.length > 0 ? Math.floor(ages.reduce((sum, age) => sum + age, 0) / ages.length) : 0;
      stats.push({
        tier,
        count: recordings.length,
        totalSizeBytes: totalSize,
        avgAgeDays: avgAge
      });
    }
    return stats;
  }
  /**
   * Initialize storage tiers for recordings without quality assessments
   * Assigns default 'warm' tier to untiered recordings
   */
  async initializeUntieredRecordings() {
    const untiered = queryAll(`
      SELECT * FROM recordings WHERE storage_tier IS NULL
    `);
    console.log(`[StoragePolicy] Found ${untiered.length} untiered recordings`);
    for (const recording of untiered) {
      const quality = await getQualityAssessmentAsync(recording.id);
      if (quality) {
        await this.assignTierAsync(recording.id, quality.quality);
      } else {
        await updateRecordingStorageTierAsync(recording.id, "warm");
        console.log(`[StoragePolicy] Assigned default 'warm' tier to ${recording.id}`);
      }
    }
    return untiered.length;
  }
}
let storagePolicyServiceInstance = null;
function getStoragePolicyService() {
  if (!storagePolicyServiceInstance) {
    storagePolicyServiceInstance = new StoragePolicyService();
  }
  return storagePolicyServiceInstance;
}
function registerQualityHandlers() {
  const qualityService = getQualityAssessmentService();
  const storageService = getStoragePolicyService();
  electron.ipcMain.handle("quality:get", async (_, recordingId) => {
    try {
      const validId = validateRecordingId(recordingId);
      const assessment = qualityService.getQuality(validId);
      return { success: true, data: assessment };
    } catch (error2) {
      const message = error2 instanceof Error ? error2.message : "Unknown error";
      return { success: false, error: message };
    }
  });
  electron.ipcMain.handle(
    "quality:set",
    async (_, recordingId, quality, reason, assessedBy) => {
      try {
        const validId = validateRecordingId(recordingId);
        const validQuality = validateQualityLevel(quality);
        const validReason = validateOptionalString(reason, 1e3);
        const validAssessedBy = validateOptionalString(assessedBy, 200);
        const assessment = await qualityService.assessQuality(
          validId,
          validQuality,
          validReason,
          validAssessedBy
        );
        return { success: true, data: assessment };
      } catch (error2) {
        const message = error2 instanceof Error ? error2.message : "Unknown error";
        return { success: false, error: message };
      }
    }
  );
  electron.ipcMain.handle("quality:auto-assess", async (_, recordingId) => {
    try {
      const validId = validateRecordingId(recordingId);
      const assessment = await qualityService.autoAssess(validId);
      return { success: true, data: assessment };
    } catch (error2) {
      const message = error2 instanceof Error ? error2.message : "Unknown error";
      return { success: false, error: message };
    }
  });
  electron.ipcMain.handle("quality:get-by-quality", async (_, quality) => {
    try {
      const validQuality = validateQualityLevel(quality);
      const recordings = qualityService.getByQuality(validQuality);
      return { success: true, data: recordings };
    } catch (error2) {
      const message = error2 instanceof Error ? error2.message : "Unknown error";
      return { success: false, error: message };
    }
  });
  electron.ipcMain.handle("quality:batch-auto-assess", async (_, recordingIds) => {
    try {
      const validIds = validateRecordingIds(recordingIds);
      const assessments = await qualityService.batchAutoAssess(validIds);
      return { success: true, data: assessments };
    } catch (error2) {
      const message = error2 instanceof Error ? error2.message : "Unknown error";
      return { success: false, error: message };
    }
  });
  electron.ipcMain.handle("quality:assess-unassessed", async () => {
    try {
      const count = await qualityService.assessUnassessed();
      return { success: true, data: { assessed: count } };
    } catch (error2) {
      const message = error2 instanceof Error ? error2.message : "Unknown error";
      return { success: false, error: message };
    }
  });
  electron.ipcMain.handle("storage:get-by-tier", async (_, tier) => {
    try {
      const validTier = validateStorageTier(tier);
      const recordings = storageService.getByTier(validTier);
      return { success: true, data: recordings };
    } catch (error2) {
      const message = error2 instanceof Error ? error2.message : "Unknown error";
      return { success: false, error: message };
    }
  });
  electron.ipcMain.handle(
    "storage:get-cleanup-suggestions",
    async (_, minAgeOverride) => {
      try {
        const validOverride = validateMinAgeOverride(minAgeOverride);
        const suggestions = storageService.getCleanupSuggestions(validOverride);
        return { success: true, data: suggestions };
      } catch (error2) {
        const message = error2 instanceof Error ? error2.message : "Unknown error";
        return { success: false, error: message };
      }
    }
  );
  electron.ipcMain.handle(
    "storage:get-cleanup-suggestions-for-tier",
    async (_, tier, minAgeDays) => {
      try {
        const validTier = validateStorageTier(tier);
        const validMinAgeDays = minAgeDays !== void 0 ? validateNumber(minAgeDays, 0, 36500) : void 0;
        const suggestions = storageService.getCleanupSuggestionsForTier(validTier, validMinAgeDays);
        return { success: true, data: suggestions };
      } catch (error2) {
        const message = error2 instanceof Error ? error2.message : "Unknown error";
        return { success: false, error: message };
      }
    }
  );
  electron.ipcMain.handle(
    "storage:execute-cleanup",
    async (_, recordingIds, archive = false) => {
      try {
        const validIds = validateRecordingIds(recordingIds);
        const validArchive = archive !== void 0 ? validateBoolean(archive) : false;
        const result = await storageService.executeCleanup(validIds, validArchive);
        return { success: true, data: result };
      } catch (error2) {
        const message = error2 instanceof Error ? error2.message : "Unknown error";
        return { success: false, error: message };
      }
    }
  );
  electron.ipcMain.handle("storage:get-stats", async () => {
    try {
      const stats = storageService.getStorageStats();
      return { success: true, data: stats };
    } catch (error2) {
      const message = error2 instanceof Error ? error2.message : "Unknown error";
      return { success: false, error: message };
    }
  });
  electron.ipcMain.handle("storage:initialize-untiered", async () => {
    try {
      const count = await storageService.initializeUntieredRecordings();
      return { success: true, data: { initialized: count } };
    } catch (error2) {
      const message = error2 instanceof Error ? error2.message : "Unknown error";
      return { success: false, error: message };
    }
  });
  electron.ipcMain.handle("storage:assign-tier", async (_, recordingId, quality) => {
    try {
      const validId = validateRecordingId(recordingId);
      const validQuality = validateQualityLevel(quality);
      storageService.assignTier(validId, validQuality);
      return { success: true };
    } catch (error2) {
      const message = error2 instanceof Error ? error2.message : "Unknown error";
      return { success: false, error: message };
    }
  });
  console.log("[IPC] Quality and Storage handlers registered");
}
const migrationLock = {
  acquire() {
    const db2 = getDatabase();
    try {
      const stmt = db2.prepare(`SELECT value FROM config WHERE key = 'migration_lock'`);
      if (stmt.step()) {
        const lockTime = parseInt(stmt.getAsObject().value, 10);
        stmt.free();
        if (Date.now() - lockTime > 36e5) {
          db2.run(`DELETE FROM config WHERE key = 'migration_lock'`);
        } else {
          return false;
        }
      } else {
        stmt.free();
      }
      db2.run(`INSERT INTO config (key, value) VALUES ('migration_lock', ?)`, [Date.now().toString()]);
      return true;
    } catch (error2) {
      return false;
    }
  },
  release() {
    const db2 = getDatabase();
    try {
      db2.run(`DELETE FROM config WHERE key = 'migration_lock'`);
    } catch (error2) {
      console.error("Failed to release migration lock:", error2);
    }
  }
};
const activeProgressTrackers = /* @__PURE__ */ new Set();
function registerProgressTracker(id) {
  activeProgressTrackers.add(id);
}
function cleanupProgressTracker(id) {
  activeProgressTrackers.delete(id);
}
function cleanupAllProgressTrackers() {
  activeProgressTrackers.clear();
}
process.on("exit", () => {
  cleanupAllProgressTrackers();
});
function sanitizeError(error2) {
  const message = error2.message;
  return message.replace(/\/[^\s]*/g, "[path]").replace(/\\/g, "[path]").replace(/[A-Z]:\\[^\s]*/g, "[path]").replace(/database.*?:/gi, "Database:").replace(/SQLITE_ERROR.*?:/gi, "Database error:").slice(0, 200);
}
function loadV11Schema() {
  try {
    const schemaPath = path.join(__dirname, "../services/migrations/v11-knowledge-captures.sql");
    return fs.readFileSync(schemaPath, "utf-8");
  } catch (error2) {
    console.error("Failed to load V11 schema file:", error2);
    throw new Error("V11 schema file not found. Cannot proceed with migration.");
  }
}
function createMigrationBackup() {
  const db2 = getDatabase();
  db2.run("DROP TABLE IF EXISTS _backup_recordings");
  db2.run("DROP TABLE IF EXISTS _backup_transcripts");
  db2.run(`
    CREATE TEMP TABLE _backup_recordings AS
    SELECT * FROM recordings
    WHERE migration_status IS NULL OR migration_status = 'pending'
  `);
  db2.run(`
    CREATE TEMP TABLE _backup_transcripts AS
    SELECT t.* FROM transcripts t
    INNER JOIN recordings r ON t.recording_id = r.id
    WHERE r.migration_status IS NULL OR r.migration_status = 'pending'
  `);
}
function checkBackupExists() {
  const db2 = getDatabase();
  try {
    const stmt = db2.prepare(`
      SELECT COUNT(*) as count FROM sqlite_master
      WHERE type='table' AND name IN ('_backup_recordings', '_backup_transcripts')
    `);
    stmt.step();
    const count = stmt.getAsObject().count || 0;
    stmt.free();
    return count === 2;
  } catch (error2) {
    console.error("Failed to check backup existence:", error2);
    return false;
  }
}
function verifyRestoration() {
  const db2 = getDatabase();
  try {
    const stmt = db2.prepare(`
      SELECT COUNT(*) as count FROM recordings
      WHERE migration_status = 'migrated'
    `);
    stmt.step();
    const count = stmt.getAsObject().count || 0;
    stmt.free();
    return count === 0;
  } catch (error2) {
    console.error("Failed to verify restoration:", error2);
    return false;
  }
}
function restoreFromBackup() {
  const db2 = getDatabase();
  try {
    if (!checkBackupExists()) {
      console.log("No backup tables found, skipping restore");
      return;
    }
    db2.run(`
      UPDATE recordings
      SET migration_status = (
        SELECT migration_status FROM _backup_recordings b
        WHERE b.id = recordings.id
      ),
      migrated_to_capture_id = NULL,
      migrated_at = NULL
      WHERE id IN (SELECT id FROM _backup_recordings)
    `);
    db2.run(`DELETE FROM transcripts WHERE recording_id IN (SELECT id FROM _backup_recordings)`);
    db2.run(`INSERT INTO transcripts SELECT * FROM _backup_transcripts`);
    console.log("Successfully restored from backup");
  } catch (error2) {
    console.error("Failed to restore from backup:", error2);
    throw error2;
  }
}
function cleanupBackupTables() {
  const db2 = getDatabase();
  try {
    db2.run("DROP TABLE IF EXISTS _backup_recordings");
    db2.run("DROP TABLE IF EXISTS _backup_transcripts");
  } catch (error2) {
    console.error("Failed to cleanup backup tables:", error2);
  }
}
function verifyMigration() {
  const db2 = getDatabase();
  const errors = [];
  try {
    const migratedStmt = db2.prepare(`
      SELECT COUNT(*) as count
      FROM recordings
      WHERE migration_status = 'migrated'
    `);
    migratedStmt.step();
    const migratedCount = migratedStmt.getAsObject().count || 0;
    migratedStmt.free();
    const capturesStmt = db2.prepare(`
      SELECT COUNT(*) as count
      FROM knowledge_captures
      WHERE source_recording_id IS NOT NULL
    `);
    capturesStmt.step();
    const capturesCount = capturesStmt.getAsObject().count || 0;
    capturesStmt.free();
    if (capturesCount !== migratedCount) {
      errors.push(`Count mismatch: ${capturesCount} captures created vs ${migratedCount} recordings marked as migrated`);
    }
    const invalidStmt = db2.prepare(`
      SELECT COUNT(*) as count
      FROM knowledge_captures
      WHERE title IS NULL OR title = ''
         OR captured_at IS NULL
         OR source_recording_id IS NULL
    `);
    invalidStmt.step();
    const invalidCount = invalidStmt.getAsObject().count || 0;
    invalidStmt.free();
    if (invalidCount > 0) {
      errors.push(`Found ${invalidCount} captures with missing required fields (title, captured_at, source_recording_id)`);
    }
    const orphanedStmt = db2.prepare(`
      SELECT COUNT(*) as count
      FROM knowledge_captures
      WHERE meeting_id IS NOT NULL
        AND NOT EXISTS (SELECT 1 FROM meetings WHERE id = knowledge_captures.meeting_id)
    `);
    orphanedStmt.step();
    const orphanedCount = orphanedStmt.getAsObject().count || 0;
    orphanedStmt.free();
    if (orphanedCount > 0) {
      errors.push(`Found ${orphanedCount} captures with invalid meeting references`);
    }
    const orphanedRecordingsStmt = db2.prepare(`
      SELECT COUNT(*) as count
      FROM knowledge_captures
      WHERE source_recording_id IS NOT NULL
        AND NOT EXISTS (SELECT 1 FROM recordings WHERE id = knowledge_captures.source_recording_id)
    `);
    orphanedRecordingsStmt.step();
    const orphanedRecordingsCount = orphanedRecordingsStmt.getAsObject().count || 0;
    orphanedRecordingsStmt.free();
    if (orphanedRecordingsCount > 0) {
      errors.push(`Found ${orphanedRecordingsCount} captures with invalid recording references`);
    }
  } catch (error2) {
    errors.push(`Verification failed: ${sanitizeError(error2)}`);
  }
  return {
    success: errors.length === 0,
    errors
  };
}
async function generateCleanupPreviewImpl() {
  const db2 = getDatabase();
  const orphanedTranscripts = [];
  const duplicateRecordings = [];
  const invalidMeetingRefs = [];
  try {
    const orphanedStmt = db2.prepare(`
      SELECT t.id, t.recording_id
      FROM transcripts t
      LEFT JOIN recordings r ON t.recording_id = r.id
      WHERE r.id IS NULL
    `);
    while (orphanedStmt.step()) {
      const row = orphanedStmt.getAsObject();
      orphanedTranscripts.push({
        id: row.id,
        recording_id: row.recording_id
      });
    }
    orphanedStmt.free();
    const duplicatesStmt = db2.prepare(`
      SELECT filename, COUNT(*) as count, MIN(id) as id
      FROM recordings
      GROUP BY filename
      HAVING COUNT(*) > 1
    `);
    while (duplicatesStmt.step()) {
      const row = duplicatesStmt.getAsObject();
      duplicateRecordings.push({
        id: row.id,
        filename: row.filename,
        count: row.count
      });
    }
    duplicatesStmt.free();
    const invalidRefsStmt = db2.prepare(`
      SELECT r.id, r.meeting_id
      FROM recordings r
      WHERE r.meeting_id IS NOT NULL
      AND NOT EXISTS (SELECT 1 FROM meetings m WHERE m.id = r.meeting_id)
    `);
    while (invalidRefsStmt.step()) {
      const row = invalidRefsStmt.getAsObject();
      invalidMeetingRefs.push({
        id: row.id,
        meeting_id: row.meeting_id
      });
    }
    invalidRefsStmt.free();
  } catch (error2) {
    console.error("Failed to generate cleanup preview:", error2);
  }
  return { orphanedTranscripts, duplicateRecordings, invalidMeetingRefs };
}
async function runPreMigrationCleanupImpl() {
  const db2 = getDatabase();
  const result = {
    success: true,
    orphanedTranscriptsRemoved: 0,
    duplicateRecordingsRemoved: 0,
    invalidMeetingRefsFixed: 0,
    errors: []
  };
  try {
    try {
      const orphanedStmt = db2.prepare(`
        DELETE FROM transcripts
        WHERE id IN (
          SELECT t.id FROM transcripts t
          LEFT JOIN recordings r ON t.recording_id = r.id
          WHERE r.id IS NULL
        )
      `);
      orphanedStmt.step();
      result.orphanedTranscriptsRemoved = db2.getRowsModified();
      orphanedStmt.free();
    } catch (error2) {
      result.errors.push(`Failed to remove orphaned transcripts: ${sanitizeError(error2)}`);
    }
    try {
      const duplicatesStmt = db2.prepare(`
        DELETE FROM recordings
        WHERE id NOT IN (
          SELECT MIN(id) FROM recordings GROUP BY filename
        )
        AND filename IN (
          SELECT filename FROM recordings GROUP BY filename HAVING COUNT(*) > 1
        )
      `);
      duplicatesStmt.step();
      result.duplicateRecordingsRemoved = db2.getRowsModified();
      duplicatesStmt.free();
    } catch (error2) {
      result.errors.push(`Failed to remove duplicate recordings: ${sanitizeError(error2)}`);
    }
    try {
      const invalidRefsStmt = db2.prepare(`
        UPDATE recordings
        SET meeting_id = NULL, correlation_confidence = NULL, correlation_method = NULL
        WHERE meeting_id IS NOT NULL
        AND NOT EXISTS (SELECT 1 FROM meetings m WHERE m.id = meeting_id)
      `);
      invalidRefsStmt.step();
      result.invalidMeetingRefsFixed = db2.getRowsModified();
      invalidRefsStmt.free();
    } catch (error2) {
      result.errors.push(`Failed to fix invalid meeting references: ${sanitizeError(error2)}`);
    }
    if (result.errors.length > 0) {
      result.success = false;
    }
  } catch (error2) {
    result.success = false;
    result.errors.push(error2.message);
  }
  return result;
}
async function migrateToV11Impl(mainWindow2) {
  if (!migrationLock.acquire()) {
    return {
      success: false,
      capturesCreated: 0,
      errors: ["Migration already in progress"],
      verified: false
    };
  }
  const trackerId = crypto$1.randomUUID();
  registerProgressTracker(trackerId);
  const result = {
    success: true,
    capturesCreated: 0,
    errors: [],
    verified: false
  };
  try {
    runInTransaction(() => {
      const db2 = getDatabase();
      mainWindow2?.webContents.send("migration:progress", {
        phase: "creating_backup",
        progress: 0
      });
      createMigrationBackup();
      mainWindow2?.webContents.send("migration:progress", {
        phase: "creating_tables",
        progress: 10
      });
      const schemaSQL = loadV11Schema();
      const statements = schemaSQL.split(";").map((s) => s.trim()).filter((s) => s.length > 0 && !s.startsWith("--"));
      for (const stmt of statements) {
        if (stmt.trim()) {
          try {
            db2.run(stmt);
          } catch (error2) {
            console.log("Schema statement warning:", error2.message);
          }
        }
      }
      mainWindow2?.webContents.send("migration:progress", {
        phase: "migrating_data",
        progress: 20
      });
      const countStmt = db2.prepare(`
        SELECT COUNT(*) as total
        FROM recordings r
        INNER JOIN transcripts t ON r.id = t.recording_id
        WHERE r.migration_status IS NULL OR r.migration_status = 'pending'
      `);
      countStmt.step();
      const totalCount = countStmt.getAsObject().total || 0;
      countStmt.free();
      if (totalCount === 0) {
        mainWindow2?.webContents.send("migration:progress", {
          phase: "complete",
          progress: 100
        });
        return;
      }
      const migrateStmt = db2.prepare(`
        SELECT r.id as recording_id, r.filename, r.date_recorded, r.meeting_id,
               t.full_text, t.summary, t.action_items
        FROM recordings r
        INNER JOIN transcripts t ON r.id = t.recording_id
        WHERE r.migration_status IS NULL OR r.migration_status = 'pending'
      `);
      const insertCaptureStmt = db2.prepare(`
        INSERT INTO knowledge_captures (
          id, title, summary, captured_at, created_at, updated_at,
          meeting_id, source_recording_id
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `);
      const insertActionItemStmt = db2.prepare(`
        INSERT INTO action_items (
          id, knowledge_capture_id, content, created_at
        )
        VALUES (?, ?, ?, ?)
      `);
      const updateRecordingStmt = db2.prepare(`
        UPDATE recordings
        SET migration_status = 'migrated',
            migrated_to_capture_id = ?,
            migrated_at = ?
        WHERE id = ?
      `);
      let lastProgressUpdateTime = 0;
      const PROGRESS_UPDATE_INTERVAL_MS = 500;
      let processed = 0;
      while (migrateStmt.step()) {
        const row = migrateStmt.getAsObject();
        try {
          const captureId = crypto$1.randomUUID();
          const now = (/* @__PURE__ */ new Date()).toISOString();
          const title = `Recording: ${row.filename}`;
          insertCaptureStmt.run([
            captureId,
            title,
            row.summary || null,
            row.date_recorded,
            now,
            now,
            row.meeting_id || null,
            row.recording_id
          ]);
          if (row.action_items) {
            try {
              const actionItems = JSON.parse(row.action_items);
              if (Array.isArray(actionItems)) {
                for (const item of actionItems) {
                  let content;
                  if (typeof item === "string") {
                    content = item;
                  } else if (typeof item === "object" && item !== null) {
                    content = item.description || item.text || item.task || item.action || JSON.stringify(item);
                  } else {
                    continue;
                  }
                  if (content && content.trim()) {
                    insertActionItemStmt.run([crypto$1.randomUUID(), captureId, content, now]);
                  }
                }
              }
            } catch {
              const actionItemsText = row.action_items;
              if (actionItemsText.trim()) {
                insertActionItemStmt.run([crypto$1.randomUUID(), captureId, actionItemsText, now]);
              }
            }
          }
          updateRecordingStmt.run([captureId, now, row.recording_id]);
          result.capturesCreated++;
          processed++;
          const currentTime = Date.now();
          const isLastRecord = processed === totalCount;
          const shouldUpdate = currentTime - lastProgressUpdateTime >= PROGRESS_UPDATE_INTERVAL_MS;
          if (shouldUpdate || isLastRecord) {
            lastProgressUpdateTime = currentTime;
            const progress = Math.floor(processed / totalCount * 60) + 20;
            mainWindow2?.webContents.send("migration:progress", {
              phase: "migrating_data",
              progress,
              processed,
              total: totalCount
            });
          }
        } catch (error2) {
          result.errors.push(`Failed to migrate recording ${row.recording_id}: ${sanitizeError(error2)}`);
        }
      }
      migrateStmt.free();
      insertCaptureStmt.free();
      insertActionItemStmt.free();
      updateRecordingStmt.free();
      mainWindow2?.webContents.send("migration:progress", {
        phase: "verifying",
        progress: 85
      });
      const verification = verifyMigration();
      result.verified = verification.success;
      if (!verification.success) {
        result.errors.push(...verification.errors);
        throw new Error("Migration verification failed: " + verification.errors.join(", "));
      }
      db2.run(`INSERT OR REPLACE INTO schema_version (version) VALUES (11)`);
      mainWindow2?.webContents.send("migration:progress", {
        phase: "complete",
        progress: 100,
        processed,
        total: totalCount
      });
      cleanupBackupTables();
    });
  } catch (error2) {
    result.success = false;
    result.errors.push(sanitizeError(error2));
    mainWindow2?.webContents.send("migration:progress", {
      phase: "error",
      error: sanitizeError(error2)
    });
    try {
      restoreFromBackup();
      result.errors.push("Migration failed. Original data has been restored from backup.");
    } catch (restoreError) {
      result.errors.push(`Failed to restore from backup: ${sanitizeError(restoreError)}`);
    }
  } finally {
    cleanupProgressTracker(trackerId);
    migrationLock.release();
  }
  return result;
}
async function rollbackV11MigrationImpl() {
  if (!migrationLock.acquire()) {
    return {
      success: false,
      errors: ["Migration in progress, cannot rollback"]
    };
  }
  const result = { success: true, errors: [] };
  try {
    const hasBackup = checkBackupExists();
    runInTransaction(() => {
      const db2 = getDatabase();
      if (hasBackup) {
        try {
          restoreFromBackup();
          if (!verifyRestoration()) {
            throw new Error("Restoration verification failed - some recordings still marked as migrated");
          }
        } catch (error2) {
          result.errors.push(`Failed to restore from backup: ${sanitizeError(error2)}`);
          throw error2;
        }
      } else {
        console.log("No backup to restore, proceeding with standard rollback");
      }
      db2.run("DROP TABLE IF EXISTS outputs");
      db2.run("DROP TABLE IF EXISTS follow_ups");
      db2.run("DROP TABLE IF EXISTS decisions");
      db2.run("DROP TABLE IF EXISTS action_items");
      db2.run("DROP TABLE IF EXISTS audio_sources");
      db2.run("DROP TABLE IF EXISTS knowledge_captures");
      if (!hasBackup) {
        try {
          db2.run(`UPDATE recordings SET migration_status = 'pending', migrated_to_capture_id = NULL, migrated_at = NULL WHERE migration_status = 'migrated'`);
        } catch {
        }
      }
      db2.run(`DELETE FROM schema_version WHERE version = 11`);
      cleanupBackupTables();
    });
  } catch (error2) {
    result.success = false;
    result.errors.push(sanitizeError(error2));
  } finally {
    migrationLock.release();
  }
  return result;
}
async function getMigrationStatusImpl() {
  const db2 = getDatabase();
  const status = {
    pending: 0,
    migrated: 0,
    skipped: 0,
    total: 0
  };
  try {
    const tableInfoStmt = db2.prepare(`PRAGMA table_info(recordings)`);
    let hasMigrationStatus = false;
    while (tableInfoStmt.step()) {
      const col = tableInfoStmt.getAsObject();
      if (col.name === "migration_status") {
        hasMigrationStatus = true;
        break;
      }
    }
    tableInfoStmt.free();
    if (hasMigrationStatus) {
      const stmt = db2.prepare(`
        SELECT
          SUM(CASE WHEN migration_status IS NULL OR migration_status = 'pending' THEN 1 ELSE 0 END) as pending,
          SUM(CASE WHEN migration_status = 'migrated' THEN 1 ELSE 0 END) as migrated,
          SUM(CASE WHEN migration_status = 'skipped' THEN 1 ELSE 0 END) as skipped,
          COUNT(*) as total
        FROM recordings
      `);
      stmt.step();
      const row = stmt.getAsObject();
      status.pending = row.pending || 0;
      status.migrated = row.migrated || 0;
      status.skipped = row.skipped || 0;
      status.total = row.total || 0;
      stmt.free();
    } else {
      const stmt = db2.prepare(`SELECT COUNT(*) as total FROM recordings`);
      stmt.step();
      const row = stmt.getAsObject();
      status.pending = row.total || 0;
      status.total = row.total || 0;
      stmt.free();
    }
  } catch (error2) {
    console.error("Failed to get migration status:", error2);
  }
  return status;
}
let mainWindowRef = null;
function setMainWindowForMigration(window) {
  mainWindowRef = window;
}
function registerMigrationHandlers() {
  electron.ipcMain.handle("migration:previewCleanup", async () => {
    try {
      return await generateCleanupPreviewImpl();
    } catch (error2) {
      console.error("Failed to preview cleanup:", error2);
      return {
        orphanedTranscripts: [],
        duplicateRecordings: [],
        invalidMeetingRefs: [],
        error: sanitizeError(error2)
      };
    }
  });
  electron.ipcMain.handle("migration:runCleanup", async () => {
    try {
      return await runPreMigrationCleanupImpl();
    } catch (error2) {
      console.error("Failed to run cleanup:", error2);
      return {
        success: false,
        orphanedTranscriptsRemoved: 0,
        duplicateRecordingsRemoved: 0,
        invalidMeetingRefsFixed: 0,
        errors: [sanitizeError(error2)]
      };
    }
  });
  electron.ipcMain.handle("migration:runV11", async () => {
    try {
      return await migrateToV11Impl(mainWindowRef);
    } catch (error2) {
      console.error("Failed to run migration:", error2);
      return {
        success: false,
        capturesCreated: 0,
        errors: [sanitizeError(error2)],
        verified: false
      };
    }
  });
  electron.ipcMain.handle("migration:rollbackV11", async () => {
    try {
      return await rollbackV11MigrationImpl();
    } catch (error2) {
      console.error("Failed to rollback migration:", error2);
      return {
        success: false,
        errors: [sanitizeError(error2)]
      };
    }
  });
  electron.ipcMain.handle("migration:getStatus", async () => {
    try {
      return await getMigrationStatusImpl();
    } catch (error2) {
      console.error("Failed to get migration status:", error2);
      return {
        pending: 0,
        migrated: 0,
        skipped: 0,
        total: 0,
        error: sanitizeError(error2)
      };
    }
  });
}
class DownloadService {
  state = {
    queue: /* @__PURE__ */ new Map(),
    currentSession: null,
    isProcessing: false,
    isPaused: false
  };
  // Device download function - will be injected from renderer
  deviceDownloadFn = null;
  constructor() {
    console.log("[DownloadService] Initialized");
  }
  /**
   * Check if a file needs to be downloaded
   * Reconciles database, synced_files table, and actual files on disk
   */
  isFileAlreadySynced(filename) {
    if (isFileSynced(filename)) {
      return { synced: true, reason: "In synced_files table" };
    }
    const wavFilename = filename.replace(/\.hda$/i, ".wav");
    if (wavFilename !== filename && isFileSynced(wavFilename)) {
      return { synced: true, reason: "WAV version in synced_files" };
    }
    const recordingsPath = getRecordingsPath();
    const filePath = path.join(recordingsPath, wavFilename);
    if (fs.existsSync(filePath)) {
      console.log(`[DownloadService] Found orphaned file on disk: ${wavFilename}, adding to synced_files`);
      addSyncedFile(filename, wavFilename, filePath);
      return { synced: true, reason: "File exists on disk (reconciled)" };
    }
    const recording = getRecordingByFilename(filename) || getRecordingByFilename(wavFilename);
    if (recording && recording.file_path && fs.existsSync(recording.file_path)) {
      console.log(`[DownloadService] Found in recordings table: ${filename}`);
      addSyncedFile(filename, path.basename(recording.file_path), recording.file_path);
      return { synced: true, reason: "In recordings table with valid file" };
    }
    return { synced: false, reason: "Not found anywhere" };
  }
  /**
   * Get files that need to be synced from a list
   */
  getFilesToSync(deviceFiles) {
    const results = [];
    for (const file of deviceFiles) {
      const { synced, reason } = this.isFileAlreadySynced(file.filename);
      if (synced) {
        console.log(`[DownloadService] Skipping ${file.filename}: ${reason}`);
      }
      results.push({ ...file, skipReason: synced ? reason : void 0 });
    }
    return results;
  }
  /**
   * Add files to download queue
   */
  queueDownloads(files) {
    const queuedIds = [];
    for (const file of files) {
      if (this.state.queue.has(file.filename)) {
        console.log(`[DownloadService] ${file.filename} already in queue, skipping`);
        continue;
      }
      const { synced } = this.isFileAlreadySynced(file.filename);
      if (synced) {
        console.log(`[DownloadService] ${file.filename} already synced, skipping`);
        continue;
      }
      const item = {
        id: file.filename,
        // Use filename as ID for simplicity
        filename: file.filename,
        fileSize: file.size,
        progress: 0,
        status: "pending"
      };
      this.state.queue.set(file.filename, item);
      queuedIds.push(file.filename);
      console.log(`[DownloadService] Queued: ${file.filename} (${(file.size / 1024 / 1024).toFixed(1)} MB)`);
    }
    this.emitStateUpdate();
    return queuedIds;
  }
  /**
   * Start a sync session
   */
  startSyncSession(files) {
    this.queueDownloads(files);
    const session = {
      id: `sync_${Date.now()}`,
      totalFiles: this.state.queue.size,
      completedFiles: 0,
      failedFiles: 0,
      startedAt: /* @__PURE__ */ new Date(),
      status: "active"
    };
    this.state.currentSession = session;
    this.emitStateUpdate();
    console.log(`[DownloadService] Started sync session ${session.id} with ${session.totalFiles} files`);
    return session;
  }
  /**
   * Process download queue - called with data from renderer
   * The actual USB communication happens in the renderer, but state is managed here
   */
  async processDownload(filename, data) {
    const item = this.state.queue.get(filename);
    if (!item) {
      return { success: false, error: "File not in queue" };
    }
    try {
      item.status = "downloading";
      item.startedAt = /* @__PURE__ */ new Date();
      this.emitStateUpdate();
      const filePath = await saveRecording(filename, data);
      const wavFilename = filename.replace(/\.hda$/i, ".wav");
      addSyncedFile(filename, path.basename(filePath), filePath, data.length);
      markRecordingDownloaded(filename, filePath);
      if (wavFilename !== filename) {
        markRecordingDownloaded(wavFilename, filePath);
      }
      item.status = "completed";
      item.progress = 100;
      item.completedAt = /* @__PURE__ */ new Date();
      if (this.state.currentSession) {
        this.state.currentSession.completedFiles++;
      }
      this.emitStateUpdate();
      console.log(`[DownloadService] Completed: ${filename}`);
      return { success: true, filePath };
    } catch (error2) {
      const errorMsg = error2 instanceof Error ? error2.message : "Unknown error";
      console.error(`[DownloadService] Failed: ${filename} - ${errorMsg}`);
      item.status = "failed";
      item.error = errorMsg;
      if (this.state.currentSession) {
        this.state.currentSession.failedFiles++;
      }
      this.emitStateUpdate();
      return { success: false, error: errorMsg };
    }
  }
  /**
   * Update progress for a download
   */
  updateProgress(filename, bytesReceived) {
    const item = this.state.queue.get(filename);
    if (item) {
      item.progress = Math.round(bytesReceived / item.fileSize * 100);
      this.emitStateUpdate();
    }
  }
  /**
   * Mark download as failed
   */
  markFailed(filename, error2) {
    const item = this.state.queue.get(filename);
    if (item) {
      item.status = "failed";
      item.error = error2;
      if (this.state.currentSession) {
        this.state.currentSession.failedFiles++;
      }
      this.emitStateUpdate();
    }
  }
  /**
   * Remove completed/failed items from queue
   */
  clearCompleted() {
    for (const [key, item] of this.state.queue) {
      if (item.status === "completed" || item.status === "failed") {
        this.state.queue.delete(key);
      }
    }
    this.emitStateUpdate();
  }
  /**
   * Cancel all pending downloads
   */
  cancelAll() {
    this.state.isPaused = true;
    for (const item of this.state.queue.values()) {
      if (item.status === "pending") {
        item.status = "failed";
        item.error = "Cancelled";
      }
    }
    if (this.state.currentSession) {
      this.state.currentSession.status = "cancelled";
    }
    this.emitStateUpdate();
  }
  /**
   * Get current state
   */
  getState() {
    return {
      queue: Array.from(this.state.queue.values()),
      session: this.state.currentSession,
      isProcessing: this.state.isProcessing,
      isPaused: this.state.isPaused
    };
  }
  /**
   * Get sync statistics
   */
  getSyncStats() {
    const syncedFiles = getSyncedFilenames();
    let pending = 0;
    let failed = 0;
    for (const item of this.state.queue.values()) {
      if (item.status === "pending" || item.status === "downloading") {
        pending++;
      } else if (item.status === "failed") {
        failed++;
      }
    }
    return {
      totalSynced: syncedFiles.size,
      pendingInQueue: pending,
      failedInQueue: failed
    };
  }
  /**
   * Emit state update to all renderer windows
   */
  emitStateUpdate() {
    const state = this.getState();
    const windows = electron.BrowserWindow.getAllWindows();
    for (const win of windows) {
      if (!win.isDestroyed()) {
        win.webContents.send("download-service:state-update", state);
      }
    }
  }
}
let downloadServiceInstance = null;
function getDownloadService() {
  if (!downloadServiceInstance) {
    downloadServiceInstance = new DownloadService();
  }
  return downloadServiceInstance;
}
function registerDownloadServiceHandlers() {
  const service = getDownloadService();
  electron.ipcMain.handle("download-service:get-state", () => {
    return service.getState();
  });
  electron.ipcMain.handle("download-service:is-file-synced", (_, filename) => {
    return service.isFileAlreadySynced(filename);
  });
  electron.ipcMain.handle("download-service:get-files-to-sync", (_, files) => {
    return service.getFilesToSync(files);
  });
  electron.ipcMain.handle("download-service:queue-downloads", (_, files) => {
    return service.queueDownloads(files);
  });
  electron.ipcMain.handle("download-service:start-session", (_, files) => {
    return service.startSyncSession(files);
  });
  electron.ipcMain.handle("download-service:process-download", async (_, filename, data) => {
    const buffer = Buffer.from(data);
    return service.processDownload(filename, buffer);
  });
  electron.ipcMain.handle("download-service:update-progress", (_, filename, bytesReceived) => {
    service.updateProgress(filename, bytesReceived);
  });
  electron.ipcMain.handle("download-service:mark-failed", (_, filename, error2) => {
    service.markFailed(filename, error2);
  });
  electron.ipcMain.handle("download-service:clear-completed", () => {
    service.clearCompleted();
  });
  electron.ipcMain.handle("download-service:cancel-all", () => {
    service.cancelAll();
  });
  electron.ipcMain.handle("download-service:get-stats", () => {
    return service.getSyncStats();
  });
  console.log("[DownloadService] IPC handlers registered");
}
function registerIpcHandlers() {
  registerConfigHandlers();
  registerDatabaseHandlers();
  registerCalendarHandlers();
  registerStorageHandlers();
  registerRecordingHandlers();
  registerRAGHandlers();
  registerAppHandlers();
  registerContactsHandlers();
  registerProjectsHandlers();
  registerOutputsHandlers();
  registerQualityHandlers();
  registerMigrationHandlers();
  registerDownloadServiceHandlers();
  console.log("All IPC handlers registered");
}
const USB_VENDOR_ID = 4310;
const USB_PRODUCT_IDS = [44812, 44813, 45069, 44814, 45070];
let mainWindow = null;
function createWindow() {
  mainWindow = new electron.BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 1e3,
    minHeight: 700,
    show: false,
    autoHideMenuBar: true,
    titleBarStyle: "hiddenInset",
    trafficLightPosition: { x: 15, y: 15 },
    webPreferences: {
      preload: path.join(__dirname, "../preload/index.js"),
      sandbox: false,
      contextIsolation: true,
      nodeIntegration: false
    }
  });
  mainWindow.on("ready-to-show", () => {
    mainWindow?.show();
  });
  mainWindow.webContents.setWindowOpenHandler((details) => {
    electron.shell.openExternal(details.url);
    return { action: "deny" };
  });
  if (utils.is.dev && process.env["ELECTRON_RENDERER_URL"]) {
    mainWindow.loadURL(process.env["ELECTRON_RENDERER_URL"]);
  } else {
    mainWindow.loadFile(path.join(__dirname, "../renderer/index.html"));
  }
}
async function initializeServices() {
  console.log("Initializing services...");
  await initializeConfig();
  console.log("Config initialized");
  await initializeFileStorage();
  console.log("File storage initialized");
  await initializeDatabase();
  console.log("Database initialized");
  const vectorStore = getVectorStore();
  await vectorStore.initialize();
  console.log("Vector store initialized");
  const rag = getRAGService();
  await rag.initialize();
  console.log("RAG service initialized");
  getStoragePolicyService();
  console.log("Storage policy service initialized");
  registerIpcHandlers();
  console.log("IPC handlers registered");
}
electron.app.whenReady().then(async () => {
  utils.electronApp.setAppUserModelId("com.hidock.meeting-intelligence");
  electron.app.on("browser-window-created", (_, window) => {
    utils.optimizer.watchWindowShortcuts(window);
  });
  electron.session.defaultSession.on("select-usb-device", (event, details, callback) => {
    console.log("=== USB DEVICE SELECTION ===");
    console.log("Available devices:", details.deviceList.map((d) => ({
      vendorId: d.vendorId.toString(16),
      productId: d.productId.toString(16),
      productName: d.productName
    })));
    const hidockDevice = details.deviceList.find(
      (device) => device.vendorId === USB_VENDOR_ID && (USB_PRODUCT_IDS.includes(device.productId) || device.productName?.toLowerCase().includes("hidock"))
    );
    if (hidockDevice) {
      console.log("Auto-selecting HiDock device:", hidockDevice.productName);
      callback(hidockDevice.deviceId);
    } else if (details.deviceList.length > 0) {
      const vendorDevice = details.deviceList.find((d) => d.vendorId === USB_VENDOR_ID);
      if (vendorDevice) {
        console.log("Auto-selecting vendor device:", vendorDevice.productName);
        callback(vendorDevice.deviceId);
      } else {
        console.log("No matching device found");
        callback();
      }
    } else {
      console.log("No USB devices available");
      callback();
    }
  });
  electron.session.defaultSession.setPermissionCheckHandler((webContents, permission, requestingOrigin, details) => {
    if (permission === "usb") {
      return true;
    }
    return true;
  });
  electron.session.defaultSession.setDevicePermissionHandler((details) => {
    if (details.deviceType === "usb") {
      return true;
    }
    return false;
  });
  await initializeServices();
  createWindow();
  if (mainWindow) {
    setMainWindow(mainWindow);
    setMainWindowForTranscription(mainWindow);
    setMainWindowForEventBus(mainWindow);
    setMainWindowForMigration(mainWindow);
  }
  startRecordingWatcher();
  startTranscriptionProcessor();
  console.log("Background services started");
  electron.app.on("activate", function() {
    if (electron.BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});
electron.app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    electron.app.quit();
  }
});
electron.app.on("before-quit", () => {
  stopRecordingWatcher();
  stopTranscriptionProcessor();
  closeDatabase();
  console.log("Cleanup complete");
});
