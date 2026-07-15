/**
 * Feature Registry — single source of truth for modular features (Track I).
 *
 * PURE module: no Electron / Node imports so BOTH the main process (via relative
 * path) and the renderer (via `@/shared/...`) consume the exact same registry and
 * the exact same `resolveFeatureState` resolver. See
 * `docs/specs/2026-07-11-modular-features-spec.md` §A.
 *
 * `core` and `library` are NOT FeatureIds — they are the permanent floor (always
 * on, never gated). Every other capability is a togglable FeatureId.
 */

export type FeatureId =
  | 'device-sync'
  | 'transcription'
  | 'calendar'
  | 'meeting-intelligence'
  | 'assistant'
  | 'context-graph'
  | 'people-projects'
  | 'explore'
  | 'today'
  | 'clipboard-capture'
  | 'connector:m365'
  | 'connector:slack'
  | 'connector:github'
  | 'connector:ics'

export type HardwareCost = 'light' | 'medium' | 'heavy'

export interface FeatureDefinition {
  id: FeatureId
  /** Human-readable name shown in Settings + the honest disabled page. */
  label: string
  /** One-sentence Settings-card copy. */
  description: string
  /** Boot-scheduler task names + persistent-loop ids this feature owns (main enforces). */
  backgroundTasks: string[]
  /** Route path prefixes this feature owns (renderer gates). */
  routes: string[]
  /** Nav hrefs hidden/grayed when disabled (usually a subset of `routes`). */
  navItems: string[]
  /**
   * IPC channel prefixes/exact-channels gated fail-closed when disabled. An entry
   * ending in `:` is a prefix; otherwise it is an exact channel name. Shared/core
   * namespaces (`config:`, `db:`, `app:`, `knowledge:`, `storage:`, …) are never
   * listed here and therefore never gated.
   */
  ipcNamespaces: string[]
  /** Hard dependencies: disabling one soft-disables this feature (cascade). */
  dependsOn: FeatureId[]
  /** Soft dependencies: informational only (no gating) — degrades quality/UX. */
  softDependsOn: FeatureId[]
  /** Static cost estimate shown in Settings before real perf data exists. */
  hardwareCost: { cpu: HardwareCost; memory: HardwareCost; network: HardwareCost }
  /** True if enabling/disabling takes effect live; false = needs restart (§B.3). */
  runtimeToggleable: boolean
}

/**
 * The registry, transcribed from spec §1.2. Order is display order (grouped by
 * the sidebar sections). `dependsOn` MUST stay a DAG (a unit test asserts it).
 */
