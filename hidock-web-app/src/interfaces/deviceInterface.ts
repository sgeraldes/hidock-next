/**
 * Unified Device Interface Abstraction for HiDock Community Platform (Web)
 * 
 * This module provides a common interface for device operations in the web application,
 * enabling consistent device management, model detection, capability reporting,
 * storage monitoring, and health diagnostics.
 */

export enum DeviceModel {
    H1 = 'hidock-h1',
    H1E = 'hidock-h1e',
    P1 = 'hidock-p1',
    UNKNOWN = 'unknown'
}

export enum DeviceCapability {
    FILE_LIST = 'file_list',
    FILE_DOWNLOAD = 'file_download',
    FILE_DELETE = 'file_delete',
    FILE_UPLOAD = 'file_upload',
    TIME_SYNC = 'time_sync',
    FORMAT_STORAGE = 'format_storage',
    SETTINGS_MANAGEMENT = 'settings_management',
    HEALTH_MONITORING = 'health_monitoring',
    REAL_TIME_RECORDING = 'real_time_recording',
    AUDIO_PLAYBACK = 'audio_playback'
}

export enum ConnectionStatus {
    DISCONNECTED = 'disconnected',
    CONNECTING = 'connecting',
    CONNECTED = 'connected',
    ERROR = 'error',
    RECONNECTING = 'reconnecting'
}

export enum OperationStatus {
    PENDING = 'pending',
    IN_PROGRESS = 'in_progress',
    COMPLETED = 'completed',
    ERROR = 'error',
    CANCELLED = 'cancelled'
}

export interface DeviceInfo {
    id: string;
    name: string;
    model: DeviceModel;
    serialNumber: string;
    firmwareVersion: string;
    vendorId: number;
    productId: number;
    connected: boolean;
    connectionTime?: Date;
    lastSeen?: Date;
}

export interface StorageInfo {
    totalCapacity: number; // bytes
    usedSpace: number;     // bytes
    freeSpace: number;     // bytes
    fileCount: number;
    healthStatus?: string;
    lastUpdated?: Date;
}

export interface AudioRecording {
    id: string;
    filename: string;
    size: number;
    duration: number;
    dateCreated: Date;
    formatVersion: number;
    checksum?: string;
    localPath?: string;
}

export interface OperationProgress {
    operationId: string;
    operationName: string;
    progress: number; // 0.0 to 1.0
    status: OperationStatus;
    message?: string;
    bytesProcessed?: number;
    totalBytes?: number;
    startTime?: Date;
    estimatedCompletion?: Date;
}

export interface DeviceHealth {
    overallStatus: 'healthy' | 'warning' | 'error';
    connectionQuality: number; // 0.0 to 1.0
    errorRate: number; // errors per operation
    lastSuccessfulOperation?: Date;
    temperature?: number;
    batteryLevel?: number;
    storageHealth?: string;
    firmwareStatus?: string;
}

export interface ConnectionStats {
    connectionAttempts: number;
    successfulConnections: number;
    failedConnections: number;
    totalOperations: number;
    successfulOperations: number;
    failedOperations: number;
    bytesTransferred: number;
    averageOperationTime: number;
    uptime: number;
    errorCounts: Record<string, number>;
}

export type ProgressCallback = (progress: OperationProgress) => void;
export type HealthCallback = (health: DeviceHealth) => void;

/**
 * Abstract interface for HiDock device operations.
 * 
 * This interface defines the common operations that must be implemented
 * by device services to ensure consistent behavior across platforms.
 */
export interface IDeviceInterface {
    /**
     * Discover available HiDock devices.
     */
    discoverDevices(): Promise<DeviceInfo[]>;

    /**
     * Connect to a HiDock device.
     */
    connect(deviceId?: string, autoRetry?: boolean): Promise<DeviceInfo>;

    /**
     * Disconnect from the current device.
     */
    disconnect(): Promise<void>;

    /**
     * Check if a device is currently connected.
     */
    isConnected(): boolean;

    /**
     * Get detailed information about the connected device.
     */
    getDeviceInfo(): Promise<DeviceInfo>;

    /**
     * Get storage information from the device.
     */
    getStorageInfo(): Promise<StorageInfo>;

    /**
     * Get list of audio recordings on the device.
     */
    getRecordings(): Promise<AudioRecording[]>;

    /**
     * Download an audio recording from the device.
     */
    downloadRecording(recordingId: string, progressCallback?: ProgressCallback): Promise<ArrayBuffer>;

    /**
     * Delete an audio recording from the device.
     */
    deleteRecording(recordingId: string, progressCallback?: ProgressCallback): Promise<void>;

    /**
     * Format the device storage.
     */
    formatStorage(progressCallback?: ProgressCallback): Promise<void>;

    /**
     * Synchronize device time.
     */
    syncTime(targetTime?: Date): Promise<void>;

    /**
     * Get list of capabilities supported by the connected device.
     */
    getCapabilities(): DeviceCapability[];

