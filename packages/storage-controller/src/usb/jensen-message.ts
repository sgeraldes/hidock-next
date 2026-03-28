export interface ResponseHeader {
  command: number
  sequence: number
  bodyLength: number
}

export class JensenMessage {
  command: number
  private msgBody: number[] = []
  private index: number = 0

  constructor(command: number) {
    this.command = command
  }

  body(data: number[]): this {
    this.msgBody = data
    return this
  }

  sequence(seq: number): this {
    this.index = seq
    return this
  }

  make(): Uint8Array {
    const buffer = new Uint8Array(12 + this.msgBody.length)
    let pos = 0
    buffer[pos++] = 0x12
    buffer[pos++] = 0x34
    buffer[pos++] = (this.command >> 8) & 0xff
    buffer[pos++] = this.command & 0xff
    buffer[pos++] = (this.index >> 24) & 0xff
    buffer[pos++] = (this.index >> 16) & 0xff
    buffer[pos++] = (this.index >> 8) & 0xff
    buffer[pos++] = this.index & 0xff
    const len = this.msgBody.length
    buffer[pos++] = (len >> 24) & 0xff
    buffer[pos++] = (len >> 16) & 0xff
    buffer[pos++] = (len >> 8) & 0xff
    buffer[pos++] = len & 0xff
    for (let i = 0; i < this.msgBody.length; i++) {
      buffer[pos++] = this.msgBody[i] & 0xff
    }
    return buffer
  }
}

export function parseResponseHeader(data: Uint8Array): ResponseHeader | null {
  if (data.length < 12) return null
  if (data[0] !== 0x12 || data[1] !== 0x34) return null

  const command = ((data[2] & 0xff) << 8) | (data[3] & 0xff)
  const sequence =
    ((data[4] & 0xff) << 24) |
    ((data[5] & 0xff) << 16) |
    ((data[6] & 0xff) << 8) |
    (data[7] & 0xff)
  const bodyLength =
    ((data[8] & 0xff) << 24) |
    ((data[9] & 0xff) << 16) |
    ((data[10] & 0xff) << 8) |
    (data[11] & 0xff)

  return { command, sequence, bodyLength }
}
