/**
 * speakerBus — a tiny in-renderer pub/sub for speaker-assignment changes.
 *
 * The transcript viewer and the reader's Participants panel each own their own
 * copy of the resolved speaker map (label bindings, per-turn overrides, splits).
 * When one panel changes an assignment we want the other to re-read the persisted
 * map so a corrected name shows up immediately, without threading state through a
 * component we don't own. A DOM CustomEvent on `window` is the lightest seam:
 * emitters call `emitSpeakerChange(recordingId)`, listeners subscribe with
 * `onSpeakerChange`.
 */

const EVENT = 'hidock:speaker-assignment-changed'

/** Notify listeners that a recording's speaker assignments changed. */
export function emitSpeakerChange(recordingId: string): void {
  if (typeof window === 'undefined') return
  window.dispatchEvent(new CustomEvent(EVENT, { detail: { recordingId } }))
}

/**
 * Subscribe to speaker-assignment changes. The callback receives the affected
 * recording id. Returns an unsubscribe function.
 */
export function onSpeakerChange(cb: (recordingId: string) => void): () => void {
  if (typeof window === 'undefined') return () => {}
  const handler = (e: Event) => {
    const id = (e as CustomEvent<{ recordingId?: string }>).detail?.recordingId
    cb(id ?? '')
  }
  window.addEventListener(EVENT, handler)
  return () => window.removeEventListener(EVENT, handler)
}
