import Database from 'better-sqlite3'
import { z } from 'zod'
import { createEntityId } from './util'
import {
  type TaskInput,
  type TaskLane,
  type TaskPriority,
  TaskRepository,
  type TaskRow,
  type TaskStatus,
  type TaskUpdatePatch
} from './repositories'

export const taskCreateSchema = z.object({
  title: z.string().trim().min(1),
  sourceRecordingId: z.string().trim().min(1).nullable().default(null),
  dueAt: z.string().datetime().nullable().default(null),
  status: z.enum(['open', 'done', 'disregarded']).default('open'),
  lane: z.enum(['inbox', 'mine', 'watching', 'done', 'disregarded']).default('inbox'),
  priority: z.enum(['low', 'normal', 'high']).default('normal')
})

export const taskUpdateSchema = z
  .object({
    title: z.string().trim().min(1).optional(),
    sourceRecordingId: z.string().trim().min(1).nullable().optional(),
    dueAt: z.string().datetime().nullable().optional(),
    status: z.enum(['open', 'done', 'disregarded']).optional(),
    lane: z.enum(['inbox', 'mine', 'watching', 'done', 'disregarded']).optional(),
    priority: z.enum(['low', 'normal', 'high']).optional()
  })
  .refine((patch) => Object.keys(patch).length > 0, 'Task update patch must not be empty')

export type TaskCreateRequest = z.input<typeof taskCreateSchema>
export type TaskUpdateRequest = z.input<typeof taskUpdateSchema>

export class TaskService {
  constructor(
    private readonly db: Database.Database,
    private readonly tasks: TaskRepository
  ) {}

  createTask(input: TaskCreateRequest): TaskRow {
    const parsed = taskCreateSchema.parse(input)
    const lane = parsed.lane
    const task: TaskInput = {
      id: createEntityId('task'),
      title: parsed.title,
      sourceRecordingId: parsed.sourceRecordingId,
      dueAt: parsed.dueAt,
      status: statusForLane(lane, parsed.status),
      lane,
      priority: parsed.priority
    }

    const create = this.db.transaction(() => {
      this.tasks.insert(task)
      this.tasks.addEvent(createEntityId('event'), task.id, 'created', { ...task })
    })
    create()

    return this.tasks.getById(task.id) as TaskRow
  }

  updateTask(id: string, input: TaskUpdateRequest): TaskRow | null {
    const parsedPatch = taskUpdateSchema.parse(input) as TaskUpdatePatch
    const before = this.tasks.getById(id)
    if (!before) return null
    const patch = normalizePatch(parsedPatch, before)
    const eventType = this.eventTypeForPatch(parsedPatch)

    const update = this.db.transaction(() => {
      const updated = this.tasks.update(id, patch)
      this.tasks.addEvent(createEntityId('event'), id, eventType, {
        before,
        patch,
        after: updated
      })
    })
    update()

    return this.tasks.getById(id)
  }

  setTaskStatus(id: string, status: TaskStatus): TaskRow | null {
    return this.updateTask(id, { status })
  }

  setTaskPriority(id: string, priority: TaskPriority): TaskRow | null {
    return this.updateTask(id, { priority })
  }

  private eventTypeForPatch(patch: TaskUpdatePatch): string {
    if (patch.lane) return 'lane-changed'
    if (patch.status) return 'status-changed'
    if (patch.priority) return 'priority-changed'
    return 'updated'
  }
}

function statusForLane(lane: TaskLane, fallback: TaskStatus = 'open'): TaskStatus {
  if (lane === 'done') return 'done'
  if (lane === 'disregarded') return 'disregarded'
  return fallback === 'done' || fallback === 'disregarded' ? 'open' : fallback
}

function laneForStatus(status: TaskStatus): TaskLane {
  if (status === 'done') return 'done'
  if (status === 'disregarded') return 'disregarded'
  return 'inbox'
}

function normalizePatch(patch: TaskUpdatePatch, before: TaskRow): TaskUpdatePatch {
  if (patch.lane) {
    return {
      ...patch,
      status: statusForLane(patch.lane, before.status)
    }
  }

  if (patch.status && patch.status !== before.status) {
    return {
      ...patch,
      lane: laneForStatus(patch.status)
    }
  }

  return patch
}
