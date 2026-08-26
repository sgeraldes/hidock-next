/**
 * Outputs IPC Handlers
 *
 * Handles output generation IPC communication using the Result pattern.
 * Includes server-side rate limiting (B-ACT-001).
 */

import { ipcMain, clipboard, dialog, BrowserWindow, shell } from 'electron'
import { writeFileSync, mkdirSync, existsSync } from 'fs'
import { join } from 'path'
import { spawn, spawnSync } from 'child_process'
import { getTranscriptsPath } from '../services/file-storage'
import { getOutputGeneratorService } from '../services/output-generator'
import { success, error, Result } from '../types/api'
import { GenerateOutputRequestSchema } from '../validation/outputs'
import type { OutputTemplate, GenerateOutputResponse } from '../types/api'
import { run, runInTransaction, queryOne } from '../services/database'
import { filterEligibleActionableRows } from '../services/actionable-eligibility'
import { getConfig, updateConfig } from '../services/config'
import { randomUUID } from 'crypto'

/**
 * Result of a "Open in Claude Code" launch request. `needsFolder` asks the
 * renderer to pick a working directory and retry with an explicit `cwd`.
 */
export interface LaunchClaudeCodeResult {
  launched: boolean
  needsFolder?: boolean
  cwd?: string
}

/**
 * Write a generated output to the transcripts workspace as a Markdown file so
 * it's immediately usable outside the app (e.g. handed to a coding agent).
 * Returns the absolute path, or undefined if the export failed (non-fatal).
 */
