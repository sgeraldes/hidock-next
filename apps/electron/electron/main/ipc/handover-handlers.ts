/**
 * Handover IPC handlers (H9 — "proper" Claude Code handover). Namespace: `handover:*`.
 *
 * Bridges the renderer Handover dialog to the main-process handover service:
 *   - `handover:createBundle` — resolve + VALIDATE a target directory (canonical
 *     realpath, protected OS/app locations refused), then assemble the handover
 *     BUNDLE (HANDOVER.md + context/ + manifest.json) into
 *     `<targetDir>/handover/<timestamped-slug>/`. Returns an OPAQUE `bundleId`.
 *   - `handover:runAgent` — optionally run the handover in-app through an AGENTIC
 *     brain resolved via the BrainRouter (task 'handover'). Accepts ONLY a
 *     `bundleId` previously minted by createBundle — bundle/target paths are
 *     looked up in the main-process registry, never taken from the renderer.
 *
 * Fallbacks (clipboard copy, open-in-terminal) stay on the existing
 * `outputs:copyToClipboard` / `outputs:launchClaudeCode` channels — this file adds
 * the bundle + in-app run only. Follows the 3-file IPC pattern in
 * `.claude/rules/electron-ipc.md`.
 */
import { ipcMain, app } from 'electron'
import { dirname } from 'path'
import { getConfig, updateConfig } from '../services/config'
import { success, error, Result } from '../types/api'
import { resolveProjectFolderForActionable } from './outputs-handlers'
import {
  assembleHandoverBundle,
  runHandoverAgent,
  getRegisteredBundle,
  validateTargetDir,
  BUNDLE_EXPIRED_ERROR,
  type HandoverManifest,
  type HandoverSourceRef,
  type RunHandoverAgentResult,
} from '../services/handover-service'

export interface CreateBundleResult {
  /** True when the bundle was written. */
  created: boolean
  /** Set when no target directory could be resolved — renderer should pick one. */
  needsFolder?: boolean
  /** Opaque registry id — the ONLY token runAgent accepts. */
  bundleId?: string
  bundleDir?: string
  handoverPath?: string
  targetDir?: string
  manifest?: HandoverManifest
}

/**
 * App-specific locations the handover must never target, on top of the built-in
 * OS-protected list in the service. Computed lazily and defensively — in unit
 * tests `app` is not available and the list is simply empty.
 */
function appProtectedPaths(): string[] {
  const paths: string[] = []
  try {
    paths.push(app.getAppPath())
  } catch {
    /* not available (tests) */
  }
  try {
    paths.push(app.getPath('userData'))
  } catch {
    /* ignore */
  }
  try {
    paths.push(dirname(app.getPath('exe')))
  } catch {
    /* ignore */
  }
  return paths
}

/**
 * Resolve the working directory for a handover, mirroring the legacy
 * `outputs:launchClaudeCode` order: explicit pick → source project folder →
 * configured handoffDirectory → none (renderer prompts). Every candidate is
 * canonicalized + vetted BEFORE use; an explicit pick is persisted as the new
 * default handoffDirectory only after it validates.
 */
async function resolveTargetDir(explicit: string | undefined, actionableId: string | undefined): Promise<string | null> {
  const protectedPaths = appProtectedPaths()

  if (explicit && explicit.trim()) {
    // Throws a user-facing message when refused — surfaced by the handler.
    const canonical = validateTargetDir(explicit, protectedPaths)
    try {
      await updateConfig('integrations', { handoffDirectory: canonical })
    } catch (cfgErr) {
      console.warn('handover:createBundle — failed to persist handoffDirectory:', cfgErr)
    }
    return canonical
  }
  if (actionableId) {
    const viaProject = resolveProjectFolderForActionable(actionableId)
    if (viaProject) {
      try {
        return validateTargetDir(viaProject, protectedPaths)
      } catch {
        /* stale/invalid project folder — fall through */
      }
    }
  }
  const configured = getConfig().integrations?.handoffDirectory
  if (configured) {
    try {
      return validateTargetDir(configured, protectedPaths)
    } catch {
      /* stale/invalid configured folder — renderer will prompt */
    }
  }
  return null
}

