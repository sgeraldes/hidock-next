import { describe, it, expect, vi, beforeEach } from 'vitest'
import { registerTurnSpeakersHandlers } from '../turn-speakers-handlers'
import { ipcMain } from 'electron'

vi.mock('electron', () => ({
  ipcMain: {
    handle: vi.fn()
  }
}))

vi.mock('../../services/database', () => ({
  getTurnOverrides: vi.fn(),
  setTurnOverride: vi.fn(),
  clearTurnOverride: vi.fn(),
  getSpeakerSplits: vi.fn(),
  splitSpeakerFrom: vi.fn(),
  mergeSpeakerSplit: vi.fn(),
  assignSpeakerFromHere: vi.fn(),
  queryAll: vi.fn()
}))

const CONTACT_UUID = '11111111-1111-4111-8111-111111111111'

function handlerFor(channel: string) {
  return vi.mocked(ipcMain.handle).mock.calls.find((call) => call[0] === channel)?.[1]
}

describe('Turn-speakers IPC handlers', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('registers all turn-speaker channels', () => {
    registerTurnSpeakersHandlers()
    for (const ch of [
      'turn-speakers:getOverrides',
      'turn-speakers:setOverride',
      'turn-speakers:clearOverride',
      'turn-speakers:getSplits',
      'turn-speakers:split',
      'turn-speakers:mergeSplit',
      'turn-speakers:assignFromHere',
      'turn-speakers:getMergeHints'
    ]) {
      expect(ipcMain.handle).toHaveBeenCalledWith(ch, expect.any(Function))
    }
  })

  it('setOverride delegates with turnIndex + contactId', async () => {
    const { setTurnOverride } = await import('../../services/database')
    vi.mocked(setTurnOverride).mockReturnValue({ id: CONTACT_UUID, name: 'Sebastian' } as any)

    registerTurnSpeakersHandlers()
    const result = (await handlerFor('turn-speakers:setOverride')?.({} as any, {
      recordingId: 'rec-1',
      turnIndex: 3,
      contactId: CONTACT_UUID
    })) as any

    expect(result.success).toBe(true)
    expect(result.data.name).toBe('Sebastian')
    expect(setTurnOverride).toHaveBeenCalledWith('rec-1', 3, { contactId: CONTACT_UUID, newName: undefined })
  })

  it('setOverride rejects when neither contactId nor newName is given', async () => {
    registerTurnSpeakersHandlers()
    const result = (await handlerFor('turn-speakers:setOverride')?.({} as any, {
      recordingId: 'rec-1',
      turnIndex: 3
    })) as any
    expect(result.success).toBe(false)
    expect(result.error.code).toBe('VALIDATION_ERROR')
  })

  it('split delegates and returns the derived label', async () => {
    const { splitSpeakerFrom } = await import('../../services/database')
    vi.mocked(splitSpeakerFrom).mockReturnValue('Speaker 1 · B')

    registerTurnSpeakersHandlers()
    const result = (await handlerFor('turn-speakers:split')?.({} as any, {
      recordingId: 'rec-1',
      baseLabel: 'Speaker 1',
      fromTurnIndex: 2
    })) as any

    expect(result.success).toBe(true)
    expect(result.data.derivedLabel).toBe('Speaker 1 · B')
    expect(splitSpeakerFrom).toHaveBeenCalledWith('rec-1', 'Speaker 1', 2)
  })

  it('mergeSplit delegates', async () => {
    const { mergeSpeakerSplit } = await import('../../services/database')
    registerTurnSpeakersHandlers()
    const result = (await handlerFor('turn-speakers:mergeSplit')?.({} as any, {
      recordingId: 'rec-1',
      baseLabel: 'Speaker 1',
      fromTurnIndex: 2
    })) as any
    expect(result.success).toBe(true)
    expect(mergeSpeakerSplit).toHaveBeenCalledWith('rec-1', 'Speaker 1', 2)
  })

  it('assignFromHere delegates split+bind and returns derived label + contact', async () => {
    const { assignSpeakerFromHere } = await import('../../services/database')
    vi.mocked(assignSpeakerFromHere).mockReturnValue({
      derivedLabel: 'Speaker 1 · B',
      contact: { id: CONTACT_UUID, name: 'Sebastian' } as any
    })

    registerTurnSpeakersHandlers()
    const result = (await handlerFor('turn-speakers:assignFromHere')?.({} as any, {
      recordingId: 'rec-1',
      baseLabel: 'Speaker 1',
      fromTurnIndex: 5,
      contactId: CONTACT_UUID
    })) as any

    expect(result.success).toBe(true)
    expect(result.data.derivedLabel).toBe('Speaker 1 · B')
    expect(result.data.contact.name).toBe('Sebastian')
    expect(assignSpeakerFromHere).toHaveBeenCalledWith('rec-1', 'Speaker 1', 5, {
      contactId: CONTACT_UUID,
      newName: undefined
    })
  })

  it('getMergeHints reads the config markers scoped to the recording', async () => {
    const { queryAll } = await import('../../services/database')
    // One valid marker + one malformed value that must be skipped.
    vi.mocked(queryAll).mockReturnValue([
      { value: JSON.stringify({ recordingId: 'rec-1', label: 'Speaker 1', names: ['Memo', 'Sebastian'] }) },
      { value: 'not-json' }
    ] as any)

    registerTurnSpeakersHandlers()
    const result = (await handlerFor('turn-speakers:getMergeHints')?.({} as any, { recordingId: 'rec-1' })) as any

    expect(result.success).toBe(true)
    expect(result.data).toEqual([{ label: 'Speaker 1', names: ['Memo', 'Sebastian'] }])
    // Query is scoped to this recording's marker prefix.
    expect(queryAll).toHaveBeenCalledWith('SELECT value FROM config WHERE key LIKE ?', [
      'self_id:merge_suspected:rec-1:%'
    ])
  })
})
