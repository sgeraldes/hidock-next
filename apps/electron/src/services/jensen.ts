/**
 * Jensen protocol — Electron renderer binding.
 *
 * The protocol implementation lives in the shared, transport-agnostic package
 * `@hidock/jensen-protocol`. In the renderer the browser WebUSB backend
 * (`navigator.usb`) is resolved lazily by the package, so no backend needs to
 * be injected here. Device logs are gated behind the QA Logs toggle.
 */

import { JensenDevice, setJensenLogging } from '@hidock/jensen-protocol'
import { shouldLogQa } from './qa-monitor'

// Renderer device logs respect the QA Logs setting (see project QA logging rules).
setJensenLogging(shouldLogQa)

export { JensenDevice }

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
// Singleton (renderer)
// ============================================================

let deviceInstance: JensenDevice | null = null

export function getJensenDevice(): JensenDevice {
  if (!deviceInstance) {
    deviceInstance = new JensenDevice()
    deviceInstance.setupUsbConnectListener()
  }
  return deviceInstance
}