    /**
     * Get connection statistics and performance metrics.
     */
    getConnectionStats(): ConnectionStats;

    /**
     * Get device health information.
     */
    getDeviceHealth(): Promise<DeviceHealth>;

    /**
     * Add a progress listener for device operations.
     */
    addProgressListener(operationId: string, callback: ProgressCallback): void;

    /**
     * Remove a progress listener.
     */
    removeProgressListener(operationId: string): void;

    /**
     * Test the current device connection.
     */
    testConnection(): Promise<boolean>;
}

/**
 * Device manager that provides unified access to device operations
 * with automatic model detection and capability management.
 */
export class DeviceManager {
    private deviceInterface: IDeviceInterface;
    private currentDevice: DeviceInfo | null = null;
    private capabilities: DeviceCapability[] = [];
    private healthMonitorActive = false;
    private healthMonitorInterval: number | null = null;
    private healthCheckInterval = 30000; // 30 seconds
    private healthCallbacks: HealthCallback[] = [];

    constructor(deviceInterface: IDeviceInterface) {
        this.deviceInterface = deviceInterface;
    }

    async initialize(): Promise<void> {
        // Initialize the device manager
    }

    async connectToDevice(deviceId?: string, autoRetry = true): Promise<DeviceInfo> {
        const deviceInfo = await this.deviceInterface.connect(deviceId, autoRetry);
        this.currentDevice = deviceInfo;
        this.capabilities = this.deviceInterface.getCapabilities();

        // Start health monitoring if supported
        if (this.capabilities.includes(DeviceCapability.HEALTH_MONITORING)) {
            this.startHealthMonitoring();
        }

        return deviceInfo;
    }

    async disconnectDevice(): Promise<void> {
        if (this.healthMonitorActive) {
            this.stopHealthMonitoring();
        }

        await this.deviceInterface.disconnect();
        this.currentDevice = null;
        this.capabilities = [];
    }

    getCurrentDevice(): DeviceInfo | null {
        return this.currentDevice;
    }

    getDeviceCapabilities(): DeviceCapability[] {
        return [...this.capabilities];
    }

    hasCapability(capability: DeviceCapability): boolean {
        return this.capabilities.includes(capability);
    }

    async getDeviceModelInfo(): Promise<Record<string, any>> {
        if (!this.currentDevice) {
            throw new Error('No device connected');
        }

        return {
            model: this.currentDevice.model,
            capabilities: this.capabilities,
            specifications: this.getModelSpecifications(this.currentDevice.model),
            recommendedSettings: this.getRecommendedSettings(this.currentDevice.model)
        };
    }

    private getModelSpecifications(model: DeviceModel): Record<string, any> {
        const specs: Record<DeviceModel, Record<string, any>> = {
            [DeviceModel.H1]: {
                maxStorage: '8GB',
                audioFormat: 'WAV/HDA',
                sampleRate: '48kHz',
                bitDepth: '16-bit',
                channels: 'Mono',
                batteryLife: '20 hours',
                connectivity: 'USB 2.0'
            },
            [DeviceModel.H1E]: {
                maxStorage: '16GB',
                audioFormat: 'WAV/HDA',
                sampleRate: '48kHz',
                bitDepth: '16-bit',
                channels: 'Mono',
                batteryLife: '24 hours',
                connectivity: 'USB 2.0',
                features: ['Auto-record', 'Bluetooth']
            },
            [DeviceModel.P1]: {
                maxStorage: '32GB',
                audioFormat: 'WAV/HDA/MP3',
                sampleRate: '48kHz',
                bitDepth: '24-bit',
                channels: 'Stereo',
                batteryLife: '30 hours',
                connectivity: 'USB-C',
                features: ['Auto-record', 'Bluetooth', 'Noise cancellation']
            },
            [DeviceModel.UNKNOWN]: {}
        };

        return specs[model] || {};
    }

    private getRecommendedSettings(model: DeviceModel): Record<string, any> {
        const settings: Record<DeviceModel, Record<string, any>> = {
            [DeviceModel.H1]: {
                autoRecord: false,
                audioQuality: 'standard',
                powerSaving: true
            },
            [DeviceModel.H1E]: {
                autoRecord: true,
                audioQuality: 'high',
                bluetoothEnabled: true,
                powerSaving: false
            },
            [DeviceModel.P1]: {
                autoRecord: true,
                audioQuality: 'premium',
                noiseCancellation: true,
                bluetoothEnabled: true,
                powerSaving: false
            },
            [DeviceModel.UNKNOWN]: {}
        };

        return settings[model] || {};
    }

    private startHealthMonitoring(): void {
        if (this.healthMonitorActive) {
            return;
        }

        this.healthMonitorActive = true;
        this.healthMonitorInterval = window.setInterval(async () => {
            try {
                const health = await this.deviceInterface.getDeviceHealth();

                for (const callback of this.healthCallbacks) {
                    try {
                        callback(health);
                    } catch (error) {
                        console.error('Health callback error:', error);
                    }
                }
            } catch (error) {
                console.error('Health monitoring error:', error);
            }
        }, this.healthCheckInterval);
    }

