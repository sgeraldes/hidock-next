import initSqlJs, { Database as SqlJsDatabase } from 'sql.js'
import { existsSync, readFileSync, writeFileSync } from 'fs'
import { getDatabasePath } from './file-storage'

let db: SqlJsDatabase | null = null
let dbPath: string = ''

const SCHEMA_VERSION = 9

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

-- Indexes for performance
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
  }
}

function runMigrations(currentVersion: number): void {
  for (let v = currentVersion + 1; v <= SCHEMA_VERSION; v++) {
    const migration = MIGRATIONS[v]
    if (migration) {
      console.log(`Running migration to v${v}...`)
      migration()
    }
    // Record the migration
    getDatabase().run('INSERT OR REPLACE INTO schema_version (version) VALUES (?)', [v])
  }
}

export async function initializeDatabase(): Promise<void> {
  dbPath = getDatabasePath()

  try {
    // Initialize SQL.js
    const SQL = await initSqlJs()

    // Load existing database or create new one
    if (existsSync(dbPath)) {
      const fileBuffer = readFileSync(dbPath)
      db = new SQL.Database(fileBuffer)
    } else {
      db = new SQL.Database()
    }

    // Run schema (all CREATE IF NOT EXISTS statements are idempotent)
    db.run(SCHEMA)

    // Check current schema version and run migrations if needed
    const versionResult = db.exec('SELECT version FROM schema_version ORDER BY version DESC LIMIT 1')
    const currentVersion =
      versionResult.length > 0 && versionResult[0].values.length > 0
        ? (versionResult[0].values[0][0] as number)
        : 0

    if (currentVersion < SCHEMA_VERSION) {
      runMigrations(currentVersion)
      console.log(`Database migrated from v${currentVersion} to v${SCHEMA_VERSION}`)
    } else if (currentVersion === 0) {
      // Fresh database, insert initial version
      db.run('INSERT INTO schema_version (version) VALUES (?)', [SCHEMA_VERSION])
    }

    // Save to disk
    saveDatabase()

    console.log(`Database initialized at ${dbPath} (schema v${SCHEMA_VERSION})`)
  } catch (error) {
    console.error('Failed to initialize database:', error)
    throw error
  }
}

export function saveDatabase(): void {
  if (db && dbPath) {
    const data = db.export()
    const buffer = Buffer.from(data)
    writeFileSync(dbPath, buffer)
  }
}

export function getDatabase(): SqlJsDatabase {
  if (!db) {
    throw new Error('Database not initialized')
  }
  return db
}

export function closeDatabase(): void {
  if (db) {
    saveDatabase()
    db.close()
    db = null
  }
}

// Generic query helpers
export function queryAll<T>(sql: string, params: unknown[] = []): T[] {
  const stmt = getDatabase().prepare(sql)
  stmt.bind(params)

  const results: T[] = []
  while (stmt.step()) {
    const row = stmt.getAsObject()
    results.push(row as T)
  }
  stmt.free()

  return results
}

export function queryOne<T>(sql: string, params: unknown[] = []): T | undefined {
  const results = queryAll<T>(sql, params)
  return results[0]
}

export function run(sql: string, params: unknown[] = []): void {
  getDatabase().run(sql, params)
  saveDatabase()
}

// Internal run that doesn't auto-save (for use within transactions)
function runNoSave(sql: string, params: unknown[] = []): void {
  getDatabase().run(sql, params)
}

/**
 * Execute a function within a database transaction.
 * Automatically handles BEGIN/COMMIT/ROLLBACK and saves only on success.
 * Use this for operations that must be atomic (all-or-nothing).
 */
export function runInTransaction<T>(fn: () => T): T {
  const database = getDatabase()
  database.run('BEGIN TRANSACTION')
  try {
    const result = fn()
    database.run('COMMIT')
    saveDatabase()
    return result
  } catch (error) {
    database.run('ROLLBACK')
    throw error
  }
}

export function runMany(sql: string, items: unknown[][]): void {
  const stmt = getDatabase().prepare(sql)
  for (const item of items) {
    stmt.bind(item)
    stmt.step()
    stmt.reset()
  }
  stmt.free()
  saveDatabase()
}

/**
 * Batch upsert multiple meetings atomically.
 * Used by calendar sync to ensure all-or-nothing behavior.
 * If any meeting fails to upsert, the entire batch is rolled back.
 */
export function upsertMeetingsBatch(meetings: Omit<Meeting, 'created_at' | 'updated_at'>[]): void {
  if (meetings.length === 0) return

  runInTransaction(() => {
    for (const meeting of meetings) {
      const existing = getMeetingById(meeting.id)

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
        )
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
  location?: string
  organizer_name?: string
  organizer_email?: string
  attendees?: string
  description?: string
  is_recurring: number
  recurrence_rule?: string
  meeting_url?: string
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
      )
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
      )
    }
    // Extract contacts from meeting attendees (uses runNoSave internally)
    extractContactsFromMeetingDataInternal(meeting)
  })
}

