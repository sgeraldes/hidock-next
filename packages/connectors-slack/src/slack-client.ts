/**
 * Slack Web API client.
 *
 * Thin, deterministic HTTP wrapper — NO LLM, NO side effects beyond the network
 * calls it is told to make (CONNECTORS.md Layer 2: connectors are LLM-free).
 * Handles the two things every Slack sync must get right:
 *   1. Rate limiting — Slack returns HTTP 429 with a `Retry-After` header (and
 *      occasionally `ok:false, error:"ratelimited"`). We honor Retry-After and
 *      retry up to `maxRetries`, backing off via an injectable `sleep`.
 *   2. Cursor pagination — list endpoints return
 *      `response_metadata.next_cursor` (empty when exhausted).
 */

import type {
  SlackApiEnvelope,
  SlackAuthTestResponse,
  SlackChannel,
  SlackClientDeps,
  SlackConversationsListResponse,
  SlackHistoryResponse,
  SlackMessage,
  SlackPostMessageResponse,
  SlackRepliesResponse,
  SlackUser,
  SlackUsersInfoResponse,
  SlackUsersListResponse
} from './types.js'

const DEFAULT_BASE_URL = 'https://slack.com/api'
const DEFAULT_MAX_RETRIES = 5
/** Fallback wait (seconds) when a 429 arrives without a Retry-After header. */
const DEFAULT_RETRY_AFTER_SECONDS = 30
/** Safety cap so a hostile Retry-After can't wedge a sync for hours. */
const MAX_RETRY_AFTER_SECONDS = 300

export class SlackApiError extends Error {
  constructor(
    /** Slack `error` code (e.g. 'invalid_auth', 'channel_not_found'). */
    public readonly code: string,
    /** The API method that failed. */
    public readonly method: string,
    public readonly needed?: string
  ) {
    super(`Slack API "${method}" failed: ${code}`)
    this.name = 'SlackApiError'
  }
}

export class SlackRateLimitError extends Error {
  constructor(public readonly method: string, public readonly retryAfterSeconds: number) {
    super(`Slack API "${method}" rate limited after exhausting retries`)
    this.name = 'SlackRateLimitError'
  }
}

const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))

export interface HistoryParams {
  channel: string
  /** Only messages after this ts (exclusive when inclusive=false). */
  oldest?: string
  /** Only messages up to this ts. */
  latest?: string
  inclusive?: boolean
  limit?: number
  cursor?: string
}

export interface RepliesParams {
  channel: string
  /** Thread parent ts. */
  ts: string
  oldest?: string
  limit?: number
  cursor?: string
}

export class SlackClient {
  private readonly token: string
  private readonly baseUrl: string
  private readonly maxRetries: number
  private readonly fetchFn: typeof fetch
  private readonly sleep: (ms: number) => Promise<void>

  constructor(token: string, deps: SlackClientDeps = {}) {
    if (!token) throw new Error('SlackClient requires a token')
    this.token = token
    this.baseUrl = deps.baseUrl ?? DEFAULT_BASE_URL
    this.maxRetries = deps.maxRetries ?? DEFAULT_MAX_RETRIES
    const f = deps.fetchFn ?? (globalThis.fetch as typeof fetch | undefined)
    if (!f) throw new Error('SlackClient: no fetch available; pass deps.fetchFn')
    this.fetchFn = f
    this.sleep = deps.sleep ?? defaultSleep
  }

  /** Validate the token; resolves to the auth.test payload. */
  async authTest(): Promise<SlackAuthTestResponse> {
    return this.call<SlackAuthTestResponse>('auth.test', {})
  }

  /**
   * List channels the token can see. Paginates internally.
   * `types` defaults to public + private channels the bot is a member of.
   */
  async listChannels(
    opts: { types?: string; excludeArchived?: boolean; limit?: number } = {}
  ): Promise<SlackChannel[]> {
    const types = opts.types ?? 'public_channel,private_channel'
    const excludeArchived = opts.excludeArchived ?? true
    const limit = opts.limit ?? 200
    const out: SlackChannel[] = []
    await this.paginate<SlackConversationsListResponse>(
      'conversations.list',
      { types, exclude_archived: String(excludeArchived), limit: String(limit) },
      (page) => {
        if (page.channels) out.push(...page.channels)
      }
    )
    return out
  }

  /** One page of channel history (caller drives pagination via cursor). */
  async conversationsHistory(params: HistoryParams): Promise<SlackHistoryResponse> {
    const body: Record<string, string> = { channel: params.channel }
    if (params.oldest !== undefined) body.oldest = params.oldest
    if (params.latest !== undefined) body.latest = params.latest
    if (params.inclusive !== undefined) body.inclusive = String(params.inclusive)
    if (params.limit !== undefined) body.limit = String(params.limit)
    if (params.cursor) body.cursor = params.cursor
    return this.call<SlackHistoryResponse>('conversations.history', body)
  }

