/**
 * Binary Vector Cache — sub-second boot load for the embedding matrix.
 *
 * The SQL load path (batched SELECT + blob decode) costs ~2.5 s for 110k+
 * rows even after Float32Array optimization — the 12 KB blobs dominate. This
 * cache stores ONLY the float matrix + row ids in a compact binary file;
 * chunk text/metadata still comes from SQLite (small rows, fast), and each
 * doc's embedding becomes a zero-copy Float32Array VIEW over the cache
 * buffer. Boot load ≈ one file read (~100–300 ms on NVMe).
 *
 * Format v1 (little-endian):
 *   [u32 headerLen][headerLen bytes of UTF-8 JSON header][payload]
 * Header: { version, createdAt, totalCount, groups: [{ provider, dims,
 *           count, idsLen, matrixLen }] }
 * Payload per group (in header order):
 *   ids:    count × [u32 byteLen][UTF-8 bytes]   (row ids, sorted)
 *   pad:    0-3 zero bytes (ids section padded to a 4-byte boundary)
 *   matrix: count × dims × 4 bytes (Float32 rows, same order as ids)
 * Matrix offsets are always 4-byte aligned (Float32Array view requirement).
 *
 * VALIDITY: the cache is a pure boot accelerator — SQLite stays the source of
 * truth. It is VALID only when the (provider, dims, count) per group matches
 * the live table AND every row id matches positionally (the loader checks);
 * any insert/delete invalidates it (count drift) and the store falls back to
 * the SQL load + rewrites the cache. Meeting-link updates do NOT invalidate
 * (metadata always comes from SQL).
 */

import { createHash } from 'crypto'
import { closeSync, existsSync, mkdirSync, openSync, readSync, renameSync, writeSync } from 'fs'
import { dirname, join } from 'path'

/**
 * Electron's Node caps a single Buffer at 2^31-1 bytes — a >2.1 GB float
 * matrix (225k+ mixed-provider rows) blows past it, so BOTH paths stream in
 * bounded pieces instead of materializing one giant buffer (the
 * "Array buffer allocation failed" crash at 225,914 rows / 2.3 GB).
 */
const WRITE_SLICE_BYTES = 64 * 1024 * 1024 // 64 MB staging buffer per flush
const READ_CHUNK_BYTES = 512 * 1024 * 1024 // 512 MB per matrix chunk buffer

export interface CacheGroupInfo {
  provider: string
  dims: number
  count: number
}

interface CacheGroupPayload extends CacheGroupInfo {
  idsLen: number
  matrixLen: number
}

interface CacheHeader {
  version: number
  createdAt: string
  totalCount: number
  fingerprint: string
  groups: CacheGroupPayload[]
}

export interface VectorCacheRow {
  id: string
  provider: string
  dims: number
  /** Zero-copy view over the cache buffer for this row's embedding. */
  vector: Float32Array
}

export interface VectorCacheData {
  rows: VectorCacheRow[]
  /** Chunk buffers retained so the Float32Array views stay valid. */
  buffers: Buffer[]
  fingerprint: string
}

const CACHE_VERSION = 1
export const VECTOR_CACHE_FILENAME = 'vector-cache-v1.bin'

function u32(n: number): Buffer {
  const b = Buffer.allocUnsafe(4)
  b.writeUInt32LE(n, 0)
  return b
}

/**
 * Fingerprint of the live table's group shape: provider+dims+count per group
 * (sorted). Any insert/delete changes it; meeting-link updates do not.
 */
export function cacheFingerprint(groups: CacheGroupInfo[]): string {
  const canonical = groups
    .map((g) => `${g.provider}:${g.dims}:${g.count}`)
    .sort()
    .join('|')
  return createHash('sha1').update(canonical).digest('hex')
}

