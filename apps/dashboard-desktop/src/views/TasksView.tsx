import { useEffect, useMemo, useState } from 'react'
import { Check, Clock, Eye, Inbox, Search, UserRound, X, XCircle } from 'lucide-react'
import { StatusBadge } from '@components/StatusBadge'
import { dashboardApi } from '@data/api'
import { formatDateTime, titleCase } from '@data/format'
import type { TaskEventRow, TaskRow, TaskUpdatePatch } from '../../electron/preload/index.d'

type TaskLane = TaskRow['lane']

interface TasksViewProps {
  tasks: TaskRow[]
  onTaskUpdate(id: string, patch: TaskUpdatePatch): Promise<void>
}

const LANES: Array<{ id: TaskLane; label: string; icon: typeof Inbox }> = [
  { id: 'inbox', label: 'Inbox', icon: Inbox },
  { id: 'mine', label: 'Mine', icon: UserRound },
  { id: 'watching', label: 'Watching', icon: Eye },
  { id: 'done', label: 'Done', icon: Check },
  { id: 'disregarded', label: 'Disregarded', icon: XCircle }
]

export function TasksView({ tasks, onTaskUpdate }: TasksViewProps): JSX.Element {
  const [query, setQuery] = useState('')
  const [priority, setPriority] = useState<'all' | TaskRow['priority']>('all')
  const [selectedTaskIds, setSelectedTaskIds] = useState<Set<string>>(() => new Set())
  const [activeTask, setActiveTask] = useState<TaskRow | null>(null)
  const [events, setEvents] = useState<TaskEventRow[]>([])

  const filteredTasks = useMemo(() => {
    const needle = query.trim().toLowerCase()
    return tasks.filter((task) => {
      const matchesQuery = !needle || task.title.toLowerCase().includes(needle)
      const matchesPriority = priority === 'all' || task.priority === priority
      return matchesQuery && matchesPriority
    })
  }, [priority, query, tasks])

  const selectedCount = selectedTaskIds.size

  useEffect(() => {
    if (!activeTask) {
      setEvents([])
      return
    }

    dashboardApi.tasks
      .listEvents(activeTask.id)
      .then(setEvents)
      .catch(() => setEvents([]))
  }, [activeTask])

  useEffect(() => {
    setSelectedTaskIds((current) => new Set([...current].filter((id) => tasks.some((task) => task.id === id))))
    setActiveTask((current) => (current ? (tasks.find((task) => task.id === current.id) ?? null) : null))
  }, [tasks])

  function toggleSelected(taskId: string): void {
    setSelectedTaskIds((current) => {
      const next = new Set(current)
      if (next.has(taskId)) next.delete(taskId)
      else next.add(taskId)
      return next
    })
  }

  async function moveSelected(lane: TaskLane): Promise<void> {
    const ids = [...selectedTaskIds]
    await Promise.all(ids.map((id) => onTaskUpdate(id, { lane })))
    setSelectedTaskIds(new Set())
  }

  return (
    <div className="view-stack">
      <div className="page-heading">
        <div>
          <h1>Tasks</h1>
          <p>Inbox, ownership, watched items, closed work, and disregarded follow-ups.</p>
        </div>
        <div className="toolbar">
          <label className="search-box">
            <Search size={16} />
            <input
              aria-label="Search tasks"
              placeholder="Search tasks"
              value={query}
              onChange={(event) => setQuery(event.currentTarget.value)}
            />
          </label>
          <select
            aria-label="Filter by priority"
            className="select-control"
            value={priority}
            onChange={(event) => setPriority(event.currentTarget.value as 'all' | TaskRow['priority'])}
          >
            <option value="all">All priorities</option>
            <option value="high">High</option>
            <option value="normal">Normal</option>
            <option value="low">Low</option>
          </select>
        </div>
      </div>

      <section className="panel bulk-panel">
        <strong>{selectedCount} selected</strong>
        <div className="segmented-actions" aria-label="Move selected tasks">
          {LANES.map((lane) => (
            <button
              key={lane.id}
              type="button"
              disabled={selectedCount === 0}
              onClick={() => moveSelected(lane.id)}
            >
              {lane.label}
            </button>
          ))}
        </div>
      </section>

      <section className="lane-board" aria-label="Task lanes">
        {LANES.map((lane) => {
          const laneTasks = filteredTasks.filter((task) => task.lane === lane.id)
          const Icon = lane.icon

          return (
            <div className="lane-column" key={lane.id}>
              <header className="lane-header">
                <span>
                  <Icon size={16} />
                  {lane.label}
                </span>
                <strong>{laneTasks.length}</strong>
              </header>

              <div className="lane-stack">
                {laneTasks.map((task) => (
                  <article className="task-card" key={task.id}>
                    <input
                      aria-label={`Select ${task.title}`}
                      checked={selectedTaskIds.has(task.id)}
                      type="checkbox"
                      onChange={() => toggleSelected(task.id)}
                    />
                    <button className="task-card__body" type="button" onClick={() => setActiveTask(task)}>
                      <strong>{task.title}</strong>
                      <span>{formatDateTime(task.dueAt)}</span>
                    </button>
                    <StatusBadge value={task.priority} tone={task.priority === 'high' ? 'warning' : 'neutral'} />
                  </article>
                ))}
              </div>
            </div>
          )
        })}
      </section>

      {activeTask && (
        <div className="dialog-backdrop" role="presentation">
          <section className="detail-dialog" role="dialog" aria-modal="true" aria-labelledby="task-detail-title">
            <header className="detail-dialog__header">
              <div>
                <h2 id="task-detail-title">{activeTask.title}</h2>
                <p>{formatDateTime(activeTask.dueAt)}</p>
              </div>
              <button className="icon-button" type="button" aria-label="Close task detail" onClick={() => setActiveTask(null)}>
                <X size={16} />
              </button>
            </header>

            <div className="detail-grid">
              <label>
                Lane
                <select
                  value={activeTask.lane}
                  onChange={(event) => onTaskUpdate(activeTask.id, { lane: event.currentTarget.value as TaskLane })}
                >
                  {LANES.map((lane) => (
                    <option key={lane.id} value={lane.id}>
                      {lane.label}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Priority
                <select
                  value={activeTask.priority}
                  onChange={(event) =>
                    onTaskUpdate(activeTask.id, { priority: event.currentTarget.value as TaskRow['priority'] })
                  }
                >
                  <option value="high">High</option>
                  <option value="normal">Normal</option>
                  <option value="low">Low</option>
                </select>
              </label>
            </div>

            <div className="event-list">
              <h3>History</h3>
              {events.map((event) => (
                <div className="event-row" key={event.id}>
                  <Clock size={15} />
                  <div>
                    <strong>{titleCase(event.eventType)}</strong>
                    <span>{formatDateTime(event.createdAt)}</span>
                  </div>
                </div>
              ))}
            </div>
          </section>
        </div>
      )}
    </div>
  )
}
