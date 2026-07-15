/**
 * Deletion-related copy (spec-005/F17 T5 §D2).
 *
 * Single source of truth for every delete/restore surface (SourceRow,
 * SourceReader, Library's confirm dialogs, DeletePermanentDialog) so the exact
 * strings can never drift between them. "Delete everywhere" and "Delete from
 * computer" are retired — every destructive item states its scope in the
 * menu itself via a muted second line (AC#1).
 */

// Menu item labels.
export const LABEL_DELETE_FROM_DEVICE = 'Delete from device'
export const LABEL_MOVE_TO_TRASH = 'Move to Trash'
export const LABEL_DELETE_PERMANENTLY = 'Delete permanently…'
export const LABEL_RESTORE = 'Restore'

// Muted second-line scope text shown under each destructive/restorative item.
export const SCOPE_DEVICE_DELETE = "Erase the recording from the HiDock. Can't be undone."
export const SCOPE_DEVICE_DELETE_SYNCED = 'Erase the recording from the HiDock. Keeps the local copy.'
export const SCOPE_DEVICE_NOT_CONNECTED = 'Device not connected'
export const SCOPE_TRASH = 'Hide it and stop AI processing. Restorable — keeps the file.'
export const SCOPE_PERMANENT = "Erase the file and all derived data from this computer. Can't be undone."
export const SCOPE_RESTORE = 'Un-hide and resume AI processing.'

/** Load-bearing aria-label join: folds the muted second line into the item's accessible name. */
export function ariaLabelWithScope(label: string, scope: string): string {
  return `${label} — ${scope}`
}

// Confirm-dialog copy. Permanent delete uses the dedicated DeletePermanentDialog (§D6), not this.
export function softDeleteConfirmDescription(filename: string): string {
  return `Move "${filename}" to Trash? It will be hidden and excluded from all AI processing. ` +
    'Nothing is erased — restore it from Trash, or delete it permanently later.'
}

export function deviceDeleteConfirmDescription(filename: string): string {
  return `Delete "${filename}" from the HiDock device? This erases the on-device recording and ` +
    "can't be undone. Your local copy (if any) is kept."
}

// Trash-mode banner (§D1 step 8).
export const TRASH_MODE_BANNER = 'Items here are hidden and excluded from AI. Restore, or delete permanently.'

// spec-005/F17 T5 — success/partial-summary toast TITLES for the
// menu-triggered actions elsewhere in Library.tsx (soft delete, device-only
// delete, restore, bulk delete). Bodies stay inline at each call site
// (single-use, interpolating the filename/counts directly) — only the
// titles are shared copy. Phase-3 integration-review S1: these used to be
// literals that bypassed this module despite its single-source claim.
export const SUCCESS_MOVED_TO_TRASH_TITLE = 'Moved to Trash'
export const SUCCESS_REMOVED_FROM_DEVICE_TITLE = 'Removed from device'
export const SUCCESS_RESTORED_TITLE = 'Restored'
export const PARTIAL_DELETE_TITLE = 'Partial Delete'

// =============================================================================
// spec-006/F17 T6 — permanent-delete OUTCOME copy (D2/D3/D5/AR3-2/AR3-3c/AR3-6a).
// The dialog's own body copy (impact sentence, graph-unknown warning) stays in
// DeletePermanentDialog.tsx per T5's §D6 ownership; this section covers the
// retry-safety line (shared with the dialog) and every completion/failure
// toast the execute path (Library.tsx's executeDeletePermanent) can show.
// =============================================================================

/** D2 — shown in DeletePermanentDialog regardless of whether the graph
 *  estimate is known: documents the AR3-1 fail-closed guarantee in plain
 *  language, so a refusal never reads as a mysterious dead end. */
export const GRAPH_CLEANUP_RETRY_SAFETY_LINE =
  "If the knowledge-graph cleanup can't complete, nothing is deleted — you can retry."

// --- Failure (nothing deleted) ---------------------------------------------

export const FAILURE_NOTHING_DELETED_TITLE = 'Delete failed — nothing was removed'

