import { describe, expect, it } from 'vitest'
import { DashboardDatabase } from '../database'

function createDatabase(): DashboardDatabase {
  const database = new DashboardDatabase(':memory:')
  database.migrate()
  return database
}

describe('DashboardDatabase', () => {
  it('migrates idempotently and seeds every local dashboard table', () => {
    const database = createDatabase()

    expect(() => database.migrate()).not.toThrow()
    expect(database.getSummary()).toMatchObject({
      recordingCount: 3,
      taskCount: 2,
      openTaskCount: 2,
      lastSyncStatus: 'ready'
    })
    expect(database.listRecordings()).toHaveLength(3)
    expect(database.listTasks()).toHaveLength(2)

    database.close()
  })

  it('composes recording details from recordings, transcripts, summaries, and tasks', () => {
    const database = createDatabase()
    const detail = database.getRecordingDetail('rec-briefing')

    expect(detail?.recording.title).toBe('Customer briefing')
    expect(detail?.transcript?.text).toContain('Customer asked')
    expect(detail?.summary?.modelId).toBe('google/gemini-3.1-flash-lite')
    expect(detail?.tasks.map((task) => task.id)).toContain('task-follow-up')

    database.close()
  })
})
