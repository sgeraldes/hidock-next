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
import { mkdir, open, rename, rm, type FileHandle } from 'fs/promises'
import { dirname, join } from 'path'

/**
 * Electron's Node caps a single Buffer at 2^31-1 bytes — a >2.1 GB float
 * matrix (225k+ mixed-provider rows) blows past it, so BOTH paths stream in
 * bounded pieces instead of materializing one giant buffer (the
 * "Array buffer allocation failed" crash at 225,914 rows / 2.3 GB).
 */
const WRITE_SLICE_BYTES = 64 * 1024 * 1024 // 64 MB staging buffer per flush
const READ_CHUNK_BYTES = 512 * 1024 * 1024 // 512 MB per matrix chunk buffer
const ASYNC_WRITE_SLICE_BYTES = 8 * 1024 * 1024
const ASYNC_READ_CHUNK_BYTES = 32 * 1024 * 1024
const cacheWriteQueues = new Map<string, Promise<{ totalCount: number; fingerprint: string }>>()
const cacheWriteGenerations = new Map<string, number>()
let asyncWriteSequence = 0

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
  /** Complete group manifest from the cache header, including skipped groups. */
  groups: CacheGroupInfo[]
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
    return { rows, buffers, fingerprint: header.fingerprint, groups: header.groups }
  } catch {
    return null
  } finally {
    closeSync(fd)
  }
}

type CacheDocument = {
  id: string
  embedding: number[] | Float32Array
  provider: string
  dims: number
}

type PreparedGroup = {
  provider: string
  dims: number
  rows: Array<{ id: string; vec: number[] | Float32Array }>
  idsLen: number
  matrixLen: number
}

function prepareGroups(docs: Iterable<CacheDocument>): { groups: PreparedGroup[]; totalCount: number } {
  const byGroup = new Map<
    string,
    { provider: string; dims: number; rows: Array<{ id: string; vec: number[] | Float32Array }> }
  >()
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

  const groups = [...byGroup.values()]
    .sort((a, b) => a.provider.localeCompare(b.provider) || a.dims - b.dims)
    .map((group): PreparedGroup => {
      group.rows.sort((a, b) => a.id.localeCompare(b.id))
      const rawIdsLen = group.rows.reduce((total, row) => total + 4 + Buffer.byteLength(row.id, 'utf-8'), 0)
      const idsLen = rawIdsLen + ((4 - (rawIdsLen % 4)) % 4)
      return {
        ...group,
        idsLen,
        matrixLen: group.rows.length * group.dims * 4,
      }
    })
  return { groups, totalCount }
}

/**
 * Invalidate every queued/in-flight async writer for this path. A hard purge
 * calls this before unlinking the final cache, preventing an older snapshot
 * from being atomically renamed back afterwards.
 */
export function cancelVectorCacheWrites(filePath: string): void {
  cacheWriteGenerations.set(filePath, (cacheWriteGenerations.get(filePath) ?? 0) + 1)
}

/** Wait until the newest queued snapshot for a path has either landed or failed. */
export async function waitForVectorCacheWrites(filePath: string): Promise<void> {
  await cacheWriteQueues.get(filePath)?.catch(() => undefined)
}

async function writeAll(handle: FileHandle, buffer: Buffer): Promise<void> {
  let offset = 0
  while (offset < buffer.length) {
    const { bytesWritten } = await handle.write(buffer, offset, buffer.length - offset)
    if (bytesWritten <= 0) throw new Error('Vector cache write made no progress')
    offset += bytesWritten
  }
}

async function readExactly(handle: FileHandle, buffer: Buffer, position: number): Promise<boolean> {
  let offset = 0
  while (offset < buffer.length) {
    const { bytesRead } = await handle.read(buffer, offset, buffer.length - offset, position + offset)
    if (bytesRead <= 0) return false
    offset += bytesRead
  }
  return true
}

/**
 * Event-loop-friendly cache writer used by the Electron main process. The
 * synchronous codec above remains available for tooling and small unit tests,
 * but a production cache can exceed 2 GB: serializing and writing it on the
 * main thread made the whole application appear frozen for minutes.
 */
