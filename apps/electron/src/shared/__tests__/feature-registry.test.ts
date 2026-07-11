/**
 * Feature registry + resolver unit tests (Track I, I2-a).
 *
 * Pure module — no Electron, no DOM. Covers: DAG acyclicity, preset flag-sets,
 * the default `full` regression (everything enabled = zero behavior change),
 * user-flag overrides, the hard-dependency cascade (with disable-reasons and
 * transitivity), soft dependencies NOT cascading, flag preservation across a
 * cascade, and the channel/route ownership maps.
 */

import { describe, it, expect } from 'vitest'
import {
  ALL_FEATURE_IDS,
  CORE_FEATURE_IDS,
  CONNECTOR_FEATURE_IDS,
  FEATURES,
  PRESETS,
  DEFAULT_FEATURES_CONFIG,
  resolveFeatureState,
  isFeatureEnabledIn,
  channelFeature,
  routeFeature,
  isPresetId,
  type FeatureId,
} from '../feature-registry'

describe('FEATURES registry shape', () => {
  it('contains exactly the 10 core features + 4 connectors', () => {
    expect(CORE_FEATURE_IDS).toEqual([
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
    ])
    expect(CONNECTOR_FEATURE_IDS).toEqual([
      'connector:m365',
      'connector:slack',
      'connector:github',
      'connector:ics',
    ])
  })

  it('every definition id matches its registry key', () => {
    for (const id of ALL_FEATURE_IDS) {
      expect(FEATURES[id].id).toBe(id)
    }
  })

  it('dependsOn references are valid FeatureIds', () => {
    for (const id of ALL_FEATURE_IDS) {
      for (const dep of FEATURES[id].dependsOn) {
        expect(ALL_FEATURE_IDS).toContain(dep)
      }
      for (const dep of FEATURES[id].softDependsOn) {
        expect(ALL_FEATURE_IDS).toContain(dep)
      }
    }
  })

  it('the hard-dependency graph is a DAG (no cycles)', () => {
    const visiting = new Set<FeatureId>()
    const done = new Set<FeatureId>()
    const visit = (id: FeatureId): void => {
      if (done.has(id)) return
      expect(visiting.has(id), `cycle through ${id}`).toBe(false)
      visiting.add(id)
      for (const dep of FEATURES[id].dependsOn) visit(dep)
      visiting.delete(id)
      done.add(id)
    }
    for (const id of ALL_FEATURE_IDS) visit(id)
  })

  it('no channel is owned by two features (unambiguous gating)', () => {
    const owners = new Map<string, FeatureId>()
    for (const id of ALL_FEATURE_IDS) {
      for (const ns of FEATURES[id].ipcNamespaces) {
        expect(owners.has(ns), `duplicate namespace entry ${ns}`).toBe(false)
        owners.set(ns, id)
      }
    }
    // Prefix entries must not overlap each other either (e.g. `a:` and `a:b:`).
    const prefixes = [...owners.keys()].filter((k) => k.endsWith(':'))
    for (const a of prefixes) {
      for (const b of prefixes) {
        if (a !== b) expect(a.startsWith(b)).toBe(false)
      }
    }
  })
})

describe('resolveFeatureState — default / full preset (zero-behavior-change regression)', () => {
  it('enables every non-connector feature with no config at all', () => {
    for (const features of [undefined, null, {}, DEFAULT_FEATURES_CONFIG] as const) {
      const resolved = resolveFeatureState(features as never)
      for (const id of CORE_FEATURE_IDS) {
        expect(resolved[id].enabled, `${id} must be enabled by default`).toBe(true)
        expect(resolved[id].reason).toBeUndefined()
      }
    }
  })

  it('keeps connectors off by default (until configured), reason preset', () => {
    const resolved = resolveFeatureState(undefined)
    for (const id of CONNECTOR_FEATURE_IDS) {
      expect(resolved[id].enabled).toBe(false)
      expect(resolved[id].reason).toBe('preset')
    }
  })

  it('treats an unknown preset value as full (defensive default)', () => {
    const resolved = resolveFeatureState({ preset: 'bogus' as never, flags: {} })
    for (const id of CORE_FEATURE_IDS) expect(resolved[id].enabled).toBe(true)
  })
})

