import { ERROR_MESSAGES, HIDOCK_COMMANDS, HIDOCK_DEVICE_CONFIG, HIDOCK_PRODUCT_IDS } from '@/constants';
import type { AudioRecording, HiDockDevice, StorageInfo } from '@/types';

// WebUSB type definitions for better TypeScript support
declare global {
    interface Navigator {
        usb: USB;
    }

    interface USB {
        requestDevice(options: USBDeviceRequestOptions): Promise<USBDevice>;
        getDevices(): Promise<USBDevice[]>;
    }

    interface USBDevice {
        vendorId: number;
        productId: number;
        productName?: string;
        manufacturerName?: string;
        serialNumber?: string;
        configuration: USBConfiguration | null;
        configurations: USBConfiguration[];
        opened: boolean;

        open(): Promise<void>;
        close(): Promise<void>;
        selectConfiguration(configurationValue: number): Promise<void>;
        claimInterface(interfaceNumber: number): Promise<void>;
        releaseInterface(interfaceNumber: number): Promise<void>;
        transferIn(endpointNumber: number, length: number): Promise<USBInTransferResult>;
        transferOut(endpointNumber: number, data: BufferSource): Promise<USBOutTransferResult>;
        clearHalt(direction: USBDirection, endpointNumber: number): Promise<void>;
    }

    interface USBDeviceRequestOptions {
        filters: USBDeviceFilter[];
    }

    interface USBDeviceFilter {
        vendorId?: number;
        productId?: number;
        classCode?: number;
        subclassCode?: number;
        protocolCode?: number;
        serialNumber?: string;
    }

    interface USBConfiguration {
        configurationValue: number;
        configurationName?: string;
        interfaces: USBInterface[];
    }

    interface USBInterface {
        interfaceNumber: number;
        alternate: USBAlternateInterface;
        alternates: USBAlternateInterface[];
        claimed: boolean;
    }

    interface USBAlternateInterface {
        alternateSetting: number;
        interfaceClass: number;
        interfaceSubclass: number;
        interfaceProtocol: number;
        interfaceName?: string;
        endpoints: USBEndpoint[];
    }

    interface USBEndpoint {
        endpointNumber: number;
        direction: USBDirection;
        type: USBEndpointType;
        packetSize: number;
    }

    type USBDirection = 'in' | 'out';
    type USBEndpointType = 'bulk' | 'interrupt' | 'isochronous';

    interface USBInTransferResult {
        data?: DataView;
        status: USBTransferStatus;
    }

    interface USBOutTransferResult {
        bytesWritten: number;
        status: USBTransferStatus;
    }

    type USBTransferStatus = 'ok' | 'stall' | 'babble';
}

interface DeviceOperationProgress {
    operation: string;
    progress: number;
    total: number;
    status: 'pending' | 'in_progress' | 'completed' | 'error';
    message?: string;
}

type ProgressCallback = (progress: DeviceOperationProgress) => void;

class DeviceService {
    private device: USBDevice | null = null;
    private isConnected = false;
    private sequenceId = 0;
    private receiveBuffer = new Uint8Array(0);

    // Enhanced connection management
    private connectionRetryCount = 0;
    private maxRetryAttempts = 3;
    private retryDelay = 1000; // milliseconds
    private lastError: string | null = null;

    // Error tracking
    private errorCounts = {
        usbTimeout: 0,
        usbPipeError: 0,
        connectionLost: 0,
        protocolError: 0
    };
    private maxErrorThreshold = 5;

    // Performance monitoring
    private operationStats = {
        commandsSent: 0,
        responsesReceived: 0,
        bytesTransferred: 0,
        connectionTime: 0,
        lastOperationTime: 0
    };

    // Progress tracking
    private progressCallbacks: Map<string, ProgressCallback> = new Map();

