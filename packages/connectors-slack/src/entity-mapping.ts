/**
 * Entity mapping — turns Slack API objects into the connector-host's Layer-0
 * entity emissions (SourceItem / ExternalPerson / Enrichment / SourceContainer).
 *
 * Deterministic and LLM-free. A Slack channel becomes a living md capture:
 * each message is one markdown `message` artifact; each image attachment is one
 * `image` artifact fetched by URL. Threaded context is preserved via
 * `parentExternalId`. @mentions are mapped to Slack user ids (contact refs).
 */

import type { Enrichment, ExternalPerson, SourceContainer, SourceItem } from './contract.js'
import type { SlackChannel, SlackFile, SlackMessage, SlackUser } from './types.js'

/** Options shared by message-rendering helpers. */
export interface MappingContext {
  /** Connector instance id (for enrichment provenance). */
  connectorId: string
  /** Slack user id → best display name, for rendering `<@U…>` mentions. */
  userNames?: Map<string, string>
  /** Bearer token used to fetch `url_private` image bytes (host downloads). */
  fetchAuthorization?: string
}

/** Build the stable source_ref for a message artifact. */
export function messageRef(channelId: string, ts: string): string {
  return `${channelId}:${ts}`
}

/** Build the stable source_ref for an image/file artifact on a message. */
export function fileRef(channelId: string, ts: string, fileId: string): string {
  return `${channelId}:${ts}:file:${fileId}`
}

/** Slack message `ts` ("1700000000.123456") → ISO timestamp. */
export function tsToIso(ts: string): string {
  const seconds = Number.parseFloat(ts)
  if (!Number.isFinite(seconds)) return new Date(0).toISOString()
  return new Date(seconds * 1000).toISOString()
}

const MENTION_RE = /<@([A-Z0-9]+)(?:\|[^>]*)?>/g

/**
 * Extract the Slack user ids referenced by `<@U123>` / `<@U123|label>` mentions.
 * Returns unique ids in first-seen order.
 */
export function parseMentions(text: string | undefined): string[] {
  if (!text) return []
  const ids: string[] = []
  const seen = new Set<string>()
  for (const m of text.matchAll(MENTION_RE)) {
    const id = m[1]
    if (!seen.has(id)) {
      seen.add(id)
      ids.push(id)
    }
  }
  return ids
}

function decodeEntities(s: string): string {
  return s.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
}

/**
 * Convert Slack mrkdwn to readable markdown: resolve user mentions to names,
 * unwrap channel refs / special mentions / links, and decode HTML entities.
 * Falls back to `@U123` when a mention's name is unknown.
 */
