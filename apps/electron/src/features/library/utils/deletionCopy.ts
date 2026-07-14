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
