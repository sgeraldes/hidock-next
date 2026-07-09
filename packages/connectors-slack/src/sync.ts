/**
 * Channel sync — the LLM-free delta loop.
 *
 * Pulls messages newer than a per-channel cursor (a Slack `ts`), preserves
 * threaded context by fetching replies for thread parents seen in the window,
 * maps everything to SourceItems, and returns the advanced cursor plus incidental
 * graph signals (author → channel edges).
 *
 * Cursor semantics: the cursor is the newest message `ts` emitted so far. The
 * next pull passes it as `oldest` with `inclusive=false`, so already-seen
 * messages are never re-emitted (incremental, idempotent).
 *
 * Known limitation (documented, not a bug): a brand-new reply on a thread whose
 * parent is OLDER than the cursor is not surfaced, because `conversations.history`
 * only returns top-level channel activity after `oldest`. Threads active within
 * the pulled window ARE fully synced. A thread registry (host-persisted) can lift
 * this later without changing this contract.
 */

import type { GraphSignal, PullResult, SourceItem } from './contract.js'
import { messageToSourceItems, type MappingContext } from './entity-mapping.js'
import type { SlackClient } from './slack-client.js'
import type { SlackMessage } from './types.js'

/** Compare two Slack `ts` strings numerically (seconds, then microseconds). */
export function compareTs(a: string, b: string): number {
  const [as, af = '0'] = a.split('.')
  const [bs, bf = '0'] = b.split('.')
  const ai = Number.parseInt(as, 10)
  const bi = Number.parseInt(bs, 10)
  if (ai !== bi) return ai - bi
  // Pad fractional parts so lexical compare matches numeric compare.
  return af.padEnd(6, '0').localeCompare(bf.padEnd(6, '0'))
}

/** Return the later of two Slack `ts` values (either may be undefined). */
export function maxTs(a: string | undefined, b: string | undefined): string | undefined {
  if (!a) return b
  if (!b) return a
  return compareTs(a, b) >= 0 ? a : b
}

export interface SyncChannelOptions {
  /** Page size for history/replies. Default 200 (Slack max is 999/1000). */
  pageSize?: number
  /** Safety cap on messages pulled per sync (avoids unbounded first sync). */
  maxMessages?: number
}

/**
 * Sync one channel since `cursor`. Returns new SourceItems (messages + images),
 * the advanced cursor, and author→channel signals.
 */
export async function syncChannel(
  client: SlackClient,
  channelId: string,
  ctx: MappingContext,
  cursor?: string,
  opts: SyncChannelOptions = {}
): Promise<PullResult> {
  const pageSize = opts.pageSize ?? 200
  const maxMessages = opts.maxMessages ?? 5000

  const topLevel: SlackMessage[] = []
  let pageCursor: string | undefined
  // Page through history newest→oldest until exhausted or the cap is hit.
  for (let i = 0; i < 10_000; i++) {
    const page = await client.conversationsHistory({
      channel: channelId,
      oldest: cursor,
      inclusive: false,
      limit: pageSize,
      cursor: pageCursor
    })
    for (const m of page.messages ?? []) topLevel.push(m)
    if (topLevel.length >= maxMessages) break
    const next = page.response_metadata?.next_cursor
    if (!next) break
    pageCursor = next
  }

  const items: SourceItem[] = []
  let newCursor = cursor
  const authorsInChannel = new Set<string>()

  const recordAuthor = (m: SlackMessage) => {
    const a = m.user ?? m.bot_id
    if (a) authorsInChannel.add(a)
  }

  for (const msg of topLevel) {
    const mapped = messageToSourceItems(channelId, msg, ctx)
    items.push(...mapped)
    newCursor = maxTs(newCursor, msg.ts)
    recordAuthor(msg)

    // Thread parent within this window → pull its (new) replies for context.
    const isThreadParent = (msg.reply_count ?? 0) > 0 && (!msg.thread_ts || msg.thread_ts === msg.ts)
    if (isThreadParent) {
      const replies = await client.conversationsReplies({
        channel: channelId,
        ts: msg.ts,
        oldest: cursor,
        limit: pageSize
      })
      for (const reply of replies) {
        items.push(...messageToSourceItems(channelId, reply, ctx, msg.ts))
        newCursor = maxTs(newCursor, reply.ts)
        recordAuthor(reply)
      }
    }
  }

  const at = new Date().toISOString()
  const signals: GraphSignal[] = [...authorsInChannel].map((personExternalId) => ({
    connectorId: ctx.connectorId,
    type: 'person-channel',
    data: { personExternalId, channelExternalId: channelId },
    at
  }))

  return { items, cursor: newCursor, signals }
}
