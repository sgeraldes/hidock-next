/**
 * Unit tests for useDeviceConnection — the shared device connect/disconnect
 * control used by the titlebar pill and the Device Sync page.
 *
 * MOCK-ONLY. The device service, store selectors, and toast are all mocked;
 * NO real USB access. Verifies status mapping, label/model formatting, action
 * routing to the service, the single-attempt guard, and error surfacing.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'

// --- Mock the store selectors with mutable state we control per test ---
let deviceStateMock = { connected: false, model: 'unknown' as string }
let connectionStatusMock: {
  step: string
  message: string
  connectFailed?: boolean
  devicePresent?: boolean
} = { step: 'idle', message: '' }

vi.mock('@/store/useAppStore', () => ({
  useDeviceState: () => deviceStateMock,
  useConnectionStatus: () => connectionStatusMock
}))

// --- Mock the device service singleton ---
const connectMock = vi.fn<() => Promise<boolean>>()
const disconnectMock = vi.fn<() => Promise<void>>()
const isConnectedMock = vi.fn<() => boolean>()

vi.mock('@/services/hidock-device', () => ({
  getHiDockDeviceService: () => ({
    connect: connectMock,
    disconnect: disconnectMock,
    isConnected: isConnectedMock
  })
}))

// --- Mock toast ---
const toastMock = vi.fn()
vi.mock('@/components/ui/toaster', () => ({
  toast: (opts: unknown) => toastMock(opts)
}))

import { useDeviceConnection } from '../useDeviceConnection'

beforeEach(() => {
  deviceStateMock = { connected: false, model: 'unknown' }
  connectionStatusMock = { step: 'idle', message: '' }
  connectMock.mockReset().mockResolvedValue(true)
  disconnectMock.mockReset().mockResolvedValue(undefined)
  isConnectedMock.mockReset().mockReturnValue(false)
  toastMock.mockReset()
})

describe('useDeviceConnection — status mapping', () => {
  it('maps disconnected when not connected and step is idle', () => {
    const { result } = renderHook(() => useDeviceConnection())
    expect(result.current.status).toBe('disconnected')
    expect(result.current.isDisconnected).toBe(true)
    expect(result.current.label).toBe('Connect device')
    expect(result.current.deviceModel).toBeNull()
  })

  it('maps connecting when the store step is an in-progress step', () => {
    connectionStatusMock = { step: 'opening', message: 'Opening…' }
    const { result } = renderHook(() => useDeviceConnection())
    expect(result.current.status).toBe('connecting')
    expect(result.current.isConnecting).toBe(true)
    expect(result.current.label).toBe('Connecting…')
  })

  it('treats error and ready as not-connecting', () => {
    connectionStatusMock = { step: 'error', message: 'boom' }
    const { result } = renderHook(() => useDeviceConnection())
    // Not connected + step error → disconnected
    expect(result.current.status).toBe('disconnected')
  })

  it('maps connected + formats the model label', () => {
    deviceStateMock = { connected: true, model: 'hidock-h1e' }
    connectionStatusMock = { step: 'ready', message: 'ready' }
    const { result } = renderHook(() => useDeviceConnection())
    expect(result.current.status).toBe('connected')
    expect(result.current.isConnected).toBe(true)
    expect(result.current.deviceModel).toBe('H1E')
    expect(result.current.label).toBe('H1E')
  })

  it('falls back to "Device" when connected model is unknown', () => {
    deviceStateMock = { connected: true, model: 'unknown' }
    const { result } = renderHook(() => useDeviceConnection())
    expect(result.current.deviceModel).toBe('Device')
    expect(result.current.label).toBe('Device')
  })
})

describe('useDeviceConnection — failed state (honest pill)', () => {
  it('maps failed with a busy hint when a connect attempt failed and a device is present', () => {
    connectionStatusMock = { step: 'idle', message: 'Connection failed', connectFailed: true, devicePresent: true }
    const { result } = renderHook(() => useDeviceConnection())
    expect(result.current.status).toBe('failed')
    expect(result.current.isFailed).toBe(true)
    expect(result.current.label).toBe('Connection failed — retry')
    expect(result.current.failedHint).toBe('Device may be busy (recording?)')
  })

  it('maps failed with a generic hint when no device was present', () => {
    connectionStatusMock = { step: 'idle', message: 'Connection failed', connectFailed: true, devicePresent: false }
    const { result } = renderHook(() => useDeviceConnection())
    expect(result.current.status).toBe('failed')
    expect(result.current.failedHint).toBe('Could not reach the HiDock')
  })

  it('a successful connection supersedes a stale failed flag', () => {
    deviceStateMock = { connected: true, model: 'hidock-h1e' }
    connectionStatusMock = { step: 'ready', message: 'ready', connectFailed: true }
    const { result } = renderHook(() => useDeviceConnection())
    expect(result.current.status).toBe('connected')
    expect(result.current.isFailed).toBe(false)
  })

  it('an in-progress retry supersedes the failed flag (shows connecting)', () => {
    connectionStatusMock = { step: 'requesting', message: 'Requesting…', connectFailed: true }
    const { result } = renderHook(() => useDeviceConnection())
    expect(result.current.status).toBe('connecting')
    expect(result.current.isFailed).toBe(false)
  })
})

describe('useDeviceConnection — connect action', () => {
  it('routes connect() to the device service and returns success', async () => {
    const { result } = renderHook(() => useDeviceConnection())
    let ok: boolean | undefined
    await act(async () => {
      ok = await result.current.connect()
    })
    expect(connectMock).toHaveBeenCalledTimes(1)
    expect(ok).toBe(true)
  })

  it('does not connect when the device is already connected', async () => {
    isConnectedMock.mockReturnValue(true)
    const { result } = renderHook(() => useDeviceConnection())
    let ok: boolean | undefined
    await act(async () => {
      ok = await result.current.connect()
    })
    expect(connectMock).not.toHaveBeenCalled()
    expect(ok).toBe(false)
  })

  it('guards against overlapping attempts (one click = one attempt)', async () => {
    // connect() hangs until we resolve it, so a second call overlaps the first.
    let resolveConnect: (v: boolean) => void = () => {}
    connectMock.mockImplementation(
      () => new Promise<boolean>((res) => { resolveConnect = res })
    )
    const { result } = renderHook(() => useDeviceConnection())

    let firstDone: Promise<boolean>
    let secondResult: boolean | undefined
    await act(async () => {
      firstDone = result.current.connect()
      // Second, overlapping attempt must be rejected without touching the service.
      secondResult = await result.current.connect()
    })
    expect(secondResult).toBe(false)
    expect(connectMock).toHaveBeenCalledTimes(1)

    await act(async () => {
      resolveConnect(true)
      await firstDone
    })
  })

  it('surfaces a toast when connect fails and toastErrors is true (default)', async () => {
    connectMock.mockResolvedValue(false)
    const { result } = renderHook(() => useDeviceConnection())
    await act(async () => {
      await result.current.connect()
    })
    expect(toastMock).toHaveBeenCalledTimes(1)
    expect(toastMock.mock.calls[0][0]).toMatchObject({ variant: 'error' })
  })

  it('does NOT toast on failure when toastErrors is false', async () => {
    connectMock.mockResolvedValue(false)
    const { result } = renderHook(() => useDeviceConnection({ toastErrors: false }))
    await act(async () => {
      await result.current.connect()
    })
    expect(toastMock).not.toHaveBeenCalled()
  })

  it('surfaces a toast when connect throws', async () => {
    connectMock.mockRejectedValue(new Error('USB exploded'))
    const { result } = renderHook(() => useDeviceConnection())
    let ok: boolean | undefined
    await act(async () => {
      ok = await result.current.connect()
    })
    expect(ok).toBe(false)
    expect(toastMock).toHaveBeenCalledTimes(1)
    expect(toastMock.mock.calls[0][0]).toMatchObject({
      description: 'USB exploded',
      variant: 'error'
    })
  })
})

describe('useDeviceConnection — disconnect action', () => {
  it('routes disconnect() to the device service', async () => {
    const { result } = renderHook(() => useDeviceConnection())
    await act(async () => {
      await result.current.disconnect()
    })
    expect(disconnectMock).toHaveBeenCalledTimes(1)
  })

  it('surfaces a toast when disconnect throws (toastErrors default)', async () => {
    disconnectMock.mockRejectedValue(new Error('nope'))
    const { result } = renderHook(() => useDeviceConnection())
    await act(async () => {
      await result.current.disconnect()
    })
    expect(toastMock).toHaveBeenCalledTimes(1)
    expect(toastMock.mock.calls[0][0]).toMatchObject({ variant: 'error' })
  })
})
