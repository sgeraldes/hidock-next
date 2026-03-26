// @vitest-environment node
import { describe, it, expect } from 'vitest'

describe('usb native module', () => {
  it('should load the usb package without errors', async () => {
    const usb = await import('usb')
    expect(usb).toBeDefined()
    expect(usb.WebUSB).toBeDefined()
  })

  it('should create a WebUSB instance', async () => {
    const { WebUSB } = await import('usb')
    const webusb = new WebUSB({ allowAllDevices: true })
    expect(webusb).toBeDefined()
    expect(typeof webusb.getDevices).toBe('function')
    expect(typeof webusb.requestDevice).toBe('function')
  })
})
