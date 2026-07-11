# Track I — Modular Features, Presets & Performance (Design Spec)

**Date:** 2026-07-11
**Status:** DESIGN — no code changes in this document's commit
**Scope:** `apps/electron` (main + renderer), `packages/connectors`
**Roadmap:** Track I, items I1–I5 (`docs/specs/2026-07-10-nightly-roadmap.md` §Track I)

**Owner's intent (verbatim, condensed):** "Not everyone would like the full-fledged Meeting
Intelligence. Some may not even have the hardware… turn on/off feature by feature — not only the
background tasks but also the UI. No way to disable GitHub, or TO CONFIGURE it — should have been
a connector. Slack, Outlook, ICS all disableable. Disable Assistant, or Explore, or Context Graph,
and therefore People/Projects/Calendar surfaces that depend on the disabled functions. Same with
Actionables. Presets: 'HiDock library management only', 'HiDock + Transcription', 'Full Context
Awareness'. Measure impact of each function on load times, running times, switching surfaces,
processing sources — an optimization path and a hardware guide. Track usage + performance indexes
(from users) to know which services to offer on the web rather than locally."

All file paths below are relative to `apps/electron/` unless prefixed with `packages/`.

---

# Part 1 — Analysis (current state, cited)

## 1. Feature inventory

The app today is a **monolith with no feature flags**: every service starts unconditionally, every
IPC handler registers unconditionally (`electron/main/ipc/handlers.ts:registerIpcHandlers` — 38
registrar calls, L44–86), and the sidebar is a hardcoded constant
(`src/components/layout/Layout.tsx:navigationSections`, L47–78). The only existing per-function
toggles are `config.transcription.autoTranscribe`, `config.calendar.syncEnabled`,
`config.device.autoConnect`/`autoDownload`, and `config.brains.enabled`
(`electron/main/services/config.ts:AppConfig`, L81–150).

### 1.1 Background-task census

**Boot-scheduler one-shots** (`electron/main/services/boot-scheduler.ts:registerBootTask` L81,
`startBootScheduler` L96; sequential, gap 1.5 s, start delay 4 s; per-task ms already logged at
L113). Registered in `electron/main/index.ts` L372–438, kicked on `did-finish-load` + 30 s
fallback (L444–450):

| # | Boot task (name) | Service entry | Feature |
|---|---|---|---|
| 1 | `org-reconcile` | `services/org-reconciler.ts:reconcileOrganization` | Calendar/People (meeting↔recording links, People-from-attendees) |
| 2 | `knowledge-capture-backfill` | `services/knowledge-capture-backfill.ts:backfillKnowledgeCaptures` | Library |
| 3 | `meeting-wiki-backfill` | `services/meeting-wiki.ts:backfillMeetingWiki` | Meeting intelligence |
| 4 | `start-transcription-processor` | `services/transcription.ts:startTranscriptionProcessor` (arms 10 s `setInterval(processQueue, 10000)`, L160) | Transcription |
| 5 | `embeddings-backfill` | `services/vector-store.ts:getVectorStore().backfillMissingTranscripts` | Assistant (embeddings) |
| 6 | `reanalyze-failed-transcripts` | `services/transcription.ts:reanalyzeFailedTranscripts` | Transcription/analysis |

**Persistent loops & watchers** (started in `initializeServices()` / `whenReady`,
`electron/main/index.ts` L151–213, 337–350):

| Loop | Where started | Cadence | Feature |
|---|---|---|---|
| Recording watcher (`services/recording-watcher.ts:startRecordingWatcher`) | `index.ts:349` | fs event-driven | Library + Device sync funnel |
| Transcription queue (`services/transcription.ts`) | boot task #4 | 10 s interval, mutex 1-at-a-time | Transcription |
| Calendar ICS auto-sync (`ipc/calendar-handlers.ts:initializeCalendarAutoSync`) | `index.ts:203` | `config.calendar.syncIntervalMinutes` (default 15 min) `setInterval` (calendar-handlers L162) | Calendar |
| Graph sync (`services/graph-sync.ts:startGraphSync`) | `index.ts:193` | event-driven (`entity:transcript-ready`, `entity:contact-changed`), debounced ingest `INGEST_DEBOUNCE_MS = 60_000` (L88) | Context Graph |
| Connector host silent resume (`services/connectors/index.ts:initConnectors`) | `index.ts:208` | boot once + on-demand sync | Connectors (M365/Slack) |
| Clipboard watch (`services/clipboard-capture.ts:startClipboardWatch`, 1.5 s poll `DEFAULT_WATCH_INTERVAL_MS`, L56) | user toggle via `ipc/clipboard-capture-handlers.ts:37` | 1.5 s poll while enabled | Clipboard capture |
| Storage policy (`services/storage-policy.ts`) | `index.ts:184 getStoragePolicyService()` | event-driven (`QualityAssessedEvent`) | Storage tiers |
| Vector store + RAG init (`index.ts:174–181 getVectorStore().initialize()` / `getRAGService().initialize()`) | boot, blocking splash | once | Assistant |
| Integrity checks (`services/integrity-service.ts:runStartupChecks`) | `index.ts:167` | boot once | Core |
| Device pipeline (`services/device-pipeline.ts:DevicePipelineService`) | lazy on first `device-pipeline:*` IPC (`ipc/device-pipeline-handlers.ts:24`) — additive-only, not yet the sole USB initiator | phase machine | Device sync |

