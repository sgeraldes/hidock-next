#!/usr/bin/env node
/**
 * cdp.mjs — deterministic CDP toolkit for the HiDock Electron app.
 *
 * One entry point that replaces the ad-hoc scratchpad scripts (RETRO F6). Connects to
 * the running renderer over the Chrome DevTools Protocol (CDP on :9222) and drives it:
 * evaluate expressions, screenshot, navigate, inspect the transcription queue, enqueue
 * transcriptions, reorder downloads, run discovery.
 *
 * Requires the app to be running (electron-vite `npm run dev`, CDP on 9222). If CDP is
 * down, every command prints a helpful hint and exits 1. Check with:
 *     node scripts/dev/app-cycle.mjs status
 *
 * Node 26 built-ins only (fetch, WebSocket, fs) — no npm packages.
 *
 * Usage:
 *   node scripts/dev/cdp.mjs eval "<expr>"            evaluate an expression, print JSON result
 *   node scripts/dev/cdp.mjs screenshot [outPath]     Page.captureScreenshot -> PNG (default .last-screenshot.png)
 *   node scripts/dev/cdp.mjs body-text [maxChars]     document.body.innerText (default 4000 chars)
 *   node scripts/dev/cdp.mjs navigate <route>         click the sidebar link for #/route (e.g. today, library)
 *   node scripts/dev/cdp.mjs click-text "<text>"      click the row/card containing the given text
 *   node scripts/dev/cdp.mjs queue-status             transcription queue counts + processing ids
 *   node scripts/dev/cdp.mjs enqueue <n>              queue the n most-recent untranscribed recordings (newest-first)
 *   node scripts/dev/cdp.mjs downloads cancel         cancel all downloads
 *   node scripts/dev/cdp.mjs downloads reorder        cancel + re-queue ALL files-to-sync newest-first
 *   node scripts/dev/cdp.mjs downloads batch <n>      cancel + re-queue only the newest n files-to-sync
 *   node scripts/dev/cdp.mjs discover                 identity.discoverContacts + discoverProjects
 */
import fs from 'node:fs'
import path from 'node:path'

const CDP_HOST = process.env.CDP_HOST || 'localhost'
const CDP_PORT = Number(process.env.CDP_PORT || 9222)
const DEFAULT_TIMEOUT = 30000
const DEFAULT_SCREENSHOT = path.join(import.meta.dirname, '.last-screenshot.png')

// Shared filename-date helpers, injected into renderer expressions so ordering matches
// the app's recency rule: 2026Jul07-193144-Rec43.wav -> 20260707193144 (sortable key).
const INJECT_HELPERS = `
  const __MONTHS = {Jan:'01',Feb:'02',Mar:'03',Apr:'04',May:'05',Jun:'06',Jul:'07',Aug:'08',Sep:'09',Oct:'10',Nov:'11',Dec:'12'};
  const __dateKey = (name) => {
    const m = String(name||'').match(/^(\\d{4})([A-Za-z]{3})(\\d{2})-(\\d{2})(\\d{2})(\\d{2})/);
    if (!m) return '';
    return m[1] + (__MONTHS[m[2]] || '00') + m[3] + m[4] + m[5] + m[6];
  };
  const __byNewest = (a, b) => __dateKey(b).localeCompare(__dateKey(a));
`

class CDP {
  constructor() {
    this.ws = null
    this.id = 0
    this.pending = new Map()
  }

  async connect(timeoutMs = DEFAULT_TIMEOUT) {
    let list
    try {
      const res = await fetch(`http://${CDP_HOST}:${CDP_PORT}/json/list`)
      list = await res.json()
    } catch {
      throw new Error(
        `CDP not reachable on :${CDP_PORT} — is the app running?\n` +
          '  Check:  node scripts/dev/app-cycle.mjs status\n' +
          '  Start:  node scripts/dev/app-cycle.mjs restart-help'
      )
    }
    const page =
      list.find((t) => t.type === 'page' && /localhost:/.test(t.url)) ||
      list.find((t) => t.type === 'page') ||
      list[0]
    if (!page || !page.webSocketDebuggerUrl) {
      throw new Error('No CDP page target found — renderer may not be loaded yet (try again in a moment).')
    }
    this.pageUrl = page.url
    this.ws = new WebSocket(page.webSocketDebuggerUrl)
    await new Promise((resolve, reject) => {
      const to = setTimeout(() => reject(new Error('CDP websocket connect timed out')), timeoutMs)
      this.ws.addEventListener('open', () => { clearTimeout(to); resolve() }, { once: true })
      this.ws.addEventListener('error', () => { clearTimeout(to); reject(new Error('CDP websocket error')) }, { once: true })
    })
    this.ws.addEventListener('message', (e) => {
      let msg
      try { msg = JSON.parse(e.data) } catch { return }
      if (msg.id && this.pending.has(msg.id)) {
        this.pending.get(msg.id)(msg)
        this.pending.delete(msg.id)
      }
    })
  }

