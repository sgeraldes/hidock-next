/**
 * Safe accessor for the Electron API bridge.
 * Returns undefined if running outside Electron or if preload failed.
 */
export function getElectronAPI(): typeof window.electronAPI | undefined {
  return typeof window !== 'undefined' ? window.electronAPI : undefined
}
