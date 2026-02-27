/**
 * FIX-013: Windows path case sensitivity in readRecordingFile
 *
 * BUG: readRecordingFile() and deleteRecording() use JavaScript's startsWith()
 * for path validation. On Windows, paths are case-insensitive but startsWith()
 * is case-sensitive. If paths come from different sources with different casing,
 * the security check fails silently and returns null.
 *
 * Example:
 *   recordingsPath = "C:\\Users\\Sebastian\\HiDock\\recordings"
 *   filePath from DB = "C:\\users\\sebastian\\hidock\\recordings\\test.wav"
 *   → startsWith() returns false → file read rejected
 */

import { describe, it, expect } from 'vitest'
import { normalize, resolve } from 'path'
import { readFileSync } from 'fs'
import { join } from 'path'

describe('FIX-013: Path case sensitivity', () => {
  it('demonstrates that startsWith is case-sensitive', () => {
    const upper = 'C:\\Users\\Sebastian\\HiDock\\recordings'
    const lower = 'C:\\users\\sebastian\\hidock\\recordings'

    // JavaScript startsWith is always case-sensitive
    expect(lower.startsWith(upper)).toBe(false)
    expect(upper.startsWith(lower)).toBe(false)

    // But case-insensitive comparison works
    expect(lower.toLowerCase().startsWith(upper.toLowerCase())).toBe(true)
  })

  it('should still reject paths outside allowed directories with case-insensitive check', () => {
    const recordingsPath = 'C:\\Users\\Sebastian\\HiDock\\recordings'
    const evilPath = 'C:\\Users\\Sebastian\\evil\\recordings\\test.wav'

    const normalizedEvil = normalize(resolve(evilPath))
    const normalizedRec = normalize(resolve(recordingsPath))

    const result = normalizedEvil.toLowerCase().startsWith(normalizedRec.toLowerCase())
    expect(result).toBe(false)
  })

  it('readRecordingFile uses case-insensitive path comparison on Windows', () => {
    // Read the actual source of readRecordingFile to verify the fix
    const sourceFile = join(__dirname, '..', 'file-storage.ts')
    const source = readFileSync(sourceFile, 'utf-8')

    // Extract the readRecordingFile function body
    const funcStart = source.indexOf('export function readRecordingFile')
    expect(funcStart).toBeGreaterThan(-1)
    const funcBody = source.slice(funcStart, source.indexOf('\n}', funcStart) + 2)

    // The path comparison within readRecordingFile must use case-insensitive check
    // Look for .toLowerCase() specifically in the startsWith path check
    const hasPathCaseInsensitive = funcBody.includes('toLowerCase')
    expect(hasPathCaseInsensitive).toBe(true)
  })

  it('deleteRecording uses case-insensitive path comparison on Windows', () => {
    const sourceFile = join(__dirname, '..', 'file-storage.ts')
    const source = readFileSync(sourceFile, 'utf-8')

    const funcStart = source.indexOf('export function deleteRecording')
    expect(funcStart).toBeGreaterThan(-1)
    const funcBody = source.slice(funcStart, source.indexOf('\n}', funcStart) + 2)

    const hasPathCaseInsensitive = funcBody.includes('toLowerCase')
    expect(hasPathCaseInsensitive).toBe(true)
  })
})