export const FEATURES: Record<FeatureId, FeatureDefinition> = {
  'device-sync': {
    id: 'device-sync',
    label: 'Device Sync',
    description: 'Connect HiDock hardware and download recordings over USB.',
    backgroundTasks: [],
    routes: ['/sync'],
    navItems: ['/sync'],
    ipcNamespaces: ['jensen:', 'device-pipeline:', 'deviceCache:', 'download-service:'],
    dependsOn: [],
    softDependsOn: [],
    hardwareCost: { cpu: 'medium', memory: 'light', network: 'light' },
    // USB safety (CLAUDE.md): never yank the device mid-transfer — toggling
    // device-sync takes effect on restart rather than live.
    runtimeToggleable: false,
  },
  transcription: {
    id: 'transcription',
    label: 'Transcription',
    description: 'Turn recordings into searchable, speaker-labelled transcripts.',
    backgroundTasks: ['start-transcription-processor', 'reanalyze-failed-transcripts'],
    routes: [],
    navItems: [],
    ipcNamespaces: [
      'transcription:',
      'transcripts:',
      'turn-speakers:',
      'self-id:',
      'transcript-upgrade:',
      'quality:',
      // recording-handlers mixes library reads with transcription TRIGGERS on the
      // shared `recordings:` namespace. Gate every transcription trigger/control
      // channel at CHANNEL granularity (spec §A.1) so they fail closed when
      // transcription is off — Review-2 [HIGH]: these previously slipped through
      // unclassified and stayed callable with transcription disabled.
      'recordings:reDiarize',
      'recordings:transcribe',
      'recordings:addToQueue',
      'recordings:processQueue',
      'recordings:reprocessWith',
      'recordings:startTranscriptionProcessor',
      'recordings:stopTranscriptionProcessor',
    ],
    dependsOn: [],
    softDependsOn: [],
    hardwareCost: { cpu: 'heavy', memory: 'medium', network: 'heavy' },
    runtimeToggleable: true,
  },
  calendar: {
    id: 'calendar',
    label: 'Calendar',
    description: 'Sync meetings and correlate them with recordings.',
    backgroundTasks: ['org-reconcile', 'loop:calendar-auto-sync'],
    routes: ['/calendar', '/meeting'],
    navItems: ['/calendar'],
    ipcNamespaces: ['calendar:', 'meetings:'],
    dependsOn: [],
    softDependsOn: [],
    hardwareCost: { cpu: 'light', memory: 'light', network: 'medium' },
    runtimeToggleable: true,
  },
  'meeting-intelligence': {
    id: 'meeting-intelligence',
    label: 'Meeting Intelligence',
    description: 'Extract action items, decisions and timeline analysis from meetings.',
    backgroundTasks: ['meeting-wiki-backfill'],
    routes: ['/actionables'],
    navItems: ['/actionables'],
    // timeline-handlers registers under `recordings:` — gate those two at
    // CHANNEL granularity so library reads on `recordings:`/`db:` stay open.
    ipcNamespaces: [
      'actionables:',
      'actionItems:',
      'recordings:getTimelineAnalysis',
      'recordings:analyzeTimeline',
    ],
    dependsOn: ['transcription'],
    softDependsOn: [],
    hardwareCost: { cpu: 'medium', memory: 'light', network: 'medium' },
    runtimeToggleable: true,
  },
  assistant: {
    id: 'assistant',
    label: 'Assistant',
    description: 'Chat over your knowledge with retrieval-augmented answers.',
    backgroundTasks: ['embeddings-backfill', 'image-capture-backfill'],
    routes: ['/assistant'],
    navItems: ['/assistant'],
    ipcNamespaces: ['assistant:', 'rag:'],
    dependsOn: ['transcription'],
    softDependsOn: [],
    hardwareCost: { cpu: 'heavy', memory: 'heavy', network: 'heavy' },
    // Vector store + RAG init are boot-blocking; enabling mid-session needs a
    // restart. Disabling only gates IPC/UI (handled live by the store + gate).
    runtimeToggleable: false,
  },
  'context-graph': {
    id: 'context-graph',
    label: 'Context Graph',
    description: 'Build a living knowledge graph of people, projects and topics.',
    backgroundTasks: ['loop:graph-sync'],
    routes: ['/context-graph'],
    navItems: ['/context-graph'],
    ipcNamespaces: ['contextGraph:', 'graph:'],
    dependsOn: ['transcription'],
    softDependsOn: [],
    hardwareCost: { cpu: 'medium', memory: 'medium', network: 'light' },
    runtimeToggleable: true,
  },
  'people-projects': {
    id: 'people-projects',
    label: 'People & Projects',
    description: 'Organize contacts and projects surfaced from your meetings.',
    backgroundTasks: [],
    routes: ['/people', '/person', '/projects'],
    navItems: ['/people', '/projects'],
    ipcNamespaces: ['contacts:', 'projects:', 'identity:'],
    // Hard input is meetings/attendees (calendar); the graph only boosts merge
    // confidence, so Context Graph is a SOFT dependency (§A.4).
    dependsOn: ['calendar'],
    softDependsOn: ['context-graph'],
    hardwareCost: { cpu: 'light', memory: 'light', network: 'light' },
    runtimeToggleable: true,
  },
  explore: {
    id: 'explore',
    label: 'Explore',
    description: 'Discover recurring topics across your transcripts.',
    backgroundTasks: [],
    routes: ['/explore'],
    navItems: ['/explore'],
    // Only on-demand aggregation over `db:get-recurring-topics` (a core `db:`
    // channel that is never gated), so no IPC namespaces of its own.
    ipcNamespaces: [],
    dependsOn: ['transcription'],
    softDependsOn: [],
    hardwareCost: { cpu: 'light', memory: 'light', network: 'light' },
    runtimeToggleable: true,
  },
  today: {
    id: 'today',
    label: 'Today',
    description: 'A daily timeline that composes whatever sources are enabled.',
    backgroundTasks: [],
    routes: ['/today'],
    navItems: ['/today'],
    ipcNamespaces: ['briefing:', 'commits:'],
    dependsOn: [],
    softDependsOn: [],
    hardwareCost: { cpu: 'light', memory: 'light', network: 'light' },
    runtimeToggleable: true,
  },
  'clipboard-capture': {
    id: 'clipboard-capture',
    label: 'Clipboard Capture',
    description: 'Auto-add screenshots copied to the clipboard as knowledge.',
    backgroundTasks: ['loop:clipboard-watch'],
    routes: [],
    navItems: [],
    ipcNamespaces: ['clipboard:'],
    dependsOn: [],
    softDependsOn: [],
    hardwareCost: { cpu: 'light', memory: 'light', network: 'light' },
    runtimeToggleable: true,
  },
  'connector:m365': {
    id: 'connector:m365',
    label: 'Microsoft 365',
    description: 'Connect Outlook calendar and contacts.',
    backgroundTasks: [],
    routes: [],
    navItems: [],
    // Connector IPC gating is a later phase (§C); the host manages per-instance
    // enable today, so no namespaces are gated here.
    ipcNamespaces: [],
    dependsOn: [],
    softDependsOn: [],
    hardwareCost: { cpu: 'light', memory: 'light', network: 'medium' },
    runtimeToggleable: true,
  },
  'connector:slack': {
    id: 'connector:slack',
    label: 'Slack',
    description: 'Connect Slack messages as a knowledge source.',
    backgroundTasks: [],
    routes: [],
    navItems: [],
    ipcNamespaces: [],
    dependsOn: [],
    softDependsOn: [],
    hardwareCost: { cpu: 'light', memory: 'light', network: 'medium' },
    runtimeToggleable: true,
  },
  'connector:github': {
    id: 'connector:github',
    label: 'GitHub',
    description: 'Surface today’s commits from local repositories.',
    backgroundTasks: [],
    routes: [],
    navItems: [],
    ipcNamespaces: [],
    dependsOn: ['today'],
    softDependsOn: [],
    hardwareCost: { cpu: 'light', memory: 'light', network: 'light' },
    runtimeToggleable: true,
  },
  'connector:ics': {
    id: 'connector:ics',
    label: 'ICS Calendar',
    description: 'Subscribe to an ICS calendar feed.',
    backgroundTasks: [],
    routes: [],
    navItems: [],
    ipcNamespaces: [],
    dependsOn: ['calendar'],
    softDependsOn: [],
    hardwareCost: { cpu: 'light', memory: 'light', network: 'medium' },
    runtimeToggleable: true,
  },
}

