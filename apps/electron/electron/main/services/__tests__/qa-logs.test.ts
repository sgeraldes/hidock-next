/**
 * Main-process QA-logs gate (F15).
 *
 * Main cannot read the renderer's QA Logs toggle (no localStorage, no store), so
 * the renderer pushes it. These pin the two things that matter: nothing is
 * logged unless the toggle is on, and early-boot logs are still capturable via
 * the env override before the first push arrives.
 *
 * @vitest-environment node
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { isQaLogsEnabled, setQaLogsEnabled, qaLog, _resetQaLogsForTests } from '../qa-logs'

describe('qa-logs', () => {
  const originalEnv = process.env.HIDOCK_QA_LOGS

  beforeEach(() => {
    _resetQaLogsForTests()
    delete process.env.HIDOCK_QA_LOGS
  })

  afterEach(() => {
    _resetQaLogsForTests()
    if (originalEnv === undefined) delete process.env.HIDOCK_QA_LOGS
    else process.env.HIDOCK_QA_LOGS = originalEnv
    vi.restoreAllMocks()
  })

  it('is off by default — main must not spam the console before the renderer pushes', () => {
    expect(isQaLogsEnabled()).toBe(false)
  })

  it('honors HIDOCK_QA_LOGS=1 so boot logs are capturable before the first push', () => {
    process.env.HIDOCK_QA_LOGS = '1'
    expect(isQaLogsEnabled()).toBe(true)
  })

  it('a renderer push wins over the env fallback, in both directions', () => {
    process.env.HIDOCK_QA_LOGS = '1'
    setQaLogsEnabled(false)
    expect(isQaLogsEnabled()).toBe(false)

    delete process.env.HIDOCK_QA_LOGS
    setQaLogsEnabled(true)
    expect(isQaLogsEnabled()).toBe(true)
  })

  it('qaLog writes a [QA-MONITOR] line only while enabled', () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {})

    qaLog('should not appear')
    expect(log).not.toHaveBeenCalled()

    setQaLogsEnabled(true)
    qaLog('boot task ran', 42)
    expect(log).toHaveBeenCalledTimes(1)
    expect(log.mock.calls[0][0]).toBe('[QA-MONITOR] boot task ran')
    expect(log.mock.calls[0][1]).toBe(42)
  })
})