export function writeVectorCacheAsync(
  filePath: string,
  docs: Iterable<CacheDocument>
): Promise<{ totalCount: number; fingerprint: string }> {
  // Freeze the requested snapshot now, then serialize replacements per path.
  // Once writes became genuinely asynchronous, overlapping initializations
  // could otherwise race on the same temp file or let an older snapshot win.
  const prepared = prepareGroups(docs)
  const generation = cacheWriteGenerations.get(filePath) ?? 0
  const previous = cacheWriteQueues.get(filePath)
  const current = (previous ? previous.catch(() => undefined) : Promise.resolve()).then(() =>
    writePreparedVectorCache(filePath, prepared, generation)
  )
  cacheWriteQueues.set(filePath, current)
  void current.then(
    () => { if (cacheWriteQueues.get(filePath) === current) cacheWriteQueues.delete(filePath) },
    () => { if (cacheWriteQueues.get(filePath) === current) cacheWriteQueues.delete(filePath) }
  )
  return current
}

async function writePreparedVectorCache(
  filePath: string,
  prepared: ReturnType<typeof prepareGroups>,
  generation: number
): Promise<{ totalCount: number; fingerprint: string }> {
  if ((cacheWriteGenerations.get(filePath) ?? 0) !== generation) {
    throw new Error('Vector cache write cancelled by invalidation')
  }
  const { groups, totalCount } = prepared
  const groupInfos: CacheGroupPayload[] = groups.map((group) => ({
    provider: group.provider,
    dims: group.dims,
    count: group.rows.length,
    idsLen: group.idsLen,
    matrixLen: group.matrixLen,
  }))
  const header: CacheHeader = {
    version: CACHE_VERSION,
    createdAt: new Date().toISOString(),
    totalCount,
    fingerprint: cacheFingerprint(groupInfos),
    groups: groupInfos,
  }
  const headerJson = JSON.stringify(header)
  const headerBuf = Buffer.concat([
    Buffer.from(headerJson, 'utf-8'),
    Buffer.alloc((4 - (Buffer.byteLength(headerJson) % 4)) % 4, 0x20),
  ])

  await mkdir(dirname(filePath), { recursive: true })
  const tmpPath = join(dirname(filePath), `.${VECTOR_CACHE_FILENAME}.tmp-${process.pid}-${++asyncWriteSequence}`)
  const handle = await open(tmpPath, 'w')
  let writeFailure: unknown
  try {
    await writeAll(handle, u32(headerBuf.length))
    await writeAll(handle, headerBuf)
    for (const group of groups) {
      const idsBuf = Buffer.alloc(group.idsLen)
      let idOffset = 0
      for (const row of group.rows) {
        const idBuf = Buffer.from(row.id, 'utf-8')
        idsBuf.writeUInt32LE(idBuf.length, idOffset)
        idOffset += 4
        idBuf.copy(idsBuf, idOffset)
        idOffset += idBuf.length
      }
      await writeAll(handle, idsBuf)

      const rowBytes = group.dims * 4
      const rowsPerSlice = Math.max(1, Math.floor(ASYNC_WRITE_SLICE_BYTES / rowBytes))
      for (let start = 0; start < group.rows.length; start += rowsPerSlice) {
        if ((cacheWriteGenerations.get(filePath) ?? 0) !== generation) {
          throw new Error('Vector cache write cancelled by invalidation')
        }
        const sliceRows = Math.min(rowsPerSlice, group.rows.length - start)
        let slice = Buffer.allocUnsafe(sliceRows * rowBytes)
        if (slice.byteOffset % 4 !== 0) slice = Buffer.from(slice)
        const floats = new Float32Array(slice.buffer, slice.byteOffset, sliceRows * group.dims)
        for (let i = 0; i < sliceRows; i++) {
          floats.set(group.rows[start + i].vec, i * group.dims)
        }
        await writeAll(handle, slice)
        await new Promise<void>((resolve) => setImmediate(resolve))
      }
    }
  } catch (error) {
    writeFailure = error
  } finally {
    await handle.close()
  }
  if (writeFailure) {
    await rm(tmpPath, { force: true })
    throw writeFailure
  }
  if ((cacheWriteGenerations.get(filePath) ?? 0) !== generation) {
    await rm(tmpPath, { force: true })
    throw new Error('Vector cache write cancelled by invalidation')
  }
  try {
    await rename(tmpPath, filePath)
    // Close the check→rename race: invalidation may have landed while the
    // asynchronous rename was pending. In that case remove the just-published
    // stale snapshot; if invalidation lands later, it removes the final itself.
    if ((cacheWriteGenerations.get(filePath) ?? 0) !== generation) {
      await rm(filePath, { force: true })
      throw new Error('Vector cache write cancelled by invalidation')
    }
  } catch (error) {
    await rm(tmpPath, { force: true })
    throw error
  }
  return { totalCount, fingerprint: header.fingerprint }
}

