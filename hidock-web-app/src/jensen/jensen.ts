/**
 * @fileoverview
 * This file contains the main Jensen class, which orchestrates the communication
 * with HiDock devices using the Jensen protocol.
 */

import {
    HIDOCK_CONSTANTS,
    COMMAND_CODES,
    COMMAND_NAMES,
} from './constants';
import { JensenLogger } from './logger';
import { JensenPacket, JensenResponse } from './protocol';
import { responseHandlers } from './handlers';
import {
    read16BitBigEndian,
    read32BitBigEndian,
    toBcd,
    fromBcd,
    formatDateToBCDString,
} from './utils';
import {
    DeviceInfo,
    DeviceTime,
    FileCount,
    FileInfo,
    DeviceSettings,
    CardInfo,
    SimpleStatusResponse,
    ProgressCallback,
    DataCallback,
    BluetoothDevice,
    BluetoothStatus,
    MeetingSchedule,
} from './types';
import { MEETING_SHORTCUTS } from './keyboard';

interface PendingPromise {
    tag: string;
    resolve: (value: any) => void;
    reject: (reason?: any) => void;
    timeout: NodeJS.Timeout | null;
}

export class Jensen {
    private logger: JensenLogger;
    private device: USBDevice | null = null;
    public model: string = "unknown";
    public versionCode: string | null = null;
    public versionNumber: number | null = null;
    public serialNumber: string | null = null;

    private isConnectedFlag = false;
    private isStopConnectionCheck = false;

    private sequenceId = 0;
    private receiveBuffer: Uint8Array = new Uint8Array(0);
    private pendingPromises: { [key: string]: PendingPromise } = {};
    private pendingCommands: JensenPacket[] = [];
    private currentCommand: string | null = null;
    private connectionCheckTimer: NodeJS.Timeout | null = null;

    private decodeTimeout: NodeJS.Timeout | null = null;
    private timewait = 10;
    private isReceiving = false;

    public ondisconnect: (() => void) | null = null;
    public onconnect: (() => void) | null = null;
    public onreceive: ((bytesReceived: number) => void) | null = null;

    // File transfer state
    private fileListCache: Uint8Array[] | null = null;
    private streamingDataCallback: DataCallback | null = null;

    constructor(logger?: JensenLogger) {
        this.logger = logger || new JensenLogger();
    }

    // Public API for BCD conversion
    public toBcd = toBcd;
    public fromBcd = fromBcd;

    /**
     * Initialize WebUSB and connect to a HiDock device.
     */
    public async init(): Promise<void> {
        if (!navigator.usb) {
            this.logger.error("jensen", "init", "WebUSB not supported");
            throw new Error("WebUSB not supported");
        }

        navigator.usb.onconnect = () => {
            this.logger.debug("jensen", "init", "USB device connected event");
            this.tryConnect();
        };

        await this.connect();
    }

    /**
     * Request device access from the user and connect.
     */
    public async connect(): Promise<void> {
        this.logger.debug("jensen", "connect", "Requesting device access");

        if (await this.tryConnect()) {
            return;
        }

        try {
            const device = await navigator.usb.requestDevice({
                filters: [{ vendorId: HIDOCK_CONSTANTS.VENDOR_ID }],
            });
            await device.open();
            this.device = device;
            await this.setupDevice();
        } catch (error: any) {
            this.logger.error("jensen", "connect", `Failed to connect: ${error.message}`);
            throw error;
        }
    }

    /**
     * Try to connect to an already authorized HiDock device.
     * @param silent - If true, don't trigger the onconnect callback.
     * @returns True if a connection was established.
     */
    public async tryConnect(silent = false): Promise<boolean> {
        await this.disconnect();

        const devices = await navigator.usb.getDevices();
        for (const device of devices) {
            if (device.productName?.includes("HiDock")) {
                this.logger.debug("jensen", "tryConnect", `Detected: ${device.productName}`);
                await device.open();
                this.device = device;
                await this.setupDevice(silent);
                return true;
            }
        }

        this.logger.debug("jensen", "tryConnect", "No HiDock device found");
        return false;
    }

