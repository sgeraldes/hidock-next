// @vitest-environment node

/**
 * Unit tests for the transport-agnostic JensenDevice.
 *
 * A fake WebUSB backend is injected via the constructor, so all protocol-level
 * logic (message building, parsing, error handling, lifecycle) runs without any
 * real hardware or environment-specific USB stack.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { EventEmitter } from 'events'
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

  function makeTeardownDevice(reset: ReturnType<typeof vi.fn>, close: ReturnType<typeof vi.fn>): USBDevice {
    return {
      vendorId: 0x10d6,
      productId: USB_PRODUCT_IDS[0],
      productName: 'HiDock H1E',
      opened: true,
      open: vi.fn(async () => {}),
      selectConfiguration: vi.fn(async () => {}),
      claimInterface: vi.fn(async () => {}),
      selectAlternateInterface: vi.fn(async () => {}),
      reset,
      close,
    } as unknown as USBDevice
  }

  it('disconnect() drains a streaming read and closes WITHOUT reset (no mid-stream wedge)', async () => {
    // A USB reset while the file list is streaming wedges the firmware. When data
    // is flowing, disconnect() must let the in-flight read complete and close
    // without resetting — mirroring the browser's teardown.
    const reset = vi.fn(async () => {})
    const close = vi.fn(async () => {})
    const device = new JensenDevice(makeFakeUsb())
    await device.tryConnect(makeTeardownDevice(reset, close))
    expect(device.isConnected()).toBe(true)

    // Simulate an active read loop (streaming).
    ;(device as unknown as { readLoopRunning: boolean }).readLoopRunning = true

    const p = device.disconnect()
    // The in-flight read completes and the loop stops re-issuing (synchronously,
    // before the drain's first poll tick fires).
    ;(device as unknown as { readLoopRunning: boolean }).readLoopRunning = false
    await p

    expect(close).toHaveBeenCalled()
    expect(reset).not.toHaveBeenCalled()
    expect(device.isConnected()).toBe(false)
  })

  it('disconnect() resets to cancel a stuck idle read, then closes', async () => {
    // When the read loop is pending but no data is flowing (idle), the transfer
    // cannot complete on its own — reset() cancels it so close() succeeds (the
    // normal-disconnect path; safe on an idle device).
    const reset = vi.fn(async () => {})
    const close = vi.fn(async () => {})
    const device = new JensenDevice(makeFakeUsb())
    await device.tryConnect(makeTeardownDevice(reset, close))

    // Active loop but no bytes ever arrive → idle; drain gives up after ~400ms.
    ;(device as unknown as { readLoopRunning: boolean }).readLoopRunning = true

    await device.disconnect()

    expect(reset).toHaveBeenCalled()
    expect(close).toHaveBeenCalled()
    expect(reset.mock.invocationCallOrder[0]).toBeLessThan(close.mock.invocationCallOrder[0])
    expect(device.isConnected()).toBe(false)
  })

  // --- Native poll path (Electron/Node: node-usb startPoll/stopPoll) ---
  //
  // node-usb's InEndpoint is an EventEmitter: polled data arrives via the 'data'
  // event (NOT the startPoll callback, which only fires on end/cancel). The mock
  // mirrors that contract exactly.

  function makePollEndpoint(): EventEmitter & { startPoll: ReturnType<typeof vi.fn>; stopPoll: ReturnType<typeof vi.fn> } {
    const ep = new EventEmitter() as EventEmitter & { startPoll: ReturnType<typeof vi.fn>; stopPoll: ReturnType<typeof vi.fn> }
    ep.startPoll = vi.fn()
    ep.stopPoll = vi.fn((cb?: () => void) => cb?.()) // emit 'end' synchronously
    return ep
  }

  function makePollDevice(ep: unknown, reset: ReturnType<typeof vi.fn>, close: ReturnType<typeof vi.fn>): USBDevice {
    const native = {
      interface: (n: number) => (n === 0 ? { endpoint: (addr: number) => (addr === 0x82 ? ep : undefined) } : undefined),
    }
    return {
      vendorId: 0x10d6,
      productId: USB_PRODUCT_IDS[0],
      productName: 'HiDock H1E',
      opened: true,
      open: vi.fn(async () => {}),
      selectConfiguration: vi.fn(async () => {}),
      claimInterface: vi.fn(async () => {}),
      selectAlternateInterface: vi.fn(async () => {}),
      transferOut: vi.fn(async () => ({ status: 'ok', bytesWritten: 12 })),
      transferIn: vi.fn(() => new Promise(() => {})),
      reset,
      close,
      // Native usb.Device handle reached by getNativeInEndpoint().
      device: native,
    } as unknown as USBDevice
  }

  it('read loop uses native startPoll(3, 32768) when a native endpoint is available', async () => {
    const ep = makePollEndpoint()
    const device = new JensenDevice(makeFakeUsb())
    await device.tryConnect(makePollDevice(ep, vi.fn(async () => {}), vi.fn(async () => {})))

    ;(device as unknown as { startReadLoop: () => void }).startReadLoop()
    // Second call must not double-start (poll is continuous).
    ;(device as unknown as { startReadLoop: () => void }).startReadLoop()

    expect(ep.startPoll).toHaveBeenCalledTimes(1)
    expect(ep.startPoll.mock.calls[0][0]).toBe(3)
    expect(ep.startPoll.mock.calls[0][1]).toBe(32768)
    // listening for data on the 'data' event (node-usb's real contract)
    expect(ep.listenerCount('data')).toBe(1)

    await device.disconnect()
  })

  it('disconnect() uses stopPoll (clean cancel) and closes WITHOUT reset on the native poll path', async () => {
    const ep = makePollEndpoint()
    const reset = vi.fn(async () => {})
    const close = vi.fn(async () => {})
    const device = new JensenDevice(makeFakeUsb())
    await device.tryConnect(makePollDevice(ep, reset, close))
    ;(device as unknown as { startReadLoop: () => void }).startReadLoop()

    await device.disconnect()

    expect(ep.stopPoll).toHaveBeenCalledTimes(1)
    expect(close).toHaveBeenCalled()
    expect(reset).not.toHaveBeenCalled() // never reset on the poll path
    expect(ep.listenerCount('data')).toBe(0) // listeners cleaned up
    expect(device.isConnected()).toBe(false)
  })

  // --- getRecordingFile (CMD 18) — live-recording status read ---

  it('getRecordingFile() resolves with the active recording filename', async () => {
    const ep = makePollEndpoint()
    const device = new JensenDevice(makeFakeUsb())
    await device.tryConnect(makePollDevice(ep, vi.fn(async () => {}), vi.fn(async () => {})))

    const promise = device.getRecordingFile()
    // Let transferOut resolve so the read loop (startPoll + 'data' listener) is armed.
    await new Promise((r) => setTimeout(r, 0))

    const name = '2025May13-160405-Rec59.hda'
    const body = new Uint8Array([...name].map((c) => c.charCodeAt(0)))
    ep.emit('data', makeResponsePacket(CMD.GET_RECORDING_FILE, 0, body))

    await expect(promise).resolves.toEqual({ recording: name, name })

    await device.disconnect()
  })

  it('getRecordingFile() resolves with recording:null when the device is idle (empty body)', async () => {
    const ep = makePollEndpoint()
    const device = new JensenDevice(makeFakeUsb())
    await device.tryConnect(makePollDevice(ep, vi.fn(async () => {}), vi.fn(async () => {})))

    const promise = device.getRecordingFile()
    await new Promise((r) => setTimeout(r, 0))

    // Empty body = device not currently recording.
    ep.emit('data', makeResponsePacket(CMD.GET_RECORDING_FILE, 0, new Uint8Array(0)))

    await expect(promise).resolves.toEqual({ recording: null })

    await device.disconnect()
  })

  it('getRecordingFile() returns null when no device is connected', async () => {
    const device = new JensenDevice(makeFakeUsb())
    expect(await device.getRecordingFile()).toBeNull()
  })

  it('reset() stops the native poll BEFORE issuing device.reset() (no mid-poll wedge)', async () => {
    const ep = makePollEndpoint()
    const reset = vi.fn(async () => {})
    const close = vi.fn(async () => {})
    const device = new JensenDevice(makeFakeUsb())
    await device.tryConnect(makePollDevice(ep, reset, close))
    ;(device as unknown as { startReadLoop: () => void }).startReadLoop()
    expect(ep.startPoll).toHaveBeenCalled()

    await device.reset()

    expect(ep.stopPoll).toHaveBeenCalled()
    expect(reset).toHaveBeenCalled()
    expect(ep.stopPoll.mock.invocationCallOrder[0]).toBeLessThan(reset.mock.invocationCallOrder[0])
  })

  it("native 'data' event copies the reused libusb buffer into receiveChunks", async () => {
    const ep = makePollEndpoint()
    const device = new JensenDevice(makeFakeUsb())
    await device.tryConnect(makePollDevice(ep, vi.fn(async () => {}), vi.fn(async () => {})))
    ;(device as unknown as { startReadLoop: () => void }).startReadLoop()

    const shared = new Uint8Array([1, 2, 3, 4])
    ep.emit('data', shared)
    // libusb reuses the same buffer for the next transfer — overwrite it; the
    // stored chunk must be an independent copy.
    shared.fill(0)

    const chunks = (device as unknown as { receiveChunks: DataView[] }).receiveChunks
    expect(chunks).toHaveLength(1)
    expect(chunks[0].getUint8(0)).toBe(1)
    expect(chunks[0].getUint8(3)).toBe(4)
    expect((device as unknown as { totalBytesReceived: number }).totalBytesReceived).toBe(4)

    await device.disconnect()
  })

  it('drainUntilIdle blocks while bytes flow, resolves after ~500ms of silence', async () => {
    // Disconnect during a download/scan must let the device finish streaming (FIFO
    // drained) before teardown — cancelling mid-send wedges the firmware.
    vi.useFakeTimers()
    try {
      const device = new JensenDevice(makeFakeUsb()) as unknown as {
        readLoopRunning: boolean
        totalBytesReceived: number
        drainUntilIdle: (m?: number) => Promise<void>
      }
      device.readLoopRunning = true
      device.totalBytesReceived = 0
      let settled = false
      const p = device.drainUntilIdle(20000).then(() => { settled = true })

      // Data still arriving → must keep waiting.
      for (let i = 0; i < 6; i++) {
        device.totalBytesReceived += 100
        await vi.advanceTimersByTimeAsync(50)
      }
      expect(settled).toBe(false)

      // Silence → resolves after ~500ms.
      await vi.advanceTimersByTimeAsync(550)
      await p
      expect(settled).toBe(true)
    } finally {
      vi.useRealTimers()
    }
  })

  it('drainUntilIdle returns immediately when not actively reading (idle disconnect)', async () => {
    const device = new JensenDevice(makeFakeUsb()) as unknown as {
      readLoopRunning: boolean
      drainUntilIdle: () => Promise<void>
    }
    device.readLoopRunning = false
    await expect(device.drainUntilIdle()).resolves.toBeUndefined()
  })

  it('disconnect() closes without reset when the read loop is idle (no pending transfer)', async () => {
    // No read loop running → nothing pending → close() directly, no reset.
    const reset = vi.fn(async () => {})
    const close = vi.fn(async () => {})
    const device = new JensenDevice(makeFakeUsb())
    await device.tryConnect(makeTeardownDevice(reset, close))

    await device.disconnect()

    expect(close).toHaveBeenCalled()
    expect(reset).not.toHaveBeenCalled()
    expect(device.isConnected()).toBe(false)
  })

  it('tryConnect() releases the device when claimInterface fails (no ACCESS lock)', async () => {
    // setup() must fail the connect cleanly on a claim error and release the
    // device, instead of reporting "connected" while every command errors.
    const close = vi.fn(async () => {})
    const reset = vi.fn(async () => {})
    const fakeDevice = {
      vendorId: 0x10d6,
      productId: USB_PRODUCT_IDS[0],
      productName: 'HiDock H1E',
      opened: true,
      open: vi.fn(async () => {}),
      selectConfiguration: vi.fn(async () => {}),
      claimInterface: vi.fn(async () => { throw new Error('LIBUSB_ERROR_ACCESS') }),
      selectAlternateInterface: vi.fn(async () => {}),
      reset,
      close,
    } as unknown as USBDevice

    const device = new JensenDevice(makeFakeUsb())
    const ok = await device.tryConnect(fakeDevice)

    expect(ok).toBe(false)
    expect(device.isConnected()).toBe(false)
    // device was released (reset+close) rather than left open+claimed
    expect(close).toHaveBeenCalled()
  })

  it('reset() returns false when not connected', async () => {
    expect(await new JensenDevice(makeFakeUsb()).reset()).toBe(false)
  })

  it('abortInFlight() resolves pending commands with null and clears scan/queue state', async () => {
    // Preemption hook used by disconnect/reset so they don't queue behind a
    // running (or stalled) scan. A pending command promise must settle with null,
    // and the listFiles accumulator (this.data) + command queue must be cleared.
    const device = new JensenDevice(makeFakeUsb()) as unknown as {
      pendingPromises: Map<string, { resolve: (v: unknown) => void; timeout?: ReturnType<typeof setTimeout> }>
      commandQueue: unknown[]
      data: Record<string, unknown>
      currentCommandTag: string | null
      abortInFlight: () => void
    }

    let resolved: unknown = 'unset'
    const pending = new Promise((resolve) => {
      device.pendingPromises.set('filelist', { resolve })
    }).then((v) => {
      resolved = v
    })
    device.commandQueue.push({})
    device.data['filelist'] = { files: [] }
    device.currentCommandTag = 'filelist'

    device.abortInFlight()
    await pending

    expect(resolved).toBeNull()
    expect(device.pendingPromises.size).toBe(0)
    expect(device.commandQueue.length).toBe(0)
    expect(device.data['filelist']).toBeUndefined()
    expect(device.currentCommandTag).toBeNull()
  })

  it('isOperationInProgress()/getLockHolder() are idle on a fresh instance', () => {
    const device = new JensenDevice(makeFakeUsb())
    expect(device.isOperationInProgress()).toBe(false)
    expect(device.getLockHolder()).toBeNull()
  })

  it('ingestReadChunk throttles parsing (continuous stream still parses; one parse per window)', () => {
    // Regression: a debounce (reset timer on every chunk) means a continuous
    // poll stream never parses until it stops — which froze download progress and
    // buffered the whole file. Throttle = at most one parse per parseDelay, and it
    // reschedules afterwards so the stream keeps parsing.
    vi.useFakeTimers()
    try {
      const device = new JensenDevice(makeFakeUsb()) as unknown as {
        parseDelay: number
        ingestReadChunk: (c: DataView) => void
        processBufferedData: () => void
      }
      const parse = vi.spyOn(device, 'processBufferedData').mockImplementation(() => {})
      device.parseDelay = 100
      const chunk = () => device.ingestReadChunk(new DataView(new Uint8Array([1, 2, 3]).buffer))

      chunk(); chunk(); chunk() // continuous flow within one window
      expect(parse).not.toHaveBeenCalled()
      vi.advanceTimersByTime(100)
      expect(parse).toHaveBeenCalledTimes(1) // throttled, not 3

      chunk() // a later chunk schedules the next parse
      vi.advanceTimersByTime(100)
      expect(parse).toHaveBeenCalledTimes(2)
    } finally {
      vi.useRealTimers()
    }
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