/** All FeatureIds in registry (display) order. */
export const ALL_FEATURE_IDS = Object.keys(FEATURES) as FeatureId[]

/** Connector features are represented in the registry but not gated in phase 1. */
export const CONNECTOR_FEATURE_IDS = ALL_FEATURE_IDS.filter((id) => id.startsWith('connector:'))

/** Non-connector features — the set that presets and phase-1 enforcement cover. */
export const CORE_FEATURE_IDS = ALL_FEATURE_IDS.filter((id) => !id.startsWith('connector:'))

// ---------------------------------------------------------------------------
// Presets
// ---------------------------------------------------------------------------

export type PresetId = 'library-only' | 'library-transcription' | 'full' | 'custom'

export const PRESET_IDS: PresetId[] = ['library-only', 'library-transcription', 'full', 'custom']

export interface PresetInfo {
  id: PresetId
  label: string
  description: string
}

export const PRESET_INFO: Record<PresetId, PresetInfo> = {
  'library-only': {
    id: 'library-only',
    label: 'HiDock Library Management',
    description: 'Just your device and recordings — no transcription or AI.',
  },
  'library-transcription': {
    id: 'library-transcription',
    label: 'HiDock + Transcription',
    description: 'Recordings plus speaker-labelled transcripts.',
  },
  full: {
    id: 'full',
    label: 'Full Context Awareness',
    description: 'Everything — meetings, assistant, graph, people and projects.',
  },
  custom: {
    id: 'custom',
    label: 'Custom',
    description: 'Your own hand-picked set of features.',
  },
}

/**
 * The named presets as explicit enabled-feature lists. Connectors default OFF in
 * every preset until the user configures one (§B.1) — they are never listed here.
 */