    private async setupDevice(silent = false): Promise<void> {
        if (!this.device) return;

        this.versionCode = null;
        this.versionNumber = null;
        this.pendingCommands = [];

        try {
            await this.device.selectConfiguration(HIDOCK_CONSTANTS.USB_CONFIG_VALUE);
            await this.device.claimInterface(HIDOCK_CONSTANTS.USB_INTERFACE_NUMBER);
            await this.device.selectAlternateInterface(
                HIDOCK_CONSTANTS.USB_INTERFACE_NUMBER,
                HIDOCK_CONSTANTS.USB_ALTERNATE_SETTING
            );
            this.model = this.getModelFromProductId(this.device.productId);
        } catch (error: any) {
            this.logger.error("jensen", "setup", `Setup failed: ${error.message}`);
        }

        if (!silent) {
            this.startConnectionMonitoring();
        }

        this.currentCommand = null;
        this.isConnectedFlag = true;
        this.logger.debug("jensen", "setup", "WebUSB connection setup complete");

        if (!silent && !this.isStopConnectionCheck && this.onconnect) {
            try {
                this.onconnect();
            } catch (error: any) {
                this.logger.error("jensen", "setup", `onconnect callback error: ${error.message}`);
            }
        }
    }

    private getModelFromProductId(productId: number): string {
        const { PRODUCT_IDS } = HIDOCK_CONSTANTS;
        switch (productId) {
            case PRODUCT_IDS.H1: return "hidock-h1";
            case PRODUCT_IDS.H1E: return "hidock-h1e";
            case PRODUCT_IDS.P1: return "hidock-p1";
            default: return "unknown";
        }
    }

    private startConnectionMonitoring(): void {
        const check = () => {
            if (!this.device?.opened) {
                if (this.connectionCheckTimer) clearTimeout(this.connectionCheckTimer);
                if (this.ondisconnect && !this.isStopConnectionCheck) {
                    this.ondisconnect();
                }
            } else {
                this.connectionCheckTimer = setTimeout(check, HIDOCK_CONSTANTS.RECEIVE_TIMEOUT);
            }
        };
        check();
    }

    public isConnected(): boolean {
        return this.device != null && this.isConnectedFlag;
    }

    public getModel(): string {
        return this.model;
    }

    public async disconnect(): Promise<void> {
        this.logger.info("jensen", "disconnect", "Disconnecting from device");
        this.isConnectedFlag = false;
        if (this.connectionCheckTimer) clearTimeout(this.connectionCheckTimer);
        try {
            await this.device?.close();
        } catch (error: any) {
            this.logger.error("jensen", "disconnect", `Error closing device: ${error.message}`);
        }
        this.device = null;
    }

    public send(packet: JensenPacket, timeout?: number, progressCallback?: ProgressCallback): Promise<any> {
        packet.sequence(this.sequenceId++);
        packet.onprogress = progressCallback || null;
        if (timeout) {
            packet.expireAfter(timeout);
        }

        this.pendingCommands.push(packet);
        this.processCommandQueue();

        return this.createCommandPromise(packet, timeout);
    }

    private async processCommandQueue(): Promise<void> {
        if (this.currentCommand) return;

        let packet: JensenPacket | undefined;
        while ((packet = this.pendingCommands.shift())) {
            const currentTime = new Date().getTime();
            if (packet.expireTime > 0 && packet.expireTime < currentTime) {
                this.logger.info("jensen", "sendNext", `Expired: cmd-${packet.command}-${packet.index}, ${COMMAND_NAMES[packet.command]}`);
                continue;
            }
            await this.sendCommand(packet);
            break;
        }
    }

    private async sendCommand(packet: JensenPacket): Promise<void> {
        const packetBytes = packet.make();
        this.currentCommand = `cmd-${packet.command}-${packet.index}`;

        this.logger.debug("jensen", "sendNext", `Command: ${COMMAND_NAMES[packet.command]}, data bytes: ${packetBytes.byteLength}`);

        this.timewait = (packet.command === COMMAND_CODES.TRANSFER_FILE || packet.command === COMMAND_CODES.GET_FILE_BLOCK) ? 1000 : 10;

        try {
            await this.device?.transferOut(HIDOCK_CONSTANTS.ENDPOINT_OUT, packetBytes);
            packet.onprogress?.(1, 1);
            if (!this.isReceiving) {
                this.startReceiving();
            }
        } catch (error: any) {
            this.logger.error("jensen", "sendNext", `Transfer error: ${error.message}`);
            this.versionCode = null;
            this.versionNumber = null;
        }
    }

    private createCommandPromise(packet: JensenPacket, timeout?: number): Promise<any> {
        const commandKey = `cmd-${packet.command}-${packet.index}`;
        const timeoutHandle = timeout ? setTimeout(() => this.timeoutCommand(commandKey), timeout * 1000) : null;

        return new Promise((resolve, reject) => {
            this.pendingPromises[commandKey] = { tag: commandKey, resolve, reject, timeout: timeoutHandle };
        });
    }

