/// <reference types="w3c-web-usb" />

import { WebUSB } from 'usb'
import { JensenMessage, parseResponseHeader } from './jensen-message.js'
import { parseFileListBuffer } from './file-list-parser.js'
import { CMD, USB_VENDOR_IDS, EP_OUT, EP_IN, PRODUCT_ID_MODEL_MAP } from './constants.js'
import type { DeviceModel, FileEntry, CardInfo, RawDeviceInfo } from '../core/types.js'

let _webusb: InstanceType<typeof WebUSB> | null = null

function getWebUSB(): InstanceType<typeof WebUSB> {
  if (!_webusb) _webusb = new WebUSB({ allowAllDevices: true })
  return _webusb
}

export class JensenDevice {
  private device: USBDevice | null = null
  private sequenceId = 0
  private _model: DeviceModel = 'unknown'
  private _serialNumber: string | null = null
  private _firmwareVersion: string | null = null

  isConnected(): boolean {
    return this.device !== null
  }

  getModel(): DeviceModel {
    return this._model
  }

  getSerialNumber(): string | null {
    return this._serialNumber
  }

  getFirmwareVersion(): string | null {
    return this._firmwareVersion
  }

  async connect(): Promise<boolean> {
    const webusb = getWebUSB()
    const devices = await webusb.getDevices()
    const found = devices.find((d) => USB_VENDOR_IDS.includes(d.vendorId))
    if (found) return this.openDevice(found)

    try {
      const picked = await webusb.requestDevice({
        filters: USB_VENDOR_IDS.map((vendorId) => ({ vendorId }))
      })
      return this.openDevice(picked)
    } catch {
      return false
    }
  }

  async disconnect(): Promise<void> {
    if (this.device) {
      try { await this.device.close() } catch { /* already closed */ }
      this.device = null
      this._model = 'unknown'
      this._serialNumber = null
      this._firmwareVersion = null
      this.sequenceId = 0
    }
  }

  async getDeviceInfo(timeout = 10000): Promise<RawDeviceInfo | null> {
    const response = await this.sendAndReceive(CMD.GET_DEVICE_INFO, [], timeout)
    if (!response || response.body.length < 4) return null

    const body = response.body
    const versionCode = `${body[1]}.${body[2]}.${body[3]}`
    const versionNumber = (body[0] << 24) | (body[1] << 16) | (body[2] << 8) | body[3]

    let serialNumber = ''
    if (body.length >= 20) {
      const snBytes = body.slice(4, 20)
      serialNumber = Array.from(snBytes).map((b) => b.toString(16).padStart(2, '0')).join('')
    }

    this._serialNumber = serialNumber
    this._firmwareVersion = versionCode
    return { versionCode, versionNumber, serialNumber, model: this._model }
  }

  async getFileCount(timeout = 10000): Promise<number> {
    const response = await this.sendAndReceive(CMD.GET_FILE_COUNT, [], timeout)
    if (!response || response.body.length < 4) return 0
    return (
      ((response.body[0] & 0xff) << 24) |
      ((response.body[1] & 0xff) << 16) |
      ((response.body[2] & 0xff) << 8) |
      (response.body[3] & 0xff)
    )
  }

  async getCardInfo(timeout = 10000): Promise<CardInfo | null> {
    const response = await this.sendAndReceive(CMD.GET_CARD_INFO, [], timeout)
    if (!response || response.body.length < 12) return null
    const b = response.body
    const free = ((b[0] & 0xff) << 24) | ((b[1] & 0xff) << 16) | ((b[2] & 0xff) << 8) | (b[3] & 0xff)
    const capacity = ((b[4] & 0xff) << 24) | ((b[5] & 0xff) << 16) | ((b[6] & 0xff) << 8) | (b[7] & 0xff)
    const statusRaw = ((b[8] & 0xff) << 24) | ((b[9] & 0xff) << 16) | ((b[10] & 0xff) << 8) | (b[11] & 0xff)
    return { used: capacity - free, capacity, free, status: statusRaw.toString(16) }
  }

  async listFiles(timeout = 120000): Promise<FileEntry[]> {
    const msg = new JensenMessage(CMD.GET_FILE_LIST).sequence(this.sequenceId++)
    await this.device!.transferOut(EP_OUT, msg.make())

    const allData: Uint8Array[] = []
    const deadline = Date.now() + timeout
    let carryBuffer = new Uint8Array(0)

    while (Date.now() < deadline) {
      let result: USBInTransferResult
      try {
        result = await this.device!.transferIn(EP_IN & 0x7f, 51200)
      } catch { break }

      if (!result.data || result.data.byteLength === 0) continue

      const chunk = new Uint8Array(result.data.buffer, result.data.byteOffset, result.data.byteLength)
      const working = new Uint8Array(carryBuffer.length + chunk.length)
      working.set(carryBuffer, 0)
      working.set(chunk, carryBuffer.length)
      carryBuffer = new Uint8Array(0)

      let pos = 0
      while (pos + 12 <= working.length) {
        if (working[pos] !== 0x12 || working[pos + 1] !== 0x34) { pos++; continue }
        const header = parseResponseHeader(working.subarray(pos))
        if (!header) { pos++; continue }
        const totalLen = 12 + header.bodyLength
        if (pos + totalLen > working.length) {
          carryBuffer = working.subarray(pos)
          pos = working.length
          break
        }
        if (header.command === CMD.GET_FILE_LIST) {
          if (header.bodyLength === 0) {
            return parseFileListBuffer(concatArrays(allData))
          }
          allData.push(working.subarray(pos + 12, pos + totalLen))
        }
        pos += totalLen
      }
      if (pos < working.length && carryBuffer.length === 0) {
        carryBuffer = working.subarray(pos)
      }
    }
    return parseFileListBuffer(concatArrays(allData))
  }

