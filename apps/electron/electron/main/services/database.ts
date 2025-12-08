import initSqlJs, { Database as SqlJsDatabase } from 'sql.js'
import { existsSync, readFileSync, writeFileSync } from 'fs'
import { getDatabasePath } from './file-storage'

let db: SqlJsDatabase | null = null
let dbPath: string = ''

const SCHEMA_VERSION = 1

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
    file_path TEXT NOT NULL,
    file_size INTEGER,
    duration_seconds REAL,
    date_recorded TEXT NOT NULL,
    meeting_id TEXT,
    correlation_confidence REAL,
    correlation_method TEXT,
    status TEXT DEFAULT 'pending',
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
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

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_meetings_start_time ON meetings(start_time);
CREATE INDEX IF NOT EXISTS idx_recordings_date ON recordings(date_recorded);
CREATE INDEX IF NOT EXISTS idx_recordings_meeting ON recordings(meeting_id);
CREATE INDEX IF NOT EXISTS idx_recordings_status ON recordings(status);
CREATE INDEX IF NOT EXISTS idx_transcripts_recording ON transcripts(recording_id);
CREATE INDEX IF NOT EXISTS idx_embeddings_transcript ON embeddings(transcript_id);
CREATE INDEX IF NOT EXISTS idx_queue_status ON transcription_queue(status);
CREATE INDEX IF NOT EXISTS idx_synced_original ON synced_files(original_filename);
`

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

    // Run schema
    db.run(SCHEMA)

    // Check and update schema version
    const versionResult = db.exec('SELECT version FROM schema_version ORDER BY version DESC LIMIT 1')
    if (versionResult.length === 0 || versionResult[0].values.length === 0) {
      db.run('INSERT INTO schema_version (version) VALUES (?)', [SCHEMA_VERSION])
    }

    // Save to disk
    saveDatabase()

    console.log(`Database initialized at ${dbPath}`)
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

export function upsertMeeting(meeting: Omit<Meeting, 'created_at' | 'updated_at'>): void {
  // Check if meeting exists
  const existing = getMeetingById(meeting.id)

  if (existing) {
    run(
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
    run(
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
}

// Recording queries
export interface Recording {
  id: string
  filename: string
  original_filename?: string
  file_path: string
  file_size?: number
  duration_seconds?: number
  date_recorded: string
  meeting_id?: string
  correlation_confidence?: number
  correlation_method?: string
  status: string
  created_at: string
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

// Full-text search (simple LIKE-based for sql.js)
export function searchTranscripts(query: string): Transcript[] {
  return queryAll<Transcript>(
    `SELECT * FROM transcripts WHERE full_text LIKE ? OR summary LIKE ? OR topics LIKE ?`,
    [`%${query}%`, `%${query}%`, `%${query}%`]
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