export const PRESETS: Record<'library-only' | 'library-transcription' | 'full', FeatureId[]> = {
  'library-only': ['device-sync', 'today'],
  'library-transcription': ['device-sync', 'today', 'transcription'],
  full: [
    'device-sync',
    'transcription',
    'calendar',
    'meeting-intelligence',
    'assistant',
    'context-graph',
    'people-projects',
    'explore',
    'today',
    'clipboard-capture',
  ],
}

export function isPresetId(value: unknown): value is PresetId {
  return typeof value === 'string' && (PRESET_IDS as string[]).includes(value)
}

// ---------------------------------------------------------------------------
// Config shape + resolver
// ---------------------------------------------------------------------------

export interface FeaturesConfig {
  preset: PresetId
  /** Sparse per-feature overrides; an unset entry falls back to the preset baseline. */
  flags: Partial<Record<FeatureId, boolean>>
}

export const DEFAULT_FEATURES_CONFIG: FeaturesConfig = { preset: 'full', flags: {} }

/** Why a feature is off. `requires:<id>` = a hard dependency is disabled (cascade). */
export type DisableReason = 'user' | 'preset' | `requires:${FeatureId}`

export interface ResolvedFeature {
  enabled: boolean
  /** Present only when `enabled` is false. */
  reason?: DisableReason
  runtimeToggleable: boolean
}

export type ResolvedFeatures = Record<FeatureId, ResolvedFeature>

/** The preset's per-feature baseline (before user flag overrides + cascade). */
function presetBaseline(preset: PresetId): Record<FeatureId, boolean> {
  const baseline = {} as Record<FeatureId, boolean>
  if (preset === 'full' || preset === 'custom') {
    // `custom` starts from the full non-connector baseline; the user's sparse
    // `flags` then carve features out. Connectors stay off until configured.
    for (const id of ALL_FEATURE_IDS) baseline[id] = !id.startsWith('connector:')
    return baseline
  }
  const enabled = new Set(PRESETS[preset])
  for (const id of ALL_FEATURE_IDS) baseline[id] = enabled.has(id)
  return baseline
}

/**
 * Pure resolver: preset baseline → user flag overrides → hard-dependency cascade.
 * Deterministic and Electron-free so it can be unit-tested and shared by both
 * processes. The user's own flags are PRESERVED across a cascade — re-enabling a
 * dependency restores the dependent to whatever the user had chosen.
 */
export function resolveFeatureState(features?: Partial<FeaturesConfig> | null): ResolvedFeatures {
  const preset: PresetId = isPresetId(features?.preset) ? (features!.preset as PresetId) : 'full'
  const flags = features?.flags ?? {}
  const baseline = presetBaseline(preset)

  const result = {} as ResolvedFeatures
  for (const id of ALL_FEATURE_IDS) {
    const def = FEATURES[id]
    const flag = flags[id]
    let enabled: boolean
    let reason: DisableReason | undefined
    if (flag === true) {
      enabled = true
    } else if (flag === false) {
      enabled = false
      reason = 'user'
    } else {
      enabled = baseline[id]
      if (!enabled) reason = 'preset'
    }
    result[id] = { enabled, reason, runtimeToggleable: def.runtimeToggleable }
  }

  // Hard-dependency cascade — iterate to a fixpoint over the DAG.
  let changed = true
  while (changed) {
    changed = false
    for (const id of ALL_FEATURE_IDS) {
      if (!result[id].enabled) continue
      for (const dep of FEATURES[id].dependsOn) {
        if (!result[dep].enabled) {
          result[id] = {
            enabled: false,
            reason: `requires:${dep}`,
            runtimeToggleable: FEATURES[id].runtimeToggleable,
          }
          changed = true
          break
        }
      }
    }
  }

  return result
}

/** Convenience: is a single feature enabled under the given features config? */
export function isFeatureEnabledIn(
  features: Partial<FeaturesConfig> | null | undefined,
  id: FeatureId
): boolean {
  return resolveFeatureState(features)[id].enabled
}

/**
 * Map an IPC channel to the feature that owns it, or null if it is a shared/core
 * channel (never gated). Exact-channel entries win over prefix entries (§A.1).
 */
export function channelFeature(channel: string): FeatureId | null {
  for (const id of ALL_FEATURE_IDS) {
    for (const ns of FEATURES[id].ipcNamespaces) {
      if (!ns.endsWith(':') && ns === channel) return id
    }
  }
  for (const id of ALL_FEATURE_IDS) {
    for (const ns of FEATURES[id].ipcNamespaces) {
      if (ns.endsWith(':') && channel.startsWith(ns)) return id
    }
  }
  return null
}