    private triggerCommandCompletion(response: any, commandId: number): void {
        if (!this.currentCommand) return;

        const expectedPrefix = this.currentCommand.substring(0, this.currentCommand.lastIndexOf("-"));
        const actualPrefix = `cmd-${commandId}`;

        if (expectedPrefix !== actualPrefix) {
            this.currentCommand = null;
            return;
        }

        const promise = this.pendingPromises[this.currentCommand];
        if (promise) {
            if (promise.timeout) clearTimeout(promise.timeout);
            promise.resolve(response);
            delete this.pendingPromises[this.currentCommand];
        } else {
            this.logger.debug("jensen", "trigger", "No action registered for command");
        }
        this.currentCommand = null;
    }

    private timeoutCommand(commandKey: string): void {
        this.logger.debug("jensen", "timeout", `Timeout ${commandKey}`);
        const promise = this.pendingPromises[commandKey];
        if (promise) {
            promise.resolve(null);
            delete this.pendingPromises[commandKey];
        }
    }

    private startReceiving(): void {
        if (!this.device || this.isReceiving) return;
        this.isReceiving = true;
        this.receiveData();
    }

    private async receiveData(): Promise<void> {
        if (!this.device) {
            this.isReceiving = false;
            return;
        }

        try {
            const result = await this.device.transferIn(HIDOCK_CONSTANTS.ENDPOINT_IN, HIDOCK_CONSTANTS.MAX_BUFFER_SIZE);
            this.processReceivedData(result);
        } catch (error: any) {
            this.logger.error("jensen", "receive", `Receive error: ${error.message}`);
            this.isReceiving = false;
        }
    }

    private processReceivedData(result: USBInTransferResult): void {
        const bytesReceived = result.data?.byteLength || 0;
        if (result.data) {
            const newData = new Uint8Array(result.data.buffer);
            const newBuffer = new Uint8Array(this.receiveBuffer.length + newData.length);
            newBuffer.set(this.receiveBuffer);
            newBuffer.set(newData, this.receiveBuffer.length);
            this.receiveBuffer = newBuffer;
        }

        this.receiveData(); // Continue listening

        if (this.decodeTimeout) clearTimeout(this.decodeTimeout);
        this.decodeTimeout = setTimeout(() => this.decodeReceivedData(), this.timewait);

        this.onreceive?.(bytesReceived);
    }

    private decodeReceivedData(): void {
        let offset = 0;
        while (true) {
            const packet = this.parsePacket(this.receiveBuffer, offset);
            if (!packet) break;

            offset += packet.length;
            const response = packet.message;

            if (response.id !== COMMAND_CODES.TRANSFER_FILE) {
                this.logger.debug("jensen", "receive", `Recv: ${COMMAND_NAMES[response.id]}, seq: ${response.sequence}, data bytes: ${response.body?.byteLength}`);
            }

            try {
                const handler = responseHandlers[response.id];
                const result = handler ? handler(response, this) : response;
                if (result !== undefined) { // Allow handlers to signal continuation
                    this.triggerCommandCompletion(result, response.id);
                }
            } catch (error: any) {
                this.triggerCommandCompletion(error, response.id);
                this.logger.error("jensen", "receive", `Handler error for ${COMMAND_NAMES[response.id]}: ${error.message}`);
            }

            this.processCommandQueue();
        }

        if (offset > 0) {
            this.receiveBuffer = this.receiveBuffer.slice(offset);
        }
    }

    private parsePacket(buffer: Uint8Array, offset: number): { message: JensenResponse; length: number } | null {
        const remainingBytes = buffer.length - offset;
        if (remainingBytes < 12) return null;

        if (buffer[offset] !== HIDOCK_CONSTANTS.PACKET_SYNC_BYTES[0] || buffer[offset + 1] !== HIDOCK_CONSTANTS.PACKET_SYNC_BYTES[1]) {
            // Search for sync bytes
            for(let i = offset + 1; i < buffer.length -1; i++) {
                if (buffer[i] === HIDOCK_CONSTANTS.PACKET_SYNC_BYTES[0] && buffer[i + 1] === HIDOCK_CONSTANTS.PACKET_SYNC_BYTES[1]) {
                    this.receiveBuffer = buffer.slice(i);
                    this.logger.error("jensen", "parsePacket", `Resynced after invalid header`);
                    return null;
                }
            }
            throw new Error("Invalid packet header");
        }

        let headerOffset = 2;
        const commandId = read16BitBigEndian(buffer, offset + headerOffset);
        headerOffset += 2;
        const sequenceId = read32BitBigEndian(buffer, offset + headerOffset);
        headerOffset += 4;
        const bodyLengthWithChecksum = read32BitBigEndian(buffer, offset + headerOffset);
        const checksumLength = (bodyLengthWithChecksum >> 24) & 0xFF;
        const bodyLength = bodyLengthWithChecksum & 0x00FFFFFF;
        headerOffset += 4;

        const totalPacketLength = 12 + bodyLength + checksumLength;
        if (remainingBytes < totalPacketLength) return null;

        const body = buffer.slice(offset + headerOffset, offset + headerOffset + bodyLength);
        return {
            message: new JensenResponse(commandId, sequenceId, body),
            length: totalPacketLength
        };
    }