export function exportOutputToFile(content: string, templateId: string): string | undefined {
  try {
    const outputsDir = join(getTranscriptsPath(), 'outputs')
    if (!existsSync(outputsDir)) {
      mkdirSync(outputsDir, { recursive: true })
    }
    const date = new Date().toISOString().slice(0, 10)
    const titleLine = content.split('\n').find((l) => l.trim().length > 0) ?? ''
    const slug =
      titleLine
        .replace(/^#+\s*/, '')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 60) || templateId
    const savedPath = join(outputsDir, `${date}-${templateId}-${slug}.md`)
    writeFileSync(savedPath, content, 'utf-8')
    return savedPath
  } catch (exportErr) {
    console.error('exportOutputToFile failed:', exportErr)
    return undefined
  }
}

/**
 * Resolve the on-disk project folder bound to an actionable's source, if any.
 * An actionable's `source_knowledge_id` is either a knowledge_captures id or a
 * recording id; a project is reachable either directly (knowledge_projects) or
 * via the recording's meeting (meeting_projects). Returns the first project
 * folder_path found, or null.
 */
export function resolveProjectFolderForActionable(actionableId: string): string | null {
  const actionable = queryOne<{ source_knowledge_id: string | null }>(
    'SELECT source_knowledge_id FROM actionables WHERE id = ?',
    [actionableId]
  )
  const skid = actionable?.source_knowledge_id
  if (!skid) return null

  // 1. Direct knowledge → project assignment (source_knowledge_id is a capture id)
  const viaKnowledge = queryOne<{ folder_path: string | null }>(
    `SELECT p.folder_path FROM knowledge_projects kp
       JOIN projects p ON p.id = kp.project_id
      WHERE kp.knowledge_capture_id = ?
        AND p.folder_path IS NOT NULL AND p.folder_path != ''
      LIMIT 1`,
    [skid]
  )
  if (viaKnowledge?.folder_path) return viaKnowledge.folder_path

  // 2. Via the recording's meeting. Resolve the recording id: prefer the
  //    capture's source_recording_id, else treat source_knowledge_id as one.
  const kc = queryOne<{ source_recording_id: string | null }>(
    'SELECT source_recording_id FROM knowledge_captures WHERE id = ?',
    [skid]
  )
  const recordingId = kc?.source_recording_id || skid
  const viaMeeting = queryOne<{ folder_path: string | null }>(
    `SELECT p.folder_path FROM recordings r
       JOIN meeting_projects mp ON mp.meeting_id = r.meeting_id
       JOIN projects p ON p.id = mp.project_id
      WHERE r.id = ?
        AND p.folder_path IS NOT NULL AND p.folder_path != ''
      LIMIT 1`,
    [recordingId]
  )
  return viaMeeting?.folder_path || null
}

/**
 * Locate the Claude Code CLI on PATH. Returns the first resolved path, or null
 * if `claude` is not installed / not on PATH.
 */
export function findClaudeCli(): string | null {
  try {
    const finder = process.platform === 'win32' ? 'where' : 'which'
    const res = spawnSync(finder, ['claude'], { encoding: 'utf-8' })
    if (res.status === 0 && typeof res.stdout === 'string' && res.stdout.trim()) {
      const first = res.stdout
        .split(/\r?\n/)
        .map((s) => s.trim())
        .find(Boolean)
      return first || null
    }
  } catch {
    /* ignore — treated as "not found" */
  }
  return null
}

/**
 * Open a new terminal window running `claude` in `cwd` with `prompt` as the
 * initial instruction. Windows: prefer Windows Terminal (wt.exe), fall back to
 * `cmd /c start`. Detached so it outlives the app; failures are logged only.
 */
export function launchClaudeTerminal(cwd: string, prompt: string): void {
  if (process.platform === 'win32') {
    try {
      const child = spawn('wt.exe', ['-w', 'new', '-d', cwd, 'claude', prompt], {
        detached: true,
        stdio: 'ignore'
      })
      child.on('error', () => spawnCmdFallback(cwd, prompt))
      child.unref()
      return
    } catch {
      spawnCmdFallback(cwd, prompt)
      return
    }
  }
  if (process.platform === 'darwin') {
    // Best-effort: open Terminal.app and run claude in the target directory.
    const script = `tell application "Terminal" to do script "cd ${shellQuote(cwd)} && claude ${shellQuote(prompt)}"`
    const child = spawn('osascript', ['-e', script], { detached: true, stdio: 'ignore' })
    child.on('error', (e) => console.error('osascript launch failed:', e))
    child.unref()
    return
  }
  // Linux best-effort: common terminal emulator.
  const child = spawn(
    'x-terminal-emulator',
    ['-e', `bash -lc 'cd ${shellQuote(cwd)} && claude ${shellQuote(prompt)}'`],
    { detached: true, stdio: 'ignore' }
  )
  child.on('error', (e) => console.error('x-terminal-emulator launch failed:', e))
  child.unref()
}

function spawnCmdFallback(cwd: string, prompt: string): void {
  const child = spawn('cmd.exe', ['/c', 'start', 'HiDock Handoff', 'cmd', '/k', 'claude', prompt], {
    cwd,
    detached: true,
    stdio: 'ignore'
  })
  child.on('error', (e) => console.error('cmd start fallback failed:', e))
  child.unref()
}

/** Minimal POSIX single-quote escaping for shell strings (mac/linux paths). */
function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`
}

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

        // Auto-export the output to the transcripts workspace so it's
        // immediately usable outside the app (e.g. fed to a coding agent).
        const savedPath = exportOutputToFile(result.content, parsed.data.templateId)

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
          generatedAt: result.generatedAt,
          savedPath
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
   * Reveal an exported output file in the OS file manager
   */
  ipcMain.handle(
    'outputs:openInFolder',
    async (_, filePath: unknown): Promise<Result<void>> => {
      try {
        if (typeof filePath !== 'string' || !filePath) {
          return error('VALIDATION_ERROR', 'filePath must be a non-empty string')
        }
        if (!existsSync(filePath)) {
          return error('NOT_FOUND', `File not found: ${filePath}`)
        }
        shell.showItemInFolder(filePath)
        return success(undefined)
      } catch (err) {
        console.error('outputs:openInFolder error:', err)
        return error('INTERNAL_ERROR', 'Failed to open folder', err)
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

        // Look up the actionable to get its artifact_id AND its source, so the
        // persisted derivative can be gated by source eligibility.
        const actionable = queryOne<{ artifact_id: string | null; source_knowledge_id: string | null }>(
          'SELECT artifact_id, source_knowledge_id FROM actionables WHERE id = ?',
          [actionableId]
        )

        if (!actionable) {
          return error('NOT_FOUND', `Actionable ${actionableId} not found`)
        }

        if (!actionable.artifact_id) {
          // No output generated yet
          return success(null)
        }

        // ADV16-5 (round-17) — gate the STORED generated derivative through the
        // shared actionable/capture eligibility boundary. After the source
        // recording/capture is trashed / marked personal / rated low-value /
        // soft-deleted, the stale actionable id must NOT re-expose its persisted
        // output content. filterEligibleActionableRows is fail-closed: a
        // recording-derived/standalone-capture skid that becomes excluded — or an
        // eligibility lookup error — drops the row, so we return no content.
        const eligibleRows = filterEligibleActionableRows(
          [actionable],
          (r) => r.source_knowledge_id
        )
        if (eligibleRows.length === 0) {
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

  /**
   * Open the generated handoff in a new Claude Code terminal session.
   *
   * cwd resolution order: explicit `cwd` (from a renderer folder pick) →
   * the source meeting's project folder → the configured handoffDirectory →
   * ask the renderer to pick a folder (`needsFolder: true`).
   *
   * The handoff Markdown must exist on disk; if only `content` is supplied it is
   * materialized via exportOutputToFile so previously-generated outputs still work.
   */
  ipcMain.handle(
    'outputs:launchClaudeCode',
    async (_, rawArgs: unknown): Promise<Result<LaunchClaudeCodeResult>> => {
      try {
        const args = (rawArgs && typeof rawArgs === 'object' ? rawArgs : {}) as {
          filePath?: unknown
          content?: unknown
          templateId?: unknown
          actionableId?: unknown
          cwd?: unknown
        }
        const actionableId = typeof args.actionableId === 'string' ? args.actionableId : undefined
        const explicitCwd = typeof args.cwd === 'string' && args.cwd.trim() ? args.cwd : undefined

        // Resolve the handoff file: use the supplied path if it exists, else
        // materialize it from content (covers re-opening a stored output).
        let filePath = typeof args.filePath === 'string' && args.filePath ? args.filePath : undefined
        if (!filePath || !existsSync(filePath)) {
          const content = typeof args.content === 'string' ? args.content : undefined
          const templateId = typeof args.templateId === 'string' ? args.templateId : 'claude_code_prompt'
          if (content) {
            filePath = exportOutputToFile(content, templateId)
          }
        }
        if (!filePath || !existsSync(filePath)) {
          return error('NOT_FOUND', 'The handoff file could not be found. Re-generate it and try again.')
        }

        // Resolve the working directory.
        let cwd: string | null = explicitCwd ?? null
        if (cwd) {
          // The user picked this folder — remember it for next time (non-fatal).
          try {
            await updateConfig('integrations', { handoffDirectory: cwd })
          } catch (cfgErr) {
            console.warn('outputs:launchClaudeCode: failed to persist handoffDirectory:', cfgErr)
          }
        }
        if (!cwd && actionableId) {
          cwd = resolveProjectFolderForActionable(actionableId)
        }
        if (!cwd) {
          const configured = getConfig().integrations?.handoffDirectory
          if (configured && existsSync(configured)) cwd = configured
        }
        if (!cwd) {
          // No folder known — let the renderer prompt for one and retry.
          return success({ launched: false, needsFolder: true })
        }
        if (!existsSync(cwd)) {
          return error('NOT_FOUND', `The handoff folder does not exist: ${cwd}`)
        }

        // Claude Code CLI must be installed.
        if (!findClaudeCli()) {
          return error(
            'SERVICE_UNAVAILABLE',
            'Claude Code CLI not found on PATH. Install it and make sure `claude` runs in your terminal.'
          )
        }

        const prompt = `Read the handoff prompt in "${filePath}" and carry out the follow-up work it describes. Start by reading that file.`
        launchClaudeTerminal(cwd, prompt)
        return success({ launched: true, cwd })
      } catch (err) {
        console.error('outputs:launchClaudeCode error:', err)
        return error('INTERNAL_ERROR', 'Failed to launch Claude Code', err)
      }
    }
  )

  console.log('Output IPC handlers registered')
}
