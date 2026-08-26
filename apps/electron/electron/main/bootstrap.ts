import { app } from 'electron'
import { join } from 'path'
import { acquireSingleInstanceLock } from './single-instance'
import { createSplashWindow } from './splash-screen'
import { configureEarlyStartup } from './startup-configuration'
import { getStartupState } from './startup-state'

const startup = getStartupState()
startup.runtimeDir = __dirname
configureEarlyStartup()

startup.hasSingleInstanceLock = acquireSingleInstanceLock({
  getMainWindow: () => startup.mainWindow,
  getSplashWindow: () => startup.splashWindow
})

if (startup.hasSingleInstanceLock) {
  app.whenReady().then(async () => {
    // This entry intentionally imports no database, AI, graph, transcription,
    // or renderer application modules. Show a useful frame first; the splash's
    // renderer process stays responsive while the main process evaluates the
    // heavier application chunk.
    startup.splashWindow = await createSplashWindow(join(__dirname, '../preload/splash.js'))
    await import('./index')
  }).catch((error) => {
    console.error('[Startup] Application bootstrap failed:', error)
    app.quit()
  })
}
