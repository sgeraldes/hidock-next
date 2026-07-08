/**
 * useDeviceConnection — the single source of truth for the device connect/
 * disconnect control shared by the titlebar status pill and the Device Sync page.
 *
 * Both surfaces MUST derive their status from the same store selectors and route
 * through the same connect/disconnect calls so their behavior can never drift.
 *
 * Status is derived from the app store (updated by OperationController from the
 * device service's connection/status listeners):
 *   - `connected`    → deviceState.connected is true
 *   - `connecting`   → a connect attempt is in flight (store step in-progress, or
 *                      this call site just kicked one off)
 *   - `disconnected` → otherwise
 *
 * ⛔ USB SAFETY (see CLAUDE.md): connecting is guarded by a MODULE-level in-flight
 * flag so two surfaces (titlebar + sync page) can never launch overlapping
 * connect attempts. One click = one attempt. We never auto-retry on failure.
 */

import { useCallback, useRef, useState } from 'react'
import { useDeviceState, useConnectionStatus } from '@/store/useAppStore'
import { getHiDockDeviceService } from '@/services/hidock-device'
import { toast } from '@/components/ui/toaster'

export type DeviceConnectionStatus = 'connected' | 'connecting' | 'disconnected'

/**
 * Shared across every hook instance: guarantees a single USB connect attempt is
 * in flight at a time, no matter which surface initiated it.
 */
let connectInFlight = false

export interface UseDeviceConnectionOptions {
  /**
   * Surface connect/disconnect failures as a toast. Defaults to `true` (the
   * titlebar pill has no room for an inline error). The Device Sync page passes
   * `false` because it renders its own inline error banner from the store.
   */
  toastErrors?: boolean
}

export interface UseDeviceConnection {
  status: DeviceConnectionStatus
  isConnected: boolean
  isConnecting: boolean
  isDisconnected: boolean
  /** Formatted device model when connected (e.g. "H1E"), otherwise null. */
  deviceModel: string | null
  /** Human label for the control: model name / "Connecting…" / "Connect device". */
  label: string
  /** Kick off one connect attempt. Returns whether it succeeded. Never retries. */
  connect: () => Promise<boolean>
  /** Disconnect the device. */
  disconnect: () => Promise<void>
}

export function useDeviceConnection(
  options: UseDeviceConnectionOptions = {}
): UseDeviceConnection {
  const { toastErrors = true } = options
  const deviceState = useDeviceState()
  const connectionStatus = useConnectionStatus()

  // Bridges the gap between click and the store reflecting the attempt, so the
  // initiating surface shows "connecting" immediately.
  const [pending, setPending] = useState(false)
  const pendingRef = useRef(false)

  const step = connectionStatus.step
  const storeConnecting = step !== 'idle' && step !== 'ready' && step !== 'error'
  const isConnected = deviceState.connected
  const isConnecting = !isConnected && (storeConnecting || pending)
  const isDisconnected = !isConnected && !isConnecting

  const status: DeviceConnectionStatus = isConnected
    ? 'connected'
    : isConnecting
      ? 'connecting'
      : 'disconnected'

  const deviceModel = isConnected
    ? deviceState.model && deviceState.model !== 'unknown'
      ? deviceState.model.replace('hidock-', '').toUpperCase()
      : 'Device'
    : null

  const label = isConnected
    ? deviceModel ?? 'Device'
    : isConnecting
      ? 'Connecting…'
      : 'Connect device'

  const connect = useCallback(async (): Promise<boolean> => {
    const service = getHiDockDeviceService()
    // USB SAFETY: never launch a second attempt while one is in flight or the
    // device is already connected.
    if (connectInFlight || service.isConnected()) return false

    connectInFlight = true
    pendingRef.current = true
    setPending(true)
    try {
      const success = await service.connect()
      if (!success && toastErrors) {
        toast({
          title: 'Connection failed',
          description:
            'Could not connect to the HiDock. Check that it is plugged in via USB and not in use by another app.',
          variant: 'error'
        })
      }
      return success
    } catch (e) {
      if (toastErrors) {
        toast({
          title: 'Connection failed',
          description: e instanceof Error ? e.message : 'Unknown error',
          variant: 'error'
        })
      }
      return false
    } finally {
      connectInFlight = false
      pendingRef.current = false
      setPending(false)
    }
  }, [toastErrors])

  const disconnect = useCallback(async (): Promise<void> => {
    try {
      await getHiDockDeviceService().disconnect()
    } catch (e) {
      if (toastErrors) {
        toast({
          title: 'Disconnect failed',
          description: e instanceof Error ? e.message : 'Unknown error',
          variant: 'error'
        })
      }
    }
  }, [toastErrors])

  return {
    status,
    isConnected,
    isConnecting,
    isDisconnected,
    deviceModel,
    label,
    connect,
    disconnect
  }
}
