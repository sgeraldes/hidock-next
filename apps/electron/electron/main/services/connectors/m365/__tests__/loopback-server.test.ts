import { describe, it, expect } from 'vitest'
import { startLoopbackServer } from '../loopback-server'

/** Fire a real localhost GET at the loopback server and return the status + body. */
async function hit(url: string): Promise<{ status: number; body: string }> {
  const res = await fetch(url)
  return { status: res.status, body: await res.text() }
}

describe('loopback-server', () => {
  it('binds an ephemeral localhost port and exposes a matching redirectUri', async () => {
    const server = await startLoopbackServer()
    try {
      expect(server.port).toBeGreaterThan(0)
      expect(server.redirectUri).toBe(`http://localhost:${server.port}`)
    } finally {
      server.close()
    }
  })

  it('captures the authorization code and serves a success page', async () => {
    const server = await startLoopbackServer({ successHtml: '<html>OK-DONE</html>' })
    try {
      const waiting = server.waitForCode(2000)
      const { status, body } = await hit(`${server.redirectUri}/?code=AUTH_CODE_123&state=st`)
      expect(status).toBe(200)
      expect(body).toContain('OK-DONE')
      const result = await waiting
      expect(result.code).toBe('AUTH_CODE_123')
      expect(result.state).toBe('st')
      expect(result.error).toBeUndefined()
    } finally {
      server.close()
    }
  })

  it('captures an OAuth error, serves an error page (400), and reports it', async () => {
    const server = await startLoopbackServer()
    try {
      const waiting = server.waitForCode(2000)
      const { status } = await hit(`${server.redirectUri}/?error=access_denied&error_description=User%20declined`)
      expect(status).toBe(400)
      const result = await waiting
      expect(result.error).toBe('access_denied')
      expect(result.errorDescription).toBe('User declined')
      expect(result.code).toBeUndefined()
    } finally {
      server.close()
    }
  })

  it('ignores unrelated requests (e.g. favicon) without consuming the one-shot capture', async () => {
    const server = await startLoopbackServer()
    try {
      const noise = await hit(`${server.redirectUri}/favicon.ico`)
      expect(noise.status).toBe(404)
      // The real redirect still resolves the pending wait.
      const waiting = server.waitForCode(2000)
      await hit(`${server.redirectUri}/?code=REAL`)
      const result = await waiting
      expect(result.code).toBe('REAL')
    } finally {
      server.close()
    }
  })

  it('rejects waitForCode after the timeout when no redirect arrives', async () => {
    const server = await startLoopbackServer()
    try {
      await expect(server.waitForCode(50)).rejects.toThrow(/Timed out/)
    } finally {
      server.close()
    }
  })
})
