import { describe, it, expect, vi } from 'vitest'
import type { ConnectorContext } from '@hidock/connectors'
import { M365Connector, m365Descriptor } from '../m365-connector'

function fakeCtx(config: Record<string, string> = {}): ConnectorContext & { statuses: any[] } {
  const secrets = new Map<string, string>()
  const statuses: any[] = []
  return {
    connectorId: 'm365',
    getConfig: () => ({ ...config }),
    getSecret: (k) => secrets.get(k) ?? null,
    setSecret: (k, v) => {
      if (v === null || v === '') secrets.delete(k)
      else secrets.set(k, v)
    },
    setStatus: (p) => statuses.push(p),
    log: () => {},
    statuses,
  }
}

// A minimal Graph calendarView delta page with attendees + emails.
const CAL_PAGE_1 = {
  value: [
    {
      id: 'evt1',
      subject: 'Sprint planning',
      start: { dateTime: '2026-07-09T10:00:00.0000000', timeZone: 'UTC' },
      end: { dateTime: '2026-07-09T11:00:00.0000000', timeZone: 'UTC' },
      location: { displayName: 'Room 4' },
      bodyPreview: 'Plan the sprint',
      isOnlineMeeting: true,
      onlineMeeting: { joinUrl: 'https://teams.example/join' },
      organizer: { emailAddress: { name: 'Alice', address: 'alice@contoso.com' } },
      attendees: [
        { type: 'required', emailAddress: { name: 'Bob', address: 'bob@contoso.com' }, status: { response: 'accepted' } },
        { type: 'optional', emailAddress: { name: 'Carol', address: 'carol@contoso.com' } },
      ],
    },
  ],
  '@odata.nextLink': 'https://graph.microsoft.com/v1.0/me/calendarView/delta?$skiptoken=PAGE2',
}
const CAL_PAGE_2 = {
  value: [],
  '@odata.deltaLink': 'https://graph.microsoft.com/v1.0/me/calendarView/delta?$deltatoken=FINAL',
}

describe('M365Connector — descriptor', () => {
  it('advertises identity + sources, oauth auth, multi-instance, and setup steps', () => {
    expect(m365Descriptor.id).toBe('m365')
    expect(m365Descriptor.capabilityKinds).toEqual(expect.arrayContaining(['identity', 'sources']))
    expect(m365Descriptor.auth.kind).toBe('oauth')
    expect(m365Descriptor.multiInstance).toBe(true)
    expect((m365Descriptor.auth.setupSteps ?? []).length).toBeGreaterThan(3)
    expect(m365Descriptor.configFields.map((f) => f.key)).toEqual(['clientId', 'tenant'])
  })

  it('with no shipped default: clientId is required and setup is NOT optional', () => {
    // The shipped default client id is empty by default (placeholder), so the
    // full "register your own app" walkthrough applies.
    expect(m365Descriptor.setupOptional).toBe(false)
    const clientId = m365Descriptor.configFields.find((f) => f.key === 'clientId')!
    expect(clientId.required).toBe(true)
    expect(clientId.advanced).toBeFalsy()
  })
})

describe('M365Connector — calendar sync', () => {
  it('maps events with attendee emails into meeting SourceItems and paginates via delta links', async () => {
    const ctx = fakeCtx({ clientId: 'abc' })
    const graphFetch = vi.fn(async (url: string) => (url.includes('PAGE2') ? CAL_PAGE_2 : CAL_PAGE_1))
    const connector = new M365Connector(ctx, { acquireToken: async () => 'tok', graphFetch })

    const container = { externalId: 'calendar', name: 'Calendar', kind: 'calendar' }
    const page1 = await connector.capabilities.sources!.pull(container)
    expect(page1.items).toHaveLength(1)
    const item = page1.items[0]
    expect(item.kind).toBe('meeting')
    const meeting = item.entity as any
    expect(meeting.title).toBe('Sprint planning')
    expect(meeting.start).toBe('2026-07-09T10:00:00.000Z')
    expect(meeting.organizer.email).toBe('alice@contoso.com')
    expect(meeting.attendees.map((a: any) => a.email)).toEqual(['bob@contoso.com', 'carol@contoso.com'])
    expect(page1.hasMore).toBe(true)
    expect(page1.cursor).toContain('PAGE2')

    // Second page returns the deltaLink as the persistable cursor, hasMore false.
    const page2 = await connector.capabilities.sources!.pull(container, page1.cursor)
    expect(page2.items).toHaveLength(0)
    expect(page2.hasMore).toBe(false)
    expect(page2.cursor).toContain('FINAL')
  })

  it('maps contacts with emails and skips emailless contacts', async () => {
    const ctx = fakeCtx({ clientId: 'abc' })
    const page = {
      value: [
        { id: 'c1', displayName: 'Dana Lee', emailAddresses: [{ address: 'dana@contoso.com' }], jobTitle: 'PM', companyName: 'Contoso' },
        { id: 'c2', displayName: 'No Email', emailAddresses: [] },
      ],
      '@odata.deltaLink': 'https://graph.microsoft.com/v1.0/me/contacts/delta?$deltatoken=D',
    }
    const connector = new M365Connector(ctx, { acquireToken: async () => 'tok', graphFetch: async () => page })
    const result = await connector.capabilities.sources!.pull({ externalId: 'contacts', name: 'Contacts', kind: 'contacts' })
    expect(result.items).toHaveLength(1)
    const person = result.items[0].entity as any
    expect(person.email).toBe('dana@contoso.com')
    expect(person.title).toBe('PM')
    expect(result.hasMore).toBe(false)
  })
})

