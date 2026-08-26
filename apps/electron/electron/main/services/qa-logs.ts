/**
 * Main-process QA-logs gate.
 *
 * ## Why this exists
 *
 * The QA Logs toggle lives in the renderer's Zustand UI store, persisted to
 * `localStorage` under `hidock-ui-store`. Renderer components read it with a
 * selector; the preload reads it through a localStorage bridge (see
 * `electron/preload/index.ts`). Neither route works in the MAIN process — it has
 * no `localStorage` and no access to the store.
 *
 * So the renderer PUSHES the value to main over the `qa:set-logs-enabled`
 * channel: once when the UI mounts (so main learns the persisted value) and again
 * on every toggle. Main caches it here, and every main-process QA log asks
 * `isQaLogsEnabled()` before writing — same contract as the renderer/preload
 * rules in CLAUDE.md, just with a push instead of a read.
 *
 * ## Boot-time escape hatch
 *
 * Boot logging (notably the BootScheduler task timings) can fire before the
 * renderer's first push lands, so `HIDOCK_QA_LOGS=1` in the environment forces
 * the gate open from process start. That is the supported way to capture a full
 * boot trace when diagnosing a startup stall.
 */

/** Last value pushed by the renderer; `null` = nothing pushed yet. */
let pushed: boolean | null = null

/**
 * Whether main-process QA logs should be written right now. Falls back to the
 * `HIDOCK_QA_LOGS=1` environment override until the renderer pushes a value, so
 * early-boot logs are capturable.
 */
export function isQaLogsEnabled(): boolean {
  if (pushed !== null) return pushed
  return process.env.HIDOCK_QA_LOGS === '1'
}

/** Record the renderer's current QA Logs toggle state. */
export function setQaLogsEnabled(enabled: boolean): void {
  pushed = enabled
}

/**
 * Write a `[QA-MONITOR]`-prefixed line when QA logs are enabled, otherwise do
 * nothing. Arguments are only touched when the gate is open, so callers may pass
 * pre-built strings without paying for them when the toggle is off.
 */
export function qaLog(message: string, ...rest: unknown[]): void {
  if (!isQaLogsEnabled()) return
  console.log(`[QA-MONITOR] ${message}`, ...rest)
}

/** Test-only: forget the pushed value so the env fallback applies again. */
export function _resetQaLogsForTests(): void {
  pushed = null
}
