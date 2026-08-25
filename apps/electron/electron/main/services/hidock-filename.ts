/**
 * HiDock filename date parsing — the AUTHORITATIVE recording start time.
 *
 * The device encodes the recording start in the filename (`2026Jul23-190839-
 * Rec39d.mp3` = 2026-07-23 19:08:39 local). Any path that creates a recordings
 * row from a file (recording-watcher, external import, integrity repair) MUST
 * prefer this over the file's mtime: a copy/download stamps the ARRIVAL time
 * as mtime, which silently shifts the recording's timeline and breaks meeting
 * correlation (2026-07-23: four manually-arrived mp3s got 23:28 as their date
 * instead of 18:01–19:08, so "Sync interna TSC" never overlapped them).
 *
 * Returns a LOCAL Date (the device clock is local); callers convert with
 * `.toISOString()` for UTC storage.
 */

const MONTH_NAMES: Record<string, number> = {
  'Jan': 0, 'Feb': 1, 'Mar': 2, 'Apr': 3, 'May': 4, 'Jun': 5,
  'Jul': 6, 'Aug': 7, 'Sep': 8, 'Oct': 9, 'Nov': 10, 'Dec': 11
}

/**
 * Parse recording date from HiDock filename formats.
 * Supports:
 * - 2025Jul08-160405-Rec59.hda / .mp3 (YYYYMonDD-HHMMSS — device format)
 * - 2025-07-08_1604.wav (YYYY-MM-DD_HHMM — the app's saved format)
 * - HDA_20250708_160405.hda (HDA_YYYYMMDD_HHMMSS)
 */
export function parseHiDockFilenameDate(filename: string): Date | undefined {
  // Format 1: 2025Jul08-160405-Rec59.hda (YYYYMonDD-HHMMSS) - Device format
  const monthNameMatch = filename.match(/(\d{4})(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)(\d{1,2})-(\d{2})(\d{2})(\d{2})/)
  if (monthNameMatch) {
    const [, year, monthName, day, hour, minute, second] = monthNameMatch
    const month = MONTH_NAMES[monthName]
    if (month !== undefined) {
      return new Date(
        parseInt(year),
        month,
        parseInt(day),
        parseInt(hour),
        parseInt(minute),
        parseInt(second)
      )
    }
  }

  // Format 2: 2025-07-08_1604.wav (YYYY-MM-DD_HHMM) - Our saved format
  const savedMatch = filename.match(/(\d{4})-(\d{2})-(\d{2})_(\d{2})(\d{2})/)
  if (savedMatch) {
    const [, year, month, day, hour, minute] = savedMatch
    return new Date(
      parseInt(year),
      parseInt(month) - 1,
      parseInt(day),
      parseInt(hour),
      parseInt(minute),
      0
    )
  }

  // Format 3: HDA_20250708_160405.hda or YYYYMMDDHHMMSS
  const numericMatch = filename.match(/(\d{4})[-_]?(\d{2})[-_]?(\d{2})[-_]?(\d{2})(\d{2})(\d{2})/)
  if (numericMatch) {
    const [, year, month, day, hour, minute, second] = numericMatch
    return new Date(
      parseInt(year),
      parseInt(month) - 1,
      parseInt(day),
      parseInt(hour),
      parseInt(minute),
      parseInt(second)
    )
  }

  return undefined
}

/** ISO (UTC) recording date for a filename, or undefined when unparseable. */
export function parseHiDockFilenameDateIso(filename: string): string | undefined {
  return parseHiDockFilenameDate(filename)?.toISOString()
}
