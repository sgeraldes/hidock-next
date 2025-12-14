/**
 * Outputs IPC Handlers
 *
 * Handles output generation IPC communication using the Result pattern.
 */

import { ipcMain, clipboard, dialog, BrowserWindow } from 'electron'
import { writeFileSync } from 'fs'
import { getOutputGeneratorService } from '../services/output-generator'
import { success, error, Result } from '../types/api'
import { GenerateOutputRequestSchema } from '../validation/outputs'
import type { OutputTemplate, GenerateOutputResponse } from '../types/api'

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
   * Generate output using a template
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

        const result = await generator.generate(parsed.data)

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

  console.log('Output IPC handlers registered')
}