  async downloadFile(
    filename: string,
    fileSize: number,
    onChunk?: (data: Uint8Array) => void,
    timeout = 300000
  ): Promise<Uint8Array | null> {
    const body: number[] = []
    for (let i = 0; i < filename.length; i++) body.push(filename.charCodeAt(i))

    const msg = new JensenMessage(CMD.TRANSFER_FILE).body(body).sequence(this.sequenceId++)
    await this.device!.transferOut(EP_OUT, msg.make())

    const chunks: Uint8Array[] = []
    let received = 0
    const deadline = Date.now() + timeout
    let carryBuffer = new Uint8Array(0)

    while (received < fileSize && Date.now() < deadline) {
      let result: USBInTransferResult
      try {
        result = await this.device!.transferIn(EP_IN & 0x7f, 51200)
      } catch { break }

      if (!result.data || result.data.byteLength === 0) continue

      const chunk = new Uint8Array(result.data.buffer, result.data.byteOffset, result.data.byteLength)
      const working = new Uint8Array(carryBuffer.length + chunk.length)
      working.set(carryBuffer, 0)
      working.set(chunk, carryBuffer.length)
      carryBuffer = new Uint8Array(0)

      let pos = 0
      while (pos + 12 <= working.length) {
        if (working[pos] !== 0x12 || working[pos + 1] !== 0x34) { pos++; continue }
        const header = parseResponseHeader(working.subarray(pos))
        if (!header) { pos++; continue }
        const totalLen = 12 + header.bodyLength
        if (pos + totalLen > working.length) {
          carryBuffer = working.subarray(pos)
          pos = working.length
          break
        }
        if (header.command === CMD.TRANSFER_FILE && header.bodyLength > 0) {
          const payload = working.slice(pos + 12, pos + totalLen)
          chunks.push(payload)
          received += payload.length
          onChunk?.(payload)
        }
        pos += totalLen
      }
      if (pos < working.length && carryBuffer.length === 0) {
        carryBuffer = working.subarray(pos)
      }
    }

    if (received < fileSize) return null
    return concatArrays(chunks)
  }

  private async openDevice(device: USBDevice): Promise<boolean> {
    try {
      await device.open()
      await device.selectConfiguration(1)
      await device.claimInterface(0)
      await device.selectAlternateInterface(0, 0)
    } catch (e) {
      console.error('[JensenDevice] Failed to open device:', e)
      return false
    }
    this.device = device
    this._model = PRODUCT_ID_MODEL_MAP[device.productId] ?? 'unknown'
    this.sequenceId = 0
    return true
  }

  private async sendAndReceive(
    command: number,
    body: number[] = [],
    timeout = 10000
  ): Promise<{ command: number; body: Uint8Array } | null> {
    if (!this.device) return null
    const msg = new JensenMessage(command).body(body).sequence(this.sequenceId++)
    await this.device.transferOut(EP_OUT, msg.make())

    const deadline = Date.now() + timeout
    let carryBuffer = new Uint8Array(0)

    while (Date.now() < deadline) {
      let result: USBInTransferResult
      try {
        result = await this.device.transferIn(EP_IN & 0x7f, 51200)
      } catch { return null }

      if (!result.data || result.data.byteLength === 0) continue

      const chunk = new Uint8Array(result.data.buffer, result.data.byteOffset, result.data.byteLength)
      const working = new Uint8Array(carryBuffer.length + chunk.length)
      working.set(carryBuffer, 0)
      working.set(chunk, carryBuffer.length)
      carryBuffer = new Uint8Array(0)

      let pos = 0
      while (pos + 12 <= working.length) {
        if (working[pos] !== 0x12 || working[pos + 1] !== 0x34) { pos++; continue }
        const header = parseResponseHeader(working.subarray(pos))
        if (!header) { pos++; continue }
        const totalLen = 12 + header.bodyLength
        if (pos + totalLen > working.length) {
          carryBuffer = working.subarray(pos)
          pos = working.length
          break
        }
        if (header.command === command) {
          return { command: header.command, body: working.subarray(pos + 12, pos + totalLen) }
        }
        pos += totalLen
      }
      if (pos < working.length && carryBuffer.length === 0) {
        carryBuffer = working.subarray(pos)
      }
    }
    return null
  }
}

function concatArrays(arrays: Uint8Array[]): Uint8Array {
  const totalLen = arrays.reduce((sum, a) => sum + a.length, 0)
  const result = new Uint8Array(totalLen)
  let offset = 0
  for (const arr of arrays) {
    result.set(arr, offset)
    offset += arr.length
  }
  return result
}