/** Serialize a doc set (each with a float vector) into the v1 binary format. */
export function writeVectorCache(
  filePath: string,
  docs: Iterable<{ id: string; embedding: number[] | Float32Array; provider: string; dims: number }>
): { totalCount: number; fingerprint: string } {
  // Group + sort deterministically (provider, then id within group).
  const byGroup = new Map<string, { provider: string; dims: number; rows: Array<{ id: string; vec: number[] | Float32Array }> }>()
  let totalCount = 0
  for (const doc of docs) {
    const key = `${doc.provider}:${doc.dims}`
    let group = byGroup.get(key)
    if (!group) {
      group = { provider: doc.provider, dims: doc.dims, rows: [] }
      byGroup.set(key, group)
    }
    group.rows.push({ id: doc.id, vec: doc.embedding })
    totalCount++
  }
  const groups = [...byGroup.values()].sort((a, b) => a.provider.localeCompare(b.provider) || a.dims - b.dims)
  for (const g of groups) g.rows.sort((a, b) => a.id.localeCompare(b.id))

  const groupInfos: CacheGroupPayload[] = []
  const payloads: Buffer[] = []
  for (const g of groups) {
    const idParts: Buffer[] = []
    for (const row of g.rows) {
      const idBuf = Buffer.from(row.id, 'utf-8')
      idParts.push(u32(idBuf.length), idBuf)
    }
    const idsBufRaw = Buffer.concat(idParts)
    // Pad the ids section to a 4-byte boundary so the matrix that follows is
    // Float32Array-view aligned.
    const idsBuf = idsBufRaw.length % 4 === 0 ? idsBufRaw : Buffer.concat([idsBufRaw, Buffer.alloc(4 - (idsBufRaw.length % 4))])
    // Bounded matrix assembly: fill a 64 MB staging buffer and flush slices —
    // a >2.1 GB group matrix can never be allocated in one piece.
    const rowBytes = g.dims * 4
    const rowsPerSlice = Math.max(1, Math.floor(WRITE_SLICE_BYTES / rowBytes))
    const matrixParts: Buffer[] = []
    for (let start = 0; start < g.rows.length; start += rowsPerSlice) {
      const sliceRows = Math.min(rowsPerSlice, g.rows.length - start)
      const slice = Buffer.allocUnsafe(sliceRows * rowBytes)
      for (let i = 0; i < sliceRows; i++) {
        const vec = g.rows[start + i].vec
        for (let d = 0; d < g.dims; d++) slice.writeFloatLE(vec[d] ?? 0, (i * g.dims + d) * 4)
      }
      matrixParts.push(slice)
    }
    const matrixLen = g.rows.length * rowBytes
    groupInfos.push({ provider: g.provider, dims: g.dims, count: g.rows.length, idsLen: idsBuf.length, matrixLen })
    payloads.push(idsBuf, ...matrixParts)
  }

  const header: CacheHeader = {
    version: CACHE_VERSION,
    createdAt: new Date().toISOString(),
    totalCount,
    fingerprint: cacheFingerprint(groupInfos),
    groups: groupInfos,
  }
  // Pad the JSON header with trailing spaces to a 4-byte boundary: the ids
  // section (itself 4-padded) then starts aligned, so every matrix start is
  // Float32Array-view aligned. JSON.parse tolerates trailing whitespace.
  const headerJson = JSON.stringify(header)
  const headerBuf = Buffer.concat([
    Buffer.from(headerJson, 'utf-8'),
    Buffer.alloc((4 - (Buffer.byteLength(headerJson) % 4)) % 4, 0x20),
  ])

  mkdirSync(dirname(filePath), { recursive: true })
  // Crash-safe: temp + rename (a torn cache must never be half-read).
  // STREAMED: sections are written sequentially — no >2.1 GB single buffer.
  const tmpPath = join(dirname(filePath), `.${VECTOR_CACHE_FILENAME}.tmp`)
  const fd = openSync(tmpPath, 'w')
  try {
    writeSync(fd, u32(headerBuf.length))
    writeSync(fd, headerBuf)
    for (const payload of payloads) writeSync(fd, payload)
  } finally {
    closeSync(fd)
  }
  renameSync(tmpPath, filePath)
  return { totalCount, fingerprint: header.fingerprint }
}

/**
 * Parse a v1 cache file. Returns null on ANY structural problem (missing,
 * truncated, bad version) — the caller falls back to the SQL load.
 */
export function readVectorCache(filePath: string): VectorCacheData | null {
  if (!existsSync(filePath)) return null
  let fd: number
  try {
    fd = openSync(filePath, 'r')
  } catch {
    return null
  }
  try {
    // Header (length-prefixed JSON).
    const lenBuf = Buffer.allocUnsafe(4)
    if (readSync(fd, lenBuf, 0, 4, 0) !== 4) return null
    const headerLen = lenBuf.readUInt32LE(0)
    if (headerLen <= 0 || headerLen > 64 * 1024 * 1024) return null
    const headerBuf = Buffer.allocUnsafe(headerLen)
    if (readSync(fd, headerBuf, 0, headerLen, 4) !== headerLen) return null
    const header = JSON.parse(headerBuf.toString('utf-8')) as CacheHeader
    if (header.version !== CACHE_VERSION || !Array.isArray(header.groups)) return null

    const rows: VectorCacheRow[] = []
    const buffers: Buffer[] = []
    let offset = 4 + headerLen
    for (const group of header.groups) {
      if (group.count * group.dims * 4 !== group.matrixLen) return null

      // ids section (small — single read; idsLen includes 0-3 pad bytes).
      const idsBuf = Buffer.alloc(group.idsLen)
      if (readSync(fd, idsBuf, 0, group.idsLen, offset) !== group.idsLen) return null
      const ids: string[] = []
      let p = 0
      for (let i = 0; i < group.count; i++) {
        if (p + 4 > group.idsLen) return null
        const len = idsBuf.readUInt32LE(p)
        p += 4
        if (p + len > group.idsLen) return null
        ids.push(idsBuf.subarray(p, p + len).toString('utf-8'))
        p += len
      }

      // matrix section in ≤512 MB chunk buffers (the >2.1 GB single-buffer cap).
      const rowBytes = group.dims * 4
      const rowsPerChunk = Math.max(1, Math.floor(READ_CHUNK_BYTES / rowBytes))
      let rowsDone = 0
      let pos = offset + group.idsLen
      const groupVectors: Float32Array[] = []
      while (rowsDone < group.count) {
        const n = Math.min(rowsPerChunk, group.count - rowsDone)
        let chunk = Buffer.allocUnsafe(n * rowBytes)
        if (readSync(fd, chunk, 0, chunk.length, pos) !== chunk.length) return null
        // Pool-allocated small chunks can sit at unaligned byteOffsets —
        // Float32Array views need a 4-byte-aligned start.
        if (chunk.byteOffset % 4 !== 0) chunk = Buffer.from(chunk)
        buffers.push(chunk)
        for (let i = 0; i < n; i++) {
          groupVectors.push(new Float32Array(chunk.buffer, chunk.byteOffset + i * rowBytes, group.dims))
        }
        rowsDone += n
        pos += chunk.length
      }
      for (let i = 0; i < group.count; i++) {
        rows.push({ id: ids[i], provider: group.provider, dims: group.dims, vector: groupVectors[i] })
      }
      offset = pos
    }
    if (rows.length !== header.totalCount) return null
    return { rows, buffers, fingerprint: header.fingerprint }
  } catch {
    return null
  } finally {
    closeSync(fd)
  }
}
