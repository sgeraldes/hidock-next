import { execFile } from 'node:child_process'
import { writeFile, unlink, mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

export interface SilenceDetectorOptions {
  peakThresholdDb?: number  // default -45
  meanThresholdDb?: number  // default -40
  ffmpegPath?: string
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

  async analyze(chunk: Buffer, tempDir?: string): Promise<SilenceDetectionResult> {
    const peakThreshold = this.options.peakThresholdDb ?? SilenceDetector.DEFAULT_PEAK_THRESHOLD_DB
    const meanThreshold = this.options.meanThresholdDb ?? SilenceDetector.DEFAULT_MEAN_THRESHOLD_DB

    let dir: string
    let createdDir = false

    if (tempDir) {
      dir = tempDir
    } else {
      dir = await mkdtemp(join(tmpdir(), 'silence-detect-'))
      createdDir = true
    }

    const tempFile = join(dir, `chunk-${Date.now()}.raw`)

    try {
      await writeFile(tempFile, chunk)

      const ffmpegBin = this.resolveFfmpegPath()
      const stderr = await this.runFfmpeg(ffmpegBin, tempFile)

      const peakMatch = stderr.match(/max_volume:\s*(-?\d+\.?\d*)\s*dB/)
      const meanMatch = stderr.match(/mean_volume:\s*(-?\d+\.?\d*|-inf)\s*dB/)

      const peakDb = peakMatch ? parseFloat(peakMatch[1]) : 0
      const meanDb = meanMatch
        ? (meanMatch[1] === '-inf' ? -Infinity : parseFloat(meanMatch[1]))
        : 0

      const isSilent = peakDb <= peakThreshold && (meanDb === -Infinity || meanDb <= meanThreshold)

      return { isSilent, peakDb, meanDb }
    } catch {
      // Fail open: if ffmpeg fails, assume not silent
      return { isSilent: false, peakDb: 0, meanDb: 0 }
    } finally {
      try {
        await unlink(tempFile)
      } catch {
        // Ignore cleanup errors
      }
      if (createdDir) {
        try {
          const { rmdir } = await import('node:fs/promises')
          await rmdir(dir)
        } catch {
          // Ignore cleanup errors
        }
      }
    }
  }

  reset(): void {
    // No stateful data to reset in current implementation
  }

  private resolveFfmpegPath(): string {
    if (this.options.ffmpegPath) {
      return this.options.ffmpegPath
    }

    try {
      // Try to use ffmpeg-static if available
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const ffmpegStatic = require('ffmpeg-static') as string
      return ffmpegStatic
    } catch {
      // Fall back to system ffmpeg
      return 'ffmpeg'
    }
  }

  private runFfmpeg(ffmpegBin: string, inputFile: string): Promise<string> {
    return new Promise((resolve, reject) => {
      execFile(
        ffmpegBin,
        [
          '-i', inputFile,
          '-af', 'volumedetect',
          '-f', 'null',
          '-',
        ],
        { timeout: 10_000 },
        (error, _stdout, stderr) => {
          // ffmpeg writes volumedetect output to stderr even on success
          // It also returns non-zero exit code when output is /dev/null
          if (stderr && (stderr.includes('max_volume') || stderr.includes('mean_volume'))) {
            resolve(stderr)
          } else if (error) {
            reject(error)
          } else {
            resolve(stderr)
          }
        },
      )
    })
  }
}