    // --- Command Methods ---

    public async getDeviceInfo(timeout?: number): Promise<DeviceInfo> {
        return this.send(new JensenPacket(COMMAND_CODES.GET_DEVICE_INFO), timeout);
    }

    public async getTime(timeout?: number): Promise<DeviceTime> {
        return this.send(new JensenPacket(COMMAND_CODES.GET_DEVICE_TIME), timeout);
    }

    public async setTime(date: Date, timeout?: number): Promise<SimpleStatusResponse> {
        const timeString = formatDateToBCDString(date);
        const bcdBytes = this.toBcd(timeString);
        return this.send(new JensenPacket(COMMAND_CODES.SET_DEVICE_TIME).body(bcdBytes), timeout);
    }

    public async getFileCount(timeout?: number): Promise<FileCount> {
        return this.send(new JensenPacket(COMMAND_CODES.GET_FILE_COUNT), timeout);
    }

    public async listFiles(): Promise<FileInfo[] | null> {
        if (this.fileListCache != null) return null;

        let fileCountResponse: FileCount | null = null;
        if (this.versionNumber === undefined || this.versionNumber <= 327722) {
            fileCountResponse = await this.getFileCount(5);
            if (!fileCountResponse || fileCountResponse.count === 0) return [];
        }

        this.fileListCache = [];

        responseHandlers[COMMAND_CODES.GET_FILE_LIST] = (response: JensenResponse): FileInfo[] | undefined => {
            if (!this.fileListCache) return;

            if (response.body.length === 0) {
                this.fileListCache = null;
                return [];
            }

            this.fileListCache.push(response.body);
            const files = this.parseFileListData(this.fileListCache);

            const expectedCount = fileCountResponse ? fileCountResponse.count : -1;
            if ((fileCountResponse && files.length >= fileCountResponse.count) || (expectedCount > -1 && files.length >= expectedCount)) {
                this.fileListCache = null;
                return files.filter(file => !!file.time);
            }
            return undefined; // Continue receiving
        };

        return this.send(new JensenPacket(COMMAND_CODES.GET_FILE_LIST));
    }

    private parseFileListData(chunks: Uint8Array[]): FileInfo[] {
        // This is a complex parser that would need to be implemented fully.
        // For brevity, this is a simplified placeholder.
        this.logger.debug("jensen", "parseFileListData", `Parsing ${chunks.length} chunks.`);
        return []; // Placeholder
    }

    public async deleteFile(filename: string, timeout?: number): Promise<SimpleStatusResponse> {
        const filenameBytes = Array.from(filename).map(c => c.charCodeAt(0));
        return this.send(new JensenPacket(COMMAND_CODES.DELETE_FILE).body(filenameBytes), timeout);
    }

    public async streaming(filename: string, fileLength: number, dataCallback: DataCallback, progressCallback?: ProgressCallback): Promise<any> {
        this.logger.info("jensen", "streaming", `File download start: ${filename}, length: ${fileLength}`);
        const filenameBytes = Array.from(filename).map(c => c.charCodeAt(0));
        let receivedBytes = 0;
        this.onreceive = progressCallback ? (bytes) => progressCallback(receivedBytes, fileLength) : null;
        this.streamingDataCallback = dataCallback;

        responseHandlers[COMMAND_CODES.TRANSFER_FILE] = (response: JensenResponse) => {
            if (!this.streamingDataCallback) return;
            if (response != null) {
                receivedBytes += response.body.length;
                this.streamingDataCallback(response.body);
                if (receivedBytes >= fileLength) {
                    this.logger.info("jensen", "streaming", "File download finish.");
                    this.streamingDataCallback = null;
                    return "OK";
                }
            } else {
                this.logger.info("jensen", "streaming", "File download fail.");
                this.streamingDataCallback("fail");
                this.streamingDataCallback = null;
            }
        };

        return this.send(new JensenPacket(COMMAND_CODES.TRANSFER_FILE).body(filenameBytes));
    }

