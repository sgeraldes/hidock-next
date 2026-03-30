const MONTH_NAMES: Record<string, number> = {
  Jan: 0, Feb: 1, Mar: 2, Apr: 3, May: 4, Jun: 5,
  Jul: 6, Aug: 7, Sep: 8, Oct: 9, Nov: 10, Dec: 11
}

const WAV_HEADER_SIZE = 44
const CHANNELS = 2
const BYTES_PER_SAMPLE = 1
const CORRECTION_FACTOR = 4

export interface ParsedFilename {
  date: Date | null
  createDate: string
  createTime: string
}

export function parseFilenameDateTime(filename: string): ParsedFilename {
  // Format 1: 2025May13-160405-Rec59.hda
  const monthNameMatch = filename.match(
    /(\d{4})(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)(\d{1,2})-(\d{2})(\d{2})(\d{2})/
  )
  if (monthNameMatch) {
    const [, year, monthName, day, hour, minute, second] = monthNameMatch
    const month = MONTH_NAMES[monthName]
    const createDate = `${year}-${String(month + 1).padStart(2, '0')}-${day.padStart(2, '0')}`
    const createTime = `${hour}:${minute}:${second}`
    const date = new Date(parseInt(year), month, parseInt(day), parseInt(hour), parseInt(minute), parseInt(second))
    return { date, createDate, createTime }
  }

  // Format 2: 20250513160405REC001.wav
  const oldWavMatch = filename.match(/^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})REC/)
  if (oldWavMatch) {
    const [, year, month, day, hour, minute, second] = oldWavMatch
    const createDate = `${year}-${month}-${day}`
    const createTime = `${hour}:${minute}:${second}`
    const date = new Date(parseInt(year), parseInt(month) - 1, parseInt(day), parseInt(hour), parseInt(minute), parseInt(second))
    return { date, createDate, createTime }
  }

  // Format 3: HDA_YYYYMMDD_HHMMSS
  const numericMatch = filename.match(/(\d{4})[-_]?(\d{2})[-_]?(\d{2})[-_](\d{2})(\d{2})(\d{2})?/)
  if (numericMatch) {
    const [, year, month, day, hour, minute, second = '00'] = numericMatch
    const createDate = `${year}-${month}-${day}`
    const createTime = `${hour}:${minute}:${second}`
    const date = new Date(parseInt(year), parseInt(month) - 1, parseInt(day), parseInt(hour), parseInt(minute), parseInt(second))
    return { date, createDate, createTime }
  }

  return { date: null, createDate: '', createTime: '' }
}

export function calculateDurationSeconds(fileLength: number, fileVersion: number): number {
  if (fileVersion === 1) {
    return Math.round(fileLength / 8000)
  } else if (fileVersion === 2) {
    const effectiveBps = (48000 * CHANNELS * BYTES_PER_SAMPLE) / CORRECTION_FACTOR
    return fileLength > WAV_HEADER_SIZE ? Math.round((fileLength - WAV_HEADER_SIZE) / effectiveBps) : 0
  } else if (fileVersion === 3) {
    const effectiveBps = (24000 * CHANNELS * BYTES_PER_SAMPLE) / CORRECTION_FACTOR
    return fileLength > WAV_HEADER_SIZE ? Math.round((fileLength - WAV_HEADER_SIZE) / effectiveBps) : 0
  } else if (fileVersion === 5) {
    return Math.round(fileLength / (12000 / CORRECTION_FACTOR))
  } else {
    return Math.round(fileLength / ((16000 * CHANNELS * BYTES_PER_SAMPLE) / CORRECTION_FACTOR))
  }
}
