/**
 * Test helpers: a scripted mock of the Slack Web API over `fetch`. No network.
 */

export interface MockResponseSpec {
  /** HTTP status. Default 200. */
  status?: number
  /** Parsed JSON body the endpoint returns. */
  body?: unknown
  /** Response headers (e.g. { 'Retry-After': '2' }). */
  headers?: Record<string, string>
}

export interface RecordedCall {
  method: string // Slack method, e.g. 'conversations.history'
  url: string
  authorization: string | null
  params: Record<string, string>
}

/**
 * Build a mock `fetch`. `handlers` maps a Slack method name to either a single
 * response or a queue of responses consumed in order (for pagination / retries).
 */
export function makeMockFetch(handlers: Record<string, MockResponseSpec | MockResponseSpec[]>): {
  fetchFn: typeof fetch
  calls: RecordedCall[]
} {
  const calls: RecordedCall[] = []
  const queues = new Map<string, MockResponseSpec[]>()
  for (const [k, v] of Object.entries(handlers)) queues.set(k, Array.isArray(v) ? [...v] : [v])

  const fetchFn = (async (url: string, init?: RequestInit) => {
    const method = String(url).split('/api/')[1] ?? String(url)
    const paramStr = typeof init?.body === 'string' ? init.body : ''
    const params: Record<string, string> = {}
    for (const [k, v] of new URLSearchParams(paramStr)) params[k] = v
    const auth =
      (init?.headers as Record<string, string> | undefined)?.Authorization ??
      (init?.headers as Record<string, string> | undefined)?.authorization ??
      null
    calls.push({ method, url: String(url), authorization: auth, params })

    const queue = queues.get(method)
    if (!queue || queue.length === 0) {
      throw new Error(`mock fetch: no scripted response for method "${method}"`)
    }
    const spec = queue.length === 1 ? queue[0] : queue.shift()!
    const status = spec.status ?? 200
    const headers = spec.headers ?? {}
    return {
      status,
      headers: { get: (name: string) => headers[name] ?? headers[name.toLowerCase()] ?? null },
      json: async () => spec.body
    } as unknown as Response
  }) as unknown as typeof fetch

  return { fetchFn, calls }
}

/** A sleep spy that records requested delays instead of waiting. */
export function makeSleepSpy(): { sleep: (ms: number) => Promise<void>; waits: number[] } {
  const waits: number[] = []
  return { sleep: async (ms: number) => void waits.push(ms), waits }
}