    private stopHealthMonitoring(): void {
        this.healthMonitorActive = false;
        if (this.healthMonitorInterval) {
            clearInterval(this.healthMonitorInterval);
            this.healthMonitorInterval = null;
        }
    }

    addHealthCallback(callback: HealthCallback): void {
        this.healthCallbacks.push(callback);
    }

    removeHealthCallback(callback: HealthCallback): void {
        const index = this.healthCallbacks.indexOf(callback);
        if (index > -1) {
            this.healthCallbacks.splice(index, 1);
        }
    }

    async performDiagnostics(): Promise<Record<string, any>> {
        if (!this.currentDevice) {
            throw new Error('No device connected');
        }

        const diagnostics: Record<string, any> = {
            timestamp: new Date(),
            deviceInfo: this.currentDevice,
            connectionTest: await this.deviceInterface.testConnection(),
            storageInfo: await this.deviceInterface.getStorageInfo(),
            connectionStats: this.deviceInterface.getConnectionStats()
        };

        if (this.hasCapability(DeviceCapability.HEALTH_MONITORING)) {
            diagnostics.healthStatus = await this.deviceInterface.getDeviceHealth();
        }

        return diagnostics;
    }

    getStorageRecommendations(storageInfo: StorageInfo): string[] {
        const recommendations: string[] = [];
        const usagePercent = (storageInfo.usedSpace / storageInfo.totalCapacity) * 100;

        if (usagePercent > 90) {
            recommendations.push('Storage is critically full. Delete old recordings.');
        } else if (usagePercent > 75) {
            recommendations.push('Storage is getting full. Consider backing up recordings.');
        } else if (usagePercent > 50) {
            recommendations.push('Storage is half full. Regular cleanup recommended.');
        }

        if (storageInfo.fileCount > 1000) {
            recommendations.push('Large number of files detected. Consider organizing recordings.');
        }

        if (storageInfo.healthStatus && storageInfo.healthStatus !== 'good') {
            recommendations.push(`Storage health issue detected: ${storageInfo.healthStatus}`);
        }

        return recommendations;
    }
}

/**
 * Utility functions for device model detection
 */
export function detectDeviceModel(vendorId: number, productId: number): DeviceModel {
    const modelMap: Record<number, DeviceModel> = {
        0xAF0C: DeviceModel.H1,
        0xAF0D: DeviceModel.H1E,
        0xAF0E: DeviceModel.P1
    };

    return modelMap[productId] || DeviceModel.UNKNOWN;
}

export function getModelCapabilities(model: DeviceModel): DeviceCapability[] {
    const baseCapabilities = [
        DeviceCapability.FILE_LIST,
        DeviceCapability.FILE_DOWNLOAD,
        DeviceCapability.FILE_DELETE,
        DeviceCapability.TIME_SYNC
    ];

    const modelSpecific: Record<DeviceModel, DeviceCapability[]> = {
        [DeviceModel.H1]: [
            DeviceCapability.FORMAT_STORAGE
        ],
        [DeviceModel.H1E]: [
            DeviceCapability.FORMAT_STORAGE,
            DeviceCapability.SETTINGS_MANAGEMENT,
            DeviceCapability.HEALTH_MONITORING
        ],
        [DeviceModel.P1]: [
            DeviceCapability.FORMAT_STORAGE,
            DeviceCapability.SETTINGS_MANAGEMENT,
            DeviceCapability.HEALTH_MONITORING,
            DeviceCapability.REAL_TIME_RECORDING,
            DeviceCapability.AUDIO_PLAYBACK
        ],
        [DeviceModel.UNKNOWN]: []
    };

    return [...baseCapabilities, ...(modelSpecific[model] || [])];
}

/**
 * Format bytes to human readable string
 */
export function formatBytes(bytes: number): string {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

/**
 * Format duration to human readable string
 */
export function formatDuration(seconds: number): string {
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const secs = Math.floor(seconds % 60);

    if (hours > 0) {
        return `${hours}:${minutes.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
    }
    return `${minutes}:${secs.toString().padStart(2, '0')}`;
}

/**
 * Calculate connection quality score based on statistics
 */
export function calculateConnectionQuality(stats: ConnectionStats): number {
    if (stats.totalOperations === 0) return 1.0;

    const successRate = stats.successfulOperations / stats.totalOperations;
    const connectionSuccessRate = stats.successfulConnections / Math.max(stats.connectionAttempts, 1);
    const avgTimeScore = Math.max(0, 1 - (stats.averageOperationTime / 10000)); // Normalize to 10s max

    return (successRate * 0.5 + connectionSuccessRate * 0.3 + avgTimeScore * 0.2);
}