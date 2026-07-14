/**
 * Slack Web API response shapes (only the fields this connector uses) plus the
 * connector's own configuration and dependency-injection surface.
 *
 * Reference: https://api.slack.com/methods
 */

/** Injectable dependencies — lets tests supply a mock `fetch`/`sleep`. */
export interface SlackClientDeps {
  /** HTTP transport. Defaults to the global `fetch` (Node 18+). */
  fetchFn?: typeof fetch
  /** Delay used by 429 backoff. Injectable so tests don't actually wait. */
  sleep?: (ms: number) => Promise<void>
  /** Max attempts per request when rate-limited (429). Default 5. */
  maxRetries?: number
  /** Base URL for the Slack Web API. Default https://slack.com/api. */
  baseUrl?: string
}

export interface SlackConnectorConfig {
  /**
   * Slack token. Bot token (`xoxb-…`) or user token (`xoxp-…`). NEVER stored in
   * the DB — the host keeps it in the OS keychain / config service and passes
   * it in here at construction (CONNECTORS.md §Data model).
   */
  token: string
  /**
   * Channel ids the user selected to sync. Empty = nothing syncs (the user must
   * explicitly opt channels in). See CONNECTORS.md sources capability.
   */
  channelAllowlist?: string[]
  /** Per-connector sync interval hint (ms). The host owns scheduling. */
  syncIntervalMs?: number
}

export interface SlackApiEnvelope {
  ok: boolean
  error?: string
  needed?: string
  provided?: string
  warning?: string
  response_metadata?: {
    next_cursor?: string
    messages?: string[]
  }
}

export interface SlackAuthTestResponse extends SlackApiEnvelope {
  url?: string
  team?: string
  user?: string
  team_id?: string
  user_id?: string
  bot_id?: string
}

export interface SlackChannel {
  id: string
  name?: string
  is_channel?: boolean
  is_group?: boolean
  is_im?: boolean
  is_private?: boolean
  is_archived?: boolean
  is_member?: boolean
  num_members?: number
  topic?: { value?: string }
  purpose?: { value?: string }
}

export interface SlackConversationsListResponse extends SlackApiEnvelope {
  channels?: SlackChannel[]
}

export interface SlackFile {
  id: string
  name?: string
  title?: string
  mimetype?: string
  filetype?: string
  size?: number
  /** Authenticated download URL (needs the bearer token in Authorization). */
  url_private?: string
  url_private_download?: string
  permalink?: string
}

export interface SlackMessage {
  type?: string
  subtype?: string
  user?: string
  bot_id?: string
  username?: string
  text?: string
  ts: string
  thread_ts?: string
  reply_count?: number
  files?: SlackFile[]
  /** True on the parent message when Slack echoes it in a replies fetch. */
  parent_user_id?: string
}

export interface SlackHistoryResponse extends SlackApiEnvelope {
  messages?: SlackMessage[]
  has_more?: boolean
}

export interface SlackRepliesResponse extends SlackApiEnvelope {
  messages?: SlackMessage[]
  has_more?: boolean
}

export interface SlackUserProfile {
  real_name?: string
  display_name?: string
  email?: string
  title?: string
  phone?: string
  image_192?: string
  image_512?: string
  image_72?: string
}

export interface SlackUser {
  id: string
  name?: string
  real_name?: string
  deleted?: boolean
  is_bot?: boolean
  tz?: string
  profile?: SlackUserProfile
}

export interface SlackUsersListResponse extends SlackApiEnvelope {
  members?: SlackUser[]
}

export interface SlackUsersInfoResponse extends SlackApiEnvelope {
  user?: SlackUser
}

export interface SlackPostMessageResponse extends SlackApiEnvelope {
  ts?: string
  channel?: string
}
