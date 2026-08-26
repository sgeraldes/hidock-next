import { describe, expect, it, vi } from 'vitest'
import { checkSpeakerModelAccess } from '../speaker-model-access'

function response(status: number, body?: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: vi.fn().mockResolvedValue(body)
  } as unknown as Response
}

describe('checkSpeakerModelAccess', () => {
  it('does not call the network without a token', async () => {
    const fetchImpl = vi.fn()

    await expect(checkSpeakerModelAccess('  ', fetchImpl as typeof fetch)).resolves.toMatchObject({
      status: 'token-missing'
    })
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it('distinguishes an invalid token from unaccepted model conditions', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(response(401))

    await expect(checkSpeakerModelAccess('hf_invalid', fetchImpl as typeof fetch)).resolves.toMatchObject({
      status: 'invalid-token'
    })
    expect(fetchImpl).toHaveBeenCalledTimes(1)
  })

  it('reports pending conditions for a valid account without model access', async () => {
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(response(200, { name: 'sebastian' }))
      .mockResolvedValueOnce(response(403))

    await expect(checkSpeakerModelAccess('hf_valid', fetchImpl as typeof fetch)).resolves.toMatchObject({
      status: 'terms-pending',
      account: 'sebastian'
    })
  })

  it('reports Community-1 as ready only when its gated file is readable', async () => {
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(response(200, { name: 'sebastian' }))
      .mockResolvedValueOnce(response(200))

    await expect(checkSpeakerModelAccess('hf_valid', fetchImpl as typeof fetch)).resolves.toMatchObject({
      status: 'granted',
      model: 'pyannote/speaker-diarization-community-1',
      fallbackModel: 'pyannote/speaker-diarization-3.1',
      account: 'sebastian'
    })
  })

  it('returns a recoverable unavailable state on network failure', async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new Error('offline'))

    await expect(checkSpeakerModelAccess('hf_valid', fetchImpl as typeof fetch)).resolves.toMatchObject({
      status: 'unavailable',
      message: expect.stringContaining('offline')
    })
  })
})
