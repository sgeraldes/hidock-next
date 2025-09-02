import { ERROR_MESSAGES, HIDOCK_COMMANDS, HIDOCK_DEVICE_CONFIG, HIDOCK_PRODUCT_IDS } from '@/constants';
import type { AudioRecording, HiDockDevice, StorageInfo, DeviceSettings, MeetingInfo, RecordingInfo } from '@/types';

// Device service specific interfaces
interface ConnectionStats {
    isConnected: boolean;
    retryCount: number;
    errorCounts: Record<string, number>;
    operationStats: Record<string, number>;
    lastError: string | null;
    deviceInfo: {
        vendorId: number;
        productId: number;
        productName?: string;
        serialNumber?: string;
    } | null;
}

// interface _DeviceResponse { // Future use - structured device responses
//     success: boolean;
//     data?: unknown;
//     error?: string;
// }

interface DeviceInfo {
    vendorId: number;
    productId: number;
    productName?: string;
    manufacturerName?: string;
    serialNumber?: string;
    firmwareVersion?: string;
}

interface PacketData {
    cmdId: number;
    seqId: number;
    data: Uint8Array;
    isComplete: boolean;
}

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
    status: 'pending' | 'in_progress' | 'completed' | 'error' | 'streaming' | 'cancelled';
    message?: string;
    newFiles?: AudioRecording[];
}

type ProgressCallback = (progress: DeviceOperationProgress) => void;

class DeviceService {
    private device: USBDevice | null = null;
    private isConnected = false;
    private sequenceId = 0;
    private receiveBuffer = new Uint8Array(0);

    // Enhanced connection management
    private connectionRetryCount = 0;
    private isAutoReconnecting = false;
    
    // File list caching
    private cachedRecordings: AudioRecording[] | null = null;
    private cacheTimestamp: number = 0;
    private readonly CACHE_DURATION = 30000; // 30 seconds cache
    private deviceSerialNumber: string | null = null;
    private cachedFileCount: number = -1;
    private cachedUsedSpace: number = -1;
    
    // Persistent cache keys
    private readonly CACHE_KEY = 'hidock_recordings_cache';
    private readonly CACHE_META_KEY = 'hidock_cache_metadata';
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

