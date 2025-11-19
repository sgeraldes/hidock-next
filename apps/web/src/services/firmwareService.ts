// Firmware Update Service for HiDock devices
// Based on analysis of HiNotes implementation

interface FirmwareMetadata {
  id: string;
  model: string;
  versionCode: string;  // e.g., "6.2.5"
  versionNumber: number; // e.g., 393733
  signature: string;     // MD5 hash
  fileName: string;      // e.g., "20ec7c710a9945428a5d3f0d904876c2"
  fileLength: number;    // Size in bytes
  remark: string;        // Changelog
  createTime: number;
  state: string;
}

// @ts-expect-error - Future use: API request structure for firmware checks
interface _FirmwareCheckRequest {
  version: string | number;
  model: string;
}

const FIRMWARE_API_BASE = 'https://hinotes.hidock.com';
const API_TOKEN = 'M4XoUFm5OOygd5snWe10lMxtSqadM2KOp2wWObw554iUyTaEZbVXdu11TZ3zD4SD';

export class FirmwareService {
  /**
   * Step 1: Check if firmware update is available
   */
  static async checkFirmwareUpdate(currentVersion: number, model: string): Promise<FirmwareMetadata | null> {
    const formData = new URLSearchParams();
    formData.append('version', currentVersion.toString());
    formData.append('model', model);

    const response = await fetch(`${FIRMWARE_API_BASE}/v2/device/firmware/latest`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'accesstoken': API_TOKEN
      },
      body: formData.toString()
    });

    const result = await response.json();
    
    if (result.error === 0 && result.data) {
      return result.data as FirmwareMetadata;
    }
    
    return null; // No update available
  }

  /**
   * Step 2: Download firmware binary
   * The frontend would attempt to download the firmware file directly
   */
  static async downloadFirmware(fileName: string, onProgress?: (progress: number) => void): Promise<ArrayBuffer> {
    // Based on the pattern, the firmware might be served from a CDN or different endpoint
    // Since direct API endpoints return 404, the firmware is likely:
    // 1. Served from a different domain/CDN
    // 2. Requires special authentication
    // 3. Downloaded via WebSocket or WebRTC data channel
    
    // Try potential firmware download patterns
    const possibleUrls = [
      `${FIRMWARE_API_BASE}/v2/device/firmware/binary/${fileName}`,
      `${FIRMWARE_API_BASE}/firmware/files/${fileName}`,
      `${FIRMWARE_API_BASE}/static/firmware/${fileName}.bin`,
      // The actual URL might be dynamically generated or use a CDN
      `https://firmware.hidock.com/${fileName}`,
      `https://cdn.hinotes.com/firmware/${fileName}`
    ];

    for (const url of possibleUrls) {
      try {
        const response = await fetch(url, {
          method: 'GET',
          headers: {
            'accesstoken': API_TOKEN
          }
        });

        if (response.ok && response.headers.get('content-type')?.includes('application/octet-stream')) {
          // Track download progress if callback provided
          if (onProgress && response.body) {
            const reader = response.body.getReader();
            const contentLength = Number(response.headers.get('content-length'));
            let receivedLength = 0;
            const chunks: Uint8Array[] = [];

            while (true) {
              const { done, value } = await reader.read();
              if (done) break;
              
              chunks.push(value);
              receivedLength += value.length;
              onProgress(receivedLength / contentLength);
            }

            // Combine chunks into single ArrayBuffer
            const result = new Uint8Array(receivedLength);
            let position = 0;
            for (const chunk of chunks) {
              result.set(chunk, position);
              position += chunk.length;
            }

            return result.buffer;
          } else {
            return await response.arrayBuffer();
          }
        }
      } catch (error) {
        console.log(`Failed to download from ${url}:`, error);
      }
    }

    throw new Error('Unable to download firmware from any known endpoint');
  }

  /**
   * Step 3: Validate firmware integrity
   */
  static async validateFirmware(data: ArrayBuffer, expectedSignature: string): Promise<boolean> {
    // Calculate MD5 hash of downloaded firmware
    const hashBuffer = await crypto.subtle.digest('MD5', data);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    const hashHex = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
    
    return hashHex === expectedSignature;
  }

  /**
   * Step 4: Upload firmware to device via USB
   * Using the jensen.js USB protocol
   */
  static async uploadFirmwareToDevice(
    device: any, // HiDock USB device instance
    firmwareData: ArrayBuffer,
    metadata: FirmwareMetadata,
    onProgress?: (progress: number) => void
  ): Promise<boolean> {
    try {
      // Phase 1: Request firmware upgrade
      // Send firmware size and version as 32-bit integers
      const requestResult = await device.requestFirmwareUpgrade(
        metadata.fileLength,
        metadata.versionNumber,
        30000 // 30 second timeout
      );

      if (requestResult.result !== 'accepted') {
        throw new Error(`Device rejected firmware: ${requestResult.result}`);
      }

      // Phase 2: Upload firmware binary
      const uploadResult = await device.uploadFirmware(
        new Uint8Array(firmwareData),
        60000, // 60 second timeout for upload
        onProgress
      );

      if (uploadResult.result !== 'success') {
        throw new Error('Firmware upload failed');
      }

      return true;
    } catch (error) {
      console.error('Firmware upload error:', error);
      return false;
    }
  }

  /**
   * Complete firmware update flow
   */
  static async performFirmwareUpdate(
    device: any,
    currentVersion: number,
    model: string,
    callbacks?: {
      onCheckUpdate?: () => void;
      onDownloadProgress?: (progress: number) => void;
      onUploadProgress?: (progress: number) => void;
      onComplete?: () => void;
      onError?: (error: string) => void;
    }
  ): Promise<void> {
    try {
      // Step 1: Check for updates
      callbacks?.onCheckUpdate?.();
      const metadata = await this.checkFirmwareUpdate(currentVersion, model);
      
      if (!metadata) {
        callbacks?.onComplete?.();
        return; // Already up to date
      }

      // Step 2: Download firmware
      const firmwareData = await this.downloadFirmware(
        metadata.fileName,
        callbacks?.onDownloadProgress
      );

      // Step 3: Validate integrity
      const isValid = await this.validateFirmware(firmwareData, metadata.signature);
      if (!isValid) {
        throw new Error('Firmware validation failed - corrupted download');
      }

      // Step 4: Upload to device
      const success = await this.uploadFirmwareToDevice(
        device,
        firmwareData,
        metadata,
        callbacks?.onUploadProgress
      );

      if (!success) {
        throw new Error('Failed to upload firmware to device');
      }

      callbacks?.onComplete?.();
    } catch (error) {
      callbacks?.onError?.(error instanceof Error ? error.message : 'Unknown error');
      throw error;
    }
  }
}

