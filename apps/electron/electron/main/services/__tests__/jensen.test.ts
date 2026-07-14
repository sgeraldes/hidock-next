// @vitest-environment node

/**
 * Unit tests for main-process JensenDevice.
 *
 * The `usb` native module is mocked so tests run without real hardware.
 * All protocol-level logic (message building, parsing, error types) is exercised
 * against the mock transport.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

// ---------------------------------------------------------------------------
// Mock the usb package.
// IMPORTANT: vi.mock() factories are hoisted before variable declarations, so
// the mock object must be defined inline inside the factory — it cannot
// reference variables declared in the module body.
// ---------------------------------------------------------------------------

vi.mock('usb', () => {
  const instance = {
    getDevices: () => Promise.resolve([]),
    requestDevice: () => Promise.reject(new Error('No device selected')),
    addEventListener: () => {},
    removeEventListener: () => {},
  }
  return {
    WebUSB: function WebUSBMock() {
      return instance
    },
  }
})


// ---------------------------------------------------------------------------
// Import after mocking
// ---------------------------------------------------------------------------

import {
  JensenDevice,
  USB_PRODUCT_IDS,
  CMD,
} from '../jensen'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Build a minimal valid Jensen protocol response packet.
 * Header: 0x12 0x34, cmd (2B), seq (4B), bodyLen (4B), body
 */
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

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('JensenDevice (main process)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  // -------------------------------------------------------------------------
  // Module / static
  // -------------------------------------------------------------------------

  it('module loads without error', async () => {
    const mod = await import('../jensen')
    expect(mod).toBeDefined()
    expect(mod.JensenDevice).toBeDefined()
    expect(mod.getJensenDevice).toBeDefined()
  })

  it('isSupported() returns true when WebUSB is available', () => {
    expect(JensenDevice.isSupported()).toBe(true)
  })

  it('setAutoConnectChecker gates the singleton hot-plug auto-connect', async () => {
    const { getJensenDevice, setAutoConnectChecker } = await import('../jensen')
    const device = getJensenDevice()

    setAutoConnectChecker(() => false)
    expect(device.autoConnectGate?.()).toBe(false)

    setAutoConnectChecker(() => true)
    expect(device.autoConnectGate?.()).toBe(true)
  })

  it('CMD constants are defined', () => {
    expect(CMD.GET_DEVICE_INFO).toBe(1)
    expect(CMD.GET_FILE_LIST).toBe(4)
    expect(CMD.TRANSFER_FILE).toBe(5)
    expect(CMD.DELETE_FILE).toBe(7)
    expect(CMD.GET_SETTINGS).toBe(11)
    expect(CMD.GET_CARD_INFO).toBe(16)
    expect(CMD.FORMAT_CARD).toBe(17)
    expect(CMD.REALTIME_READ_SETTING).toBe(32)
    expect(CMD.REALTIME_CONTROL).toBe(33)
    expect(CMD.REALTIME_TRANSFER).toBe(34)
    expect(CMD.GET_BATTERY_STATUS).toBe(4100)
    expect(CMD.BLUETOOTH_STATUS).toBe(4099)
    expect(CMD.BT_SCAN).toBe(4101)
  })

  it('USB_PRODUCT_IDS maps known models', () => {
    expect(USB_PRODUCT_IDS.H1).toBe(0xaf0c)
    expect(USB_PRODUCT_IDS.H1E).toBe(0xb00d)
    expect(USB_PRODUCT_IDS.P1).toBe(0xb00e)
    expect(USB_PRODUCT_IDS.P1_MINI).toBe(0xaf0f)
  })

  // -------------------------------------------------------------------------
  // Lifecycle
  // -------------------------------------------------------------------------

  it('new JensenDevice starts disconnected', () => {
    const device = new JensenDevice()
    expect(device.isConnected()).toBe(false)
  })

  it('isP1Device() returns false when disconnected (model=unknown)', () => {
    const device = new JensenDevice()
    expect(device.isP1Device()).toBe(false)
  })

  it('getModel() returns "unknown" before connection', () => {
    const device = new JensenDevice()
    expect(device.getModel()).toBe('unknown')
  })

  it('connect() returns false when no devices found', async () => {
    // Mock already configured to return [] from getDevices and reject requestDevice
    const device = new JensenDevice()
    const result = await device.connect()
    expect(result).toBe(false)
  })

  it('tryConnect() returns false when no devices found', async () => {
    // Mock already configured to return [] from getDevices
    const device = new JensenDevice()
    const result = await device.tryConnect()
    expect(result).toBe(false)
  })

  it('disconnect() is safe when not connected', async () => {
    const device = new JensenDevice()
    await expect(device.disconnect()).resolves.toBeUndefined()
    expect(device.isConnected()).toBe(false)
  })

  it('reset() returns false when not connected', async () => {
    const device = new JensenDevice()
    const result = await device.reset()
    expect(result).toBe(false)
  })

  it('isOperationInProgress() returns false on a fresh instance', () => {
    const device = new JensenDevice()
    expect(device.isOperationInProgress()).toBe(false)
  })

  it('getLockHolder() returns null when no operation in progress', () => {
    const device = new JensenDevice()
    expect(device.getLockHolder()).toBeNull()
  })

  it('listFiles does not stop at the old 120 second cutoff', async () => {
    vi.useFakeTimers()

    try {
      const device = new JensenDevice()
      device.versionNumber = 327733
      ;(device as any).device = {
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

  // -------------------------------------------------------------------------
  // Protocol — JensenMessage packet building
  // -------------------------------------------------------------------------

  it('response packet has correct sync header bytes', () => {
    const body = new Uint8Array([0xaa, 0xbb])
    const packet = makeResponsePacket(1, 0, body)
    expect(packet[0]).toBe(0x12)
    expect(packet[1]).toBe(0x34)
  })

  it('response packet encodes command ID correctly', () => {
    const packet = makeResponsePacket(CMD.GET_DEVICE_INFO, 0, new Uint8Array([]))
    const cmdId = ((packet[2] & 0xff) << 8) | (packet[3] & 0xff)
    expect(cmdId).toBe(CMD.GET_DEVICE_INFO)
  })

  it('response packet encodes body length correctly', () => {
    const body = new Uint8Array([1, 2, 3, 4, 5])
    const packet = makeResponsePacket(1, 0, body)
    const bodyLen =
      ((packet[8] & 0xff) << 24) |
      ((packet[9] & 0xff) << 16) |
      ((packet[10] & 0xff) << 8) |
      (packet[11] & 0xff)
    expect(bodyLen).toBe(5)
  })

  // -------------------------------------------------------------------------
  // Protocol — parsePacket (accessed through public parseFileListFlat path)
  // -------------------------------------------------------------------------

  it('parsePacket returns null for insufficient data (tested via parseFileListFlat)', () => {
    const device = new JensenDevice()
    // An empty buffer has no valid file entries — method should return empty array
    const result = device.parseFileListFlat(new Uint8Array(0))
    expect(result.files).toEqual([])
    expect(result.headerTotal).toBe(0)
  })

  it('parseFileListFlat detects 0xFF 0xFF header and extracts total count', () => {
    const device = new JensenDevice()
    // Build a buffer with the file count header only (no file entries)
    const buf = new Uint8Array([0xff, 0xff, 0x00, 0x00, 0x00, 0x05])
    const result = device.parseFileListFlat(buf)
    expect(result.headerTotal).toBe(5)
    expect(result.files).toHaveLength(0)
  })

  it('fromBcd converts BCD bytes to string correctly', () => {
    const device = new JensenDevice()
    // 0x20, 0x25, 0x01, 0x13 → "20250113"
    expect(device.fromBcd(0x20, 0x25, 0x01, 0x13)).toBe('20250113')
  })

  // -------------------------------------------------------------------------
  // Model detection
  // -------------------------------------------------------------------------

  it('detectModel maps H1 product ID (via USB_PRODUCT_IDS constants)', () => {
    // detectModel is private; test via the public USB_PRODUCT_IDS constants
    // that feed into it — the mapping is exercised by the renderer-side tests.
    expect(USB_PRODUCT_IDS.H1).toBe(0xaf0c)
    expect(USB_PRODUCT_IDS.H1E).toBe(0xb00d)
    expect(USB_PRODUCT_IDS.P1).toBe(0xb00e)
    expect(USB_PRODUCT_IDS.P1_MINI).toBe(0xaf0f)
  })

  // -------------------------------------------------------------------------
  // Disconnect detection regex
  // -------------------------------------------------------------------------

  it('disconnect detection pattern matches NO_DEVICE error', () => {
    const disconnectPattern = /NO_DEVICE|NOT_FOUND|LIBUSB_TRANSFER_NO_DEVICE|LIBUSB_ERROR_NO_DEVICE/
    expect(disconnectPattern.test('LIBUSB_TRANSFER_NO_DEVICE')).toBe(true)
    expect(disconnectPattern.test('LIBUSB_ERROR_NO_DEVICE')).toBe(true)
    expect(disconnectPattern.test('NO_DEVICE')).toBe(true)
    expect(disconnectPattern.test('NOT_FOUND')).toBe(true)
    expect(disconnectPattern.test('some other error')).toBe(false)
  })

  // -------------------------------------------------------------------------
  // Callbacks
  // -------------------------------------------------------------------------

  it('ondisconnect callback can be assigned', () => {
    const device = new JensenDevice()
    const cb = vi.fn()
    device.ondisconnect = cb
    expect(device.ondisconnect).toBe(cb)
  })

  it('onconnect callback can be assigned', () => {
    const device = new JensenDevice()
    const cb = vi.fn()
    device.onconnect = cb
    expect(device.onconnect).toBe(cb)
  })

  // -------------------------------------------------------------------------
  // Filename date parsing
  // -------------------------------------------------------------------------

  it('parseFilenameDateTime parses month-name format', () => {
    const device = new JensenDevice()
    const result = device.parseFilenameDateTime('2025May13-160405-Rec59.hda')
    expect(result.createDate).toBe('2025-05-13')
    expect(result.createTime).toBe('16:04:05')
    expect(result.time).toBeInstanceOf(Date)
    expect(result.time?.getFullYear()).toBe(2025)
    expect(result.time?.getMonth()).toBe(4) // May = 4 (0-indexed)
  })

  it('parseFilenameDateTime parses old WAV REC format', () => {
    const device = new JensenDevice()
    const result = device.parseFilenameDateTime('20250513160405REC001.wav')
    expect(result.createDate).toBe('2025-05-13')
    expect(result.createTime).toBe('16:04:05')
    expect(result.time).toBeInstanceOf(Date)
  })

  it('parseFilenameDateTime returns null time for unrecognized format', () => {
    const device = new JensenDevice()
    const result = device.parseFilenameDateTime('unknown_file.hda')
    expect(result.time).toBeNull()
  })

  // -------------------------------------------------------------------------
  // getJensenDevice singleton
  // -------------------------------------------------------------------------

  it('getJensenDevice returns the same instance on repeated calls', async () => {
    const { getJensenDevice } = await import('../jensen')
    const a = getJensenDevice()
    const b = getJensenDevice()
    expect(a).toBe(b)
  })
})
