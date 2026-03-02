/**
 * Outputs IPC Handlers
 *
 * Handles output generation IPC communication using the Result pattern.
 * Includes server-side rate limiting (B-ACT-001).
 */

import { ipcMain, clipboard, dialog, BrowserWindow } from 'electron'
import { writeFileSync } from 'fs'
import { getOutputGeneratorService } from '../services/output-generator'
import { success, error, Result } from '../types/api'
import { GenerateOutputRequestSchema } from '../validation/outputs'
import type { OutputTemplate, GenerateOutputResponse } from '../types/api'
import { run, runInTransaction, queryOne } from '../services/database'
import { randomUUID } from 'crypto'

// B-ACT-001: Server-side rate limiting — sliding window per actionable/knowledge capture
const RATE_LIMIT_WINDOW_MS = 60_000 // 1 minute
const RATE_LIMIT_MAX_REQUESTS = 5
const generationTimestamps: Map<string, number[]> = new Map()

/**
 * Check and enforce rate limit for a given key.
 * Returns true if the request is allowed, false if rate-limited.
 */
function checkRateLimit(key: string): boolean {
  const now = Date.now()
  const timestamps = generationTimestamps.get(key) || []

  // Remove timestamps outside the sliding window
  const recent = timestamps.filter((t) => now - t < RATE_LIMIT_WINDOW_MS)

  if (recent.length >= RATE_LIMIT_MAX_REQUESTS) {
    // Update the map with pruned timestamps
    generationTimestamps.set(key, recent)
    return false
  }

  // Record new timestamp
  recent.push(now)
  generationTimestamps.set(key, recent)
  return true
}

