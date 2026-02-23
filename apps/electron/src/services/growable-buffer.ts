/**
 * GrowableBuffer - Efficient buffer for accumulating USB data with O(1) amortized appends.
 *
 * Replaces the O(n^2) copy-concat pattern where every USB read created a new Uint8Array
 * and copied the entire existing buffer. Uses geometric growth (doubling) with an offset-based
 * consumption model, so parsing can advance through data without copying.
 *
 * Thread safety: JavaScript is single-threaded. All async operations in JensenDevice are
 * serialized by the withLock() mutex. No concurrent access concerns.
 */
export class GrowableBuffer {
  private static readonly MIN_CAPACITY = 65536 // 64KB - matches USB read size

  private buffer: Uint8Array
  private offset = 0 // Read cursor: bytes before this have been consumed
  private used = 0   // Write cursor: bytes after this are uninitialized

  /**
   * Create a new GrowableBuffer with the given initial capacity.
   * Capacity is clamped to a minimum of 64KB to match USB read size.
   *
   * @param initialCapacity - Initial buffer size in bytes (minimum 64KB)
   */
  constructor(initialCapacity?: number) {
    const requested = initialCapacity ?? GrowableBuffer.MIN_CAPACITY
    const capacity = Math.max(requested, GrowableBuffer.MIN_CAPACITY)
    this.buffer = new Uint8Array(capacity)
  }

  /** Number of unconsumed bytes available for reading. */
  get length(): number {
    return this.used - this.offset
  }

  /** Total allocated buffer size (includes consumed and unused space). */
  get capacity(): number {
    return this.buffer.length
  }

  /**
   * Append data to the end of the buffer, growing if necessary.
   * Zero-length appends are no-ops.
   *
   * @param data - Bytes to append
   */
  append(data: Uint8Array): void {
    if (data.length === 0) return

    const required = this.used + data.length
    if (required > this.buffer.length) {
      this.grow(required)
    }

    this.buffer.set(data, this.used)
    this.used += data.length
  }

  /**
   * Advance the read cursor by `count` bytes, effectively discarding them.
   * Compacts the buffer when wasted space exceeds 50% of capacity.
   *
   * @param count - Number of bytes to consume
   * @throws RangeError if count exceeds available data length
   */
  consume(count: number): void {
    if (count > this.length) {
      throw new RangeError(
        `Cannot consume ${count} bytes: only ${this.length} bytes available`
      )
    }

    this.offset += count

    // Compact when wasted space exceeds 50% of capacity
    if (this.offset > this.buffer.length / 2) {
      this.compact()
    }
  }

  /**
   * Read a single byte at the given index, relative to the current offset.
   * Index 0 is the first unconsumed byte.
   *
   * @param index - Zero-based index relative to current offset
   * @throws RangeError if index is out of bounds
   */
  byteAt(index: number): number {
    if (index < 0 || index >= this.length) {
      throw new RangeError(
        `Index ${index} out of bounds for buffer of length ${this.length}`
      )
    }
    return this.buffer[this.offset + index]
  }

  /**
   * Extract an independent copy of bytes from the buffer.
   * Indices are RELATIVE TO CURRENT OFFSET (consistent with byteAt).
   *
   * @param start - Start index (inclusive), relative to offset
   * @param end - End index (exclusive), relative to offset
   * @returns A new Uint8Array containing the requested bytes
   */
  sliceCopy(start: number, end: number): Uint8Array {
    const absStart = this.offset + start
    const absEnd = this.offset + end
    return this.buffer.slice(absStart, absEnd)
  }

  /**
   * COMPOUND METHOD: Atomically extract a copy of data and advance the cursor.
   * This eliminates the dangerous ordering dependency between sliceCopy and consume.
   *
   * Equivalent to:
   *   const copy = this.sliceCopy(start, end)
   *   this.consume(consumeCount)
   *   return copy
   *
   * But as a single atomic operation, it's impossible to accidentally reverse the order.
   *
   * @param start - Start index for extraction (inclusive), relative to offset
   * @param end - End index for extraction (exclusive), relative to offset
   * @param consumeCount - Number of bytes to consume after extraction
   * @returns A new Uint8Array containing the extracted bytes
   * @throws RangeError if consumeCount exceeds available data length
   */
  extractAndConsume(start: number, end: number, consumeCount: number): Uint8Array {
    const copy = this.sliceCopy(start, end)
    this.consume(consumeCount)
    return copy
  }

  /**
   * Reset the buffer to empty state, retaining allocated capacity.
   * Use this between operations to avoid reallocation.
   */
  clear(): void {
    this.offset = 0
    this.used = 0
  }

  /**
   * Reallocate buffer to exactly the current data length.
   * Use on disconnect to release unused memory.
   */
  shrinkToFit(): void {
    const len = this.length
    if (len === 0) {
      this.buffer = new Uint8Array(GrowableBuffer.MIN_CAPACITY)
      this.offset = 0
      this.used = 0
      return
    }
    const shrunk = new Uint8Array(len)
    shrunk.set(this.buffer.subarray(this.offset, this.used))
    this.buffer = shrunk
    this.offset = 0
    this.used = len
  }

  /**
   * Grow the internal buffer to accommodate at least `minCapacity` bytes.
   * Uses geometric doubling to achieve amortized O(1) appends.
   */
  private grow(minCapacity: number): void {
    let newCapacity = this.buffer.length
    while (newCapacity < minCapacity) {
      newCapacity *= 2
    }
    const newBuffer = new Uint8Array(newCapacity)
    // Copy only the unconsumed data
    newBuffer.set(this.buffer.subarray(this.offset, this.used))
    this.buffer = newBuffer
    this.used = this.used - this.offset
    this.offset = 0
  }

  /**
   * Move unconsumed data to the front of the buffer, resetting offset to 0.
   * Called automatically when wasted space exceeds 50% of capacity.
   */
  private compact(): void {
    const len = this.length
    if (len > 0) {
      // Use copyWithin for in-place compaction (avoids allocation)
      this.buffer.copyWithin(0, this.offset, this.used)
    }
    this.offset = 0
    this.used = len
  }
}
