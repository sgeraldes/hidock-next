/**
 * Value-classification backfill IPC (F16/spec-003, Part H).
 *
 * Three zod-validated handlers over the value-backfill.ts service. Every
 * response is a structured `{ success, ... }` shape — never throws across
 * IPC. The runner itself already guards concurrency + no-provider; these
 * handlers just validate input at the boundary and pass through.
 */

import { ipcMain } from 'electron'
import { z } from 'zod'
import { startValueBackfill, cancelValueBackfill, getValueBackfillStatus } from '../services/value-backfill'

const StartBackfillSchema = z
  .object({
    order: z.enum(['newest', 'oldest']).default('newest')
  })
  .optional()

export function registerValueBackfillHandlers(): void {
  // Start a backfill run (no-op / already-running / no-provider guarded inside).
  ipcMain.handle('value:startBackfill', async (_, request: unknown) => {
    try {
      const parsed = StartBackfillSchema.safeParse(request)
      if (!parsed.success) {
        return { success: false, error: parsed.error.issues[0]?.message || 'Invalid request' }
      }
      const result = await startValueBackfill(parsed.data)
      return { success: true, started: result.started, reason: result.reason }
    } catch (e) {
      console.error('value:startBackfill error:', e)
      return { success: false, error: e instanceof Error ? e.message : 'Unknown error' }
    }
  })

  // Cancel an in-flight run. No untrusted input.
  ipcMain.handle('value:cancelBackfill', async () => {
    try {
      const result = cancelValueBackfill()
      return { success: true, cancelled: result.cancelled }
    } catch (e) {
      console.error('value:cancelBackfill error:', e)
      return { success: false, error: e instanceof Error ? e.message : 'Unknown error' }
    }
  })

  // Read-only status for the Settings card (resume affordance / initial state).
  ipcMain.handle('value:getBackfillStatus', async () => {
    try {
      const data = getValueBackfillStatus()
      return { success: true, data }
    } catch (e) {
      console.error('value:getBackfillStatus error:', e)
      return { success: false, error: e instanceof Error ? e.message : 'Unknown error' }
    }
  })

  console.log('Value backfill IPC handlers registered')
}
