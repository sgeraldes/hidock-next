/**
 * One-shot loopback HTTP server for the OAuth 2.0 Authorization Code + PKCE flow
 * (the "HiNotes-style popup"): we open the system browser at the Microsoft
 * sign-in URL with `redirect_uri=http://localhost:<ephemeral>`, and this server
 * captures the single redirect that carries the `?code=` (or `?error=`), shows
 * the user a friendly "return to HiDock" page, and resolves.
 *
 * Design:
 *  - Binds 127.0.0.1:0 → the OS assigns a free EPHEMERAL port. Azure matches any
 *    port for the `http://localhost` loopback redirect on a public client
 *    (RFC 8252 §7.3), so no fixed port needs registering.
 *  - Captures exactly ONE authorization response, then keeps the socket only long
 *    enough to serve the success/error page. `waitForCode` rejects on timeout so
 *    a user who abandons the browser tab never wedges the connector.
 *  - Ignores unrelated requests (e.g. the browser's /favicon.ico) so they don't
 *    consume the one-shot capture.
 *  - Pure Node `http` — no Electron dependency, so it is unit-testable by issuing
 *    a real localhost request against the bound port.
 */
import { createServer, type Server, type IncomingMessage, type ServerResponse } from 'http'
import { AddressInfo } from 'net'

export interface LoopbackResult {
  /** The authorization code, when the redirect succeeded. */
  code?: string
  /** OAuth error code (e.g. 'access_denied'), when the user declined/failed. */
  error?: string
  errorDescription?: string
  /** The `state` echoed back by the authorization server (CSRF check). */
  state?: string
}

export interface LoopbackServer {
  /** Bound loopback port (ephemeral). */
  readonly port: number
  /** Full redirect URI to pass to MSAL (`http://localhost:<port>`). */
  readonly redirectUri: string
  /**
   * Resolve with the first authorization response captured, or reject if none
   * arrives within `timeoutMs`. Safe to call once; subsequent calls resolve with
   * the same captured result.
   */
  waitForCode(timeoutMs: number): Promise<LoopbackResult>
  /** Tear the server down (idempotent). Always call in a finally. */
  close(): void
}

function defaultSuccessHtml(): string {
  return page(
    'You’re connected',
    'HiDock is now linked to your Microsoft 365 account. You can close this tab and return to the app.'
  )
}

function defaultErrorHtml(message: string): string {
  return page('Sign-in didn’t finish', message || 'The sign-in was cancelled. Return to HiDock and try again.')
}

/** Minimal, self-contained, theme-aware confirmation page. */
function page(title: string, body: string): string {
  const esc = (s: string) => s.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c] as string)
  return `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)} — HiDock</title>
<style>
  :root { color-scheme: light dark; }
  body { margin:0; min-height:100vh; display:grid; place-items:center;
    font:16px/1.5 -apple-system,Segoe UI,Roboto,sans-serif;
    background:#f6f7f9; color:#1a1a1a; }
  @media (prefers-color-scheme: dark){ body{ background:#0f1115; color:#e8eaed; } .card{ background:#171a21; } }
  .card { max-width:420px; padding:40px 36px; border-radius:16px; background:#fff;
    box-shadow:0 8px 40px rgba(0,0,0,.12); text-align:center; }
  .mark { width:56px;height:56px;margin:0 auto 20px;border-radius:14px;
    background:linear-gradient(135deg,#5b8cff,#7c4dff); display:grid;place-items:center;color:#fff;font-size:28px; }
  h1 { font-size:20px; margin:0 0 8px; }
  p { margin:0; opacity:.8; }
</style></head><body>
<div class="card"><div class="mark">✓</div><h1>${esc(title)}</h1><p>${esc(body)}</p></div>
</body></html>`
}

export interface LoopbackOptions {
  successHtml?: string
  /** Called with the OAuth error message to render the failure page. */
  errorHtml?: (message: string) => string
  /** Bind host; defaults to 127.0.0.1. */
  host?: string
}

/**
 * Start a one-shot loopback server. Resolves once the socket is listening; the
 * caller then builds the auth URL with `server.redirectUri` and awaits
 * `server.waitForCode`.
 */
export function startLoopbackServer(opts: LoopbackOptions = {}): Promise<LoopbackServer> {
  const host = opts.host ?? '127.0.0.1'
  const successHtml = opts.successHtml ?? defaultSuccessHtml()
  const renderError = opts.errorHtml ?? defaultErrorHtml

  return new Promise<LoopbackServer>((resolveServer, rejectServer) => {
    let captured: LoopbackResult | null = null
    let resolveCode: ((r: LoopbackResult) => void) | null = null
    let closed = false

    const handler = (req: IncomingMessage, res: ServerResponse): void => {
      let url: URL
      try {
        url = new URL(req.url ?? '/', `http://${host}`)
      } catch {
        res.statusCode = 400
        res.end('Bad Request')
        return
      }
      const params = url.searchParams
      const code = params.get('code') ?? undefined
      const error = params.get('error') ?? undefined
      // Ignore requests that carry neither a code nor an error (favicon, probes).
      if (!code && !error) {
        res.statusCode = 404
        res.end('Not Found')
        return
      }
      const result: LoopbackResult = {
        code,
        error,
        errorDescription: params.get('error_description') ?? undefined,
        state: params.get('state') ?? undefined,
      }
      if (!captured) captured = result
      res.statusCode = error ? 400 : 200
      res.setHeader('Content-Type', 'text/html; charset=utf-8')
      res.end(error ? renderError(result.errorDescription || result.error || '') : successHtml)
      if (resolveCode) {
        resolveCode(captured)
        resolveCode = null
      }
    }

    const server: Server = createServer(handler)
    server.on('error', (err) => {
      if (!closed) rejectServer(err)
    })
    server.listen(0, host, () => {
      const addr = server.address() as AddressInfo
      const port = addr.port

      const api: LoopbackServer = {
        port,
        redirectUri: `http://localhost:${port}`,
        waitForCode(timeoutMs: number): Promise<LoopbackResult> {
          if (captured) return Promise.resolve(captured)
          return new Promise<LoopbackResult>((resolve, reject) => {
            resolveCode = resolve
            const timer = setTimeout(() => {
              if (!captured) {
                resolveCode = null
                reject(new Error('Timed out waiting for the Microsoft sign-in to complete.'))
              }
            }, timeoutMs)
            if (typeof timer.unref === 'function') timer.unref()
          })
        },
        close(): void {
          if (closed) return
          closed = true
          try {
            server.close()
          } catch {
            /* already closed */
          }
        },
      }
      resolveServer(api)
    })
  })
}
