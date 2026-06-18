import Database from 'better-sqlite3'
import { type RecordingRepository, type SummaryRepository, type SyncRunRepository, type TaskRepository, type TranscriptRepository } from './repositories'

export interface SeedRepositories {
  recordings: RecordingRepository
  transcripts: TranscriptRepository
  summaries: SummaryRepository
  tasks: TaskRepository
  syncRuns: SyncRunRepository
}

export function seedDevelopmentData(db: Database.Database, repositories: SeedRepositories): void {
  if (repositories.recordings.count() > 0) return

  const seed = db.transaction(() => {
    repositories.recordings.upsert({
      id: 'rec-briefing',
      title: 'Customer briefing',
      recordedAt: '2026-06-17T14:30:00.000Z',
      durationSeconds: 2140,
      status: 'downloaded',
      transcriptStatus: 'complete',
      localPath: null
    })
    repositories.recordings.upsert({
      id: 'rec-design-review',
      title: 'Design review',
      recordedAt: '2026-06-16T09:15:00.000Z',
      durationSeconds: 1685,
      status: 'on-device',
      transcriptStatus: 'none',
      localPath: null
    })
    repositories.recordings.upsert({
      id: 'rec-ops-sync',
      title: 'Ops sync',
      recordedAt: '2026-06-15T18:05:00.000Z',
      durationSeconds: 1260,
      status: 'summarized',
      transcriptStatus: 'complete',
      localPath: null
    })

    repositories.transcripts.upsert({
      id: 'transcript-briefing',
      recordingId: 'rec-briefing',
      text: 'Customer asked for a concise dashboard with local recordings, summaries, and clear follow-up ownership.',
      createdAt: '2026-06-17T15:08:00.000Z'
    })
    repositories.transcripts.upsert({
      id: 'transcript-ops-sync',
      recordingId: 'rec-ops-sync',
      text: 'Ops sync covered metadata refresh, transcript formatting, and manual download safeguards.',
      createdAt: '2026-06-15T18:34:00.000Z'
    })

    repositories.summaries.create({
      id: 'summary-briefing',
      recordingId: 'rec-briefing',
      text: 'Customer wants the dashboard to prioritize local review, task extraction, and safe device sync.',
      modelId: 'google/gemini-3.1-flash-lite',
      createdAt: '2026-06-17T15:12:00.000Z'
    })
    repositories.summaries.create({
      id: 'summary-ops-sync',
      recordingId: 'rec-ops-sync',
      text: 'Keep metadata sync read-only and make transcript exports reviewable before sharing.',
      modelId: 'google/gemini-3.1-flash-lite',
      createdAt: '2026-06-15T18:40:00.000Z'
    })

    repositories.tasks.insert({
      id: 'task-follow-up',
      title: 'Send dashboard follow-up notes',
      sourceRecordingId: 'rec-briefing',
      dueAt: '2026-06-19T16:00:00.000Z',
      status: 'open',
      lane: 'mine',
      priority: 'high'
    })
    repositories.tasks.addEvent('event-follow-up-created', 'task-follow-up', 'created', {
      source: 'development-seed'
    })
    repositories.tasks.insert({
      id: 'task-export',
      title: 'Review exported transcript formatting',
      sourceRecordingId: 'rec-ops-sync',
      dueAt: null,
      status: 'open',
      lane: 'inbox',
      priority: 'normal'
    })
    repositories.tasks.addEvent('event-export-created', 'task-export', 'created', {
      source: 'development-seed'
    })

    repositories.syncRuns.insert('sync-seed', 'ready', 'Local schema initialized with sample dashboard data')
  })

  seed()
}