describe('resolveFeatureState — named presets', () => {
  it('library-only enables exactly device-sync + today (and the floor)', () => {
    const resolved = resolveFeatureState({ preset: 'library-only', flags: {} })
    const enabled = ALL_FEATURE_IDS.filter((id) => resolved[id].enabled)
    expect(enabled.sort()).toEqual(['device-sync', 'today'].sort())
    // Everything else is off with an honest reason.
    expect(resolved.transcription).toMatchObject({ enabled: false, reason: 'preset' })
    expect(resolved.calendar).toMatchObject({ enabled: false, reason: 'preset' })
    expect(resolved.assistant.enabled).toBe(false)
    expect(resolved['context-graph'].enabled).toBe(false)
    expect(resolved['meeting-intelligence'].enabled).toBe(false)
    expect(resolved['people-projects'].enabled).toBe(false)
    expect(resolved.explore.enabled).toBe(false)
    expect(resolved['clipboard-capture'].enabled).toBe(false)
  })

  it('library-transcription adds only transcription', () => {
    const resolved = resolveFeatureState({ preset: 'library-transcription', flags: {} })
    const enabled = ALL_FEATURE_IDS.filter((id) => resolved[id].enabled)
    expect(enabled.sort()).toEqual(['device-sync', 'today', 'transcription'].sort())
    // Dependents of transcription stay off because the PRESET excludes them
    // (reason preset, not cascade — they were never in the baseline).
    expect(resolved['meeting-intelligence']).toMatchObject({ enabled: false, reason: 'preset' })
  })

  it('the PRESETS flag-sets only reference valid ids', () => {
    for (const ids of Object.values(PRESETS)) {
      for (const id of ids) expect(ALL_FEATURE_IDS).toContain(id)
    }
  })

  it('custom preset = full baseline carved by user flags', () => {
    const resolved = resolveFeatureState({ preset: 'custom', flags: { assistant: false } })
    expect(resolved.assistant).toMatchObject({ enabled: false, reason: 'user' })
    for (const id of CORE_FEATURE_IDS.filter((i) => i !== 'assistant')) {
      expect(resolved[id].enabled, `${id} should stay on in custom`).toBe(true)
    }
  })
})

describe('resolveFeatureState — user flags + cascade', () => {
  it('a user flag=false disables with reason user', () => {
    const resolved = resolveFeatureState({ preset: 'full', flags: { explore: false } })
    expect(resolved.explore).toMatchObject({ enabled: false, reason: 'user' })
  })

  it('disabling transcription soft-disables all four dependents with requires:transcription', () => {
    const resolved = resolveFeatureState({ preset: 'full', flags: { transcription: false } })
    expect(resolved.transcription).toMatchObject({ enabled: false, reason: 'user' })
    for (const dep of ['meeting-intelligence', 'assistant', 'context-graph', 'explore'] as const) {
      expect(resolved[dep]).toMatchObject({ enabled: false, reason: 'requires:transcription' })
    }
    // Unrelated features are untouched.
    expect(resolved.calendar.enabled).toBe(true)
    expect(resolved['people-projects'].enabled).toBe(true)
    expect(resolved['device-sync'].enabled).toBe(true)
  })

  it('disabling calendar cascades to people-projects', () => {
    const resolved = resolveFeatureState({ preset: 'full', flags: { calendar: false } })
    expect(resolved['people-projects']).toMatchObject({
      enabled: false,
      reason: 'requires:calendar',
    })
  })

  it('soft dependencies do NOT cascade (context-graph off keeps people-projects on)', () => {
    const resolved = resolveFeatureState({ preset: 'full', flags: { 'context-graph': false } })
    expect(resolved['people-projects'].enabled).toBe(true)
  })

  it('cascade wins over an explicit user enable (dependent cannot outrun its dependency)', () => {
    const resolved = resolveFeatureState({
      preset: 'full',
      flags: { transcription: false, assistant: true },
    })
    expect(resolved.assistant).toMatchObject({ enabled: false, reason: 'requires:transcription' })
  })

  it("preserves the user's flag across a cascade — re-enabling the dependency restores the choice", () => {
    // User had assistant explicitly ON; transcription off cascaded it off.
    const off = resolveFeatureState({
      preset: 'library-transcription',
      flags: { transcription: false, assistant: true },
    })
    expect(off.assistant.enabled).toBe(false)
    // Turning transcription back on (remove the override) restores assistant=true
    // from the user's untouched flag — even though the preset baseline is off.
    const on = resolveFeatureState({
      preset: 'library-transcription',
      flags: { assistant: true },
    })
    expect(on.assistant.enabled).toBe(true)
  })

  it('a user flag=true enables a preset-off feature (given deps are met)', () => {
    const resolved = resolveFeatureState({
      preset: 'library-only',
      flags: { transcription: true },
    })
    expect(resolved.transcription.enabled).toBe(true)
    // Its dependents stay off — the preset baseline excludes them.
    expect(resolved.assistant).toMatchObject({ enabled: false, reason: 'preset' })
  })

  it('transitive cascade: enabling explore under library-only still requires transcription', () => {
    const resolved = resolveFeatureState({ preset: 'library-only', flags: { explore: true } })
    expect(resolved.explore).toMatchObject({ enabled: false, reason: 'requires:transcription' })
  })

  it('isFeatureEnabledIn matches the resolver', () => {
    expect(isFeatureEnabledIn(undefined, 'assistant')).toBe(true)
    expect(isFeatureEnabledIn({ preset: 'library-only', flags: {} }, 'assistant')).toBe(false)
  })
})