/** AR3-1/AR3-3(a) — the local purge itself refused (fail-closed) because the
 *  graph cleanup seam is unavailable. Pairs with the AR3-3(c) escape-hatch
 *  toast action. */
export function graphCleanupFailedBody(filename: string): string {
  return `Couldn't finish removing "${filename}" (graph cleanup failed). Nothing was deleted; please retry.`
}

export function genericPermanentDeleteFailedBody(filename: string): string {
  return `Failed to permanently delete "${filename}". Nothing was deleted; please retry.`
}

/** AR3-3(c) — the failure toast's explicit second-action label. */
export const LABEL_DELETE_ANYWAY_SKIP_GRAPH = 'Delete anyway (skip graph cleanup)'

// --- Partial (local purge succeeded, something else did not) ---------------

/** D3 — device copy remains after a confirmed local purge (device delete
 *  failed OR AR3-6(a)'s TOCTOU re-check found the device no longer usable at
 *  execute time). Never the plain success toast in this case. */
export const DEVICE_COPY_REMAINS_TITLE = 'Removed locally — device copy remains'

export function deviceCopyRemainsBody(filename: string): string {
  return (
    `Removed "${filename}" and its data from this computer. The device copy is still there ` +
    'and will reconcile on the next device scan.'
  )
}

/** AR3-2 — one or more post-commit file-cleanup targets could not be
 *  confirmed removed; a bounded retry sweep will keep trying. Success is
 *  intentionally NOT claimed here. */
export const FILES_PENDING_TITLE = 'Removed data — cleanup still finishing'

const CLEANUP_KIND_LABELS: Record<string, string> = {
  audio: 'the audio file',
  wiki: 'a wiki page',
  artifact: 'an artifact file',
  vector: 'a search index entry'
}

function joinParts(parts: string[]): string {
  if (parts.length === 0) return ''
  if (parts.length === 1) return parts[0]
  return `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}`
}

export function filesPendingBody(filename: string, kinds: string[]): string {
  const unique = Array.from(new Set(kinds)).map((k) => CLEANUP_KIND_LABELS[k] ?? `a ${k} file`)
  const list = joinParts(unique) || 'a file'
  return `Removed "${filename}"'s data, but ${list} couldn't be deleted yet. It will retry automatically.`
}

/** CX-T6-5 (fix round 2) — the device copy WAS removed and the local purge
 *  succeeded, but the view-bookkeeping reconciliation (markNotOnDevice: row
 *  flip + device-cache entry removal) failed — so the list may keep showing
 *  the file until the next authoritative device scan corrects it. Appended
 *  as a small note to the (warning-variant) completion toast; never claims
 *  the view is already consistent. */
export const VIEW_MAY_BE_STALE_NOTE =
  'The list may still show the device copy until the next device scan.'

/** CX-T6-3 (fix round) — BOTH partial outcomes at once: the device copy
 *  wasn't removed AND local file cleanup is still pending. One toast that
 *  enumerates both; never a body that claims full local removal while the
 *  pending-cleanup ledger is non-empty. */
export const COMBINED_PARTIAL_TITLE = 'Partially removed — device copy remains'

export function combinedPartialBody(filename: string, kinds: string[]): string {
  const unique = Array.from(new Set(kinds)).map((k) => CLEANUP_KIND_LABELS[k] ?? `a ${k} file`)
  const list = joinParts(unique) || 'a file'
  return (
    `Removed "${filename}"'s data, but ${list} couldn't be deleted yet (it will retry automatically), ` +
    'and the device copy is still there — it will reconcile on the next device scan.'
  )
}

// --- Success (D5 — actual counts, not the dialog's estimate) ---------------

export interface ActualRemovedCounts {
  transcripts?: number
  actionItems?: number
  embeddings?: number
  edgesRemoved?: number
}

/** D5 — the completion toast reports ACTUAL counts (unlike the dialog, which
 *  shows an estimate). Appends "and the device copy" only when the device
 *  branch also confirmed removal. */
