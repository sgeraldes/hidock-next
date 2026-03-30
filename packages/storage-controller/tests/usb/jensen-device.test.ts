import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('usb', () => {
  const mockDevice = {
    vendorId: 0x10d6,
    productId: 0xaf0c,
    open: vi.fn().mockResolvedValue(undefined),
    close: vi.fn().mockResolvedValue(undefined),
    selectConfiguration: vi.fn().mockResolvedValue(undefined),
    claimInterface: vi.fn().mockResolvedValue(undefined),
    selectAlternateInterface: vi.fn().mockResolvedValue(undefined),
    transferOut: vi.fn().mockResolvedValue({ status: 'ok', bytesWritten: 12 }),
    transferIn: vi.fn().mockResolvedValue({ status: 'ok', data: new DataView(new ArrayBuffer(0)) })
  }

  return {
    WebUSB: vi.fn().mockImplementation(() => ({
      getDevices: vi.fn().mockResolvedValue([mockDevice]),
      requestDevice: vi.fn().mockResolvedValue(mockDevice)
    }))
  }
})

import { JensenDevice } from '../../src/usb/jensen-device.js'

describe('JensenDevice', () => {
  let device: JensenDevice

  beforeEach(() => {
    device = new JensenDevice()
  })

  it('starts disconnected', () => {
    expect(device.isConnected()).toBe(false)
  })

  it('getModel returns unknown when not connected', () => {
    expect(device.getModel()).toBe('unknown')
  })

  it('getSerialNumber returns null when not connected', () => {
    expect(device.getSerialNumber()).toBeNull()
  })
})
