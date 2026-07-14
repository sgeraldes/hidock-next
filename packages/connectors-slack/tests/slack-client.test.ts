import { describe, expect, it } from 'vitest'
import { SlackApiError, SlackClient, SlackRateLimitError } from '../src/slack-client.js'
import { makeMockFetch, makeSleepSpy } from './helpers.js'

describe('SlackClient auth + request shape', () => {
  it('sends token as Bearer and form-encoded params', async () => {
    const { fetchFn, calls } = makeMockFetch({
      'auth.test': { body: { ok: true, team: 'Acme', user_id: 'U1' } }
    })
    const client = new SlackClient('xoxb-secret', { fetchFn })
    const res = await client.authTest()
    expect(res.team).toBe('Acme')
    expect(calls[0].authorization).toBe('Bearer xoxb-secret')
    expect(calls[0].url).toContain('/api/auth.test')
  })

  it('throws SlackApiError with the error code on ok:false', async () => {
    const { fetchFn } = makeMockFetch({ 'auth.test': { body: { ok: false, error: 'invalid_auth' } } })
    const client = new SlackClient('bad', { fetchFn })
    await expect(client.authTest()).rejects.toMatchObject({ code: 'invalid_auth' })
    await expect(client.authTest()).rejects.toBeInstanceOf(SlackApiError)
  })
})

describe('SlackClient pagination', () => {
  it('follows next_cursor across pages for listChannels', async () => {
    const { fetchFn, calls } = makeMockFetch({
      'conversations.list': [
        { body: { ok: true, channels: [{ id: 'C1' }], response_metadata: { next_cursor: 'pg2' } } },
        { body: { ok: true, channels: [{ id: 'C2' }], response_metadata: { next_cursor: '' } } }
      ]
    })
    const client = new SlackClient('t', { fetchFn })
    const channels = await client.listChannels()
    expect(channels.map((c) => c.id)).toEqual(['C1', 'C2'])
    // Second call must carry the cursor.
    expect(calls[1].params.cursor).toBe('pg2')
  })

  it('drops the echoed thread parent in conversations.replies', async () => {
    const { fetchFn } = makeMockFetch({
      'conversations.replies': {
        body: {
          ok: true,
          messages: [
            { ts: '100.000', text: 'parent' },
            { ts: '101.000', text: 'reply-a' },
            { ts: '102.000', text: 'reply-b' }
          ],
          response_metadata: { next_cursor: '' }
        }
      }
    })
    const client = new SlackClient('t', { fetchFn })
    const replies = await client.conversationsReplies({ channel: 'C1', ts: '100.000' })
    expect(replies.map((m) => m.ts)).toEqual(['101.000', '102.000'])
  })
})

describe('SlackClient rate limiting (429)', () => {
  it('honors Retry-After and retries, recording the wait', async () => {
    const { sleep, waits } = makeSleepSpy()
    const { fetchFn, calls } = makeMockFetch({
      'users.list': [
        { status: 429, headers: { 'Retry-After': '3' }, body: {} },
        { body: { ok: true, members: [{ id: 'U1' }], response_metadata: { next_cursor: '' } } }
      ]
    })
    const client = new SlackClient('t', { fetchFn, sleep })
    const users = await client.listUsers()
    expect(users.map((u) => u.id)).toEqual(['U1'])
    expect(waits).toEqual([3000]) // 3s Retry-After honored
    expect(calls.length).toBe(2) // one 429, one success
  })

  it('treats body-level error:"ratelimited" as a retryable rate limit', async () => {
    const { sleep, waits } = makeSleepSpy()
    const { fetchFn } = makeMockFetch({
      'auth.test': [
        { status: 200, headers: { 'Retry-After': '1' }, body: { ok: false, error: 'ratelimited' } },
        { body: { ok: true, team: 'Acme' } }
      ]
    })
    const client = new SlackClient('t', { fetchFn, sleep })
    const res = await client.authTest()
    expect(res.team).toBe('Acme')
    expect(waits).toEqual([1000])
  })

  it('gives up with SlackRateLimitError after exhausting retries', async () => {
    const { sleep, waits } = makeSleepSpy()
    const { fetchFn } = makeMockFetch({
      'auth.test': { status: 429, headers: { 'Retry-After': '2' }, body: {} }
    })
    const client = new SlackClient('t', { fetchFn, sleep, maxRetries: 2 })
    await expect(client.authTest()).rejects.toBeInstanceOf(SlackRateLimitError)
    // maxRetries=2 → waits on attempt 0 and 1, then throws on attempt 2.
    expect(waits).toEqual([2000, 2000])
  })

  it('falls back to a default wait when Retry-After is missing', async () => {
    const { sleep, waits } = makeSleepSpy()
    const { fetchFn } = makeMockFetch({
      'auth.test': [
        { status: 429, body: {} },
        { body: { ok: true } }
      ]
    })
    const client = new SlackClient('t', { fetchFn, sleep })
    await client.authTest()
    expect(waits[0]).toBeGreaterThan(0)
  })
})

describe('SlackClient postMessage', () => {
  it('posts text and optional thread_ts', async () => {
    const { fetchFn, calls } = makeMockFetch({
      'chat.postMessage': { body: { ok: true, ts: '999.001', channel: 'C1' } }
    })
    const client = new SlackClient('t', { fetchFn })
    const res = await client.postMessage('C1', 'hello', '900.000')
    expect(res.ts).toBe('999.001')
    expect(calls[0].params).toMatchObject({ channel: 'C1', text: 'hello', thread_ts: '900.000' })
  })
})
