/**
 * value:startBackfill / value:cancelBackfill / value:getBackfillStatus IPC
 * tests (F16/spec-003 Part H). Mock-only, mirroring recording-handlers.test.ts:
 * capture the handler registered via ipcMain.handle and invoke it directly.
 * The service layer (value-backfill.ts) already guards concurrency/no-provider
 * internally — these tests verify input validation and pass-through wiring.
 *
 * @vitest-environment node
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { ipcMain } from 'electron'
import { registerValueBackfillHandlers } from '../value-backfill-handlers'

vi.mock('electron', () => ({
  ipcMain: { handle: vi.fn() }
}))

const startValueBackfillMock = vi.fn()
const cancelValueBackfillMock = vi.fn()
const getValueBackfillStatusMock = vi.fn()

vi.mock('../../services/value-backfill', () => ({
  startValueBackfill: (...args: unknown[]) => startValueBackfillMock(...args),
  cancelValueBackfill: (...args: unknown[]) => cancelValueBackfillMock(...args),
  getValueBackfillStatus: (...args: unknown[]) => getValueBackfillStatusMock(...args)
}))

function getHandler(channel: string): (...args: unknown[]) => Promise<unknown> {
  const call = (ipcMain.handle as any).mock.calls.find((c: unknown[]) => c[0] === channel)
  if (!call) throw new Error(`${channel} was not registered`)
  return call[1]
}

describe('value-backfill-handlers', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    registerValueBackfillHandlers()
  })

  it('registers all three channels', () => {
    expect(ipcMain.handle).toHaveBeenCalledWith('value:startBackfill', expect.any(Function))
    expect(ipcMain.handle).toHaveBeenCalledWith('value:cancelBackfill', expect.any(Function))
    expect(ipcMain.handle).toHaveBeenCalledWith('value:getBackfillStatus', expect.any(Function))
  })

  describe('value:startBackfill', () => {
    it('passes undefined through to the service when no request is given (service defaults order)', async () => {
      startValueBackfillMock.mockResolvedValue({ started: true, total: 5 })
      const handler = getHandler('value:startBackfill')

      const result = await handler(null, undefined)

      // z.object({...}).optional() lets a wholly-absent request pass through
      // as undefined rather than backfilling the inner default — the SERVICE
      // (startValueBackfill) applies its own `opts?.order ?? 'newest'` default.
      expect(startValueBackfillMock).toHaveBeenCalledWith(undefined)
      expect(result).toEqual({ success: true, started: true, reason: undefined })
    })

    it('defaults order to "newest" when an empty object is given', async () => {
      startValueBackfillMock.mockResolvedValue({ started: true, total: 5 })
      const handler = getHandler('value:startBackfill')

      await handler(null, {})

      expect(startValueBackfillMock).toHaveBeenCalledWith({ order: 'newest' })
    })

    it('accepts an explicit order', async () => {
      startValueBackfillMock.mockResolvedValue({ started: true, total: 3 })
      const handler = getHandler('value:startBackfill')

      await handler(null, { order: 'oldest' })

      expect(startValueBackfillMock).toHaveBeenCalledWith({ order: 'oldest' })
    })

    it('rejects an invalid order without throwing or calling the service', async () => {
      const handler = getHandler('value:startBackfill')

      const result = await handler(null, { order: 'bogus' })

      expect(result).toEqual({ success: false, error: expect.any(String) })
      expect(startValueBackfillMock).not.toHaveBeenCalled()
    })

    it('passes through a concurrent-start guard result', async () => {
      startValueBackfillMock.mockResolvedValue({ started: false, reason: 'already-running' })
      const handler = getHandler('value:startBackfill')

      const result = await handler(null, undefined)

      expect(result).toEqual({ success: true, started: false, reason: 'already-running' })
    })

    it('passes through a no-provider guard result', async () => {
      startValueBackfillMock.mockResolvedValue({ started: false, reason: 'no-provider' })
      const handler = getHandler('value:startBackfill')

      const result = await handler(null, undefined)

      expect(result).toEqual({ success: true, started: false, reason: 'no-provider' })
    })

    it('never throws across IPC on an unexpected service error', async () => {
      startValueBackfillMock.mockRejectedValue(new Error('boom'))
      const handler = getHandler('value:startBackfill')

      const result = await handler(null, undefined)

      expect(result).toEqual({ success: false, error: 'boom' })
    })
  })

  describe('value:cancelBackfill', () => {
    it('returns the cancelled flag', async () => {
      cancelValueBackfillMock.mockReturnValue({ cancelled: true })
      const handler = getHandler('value:cancelBackfill')

      const result = await handler(null)

      expect(result).toEqual({ success: true, cancelled: true })
    })

    it('returns cancelled:false when nothing was running', async () => {
      cancelValueBackfillMock.mockReturnValue({ cancelled: false })
      const handler = getHandler('value:cancelBackfill')

      const result = await handler(null)

      expect(result).toEqual({ success: true, cancelled: false })
    })
  })

  describe('value:getBackfillStatus', () => {
    it('wraps the status in { success, data }', async () => {
      const status = { running: false, total: 10, done: 3, marked: 1, failed: 0, remaining: 7 }
      getValueBackfillStatusMock.mockReturnValue(status)
      const handler = getHandler('value:getBackfillStatus')

      const result = await handler(null)

      expect(result).toEqual({ success: true, data: status })
    })

    it('never throws across IPC on an unexpected service error', async () => {
      getValueBackfillStatusMock.mockImplementation(() => {
        throw new Error('db unavailable')
      })
      const handler = getHandler('value:getBackfillStatus')

      const result = await handler(null)

      expect(result).toEqual({ success: false, error: 'db unavailable' })
    })
  })
})
