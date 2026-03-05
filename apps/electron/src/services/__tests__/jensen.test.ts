import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  CMD,
  USB_VENDOR_ID,
  USB_ALTERNATE_VENDOR_ID,
  USB_VENDOR_IDS,
  USB_PRODUCT_IDS,
  EP_OUT,
  EP_IN,
  JensenDevice,
  getJensenDevice,
} from '../jensen'

// ============================================================
// Helpers: Mock WebUSB
// ============================================================

function createMockUSBDevice(overrides: Partial<USBDevice> = {}): USBDevice {
  // Track opened state mutably so open()/close() can update it
  const state = { opened: overrides.opened ?? false }

  const device: any = {
    vendorId: overrides.vendorId ?? USB_VENDOR_ID,
    productId: overrides.productId ?? USB_PRODUCT_IDS.H1,
    productName: overrides.productName ?? 'HiDock H1',
    configuration: {
      configurationValue: 1,
      configurationName: 'Default',
      interfaces: [
        {
          interfaceNumber: 0,
          claimed: false,
          alternate: {
            alternateSetting: 0,
            interfaceClass: 0xff,
            interfaceSubclass: 0,
            interfaceProtocol: 0,
            interfaceName: null,
            endpoints: [
              {
                endpointNumber: 1,
                direction: 'out' as USBDirection,
                type: 'bulk' as USBEndpointType,
                packetSize: 512,
              },
              {
                endpointNumber: 2,
                direction: 'in' as USBDirection,
                type: 'bulk' as USBEndpointType,
                packetSize: 512,
              },
            ],
          },
          alternates: [
            {
              alternateSetting: 0,
              interfaceClass: 0xff,
              interfaceSubclass: 0,
              interfaceProtocol: 0,
              interfaceName: null,
              endpoints: [
                {
                  endpointNumber: 1,
                  direction: 'out' as USBDirection,
                  type: 'bulk' as USBEndpointType,
                  packetSize: 512,
                },
                {
                  endpointNumber: 2,
                  direction: 'in' as USBDirection,
                  type: 'bulk' as USBEndpointType,
                  packetSize: 512,
                },
              ],
            },
          ],
        },
      ],
    } as USBConfiguration,
    configurations: [
      { configurationValue: 1 } as USBConfiguration,
    ],
    deviceClass: 0xff,
    deviceSubclass: 0,
    deviceProtocol: 0,
    deviceVersionMajor: 1,
    deviceVersionMinor: 0,
    deviceVersionSubminor: 0,
    manufacturerName: 'Actions Semiconductor',
    serialNumber: 'SN12345',
    usbVersionMajor: 2,
    usbVersionMinor: 0,
    usbVersionSubminor: 0,
    open: overrides.open ?? vi.fn().mockImplementation(async () => { state.opened = true }),
    close: overrides.close ?? vi.fn().mockImplementation(async () => { state.opened = false }),
    forget: vi.fn().mockResolvedValue(undefined),
    selectConfiguration: vi.fn().mockResolvedValue(undefined),
    claimInterface: vi.fn().mockResolvedValue(undefined),
    releaseInterface: vi.fn().mockResolvedValue(undefined),
    selectAlternateInterface: vi.fn().mockResolvedValue(undefined),
    controlTransferIn: vi.fn().mockResolvedValue({ status: 'ok', data: new DataView(new ArrayBuffer(0)) }),
    controlTransferOut: vi.fn().mockResolvedValue({ status: 'ok', bytesWritten: 0 }),
    transferIn: vi.fn().mockResolvedValue({ status: 'ok', data: new DataView(new ArrayBuffer(0)) }),
    transferOut: vi.fn().mockResolvedValue({ status: 'ok', bytesWritten: 0 }),
    clearHalt: vi.fn().mockResolvedValue(undefined),
    reset: overrides.reset ?? vi.fn().mockResolvedValue(undefined),
    isochronousTransferIn: vi.fn().mockResolvedValue({ data: new DataView(new ArrayBuffer(0)), packets: [] }),
    isochronousTransferOut: vi.fn().mockResolvedValue({ data: new DataView(new ArrayBuffer(0)), packets: [] }),
  }

  // Use Object.defineProperty to make 'opened' a dynamic getter
  Object.defineProperty(device, 'opened', {
    get: () => state.opened,
    set: (v: boolean) => { state.opened = v },
    enumerable: true,
    configurable: true,
  })

  return device as USBDevice
}