export function registerOutputsHandlers(): void {
  const generator = getOutputGeneratorService()

  /**
   * Get all available output templates
   */
  ipcMain.handle(
    'outputs:getTemplates',
    async (): Promise<Result<OutputTemplate[]>> => {
      try {
        const templates = generator.getTemplates()
        return success(templates)
      } catch (err) {
        console.error('outputs:getTemplates error:', err)
        return error('INTERNAL_ERROR', 'Failed to get templates', err)
      }
    }
  )

  /**
   * Generate output using a template (with server-side rate limiting)
   */
  ipcMain.handle(
    'outputs:generate',
    async (_, request: unknown): Promise<Result<GenerateOutputResponse>> => {
      try {
        // Validate request
        const parsed = GenerateOutputRequestSchema.safeParse(request)
        if (!parsed.success) {
          return error('VALIDATION_ERROR', 'Invalid generate request', parsed.error.format())
        }

        // B-ACT-001: Server-side rate limiting per knowledge capture or actionable
        const rateLimitKey = parsed.data.actionableId || parsed.data.knowledgeCaptureId || 'global'
        if (!checkRateLimit(rateLimitKey)) {
          return error(
            'RATE_LIMITED',
            'Rate limit exceeded. Maximum 5 generations per minute. Please wait before trying again.'
          )
        }

        const result = await generator.generate(parsed.data)

        // If actionableId was provided, link the result
        if (parsed.data.actionableId) {
          try {
            const outputId = randomUUID()
            const now = new Date().toISOString()
            
            runInTransaction(() => {
              // Create output entry
              run('INSERT INTO outputs (id, knowledge_capture_id, template_id, template_name, content, generated_at) VALUES (?, ?, ?, ?, ?, ?)',
                [outputId, parsed.data.knowledgeCaptureId || '', parsed.data.templateId, parsed.data.templateId, result.content, now])
              
              // Update actionable status and link artifact
              run('UPDATE actionables SET status = ?, artifact_id = ?, generated_at = ?, updated_at = ? WHERE id = ?',
                ['generated', outputId, now, now, parsed.data.actionableId])
            })
          } catch (linkError) {
            console.error('Failed to link output to actionable:', linkError)
          }
        }

        return success({
          content: result.content,
          templateId: result.templateId,
          generatedAt: result.generatedAt
        })
      } catch (err) {
        console.error('outputs:generate error:', err)

        // Check for specific error types
        if (err instanceof Error) {
          if (err.message.includes('not available')) {
            return error('OLLAMA_UNAVAILABLE', err.message)
          }
          if (err.message.includes('not found')) {
            return error('NOT_FOUND', err.message)
          }
          if (err.message.includes('No transcripts')) {
            return error('NOT_FOUND', err.message)
          }
        }

        return error('INTERNAL_ERROR', 'Failed to generate output', err)
      }
    }
  )

  /**
   * Copy content to clipboard
   */
  ipcMain.handle(
    'outputs:copyToClipboard',
    async (_, content: unknown): Promise<Result<void>> => {
      try {
        if (typeof content !== 'string') {
          return error('VALIDATION_ERROR', 'Content must be a string')
        }

        clipboard.writeText(content)
        return success(undefined)
      } catch (err) {
        console.error('outputs:copyToClipboard error:', err)
        return error('INTERNAL_ERROR', 'Failed to copy to clipboard', err)
      }
    }
  )

  /**
   * Save content to file
   */
  ipcMain.handle(
    'outputs:saveToFile',
    async (event, content: unknown, suggestedName?: unknown): Promise<Result<string>> => {
      try {
        if (typeof content !== 'string') {
          return error('VALIDATION_ERROR', 'Content must be a string')
        }

        const win = BrowserWindow.fromWebContents(event.sender)
        if (!win) {
          return error('INTERNAL_ERROR', 'No window found')
        }

        const defaultName = typeof suggestedName === 'string'
          ? suggestedName
          : `output-${new Date().toISOString().slice(0, 10)}.md`

        const result = await dialog.showSaveDialog(win, {
          defaultPath: defaultName,
          filters: [
            { name: 'Markdown', extensions: ['md'] },
            { name: 'Text', extensions: ['txt'] },
            { name: 'All Files', extensions: ['*'] }
          ]
        })

        if (result.canceled || !result.filePath) {
          return error('VALIDATION_ERROR', 'Save cancelled by user')
        }

        writeFileSync(result.filePath, content, 'utf-8')
        return success(result.filePath)
      } catch (err) {
        console.error('outputs:saveToFile error:', err)
        return error('INTERNAL_ERROR', 'Failed to save file', err)
      }
    }
  )

  /**
   * B-ACT-004: Get existing output for an actionable by its artifact_id
   */
  ipcMain.handle(
    'outputs:getByActionableId',
    async (_, actionableId: unknown): Promise<Result<GenerateOutputResponse | null>> => {
      try {
        if (typeof actionableId !== 'string' || !actionableId) {
          return error('VALIDATION_ERROR', 'actionableId must be a non-empty string')
        }

        // Look up the actionable to get its artifact_id
        const actionable = queryOne<{ artifact_id: string | null }>(
          'SELECT artifact_id FROM actionables WHERE id = ?',
          [actionableId]
        )

        if (!actionable) {
          return error('NOT_FOUND', `Actionable ${actionableId} not found`)
        }

        if (!actionable.artifact_id) {
          // No output generated yet
          return success(null)
        }

        // Fetch the output by artifact_id
        const output = queryOne<{
          content: string
          template_id: string
          generated_at: string
        }>(
          'SELECT content, template_id, generated_at FROM outputs WHERE id = ?',
          [actionable.artifact_id]
        )

        if (!output) {
          // artifact_id references a missing output — stale reference
          return success(null)
        }

        return success({
          content: output.content,
          templateId: output.template_id as any,
          generatedAt: output.generated_at
        })
      } catch (err) {
        console.error('outputs:getByActionableId error:', err)
        return error('INTERNAL_ERROR', 'Failed to get output for actionable', err)
      }
    }
  )

  console.log('Output IPC handlers registered')
}
