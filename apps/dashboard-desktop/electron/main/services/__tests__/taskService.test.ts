import { describe, expect, it } from 'vitest'
import { DashboardDatabase } from '../database'

function createDatabase(): DashboardDatabase {
  const database = new DashboardDatabase(':memory:')
  database.migrate()
  return database
}

describe('TaskService', () => {
  it('creates tasks and writes a created event', () => {
    const database = createDatabase()
    const task = database.taskService.createTask({
      title: 'Call back customer',
      sourceRecordingId: 'rec-briefing',
      dueAt: '2026-06-20T10:00:00.000Z',
      priority: 'high'
    })

    const events = database.tasks.listEvents(task.id)
    expect(task.status).toBe('open')
    expect(task.lane).toBe('inbox')
    expect(events).toHaveLength(1)
    expect(events[0]).toMatchObject({ taskId: task.id, eventType: 'created' })

    database.close()
  })

  it('updates task status and records an audit event', () => {
    const database = createDatabase()
    const updated = database.taskService.setTaskStatus('task-follow-up', 'done')
    const events = database.tasks.listEvents('task-follow-up')

    expect(updated?.status).toBe('done')
    expect(updated?.lane).toBe('done')
    expect(events.map((event) => event.eventType)).toContain('status-changed')

    database.close()
  })

  it('moves tasks between review lanes and keeps terminal states out of open counts', () => {
    const database = createDatabase()
    const disregarded = database.taskService.updateTask('task-export', { lane: 'disregarded' })
    const events = database.tasks.listEvents('task-export')

    expect(disregarded).toMatchObject({ lane: 'disregarded', status: 'disregarded' })
    expect(database.getSummary().openTaskCount).toBe(1)
    expect(events.map((event) => event.eventType)).toContain('lane-changed')

    database.close()
  })
})

describe('SyncRunService', () => {
  it('tracks sync run lifecycle', () => {
    const database = createDatabase()
    const run = database.syncRunService.startRun('Manual metadata sync')
    const finished = database.syncRunService.finishRun(run.id, 'ready', 'Metadata sync complete')

    expect(finished).toMatchObject({
      id: run.id,
      status: 'ready',
      message: 'Metadata sync complete'
    })
    expect(database.syncRunService.listRecent(1)[0]?.id).toBe(run.id)

    database.close()
  })
})
