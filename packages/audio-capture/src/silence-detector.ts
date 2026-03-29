export interface SilenceDetectorOptions {
  peakThresholdDb?: number  // default -45
  meanThresholdDb?: number  // default -40
}

export interface SilenceDetectionResult {
  isSilent: boolean
  peakDb: number
  meanDb: number
}

export class SilenceDetector {
  static readonly DEFAULT_PEAK_THRESHOLD_DB = -45
  static readonly DEFAULT_MEAN_THRESHOLD_DB = -40

  constructor(private readonly options: SilenceDetectorOptions = {}) {}

  analyze(_chunk: unknown): SilenceDetectionResult {
    throw new Error('not implemented')
  }

  reset(): void {
    throw new Error('not implemented')
  }
}