/** Match a route/location pathname to the feature that owns it, or null. */
export function routeFeature(pathname: string): FeatureId | null {
  const path = pathname.replace(/\/+$/, '') || '/'
  for (const id of ALL_FEATURE_IDS) {
    for (const route of FEATURES[id].routes) {
      if (path === route || path.startsWith(route + '/')) return id
    }
  }
  return null
}

// ---------------------------------------------------------------------------
// Channel classification (Review-2 [HIGH]: no channel may slip through the gate
// unclassified)
// ---------------------------------------------------------------------------

/**
 * Namespaces that are wholly `core` / shared floor and are NEVER gated. Every
 * channel under one of these prefixes is intentionally open (config, database,
 * storage, the always-on Library floor, connector management, …). A prefix ends
 * in `:`.
 *
 * NOTE: this is deliberately a prefix allowlist for namespaces that belong
 * entirely to core. Namespaces that MIX feature-owned and core channels (today
 * only `recordings:`) are NOT listed here — their core channels are exact-listed
 * in `CORE_CHANNELS` so a newly-added `recordings:*` trigger cannot silently
 * default to open; it stays `unclassified` until a human classifies it.
 */
export const CORE_CHANNEL_PREFIXES: string[] = [
  'app:',
  'config:',
  'db:',
  'storage:',
  'integrity:',
  'migration:',
  'repair:',
  'brains:',
  'knowledge:',
  'artifacts:',
  'waveform:',
  'handover:',
  'outputs:',
  // Connector management surface (list/configure/connect/disconnect for ALL
  // connectors). Per-connector IPC gating is a later phase (spec §C.3); the host
  // enforces per-instance enable today, so these stay open.
  'connectors:',
]

/**
 * Exact `core` channels that live on the SHARED `recordings:` namespace (Library
 * reads, deletes, imports, watcher control, meeting-linking, status reads/writes).
 * They stay open even when transcription is off. Transcription TRIGGERS and the
 * meeting-intelligence timeline channels on the same namespace are feature-owned
 * (see `FEATURES[*].ipcNamespaces`) and are NOT listed here.
 */
export const CORE_CHANNELS: string[] = [
  'recordings:addExternal',
  'recordings:addExternalByPath',
  'recordings:backfillDurations',
  'recordings:clearPreassignment',
  'recordings:delete',
  'recordings:deleteBatch',
  'recordings:deleteCascade',
  'recordings:deletionImpact',
  'recordings:getAll',
  'recordings:getAllWithTranscripts',
  'recordings:getById',
  'recordings:getCandidates',
  'recordings:getForMeeting',
  'recordings:getMeetingsNearDate',
  'recordings:getPreassignment',
  'recordings:getTranscript',
  'recordings:getTranscriptionStatus',
  'recordings:getWatcherStatus',
  'recordings:linkToMeeting',
  'recordings:markPersonal',
  'recordings:preassign',
  'recordings:restore',
  'recordings:scanFolder',
  'recordings:selectMeeting',
  'recordings:startWatcher',
  'recordings:stopWatcher',
  'recordings:unlinkFromMeeting',
  'recordings:updateDuration',
  'recordings:updateStatus',
  'recordings:updateTranscriptionStatus',
]

/** Result of classifying an IPC channel for the gate + the completeness test. */
export type ChannelClass =
  | { kind: 'feature'; feature: FeatureId }
  | { kind: 'core' }
  | { kind: 'unclassified' }

/**
 * Classify an IPC channel as owned by a feature, intentionally core (never
 * gated), or `unclassified`. The registrar-inventory completeness test asserts
 * that NO registered channel is `unclassified`, so any future channel must be
 * mapped to a feature (in `FEATURES[*].ipcNamespaces`) or explicitly declared
 * core (a `CORE_CHANNEL_PREFIXES` prefix or a `CORE_CHANNELS` exact entry).
 */
export function classifyChannel(channel: string): ChannelClass {
  const feature = channelFeature(channel)
  if (feature) return { kind: 'feature', feature }
  if (CORE_CHANNELS.includes(channel)) return { kind: 'core' }
  for (const prefix of CORE_CHANNEL_PREFIXES) {
    if (channel.startsWith(prefix)) return { kind: 'core' }
  }
  return { kind: 'unclassified' }
}
