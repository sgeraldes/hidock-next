/**
 * Web Device Adapter - Implements the unified device interface for WebUSB
 * 
 * This adapter wraps the existing deviceService to implement the unified
 * IDeviceInterface, providing consistent API across platforms.
 */

import { HIDOCK_DEVICE_CONFIG, HIDOCK_PRODUCT_IDS } from '../constants';
import {
    AudioRecording,
    ConnectionStats,
    DeviceCapability,
    DeviceHealth,
    DeviceInfo,
    DeviceModel,
    IDeviceInterface,
    OperationProgress,
    OperationStatus,
    ProgressCallback,
    StorageInfo,
    detectDeviceModel,
    getModelCapabilities
} from '../interfaces/deviceInterface';
import { deviceService } from '../services/deviceService';

/**
 * WebUSB implementation of the unified device interface
 */
export class WebDeviceAdapter implements IDeviceInterface {
    private progressCallbacks: Map<string, ProgressCallback> = new Map();

    async discoverDevices(): Promise<DeviceInfo[]> {
        try {
            // WebUSB doesn't have a discovery API, but we can check for previously authorized devices
            if (!navigator.usb) {
                return [];
            }

            const devices = await navigator.usb.getDevices();
            const hidockDevices: DeviceInfo[] = [];

            for (const device of devices) {
                if (device.vendorId === HIDOCK_DEVICE_CONFIG.VENDOR_ID) {
                    const model = detectDeviceModel(device.vendorId, device.productId);

                    hidockDevices.push({
                        id: device.serialNumber || `${device.vendorId}-${device.productId}`,
                        name: device.productName || `HiDock Device`,
                        model,
                        serialNumber: device.serialNumber || 'Unknown',
                        firmwareVersion: '1.0.0', // Would need to be queried from device
                        vendorId: device.vendorId,
                        productId: device.productId,
                        connected: false, // We'd need to check actual connection status
                        lastSeen: new Date()
                    });
                }
            }

            return hidockDevices;
        } catch (error) {
            console.error('Failed to discover devices:', error);
            return [];
        }
    }

