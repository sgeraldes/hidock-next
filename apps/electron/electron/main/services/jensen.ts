/**
 * Jensen protocol — Electron main-process binding.
 *
 * The protocol implementation now lives in the shared, transport-agnostic
 * package `@hidock/jensen-protocol`. This module binds the node-usb WebUSB
 * backend (`new WebUSB()` from the `usb` package) and exposes the same public
 * API the main process has always used, so IPC handlers and tests are unchanged.
 */

/// <reference types="w3c-web-usb" />

import { WebUSB } from 'usb'
import { JensenDevice as CoreJensenDevice } from '@hidock/jensen-protocol'

// node-usb's WebUSB backend. `allowAllDevices` bypasses the browser picker so
// the main process can enumerate the HiDock without user interaction.
const webusb = new WebUSB({ allowAllDevices: true }) as unknown as USB

/**
 * Main-process JensenDevice: identical protocol logic from the shared package,
 * with the node-usb WebUSB backend bound as the default. Callers can still do
 * `new JensenDevice()` (no args) exactly as before.
 */
export class JensenDevice extends CoreJensenDevice {
  constructor(usb: USB = webusb) {
    super(usb)
  }

  static isSupported(usb: USB = webusb): boolean {
    return CoreJensenDevice.isSupported(usb)
  }
}

// Re-export the protocol surface so existing `from '../services/jensen'` imports keep working.
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
// Singleton (process-wide, main process)
// ============================================================

let deviceInstance: JensenDevice | null = null

// Injected at startup (setAutoConnectChecker) so this module — which is shared
// with the renderer tsconfig and unit-tested in isolation — does not statically
// import the Electron-only config module. Defaults to the original always-connect
// behavior until wired.
let autoConnectChecker: (() => boolean) | null = null
const gate = (): boolean => (autoConnectChecker ? autoConnectChecker() : true)

/**
 * Wire the USB hot-plug auto-connect gate to a config reader. Called once during
 * main-process startup. Without it, the device reconnects on every power-on /
 * plug-in regardless of the user's "Auto-connect on startup" toggle. Manual
 * connect() (the jensen:connect IPC / "Connect Device" button) never goes
 * through this gate, so it always works.
 */
export function setAutoConnectChecker(fn: () => boolean): void {
  autoConnectChecker = fn
  if (deviceInstance) deviceInstance.autoConnectGate = gate
}

export function getJensenDevice(): JensenDevice {
  if (!deviceInstance) {
    deviceInstance = new JensenDevice()
    deviceInstance.autoConnectGate = gate
    deviceInstance.setupUsbConnectListener()
  }
  return deviceInstance
}
