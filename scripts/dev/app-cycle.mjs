#!/usr/bin/env node
/**
 * app-cycle.mjs — deterministic lifecycle helper for the HiDock Electron dev app.
 *
 * Kills the manual "restart dance" (RETRO F7): stop the tracked dev listeners, check
 * whether CDP is up, wait for it to come up (optionally gated on a log line), and print
 * the exact restart sequence.
 *
 * IMPORTANT: this script does NOT start the dev server itself — a script-spawned dev
 * server would orphan (see the global rule on stoppable background processes). Instead
 * `restart-help` prints the exact start command for the harness to run in a tracked
 * background shell, so it can always be stopped again.
 *
 * Node 26 built-ins only (fetch, fs, child_process) — no npm packages.
 *
 * Usage:
 *   node scripts/dev/app-cycle.mjs status                 is CDP reachable? print version + page list
 *   node scripts/dev/app-cycle.mjs stop                   reap the dev listeners (9222 + renderer) via devproc
 *   node scripts/dev/app-cycle.mjs wait [--timeout <sec>] [--log <file> --until <regex>]
 *                                                         poll until CDP is up (and, optionally, a log line matches)
 *   node scripts/dev/app-cycle.mjs restart-help           print the exact stop + start + wait sequence
 *
 * Exit codes: 0 = ok, 1 = not-reachable / timeout, 2 = usage error.
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { execFileSync } from 'node:child_process'

const CDP_HOST = process.env.CDP_HOST || 'localhost'
const CDP_PORT = Number(process.env.CDP_PORT || 9222)
// Renderer dev-server ports vary across electron-vite runs (517x); reap the known set.
const DEFAULT_PORTS = [CDP_PORT, 5180, 5179, 5173]
const DEVPROC = path.join(os.homedir(), '.claude', 'hooks', 'devproc.mjs')

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function cdpVersion() {
  const res = await fetch(`http://${CDP_HOST}:${CDP_PORT}/json/version`, { signal: AbortSignal.timeout(3000) })
  return res.json()
}

async function cdpPages() {
  const res = await fetch(`http://${CDP_HOST}:${CDP_PORT}/json/list`, { signal: AbortSignal.timeout(3000) })
  return res.json()
}

async function isCdpUp() {
  try {
    const pages = await cdpPages()
    // "Up" means a renderer page target exists, not merely that the port answers.
    return Array.isArray(pages) && pages.some((t) => t.type === 'page' && /localhost:/.test(t.url))
  } catch {
    return false
  }
}

function parseFlags(args) {
  const out = { _: [], timeout: null, log: null, until: null, ports: null }
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--timeout') out.timeout = Number(args[++i])
    else if (args[i] === '--log') out.log = args[++i]
    else if (args[i] === '--until') out.until = args[++i]
    else if (args[i] === '--ports') out.ports = args[++i].split(',').map(Number).filter(Boolean)
    else out._.push(args[i])
  }
  return out
}

// Ask CDP which renderer port is live so `stop` reaps the actual one, not just guesses.
async function detectRendererPort() {
  try {
    const pages = await cdpPages()
    for (const t of pages || []) {
      const m = String(t.url || '').match(/localhost:(\d+)/)
      if (m) return Number(m[1])
    }
  } catch { /* CDP down — fall back to defaults */ }
  return null
}

async function cmdStatus() {
  let version
  try {
    version = await cdpVersion()
  } catch {
    process.stderr.write(`CDP not reachable on :${CDP_PORT} — app is not running (or --remote-debugging-port is off).\n`)
    process.exit(1)
  }
  const pages = await cdpPages().catch(() => [])
  const out = {
    reachable: true,
    browser: version.Browser,
    userAgent: version['User-Agent'],
    pages: (pages || []).map((t) => ({ type: t.type, title: t.title, url: t.url, id: t.id })),
  }
  process.stdout.write(JSON.stringify(out, null, 2) + '\n')
  process.exit(0)
}