**On-demand (IPC-triggered) heavy work:** identity discovery
(`services/identity-discovery.ts:discoverContactMerges` L364, `discoverProjectMerges` L470, via
`ipc/identity-handlers.ts:195`), timeline analysis
(`services/timeline-analysis.ts:analyzeTimeline` via `ipc/timeline-handlers.ts`), recurring topics
(`services/recurring-topics.ts:getRecurringTopics` via `ipc/database-handlers.ts:88
db:get-recurring-topics`), git commits (`services/git-commits.ts:getTodayCommits` via
`ipc/git-commits-handlers.ts:22 commits:today`), quality assessment
(`services/quality-assessment.ts` via `ipc/quality-handlers.ts`), re-diarize, transcript-upgrade,
handover, outputs.

### 1.2 Feature → footprint table (the registry's source data)

| Feature id (proposed) | Background tasks | IPC namespaces | DB tables owned | UI surfaces (routes / nav) | Depends on |
|---|---|---|---|---|---|
| **core** (not disableable) | integrity checks, storage policy, config, event bus | `app:` `config:` `db:` `storage:` `integrity:` `migration:`/`repair:` `brains:` | `config`, `schema_version`, migration backups | `/settings`, Layout shell | — |
| **library** (not disableable — the product floor) | recording watcher, knowledge-capture backfill (boot #2) | `knowledge:` `recordings:` (read), `artifacts:` `waveform:` `outputs:` `handover:` | `recordings`, `knowledge_captures`, `artifacts`, `outputs`, `audio_sources` | `/library` (nav: Library) | core |
| **device-sync** | device pipeline, download service, jensen, device cache | `jensen:` `device-pipeline:` `deviceCache:` + download channels (`services/download-service.ts:registerDownloadServiceHandlers`) | `synced_files`, `download_queue`, `device_files_cache`, `deletion_journal` | `/sync` (nav: Sync, section DEVICE) | core, library |
| **transcription** | queue processor (boot #4), reanalyze (boot #6) | `transcription:` `transcripts:` `re-diarize` + `turn-speakers:` `self-id:` `transcript-upgrade:` `quality:` | `transcripts`, `transcription_queue`, `transcription_service_lock`, `transcript_speakers`, `speaker_splits`, `turn_speaker_overrides`, `quality_assessments` | transcript panes inside Library/Meeting detail | library |
| **calendar** | ICS auto-sync loop, org-reconcile (boot #1) | `calendar:` `meetings:` `briefing:` (meetings part) | `meetings`, `meeting_contacts`, `meeting_projects`, `recording_meeting_candidates`, `recording_preassignments` | `/calendar`, `/meeting/:id` (nav: Calendar) | core; enriched by connectors (ICS/M365) |
| **meeting-intelligence** (actionables & analysis) | meeting-wiki backfill (boot #3), timeline analysis, quality auto-assess | `actionables:` `actionItems:` `recordings:getTimelineAnalysis`/`:analyzeTimeline` | `actionables`, `action_items`, `decisions`, `follow_ups`, `capture_action_items` | `/actionables` (nav: Actionables, section ACTIONS); timeline strip in players | transcription |
| **assistant** | vector store + RAG init, embeddings backfill (boot #5) | `assistant:` `rag:` | `conversations`, `conversation_context`, `chat_messages`, `embeddings`, `vector_embeddings` | `/assistant` (nav: Assistant); `GlobalAssistant` floating button (`src/App.tsx:46`) | transcription (content), brains |
| **context-graph** | graph-sync event loop | `contextGraph:` `graph:` | `graph_nodes`, `graph_edges`, `graph_ingested_transcripts` (via `@hidock/knowledge-graph`), `knowledge_projects` | `/context-graph` (nav: Context Graph) | transcription |
| **people-projects** | identity discovery (on-demand), org-reconciler People creation | `contacts:` `projects:` `identity:` | `contacts`, `contact_aliases`, `identity_suggestions`, `mention_resolutions`, `merge_journal`, `projects`, `project_aliases`, `project_notes` | `/people`, `/person/:id`, `/projects` (nav: People, Projects) | calendar (attendees), context-graph (merge signals — soft) |
| **explore** | none (recurring-topics is on-demand aggregation) | `db:get-recurring-topics` passthrough | — | `/explore` (nav: Explore) | transcription |
| **today** | briefing; composes commits/captures/meetings | `briefing:` `commits:` `clipboard:` | — | `/today` (nav: Today) | core; degrades per enabled features |
| **clipboard-capture** | 1.5 s clipboard poll (opt-in) | `clipboard:` | (captures land in `knowledge_captures`) | capture toast; Settings toggle | library |
| **connector: m365 / slack** | silent resume + on-demand sync | `connectors:` | none (state in `connectors.json` via `services/connectors/connector-store.ts:ConnectorStore`) | Settings → Connectors (`src/components/settings/ConnectorsSettings.tsx`) | core |
| **connector: github (TO BE BUILT — see §2)** | none today; polling TBD | `commits:` today | none | Today "Commits today" card | today |

Dependency proof points: Assistant → RAG → embeddings/vector/brains (`services/rag.ts:6–12`
imports `getVectorStore`, `getChatLLMService`, `getEmbeddingsService`, `BrainId`);
People/Projects → identity + org-reconciler (`ipc/identity-handlers.ts:35–36` imports
`discoverContactMerges`/`discoverProjectMerges` + `autoSplitAmbiguousBuckets`); Explore →
transcripts (`src/pages/Explore.tsx:99` → `db:get-recurring-topics` →
`services/recurring-topics.ts`); Actionables ← transcription analysis
(`services/transcription.ts` writes action_items/decisions; `services/timeline-analysis.ts`
fuses them into event markers); device-sync → transcription funnel
(`services/device-pipeline-instance.ts:18` imports `queueTranscriptionIfEnabled`); graph ←
transcripts (`services/graph-sync.ts` subscribes `entity:transcript-ready`).

## 2. Connector reality check — and the GitHub gap

### What exists (the good half)

- **Contract:** `packages/connectors/src/types.ts` is canonical. `ConnectorDescriptor` (L323) —
  id, displayName, auth, `configFields` (with `secret`/`advanced` flags), `capabilityKinds`,
  `multiInstance`, `setupOptional`. Four capability surfaces: `IdentityProvider`,
  `SourceProvider`, `ActionProvider`, `SignalProvider` (L246–280). `ConnectorHost` registry +
  lifecycle lives in `packages/connectors/src/registry.ts`.
- **Host wiring:** `electron/main/services/connectors/index.ts:buildHost` registers M365
  (`m365Descriptor`, L33) and Slack (`@hidock/connectors-slack`, defensively, L38–47).
  `initConnectors()` (L62) does a silent, non-interactive resume at boot.
- **State/secrets:** `services/connectors/connector-store.ts:ConnectorStore` — config + cursors in
  `<userData>/connectors.json`; secrets under `_secrets` encrypted with `safeStorage` (L28–48);
  per-source `enabled` flag already exists (`StoredSourceState.enabled`, types.ts L416).
- **Settings UI:** `src/components/settings/ConnectorsSettings.tsx` drives configure / connect /
  disconnect / removeInstance / setInstanceLabel through `window.electronAPI.connectors.*`
  (L190–246) against `ipc/connectors-handlers.ts`.

So the framework the owner asked for **already exists** — GitHub and ICS simply don't use it.

### The GitHub gap (evidence)

The Today page's "Commits today" feature bypasses the connector contract entirely:

1. **Standalone service, not a Connector.** `services/git-commits.ts:getTodayCommits` (L160) shells
   out to read-only `git log`. It implements none of `Connector`/`ConnectorDescriptor`; it is not
   registered in `services/connectors/index.ts:buildHost` (only M365 + Slack are).
2. **No configuration anywhere.** Repo paths default to `process.cwd()` when the caller passes
   none (`git-commits.ts` L162–165: `options.repoPaths && … ? options.repoPaths :
   [process.cwd()]`) — i.e. *the directory the Electron app was launched from*, which is
   meaningless in a packaged install. There is no `AppConfig` section for repos
   (`config.ts:AppConfig` has none) and no `connectors.json` entry.
3. **No toggle.** `ipc/git-commits-handlers.ts:registerGitCommitsHandlers` (L21) registers
   `commits:today` unconditionally from `ipc/handlers.ts:83`. `ConnectorsSettings.tsx` does not
   list GitHub; no Settings surface mentions it.
4. **Renderer hardwired.** `src/pages/Today.tsx:1215` renders `<TodayCommits />`
   (`src/features/today/TodayCommits.tsx:83`) with **no `repoPaths` prop**, so every user always
   gets the `process.cwd()` behavior, always on.

The contract even anticipates this connector: `GraphSignal.type` documents `'commit'` as an
example (`packages/connectors/src/types.ts:235`) and `SourceContainer.kind` documents `'repo'`
(L131).

### ICS / Outlook

ICS calendar sync is likewise **pre-connector plumbing**: URL + toggle live in
`config.calendar` (`config.ts` L89–94, ICS URL encrypted per CS-007, L62–79), the loop lives in
`ipc/calendar-handlers.ts:initializeCalendarAutoSync`, and Settings edits raw config — not a
`ConnectorDescriptor`. It *does* at least have `syncEnabled`. M365 calendar already flows through
the connector host (`ExternalMeeting`, types.ts L105), so ICS is the odd one out.

## 3. Perf measurement points (what's already cheap to capture)

| Dimension | Existing hook | Citation |
|---|---|---|
| Boot job cost | Boot scheduler **already logs per-task ms**: `` log(`"${task.name}" done in ${Date.now() - startedAt}ms`) `` | `boot-scheduler.ts:109–113` |
| Boot phases | `initializeServices()` runs sequential named phases with splash updates (config → storage → DB → integrity → vector → RAG → policy → IPC) — timing wrap is one function | `index.ts:151–213` |
| IPC latency (renderer→main) | **Single choke point**: every `window.electronAPI.*` call funnels through `const callIPC = async (channel, ...args)` in the preload | `electron/preload/index.ts:102` |
| IPC handler cost (main) | Single registrar `registerIpcHandlers()` — a wrapping `handle()` shim covers all 38 handler files without touching them | `ipc/handlers.ts:42` |
| Surface switch | React Router `<Routes>` in one place + existing `RoutePersistence` component that already observes every location change | `src/App.tsx:144–145` |
| Queue / source processing | Transcription processor is mutex-gated one-item-at-a-time inside `processQueue` (start/end per item is one span); download service and embeddings backfill likewise per-item | `services/transcription.ts:148–169`; boot job #5 |
| Feature-tagged logging convention | `[QA-MONITOR]` gated logging via `useUIStore.getState().qaLogsEnabled` already established; preload `callIPC` already does QA-MONITOR gating | CLAUDE.md QA rules; `preload/index.ts:77` |

Missing entirely: persistence of any timing (all console-only), per-feature attribution,
navigation timing, and any user-visible report.

---

# Part 2 — Design

## A. Feature Registry (single source of truth)

### A.1 Shape

New shared module consumed by BOTH processes — `src/shared/feature-registry.ts` (imported by main
via relative path, like existing shared types):

```typescript
export type FeatureId =
  | 'device-sync' | 'transcription' | 'calendar' | 'meeting-intelligence'
  | 'assistant' | 'context-graph' | 'people-projects' | 'explore'
  | 'today' | 'clipboard-capture'
  | 'connector:m365' | 'connector:slack' | 'connector:github' | 'connector:ics'
// 'core' and 'library' are NOT FeatureIds — they are the permanent floor.

export type HardwareCost = 'light' | 'medium' | 'heavy'  // static estimate, refined by perf-meter data

export interface FeatureDefinition {
  id: FeatureId
  label: string                 // "Meeting Intelligence"
  description: string           // one sentence, Settings card copy
  /** Boot-scheduler task names + persistent loop ids this feature owns (main enforces). */
  backgroundTasks: string[]     // e.g. ['start-transcription-processor', 'reanalyze-failed-transcripts']
  /** Route paths owned (renderer redirects) and nav hrefs hidden when disabled. */
  routes: string[]              // e.g. ['/actionables']
  navItems: string[]            // usually same hrefs; kept separate for embedded surfaces
  /** IPC channel prefixes gated fail-closed when disabled. */
  ipcNamespaces: string[]       // e.g. ['actionables:', 'actionItems:']
  /** Hard dependencies: disabling a dependency soft-disables this feature. */
  dependsOn: FeatureId[]
  /** Static cost estimate shown in Settings before real perf data exists. */
  hardwareCost: { cpu: HardwareCost; memory: HardwareCost; network: HardwareCost }
  /** True if enabling/disabling takes effect live; false = needs restart (§B.3). */
  runtimeToggleable: boolean
}

export const FEATURES: Record<FeatureId, FeatureDefinition> = { /* from §1.2 table */ }
```

The §1.2 table is transcribed 1:1 into `FEATURES`. Population rules:

- `backgroundTasks` uses the **existing boot-task names** (`org-reconcile`,
  `embeddings-backfill`, …) plus new stable ids for persistent loops
  (`loop:calendar-auto-sync`, `loop:graph-sync`, `loop:recording-watcher`,
  `loop:clipboard-watch`, `loop:transcription-processor`).
- `ipcNamespaces` uses the prefixes from §1.2. Where a handler file mixes namespaces owned by
  different features (`recording-handlers.ts` serves both library reads and transcription
  triggers; `timeline-handlers.ts` registers under `recordings:`), gate at **channel** granularity:
  the registry may list full channel names (`recordings:analyzeTimeline`) alongside prefixes. The
  gate treats an entry ending in `:` as a prefix, otherwise as an exact channel.
- Shared/core namespaces (`config:`, `db:`, `app:`, `knowledge:`, `storage:`) are never gated.

Dependency graph (must stay a DAG; a unit test asserts acyclicity):

```
transcription ──▶ meeting-intelligence
      │────────▶ assistant
      │────────▶ context-graph
      │────────▶ explore
calendar ──────▶ people-projects        (attendee-sourced People)
context-graph ─▶ people-projects [soft] (merge-signal quality only — see A.4)
library ───────▶ device-sync, transcription, clipboard-capture   (library = always on)
today ─────────▶ (none hard; composes whatever is enabled)
connector:ics ─▶ feeds calendar        (calendar works without it, degraded)
connector:github ▶ feeds today          (commits card)
```

Note the direction People/Projects: the owner said "disable Context Graph, and therefore
People/Projects/Calendar surfaces that depend on the disabled functions". Analysis shows
People/Projects' *hard* input is meetings/attendees (org-reconciler) and identity-discovery;
the graph only *boosts* merge confidence (`identity-discovery.ts` graph signal). So Context Graph
→ People is a **soft** dependency: disabling Context Graph keeps People but degrades suggestion
quality (badge, not removal). Disabling **Calendar** soft-disables People/Projects' auto-creation
while keeping manual CRUD. This honesty is exactly what "soft-disable with 'requires X'
surfacing" is for.

### A.2 Flag storage

New `AppConfig.features` section (`config.ts:AppConfig`):

```typescript
features: {
  preset: 'library-only' | 'library-transcription' | 'full' | 'custom'
  flags: Partial<Record<FeatureId, boolean>>   // sparse overrides; unset = preset default
}
```

- Persisted by the existing atomic writer (`config.ts:writeConfigAtomically`, L41) — no new file.
- **Effective state** = preset baseline → apply `flags` overrides → apply dependency cascade
  (§A.4). Computed by one pure function `resolveFeatureState(config): Record<FeatureId,
  {enabled: boolean; reason?: 'user' | 'preset' | `requires:${FeatureId}`}>` in the shared
  module — unit-testable, no Electron imports.
- Default preset for existing installs: `full` (zero behavior change on upgrade). New installs:
  onboarding asks (out of scope here; default `full`).

### A.3 Enforcement — four gates, all reading the same resolver

**Gate 1 — background tasks (main).** In `index.ts`, each `registerBootTask` call and each loop
start is wrapped: `if (isFeatureEnabled('transcription')) registerBootTask({name:
'start-transcription-processor', …})`. For runtime toggling, each persistent loop must expose a
stop function — most already do: `stopTranscriptionProcessor` (`transcription.ts:169`),
`stopAutoSync` (calendar-handlers), `stopClipboardWatch` (clipboard-capture). Graph-sync needs a
`stopGraphSync()` added (unsubscribe from the event bus). A small
`feature-lifecycle.ts` maps featureId → `{start, stop}` and reacts to flag changes broadcast on
the event bus (`services/event-bus.ts`).

**Gate 2 — IPC (main, fail-closed).** One wrapper in `ipc/handlers.ts` — the single registrar is
the choke point:

```typescript
// feature-gate.ts (main)
export class FeatureDisabledError extends Error {
  constructor(public featureId: FeatureId, channel: string) {
    super(`Feature "${featureId}" is disabled (channel ${channel}). Enable it in Settings → Features.`)
    this.name = 'FeatureDisabledError'
  }
}
```

Implementation: monkey-patch is NOT used; instead `registerIpcHandlers()` installs a
`gatedHandle(channel, fn)` helper exported from `feature-gate.ts` and handler files migrate to it
incrementally (Phase 2 wraps at the registrar level via `ipcMain.handle` interception is rejected
— Electron gives no clean interception; instead the gate is checked inside a shared shim that
handler files import). Until a handler file migrates, its feature is restart-gated only (its
registration is skipped when the feature is disabled at boot — that alone is fail-closed).
Renderer sees a rejected promise with the clear error message (Electron propagates thrown
errors); the preload `callIPC` (L102) additionally tags these so stores can distinguish
"disabled" from "failed".

**Gate 3 — routes (renderer, honest redirect).** A `<FeatureRoute feature="actionables">` wrapper
in `src/App.tsx` around each owned route. When disabled it renders a **FeatureDisabledPage** —
not a silent redirect: feature name, why it's off (`user` vs `requires:transcription`), and an
"Enable in Settings" button deep-linking to Settings → Features. Deep links (`/meeting/:id` when
calendar is off) get the same page — never a blank screen or crash.

**Gate 4 — nav + embedded surfaces (renderer).** `navigationSections` (`Layout.tsx:47`) becomes a
function of the resolved state: items whose feature is disabled are **removed**; items whose
feature is soft-disabled (dependency) are shown grayed with a "requires Transcription" tooltip —
per the owner: cascade must surface, not silently remove. Embedded surfaces (GlobalAssistant
button `App.tsx:46`, TodayCommits card `Today.tsx:1215`, timeline strip) check the same store:
`const enabled = useFeatureStore((s) => s.isEnabled('assistant'))`. Renderer store
(`src/store/useFeatureStore.ts`) hydrates from `config:get` and subscribes to a
`features:changed` push event (event-bus → `mainWindow.webContents.send`).

### A.4 Cascade semantics

- **Hard dependency** (`dependsOn`): disabling X *soft-disables* every feature that hard-depends
  on X (transitively). Soft-disabled = behaves exactly like disabled (all four gates) but the
  Settings card and grayed nav item show "requires X" and re-enable automatically when X returns.
  The user's own flag for the dependent feature is **preserved** — turning transcription back on
  restores Assistant to whatever the user had chosen.
- **Soft dependency** (Context Graph → People suggestion quality): no gating; the dependent
  surface renders a quality note ("Merge suggestions are less accurate without Context Graph").
  Registered in the definition as `softDependsOn` (informational only).
- **Cycle safety:** resolver is iterative fixpoint over the DAG; unit test asserts no cycles in
  `FEATURES`.

## B. Presets

### B.1 The three named presets + custom

| Preset id | Label | Enabled features |
|---|---|---|
| `library-only` | **HiDock Library Management** | core, library, `device-sync` — nothing else. Nav: Today (degraded: recordings only), Library, Sync, Settings |
| `library-transcription` | **HiDock + Transcription** | + `transcription` (and its Settings surfaces: quality, speakers, re-diarize) |
| `full` | **Full Context Awareness** | everything, including connectors the user has configured |
| `custom` | **Custom** | any user-edited flag set; selecting a named preset then flipping one flag switches the selector to `custom` (flags snapshot preserved) |

Presets are just named flag-sets: `const PRESETS: Record<PresetId, FeatureId[]>` in the shared
registry module. Connectors default OFF in every preset until configured (a configured connector
in `connectors.json` counts as user intent → enabled unless flagged off).

### B.2 Applying a preset

`config:update-section('features', {preset, flags: {}})` → main recomputes resolved state → diffs
old vs new per feature → for each changed feature: if `runtimeToggleable`, run its
`feature-lifecycle` start/stop now; else mark it in a `pendingRestart` set. Broadcast
`features:changed {resolved, pendingRestart}`; renderer updates nav/routes instantly and shows a
restart banner listing only the features that need it.

### B.3 Runtime vs restart — explicit per feature

| Feature | Runtime-toggleable? | Why |
|---|---|---|
| transcription | **Yes** | `startTranscriptionProcessor`/`stopTranscriptionProcessor` exist (`transcription.ts:148/169`); queue survives pause |
| calendar | **Yes** | `initializeCalendarAutoSync`/`stopAutoSync` exist (calendar-handlers) |
| clipboard-capture | **Yes** | already a runtime toggle (`clipboard-capture-handlers.ts:37`) |
| context-graph | **Yes (off) / Yes (on)** | needs new `stopGraphSync()` (event-bus unsubscribe); ingest debounce timer cleared |
| assistant | **Enable: restart. Disable: runtime.** | vector store + RAG init are boot-blocking in `initializeServices()` (`index.ts:174–181`); disable just gates IPC/UI. Enabling mid-session would need lazy init — deferred to keep Phase 2 small; revisit after perf-meter shows init cost |
| device-sync | **Yes** | pipeline is lazy (`device-pipeline-handlers.ts:24`); disable = stop pipeline + skip watcher's device funnel; USB safety: disable only in IDLE phase, else queued until the phase machine reaches IDLE (never yank mid-transfer — CLAUDE.md USB rules) |
| meeting-intelligence, explore, today, people-projects | **Yes** | on-demand IPC only; no loops to stop |
| connectors (each) | **Yes** | host already supports connect/disconnect per instance (`registry.ts` lifecycle) |
| boot-scheduler one-shots | n/a | next boot simply doesn't register them; disabling mid-run does not cancel an in-flight task (they're short and idempotent) |

## C. Connector unification (GitHub, ICS join M365/Slack)

### C.1 GitHub connector (`connector:github`)

New package-level connector `packages/connectors-github/` (mirroring
`packages/connectors-slack/` structure — `contract.ts`, `sync.ts`, `types.ts`):

- **Descriptor:** `id: 'github'`, `transport: 'native'`, `auth: {kind: 'none'}` for local-repo
  mode (Phase 1: local `git log` needs no token) with an `advanced` optional `token` secret field
  for a later GitHub-API mode. `configFields`: `repoPaths` (multiline text; validated as existing
  dirs), `pollMinutes` (number, default 0 = on-demand only). `capabilityKinds: ['sources',
  'signals']`.
- **SourceProvider:** `listContainers()` → one `SourceContainer {kind: 'repo'}` per resolved repo
  root (reusing `git-commits.ts:getRepoInfo`); `pull()` → commits since cursor as `SourceItem
  {kind: 'commit'}` + `GraphSignal {type: 'commit'}` (both already anticipated by the contract —
  types.ts L131, L235).
- **Registration:** one line in `services/connectors/index.ts:buildHost`, same defensive
  `require` pattern as Slack (L38–47).
- **Migration of the hardwired feature:** `services/git-commits.ts` stays as the pure git-reading
  core (it's well-tested and read-only); the connector wraps it. `ipc/git-commits-handlers.ts`
  `commits:today` changes to: resolve repo paths from the github connector's config
  (`getConnectorStore().getConfig('github').repoPaths`) instead of `process.cwd()`; return
  `{success: true, commits: [], disabled: true}` when `connector:github` is disabled/unconfigured.
  `TodayCommits.tsx` hides the card when `disabled` (and Today shows nothing rather than an empty
  scaffold). No DB migration needed (feature has no tables).
- **Config migration:** none required — current behavior (`process.cwd()`) is meaningless in
  production, so there is nothing worth preserving; fresh default = unconfigured/off. This is a
  deliberate, documented behavior change.

### C.2 ICS connector (`connector:ics`)

Wrap existing ICS sync in a descriptor registered in the same host: `id: 'ics'`,
`auth: {kind: 'none'}`, `configFields`: `icsUrl` (secret — it embeds a private token; today
encrypted via CS-007, `config.ts:62`), `syncIntervalMinutes`. `capabilityKinds: ['sources']`
emitting `SourceItem {kind: 'meeting', entity: ExternalMeeting}` — the ingestion sink already
routes meetings to calendar-sync (`types.ts:474` IngestionSink doc).

**Config migration (this one is real):** on first boot with the new code, if
`config.calendar.icsUrl` is set, copy it into `connectors.json` under `ics` (secret-encrypted via
`ConnectorStore.setSecret`), map `syncEnabled` → connector enabled flag, then blank the legacy
fields and leave a `calendarMigratedToConnector: true` marker. The calendar auto-sync loop
switches its source of truth to the connector store. Rollback safety: marker + one-release
retention of the legacy encrypted value (mirroring the Gemini-key migration pattern,
`config.ts:migrateGeminiKeyToCredentialStore`, L330).

### C.3 Per-connector enable toggles

Add `enabled: boolean` to `StoredConnectorState` (additive, default true when configured —
matches the contract's "additive changes only" rule, types.ts header). `ConnectorHost` skips
sync/resume for disabled instances; `ConnectorsSettings.tsx` gains an on/off switch per instance
card next to the existing Connect/Disconnect. The feature registry exposes each connector as
`connector:<id>` so the Features panel and the connectors panel stay consistent (one reads the
other; connector flags live in `connectors.json`, mirrored into resolved feature state).

## D. Perf instrumentation (`perf-meter`)

### D.1 Core: feature-tagged spans

New main-process module `services/perf-meter.ts` + a thin renderer mirror. Not a tracing
framework — a ring buffer of closed spans with periodic aggregation:

```typescript
export type SpanKind = 'boot-phase' | 'boot-task' | 'loop-run' | 'ipc' | 'surface-switch' | 'source-process'
export interface PerfSpan {
  kind: SpanKind
  feature: FeatureId | 'core' | 'library'
  name: string          // 'org-reconcile', 'recordings:list', '/library', 'transcribe:<ext>'
  startedAt: number     // epoch ms
  durMs: number
  meta?: Record<string, number | string>  // e.g. {items: 12, bytes: 1048576} — NEVER content
}
export function span(kind: SpanKind, feature: string, name: string): () => void  // returns end()
```

Storage: in-memory ring (last 2 000 spans) + hourly aggregation into a new DB table
`perf_rollups (day, kind, feature, name, count, total_ms, p50_ms, p95_ms, max_ms)` — one
`SCHEMA_VERSION` bump owned by the perf phase (per `.claude/rules/database-migrations.md`).
Raw spans are never persisted; rollups are tiny and local-only. A `perfMeterEnabled` config flag
(default **on** — it's cheap; the QA-logs toggle governs console echo only).

### D.2 Capture points (each maps to an existing hook from §3)

1. **Boot phases:** wrap each step of `initializeServices()` (`index.ts:151`) —
   `span('boot-phase','core','db-init')` etc. Also one `boot-total` span from `whenReady` to
   `did-finish-load`.
2. **Boot tasks:** `startBootScheduler({log})` already measures ms (`boot-scheduler.ts:113`);
   add an optional `onTaskDone(name, ms, ok)` callback in `BootSchedulerOptions` so the meter
   records without parsing log strings. Task-name → feature comes from the registry's
   `backgroundTasks`.
3. **Loop runs:** each loop body wraps itself: `processQueue` per pass + per item
   (`transcription.ts`), calendar sync per run, graph ingest per debounce flush, connector
   `pull()` per container.
4. **IPC:** main-side in the `gatedHandle` shim (§A.3 Gate 2) — channel → feature via the same
   namespace map used for gating; renderer-side `callIPC` (`preload/index.ts:102`) records
   round-trip and posts batched samples to main every 30 s (`perf:samples` channel).
5. **Surface switch:** in `RoutePersistence` (`src/App.tsx:144`) — on location change, record
   `t0`; the target page's top-level Suspense/`useEffect` posts "settled" (a shared
   `useSurfaceSettled(route)` hook); `durMs = settled - t0`. Feature from the registry's `routes`.
6. **Source processing:** one `source-process` span per artifact/recording through its pipeline
   (download → transcribe → analyze → embed → ingest), tagged per stage feature so the report can
   say "each hour of audio costs: transcription X s, embeddings Y s, graph Z s".

### D.3 Report surface — Settings → Performance

New Settings tab reading `perf:report` IPC (aggregates from `perf_rollups`):

- **Per-feature cost table** (the optimization path / hardware guide): rows = features; columns =
  boot cost (ms), background cost (ms/day), IPC p95 (ms), surface-switch p95 (ms), source cost
  (s/item). A "What if I turn this off?" column = its measured totals — turning the owner's
  question into literal numbers.
- **Boot waterfall** for the last boot (phases + tasks in order, ms bars).
- **Hardware class line** (cores, RAM bucket, platform — from `os` module) so users can compare
  against the docs' hardware guide.
- Export button → JSON to clipboard/file (feeds the docs' hardware guide; also the exact payload
  telemetry would send, building trust through transparency).

No external sending from this section — display + local export only.

## E. Telemetry (separate, opt-in, off by default)

Strictly separated from perf-meter: perf-meter is local and default-on; telemetry is
**network and default-OFF**.

- **Consent:** explicit screen (first run after upgrade + Settings → Privacy), unchecked by
  default, one sentence per data category, "See exactly what would be sent" opens the live JSON
  (same payload as the D.3 export). Stored as `telemetry: {enabled: false, consentAt: string |
  null, installId: string}` in config. `installId` = random UUID minted at consent, revocable
  ("Reset ID"), never derived from hardware.
- **Payload schema (documented in the spec + shown in-app):**

```jsonc
{
  "schema": 1,
  "installId": "uuid-v4",            // random, user-resettable
  "appVersion": "1.0.0",
  "platform": "win32|darwin|linux",
  "hardwareClass": { "cpuCores": 8, "ramGB": 16, "gpu": "none|cuda|metal" },
  "preset": "library-transcription",
  "featuresEnabled": ["device-sync", "transcription"],
  "connectorsConfigured": ["ics"],   // ids only, never config/values
  "perfIndexes": {                   // per-feature aggregates only — no names, paths, or counts of user content beyond coarse buckets
    "bootTotalMs": {"p50": 4200, "p95": 6100},
    "byFeature": { "transcription": {"bgMsPerDay": 180000, "ipcP95Ms": 45, "sourceSecPerItem": 95} }
  },
  "usage": { "surfaceOpensPerDay": {"library": 14, "assistant": 0} }  // counts only
}
```

  Explicitly excluded: file names/paths, transcript/meeting/contact content, URLs, emails,
  connector config, repo names, error strings, IP-derived location.
- **Transport:** batched weekly, HTTPS POST, fire-and-forget with local queue; endpoint is a
  config constant left empty until a backend exists — with no endpoint the pipeline no-ops (so
  I5 can ship UI + schema before any server).
- **Why (service-offering rationale, per the owner):** aggregate `perfIndexes` × `hardwareClass`
  answers "which functions are too heavy for typical user hardware" — those are the candidates to
  offer as hosted/web services (e.g. if transcription `sourceSecPerItem` is 10× worse on
  4-core/8 GB machines and Assistant usage is near-zero locally, transcription is the web-service
  candidate, Assistant is not). `featuresEnabled` distributions answer "what do people actually
  turn on" → preset tuning and packaging.

## F. Phased build plan

Gates for every phase (per `.claude/rules/agent-dispatch.md`): `npm run typecheck` + `npm run
lint` (0 errors) + full `npm run test:run` green; journey walk on changed surfaces.

| Phase | Deliverable | File ownership (disjoint) | Tests |
|---|---|---|---|
| **I2-a Registry + resolver** | `src/shared/feature-registry.ts` (FEATURES, PRESETS, `resolveFeatureState`), `AppConfig.features` section + defaults | `src/shared/feature-registry.ts` (new), `electron/main/services/config.ts` | Pure unit tests: resolver, cascade fixpoint, DAG acyclicity, preset flag-sets; config migration default = `full` |
| **I2-b Main enforcement** | `feature-gate.ts` (`isFeatureEnabled`, `gatedHandle`, `FeatureDisabledError`), `feature-lifecycle.ts` (start/stop map incl. new `stopGraphSync`), gate boot tasks + loops in `index.ts` | `electron/main/services/feature-gate.ts`, `feature-lifecycle.ts` (new), `electron/main/index.ts`, `services/graph-sync.ts`, `ipc/handlers.ts` | Unit: gatedHandle rejects with FeatureDisabledError; lifecycle start/stop idempotence; integration: boot with `library-only` registers 0 gated tasks |
| **I2-c Renderer enforcement** | `useFeatureStore`, `<FeatureRoute>` + FeatureDisabledPage, nav filtering + grayed "requires X" items, embedded-surface checks (GlobalAssistant, TodayCommits, timeline strip) | `src/store/useFeatureStore.ts` (new), `src/App.tsx`, `src/components/layout/Layout.tsx`, `src/components/FeatureDisabledPage.tsx` (new) | Component tests: nav hides/grays; route renders disabled page; deep link `/meeting/:id` with calendar off shows honest page |
| **I3 Settings panel + presets** | Settings → Features (cards grouped by §1.2 sections, preset selector, restart banner, cascade badges) | `src/components/settings/FeaturesSettings.tsx` (new), `src/pages/Settings.tsx` (tab registration only) | Component tests: preset switch → flags; flipping one flag → `custom`; restart banner lists only non-runtime features |
| **I3-b Connector unification** | `packages/connectors-github/` (new), ICS descriptor + config migration, `enabled` toggle in store/host/UI, `commits:today` re-source | `packages/connectors-github/*`, `services/connectors/*`, `ipc/git-commits-handlers.ts`, `ipc/calendar-handlers.ts`, `src/components/settings/ConnectorsSettings.tsx`, `src/features/today/TodayCommits.tsx` | Unit: github pull/cursor vs mocked git; ICS migration idempotence + rollback marker; host skips disabled instances |
| **I4 Perf-meter + report** | `services/perf-meter.ts`, capture points (boot phases, `onTaskDone` in boot-scheduler, callIPC batching, gatedHandle timing, `useSurfaceSettled`), `perf_rollups` table (**owns the SCHEMA_VERSION bump**), Settings → Performance | `services/perf-meter.ts` (new), `services/boot-scheduler.ts` (options only), `electron/preload/index.ts` (callIPC), `services/database.ts` (schema bump + version-test assertion), `src/components/settings/PerformanceSettings.tsx` (new), `src/App.tsx` (RoutePersistence hook) | Unit: span/rollup math (p50/p95), ring-buffer bounds; schema-version test updated in same change; report renders from fixture rollups |
| **I5 Telemetry** | Consent screen, payload builder (reuses D.3 export), local queue, no-op transport | `services/telemetry.ts` (new), `src/components/settings/PrivacySettings.tsx` (new), config `telemetry` section | Unit: payload contains ONLY schema fields (snapshot test against allowlist); disabled ⇒ zero network; consent revocation purges queue + installId |

**Recommended phase-1 slice:** I2-a + I2-b + I2-c together (registry is inert without
enforcement, enforcement is invisible without nav/routes) with only the **three presets + no
per-feature UI** — preset switching via a minimal Settings dropdown. That alone delivers the
owner's headline ("HiDock library management only" actually stops transcription, assistant,
graph, calendar work) and is safely shippable behind default `full`.

### Risks & mitigations

1. **Route guards vs deep links** — internal links to disabled surfaces (meeting links from
   Library when calendar is off, person chips when People is off). Mitigation: FeatureDisabledPage
   for routes + a `useFeatureLink()` helper that renders such links as plain text with tooltip;
   journey-walk each preset (verify-journeys) as the phase gate.
2. **Cascade UX confusion** — user disables transcription and "loses" five surfaces. Mitigation:
   confirm dialog listing the cascade before applying ("Turning off Transcription also pauses:
   Meeting Intelligence, Assistant, Context Graph, Explore"); grayed nav (not removed) for
   soft-disabled dependents.
3. **IPC gating breaks shared channels** — `recordings:` is served by four handler files across
   features. Mitigation: channel-level (not just prefix) gating in the registry; a unit test
   enumerates every registered channel against the namespace map and fails on unowned or
   double-owned gated channels.
4. **Config migration (ICS → connector)** — split-brain between `config.calendar` and
   `connectors.json`. Mitigation: marker + one-release legacy retention, mirroring the proven
   Gemini-key migration (`config.ts:330`); boot reconciliation heals mismatch.
5. **Runtime USB stop** — disabling device-sync mid-download can wedge the device (CLAUDE.md USB
   rules). Mitigation: pipeline processes disable only at IDLE; UI shows "finishing current
   transfer…".
6. **Perf overhead** — the meter must not become the cost it measures. Ring buffer + counters
   only; no synchronous disk writes on the hot path (hourly rollup piggybacks the existing
   debounced sql.js persistence); IPC sampling batched at 30 s.
7. **Stale renderer state** — flags changed in main while a page is open. Mitigation: single
   `features:changed` push + store subscription; pages read via selectors so they re-render;
   FeatureRoute re-evaluates on store change (an open disabled page swaps to the honest page
   live).
