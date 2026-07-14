import { describe, it, expect, vi, beforeEach } from 'vitest'
import { registerTranscriptsHandlers } from '../transcripts-handlers'
import { ipcMain } from 'electron'

vi.mock('electron', () => ({
  ipcMain: {
    handle: vi.fn()
  }
}))

vi.mock('../../services/database', () => ({
  assignSpeaker: vi.fn(),
  getSpeakerMap: vi.fn(),
  unassignSpeaker: vi.fn()
}))

function handlerFor(channel: string) {
  return vi.mocked(ipcMain.handle).mock.calls.find((call) => call[0] === channel)?.[1]
}

describe('Transcripts IPC Handlers', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('registers all speaker channels', () => {
    registerTranscriptsHandlers()
    expect(ipcMain.handle).toHaveBeenCalledWith('transcripts:assignSpeaker', expect.any(Function))
    expect(ipcMain.handle).toHaveBeenCalledWith('transcripts:getSpeakerMap', expect.any(Function))
    expect(ipcMain.handle).toHaveBeenCalledWith('transcripts:unassignSpeaker', expect.any(Function))
  })

  it('assignSpeaker delegates with newName and returns the contact', async () => {
    const { assignSpeaker } = await import('../../services/database')
    vi.mocked(assignSpeaker).mockReturnValue({ id: 'c1', name: 'Alice' } as any)

    registerTranscriptsHandlers()
    const result = (await handlerFor('transcripts:assignSpeaker')?.({} as any, {
      recordingId: 'rec-1',
      speakerLabel: 'Speaker 1',
      newName: 'Alice'
    })) as any

    expect(result.success).toBe(true)
    expect(result.data.name).toBe('Alice')
    expect(assignSpeaker).toHaveBeenCalledWith('rec-1', 'Speaker 1', { contactId: undefined, newName: 'Alice' })
  })

  it('assignSpeaker rejects when neither contactId nor newName is given', async () => {
    registerTranscriptsHandlers()
    const result = (await handlerFor('transcripts:assignSpeaker')?.({} as any, {
      recordingId: 'rec-1',
      speakerLabel: 'Speaker 1'
    })) as any

    expect(result.success).toBe(false)
    expect(result.error.code).toBe('VALIDATION_ERROR')
  })

  it('getSpeakerMap returns rows', async () => {
    const { getSpeakerMap } = await import('../../services/database')
    vi.mocked(getSpeakerMap).mockReturnValue([{ speaker_label: 'Speaker 1', contact_id: 'c1', name: 'Alice' }] as any)

    registerTranscriptsHandlers()
    const result = (await handlerFor('transcripts:getSpeakerMap')?.({} as any, { recordingId: 'rec-1' })) as any

    expect(result.success).toBe(true)
    expect(result.data).toHaveLength(1)
    expect(getSpeakerMap).toHaveBeenCalledWith('rec-1')
  })

  it('unassignSpeaker delegates', async () => {
    const { unassignSpeaker } = await import('../../services/database')

    registerTranscriptsHandlers()
    const result = (await handlerFor('transcripts:unassignSpeaker')?.({} as any, {
      recordingId: 'rec-1',
      speakerLabel: 'Speaker 1'
    })) as any

    expect(result.success).toBe(true)
    expect(unassignSpeaker).toHaveBeenCalledWith('rec-1', 'Speaker 1')
  })
})
