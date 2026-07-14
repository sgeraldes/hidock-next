/**
 * Duration filtering for the Knowledge Library.
 *
 * Duration controls apply to AUDIO recordings only. Non-audio sources (images,
 * PDFs, notes) have no duration and are excluded gracefully when a duration
 * filter is active — they are never falsely matched by a "< 1 min" preset.
 */

import type { UnifiedRecording } from '@/types/unified-recording'
import { getSourceType, sourceTypeHasDuration } from './sourceType'

export type DurationPreset = 'all' | 'under10s' | 'under1m' | 'under5m' | 'over5m'

/** Upper bound (seconds, exclusive) for a preset, or null when unbounded/all. */
const PRESET_MAX: Record<DurationPreset, number | null> = {
  all: null,
  under10s: 10,
  under1m: 60,
  under5m: 300,
  over5m: null // handled specially (>= 300)
}

export const DURATION_PRESET_LABELS: Record<DurationPreset, string> = {
  all: 'Any length',
  under10s: 'Under 10s',
  under1m: 'Under 1 min',
  under5m: 'Under 5 min',
  over5m: 'Over 5 min'
}

/**
 * Does a recording match the active duration preset?
 *
 * - `all` matches everything (no filtering).
 * - Any other preset only ever matches audio with a known (> 0) duration; every
 *   non-audio or unknown-duration row is excluded so junk-cleanup by length is
 *   precise.
 */
export function matchesDurationPreset(recording: UnifiedRecording, preset: DurationPreset): boolean {
  if (preset === 'all') return true

  const type = getSourceType(recording)
  if (!sourceTypeHasDuration(type)) return false

  const duration = recording.duration ?? 0
  if (duration <= 0) return false

  if (preset === 'over5m') return duration >= 300
  const max = PRESET_MAX[preset]
  if (max === null) return true
  return duration < max
}