  /** All replies in a thread (paginates internally). Excludes the parent echo. */
  async conversationsReplies(params: RepliesParams): Promise<SlackMessage[]> {
    const out: SlackMessage[] = []
    const base: Record<string, string> = { channel: params.channel, ts: params.ts }
    if (params.oldest !== undefined) base.oldest = params.oldest
    if (params.limit !== undefined) base.limit = String(params.limit)
    await this.paginate<SlackRepliesResponse>('conversations.replies', base, (page) => {
      if (page.messages) out.push(...page.messages)
    })
    // Slack echoes the thread parent as the first element; drop it — the caller
    // already has the parent from conversations.history.
    return out.filter((m) => m.ts !== params.ts)
  }

  /** List all users (paginates internally). */
  async listUsers(opts: { limit?: number } = {}): Promise<SlackUser[]> {
    const limit = opts.limit ?? 200
    const out: SlackUser[] = []
    await this.paginate<SlackUsersListResponse>(
      'users.list',
      { limit: String(limit) },
      (page) => {
        if (page.members) out.push(...page.members)
      }
    )
    return out
  }

  /** Fetch a single user. */
  async usersInfo(user: string): Promise<SlackUser | undefined> {
    const res = await this.call<SlackUsersInfoResponse>('users.info', { user })
    return res.user
  }

  /** Post a message (optionally into a thread via `threadTs`). */
  async postMessage(channel: string, text: string, threadTs?: string): Promise<SlackPostMessageResponse> {
    const body: Record<string, string> = { channel, text }
    if (threadTs) body.thread_ts = threadTs
    return this.call<SlackPostMessageResponse>('chat.postMessage', body)
  }

  // --- internals -----------------------------------------------------------

  /** Walk `next_cursor` pagination, invoking `onPage` for each page. */
  private async paginate<T extends SlackApiEnvelope>(
    method: string,
    baseBody: Record<string, string>,
    onPage: (page: T) => void
  ): Promise<void> {
    let cursor: string | undefined
    // Bound the loop so a misbehaving server can't spin forever.
    for (let i = 0; i < 10_000; i++) {
      const body = cursor ? { ...baseBody, cursor } : baseBody
      const page = await this.call<T>(method, body)
      onPage(page)
      const next = page.response_metadata?.next_cursor
      if (!next) return
      cursor = next
    }
  }

  /**
   * Single Slack Web API call with 429 backoff. Slack accepts params as
   * application/x-www-form-urlencoded with the token in the Authorization
   * header. Throws {@link SlackApiError} on `ok:false` (non-rate-limit) and
   * {@link SlackRateLimitError} when retries are exhausted.
   */
  private async call<T extends SlackApiEnvelope>(method: string, params: Record<string, string>): Promise<T> {
    const url = `${this.baseUrl}/${method}`
    let lastRetryAfter = DEFAULT_RETRY_AFTER_SECONDS

    for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
      const res = await this.fetchFn(url, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.token}`,
          'Content-Type': 'application/x-www-form-urlencoded; charset=utf-8'
        },
        body: new URLSearchParams(params).toString()
      })

      if (res.status === 429) {
        lastRetryAfter = clampRetryAfter(parseRetryAfter(res.headers?.get?.('Retry-After')))
        if (attempt === this.maxRetries) break
        await this.sleep(lastRetryAfter * 1000)
        continue
      }

      const json = (await res.json()) as T
      if (json.ok) return json

      // Slack sometimes signals rate limiting in the body rather than status.
      if (json.error === 'ratelimited' || json.error === 'rate_limited') {
        lastRetryAfter = clampRetryAfter(parseRetryAfter(res.headers?.get?.('Retry-After')))
        if (attempt === this.maxRetries) break
        await this.sleep(lastRetryAfter * 1000)
        continue
      }

      throw new SlackApiError(json.error ?? 'unknown_error', method, json.needed)
    }

    throw new SlackRateLimitError(method, lastRetryAfter)
  }
}

function parseRetryAfter(header: string | null | undefined): number {
  if (!header) return DEFAULT_RETRY_AFTER_SECONDS
  const n = Number.parseInt(header, 10)
  return Number.isFinite(n) && n > 0 ? n : DEFAULT_RETRY_AFTER_SECONDS
}

function clampRetryAfter(seconds: number): number {
  return Math.min(Math.max(seconds, 1), MAX_RETRY_AFTER_SECONDS)
}