export function registerHandoverHandlers(): void {
  /**
   * Assemble a handover bundle. `content` is the HANDOVER.md core (the
   * claude_code_prompt template output the renderer already generated).
   */
  ipcMain.handle('handover:createBundle', async (_e, rawArgs: unknown): Promise<Result<CreateBundleResult>> => {
    try {
      const args = (rawArgs && typeof rawArgs === 'object' ? rawArgs : {}) as {
        content?: unknown
        actionableId?: unknown
        knowledgeCaptureId?: unknown
        meetingId?: unknown
        recordingId?: unknown
        targetDir?: unknown
        brain?: unknown
      }

      const content = typeof args.content === 'string' ? args.content : ''
      if (!content.trim()) {
        return error('VALIDATION_ERROR', 'A handover prompt is required. Generate the Claude Code handoff first.')
      }

      const actionableId = typeof args.actionableId === 'string' ? args.actionableId : undefined
      const explicit = typeof args.targetDir === 'string' && args.targetDir.trim() ? args.targetDir : undefined

      let targetDir: string | null
      try {
        targetDir = await resolveTargetDir(explicit, actionableId)
      } catch (validationErr) {
        return error('VALIDATION_ERROR', (validationErr as Error).message)
      }
      if (!targetDir) {
        return success({ created: false, needsFolder: true })
      }

      const source: HandoverSourceRef = {
        actionableId,
        knowledgeCaptureId: typeof args.knowledgeCaptureId === 'string' ? args.knowledgeCaptureId : undefined,
        meetingId: typeof args.meetingId === 'string' ? args.meetingId : undefined,
        recordingId: typeof args.recordingId === 'string' ? args.recordingId : undefined,
      }
      const brain =
        args.brain && typeof args.brain === 'object'
          ? (args.brain as { id: string; label: string })
          : null

      const { bundleId, bundleDir, handoverPath, targetDir: canonicalTarget, manifest } = assembleHandoverBundle({
        targetDir,
        handoverContent: content,
        source,
        brain,
        extraProtectedPaths: appProtectedPaths(),
      })

      return success({ created: true, bundleId, bundleDir, handoverPath, targetDir: canonicalTarget, manifest })
    } catch (err) {
      console.error('handover:createBundle error:', err)
      return error('INTERNAL_ERROR', (err as Error)?.message || 'Failed to write the handover bundle', err)
    }
  })

  /**
   * Run a previously-written bundle through an agentic brain, in-app. Accepts
   * ONLY an opaque bundleId minted by createBundle in this session; the bundle
   * and target paths are read from the main-process registry.
   */
  ipcMain.handle('handover:runAgent', async (_e, rawArgs: unknown): Promise<Result<RunHandoverAgentResult>> => {
    try {
      const args = (rawArgs && typeof rawArgs === 'object' ? rawArgs : {}) as {
        bundleId?: unknown
        brainId?: unknown
      }
      const bundleId = typeof args.bundleId === 'string' ? args.bundleId : ''
      if (!bundleId || !getRegisteredBundle(bundleId)) {
        // Registry is session-only: after an app restart every old id is stale,
        // so this is the normal "bundle expired" path, not just a forged id.
        return error('NOT_FOUND', BUNDLE_EXPIRED_ERROR)
      }

      const result = await runHandoverAgent({
        bundleId,
        brainId: typeof args.brainId === 'string' && args.brainId ? args.brainId : undefined,
      })
      // A never-throw null run is a real failure the renderer surfaces — but the IPC
      // call itself succeeds so the renderer can read `result.ok`/`result.error`.
      return success(result)
    } catch (err) {
      console.error('handover:runAgent error:', err)
      return error('INTERNAL_ERROR', 'Failed to run the handover agent', err)
    }
  })

  console.log('Handover IPC handlers registered')
}
