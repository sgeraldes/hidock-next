import Database from 'better-sqlite3'

export type RecordingStatus = 'on-device' | 'downloaded' | 'transcribed' | 'summarized'
export type TranscriptStatus = 'none' | 'queued' | 'complete' | 'failed'
export type TaskStatus = 'open' | 'done' | 'disregarded'
export type TaskLane = 'inbox' | 'mine' | 'watching' | 'done' | 'disregarded'
export type TaskPriority = 'low' | 'normal' | 'high'
export type SyncRunStatus = 'running' | 'ready' | 'failed'

export interface DashboardSummary {
  recordingCount: number
  taskCount: number
  openTaskCount: number
  lastSyncStatus: string
}

export interface RecordingRow {
  id: string
  title: string
  recordedAt: string
  durationSeconds: number
  status: RecordingStatus
  transcriptStatus: TranscriptStatus
}

export interface TranscriptRow {
  id: string
  recordingId: string
  text: string
  createdAt: string
}

export interface SummaryRow {
  id: string
  recordingId: string
  text: string
  modelId: string
  createdAt: string
}

export interface TaskRow {
  id: string
  title: string
  sourceRecordingId: string | null
  dueAt: string | null
  status: TaskStatus
  lane: TaskLane
  priority: TaskPriority
}

export interface TaskEventRow {
  id: string
  taskId: string
  eventType: string
  payload: Record<string, unknown>
  createdAt: string
}

export interface SyncRunRow {
  id: string
  status: SyncRunStatus
  message: string | null
  startedAt: string
  finishedAt: string | null
}

export interface RecordingDetail {
  recording: RecordingRow
  transcript: TranscriptRow | null
  summary: SummaryRow | null
  tasks: TaskRow[]
}

export interface RecordingInput {
  id: string
  title: string
  recordedAt: string
  durationSeconds: number
  status: RecordingStatus
  transcriptStatus: TranscriptStatus
  localPath?: string | null
}

export interface TranscriptInput {
  id: string
  recordingId: string
  text: string
  createdAt?: string
}

export interface SummaryInput {
  id: string
  recordingId: string
  text: string
  modelId: string
  createdAt?: string
}

export interface TaskInput {
  id: string
  title: string
  sourceRecordingId: string | null
  dueAt: string | null
  status: TaskStatus
  lane: TaskLane
  priority: TaskPriority
}

export interface TaskUpdatePatch {
  title?: string
  sourceRecordingId?: string | null
  dueAt?: string | null
  status?: TaskStatus
  lane?: TaskLane
  priority?: TaskPriority
}

interface CountRow {
  count: number
}

export class RecordingRepository {
  constructor(private readonly db: Database.Database) {}

  count(): number {
    return (this.db.prepare('SELECT COUNT(*) as count FROM recordings').get() as CountRow).count
  }

  list(): RecordingRow[] {
    return this.db
      .prepare(
        `SELECT id, title, recorded_at as recordedAt, duration_seconds as durationSeconds, status, transcript_status as transcriptStatus
         FROM recordings
         ORDER BY recorded_at DESC`
      )
      .all() as RecordingRow[]
  }

  getById(id: string): RecordingRow | null {
    return (
      (this.db
        .prepare(
          `SELECT id, title, recorded_at as recordedAt, duration_seconds as durationSeconds, status, transcript_status as transcriptStatus
           FROM recordings
           WHERE id = ?`
        )
        .get(id) as RecordingRow | undefined) ?? null
    )
  }

  upsert(input: RecordingInput): void {
    this.db
      .prepare(
        `INSERT INTO recordings (id, title, recorded_at, duration_seconds, status, transcript_status, local_path, updated_at)
         VALUES (@id, @title, @recordedAt, @durationSeconds, @status, @transcriptStatus, @localPath, CURRENT_TIMESTAMP)
         ON CONFLICT(id) DO UPDATE SET
           title = excluded.title,
           recorded_at = excluded.recorded_at,
           duration_seconds = excluded.duration_seconds,
           status = excluded.status,
           transcript_status = excluded.transcript_status,
           local_path = excluded.local_path,
           updated_at = CURRENT_TIMESTAMP`
      )
      .run({ ...input, localPath: input.localPath ?? null })
  }
}

export class TranscriptRepository {
  constructor(private readonly db: Database.Database) {}

  getByRecordingId(recordingId: string): TranscriptRow | null {
    return (
      (this.db
        .prepare(
          `SELECT id, recording_id as recordingId, text, created_at as createdAt
           FROM transcripts
           WHERE recording_id = ?
           ORDER BY created_at DESC
           LIMIT 1`
        )
        .get(recordingId) as TranscriptRow | undefined) ?? null
    )
  }

  upsert(input: TranscriptInput): void {
    this.db
      .prepare(
        `INSERT INTO transcripts (id, recording_id, text, created_at)
         VALUES (@id, @recordingId, @text, COALESCE(@createdAt, CURRENT_TIMESTAMP))
         ON CONFLICT(id) DO UPDATE SET text = excluded.text`
      )
      .run({ ...input, createdAt: input.createdAt ?? null })
  }
}

export class SummaryRepository {
  constructor(private readonly db: Database.Database) {}

  getLatestByRecordingId(recordingId: string): SummaryRow | null {
    return (
      (this.db
        .prepare(
          `SELECT id, recording_id as recordingId, text, model_id as modelId, created_at as createdAt
           FROM summaries
           WHERE recording_id = ?
           ORDER BY created_at DESC
           LIMIT 1`
        )
        .get(recordingId) as SummaryRow | undefined) ?? null
    )
  }

