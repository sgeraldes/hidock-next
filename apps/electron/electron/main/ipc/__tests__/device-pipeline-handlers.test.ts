// @vitest-environment node

/**
 * Unit tests for DevicePipeline IPC handlers (Slice 4).
 *
 * MOCK-ONLY — no real USB, no Electron. ipcMain + BrowserWindow are mocked, and
 * a hand-rolled DevicePipelineService stand-in (an EventEmitter with the action
 * methods + getState/getFiles) is injected.
 *
 * Verifies:
 *  - All 8 `device-pipeline:` channels are registered.
 *  - get-state / get-files read straight from the injected pipeline.
 *  - Each action channel delegates to the matching pipeline method.
 *  - delete-file forwards the filename (object or string arg) and rejects empties.
 *  - The 'state' / 'files' EventEmitter events bridge to webContents.send via the
 *    broadcast window.
 *  - Action handlers swallow throws to null/false (never reject the renderer).
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { EventEmitter } from 'events'

// ---------------------------------------------------------------------------
// Shared registries — populated by vi.mock factories at module load time
// ---------------------------------------------------------------------------

const mockHandlers: Record<string, (event: any, args?: any) => any> = {}
const broadcastSendCalls: Array<[string, any]> = []
const broadcastWindowState = { destroyed: false }

vi.mock('electron', () => ({
  ipcMain: {
    handle: (channel: string, fn: (event: any, args?: any) => any) => {
      mockHandlers[channel] = fn
    },
  },
  BrowserWindow: {
    getAllWindows: () => [
      {
        webContents: {
          isDestroyed: () => broadcastWindowState.destroyed,
          send: (channel: string, payload: any) => {
            broadcastSendCalls.push([channel, payload])
          },
        },
      },
    ],
  },
}))

// Prevent the real getDevicePipelineService() default (which lazy-requires
// jensen/usb/etc.) from ever loading — we always inject our own instance.
vi.mock('../../services/device-pipeline', () => ({
  getDevicePipelineService: () => {
    throw new Error('default singleton should not be used in tests')
  },
}))

import {
  registerDevicePipelineHandlers,
  __resetDevicePipelineBridgeForTests,
} from '../device-pipeline-handlers'

// ---------------------------------------------------------------------------
// Pipeline stand-in: an EventEmitter with the action surface + state accessors
// ---------------------------------------------------------------------------

function makePipeline() {
  const emitter = new EventEmitter() as any
  emitter.getState = vi.fn().mockReturnValue({
    phase: 'idle',
    device: null,
    scanProgress: null,
    downloadProgress: null,
    error: null,
  })
  emitter.getFiles = vi.fn().mockReturnValue([{ name: 'a.hda' }])
  emitter.connect = vi.fn().mockResolvedValue(true)
  emitter.disconnect = vi.fn().mockResolvedValue(undefined)
  emitter.manualSync = vi.fn().mockResolvedValue(undefined)
  emitter.cancelDownloads = vi.fn().mockResolvedValue(undefined)
  emitter.deleteFile = vi.fn().mockResolvedValue({ result: 'success' })
  emitter.formatDevice = vi.fn().mockResolvedValue({ result: 'success' })
  return emitter
}

const EXPECTED_CHANNELS = [
  'device-pipeline:get-state',
  'device-pipeline:get-files',
  'device-pipeline:connect',
  'device-pipeline:disconnect',
  'device-pipeline:sync',
  'device-pipeline:cancel',
  'device-pipeline:delete-file',
  'device-pipeline:format',
]

describe('registerDevicePipelineHandlers', () => {
  let pipeline: any

  beforeEach(() => {
    vi.clearAllMocks()
    broadcastSendCalls.length = 0
    broadcastWindowState.destroyed = false
    Object.keys(mockHandlers).forEach((k) => delete mockHandlers[k])
    __resetDevicePipelineBridgeForTests()
    pipeline = makePipeline()
    registerDevicePipelineHandlers(pipeline)
  })

  // -------------------------------------------------------------------------
  // Channel registration
  // -------------------------------------------------------------------------

  it('registers all 8 device-pipeline channels', () => {
    expect(EXPECTED_CHANNELS).toHaveLength(8)
    for (const channel of EXPECTED_CHANNELS) {
      expect(mockHandlers[channel], `Missing handler for ${channel}`).toBeDefined()
    }
  })

  // -------------------------------------------------------------------------
  // State projection
  // -------------------------------------------------------------------------

  it('get-state returns pipeline.getState()', async () => {
    const result = await mockHandlers['device-pipeline:get-state']({})
    expect(pipeline.getState).toHaveBeenCalledTimes(1)
    expect(result).toMatchObject({ phase: 'idle' })
  })

  it('get-files returns pipeline.getFiles()', async () => {
    const result = await mockHandlers['device-pipeline:get-files']({})
    expect(pipeline.getFiles).toHaveBeenCalledTimes(1)
    expect(result).toEqual([{ name: 'a.hda' }])
  })

  // -------------------------------------------------------------------------
  // Action delegation
  // -------------------------------------------------------------------------

  it('connect delegates to pipeline.connect()', async () => {
    const result = await mockHandlers['device-pipeline:connect']({})
    expect(pipeline.connect).toHaveBeenCalledTimes(1)
    expect(result).toBe(true)
  })

  it('disconnect delegates to pipeline.disconnect() and returns null', async () => {
    const result = await mockHandlers['device-pipeline:disconnect']({})
    expect(pipeline.disconnect).toHaveBeenCalledTimes(1)
    expect(result).toBeNull()
  })

  it('sync delegates to pipeline.manualSync()', async () => {
    const result = await mockHandlers['device-pipeline:sync']({})
    expect(pipeline.manualSync).toHaveBeenCalledTimes(1)
    expect(result).toBeNull()
  })

  it('cancel delegates to pipeline.cancelDownloads()', async () => {
    const result = await mockHandlers['device-pipeline:cancel']({})
    expect(pipeline.cancelDownloads).toHaveBeenCalledTimes(1)
    expect(result).toBeNull()
  })

  it('delete-file forwards filename from object arg', async () => {
    const result = await mockHandlers['device-pipeline:delete-file']({}, { filename: 'rec.hda' })
    expect(pipeline.deleteFile).toHaveBeenCalledWith('rec.hda')
    expect(result).toEqual({ result: 'success' })
  })

  it('delete-file forwards filename from string arg', async () => {
    await mockHandlers['device-pipeline:delete-file']({}, 'rec2.hda')
    expect(pipeline.deleteFile).toHaveBeenCalledWith('rec2.hda')
  })

  it('delete-file rejects empty/missing filename', async () => {
    const result = await mockHandlers['device-pipeline:delete-file']({}, {})
    expect(result).toBeNull()
    expect(pipeline.deleteFile).not.toHaveBeenCalled()
  })

  it('format delegates to pipeline.formatDevice()', async () => {
    const result = await mockHandlers['device-pipeline:format']({})
    expect(pipeline.formatDevice).toHaveBeenCalledTimes(1)
    expect(result).toEqual({ result: 'success' })
  })

  // -------------------------------------------------------------------------
  // EventEmitter → renderer bridge
  // -------------------------------------------------------------------------

  it('bridges the pipeline "state" event to device-pipeline:state broadcast', () => {
    const state = { phase: 'scanning', device: null, scanProgress: { current: 1, total: 3 }, downloadProgress: null, error: null }
    pipeline.emit('state', state)
    const sent = broadcastSendCalls.find(([c]) => c === 'device-pipeline:state')
    expect(sent).toBeDefined()
    expect(sent?.[1]).toEqual(state)
  })

  it('bridges the pipeline "files" event to device-pipeline:files broadcast', () => {
    const files = [{ name: 'x.hda' }, { name: 'y.hda' }]
    pipeline.emit('files', files)
    const sent = broadcastSendCalls.find(([c]) => c === 'device-pipeline:files')
    expect(sent).toBeDefined()
    expect(sent?.[1]).toEqual(files)
  })

  it('does not broadcast when the window is destroyed', () => {
    broadcastWindowState.destroyed = true
    pipeline.emit('state', { phase: 'idle' })
    expect(broadcastSendCalls).toHaveLength(0)
  })

  it('does not duplicate broadcasts when re-registered with the same pipeline', () => {
    // Re-register without resetting the bridge guard — must not double-bind.
    registerDevicePipelineHandlers(pipeline)
    pipeline.emit('state', { phase: 'idle' })
    const stateBroadcasts = broadcastSendCalls.filter(([c]) => c === 'device-pipeline:state')
    expect(stateBroadcasts).toHaveLength(1)
  })

  // -------------------------------------------------------------------------
  // Error handling — handlers never reject
  // -------------------------------------------------------------------------

  it('connect returns false when pipeline.connect throws', async () => {
    pipeline.connect.mockRejectedValue(new Error('boom'))
    const result = await mockHandlers['device-pipeline:connect']({})
    expect(result).toBe(false)
  })

  it('format returns null when pipeline.formatDevice throws', async () => {
    pipeline.formatDevice.mockRejectedValue(new Error('boom'))
    const result = await mockHandlers['device-pipeline:format']({})
    expect(result).toBeNull()
  })
})
