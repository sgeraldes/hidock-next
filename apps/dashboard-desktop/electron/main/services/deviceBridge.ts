export interface DeviceStatus {
  connected: boolean
  model: string | null
  productId: string | null
  firmwareVersion: string | null
  safeMode: true
}

export interface DeviceRecording {
  id: string
  filename: string
  sizeBytes: number
  recordedAt: string | null
}

export const SUPPORTED_PRODUCT_IDS = {
  hidockH1: '0xB00C',
  hidockH1Legacy: '0xAF0C',
  hidockH1E: '0xAF0D',
  hidockP1: '0xAF0E'
} as const

export class DeviceBridge {
  async getStatus(): Promise<DeviceStatus> {
    return {
      connected: false,
      model: null,
      productId: null,
      firmwareVersion: null,
      safeMode: true
    }
  }

  async listRecordings(): Promise<DeviceRecording[]> {
    return []
  }

  async downloadRecording(recordingId: string): Promise<{ ok: true; message: string }> {
    return {
      ok: true,
      message: `Selected download scaffold ready for ${recordingId}. Connect a HiDock device to enable manual transfer.`
    }
  }

  async syncMetadata(): Promise<{ ok: true; message: string }> {
    return {
      ok: true,
      message: 'Metadata sync bridge is ready. Connect a HiDock device to enable read-only sync.'
    }
  }
}
