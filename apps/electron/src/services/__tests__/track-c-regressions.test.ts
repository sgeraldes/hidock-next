// @vitest-environment node

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const root = resolve(__dirname, '../../..')

describe('Track C source invariants', () => {
  it('latches auto-sync before either listRecordings call', () => {
    const source = readFileSync(resolve(root, 'src/hooks/useDeviceSubscriptions.ts'), 'utf8')
    const calls = [...source.matchAll(/recordings = await deviceService\.listRecordings\(\)/g)]

    expect(calls).toHaveLength(2)
    for (const call of calls) {
      const precedingBlock = source.slice(Math.max(0, call.index! - 800), call.index)
      expect(precedingBlock).toContain('autoSyncTriggeredRef.current = true')
    }
  })

  it('does not emit ready from listRecordings cleanup', () => {
    const source = readFileSync(resolve(root, 'src/services/hidock-device.ts'), 'utf8')
    const listStart = source.indexOf('async listRecordings(')
    const listEnd = source.indexOf('async deleteRecording(', listStart)
    const listMethod = source.slice(listStart, listEnd)
    const cleanup = listMethod.slice(listMethod.lastIndexOf('finally {'))

    expect(cleanup).not.toContain("updateStatus('ready'")
  })

  it('keeps the already-removed step1Success variable absent', () => {
    const source = readFileSync(resolve(root, 'src/services/hidock-device.ts'), 'utf8')
    expect(source).not.toContain('step1Success')
  })
})
