/**
 * Jensen protocol — Electron renderer binding.
 *
 * The protocol implementation lives in the shared, transport-agnostic package
 * `@hidock/jensen-protocol`. At runtime the renderer no longer talks WebUSB
 * directly: `getJensenDevice()` returns a `JensenIpcClient` that routes every
 * call to the main process over IPC (the main process owns the single node-usb
 * device). The `JensenDevice` class is still re-exported for its types and for
 * any consumer that needs the WebUSB protocol surface directly.
 *
 * Device logs are gated behind the QA Logs toggle.
 */

import { JensenDevice, setJensenLogging } from '@hidock/jensen-protocol'
import { shouldLogQa } from './qa-monitor'
import { JensenIpcClient, getJensenIpcClient } from './jensen-ipc-client'

// Renderer device logs respect the QA Logs setting (see project QA logging rules).
setJensenLogging(shouldLogQa)

export { JensenDevice, JensenIpcClient }

export {
  CMD,
  USB_VENDOR_ID,
  USB_ALTERNATE_VENDOR_ID,
  USB_VENDOR_IDS,
  USB_PRODUCT_IDS,
  EP_OUT,
  EP_IN,
} from '@hidock/jensen-protocol'

export type {
  DeviceModel,
  DeviceInfo,
  FileInfo,
  CardInfo,
  DeviceSettings,
  RealtimeSettings,
  RealtimeData,
  BatteryStatus,
  BluetoothDevice,
  BluetoothStatus,
} from '@hidock/jensen-protocol'

// ============================================================
// Singleton (renderer) — IPC-backed
// ============================================================

/**
 * Returns the renderer device handle. This is a `JensenIpcClient` that
 * implements the same surface as `JensenDevice` but delegates to the main
 * process over IPC. The cast is structural: `JensenIpcClient` provides every
 * member `hidock-device.ts` uses.
 */
export function getJensenDevice(): JensenDevice {
  return getJensenIpcClient() as unknown as JensenDevice
}

/**
 * Escape hatch: a direct WebUSB-backed device from the shared package
 * (browser transport). Unused by the IPC-based renderer flow today; kept for
 * tooling/diagnostics that may need to talk WebUSB from the renderer directly.
 * @deprecated Prefer getJensenDevice() which is IPC-backed.
 */
export function getWebUsbJensenDevice(): JensenDevice {
  const instance = new JensenDevice()
  instance.setupUsbConnectListener()
  return instance
}
