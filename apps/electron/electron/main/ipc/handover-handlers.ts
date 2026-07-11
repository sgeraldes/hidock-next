/**
 * Handover IPC handlers (H9 — "proper" Claude Code handover). Namespace: `handover:*`.
 *
 * Bridges the renderer Handover dialog to the main-process handover service:
 *   - `handover:createBundle` — resolve a target directory, then assemble the
 *     handover BUNDLE (HANDOVER.md + context/ + manifest.json) into
 *     `<targetDir>/handover/<timestamped-slug>/`.
 *   - `handover:runAgent` — optionally run the handover in-app through an AGENTIC
 *     brain resolved via the BrainRouter (task 'handover'), streaming a RUN.log
 *     into the bundle and surfacing completion/failure via the event bus.
 *
 * Fallbacks (clipboard copy, open-in-terminal) stay on the existing
 * `outputs:copyToClipboard` / `outputs:launchClaudeCode` channels — this file adds
 * the bundle + in-app run only. Follows the 3-file IPC pattern in
 * `.claude/rules/electron-ipc.md`.
 */
import { ipcMain } from 'electron'
import { existsSync } from 'fs'
import { getConfig, updateConfig } from '../services/config'
import { success, error, Result } from '../types/api'
import { resolveProjectFolderForActionable } from './outputs-handlers'
import {
  assembleHandoverBundle,
  runHandoverAgent,
  type HandoverManifest,
  type HandoverSourceRef,
  type RunHandoverAgentResult,
} from '../services/handover-service'

export interface CreateBundleResult {
  /** True when the bundle was written. */
  created: boolean
  /** Set when no target directory could be resolved — renderer should pick one. */
  needsFolder?: boolean
  bundleDir?: string
  handoverPath?: string
  targetDir?: string
  manifest?: HandoverManifest
}

/**
 * Resolve the working directory for a handover, mirroring the legacy
 * `outputs:launchClaudeCode` order: explicit pick → source project folder →
 * configured handoffDirectory → none (renderer prompts). An explicit pick is
 * persisted as the new default handoffDirectory (non-fatal on failure).
 */
async function resolveTargetDir(explicit: string | undefined, actionableId: string | undefined): Promise<string | null> {
  if (explicit && explicit.trim()) {
    try {
      await updateConfig('integrations', { handoffDirectory: explicit })
    } catch (cfgErr) {
      console.warn('handover:createBundle — failed to persist handoffDirectory:', cfgErr)
    }
    return explicit
  }
  if (actionableId) {
    const viaProject = resolveProjectFolderForActionable(actionableId)
    if (viaProject) return viaProject
  }
  const configured = getConfig().integrations?.handoffDirectory
  if (configured && existsSync(configured)) return configured
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

      const targetDir = await resolveTargetDir(explicit, actionableId)
      if (!targetDir) {
        return success({ created: false, needsFolder: true })
      }
      if (!existsSync(targetDir)) {
        return error('NOT_FOUND', `The handover folder does not exist: ${targetDir}`)
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

      const { bundleDir, handoverPath, manifest } = assembleHandoverBundle({
        targetDir,
        handoverContent: content,
        source,
        brain,
      })

      return success({ created: true, bundleDir, handoverPath, targetDir, manifest })
    } catch (err) {
      console.error('handover:createBundle error:', err)
      return error('INTERNAL_ERROR', 'Failed to write the handover bundle', err)
    }
  })

  /**
   * Run a previously-written bundle through an agentic brain, in-app. Resolves the
   * brain via the router (or an explicit brainId) and honours its null contract.
   */
  ipcMain.handle('handover:runAgent', async (_e, rawArgs: unknown): Promise<Result<RunHandoverAgentResult>> => {
    try {
      const args = (rawArgs && typeof rawArgs === 'object' ? rawArgs : {}) as {
        bundleDir?: unknown
        targetDir?: unknown
        brainId?: unknown
      }
      const bundleDir = typeof args.bundleDir === 'string' ? args.bundleDir : ''
      const targetDir = typeof args.targetDir === 'string' ? args.targetDir : ''
      if (!bundleDir || !existsSync(bundleDir)) {
        return error('NOT_FOUND', 'The handover bundle could not be found. Write it again and retry.')
      }
      if (!targetDir || !existsSync(targetDir)) {
        return error('NOT_FOUND', `The handover working directory does not exist: ${targetDir}`)
      }

      const result = await runHandoverAgent({
        bundleDir,
        targetDir,
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
