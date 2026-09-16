// @vitest-environment node
import { mkdtempSync, writeFileSync, existsSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterEach, describe, expect, it, vi } from 'vitest'

const state = vi.hoisted(() => ({
  storage: { dataPath: '', recordingsPath: '', transcriptsPath: '', maxRecordingsGB: 10 },
  message: vi.fn(),
  picker: vi.fn(),
  save: vi.fn()
}))
vi.mock('electron', () => ({ dialog: { showMessageBox: state.message, showOpenDialog: state.picker } }))
vi.mock('../services/config', () => ({
  getConfig: () => ({ storage: state.storage }),
  getDataPath: () => state.storage.dataPath,
  updateConfig: state.save
}))
import { initializeStartupStorage } from '../storage-startup'
import { initializeFileStorage, StorageInitializationError } from '../services/file-storage'

const roots: string[] = []
function setup() {
  vi.resetAllMocks()
  const root = mkdtempSync(join(tmpdir(), 'hidock-storage-startup-'))
  roots.push(root)
  const blocked = join(root, 'not-a-directory')
  writeFileSync(blocked, 'existing file must survive')
  state.storage = { dataPath: blocked, recordingsPath: '', transcriptsPath: '', maxRecordingsGB: 10 }
  return { root, blocked, status: vi.fn(async () => {}) }
}
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

describe('storage startup recovery with real filesystem', () => {
  it('reports a file blocking the storage directory and permits quitting without saving', async () => {
    const { blocked, status } = setup()
    state.message.mockResolvedValue({ response: 2 })
    expect(await initializeStartupStorage(null, status)).toBe(false)
    expect(state.message.mock.calls[0][0].detail).toContain(blocked)
    expect(state.save).not.toHaveBeenCalled()
    expect(existsSync(blocked)).toBe(true)
  })

  it('validates the selected folder before persisting it and resumes startup', async () => {
    const { root, blocked, status } = setup()
    const chosen = join(root, 'library')
    state.message.mockResolvedValue({ response: 1 })
    state.picker.mockResolvedValue({ canceled: false, filePaths: [chosen] })
    state.save.mockImplementation(async (_section, storage) => {
      expect(existsSync(join(chosen, 'data'))).toBe(true)
      state.storage = storage
    })
    expect(await initializeStartupStorage(null, status)).toBe(true)
    expect(state.storage.dataPath).toBe(chosen)
    expect(existsSync(join(chosen, 'recordings'))).toBe(true)
    expect(existsSync(blocked)).toBe(true)
    expect(state.save).toHaveBeenCalledTimes(1)
  })

  it('keeps configuration unchanged when the picker is cancelled', async () => {
    const { status } = setup()
    state.message.mockResolvedValueOnce({ response: 1 }).mockResolvedValueOnce({ response: 2 })
    state.picker.mockResolvedValue({ canceled: true, filePaths: [] })
    expect(await initializeStartupStorage(null, status)).toBe(false)
    expect(state.save).not.toHaveBeenCalled()
  })

  it('retries the same location after the obstruction is removed', async () => {
    const { blocked, status } = setup()
    state.message.mockImplementation(async () => {
      rmSync(blocked)
      return { response: 0 }
    })
    expect(await initializeStartupStorage(null, status)).toBe(true)
    expect(existsSync(join(blocked, 'data'))).toBe(true)
    expect(state.save).not.toHaveBeenCalled()
  })

  it('identifies an unavailable recordings override separately from the data root', async () => {
    const { root, blocked } = setup()
    state.storage.dataPath = join(root, 'data-root')
    state.storage.recordingsPath = blocked
    await expect(initializeFileStorage()).rejects.toMatchObject({
      name: 'StorageInitializationError', setting: 'recordingsPath', directory: blocked
    })
  })

  it('surfaces a save failure instead of continuing with unpersisted settings', async () => {
    const { root, status } = setup()
    state.message.mockResolvedValue({ response: 1 })
    state.picker.mockResolvedValue({ canceled: false, filePaths: [join(root, 'valid')] })
    state.save.mockRejectedValue(new Error('config is read only'))
    await expect(initializeStartupStorage(null, status)).rejects.toThrow('config is read only')
  })

  it('wraps the OS error when a parent component is a file', async () => {
    const { blocked } = setup()
    state.storage.dataPath = join(blocked, 'missing')
    await expect(initializeFileStorage()).rejects.toBeInstanceOf(StorageInitializationError)
  })
})
