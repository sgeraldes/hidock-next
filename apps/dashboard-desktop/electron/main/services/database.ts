import Database from 'better-sqlite3'
import {
  type DashboardSummary,
  RecordingRepository,
  type RecordingDetail,
  type RecordingRow,
  SummaryRepository,
  SyncRunRepository,
  TaskRepository,
  type TaskRow,
  TranscriptRepository
} from './repositories'
import { seedDevelopmentData } from './seed'
import { SyncRunService } from './syncRunService'
import { TaskService } from './taskService'

const MIGRATIONS = [
  {
    version: 1,
    sql: `
      CREATE TABLE IF NOT EXISTS schema_migrations (
        version INTEGER PRIMARY KEY,
        applied_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS recordings (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        recorded_at TEXT NOT NULL,
        duration_seconds INTEGER NOT NULL DEFAULT 0,
        status TEXT NOT NULL DEFAULT 'on-device',
        transcript_status TEXT NOT NULL DEFAULT 'none',
        local_path TEXT,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS transcripts (
        id TEXT PRIMARY KEY,
        recording_id TEXT NOT NULL REFERENCES recordings(id) ON DELETE CASCADE,
        text TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS summaries (
        id TEXT PRIMARY KEY,
        recording_id TEXT NOT NULL REFERENCES recordings(id) ON DELETE CASCADE,
        text TEXT NOT NULL,
        model_id TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS tasks (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        source_recording_id TEXT REFERENCES recordings(id) ON DELETE SET NULL,
        due_at TEXT,
        status TEXT NOT NULL DEFAULT 'open',
        priority TEXT NOT NULL DEFAULT 'normal',
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS task_events (
        id TEXT PRIMARY KEY,
        task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
        event_type TEXT NOT NULL,
        payload_json TEXT NOT NULL DEFAULT '{}',
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS sync_runs (
        id TEXT PRIMARY KEY,
        status TEXT NOT NULL,
        message TEXT,
        started_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        finished_at TEXT
      );

      CREATE TABLE IF NOT EXISTS settings (
        key TEXT PRIMARY KEY,
        value_json TEXT NOT NULL,
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
    `
  },
  {
    version: 2,
    sql: `
      ALTER TABLE tasks ADD COLUMN lane TEXT NOT NULL DEFAULT 'inbox';

      UPDATE tasks
      SET lane = CASE
        WHEN status = 'done' THEN 'done'
        ELSE 'inbox'
      END;
    `
  }
]

export class DashboardDatabase {
  private readonly db: Database.Database
  readonly recordings: RecordingRepository
  readonly transcripts: TranscriptRepository
  readonly summaries: SummaryRepository
  readonly tasks: TaskRepository
  readonly syncRuns: SyncRunRepository
  readonly taskService: TaskService
  readonly syncRunService: SyncRunService

  constructor(filePath: string) {
    this.db = new Database(filePath)
    this.db.pragma('foreign_keys = ON')
    this.recordings = new RecordingRepository(this.db)
    this.transcripts = new TranscriptRepository(this.db)
    this.summaries = new SummaryRepository(this.db)
    this.tasks = new TaskRepository(this.db)
    this.syncRuns = new SyncRunRepository(this.db)
    this.taskService = new TaskService(this.db, this.tasks)
    this.syncRunService = new SyncRunService(this.syncRuns)
  }

  migrate(): void {
    this.db.exec(
      'CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)'
    )

    const current = this.db
      .prepare('SELECT COALESCE(MAX(version), 0) as version FROM schema_migrations')
      .get() as { version: number }

    for (const migration of MIGRATIONS) {
      if (migration.version <= current.version) continue
      const applyMigration = this.db.transaction(() => {
        this.db.exec(migration.sql)
        this.db.prepare('INSERT INTO schema_migrations (version) VALUES (?)').run(migration.version)
      })
      applyMigration()
    }

    seedDevelopmentData(this.db, {
      recordings: this.recordings,
      transcripts: this.transcripts,
      summaries: this.summaries,
      tasks: this.tasks,
      syncRuns: this.syncRuns
    })
  }

  getSummary(): DashboardSummary {
    const lastSync = this.syncRuns.latest()

    return {
      recordingCount: this.recordings.count(),
      taskCount: this.tasks.count(),
      openTaskCount: this.tasks.countOpen(),
      lastSyncStatus: lastSync?.status ?? 'never-run'
    }
  }

  listRecordings(): RecordingRow[] {
    return this.recordings.list()
  }

  getRecordingDetail(id: string): RecordingDetail | null {
    const recording = this.recordings.getById(id)
    if (!recording) return null

    return {
      recording,
      transcript: this.transcripts.getByRecordingId(id),
      summary: this.summaries.getLatestByRecordingId(id),
      tasks: this.tasks.listByRecordingId(id)
    }
  }

  listTasks(): TaskRow[] {
    return this.tasks.list()
  }

  close(): void {
    this.db.close()
  }
}

export type {
  DashboardSummary,
  RecordingDetail,
  RecordingRow,
  SummaryRow,
  SyncRunRow,
  TaskEventRow,
  TaskRow,
  TranscriptRow
} from './repositories'
