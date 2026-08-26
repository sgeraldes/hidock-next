/**
 * Active USB transfer controller (Phase 1: download cancellation).
 *
 * The Jensen protocol has NO command to abort an in-flight TRANSFER_FILE stream
 * (verified in jensen-device.ts's CMD enum and apps/desktop/src/constants.py). The
 * device keeps streaming the whole file after a "cancel". The SAFE abort strategy
 * therefore lives inside JensenDevice.downloadFile() (absorb chunks → keep polling →
 * drain to the protocol byte boundary → advance only when idle → quarantine on
 * stall). See jensen-device.ts `settleTransfer`.
 *
 * This module is the thin MAIN-PROCESS coordination layer around that: it owns the
 * ONE active transfer at a time so two unrelated concerns can find and cancel it:
 *   - the low-level jensen:cancelDownload / jensen:disconnect IPC handlers, and
 *   - the higher-level download-service cancel / cancel-all handlers (which also own
 *     the queue-state transition).
 *
 * It intentionally holds only what is needed to abort and to KNOW WHEN the abort
 * has settled — { filename, AbortController, settled } — so a cancel IPC handler can
 * `await` real completion (the transfer function returning) instead of firing the
 * abort and returning while chunks are still being forwarded to the renderer.
 *
 * Single-transfer invariant: downloads are serialized (the renderer's
 * useDownloadOrchestrator runs one at a time, and the Jensen command queue enforces
 * one TRANSFER_FILE at a time on the bus). We therefore track exactly one active
 * transfer; a second `trackActiveTransfer` while one is live replaces the pointer
 * (its own finally only clears the pointer if it still owns it).
 */

interface ActiveTransfer {
  filename: string
  abort: AbortController
  /** Resolves when the wrapped transfer function returns (consumer-settled). */
  settled: Promise<void>
}

let active: ActiveTransfer | null = null

/**
 * Wrap the execution of a single device→disk transfer so it is discoverable and
 * cancellable while it runs. Registers { filename, abort, settled } for the lifetime
 * of `run()` and clears it (if still the owner) when `run()` settles.
 *
 * The returned promise is `run()`'s own result — callers use it exactly as before.
 */
export async function trackActiveTransfer<T>(
  filename: string,
  abort: AbortController,
  run: () => Promise<T>
): Promise<T> {
  let markSettled!: () => void
  const settled = new Promise<void>((resolve) => {
    markSettled = resolve
  })
  const entry: ActiveTransfer = { filename, abort, settled }
  active = entry
  try {
    return await run()
  } finally {
    // Only clear if we are still the registered transfer — a later transfer may
    // have replaced us (should not happen under the single-transfer invariant, but
    // stay correct if it ever does).
    if (active === entry) active = null
    markSettled()
  }
}

/** Filename of the transfer currently streaming, or null when the bus is idle. */
export function getActiveTransferFilename(): string | null {
  return active?.filename ?? null
}

/** True when a transfer is in flight. */
export function hasActiveTransfer(): boolean {
  return active !== null
}

/**
 * Abort the active transfer WITHOUT waiting for it to settle. Used by the disconnect
 * path, which owns its own drain + close (gracefulCloseDevice) and must NOT block on
 * the transfer's own settlement — aborting with reason 'disconnect' tells
 * JensenDevice.downloadFile to stand down for teardown.
 */
export function abortActiveTransfer(reason = 'user-cancel'): void {
  if (active && !active.abort.signal.aborted) active.abort.abort(reason)
}

/**
 * Abort the active transfer (if any) and RESOLVE ONLY AFTER it has settled — i.e.
 * after JensenDevice.downloadFile returns, so no more chunks will be forwarded and
 * the renderer's transfer call has already returned. Idempotent: aborting an
 * already-aborted transfer is a no-op; the settlement is still awaited.
 *
 * Returns true if there was an active transfer to abort, false otherwise.
 */
export async function cancelActiveTransfer(reason = 'user-cancel'): Promise<boolean> {
  const entry = active
  if (!entry) return false
  if (!entry.abort.signal.aborted) entry.abort.abort(reason)
  await entry.settled
  return true
}

/**
 * Like cancelActiveTransfer, but only if the active transfer is for `filename`.
 * Used by per-file cancel so cancelling file A never aborts an unrelated in-flight
 * transfer for file B. Returns true only when `filename` was the active transfer and
 * has now settled.
 */
export async function cancelActiveTransferByName(
  filename: string,
  reason = 'user-cancel'
): Promise<boolean> {
  const entry = active
  if (!entry || entry.filename !== filename) return false
  if (!entry.abort.signal.aborted) entry.abort.abort(reason)
  await entry.settled
  return true
}

/** Test-only: forget any active transfer (does NOT abort it). */
export function __resetActiveTransferForTests(): void {
  active = null
}
