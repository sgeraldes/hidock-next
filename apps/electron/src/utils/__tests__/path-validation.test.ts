/**
 * Path Validation Tests
 * SECURITY: Tests for directory traversal prevention
 */

import { describe, it, expect } from 'vitest'
import { validateDevicePath, sanitizeDevicePath, validateDevicePaths } from '../path-validation'

describe('validateDevicePath', () => {
  describe('Valid paths', () => {
    it('should accept simple recording filenames', () => {
      expect(validateDevicePath('REC001.wav')).toBe(true)
      expect(validateDevicePath('recording_2024.mp3')).toBe(true)
      expect(validateDevicePath('file-123.m4a')).toBe(true)
    })

    it('should accept filenames with underscores and hyphens', () => {
      expect(validateDevicePath('test_file-123.wav')).toBe(true)
      expect(validateDevicePath('MY_RECORDING.WAV')).toBe(true)
    })

    it('should accept mixed case filenames', () => {
      expect(validateDevicePath('MyFile.Wav')).toBe(true)
      expect(validateDevicePath('UPPERCASE.MP3')).toBe(true)
      expect(validateDevicePath('lowercase.wav')).toBe(true)
    })
  })

  describe('Directory traversal attacks', () => {
    it('should reject paths with ..', () => {
      expect(validateDevicePath('../../../etc/passwd')).toBe(false)
      expect(validateDevicePath('..\\..\\..\\windows\\system32')).toBe(false)
      expect(validateDevicePath('file..txt')).toBe(false)
    })

    it('should reject paths with forward slashes', () => {
      expect(validateDevicePath('folder/file.wav')).toBe(false)
      expect(validateDevicePath('/etc/passwd')).toBe(false)
      expect(validateDevicePath('sub/directory/file.wav')).toBe(false)
    })

    it('should reject paths with backslashes', () => {
      expect(validateDevicePath('folder\\file.wav')).toBe(false)
      expect(validateDevicePath('C:\\Windows\\system32')).toBe(false)
    })

    it('should reject paths with null bytes', () => {
      expect(validateDevicePath('file\0.wav')).toBe(false)
      expect(validateDevicePath('test\x00file.mp3')).toBe(false)
    })
  })

  describe('Hidden files and special cases', () => {
    it('should reject hidden files (starting with dot)', () => {
      expect(validateDevicePath('.hidden')).toBe(false)
      expect(validateDevicePath('.ssh')).toBe(false)
    })

    it('should reject just dots', () => {
      expect(validateDevicePath('.')).toBe(false)
      expect(validateDevicePath('..')).toBe(false)
    })
  })

  describe('Invalid characters', () => {
    it('should reject paths with special characters', () => {
      expect(validateDevicePath('file*.wav')).toBe(false)
      expect(validateDevicePath('file?.mp3')).toBe(false)
      expect(validateDevicePath('file<>.wav')).toBe(false)
      expect(validateDevicePath('file|pipe.wav')).toBe(false)
    })

    it('should reject paths with spaces', () => {
      expect(validateDevicePath('my file.wav')).toBe(false)
    })
  })

  describe('Edge cases', () => {
    it('should reject empty or null paths', () => {
      expect(validateDevicePath('')).toBe(false)
      expect(validateDevicePath(null as any)).toBe(false)
      expect(validateDevicePath(undefined as any)).toBe(false)
    })

    it('should reject paths that are too long', () => {
      const longPath = 'a'.repeat(256) + '.wav'
      expect(validateDevicePath(longPath)).toBe(false)
    })

    it('should accept paths at maximum length', () => {
      const maxPath = 'a'.repeat(251) + '.wav' // 255 chars total
      expect(validateDevicePath(maxPath)).toBe(true)
    })

    it('should reject non-string inputs', () => {
      expect(validateDevicePath(123 as any)).toBe(false)
      expect(validateDevicePath({} as any)).toBe(false)
      expect(validateDevicePath([] as any)).toBe(false)
    })
  })
})

describe('sanitizeDevicePath', () => {
  it('should return valid paths unchanged', () => {
    expect(sanitizeDevicePath('REC001.wav')).toBe('REC001.wav')
    expect(sanitizeDevicePath('file-123.mp3')).toBe('file-123.mp3')
  })

  it('should remove directory components', () => {
    expect(sanitizeDevicePath('folder/file.wav')).toBe('file.wav')
    expect(sanitizeDevicePath('C:\\Windows\\file.wav')).toBe('file.wav')
    expect(sanitizeDevicePath('../../../file.wav')).toBe('file.wav')
  })

  it('should replace invalid characters with underscore', () => {
    expect(sanitizeDevicePath('my file.wav')).toBe('my_file.wav')
    expect(sanitizeDevicePath('file*?.wav')).toBe('file__.wav')
  })

  it('should return null for invalid inputs', () => {
    expect(sanitizeDevicePath('')).toBe(null)
    expect(sanitizeDevicePath(null as any)).toBe(null)
    expect(sanitizeDevicePath(undefined as any)).toBe(null)
  })

  it('should return null if sanitized result is invalid', () => {
    expect(sanitizeDevicePath('....')).toBe(null)
    expect(sanitizeDevicePath('.hidden')).toBe(null)
  })
})

describe('validateDevicePaths', () => {
  it('should separate valid and rejected paths', () => {
    const paths = [
      'REC001.wav',
      '../../../etc/passwd',
      'valid-file.mp3',
      'folder/file.wav',
      'good_recording.m4a'
    ]

    const result = validateDevicePaths(paths)

    expect(result.valid).toEqual([
      'REC001.wav',
      'valid-file.mp3',
      'good_recording.m4a'
    ])

    expect(result.rejected).toHaveLength(2)
    expect(result.rejected[0].path).toBe('../../../etc/passwd')
    expect(result.rejected[0].reason).toBe('Directory traversal attempt detected')
    expect(result.rejected[1].path).toBe('folder/file.wav')
    expect(result.rejected[1].reason).toBe('Subdirectories not allowed')
  })

  it('should handle all valid paths', () => {
    const paths = ['file1.wav', 'file2.mp3', 'file3.m4a']
    const result = validateDevicePaths(paths)

    expect(result.valid).toEqual(paths)
    expect(result.rejected).toHaveLength(0)
  })

  it('should handle all invalid paths', () => {
    const paths = ['../', 'folder/file', '.hidden']
    const result = validateDevicePaths(paths)

    expect(result.valid).toHaveLength(0)
    expect(result.rejected).toHaveLength(3)
  })

  it('should provide appropriate rejection reasons', () => {
    const result = validateDevicePaths(['a'.repeat(300)])

    expect(result.rejected[0].reason).toBe('Path too long')
  })
})
