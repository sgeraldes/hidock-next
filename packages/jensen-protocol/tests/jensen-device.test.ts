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

  it('bounds a stalled download, resolves false, and quarantines the connection', async () => {
    vi.useFakeTimers()
    try {
      const transferOut = vi.fn(async () => ({ bytesWritten: 0 }))
      const transferIn = vi.fn(() => new Promise<USBInTransferResult>(() => {}))
      const reset = vi.fn(async () => {})
      const close = vi.fn(async () => {})
      const device = new JensenDevice(makeFakeUsb())
      ;(device as unknown as { device: USBDevice }).device = {
        opened: true,
        transferOut,
        transferIn,
        reset,
        close,
      } as unknown as USBDevice

      const resultPromise = device.downloadFile('stalled.hda', 1024, vi.fn())
      // 120s inactivity window (raised from 60s: real devices pause on big files),
      // then drain + quarantine teardown.
      await vi.advanceTimersByTimeAsync(300_000)

      await expect(resultPromise).resolves.toBe(false)
      // Stall settlement NEVER advances the queue: it tears the session down so the
      // slot is cleared via disconnect, and the session is left poisoned for reconnect.
      expect((device as unknown as { currentCommandTag: string | null }).currentCommandTag).toBeNull()
      expect(device.isPoisoned()).toBe(true)
      expect(device.isConnected()).toBe(false)
    } finally {
      vi.useRealTimers()
    }
  })

  it('a stalled transfer quarantines instead of advancing — late packets never overlap a next command', async () => {
    // CRITICAL regression: a stall must NEVER send the next command. Silence is not
    // proof of quiescence and a stalled transfer is unrecoverable, so the ONLY safe
    // move is to tear the session down (drain best-effort → disconnect) and require a
    // clean reconnect. A late transfer packet during the drain must be absorbed and
    // must not resolve the download as complete or release the slot.
    const ep = makePollEndpoint()
    const reset = vi.fn(async () => {})
    const close = vi.fn(async () => {})
    const device = new JensenDevice(makeFakeUsb())
    const dev = makePollDevice(ep, reset, close)
    const transferOut = dev.transferOut as unknown as ReturnType<typeof vi.fn>
    await device.tryConnect(dev) // real timers (300ms stabilization delay)
    ;(device as unknown as { startReadLoop: () => void }).startReadLoop()

    vi.useFakeTimers()
    try {
      const onChunk = vi.fn()
      // Large file that never completes; a second command is queued behind it.
      const dl = device.downloadFile('big.hda', 100_000, onChunk)
      const info = device.getDeviceInfo(5)

      await vi.advanceTimersByTimeAsync(1)
      // Only the transfer went out; the second command is blocked on the command lock.
      expect(transferOut).toHaveBeenCalledTimes(1)
      const firstSend = transferOut.mock.calls[0][1] as Uint8Array
      expect((firstSend[2] << 8) | firstSend[3]).toBe(CMD.TRANSFER_FILE)

      // A partial transfer packet arrives (does not complete the file).
      ep.emit('data', makeResponsePacket(CMD.TRANSFER_FILE, 0, new Uint8Array(4096)))
      await vi.advanceTimersByTimeAsync(1000) // let the throttled (1s) parse dispatch the handler
      expect(onChunk).toHaveBeenCalledTimes(1)

      // Device then goes silent for the full 120s inactivity window → watchdog fires
      // and begins settling (swaps in a no-op absorber, starts draining the IN FIFO).
      await vi.advanceTimersByTimeAsync(120_000)
      // Still holding the slot — nothing new sent yet.
      expect(transferOut).toHaveBeenCalledTimes(1)

      // While draining, the device keeps emitting LATE transfer packets. These must be
      // absorbed and MUST NOT release the slot or advance the queue mid-stream.
      for (let i = 0; i < 5; i++) {
        ep.emit('data', makeResponsePacket(CMD.TRANSFER_FILE, 0, new Uint8Array(4096)))
        await vi.advanceTimersByTimeAsync(100) // bytes still flowing keeps the drain busy
      }
      // INVARIANT: the next command has NOT been sent while packets were still arriving.
      expect(transferOut).toHaveBeenCalledTimes(1)

      // Stream goes quiet → drain reaches its idle boundary (~500ms) → quarantine
      // teardown (stopPoll + close) runs.
      await vi.advanceTimersByTimeAsync(3000)

      await expect(dl).resolves.toBe(false) // stalled transfer fails, not completes
      // The queue was NEVER advanced — quarantine tore the session down instead.
      expect(transferOut).toHaveBeenCalledTimes(1)
      expect(ep.stopPoll).toHaveBeenCalled() // poll stopped on the way down
      expect(device.isPoisoned()).toBe(true)
      expect(device.isConnected()).toBe(false)
      // The command queued behind the transfer was failed by teardown (resolved null),
      // NOT sent onto a poisoned bus.
      await expect(info).resolves.toBeNull()
    } finally {
      vi.useRealTimers()
    }
  })

  it('user-cancel advances ONLY at the protocol byte boundary — packets resuming after >500ms of silence never overlap the next command', async () => {
    // CRITICAL regression (re-review): silence is NOT proof of quiescence — this
    // device documents multi-second legitimate inter-packet pauses, and the device
    // streams the whole file regardless of a cancel (the protocol has no cancel
    // command). The ONLY protocol-proven end of a TRANSFER_FILE stream is its byte
    // boundary (fileSize body bytes). A silence-based drain would advance during a
    // pause and the resumed stream would overlap the next command.
    const ep = makePollEndpoint()
    const device = new JensenDevice(makeFakeUsb())
    const dev = makePollDevice(ep, vi.fn(async () => {}), vi.fn(async () => {}))
    const transferOut = dev.transferOut as unknown as ReturnType<typeof vi.fn>
    await device.tryConnect(dev)
    ;(device as unknown as { startReadLoop: () => void }).startReadLoop()

    vi.useFakeTimers()
    try {
      const FILE_SIZE = 12_288 // 3 packets of 4096
      const controller = new AbortController()
      const dl = device.downloadFile('small.hda', FILE_SIZE, vi.fn(), undefined, controller.signal)
      const info = device.getDeviceInfo(5)

      await vi.advanceTimersByTimeAsync(1)
      expect(transferOut).toHaveBeenCalledTimes(1)

      // First packet arrives (4096/12288), then the user cancels mid-stream.
      ep.emit('data', makeResponsePacket(CMD.TRANSFER_FILE, 0, new Uint8Array(4096)))
      await vi.advanceTimersByTimeAsync(1000) // TRANSFER_FILE parse throttle is 1s

      controller.abort('user-cancel')
      // The download's own promise resolves false immediately…
      await expect(dl).resolves.toBe(false)
      // …but the slot is NOT released.
      expect(transferOut).toHaveBeenCalledTimes(1)

      // The device PAUSES for >500ms (a legitimate inter-packet gap). The old
      // silence-based drain declared quiescence here and advanced — the exact bug.
      await vi.advanceTimersByTimeAsync(2_000)
      expect(transferOut).toHaveBeenCalledTimes(1) // still held: silence proves nothing

      // The stream RESUMES after the pause. These packets must be absorbed —
      // had we advanced during the pause, they would now overlap the next command.
      ep.emit('data', makeResponsePacket(CMD.TRANSFER_FILE, 0, new Uint8Array(4096)))
      await vi.advanceTimersByTimeAsync(1_100)
      expect(transferOut).toHaveBeenCalledTimes(1) // 8192/12288 — boundary not reached

      // Final packet reaches the protocol byte boundary (12288/12288) — the ONLY
      // proof the stream is finished. NOW the slot may be released.
      ep.emit('data', makeResponsePacket(CMD.TRANSFER_FILE, 0, new Uint8Array(4096)))
      await vi.advanceTimersByTimeAsync(1_200)

      expect(transferOut).toHaveBeenCalledTimes(2)
      const secondSend = transferOut.mock.calls[1][1] as Uint8Array
      expect((secondSend[2] << 8) | secondSend[3]).toBe(CMD.GET_DEVICE_INFO)
      // Connection stays healthy after a boundary-proven cancel — not poisoned.
      expect(device.isPoisoned()).toBe(false)
      expect(device.isConnected()).toBe(true)

      ep.emit('data', makeResponsePacket(CMD.GET_DEVICE_INFO, 1, new Uint8Array(20)))
      await vi.advanceTimersByTimeAsync(20)
      await expect(info).resolves.not.toBeNull()
    } finally {
      vi.useRealTimers()
    }
  })

  it('getActiveDownloadSettlement resolves only AFTER the byte-boundary drain (Phase-2 contract)', async () => {
    // downloadFile's OWN promise resolves false the instant a user-cancel abort fires
    // (so the UI can react at once), but the async byte-boundary drain is still running.
    // getActiveDownloadSettlement() exposes the POST-DRAIN settlement so a cancel
    // coordinator (jensen-handlers → download-transfer-controller) can stay registered
    // until the device has truly settled. It must stay PENDING through the drain and
    // resolve only once the boundary is reached.
    const ep = makePollEndpoint()
    const device = new JensenDevice(makeFakeUsb())
    const dev = makePollDevice(ep, vi.fn(async () => {}), vi.fn(async () => {}))
    const transferOut = dev.transferOut as unknown as ReturnType<typeof vi.fn>
    await device.tryConnect(dev)
    ;(device as unknown as { startReadLoop: () => void }).startReadLoop()

    vi.useFakeTimers()
    try {
      const FILE_SIZE = 12_288 // 3 packets of 4096
      const controller = new AbortController()
      const dl = device.downloadFile('small.hda', FILE_SIZE, vi.fn(), undefined, controller.signal)

      await vi.advanceTimersByTimeAsync(1)
      expect(transferOut).toHaveBeenCalledTimes(1)

      // First packet arrives (4096/12288), then the user cancels mid-stream.
      ep.emit('data', makeResponsePacket(CMD.TRANSFER_FILE, 0, new Uint8Array(4096)))
      await vi.advanceTimersByTimeAsync(1000)

      controller.abort('user-cancel')
      // downloadFile's own promise resolves false immediately…
      await expect(dl).resolves.toBe(false)

      // …but the POST-DRAIN settlement is still pending (drain has not reached the
      // byte boundary yet).
      const settlement = device.getActiveDownloadSettlement()
      expect(settlement).not.toBeNull()
      let settlementResolved = false
      void settlement!.then(() => { settlementResolved = true })

      // Let the drain run through a legitimate inter-packet pause — settlement must NOT
      // resolve while bytes are still owed against the boundary.
      await vi.advanceTimersByTimeAsync(2_000)
      expect(settlementResolved).toBe(false)

      // Second packet (8192/12288) — boundary still not reached.
      ep.emit('data', makeResponsePacket(CMD.TRANSFER_FILE, 0, new Uint8Array(4096)))
      await vi.advanceTimersByTimeAsync(1_100)
      expect(settlementResolved).toBe(false)

      // Final packet reaches the protocol byte boundary (12288/12288) → drain completes
      // (releaseSlotAndAdvance) → the settlement resolves.
      ep.emit('data', makeResponsePacket(CMD.TRANSFER_FILE, 0, new Uint8Array(4096)))
      await vi.advanceTimersByTimeAsync(1_200)

      expect(settlementResolved).toBe(true)
      // Boundary-proven cancel keeps the connection healthy and clears the handle.
      expect(device.isPoisoned()).toBe(false)
      expect(device.getActiveDownloadSettlement()).toBeNull()
    } finally {
      vi.useRealTimers()
    }
  })

  it('a user-cancel that stalls before its byte boundary quarantines (never advances)', async () => {
    // If the cancelled stream dies before delivering fileSize bytes, the boundary can
    // never be proven — the drain times out on no-progress and the ONLY safe move is
    // quarantine (tear down for a clean reconnect), never sending the next command.
    const ep = makePollEndpoint()
    const device = new JensenDevice(makeFakeUsb())
    const dev = makePollDevice(ep, vi.fn(async () => {}), vi.fn(async () => {}))
    const transferOut = dev.transferOut as unknown as ReturnType<typeof vi.fn>
    await device.tryConnect(dev)
    ;(device as unknown as { startReadLoop: () => void }).startReadLoop()

    vi.useFakeTimers()
    try {
      const controller = new AbortController()
      const dl = device.downloadFile('big.hda', 100_000, vi.fn(), undefined, controller.signal)
      const info = device.getDeviceInfo(5)

      await vi.advanceTimersByTimeAsync(1)
      expect(transferOut).toHaveBeenCalledTimes(1)

      // A little data, then the user cancels; the stream then goes dead forever.
      ep.emit('data', makeResponsePacket(CMD.TRANSFER_FILE, 0, new Uint8Array(4096)))
      await vi.advanceTimersByTimeAsync(1000)
      controller.abort('user-cancel')
      await expect(dl).resolves.toBe(false)

      // No progress toward the boundary for the full stall window → quarantine.
      await vi.advanceTimersByTimeAsync(121_000)
      await vi.advanceTimersByTimeAsync(3_000) // teardown settles

      expect(transferOut).toHaveBeenCalledTimes(1) // never advanced
      expect(ep.stopPoll).toHaveBeenCalled()
      expect(device.isPoisoned()).toBe(true)
      expect(device.isConnected()).toBe(false)
      await expect(info).resolves.toBeNull() // queued command failed by teardown, not sent
    } finally {
      vi.useRealTimers()
    }
  })

  it('disconnect during a user-cancel drain stands down — teardown owns the bus', async () => {
    // Re-review CRITICAL: a disconnect that starts WHILE the cancel drain is waiting
    // for the byte boundary must take over. The drain notices teardownInProgress and
    // stands down: no advance, no quarantine — the close path owns the FIFO.
    const ep = makePollEndpoint()
    const device = new JensenDevice(makeFakeUsb())
    const dev = makePollDevice(ep, vi.fn(async () => {}), vi.fn(async () => {}))
    const transferOut = dev.transferOut as unknown as ReturnType<typeof vi.fn>
    await device.tryConnect(dev)
    ;(device as unknown as { startReadLoop: () => void }).startReadLoop()

    const controller = new AbortController()
    const dl = device.downloadFile('big.hda', 100_000, vi.fn(), undefined, controller.signal)
    const info = device.getDeviceInfo(5)
    await new Promise((r) => setTimeout(r, 0))
    expect(transferOut).toHaveBeenCalledTimes(1)

    // User cancels → the byte-boundary drain starts (boundary far away).
    controller.abort('user-cancel')
    await expect(dl).resolves.toBe(false)
    expect(transferOut).toHaveBeenCalledTimes(1)

    // Disconnect begins while the drain is mid-wait.
    await device.disconnect()
    // Give the drain loop a few ticks to observe teardown and stand down.
    await new Promise((r) => setTimeout(r, 200))

    // The already-selected user-cancel policy could NOT advance or quarantine:
    // teardown owned the bus from the moment it started.
    expect(transferOut).toHaveBeenCalledTimes(1)
    expect(device.isConnected()).toBe(false)
    expect(device.isPoisoned()).toBe(false) // torn down by disconnect, not quarantined
    await expect(info).resolves.toBeNull() // queued command failed by teardown
  })

  it('disconnect during a download never advances the queue (teardown owns the FIFO)', async () => {
    // The disconnect IPC aborts with reason 'disconnect'. Settlement must resolve the
    // download false and STAND DOWN — the disconnect/close path owns the drain, so no
    // next command may be sent (synchronously or after any drain).
    const ep = makePollEndpoint()
    const reset = vi.fn(async () => {})
    const close = vi.fn(async () => {})
    const device = new JensenDevice(makeFakeUsb())
    const dev = makePollDevice(ep, reset, close)
    const transferOut = dev.transferOut as unknown as ReturnType<typeof vi.fn>
    await device.tryConnect(dev)
    ;(device as unknown as { startReadLoop: () => void }).startReadLoop()

    const controller = new AbortController()
    const dl = device.downloadFile('big.hda', 100_000, vi.fn(), undefined, controller.signal)
    const info = device.getDeviceInfo(5)
    await new Promise((r) => setTimeout(r, 0))
    expect(transferOut).toHaveBeenCalledTimes(1)

    // Mirror jensen-handlers: abort('disconnect') then run the real teardown.
    controller.abort('disconnect')
    await expect(dl).resolves.toBe(false)
    // No second command was sent synchronously by the abort (the classic race).
    expect(transferOut).toHaveBeenCalledTimes(1)

    await device.disconnect()
    // Teardown completed WITHOUT ever advancing the queue.
    expect(transferOut).toHaveBeenCalledTimes(1)
    expect(ep.stopPoll).toHaveBeenCalled()
    expect(device.isConnected()).toBe(false)
    // The queued command was failed (resolved null) by teardown, not sent.
    await expect(info).resolves.toBeNull()
  })

  it('double-settle guard: an abort after normal completion is a no-op', async () => {
    // Completion settles the transfer (bus already quiet, queue advanced normally). A
    // late abort/disconnect racing the final packet must NOT re-settle — no second
    // resolution, no quarantine, no extra teardown.
    const ep = makePollEndpoint()
    const device = new JensenDevice(makeFakeUsb())
    const dev = makePollDevice(ep, vi.fn(async () => {}), vi.fn(async () => {}))
    const transferOut = dev.transferOut as unknown as ReturnType<typeof vi.fn>
    await device.tryConnect(dev)
    ;(device as unknown as { startReadLoop: () => void }).startReadLoop()

    vi.useFakeTimers()
    try {
      const controller = new AbortController()
      const dl = device.downloadFile('small.hda', 4096, vi.fn(), undefined, controller.signal)
      await vi.advanceTimersByTimeAsync(1)

      // A single packet completes the file.
      ep.emit('data', makeResponsePacket(CMD.TRANSFER_FILE, 0, new Uint8Array(4096)))
      await vi.advanceTimersByTimeAsync(1000)
      await expect(dl).resolves.toBe(true)

      // A late abort now must do nothing — session stays healthy, not poisoned.
      controller.abort('disconnect')
      await vi.advanceTimersByTimeAsync(1000)
      expect(device.isPoisoned()).toBe(false)
      expect(device.isConnected()).toBe(true)
    } finally {
      vi.useRealTimers()
    }
  })

  it('quarantine auto-recovers with a bounded clean reconnect — no physical hot-plug needed', async () => {
    // Re-review HIGH: a quarantine tears the session down but the device never
    // unplugged, so no USB hot-plug event will ever reconnect it. The bounded
    // recovery machine must reconnect cleanly on its own (one tryConnect per
    // backoff step), clear the poison, and fire onconnect (which drives init +
    // the interrupted-download retry on the electron side).
    const ep = makePollEndpoint()
    const dev = makePollDevice(ep, vi.fn(async () => {}), vi.fn(async () => {}))
    // The still-plugged device is discoverable by getDevices() for the recovery.
    const getDevices = vi.fn(async () => [dev])
    const device = new JensenDevice(makeFakeUsb({ getDevices: getDevices as unknown as USB['getDevices'] }))
    const onconnect = vi.fn()
    device.onconnect = onconnect
    await device.tryConnect(dev)
    ;(device as unknown as { startReadLoop: () => void }).startReadLoop()
    // Flush the initial connect's setTimeout(0) onconnect before counting.
    await new Promise((r) => setTimeout(r, 10))
    onconnect.mockClear() // count only the RECOVERY connect below

    vi.useFakeTimers()
    try {
      // A download that stalls (no data ever) → quarantine teardown.
      const dl = device.downloadFile('dead.hda', 100_000, vi.fn())
      await vi.advanceTimersByTimeAsync(1)
      await vi.advanceTimersByTimeAsync(121_000)
      await expect(dl).resolves.toBe(false)
      expect(device.isPoisoned()).toBe(true)
      expect(device.isConnected()).toBe(false)
      expect(onconnect).not.toHaveBeenCalled() // not recovered yet

      // First backoff step (2s) fires ONE clean tryConnect → reconnects.
      await vi.advanceTimersByTimeAsync(3_000)
      expect(device.isConnected()).toBe(true)
      expect(device.isPoisoned()).toBe(false) // setup() cleared the poison
      await vi.advanceTimersByTimeAsync(10)   // onconnect fires via setTimeout(0)
      expect(onconnect).toHaveBeenCalledTimes(1)

      // The machine stops after success — no further reconnect attempts.
      const callsAfterRecovery = getDevices.mock.calls.length
      await vi.advanceTimersByTimeAsync(60_000)
      expect(getDevices.mock.calls.length).toBe(callsAfterRecovery)
    } finally {
      vi.useRealTimers()
    }
  })

  it('quarantine recovery caps its attempts and surfaces a terminal recovery-required state', async () => {
    // If the device cannot be reconnected (e.g. genuinely unplugged, or the
    // interface is wedged), the machine tries its bounded backoff steps (2s/5s/10s,
    // ONE clean attempt each — never a rapid open/close loop) and then STOPS,
    // firing onrecoveryexhausted so the UI can surface "recovery required".
    const ep = makePollEndpoint()
    const dev = makePollDevice(ep, vi.fn(async () => {}), vi.fn(async () => {}))
    const getDevices = vi.fn(async () => [] as USBDevice[]) // device never discoverable
    const device = new JensenDevice(makeFakeUsb({ getDevices: getDevices as unknown as USB['getDevices'] }))
    const onexhausted = vi.fn()
    device.onrecoveryexhausted = onexhausted
    await device.tryConnect(dev)
    ;(device as unknown as { startReadLoop: () => void }).startReadLoop()

    vi.useFakeTimers()
    try {
      const dl = device.downloadFile('dead.hda', 100_000, vi.fn())
      await vi.advanceTimersByTimeAsync(1)
      await vi.advanceTimersByTimeAsync(121_000) // stall → quarantine
      await expect(dl).resolves.toBe(false)
      getDevices.mockClear()

      // Backoff steps 2s → 5s → 10s: exactly three clean attempts, then terminal.
      await vi.advanceTimersByTimeAsync(20_000)
      expect(getDevices).toHaveBeenCalledTimes(3)
      expect(onexhausted).toHaveBeenCalledTimes(1)
      expect(device.isConnected()).toBe(false)
      expect(device.isPoisoned()).toBe(true) // still poisoned — needs manual action

      // Truly terminal: no further attempts ever.
      await vi.advanceTimersByTimeAsync(120_000)
      expect(getDevices).toHaveBeenCalledTimes(3)
      expect(onexhausted).toHaveBeenCalledTimes(1)
    } finally {
      vi.useRealTimers()
    }
  })

  // --- Recovery ownership: an EXPLICIT disconnect cancels the cycle at ANY point ---
  //
  // The recovery machine's ownership is a session GENERATION, bumped synchronously
  // at every explicit disconnect()/reset(). The cycle captures it at quarantine
  // start and re-checks after every await — so an explicit disconnect during the
  // quarantine teardown, the backoff, getDevices, open, or setup must fully cancel
  // recovery with NO reopen.

  function makeRecoveryHarness(getDevicesImpl?: () => Promise<USBDevice[]>) {
    const ep = makePollEndpoint()
    const dev = makePollDevice(ep, vi.fn(async () => {}), vi.fn(async () => {}))
    const getDevices = vi.fn(getDevicesImpl ?? (async () => [dev]))
    const device = new JensenDevice(makeFakeUsb({ getDevices: getDevices as unknown as USB['getDevices'] }))
    return { ep, dev, getDevices, device }
  }

  it('explicit disconnect during the quarantine teardown await → recovery is never scheduled', async () => {
    const { dev, getDevices, device } = makeRecoveryHarness()
    await device.tryConnect(dev)
    ;(device as unknown as { startReadLoop: () => void }).startReadLoop()
    const openCalls = (dev.open as unknown as ReturnType<typeof vi.fn>).mock.calls.length

    vi.useFakeTimers()
    try {
      const dl = device.downloadFile('dead.hda', 100_000, vi.fn())
      await vi.advanceTimersByTimeAsync(1)
      getDevices.mockClear()

      // Stall fires at 120s; its drain + the quarantine teardown span the next
      // ~second. Land the explicit disconnect INSIDE that teardown window.
      await vi.advanceTimersByTimeAsync(120_700)
      const d = device.disconnect() // bumps the generation mid-teardown
      await vi.advanceTimersByTimeAsync(5_000)
      await d
      await expect(dl).resolves.toBe(false)

      // The user's disconnect is final: no recovery scheduled, no reopen — ever.
      await vi.advanceTimersByTimeAsync(120_000)
      expect(getDevices).not.toHaveBeenCalled()
      expect((dev.open as unknown as ReturnType<typeof vi.fn>).mock.calls.length).toBe(openCalls)
      expect(device.isConnected()).toBe(false)
    } finally {
      vi.useRealTimers()
    }
  })

  it('explicit disconnect while recovery awaits getDevices → device is never reopened', async () => {
    let resolveGetDevices: ((d: USBDevice[]) => void) | null = null
    const { dev, getDevices, device } = makeRecoveryHarness(
      () => new Promise<USBDevice[]>((res) => { resolveGetDevices = res })
    )
    await device.tryConnect(dev)
    ;(device as unknown as { startReadLoop: () => void }).startReadLoop()
    const openCalls = (dev.open as unknown as ReturnType<typeof vi.fn>).mock.calls.length

    vi.useFakeTimers()
    try {
      const dl = device.downloadFile('dead.hda', 100_000, vi.fn())
      await vi.advanceTimersByTimeAsync(1)
      await vi.advanceTimersByTimeAsync(121_000) // stall → quarantine
      await expect(dl).resolves.toBe(false)

      await vi.advanceTimersByTimeAsync(2_100) // first backoff fires → attempt blocks on getDevices
      expect(getDevices).toHaveBeenCalledTimes(1)
      expect(resolveGetDevices).not.toBeNull()

      await device.disconnect() // explicit — bumps generation mid-attempt

      resolveGetDevices!([dev]) // the await returns AFTER the disconnect
      await vi.advanceTimersByTimeAsync(1_000)

      // Re-check before opening: the device must NOT be reopened.
      expect((dev.open as unknown as ReturnType<typeof vi.fn>).mock.calls.length).toBe(openCalls)
      expect(device.isConnected()).toBe(false)
      // And the dead cycle never reschedules.
      await vi.advanceTimersByTimeAsync(120_000)
      expect(getDevices).toHaveBeenCalledTimes(1)
    } finally {
      vi.useRealTimers()
    }
  })

  it('explicit disconnect while recovery awaits open() → no setup, the opened handle is closed', async () => {
    const { dev, getDevices, device } = makeRecoveryHarness()
    await device.tryConnect(dev)
    ;(device as unknown as { startReadLoop: () => void }).startReadLoop()
    const scMock = dev.selectConfiguration as unknown as ReturnType<typeof vi.fn>
    const openMock = dev.open as unknown as ReturnType<typeof vi.fn>
    const closeMock = dev.close as unknown as ReturnType<typeof vi.fn>

    vi.useFakeTimers()
    try {
      const dl = device.downloadFile('dead.hda', 100_000, vi.fn())
      await vi.advanceTimersByTimeAsync(1)
      await vi.advanceTimersByTimeAsync(121_000) // stall → quarantine
      await expect(dl).resolves.toBe(false)

      // Recovery's open() hangs until we release it.
      let resolveOpen: (() => void) | null = null
      openMock.mockImplementation(() => new Promise<void>((res) => { resolveOpen = res }))
      const setupCallsBefore = scMock.mock.calls.length
      const closeCallsBefore = closeMock.mock.calls.length

      await vi.advanceTimersByTimeAsync(2_100) // attempt: getDevices → open (pending)
      expect(resolveOpen).not.toBeNull()

      await device.disconnect() // explicit — mid-open

      resolveOpen!() // open completes AFTER the disconnect
      await vi.advanceTimersByTimeAsync(1_000)

      // Re-check before setup: never configured, and the unwanted open was undone.
      expect(scMock.mock.calls.length).toBe(setupCallsBefore)
      expect(closeMock.mock.calls.length).toBeGreaterThan(closeCallsBefore)
      expect(device.isConnected()).toBe(false)
      await vi.advanceTimersByTimeAsync(120_000)
      expect(getDevices).toHaveBeenCalledTimes(1) // dead cycle never reschedules
    } finally {
      vi.useRealTimers()
    }
  })

  it('explicit disconnect while recovery is in setup() → session ends disconnected, cycle dead', async () => {
    const { dev, getDevices, device } = makeRecoveryHarness()
    await device.tryConnect(dev)
    ;(device as unknown as { startReadLoop: () => void }).startReadLoop()
    const scMock = dev.selectConfiguration as unknown as ReturnType<typeof vi.fn>

    vi.useFakeTimers()
    try {
      const dl = device.downloadFile('dead.hda', 100_000, vi.fn())
      await vi.advanceTimersByTimeAsync(1)
      await vi.advanceTimersByTimeAsync(121_000) // stall → quarantine
      await expect(dl).resolves.toBe(false)

      // Recovery's setup blocks at selectConfiguration until we release it.
      let resolveSc: (() => void) | null = null
      scMock.mockImplementation(() => new Promise<void>((res) => { resolveSc = res }))

      await vi.advanceTimersByTimeAsync(2_100) // attempt: getDevices → open → setup (pending)
      expect(resolveSc).not.toBeNull()

      const d = device.disconnect() // explicit — mid-setup

      resolveSc!() // setup proceeds AFTER the disconnect started
      scMock.mockImplementation(async () => {}) // let teardown-triggered paths pass
      await vi.advanceTimersByTimeAsync(2_000) // setup 300ms + teardowns settle
      await d

      // Post-setup generation check tears the fresh session down again.
      expect(device.isConnected()).toBe(false)
      // Dead cycle: no further recovery attempts.
      const calls = getDevices.mock.calls.length
      await vi.advanceTimersByTimeAsync(120_000)
      expect(getDevices.mock.calls.length).toBe(calls)
      expect(device.isConnected()).toBe(false)
    } finally {
      vi.useRealTimers()
    }
  })

  it('concurrent double-disconnect: teardown ownership is refcounted (no premature release)', async () => {
    // With a shared boolean, the second disconnect finishing first cleared the flag
    // while the first teardown still owned the bus — letting a settlement advance
    // mid-teardown. The refcount + serialized teardown bodies prevent that.
    const ep = makePollEndpoint()
    const close = vi.fn(async () => {})
    const device = new JensenDevice(makeFakeUsb())
    const dev = makePollDevice(ep, vi.fn(async () => {}), close)
    const transferOut = dev.transferOut as unknown as ReturnType<typeof vi.fn>
    await device.tryConnect(dev)
    ;(device as unknown as { startReadLoop: () => void }).startReadLoop()

    const controller = new AbortController()
    const dl = device.downloadFile('big.hda', 100_000, vi.fn(), undefined, controller.signal)
    device.getDeviceInfo(5)
    await new Promise((r) => setTimeout(r, 0))
    expect(transferOut).toHaveBeenCalledTimes(1)

    // Cancel → the byte-boundary drain is now waiting; teardown must force standdown.
    controller.abort('user-cancel')
    await expect(dl).resolves.toBe(false)

    const d1 = device.disconnect()
    const d2 = device.disconnect()
    // BOTH teardowns hold ownership immediately (synchronous refcount claim).
    expect((device as unknown as { teardownDepth: number }).teardownDepth).toBe(2)

    await Promise.all([d1, d2])
    expect((device as unknown as { teardownDepth: number }).teardownDepth).toBe(0)

    // Give the (stood-down) drain a few ticks — it must never advance the queue.
    await new Promise((r) => setTimeout(r, 200))
    expect(transferOut).toHaveBeenCalledTimes(1)
    expect(close).toHaveBeenCalledTimes(1) // second teardown found nothing to close
    expect(device.isConnected()).toBe(false)
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
    // USB_PRODUCT_IDS is a NAMED-KEY map (H1/H1E/P1/...), not an array — a positional
    // `[0]` lookup yields undefined, which isHiDockUsbDevice() only tolerates because
    // its productName check ("hidock") short-circuits first. Use the real H1E id here and
    // in the other stand-ins below so they are faithful devices that detectModel() resolves.
    const hidockDevice = { vendorId: 0x10d6, productId: USB_PRODUCT_IDS.H1E, productName: 'HiDock H1E' }

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
      productId: USB_PRODUCT_IDS.H1E,
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

  it('drainUntilIdle returns { drained: true } immediately when not actively reading (idle disconnect)', async () => {
    const device = new JensenDevice(makeFakeUsb()) as unknown as {
      readLoopRunning: boolean
      drainUntilIdle: () => Promise<{ drained: true } | { timedOut: true }>
    }
    device.readLoopRunning = false
    await expect(device.drainUntilIdle()).resolves.toEqual({ drained: true })
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
      productId: USB_PRODUCT_IDS.H1E,
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

  // --- Command serialization + desync resistance (regression: CMD 18 poll) ---
  //
  // A device connected over a bus that cannot multiplex requires ONE outstanding
  // command at a time; the response matcher keys purely on command id, so a late
  // response to a timed-out command must never be matched against the next
  // command. These tests exercise the command lock + timeout unblocking +
  // stale-response discard that make that safe.

  it('serializes two concurrently-issued commands strictly on the wire (no interleave)', async () => {
    const ep = makePollEndpoint()
    const device = new JensenDevice(makeFakeUsb())
    const dev = makePollDevice(ep, vi.fn(async () => {}), vi.fn(async () => {}))
    const transferOut = dev.transferOut as unknown as ReturnType<typeof vi.fn>
    await device.tryConnect(dev)
    ;(device as unknown as { startReadLoop: () => void }).startReadLoop()

    // Issue two commands WITHOUT awaiting the first — they must serialize.
    const p1 = device.getDeviceInfo(5)
    const p2 = device.getRecordingFile(5)

    // Only the first command's send has gone out; the second is blocked on the lock.
    await new Promise((r) => setTimeout(r, 0))
    expect(transferOut).toHaveBeenCalledTimes(1)
    // First byte pair is the sync marker; bytes 2-3 are the command id (big-endian).
    const firstSend = transferOut.mock.calls[0][1] as Uint8Array
    expect((firstSend[2] << 8) | firstSend[3]).toBe(CMD.GET_DEVICE_INFO)

    // Answer command 1 → the lock releases and command 2 is sent.
    ep.emit('data', makeResponsePacket(CMD.GET_DEVICE_INFO, 0, new Uint8Array(20)))
    await p1
    await new Promise((r) => setTimeout(r, 0))
    expect(transferOut).toHaveBeenCalledTimes(2)
    const secondSend = transferOut.mock.calls[1][1] as Uint8Array
    expect((secondSend[2] << 8) | secondSend[3]).toBe(CMD.GET_RECORDING_FILE)

    ep.emit('data', makeResponsePacket(CMD.GET_RECORDING_FILE, 1, new Uint8Array(0)))
    await expect(p2).resolves.toEqual({ recording: null })

    await device.disconnect()
  })

  it('a command timeout unblocks the queue (next command still sends)', async () => {
    const ep = makePollEndpoint()
    const device = new JensenDevice(makeFakeUsb())
    const dev = makePollDevice(ep, vi.fn(async () => {}), vi.fn(async () => {}))
    const transferOut = dev.transferOut as unknown as ReturnType<typeof vi.fn>
    await device.tryConnect(dev) // real timers (setup has a 300ms stabilization delay)
    ;(device as unknown as { startReadLoop: () => void }).startReadLoop()

    vi.useFakeTimers()
    try {
      // First command never gets a response → it must time out and release the lock.
      const p1 = device.getRecordingFile(5)
      const p2 = device.getDeviceInfo(5)

      await vi.advanceTimersByTimeAsync(1)
      expect(transferOut).toHaveBeenCalledTimes(1) // second still blocked on the lock

      await vi.advanceTimersByTimeAsync(5000) // command 1 expires
      await expect(p1).resolves.toBeNull()
      await vi.advanceTimersByTimeAsync(1)
      expect(transferOut).toHaveBeenCalledTimes(2) // timeout unblocked the queue → second sent

      // currentCommandTag must reflect command 2 (seq 1), not the expired command 1.
      const secondSend = transferOut.mock.calls[1][1] as Uint8Array
      expect((secondSend[2] << 8) | secondSend[3]).toBe(CMD.GET_DEVICE_INFO)
      expect((device as unknown as { currentCommandTag: string | null }).currentCommandTag)
        .toBe('cmd-1-1')

      ep.emit('data', makeResponsePacket(CMD.GET_DEVICE_INFO, 1, new Uint8Array(20)))
      await vi.advanceTimersByTimeAsync(20) // let the throttled parse run
      await expect(p2).resolves.not.toBeNull()
    } finally {
      vi.useRealTimers()
    }
  })

  it('discards a late response for a timed-out command instead of desyncing the next', async () => {
    const ep = makePollEndpoint()
    const device = new JensenDevice(makeFakeUsb())
    const dev = makePollDevice(ep, vi.fn(async () => {}), vi.fn(async () => {}))
    await device.tryConnect(dev) // real timers
    ;(device as unknown as { startReadLoop: () => void }).startReadLoop()

    vi.useFakeTimers()
    try {
      // Command 1 (the poll) times out with no response.
      const p1 = device.getRecordingFile(5)
      await vi.advanceTimersByTimeAsync(5000)
      await expect(p1).resolves.toBeNull()

      // Command 2 (init device-info) is now in flight.
      const p2 = device.getDeviceInfo(10)
      await vi.advanceTimersByTimeAsync(1)

      // The device's LATE response to command 1 arrives while command 2 is current.
      // The old behavior cleared command 2's tag here → command 2 then never
      // resolved (its own response matched an empty slot). It must be discarded.
      const staleName = '2025May13-160405-Rec59.hda'
      const staleBody = new Uint8Array([...staleName].map((c) => c.charCodeAt(0)))
      ep.emit('data', makeResponsePacket(CMD.GET_RECORDING_FILE, 0, staleBody))
      await vi.advanceTimersByTimeAsync(20) // parse + dispatch the stale packet

      // Command 2's genuine response then resolves it correctly — no desync.
      const infoBody = new Uint8Array(20)
      infoBody[0] = 5 // version byte
      ep.emit('data', makeResponsePacket(CMD.GET_DEVICE_INFO, 1, infoBody))
      await vi.advanceTimersByTimeAsync(20)
      const info = await p2
      expect(info).not.toBeNull()
      expect(info?.versionCode).toBe('0.0.0')
    } finally {
      vi.useRealTimers()
    }
  })
})
