export interface DiarizationSegment {
  speaker?: string
  start?: number
  end?: number
  text?: string
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
  reasons: string[]
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
      reasons: ['No timestamped speaker segments were returned']
    }
  }

  const valid: Array<{ start: number; end: number; speaker: string }> = []
  let malformedSegments = 0
  for (const segment of segments) {
    const start = segment.start
    const end = segment.end
    const speaker = segment.speaker?.trim() || ''
    if (!Number.isFinite(start) || !Number.isFinite(end) || (start as number) < 0 || (end as number) <= (start as number)) {
      malformedSegments++
      continue
    }
    valid.push({ start: start as number, end: end as number, speaker })
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

  const speakers = new Set(valid.map((segment) => segment.speaker).filter(Boolean))
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
    speakerCount: speakers.size,
    coveredSeconds: round(coveredSeconds),
    coverageRatio: coverageRatio === null ? null : round(coverageRatio),
    unattributedSeconds: unattributedSeconds === null ? null : round(unattributedSeconds),
    malformedSegments,
    groundedSegments,
    groundingRatio: groundingRatio === null ? null : round(groundingRatio),
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
      reasons: ['Diarization output is not valid JSON']
    }
  }
}