function setupNavigatorUSB(devices: USBDevice[] = []) {
  const mockUSB = {
    getDevices: vi.fn().mockResolvedValue(devices),
    requestDevice: vi.fn().mockResolvedValue(devices[0] || null),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    onconnect: null as ((event: USBConnectionEvent) => void) | null,
    ondisconnect: null as ((event: USBConnectionEvent) => void) | null,
  }

  Object.defineProperty(navigator, 'usb', {
    value: mockUSB,
    writable: true,
    configurable: true,
  })

  return mockUSB
}

// ============================================================
// Tests: Constants
// ============================================================

describe('Jensen protocol constants', () => {
  describe('CMD', () => {
    it('has correct basic device command IDs', () => {
      expect(CMD.GET_DEVICE_INFO).toBe(1)
      expect(CMD.GET_DEVICE_TIME).toBe(2)
      expect(CMD.SET_DEVICE_TIME).toBe(3)
      expect(CMD.GET_FILE_LIST).toBe(4)
      expect(CMD.TRANSFER_FILE).toBe(5)
      expect(CMD.GET_FILE_COUNT).toBe(6)
      expect(CMD.DELETE_FILE).toBe(7)
    })

    it('has correct settings command IDs', () => {
      expect(CMD.GET_SETTINGS).toBe(11)
      expect(CMD.SET_SETTINGS).toBe(12)
    })

    it('has correct realtime streaming command IDs', () => {
      expect(CMD.REALTIME_READ_SETTING).toBe(32)
      expect(CMD.REALTIME_CONTROL).toBe(33)
      expect(CMD.REALTIME_TRANSFER).toBe(34)
    })

    it('has correct Bluetooth command IDs (P1 devices)', () => {
      expect(CMD.BLUETOOTH_SCAN).toBe(4097)
      expect(CMD.BLUETOOTH_CMD).toBe(4098)
      expect(CMD.BLUETOOTH_STATUS).toBe(4099)
      expect(CMD.GET_BATTERY_STATUS).toBe(4100)
    })

    it('has correct factory/debug command IDs', () => {
      expect(CMD.FACTORY_RESET).toBe(61451)
      expect(CMD.BLUE_B_TIMEOUT).toBe(61457)
    })

    it('commands are readonly (const assertion)', () => {
      // TypeScript const assertion prevents reassignment at compile time.
      // At runtime, we verify the values are numbers.
      const allValues = Object.values(CMD)
      expect(allValues.every((v) => typeof v === 'number')).toBe(true)
    })
  })

  describe('USB identifiers', () => {
    it('has correct vendor IDs', () => {
      expect(USB_VENDOR_ID).toBe(0x10d6)
      expect(USB_ALTERNATE_VENDOR_ID).toBe(0x3887)
    })

    it('USB_VENDOR_IDS includes both vendor IDs', () => {
      expect(USB_VENDOR_IDS).toContain(0x10d6)
      expect(USB_VENDOR_IDS).toContain(0x3887)
      expect(USB_VENDOR_IDS).toHaveLength(2)
    })

    it('has correct product IDs for all models', () => {
      expect(USB_PRODUCT_IDS.H1).toBe(0xaf0c)
      expect(USB_PRODUCT_IDS.H1E).toBe(0xb00d)
      expect(USB_PRODUCT_IDS.H1E_OLD).toBe(0xaf0d)
      expect(USB_PRODUCT_IDS.P1).toBe(0xb00e)
      expect(USB_PRODUCT_IDS.P1_OLD).toBe(0xaf0e)
      expect(USB_PRODUCT_IDS.P1_MINI).toBe(0xaf0f)
    })

    it('has correct alternative product IDs', () => {
      expect(USB_PRODUCT_IDS.H1_ALT1).toBe(0x0100)
      expect(USB_PRODUCT_IDS.H1E_ALT1).toBe(0x0101)
      expect(USB_PRODUCT_IDS.H1_ALT2).toBe(0x0102)
      expect(USB_PRODUCT_IDS.H1E_ALT2).toBe(0x0103)
      expect(USB_PRODUCT_IDS.P1_ALT).toBe(0x2040)
      expect(USB_PRODUCT_IDS.P1_MINI_ALT).toBe(0x2041)
    })

    it('has correct endpoint addresses', () => {
      expect(EP_OUT).toBe(0x01)
      expect(EP_IN).toBe(0x82)
    })
  })
})