function cmdStop(flags) {
  return (async () => {
    if (!fs.existsSync(DEVPROC)) {
      process.stderr.write(`devproc not found at ${DEVPROC} — cannot reap. Stop the dev shell via the harness instead.\n`)
      process.exit(1)
    }
    const detected = await detectRendererPort()
    const ports = [...new Set([...(flags.ports || DEFAULT_PORTS), ...(detected ? [detected] : [])])]
    process.stdout.write(`Reaping listeners on ports: ${ports.join(', ')} (via devproc reap --any)\n`)
    try {
      const out = execFileSync(process.execPath, [DEVPROC, 'reap', '--any', ...ports.map(String)], {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
      })
      if (out) process.stdout.write(out)
    } catch (e) {
      // reap on a free port is a no-op; only surface unexpected failures.
      const msg = (e.stdout || '') + (e.stderr || '')
      if (msg) process.stdout.write(msg)
    }
    // Confirm it's actually down.
    const stillUp = await isCdpUp()
    process.stdout.write(stillUp ? 'WARNING: CDP still reachable — a listener may have survived.\n' : 'Stopped: CDP no longer reachable.\n')
    process.exit(0)
  })()
}

async function cmdWait(flags) {
  const timeoutSec = flags.timeout || 120
  const deadline = Date.now() + timeoutSec * 1000
  if ((flags.log && !flags.until) || (flags.until && !flags.log)) {
    process.stderr.write('usage: --log <file> and --until <regex> must be given together\n')
    process.exit(2)
  }
  let re = null
  if (flags.until) {
    try { re = new RegExp(flags.until) } catch (e) { process.stderr.write(`bad --until regex: ${e.message}\n`); process.exit(2) }
  }

  let cdpReady = false
  let logReady = !re
  while (Date.now() < deadline) {
    if (!cdpReady) cdpReady = await isCdpUp()
    if (re && !logReady && flags.log && fs.existsSync(flags.log)) {
      try { logReady = re.test(fs.readFileSync(flags.log, 'utf8')) } catch { /* file busy — retry */ }
    }
    if (cdpReady && logReady) {
      process.stdout.write(`CDP up${re ? ` and log matched /${flags.until}/` : ''}.\n`)
      process.exit(0)
    }
    await sleep(1000)
  }
  process.stderr.write(
    `Timed out after ${timeoutSec}s: cdpReady=${cdpReady}` + (re ? `, logMatched=${logReady}` : '') + '\n'
  )
  process.exit(1)
}

function cmdRestartHelp() {
  const text = `Restart the HiDock Electron dev app (this script never orphans the server):

  1. Stop the current instance:
       node scripts/dev/app-cycle.mjs stop

  2. Start it in a HARNESS-TRACKED background shell (so it stays stoppable).
     Preferred — Bash tool with run_in_background: true:
       cd apps/electron && npm run dev
     Fallback — devproc (registers the PID so block-kill lets it be stopped later):
       node "${DEVPROC}" run --port ${CDP_PORT} --label hidock-dev -- npm --prefix apps/electron run dev

  3. Wait for CDP to come up (optionally gate on a migration/log line):
       node scripts/dev/app-cycle.mjs wait --timeout 120
       node scripts/dev/app-cycle.mjs wait --timeout 180 --log <devlog> --until "Migration v[0-9]+ complete"

  4. Verify the renderer is live:
       node scripts/dev/cdp.mjs queue-status
`
  process.stdout.write(text)
  process.exit(0)
}

async function main() {
  const [cmd, ...rest] = process.argv.slice(2)
  const flags = parseFlags(rest)
  switch (cmd) {
    case 'status': return cmdStatus()
    case 'stop': return cmdStop(flags)
    case 'wait': return cmdWait(flags)
    case 'restart-help': return cmdRestartHelp()
    case undefined:
    case 'help':
    case '--help':
    case '-h':
      process.stdout.write(fs.readFileSync(import.meta.filename, 'utf8').split('\n').slice(2, 33).join('\n') + '\n')
      process.exit(cmd ? 0 : 2)
      break
    default:
      process.stderr.write(`unknown command: ${cmd}\nrun 'node scripts/dev/app-cycle.mjs help' for usage\n`)
      process.exit(2)
  }
}

main().catch((e) => { process.stderr.write(String(e && e.stack || e) + '\n'); process.exit(1) })
