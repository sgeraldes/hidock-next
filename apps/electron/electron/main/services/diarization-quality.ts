export interface DiarizationSegment {
  speaker?: string
  start?: number
  end?: number
  text?: string
  /** How this turn's speaker was decided (see reconcileProviderSpeakers). */
  speakerAttribution?: string
  /** 0..1 acoustic overlap backing the speaker label. */
  speakerConfidence?: number
}

export interface AudioActivityInterval {
  start: number
  end: number
}

export interface DiarizationQualityReport {
  status: 'high' | 'degraded' | 'failed' | 'unavailable'
  segmentCount: number
  speakerCount: number
  coveredSeconds: number
  coverageRatio: number | null
  unattributedSeconds: number | null
  malformedSegments: number
  groundedSegments: number
  groundingRatio: number | null
  /**
   * True when the turns carry MORE THAN ONE speaker-label scheme (e.g. stable
   * "Voice C5C45B" alongside raw "SPEAKER_00"). That inflates a naive distinct
   * label count - a 1:1 call read as 4 speakers - and makes one person appear
   * under two tags. speakerCount below reports the authoritative scheme only.
   */
  mixedLabelSchemes: boolean
  /** Turns whose speaker could not be attributed to any acoustic voice. */
  unresolvedSpeakerSegments: number
  /** Turns attributed on weak acoustic overlap; treat their speaker as a guess. */
  lowConfidenceSpeakerSegments: number
  /**
   * Seconds of locally detected SPEECH that fall after the last transcribed
   * turn. Non-zero means the provider stopped early and real conversation is
   * missing — distinct from trailing silence, which is not a defect.
   */
  untranscribedSpeechSeconds: number
  reasons: string[]
}

/**
 * A tail this short is boundary noise between VAD and the provider's last
 * timestamp, not a truncated transcript.
 */
const TRUNCATION_TOLERANCE_SECONDS = 30

/**
 * Seconds of detected speech activity occurring after `lastTurnEnd`.
 *
 * This is the honest test for "the transcript stops early". Comparing the last
 * turn against the FILE duration cannot distinguish a truncated transcript from
 * a recording that simply ends in quiet; comparing it against locally detected
 * voice activity can. On the 56-minute interview that lost its last 10.4
 * minutes, the audio after the final turn is continuous conversation.
 */
export function untranscribedSpeechAfter(
  lastTurnEnd: number,
  activityIntervals: AudioActivityInterval[] | null | undefined
): number {
  if (!activityIntervals || activityIntervals.length === 0) return 0
  let seconds = 0
  for (const interval of activityIntervals) {
    const start = Math.max(interval.start, lastTurnEnd)
    if (interval.end > start) seconds += interval.end - start
  }
  return seconds <= TRUNCATION_TOLERANCE_SECONDS ? 0 : round(seconds)
}

/** Stable cross-recording voice label minted by speaker-linking. */
const STABLE_VOICE_LABEL = /^Voice [0-9A-F]{6}$/
/** Raw diarizer / provider label (SPEAKER_00, Speaker 1, ...). */
const PROVIDER_SPEAKER_LABEL = /^speaker[\s_]*\d+$/i

/**
 * Distinct speakers, counted on ONE scheme. When both a stable scheme and a raw
 * provider scheme are present the stable one wins: the raw labels are residue
 * from turns the reconciler could not attribute, not extra people.
 */
export function countDistinctSpeakers(labels: Iterable<string>): {
  speakerCount: number
  mixedLabelSchemes: boolean
} {
  const all = new Set<string>()
  for (const label of labels) if (label) all.add(label)
  const stable = [...all].filter((label) => STABLE_VOICE_LABEL.test(label))
  const provider = [...all].filter((label) => PROVIDER_SPEAKER_LABEL.test(label))
  const mixedLabelSchemes = stable.length > 0 && provider.length > 0
  return {
    speakerCount: mixedLabelSchemes ? stable.length : all.size,
    mixedLabelSchemes
  }
}

function round(value: number): number {
  return Math.round(value * 1000) / 1000
}

