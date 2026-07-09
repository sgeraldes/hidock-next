import { describe, expect, it } from 'vitest'
import type { EntityRef, GraphSignal } from '../src/contract.js'
import { createSlackConnector, SLACK_REQUIRED_SCOPES } from '../src/slack-connector.js'
import { makeMockFetch } from './helpers.js'

const USERS = {
  ok: true,
  members: [
    { id: 'U1', name: 'alice', real_name: 'Alice Anderson', profile: { display_name: 'Alice', email: 'alice@acme.io', title: 'CTO' } },
    { id: 'U2', name: 'bob', profile: { display_name: 'Bob', email: 'bob@acme.io' } },
    { id: 'UBOT', name: 'bot', is_bot: true, profile: {} },
    { id: 'UDEL', name: 'ghost', deleted: true, profile: {} }
  ],
  response_metadata: { next_cursor: '' }
}

describe('SlackConnector identity', () => {
  it('searchPeople matches name/handle/email and excludes bots + deleted', async () => {
    const { fetchFn } = makeMockFetch({ 'users.list': { body: USERS } })
    const c = createSlackConnector({ token: 'xoxb-t' }, { fetchFn })
    const byName = await c.searchPeople('alice')
    expect(byName.map((p) => p.externalId)).toEqual(['U1'])
    const byEmail = await c.searchPeople('bob@acme')
    expect(byEmail.map((p) => p.externalId)).toEqual(['U2'])
    const all = await c.searchPeople('')
    expect(all.map((p) => p.externalId).sort()).toEqual(['U1', 'U2']) // no bot, no deleted
  })

  it('enrich returns confidence 1.0 on email match, 0.5 on name-only, null otherwise', async () => {
    const { fetchFn } = makeMockFetch({ 'users.list': { body: USERS } })
    const c = createSlackConnector({ token: 'xoxb-t' }, { fetchFn })
    expect(await c.enrich({ id: 'p1', name: 'x', email: 'ALICE@acme.io' })).toMatchObject({ confidence: 1.0, externalId: 'U1' })
    expect(await c.enrich({ id: 'p2', name: 'Alice', email: null })).toMatchObject({ confidence: 0.5, externalId: 'U1' })
    expect(await c.enrich({ id: 'p3', name: 'Nobody', email: 'no@one.io' })).toBeNull()
  })

  it('listPeople returns humans only', async () => {
    const { fetchFn } = makeMockFetch({ 'users.list': { body: USERS } })
    const c = createSlackConnector({ token: 'xoxb-t' }, { fetchFn })
    const people = await c.listPeople()
    expect(people.map((p) => p.externalId).sort()).toEqual(['U1', 'U2'])
  })
})

describe('SlackConnector sources', () => {
  it('listContainers maps channels; listSelectedContainers respects the allowlist', async () => {
    const channels = {
      ok: true,
      channels: [
        { id: 'C1', name: 'general', is_private: false },
        { id: 'C2', name: 'random', is_private: false }
      ],
      response_metadata: { next_cursor: '' }
    }
    const { fetchFn } = makeMockFetch({ 'conversations.list': { body: channels } })
    const c = createSlackConnector({ token: 'xoxb-t', channelAllowlist: ['C2'] }, { fetchFn })
    expect((await c.listContainers()).map((x) => x.externalId)).toEqual(['C1', 'C2'])
    expect((await c.listSelectedContainers()).map((x) => x.externalId)).toEqual(['C2'])
  })

  it('listSelectedContainers is empty when nothing is opted in', async () => {
    const { fetchFn } = makeMockFetch({ 'conversations.list': { body: { ok: true, channels: [], response_metadata: { next_cursor: '' } } } })
    const c = createSlackConnector({ token: 'xoxb-t' }, { fetchFn })
    expect(await c.listSelectedContainers()).toEqual([])
  })
})

