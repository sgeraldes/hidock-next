// CHARACTERIZATION (C5 Phase 0) — pins current behavior, not desired behavior; see device-pipeline-spec §1, §2, §3

/**
 * Pins JensenDevice command-queueing/intent behaviors that the sibling suite
 * (jensen-device.test.ts) does not already cover: tryConnect's already-connected
 * and non-HiDock-device early returns, listFiles' `data.filelist` concurrent-list
 * guard (including a race window the guard does NOT close), and downloadFile's
 * pre-flight rejection of an already-aborted signal / disconnected device. These
 * are exactly the "current gate inventory" behaviors device-pipeline-spec §1
 * attributes to JensenDevice, and the coalescing-key design in §3 point 2 is the
 * future fix for the gap pinned here as KNOWN-ODD. Zero behavior change — every
 * assertion below describes what the code does today, not what it should do.
 */

import { describe, it, expect, vi } from 'vitest'
import { EventEmitter } from 'events'
import { JensenDevice, USB_PRODUCT_IDS, CMD } from '../src/index.js'

// A minimal WebUSB backend stand-in: no devices, rejecting picker. Mirrors the
// sibling suite's harness exactly.
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

// node-usb native poll harness — copied from the sibling suite so tryConnect()
// can actually complete setup() and the read loop can be armed.
function makePollEndpoint(): EventEmitter & { startPoll: ReturnType<typeof vi.fn>; stopPoll: ReturnType<typeof vi.fn> } {
  const ep = new EventEmitter() as EventEmitter & { startPoll: ReturnType<typeof vi.fn>; stopPoll: ReturnType<typeof vi.fn> }
  ep.startPoll = vi.fn()
  ep.stopPoll = vi.fn((cb?: () => void) => cb?.())
  return ep
}

function makePollDevice(ep: unknown, reset: ReturnType<typeof vi.fn>, close: ReturnType<typeof vi.fn>): USBDevice {
  const native = {
    interface: (n: number) => (n === 0 ? { endpoint: (addr: number) => (addr === 0x82 ? ep : undefined) } : undefined),
  }
  return {
    vendorId: 0x10d6,
    // USB_PRODUCT_IDS is a NAMED-KEY map (H1/H1E/P1/...), not an array — a positional
    // `[0]` lookup yields undefined, which isHiDockUsbDevice() only tolerates because
    // its productName check ("hidock") short-circuits first. Use the real H1E id so the
    // stand-in is a faithful device and detectModel() resolves it.
    productId: USB_PRODUCT_IDS.H1E,
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
    device: native,
  } as unknown as USBDevice
}

function cmdIdOf(call: unknown[]): number {
  const bytes = call[1] as Uint8Array
  return (bytes[2] << 8) | bytes[3]
}