  create(input: SummaryInput): void {
    this.db
      .prepare(
        `INSERT INTO summaries (id, recording_id, text, model_id, created_at)
         VALUES (@id, @recordingId, @text, @modelId, COALESCE(@createdAt, CURRENT_TIMESTAMP))`
      )
      .run({ ...input, createdAt: input.createdAt ?? null })
  }
}

export class TaskRepository {
  constructor(private readonly db: Database.Database) {}

  count(): number {
    return (this.db.prepare('SELECT COUNT(*) as count FROM tasks').get() as CountRow).count
  }

  countOpen(): number {
    return (this.db.prepare("SELECT COUNT(*) as count FROM tasks WHERE status = 'open'").get() as CountRow).count
  }

  list(): TaskRow[] {
    return this.db
      .prepare(
        `SELECT id, title, source_recording_id as sourceRecordingId, due_at as dueAt, status, lane, priority
         FROM tasks
         ORDER BY lane ASC, due_at IS NULL ASC, due_at ASC, created_at DESC`
      )
      .all() as TaskRow[]
  }

  getById(id: string): TaskRow | null {
    return (
      (this.db
        .prepare(
          `SELECT id, title, source_recording_id as sourceRecordingId, due_at as dueAt, status, lane, priority
           FROM tasks
           WHERE id = ?`
        )
        .get(id) as TaskRow | undefined) ?? null
    )
  }

  listByRecordingId(recordingId: string): TaskRow[] {
    return this.db
      .prepare(
        `SELECT id, title, source_recording_id as sourceRecordingId, due_at as dueAt, status, lane, priority
         FROM tasks
         WHERE source_recording_id = ?
         ORDER BY lane ASC, due_at IS NULL ASC, due_at ASC, created_at DESC`
      )
      .all(recordingId) as TaskRow[]
  }

  insert(input: TaskInput): void {
    this.db
      .prepare(
        `INSERT INTO tasks (id, title, source_recording_id, due_at, status, lane, priority)
         VALUES (@id, @title, @sourceRecordingId, @dueAt, @status, @lane, @priority)`
      )
      .run(input)
  }

  update(id: string, patch: TaskUpdatePatch): TaskRow | null {
    const current = this.getById(id)
    if (!current) return null

    const next = { ...current, ...patch }
    this.db
      .prepare(
        `UPDATE tasks
         SET title = @title,
             source_recording_id = @sourceRecordingId,
             due_at = @dueAt,
             status = @status,
             lane = @lane,
             priority = @priority,
             updated_at = CURRENT_TIMESTAMP
         WHERE id = @id`
      )
      .run(next)

    return this.getById(id)
  }

  addEvent(id: string, taskId: string, eventType: string, payload: Record<string, unknown>): void {
    this.db
      .prepare(
        `INSERT INTO task_events (id, task_id, event_type, payload_json)
         VALUES (?, ?, ?, ?)`
      )
      .run(id, taskId, eventType, JSON.stringify(payload))
  }

  listEvents(taskId: string): TaskEventRow[] {
    return this.db
      .prepare(
        `SELECT id, task_id as taskId, event_type as eventType, payload_json as payloadJson, created_at as createdAt
         FROM task_events
         WHERE task_id = ?
         ORDER BY created_at ASC`
      )
      .all(taskId)
      .map((row) => {
        const event = row as TaskEventRow & { payloadJson: string }
        return {
          id: event.id,
          taskId: event.taskId,
          eventType: event.eventType,
          payload: JSON.parse(event.payloadJson) as Record<string, unknown>,
          createdAt: event.createdAt
        }
      })
  }
}

export class SyncRunRepository {
  constructor(private readonly db: Database.Database) {}

  latest(): SyncRunRow | null {
    return (
      (this.db
        .prepare(
          `SELECT id, status, message, started_at as startedAt, finished_at as finishedAt
           FROM sync_runs
           ORDER BY started_at DESC, rowid DESC
           LIMIT 1`
        )
        .get() as SyncRunRow | undefined) ?? null
    )
  }

  listRecent(limit = 10): SyncRunRow[] {
    return this.db
      .prepare(
        `SELECT id, status, message, started_at as startedAt, finished_at as finishedAt
         FROM sync_runs
         ORDER BY started_at DESC, rowid DESC
         LIMIT ?`
      )
      .all(limit) as SyncRunRow[]
  }

  insert(id: string, status: SyncRunStatus, message: string | null): void {
    this.db
      .prepare('INSERT INTO sync_runs (id, status, message) VALUES (?, ?, ?)')
      .run(id, status, message)
  }

  finish(id: string, status: Exclude<SyncRunStatus, 'running'>, message: string | null): SyncRunRow | null {
    this.db
      .prepare(
        `UPDATE sync_runs
         SET status = ?, message = ?, finished_at = CURRENT_TIMESTAMP
         WHERE id = ?`
      )
      .run(status, message, id)

    return this.getById(id)
  }

  getById(id: string): SyncRunRow | null {
    return (
      (this.db
        .prepare(
          `SELECT id, status, message, started_at as startedAt, finished_at as finishedAt
           FROM sync_runs
           WHERE id = ?`
        )
        .get(id) as SyncRunRow | undefined) ?? null
    )
  }
}