describe('SlackConnector actions', () => {
  const personWithSlack = (externalId: string): EntityRef => ({
    type: 'person',
    id: 'p1'
    // identities filled per-test using the connector id
  }) as EntityRef

  it('offers "Message on Slack" only for a person with a linked slack identity', async () => {
    const { fetchFn } = makeMockFetch({ 'auth.test': { body: { ok: true } } })
    const c = createSlackConnector({ token: 'xoxb-t' }, { fetchFn })
    const withId: EntityRef = { type: 'person', id: 'p1', identities: [{ connectorId: c.id, externalId: 'U1' }] }
    const actions = c.actionsFor(withId)
    expect(actions).toHaveLength(1)
    expect(actions[0].label).toBe('Message on Slack')
    expect(actions[0].payload).toMatchObject({ channel: 'U1' })

    expect(c.actionsFor({ type: 'person', id: 'p2' })).toEqual([])
    expect(c.actionsFor({ type: 'project', id: 'pr1' })).toEqual([])
    void personWithSlack
  })

  it('runAction posts the message and returns the ts', async () => {
    const { fetchFn, calls } = makeMockFetch({ 'chat.postMessage': { body: { ok: true, ts: '9.9' } } })
    const c = createSlackConnector({ token: 'xoxb-t' }, { fetchFn })
    const action = c.actionsFor({ type: 'person', id: 'p1', identities: [{ connectorId: c.id, externalId: 'U1' }] })[0]
    const res = await c.runAction(action, { text: 'hi there' })
    expect(res).toEqual({ ok: true, externalId: '9.9' })
    expect(calls[0].params).toMatchObject({ channel: 'U1', text: 'hi there' })
  })

  it('runAction rejects empty text without calling Slack', async () => {
    const { fetchFn, calls } = makeMockFetch({ 'chat.postMessage': { body: { ok: true } } })
    const c = createSlackConnector({ token: 'xoxb-t' }, { fetchFn })
    const action = c.actionsFor({ type: 'person', id: 'p1', identities: [{ connectorId: c.id, externalId: 'U1' }] })[0]
    const res = await c.runAction(action, { text: '   ' })
    expect(res.ok).toBe(false)
    expect(calls).toHaveLength(0)
  })
})

describe('SlackConnector status', () => {
  it('connect() → connected on auth.test success', async () => {
    const { fetchFn } = makeMockFetch({ 'auth.test': { body: { ok: true, team: 'Acme' } } })
    const c = createSlackConnector({ token: 'xoxb-t' }, { fetchFn })
    const st = await c.connect()
    expect(st.state).toBe('connected')
    expect(c.status().state).toBe('connected')
  })

  it('connect() → auth-needed on invalid_auth', async () => {
    const { fetchFn } = makeMockFetch({ 'auth.test': { body: { ok: false, error: 'invalid_auth' } } })
    const c = createSlackConnector({ token: 'bad' }, { fetchFn })
    const st = await c.connect()
    expect(st.state).toBe('auth-needed')
  })

  it('connect() → error on a non-auth API error', async () => {
    const { fetchFn } = makeMockFetch({ 'auth.test': { body: { ok: false, error: 'internal_error' } } })
    const c = createSlackConnector({ token: 't' }, { fetchFn })
    expect((await c.connect()).state).toBe('error')
  })
})

describe('SlackConnector signal bridging', () => {
  it('forwards pull-time author→channel signals to a subscriber', async () => {
    const { fetchFn } = makeMockFetch({
      'users.list': { body: { ok: true, members: [], response_metadata: { next_cursor: '' } } },
      'conversations.history': {
        body: {
          ok: true,
          messages: [{ type: 'message', user: 'U1', text: 'hi', ts: '100.0' }],
          response_metadata: { next_cursor: '' }
        }
      }
    })
    const c = createSlackConnector({ token: 'xoxb-t' }, { fetchFn })
    const received: GraphSignal[] = []
    c.subscribe((s) => received.push(s))
    await c.pull({ externalId: 'C1', name: 'general', kind: 'channel' })
    expect(received).toHaveLength(1)
    expect(received[0]).toMatchObject({ type: 'person-channel', data: { personExternalId: 'U1', channelExternalId: 'C1' } })
    c.unsubscribe()
  })
})

describe('exports', () => {
  it('documents the required scopes', () => {
    expect(SLACK_REQUIRED_SCOPES.history).toBe('channels:history')
    expect(SLACK_REQUIRED_SCOPES.channels).toBe('channels:read')
    expect(SLACK_REQUIRED_SCOPES.users).toBe('users:read')
  })
})