    async connect(deviceId?: string, autoRetry = true): Promise<DeviceInfo> {
        try {
            let hidockDevice;

            if (deviceId) {
                // Try to connect to specific device (not directly supported by current service)
                // For now, we'll use the general connection method
                hidockDevice = await deviceService.requestDevice();
            } else {
                hidockDevice = await deviceService.requestDevice();
            }

            // Convert to unified DeviceInfo format
            const model = detectDeviceModel(HIDOCK_DEVICE_CONFIG.VENDOR_ID, hidockDevice.storageInfo ? 0xAF0D : 0xAF0C);

            return {
                id: hidockDevice.id,
                name: hidockDevice.name,
                model,
                serialNumber: hidockDevice.serialNumber,
                firmwareVersion: hidockDevice.firmwareVersion,
                vendorId: HIDOCK_DEVICE_CONFIG.VENDOR_ID,
                productId: model === DeviceModel.H1 ? HIDOCK_PRODUCT_IDS.H1 :
                    model === DeviceModel.H1E ? HIDOCK_PRODUCT_IDS.H1E :
                        model === DeviceModel.P1 ? HIDOCK_PRODUCT_IDS.P1 : HIDOCK_PRODUCT_IDS.DEFAULT,
                connected: hidockDevice.connected,
                connectionTime: new Date()
            };
        } catch (error) {
            throw new Error(`Connection failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
        }
    }

    async disconnect(): Promise<void> {
        await deviceService.disconnect();
    }

    isConnected(): boolean {
        return deviceService.isDeviceConnected();
    }

    async getDeviceInfo(): Promise<DeviceInfo> {
        if (!this.isConnected()) {
            throw new Error('No device connected');
        }

        const stats = deviceService.getConnectionStats();
        const model = detectDeviceModel(HIDOCK_DEVICE_CONFIG.VENDOR_ID, stats.deviceInfo?.productId || 0);

        return {
            id: stats.deviceInfo?.serialNumber || 'unknown',
            name: stats.deviceInfo?.productName || 'HiDock Device',
            model,
            serialNumber: stats.deviceInfo?.serialNumber || 'Unknown',
            firmwareVersion: '1.0.0', // Would need to be queried from device
            vendorId: stats.deviceInfo?.vendorId || HIDOCK_DEVICE_CONFIG.VENDOR_ID,
            productId: stats.deviceInfo?.productId || 0,
            connected: stats.isConnected,
            connectionTime: new Date(stats.operationStats.connectionTime)
        };
    }

    async getStorageInfo(): Promise<StorageInfo> {
        if (!this.isConnected()) {
            throw new Error('No device connected');
        }

        // The deviceService doesn't have a direct getStorageInfo method,
        // but we can get it through other means or extend the service
        try {
            // This would need to be implemented in the deviceService
            // For now, we'll return mock data or try to get it another way
            const recordings = await deviceService.getRecordings();
            const totalSize = recordings.reduce((sum, rec) => sum + rec.size, 0);

            return {
                totalCapacity: 8 * 1024 * 1024 * 1024, // 8GB default
                usedSpace: totalSize,
                freeSpace: (8 * 1024 * 1024 * 1024) - totalSize,
                fileCount: recordings.length,
                healthStatus: 'good',
                lastUpdated: new Date()
            };
        } catch (error) {
            throw new Error(`Failed to get storage info: ${error instanceof Error ? error.message : 'Unknown error'}`);
        }
    }

    async getRecordings(): Promise<AudioRecording[]> {
        if (!this.isConnected()) {
            throw new Error('No device connected');
        }

        try {
            const recordings = await deviceService.getRecordings();

            return recordings.map(rec => ({
                id: rec.id,
                filename: rec.fileName,
                size: rec.size,
                duration: rec.duration,
                dateCreated: rec.dateCreated,
                formatVersion: 2, // Default version
                checksum: undefined,
                localPath: rec.localPath
            }));
        } catch (error) {
            throw new Error(`Failed to get recordings: ${error instanceof Error ? error.message : 'Unknown error'}`);
        }
    }

    async downloadRecording(recordingId: string, progressCallback?: ProgressCallback): Promise<ArrayBuffer> {
        if (!this.isConnected()) {
            throw new Error('No device connected');
        }

        try {
            // Set up progress tracking
            if (progressCallback) {
                this.addProgressListener(`download_${recordingId}`, progressCallback);

                // Set up the deviceService progress callback
                deviceService.onProgress(`download_${recordingId}`, (progress) => {
                    const unifiedProgress: OperationProgress = {
                        operationId: `download_${recordingId}`,
                        operationName: progress.operation,
                        progress: progress.progress / 100, // Convert to 0-1 range
                        status: this.mapProgressStatus(progress.status),
                        message: progress.message,
                        bytesProcessed: 0, // Would need to be calculated
                        totalBytes: 0,     // Would need to be calculated
                        startTime: new Date()
                    };

                    progressCallback(unifiedProgress);
                });
            }

            const result = await deviceService.downloadRecording(recordingId, progressCallback ?
                (progress) => {
                    const unifiedProgress: OperationProgress = {
                        operationId: `download_${recordingId}`,
                        operationName: progress.operation,
                        progress: progress.progress / 100,
                        status: this.mapProgressStatus(progress.status),
                        message: progress.message,
                        startTime: new Date()
                    };
                    progressCallback(unifiedProgress);
                } : undefined
            );

            return result;
        } catch (error) {
            throw new Error(`Download failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
        } finally {
            this.removeProgressListener(`download_${recordingId}`);
        }
    }

    async deleteRecording(recordingId: string, progressCallback?: ProgressCallback): Promise<void> {
        if (!this.isConnected()) {
            throw new Error('No device connected');
        }

        try {
            if (progressCallback) {
                this.addProgressListener(`delete_${recordingId}`, progressCallback);
            }

            await deviceService.deleteRecording(recordingId, progressCallback ?
                (progress) => {
                    const unifiedProgress: OperationProgress = {
                        operationId: `delete_${recordingId}`,
                        operationName: progress.operation,
                        progress: progress.progress / 100,
                        status: this.mapProgressStatus(progress.status),
                        message: progress.message,
                        startTime: new Date()
                    };
                    progressCallback(unifiedProgress);
                } : undefined
            );
        } catch (error) {
            throw new Error(`Delete failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
        } finally {
            this.removeProgressListener(`delete_${recordingId}`);
        }
    }

    async formatStorage(progressCallback?: ProgressCallback): Promise<void> {
        if (!this.isConnected()) {
            throw new Error('No device connected');
        }

        try {
            if (progressCallback) {
                this.addProgressListener('format_device', progressCallback);
            }

            await deviceService.formatDevice(progressCallback ?
                (progress) => {
                    const unifiedProgress: OperationProgress = {
                        operationId: 'format_device',
                        operationName: progress.operation,
                        progress: progress.progress / 100,
                        status: this.mapProgressStatus(progress.status),
                        message: progress.message,
                        startTime: new Date()
                    };
                    progressCallback(unifiedProgress);
                } : undefined
            );
        } catch (error) {
            throw new Error(`Format failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
        } finally {
            this.removeProgressListener('format_device');
        }
    }

    async syncTime(targetTime?: Date): Promise<void> {
        if (!this.isConnected()) {
            throw new Error('No device connected');
        }

        try {
            await deviceService.syncTime();
        } catch (error) {
            throw new Error(`Time sync failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
        }
    }

    getCapabilities(): DeviceCapability[] {
        if (!this.isConnected()) {
            return [];
        }

        const stats = deviceService.getConnectionStats();
        const model = detectDeviceModel(HIDOCK_DEVICE_CONFIG.VENDOR_ID, stats.deviceInfo?.productId || 0);

        return getModelCapabilities(model);
    }

    getConnectionStats(): ConnectionStats {
        const stats = deviceService.getConnectionStats();

        return {
            connectionAttempts: stats.retryCount + 1,
            successfulConnections: stats.isConnected ? 1 : 0,
            failedConnections: stats.retryCount,
            totalOperations: stats.operationStats.commandsSent,
            successfulOperations: stats.operationStats.responsesReceived,
            failedOperations: stats.operationStats.commandsSent - stats.operationStats.responsesReceived,
            bytesTransferred: stats.operationStats.bytesTransferred,
            averageOperationTime: stats.operationStats.lastOperationTime,
            uptime: stats.operationStats.connectionTime ? Date.now() - stats.operationStats.connectionTime : 0,
            errorCounts: stats.errorCounts
        };
    }

    async getDeviceHealth(): Promise<DeviceHealth> {
        if (!this.isConnected()) {
            throw new Error('No device connected');
        }

        const stats = this.getConnectionStats();
        const connectionQuality = this.calculateConnectionQuality(stats);
        const errorRate = stats.totalOperations > 0 ? stats.failedOperations / stats.totalOperations : 0;

        let overallStatus: 'healthy' | 'warning' | 'error' = 'healthy';
        if (errorRate > 0.1) {
            overallStatus = 'error';
        } else if (errorRate > 0.05 || connectionQuality < 0.8) {
            overallStatus = 'warning';
        }

        return {
            overallStatus,
            connectionQuality,
            errorRate,
            lastSuccessfulOperation: new Date(), // Would need to track this
            temperature: undefined, // Not available via WebUSB
            batteryLevel: undefined, // Not available via WebUSB
            storageHealth: 'good', // Would need to be determined
            firmwareStatus: 'up_to_date' // Would need to be determined
        };
    }

    addProgressListener(operationId: string, callback: ProgressCallback): void {
        this.progressCallbacks.set(operationId, callback);
    }

    removeProgressListener(operationId: string): void {
        this.progressCallbacks.delete(operationId);
        deviceService.removeProgressListener(operationId);
    }

    async testConnection(): Promise<boolean> {
        try {
            return await deviceService.testConnection();
        } catch (error) {
            return false;
        }
    }

    private mapProgressStatus(status: string): OperationStatus {
        switch (status) {
            case 'pending':
                return OperationStatus.PENDING;
            case 'in_progress':
                return OperationStatus.IN_PROGRESS;
            case 'completed':
                return OperationStatus.COMPLETED;
            case 'error':
                return OperationStatus.ERROR;
            default:
                return OperationStatus.PENDING;
        }
    }

    private calculateConnectionQuality(stats: ConnectionStats): number {
        if (stats.totalOperations === 0) return 1.0;

        const successRate = stats.successfulOperations / stats.totalOperations;
        const connectionSuccessRate = stats.successfulConnections / Math.max(stats.connectionAttempts, 1);
        const avgTimeScore = Math.max(0, 1 - (stats.averageOperationTime / 10000)); // Normalize to 10s max

        return (successRate * 0.5 + connectionSuccessRate * 0.3 + avgTimeScore * 0.2);
    }
}

// Export singleton instance
export const webDeviceAdapter = new WebDeviceAdapter();