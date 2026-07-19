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
 *
 * ## Per-task timing (F15)
 *
 * Sequencing alone was not enough: one task could still monopolize the event loop
 * for tens of seconds and freeze the window on its own. Every task is therefore
 * timed and the record kept in memory (`getBootTaskTimings()`), so a stall can be
 * attributed to a specific task instead of guessed at. The per-task lines are QA
 * logs (gated on the QA Logs toggle, see services/qa-logs.ts), but a task that
 * runs longer than `SLOW_TASK_WARN_MS` always warns — a boot task holding the
 * main process that long is a defect, not debug chatter.
 */

import { isQaLogsEnabled } from './qa-logs'

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
  /**
   * Optional logger override. Defaults to a QA-gated `[QA-MONITOR]` logger, so
   * per-task chatter only appears when the QA Logs toggle is on. Slow-task
   * warnings and task failures bypass this and always print.
   */
  log?: (msg: string) => void
}

/** One completed boot task's timing record. */
export interface BootTaskTiming {
  /** Task name as registered. */
  name: string
  /** Epoch ms when the task started. */
  startedAt: number
  /** Wall-clock ms the task held the scheduler (await included). */
  elapsedMs: number
  /** False when the task threw; the scheduler continues either way. */
  ok: boolean
  /** Error message when `ok` is false. */
  error?: string
}

const DEFAULT_START_DELAY_MS = 4000
const DEFAULT_GAP_MS = 1500

/**
 * A boot task busier than this owns the main process (and therefore blocks ALL
 * renderer IPC) long enough for the window to be reported "Not Responding", so
 * it is surfaced regardless of the QA Logs toggle.
 */
const SLOW_TASK_WARN_MS = 3000

let queue: BootTask[] = []
let started = false
let settled = false
let settlePromise: Promise<void> | null = null
let timings: BootTaskTiming[] = []
let settleWaiters: Array<() => void> = []

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
 * Timing record for every boot task that has finished so far, in completion
 * order. This is the evidence surface for "which boot task froze the app" — it
 * is captured unconditionally (a handful of numbers), independently of whether
 * the QA Logs toggle is on for the human-readable lines.
 */
export function getBootTaskTimings(): readonly BootTaskTiming[] {
  return timings
}

/** True while the drain loop is running (started and not yet settled). */
export function isBootDrainActive(): boolean {
  return started && !settled
}

/**
 * Resolve once the boot tasks have finished — used to keep other heavy
 * main-process work (notably calendar sync) from overlapping the boot drain.
 *
 * Resolves immediately when the drain has already settled. When the scheduler
 * has not started yet the caller still waits, because in the real app the
 * scheduler is started very shortly after (on the renderer's `did-finish-load`,
 * with a fallback timer) and starting heavy work in that window is precisely the
 * overlap this guards against.
 *
 * Always bounded by `timeoutMs`: a scheduler that never starts, or a task that
 * hangs, must never permanently wedge the caller. On timeout the promise
 * resolves (not rejects) — the caller proceeds, accepting possible overlap
 * rather than dropping the work entirely.
 */
export function whenBootTasksSettled(timeoutMs = 120000): Promise<void> {
  if (settled) return Promise.resolve()
  return new Promise<void>((resolve) => {
    let done = false
    const finish = (): void => {
      if (done) return
      done = true
      clearTimeout(timer)
      resolve()
    }
    const timer = setTimeout(finish, Math.max(0, timeoutMs))
    // Do not hold the process open just to wait for the boot drain.
    if (typeof timer.unref === 'function') timer.unref()
    settleWaiters.push(finish)
  })
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
  // Per-task chatter is a QA log; it stays silent unless the toggle is on.
  const log =
    options.log ?? ((m: string) => { if (isQaLogsEnabled()) console.log(`[QA-MONITOR][BootScheduler] ${m}`) })

  settlePromise = (async () => {
    await delay(startDelayMs)

    while (queue.length > 0) {
      const task = queue.shift() as BootTask
      const startedAt = Date.now()
      let ok = true
      let error: string | undefined
      try {
        log(`running "${task.name}"...`)
        await task.run()
      } catch (e) {
        // Best-effort: one failing task must never abort the rest (this matches
        // the pre-existing per-task try/catch each backfill had on its own).
        ok = false
        error = e instanceof Error ? e.message : String(e)
      }

      const elapsedMs = Date.now() - startedAt
      timings.push({ name: task.name, startedAt, elapsedMs, ok, ...(error ? { error } : {}) })

      if (ok) {
        log(`"${task.name}" done in ${elapsedMs}ms`)
      } else {
        // A failing boot task is a real defect, not QA chatter — always surface it.
        console.error(`[BootScheduler] "${task.name}" failed after ${elapsedMs}ms:`, error)
      }

      // A task this slow held the main process (and therefore every renderer IPC
      // round-trip) long enough to freeze the window — report it regardless of
      // the QA toggle so the next stall is attributable without a repro session.
      if (elapsedMs >= SLOW_TASK_WARN_MS) {
        console.warn(
          `[BootScheduler] SLOW boot task "${task.name}" took ${elapsedMs}ms ` +
            `(>= ${SLOW_TASK_WARN_MS}ms); the UI is unresponsive for any part of that ` +
            `spent without yielding.`
        )
      }

      // Yield between tasks so the renderer's queued IPC is serviced before the
      // next heavy pass grabs the event loop.
      if (queue.length > 0) await delay(gapMs)
    }

    const totalMs = timings.reduce((sum, t) => sum + t.elapsedMs, 0)
    log(`all boot tasks complete (${timings.length} tasks, ${totalMs}ms of task time)`)

    // Release anything that deferred itself until boot work finished (e.g. the
    // startup/periodic calendar sync) BEFORE resolving, so a waiter never starts
    // while the drain is still marked active.
    settled = true
    const waiters = settleWaiters
    settleWaiters = []
    for (const w of waiters) w()
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
  settled = false
  settlePromise = null
  timings = []
  // Release any pending waiter so a test that awaited whenBootTasksSettled()
  // cannot hang past the reset.
  const waiters = settleWaiters
  settleWaiters = []
  for (const w of waiters) w()
}
