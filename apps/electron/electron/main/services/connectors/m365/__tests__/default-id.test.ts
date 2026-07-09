import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { ConnectorContext } from '@hidock/connectors'

// Simulate a project that HAS pasted a shipped default client id into default-app.ts.
vi.mock('../default-app', () => ({
  DEFAULT_M365_CLIENT_ID: 'shipped-default-client-id',
  DEFAULT_M365_TENANT: 'common',
  hasDefaultM365App: () => true,
}))

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

describe('M365 default client id (precedence + zero-setup UX)', () => {
  let m365Descriptor: typeof import('../m365-connector').m365Descriptor
  let M365Connector: typeof import('../m365-connector').M365Connector

  beforeEach(async () => {
    vi.resetModules()
    const mod = await import('../m365-connector')
    m365Descriptor = mod.m365Descriptor
    M365Connector = mod.M365Connector
  })

  it('descriptor collapses setup: setupOptional true, clientId optional + advanced', () => {
    expect(m365Descriptor.setupOptional).toBe(true)
    const clientId = m365Descriptor.configFields.find((f) => f.key === 'clientId')!
    expect(clientId.required).toBe(false)
    expect(clientId.advanced).toBe(true)
  })

  it('connect uses the shipped default when the user set NO client id (no auth-needed)', async () => {
    const ctx = fakeCtx({}) // user provided nothing
    const runAuthCode = vi.fn(async (onPrompt: any) => onPrompt({ url: 'https://login/authorize', message: 'x' }))
    const connector = new M365Connector(ctx, { trySilentToken: async () => null, runAuthCode })
    const status = await connector.connect({ interactive: true })
    // The default client id filled the gap, so the browser flow ran instead of auth-needed.
    expect(status.state).toBe('connected')
    expect(runAuthCode).toHaveBeenCalledTimes(1)
    expect(ctx.statuses.some((s) => s.state === 'auth-needed')).toBe(false)
  })

  it('a user-provided client id still connects (user value takes precedence over the default)', async () => {
    const ctx = fakeCtx({ clientId: 'my-own-app-id' })
    const runAuthCode = vi.fn(async (onPrompt: any) => onPrompt({ url: 'https://login/authorize', message: 'x' }))
    const connector = new M365Connector(ctx, { trySilentToken: async () => null, runAuthCode })
    const status = await connector.connect({ interactive: true })
    expect(status.state).toBe('connected')
    expect(runAuthCode).toHaveBeenCalledTimes(1)
  })
})
