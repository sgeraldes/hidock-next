/**
 * @hidock/jensen-protocol — transport-agnostic Jensen USB protocol for HiDock devices.
 *
 * The protocol logic is identical across environments; only the WebUSB backend
 * differs. Inject `navigator.usb` (browser) or `new WebUSB()` from the node `usb`
 * package (Electron main / Node) into the JensenDevice constructor.
 */

export {
  JensenDevice,
  CMD,
  USB_VENDOR_ID,
  USB_ALTERNATE_VENDOR_ID,
  USB_VENDOR_IDS,
  USB_PRODUCT_IDS,
  EP_OUT,
  EP_IN,
} from './jensen-device.js'

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
} from './jensen-device.js'
