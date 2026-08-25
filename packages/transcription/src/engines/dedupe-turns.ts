import type { TranscriptSegment } from './engine-interface.js'

/**
 * Block-level de-duplication for assembled speaker turns.
 *
 * WHY THIS EXISTS
 * ---------------
 * Long recordings are transcribed in several provider calls (fixed audio
 * chunks, or Interactions ranges over one uploaded file). Those calls are NOT
 * independent: the chunked path feeds the previous chunk's tail back in the
 * prompt, and the Interactions path threads `previousInteractionId` so the
 * whole previous response sits in the model's context. Both give the model a
 * standing invitation to re-emit content it already produced, and it takes it:
 * on live recordings we measured a full ~10-minute block of turns re-appearing
 * verbatim at the NEXT chunk's offset (Rec08: 29 turns repeated at +600s AND
 * +1800s; Rec18: 20 turns repeated at +1200s, one chunk length, with the newer
 * Interactions path).
 *
 * The audio splitter is not at fault — chunks are contiguous, gap-free and
 * byte-distinct (verified by hashing real recordings). The repetition is in
 * the model's OUTPUT, so the defence belongs at assembly, provider-agnostic.
 *
 * WHY A "RUN" AND NOT A PLAIN SET
 * -------------------------------
 * Real conversation repeats short turns constantly — "Sí.", "Okay.", "Eh".
 * Dropping every repeated line destroys real speech (a naive line-level dedup
 * scored one 71-minute interview as 27% duplicated when most of that was
 * genuine backchannel). So a repeat is only dropped when it is part of a RUN
 * of consecutive turns that already occurred consecutively, and that run
 * carries at least one substantive (long) turn. A single sentence repeated by
 * a speaker for emphasis is preserved; a re-emitted block is not.
 */

/** Consecutive matching turns required before a repeat is treated as a block. */
export const MIN_DUPLICATE_RUN = 2
/** A run must contain at least one turn this long to be droppable. */
export const MIN_SUBSTANTIVE_CHARS = 40
/** Consecutive identical substantive turns tolerated before collapsing (loop guard). */
export const MAX_CONSECUTIVE_REPEATS = 2

export function normalizeTurnText(text: string): string {
  return text.toLowerCase().replace(/\s+/g, ' ').trim()
}

/**
 * Incremental de-duplicator. Feed it each provider call's turns in order; it
 * returns only the turns that are not a replay of something already accepted.
 * State is kept across calls so cross-chunk block repeats are caught, and the
 * same pass also catches a chunk repeating itself (the "tail loops forever"
 * failure).
 */
export class TurnDeduper {
  /** Normalized text of every accepted turn, in order. */
  private readonly accepted: string[] = []
  /** normalized text -> indices in `accepted`, for run matching. */
  private readonly index = new Map<string, number[]>()
  private droppedCount = 0

  /** Number of turns suppressed so far (for quality reporting). */
  get dropped(): number {
    return this.droppedCount
  }

  /** Turns accepted so far. */
  get size(): number {
    return this.accepted.length
  }

  /**
   * Filter one batch of turns against everything accepted so far (and against
   * itself). Returns the surviving turns in their original order.
   */
  push(incoming: TranscriptSegment[]): TranscriptSegment[] {
    const out: TranscriptSegment[] = []
    const norms = incoming.map((turn) => normalizeTurnText(turn.text ?? ''))
    let i = 0
    while (i < incoming.length) {
      const runLength = this.longestRepeatedRunAt(incoming, norms, i)
      if (runLength >= MIN_DUPLICATE_RUN) {
        this.droppedCount += runLength
        i += runLength
        continue
      }
      if (this.isDegenerateRepeat(norms[i])) {
        this.droppedCount += 1
        i += 1
        continue
      }
      out.push(incoming[i])
      this.accept(norms[i])
      i += 1
    }
    return out
  }

  private accept(norm: string): void {
    const position = this.accepted.length
    this.accepted.push(norm)
    const bucket = this.index.get(norm)
    if (bucket) bucket.push(position)
    else this.index.set(norm, [position])
  }

  /**
   * A substantive turn repeated back-to-back beyond MAX_CONSECUTIVE_REPEATS is
   * a generation loop, not speech. Runs of length 1 never reach the run matcher,
   * so this catches the degenerate `A A A A …` tail.
   */
  private isDegenerateRepeat(norm: string): boolean {
    if (norm.length < MIN_SUBSTANTIVE_CHARS) return false
    let repeats = 0
    for (let k = this.accepted.length - 1; k >= 0 && this.accepted[k] === norm; k--) repeats++
    return repeats >= MAX_CONSECUTIVE_REPEATS
  }

  /**
   * Longest run starting at `from` that already appears as a consecutive run in
   * the accepted history. Returns 0 when the run is not substantive enough to
   * be worth dropping.
   */
  private longestRepeatedRunAt(
    incoming: TranscriptSegment[],
    norms: string[],
    from: number
  ): number {
    const starts = this.index.get(norms[from])
    if (!starts || starts.length === 0) return 0

    let best = 0
    for (const start of starts) {
      let length = 0
      while (
        start + length < this.accepted.length &&
        from + length < incoming.length &&
        this.accepted[start + length] === norms[from + length]
      ) {
        length++
      }
      if (length > best) best = length
    }
    if (best < MIN_DUPLICATE_RUN) return 0

    // Only drop a run that carries real content; a run of pure backchannel
    // ("Sí." / "Okay.") is ordinary conversation, not a replay.
    const substantive = norms
      .slice(from, from + best)
      .some((norm) => norm.length >= MIN_SUBSTANTIVE_CHARS)
    return substantive ? best : 0
  }
}

/** One-shot convenience wrapper over {@link TurnDeduper}. */
export function dedupeTurns(turns: TranscriptSegment[]): TranscriptSegment[] {
  return new TurnDeduper().push(turns)
}