export function renderText(text: string | undefined, userNames?: Map<string, string>): string {
  if (!text) return ''
  let out = text
    // User mentions: <@U123> or <@U123|label>
    .replace(/<@([A-Z0-9]+)(?:\|([^>]*))?>/g, (_full, id: string, label?: string) => {
      const name = userNames?.get(id) ?? label ?? id
      return `@${name}`
    })
    // Channel refs: <#C123|name> or <#C123>
    .replace(/<#([A-Z0-9]+)(?:\|([^>]*))?>/g, (_full, _id: string, name?: string) => `#${name ?? _id}`)
    // Subteam/user-group: <!subteam^S123|@group>
    .replace(/<!subteam\^[A-Z0-9]+(?:\|([^>]*))?>/g, (_full, label?: string) => label ?? '@group')
    // Special mentions: <!here>, <!channel>, <!everyone>, <!date...>
    .replace(/<!([a-z]+)(?:\^[^|>]+)?(?:\|([^>]*))?>/g, (_full, kw: string, label?: string) => label ?? `@${kw}`)
    // Links: <https://url|text> or <https://url>
    .replace(/<(https?:[^|>]+)(?:\|([^>]*))?>/g, (_full, url: string, label?: string) =>
      label ? `[${label}](${url})` : url
    )
  return decodeEntities(out)
}

const IMAGE_MIME_RE = /^image\//i

function isImageFile(f: SlackFile): boolean {
  if (f.mimetype && IMAGE_MIME_RE.test(f.mimetype)) return true
  return ['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'heic'].includes((f.filetype ?? '').toLowerCase())
}

/**
 * Map one Slack message to its artifact emissions: exactly one `message`
 * (markdown) item, plus one `image` item per image attachment.
 *
 * @param channelId  the container id (channel), for building refs
 * @param msg        the Slack message
 * @param ctx        mapping context (names, connector id, auth)
 * @param parentTs   thread parent ts when `msg` is a reply (sets parentExternalId)
 */
export function messageToSourceItems(
  channelId: string,
  msg: SlackMessage,
  ctx: MappingContext,
  parentTs?: string
): SourceItem[] {
  const items: SourceItem[] = []
  const createdAt = tsToIso(msg.ts)
  const mentions = parseMentions(msg.text)
  const parentExternalId =
    parentTs && parentTs !== msg.ts ? messageRef(channelId, parentTs) : undefined
  const author = msg.user ?? msg.bot_id

  const rendered = renderText(msg.text, ctx.userNames)
  const authorName = (author && ctx.userNames?.get(author)) || msg.username || author || 'unknown'
  // A message may be attachment-only (no text). Still emit a message item so the
  // thread/timeline stays intact and image items have a parent to point at.
  const markdown = rendered
    ? `**${authorName}:** ${rendered}`
    : `**${authorName}:** _(no text)_`

  items.push({
    externalId: messageRef(channelId, msg.ts),
    kind: 'message',
    mime: 'text/markdown',
    text: markdown,
    createdAt,
    authorExternalId: author,
    mentions: mentions.length ? mentions : undefined,
    parentExternalId,
    metadata: {
      channelId,
      ts: msg.ts,
      threadTs: msg.thread_ts,
      replyCount: msg.reply_count,
      subtype: msg.subtype,
      authorName
    }
  })

  for (const file of msg.files ?? []) {
    if (!isImageFile(file)) continue
    const downloadUrl = file.url_private_download ?? file.url_private
    if (!downloadUrl) continue
    items.push({
      externalId: fileRef(channelId, msg.ts, file.id),
      kind: 'image',
      mime: file.mimetype ?? 'application/octet-stream',
      title: file.title ?? file.name,
      url: downloadUrl,
      fetchAuthorization: ctx.fetchAuthorization,
      createdAt,
      authorExternalId: author,
      parentExternalId: messageRef(channelId, msg.ts),
      metadata: {
        channelId,
        ts: msg.ts,
        fileId: file.id,
        size: file.size,
        permalink: file.permalink
      }
    })
  }

  return items
}

/** Best human name for a Slack user. */
export function bestName(user: SlackUser): string {
  return (
    user.profile?.display_name ||
    user.real_name ||
    user.profile?.real_name ||
    user.name ||
    user.id
  )
}

/** Map a Slack user to an ExternalPerson (identity autocomplete / contact sync). */
export function userToExternalPerson(user: SlackUser): ExternalPerson {
  return {
    externalId: user.id,
    name: bestName(user),
    email: user.profile?.email,
    avatarUrl: user.profile?.image_512 ?? user.profile?.image_192 ?? user.profile?.image_72,
    title: user.profile?.title,
    metadata: {
      handle: user.name,
      isBot: user.is_bot ?? false,
      deleted: user.deleted ?? false,
      timezone: user.tz
    }
  }
}

/**
 * Map a Slack user to an Enrichment for a canonical contact.
 * Confidence is 1.0 when we matched by verified email (a connector-confirmed
 * identity per CONNECTORS.md), else 0.5 for a name-only association.
 */
export function userToEnrichment(connectorId: string, user: SlackUser, matchedByEmail: boolean): Enrichment {
  return {
    connectorId,
    externalId: user.id,
    fields: {
      role: user.profile?.title,
      avatarUrl: user.profile?.image_512 ?? user.profile?.image_192,
      phone: user.profile?.phone,
      timezone: user.tz
    },
    confidence: matchedByEmail ? 1.0 : 0.5
  }
}

/** Map a Slack channel to a SourceContainer. */
export function channelToSourceContainer(channel: SlackChannel): SourceContainer {
  return {
    externalId: channel.id,
    name: channel.name ?? channel.id,
    kind: channel.is_im ? 'dm' : channel.is_private ? 'private_channel' : 'channel',
    metadata: {
      isPrivate: channel.is_private ?? false,
      isMember: channel.is_member ?? false,
      isArchived: channel.is_archived ?? false,
      numMembers: channel.num_members,
      topic: channel.topic?.value,
      purpose: channel.purpose?.value
    }
  }
}
