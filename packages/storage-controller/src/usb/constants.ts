import type { DeviceModel } from '../core/types.js'

// Vendor IDs
export const USB_VENDOR_ID = 0x10d6          // Actions Semiconductor (older)
export const USB_ALTERNATE_VENDOR_ID = 0x3887 // HiDock (newer P1 Mini)
export const USB_VENDOR_IDS: number[] = [0x10d6, 0x3887]

// Product IDs
export const USB_PRODUCT_IDS = {
  H1: 0xaf0c,
  H1E_OLD: 0xaf0d,
  H1E: 0xb00d,
  P1_OLD: 0xaf0e,
  P1: 0xb00e,
  P1_MINI: 0xaf0f,
  H1_ALT1: 0x0100,
  H1E_ALT1: 0x0101,
  H1_ALT2: 0x0102,
  H1E_ALT2: 0x0103,
  P1_ALT: 0x2040,
  P1_MINI_ALT: 0x2041
} as const

// Product ID to model name mapping
export const PRODUCT_ID_MODEL_MAP: Record<number, DeviceModel> = {
  0xaf0c: 'hidock-h1',
  0x0100: 'hidock-h1',
  0x0102: 'hidock-h1',
  0xaf0d: 'hidock-h1e',
  0xb00d: 'hidock-h1e',
  0x0101: 'hidock-h1e',
  0x0103: 'hidock-h1e',
  0xaf0e: 'hidock-p1',
  0xb00e: 'hidock-p1',
  0x2040: 'hidock-p1',
  0xaf0f: 'hidock-p1-mini',
  0x2041: 'hidock-p1-mini'
}

// USB endpoints
export const EP_OUT = 0x01
export const EP_IN = 0x82

// Jensen protocol command codes (read-only subset)
export const CMD = {
  GET_DEVICE_INFO: 1,
  GET_FILE_LIST: 4,
  TRANSFER_FILE: 5,
  GET_FILE_COUNT: 6,
  GET_CARD_INFO: 16
} as const
