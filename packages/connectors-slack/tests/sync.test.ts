import { describe, expect, it, vi } from 'vitest'
import type { MappingContext } from '../src/entity-mapping.js'
import type { SlackClient } from '../src/slack-client.js'
import { compareTs, maxTs, syncChannel } from '../src/sync.js'
import type { SlackHistoryResponse, SlackMessage } from '../src/types.js'

const ctx: MappingContext = { connectorId: 'slack:abc', userNames: new Map([['U1', 'Alice'], ['U2', 'Bob']]) }

describe('ts comparison', () => {
  it('compares numerically across seconds and microseconds', () => {
    expect(compareTs('100.000001', '100.000002')).toBeLessThan(0)
    expect(compareTs('101.000000', '100.999999')).toBeGreaterThan(0)
    expect(compareTs('100.000100', '100.000100')).toBe(0)
  })
  it('maxTs picks the later value, tolerating undefined', () => {
    expect(maxTs(undefined, '100.0')).toBe('100.0')
    expect(maxTs('100.0', undefined)).toBe('100.0')
    expect(maxTs('100.0', '101.0')).toBe('101.0')
  })
})

/** Build a fake SlackClient with scripted history pages + replies. */
function fakeClient(opts: {
  historyPages: SlackHistoryResponse[]
  replies?: Record<string, SlackMessage[]>
}): { client: SlackClient; historyCalls: any[]; replyCalls: any[] } {
  const pages = [...opts.historyPages]
  const historyCalls: any[] = []
  const replyCalls: any[] = []
  const client = {
    conversationsHistory: vi.fn(async (params: any) => {
      historyCalls.push(params)
      return pages.shift() ?? { ok: true, messages: [] }
    }),
    conversationsReplies: vi.fn(async (params: any) => {
      replyCalls.push(params)
      return opts.replies?.[params.ts] ?? []
    })
  } as unknown as SlackClient
  return { client, historyCalls, replyCalls }
}

describe('syncChannel incremental', () => {
  it('passes the cursor as oldest (exclusive) and advances the cursor to the newest ts', async () => {
    const { client, historyCalls } = fakeClient({
      historyPages: [
        {
          ok: true,
          messages: [
            { type: 'message', user: 'U1', text: 'first', ts: '100.000001' },
            { type: 'message', user: 'U2', text: 'second', ts: '100.000002' }
          ],
          response_metadata: { next_cursor: '' }
        }
      ]
    })
    const res = await syncChannel(client, 'C1', ctx, '99.000000')
    expect(historyCalls[0]).toMatchObject({ channel: 'C1', oldest: '99.000000', inclusive: false })
    expect(res.items.filter((i) => i.kind === 'message')).toHaveLength(2)
    expect(res.cursor).toBe('100.000002')
  })

  it('paginates history via next_cursor', async () => {
    const { client, historyCalls } = fakeClient({
      historyPages: [
        { ok: true, messages: [{ type: 'message', user: 'U1', text: 'a', ts: '100.0' }], response_metadata: { next_cursor: 'p2' } },
        { ok: true, messages: [{ type: 'message', user: 'U2', text: 'b', ts: '101.0' }], response_metadata: { next_cursor: '' } }
      ]
    })
    const res = await syncChannel(client, 'C1', ctx)
    expect(historyCalls[1].cursor).toBe('p2')
    expect(res.cursor).toBe('101.0')
  })

  it('pulls replies for a thread parent and parents them correctly', async () => {
    const { client, replyCalls } = fakeClient({
      historyPages: [
        {
          ok: true,
          messages: [{ type: 'message', user: 'U1', text: 'root', ts: '100.0', reply_count: 2 }],
          response_metadata: { next_cursor: '' }
        }
      ],
      replies: {
        '100.0': [
          { type: 'message', user: 'U2', text: 'r1', ts: '100.5', thread_ts: '100.0' },
          { type: 'message', user: 'U1', text: 'r2', ts: '101.0', thread_ts: '100.0' }
        ]
      }
    })
    const res = await syncChannel(client, 'C1', ctx, '99.0')
    // Replies fetched since the same cursor.
    expect(replyCalls[0]).toMatchObject({ channel: 'C1', ts: '100.0', oldest: '99.0' })
    const messages = res.items.filter((i) => i.kind === 'message')
    expect(messages).toHaveLength(3) // root + 2 replies
    const replies = messages.filter((m) => m.parentExternalId === 'C1:100.0')
    expect(replies).toHaveLength(2)
    // Cursor advances past the newest reply.
    expect(res.cursor).toBe('101.0')
  })

  it('emits author→channel signals for observed posters', async () => {
    const { client } = fakeClient({
      historyPages: [
        {
          ok: true,
          messages: [
            { type: 'message', user: 'U1', text: 'a', ts: '100.0' },
            { type: 'message', user: 'U2', text: 'b', ts: '101.0' },
            { type: 'message', user: 'U1', text: 'c', ts: '102.0' }
          ],
          response_metadata: { next_cursor: '' }
        }
      ]
    })
    const res = await syncChannel(client, 'C1', ctx)
    const people = (res.signals ?? []).map((s) => s.data.personExternalId).sort()
    expect(people).toEqual(['U1', 'U2']) // deduped
    expect(res.signals?.every((s) => s.type === 'person-channel' && s.data.channelExternalId === 'C1')).toBe(true)
  })

  it('returns an unchanged cursor and no items when nothing is new', async () => {
    const { client } = fakeClient({ historyPages: [{ ok: true, messages: [], response_metadata: { next_cursor: '' } }] })
    const res = await syncChannel(client, 'C1', ctx, '500.0')
    expect(res.items).toHaveLength(0)
    expect(res.cursor).toBe('500.0')
  })
})
