import { describe, it, expect } from 'vitest'
import { GrowableBuffer } from '../growable-buffer'

describe('GrowableBuffer', () => {
  // ============================================================
  // Constructor
  // ============================================================
  describe('constructor', () => {
    it('creates with default capacity of 64KB', () => {
      const buf = new GrowableBuffer()
      expect(buf.capacity).toBe(65536)
      expect(buf.length).toBe(0)
    })

    it('enforces minimum capacity of 64KB even when smaller requested', () => {
      const buf = new GrowableBuffer(100)
      expect(buf.capacity).toBe(65536)
      expect(buf.length).toBe(0)
    })

    it('accepts custom capacity larger than minimum', () => {
      const buf = new GrowableBuffer(131072) // 128KB
      expect(buf.capacity).toBe(131072)
      expect(buf.length).toBe(0)
    })

    it('enforces minimum capacity for zero', () => {
      const buf = new GrowableBuffer(0)
      expect(buf.capacity).toBe(65536)
    })

    it('enforces minimum capacity for negative values', () => {
      const buf = new GrowableBuffer(-1)
      expect(buf.capacity).toBe(65536)
    })
  })

  // ============================================================
  // append
  // ============================================================
  describe('append', () => {
    it('appends single chunk', () => {
      const buf = new GrowableBuffer()
      const data = new Uint8Array([1, 2, 3, 4, 5])
      buf.append(data)
      expect(buf.length).toBe(5)
    })

    it('appends multiple chunks', () => {
      const buf = new GrowableBuffer()
      buf.append(new Uint8Array([1, 2, 3]))
      buf.append(new Uint8Array([4, 5, 6]))
      expect(buf.length).toBe(6)
      expect(buf.byteAt(0)).toBe(1)
      expect(buf.byteAt(5)).toBe(6)
    })

    it('geometric growth when capacity exceeded', () => {
      const buf = new GrowableBuffer()
      const initialCapacity = buf.capacity // 64KB

      // Append enough data to exceed initial capacity
      const largeData = new Uint8Array(initialCapacity + 1)
      for (let i = 0; i < largeData.length; i++) {
        largeData[i] = i & 0xff
      }
      buf.append(largeData)

      // Capacity should have doubled
      expect(buf.capacity).toBe(initialCapacity * 2)
      expect(buf.length).toBe(initialCapacity + 1)

      // Verify data integrity
      for (let i = 0; i < largeData.length; i++) {
        expect(buf.byteAt(i)).toBe(i & 0xff)
      }
    })

    it('zero-length append is a no-op', () => {
      const buf = new GrowableBuffer()
      buf.append(new Uint8Array([1, 2, 3]))
      const lenBefore = buf.length
      const capBefore = buf.capacity

      buf.append(new Uint8Array(0))

      expect(buf.length).toBe(lenBefore)
      expect(buf.capacity).toBe(capBefore)
    })

    it('preserves existing data after growth', () => {
      const buf = new GrowableBuffer()

      // Fill to near capacity
      const initial = new Uint8Array(65000)
      for (let i = 0; i < initial.length; i++) initial[i] = i & 0xff
      buf.append(initial)

      // Trigger growth
      const extra = new Uint8Array(1000)
      for (let i = 0; i < extra.length; i++) extra[i] = (i + 100) & 0xff
      buf.append(extra)

      // Verify initial data preserved
      for (let i = 0; i < initial.length; i++) {
        expect(buf.byteAt(i)).toBe(i & 0xff)
      }
      // Verify appended data
      for (let i = 0; i < extra.length; i++) {
        expect(buf.byteAt(initial.length + i)).toBe((i + 100) & 0xff)
      }
    })
  })

  // ============================================================
  // consume
  // ============================================================
  describe('consume', () => {
    it('advances cursor correctly', () => {
      const buf = new GrowableBuffer()
      buf.append(new Uint8Array([10, 20, 30, 40, 50]))
      buf.consume(2)
      expect(buf.length).toBe(3)
      expect(buf.byteAt(0)).toBe(30)
    })

    it('throws RangeError when consuming more than available', () => {
      const buf = new GrowableBuffer()
      buf.append(new Uint8Array([1, 2, 3]))
      expect(() => buf.consume(4)).toThrow(RangeError)
      expect(() => buf.consume(4)).toThrow('Cannot consume 4 bytes: only 3 bytes available')
    })

    it('allows consuming exact length (empty buffer)', () => {
      const buf = new GrowableBuffer()
      buf.append(new Uint8Array([1, 2, 3]))
      buf.consume(3)
      expect(buf.length).toBe(0)
    })

    it('consuming zero bytes is allowed', () => {
      const buf = new GrowableBuffer()
      buf.append(new Uint8Array([1, 2, 3]))
      buf.consume(0)
      expect(buf.length).toBe(3)
    })

    it('triggers compaction when waste exceeds 50%', () => {
      const buf = new GrowableBuffer()
      const capacity = buf.capacity

      // Fill half the buffer + 1 byte
      const fillSize = Math.floor(capacity / 2) + 1
      const data = new Uint8Array(fillSize)
      for (let i = 0; i < fillSize; i++) data[i] = i & 0xff
      buf.append(data)

      // Consume just over half the capacity to trigger compaction
      buf.consume(fillSize)

      // After compaction, offset should be reset to 0 internally
      // Buffer length should be 0 since we consumed everything
      expect(buf.length).toBe(0)
    })

    it('compaction preserves remaining data correctly', () => {
      const buf = new GrowableBuffer()
      const capacity = buf.capacity

      // Fill buffer with sequential bytes
      const fillSize = capacity
      const data = new Uint8Array(fillSize)
      for (let i = 0; i < fillSize; i++) data[i] = i & 0xff
      buf.append(data)

      // Consume just over 50% to trigger compaction
      const consumeCount = Math.floor(capacity / 2) + 1
      buf.consume(consumeCount)

      // Verify remaining data is intact
      const remaining = fillSize - consumeCount
      expect(buf.length).toBe(remaining)
      for (let i = 0; i < remaining; i++) {
        expect(buf.byteAt(i)).toBe((consumeCount + i) & 0xff)
      }
    })
  })

  // ============================================================
  // byteAt
  // ============================================================
  describe('byteAt', () => {
    it('reads bytes relative to offset', () => {
      const buf = new GrowableBuffer()
      buf.append(new Uint8Array([10, 20, 30, 40, 50]))
      buf.consume(2)

      expect(buf.byteAt(0)).toBe(30)
      expect(buf.byteAt(1)).toBe(40)
      expect(buf.byteAt(2)).toBe(50)
    })

    it('throws RangeError on negative index', () => {
      const buf = new GrowableBuffer()
      buf.append(new Uint8Array([1, 2, 3]))
      expect(() => buf.byteAt(-1)).toThrow(RangeError)
    })

    it('throws RangeError on index equal to length', () => {
      const buf = new GrowableBuffer()
      buf.append(new Uint8Array([1, 2, 3]))
      expect(() => buf.byteAt(3)).toThrow(RangeError)
    })

    it('throws RangeError on index exceeding length', () => {
      const buf = new GrowableBuffer()
      buf.append(new Uint8Array([1, 2, 3]))
      expect(() => buf.byteAt(100)).toThrow(RangeError)
    })

    it('throws RangeError on empty buffer', () => {
      const buf = new GrowableBuffer()
      expect(() => buf.byteAt(0)).toThrow(RangeError)
    })
  })

  // ============================================================
  // sliceCopy
  // ============================================================
  describe('sliceCopy', () => {
    it('returns independent copy', () => {
      const buf = new GrowableBuffer()
      buf.append(new Uint8Array([1, 2, 3, 4, 5]))
      const copy = buf.sliceCopy(1, 4)

      expect(copy).toEqual(new Uint8Array([2, 3, 4]))

      // Modify copy - original should be unchanged
      copy[0] = 99
      expect(buf.byteAt(1)).toBe(2)
    })

    it('indices are relative to offset', () => {
      const buf = new GrowableBuffer()
      buf.append(new Uint8Array([10, 20, 30, 40, 50]))
      buf.consume(2) // offset now at 2, logical data = [30, 40, 50]

      const copy = buf.sliceCopy(0, 3)
      expect(copy).toEqual(new Uint8Array([30, 40, 50]))
    })

    it('returns empty array for equal start and end', () => {
      const buf = new GrowableBuffer()
      buf.append(new Uint8Array([1, 2, 3]))
      const copy = buf.sliceCopy(1, 1)
      expect(copy.length).toBe(0)
    })

    it('handles full buffer slice', () => {
      const buf = new GrowableBuffer()
      buf.append(new Uint8Array([1, 2, 3, 4, 5]))
      const copy = buf.sliceCopy(0, 5)
      expect(copy).toEqual(new Uint8Array([1, 2, 3, 4, 5]))
    })
  })

  // ============================================================
  // extractAndConsume
  // ============================================================
  describe('extractAndConsume', () => {
    it('atomically extracts and consumes', () => {
      const buf = new GrowableBuffer()
      buf.append(new Uint8Array([0x12, 0x34, 0, 5, 0, 0, 0, 0, 0, 0, 0, 3, 0xAA, 0xBB, 0xCC]))
      // Extract body bytes [12..15) and consume entire 15-byte message
      const body = buf.extractAndConsume(12, 15, 15)
      expect(body).toEqual(new Uint8Array([0xAA, 0xBB, 0xCC]))
      expect(buf.length).toBe(0)
    })

    it('preserves data integrity with remaining data', () => {
      const buf = new GrowableBuffer()
      // Two messages: [A, B, C] then [D, E, F]
      buf.append(new Uint8Array([65, 66, 67, 68, 69, 70]))

      // Extract first 3 bytes and consume them
      const first = buf.extractAndConsume(0, 3, 3)
      expect(first).toEqual(new Uint8Array([65, 66, 67]))
      expect(buf.length).toBe(3)

      // Remaining data should still be correct
      expect(buf.byteAt(0)).toBe(68)
      expect(buf.byteAt(1)).toBe(69)
      expect(buf.byteAt(2)).toBe(70)
    })

    it('throws RangeError if consumeCount exceeds length', () => {
      const buf = new GrowableBuffer()
      buf.append(new Uint8Array([1, 2, 3]))
      expect(() => buf.extractAndConsume(0, 2, 5)).toThrow(RangeError)
    })

    it('returns independent copy that survives compaction', () => {
      const buf = new GrowableBuffer()
      const capacity = buf.capacity

      // Fill buffer to trigger compaction on consume
      const data = new Uint8Array(capacity)
      for (let i = 0; i < data.length; i++) data[i] = i & 0xff
      buf.append(data)

      // Extract first 10 bytes, consume more than 50% to trigger compaction
      const consumeSize = Math.floor(capacity / 2) + 100
      const extracted = buf.extractAndConsume(0, 10, consumeSize)

      // Extracted data should be a safe independent copy
      for (let i = 0; i < 10; i++) {
        expect(extracted[i]).toBe(i & 0xff)
      }

      // Remaining data should still be correct
      const remaining = capacity - consumeSize
      for (let i = 0; i < Math.min(remaining, 10); i++) {
        expect(buf.byteAt(i)).toBe((consumeSize + i) & 0xff)
      }
    })
  })

  // ============================================================
  // clear
  // ============================================================
  describe('clear', () => {
    it('resets length to zero', () => {
      const buf = new GrowableBuffer()
      buf.append(new Uint8Array([1, 2, 3, 4, 5]))
      buf.clear()
      expect(buf.length).toBe(0)
    })

    it('retains capacity', () => {
      const buf = new GrowableBuffer()
      const initialCapacity = buf.capacity
      buf.append(new Uint8Array([1, 2, 3, 4, 5]))
      buf.clear()
      expect(buf.capacity).toBe(initialCapacity)
    })

    it('retains grown capacity', () => {
      const buf = new GrowableBuffer()
      // Grow the buffer
      const largeData = new Uint8Array(100000)
      buf.append(largeData)
      const grownCapacity = buf.capacity
      expect(grownCapacity).toBeGreaterThan(65536)

      buf.clear()
      expect(buf.length).toBe(0)
      expect(buf.capacity).toBe(grownCapacity) // Retained
    })

    it('allows reuse after clear', () => {
      const buf = new GrowableBuffer()
      buf.append(new Uint8Array([1, 2, 3]))
      buf.clear()
      buf.append(new Uint8Array([4, 5, 6]))
      expect(buf.length).toBe(3)
      expect(buf.byteAt(0)).toBe(4)
      expect(buf.byteAt(2)).toBe(6)
    })
  })

  // ============================================================
  // shrinkToFit
  // ============================================================
  describe('shrinkToFit', () => {
    it('reallocates to current data length', () => {
      const buf = new GrowableBuffer()
      buf.append(new Uint8Array(1000))
      buf.shrinkToFit()
      expect(buf.capacity).toBe(1000)
      expect(buf.length).toBe(1000)
    })

    it('preserves data after shrink', () => {
      const buf = new GrowableBuffer()
      buf.append(new Uint8Array([10, 20, 30, 40, 50]))
      buf.consume(2)
      buf.shrinkToFit()

      expect(buf.length).toBe(3)
      expect(buf.capacity).toBe(3)
      expect(buf.byteAt(0)).toBe(30)
      expect(buf.byteAt(1)).toBe(40)
      expect(buf.byteAt(2)).toBe(50)
    })

    it('resets to minimum capacity when empty', () => {
      const buf = new GrowableBuffer()
      buf.append(new Uint8Array(100000))
      buf.clear()
      buf.shrinkToFit()
      expect(buf.capacity).toBe(65536)
      expect(buf.length).toBe(0)
    })
  })

  // ============================================================
  // Compaction verification
  // ============================================================
  describe('compaction', () => {
    it('compacts correctly after consuming past 50%', () => {
      const buf = new GrowableBuffer()

      // Write known pattern
      const data = new Uint8Array(60000)
      for (let i = 0; i < data.length; i++) data[i] = (i * 7) & 0xff
      buf.append(data)

      // Consume 40000 bytes (over 50% of 64KB)
      buf.consume(40000)

      // After compaction, verify remaining 20000 bytes
      expect(buf.length).toBe(20000)
      for (let i = 0; i < 20000; i++) {
        expect(buf.byteAt(i)).toBe(((40000 + i) * 7) & 0xff)
      }
    })

    it('multiple consume/append cycles with compaction', () => {
      const buf = new GrowableBuffer()

      // Simulate USB read/parse cycle
      for (let cycle = 0; cycle < 50; cycle++) {
        // Append 4KB chunk (simulating USB read)
        const chunk = new Uint8Array(4096)
        for (let i = 0; i < chunk.length; i++) {
          chunk[i] = (cycle * 4096 + i) & 0xff
        }
        buf.append(chunk)

        // Consume 3KB (simulating message parse)
        if (buf.length >= 3072) {
          // Verify first byte before consuming
          const expectedFirstByte = buf.byteAt(0)
          const copy = buf.sliceCopy(0, 3072)
          expect(copy[0]).toBe(expectedFirstByte)
          buf.consume(3072)
        }
      }

      // Buffer should have accumulated the leftover bytes
      expect(buf.length).toBeGreaterThan(0)
    })
  })

  // ============================================================
  // Large buffer stress test
  // ============================================================
  describe('stress test', () => {
    it('handles many MB of data with message parsing', () => {
      const buf = new GrowableBuffer()
      const HEADER = new Uint8Array([0x12, 0x34])
      let totalAppended = 0
      let messagesExtracted = 0

      // Simulate 2MB of USB data arriving in 64KB chunks
      for (let chunk = 0; chunk < 32; chunk++) {
        const data = new Uint8Array(65536)
        for (let i = 0; i < data.length; i++) {
          data[i] = (chunk * 65536 + i) & 0xff
        }
        buf.append(data)
        totalAppended += data.length

        // Parse as many "messages" as possible (fixed 100-byte messages)
        while (buf.length >= 100) {
          buf.consume(100)
          messagesExtracted++
        }
      }

      expect(totalAppended).toBe(2 * 1024 * 1024)
      expect(messagesExtracted).toBe(Math.floor(totalAppended / 100) - (buf.length > 0 ? 0 : 0))
      // All data should be accounted for
      expect(messagesExtracted * 100 + buf.length).toBe(totalAppended)
    })
  })

  // ============================================================
  // Jensen protocol simulation
  // ============================================================
  describe('Jensen protocol simulation', () => {
    /**
     * Build a Jensen protocol message:
     * [0x12, 0x34] sync + [cmd_hi, cmd_lo] + [seq 4 bytes] + [bodylen 4 bytes] + body
     */
    function buildJensenMessage(cmdId: number, seqId: number, body: Uint8Array): Uint8Array {
      const msg = new Uint8Array(12 + body.length)
      msg[0] = 0x12
      msg[1] = 0x34
      msg[2] = (cmdId >> 8) & 0xff
      msg[3] = cmdId & 0xff
      msg[4] = (seqId >> 24) & 0xff
      msg[5] = (seqId >> 16) & 0xff
      msg[6] = (seqId >> 8) & 0xff
      msg[7] = seqId & 0xff
      msg[8] = (body.length >> 24) & 0xff
      msg[9] = (body.length >> 16) & 0xff
      msg[10] = (body.length >> 8) & 0xff
      msg[11] = body.length & 0xff
      msg.set(body, 12)
      return msg
    }

    /**
     * Simulate tryParseMessage() using GrowableBuffer APIs.
     * Returns parsed message or null if incomplete.
     */
    function tryParseMessage(buf: GrowableBuffer): { id: number; sequence: number; body: Uint8Array } | null {
      if (buf.length < 12) return null

      // Find sync marker
      let syncPos = -1
      for (let i = 0; i <= buf.length - 2; i++) {
        if (buf.byteAt(i) === 0x12 && buf.byteAt(i + 1) === 0x34) {
          syncPos = i
          break
        }
      }

      if (syncPos === -1) {
        buf.clear()
        return null
      }

      // Discard junk before sync marker
      if (syncPos > 0) {
        buf.consume(syncPos)
      }

      if (buf.length < 12) return null

      // Parse header
      const cmdId = (buf.byteAt(2) << 8) | buf.byteAt(3)
      const seqId =
        (buf.byteAt(4) << 24) |
        (buf.byteAt(5) << 16) |
        (buf.byteAt(6) << 8) |
        buf.byteAt(7)

      const bodyLenRaw =
        (buf.byteAt(8) << 24) |
        (buf.byteAt(9) << 16) |
        (buf.byteAt(10) << 8) |
        buf.byteAt(11)

      const padding = (bodyLenRaw >> 24) & 0xff
      const bodyLen = bodyLenRaw & 0xffffff
      const totalLen = 12 + bodyLen + padding

      if (buf.length < totalLen) return null

      // Extract body and consume using compound method
      const body = buf.extractAndConsume(12, 12 + bodyLen, totalLen)
      return { id: cmdId, sequence: seqId, body }
    }

    it('parses a single complete message', () => {
      const buf = new GrowableBuffer()
      const body = new Uint8Array([0xAA, 0xBB, 0xCC, 0xDD])
      const msg = buildJensenMessage(4, 42, body) // CMD_GET_FILE_LIST=4, seq=42

      buf.append(msg)

      const parsed = tryParseMessage(buf)
      expect(parsed).not.toBeNull()
      expect(parsed!.id).toBe(4)
      expect(parsed!.sequence).toBe(42)
      expect(parsed!.body).toEqual(body)
      expect(buf.length).toBe(0)
    })

    it('handles junk bytes before sync marker', () => {
      const buf = new GrowableBuffer()
      const junk = new Uint8Array([0xFF, 0xFE, 0xFD, 0xFC, 0xFB])
      const body = new Uint8Array([0x01, 0x02])
      const msg = buildJensenMessage(1, 0, body)

      buf.append(junk)
      buf.append(msg)

      const parsed = tryParseMessage(buf)
      expect(parsed).not.toBeNull()
      expect(parsed!.id).toBe(1)
      expect(parsed!.body).toEqual(body)
      expect(buf.length).toBe(0)
    })

    it('returns null for incomplete message', () => {
      const buf = new GrowableBuffer()
      const body = new Uint8Array(100)
      const msg = buildJensenMessage(5, 1, body)

      // Only append first 50 bytes (incomplete)
      buf.append(msg.subarray(0, 50))

      const parsed = tryParseMessage(buf)
      expect(parsed).toBeNull()
      expect(buf.length).toBe(50) // Data preserved
    })

    it('handles split chunks (message arriving in two parts)', () => {
      const buf = new GrowableBuffer()
      const body = new Uint8Array(200)
      for (let i = 0; i < body.length; i++) body[i] = i & 0xff
      const msg = buildJensenMessage(5, 10, body)

      // Split at arbitrary point
      const splitPoint = 80
      buf.append(msg.subarray(0, splitPoint))

      // First attempt: incomplete
      let parsed = tryParseMessage(buf)
      expect(parsed).toBeNull()

      // Append rest
      buf.append(msg.subarray(splitPoint))

      // Second attempt: complete
      parsed = tryParseMessage(buf)
      expect(parsed).not.toBeNull()
      expect(parsed!.id).toBe(5)
      expect(parsed!.sequence).toBe(10)
      expect(parsed!.body).toEqual(body)
    })

    it('parses multiple messages sequentially', () => {
      const buf = new GrowableBuffer()

      const bodies = [
        new Uint8Array([0x01]),
        new Uint8Array([0x02, 0x03]),
        new Uint8Array([0x04, 0x05, 0x06]),
      ]

      // Append all three messages at once
      for (let i = 0; i < bodies.length; i++) {
        buf.append(buildJensenMessage(4, i, bodies[i]))
      }

      // Parse them one by one
      for (let i = 0; i < bodies.length; i++) {
        const parsed = tryParseMessage(buf)
        expect(parsed).not.toBeNull()
        expect(parsed!.sequence).toBe(i)
        expect(parsed!.body).toEqual(bodies[i])
      }

      // Buffer should be empty
      expect(buf.length).toBe(0)
    })

    it('parses messages with junk between them', () => {
      const buf = new GrowableBuffer()

      const junk1 = new Uint8Array([0xFF, 0xFF, 0xFF])
      const body1 = new Uint8Array([0xAA])
      const msg1 = buildJensenMessage(1, 0, body1)

      const junk2 = new Uint8Array([0xEE, 0xEE])
      const body2 = new Uint8Array([0xBB])
      const msg2 = buildJensenMessage(2, 1, body2)

      buf.append(junk1)
      buf.append(msg1)
      buf.append(junk2)
      buf.append(msg2)

      // First parse: skips junk1, extracts msg1
      const parsed1 = tryParseMessage(buf)
      expect(parsed1).not.toBeNull()
      expect(parsed1!.id).toBe(1)
      expect(parsed1!.body).toEqual(body1)

      // Second parse: skips junk2, extracts msg2
      const parsed2 = tryParseMessage(buf)
      expect(parsed2).not.toBeNull()
      expect(parsed2!.id).toBe(2)
      expect(parsed2!.body).toEqual(body2)

      expect(buf.length).toBe(0)
    })

    it('simulates full file list download with many messages', () => {
      const buf = new GrowableBuffer()
      const messageCount = 500

      // Build all messages
      const allData = new Uint8Array(messageCount * (12 + 64))
      let writePos = 0
      for (let i = 0; i < messageCount; i++) {
        const body = new Uint8Array(64)
        for (let j = 0; j < 64; j++) body[j] = (i * 64 + j) & 0xff
        const msg = buildJensenMessage(4, i, body)
        allData.set(msg, writePos)
        writePos += msg.length
      }

      // Feed in 64KB chunks (simulating USB reads)
      let feedPos = 0
      let parsedCount = 0
      while (feedPos < writePos) {
        const chunkSize = Math.min(65536, writePos - feedPos)
        buf.append(allData.subarray(feedPos, feedPos + chunkSize))
        feedPos += chunkSize

        // Parse all complete messages
        let msg = tryParseMessage(buf)
        while (msg !== null) {
          expect(msg.sequence).toBe(parsedCount)
          expect(msg.body.length).toBe(64)
          // Verify body content
          for (let j = 0; j < 64; j++) {
            expect(msg.body[j]).toBe((parsedCount * 64 + j) & 0xff)
          }
          parsedCount++
          msg = tryParseMessage(buf)
        }
      }

      expect(parsedCount).toBe(messageCount)
      expect(buf.length).toBe(0)
    })

    it('handles empty body message (terminator)', () => {
      const buf = new GrowableBuffer()
      const msg = buildJensenMessage(4, 99, new Uint8Array(0))
      buf.append(msg)

      const parsed = tryParseMessage(buf)
      expect(parsed).not.toBeNull()
      expect(parsed!.id).toBe(4)
      expect(parsed!.sequence).toBe(99)
      expect(parsed!.body.length).toBe(0)
    })

    it('integration: interleaved append and parse with compaction', () => {
      const buf = new GrowableBuffer()
      let parsedSequences: number[] = []

      // Simulate USB transfer with many small messages causing compaction
      for (let batch = 0; batch < 100; batch++) {
        // Build 5 messages per batch
        for (let i = 0; i < 5; i++) {
          const seqId = batch * 5 + i
          const body = new Uint8Array(100)
          body[0] = seqId & 0xff
          const msg = buildJensenMessage(5, seqId, body)
          buf.append(msg)
        }

        // Parse all available messages
        let parsed = tryParseMessage(buf)
        while (parsed !== null) {
          parsedSequences.push(parsed.sequence)
          parsed = tryParseMessage(buf)
        }
      }

      // Should have parsed all 500 messages in order
      expect(parsedSequences.length).toBe(500)
      for (let i = 0; i < 500; i++) {
        expect(parsedSequences[i]).toBe(i)
      }
    })
  })
})