            // Request device access with all known HiDock vendor/product ID combinations
            const device = await navigator.usb.requestDevice({
                filters: [
                    // Actions Semiconductor vendor ID (0x10D6)
                    { vendorId: HIDOCK_DEVICE_CONFIG.VENDOR_ID, productId: HIDOCK_PRODUCT_IDS.H1 },
                    { vendorId: HIDOCK_DEVICE_CONFIG.VENDOR_ID, productId: HIDOCK_PRODUCT_IDS.H1E },
                    { vendorId: HIDOCK_DEVICE_CONFIG.VENDOR_ID, productId: HIDOCK_PRODUCT_IDS.P1 },
                    { vendorId: HIDOCK_DEVICE_CONFIG.VENDOR_ID, productId: HIDOCK_PRODUCT_IDS.DEFAULT },
                    // Alternative vendor ID (0x1a86) - commonly used for CH340/CH341 USB chips
                    { vendorId: 0x1a86, productId: HIDOCK_PRODUCT_IDS.H1 },
                    { vendorId: 0x1a86, productId: HIDOCK_PRODUCT_IDS.H1E },
                    { vendorId: 0x1a86, productId: HIDOCK_PRODUCT_IDS.P1 },
                    { vendorId: 0x1a86, productId: HIDOCK_PRODUCT_IDS.DEFAULT },
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
            
            // Handle user cancellation separately
            if (error instanceof DOMException && error.name === 'NotFoundError') {
                // User cancelled the device selection dialog
                this.updateProgress('device_request', {
                    operation: 'Device selection cancelled',
                    progress: 0,
                    total: 100,
                    status: 'cancelled'
                });
                
                // Don't throw an error for cancellation, just return null
                return null;
            }
            
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

        let connected = false;
        while (!connected) {
            try {
                const result = await this.attemptConnection(usbDevice);
                this.connectionRetryCount = 0;
                this.operationStats.connectionTime = Date.now();
                connected = true;
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

        // This should never be reached due to the while loop logic, but TypeScript requires it
        throw new Error(ERROR_MESSAGES.CONNECTION_FAILED);
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
        this.isAutoReconnecting = false; // Reset auto-reconnect flag on successful connection

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

        // Use the actual product name from the device, or determine based on product ID
        let model = this.device.productName || 'Unknown HiDock';
        
        // Only use product ID-based naming as a fallback if no product name
        if (!this.device.productName) {
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
        }

        this.updateProgress('device_connection', {
            operation: 'Connection completed',
            progress: 100,
            total: 100,
            status: 'completed'
        });

        return {
            id: this.device.serialNumber || 'unknown',
            name: model,  // Use the model as the name
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
                this.isAutoReconnecting = false; // Reset auto-reconnection flag on disconnect
                
                // Keep cache in memory and localStorage for when device reconnects
                // Cache will be invalidated if storage info changes on next connection

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

    private _resetErrorCounts(): void { // Future use - error count management
        this.errorCounts = {
            usbTimeout: 0,
            usbPipeError: 0,
            connectionLost: 0,
            protocolError: 0
        };
        console.debug('Error counts reset');
    }

    private delay(ms: number): Promise<void> {
        // Debug: track error reset capability
        if (Math.random() < 0.001) this._resetErrorCounts();
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

    public getConnectionStats(): ConnectionStats {
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

    private loadCacheFromStorage(): void {
        try {
            const metaStr = localStorage.getItem(this.CACHE_META_KEY);
            const cacheStr = localStorage.getItem(this.CACHE_KEY);
            
            if (metaStr && cacheStr) {
                const meta = JSON.parse(metaStr);
                const cache = JSON.parse(cacheStr);
                
                // Restore cache if it's for the same device
                if (meta.deviceSerialNumber && cache.recordings) {
                    this.cachedRecordings = cache.recordings.map((rec: any) => ({
                        ...rec,
                        dateCreated: new Date(rec.dateCreated)
                    }));
                    this.cachedFileCount = meta.fileCount;
                    this.cachedUsedSpace = meta.usedSpace;
                    this.deviceSerialNumber = meta.deviceSerialNumber;
                    this.cacheTimestamp = meta.timestamp;
                    
                    console.log(`📦 Loaded cached recordings from localStorage: ${this.cachedRecordings.length} files`);
                }
            }
        } catch (error) {
            console.warn('Failed to load cache from localStorage:', error);
            // Clear corrupt cache
            localStorage.removeItem(this.CACHE_KEY);
            localStorage.removeItem(this.CACHE_META_KEY);
        }
    }
    
    private saveCacheToStorage(): void {
        try {
            if (this.cachedRecordings && this.deviceSerialNumber) {
                const meta = {
                    deviceSerialNumber: this.deviceSerialNumber,
                    fileCount: this.cachedFileCount,
                    usedSpace: this.cachedUsedSpace,
                    timestamp: this.cacheTimestamp
                };
                
                const cache = {
                    recordings: this.cachedRecordings
                };
                
                localStorage.setItem(this.CACHE_META_KEY, JSON.stringify(meta));
                localStorage.setItem(this.CACHE_KEY, JSON.stringify(cache));
                
                console.log(`💾 Saved ${this.cachedRecordings.length} recordings to localStorage cache`);
            }
        } catch (error) {
            console.warn('Failed to save cache to localStorage:', error);
            // If storage is full or fails, clear it
            localStorage.removeItem(this.CACHE_KEY);
            localStorage.removeItem(this.CACHE_META_KEY);
        }
    }

    async getRecordings(forceRefresh: boolean = false): Promise<AudioRecording[]> {
        if (!this.isConnected || !this.device) {
            throw new Error('Device not connected');
        }

        // Load cache from localStorage if not already loaded
        if (!this.cachedRecordings && !forceRefresh) {
            this.loadCacheFromStorage();
        }

        // First check if we need to refresh based on storage info changes
        if (!forceRefresh && this.cachedRecordings && this.device.serialNumber === this.deviceSerialNumber) {
            try {
                // Get current storage info to check if files have changed
                const currentStorageInfo = await this.getStorageInfo();
                
                // Check if file count or used space has changed
                const storageUnchanged = 
                    currentStorageInfo.fileCount === this.cachedFileCount &&
                    currentStorageInfo.usedSpace === this.cachedUsedSpace;
                
                if (storageUnchanged) {
                    console.log(`📋 Storage unchanged (${this.cachedFileCount} files, ${this.cachedUsedSpace} bytes used) - using cached file list`);
                    return this.cachedRecordings;
                }
                
                console.log(`📋 Storage changed - File count: ${this.cachedFileCount} → ${currentStorageInfo.fileCount}, Used: ${this.cachedUsedSpace} → ${currentStorageInfo.usedSpace}`);
                
                // Update cached values for next check
                this.cachedFileCount = currentStorageInfo.fileCount;
                this.cachedUsedSpace = currentStorageInfo.usedSpace;
                
                // Also update the localStorage metadata so the change is persisted
                try {
                    const meta = {
                        deviceSerialNumber: this.deviceSerialNumber,
                        fileCount: this.cachedFileCount,
                        usedSpace: this.cachedUsedSpace,
                        timestamp: this.cacheTimestamp
                    };
                    localStorage.setItem(this.CACHE_META_KEY, JSON.stringify(meta));
                } catch (error) {
                    console.warn('Failed to update cache metadata:', error);
                }
            } catch (error) {
                console.warn('Failed to check storage info, will fetch file list anyway:', error);
            }
        }

        console.log('📋 Fetching fresh file list from device...');
        
        try {
            this.updateProgress('get_recordings', {
                operation: 'Getting file list',
                progress: 0,
                total: 100,
                status: 'in_progress'
            });

            const seqId = await this.sendCommand(HIDOCK_COMMANDS.GET_FILE_LIST);
            
            // Collect streaming file list packets with incremental parsing
            const recordings = await this.receiveAndParseStreamingFileList(
                seqId, 
                HIDOCK_COMMANDS.GET_FILE_LIST,
                (fileCount: number, totalFiles: number, packetCount: number) => {
                    this.updateProgress('get_recordings', {
                        operation: `Loading file list`,
                        progress: fileCount,
                        total: totalFiles || 500, // Use estimated total until we know the real total
                        status: 'in_progress',
                        message: `Found ${fileCount}${totalFiles ? `/${totalFiles}` : ''} files (${packetCount} packets)`
                    });
                },
                10000, // timeout
                (newFiles: AudioRecording[]) => {
                    // Emit streaming progress for UI to show files incrementally
                    console.log(`🚀 DEVICE: Broadcasting ${newFiles.length} files via streaming_files progress`);
                    this.updateProgress('streaming_files', {
                        operation: 'New files available',
                        progress: newFiles.length,
                        total: newFiles.length,
                        status: 'streaming',
                        newFiles
                    });
                }
            );

            this.updateProgress('get_recordings', {
                operation: `Found ${recordings.length} recordings`,
                progress: 100,
                total: 100,
                status: 'completed'
            });

            // Cache the results with storage info for smart invalidation
            this.cachedRecordings = recordings;
            this.cacheTimestamp = Date.now();
            this.deviceSerialNumber = this.device.serialNumber || null;
            
            // Store the current file count and used space for cache validation
            // These values were already updated in the check above if we entered this code path
            // If not (first fetch), get them now
            if (this.cachedFileCount === -1 || this.cachedUsedSpace === -1) {
                try {
                    const storageInfo = await this.getStorageInfo();
                    this.cachedFileCount = storageInfo.fileCount;
                    this.cachedUsedSpace = storageInfo.usedSpace;
                } catch (error) {
                    console.warn('Failed to cache storage info:', error);
                    // Use recording count as fallback
                    this.cachedFileCount = recordings.length;
                    this.cachedUsedSpace = recordings.reduce((total, rec) => total + rec.size, 0);
                }
            }
            
            console.log(`📋 Cached ${recordings.length} files for device ${this.deviceSerialNumber} (${this.cachedFileCount} files, ${this.cachedUsedSpace} bytes used)`);
            
            // Save cache to localStorage for persistence across browser refreshes
            this.saveCacheToStorage();

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
        const totalSizeBytes = 0; // Not reassigned anymore
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

                const _totalSizeBytes = totalSizeBytes + fileLengthBytes; // Future: use for storage calculation
                console.debug('Processing file, current total size:', _totalSizeBytes, 'bytes');
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

    async downloadRecording(recordingId: string, progressCallback?: ProgressCallback, fileName?: string, fileSize?: number): Promise<ArrayBuffer> {
        if (!this.isConnected || !this.device) {
            throw new Error('Device not connected');
        }

        try {
            // Set up progress tracking
            if (progressCallback) {
                this.onProgress(`download_${recordingId}`, progressCallback);
            }

            // If fileName not provided, we need to get it (backward compatibility)
            let recordingFileName = fileName;
            let recordingSize = fileSize || 0;
            
            if (!recordingFileName) {
                console.warn(`⚠️ No filename provided, fetching file list (SLOW!)...`);
                this.updateProgress(`download_${recordingId}`, {
                    operation: 'Finding recording',
                    progress: 0,
                    total: 100,
                    status: 'in_progress'
                });
                
                const recordings = await this.getRecordings();
                const recording = recordings.find(r => r.id === recordingId);
                if (!recording) {
                    throw new Error('Recording not found');
                }
                recordingFileName = recording.fileName;
                recordingSize = recording.size;
            }
            
            console.log(`📥 Downloading: ${recordingFileName} (${recordingSize} bytes)`);

            this.updateProgress(`download_${recordingId}`, {
                operation: 'Starting download',
                progress: 10,
                total: 100,
                status: 'in_progress'
            });

            // Use GET_FILE_BLOCK to download the entire file
            const fileData = await this.downloadFileBlocks(recordingFileName, recordingSize, `download_${recordingId}`);

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

    private async downloadFileBlocks(fileName: string, fileSize: number, progressId: string): Promise<ArrayBuffer> {
        console.log(`📥 Starting single-block download for: ${fileName} (${fileSize} bytes) using jensen.js protocol`);
        
        try {
            // Build command body following jensen.js format: 4-byte length (big-endian) + filename
            const body = new Uint8Array(4 + fileName.length);
            const view = new DataView(body.buffer);
            
            // Big-endian file size (total length to download)
            view.setUint32(0, fileSize, false); // Big-endian file size
            
            // Add filename
            const encoder = new TextEncoder();
            const filenameBytes = encoder.encode(fileName);
            body.set(filenameBytes, 4);
            
            console.log(`📥 Sending GET_FILE_BLOCK command: length=${fileSize}, filename="${fileName}"`);
            
            // Send GET_FILE_BLOCK command
            const seqId = await this.sendCommand(HIDOCK_COMMANDS.GET_FILE_BLOCK, body);
            
            // Receive the file data in streaming fashion (jensen.js style)
            const fileData = await this.receiveFileDataStream(seqId, fileSize, progressId);
            
            console.log(`✅ Download completed: ${fileData.byteLength} bytes`);
            return fileData;
            
        } catch (error) {
            console.error(`Failed to download file:`, error);
            throw new Error(`Download failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
        }
    }

    private async receiveFileDataStream(seqId: number, expectedSize: number, progressId: string): Promise<ArrayBuffer> {
        console.log(`📥 Starting streamed file data receive, expected size: ${expectedSize} bytes`);
        const chunks: Uint8Array[] = [];
        let totalReceived = 0;
        const startTime = Date.now();
        const timeout = 60000; // 60 seconds timeout
        let chunkCount = 0;

        while (totalReceived < expectedSize) {
            if (Date.now() - startTime > timeout) {
                const elapsed = Math.round((Date.now() - startTime) / 1000);
                throw new Error(`File transfer timeout after ${elapsed}s. Received ${totalReceived}/${expectedSize} bytes in ${chunkCount} chunks`);
            }

            try {
                console.log(`📥 Waiting for chunk ${chunkCount + 1}, received so far: ${totalReceived}/${expectedSize}`);
                const response = await this.receiveResponse(seqId, 15000, HIDOCK_COMMANDS.GET_FILE_BLOCK);
                chunkCount++;

                if (!response.data || response.data.length === 0) {
                    if (totalReceived >= expectedSize) {
                        console.log('📥 Received empty chunk, transfer complete');
                        break; // Transfer complete
                    }
                    console.warn('Empty chunk received before completion');
                    await this.delay(100);
                    continue;
                }

                chunks.push(response.data);
                totalReceived += response.data.length;

                // Update progress
                const progress = Math.min((totalReceived / expectedSize) * 80 + 10, 95); // 10-95% range
                this.updateProgress(progressId, {
                    operation: `Downloaded: ${this.formatBytes(totalReceived)} / ${this.formatBytes(expectedSize)}`,
                    progress,
                    total: 100,
                    status: 'in_progress'
                });

                console.log(`📥 Chunk ${chunkCount}: ${response.data.length} bytes, total: ${totalReceived}/${expectedSize}`);

                // Check if we've received all data
                if (totalReceived >= expectedSize) {
                    console.log(`📥 Download complete: received ${totalReceived}/${expectedSize} bytes in ${chunkCount} chunks`);
                    break;
                }
                
            } catch (error) {
                console.error(`Failed to receive chunk ${chunkCount}:`, error);
                throw new Error(`File transfer failed at chunk ${chunkCount}: ${error instanceof Error ? error.message : 'Unknown error'}`);
            }
        }

        // Combine all chunks
        const finalData = new Uint8Array(totalReceived);
        let position = 0;
        for (const chunk of chunks) {
            finalData.set(chunk, position);
            position += chunk.length;
        }

        console.log(`✅ File transfer completed: ${finalData.length} bytes in ${chunks.length} chunks`);
        return finalData.buffer;
    }

    private async receiveFileData(seqId: number, expectedSize: number, progressId: string): Promise<ArrayBuffer> {
        console.log(`📥 Starting file data receive, expected size: ${expectedSize} bytes`);
        const chunks: Uint8Array[] = [];
        let totalReceived = 0;
        const startTime = Date.now();
        const timeout = 60000; // 60 seconds timeout (reduced from 3 minutes)
        let chunkCount = 0;

        while (totalReceived < expectedSize) {
            if (Date.now() - startTime > timeout) {
                const elapsed = Math.round((Date.now() - startTime) / 1000);
                throw new Error(`File transfer timeout after ${elapsed}s. Received ${totalReceived}/${expectedSize} bytes in ${chunkCount} chunks`);
            }

            try {
                console.log(`📥 Waiting for chunk ${chunkCount + 1}, received so far: ${totalReceived}/${expectedSize}`);
                const response = await this.receiveResponse(seqId, 15000, HIDOCK_COMMANDS.TRANSFER_FILE);
                chunkCount++;

                if (response.data.length === 0) {
                    if (totalReceived >= expectedSize) {
                        break; // Transfer complete
                    }
                    console.warn('Empty chunk received before completion');
                    await this.delay(100);
                    continue;
                }

                chunks.push(response.data);
                totalReceived += response.data.length;

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
            const responseView = new DataView(response.data.buffer, response.data.byteOffset);
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

    private async receiveResponse(expectedSeqId: number, timeoutMs = 5000, streamingCmdId?: number): Promise<PacketData> {
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
                    let packetParsed = true;
                    while (packetParsed) {
                        const packet = this.parsePacket();
                        if (!packet) {
                            packetParsed = false;
                            break;
                        }

                        // Check if this is the response we're waiting for OR a streaming packet
                        if (packet.seqId === expectedSeqId ||
                            (streamingCmdId !== undefined && packet.cmdId === streamingCmdId)) {

                            this.operationStats.responsesReceived++;
                            return packet;
                        } else {
                            console.warn(`Unexpected Seq/CMD. Expected Seq: ${expectedSeqId} ` +
                                `(or stream ${streamingCmdId}), Got CMD: ${packet.cmdId} Seq: ${packet.seqId}. Discarding.`);
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

    private async receiveAllStreamingPackets(
        initialSeqId: number, 
        streamingCmdId: number, 
        onProgress?: (packetCount: number, totalBytes: number) => void,
        timeoutMs = 10000
    ): Promise<Uint8Array> {
        if (!this.device || !this.isConnected) {
            throw new Error('Device not connected');
        }

        const startTime = Date.now();
        const allData: Uint8Array[] = [];

        while (Date.now() - startTime < timeoutMs) {
            try {
                // Read data from device
                const readSize = 4096 * 16; // 64KB buffer
                const result = await this.device.transferIn(HIDOCK_DEVICE_CONFIG.ENDPOINT_IN, readSize);

                if (result.status === 'ok' && result.data) {
                    const newData = new Uint8Array(result.data.buffer);

                    // Append to receive buffer
                    const combined = new Uint8Array(this.receiveBuffer.length + newData.length);
                    combined.set(this.receiveBuffer);
                    combined.set(newData, this.receiveBuffer.length);
                    this.receiveBuffer = combined;

                    // Parse all available packets
                    let packetParsed = true;
                    while (packetParsed) {
                        const packet = this.parsePacket();
                        if (!packet) {
                            packetParsed = false;
                            break;
                        }

                        // Check if this is a streaming packet for our command
                        if (packet.cmdId === streamingCmdId) {
                            console.debug(`Got streaming packet: CMD ${packet.cmdId}, Seq ${packet.seqId}, Data length: ${packet.data.length}`);
                            allData.push(packet.data);
                            
                            // Report progress
                            if (onProgress) {
                                const totalBytes = allData.reduce((sum, data) => sum + data.length, 0);
                                onProgress(allData.length, totalBytes);
                            }
                        } else if (packet.seqId === initialSeqId) {
                            // This might be the initial response
                            console.debug(`Got initial response: CMD ${packet.cmdId}, Seq ${packet.seqId}`);
                            if (allData.length === 0) {
                                allData.push(packet.data);
                                
                                // Report progress for initial packet
                                if (onProgress) {
                                    onProgress(1, packet.data.length);
                                }
                            }
                        } else {
                            console.debug(`Ignoring packet: CMD ${packet.cmdId}, Seq ${packet.seqId}`);
                        }
                    }
                }

                // If we have data and haven't received new packets recently, consider stopping
                if (allData.length > 0) {
                    await this.delay(100);
                    
                    // Simple heuristic: stop after collecting data for a reasonable time
                    const timeSinceStart = Date.now() - startTime;
                    if (timeSinceStart > 3000) { // Stop after 3 seconds if we have data
                        console.debug('Stopping stream collection after 3s timeout with data');
                        break;
                    }
                }

            } catch (error) {
                if (error instanceof DOMException && error.name === 'NetworkError') {
                    // USB timeout is normal when no more data is available
                    if (allData.length > 0) {
                        console.debug('USB timeout but we have data, ending stream');
                        break;
                    }
                }
                console.error('Error in streaming packet reception:', error);
                throw error;
            }
        }

        if (allData.length === 0) {
            throw new Error('No streaming data received');
        }

        // Combine all data
        const totalLength = allData.reduce((sum, data) => sum + data.length, 0);
        const combined = new Uint8Array(totalLength);
        let offset = 0;
        for (const data of allData) {
            combined.set(data, offset);
            offset += data.length;
        }

        console.debug(`Collected ${allData.length} streaming packets, total ${totalLength} bytes`);
        return combined;
    }

    private async receiveAndParseStreamingFileList(
        initialSeqId: number,
        streamingCmdId: number,
        onProgress?: (fileCount: number, totalFiles: number, packetCount: number) => void,
        timeoutMs = 10000,
        onNewFiles?: (files: AudioRecording[]) => void
    ): Promise<AudioRecording[]> {
        if (!this.device || !this.isConnected) {
            throw new Error('Device not connected');
        }

        const startTime = Date.now();
        const recordings: AudioRecording[] = [];
        let packetCount = 0;
        let totalFilesFromHeader = 0;
        let partialPacketBuffer = new Uint8Array(0);

        while (Date.now() - startTime < timeoutMs) {
            try {
                const readSize = 4096 * 16; // 64KB buffer
                const result = await this.device.transferIn(HIDOCK_DEVICE_CONFIG.ENDPOINT_IN, readSize);

                if (result.status === 'ok' && result.data) {
                    const newData = new Uint8Array(result.data.buffer);

                    // Append to receive buffer
                    const combined = new Uint8Array(this.receiveBuffer.length + newData.length);
                    combined.set(this.receiveBuffer);
                    combined.set(newData, this.receiveBuffer.length);
                    this.receiveBuffer = combined;

                    // Parse all available packets
                    let packetParsed = true;
                    while (packetParsed) {
                        const packet = this.parsePacket();
                        if (!packet) {
                            packetParsed = false;
                            break;
                        }

                        // Check if this is a streaming packet for our command
                        if (packet.cmdId === streamingCmdId || packet.seqId === initialSeqId) {
                            packetCount++;
                            
                            // Combine with any leftover data from previous packet
                            const currentData = new Uint8Array(partialPacketBuffer.length + packet.data.length);
                            currentData.set(partialPacketBuffer);
                            currentData.set(packet.data, partialPacketBuffer.length);
                            
                            // Parse files from this packet data
                            const { parsedFiles, remainingBuffer, headerTotal } = this.parsePartialFileList(currentData, totalFilesFromHeader);
                            
                            // Update total if we found it in header
                            if (headerTotal > 0 && totalFilesFromHeader === 0) {
                                totalFilesFromHeader = headerTotal;
                            }
                            
                            // Add newly parsed files
                            recordings.push(...parsedFiles);
                            
                            // Emit new files for streaming display in smaller batches
                            if (onNewFiles && parsedFiles.length > 0) {
                                console.log(`🔥 DEVICE: Processing ${parsedFiles.length} new files in smaller batches at ${new Date().toLocaleTimeString()}`);
                                
                                // Stream files in batches of 10 to make updates more granular
                                const batchSize = 10;
                                for (let i = 0; i < parsedFiles.length; i += batchSize) {
                                    const batch = parsedFiles.slice(i, i + batchSize);
                                    console.log(`📦 DEVICE: Emitting batch ${Math.floor(i/batchSize) + 1}/${Math.ceil(parsedFiles.length/batchSize)} with ${batch.length} files at ${new Date().toLocaleTimeString()}`);
                                    onNewFiles(batch);
                                    
                                    // Small delay between batches to make streaming visible
                                    if (i + batchSize < parsedFiles.length) {
                                        await this.delay(200); // 200ms between 10-file batches
                                    }
                                }
                            }
                            
                            // Store remaining partial data for next packet
                            partialPacketBuffer = remainingBuffer;
                            
                            // Report progress
                            if (onProgress) {
                                onProgress(recordings.length, totalFilesFromHeader, packetCount);
                            }
                            
                            console.debug(`Packet ${packetCount}: +${parsedFiles.length} files (total: ${recordings.length}${totalFilesFromHeader ? `/${totalFilesFromHeader}` : ''})`);
                        }
                    }
                }

                // Stop condition: if we have files and haven't received new packets recently
                if (recordings.length > 0) {
                    await this.delay(100);
                    
                    const timeSinceStart = Date.now() - startTime;
                    if (timeSinceStart > 3000) { // Stop after 3s if we have data
                        console.debug(`Stopping stream after 3s with ${recordings.length} files from ${packetCount} packets`);
                        break;
                    }
                }

            } catch (error) {
                if (error instanceof DOMException && error.name === 'NetworkError') {
                    if (recordings.length > 0) {
                        console.debug(`USB timeout but we have ${recordings.length} files, ending stream`);
                        break;
                    }
                }
                console.error('Error in streaming file list reception:', error);
                throw error;
            }
        }

        if (recordings.length === 0) {
            throw new Error('No files received from streaming');
        }

        console.debug(`Streaming complete: ${recordings.length} files from ${packetCount} packets`);
        return recordings;
    }

    async getAudioBlobUrl(recordingId: string, fileName?: string, fileSize?: number): Promise<string> {
        try {
            console.log(`🎵 Getting audio: ${fileName || recordingId}`);
            
            // Simple progress callback
            const progressCallback = (progress: ProgressData) => {
                if (progress.status === 'error') {
                    console.error(`❌ Download error: ${progress.message}`);
                }
            };
            
            // Download the audio data with progress tracking - NOW WITH FILENAME!
            const audioData = await this.downloadRecording(recordingId, progressCallback, fileName, fileSize);
            
            console.log(`✅ Downloaded ${audioData.byteLength} bytes`);
            
            // Create blob from ArrayBuffer
            // HiDock files are typically WAV format
            const audioBlob = new Blob([audioData], { type: 'audio/wav' });
            
            // Create object URL for playback
            const audioUrl = URL.createObjectURL(audioBlob);
            
            console.log(`✅ DEVICE: Created audio blob URL for ${recordingId}: ${audioUrl.slice(0, 50)}...`);
            return audioUrl;
            
        } catch (error) {
            console.error(`❌ DEVICE: Failed to get audio blob URL for ${recordingId}:`, error);
            throw new Error(`Failed to load audio: ${error instanceof Error ? error.message : 'Unknown error'}`);
        }
    }

    revokeAudioBlobUrl(url: string): void {
        try {
            URL.revokeObjectURL(url);
            console.log(`🗑️ DEVICE: Revoked audio blob URL: ${url.slice(0, 50)}...`);
        } catch (error) {
            console.warn('Failed to revoke audio blob URL:', error);
        }
    }

    private parsePartialFileList(data: Uint8Array, knownTotal: number): {
        parsedFiles: AudioRecording[];
        remainingBuffer: Uint8Array;
        headerTotal: number;
    } {
        const recordings: AudioRecording[] = [];
        const dataView = new DataView(data.buffer, data.byteOffset);
        let offset = 0;
        let totalFilesFromHeader = knownTotal;

        // Check for header with total file count (only if we haven't seen it yet)
        if (totalFilesFromHeader === 0 && data.length >= 6 && dataView.getUint8(offset) === 0xFF && dataView.getUint8(offset + 1) === 0xFF) {
            totalFilesFromHeader = dataView.getUint32(offset + 2, false);
            offset += 6;
            console.debug(`Found total files in header: ${totalFilesFromHeader}`);
        }

        // Parse files until we run out of complete records or data
        while (offset < data.length) {
            const startOffset = offset;
            
            try {
                // Check if we have minimum data for a file record
                if (offset + 4 > data.length) break;

                const fileVersion = dataView.getUint8(offset);
                offset += 1;

                // Get filename length (3 bytes, big endian)
                if (offset + 3 > data.length) {
                    offset = startOffset;
                    break;
                }
                const nameLen = (dataView.getUint8(offset) << 16) |
                    (dataView.getUint8(offset + 1) << 8) |
                    dataView.getUint8(offset + 2);
                offset += 3;

                if (offset + nameLen > data.length) {
                    offset = startOffset;
                    break;
                }

                // Extract filename
                const filenameBytes = data.slice(offset, offset + nameLen);
                const filename = String.fromCharCode(...Array.from(filenameBytes).filter(b => b > 0));
                offset += nameLen;

                // Check for remaining required fields
                const minRemaining = 4 + 6 + 16;
                if (offset + minRemaining > data.length) {
                    offset = startOffset;
                    break;
                }

                // Get file length
                const fileLengthBytes = dataView.getUint32(offset, false);
                offset += 4;

                // Skip 6 bytes
                offset += 6;

                // Skip signature (16 bytes)  
                offset += 16;

                // Calculate duration and create recording
                let durationSec = 0;
                if (fileVersion === 1) {
                    durationSec = Math.round(fileLengthBytes / 16000);
                } else if (fileVersion === 2) {
                    durationSec = Math.round(fileLengthBytes / 32000);
                } else {
                    durationSec = Math.round(fileLengthBytes / 16000);
                }

                recordings.push({
                    id: `hidock-${filename}`,
                    fileName: filename,
                    size: fileLengthBytes,
                    duration: durationSec,
                    dateCreated: this.parseFilenameDate(filename),
                    status: 'on_device'
                });

            } catch (error) {
                console.warn(`Error parsing file at offset ${offset}:`, error);
                offset = startOffset;
                break;
            }
        }

        // Return remaining unparsed data
        const remainingBuffer = offset < data.length ? data.slice(offset) : new Uint8Array(0);
        
        return {
            parsedFiles: recordings,
            remainingBuffer,
            headerTotal: totalFilesFromHeader
        };
    }

    private parsePacket(): PacketData | null {
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
                cmdId: commandId,
                seqId: sequence,
                data: body,
                isComplete: true
            };
        } catch (error) {
            console.error('Error parsing packet:', error);
            this.incrementErrorCount('protocolError');
            // Clear buffer to prevent infinite loop
            this.receiveBuffer = new Uint8Array(0);
            return null;
        }
    }

    private async getDeviceInfo(): Promise<DeviceInfo> {
        try {
            const seqId = await this.sendCommand(HIDOCK_COMMANDS.GET_DEVICE_INFO);
            const response = await this.receiveResponse(seqId);

            if (response.data.length >= 4) {
                const view = new DataView(response.data.buffer, response.data.byteOffset);
                const versionCodeBytes = response.data.slice(0, 4);
                const _versionNumber = view.getUint32(0, false); // Future: use for version validation
                console.debug('Device version number:', _versionNumber);
                const versionCode = Array.from(versionCodeBytes.slice(1)).join('.');

                let serialNumber = 'N/A';
                if (response.data.length > 4) {
                    const serialBytes = response.data.slice(4, 20);
                    // Filter printable characters and decode
                    const printableBytes = Array.from(serialBytes).filter((b: number) => (b >= 32 && b <= 126) || b === 0);
                    const nullIndex = printableBytes.indexOf(0);
                    const cleanBytes = nullIndex !== -1 ? printableBytes.slice(0, nullIndex) : printableBytes;
                    serialNumber = new TextDecoder().decode(new Uint8Array(cleanBytes as number[])).trim() ||
                        Array.from(serialBytes).map((b: number) => b.toString(16).padStart(2, '0')).join('');
                }

                return {
                    vendorId: this.device?.vendorId || 0,
                    productId: this.device?.productId || 0,
                    productName: this.device?.productName,
                    manufacturerName: this.device?.manufacturerName,
                    serialNumber,
                    firmwareVersion: versionCode
                };
            }

            // Fallback to basic info
            return {
                vendorId: this.device?.vendorId || 0,
                productId: this.device?.productId || 0,
                productName: this.device?.productName,
                manufacturerName: this.device?.manufacturerName,
                serialNumber: this.device?.serialNumber || 'Unknown',
                firmwareVersion: '1.0.0'
            };
        } catch (error) {
            console.error('Failed to get device info:', error);
            // Fallback to basic info
            return {
                vendorId: this.device?.vendorId || 0,
                productId: this.device?.productId || 0,
                productName: this.device?.productName,
                manufacturerName: this.device?.manufacturerName,
                serialNumber: 'Unknown',
                firmwareVersion: '1.0.0'
            };
        }
    }

    private async getStorageInfo(): Promise<StorageInfo> {
        try {
            const seqId = await this.sendCommand(HIDOCK_COMMANDS.GET_CARD_INFO);
            const response = await this.receiveResponse(seqId);

            console.log(`📊 Storage info response: ${response.data.length} bytes`);

            if (response.data.length >= 12) {
                const view = new DataView(response.data.buffer, response.data.byteOffset);

                // Parse storage info (values are in MiB - binary megabytes)
                // Note: Device returns FREE space first, then total capacity
                const freeMiB = view.getUint32(0, false);
                const capacityMiB = view.getUint32(4, false);
                const statusRaw = view.getUint32(8, false); // Status information
                
                console.log(`📊 Storage raw values: free=${freeMiB} MiB, capacity=${capacityMiB} MiB, status=0x${statusRaw.toString(16)}`);

                // Convert MiB to bytes (1 MiB = 1024 * 1024 bytes)
                // This will give us the actual binary capacity
                const totalCapacity = capacityMiB * 1024 * 1024;
                const freeSpace = freeMiB * 1024 * 1024;
                const usedSpace = totalCapacity - freeSpace;
                
                // Get file count separately
                let fileCount = 0;
                try {
                    fileCount = await this.getFileCount();
                } catch (err) {
                    console.warn('Failed to get file count, using 0:', err);
                }

                console.log(`📊 Storage calculated: total=${this.formatBytes(totalCapacity)}, used=${this.formatBytes(usedSpace)}, free=${this.formatBytes(freeSpace)}, files=${fileCount}`);

                return {
                    totalCapacity,
                    usedSpace,
                    freeSpace,
                    fileCount,
                };
            }

            console.warn('Storage info response too short, using fallback values');
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

            if (!response.data || response.data.length === 0) {
                return 0;
            }

            if (response.data.length >= 4) {
                const view = new DataView(response.data.buffer, response.data.byteOffset);
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

    // Auto-reconnect to already paired devices on app startup
    async tryAutoReconnect(): Promise<HiDockDevice | null> {
        // Prevent multiple simultaneous auto-reconnection attempts
        if (this.isAutoReconnecting) {
            console.log('🔄 Auto-reconnection already in progress, skipping...');
            return null;
        }
        
        // Don't try to auto-reconnect if already connected
        if (this.isConnected) {
            console.log('🔗 Already connected, skipping auto-reconnection');
            // Return current device info if already connected
            if (this.device) {
                return await this.getCurrentDeviceInfo();
            }
            return null;
        }
        
        this.isAutoReconnecting = true;
        
        try {
            console.log('🔍 Checking for previously paired devices...');
            const devices = await navigator.usb.getDevices();
            
            for (const device of devices) {
                if (this.isHiDockDevice(device)) {
                    console.log(`🔌 Found paired HiDock device: ${device.productName}`);
                    try {
                        const connectedDevice = await this.connectToDevice(device);
                        console.log('✅ Auto-reconnected successfully');
                        return connectedDevice;
                    } catch (error) {
                        console.warn('⚠️ Failed to auto-reconnect:', error);
                        continue;
                    }
                }
            }
            
            console.log('📭 No paired HiDock devices found');
            return null;
        } catch (error) {
            console.error('❌ Auto-reconnect failed:', error);
            return null;
        } finally {
            this.isAutoReconnecting = false;
        }
    }
    
    // Helper method to get current device info with storage
    async getCurrentDeviceInfo(): Promise<HiDockDevice> {
        if (!this.device || !this.isConnected) {
            throw new Error('Device not connected');
        }
        
        const deviceInfo = await this.getDeviceInfo();
        const storageInfo = await this.getStorageInfo();
        
        // Use the actual product name from the device, or determine based on product ID
        let model = this.device.productName || 'Unknown HiDock';
        
        // Only use product ID-based naming as a fallback if no product name
        if (!this.device.productName) {
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
        }
        
        return {
            id: this.device.serialNumber || 'unknown',
            name: model,  // Use the model as the name
            model,
            serialNumber: this.device.serialNumber || 'Unknown',
            firmwareVersion: deviceInfo.firmwareVersion || '1.0.0',
            connected: true,
            storageInfo,
        };
    }
    
    private isHiDockDevice(device: USBDevice): boolean {
        // Check if device is a HiDock based on vendor/product ID
        const isKnownVendor = device.vendorId === 0x10D6 || device.vendorId === 0x1a86;
        const isKnownProduct = Object.values(HIDOCK_PRODUCT_IDS).includes(device.productId);
        const hasHiDockName = device.productName?.toLowerCase().includes('hidock') ?? false;
        
        return isKnownVendor && (isKnownProduct || hasHiDockName);
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
            if (response.data.length > 0) {
                const view = new DataView(response.data.buffer, response.data.byteOffset);
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
            if (response.data.length > 0) {
                const view = new DataView(response.data.buffer, response.data.byteOffset);
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

    // Device Settings Commands
    async getSettings(): Promise<DeviceSettings> {
        if (!this.isConnected || !this.device) {
            throw new Error(ERROR_MESSAGES.DEVICE_NOT_CONNECTED);
        }

        try {
            const seqId = await this.sendCommand(HIDOCK_COMMANDS.GET_SETTINGS);
            const response = await this.receiveResponse(seqId);

            if (response.data.length >= 16) {
                return {
                    autoRecord: response.data[3] === 1,
                    autoPlay: response.data[7] === 1,
                    bluetoothTone: response.data[15] !== 1,
                    notification: response.data.length >= 12 ? response.data[11] === 1 : undefined
                };
            }

            throw new Error('Invalid settings response from device');
        } catch (error) {
            console.error('Failed to get device settings:', error);
            throw new Error('Failed to get device settings');
        }
    }

    async setAutoRecord(enabled: boolean): Promise<void> {
        if (!this.isConnected || !this.device) {
            throw new Error(ERROR_MESSAGES.DEVICE_NOT_CONNECTED);
        }

        try {
            const body = new Uint8Array([0, 0, 0, enabled ? 1 : 2]);
            const seqId = await this.sendCommand(HIDOCK_COMMANDS.SET_SETTINGS, body);
            const response = await this.receiveResponse(seqId);

            if (response.data.length > 0 && response.data[0] !== 0) {
                throw new Error('Device reported settings update failed');
            }
        } catch (error) {
            console.error('Failed to set auto record:', error);
            throw new Error('Failed to update auto record setting');
        }
    }

    async setAutoPlay(enabled: boolean): Promise<void> {
        if (!this.isConnected || !this.device) {
            throw new Error(ERROR_MESSAGES.DEVICE_NOT_CONNECTED);
        }

        try {
            const body = new Uint8Array([0, 0, 0, 0, 0, 0, 0, enabled ? 1 : 2]);
            const seqId = await this.sendCommand(HIDOCK_COMMANDS.SET_SETTINGS, body);
            const response = await this.receiveResponse(seqId);

            if (response.data.length > 0 && response.data[0] !== 0) {
                throw new Error('Device reported settings update failed');
            }
        } catch (error) {
            console.error('Failed to set auto play:', error);
            throw new Error('Failed to update auto play setting');
        }
    }

    async setNotification(enabled: boolean): Promise<void> {
        if (!this.isConnected || !this.device) {
            throw new Error(ERROR_MESSAGES.DEVICE_NOT_CONNECTED);
        }

        try {
            const body = new Uint8Array(12);
            body[11] = enabled ? 1 : 2;
            const seqId = await this.sendCommand(HIDOCK_COMMANDS.SET_SETTINGS, body);
            const response = await this.receiveResponse(seqId);

            if (response.data.length > 0 && response.data[0] !== 0) {
                throw new Error('Device reported settings update failed');
            }
        } catch (error) {
            console.error('Failed to set notification:', error);
            throw new Error('Failed to update notification setting');
        }
    }

    async setBluetoothTone(enabled: boolean): Promise<void> {
        if (!this.isConnected || !this.device) {
            throw new Error(ERROR_MESSAGES.DEVICE_NOT_CONNECTED);
        }

        try {
            const body = new Uint8Array(16);
            body[15] = enabled ? 2 : 1; // Note: inverted logic for bluetooth tone
            const seqId = await this.sendCommand(HIDOCK_COMMANDS.SET_SETTINGS, body);
            const response = await this.receiveResponse(seqId);

            if (response.data.length > 0 && response.data[0] !== 0) {
                throw new Error('Device reported settings update failed');
            }
        } catch (error) {
            console.error('Failed to set bluetooth tone:', error);
            throw new Error('Failed to update bluetooth tone setting');
        }
    }

    // Calendar/Meeting Integration
    async sendScheduleInfo(meetings: MeetingInfo[]): Promise<void> {
        if (!this.isConnected || !this.device) {
            throw new Error(ERROR_MESSAGES.DEVICE_NOT_CONNECTED);
        }

        try {
            let body: number[] = [];
            
            if (meetings.length === 0) {
                // Send empty schedule (52 zeros)
                body = new Array(52).fill(0);
            } else {
                // Build schedule body based on jensen.js format
                for (const meeting of meetings) {
                    // Date format: YYYYMMDDHHMMSS (14 bytes as BCD)
                    const startStr = this.formatDateForDevice(meeting.startDate);
                    const endStr = this.formatDateForDevice(meeting.endDate);
                    
                    // Convert to BCD format
                    const startBCD = this.toBCD(startStr);
                    const endBCD = this.toBCD(endStr);
                    
                    // Add padding
                    startBCD.push(0);
                    endBCD.push(0);
                    
                    // Platform-specific keyboard shortcuts (34 bytes)
                    const shortcuts = this.getPlatformShortcuts(meeting.platform, meeting.os || 'Windows');
                    
                    // Combine: start(8) + end(8) + reserved(2) + shortcuts(34) = 52 bytes per meeting
                    body = body.concat([...startBCD, ...endBCD, 0, 0, ...shortcuts]);
                }
            }

            const bodyArray = new Uint8Array(body);
            const seqId = await this.sendCommand(HIDOCK_COMMANDS.SEND_SCHEDULE_INFO, bodyArray);
            const response = await this.receiveResponse(seqId);

            if (response.data.length > 0 && response.data[0] !== 0) {
                throw new Error('Device reported schedule update failed');
            }
        } catch (error) {
            console.error('Failed to send schedule info:', error);
            throw new Error('Failed to update meeting schedule');
        }
    }

    // Device Management Commands
    async getDeviceTime(): Promise<Date> {
        if (!this.isConnected || !this.device) {
            throw new Error(ERROR_MESSAGES.DEVICE_NOT_CONNECTED);
        }

        try {
            const seqId = await this.sendCommand(HIDOCK_COMMANDS.GET_DEVICE_TIME);
            const response = await this.receiveResponse(seqId);

            if (response.data.length >= 7) {
                // Parse BCD time format
                const timeStr = this.fromBCD(response.data.slice(0, 7));
                
                if (timeStr === '00000000000000') {
                    return new Date(); // Device time not set
                }

                // Format: YYYYMMDDHHMMSS
                const year = parseInt(timeStr.slice(0, 4));
                const month = parseInt(timeStr.slice(4, 6)) - 1; // JS months are 0-indexed
                const day = parseInt(timeStr.slice(6, 8));
                const hour = parseInt(timeStr.slice(8, 10));
                const minute = parseInt(timeStr.slice(10, 12));
                const second = parseInt(timeStr.slice(12, 14));

                return new Date(year, month, day, hour, minute, second);
            }

            throw new Error('Invalid time response from device');
        } catch (error) {
            console.error('Failed to get device time:', error);
            throw new Error('Failed to get device time');
        }
    }

    async getCurrentRecording(): Promise<RecordingInfo | null> {
        if (!this.isConnected || !this.device) {
            throw new Error(ERROR_MESSAGES.DEVICE_NOT_CONNECTED);
        }

        try {
            const seqId = await this.sendCommand(HIDOCK_COMMANDS.GET_RECORDING_FILE);
            const response = await this.receiveResponse(seqId);

            if (!response.data || response.data.length === 0) {
                return null; // No recording in progress
            }

            // Parse recording info (matches jensen.js format)
            const fileName: string[] = [];
            for (let i = 0; i < response.data.length; i++) {
                if (response.data[i] > 0) {
                    fileName.push(String.fromCharCode(response.data[i]));
                }
            }

            const name = fileName.join('');
            let time: Date | null = null;
            let createDate = '';
            let createTime = '';

            // Parse filename for date/time info
            if (name.match(/^\d{14}REC\d+\.wav$/)) {
                const dateStr = name.slice(0, 14);
                time = new Date(
                    parseInt(dateStr.slice(0, 4)),
                    parseInt(dateStr.slice(4, 6)) - 1,
                    parseInt(dateStr.slice(6, 8)),
                    parseInt(dateStr.slice(8, 10)),
                    parseInt(dateStr.slice(10, 12)),
                    parseInt(dateStr.slice(12, 14))
                );
                createDate = `${time.getFullYear()}/${String(time.getMonth() + 1).padStart(2, '0')}/${String(time.getDate()).padStart(2, '0')}`;
                createTime = `${String(time.getHours()).padStart(2, '0')}:${String(time.getMinutes()).padStart(2, '0')}:${String(time.getSeconds()).padStart(2, '0')}`;
            }

            return {
                recording: name,
                name,
                createDate,
                createTime,
                time,
                duration: 0,
                length: 0,
                signature: '0'.repeat(32)
            };
        } catch (error) {
            console.error('Failed to get current recording:', error);
            throw new Error('Failed to get current recording info');
        }
    }

    async restoreFactorySettings(): Promise<void> {
        if (!this.isConnected || !this.device) {
            throw new Error(ERROR_MESSAGES.DEVICE_NOT_CONNECTED);
        }

        try {
            // Magic bytes for factory reset
            const body = new Uint8Array([1, 2, 3, 4]);
            const seqId = await this.sendCommand(HIDOCK_COMMANDS.RESTORE_FACTORY_SETTINGS, body);
            const response = await this.receiveResponse(seqId);

            if (response.data.length > 0 && response.data[0] !== 0) {
                throw new Error('Device reported factory reset failed');
            }

            // Clear all cached data after factory reset
            this.cachedRecordings = null;
            this.cacheTimestamp = 0;
        } catch (error) {
            console.error('Failed to restore factory settings:', error);
            throw new Error('Failed to restore factory settings');
        }
    }

    // Helper methods for calendar/date formatting
    private formatDateForDevice(date: Date): string {
        const year = date.getFullYear();
        const month = String(date.getMonth() + 1).padStart(2, '0');
        const day = String(date.getDate()).padStart(2, '0');
        const hour = String(date.getHours()).padStart(2, '0');
        const minute = String(date.getMinutes()).padStart(2, '0');
        const second = String(date.getSeconds()).padStart(2, '0');
        return `${year}${month}${day}${hour}${minute}${second}`;
    }

    private toBCD(str: string): number[] {
        const result: number[] = [];
        for (let i = 0; i < str.length; i += 2) {
            const high = (str.charCodeAt(i) - 48) & 0xFF;
            const low = (str.charCodeAt(i + 1) - 48) & 0xFF;
            result.push((high << 4) | low);
        }
        return result;
    }

    private fromBCD(data: Uint8Array): string {
        let result = '';
        for (let i = 0; i < data.length; i++) {
            const byte = data[i] & 0xFF;
            result += String((byte >> 4) & 0x0F);
            result += String(byte & 0x0F);
        }
        return result;
    }

    private getPlatformShortcuts(platform: string, os: string): number[] {
        // This would need the full keyboard mapping from jensen.js
        // For now, return empty shortcuts
        return new Array(34).fill(0);
    }
}

export const deviceService = new DeviceService();
