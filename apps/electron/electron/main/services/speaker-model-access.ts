const COMMUNITY_MODEL = 'pyannote/speaker-diarization-community-1'
const FALLBACK_MODEL = 'pyannote/speaker-diarization-3.1'
const WHO_AM_I_URL = 'https://huggingface.co/api/whoami-v2'
const COMMUNITY_MODEL_CONFIG_URL =
  'https://huggingface.co/pyannote/speaker-diarization-community-1/resolve/main/config.yaml'

export type SpeakerModelAccessStatus =
  | 'granted'
  | 'token-missing'
  | 'invalid-token'
  | 'terms-pending'
  | 'unavailable'

export interface SpeakerModelAccessResult {
  status: SpeakerModelAccessStatus
  model: string
  fallbackModel: string
  account?: string
  message: string
}

type FetchLike = typeof fetch

function result(
  status: SpeakerModelAccessStatus,
  message: string,
  account?: string
): SpeakerModelAccessResult {
  return {
    status,
    model: COMMUNITY_MODEL,
    fallbackModel: FALLBACK_MODEL,
    ...(account ? { account } : {}),
    message
  }
}

async function fetchWithTimeout(
  fetchImpl: FetchLike,
  url: string,
  token: string,
  timeoutMs: number
): Promise<Response> {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), timeoutMs)
  try {
    return await fetchImpl(url, {
      headers: { Authorization: `Bearer ${token}` },
      redirect: 'follow',
      signal: controller.signal
    })
  } finally {
    clearTimeout(timeout)
  }
}

/**
 * Check the two independent Hugging Face requirements for Community-1:
 * a valid token, and acceptance of the model's contact-sharing conditions.
 * The token is sent only to fixed huggingface.co HTTPS endpoints.
 */
export async function checkSpeakerModelAccess(
  rawToken: string,
  fetchImpl: FetchLike = fetch,
  timeoutMs = 12_000
): Promise<SpeakerModelAccessResult> {
  const token = rawToken.trim()
  if (!token) {
    return result('token-missing', 'Add and save a Hugging Face token to use persistent speaker identification.')
  }

  try {
    const identityResponse = await fetchWithTimeout(fetchImpl, WHO_AM_I_URL, token, timeoutMs)
    if (identityResponse.status === 401 || identityResponse.status === 403) {
      return result('invalid-token', 'Hugging Face rejected this token. Create a new read token and save it here.')
    }
    if (!identityResponse.ok) {
      return result(
        'unavailable',
        `Hugging Face could not validate the token (HTTP ${identityResponse.status}). Try again.`
      )
    }

    let account: string | undefined
    try {
      const identity = (await identityResponse.json()) as { name?: unknown; fullname?: unknown }
      account = typeof identity.name === 'string'
        ? identity.name
        : typeof identity.fullname === 'string'
          ? identity.fullname
          : undefined
    } catch {
      // Identity is useful display context, but not required for access checks.
    }

    const modelResponse = await fetchWithTimeout(fetchImpl, COMMUNITY_MODEL_CONFIG_URL, token, timeoutMs)
    if (modelResponse.ok) {
      return result('granted', 'Community-1 is available to this token.', account)
    }
    if (modelResponse.status === 401 || modelResponse.status === 403) {
      return result(
        'terms-pending',
        'This token is valid, but its account has not granted access to Community-1. Review the model conditions, then check again.',
        account
      )
    }

    return result(
      'unavailable',
      `Community-1 access could not be checked (HTTP ${modelResponse.status}). The legacy model remains the fallback.`,
      account
    )
  } catch (error) {
    const timedOut = error instanceof Error && error.name === 'AbortError'
    return result(
      'unavailable',
      timedOut
        ? 'The Hugging Face access check timed out. Check your connection and try again.'
        : `The Hugging Face access check failed: ${error instanceof Error ? error.message : 'network error'}`
    )
  }
}

export const SPEAKER_MODEL_ACCESS_URL =
  'https://huggingface.co/pyannote/speaker-diarization-community-1'
