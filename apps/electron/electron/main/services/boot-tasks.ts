/**
 * Boot task registration + feature gating (Track I, Gate 1 — boot side).
 *
 * The deferred heavy boot work lives here (moved out of index.ts) so it can be
 * unit-tested: each task is tagged with the feature that owns it, and a disabled
 * feature's tasks are simply never registered on the scheduler (fail-closed by
 * non-registration). `feature: null` marks core/library-floor work that always
 * runs regardless of preset.
 *
 * Under the default `full` preset every feature is enabled, so all six tasks
 * register exactly as before modular features existed (zero behavior change).
 */

import { registerBootTask } from './boot-scheduler'
import { isFeatureEnabled as defaultIsFeatureEnabled } from './feature-gate'
import type { FeatureId } from '../../../src/shared/feature-registry'

export interface GatedBootTask {
  name: string
  /** Feature that owns this task; `null` = always runs (core/library floor). */
  feature: FeatureId | null
  run: () => void | Promise<void>
}

/**
 * The six deferred boot tasks, tagged by owning feature. Bodies mirror the
 * original index.ts registrations (dynamic imports, per-task try/catch) so the
 * heavy modules load lazily only when their task actually runs.
 */
export const BOOT_TASK_DEFS: GatedBootTask[] = [
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
    name: 'embeddings-backfill',
    feature: 'assistant',
    run: () =>
      import('./vector-store')
        .then(async ({ getVectorStore }) => {
          const store = getVectorStore()
          await store.initialize()
          await store.backfillMissingTranscripts()
        })
        .catch((e) => console.error('[VectorStore] Backfill error:', e)),
  },
  {
    name: 'reanalyze-failed-transcripts',
    feature: 'transcription',
    run: async () => {
      await import('./transcription')
        .then(({ reanalyzeFailedTranscripts }) => reanalyzeFailedTranscripts())
        .catch((e) => console.error('[Reanalyze] Backfill error:', e))
    },
  },
  {
    // F5 (PixelRAG): index EXISTING image captures (screenshots) that have no
    // embeddings yet. Bounded per boot tick; degrades silently without a
    // Gemini/embedding backend. Feeds assistant retrieval, so it is owned by
    // the assistant feature.
    name: 'image-capture-backfill',
    feature: 'assistant',
    run: () =>
      import('./artifact-service')
        .then(({ backfillImageCaptureIndex }) => backfillImageCaptureIndex())
        .then(() => undefined)
        .catch((e) => console.error('[ArtifactService] Image-capture backfill error:', e)),
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
    }
  }
  return registered
}