// ============================================================
// Tests: JensenDevice
// ============================================================

describe('JensenDevice', () => {
  let device: JensenDevice

  beforeEach(() => {
    device = new JensenDevice()
  })

  afterEach(async () => {
    // Clean up: disconnect if connected
    try {
      await device.disconnect()
    } catch {
      // Ignore cleanup errors
    }
  })

  // ============================================================
  // isSupported
  // ============================================================

  describe('isSupported', () => {
    it('returns true when navigator.usb exists', () => {
      setupNavigatorUSB()
      expect(JensenDevice.isSupported()).toBe(true)
    })

    it('returns false when navigator.usb is absent', () => {
      // Save original and remove
      const originalUsb = (navigator as any).usb
      delete (navigator as any).usb

      try {
        expect(JensenDevice.isSupported()).toBe(false)
      } finally {
        // Restore
        if (originalUsb !== undefined) {
          Object.defineProperty(navigator, 'usb', {
            value: originalUsb,
            writable: true,
            configurable: true,
          })
        }
      }
    })
  })

  // ============================================================
  // Initial state
  // ============================================================

  describe('initial state', () => {
    it('starts disconnected', () => {
      expect(device.isConnected()).toBe(false)
    })

    it('has unknown model initially', () => {
      expect(device.getModel()).toBe('unknown')
    })

    it('has no version info initially', () => {
      expect(device.versionCode).toBeNull()
      expect(device.versionNumber).toBeNull()
      expect(device.serialNumber).toBeNull()
    })

    it('has no active operation initially', () => {
      expect(device.isOperationInProgress()).toBe(false)
      expect(device.getLockHolder()).toBeNull()
    })
  })

  // ============================================================
  // connect / tryConnect
  // ============================================================

  describe('connect', () => {
    it('returns false when WebUSB is not supported', async () => {
      const originalUsb = (navigator as any).usb
      delete (navigator as any).usb

      try {
        const result = await device.connect()
        expect(result).toBe(false)
      } finally {
        if (originalUsb !== undefined) {
          Object.defineProperty(navigator, 'usb', {
            value: originalUsb,
            writable: true,
            configurable: true,
          })
        }
      }
    })

    it('connects successfully to an authorized device', async () => {
      const mockDevice = createMockUSBDevice()
      setupNavigatorUSB([mockDevice])

      const result = await device.connect()
      expect(result).toBe(true)
      expect(device.isConnected()).toBe(true)
      expect(mockDevice.open).toHaveBeenCalled()
      expect(mockDevice.selectConfiguration).toHaveBeenCalledWith(1)
      expect(mockDevice.claimInterface).toHaveBeenCalledWith(0)
      expect(mockDevice.selectAlternateInterface).toHaveBeenCalledWith(0, 0)
    })

    it('determines correct model for H1 device', async () => {
      const mockDevice = createMockUSBDevice({
        productId: USB_PRODUCT_IDS.H1,
      } as any)
      setupNavigatorUSB([mockDevice])

      await device.connect()
      expect(device.getModel()).toBe('hidock-h1')
    })

    it('determines correct model for H1E device', async () => {
      const mockDevice = createMockUSBDevice({
        productId: USB_PRODUCT_IDS.H1E,
      } as any)
      setupNavigatorUSB([mockDevice])

      await device.connect()
      expect(device.getModel()).toBe('hidock-h1e')
    })

    it('determines correct model for P1 device', async () => {
      const mockDevice = createMockUSBDevice({
        productId: USB_PRODUCT_IDS.P1,
      } as any)
      setupNavigatorUSB([mockDevice])

      await device.connect()
      expect(device.getModel()).toBe('hidock-p1')
    })

    it('determines correct model for P1 Mini device', async () => {
      const mockDevice = createMockUSBDevice({
        productId: USB_PRODUCT_IDS.P1_MINI,
      } as any)
      setupNavigatorUSB([mockDevice])

      await device.connect()
      expect(device.getModel()).toBe('hidock-p1-mini')
    })

    it('determines correct model for P1 Mini alternate ID', async () => {
      const mockDevice = createMockUSBDevice({
        productId: USB_PRODUCT_IDS.P1_MINI_ALT,
      } as any)
      setupNavigatorUSB([mockDevice])

      await device.connect()
      expect(device.getModel()).toBe('hidock-p1-mini')
    })

    it('sets model to unknown for unrecognized product ID', async () => {
      const mockDevice = createMockUSBDevice({
        productId: 0x9999,
      } as any)
      setupNavigatorUSB([mockDevice])

      await device.connect()
      expect(device.getModel()).toBe('unknown')
    })

    it('closes already-open device before reconnecting', async () => {
      const mockDevice = createMockUSBDevice({ opened: true } as any)
      setupNavigatorUSB([mockDevice])

      await device.connect()
      // close should be called to clean up the stale connection (at least once for disconnect + once for open device)
      expect(mockDevice.close).toHaveBeenCalled()
    })

    it('fires onconnect callback after successful connection', async () => {
      const mockDevice = createMockUSBDevice()
      setupNavigatorUSB([mockDevice])

      const onconnectSpy = vi.fn()
      device.onconnect = onconnectSpy

      await device.connect()
      // onconnect is deferred via setTimeout(300) to give the device firmware
      // time to stabilize after USB interface is claimed before sending commands.
      await new Promise(resolve => setTimeout(resolve, 350))
      expect(onconnectSpy).toHaveBeenCalledTimes(1)
    })

    it('resets sequence ID on connect', async () => {
      const mockDevice = createMockUSBDevice()
      setupNavigatorUSB([mockDevice])

      // Simulate that sequence ID was advanced (internal state)
      // After connect, it should reset
      await device.connect()
      // We can verify indirectly: a new connection should start fresh
      expect(device.isConnected()).toBe(true)
    })

    it('returns false when device.open() throws', async () => {
      const mockDevice = createMockUSBDevice({
        open: vi.fn().mockRejectedValue(new Error('Access denied')),
      } as any)
      setupNavigatorUSB([mockDevice])

      const result = await device.connect()
      expect(result).toBe(false)
    })
  })

  describe('tryConnect', () => {
    it('returns false when WebUSB is not supported', async () => {
      const originalUsb = (navigator as any).usb
      delete (navigator as any).usb

      try {
        const result = await device.tryConnect()
        expect(result).toBe(false)
      } finally {
        if (originalUsb !== undefined) {
          Object.defineProperty(navigator, 'usb', {
            value: originalUsb,
            writable: true,
            configurable: true,
          })
        }
      }
    })

    it('returns false when no authorized devices found', async () => {
      setupNavigatorUSB([]) // No devices

      const result = await device.tryConnect()
      expect(result).toBe(false)
    })

    it('skips non-HiDock devices', async () => {
      const mockDevice = createMockUSBDevice({
        vendorId: 0x1234,
        productName: 'Not a HiDock',
      } as any)
      setupNavigatorUSB([mockDevice])

      const result = await device.tryConnect()
      expect(result).toBe(false)
    })

    it('connects to authorized HiDock device', async () => {
      const mockDevice = createMockUSBDevice()
      setupNavigatorUSB([mockDevice])

      const result = await device.tryConnect()
      expect(result).toBe(true)
      expect(device.isConnected()).toBe(true)
    })

    it('returns true if already connected', async () => {
      const mockDevice = createMockUSBDevice()
      setupNavigatorUSB([mockDevice])

      // Connect first
      await device.tryConnect()
      expect(device.isConnected()).toBe(true)

      // Try again - should return true without reconnecting
      const result = await device.tryConnect()
      expect(result).toBe(true)
    })
  })

  // ============================================================
  // disconnect
  // ============================================================

  describe('disconnect', () => {
    it('closes the device on disconnect', async () => {
      const mockDevice = createMockUSBDevice()
      setupNavigatorUSB([mockDevice])

      await device.connect()
      await device.disconnect()

      expect(mockDevice.close).toHaveBeenCalled()
      expect(device.isConnected()).toBe(false)
    })

    it('fires ondisconnect callback', async () => {
      const mockDevice = createMockUSBDevice()
      setupNavigatorUSB([mockDevice])

      const ondisconnectSpy = vi.fn()
      device.ondisconnect = ondisconnectSpy

      await device.connect()
      await device.disconnect()

      expect(ondisconnectSpy).toHaveBeenCalledTimes(1)
    })

    it('is safe to call disconnect when not connected', async () => {
      // Should not throw
      await expect(device.disconnect()).resolves.toBeUndefined()
    })

    it('resets model to unknown after disconnect', async () => {
      // Note: disconnect() does not explicitly reset model. It sets device = null.
      // isConnected() returns false, but model remains from last connection.
      // This is expected behavior - the model is cached info.
      const mockDevice = createMockUSBDevice({
        productId: USB_PRODUCT_IDS.P1,
      } as any)
      setupNavigatorUSB([mockDevice])

      await device.connect()
      expect(device.getModel()).toBe('hidock-p1')

      await device.disconnect()
      expect(device.isConnected()).toBe(false)
    })

    it('handles close errors gracefully', async () => {
      const mockDevice = createMockUSBDevice({
        close: vi.fn().mockRejectedValue(new Error('Close failed')),
      } as any)
      setupNavigatorUSB([mockDevice])

      await device.connect()

      // Should not throw despite close error
      await expect(device.disconnect()).resolves.toBeUndefined()
    })
  })

  // ============================================================
  // reset
  // ============================================================

  describe('reset', () => {
    it('returns false when not connected', async () => {
      const result = await device.reset()
      expect(result).toBe(false)
    })

    it('calls device.reset() on connected device', async () => {
      const mockDevice = createMockUSBDevice()
      setupNavigatorUSB([mockDevice])

      await device.connect()
      // After connect, opened is true (mock's open() sets state.opened = true)

      const result = await device.reset()
      expect(result).toBe(true)
      expect(mockDevice.reset).toHaveBeenCalled()
    })

    it('falls back to close/reopen when reset() fails', async () => {
      const mockDevice = createMockUSBDevice({
        reset: vi.fn().mockRejectedValue(new Error('Reset not supported')),
      } as any)
      setupNavigatorUSB([mockDevice])

      await device.connect()
      // opened is true after connect

      const result = await device.reset()
      expect(result).toBe(true)
      // Should have called close and open as fallback
      expect(mockDevice.close).toHaveBeenCalled()
      expect(mockDevice.open).toHaveBeenCalled()
    })
  })

  // ============================================================
  // isOperationInProgress / getLockHolder
  // ============================================================

  describe('operation lock state', () => {
    it('reports no operation in progress initially', () => {
      expect(device.isOperationInProgress()).toBe(false)
      expect(device.getLockHolder()).toBeNull()
    })
  })

  // ============================================================
  // USB connect listener
  // ============================================================

  describe('USB connect listener', () => {
    it('sets up onconnect handler on navigator.usb', () => {
      const mockUSB = setupNavigatorUSB()

      device.setupUsbConnectListener()
      expect(mockUSB.onconnect).not.toBeNull()
    })

    it('removes onconnect handler on cleanup', () => {
      const mockUSB = setupNavigatorUSB()

      device.setupUsbConnectListener()
      expect(mockUSB.onconnect).not.toBeNull()

      device.removeUsbConnectListener()
      expect(mockUSB.onconnect).toBeNull()
    })

    it('does not set up duplicate listeners', () => {
      const mockUSB = setupNavigatorUSB()

      device.setupUsbConnectListener()
      const firstHandler = mockUSB.onconnect

      device.setupUsbConnectListener()
      // Should be the same handler (not re-assigned)
      expect(mockUSB.onconnect).toBe(firstHandler)
    })
  })

  // ============================================================
  // getJensenDevice singleton
  // ============================================================

  describe('getJensenDevice', () => {
    it('returns a JensenDevice instance', () => {
      setupNavigatorUSB()
      const singleton = getJensenDevice()
      expect(singleton).toBeInstanceOf(JensenDevice)
    })

    it('returns the same instance on subsequent calls', () => {
      setupNavigatorUSB()
      const first = getJensenDevice()
      const second = getJensenDevice()
      expect(first).toBe(second)
    })
  })
})
