/**
 * Boot-task feature gating (Gate 1) — a disabled feature's tasks are NEVER
 * registered on the boot scheduler (Track I, I2-b).
 *
 * @vitest-environment node
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  resolveFeatureState,
  FEATURES,
  type FeatureId,
  type FeaturesConfig,
} from '../../../../src/shared/feature-registry'

// feature-gate transitively imports config → electron; keep it hermetic.
let featuresConfig: FeaturesConfig | undefined
const initializeVectorStore = vi.fn(async () => undefined)
const backfillMissingTranscripts = vi.fn(async () => ({ indexed: 0, skipped: 0 }))
vi.mock('../config', () => ({
  getConfig: () => ({ features: featuresConfig }),
}))
vi.mock('../vector-store', () => ({
  getVectorStore: () => ({
    initialize: initializeVectorStore,
    backfillMissingTranscripts,
  }),
}))

import { BOOT_TASK_DEFS, registerGatedBootTasks } from '../boot-tasks'

const ALL_TASK_NAMES = [
  'database-backup',
  'integrity-check',
  'org-reconcile',
  'knowledge-capture-backfill',
  'meeting-wiki-backfill',
  'start-transcription-processor',
  'semantic-index-restore',
]

/** Resolver-backed enable check for a given preset. */
function enabledUnder(features: FeaturesConfig): (id: FeatureId) => boolean {
  const resolved = resolveFeatureState(features)
  return (id) => resolved[id].enabled
}

beforeEach(() => {
  featuresConfig = undefined
  initializeVectorStore.mockClear()
  backfillMissingTranscripts.mockClear()
})

describe('BOOT_TASK_DEFS', () => {
  it('covers every deferred boot task in execution order', () => {
    expect(BOOT_TASK_DEFS.map((t) => t.name)).toEqual(ALL_TASK_NAMES)
  })

  it('every feature-owned task name is declared in that feature\'s registry backgroundTasks', () => {
    for (const def of BOOT_TASK_DEFS) {
      if (def.feature === null) continue
      expect(
        FEATURES[def.feature].backgroundTasks,
        `${def.name} must be listed under FEATURES['${def.feature}'].backgroundTasks`
      ).toContain(def.name)
    }
  })

  it('restores the existing semantic index without starting an embedding backfill', async () => {
    const task = BOOT_TASK_DEFS.find((candidate) => candidate.name === 'semantic-index-restore')
    expect(task).toBeDefined()

    await task!.run()

    expect(initializeVectorStore).toHaveBeenCalledOnce()
    expect(backfillMissingTranscripts).not.toHaveBeenCalled()
  })
})

describe('registerGatedBootTasks', () => {
  it('registers every task under the default full preset', () => {
    const registered: string[] = []
    const names = registerGatedBootTasks({
      isFeatureEnabled: enabledUnder({ preset: 'full', flags: {} }),
      register: (t) => registered.push(t.name),
    })
    expect(names).toEqual(ALL_TASK_NAMES)
    expect(registered).toEqual(ALL_TASK_NAMES)
  })

  it('library-only registers ZERO gated tasks — only the library-floor backfill', () => {
    const registered: string[] = []
    registerGatedBootTasks({
      isFeatureEnabled: enabledUnder({ preset: 'library-only', flags: {} }),
      register: (t) => registered.push(t.name),
    })
    expect(registered).toEqual(['database-backup', 'integrity-check', 'knowledge-capture-backfill'])
  })

  it('library-transcription adds exactly the two transcription tasks', () => {
    const registered: string[] = []
    registerGatedBootTasks({
      isFeatureEnabled: enabledUnder({ preset: 'library-transcription', flags: {} }),
      register: (t) => registered.push(t.name),
    })
    expect(registered).toEqual([
      'database-backup',
      'integrity-check',
      'knowledge-capture-backfill',
      'start-transcription-processor',
    ])
  })

  it('cascade gating: transcription off under full also stops the assistant semantic-index restore', () => {
    const registered: string[] = []
    registerGatedBootTasks({
      isFeatureEnabled: enabledUnder({ preset: 'full', flags: { transcription: false } }),
      register: (t) => registered.push(t.name),
    })
    // meeting-wiki (meeting-intelligence), transcription tasks and
    // semantic-index-restore (assistant) all drop via the requires:transcription cascade.
    expect(registered).toEqual(['database-backup', 'integrity-check', 'org-reconcile', 'knowledge-capture-backfill'])
  })

  it('a disabled task NEVER runs — its run() body is not invoked', async () => {
    const ran: string[] = []
    const defs = BOOT_TASK_DEFS.map((d) => ({
      ...d,
      run: () => {
        ran.push(d.name)
      },
    }))
    const captured: Array<{ name: string; run: () => void | Promise<void> }> = []
    registerGatedBootTasks({
      isFeatureEnabled: enabledUnder({ preset: 'library-only', flags: {} }),
      register: (t) => captured.push(t),
      defs,
    })
    for (const t of captured) await t.run()
    expect(ran).toEqual(['database-backup', 'integrity-check', 'knowledge-capture-backfill'])
  })

  it('uses the live config-backed gate by default (mocked config here)', () => {
    featuresConfig = { preset: 'library-only', flags: {} }
    const registered: string[] = []
    registerGatedBootTasks({ register: (t) => registered.push(t.name) })
    expect(registered).toEqual(['database-backup', 'integrity-check', 'knowledge-capture-backfill'])
  })
})