/**
 * Event-loop-friendly reader for the production cache. Disk reads are awaited
 * in bounded chunks and row-view construction yields between chunks, so the
 * main process continues serving renderer IPC while a multi-gigabyte index is
 * restored.
 */
export async function readVectorCacheAsync(
  filePath: string,
  providerFilter?: string
): Promise<VectorCacheData | null> {
  let handle: FileHandle
  try {
    handle = await open(filePath, 'r')
  } catch {
    return null
  }

  try {
    const lenBuf = Buffer.allocUnsafe(4)
    if (!(await readExactly(handle, lenBuf, 0))) return null
    const headerLen = lenBuf.readUInt32LE(0)
    if (headerLen <= 0 || headerLen > 64 * 1024 * 1024) return null
    const headerBuf = Buffer.allocUnsafe(headerLen)
    if (!(await readExactly(handle, headerBuf, 4))) return null
    const header = JSON.parse(headerBuf.toString('utf-8')) as CacheHeader
    if (header.version !== CACHE_VERSION || !Array.isArray(header.groups)) return null

    const rows: VectorCacheRow[] = []
    const buffers: Buffer[] = []
    let offset = 4 + headerLen
    for (const group of header.groups) {
      if (group.count < 0 || group.dims <= 0 || group.count * group.dims * 4 !== group.matrixLen) return null
      if (providerFilter && group.provider !== providerFilter) {
        // The cache may contain several provider partitions. Retrieval can use
        // only the active provider, so skip inactive matrices by file offset —
        // do not read or retain gigabytes of vectors that cannot be searched.
        offset += group.idsLen + group.matrixLen
        continue
      }
      const idsBuf = Buffer.alloc(group.idsLen)
      if (!(await readExactly(handle, idsBuf, offset))) return null
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

      const rowBytes = group.dims * 4
      const rowsPerChunk = Math.max(1, Math.floor(ASYNC_READ_CHUNK_BYTES / rowBytes))
      let rowsDone = 0
      let position = offset + group.idsLen
      while (rowsDone < group.count) {
        const count = Math.min(rowsPerChunk, group.count - rowsDone)
        let chunk = Buffer.allocUnsafe(count * rowBytes)
        if (!(await readExactly(handle, chunk, position))) return null
        if (chunk.byteOffset % 4 !== 0) chunk = Buffer.from(chunk)
        buffers.push(chunk)
        for (let i = 0; i < count; i++) {
          rows.push({
            id: ids[rowsDone + i],
            provider: group.provider,
            dims: group.dims,
            vector: new Float32Array(chunk.buffer, chunk.byteOffset + i * rowBytes, group.dims),
          })
        }
        rowsDone += count
        position += chunk.length
        await new Promise<void>((resolve) => setImmediate(resolve))
      }
      offset = position
    }
    const expectedRows = providerFilter
      ? header.groups.filter((group) => group.provider === providerFilter).reduce((sum, group) => sum + group.count, 0)
      : header.totalCount
    if (rows.length !== expectedRows) return null
    return { rows, buffers, fingerprint: header.fingerprint, groups: header.groups }
  } catch {
    return null
  } finally {
    await handle.close()
  }
}