  send(method, params = {}, timeoutMs = DEFAULT_TIMEOUT) {
    return new Promise((resolve, reject) => {
      const i = ++this.id
      const to = setTimeout(() => {
        this.pending.delete(i)
        reject(new Error(`${method} timed out after ${timeoutMs}ms`))
      }, timeoutMs)
      this.pending.set(i, (msg) => { clearTimeout(to); resolve(msg) })
      this.ws.send(JSON.stringify({ id: i, method, params }))
    })
  }

  // Evaluate an expression in the renderer. Always awaits (so both `1+1` and a promise
  // work) and always returns a value or {error} — never throws into the caller.
  async eval(expr, timeoutMs = DEFAULT_TIMEOUT) {
    const wrapped = `(async()=>{try{return await (${expr})}catch(e){return {error:String(e&&e.message||e)}}})()`
    const msg = await this.send('Runtime.evaluate', { expression: wrapped, returnByValue: true, awaitPromise: true }, timeoutMs)
    if (msg.error) return { error: msg.error.message || String(msg.error) }
    const r = msg.result
    if (r && r.exceptionDetails) {
      return { error: r.exceptionDetails.exception?.description || r.exceptionDetails.text || 'evaluation error' }
    }
    return r?.result?.value
  }

  close() { try { this.ws && this.ws.close() } catch { /* already closed */ } }
}

function print(value) {
  process.stdout.write(JSON.stringify(value, null, 2) + '\n')
}

function fail(message, code = 1) {
  process.stderr.write(message + '\n')
  process.exit(code)
}

