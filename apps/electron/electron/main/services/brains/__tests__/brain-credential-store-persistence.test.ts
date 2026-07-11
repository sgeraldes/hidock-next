/**
 * BrainCredentialStore persistence robustness (H10 FIX).
 *
 * Verifies the two properties that make the Gemini-key sync self-healing:
 *   1. Atomic writes — persist goes through a temp file + rename, so an
 *      interrupted write can never corrupt/partially overwrite brains.json.
 *   2. Observable + rollback — setSecret returns false and rolls the in-memory
 *      change back when persistence fails, so getSecret keeps reporting the OLD
 *      value and the next save/boot re-attempts (no silent success).
 *
 * `fs` is mocked with an in-memory file table so we can observe exactly what
 * reached "disk" and force writeFileSync / renameSync to throw.
 *
 * @vitest-environment node
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { tmpdir } from 'os'

const { files, flags } = vi.hoisted(() => ({
  files: new Map<string, string>(),
  flags: { writeThrows: false, renameThrows: false },
}))

vi.mock('fs', () => ({
  existsSync: (p: string) => files.has(p),
  readFileSync: (p: string) => {
    if (!files.has(p)) throw new Error(`ENOENT: ${p}`)
    return files.get(p)!
  },
  mkdirSync: () => undefined,
  writeFileSync: (p: string, data: string) => {
    if (flags.writeThrows) throw new Error('EROFS: read-only file system')
    files.set(p, data)
  },
  renameSync: (from: string, to: string) => {
    if (flags.renameThrows) throw new Error('EPERM: rename failed')
    if (!files.has(from)) throw new Error(`ENOENT rename source: ${from}`)
    files.set(to, files.get(from)!)
    files.delete(from)
  },
}))

vi.mock('electron', () => ({
  app: { getPath: () => tmpdir() },
  safeStorage: { isEncryptionAvailable: () => false },
}))

import { BrainCredentialStore } from '../brain-credential-store'

const FILE = `${tmpdir()}/brains-persist-test.json`
const TMP = `${FILE}.tmp`

function freshStore(): BrainCredentialStore {
  const store = new BrainCredentialStore(FILE)
  store.load()
  return store
}

function storedKey(): string | undefined {
  const raw = files.get(FILE)
  if (!raw) return undefined
  return JSON.parse(raw)['gemini-api']?._secrets?.apiKey
}

describe('BrainCredentialStore persistence robustness', () => {
  beforeEach(() => {
    files.clear()
    flags.writeThrows = false
    flags.renameThrows = false
    vi.clearAllMocks()
  })

  it('setSecret returns true and the value reaches the real file on success', () => {
    const store = freshStore()
    expect(store.setSecret('gemini-api', 'apiKey', 'sk-1')).toBe(true)
    expect(storedKey()).toBe('sk-1')
    // Temp file is renamed away — no leftover on success.
    expect(files.has(TMP)).toBe(false)
  })

  it('writes atomically via temp file + rename (target never left partial)', () => {
    const store = freshStore()
    store.setSecret('gemini-api', 'apiKey', 'sk-good')

    // rename fails on the next write: the real target must keep its previous
    // good content, never a half-written blob.
    flags.renameThrows = true
    const ok = store.setSecret('gemini-api', 'apiKey', 'sk-bad')
    expect(ok).toBe(false)
    expect(storedKey()).toBe('sk-good')
  })

  it('surfaces a write failure (returns false) and rolls back in-memory state', () => {
    const store = freshStore()
    store.setSecret('gemini-api', 'apiKey', 'sk-good')

    flags.writeThrows = true
    const ok = store.setSecret('gemini-api', 'apiKey', 'sk-new')
    expect(ok).toBe(false)
    // In-memory rolled back → still reports the OLD value, so callers detect a
    // mismatch and re-attempt (rather than believing the write succeeded).
    expect(store.getSecret('gemini-api', 'apiKey')).toBe('sk-good')
    // Disk untouched too.
    expect(storedKey()).toBe('sk-good')
  })

  it('rolls back a failed deletion — old key stays authoritative until a real write', () => {
    const store = freshStore()
    store.setSecret('gemini-api', 'apiKey', 'sk-good')

    flags.writeThrows = true
    const ok = store.setSecret('gemini-api', 'apiKey', null) // attempt clear
    expect(ok).toBe(false)
    expect(store.getSecret('gemini-api', 'apiKey')).toBe('sk-good')
    expect(storedKey()).toBe('sk-good')

    // A subsequent successful clear actually removes it.
    flags.writeThrows = false
    expect(store.setSecret('gemini-api', 'apiKey', null)).toBe(true)
    expect(store.getSecret('gemini-api', 'apiKey')).toBeNull()
    expect(storedKey()).toBeUndefined()
  })
})