describe('JensenDevice command-queueing gaps (C5 characterization)', () => {
  // --- tryConnect() early returns (device-pipeline-spec §1 row 2) ---

  it('tryConnect() returns early (true) when already connected — no second open()/claim', async () => {
    const ep = makePollEndpoint()
    const device = new JensenDevice(makeFakeUsb())
    const dev = makePollDevice(ep, vi.fn(async () => {}), vi.fn(async () => {}))
    const openMock = dev.open as unknown as ReturnType<typeof vi.fn>
    const claimMock = dev.claimInterface as unknown as ReturnType<typeof vi.fn>

    await device.tryConnect(dev)
    expect(device.isConnected()).toBe(true)
    expect(openMock).toHaveBeenCalledTimes(1)
    expect(claimMock).toHaveBeenCalledTimes(1)

    // Second tryConnect() while already connected: early-returns true WITHOUT
    // re-opening or re-claiming the device (jensen-device.ts:532-535).
    const second = await device.tryConnect(dev)
    expect(second).toBe(true)
    expect(openMock).toHaveBeenCalledTimes(1)
    expect(claimMock).toHaveBeenCalledTimes(1)

    await device.disconnect()
  })

  it('tryConnect(preAuthorizedDevice) returns false without opening when the device is not a HiDock', async () => {
    // jensen-device.ts:549-552 — isHiDockUsbDevice() rejects a provided device
    // whose vendorId/productId/productName don't match before any open() call.
    const notHiDock = {
      vendorId: 0x9999, // not in USB_VENDOR_IDS
      productId: 0x1234, // not in USB_PRODUCT_IDS
      productName: 'Some Other USB Gadget',
      open: vi.fn(async () => {}),
    } as unknown as USBDevice

    const device = new JensenDevice(makeFakeUsb())
    const ok = await device.tryConnect(notHiDock)

    expect(ok).toBe(false)
    expect(device.isConnected()).toBe(false)
    expect((notHiDock.open as unknown as ReturnType<typeof vi.fn>)).not.toHaveBeenCalled()
  })

  // --- listFiles() concurrent-list guard (device-pipeline-spec §1 row 3) ---

  it('listFiles() returns [] immediately (not a queued/awaited result) when data.filelist is already set', async () => {
    // KNOWN-ODD: device-pipeline-spec §3 point 2 — the future coordinator returns
    // the EXISTING promise (or a DUPLICATE outcome) for an overlapping intent so
    // the caller still gets the real result. The current guard instead resolves
    // the second caller with an empty array, discarding it from the in-flight
    // scan; it never touches the wire or the live accumulator.
    const ep = makePollEndpoint()
    const device = new JensenDevice(makeFakeUsb())
    const dev = makePollDevice(ep, vi.fn(async () => {}), vi.fn(async () => {}))
    const transferOut = dev.transferOut as unknown as ReturnType<typeof vi.fn>
    await device.tryConnect(dev)
    ;(device as unknown as { startReadLoop: () => void }).startReadLoop()

    // Simulate an in-flight scan by installing the accumulator the guard checks.
    const liveAccumulator = { tailBuffer: new Uint8Array(0), tailLen: 0, files: [], headerTotal: 0, headerParsed: false }
    ;(device as unknown as { data: Record<string, unknown> }).data['filelist'] = liveAccumulator

    const result = await device.listFiles()

    expect(result).toEqual([])
    expect(transferOut).not.toHaveBeenCalled() // no second CMD_GET_FILE_LIST/GET_FILE_COUNT sent
    // The live accumulator is untouched — the guard did not clear or replace it.
    expect((device as unknown as { data: Record<string, unknown> }).data['filelist']).toBe(liveAccumulator)

    await device.disconnect()
  })

  it('KNOWN-ODD: two listFiles() calls issued back-to-back before firmware version is known BOTH reach the wire', async () => {
    // KNOWN-ODD: device-pipeline-spec §1 row 3 claims data.filelist "prevents two
    // list accumulators consuming the same stream" and §3 point 2 promises
    // coalesced/deduplicated sync intent. In reality the guard (jensen-device.ts:
    // 2088 `if (this.data[key] != null) return []`) is checked BEFORE the
    // `await this.getFileCount(5)` call that legacy/unversioned firmware requires
    // (jensen-device.ts:2093-2096) — `this.data[key]` is only assigned AFTER that
    // await resolves. Two listFiles() calls fired synchronously (no await between
    // them) both pass the still-null guard and BOTH issue their own
    // CMD_GET_FILE_COUNT command onto the wire — the two-accumulator race the
    // guard is documented to prevent. This is exactly the gap the coordinator's
    // coalescing key (`sync:<generation>`) is designed to close.
    const ep = makePollEndpoint()
    const device = new JensenDevice(makeFakeUsb())
    const dev = makePollDevice(ep, vi.fn(async () => {}), vi.fn(async () => {}))
    const transferOut = dev.transferOut as unknown as ReturnType<typeof vi.fn>
    await device.tryConnect(dev)
    ;(device as unknown as { startReadLoop: () => void }).startReadLoop()
    // Fresh post-connect state: setup() leaves versionNumber null, forcing the
    // getFileCount() pre-check path (jensen-device.ts:2093).
    expect(device.versionNumber).toBeNull()

    // Fire both calls synchronously — neither is awaited before the second starts.
    const p1 = device.listFiles()
    const p2 = device.listFiles()

    // Let both synchronous prefixes (guard check -> await getFileCount) run and
    // the first queued GET_FILE_COUNT reach the wire.
    await new Promise((r) => setTimeout(r, 0))
    await new Promise((r) => setTimeout(r, 0))
    expect(transferOut.mock.calls.length).toBeGreaterThanOrEqual(1)
    expect(cmdIdOf(transferOut.mock.calls[0])).toBe(CMD.GET_FILE_COUNT)

    // Answer the first GET_FILE_COUNT so the command lock advances to the second.
    ep.emit('data', makeResponsePacket(CMD.GET_FILE_COUNT, 0, new Uint8Array([0, 0, 0, 0])))
    await new Promise((r) => setTimeout(r, 0))
    await new Promise((r) => setTimeout(r, 0))

    // A SECOND CMD_GET_FILE_COUNT reached the wire — proof the guard did not
    // stop the second caller (it raced the first through the un-guarded window).
    const fileCountSends = transferOut.mock.calls.filter((c) => cmdIdOf(c) === CMD.GET_FILE_COUNT)
    expect(fileCountSends.length).toBe(2)

    // Answer the second GET_FILE_COUNT as empty (0 files) so both calls settle
    // cleanly without needing to drive a full GET_FILE_LIST exchange.
    ep.emit('data', makeResponsePacket(CMD.GET_FILE_COUNT, 1, new Uint8Array([0, 0, 0, 0])))
    await expect(p1).resolves.toEqual([])
    await expect(p2).resolves.toEqual([])

    await device.disconnect()
  })

  // --- downloadFile() pre-flight rejection (device-pipeline-spec §1 row 4, §3 DeviceTransport.downloadFile) ---

  it('downloadFile() rejects synchronously (no transfer begins) when the AbortSignal is already aborted', async () => {
    const ep = makePollEndpoint()
    const device = new JensenDevice(makeFakeUsb())
    const dev = makePollDevice(ep, vi.fn(async () => {}), vi.fn(async () => {}))
    const transferOut = dev.transferOut as unknown as ReturnType<typeof vi.fn>
    await device.tryConnect(dev)
    ;(device as unknown as { startReadLoop: () => void }).startReadLoop()

    const controller = new AbortController()
    controller.abort('pre-aborted')

    const result = await device.downloadFile('never.hda', 4096, vi.fn(), undefined, controller.signal)

    expect(result).toBe(false)
    expect(transferOut).not.toHaveBeenCalled() // no CMD_TRANSFER_FILE ever sent

    await device.disconnect()
  })

  it('downloadFile() resolves false without transferring when the device is disconnected', async () => {
    const device = new JensenDevice(makeFakeUsb())
    expect(device.isConnected()).toBe(false)

    const result = await device.downloadFile('never.hda', 4096, vi.fn())

    expect(result).toBe(false)
  })
})
