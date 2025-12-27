/**
 * IPC handlers for the Data Integrity Service
 */

import { ipcMain } from 'electron'
import { getIntegrityService } from '../services/integrity-service'

export function registerIntegrityHandlers(): void {
  const service = getIntegrityService()

  // Run full integrity scan
  ipcMain.handle('integrity:run-scan', async () => {
    return service.runFullScan()
  })

  // Get last scan report
  ipcMain.handle('integrity:get-report', () => {
    return service.getLastReport()
  })

  // Repair a specific issue
  ipcMain.handle('integrity:repair-issue', async (_, issueId: string) => {
    return service.repairIssue(issueId)
  })

  // Repair all auto-repairable issues
  ipcMain.handle('integrity:repair-all', async () => {
    return service.repairAllAuto()
  })

  // Run startup checks (can also be called manually)
  ipcMain.handle('integrity:run-startup-checks', async () => {
    return service.runStartupChecks()
  })

  console.log('[IntegrityHandlers] IPC handlers registered')
}
