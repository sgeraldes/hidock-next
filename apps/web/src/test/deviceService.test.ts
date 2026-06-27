/**
 * Tests for WebUSB device service implementation
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { HIDOCK_COMMANDS, HIDOCK_DEVICE_CONFIG, HIDOCK_PRODUCT_IDS } from '../constants';
import { deviceService } from '../services/deviceService';

// Type for accessing internal device service properties in tests
interface TestableDeviceService {
    device: USBDevice | null;
    isConnected: boolean;
    sequenceId: number;
    receiveBuffer: Uint8Array;
    buildPacket: (commandId: number, bodyBytes: Uint8Array) => Uint8Array;
    sendCommand: (commandId: number, bodyBytes?: Uint8Array) => Promise<number>;
    parsePacket: () => unknown;
    updateProgress: (operationId: string, progress: unknown) => void;
}

// Mock WebUSB API
const mockUSBDevice = {
    vendorId: HIDOCK_DEVICE_CONFIG.VENDOR_ID,
    productId: HIDOCK_PRODUCT_IDS.H1E,
    productName: 'HiDock H1E',
    manufacturerName: 'HiDock',
    serialNumber: 'TEST123456',
    configuration: null,
    configurations: [],
    opened: false,

    open: vi.fn().mockResolvedValue(undefined),
    close: vi.fn().mockResolvedValue(undefined),
    selectConfiguration: vi.fn().mockResolvedValue(undefined),
    claimInterface: vi.fn().mockResolvedValue(undefined),
    releaseInterface: vi.fn().mockResolvedValue(undefined),
    transferIn: vi.fn(),
    transferOut: vi.fn(),
    clearHalt: vi.fn().mockResolvedValue(undefined),
};

const mockNavigatorUSB = {
    requestDevice: vi.fn().mockResolvedValue(mockUSBDevice),
    getDevices: vi.fn().mockResolvedValue([]),
};

// Tracks the sequence id of the most recently sent command so the default
// transferIn mock can echo a matching response (see beforeEach).
let lastSentSeqId = 0;

// Setup global mocks
beforeEach(() => {
    vi.clearAllMocks();
    lastSentSeqId = 0;

    // Mock navigator.usb
    Object.defineProperty(window.navigator, 'usb', {
        value: mockNavigatorUSB,
        writable: true,
    });

    // Reset device service state
    (deviceService as unknown as TestableDeviceService).device = null;
    (deviceService as unknown as TestableDeviceService).isConnected = false;
    (deviceService as unknown as TestableDeviceService).sequenceId = 0;
    (deviceService as unknown as TestableDeviceService).receiveBuffer = new Uint8Array(0);

    // Responsive default mock: echo back a valid Jensen response packet whose
    // sequence id matches the last command sent, so receiveResponse() resolves
    // immediately instead of spinning to its 5s/60s real-timer timeout (which made
    // the whole suite take minutes). Empty body — the connection parsers
    // (getDeviceInfo/getStorageInfo) tolerate it and fall back. Individual tests
    // that need specific payloads still override transferIn with mockImplementation.
    mockUSBDevice.transferOut.mockImplementation((...args: unknown[]) => {
        const data = args[1] as Uint8Array;
        const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
        lastSentSeqId = view.getUint32(4, false);
        return Promise.resolve({ status: 'ok', bytesWritten: data.byteLength });
    });
    mockUSBDevice.transferIn.mockImplementation(() => {
        const pkt = new Uint8Array(12);
        const v = new DataView(pkt.buffer);
        v.setUint8(0, 0x12);
        v.setUint8(1, 0x34);
        v.setUint16(2, 0, false); // command id echo (unused on this path)
        v.setUint32(4, lastSentSeqId, false); // match the awaited sequence id
        v.setUint32(8, 0, false); // zero-length body
        return Promise.resolve({ status: 'ok', data: new DataView(pkt.buffer) });
    });
});

describe('DeviceService WebUSB Implementation', () => {
    describe('Device Discovery and Connection', () => {
        it('should check WebUSB support', async () => {
            // Remove WebUSB support
            delete (navigator as any).usb;

            await expect(deviceService.requestDevice()).rejects.toThrow(
                'HiDock device not found. Please connect your device and try again.'
            );
        });

        it('should request device with correct filters', async () => {
            await deviceService.requestDevice();

            // requestDevice() offers every supported vendor×product combination —
            // assert the key models are present rather than pinning the exact list.
            expect(mockNavigatorUSB.requestDevice).toHaveBeenCalledTimes(1);
            const filters = mockNavigatorUSB.requestDevice.mock.calls[0][0].filters;
            expect(Array.isArray(filters)).toBe(true);
            expect(filters).toEqual(expect.arrayContaining([
                { vendorId: HIDOCK_DEVICE_CONFIG.VENDOR_ID, productId: HIDOCK_PRODUCT_IDS.H1 },
                { vendorId: HIDOCK_DEVICE_CONFIG.VENDOR_ID, productId: HIDOCK_PRODUCT_IDS.H1E },
                { vendorId: HIDOCK_DEVICE_CONFIG.VENDOR_ID, productId: HIDOCK_PRODUCT_IDS.P1 },
            ]));
        });

        it('should connect to device successfully', async () => {
            const device = await deviceService.requestDevice();

            expect(mockUSBDevice.open).toHaveBeenCalled();
            expect(mockUSBDevice.selectConfiguration).toHaveBeenCalledWith(1);
            expect(mockUSBDevice.claimInterface).toHaveBeenCalledWith(HIDOCK_DEVICE_CONFIG.INTERFACE_NUMBER);

            expect(device).toMatchObject({
                id: 'TEST123456',
                name: 'HiDock H1E',
                model: 'HiDock H1E',
                serialNumber: 'TEST123456',
                connected: true,
            });
        });

        it('should handle connection retry on failure', async () => {
            mockUSBDevice.open.mockRejectedValueOnce(new Error('Connection failed'));
            mockUSBDevice.open.mockResolvedValueOnce(undefined);

            const device = await deviceService.requestDevice();

            expect(mockUSBDevice.open).toHaveBeenCalledTimes(2);
            expect(device?.connected).toBe(true);
        });

        it('should disconnect properly', async () => {
            await deviceService.requestDevice();
            await deviceService.disconnect();

            expect(mockUSBDevice.releaseInterface).toHaveBeenCalledWith(HIDOCK_DEVICE_CONFIG.INTERFACE_NUMBER);
            expect(mockUSBDevice.close).toHaveBeenCalled();
            expect(deviceService.isDeviceConnected()).toBe(false);
        });
    });

    describe('Protocol Implementation', () => {
        beforeEach(async () => {
            // Setup connected device
            await deviceService.requestDevice();
        });

        it('should build packets correctly', () => {
            const commandId = HIDOCK_COMMANDS.GET_DEVICE_INFO;
            const bodyBytes = new Uint8Array([1, 2, 3, 4]);

            // Access private method for testing
            const packet = (deviceService as unknown as TestableDeviceService).buildPacket(commandId, bodyBytes);

            expect(packet.length).toBe(12 + bodyBytes.length);
            expect(packet[0]).toBe(0x12); // Sync byte 1
            expect(packet[1]).toBe(0x34); // Sync byte 2

            // Check command ID (big endian)
            const view = new DataView(packet.buffer);
            expect(view.getUint16(2, false)).toBe(commandId);

            // Check body length
            expect(view.getUint32(8, false)).toBe(bodyBytes.length);

            // Check body content
            expect(packet.slice(12)).toEqual(bodyBytes);
        });

        it('should send commands with proper USB transfer', async () => {
            mockUSBDevice.transferOut.mockResolvedValue({
                status: 'ok',
                bytesWritten: 12
            });

            const seqId = await (deviceService as unknown as TestableDeviceService).sendCommand(HIDOCK_COMMANDS.GET_DEVICE_INFO);

            expect(mockUSBDevice.transferOut).toHaveBeenCalledWith(
                HIDOCK_DEVICE_CONFIG.ENDPOINT_OUT,
                expect.any(Uint8Array)
            );
            expect(seqId).toBeGreaterThan(0);
        });

        it('should handle USB transfer errors', async () => {
            mockUSBDevice.transferOut.mockResolvedValue({
                status: 'stall',
                bytesWritten: 0
            });

            await expect(
                (deviceService as unknown as TestableDeviceService).sendCommand(HIDOCK_COMMANDS.GET_DEVICE_INFO)
            ).rejects.toThrow('Failed to send command to device');
        });

        it('should parse response packets correctly', () => {
            // Create a valid response packet
            const commandId = HIDOCK_COMMANDS.GET_DEVICE_INFO;
            const sequence = 123;
            const body = new Uint8Array([1, 2, 3, 4]);

            const packet = new Uint8Array(12 + body.length);
            const view = new DataView(packet.buffer);

            // Build response packet
            view.setUint8(0, 0x12); // Sync byte 1
            view.setUint8(1, 0x34); // Sync byte 2
            view.setUint16(2, commandId, false); // Command ID
            view.setUint32(4, sequence, false); // Sequence ID
            view.setUint32(8, body.length, false); // Body length
            packet.set(body, 12);

            // Set receive buffer and parse
            (deviceService as unknown as TestableDeviceService).receiveBuffer = packet;
            const parsed = (deviceService as unknown as TestableDeviceService).parsePacket();

            expect(parsed).toEqual({
                cmdId: commandId,
                seqId: sequence,
                data: body,
                isComplete: true
            });
        });

        it('should handle malformed packets gracefully', () => {
            // Set invalid data in receive buffer
            (deviceService as unknown as TestableDeviceService).receiveBuffer = new Uint8Array([0xFF, 0xFF, 0xFF]);

            const parsed = (deviceService as unknown as TestableDeviceService).parsePacket();
            expect(parsed).toBeNull();
        });
    });

    describe('File Operations', () => {
        beforeEach(async () => {
            // Setup proper device connection mock sequence
            let callCount = 0;

            // Mock the connection sequence: device info, storage info, then file list
            mockUSBDevice.transferIn.mockImplementation(() => {
                callCount++;

                if (callCount === 1) {
                    // Device info response - proper packet format
                    const deviceInfoBody = new Array(32).fill(0x00);
                    const deviceInfoResponse = new Uint8Array([
                        0x12, 0x34, // Sync bytes
                        0x00, 0x00, // Command ID: 0 (big endian)
                        0x00, 0x00, 0x00, 0x01, // Sequence: 1 (big endian)
                        0x02, 0x00, 0x00, 0x20, // Body length: 32 bytes with 2-byte checksum (big endian)
                        ...deviceInfoBody, // Device info data (32 bytes)
                        0x56, 0x78, // Checksum (2 bytes)
                    ]);
                    return Promise.resolve({
                        status: 'ok',
                        data: new DataView(deviceInfoResponse.buffer)
                    });
                } else if (callCount === 2) {
                    // Storage info response - proper packet format
                    const storageInfoResponse = new Uint8Array([
                        0x12, 0x34, // Sync bytes
                        0x00, 0x00, // Command ID: 0 (big endian)
                        0x00, 0x00, 0x00, 0x02, // Sequence: 2 (big endian)
                        0x02, 0x00, 0x00, 0x08, // Body length: 8 bytes with 2-byte checksum (big endian)
                        0x00, 0x10, 0x00, 0x00, // Total space: 1MB (big endian)
                        0x00, 0x08, 0x00, 0x00, // Free space: 512KB (big endian)
                        0x56, 0x78, // Checksum (2 bytes)
                    ]);
                    return Promise.resolve({
                        status: 'ok',
                        data: new DataView(storageInfoResponse.buffer)
                    });
                } else {
                    // File list response - proper packet format
                    const fileName = 'test.wav';
                    const fileNamePadded = fileName.padEnd(12, '\0');
                    const fileListBody = new Uint8Array([
                        0x00, 0x00, 0x00, 0x01, // Number of files: 1 (big endian)
                        0x02, // File version
                        0x0C, // Filename length (12 bytes)
                        ...new TextEncoder().encode(fileNamePadded), // Filename (12 bytes)
                        0x00, 0x00, 0x10, 0x00, // File size: 4096 bytes (big endian)
                        0x00, 0x00, 0x00, 0x00, 0x00, 0x00, // Skip 6 bytes
                        ...new Array(16).fill(0x00), // Signature (16 bytes)
                    ]);

                    const mockFileListResponse = new Uint8Array([
                        0x12, 0x34, // Sync bytes
                        0x00, 0x00, // Command ID: 0 (big endian)
                        0x00, 0x00, 0x00, 0x03, // Sequence: 3 (big endian)
                        0x02, 0x00, 0x00, fileListBody.length, // Body length with 2-byte checksum (big endian)
                        ...fileListBody, // File list data
                        0x56, 0x78, // Checksum (2 bytes)
                    ]);
                    return Promise.resolve({
                        status: 'ok',
                        data: new DataView(mockFileListResponse.buffer)
                    });
                }
            });
            // transferOut keeps the outer beforeEach's implementation, which records
            // lastSentSeqId so the getRecordings test can echo matching responses.

            await deviceService.requestDevice();
        });

        it('should get recordings list', async () => {
            // Set up specific mock for getRecordings call (sequence should be 4 after connection setup)
            let _getRecordingsCallCount = 0;
            mockUSBDevice.transferIn.mockImplementation(() => {
                _getRecordingsCallCount++;

                // File list response - proper format expected by parseFileListResponse
                const fileName = 'test.wav';
                const fileNameBytes = new TextEncoder().encode(fileName);

                const fileListBody = new Uint8Array([
                    // Optional header with file count
                    0xFF, 0xFF, // Header prefix
                    0x00, 0x00, 0x00, 0x01, // Number of files: 1 (big endian)

                    // File entry
                    0x02, // File version
                    0x00, 0x00, fileNameBytes.length, // Filename length (3 bytes, big endian)
                    ...fileNameBytes, // Filename
                    0x00, 0x00, 0x10, 0x00, // File size: 4096 bytes (big endian)
                    0x00, 0x00, 0x00, 0x00, 0x00, 0x00, // Skip 6 bytes
                    ...new Array(16).fill(0x00), // Signature (16 bytes)
                ]);

                // Respond to whatever command was just sent (getRecordings issues
                // getFileCount then GET_FILE_LIST). Match the live sequence id so the
                // non-streaming getFileCount resolves; cmd id 4 also matches the
                // GET_FILE_LIST streaming read.
                const mockFileListResponse = new Uint8Array(12 + fileListBody.length + 2);
                const respView = new DataView(mockFileListResponse.buffer);
                respView.setUint8(0, 0x12);
                respView.setUint8(1, 0x34);
                respView.setUint16(2, HIDOCK_COMMANDS.GET_FILE_LIST, false);
                respView.setUint32(4, lastSentSeqId, false);
                respView.setUint32(8, (0x02 << 24) | fileListBody.length, false); // 2-byte checksum + body length
                mockFileListResponse.set(fileListBody, 12);
                mockFileListResponse[12 + fileListBody.length] = 0x56;
                mockFileListResponse[12 + fileListBody.length + 1] = 0x78;

                return Promise.resolve({
                    status: 'ok',
                    data: new DataView(mockFileListResponse.buffer)
                });
            });

            const recordings = await deviceService.getRecordings();

            expect(recordings).toHaveLength(1);
            expect(recordings[0]).toMatchObject({
                fileName: 'test.wav',
                size: 4096,
                status: 'on_device'
            });
        });

        it('should download recordings with progress tracking', async () => {
            // Mock successful download with proper response sequence
            const fileData = new Uint8Array([1, 2, 3, 4, 5]);
            let downloadCallCount = 0;

            // Reset mock for this specific test
            mockUSBDevice.transferIn.mockImplementation(() => {
                downloadCallCount++;

                if (downloadCallCount === 1) {
                    // Download start response with proper packet format
                    const downloadStartResponse = new Uint8Array([
                        0x12, 0x34, // Sync bytes
                        0x00, 0x00, // Command ID: 0 (big endian)
                        0x00, 0x00, 0x00, 0x04, // Sequence: 4 (big endian)
                        0x02, 0x00, 0x00, fileData.length, // Body length with 2-byte checksum (big endian)
                        ...fileData, // File data
                        0x56, 0x78, // Checksum (2 bytes)
                    ]);
                    return Promise.resolve({
                        status: 'ok',
                        data: new DataView(downloadStartResponse.buffer)
                    });
                } else {
                    // No more data
                    return Promise.resolve({
                        status: 'ok',
                        data: new DataView(new ArrayBuffer(0))
                    });
                }
            });

            mockUSBDevice.transferOut.mockResolvedValue({ status: 'ok', bytesWritten: 12 });

            // Mock getRecordings to return a test recording
            vi.spyOn(deviceService, 'getRecordings').mockResolvedValue([
                {
                    id: 'test-recording',
                    fileName: 'test.wav',
                    size: fileData.length,
                    duration: 10,
                    dateCreated: new Date(),
                    status: 'on_device'
                }
            ]);

            const progressCallback = vi.fn((progress) => {
                console.log('Progress:', progress);
            });
            const result = await deviceService.downloadRecording('test-recording', progressCallback);

            expect(result).toBeInstanceOf(ArrayBuffer);
            expect(progressCallback).toHaveBeenCalled();
        }, 10000); // Increase timeout to 10 seconds
    });

    describe('Error Handling and Statistics', () => {
        beforeEach(async () => {
            await deviceService.requestDevice();
        });

        it('should track connection statistics', () => {
            const stats = deviceService.getConnectionStats();

            expect(stats).toHaveProperty('isConnected');
            expect(stats).toHaveProperty('retryCount');
            expect(stats).toHaveProperty('errorCounts');
            expect(stats).toHaveProperty('operationStats');
            expect(stats).toHaveProperty('deviceInfo');
        });

        it('should increment error counts on failures', async () => {
            mockUSBDevice.transferOut.mockRejectedValue(new DOMException('Network error', 'NetworkError'));

            try {
                await (deviceService as unknown as TestableDeviceService).sendCommand(HIDOCK_COMMANDS.GET_DEVICE_INFO);
            } catch (_error) {
                // Expected to fail
            }

            const stats = deviceService.getConnectionStats();
            expect(stats.errorCounts.usbTimeout).toBeGreaterThan(0);
        });

        it('should test connection health', async () => {
            // Mock successful file count response
            mockUSBDevice.transferOut.mockResolvedValue({ status: 'ok', bytesWritten: 12 });
            mockUSBDevice.transferIn.mockResolvedValue({
                status: 'ok',
                data: { buffer: new Uint8Array([0, 0, 0, 5]).buffer } // 5 files
            });

            const isHealthy = await deviceService.testConnection();
            expect(isHealthy).toBe(true);
        });

        it('should handle progress callbacks', () => {
            const progressCallback = vi.fn();

            deviceService.onProgress('test-operation', progressCallback);
            (deviceService as unknown as TestableDeviceService).updateProgress('test-operation', {
                operation: 'Test',
                progress: 50,
                total: 100,
                status: 'in_progress'
            });

            expect(progressCallback).toHaveBeenCalledWith({
                operation: 'Test',
                progress: 50,
                total: 100,
                status: 'in_progress'
            });

            deviceService.removeProgressListener('test-operation');
        });
    });

    describe('Device Capabilities', () => {
        it('should return correct capabilities for different models', async () => {
            mockUSBDevice.productId = HIDOCK_PRODUCT_IDS.H1E;
            await deviceService.requestDevice();

            const capabilities = await deviceService.getDeviceCapabilities();

            expect(capabilities).toContain('file_list');
            expect(capabilities).toContain('file_download');
            expect(capabilities).toContain('file_delete');
            expect(capabilities).toContain('time_sync');
            expect(capabilities).toContain('format_storage');
            expect(capabilities).toContain('settings_management');
        });
    });
});
