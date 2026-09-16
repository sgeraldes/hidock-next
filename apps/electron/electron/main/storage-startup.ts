import { dialog, type BrowserWindow } from 'electron'
import { getConfig, updateConfig } from './services/config'
import { initializeFileStorage, StorageInitializationError } from './services/file-storage'

/** Recover storage before opening the database; never silently replace a library. */
export async function initializeStartupStorage(
  owner: BrowserWindow | null,
  status: (message: string, progress?: number) => Promise<void>
): Promise<boolean> {
  let candidate = { ...getConfig().storage }
  while (true) {
    try {
      await status('Setting up storage...', 20)
      await initializeFileStorage(candidate)
      if (JSON.stringify(candidate) !== JSON.stringify(getConfig().storage)) {
        await updateConfig('storage', candidate)
      }
      return true
    } catch (error) {
      if (!(error instanceof StorageInitializationError)) throw error
      console.error('[Startup] Storage initialization failed:', error)
      await status('Storage unavailable. Choose an option in the dialog.')
      const options: Electron.MessageBoxOptions = {
        type: 'error',
        title: 'Storage unavailable',
        message: 'HiDock could not open its storage folder.',
        detail: `${error.message}\n\nReconnect the drive and retry, or choose the existing folder at its new location. ` +
          'Choosing an empty data folder starts a separate library. Existing files are not moved or deleted.',
        buttons: ['Retry', 'Choose Folder...', 'Quit'],
        defaultId: 0,
        cancelId: 2,
        noLink: true
      }
      const parent = owner && !owner.isDestroyed() ? owner : null
      const { response } = parent
        ? await dialog.showMessageBox(parent, options)
        : await dialog.showMessageBox(options)
      if (response === 2) return false
      if (response !== 1) continue
      const pickerOptions: Electron.OpenDialogOptions = {
        title: `Choose storage folder (${error.setting})`,
        properties: ['openDirectory', 'createDirectory']
      }
      const selected = parent
        ? await dialog.showOpenDialog(parent, pickerOptions)
        : await dialog.showOpenDialog(pickerOptions)
      if (!selected.canceled && selected.filePaths[0]) {
        candidate = { ...candidate, [error.setting]: selected.filePaths[0] }
      }
    }
  }
}
