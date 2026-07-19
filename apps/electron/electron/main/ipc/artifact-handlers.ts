/**
 * Artifact IPC Handlers (C0 entity-type foundation)
 *
 * Channels:
 *   artifacts:import(filePaths[])         → import known-path files
 *   artifacts:pickAndImport()             → native picker → import
 *   artifacts:getForCapture(captureId)    → list a capture's artifacts
 *   artifacts:openInFolder(id)            → reveal the stored blob
 */

import { ipcMain, dialog, shell, BrowserWindow } from 'electron'
import { z } from 'zod'
import { success, error, Result, ArtifactSummary, ArtifactImportSummary } from '../types/api'
import {
  importArtifact,
  getArtifactsForCapture,
  getArtifactById,
  type ArtifactRow
} from '../services/artifact-service'
import { isCaptureEligible } from '../services/recording-eligibility'

function toSummary(row: ArtifactRow): ArtifactSummary {
  let metadata: Record<string, unknown> | null = null
  if (row.metadata) {
    try {
      metadata = JSON.parse(row.metadata)
    } catch {
      metadata = null
    }
  }
  return {
    id: row.id,
    knowledgeCaptureId: row.knowledge_capture_id,
    kind: row.kind,
    mime: row.mime,
    size: row.size,
    storagePath: row.storage_path,
    hasText: !!(row.extracted_text && row.extracted_text.trim().length > 0),
    metadata,
    createdAt: row.created_at
  }
}

const IMPORT_FILTERS = [
  {
    name: 'Documents & Images',
    extensions: ['pdf', 'md', 'markdown', 'txt', 'json', 'png', 'jpg', 'jpeg', 'svg', 'webp']
  }
]

const ImportRequestSchema = z.array(z.string().min(1)).min(1)
const CaptureIdSchema = z.string().min(1).max(200)
const ArtifactIdSchema = z.string().min(1).max(200)

async function importPaths(filePaths: string[]): Promise<ArtifactImportSummary[]> {
  const results: ArtifactImportSummary[] = []
  for (const filePath of filePaths) {
    const result = await importArtifact(filePath)
    results.push({ ...toSummary(result.artifact), deduped: result.deduped, indexedChunks: result.indexedChunks })
  }
  return results
}

export function registerArtifactHandlers(): void {
  ipcMain.handle('artifacts:import', async (_, filePaths: unknown): Promise<Result<ArtifactImportSummary[]>> => {
    try {
      const parsed = ImportRequestSchema.safeParse(filePaths)
      if (!parsed.success) {
        return error('VALIDATION_ERROR', 'Invalid import request', parsed.error.format())
      }
      return success(await importPaths(parsed.data))
    } catch (err) {
      console.error('artifacts:import error:', err)
      return error('INTERNAL_ERROR', 'Failed to import artifacts', err instanceof Error ? err.message : err)
    }
  })

  ipcMain.handle('artifacts:pickAndImport', async (): Promise<Result<ArtifactImportSummary[]>> => {
    try {
      const parent = BrowserWindow.getFocusedWindow() || BrowserWindow.getAllWindows()[0]
      const dialogResult = await dialog.showOpenDialog(parent, {
        title: 'Import Files',
        filters: IMPORT_FILTERS,
        properties: ['openFile', 'multiSelections']
      })

      if (dialogResult.canceled || dialogResult.filePaths.length === 0) {
        return success([])
      }

      return success(await importPaths(dialogResult.filePaths))
    } catch (err) {
      console.error('artifacts:pickAndImport error:', err)
      return error('INTERNAL_ERROR', 'Failed to import selected files', err instanceof Error ? err.message : err)
    }
  })

  ipcMain.handle('artifacts:getForCapture', async (_, captureId: unknown): Promise<Result<ArtifactSummary[]>> => {
    try {
      const parsed = CaptureIdSchema.safeParse(captureId)
      if (!parsed.success) {
        return error('VALIDATION_ERROR', 'Invalid capture id', parsed.error.format())
      }
      // ADV17-3 (round-18) — DISPLAY read boundary. Artifact summaries expose
      // storagePath + metadata (incl. generated image descriptions) derived from
      // a capture; gate on the shared fail-closed capture allowlist. A soft-
      // deleted / low-value / garbage / recording-derived-excluded / missing
      // capture — or a lookup failure — returns NO artifacts.
      if (!isCaptureEligible(parsed.data)) return success([])
      return success(getArtifactsForCapture(parsed.data).map(toSummary))
    } catch (err) {
      console.error('artifacts:getForCapture error:', err)
      return error('DATABASE_ERROR', 'Failed to fetch artifacts', err instanceof Error ? err.message : err)
    }
  })

  ipcMain.handle('artifacts:openInFolder', async (_, id: unknown): Promise<Result<void>> => {
    try {
      const parsed = ArtifactIdSchema.safeParse(id)
      if (!parsed.success) {
        return error('VALIDATION_ERROR', 'Invalid artifact id', parsed.error.format())
      }
      const artifact = getArtifactById(parsed.data)
      if (!artifact || !artifact.storage_path) {
        return error('NOT_FOUND', 'Artifact not found or has no stored file')
      }
      // ADV17-3 (round-18) — revealing the stored blob path exposes the same
      // capture-derived content; gate the owning capture through the shared
      // fail-closed allowlist before showing it in the OS file manager.
      if (!artifact.knowledge_capture_id || !isCaptureEligible(artifact.knowledge_capture_id)) {
        return error('NOT_FOUND', 'Artifact not found or has no stored file')
      }
      shell.showItemInFolder(artifact.storage_path)
      return success(undefined)
    } catch (err) {
      console.error('artifacts:openInFolder error:', err)
      return error('INTERNAL_ERROR', 'Failed to reveal artifact', err instanceof Error ? err.message : err)
    }
  })
}