    async requestDevice(): Promise<HiDockDevice | null> {
        try {
            // Check if WebUSB is supported
            if (!navigator.usb) {
                throw new Error('WebUSB is not supported in this browser. Please use Chrome, Edge, or Opera.');
            }

            this.updateProgress('device_request', {
                operation: 'Requesting device access',
                progress: 0,
                total: 100,
                status: 'pending'
            });

            // Request device access with all known HiDock product IDs
            const device = await navigator.usb.requestDevice({
                filters: [
                    { vendorId: HIDOCK_DEVICE_CONFIG.VENDOR_ID, productId: HIDOCK_PRODUCT_IDS.H1 },
                    { vendorId: HIDOCK_DEVICE_CONFIG.VENDOR_ID, productId: HIDOCK_PRODUCT_IDS.H1E },
                    { vendorId: HIDOCK_DEVICE_CONFIG.VENDOR_ID, productId: HIDOCK_PRODUCT_IDS.P1 },
                    { vendorId: HIDOCK_DEVICE_CONFIG.VENDOR_ID, productId: HIDOCK_PRODUCT_IDS.DEFAULT },
                ]
            });

            this.updateProgress('device_request', {
                operation: 'Device selected',
                progress: 50,
                total: 100,
                status: 'in_progress'
            });

            const connectedDevice = await this.connectToDevice(device);

            this.updateProgress('device_request', {
                operation: 'Device connected successfully',
                progress: 100,
                total: 100,
                status: 'completed'
            });

            return connectedDevice;
        } catch (error) {
            console.error('Failed to request device:', error);
            this.lastError = error instanceof Error ? error.message : 'Unknown error';
            this.incrementErrorCount('connectionLost');

            this.updateProgress('device_request', {
                operation: 'Device request failed',
                progress: 0,
                total: 100,
                status: 'error',
                message: this.lastError
            });

            throw new Error(ERROR_MESSAGES.DEVICE_NOT_FOUND);
        }
    }

    async connectToDevice(usbDevice: USBDevice, autoRetry: boolean = true): Promise<HiDockDevice> {
        if (autoRetry) {
            this.connectionRetryCount = 0;
        }

        while (true) {
            try {
                const result = await this.attemptConnection(usbDevice);
                this.connectionRetryCount = 0;
                this.operationStats.connectionTime = Date.now();
                return result;
            } catch (error) {
                this.lastError = error instanceof Error ? error.message : 'Unknown error';
                this.connectionRetryCount++;

                if (!autoRetry || !this.shouldRetryConnection()) {
                    console.error(`Connection failed after ${this.connectionRetryCount} attempts:`, error);
                    throw new Error(ERROR_MESSAGES.CONNECTION_FAILED);
                }

                console.warn(`Connection attempt ${this.connectionRetryCount} failed: ${this.lastError}. Retrying in ${this.retryDelay}ms...`);
                await this.delay(this.retryDelay);
            }
        }
    }

    private async attemptConnection(usbDevice: USBDevice): Promise<HiDockDevice> {
        this.device = usbDevice;

        this.updateProgress('device_connection', {
            operation: 'Opening device',
            progress: 10,
            total: 100,
            status: 'in_progress'
        });

        // Open the device
        await this.device.open();

        this.updateProgress('device_connection', {
            operation: 'Configuring device',
            progress: 30,
            total: 100,
            status: 'in_progress'
        });

        // Select configuration (usually 1)
        if (this.device.configuration === null) {
            await this.device.selectConfiguration(1);
        }

        this.updateProgress('device_connection', {
            operation: 'Claiming interface',
            progress: 50,
            total: 100,
            status: 'in_progress'
        });

        // Claim the interface
        await this.device.claimInterface(HIDOCK_DEVICE_CONFIG.INTERFACE_NUMBER);

        this.isConnected = true;
        this.sequenceId = 0;
        this.receiveBuffer = new Uint8Array(0);

        this.updateProgress('device_connection', {
            operation: 'Getting device information',
            progress: 70,
            total: 100,
            status: 'in_progress'
        });

        // Get device information
        const deviceInfo = await this.getDeviceInfo();

        this.updateProgress('device_connection', {
            operation: 'Getting storage information',
            progress: 90,
            total: 100,
            status: 'in_progress'
        });

        const storageInfo = await this.getStorageInfo();

        // Determine model based on product ID
        let model = 'Unknown HiDock';
        switch (this.device.productId) {
            case HIDOCK_PRODUCT_IDS.H1:
                model = 'HiDock H1';
                break;
            case HIDOCK_PRODUCT_IDS.H1E:
                model = 'HiDock H1E';
                break;
            case HIDOCK_PRODUCT_IDS.P1:
                model = 'HiDock P1';
                break;
            default:
                model = `HiDock Device (PID: ${this.device.productId.toString(16)})`;
        }

        this.updateProgress('device_connection', {
            operation: 'Connection completed',
            progress: 100,
            total: 100,
            status: 'completed'
        });

        return {
            id: this.device.serialNumber || 'unknown',
            name: this.device.productName || model,
            model,
            serialNumber: this.device.serialNumber || 'Unknown',
            firmwareVersion: deviceInfo.firmwareVersion || '1.0.0',
            connected: true,
            storageInfo,
        };
    }

    async disconnect(): Promise<void> {
        if (this.device && this.isConnected) {
            try {
                this.updateProgress('device_disconnect', {
                    operation: 'Disconnecting device',
                    progress: 50,
                    total: 100,
                    status: 'in_progress'
                });

                await this.device.releaseInterface(HIDOCK_DEVICE_CONFIG.INTERFACE_NUMBER);
                await this.device.close();
                this.device = null;
                this.isConnected = false;

                this.updateProgress('device_disconnect', {
                    operation: 'Device disconnected',
                    progress: 100,
                    total: 100,
                    status: 'completed'
                });
            } catch (error) {
                console.error('Error disconnecting device:', error);
                this.updateProgress('device_disconnect', {
                    operation: 'Disconnect error',
                    progress: 0,
                    total: 100,
                    status: 'error',
                    message: error instanceof Error ? error.message : 'Unknown error'
                });
            }
        }
    }

