/**
 * Binary vector cache — format round-trip and validation.
 *
 * @vitest-environment node
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { existsSync, mkdirSync, rmSync, writeFileSync, readFileSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import {
  cacheFingerprint,
  readVectorCache,
  writeVectorCache,
  VECTOR_CACHE_FILENAME,
} from '../vector-cache'

const DIR = join(tmpdir(), 'vector-cache-test')

beforeEach(() => {
  rmSync(DIR, { recursive: true, force: true })
  mkdirSync(DIR, { recursive: true })
})

afterEach(() => {
  rmSync(DIR, { recursive: true, force: true })
})

function doc(id: string, provider: string, dims: number, fill: number) {
  return { id, provider, dims, embedding: new Array(dims).fill(fill) }
}

describe('vector-cache round-trip', () => {
  it('writes and reads back all rows with exact vectors', () => {
    const path = join(DIR, VECTOR_CACHE_FILENAME)
    const docs = [
      doc('b-2', 'gemini-api', 3, 0.5),
      doc('a-1', 'gemini-api', 3, 1),
      doc('n-1', 'local-onnx-embed', 2, -0.25),
    ]
    const { totalCount } = writeVectorCache(path, docs)
    expect(totalCount).toBe(3)

    const cache = readVectorCache(path)!
    expect(cache).not.toBeNull()
    expect(cache.rows.length).toBe(3)
    // groups sorted by provider; ids sorted within a group
    expect(cache.rows.map((r) => r.id)).toEqual(['a-1', 'b-2', 'n-1'])
    expect(cache.rows[0].provider).toBe('gemini-api')
    expect(cache.rows[2].provider).toBe('local-onnx-embed')
    expect(cache.rows[2].dims).toBe(2)

    const v = cache.rows[0].vector
    expect(v).toBeInstanceOf(Float32Array)
    expect([...v]).toEqual([1, 1, 1])
    expect([...cache.rows[2].vector]).toEqual([-0.25, -0.25])
  })

  it('accepts Float32Array embeddings as well as number[]', () => {
    const path = join(DIR, VECTOR_CACHE_FILENAME)
    writeVectorCache(path, [
      { id: 'f-1', provider: 'gemini-api', dims: 2, embedding: new Float32Array([3.5, -1.5]) },
    ])
    const cache = readVectorCache(path)!
    expect([...cache.rows[0].vector]).toEqual([3.5, -1.5])
  })

  it('fingerprint changes when a row is added or removed (insert/delete invalidation)', () => {
    const base = [{ provider: 'gemini-api', dims: 3, count: 2 }]
    const grown = [{ provider: 'gemini-api', dims: 3, count: 3 }]
    expect(cacheFingerprint(base)).not.toBe(cacheFingerprint(grown))
    // meeting-link style churn (same counts) does NOT change it
    const same = [{ provider: 'gemini-api', dims: 3, count: 2 }]
    expect(cacheFingerprint(base)).toBe(cacheFingerprint(same))
  })

  it('returns null for a missing file', () => {
    expect(readVectorCache(join(DIR, 'nope.bin'))).toBeNull()
  })

  it('returns null for a truncated/corrupt file (never half-serves)', () => {
    const path = join(DIR, VECTOR_CACHE_FILENAME)
    writeVectorCache(path, [doc('a-1', 'gemini-api', 4, 1), doc('a-2', 'gemini-api', 4, 2)])
    const buf = readFileSync(path)
    writeFileSync(path, buf.subarray(0, buf.length - 10)) // tear the tail
    expect(readVectorCache(path)).toBeNull()
  })

  it('returns null for a garbage header', () => {
    const path = join(DIR, VECTOR_CACHE_FILENAME)
    writeFileSync(path, Buffer.from([9, 9, 9, 9, 1, 2, 3]))
    expect(readVectorCache(path)).toBeNull()
  })

  it('temp-write + rename leaves no .tmp residue', () => {
    const path = join(DIR, VECTOR_CACHE_FILENAME)
    writeVectorCache(path, [doc('a-1', 'gemini-api', 2, 1)])
    expect(existsSync(path)).toBe(true)
    expect(existsSync(join(DIR, `.${VECTOR_CACHE_FILENAME}.tmp`))).toBe(false)
  })
})