describe('channelFeature (IPC ownership map)', () => {
  it('maps prefix-owned channels to their feature', () => {
    expect(channelFeature('transcription:cancel')).toBe('transcription')
    expect(channelFeature('assistant:getConversations')).toBe('assistant')
    expect(channelFeature('contextGraph:getGraph')).toBe('context-graph')
    expect(channelFeature('jensen:connect')).toBe('device-sync')
    expect(channelFeature('download-service:get-state')).toBe('device-sync')
    expect(channelFeature('calendar:sync')).toBe('calendar')
    expect(channelFeature('contacts:getAll')).toBe('people-projects')
    expect(channelFeature('briefing:get')).toBe('today')
    expect(channelFeature('clipboard:captureImage')).toBe('clipboard-capture')
  })

  it('exact-channel entries win over the recordings: shared namespace', () => {
    expect(channelFeature('recordings:analyzeTimeline')).toBe('meeting-intelligence')
    expect(channelFeature('recordings:getTimelineAnalysis')).toBe('meeting-intelligence')
    expect(channelFeature('recordings:reDiarize')).toBe('transcription')
  })

  it('returns null for shared/core channels (never gated)', () => {
    for (const ch of [
      'config:get',
      'db:get-recordings',
      'app:info',
      'knowledge:getAll',
      'storage:get-info',
      'integrity:run-scan',
      'recordings:delete', // library reads/deletes stay open
      'artifacts:import',
      'waveform:getCache',
      'outputs:generate',
      'brains:list',
      'migration:getStatus',
      'connectors:list',
    ]) {
      expect(channelFeature(ch), `${ch} must be unowned`).toBeNull()
    }
  })
})

describe('routeFeature (route ownership map)', () => {
  it('maps owned routes (including sub-paths and trailing slashes)', () => {
    expect(routeFeature('/calendar')).toBe('calendar')
    expect(routeFeature('/meeting/abc-123')).toBe('calendar')
    expect(routeFeature('/assistant')).toBe('assistant')
    expect(routeFeature('/assistant/')).toBe('assistant')
    expect(routeFeature('/context-graph')).toBe('context-graph')
    expect(routeFeature('/people')).toBe('people-projects')
    expect(routeFeature('/person/42')).toBe('people-projects')
    expect(routeFeature('/projects')).toBe('people-projects')
    expect(routeFeature('/actionables')).toBe('meeting-intelligence')
    expect(routeFeature('/explore')).toBe('explore')
    expect(routeFeature('/today')).toBe('today')
    expect(routeFeature('/sync')).toBe('device-sync')
  })

  it('returns null for floor routes (Library, Settings, root)', () => {
    expect(routeFeature('/library')).toBeNull()
    expect(routeFeature('/settings')).toBeNull()
    expect(routeFeature('/')).toBeNull()
  })
})

describe('isPresetId', () => {
  it('accepts the four presets and rejects anything else', () => {
    expect(isPresetId('full')).toBe(true)
    expect(isPresetId('library-only')).toBe(true)
    expect(isPresetId('library-transcription')).toBe(true)
    expect(isPresetId('custom')).toBe(true)
    expect(isPresetId('everything')).toBe(false)
    expect(isPresetId(undefined)).toBe(false)
  })
})
