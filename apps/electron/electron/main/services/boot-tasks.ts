/**
 * Boot task registration + feature gating (Track I, Gate 1 — boot side).
 *
 * The deferred heavy boot work lives here (moved out of index.ts) so it can be
 * unit-tested: each task is tagged with the feature that owns it, and a disabled
 * feature's tasks are simply never registered on the scheduler (fail-closed by
 * non-registration). `feature: null` marks core/library-floor work that always
 * runs regardless of preset.
 *
 * Under the default `full` preset every feature-owned task is enabled; core
 * post-paint tasks register for every preset.
 */

import { registerBootTask } from './boot-scheduler'
import { isFeatureEnabled as defaultIsFeatureEnabled } from './feature-gate'
import type { FeatureId } from '../../../src/shared/feature-registry'
import { markVectorStartupQueued } from './vector-startup-state'

export interface GatedBootTask {
  name: string
  /** Feature that owns this task; `null` = always runs (core/library floor). */
  feature: FeatureId | null
  run: () => void | Promise<void>
}

/**
 * Deferred boot tasks tagged by owning feature. Heavy modules load lazily only
 * when their task actually runs.
 */
export const BOOT_TASK_DEFS: GatedBootTask[] = [
  {
    name: 'database-backup',
    feature: null,
    run: async () => {
      await import('./database')
        .then(({ runDeferredDatabaseBackup }) => runDeferredDatabaseBackup())
        .catch((e) => console.error('[Database] deferred backup error:', e))
    },
  },
  {
    // Potentially expensive whole-database checks run only after the renderer
    // has painted; they previously extended the pre-window splash delay.
    name: 'integrity-check',
    feature: null,
    run: async () => {
      await import('./integrity-service')
        .then(async ({ getIntegrityService }) => {
          const result = await getIntegrityService().runStartupChecks()
          if (result.issuesFound > 0) {
            console.log(`Integrity checks: ${result.issuesFixed}/${result.issuesFound} issues fixed`)
          }
        })
        .catch((e) => console.error('[IntegrityService] startup check error:', e))
    },
  },
  {
    // Meeting↔recording links, People from attendees, ICS text repair, status
    // self-heal. Owned by Calendar (People/Projects hard-depends on Calendar).
    name: 'org-reconcile',
    feature: 'calendar',
    run: async () => {
      await import('./org-reconciler')
        .then(({ reconcileOrganization }) => reconcileOrganization())
        .catch((e) => console.error('[OrgReconciler] error:', e))
    },
  },
  {
    // Self-heal the Knowledge Library — library floor, always runs.
    name: 'knowledge-capture-backfill',
    feature: null,
    run: async () => {
      await import('./knowledge-capture-backfill')
        .then(({ backfillKnowledgeCaptures }) => backfillKnowledgeCaptures())
        .catch((e) => console.error('[KnowledgeCaptureBackfill] error:', e))
    },
  },
  {
    name: 'meeting-wiki-backfill',
    feature: 'meeting-intelligence',
    run: async () => {
      await import('./meeting-wiki')
        .then(({ backfillMeetingWiki }) => backfillMeetingWiki())
        .catch((e) => console.error('[MeetingWiki] Backfill error:', e))
    },
  },
  {
    name: 'start-transcription-processor',
    feature: 'transcription',
    run: async () => {
      await import('./transcription')
        .then(({ startTranscriptionProcessor }) => startTranscriptionProcessor())
        .catch((e) => console.error('[Transcription] processor start error:', e))
    },
  },
  {
    name: 'semantic-index-restore',
    feature: 'assistant',
    run: () =>
      import('./vector-store')
        .then(async ({ getVectorStore }) => {
          // Boot restores existing local state only. It MUST NOT generate new
          // embeddings or call a provider: that old "backfill" phase could walk
          // the entire transcript corpus and made startup an open-ended job.
          // Newly completed transcripts index through the transcription
          // pipeline; historical repair remains an explicit maintenance action.
          await getVectorStore().initialize()
        })
        .catch((e) => console.error('[VectorStore] Restore error:', e)),
  },
]

export interface RegisterBootTasksOptions {
  /** Override the enable check (tests inject a preset resolver). */
  isFeatureEnabled?: (id: FeatureId) => boolean
  /** Override the registrar (tests capture registrations). */
  register?: (task: { name: string; run: () => void | Promise<void> }) => void
  /** Override the task set (tests). */
  defs?: GatedBootTask[]
}

/**
 * Register every boot task whose owning feature is enabled (or which is unowned
 * floor work). Returns the names actually registered — the assertion surface for
 * the "library-only registers 0 gated tasks" test.
 */
export function registerGatedBootTasks(opts: RegisterBootTasksOptions = {}): string[] {
  const isEnabled = opts.isFeatureEnabled ?? defaultIsFeatureEnabled
  const register = opts.register ?? registerBootTask
  const defs = opts.defs ?? BOOT_TASK_DEFS
  const registered: string[] = []
  for (const def of defs) {
    if (def.feature === null || isEnabled(def.feature)) {
      register({ name: def.name, run: def.run })
      registered.push(def.name)
      if (def.name === 'semantic-index-restore') markVectorStartupQueued()
    }
  }
  return registered
}
