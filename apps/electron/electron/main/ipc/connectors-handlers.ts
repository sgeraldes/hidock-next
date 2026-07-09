/**
 * IPC handlers for the connector host (Layer 2). Namespace: `connectors:*`.
 *
 * Bridges the renderer Settings → Connectors UI to the main-process
 * ConnectorHost: list/status/configure/connect/disconnect/sync + source
 * toggles + people search. Status changes are pushed to the renderer via
 * `connectors:status-changed`.
 */
import { ipcMain, BrowserWindow } from 'electron'
import { getConnectorHost } from '../services/connectors'
import { getEventBus } from '../services/event-bus'

let statusWired = false

export function registerConnectorsHandlers(): void {
  const host = getConnectorHost()

  // Push connector status changes to the renderer (wire once).
  if (!statusWired) {
    host.onStatus((id, status) => {
      const win = BrowserWindow.getAllWindows()[0]
      win?.webContents.send('connectors:status-changed', { id, status })
    })
    statusWired = true
  }

  ipcMain.handle('connectors:list', () => host.list())

  ipcMain.handle('connectors:get', (_e, id: string) => host.summary(id))

  ipcMain.handle('connectors:configure', async (_e, id: string, values: Record<string, string | number | boolean>) => {
    await host.configure(id, values)
    return host.summary(id)
  })

  // User-initiated connect: interactive (may drive device-code sign-in).
  ipcMain.handle('connectors:connect', async (_e, id: string) => {
    await host.connect(id, { interactive: true })
    return host.summary(id)
  })

  ipcMain.handle('connectors:disconnect', async (_e, id: string) => {
    await host.disconnect(id)
    return host.summary(id)
  })

  ipcMain.handle('connectors:listContainers', (_e, id: string) => host.listContainers(id))

  ipcMain.handle('connectors:setSourceEnabled', (_e, id: string, containerId: string, enabled: boolean) => {
    host.setSourceEnabled(id, containerId, enabled)
    return host.summary(id)
  })

  ipcMain.handle('connectors:sync', async (_e, id: string, containerId?: string) => {
    const outcome = await host.syncNow(id, containerId)
    // Nudge meeting/People surfaces to refetch when a sync produced meetings.
    if (outcome.meetings > 0) {
      try {
        getEventBus().emitDomainEvent({
          type: 'calendar:synced',
          timestamp: new Date().toISOString(),
          payload: { meetingsCount: outcome.meetings },
        })
      } catch {
        /* non-fatal */
      }
    }
    return outcome
  })

  ipcMain.handle('connectors:searchPeople', (_e, query: string) => host.searchPeople(query))
}
