/**
 * resolveParticipants
 *
 * Derives the "who actually spoke" list for a recording from the SAME resolved
 * speaker map the transcript viewer uses, so a correction made in the transcript
 * (assign a diarization label to a contact, override a single turn, or split a
 * merged label) is reflected in the Participants list immediately.
 *
 * The transcript resolves each turn's identity as:
 *   base      = the raw diarization label (segment.speaker, e.g. "Speaker 1")
 *   effective = base, or its split-derived label when a split boundary applies
 *   identity  = a per-turn override  ??  the label→contact binding  ??  the label
 *
 * This helper replays that exact resolution across every turn and groups the
 * result into distinct speakers, keyed by contact id when resolved (so the same
 * person under two labels collapses) or by the effective label otherwise.
 *
 * Turn indices MUST be computed against the SAME expanded segment list the
 * viewer renders (legacy chunk blobs are re-split via `expandInlineStoredSegments`),
 * otherwise per-turn overrides and splits would bind to the wrong turns.
 */

import type { StoredSegment } from '../components/TranscriptViewer'
import { expandInlineStoredSegments } from './splitInlineTurns'

/** A speaker split loaded from the backend (base label forked from a turn on). */
export interface SpeakerSplit {
  baseLabel: string
  fromIndex: number
  derivedLabel: string
}

/** A single resolved contact assignment (from the label map or a per-turn override). */
export interface SpeakerAssignment {
  contactId: string
  name: string
}

export interface ResolveSpeakerContext {
  splits: SpeakerSplit[]
  /** effective label → assigned contact ("everywhere" bindings). */
  speakerMap: Map<string, SpeakerAssignment>
  /** turn index → assigned contact (supersedes the label map for that turn). */
  turnOverrides: Map<number, SpeakerAssignment>
  /** base labels the self-ID pass suspects are two merged people. */
  mergeHints: Set<string>
}

export interface ResolvedSpeaker {
  /** Dedupe key: the contact id when resolved, else the effective label. */
  key: string
  /** Display name — the person's name when resolved, else the effective label. */
  name: string
  /** Resolved contact id, when this speaker maps to a known person. */
  contactId?: string
  /** The raw diarization base label (what the assign popover binds "everywhere"). */
  baseLabel: string
  /** The effective (possibly split-derived) label — the assign key + fallback name. */
  effectiveLabel: string
  /** First turn index this identity appears at (the popover's turn context). */
  firstTurnIndex: number
  /** How many turns are attributed to this identity. */
  turnCount: number
  /** The self-ID pass suspects the base label is two people. */
  mergeSuspected: boolean
}

/**
 * The effective label for a turn: if a split for this base label begins at or
 * before this turn, the derived label of the latest such boundary; else the raw
 * base label. Mirrors TranscriptViewer.effectiveLabelFor exactly.
 */
export function effectiveLabelFor(baseLabel: string, turnIndex: number, splits: SpeakerSplit[]): string {
  let best: SpeakerSplit | undefined
  for (const s of splits) {
    if (s.baseLabel !== baseLabel) continue
    if (s.fromIndex <= turnIndex && (!best || s.fromIndex > best.fromIndex)) best = s
  }
  return best ? best.derivedLabel : baseLabel
}

/**
 * A raw, un-named diarization label like "Speaker 1", "speaker_2", "SPEAKER 03".
 * Used to decide whether the Participants list still has unidentified speakers
 * worth polling the resolved map for (a correction may land from the transcript).
 */
export function isRawSpeakerLabel(name: string): boolean {
  return /^\s*speaker[\s_-]*\d+\s*$/i.test(name)
}

/** Resolve the distinct speakers who actually spoke, applying all corrections. */
export function resolveParticipants(
  segments: StoredSegment[] | undefined,
  ctx: ResolveSpeakerContext
): ResolvedSpeaker[] {
  const expanded = expandInlineStoredSegments(segments ?? []).filter((s) => s.text?.trim())
  const order: string[] = []
  const byKey = new Map<string, ResolvedSpeaker>()

  expanded.forEach((seg, turnIndex) => {
    const base = seg.speaker?.trim()
    if (!base) return
    const effective = effectiveLabelFor(base, turnIndex, ctx.splits)
    const override = ctx.turnOverrides.get(turnIndex)
    const labelAssign = ctx.speakerMap.get(effective)
    const assigned = override ?? labelAssign
    const contactId = assigned?.contactId
    const name = assigned?.name ?? effective
    const key = contactId ? `c:${contactId}` : `l:${effective}`

    const existing = byKey.get(key)
    if (existing) {
      existing.turnCount += 1
      // Keep the earliest turn as the popover context.
      if (turnIndex < existing.firstTurnIndex) {
        existing.firstTurnIndex = turnIndex
        existing.baseLabel = base
        existing.effectiveLabel = effective
      }
      existing.mergeSuspected = existing.mergeSuspected || ctx.mergeHints.has(base)
      return
    }
    order.push(key)
    byKey.set(key, {
      key,
      name,
      contactId,
      baseLabel: base,
      effectiveLabel: effective,
      firstTurnIndex: turnIndex,
      turnCount: 1,
      mergeSuspected: ctx.mergeHints.has(base)
    })
  })

  return order.map((k) => byKey.get(k)!)
}