    // Helper methods for enhanced functionality
    private shouldRetryConnection(): boolean {
        return (this.connectionRetryCount < this.maxRetryAttempts &&
            this.errorCounts.connectionLost < this.maxErrorThreshold);
    }

    private incrementErrorCount(errorType: keyof typeof this.errorCounts): void {
        this.errorCounts[errorType]++;
        console.debug(`Error count for ${errorType}: ${this.errorCounts[errorType]}`);
    }

    private resetErrorCounts(): void {
        this.errorCounts = {
            usbTimeout: 0,
            usbPipeError: 0,
            connectionLost: 0,
            protocolError: 0
        };
    }

    private delay(ms: number): Promise<void> {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    private updateProgress(operationId: string, progress: DeviceOperationProgress): void {
        const callback = this.progressCallbacks.get(operationId);
        if (callback) {
            callback(progress);
        }
    }

    public onProgress(operationId: string, callback: ProgressCallback): void {
        this.progressCallbacks.set(operationId, callback);
    }

    public removeProgressListener(operationId: string): void {
        this.progressCallbacks.delete(operationId);
    }

    public getConnectionStats(): any {
        return {
            isConnected: this.isConnected,
            retryCount: this.connectionRetryCount,
            errorCounts: { ...this.errorCounts },
            operationStats: { ...this.operationStats },
            lastError: this.lastError,
            deviceInfo: this.device ? {
                vendorId: this.device.vendorId,
                productId: this.device.productId,
                productName: this.device.productName,
                serialNumber: this.device.serialNumber
            } : null
        };
    }

    async getRecordings(): Promise<AudioRecording[]> {
        if (!this.isConnected || !this.device) {
            throw new Error('Device not connected');
        }

        try {
            this.updateProgress('get_recordings', {
                operation: 'Getting file list',
                progress: 0,
                total: 100,
                status: 'in_progress'
            });

            const seqId = await this.sendCommand(HIDOCK_COMMANDS.GET_FILE_LIST);
            const response = await this.receiveResponse(seqId);

            this.updateProgress('get_recordings', {
                operation: 'Parsing file list',
                progress: 50,
                total: 100,
                status: 'in_progress'
            });

            const recordings = this.parseFileListResponse(response.body);

            this.updateProgress('get_recordings', {
                operation: `Found ${recordings.length} recordings`,
                progress: 100,
                total: 100,
                status: 'completed'
            });

            return recordings;
        } catch (error) {
            console.error('Failed to get recordings:', error);
            this.incrementErrorCount('protocolError');

            this.updateProgress('get_recordings', {
                operation: 'Failed to get recordings',
                progress: 0,
                total: 100,
                status: 'error',
                message: error instanceof Error ? error.message : 'Unknown error'
            });

            // Return empty array instead of throwing to allow graceful degradation
            return [];
        }
    }

    private parseFileListResponse(responseBody: Uint8Array): AudioRecording[] {
        const recordings: AudioRecording[] = [];
        const dataView = new DataView(responseBody.buffer, responseBody.byteOffset);
        let offset = 0;
        let totalSizeBytes = 0;
        let totalFilesFromHeader = -1;

        // Check for header with total file count
        if (responseBody.length >= 6 && dataView.getUint8(offset) === 0xFF && dataView.getUint8(offset + 1) === 0xFF) {
            totalFilesFromHeader = dataView.getUint32(offset + 2, false);
            offset += 6;
        }

        let parsedFileCount = 0;
        while (offset < responseBody.length) {
            try {
                if (offset + 4 > responseBody.length) break;

                const fileVersion = dataView.getUint8(offset);
                offset += 1;

                // Get filename length (3 bytes, big endian)
                const nameLen = (dataView.getUint8(offset) << 16) |
                    (dataView.getUint8(offset + 1) << 8) |
                    dataView.getUint8(offset + 2);
                offset += 3;

                if (offset + nameLen > responseBody.length) break;

                // Extract filename
                const filenameBytes = responseBody.slice(offset, offset + nameLen);
                const filename = String.fromCharCode(...Array.from(filenameBytes).filter(b => b > 0));
                offset += nameLen;

                const minRemaining = 4 + 6 + 16;
                if (offset + minRemaining > responseBody.length) break;

                // Get file length
                const fileLengthBytes = dataView.getUint32(offset, false);
                offset += 4;

                // Skip 6 bytes
                offset += 6;

                // Skip signature (16 bytes)
                offset += 16;

                // Calculate duration based on file version
                let durationSec = 0;
                if (fileVersion === 1) {
                    durationSec = (fileLengthBytes / 32) * 2;
                } else if (fileVersion === 2) {
                    durationSec = fileLengthBytes > 44 ? (fileLengthBytes - 44) / (48000 * 2 * 1) : 0;
                } else if (fileVersion === 3) {
                    durationSec = fileLengthBytes > 44 ? (fileLengthBytes - 44) / (24000 * 2 * 1) : 0;
                } else if (fileVersion === 5) {
                    durationSec = fileLengthBytes / 12000;
                } else {
                    durationSec = fileLengthBytes / (16000 * 2 * 1);
                }

                // Parse date from filename
                const dateCreated = this.parseFilenameDate(filename);

                recordings.push({
                    id: `rec-${parsedFileCount}`,
                    fileName: filename,
                    size: fileLengthBytes,
                    duration: durationSec,
                    dateCreated,
                    status: 'on_device',
                });

                totalSizeBytes += fileLengthBytes;
                parsedFileCount++;

                if (totalFilesFromHeader !== -1 && parsedFileCount >= totalFilesFromHeader) {
                    break;
                }
            } catch (error) {
                console.error(`Parsing error at offset ${offset}:`, error);
                break;
            }
        }

        return recordings.filter(r => r.fileName && r.size > 0);
    }

    private parseFilenameDate(filename: string): Date {
        try {
            // Try different filename formats
            if (filename.length >= 14 && filename.slice(0, 14).match(/^\d{14}$/)) {
                // Format: YYYYMMDDHHMMSS
                const year = parseInt(filename.slice(0, 4));
                const month = parseInt(filename.slice(4, 6)) - 1;
                const day = parseInt(filename.slice(6, 8));
                const hour = parseInt(filename.slice(8, 10));
                const minute = parseInt(filename.slice(10, 12));
                const second = parseInt(filename.slice(12, 14));
                return new Date(year, month, day, hour, minute, second);
            }

            // Try format: 2025May12-114141-Rec44.hda
            const match = filename.match(/^(\d{4})([A-Za-z]{3})(\d{2})-(\d{2})(\d{2})(\d{2})/);
            if (match) {
                const [, year, monthStr, day, hour, minute, second] = match;
                const monthMap: { [key: string]: number } = {
                    'Jan': 0, 'Feb': 1, 'Mar': 2, 'Apr': 3, 'May': 4, 'Jun': 5,
                    'Jul': 6, 'Aug': 7, 'Sep': 8, 'Oct': 9, 'Nov': 10, 'Dec': 11
                };
                const month = monthMap[monthStr];
                if (month !== undefined) {
                    return new Date(parseInt(year), month, parseInt(day),
                        parseInt(hour), parseInt(minute), parseInt(second));
                }
            }
        } catch (error) {
            console.debug(`Date parse error for '${filename}':`, error);
        }

        // Fallback to current date
        return new Date();
    }

    async downloadRecording(recordingId: string, progressCallback?: ProgressCallback): Promise<ArrayBuffer> {
        if (!this.isConnected || !this.device) {
            throw new Error('Device not connected');
        }

        try {
            // Set up progress tracking
            if (progressCallback) {
                this.onProgress(`download_${recordingId}`, progressCallback);
            }

            this.updateProgress(`download_${recordingId}`, {
                operation: 'Finding recording',
                progress: 0,
                total: 100,
                status: 'in_progress'
            });

            // Get the recording filename from the recordingId
            const recordings = await this.getRecordings();
            const recording = recordings.find(r => r.id === recordingId);
            if (!recording) {
                throw new Error('Recording not found');
            }

            this.updateProgress(`download_${recordingId}`, {
                operation: 'Starting download',
                progress: 10,
                total: 100,
                status: 'in_progress'
            });

            // Send transfer file command with filename
            const encoder = new TextEncoder();
            const filenameBytes = encoder.encode(recording.fileName);

            const seqId = await this.sendCommand(HIDOCK_COMMANDS.TRANSFER_FILE, filenameBytes);

            this.updateProgress(`download_${recordingId}`, {
                operation: 'Receiving file data',
                progress: 20,
                total: 100,
                status: 'in_progress'
            });

            // Receive file data with progress tracking
            const fileData = await this.receiveFileData(seqId, recording.size, `download_${recordingId}`);

            this.updateProgress(`download_${recordingId}`, {
                operation: 'Download completed',
                progress: 100,
                total: 100,
                status: 'completed'
            });

            // Update operation stats
            this.operationStats.bytesTransferred += fileData.byteLength;

            return fileData;
        } catch (error) {
            console.error('Failed to download recording:', error);
            this.incrementErrorCount('protocolError');

            this.updateProgress(`download_${recordingId}`, {
                operation: 'Download failed',
                progress: 0,
                total: 100,
                status: 'error',
                message: error instanceof Error ? error.message : 'Unknown error'
            });

            throw new Error('Failed to download recording from device');
        } finally {
            this.removeProgressListener(`download_${recordingId}`);
        }
    }

    private async receiveFileData(seqId: number, expectedSize: number, progressId: string): Promise<ArrayBuffer> {
        const chunks: Uint8Array[] = [];
        let totalReceived = 0;
        const startTime = Date.now();
        const timeout = 180000; // 3 minutes timeout

        while (totalReceived < expectedSize) {
            if (Date.now() - startTime > timeout) {
                throw new Error('File transfer timeout');
            }

            try {
                const response = await this.receiveResponse(seqId, 15000, HIDOCK_COMMANDS.TRANSFER_FILE);

                if (response.body.length === 0) {
                    if (totalReceived >= expectedSize) {
                        break; // Transfer complete
                    }
                    console.warn('Empty chunk received before completion');
                    await this.delay(100);
                    continue;
                }

                chunks.push(response.body);
                totalReceived += response.body.length;

                // Update progress
                const progress = Math.min((totalReceived / expectedSize) * 80 + 20, 95); // 20-95% range
                this.updateProgress(progressId, {
                    operation: `Downloading: ${this.formatBytes(totalReceived)} / ${this.formatBytes(expectedSize)}`,
                    progress,
                    total: 100,
                    status: 'in_progress'
                });

                if (totalReceived >= expectedSize) {
                    break;
                }
            } catch (error) {
                if (error instanceof Error && error.message.includes('timeout')) {
                    console.warn('Receive timeout, retrying...');
                    continue;
                }
                throw error;
            }
        }

        // Combine all chunks
        const completeFile = new Uint8Array(totalReceived);
        let offset = 0;
        for (const chunk of chunks) {
            completeFile.set(chunk, offset);
            offset += chunk.length;
        }

        return completeFile.buffer;
    }

    private formatBytes(bytes: number): string {
        if (bytes === 0) return '0 Bytes';
        const k = 1024;
        const sizes = ['Bytes', 'KB', 'MB', 'GB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
    }



    async syncTime(): Promise<void> {
        if (!this.isConnected || !this.device) {
            throw new Error('Device not connected');
        }

        try {
            const currentTime = new Date();

            // Convert time to device format (Unix timestamp)
            const timestamp = Math.floor(currentTime.getTime() / 1000);
            const timeBytes = new Uint8Array(4);
            const view = new DataView(timeBytes.buffer);
            view.setUint32(0, timestamp, false);

            const seqId = await this.sendCommand(HIDOCK_COMMANDS.SET_DEVICE_TIME, timeBytes);
            const response = await this.receiveResponse(seqId);

            // Check if time sync was successful
            const responseView = new DataView(response.body.buffer, response.body.byteOffset);
            const status = responseView.getUint32(0, false);

            if (status !== 0) {
                throw new Error('Device reported time sync failed');
            }

            console.log(`Successfully synced device time to ${currentTime.toISOString()}`);
        } catch (error) {
            console.error('Failed to sync time:', error);
            throw new Error('Failed to sync device time');
        }
    }

    // Protocol implementation methods
    private buildPacket(commandId: number, bodyBytes: Uint8Array = new Uint8Array(0)): Uint8Array {
        this.sequenceId = (this.sequenceId + 1) & 0xFFFFFFFF;

        const packet = new Uint8Array(12 + bodyBytes.length);
        const view = new DataView(packet.buffer);

        // Sync bytes
        view.setUint8(0, 0x12);
        view.setUint8(1, 0x34);

        // Command ID (2 bytes, big endian)
        view.setUint16(2, commandId, false);

        // Sequence ID (4 bytes, big endian)
        view.setUint32(4, this.sequenceId, false);

        // Body length (4 bytes, big endian)
        view.setUint32(8, bodyBytes.length, false);

        // Copy body bytes
        packet.set(bodyBytes, 12);

        return packet;
    }

    private async sendCommand(commandId: number, bodyBytes: Uint8Array = new Uint8Array(0)): Promise<number> {
        if (!this.device || !this.isConnected) {
            throw new Error('Device not connected');
        }

        const packet = this.buildPacket(commandId, bodyBytes);
        const startTime = Date.now();

        try {
            const result = await this.device.transferOut(HIDOCK_DEVICE_CONFIG.ENDPOINT_OUT, packet);

            // Update performance statistics
            this.operationStats.commandsSent++;
            this.operationStats.bytesTransferred += packet.length;
            this.operationStats.lastOperationTime = Date.now() - startTime;

            if (result.status !== 'ok') {
                this.incrementErrorCount('protocolError');
                throw new Error(`USB transfer failed: ${result.status}`);
            }

            if (result.bytesWritten !== packet.length) {
                this.incrementErrorCount('protocolError');
                console.warn(`Partial write for CMD ${commandId}: sent ${result.bytesWritten}/${packet.length} bytes`);
            }

            return this.sequenceId;
        } catch (error) {
            console.error('Failed to send command:', error);

            if (error instanceof DOMException) {
                if (error.name === 'NetworkError') {
                    this.incrementErrorCount('usbTimeout');
                } else if (error.name === 'InvalidStateError') {
                    this.incrementErrorCount('connectionLost');
                    this.isConnected = false;
                }
            }

            throw new Error('Failed to send command to device');
        }
    }

    private async receiveResponse(expectedSeqId: number, timeoutMs = 5000, streamingCmdId?: number): Promise<any> {
        if (!this.device || !this.isConnected) {
            throw new Error('Device not connected');
        }

        const startTime = Date.now();

        while (Date.now() - startTime < timeoutMs) {
            try {
                // Read data from device with larger buffer for better performance
                const readSize = 4096 * 16; // 64KB buffer
                const result = await this.device.transferIn(HIDOCK_DEVICE_CONFIG.ENDPOINT_IN, readSize);

                if (result.status === 'ok' && result.data) {
                    const newData = new Uint8Array(result.data.buffer);

                    // Append to receive buffer
                    const combined = new Uint8Array(this.receiveBuffer.length + newData.length);
                    combined.set(this.receiveBuffer);
                    combined.set(newData, this.receiveBuffer.length);
                    this.receiveBuffer = combined;

                    // Update performance statistics
                    this.operationStats.bytesTransferred += newData.length;

                    // Try to parse complete packets
                    while (true) {
                        const packet = this.parsePacket();
                        if (!packet) break;

                        // Check if this is the response we're waiting for OR a streaming packet
                        if (packet.sequence === expectedSeqId ||
                            (streamingCmdId !== undefined && packet.id === streamingCmdId)) {

                            this.operationStats.responsesReceived++;
                            return packet;
                        } else {
                            console.warn(`Unexpected Seq/CMD. Expected Seq: ${expectedSeqId} ` +
                                `(or stream ${streamingCmdId}), Got CMD: ${packet.id} Seq: ${packet.sequence}. Discarding.`);
                        }
                    }
                }
            } catch (error) {
                if (error instanceof DOMException) {
                    if (error.name === 'NetworkError') {
                        this.incrementErrorCount('usbTimeout');
                        continue; // Timeout is expected, continue trying
                    } else if (error.name === 'InvalidStateError') {
                        this.incrementErrorCount('connectionLost');
                        this.isConnected = false;
                        throw new Error('Device connection lost');
                    }
                }

                this.incrementErrorCount('protocolError');
                throw error;
            }

            // Small delay to prevent busy waiting
            await this.delay(10);
        }

        this.incrementErrorCount('usbTimeout');
        throw new Error(`Response timeout waiting for SeqID ${expectedSeqId}`);
    }

    private parsePacket(): any {
        if (this.receiveBuffer.length < 2) {
            return null;
        }

        // Find sync bytes
        let syncIndex = -1;
        for (let i = 0; i <= this.receiveBuffer.length - 2; i++) {
            if (this.receiveBuffer[i] === 0x12 && this.receiveBuffer[i + 1] === 0x34) {
                syncIndex = i;
                break;
            }
        }

        if (syncIndex === -1) {
            return null;
        }

        // Remove data before sync and warn if we had to discard data
        if (syncIndex > 0) {
            console.warn(`Re-syncing: Discarded ${syncIndex} prefix bytes`);
            this.receiveBuffer = this.receiveBuffer.slice(syncIndex);
        }

        if (this.receiveBuffer.length < 12) {
            return null;
        }

        try {
            const view = new DataView(this.receiveBuffer.buffer, this.receiveBuffer.byteOffset);

            // Parse header
            const commandId = view.getUint16(2, false);
            const sequence = view.getUint32(4, false);
            const bodyLengthFromHeader = view.getUint32(8, false);

            // Extract checksum length and body length
            const checksumLen = (bodyLengthFromHeader >> 24) & 0xFF;
            const bodyLength = bodyLengthFromHeader & 0x00FFFFFF;

            const totalLength = 12 + bodyLength + checksumLen;

            if (this.receiveBuffer.length < totalLength) {
                return null; // Not enough data yet
            }

            // Extract body
            const body = this.receiveBuffer.slice(12, 12 + bodyLength);

            // Remove processed packet from buffer
            this.receiveBuffer = this.receiveBuffer.slice(totalLength);

            console.debug(`RECV RSP CMD: ${commandId}, Seq: ${sequence}, BodyLen: ${bodyLength}`);

            return {
                id: commandId,
                sequence,
                body
            };
        } catch (error) {
            console.error('Error parsing packet:', error);
            this.incrementErrorCount('protocolError');
            // Clear buffer to prevent infinite loop
            this.receiveBuffer = new Uint8Array(0);
            return null;
        }
    }

    private async getDeviceInfo(): Promise<any> {
        try {
            const seqId = await this.sendCommand(HIDOCK_COMMANDS.GET_DEVICE_INFO);
            const response = await this.receiveResponse(seqId);

            if (response.body.length >= 4) {
                const view = new DataView(response.body.buffer, response.body.byteOffset);
                const versionCodeBytes = response.body.slice(0, 4);
                const versionNumber = view.getUint32(0, false);
                const versionCode = Array.from(versionCodeBytes.slice(1)).join('.');

                let serialNumber = 'N/A';
                if (response.body.length > 4) {
                    const serialBytes = response.body.slice(4, 20);
                    // Filter printable characters and decode
                    const printableBytes = Array.from(serialBytes).filter((b: any) => (b >= 32 && b <= 126) || b === 0);
                    const nullIndex = printableBytes.indexOf(0);
                    const cleanBytes = nullIndex !== -1 ? printableBytes.slice(0, nullIndex) : printableBytes;
                    serialNumber = new TextDecoder().decode(new Uint8Array(cleanBytes as number[])).trim() ||
                        Array.from(serialBytes).map((b: any) => b.toString(16).padStart(2, '0')).join('');
                }

                return {
                    versionCode,
                    versionNumber,
                    serialNumber,
                    firmwareVersion: versionCode
                };
            }

            // Fallback to basic info
            return {
                versionCode: '1.0.0',
                versionNumber: 0,
                serialNumber: this.device?.serialNumber || 'Unknown',
                firmwareVersion: '1.0.0'
            };
        } catch (error) {
            console.error('Failed to get device info:', error);
            // Fallback to basic info
            return {
                versionCode: '1.0.0',
                versionNumber: 0,
                serialNumber: 'Unknown',
                firmwareVersion: '1.0.0'
            };
        }
    }

    private async getStorageInfo(): Promise<StorageInfo> {
        try {
            const seqId = await this.sendCommand(HIDOCK_COMMANDS.GET_CARD_INFO);
            const response = await this.receiveResponse(seqId);

            if (response.body.length >= 12) {
                const view = new DataView(response.body.buffer, response.body.byteOffset);

                // Parse storage info (values are in MB)
                const usedMB = view.getUint32(0, false);
                const capacityMB = view.getUint32(4, false);
                // const statusRaw = view.getUint32(8, false); // Status information if needed

                const totalCapacity = capacityMB * 1024 * 1024; // Convert MB to bytes
                const usedSpace = usedMB * 1024 * 1024;

                return {
                    totalCapacity,
                    usedSpace,
                    freeSpace: totalCapacity - usedSpace,
                    fileCount: await this.getFileCount(),
                };
            }

            // Fallback values
            return {
                totalCapacity: 8 * 1024 * 1024 * 1024, // 8GB
                usedSpace: 100 * 1024 * 1024, // 100MB
                freeSpace: 8 * 1024 * 1024 * 1024 - 100 * 1024 * 1024,
                fileCount: await this.getFileCount(),
            };
        } catch (error) {
            console.error('Failed to get storage info:', error);
            // Fallback values
            return {
                totalCapacity: 8 * 1024 * 1024 * 1024, // 8GB
                usedSpace: 100 * 1024 * 1024, // 100MB
                freeSpace: 8 * 1024 * 1024 * 1024 - 100 * 1024 * 1024,
                fileCount: 0,
            };
        }
    }

    private async getFileCount(): Promise<number> {
        try {
            const seqId = await this.sendCommand(HIDOCK_COMMANDS.GET_FILE_COUNT);
            const response = await this.receiveResponse(seqId);

            if (!response.body || response.body.length === 0) {
                return 0;
            }

            if (response.body.length >= 4) {
                const view = new DataView(response.body.buffer, response.body.byteOffset);
                return view.getUint32(0, false);
            }

            return 0;
        } catch (error) {
            console.error('Failed to get file count:', error);
            return 0;
        }
    }

    isDeviceConnected(): boolean {
        return this.isConnected && this.device !== null;
    }

    // Additional utility methods for enhanced functionality
    async getDeviceCapabilities(): Promise<string[]> {
        const capabilities = ['file_list', 'file_download', 'file_delete'];

        if (this.device) {
            // Add capabilities based on device model
            switch (this.device.productId) {
                case HIDOCK_PRODUCT_IDS.H1:
                case HIDOCK_PRODUCT_IDS.H1E:
                    capabilities.push('time_sync', 'format_storage', 'settings_management');
                    break;
                case HIDOCK_PRODUCT_IDS.P1:
                    capabilities.push('time_sync', 'format_storage');
                    break;
            }
        }

        return capabilities;
    }

    async testConnection(): Promise<boolean> {
        if (!this.isConnected || !this.device) {
            return false;
        }

        try {
            // Perform a lightweight operation to test connection
            await this.getFileCount();
            return true;
        } catch (error) {
            console.warn('Connection test failed:', error);
            this.incrementErrorCount('connectionLost');
            return false;
        }
    }

    // Enhanced delete with progress tracking
    async deleteRecording(recordingId: string, progressCallback?: ProgressCallback): Promise<void> {
        if (!this.isConnected || !this.device) {
            throw new Error('Device not connected');
        }

        try {
            if (progressCallback) {
                this.onProgress(`delete_${recordingId}`, progressCallback);
            }

            this.updateProgress(`delete_${recordingId}`, {
                operation: 'Finding recording',
                progress: 0,
                total: 100,
                status: 'in_progress'
            });

            // Get the recording filename from the recordingId
            const recordings = await this.getRecordings();
            const recording = recordings.find(r => r.id === recordingId);
            if (!recording) {
                throw new Error('Recording not found');
            }

            this.updateProgress(`delete_${recordingId}`, {
                operation: 'Deleting recording',
                progress: 50,
                total: 100,
                status: 'in_progress'
            });

            // Send delete file command with filename
            const encoder = new TextEncoder();
            const filenameBytes = encoder.encode(recording.fileName);

            const seqId = await this.sendCommand(HIDOCK_COMMANDS.DELETE_FILE, filenameBytes);
            const response = await this.receiveResponse(seqId);

            // Check if deletion was successful
            if (response.body.length > 0) {
                const view = new DataView(response.body.buffer, response.body.byteOffset);
                const status = view.getUint8(0);

                if (status !== 0) {
                    throw new Error(`Device reported deletion failed (status: ${status})`);
                }
            }

            this.updateProgress(`delete_${recordingId}`, {
                operation: 'Recording deleted successfully',
                progress: 100,
                total: 100,
                status: 'completed'
            });

            console.log(`Successfully deleted recording ${recording.fileName} from device`);
        } catch (error) {
            console.error('Failed to delete recording:', error);
            this.incrementErrorCount('protocolError');

            this.updateProgress(`delete_${recordingId}`, {
                operation: 'Delete failed',
                progress: 0,
                total: 100,
                status: 'error',
                message: error instanceof Error ? error.message : 'Unknown error'
            });

            throw new Error('Failed to delete recording from device');
        } finally {
            this.removeProgressListener(`delete_${recordingId}`);
        }
    }

    // Enhanced format with progress tracking
    async formatDevice(progressCallback?: ProgressCallback): Promise<void> {
        if (!this.isConnected || !this.device) {
            throw new Error('Device not connected');
        }

        try {
            if (progressCallback) {
                this.onProgress('format_device', progressCallback);
            }

            this.updateProgress('format_device', {
                operation: 'Starting format operation',
                progress: 0,
                total: 100,
                status: 'in_progress'
            });

            // Send format command with required body bytes
            const formatBody = new Uint8Array([1, 2, 3, 4]);
            const seqId = await this.sendCommand(HIDOCK_COMMANDS.FORMAT_CARD, formatBody);

            this.updateProgress('format_device', {
                operation: 'Formatting storage...',
                progress: 50,
                total: 100,
                status: 'in_progress'
            });

            const response = await this.receiveResponse(seqId, 60000); // 60 second timeout for format

            // Check if format was successful
            if (response.body.length > 0) {
                const view = new DataView(response.body.buffer, response.body.byteOffset);
                const status = view.getUint8(0);

                if (status !== 0) {
                    throw new Error(`Device reported format failed (status: ${status})`);
                }
            }

            this.updateProgress('format_device', {
                operation: 'Format completed successfully',
                progress: 100,
                total: 100,
                status: 'completed'
            });

            console.log('Successfully formatted device storage');
        } catch (error) {
            console.error('Failed to format device:', error);
            this.incrementErrorCount('protocolError');

            this.updateProgress('format_device', {
                operation: 'Format failed',
                progress: 0,
                total: 100,
                status: 'error',
                message: error instanceof Error ? error.message : 'Unknown error'
            });

            throw new Error('Failed to format device storage');
        } finally {
            this.removeProgressListener('format_device');
        }
    }
}

export const deviceService = new DeviceService();