/**
 * speakerRanges
 *
 * Derives per-speaker time RANGES (and a stable color per speaker) from a
 * recording's stored transcript segments, so the full-mode waveform timeline can
 * paint each bar with the color of whoever was speaking at that moment.
 *
 * Colors are assigned by RESOLVED speaker key — the SAME key the reader's
 * Participants list uses (a contact id when a diarization label is bound to a
 * person, else the effective label). Because the key is shared, the swatch shown
 * on a Participants chip and the bars painted for that speaker use ONE identical
 * color. Callers supply a `resolveLabel` that maps a raw diarization label to its
 * resolved `{ key, name }`; when omitted (or when a label has no resolution) the
 * label itself is used, so this degrades gracefully with no speaker map.
 *
 * Timing note: segments are expanded with `expandInlineStoredSegments` first, so
 * legacy chunk-blob transcripts (one segment packing many `[MM:SS] Speaker N:`
 * turns) still yield correct per-turn ranges — the SAME expansion the transcript
 * viewer and resolveParticipants use, keeping turn boundaries consistent.
 */

import type { StoredSegment } from '../components/TranscriptViewer'
import { expandInlineStoredSegments } from './splitInlineTurns'

/**
 * Categorical speaker palette. Mid-saturation 600-weight hues chosen to (a) stay
 * distinct from one another and (b) read on BOTH the light lavender and the dark
 * player panels. Assigned round-robin by first appearance, so the same speaker
 * always gets the same color within a recording.
 */
export const SPEAKER_PALETTE = [
  '#2563EB', // blue-600
  '#059669', // emerald-600
  '#7C3AED', // violet-600
  '#D97706', // amber-600
  '#E11D48', // rose-600
  '#0891B2', // cyan-600
  '#C026D3', // fuchsia-600
  '#65A30D', // lime-600
] as const

/** A single painted time range attributed to one resolved speaker. */
export interface DerivedSpeakerRange {
  startSec: number
  endSec: number
  /** Resolved speaker key (contact id key or effective label) — the color key. */
  speakerKey: string
  /** Display name (resolved person name, else the diarization label). */
  name: string
  /** The stable color assigned to this speaker. */
  color: string
}

/** One legend row: a distinct speaker with its color and how much it spoke. */
export interface SpeakerLegendEntry {
  speakerKey: string
  name: string
  color: string
  turnCount: number
}

/** What a raw diarization label resolves to (shared with the Participants list). */
export interface SpeakerLabelResolution {
  key: string
  name: string
}

export interface SpeakerRangesResult {
  ranges: DerivedSpeakerRange[]
  legend: SpeakerLegendEntry[]
  /** speakerKey → color, so Participants chips can show the matching swatch. */
  colorByKey: Map<string, string>
}

const EMPTY: SpeakerRangesResult = { ranges: [], legend: [], colorByKey: new Map() }

/**
 * Derive per-speaker ranges + colors from stored transcript segments.
 *
 * @param segments    The recording's stored `speakers` segments (seconds-based).
 * @param durationSec Total audio duration; used to close the final turn and to
 *                    clamp ranges. When ≤ 0, ranges are still produced from the
 *                    segment times (callers gate rendering on a real duration).
 * @param resolveLabel Maps a raw diarization label ("Speaker 2") to its resolved
 *                     `{ key, name }` (from the shared participant map). Optional.
 *                     Receives the turn index (position in the SAME expanded,
 *                     text-filtered turn list resolveParticipants uses), so
 *                     per-turn corrections — splits ("Speaker 1 · B" from turn N
 *                     on) and per-turn overrides — resolve to DIFFERENT keys on
 *                     each side of a boundary instead of collapsing to one color.
 */
export function deriveSpeakerRanges(
  segments: StoredSegment[] | undefined,
  durationSec: number,
  resolveLabel?: (baseLabel: string, turnIndex: number) => SpeakerLabelResolution | undefined
): SpeakerRangesResult {
  if (!segments || segments.length === 0) return EMPTY

  const expanded = expandInlineStoredSegments(segments).filter((s) => s.text?.trim())
  if (expanded.length === 0) return EMPTY

  // First pass: build raw ranges keyed by resolved speaker, collecting the order
  // in which distinct keys first appear (that order drives color assignment).
  interface Raw {
    startSec: number
    endSec: number
    key: string
    name: string
  }
  const raws: Raw[] = []
  const keyOrder: string[] = []
  const seenKeys = new Set<string>()

  for (let i = 0; i < expanded.length; i++) {
    const seg = expanded[i]
    const base = seg.speaker?.trim()
    if (!base) continue // untagged turn → leave a color gap

    const resolved = resolveLabel?.(base, i)
    const key = resolved?.key ?? `l:${base}`
    const name = resolved?.name ?? base

    let startSec = Number.isFinite(seg.start) ? Math.max(0, seg.start || 0) : 0
    // End = this turn's own end, else the next turn's start, else the duration.
    let endSec: number
    if (seg.end != null && Number.isFinite(seg.end)) {
      endSec = seg.end
    } else {
      const next = expanded[i + 1]
      endSec = next && Number.isFinite(next.start) ? next.start : durationSec
    }
    if (durationSec > 0) {
      startSec = Math.min(startSec, durationSec)
      endSec = Math.min(endSec, durationSec)
    }
    if (!(endSec > startSec)) continue // skip zero/negative-width turns

    raws.push({ startSec, endSec, key, name })
    if (!seenKeys.has(key)) {
      seenKeys.add(key)
      keyOrder.push(key)
    }
  }

  if (raws.length === 0) return EMPTY

  // Assign one color per distinct key, round-robin over the palette.
  const colorByKey = new Map<string, string>()
  keyOrder.forEach((key, idx) => {
    colorByKey.set(key, SPEAKER_PALETTE[idx % SPEAKER_PALETTE.length])
  })

  const ranges: DerivedSpeakerRange[] = raws.map((r) => ({
    startSec: r.startSec,
    endSec: r.endSec,
    speakerKey: r.key,
    name: r.name,
    color: colorByKey.get(r.key)!,
  }))

  // Legend: one row per distinct key (first-appearance order), aggregating turns.
  const legendByKey = new Map<string, SpeakerLegendEntry>()
  for (const r of ranges) {
    const existing = legendByKey.get(r.speakerKey)
    if (existing) {
      existing.turnCount += 1
    } else {
      legendByKey.set(r.speakerKey, {
        speakerKey: r.speakerKey,
        name: r.name,
        color: r.color,
        turnCount: 1,
      })
    }
  }
  const legend = keyOrder.map((k) => legendByKey.get(k)!).filter(Boolean)

  return { ranges, legend, colorByKey }
}