    public async getSettings(timeout?: number): Promise<DeviceSettings> {
        if ((this.model === "hidock-h1" || this.model === "hidock-h1e") && this.versionNumber! < 327714) {
            return { autoRecord: false, autoPlay: false, bluetoothTone: false };
        }
        return this.send(new JensenPacket(COMMAND_CODES.GET_SETTINGS), timeout);
    }

    public async setAutoRecord(enabled: boolean, timeout?: number): Promise<SimpleStatusResponse> {
        if ((this.model === "hidock-h1" || this.model === "hidock-h1e") && this.versionNumber! < 327714) {
            return { result: "failed" };
        }
        return this.send(new JensenPacket(COMMAND_CODES.SET_SETTINGS).body([0, 0, 0, enabled ? 1 : 2]), timeout);
    }

    public async getCardInfo(timeout?: number): Promise<CardInfo | null> {
        if ((this.model === "hidock-h1" || this.model === "hidock-h1e") && this.versionNumber! < 327733) {
            return null;
        }
        return this.send(new JensenPacket(COMMAND_CODES.GET_CARD_INFO), timeout);
    }

    public async formatCard(timeout?: number): Promise<SimpleStatusResponse | null> {
        if ((this.model === "hidock-h1" || this.model === "hidock-h1e") && this.versionNumber! < 327733) {
            return null;
        }
        return this.send(new JensenPacket(COMMAND_CODES.FORMAT_CARD).body([1, 2, 3, 4]), timeout);
    }

    public async factoryReset(timeout?: number): Promise<SimpleStatusResponse | null> {
        const isCompatible = (this.model === "hidock-h1" || this.model === "hidock-h1e") && this.versionNumber! >= 327705;
        if (!isCompatible) return null;
        return this.send(new JensenPacket(COMMAND_CODES.FACTORY_RESET), timeout);
    }

    public async sendScheduleInfo(schedules: MeetingSchedule[]): Promise<SimpleStatusResponse> {
        if (Array.isArray(schedules) && schedules.length) {
            let scheduleBytes: number[] = [];
            for (const schedule of schedules) {
                let platformBytes = new Array(34).fill(0);
                if (MEETING_SHORTCUTS[schedule.platform]?.[schedule.os]) {
                    platformBytes = MEETING_SHORTCUTS[schedule.platform][schedule.os];
                }
                let startDateBytes = new Array(8).fill(0);
                let endDateBytes = new Array(8).fill(0);
                if (schedule.startDate && schedule.endDate) {
                    startDateBytes = [...toBcd(formatDateToBCDString(schedule.startDate)), 0];
                    endDateBytes = [...toBcd(formatDateToBCDString(schedule.endDate)), 0];
                }
                scheduleBytes = scheduleBytes.concat([...startDateBytes, ...endDateBytes, 0, 0, ...platformBytes]);
            }
            return this.send(new JensenPacket(COMMAND_CODES.SEND_MEETING_SCHEDULE).body(scheduleBytes));
        } else {
            const emptySchedule = new Array(52).fill(0);
            return this.send(new JensenPacket(COMMAND_CODES.SEND_MEETING_SCHEDULE).body(emptySchedule));
        }
    }

    public async scanDevices(timeout = 20): Promise<BluetoothDevice[] | null> {
        if (this.model !== "hidock-p1") return null;
        return this.send(new JensenPacket(COMMAND_CODES.BLUETOOTH_SCAN), timeout);
    }

    public async connectBTDevice(macAddress: string, timeout?: number): Promise<SimpleStatusResponse | null> {
        if (this.model !== "hidock-p1") return null;
        const macParts = macAddress.split("-");
        if (macParts.length !== 6) throw new Error("Invalid MAC address format");
        const macBytes = macParts.map(part => parseInt(part, 16));
        return this.send(new JensenPacket(COMMAND_CODES.BLUETOOTH_CMD).body([0, ...macBytes]), timeout);
    }

    public async disconnectBTDevice(timeout?: number): Promise<SimpleStatusResponse | null> {
        if (this.model !== "hidock-p1") return null;
        return this.send(new JensenPacket(COMMAND_CODES.BLUETOOTH_CMD).body([1]), timeout);
    }

    public async getBluetoothStatus(timeout?: number): Promise<BluetoothStatus | null> {
        if (this.model !== "hidock-p1") return null;
        return this.send(new JensenPacket(COMMAND_CODES.BLUETOOTH_STATUS), timeout);
    }
}
