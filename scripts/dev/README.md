# scripts/dev — deterministic dev toolkit (Electron app)

Two Node ESM tools (Node 26 built-ins only — `fetch`, `WebSocket`, `fs`, `child_process`; no npm
packages) that replace the ad-hoc CDP scratchpad scripts and the manual restart dance
(RETRO F6/F7). They drive the **running** HiDock Electron app over the Chrome DevTools Protocol
(CDP on `:9222`, exposed by electron-vite `npm run dev`).

## app-cycle.mjs — lifecycle

One command instead of "stop task → reap ports → start → wait for CDP". It deliberately does **not**
start the dev server (a script-spawned server would orphan and become unstoppable); `restart-help`
prints the exact start command for the harness to run in a tracked background shell.

- `node scripts/dev/app-cycle.mjs status` — is CDP reachable? Prints browser version + page list. Exit 1 if down.
- `node scripts/dev/app-cycle.mjs stop` — reaps the dev listeners (9222 + the live renderer port, auto-detected, plus 5180/5179/5173) via `~/.claude/hooks/devproc.mjs reap --any`. Tolerates ports already free.
- `node scripts/dev/app-cycle.mjs wait [--timeout <sec>] [--log <file> --until <regex>]` — polls until a renderer page target is up; with `--log`/`--until` also waits for a matching log line (e.g. a migration message). Exit 1 on timeout.
- `node scripts/dev/app-cycle.mjs restart-help` — prints the full stop + tracked-start + wait + verify sequence.

Exit codes: `0` ok, `1` not-reachable/timeout, `2` usage error.

## cdp.mjs — drive the renderer

One entry point; every remote expression is wrapped so it returns a value or `{error}` (never throws),
with a 30s default timeout and a clear hint when CDP is down.

- `node scripts/dev/cdp.mjs eval "<expr>"` — evaluate an expression (awaited), print JSON.
- `node scripts/dev/cdp.mjs screenshot [outPath]` — `Page.captureScreenshot` → PNG (default `scripts/dev/.last-screenshot.png`, gitignored).
- `node scripts/dev/cdp.mjs body-text [maxChars]` — `document.body.innerText` (default 4000).
- `node scripts/dev/cdp.mjs navigate <route>` — click the sidebar link for `#/route` (`today`, `library`, `people`, `calendar`, …); falls back to setting `location.hash`.
- `node scripts/dev/cdp.mjs click-text "<text>"` — click the row/card/button containing the given text.
- `node scripts/dev/cdp.mjs queue-status` — transcription queue counts + in-progress ids.
- `node scripts/dev/cdp.mjs enqueue <n>` — queue the `n` most-recent untranscribed recordings (newest-first by filename date).
- `node scripts/dev/cdp.mjs downloads cancel|reorder|batch <n>` — cancel all; re-queue ALL files-to-sync newest-first; or only the newest `n`. (`reorder`/`batch` read the device file list from `deviceCache.getAll()`.)
- `node scripts/dev/cdp.mjs discover` — `identity.discoverContacts` + `discoverProjects`.

Override the endpoint with `CDP_HOST` / `CDP_PORT` env vars if needed.

## The restart dance

The lifecycle script never orphans a process, so restarting is a short choreography between the
script (stop/wait/verify) and the harness (the tracked start):

```bash
# 1. Stop the running instance (reaps CDP + renderer listeners via devproc)
node scripts/dev/app-cycle.mjs stop

# 2. Start in a HARNESS-TRACKED background shell so it stays stoppable.
#    Preferred: Bash tool with run_in_background: true →  cd apps/electron && npm run dev
#    Fallback (registers PID for block-kill):
#      node ~/.claude/hooks/devproc.mjs run --port 9222 --label hidock-dev -- npm --prefix apps/electron run dev

# 3. Wait for CDP (optionally gate on a log line)
node scripts/dev/app-cycle.mjs wait --timeout 120
# node scripts/dev/app-cycle.mjs wait --timeout 180 --log <devlog> --until "Migration v[0-9]+ complete"

# 4. Verify the renderer is live
node scripts/dev/cdp.mjs queue-status
```

`node scripts/dev/app-cycle.mjs restart-help` prints this exact sequence on demand.

## Journeys

`.claude/skills/verify-journeys/SKILL.md` uses `cdp.mjs` to walk core user journeys (Today, Meeting,
Library, People, Calendar) and score what a user can actually see/do. Run it after every UI round.
