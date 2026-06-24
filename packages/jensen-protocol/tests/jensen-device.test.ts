// @vitest-environment node

/**
 * Unit tests for the transport-agnostic JensenDevice.
 *
 * A fake WebUSB backend is injected via the constructor, so all protocol-level
 * logic (message building, parsing, error handling, lifecycle) runs without any
 * real hardware or environment-specific USB stack.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { JensenDevice, USB_PRODUCT_IDS, CMD } from '../src/index.js'

// A minimal WebUSB backend stand-in: no devices, rejecting picker.
function makeFakeUsb(overrides: Partial<USB> = {}): USB {
  return {
    getDevices: () => Promise.resolve([]),
    requestDevice: () => Promise.reject(new Error('No device selected')),
    addEventListener: () => {},
    removeEventListener: () => {},
    ...overrides,
  } as unknown as USB
}

function makeResponsePacket(cmdId: number, sequence: number, body: Uint8Array): Uint8Array {
  const header = new Uint8Array(12)
  header[0] = 0x12
  header[1] = 0x34
  header[2] = (cmdId >> 8) & 0xff
  header[3] = cmdId & 0xff
  header[4] = (sequence >> 24) & 0xff
  header[5] = (sequence >> 16) & 0xff
  header[6] = (sequence >> 8) & 0xff
  header[7] = sequence & 0xff
  const len = body.length
  header[8] = (len >> 24) & 0xff
  header[9] = (len >> 16) & 0xff
  header[10] = (len >> 8) & 0xff
  header[11] = len & 0xff
  const packet = new Uint8Array(12 + len)
  packet.set(header, 0)
  packet.set(body, 12)
  return packet
}

describe('JensenDevice (transport-agnostic core)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  // --- Static / DI ---

  it('isSupported() returns true when a USB backend is injected', () => {
    expect(JensenDevice.isSupported(makeFakeUsb())).toBe(true)
  })

  it('isSupported() returns false when no backend is available', () => {
    expect(JensenDevice.isSupported(undefined)).toBe(false)
  })

  it('CMD constants are defined', () => {
    expect(CMD.GET_DEVICE_INFO).toBe(1)
    expect(CMD.GET_FILE_LIST).toBe(4)
    expect(CMD.TRANSFER_FILE).toBe(5)
    expect(CMD.DELETE_FILE).toBe(7)
    expect(CMD.GET_SETTINGS).toBe(11)
    expect(CMD.GET_CARD_INFO).toBe(16)
    expect(CMD.FORMAT_CARD).toBe(17)
  })

  it('USB_PRODUCT_IDS maps known models', () => {
    expect(USB_PRODUCT_IDS.H1).toBe(0xaf0c)
    expect(USB_PRODUCT_IDS.H1E).toBe(0xb00d)
    expect(USB_PRODUCT_IDS.P1).toBe(0xb00e)
    expect(USB_PRODUCT_IDS.P1_MINI).toBe(0xaf0f)
  })

  // --- Lifecycle ---

  it('new JensenDevice starts disconnected', () => {
    expect(new JensenDevice(makeFakeUsb()).isConnected()).toBe(false)
  })

  it('getModel() returns "unknown" before connection', () => {
    expect(new JensenDevice(makeFakeUsb()).getModel()).toBe('unknown')
  })

  it('connect() returns false when no devices found', async () => {
    expect(await new JensenDevice(makeFakeUsb()).connect()).toBe(false)
  })

  it('tryConnect() returns false when no devices found', async () => {
    expect(await new JensenDevice(makeFakeUsb()).tryConnect()).toBe(false)
  })

  it('hot-plug auto-connect honors autoConnectGate', () => {
    let connectHandler: ((e: { device: unknown }) => void) | null = null
    const usb = makeFakeUsb({
      addEventListener: ((type: string, h: (e: { device: unknown }) => void) => {
        if (type === 'connect') connectHandler = h
      }) as unknown as USB['addEventListener'],
    })
    const hidockDevice = { vendorId: 0x10d6, productId: USB_PRODUCT_IDS[0], productName: 'HiDock H1E' }

    // Gate closed → the connect event is ignored, tryConnect is not called.
    const devOff = new JensenDevice(usb)
    const tryConnectOff = vi.spyOn(devOff, 'tryConnect').mockResolvedValue(false)
    devOff.autoConnectGate = () => false
    devOff.setupUsbConnectListener()
    connectHandler?.({ device: hidockDevice })
    expect(tryConnectOff).not.toHaveBeenCalled()

    // Gate open → the connect event drives tryConnect.
    const devOn = new JensenDevice(usb)
    const tryConnectOn = vi.spyOn(devOn, 'tryConnect').mockResolvedValue(true)
    devOn.autoConnectGate = () => true
    devOn.setupUsbConnectListener()
    connectHandler?.({ device: hidockDevice })
    expect(tryConnectOn).toHaveBeenCalledTimes(1)
  })

  it('disconnect() is safe when not connected', async () => {
    const device = new JensenDevice(makeFakeUsb())
    await expect(device.disconnect()).resolves.toBeUndefined()
    expect(device.isConnected()).toBe(false)
  })

  it('reset() returns false when not connected', async () => {
    expect(await new JensenDevice(makeFakeUsb()).reset()).toBe(false)
  })

  it('isOperationInProgress()/getLockHolder() are idle on a fresh instance', () => {
    const device = new JensenDevice(makeFakeUsb())
    expect(device.isOperationInProgress()).toBe(false)
    expect(device.getLockHolder()).toBeNull()
  })

  it('listFiles does not stop at the old 120 second cutoff', async () => {
    vi.useFakeTimers()
    try {
      const device = new JensenDevice(makeFakeUsb())
      device.versionNumber = 327733
      ;(device as unknown as { device: unknown }).device = {
        transferOut: vi.fn().mockResolvedValue({ status: 'ok', bytesWritten: 12 }),
        transferIn: vi.fn(() => new Promise(() => {})),
      }
      let settled = false
      const promise = device.listFiles().then((result) => {
        settled = true
        return result
      })
      await Promise.resolve()
      await vi.advanceTimersByTimeAsync(120_001)
      expect(settled).toBe(false)
      await vi.advanceTimersByTimeAsync(480_000)
      await expect(promise).resolves.toEqual([])
      expect(settled).toBe(true)
    } finally {
      vi.useRealTimers()
    }
  })

  // --- Protocol: packet building ---

  it('response packet has correct sync header bytes', () => {
    const packet = makeResponsePacket(1, 0, new Uint8Array([0xaa, 0xbb]))
    expect(packet[0]).toBe(0x12)
    expect(packet[1]).toBe(0x34)
  })

  it('response packet encodes command ID + body length correctly', () => {
    const packet = makeResponsePacket(CMD.GET_DEVICE_INFO, 0, new Uint8Array([1, 2, 3, 4, 5]))
    expect(((packet[2] & 0xff) << 8) | (packet[3] & 0xff)).toBe(CMD.GET_DEVICE_INFO)
    const bodyLen =
      ((packet[8] & 0xff) << 24) | ((packet[9] & 0xff) << 16) | ((packet[10] & 0xff) << 8) | (packet[11] & 0xff)
    expect(bodyLen).toBe(5)
  })

  // --- Protocol: parsing ---

  it('parseFileListFlat returns empty for insufficient data', () => {
    const result = new JensenDevice(makeFakeUsb()).parseFileListFlat(new Uint8Array(0))
    expect(result.files).toEqual([])
    expect(result.headerTotal).toBe(0)
  })

  it('parseFileListFlat detects 0xFF 0xFF header and extracts total count', () => {
    const buf = new Uint8Array([0xff, 0xff, 0x00, 0x00, 0x00, 0x05])
    const result = new JensenDevice(makeFakeUsb()).parseFileListFlat(buf)
    expect(result.headerTotal).toBe(5)
    expect(result.files).toHaveLength(0)
  })

  it('fromBcd converts BCD bytes to string correctly', () => {
    expect(new JensenDevice(makeFakeUsb()).fromBcd(0x20, 0x25, 0x01, 0x13)).toBe('20250113')
  })

  // --- Filename date parsing ---

  it('parseFilenameDateTime parses month-name format', () => {
    const result = new JensenDevice(makeFakeUsb()).parseFilenameDateTime('2025May13-160405-Rec59.hda')
    expect(result.createDate).toBe('2025-05-13')
    expect(result.createTime).toBe('16:04:05')
    expect(result.time?.getFullYear()).toBe(2025)
    expect(result.time?.getMonth()).toBe(4)
  })

  it('parseFilenameDateTime parses old WAV REC format', () => {
    const result = new JensenDevice(makeFakeUsb()).parseFilenameDateTime('20250513160405REC001.wav')
    expect(result.createDate).toBe('2025-05-13')
    expect(result.createTime).toBe('16:04:05')
    expect(result.time).toBeInstanceOf(Date)
  })

  it('parseFilenameDateTime returns null time for unrecognized format', () => {
    expect(new JensenDevice(makeFakeUsb()).parseFilenameDateTime('unknown_file.hda').time).toBeNull()
  })

  // --- Callbacks ---

  it('connect/disconnect callbacks can be assigned', () => {
    const device = new JensenDevice(makeFakeUsb())
    const cb = vi.fn()
    device.ondisconnect = cb
    device.onconnect = cb
    expect(device.ondisconnect).toBe(cb)
    expect(device.onconnect).toBe(cb)
  })
})