// Normalize 'today', '/today', '#/today' -> '#/today'
function normalizeRoute(route) {
  let r = String(route || '').trim()
  r = r.replace(/^#/, '').replace(/^\/+/, '')
  return `#/${r}`
}

async function main() {
  const [cmd, ...args] = process.argv.slice(2)

  if (!cmd || cmd === 'help' || cmd === '--help' || cmd === '-h') {
    process.stdout.write(fs.readFileSync(import.meta.filename, 'utf8').split('\n').slice(2, 41).join('\n') + '\n')
    return
  }

  const cdp = new CDP()
  try {
    await cdp.connect()
  } catch (e) {
    cdp.close()
    fail(e.message, 1)
    return
  }

  try {
    switch (cmd) {
      case 'eval': {
        const expr = args.join(' ')
        if (!expr) return fail('usage: cdp.mjs eval "<expr>"', 2)
        print(await cdp.eval(expr))
        break
      }

      case 'screenshot': {
        const outPath = args[0] ? path.resolve(args[0]) : DEFAULT_SCREENSHOT
        const msg = await cdp.send('Page.captureScreenshot', { format: 'png' })
        const data = msg?.result?.data
        if (!data) return fail('screenshot failed: no image data returned', 1)
        fs.mkdirSync(path.dirname(outPath), { recursive: true })
        fs.writeFileSync(outPath, Buffer.from(data, 'base64'))
        print({ saved: outPath, bytes: fs.statSync(outPath).size })
        break
      }

      case 'body-text': {
        const max = Number(args[0] || 4000)
        const text = await cdp.eval(`((document.body && document.body.innerText) || '').slice(0, ${max})`)
        process.stdout.write((typeof text === 'string' ? text : JSON.stringify(text)) + '\n')
        break
      }

      case 'navigate': {
        if (!args[0]) return fail('usage: cdp.mjs navigate <route>   (e.g. today, library, people, calendar)', 2)
        const route = normalizeRoute(args[0])
        const expr = `(() => {
          const route = ${JSON.stringify(route)};
          const links = Array.from(document.querySelectorAll('a[href]'));
          const link = links.find(a => (a.getAttribute('href')||'').endsWith(route))
                    || links.find(a => (a.getAttribute('href')||'').includes(route));
          if (link) { link.click(); return { clicked: true, route, hash: location.hash }; }
          location.hash = route;  // fallback: no sidebar link found
          return { clicked: false, route, hash: location.hash,
                   available: links.map(a => a.getAttribute('href')).filter(h => h && h.includes('#/')).slice(0, 20) };
        })()`
        print(await cdp.eval(expr))
        break
      }

      case 'click-text': {
        const text = args.join(' ')
        if (!text) return fail('usage: cdp.mjs click-text "<text>"', 2)
        const expr = `(() => {
          const needle = ${JSON.stringify(text)}.toLowerCase();
          const all = Array.from(document.querySelectorAll('body *'));
          // Smallest element that contains the text but whose children do not (the leaf).
          const match = all.find(el => {
            const t = (el.textContent || '').trim().toLowerCase();
            if (!t.includes(needle)) return false;
            return !Array.from(el.children).some(c => (c.textContent || '').toLowerCase().includes(needle));
          });
          if (!match) return { clicked: false, text: ${JSON.stringify(text)} };
          const target = match.closest('[role="button"],button,a,[data-testid],li,tr,[class*="row"],[class*="card"],[class*="item"]') || match;
          target.click();
          return { clicked: true, text: ${JSON.stringify(text)}, tag: target.tagName, className: String(target.className || '') };
        })()`
        print(await cdp.eval(expr))
        break
      }

      case 'queue-status': {
        const expr = `(async () => {
          const q = await window.electronAPI.recordings.getTranscriptionQueue();
          const counts = {};
          for (const it of q) counts[it.status] = (counts[it.status] || 0) + 1;
          const processing = q.filter(it => it.status === 'processing')
            .map(it => ({ id: it.id, recording_id: it.recording_id, filename: it.filename, progress: it.progress }));
          return { total: q.length, counts, processing };
        })()`
        print(await cdp.eval(expr))
        break
      }

      case 'enqueue': {
        const n = Number(args[0])
        if (!Number.isInteger(n) || n <= 0) return fail('usage: cdp.mjs enqueue <n>   (n = how many recent untranscribed to queue)', 2)
        const expr = `(async () => {
          ${INJECT_HELPERS}
          const recs = await window.electronAPI.recordings.getAll();
          const pending = recs
            .filter(r => r.transcription_status !== 'complete')
            .sort((a, b) => __byNewest(a.filename, b.filename));
          const pick = pending.slice(0, ${n});
          const enqueued = [];
          for (const r of pick) {
            try {
              const queueItemId = await window.electronAPI.recordings.addToQueue(r.id);
              enqueued.push({ id: r.id, filename: r.filename, queueItemId });
            } catch (e) {
              enqueued.push({ id: r.id, filename: r.filename, error: String(e && e.message || e) });
            }
          }
          return { requested: ${n}, untranscribedTotal: pending.length, enqueued };
        })()`
        print(await cdp.eval(expr, 120000))
        break
      }

      case 'downloads': {
        const sub = args[0]
        if (!['cancel', 'reorder', 'batch'].includes(sub)) {
          return fail('usage: cdp.mjs downloads cancel|reorder|batch <n>', 2)
        }
        if (sub === 'cancel') {
          const expr = `(async () => {
            await window.electronAPI.downloadService.cancelAll();
            const s = await window.electronAPI.downloadService.getState();
            return { cancelled: true, queueLength: s.queue.length, isProcessing: s.isProcessing };
          })()`
          print(await cdp.eval(expr))
          break
        }
        // reorder = all, batch = newest n
        const limit = sub === 'batch' ? Number(args[1]) : 0
        if (sub === 'batch' && (!Number.isInteger(limit) || limit <= 0)) {
          return fail('usage: cdp.mjs downloads batch <n>', 2)
        }
        const expr = `(async () => {
          ${INJECT_HELPERS}
          const devFiles = await window.electronAPI.deviceCache.getAll();
          if (!devFiles || !devFiles.length) return { error: 'deviceCache is empty — connect the device / populate the cache first' };
          const results = await window.electronAPI.downloadService.getFilesToSync(
            devFiles.map(f => ({ filename: f.filename, size: f.size, duration: f.duration, dateCreated: f.dateCreated }))
          );
          const toSync = results.filter(r => !r.skipReason).sort((a, b) => __byNewest(a.filename, b.filename));
          const pick = ${limit} > 0 ? toSync.slice(0, ${limit}) : toSync;
          await window.electronAPI.downloadService.cancelAll();
          await window.electronAPI.downloadService.queueDownloads(
            pick.map(r => ({
              filename: r.filename,
              size: r.size,
              dateCreated: (r.dateCreated instanceof Date ? r.dateCreated.toISOString() : r.dateCreated)
            }))
          );
          return { filesToSync: toSync.length, queued: pick.length, first: pick.slice(0, 5).map(r => r.filename) };
        })()`
        print(await cdp.eval(expr, 120000))
        break
      }

      case 'discover': {
        const expr = `(async () => {
          const out = {};
          try { out.contacts = await window.electronAPI.identity.discoverContacts(); }
          catch (e) { out.contactsError = String(e && e.message || e); }
          try { out.projects = await window.electronAPI.identity.discoverProjects(); }
          catch (e) { out.projectsError = String(e && e.message || e); }
          return out;
        })()`
        print(await cdp.eval(expr, 120000))
        break
      }

      default:
        cdp.close()
        return fail(`unknown command: ${cmd}\nrun 'node scripts/dev/cdp.mjs help' for usage`, 2)
    }
  } finally {
    cdp.close()
  }
}

main().catch((e) => fail(String(e && e.stack || e), 1))
