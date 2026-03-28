import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { LocalScanner } from '../../src/cache/local-scanner.js'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

let scanDir: string

beforeEach(() => {
  scanDir = mkdtempSync(join(tmpdir(), 'hidock-scan-'))
})

afterEach(() => {
  rmSync(scanDir, { recursive: true, force: true })
})

describe('LocalScanner', () => {
  it('finds .wav files in directory', () => {
    writeFileSync(join(scanDir, '2025May13-160405-Rec59.wav'), Buffer.alloc(8000))
    const scanner = new LocalScanner(scanDir)
    const files = scanner.scan()
    expect(files).toHaveLength(1)
    expect(files[0].filename).toBe('2025May13-160405-Rec59.wav')
    expect(files[0].localPath).toBe(join(scanDir, '2025May13-160405-Rec59.wav'))
    expect(files[0].source).toBe('local')
    expect(files[0].size).toBe(8000)
  })

  it('also finds .hda files', () => {
    writeFileSync(join(scanDir, 'test.hda'), Buffer.alloc(1000))
    const scanner = new LocalScanner(scanDir)
    const files = scanner.scan()
    expect(files).toHaveLength(1)
  })

  it('ignores non-audio files', () => {
    writeFileSync(join(scanDir, 'notes.txt'), 'hello')
    writeFileSync(join(scanDir, 'test.wav'), Buffer.alloc(100))
    const scanner = new LocalScanner(scanDir)
    const files = scanner.scan()
    expect(files).toHaveLength(1)
  })

  it('returns empty array for nonexistent directory', () => {
    const scanner = new LocalScanner('/nonexistent/path')
    expect(scanner.scan()).toEqual([])
  })

  it('parses date from filename', () => {
    writeFileSync(join(scanDir, '2025May13-160405-Rec59.wav'), Buffer.alloc(3000))
    const scanner = new LocalScanner(scanDir)
    const files = scanner.scan()
    expect(files[0].date).not.toBeNull()
    expect(files[0].date!.getFullYear()).toBe(2025)
  })
})
