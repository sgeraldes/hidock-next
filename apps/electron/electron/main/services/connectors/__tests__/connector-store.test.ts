import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mkdtempSync, rmSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'

// safeStorage unavailable → plaintext fallback (matches config.ts behavior).
vi.mock('electron', () => ({
  app: { getPath: () => tmpdir() },
  safeStorage: { isEncryptionAvailable: () => false, encryptString: (s: string) => Buffer.from(s), decryptString: (b: Buffer) => b.toString() },
}))

import { ConnectorStore } from '../connector-store'

describe('ConnectorStore — multi-instance surface', () => {
  let dir: string
  let file: string

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'conn-store-'))
    file = join(dir, 'connectors.json')
  })
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  it('persists instance metadata and enumerates instance ids', () => {
    const store = new ConnectorStore(file)
    store.setInstanceMeta('m365', { type: 'm365', label: 'Microsoft 365' })
    store.setInstanceMeta('m365:abc', { type: 'm365', label: 'Personal (hotmail)' })
    expect(store.listInstanceIds().sort()).toEqual(['m365', 'm365:abc'])
    expect(store.getInstanceMeta('m365:abc')).toEqual({ type: 'm365', label: 'Personal (hotmail)' })
  })

  it('returns null metadata for legacy/unlabeled state', () => {
    const store = new ConnectorStore(file)
    store.setConfig('m365', { clientId: 'x' }) // config only, no meta
    expect(store.getInstanceMeta('m365')).toBeNull()
    expect(store.listInstanceIds()).toContain('m365')
  })

  it('namespaces config + secrets per instance and survives reload from disk', () => {
    const store = new ConnectorStore(file)
    store.setInstanceMeta('m365', { type: 'm365', label: 'Work' })
    store.setConfig('m365', { tenant: 'dfx5.com' })
    store.setSecret('m365', 'msalCache', 'work-token')
    store.setConfig('m365:p', { tenant: 'common' })
    store.setSecret('m365:p', 'msalCache', 'personal-token')

    const reopened = new ConnectorStore(file)
    expect(reopened.getConfig('m365').tenant).toBe('dfx5.com')
    expect(reopened.getSecret('m365', 'msalCache')).toBe('work-token')
    expect(reopened.getConfig('m365:p').tenant).toBe('common')
    expect(reopened.getSecret('m365:p', 'msalCache')).toBe('personal-token')
  })

  it('removeInstance purges the account state + secrets', () => {
    const store = new ConnectorStore(file)
    store.setInstanceMeta('m365:gone', { type: 'm365', label: 'Temp' })
    store.setSecret('m365:gone', 'msalCache', 'blob')
    store.removeInstance('m365:gone')
    expect(store.listInstanceIds()).not.toContain('m365:gone')
    expect(store.getInstanceMeta('m365:gone')).toBeNull()
    expect(store.hasSecret('m365:gone', 'msalCache')).toBe(false)
  })
})