/**
 * Extract contacts from meeting attendees and organizer.
 * Internal version using runNoSave - must be called within a transaction.
 */
function extractContactsFromMeetingDataInternal(meeting: Omit<Meeting, 'created_at' | 'updated_at'>): void {
  // Handle organizer
  if (meeting.organizer_email || meeting.organizer_name) {
    const existing = meeting.organizer_email ? getContactByEmail(meeting.organizer_email) : undefined
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

  // Handle attendees
  if (meeting.attendees) {
    try {
      const attendees = JSON.parse(meeting.attendees)
      for (const attendee of attendees) {
        if (!attendee.email && !attendee.name) continue

        const existing = attendee.email ? getContactByEmail(attendee.email) : undefined
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
    } catch (e) {
      // Invalid JSON, skip
    }
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
}

export function getRecordings(): Recording[] {
  return queryAll<Recording>('SELECT * FROM recordings ORDER BY date_recorded DESC')
}

export function getRecordingById(id: string): Recording | undefined {
  return queryOne<Recording>('SELECT * FROM recordings WHERE id = ?', [id])
}

export function getRecordingsForMeeting(meetingId: string): Recording[] {
  return queryAll<Recording>('SELECT * FROM recordings WHERE meeting_id = ?', [meetingId])
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

// Mark recording as downloaded
export function markRecordingDownloaded(filename: string, localPath: string): void {
  const recording = getRecordingByFilename(filename)
  if (recording) {
    const newLocation = recording.on_device ? 'both' : 'local-only'
    updateRecordingLifecycle(recording.id, {
      file_path: localPath,
      on_local: 1,
      location: newLocation as Recording['location']
    })
  }
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
  )
}

export function updateRecordingStatus(id: string, status: string): void {
  run('UPDATE recordings SET status = ? WHERE id = ?', [status, id])
}

export function linkRecordingToMeeting(
  recordingId: string,
  meetingId: string,
  confidence: number,
  method: string
): void {
  run(
    `UPDATE recordings SET meeting_id = ?, correlation_confidence = ?, correlation_method = ? WHERE id = ?`,
    [meetingId, confidence, method, recordingId]
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
      transcript.sentiment ?? null,
      transcript.speakers ?? null,
      transcript.word_count ?? null,
      transcript.transcription_provider ?? null,
      transcript.transcription_model ?? null
    ]
  )
}

/**
 * Escape special LIKE pattern characters to prevent SQL injection via wildcards.
 * In SQLite LIKE, % matches any sequence and _ matches any single character.
 * We escape them with \ and specify ESCAPE '\' in the query.
 */
function escapeLikePattern(pattern: string): string {
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
  error_message?: string
  created_at: string
  started_at?: string
  completed_at?: string
}

export function addToQueue(recordingId: string): string {
  const id = crypto.randomUUID()
  run('INSERT INTO transcription_queue (id, recording_id) VALUES (?, ?)', [id, recordingId])
  return id
}

export function getQueueItems(status?: string): QueueItem[] {
  if (status) {
    return queryAll<QueueItem>('SELECT * FROM transcription_queue WHERE status = ? ORDER BY created_at', [status])
  }
  return queryAll<QueueItem>('SELECT * FROM transcription_queue ORDER BY created_at')
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
  } else {
    run('UPDATE transcription_queue SET status = ? WHERE id = ?', [status, id])
  }
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
  notes: string | null
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

export function getContacts(search?: string, limit = 100, offset = 0): { contacts: Contact[]; total: number } {
  let countSql = 'SELECT COUNT(*) as count FROM contacts'
  let sql = 'SELECT * FROM contacts'
  const params: unknown[] = []

  if (search) {
    const escaped = escapeLikePattern(search)
    const searchClause = " WHERE name LIKE ? ESCAPE '\\' OR email LIKE ? ESCAPE '\\'"
    countSql += searchClause
    sql += searchClause
    params.push(`%${escaped}%`, `%${escaped}%`)
  }

  sql += ' ORDER BY meeting_count DESC, last_seen_at DESC LIMIT ? OFFSET ?'

  const countResult = queryOne<{ count: number }>(countSql, params)
  const contacts = queryAll<Contact>(sql, [...params, limit, offset])

  return { contacts, total: countResult?.count ?? 0 }
}

export function getContactById(id: string): Contact | undefined {
  return queryOne<Contact>('SELECT * FROM contacts WHERE id = ?', [id])
}

export function getContactByEmail(email: string): Contact | undefined {
  return queryOne<Contact>('SELECT * FROM contacts WHERE email = ?', [email])
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
      `INSERT INTO contacts (id, name, email, notes, first_seen_at, last_seen_at, meeting_count)
      VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [
        contact.id,
        contact.name,
        contact.email,
        contact.notes,
        contact.first_seen_at,
        contact.last_seen_at,
        contact.meeting_count
      ]
    )
    return { ...contact, created_at: new Date().toISOString() }
  }
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

export function linkContactToMeeting(meetingId: string, contactId: string, role: ContactRole): void {
  run(
    'INSERT OR IGNORE INTO meeting_contacts (meeting_id, contact_id, role) VALUES (?, ?, ?)',
    [meetingId, contactId, role]
  )
}

// =============================================================================
// Project queries
// =============================================================================

export interface Project {
  id: string
  name: string
  description: string | null
  created_at: string
}

export interface MeetingProject {
  meeting_id: string
  project_id: string
}

export function getProjects(search?: string, limit = 100, offset = 0): { projects: Project[]; total: number } {
  let countSql = 'SELECT COUNT(*) as count FROM projects'
  let sql = 'SELECT * FROM projects'
  const params: unknown[] = []

  if (search) {
    const escaped = escapeLikePattern(search)
    const searchClause = " WHERE name LIKE ? ESCAPE '\\' OR description LIKE ? ESCAPE '\\'"
    countSql += searchClause
    sql += searchClause
    params.push(`%${escaped}%`, `%${escaped}%`)
  }

  sql += ' ORDER BY created_at DESC LIMIT ? OFFSET ?'

  const countResult = queryOne<{ count: number }>(countSql, params)
  const projects = queryAll<Project>(sql, [...params, limit, offset])

  return { projects, total: countResult?.count ?? 0 }
}

export function getProjectById(id: string): Project | undefined {
  return queryOne<Project>('SELECT * FROM projects WHERE id = ?', [id])
}

export function createProject(project: Omit<Project, 'created_at'>): Project {
  run(
    'INSERT INTO projects (id, name, description) VALUES (?, ?, ?)',
    [project.id, project.name, project.description]
  )
  return { ...project, created_at: new Date().toISOString() }
}

export function updateProject(id: string, name?: string, description?: string): void {
  const updates: string[] = []
  const params: unknown[] = []

  if (name !== undefined) {
    updates.push('name = ?')
    params.push(name)
  }
  if (description !== undefined) {
    updates.push('description = ?')
    params.push(description)
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

// =============================================================================
// Contact extraction from meeting attendees
// =============================================================================

export function extractContactsFromMeeting(meeting: Meeting): void {
  // Extract organizer as contact
  if (meeting.organizer_email) {
    const organizerContact = upsertContact({
      id: crypto.randomUUID(),
      name: meeting.organizer_name || meeting.organizer_email,
      email: meeting.organizer_email,
      notes: null,
      first_seen_at: meeting.start_time,
      last_seen_at: meeting.start_time,
      meeting_count: 1
    })
    linkContactToMeeting(meeting.id, organizerContact.id, 'organizer')
  }

  // Extract attendees as contacts
  if (meeting.attendees) {
    try {
      const attendees = JSON.parse(meeting.attendees) as Array<{ name?: string; email?: string }>
      for (const attendee of attendees) {
        if (attendee.email) {
          const attendeeContact = upsertContact({
            id: crypto.randomUUID(),
            name: attendee.name || attendee.email,
            email: attendee.email,
            notes: null,
            first_seen_at: meeting.start_time,
            last_seen_at: meeting.start_time,
            meeting_count: 1
          })
          linkContactToMeeting(meeting.id, attendeeContact.id, 'attendee')
        }
      }
    } catch {
      // Invalid JSON, skip attendee extraction
      console.warn(`Failed to parse attendees JSON for meeting ${meeting.id}`)
    }
  }
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
}

export function getCandidatesForRecordingWithDetails(recordingId: string): MeetingCandidateWithDetails[] {
  if (!recordingId || typeof recordingId !== 'string') return []

  const sql = `
    SELECT c.id, c.recording_id, c.meeting_id, c.confidence_score, c.match_reason,
      c.is_ai_selected, c.is_user_confirmed, m.subject, m.start_time, m.end_time
    FROM recording_meeting_candidates c
    JOIN meetings m ON m.id = c.meeting_id
    WHERE c.recording_id = ?
    ORDER BY c.confidence_score DESC LIMIT 20
  `

  try {
    const rows = queryAll<{
      id: string; recording_id: string; meeting_id: string; confidence_score: number
      match_reason: string | null; is_ai_selected: number; is_user_confirmed: number
      subject: string; start_time: string; end_time: string
    }>(sql, [recordingId])

    return rows.map(r => ({
      id: r.id, recordingId: r.recording_id, meetingId: r.meeting_id,
      subject: r.subject, startTime: r.start_time, endTime: r.end_time,
      confidenceScore: r.confidence_score, matchReason: r.match_reason,
      isAiSelected: r.is_ai_selected === 1, isUserConfirmed: r.is_user_confirmed === 1
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
  getDatabase().run("UPDATE recordings SET status = 'pending' WHERE status = 'transcribing'")
  getDatabase().run("UPDATE transcription_queue SET status = 'pending' WHERE status = 'processing'")
  console.log('[Database] Reset stuck transcriptions check complete')
  return { recordingsReset: 0, queueItemsReset: 0 }
}