export function actualRemovalSummary(removed: ActualRemovedCounts | undefined, alsoDeviceRemoved: boolean): string {
  const parts: string[] = []
  if (removed?.transcripts) parts.push(`${removed.transcripts} transcript${removed.transcripts === 1 ? '' : 's'}`)
  if (removed?.actionItems) parts.push(`${removed.actionItems} action item${removed.actionItems === 1 ? '' : 's'}`)
  if (removed?.embeddings) parts.push(`${removed.embeddings} embedding${removed.embeddings === 1 ? '' : 's'}`)
  if (removed?.edgesRemoved) parts.push(`${removed.edgesRemoved} graph link${removed.edgesRemoved === 1 ? '' : 's'}`)
  const removedText = joinParts(parts) || 'its data'
  const deviceSuffix = alsoDeviceRemoved ? ' and the device copy' : ''
  return `Removed ${removedText}${deviceSuffix}.`
}

export const SUCCESS_DELETED_PERMANENTLY_TITLE = 'Deleted permanently'

/** The three device-branch outcomes `executeDeletePermanent` can reach. */
export type DeviceDeleteOutcome = 'not-requested' | 'success' | 'partial'

export interface CompletionToastInputs {
  filename: string
  deviceOutcome: DeviceDeleteOutcome
  /** AR3-2 — true when the local purge's own post-commit file cleanup left something pending. */
  filesPending: boolean
  pendingKinds: string[]
  /** CX-T6-5/CX-T6-6 — true when the device copy WAS removed but the
   *  view-bookkeeping reconciliation or the local rebuild failed, so the
   *  list may still show it until the next authoritative device scan. */
  viewMayBeStale: boolean
  removed: ActualRemovedCounts | undefined
}

export interface CompletionToast {
  variant: 'success' | 'warning'
  title: string
  body: string
}

/**
 * The permanent-delete completion-toast outcome ladder (T6 fix rounds
 * CX-T6-1..6), extracted to a pure function of its inputs so the priority
 * order — combined-partial > device-partial > files-pending > stale-view >
 * plain success — is unit-testable directly instead of only through the
 * rendered Library flow (phase-3 integration-review `/simplify` candidate
 * #2). `executeDeletePermanent` (Library.tsx) computes the inputs — live
 * device calls, IPC reconciliation, refreshLocal outcomes — and simply
 * dispatches whatever this returns; it owns no copy decisions of its own.
 */
export function selectCompletionToast(inputs: CompletionToastInputs): CompletionToast {
  const { filename, deviceOutcome, filesPending, pendingKinds, viewMayBeStale, removed } = inputs
  const staleNote = viewMayBeStale ? ` ${VIEW_MAY_BE_STALE_NOTE}` : ''

  if (deviceOutcome === 'partial' && filesPending) {
    // CX-T6-3 — both partial outcomes must surface together; the
    // device-only body would otherwise overclaim full local removal.
    return { variant: 'warning', title: COMBINED_PARTIAL_TITLE, body: combinedPartialBody(filename, pendingKinds) }
  }
  if (deviceOutcome === 'partial') {
    return { variant: 'warning', title: DEVICE_COPY_REMAINS_TITLE, body: deviceCopyRemainsBody(filename) }
  }
  if (filesPending) {
    return {
      variant: 'warning',
      title: FILES_PENDING_TITLE,
      body: filesPendingBody(filename, pendingKinds) + staleNote
    }
  }
  if (viewMayBeStale) {
    // Everything WAS deleted (local + device) — the honest partial path
    // applies: warning variant, with the stale-view note appended.
    return {
      variant: 'warning',
      title: SUCCESS_DELETED_PERMANENTLY_TITLE,
      body: `${actualRemovalSummary(removed, true)}${staleNote}`
    }
  }
  return {
    variant: 'success',
    title: SUCCESS_DELETED_PERMANENTLY_TITLE,
    body: actualRemovalSummary(removed, deviceOutcome === 'success')
  }
}
