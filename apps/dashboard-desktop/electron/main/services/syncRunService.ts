import { createEntityId } from './util'
import { type SyncRunRow, SyncRunRepository } from './repositories'

export class SyncRunService {
  constructor(private readonly runs: SyncRunRepository) {}

  startRun(message: string | null = null): SyncRunRow {
    const id = createEntityId('sync')
    this.runs.insert(id, 'running', message)
    return this.runs.getById(id) as SyncRunRow
  }

  finishRun(id: string, status: 'ready' | 'failed', message: string | null = null): SyncRunRow | null {
    return this.runs.finish(id, status, message)
  }

  listRecent(limit = 10): SyncRunRow[] {
    return this.runs.listRecent(limit)
  }
}