// Alternative: The firmware might be embedded in the JavaScript bundle
// or fetched via WebSocket after authentication
export class AlternativeFirmwareDownload {
  /**
   * If firmware is delivered via WebSocket
   */
  static async downloadViaWebSocket(fileName: string): Promise<ArrayBuffer> {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(`wss://hinotes.hidock.com/firmware`);
      
      ws.onopen = () => {
        // Send download request
        ws.send(JSON.stringify({
          action: 'download',
          fileName: fileName,
          token: API_TOKEN
        }));
      };

      let chunks: Uint8Array[] = [];
      
      ws.onmessage = (event) => {
        if (event.data instanceof Blob) {
          event.data.arrayBuffer().then(buffer => {
            chunks.push(new Uint8Array(buffer));
          });
        } else if (typeof event.data === 'string') {
          const message = JSON.parse(event.data);
          if (message.error) {
            reject(new Error(message.error));
          } else if (message.complete) {
            // Combine all chunks
            const totalLength = chunks.reduce((acc, chunk) => acc + chunk.length, 0);
            const result = new Uint8Array(totalLength);
            let position = 0;
            for (const chunk of chunks) {
              result.set(chunk, position);
              position += chunk.length;
            }
            resolve(result.buffer);
          }
        }
      };

      ws.onerror = (error) => reject(error);
    });
  }

  /**
   * If firmware URL is dynamically generated
   */
  static async getFirmwareUrl(fileName: string): Promise<string> {
    // Request a signed URL from the API
    const response = await fetch(`${FIRMWARE_API_BASE}/v2/device/firmware/url`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'accesstoken': API_TOKEN
      },
      body: JSON.stringify({ fileName })
    });

    const result = await response.json();
    if (result.error === 0 && result.data?.url) {
      return result.data.url;
    }

    throw new Error('Failed to get firmware download URL');
  }
}