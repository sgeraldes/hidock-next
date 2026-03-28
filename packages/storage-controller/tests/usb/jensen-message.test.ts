import { describe, it, expect } from 'vitest'
import { JensenMessage, parseResponseHeader } from '../../src/usb/jensen-message.js'

describe('JensenMessage', () => {
  it('creates a message with sync markers 0x12 0x34', () => {
    const msg = new JensenMessage(1)
    const bytes = msg.make()
    expect(bytes[0]).toBe(0x12)
    expect(bytes[1]).toBe(0x34)
  })

  it('encodes command ID as big-endian 16-bit', () => {
    const msg = new JensenMessage(4)
    const bytes = msg.make()
    expect(bytes[2]).toBe(0x00)
    expect(bytes[3]).toBe(0x04)
  })

  it('encodes sequence ID as big-endian 32-bit', () => {
    const msg = new JensenMessage(1).sequence(256)
    const bytes = msg.make()
    expect(bytes[4]).toBe(0x00)
    expect(bytes[5]).toBe(0x00)
    expect(bytes[6]).toBe(0x01)
    expect(bytes[7]).toBe(0x00)
  })

  it('encodes body length as big-endian 32-bit', () => {
    const msg = new JensenMessage(5).body([0x41, 0x42, 0x43])
    const bytes = msg.make()
    expect(bytes[8]).toBe(0x00)
    expect(bytes[9]).toBe(0x00)
    expect(bytes[10]).toBe(0x00)
    expect(bytes[11]).toBe(0x03)
    expect(bytes[12]).toBe(0x41)
    expect(bytes[13]).toBe(0x42)
    expect(bytes[14]).toBe(0x43)
  })

  it('produces 12-byte header for empty body', () => {
    const msg = new JensenMessage(1)
    expect(msg.make().byteLength).toBe(12)
  })

  it('chains body and sequence fluently', () => {
    const msg = new JensenMessage(5).body([1, 2]).sequence(10)
    const bytes = msg.make()
    expect(bytes.byteLength).toBe(14)
  })
})

describe('parseResponseHeader', () => {
  it('parses a valid 12-byte header', () => {
    const data = new Uint8Array([0x12, 0x34, 0x00, 0x01, 0x00, 0x00, 0x00, 0x05, 0x00, 0x00, 0x00, 0x03])
    const header = parseResponseHeader(data)
    expect(header).not.toBeNull()
    expect(header!.command).toBe(1)
    expect(header!.sequence).toBe(5)
    expect(header!.bodyLength).toBe(3)
  })

  it('returns null for invalid sync markers', () => {
    const data = new Uint8Array([0xFF, 0xFF, 0x00, 0x01, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00])
    expect(parseResponseHeader(data)).toBeNull()
  })

  it('returns null for data shorter than 12 bytes', () => {
    const data = new Uint8Array([0x12, 0x34, 0x00, 0x01])
    expect(parseResponseHeader(data)).toBeNull()
  })
})