/**
 * Deterministic post-provider quality gate for VAD/diarization output. It never
 * invents speaker identities. Failed reports block identity inference; degraded
 * reports are retained and labeled so the transcript remains usable without
 * pretending the diarization is trustworthy.
 */
export function assessDiarizationQuality(
  segments: DiarizationSegment[] | null | undefined,
  durationSeconds?: number | null,
  activityIntervals?: AudioActivityInterval[] | null
): DiarizationQualityReport {
  if (!segments || segments.length === 0) {
    return {
      status: 'unavailable',
      segmentCount: 0,
      speakerCount: 0,
      coveredSeconds: 0,
      coverageRatio: durationSeconds && durationSeconds > 0 ? 0 : null,
      unattributedSeconds: durationSeconds && durationSeconds > 0 ? durationSeconds : null,
      malformedSegments: 0,
      groundedSegments: 0,
      groundingRatio: activityIntervals ? 0 : null,
      mixedLabelSchemes: false,
      unresolvedSpeakerSegments: 0,
      lowConfidenceSpeakerSegments: 0,
      untranscribedSpeechSeconds: 0,
      reasons: ['No timestamped speaker segments were returned']
    }
  }

  const valid: Array<{
    start: number
    end: number
    speaker: string
    speakerAttribution?: string
  }> = []
  let malformedSegments = 0
  for (const segment of segments) {
    const start = segment.start
    const end = segment.end
    const speaker = segment.speaker?.trim() || ''
    if (!Number.isFinite(start) || !Number.isFinite(end) || (start as number) < 0 || (end as number) <= (start as number)) {
      malformedSegments++
      continue
    }
    valid.push({
      start: start as number,
      end: end as number,
      speaker,
      speakerAttribution: segment.speakerAttribution
    })
  }

  if (valid.length === 0) {
    return {
      status: 'failed',
      segmentCount: segments.length,
      speakerCount: 0,
      coveredSeconds: 0,
      coverageRatio: durationSeconds && durationSeconds > 0 ? 0 : null,
      unattributedSeconds: durationSeconds && durationSeconds > 0 ? durationSeconds : null,
      malformedSegments,
      groundedSegments: 0,
      groundingRatio: activityIntervals ? 0 : null,
      mixedLabelSchemes: false,
      unresolvedSpeakerSegments: 0,
      lowConfidenceSpeakerSegments: 0,
      untranscribedSpeechSeconds: 0,
      reasons: ['All diarization segments have invalid timestamps']
    }
  }

  const sorted = valid.slice().sort((a, b) => a.start - b.start || a.end - b.end)
  let coveredSeconds = 0
  let rangeStart = sorted[0].start
  let rangeEnd = sorted[0].end
  for (const segment of sorted.slice(1)) {
    if (segment.start <= rangeEnd) {
      rangeEnd = Math.max(rangeEnd, segment.end)
    } else {
      coveredSeconds += rangeEnd - rangeStart
      rangeStart = segment.start
      rangeEnd = segment.end
    }
  }
  coveredSeconds += rangeEnd - rangeStart

  const { speakerCount, mixedLabelSchemes } = countDistinctSpeakers(
    valid.map((segment) => segment.speaker).filter(Boolean) as string[]
  )
  const unresolvedSpeakerSegments = valid.filter(
    (segment) => segment.speakerAttribution === 'unresolved'
  ).length
  const lowConfidenceSpeakerSegments = valid.filter(
    (segment) => segment.speakerAttribution === 'acoustic-weak'
  ).length
  const lastTurnEnd = valid.reduce((latest, segment) => Math.max(latest, segment.end), 0)
  const untranscribedSpeechSeconds = untranscribedSpeechAfter(lastTurnEnd, activityIntervals)
  const duration = durationSeconds && durationSeconds > 0 ? durationSeconds : null
  const boundedCoverage = duration ? Math.min(coveredSeconds, duration) : coveredSeconds
  const coverageRatio = duration ? boundedCoverage / duration : null
  const unattributedSeconds = duration ? Math.max(0, duration - boundedCoverage) : null
  const reasons: string[] = []

  // Provider timestamps must be grounded in independently detected local
  // audio activity. A small pad permits VAD/timestamp boundary disagreement;
  // calendar or transcript content can never satisfy this check.
  const GROUNDING_PAD_SECONDS = 1.5
  const groundedSegments = activityIntervals
    ? valid.filter((segment) => activityIntervals.some((interval) =>
        segment.start >= interval.start - GROUNDING_PAD_SECONDS &&
        segment.start <= interval.end + GROUNDING_PAD_SECONDS
      )).length
    : 0
  const groundingRatio = activityIntervals ? groundedSegments / valid.length : null

  if (malformedSegments > 0) reasons.push(`${malformedSegments} segment(s) have invalid timestamps`)
  if (mixedLabelSchemes) {
    reasons.push('Speaker labels mix more than one naming scheme; some turns were never attributed to a voice')
  }
  if (unresolvedSpeakerSegments > 0) {
    reasons.push(`${unresolvedSpeakerSegments} segment(s) have an unattributed speaker`)
  }
  if (lowConfidenceSpeakerSegments > 0) {
    reasons.push(`${lowConfidenceSpeakerSegments} segment(s) have a low-confidence speaker label`)
  }
  if (untranscribedSpeechSeconds > 0) {
    reasons.push(
      `Transcript ends ${Math.round(untranscribedSpeechSeconds)}s of detected speech early ` +
        '(the recording keeps talking after the last turn)'
    )
  }
  if (valid.some((segment) => !segment.speaker)) reasons.push('One or more segments have no speaker label')
  if (coverageRatio !== null && coverageRatio < 0.55) reasons.push('Timestamped speech covers less than 55% of the recording')
  if (duration && sorted[sorted.length - 1].end > duration + 5) reasons.push('Segment timestamps extend beyond the recording duration')
  if (groundingRatio !== null && groundingRatio < 0.5) {
    reasons.push('Fewer than 50% of provider speaker turns are grounded in local audio activity')
  }

  const malformedRatio = malformedSegments / segments.length
  const failed = malformedRatio >= 0.5 || (groundingRatio !== null && groundingRatio < 0.5)
  const degraded = reasons.length > 0

  return {
    status: failed ? 'failed' : degraded ? 'degraded' : 'high',
    segmentCount: segments.length,
    speakerCount,
    coveredSeconds: round(coveredSeconds),
    coverageRatio: coverageRatio === null ? null : round(coverageRatio),
    unattributedSeconds: unattributedSeconds === null ? null : round(unattributedSeconds),
    malformedSegments,
    groundedSegments,
    groundingRatio: groundingRatio === null ? null : round(groundingRatio),
    mixedLabelSchemes,
    unresolvedSpeakerSegments,
    lowConfidenceSpeakerSegments,
    untranscribedSpeechSeconds,
    reasons
  }
}

export function parseAndAssessDiarization(
  speakersJson: string | null | undefined,
  durationSeconds?: number | null,
  activityIntervals?: AudioActivityInterval[] | null
): DiarizationQualityReport {
  if (!speakersJson) return assessDiarizationQuality(undefined, durationSeconds, activityIntervals)
  try {
    const parsed = JSON.parse(speakersJson)
    return assessDiarizationQuality(Array.isArray(parsed) ? parsed : undefined, durationSeconds, activityIntervals)
  } catch {
    return {
      status: 'failed',
      segmentCount: 0,
      speakerCount: 0,
      coveredSeconds: 0,
      coverageRatio: durationSeconds && durationSeconds > 0 ? 0 : null,
      unattributedSeconds: durationSeconds && durationSeconds > 0 ? durationSeconds : null,
      malformedSegments: 0,
      groundedSegments: 0,
      groundingRatio: activityIntervals ? 0 : null,
      mixedLabelSchemes: false,
      unresolvedSpeakerSegments: 0,
      lowConfidenceSpeakerSegments: 0,
      untranscribedSpeechSeconds: 0,
      reasons: ['Diarization output is not valid JSON']
    }
  }
}
