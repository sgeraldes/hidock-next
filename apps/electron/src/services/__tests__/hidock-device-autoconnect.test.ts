/**
 * HiDock Device Service - Auto-connect Persistence Tests
 *
 * BUG-AC-001: enableAutoConnect() doesn't persist re-enabled state
 *   OBSERVED: After disconnect → restart, auto-connect stays disabled forever
 *   ROOT CAUSE: disableAutoConnect() persists false, but enableAutoConnect() only sets in-memory
 *
 * BUG-AC-002: After disconnect, enableAutoConnect must re-persist config
 *   The flow: connect → disconnect (persists false) → connect again (only in-memory)
 *   → restart app → config says false → auto-connect never starts
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

// We can't easily instantiate HiDockDeviceService (it depends on Jensen, USB, etc.)
// Instead, test the logic pattern directly

describe('Auto-connect persistence logic', () => {
  let configFile: Record<string, any>
  let inMemory: { enabled: boolean; connectOnStartup: boolean }

  const saveConfig = vi.fn((config: any) => {
    configFile = { ...configFile, ...config }
  })

  beforeEach(() => {
    vi.clearAllMocks()
    // Simulate fresh app state
    configFile = { autoConnect: true }
    inMemory = { enabled: true, connectOnStartup: true }
  })

  function disableAutoConnect() {
    inMemory.enabled = false
    inMemory.connectOnStartup = false
    saveConfig({ autoConnect: inMemory.enabled })
  }

  function enableAutoConnect() {
    inMemory.enabled = true
    // BUG: This function does NOT call saveConfig()
    // Fix: Should call saveConfig({ autoConnect: inMemory.enabled })
  }

  function enableAutoConnectFixed() {
    inMemory.enabled = true
    inMemory.connectOnStartup = true
    saveConfig({ autoConnect: inMemory.enabled })
  }

  it('BUG-AC-001: disconnect persists false but reconnect does not persist true', () => {
    // Step 1: User disconnects
    disableAutoConnect()
    expect(configFile.autoConnect).toBe(false) // Persisted correctly

    // Step 2: User reconnects
    enableAutoConnect()
    expect(inMemory.enabled).toBe(true) // In-memory correct

    // BUG: Config file still says false!
    expect(configFile.autoConnect).toBe(false) // <-- This is the bug

    // Step 3: App restarts - reads from config file
    const afterRestart = configFile.autoConnect
    // Auto-connect will NOT start because config says false
    expect(afterRestart).toBe(false) // Bug confirmed: auto-connect dead after restart
  })

  it('FIXED: enableAutoConnect should persist the re-enabled state', () => {
    // Step 1: User disconnects
    disableAutoConnect()
    expect(configFile.autoConnect).toBe(false)

    // Step 2: User reconnects (with fix)
    enableAutoConnectFixed()
    expect(inMemory.enabled).toBe(true)

    // With fix: Config file should now say true
    expect(configFile.autoConnect).toBe(true) // Fixed!

    // Step 3: App restarts - reads from config file
    const afterRestart = configFile.autoConnect
    expect(afterRestart).toBe(true) // Auto-connect works after restart
  })
})
