/**
 * Boot Scheduler — sequential, idle-yielding runner for heavy, non-critical
 * startup work.
 *
 * ## Why this exists (root cause of the restart freeze)
 *
 * On a large database the app used to fire a *burst* of heavy main-process work
 * right after the window was shown:
 *
 *  - the transcription backlog drain (`startTranscriptionProcessor` → immediate
 *    `processQueue`, ~240 items), plus
 *  - five INDEPENDENT `setTimeout` backfills bunched at 8s/10s/12s/15s/20s:
 *    org-reconciler (which runs the ~1,521-row status self-heal),
 *    meeting-wiki backfill, knowledge-capture backfill, embeddings backfill,
 *    and failed-transcript reanalysis, plus
 *  - the living-graph ingest (rekey over ~43,700 nodes) that the drain triggers.
 *
 * All of that is synchronous sql.js work on the ONE main-process event loop, so
 * it overlapped and starved the renderer's IPC — the window went "not
 * responding" with high CPU for a while after every restart.
 *
 * ## What it does
 *
 * Runs registered tasks ONE AT A TIME (concurrency cap = 1). Each task is awaited
 * to completion before the next starts, and an idle gap is inserted BETWEEN tasks
 * so the event loop drains the renderer's queued IPC in the meantime. The heavy
 * work still all runs — it is just spread out instead of bursting at once, and it
 * only begins after the window has painted (the caller starts the scheduler on
 * the renderer's first `did-finish-load`).
 *
 * The scheduler does NOT change what any task does or the order the user's data
 * is processed in — it only governs WHEN each boot task starts relative to the
 * others so the UI stays responsive.
 */

export interface BootTask {
  /** Human-readable label for logging. */
  name: string
  /**
   * The work to run. May be sync or async; the scheduler awaits it before
   * starting the next task. Tasks that kick off their own long-running loop
   * (e.g. starting an interval-based processor) should return promptly so they
   * do not block later tasks.
   */
  run: () => void | Promise<void>
}

export interface BootSchedulerOptions {
  /**
   * Idle delay (ms) before the FIRST task runs. Lets the renderer's first paint
   * and its initial data-load IPC settle before any heavy task competes.
   */
  startDelayMs?: number
  /**
   * Idle gap (ms) inserted BETWEEN consecutive tasks. This is the yield that
   * keeps the main-process event loop servicing renderer IPC between heavy
   * passes.
   */
  gapMs?: number
  /** Optional logger override (defaults to console.log with a prefix). */
  log?: (msg: string) => void
}

const DEFAULT_START_DELAY_MS = 4000
const DEFAULT_GAP_MS = 1500

let queue: BootTask[] = []
let started = false
let settlePromise: Promise<void> | null = null

/** Wait `ms` while yielding the event loop (renderer IPC runs during the wait). */
function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, Math.max(0, ms)))
}

/**
 * Register a heavy boot task. Tasks run in registration order. May be called
 * before OR during draining — a task registered while the scheduler is running
 * is still picked up (the drain loop re-checks the queue each iteration).
 */
export function registerBootTask(task: BootTask): void {
  queue.push(task)
}

/** Number of tasks still waiting to run (drops to 0 once the queue drains). */
export function pendingBootTaskCount(): number {
  return queue.length
}

/**
 * Begin draining the registered tasks sequentially. Idempotent: the first call
 * owns the drain; later calls return the same settle promise without starting a
 * second drain (so wiring it to both `did-finish-load` and a fallback timeout is
 * safe). Resolves when the queue is empty.
 */
export function startBootScheduler(options: BootSchedulerOptions = {}): Promise<void> {
  if (started) return settlePromise ?? Promise.resolve()
  started = true

  const startDelayMs = options.startDelayMs ?? DEFAULT_START_DELAY_MS
  const gapMs = options.gapMs ?? DEFAULT_GAP_MS
  const log = options.log ?? ((m: string) => console.log(`[BootScheduler] ${m}`))

  settlePromise = (async () => {
    await delay(startDelayMs)

    while (queue.length > 0) {
      const task = queue.shift() as BootTask
      const startedAt = Date.now()
      try {
        log(`running "${task.name}"...`)
        await task.run()
        log(`"${task.name}" done in ${Date.now() - startedAt}ms`)
      } catch (e) {
        // Best-effort: one failing task must never abort the rest (this matches
        // the pre-existing per-task try/catch each backfill had on its own).
        log(`"${task.name}" failed: ${e instanceof Error ? e.message : String(e)}`)
      }

      // Yield between tasks so the renderer's queued IPC is serviced before the
      // next heavy pass grabs the event loop.
      if (queue.length > 0) await delay(gapMs)
    }

    log('all boot tasks complete')
  })()

  return settlePromise
}

/**
 * Test-only reset: clears the queue and the started/settled state so each test
 * observes a fresh scheduler. Not used by the app.
 */
export function _resetBootSchedulerForTests(): void {
  queue = []
  started = false
  settlePromise = null
}