describe('M365Connector — identity', () => {
  const PEOPLE_PAGE = {
    value: [
      {
        id: 'p1',
        displayName: 'Bob Jones',
        scoredEmailAddresses: [{ address: 'bob@contoso.com' }],
        jobTitle: 'Engineer',
        companyName: 'Contoso',
      },
    ],
  }

  it('searchPeople maps /me/people results', async () => {
    const ctx = fakeCtx({ clientId: 'abc' })
    const connector = new M365Connector(ctx, { acquireToken: async () => 'tok', graphFetch: async () => PEOPLE_PAGE })
    const people = await connector.capabilities.identity!.searchPeople('bob')
    expect(people).toHaveLength(1)
    expect(people[0].email).toBe('bob@contoso.com')
    expect(people[0].title).toBe('Engineer')
  })

  it('enrich returns confidence 1.0 on exact email match, 0.6 otherwise, null on no results', async () => {
    const ctx = fakeCtx({ clientId: 'abc' })
    const connector = new M365Connector(ctx, { acquireToken: async () => 'tok', graphFetch: async () => PEOPLE_PAGE })
    const exact = await connector.capabilities.identity!.enrich({ id: '1', name: 'Bob', email: 'bob@contoso.com' })
    expect(exact?.confidence).toBe(1.0)
    expect(exact?.fields.company).toBe('Contoso')
    const nameOnly = await connector.capabilities.identity!.enrich({ id: '2', name: 'Bob' })
    expect(nameOnly?.confidence).toBe(0.6)

    const empty = new M365Connector(ctx, { acquireToken: async () => 'tok', graphFetch: async () => ({ value: [] }) })
    const none = await empty.capabilities.identity!.enrich({ id: '3', name: 'Nobody', email: 'no@x.com' })
    expect(none).toBeNull()
  })
})

describe('M365Connector — lifecycle', () => {
  it('connect without a clientId reports auth-needed and does not throw', async () => {
    const ctx = fakeCtx({})
    const connector = new M365Connector(ctx, {})
    const status = await connector.connect()
    expect(status.state).toBe('auth-needed')
    expect(ctx.statuses.at(-1).state).toBe('auth-needed')
  })

  it('connect with a cached silent token connects without device-code', async () => {
    const ctx = fakeCtx({ clientId: 'abc' })
    const runDeviceCode = vi.fn()
    const connector = new M365Connector(ctx, { trySilentToken: async () => 'cached-tok', runDeviceCode })
    const status = await connector.connect()
    expect(status.state).toBe('connected')
    expect(runDeviceCode).not.toHaveBeenCalled()
  })

  it('interactive connect DEFAULTS to the browser (auth-code) flow and surfaces the auth URL', async () => {
    const ctx = fakeCtx({ clientId: 'abc' })
    const runDeviceCode = vi.fn()
    const runAuthCode = vi.fn(async (onPrompt: any) => {
      onPrompt({ url: 'https://login.microsoftonline.com/common/oauth2/v2.0/authorize?x=1', message: 'Opening browser…' })
    })
    const connector = new M365Connector(ctx, { trySilentToken: async () => null, runAuthCode, runDeviceCode })
    const status = await connector.connect({ interactive: true })
    expect(status.state).toBe('connected')
    expect(runAuthCode).toHaveBeenCalledTimes(1)
    expect(runDeviceCode).not.toHaveBeenCalled()
    const connecting = ctx.statuses.find((s) => s.state === 'connecting')
    expect(connecting?.detail?.mode).toBe('auth-code')
    expect(connecting?.detail?.authUrl).toContain('login.microsoftonline.com')
  })

  it('interactive connect with authMode "device-code" runs device-code and surfaces the code prompt', async () => {
    const ctx = fakeCtx({ clientId: 'abc' })
    const runAuthCode = vi.fn()
    const runDeviceCode = vi.fn(async (onPrompt: any) => {
      onPrompt({ verificationUri: 'https://microsoft.com/devicelogin', userCode: 'ABCD-1234', message: 'Go sign in' })
    })
    const connector = new M365Connector(ctx, { trySilentToken: async () => null, runDeviceCode, runAuthCode })
    const status = await connector.connect({ interactive: true, authMode: 'device-code' })
    expect(status.state).toBe('connected')
    expect(runDeviceCode).toHaveBeenCalledTimes(1)
    expect(runAuthCode).not.toHaveBeenCalled()
    const connecting = ctx.statuses.find((s) => s.state === 'connecting')
    expect(connecting?.detail?.mode).toBe('device-code')
    expect(connecting?.detail?.userCode).toBe('ABCD-1234')
    expect(connecting?.detail?.verificationUri).toContain('devicelogin')
  })

  it('uses the instance id from ctx.connectorId (multi-instance provenance)', async () => {
    const ctx = fakeCtx({ clientId: 'abc' })
    ;(ctx as { connectorId: string }).connectorId = 'm365:acct-2'
    const connector = new M365Connector(ctx, {})
    expect(connector.id).toBe('m365:acct-2')
  })

  it('silent (non-interactive) connect with no cached token reports auth-needed and NEVER runs device-code', async () => {
    const ctx = fakeCtx({ clientId: 'abc' })
    const runDeviceCode = vi.fn()
    const connector = new M365Connector(ctx, { trySilentToken: async () => null, runDeviceCode })
    const status = await connector.connect() // no interactive flag → startup resume
    expect(status.state).toBe('auth-needed')
    expect(runDeviceCode).not.toHaveBeenCalled()
  })

  it('disconnect clears the cached token secret', async () => {
    const ctx = fakeCtx({ clientId: 'abc' })
    ctx.setSecret('msalCache', 'blob')
    const connector = new M365Connector(ctx, {})
    await connector.disconnect()
    expect(ctx.getSecret('msalCache')).toBeNull()
    expect(connector.status().state).toBe('disconnected')
  })
})
