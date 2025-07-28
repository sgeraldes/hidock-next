/**
 * @fileoverview
 * HiDock Jensen Protocol Implementation - Complete Documented Version
 * 
 * This file contains the complete implementation of the Jensen protocol used by HiDock devices.
 * It provides WebUSB communication capabilities for HiDock H1, H1E, and P1 devices.
 * 
 * The Jensen protocol is a custom binary protocol that uses specific packet structures
 * for communication with HiDock hardware devices over USB.
 * 
 * This is a fully documented and expanded version of the original minified jensen.js,
 * with detailed explanations of all magic numbers, protocol structures, and operations.
 */

/**
 * HiDock Device Constants and Magic Numbers
 */
const HIDOCK_CONSTANTS = {
    // USB Vendor and Product IDs
    VENDOR_ID: 0x10E6,  // 4310 in decimal - HiDock's USB Vendor ID
    
    // Product IDs for different HiDock models
    PRODUCT_IDS: {
        H1: 45068,   // 0xB00C - HiDock H1 model
        H1E: 45069,  // 0xB00D - HiDock H1E model  
        P1: 45070    // 0xB00E - HiDock P1 model
    },
    
    // USB Configuration
    USB_CONFIG_VALUE: 1,
    USB_INTERFACE_NUMBER: 0,
    USB_ALTERNATE_SETTING: 0,
    
    // USB Endpoints
    ENDPOINT_OUT: 1,  // Endpoint for sending data to device
    ENDPOINT_IN: 2,   // Endpoint for receiving data from device
    
    // Protocol Magic Numbers
    PACKET_SYNC_BYTES: [0x12, 0x34], // Packet synchronization bytes
    MAX_BUFFER_SIZE: 51200,           // 50KB - Maximum read buffer size
    MAX_PACKET_SIZE: 102400,          // 100KB - Maximum packet size for processing
    RECEIVE_TIMEOUT: 100,             // 100ms - Receive loop timeout
    
    // Logger Configuration
    MAX_LOG_ENTRIES: 15000,  // Maximum number of log entries to keep
};

/**
 * HiDock Command Codes
 * These are the numeric command identifiers used in the Jensen protocol
 */
const COMMAND_CODES = {
    // Basic Device Commands
    INVALID: 0,                    // Invalid command
    GET_DEVICE_INFO: 1,           // Get device information (firmware, serial, etc.)
    GET_DEVICE_TIME: 2,           // Get current device time
    SET_DEVICE_TIME: 3,           // Set device time
    
    // File Operations
    GET_FILE_LIST: 4,             // Get list of files on device
    TRANSFER_FILE: 5,             // Transfer/download file from device
    GET_FILE_COUNT: 6,            // Get total number of files
    DELETE_FILE: 7,               // Delete file from device
    
    // Firmware Operations
    REQUEST_FIRMWARE_UPGRADE: 8,   // Request firmware upgrade
    FIRMWARE_UPLOAD: 9,           // Upload firmware data
    
    // Device Testing/Debug
    DEVICE_MSG_TEST: 10,          // Device message test
    BNC_DEMO_TEST: 10,            // BNC demo test (same as device msg test)
    
    // Settings Management
    GET_SETTINGS: 11,             // Get device settings
    SET_SETTINGS: 12,             // Set device settings
    GET_FILE_BLOCK: 13,           // Get file block (streaming)
    
    // Storage Management
    GET_CARD_INFO: 16,            // Get storage card information
    FORMAT_CARD: 17,              // Format storage card
    GET_RECORDING_FILE: 18,       // Get recording file info
    RESTORE_FACTORY_SETTINGS: 19, // Restore factory settings
    SEND_MEETING_SCHEDULE: 20,    // Send meeting schedule information
    READ_FILE_PART: 21,           // Read part of a file
    
    // Tone/Audio Updates
    REQUEST_TONE_UPDATE: 22,      // Request tone update
    UPDATE_TONE: 23,              // Update tone data
    REQUEST_UAC_UPDATE: 24,       // Request UAC (USB Audio Class) update
    UPDATE_UAC: 25,               // Update UAC data
    
    // Realtime Features
    GET_REALTIME_SETTINGS: 32,    // Get realtime settings
    CONTROL_REALTIME: 33,         // Control realtime operations
    GET_REALTIME_DATA: 34,        // Get realtime data
    
    // Bluetooth Operations (P1 model only)
    BLUETOOTH_SCAN: 4097,         // 0x1001 - Scan for Bluetooth devices
    BLUETOOTH_CMD: 4098,          // 0x1002 - Bluetooth command
    BLUETOOTH_STATUS: 4099,       // 0x1003 - Get Bluetooth status
    
    // Factory/Testing Commands
    FACTORY_RESET: 61451,         // 0xF00B - Factory reset
    TEST_SN_WRITE: 61447,         // 0xF007 - Test serial number write
    RECORD_TEST_START: 61448,     // 0xF008 - Start recording test
    RECORD_TEST_END: 61449,       // 0xF009 - End recording test
};

/**
 * Human-readable command names for debugging and logging
 */
const COMMAND_NAMES = {
    [COMMAND_CODES.INVALID]: "invalid-0",
    [COMMAND_CODES.GET_DEVICE_INFO]: "get-device-info",
    [COMMAND_CODES.GET_DEVICE_TIME]: "get-device-time",
    [COMMAND_CODES.SET_DEVICE_TIME]: "set-device-time",
    [COMMAND_CODES.GET_FILE_LIST]: "get-file-list",
    [COMMAND_CODES.TRANSFER_FILE]: "transfer-file",
    [COMMAND_CODES.GET_FILE_COUNT]: "get-file-count",
    [COMMAND_CODES.DELETE_FILE]: "delete-file",
    [COMMAND_CODES.REQUEST_FIRMWARE_UPGRADE]: "request-firmware-upgrade",
    [COMMAND_CODES.FIRMWARE_UPLOAD]: "firmware-upload",
    [COMMAND_CODES.DEVICE_MSG_TEST]: "device-msg-test",
    [COMMAND_CODES.BNC_DEMO_TEST]: "bnc-demo-test",
    [COMMAND_CODES.GET_SETTINGS]: "get-settings",
    [COMMAND_CODES.SET_SETTINGS]: "set-settings",
    [COMMAND_CODES.GET_FILE_BLOCK]: "get-file-block",
    [COMMAND_CODES.GET_CARD_INFO]: "read-card-info",
    [COMMAND_CODES.FORMAT_CARD]: "format-card",
    [COMMAND_CODES.GET_RECORDING_FILE]: "get-recording-file",
    [COMMAND_CODES.RESTORE_FACTORY_SETTINGS]: "restore-factory-settings",
    [COMMAND_CODES.SEND_MEETING_SCHEDULE]: "send-meeting-schedule-info",
    [COMMAND_CODES.READ_FILE_PART]: "read-file-part",
    [COMMAND_CODES.REQUEST_TONE_UPDATE]: "request-tone-update",
    [COMMAND_CODES.UPDATE_TONE]: "update-tone",
    [COMMAND_CODES.REQUEST_UAC_UPDATE]: "request-uac-update",
    [COMMAND_CODES.UPDATE_UAC]: "update-uac",
    [COMMAND_CODES.GET_REALTIME_SETTINGS]: "get-realtime-settings",
    [COMMAND_CODES.CONTROL_REALTIME]: "control-realtime",
    [COMMAND_CODES.GET_REALTIME_DATA]: "get-realtime-data",
    [COMMAND_CODES.BLUETOOTH_SCAN]: "bluetooth-scan",
    [COMMAND_CODES.BLUETOOTH_CMD]: "bluetooth-cmd",
    [COMMAND_CODES.BLUETOOTH_STATUS]: "bluetooth-status",
    [COMMAND_CODES.FACTORY_RESET]: "factory-reset",
    [COMMAND_CODES.TEST_SN_WRITE]: "test-sn-write",
    [COMMAND_CODES.RECORD_TEST_START]: "record-test-start",
    [COMMAND_CODES.RECORD_TEST_END]: "record-test-end",
};

/**
 * Keyboard/HID Key Mapping for meeting shortcuts
 * These values correspond to USB HID keyboard scan codes
 */
const HID_KEY_CODES = {
    CUSTOM_1: 1,
    A: 4, B: 5, C: 6, D: 7, E: 8, F: 9, G: 10, H: 11, I: 12, J: 13,
    K: 14, L: 15, M: 16, N: 17, O: 18, P: 19, Q: 20, R: 21, S: 22,
    T: 23, U: 24, V: 25, W: 26, X: 27, Y: 28, Z: 27,
    ENTER: 40,
    ESCAPE: 41,
    SPACE: 44,
};

/**
 * Logger class for debug and error tracking
 * Maintains a circular buffer of log messages with timestamps
 */
class JensenLogger {
    constructor() {
        this.messages = [];
        this.consoleOutput = true;
    }

    /**
     * Log an info message
     * @param {string} module - Module name
     * @param {string} procedure - Procedure/function name
     * @param {string} message - Log message
     */
    info(module, procedure, message) {
        this._append("info", module, procedure, message);
    }

    /**
     * Log a debug message
     * @param {string} module - Module name
     * @param {string} procedure - Procedure/function name
     * @param {string} message - Log message
     */
    debug(module, procedure, message) {
        this._append("debug", module, procedure, message);
    }

    /**
     * Log an error message
     * @param {string} module - Module name
     * @param {string} procedure - Procedure/function name
     * @param {string} message - Log message
     */
    error(module, procedure, message) {
        this._append("error", module, procedure, message);
    }

    /**
     * Internal method to append log entries
     * @private
     */
    _append(level, module, procedure, message) {
        const logEntry = {
            level: level,
            module: module,
            procedure: procedure,
            message: message,
            time: new Date().getTime(),
        };

        this.messages.push(logEntry);
        
        if (this.consoleOutput) {
            this._print(logEntry);
        }

        // Maintain circular buffer - remove old entries
        if (this.messages.length > HIDOCK_CONSTANTS.MAX_LOG_ENTRIES) {
            this.messages.shift();
        }
    }

    /**
     * Print log entry to console
     * @private
     */
    _print(logEntry) {
        const timestamp = new Date(logEntry.time);
        const logFunction = console[logEntry.level] || console.log;
        logFunction(`[${timestamp.toISOString()}] ${logEntry.module}.${logEntry.procedure}: ${logEntry.message}`);
    }

    /**
     * Filter log messages by module and procedure
     */
    filter(module, procedure) {
        return this.messages.filter(entry => entry.module === module && entry.procedure === procedure);
    }

    /**
     * Search log messages
     */
    search(module, procedure, messageFilter) {
        return this.messages.filter(entry => {
            if (entry.module !== module) return false;
            if (procedure && entry.procedure !== procedure) return false;
            if (messageFilter && entry.message.indexOf(messageFilter) === -1) return false;
            return true;
        });
    }

    /**
     * Get the last N log entries
     */
    peek(count) {
        return this.messages.slice(-count);
    }

    enableConsoleOutput() {
        this.consoleOutput = true;
    }

    disableConsoleOutput() {
        this.consoleOutput = false;
    }
}

/**
 * Date formatting utility
 * Converts Date object to BCD (Binary Coded Decimal) format used by HiDock
 * Format: YYYYMMDDHHMMSS
 */
function formatDateToBCD(date) {
    let formatted = date.getFullYear() +
        "-0" + (date.getMonth() + 1) +
        "-0" + date.getDate() +
        "-0" + date.getHours() +
        "-0" + date.getMinutes() +
        "-0" + date.getSeconds();

    // Remove leading zeros and format as YYYYMMDDHHMMSS
    return formatted.replace(
        /(\d{4})\-0*(\d{2})\-0*(\d{2})\-0*(\d{2})\-0*(\d{2})\-0*(\d{2})/gi,
        "$1$2$3$4$5$6"
    );
}

/**
 * Hex string to byte array conversion utility
 * @param {string} hexString - Hex string (e.g., "1234ABCD")
 * @returns {number[]} Array of bytes
 */
function hexStringToBytes(hexString) {
    return hexString.match(/.{1,2}/g).map(byte => parseInt(byte, 16));
}

/**
 * Keyboard shortcut builder for meeting controls
 * Builds HID keyboard report data for different meeting platforms
 */
class KeyboardShortcutBuilder {
    constructor() {
        this.control = false;
        this.shift = false;
        this.alt = false;
        this.guiKey = false; // Windows/Cmd key
        this.keys = [];
    }

    withControl() {
        this.control = true;
        return this;
    }

    withShift() {
        this.shift = true;
        return this;
    }

    withAlt() {
        this.alt = true;
        return this;
    }

    withGuiKey() {
        this.guiKey = true;
        return this;
    }

    withKey(keyName) {
        if (this.keys.length >= 2) {
            throw new Error("Maximum 2 keys allowed in combination");
        }
        this.keys.push(this._mapKey(keyName));
        return this;
    }

    _mapKey(keyName) {
        return HID_KEY_CODES[keyName];
    }

    /**
     * Build the final HID report
     * @param {number} reportId - HID report ID (default: 3)
     * @param {number} reserved - Reserved byte (default: 0)
     * @returns {number[]} 8-byte HID keyboard report
     */
    build(reportId = 3, reserved = 0) {
        let modifiers = reserved;
        
        // Build modifier byte
        if (this.control) modifiers |= 0x01;  // Left Ctrl
        if (this.shift) modifiers |= 0x02;    // Left Shift
        if (this.alt) modifiers |= 0x04;      // Left Alt
        if (this.guiKey) modifiers |= 0x08;   // Left GUI (Windows/Cmd)

        const report = [
            reportId,
            modifiers,
            this.keys.length > 0 ? this.keys[0] : 0,
            this.keys.length > 1 ? this.keys[1] : 0,
            0, 0, 0, 0  // Reserved bytes
        ];

        // Reset state for next build
        this.control = false;
        this.shift = false;
        this.alt = false;
        this.guiKey = false;
        this.keys = [];

        return report;
    }
}

/**
 * Create modifier-only keyboard report
 * @param {boolean} ctrl - Control key pressed
 * @param {boolean} shift - Shift key pressed  
 * @param {boolean} alt - Alt key pressed
 * @param {boolean} gui - GUI key pressed
 * @returns {number[]} 2-byte modifier report
 */
function createModifierReport(ctrl = false, shift = false, alt = false, gui = false) {
    let modifiers = 0;
    if (ctrl) modifiers |= 0x01;
    if (shift) modifiers |= 0x02;
    if (alt) modifiers |= 0x04;
    if (gui) modifiers |= 0x08;
    return [0, modifiers];
}

/**
 * Empty 8-byte array for padding/unused slots
 */
const EMPTY_BYTES = [0, 0, 0, 0, 0, 0, 0, 0];

/**
 * Meeting platform keyboard shortcuts configuration
 * Maps different meeting platforms to their keyboard shortcuts for different operating systems
 */
const MEETING_SHORTCUTS = {
    zoom: {
        Windows: [
            ...createModifierReport(false, true),  // Shift modifier
            ...new KeyboardShortcutBuilder().build(4, 1),  // Custom report
            ...new KeyboardShortcutBuilder().withAlt().withKey("Q").build(),  // Alt+Q
            ...new KeyboardShortcutBuilder().build(4, 16), // Custom report  
            ...EMPTY_BYTES,
        ],
        Mac: [
            ...createModifierReport(false, true),  // Shift modifier
            ...new KeyboardShortcutBuilder().build(4, 1),  // Custom report
            ...new KeyboardShortcutBuilder().withGuiKey().withKey("W").build(),  // Cmd+W
            ...new KeyboardShortcutBuilder().build(4, 16), // Custom report
            ...EMPTY_BYTES,
        ],
        Linux: [
            ...createModifierReport(),
            ...EMPTY_BYTES, ...EMPTY_BYTES, ...EMPTY_BYTES, ...EMPTY_BYTES
        ],
    },
    
    teams: {
        Windows: [
            ...createModifierReport(),
            ...new KeyboardShortcutBuilder().withControl().withShift().withKey("A").build(), // Ctrl+Shift+A
            ...new KeyboardShortcutBuilder().withControl().withShift().withKey("H").build(), // Ctrl+Shift+H  
            ...new KeyboardShortcutBuilder().withControl().withShift().withKey("D").build(), // Ctrl+Shift+D
            ...new KeyboardShortcutBuilder().withControl().withShift().withKey("M").build(), // Ctrl+Shift+M
        ],
        Mac: [
            ...createModifierReport(),
            ...new KeyboardShortcutBuilder().withGuiKey().withShift().withKey("A").build(), // Cmd+Shift+A
            ...new KeyboardShortcutBuilder().withGuiKey().withShift().withKey("H").build(), // Cmd+Shift+H
            ...new KeyboardShortcutBuilder().withGuiKey().withShift().withKey("D").build(), // Cmd+Shift+D
            ...new KeyboardShortcutBuilder().withGuiKey().withShift().withKey("M").build(), // Cmd+Shift+M
        ],
        Linux: [
            ...createModifierReport(),
            ...EMPTY_BYTES, ...EMPTY_BYTES, ...EMPTY_BYTES, ...EMPTY_BYTES
        ],
    },

    "google-meeting": {
        Windows: [
            ...createModifierReport(),
            ...EMPTY_BYTES, ...EMPTY_BYTES, ...EMPTY_BYTES,
            ...new KeyboardShortcutBuilder().withControl().withKey("D").build(), // Ctrl+D
        ],
        Mac: [
            ...createModifierReport(),
            ...EMPTY_BYTES, ...EMPTY_BYTES, ...EMPTY_BYTES,
            ...new KeyboardShortcutBuilder().withGuiKey().withKey("D").build(), // Cmd+D
        ],
        Linux: [
            ...createModifierReport(),
            ...EMPTY_BYTES, ...EMPTY_BYTES, ...EMPTY_BYTES, ...EMPTY_BYTES
        ],
    },

    webex: {
        Windows: [
            ...createModifierReport(),
            ...new KeyboardShortcutBuilder().withControl().withShift().withKey("C").build(), // Ctrl+Shift+C
            ...new KeyboardShortcutBuilder().withControl().withKey("L").build(), // Ctrl+L
            ...new KeyboardShortcutBuilder().withControl().withKey("D").build(), // Ctrl+D
            ...new KeyboardShortcutBuilder().withControl().withKey("M").build(), // Ctrl+M
        ],
        Mac: [
            ...createModifierReport(),
            ...new KeyboardShortcutBuilder().withControl().withShift().withKey("C").build(), // Ctrl+Shift+C
            ...new KeyboardShortcutBuilder().withGuiKey().withKey("L").build(), // Cmd+L
            ...new KeyboardShortcutBuilder().withGuiKey().withShift().withKey("D").build(), // Cmd+Shift+D
            ...new KeyboardShortcutBuilder().withGuiKey().withShift().withKey("M").build(), // Cmd+Shift+M
        ],
        Linux: [
            ...createModifierReport(),
            ...EMPTY_BYTES, ...EMPTY_BYTES, ...EMPTY_BYTES, ...EMPTY_BYTES
        ],
    },

    // Add more meeting platforms as needed...
    discord: {
        Windows: [
            ...createModifierReport(),
            ...new KeyboardShortcutBuilder().withControl().withKey("ENTER").build(), // Ctrl+Enter
            ...EMPTY_BYTES,
            ...new KeyboardShortcutBuilder().withKey("ESCAPE").build(), // Escape
            ...new KeyboardShortcutBuilder().withControl().withShift().withKey("M").build(), // Ctrl+Shift+M
        ],
        Mac: [
            ...createModifierReport(),
            ...new KeyboardShortcutBuilder().withGuiKey().withKey("ENTER").build(), // Cmd+Enter
            ...EMPTY_BYTES,
            ...new KeyboardShortcutBuilder().withGuiKey().withKey("ESCAPE").build(), // Cmd+Escape
            ...new KeyboardShortcutBuilder().withGuiKey().withShift().withKey("M").build(), // Cmd+Shift+M
        ],
        Linux: [
            ...createModifierReport(),
            ...EMPTY_BYTES, ...EMPTY_BYTES, ...EMPTY_BYTES, ...EMPTY_BYTES
        ],
    },
};

/**
 * Jensen Packet class - represents a command packet to be sent to the device
 */
class JensenPacket {
    /**
     * @param {number} command - Command code from COMMAND_CODES
     */
    constructor(command) {
        this.command = command;
        this.msgBody = [];      // Packet payload bytes
        this.index = 0;         // Sequence number
        this.expireTime = 0;    // Expiration timestamp
        this.onprogress = null; // Progress callback
    }

    /**
     * Set the packet body/payload
     * @param {number[]} bodyBytes - Array of bytes for packet payload
     * @returns {JensenPacket} This packet (for chaining)
     */
    body(bodyBytes) {
        this.msgBody = bodyBytes;
        return this;
    }

    /**
     * Set packet expiration time
     * @param {number} seconds - Seconds from now when packet expires
     */
    expireAfter(seconds) {
        this.expireTime = new Date().getTime() + (seconds * 1000);
    }

    /**
     * Set packet sequence number
     * @param {number} sequenceId - Sequence ID
     * @returns {JensenPacket} This packet (for chaining)
     */
    sequence(sequenceId) {
        this.index = sequenceId;
        return this;
    }

    /**
     * Build the final packet bytes for transmission
     * Jensen Protocol Packet Structure:
     * 
     * Bytes 0-1:   Sync bytes (0x12, 0x34)
     * Bytes 2-3:   Command ID (16-bit big-endian)
     * Bytes 4-7:   Sequence ID (32-bit big-endian) 
     * Bytes 8-11:  Body length (32-bit big-endian)
     * Bytes 12+:   Body data
     * 
     * @returns {Uint8Array} Complete packet ready for transmission
     */
    make() {
        const packet = new Uint8Array(12 + this.msgBody.length);
        let offset = 0;

        // Sync bytes - packet header identification
        packet[offset++] = 0x12;  // Magic sync byte 1
        packet[offset++] = 0x34;  // Magic sync byte 2

        // Command ID (16-bit big-endian)
        packet[offset++] = (this.command >> 8) & 0xFF;
        packet[offset++] = this.command & 0xFF;

        // Sequence ID (32-bit big-endian)
        packet[offset++] = (this.index >> 24) & 0xFF;
        packet[offset++] = (this.index >> 16) & 0xFF;
        packet[offset++] = (this.index >> 8) & 0xFF;
        packet[offset++] = this.index & 0xFF;

        // Body length (32-bit big-endian)
        const bodyLength = this.msgBody.length;
        packet[offset++] = (bodyLength >> 24) & 0xFF;
        packet[offset++] = (bodyLength >> 16) & 0xFF;
        packet[offset++] = (bodyLength >> 8) & 0xFF;
        packet[offset++] = bodyLength & 0xFF;

        // Copy body data
        for (let i = 0; i < this.msgBody.length; i++) {
            packet[offset++] = this.msgBody[i] & 0xFF;
        }

        return packet;
    }
}

/**
 * Jensen Response class - represents a response packet received from the device
 */
class JensenResponse {
    /**
     * @param {number} commandId - Command ID this response is for
     * @param {number} sequence - Sequence number
     * @param {Uint8Array} body - Response body data
     */
    constructor(commandId, sequence, body) {
        this.id = commandId;
        this.sequence = sequence;
        this.body = body;
    }
}

/**
 * Main Jensen class - handles communication with HiDock devices
 */
class Jensen {
    /**
     * @param {JensenLogger} logger - Logger instance (optional)
     */
    constructor(logger) {
        // Logger for debug/error tracking
        this.logger = logger || new JensenLogger();
        
        // USB Device connection
        this.device = null;
        this.model = "unknown";
        this.versionCode = null;
        this.versionNumber = null;
        this.serialNumber = null;
        
        // Connection state
        this.isConnectedFlag = false;
        this.isStopConnectionCheck = false;
        
        // Protocol state
        this.sequenceId = 0;
        this.receiveBuffer = new Uint8Array(0);
        this.pendingPromises = {};          // Map of sequence IDs to Promise resolvers
        this.pendingCommands = [];          // Queue of commands to send
        this.currentCommand = null;         // Currently executing command
        this.connectionCheckTimer = null;
        
        // Device settings cache
        this.deviceBehaviorSettings = {
            autoRecord: null,
            autoPlay: null,
            bluetoothTone: null,
            notificationSound: null,
        };
        
        // Receive processing
        this.decodeTimeout = 0;
        this.timewait = 1;  // Time to wait between operations
        
        // File transfer state
        this.fileLength = 0;
        this.fileReadBytes = 0;
        this.onFileRecvHandler = null;
        
        // Callbacks
        this.ondisconnect = null;
        this.onconnect = null;
        this.onreceive = null;
        
        // Initialize command handlers
        this._initializeCommandHandlers();
    }

    /**
     * Initialize WebUSB connection and attempt to connect to device
     * This is the main entry point for connecting to a HiDock device
     */
    async init() {
        if (!navigator.usb) {
            this.logger.error("jensen", "init", "WebUSB not supported in this browser");
            return;
        }

        // Set up USB connect event handler
        navigator.usb.onconnect = (event) => {
            this.logger.debug("jensen", "init", "USB device connected event");
            this.tryconnect();
        };

        await this.connect();
    }

    /**
     * Request device access from user and connect
     */
    async connect() {
        this.logger.debug("jensen", "connect", "Requesting device access");
        
        if (await this.tryconnect()) {
            return;
        }

        try {
            // Request user to select HiDock device
            const device = await navigator.usb.requestDevice({
                filters: [{ vendorId: HIDOCK_CONSTANTS.VENDOR_ID }],
            });

            await device.open();
            this.device = device;
            await this._setupDevice();
        } catch (error) {
            this.logger.error("jensen", "connect", `Failed to connect: ${error.message}`);
            throw error;
        }
    }

    /**
     * Try to connect to an already authorized HiDock device
     * @param {boolean} silent - If true, don't trigger connect callback
     * @returns {boolean} True if connection successful
     */
    async tryconnect(silent = false) {
        await this.disconnect();
        
        const devices = await navigator.usb.getDevices();
        
        for (const device of devices) {
            if (device.productName && device.productName.indexOf("HiDock") > -1) {
                this.logger.debug("jensen", "tryconnect", `Detected: ${device.productName}`);
                
                await device.open();
                this.device = device;
                await this._setupDevice(silent);
                return true;
            }
        }
        
        this.logger.debug("jensen", "tryconnect", "No HiDock device found");
        return false;
    }

    /**
     * Set up device connection - claim interface and determine model
     * @private
     * @param {boolean} silent - If true, don't trigger connect callback
     */
    async _setupDevice(silent = false) {
        // Reset device state
        this.versionCode = null;
        this.versionNumber = null;
        this.pendingCommands.length = 0;

        try {
            // Configure USB interface
            await this.device.selectConfiguration(HIDOCK_CONSTANTS.USB_CONFIG_VALUE);
            await this.device.claimInterface(HIDOCK_CONSTANTS.USB_INTERFACE_NUMBER);
            await this.device.selectAlternateInterface(
                HIDOCK_CONSTANTS.USB_INTERFACE_NUMBER, 
                HIDOCK_CONSTANTS.USB_ALTERNATE_SETTING
            );

            // Determine device model from Product ID
            this.model = this._getModelFromProductId(this.device.productId);
            
        } catch (error) {
            this.logger.error("jensen", "setup", `Setup failed: ${error.message}`);
        }

        // Start connection monitoring if not silent
        if (!silent) {
            this._startConnectionMonitoring();
        }

        this.currentCommand = null;
        this.isConnectedFlag = false;
        
        this.logger.debug("jensen", "setup", "WebUSB connection setup complete");

        // Trigger connect callback
        if (!silent && !this.isStopConnectionCheck && this.onconnect) {
            try {
                this.onconnect();
            } catch (error) {
                this.logger.error("jensen", "setup", `Connect callback error: ${error.message}`);
            }
        }
    }

    /**
     * Determine device model from USB Product ID
     * @private
     * @param {number} productId - USB Product ID
     * @returns {string} Model name
     */
    _getModelFromProductId(productId) {
        switch (productId) {
            case HIDOCK_CONSTANTS.PRODUCT_IDS.H1:
                return "hidock-h1";
            case HIDOCK_CONSTANTS.PRODUCT_IDS.H1E:
                return "hidock-h1e";
            case HIDOCK_CONSTANTS.PRODUCT_IDS.P1:
                return "hidock-p1";
            default:
                return "unknown";
        }
    }

    /**
     * Start connection monitoring timer
     * @private
     */
    _startConnectionMonitoring() {
        const checkConnection = () => {
            if (!this.device?.opened) {
                try {
                    clearTimeout(this.connectionCheckTimer);
                    
                    // Clean up test audio element if it exists
                    const testAudio = document.getElementById("test_audio");
                    if (testAudio) {
                        testAudio.remove();
                    }

                    // Trigger disconnect callback
                    if (this.ondisconnect && !this.isStopConnectionCheck) {
                        this.ondisconnect();
                    }
                } catch (error) {
                    this.logger.error("jensen", "connectionCheck", `Error: ${error.message}`);
                }
            }

            this.connectionCheckTimer = setTimeout(checkConnection, HIDOCK_CONSTANTS.RECEIVE_TIMEOUT);
        };

        checkConnection();
    }

    /**
     * Check if device is connected
     * @returns {boolean} True if connected
     */
    isConnected() {
        return this.device != null;
    }

    /**
     * Get device model
     * @returns {string} Device model name
     */
    getModel() {
        return this.model;
    }

    /**
     * Disconnect from device
     */
    async disconnect() {
        this.logger.info("jensen", "disconnect", "Disconnecting from device");
        
        try {
            if (this.device) {
                await this.device.close();
            }
        } catch (error) {
            this.logger.error("jensen", "disconnect", `Error closing device: ${error.message}`);
        }
        
        this.device = null;
        this.isConnectedFlag = false;
    }

    /**
     * Send a command to the device
     * @param {JensenPacket} packet - Command packet to send
     * @param {number} timeout - Timeout in seconds (optional)
     * @param {Function} progressCallback - Progress callback (optional)
     * @returns {Promise} Promise that resolves with the response
     */
    send(packet, timeout, progressCallback) {
        // Set sequence ID and callbacks
        packet.sequence(this.sequenceId++);
        packet.onprogress = progressCallback;
        
        if (timeout) {
            packet.expireAfter(timeout);
        }

        // Add to command queue
        this.pendingCommands.push(packet);
        
        // Start processing queue
        this._processCommandQueue();
        
        // Return promise that will be resolved when response arrives
        return this._createCommandPromise(packet, timeout);
    }

    /**
     * Process the command queue
     * @private
     */
    async _processCommandQueue() {
        // If already processing a command, wait
        if (this.currentCommand) {
            return;
        }

        while (this.pendingCommands.length > 0) {
            const packet = this.pendingCommands.shift();
            const currentTime = new Date().getTime();
            
            // Skip expired commands
            if (packet.expireTime > 0 && packet.expireTime < currentTime) {
                this.logger.info("jensen", "sendNext", 
                    `Expired: cmd-${packet.command}-${packet.index}, ${COMMAND_NAMES[packet.command]}`);
                continue;
            }

            // Send the command
            await this._sendCommand(packet);
            break;
        }
    }

    /**
     * Send a single command packet
     * @private
     */
    async _sendCommand(packet) {
        const packetBytes = packet.make();
        this.currentCommand = `cmd-${packet.command}-${packet.index}`;
        
        this.logger.debug("jensen", "sendNext", 
            `Command: ${COMMAND_NAMES[packet.command]}, data bytes: ${packetBytes.byteLength}`);

        // Set timing - file transfers need longer waits
        this.timewait = (packet.command === COMMAND_CODES.TRANSFER_FILE || 
                        packet.command === COMMAND_CODES.GET_FILE_BLOCK) ? 1000 : 10;

        try {
            await this.device.transferOut(HIDOCK_CONSTANTS.ENDPOINT_OUT, packetBytes);
            
            // Report progress if callback provided
            if (packet.onprogress) {
                packet.onprogress(1, 1);
            }

            // Start receiving if not already receiving
            if (!this.isReceiving) {
                this._startReceiving();
            }
        } catch (error) {
            this.logger.error("jensen", "sendNext", `Transfer error: ${error.message}`);
            this.versionCode = null;
            this.versionNumber = null;
        }
    }

    /**
     * Create a promise for command response
     * @private
     */
    _createCommandPromise(packet, timeout) {
        const commandKey = `cmd-${packet.command}-${packet.index}`;
        
        const timeoutHandle = timeout ? setTimeout(() => {
            this._timeoutCommand(commandKey);
        }, timeout * 1000) : null;

        return new Promise((resolve, reject) => {
            this.pendingPromises[commandKey] = {
                tag: commandKey,
                resolve: resolve,
                reject: reject,
                timeout: timeoutHandle
            };
        });
    }

    /**
     * Trigger command completion
     * @private
     */
    _triggerCommandCompletion(response, commandId) {
        if (!this.currentCommand) {
            return;
        }

        // Check if this response matches the current command
        const expectedPrefix = this.currentCommand.substring(0, this.currentCommand.lastIndexOf("-"));
        const actualPrefix = `cmd-${commandId}`;

        this.logger.debug("jensen", "trigger", 
            `Trigger - ${expectedPrefix} <---> ${actualPrefix}`);

        if (expectedPrefix !== actualPrefix) {
            this.currentCommand = null;
            return;
        }

        // Find and resolve the pending promise
        if (this.currentCommand in this.pendingPromises) {
            const promise = this.pendingPromises[this.currentCommand];
            
            if (promise.timeout) {
                clearTimeout(promise.timeout);
            }
            
            promise.resolve(response);
            delete this.pendingPromises[this.currentCommand];
            this.currentCommand = null;
        } else {
            this.logger.debug("jensen", "trigger", "No action registered for command");
        }
    }

    /**
     * Handle command timeout
     * @private
     */
    _timeoutCommand(commandKey) {
        this.logger.debug("jensen", "timeout", `Timeout ${commandKey}`);
        
        if (commandKey in this.pendingPromises) {
            this.pendingPromises[commandKey].resolve(null);
            delete this.pendingPromises[commandKey];
        }
    }

    /**
     * Start receiving data from device
     * @private
     */
    _startReceiving() {
        if (!this.device || this.isReceiving) {
            return;
        }

        this.isReceiving = true;
        this._receiveData();
    }

    /**
     * Continuously receive data from device
     * @private
     */
    async _receiveData() {
        if (!this.device) {
            this.isReceiving = false;
            return;
        }

        try {
            const result = await this.device.transferIn(
                HIDOCK_CONSTANTS.ENDPOINT_IN, 
                HIDOCK_CONSTANTS.MAX_BUFFER_SIZE
            );
            
            this._processReceivedData(result);
        } catch (error) {
            this.logger.error("jensen", "receive", `Receive error: ${error.message}`);
        }
    }

    /**
     * Process received data
     * @private
     */
    _processReceivedData(result) {
        // Accumulate bytes transferred
        const bytesReceived = result.data?.byteLength || 0;
        
        // Add to receive buffer
        this.receiveBuffer = this._appendToBuffer(this.receiveBuffer, result.data);
        
        // Continue receiving
        this._receiveData();
        
        // Clear existing decode timeout and set new one
        if (this.decodeTimeout) {
            clearTimeout(this.decodeTimeout);
        }
        
        this.decodeTimeout = setTimeout(() => {
            this._decodeReceivedData();
        }, this.timewait);

        // Trigger receive callback if set
        if (this.onreceive) {
            try {
                this.onreceive(bytesReceived);
            } catch (error) {
                this.logger.error("jensen", "receive", `Receive callback error: ${error.message}`);
            }
        }
    }

    /**
     * Append new data to receive buffer
     * @private
     */
    _appendToBuffer(buffer, newData) {
        if (!newData) return buffer;
        
        const combined = new Uint8Array(buffer.length + newData.byteLength);
        combined.set(buffer);
        combined.set(new Uint8Array(newData), buffer.length);
        return combined;
    }

    /**
     * Decode received data and extract complete packets
     * @private
     */
    _decodeReceivedData() {
        let processingBuffer = new Uint8Array(HIDOCK_CONSTANTS.MAX_PACKET_SIZE);
        let bufferLength = 0;
        let parseError = false;

        // Copy all received chunks into processing buffer
        for (let chunkIndex = 0; chunkIndex < this.receiveBuffer.length; chunkIndex++) {
            processingBuffer[bufferLength++] = this.receiveBuffer[chunkIndex];
        }

        let parseOffset = 0;
        
        // Process all complete packets in buffer
        while (true) {
            let packet = null;
            
            try {
                packet = this._parsePacket(processingBuffer, parseOffset, bufferLength);
            } catch (error) {
                parseError = true;
                break;
            }

            if (!packet) {
                break; // No more complete packets
            }

            parseOffset += packet.length;
            const response = packet.message;
            
            // Log received packet (except file transfer data)
            if (response.id !== COMMAND_CODES.TRANSFER_FILE) {
                const commandName = COMMAND_NAMES[response.id] || "unknown";
                const bodyLength = response.body?.byteLength || 0;
                
                // Show first 32 bytes of response for debugging
                const debugBytes = [];
                for (let i = 0; i < Math.min(bodyLength, 32); i++) {
                    const byte = response.body[i] & 0xFF;
                    debugBytes.push("0" + byte.toString(16).replace(/^0(\w{2})$/gi, "$1"));
                }

                this.logger.debug("jensen", "receive", 
                    `Recv: ${commandName}, seq: ${response.sequence}, ` +
                    `data bytes: ${bodyLength}, data: ${debugBytes.join(" ")}`);
            }

            // Process the response
            try {
                const result = this._handleResponse(response);
                if (result) {
                    this._triggerCommandCompletion(result, response.id);
                }
            } catch (error) {
                this._triggerCommandCompletion(error, response.id);
                this.logger.error("jensen", "receive", 
                    `Recv: ${COMMAND_NAMES[response.id]}, seq: ${response.sequence}, error: ${error.message}`);
            }

            // Continue processing command queue
            this._processCommandQueue();
        }

        // Handle parse errors
        if (parseError) {
            const commandId = parseInt(this.currentCommand?.replace(/^cmd-(\d+)-(\d+)$/gi, "$1"));
            if (commandId) {
                try {
                    this._handleResponse(null, commandId);
                } catch (error) {
                    this._triggerCommandCompletion(error, commandId);
                    this.logger.error("jensen", "decode", `Decode error: ${error.message}`);
                }
                this._triggerCommandCompletion(null, commandId);
            }
            
            // Clear buffer on parse error
            this.receiveBuffer = new Uint8Array(0);
        } else {
            // Remove processed data from buffer
            const remainingLength = bufferLength - parseOffset;
            const remainingBuffer = new Uint8Array(remainingLength);
            for (let i = 0; i < remainingLength; i++) {
                remainingBuffer[i] = processingBuffer[parseOffset + i];
            }
            this.receiveBuffer = remainingBuffer;
        }
    }

    /**
     * Parse a single packet from the buffer
     * @private
     * @param {Uint8Array} buffer - Data buffer
     * @param {number} offset - Starting offset
     * @param {number} length - Buffer length
     * @returns {Object|null} Parsed packet or null if incomplete
     */
    _parsePacket(buffer, offset, length) {
        const remainingBytes = length - offset;
        
        // Need at least 12 bytes for header
        if (remainingBytes < 12) {
            return null;
        }

        // Check sync bytes
        if (buffer[offset] !== HIDOCK_CONSTANTS.PACKET_SYNC_BYTES[0] || 
            buffer[offset + 1] !== HIDOCK_CONSTANTS.PACKET_SYNC_BYTES[1]) {
            throw new Error("Invalid packet header - sync bytes not found");
        }

        let headerOffset = 2;
        
        // Parse command ID (16-bit big-endian)
        const commandId = this._read16BitBigEndian(buffer, offset + headerOffset);
        headerOffset += 2;

        // Parse sequence ID (32-bit big-endian)
        const sequenceId = this._read32BitBigEndian(buffer, offset + headerOffset);
        headerOffset += 4;

        // Parse body length with checksum (32-bit big-endian)
        const bodyLengthWithChecksum = this._read32BitBigEndian(buffer, offset + headerOffset);
        const checksumLength = (bodyLengthWithChecksum >> 24) & 0xFF;
        const bodyLength = bodyLengthWithChecksum & 0x00FFFFFF;
        headerOffset += 4;

        const totalPacketLength = 12 + bodyLength + checksumLength;

        // Check if we have the complete packet
        if (remainingBytes < totalPacketLength) {
            return null;
        }

        // Extract body data
        const body = buffer.slice(offset + headerOffset, offset + headerOffset + bodyLength);

        this.logger.debug("jensen", "parsePacket", 
            `CMD: ${commandId}, Seq: ${sequenceId}, BodyLen: ${bodyLength}`);

        return {
            message: new JensenResponse(commandId, sequenceId, body),
            length: totalPacketLength
        };
    }

    /**
     * Read 16-bit big-endian value from buffer
     * @private
     */
    _read16BitBigEndian(buffer, offset) {
        return ((buffer[offset] & 0xFF) << 8) | (buffer[offset + 1] & 0xFF);
    }

    /**
     * Read 32-bit big-endian value from buffer
     * @private
     */
    _read32BitBigEndian(buffer, offset) {
        return ((buffer[offset] & 0xFF) << 24) |
               ((buffer[offset + 1] & 0xFF) << 16) |
               ((buffer[offset + 2] & 0xFF) << 8) |
               (buffer[offset + 3] & 0xFF);
    }

    // ===========================================
    // BCD (Binary Coded Decimal) Utility Methods
    // ===========================================

    /**
     * Convert string to BCD (Binary Coded Decimal) format
     * Each decimal digit is encoded in 4 bits
     * @param {string} decimalString - String of decimal digits
     * @returns {number[]} Array of BCD bytes
     */
    to_bcd(decimalString) {
        const bcdBytes = [];
        
        for (let i = 0; i < decimalString.length; i += 2) {
            const highNibble = (decimalString.charCodeAt(i) - 48) & 0xFF;
            const lowNibble = (decimalString.charCodeAt(i + 1) - 48) & 0xFF;
            bcdBytes.push((highNibble << 4) | lowNibble);
        }
        
        return bcdBytes;
    }

    /**
     * Convert BCD bytes to decimal string
     * @param {...number} bcdBytes - BCD bytes to convert
     * @returns {string} Decimal string
     */
    from_bcd(...bcdBytes) {
        let result = "";
        
        for (const byte of bcdBytes) {
            const maskedByte = byte & 0xFF;
            result += ((maskedByte >> 4) & 0x0F).toString();
            result += (maskedByte & 0x0F).toString();
        }
        
        return result;
    }

    // =======================================
    // Command Implementation Methods
    // =======================================

    /**
     * Get device information (firmware version, serial number, etc.)
     * @param {number} timeout - Timeout in seconds
     * @returns {Promise} Promise resolving to device info
     */
    async getDeviceInfo(timeout) {
        return this.send(new JensenPacket(COMMAND_CODES.GET_DEVICE_INFO), timeout);
    }

    /**
     * Get device time
     * @param {number} timeout - Timeout in seconds
     * @returns {Promise} Promise resolving to device time
     */
    async getTime(timeout) {
        return this.send(new JensenPacket(COMMAND_CODES.GET_DEVICE_TIME), timeout);
    }

    /**
     * Set device time
     * @param {Date} date - Date to set
     * @param {number} timeout - Timeout in seconds
     * @returns {Promise} Promise resolving to operation result
     */
    async setTime(date, timeout) {
        const timeString = formatDateToBCD(date);
        const bcdBytes = this.to_bcd(timeString);
        
        return this.send(
            new JensenPacket(COMMAND_CODES.SET_DEVICE_TIME).body(bcdBytes), 
            timeout
        );
    }

    /**
     * Get file count on device
     * @param {number} timeout - Timeout in seconds
     * @returns {Promise} Promise resolving to file count
     */
    async getFileCount(timeout) {
        return this.send(new JensenPacket(COMMAND_CODES.GET_FILE_COUNT), timeout);
    }

    /**
     * List files on device
     * This is a complex operation that may require multiple packet exchanges
     * @returns {Promise} Promise resolving to file list
     */
    async listFiles() {
        const cacheKey = "filelist";
        
        // Return null if already processing
        if (this[cacheKey] != null) {
            return null;
        }

        // For older firmware versions, get file count first
        let fileCountResponse = null;
        if (this.versionNumber === undefined || this.versionNumber <= 327722) {
            fileCountResponse = await this.getFileCount(5);
            if (!fileCountResponse) {
                return null;
            }
        }

        // Return empty list if no files
        if (fileCountResponse && fileCountResponse.count === 0) {
            return null;
        }

        // Initialize file list cache
        this[cacheKey] = [];

        // Register handler for file list data
        Jensen.registerHandler(COMMAND_CODES.GET_FILE_LIST, (response, jensenInstance) => {
            if (response.body.length === 0) {
                jensenInstance[cacheKey] = null;
                return [];
            }

            jensenInstance[cacheKey].push(response.body);
            
            // Parse accumulated file data
            const files = this._parseFileListData(jensenInstance[cacheKey]);
            const expectedCount = fileCountResponse ? fileCountResponse.count : -1;
            
            // Check if we have all files
            if ((fileCountResponse && files.length >= fileCountResponse.count) ||
                (expectedCount > -1 && files.length >= expectedCount)) {
                jensenInstance[cacheKey] = null;
                return files.filter(file => !!file.time);
            }
            
            return undefined; // Continue receiving
        });

        return this.send(new JensenPacket(COMMAND_CODES.GET_FILE_LIST));
    }

    /**
     * Parse file list data from multiple response chunks
     * @private
     */
    _parseFileListData(chunks) {
        const files = [];
        const allBytes = [];
        let totalFileCount = -1;
        let parseOffset = 0;

        // Combine all chunks into a single byte array
        for (const chunk of chunks) {
            for (let i = 0; i < chunk.length; i++) {
                allBytes.push(chunk[i]);
            }
        }

        // Check for header with total file count
        if (allBytes.length >= 6 && 
            (allBytes[0] & 0xFF) === 0xFF && 
            (allBytes[1] & 0xFF) === 0xFF) {
            totalFileCount = ((allBytes[2] & 0xFF) << 24) |
                           ((allBytes[3] & 0xFF) << 16) |
                           ((allBytes[4] & 0xFF) << 8) |
                           (allBytes[5] & 0xFF);
            parseOffset = 6;
        }

        // Parse individual file entries
        while (parseOffset < allBytes.length) {
            const fileInfo = this._parseFileEntry(allBytes, parseOffset);
            if (!fileInfo) break;
            
            files.push(fileInfo.file);
            parseOffset = fileInfo.nextOffset;
            
            if (totalFileCount !== -1 && files.length >= totalFileCount) {
                break;
            }
        }

        return files;
    }

    /**
     * Parse a single file entry from the file list data
     * @private
     */
    _parseFileEntry(bytes, offset) {
        if (offset + 4 >= bytes.length) return null;

        // File version (1 byte)
        const fileVersion = bytes[offset] & 0xFF;
        offset += 1;

        // Filename length (3 bytes, big-endian)
        const nameLength = ((bytes[offset] & 0xFF) << 16) |
                          ((bytes[offset + 1] & 0xFF) << 8) |
                          (bytes[offset + 2] & 0xFF);
        offset += 3;

        if (offset + nameLength > bytes.length) return null;

        // Extract filename
        const filenameChars = [];
        for (let i = 0; i < nameLength && offset < bytes.length; i++) {
            const byte = bytes[offset++] & 0xFF;
            if (byte > 0) {
                filenameChars.push(String.fromCharCode(byte));
            }
        }

        const minRemainingBytes = 4 + 6 + 16; // file length + skip + signature
        if (offset + minRemainingBytes > bytes.length) return null;

        // File length (4 bytes, big-endian)
        const fileLength = ((bytes[offset] & 0xFF) << 24) |
                          ((bytes[offset + 1] & 0xFF) << 16) |
                          ((bytes[offset + 2] & 0xFF) << 8) |
                          (bytes[offset + 3] & 0xFF);
        offset += 4;

        // Skip 6 bytes
        offset += 6;

        // Skip signature (16 bytes)
        const signature = [];
        for (let i = 0; i < 16; i++) {
            const byte = (bytes[offset++] & 0xFF).toString(16);
            signature.push(byte.length === 1 ? "0" + byte : byte);
        }

        const filename = filenameChars.join("");
        const duration = this._calculateFileDuration(fileVersion, fileLength);
        const createTime = this._parseFilenameDate(filename);

        const formatTime = (num) => num > 9 ? num.toString() : "0" + num;
        
        let createDate = "";
        let createTimeStr = "";
        
        if (createTime) {
            createDate = `${createTime.getFullYear()}/${formatTime(createTime.getMonth() + 1)}/${formatTime(createTime.getDate())}`;
            createTimeStr = `${formatTime(createTime.getHours())}:${formatTime(createTime.getMinutes())}:${formatTime(createTime.getSeconds())}`;
        }

        return {
            file: {
                name: filename,
                createDate: createDate,
                createTime: createTimeStr,
                time: createTime,
                duration: duration,
                version: fileVersion,
                length: fileLength,
                signature: signature.join("")
            },
            nextOffset: offset
        };
    }

    /**
     * Calculate file duration based on version and length
     * @private
     */
    _calculateFileDuration(version, length) {
        switch (version) {
            case 1:
                return (length / 32) * 2;
            case 2:
                return length > 44 ? (length - 44) / (48000 * 2 * 1) : 0;
            case 3:
                return length > 44 ? (length - 44) / (24000 * 2 * 1) : 0;
            case 5:
                return length / 12000;
            default:
                return length / (16000 * 2 * 1);
        }
    }

    /**
     * Parse date from filename
     * @private
     */
    _parseFilenameDate(filename) {
        try {
            // Try format: YYYYMMDDHHMMSS
            if (filename.length >= 14 && filename.slice(0, 14).match(/^\d{14}$/)) {
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
                const monthMap = {
                    'Jan': 0, 'Feb': 1, 'Mar': 2, 'Apr': 3, 'May': 4, 'Jun': 5,
                    'Jul': 6, 'Aug': 7, 'Sep': 8, 'Oct': 9, 'Nov': 10, 'Dec': 11
                };
                const month = monthMap[monthStr];
                if (month !== undefined) {
                    return new Date(
                        parseInt(year), month, parseInt(day),
                        parseInt(hour), parseInt(minute), parseInt(second)
                    );
                }
            }
        } catch (error) {
            this.logger.debug("jensen", "parseDate", `Date parse error for '${filename}': ${error.message}`);
        }

        return new Date(); // Fallback to current date
    }

    /**
     * Delete a file from the device
     * @param {string} filename - Name of file to delete
     * @param {number} timeout - Timeout in seconds
     * @returns {Promise} Promise resolving to operation result
     */
    async deleteFile(filename, timeout) {
        const filenameBytes = [];
        for (let i = 0; i < filename.length; i++) {
            filenameBytes.push(filename.charCodeAt(i));
        }
        
        return this.send(
            new JensenPacket(COMMAND_CODES.DELETE_FILE).body(filenameBytes),
            timeout
        );
    }

    /**
     * Stream a file from the device
     * @param {string} filename - Name of file to stream
     * @param {number} fileLength - Expected file length
     * @param {Function} dataCallback - Callback for received data chunks
     * @param {Function} progressCallback - Progress callback
     * @returns {Promise} Promise resolving when streaming completes
     */
    async streaming(filename, fileLength, dataCallback, progressCallback) {
        if (typeof fileLength !== "number") {
            throw new Error("Parameter 'length' required");
        }
        if (fileLength <= 0) {
            throw new Error("Parameter 'length' must greater than zero");
        }

        this.logger.info("jensen", "streaming", 
            `File download start. filename: ${filename}, length: ${fileLength}`);

        const filenameBytes = [];
        for (let i = 0; i < filename.length; i++) {
            filenameBytes.push(filename.charCodeAt(i));
        }

        let receivedBytes = 0;
        this.onreceive = progressCallback;

        // Register handler for streaming data
        Jensen.registerHandler(COMMAND_CODES.TRANSFER_FILE, (response) => {
            if (response != null) {
                receivedBytes += response.body.length || response.body.byteLength;
                dataCallback(response.body);
                
                this.logger.info("jensen", "streaming length", `${fileLength} ${receivedBytes}`);
                
                if (receivedBytes >= fileLength) {
                    this.logger.info("jensen", "streaming", "File download finish.");
                    return "OK";
                }
            } else {
                this.logger.info("jensen", "streaming", "File download fail.");
                dataCallback("fail");
            }
        });

        return this.send(new JensenPacket(COMMAND_CODES.TRANSFER_FILE).body(filenameBytes));
    }

    /**
     * Get device settings
     * @param {number} timeout - Timeout in seconds
     * @returns {Promise} Promise resolving to device settings
     */
    async getSettings(timeout) {
        // Check firmware version compatibility
        if ((this.model === "hidock-h1" || this.model === "hidock-h1e") && 
            this.versionNumber < 327714) {
            return { autoRecord: false, autoPlay: false };
        }
        
        return this.send(new JensenPacket(COMMAND_CODES.GET_SETTINGS), timeout);
    }

    /**
     * Set auto-record setting
     * @param {boolean} enabled - Enable/disable auto-record
     * @param {number} timeout - Timeout in seconds
     * @returns {Promise} Promise resolving to operation result
     */
    setAutoRecord(enabled, timeout) {
        if ((this.model === "hidock-h1" || this.model === "hidock-h1e") && 
            this.versionNumber < 327714) {
            return { result: false };
        }
        
        return this.send(
            new JensenPacket(COMMAND_CODES.SET_SETTINGS).body([0, 0, 0, enabled ? 1 : 2]),
            timeout
        );
    }

    /**
     * Set auto-play setting
     * @param {boolean} enabled - Enable/disable auto-play
     * @param {number} timeout - Timeout in seconds
     * @returns {Promise} Promise resolving to operation result
     */
    setAutoPlay(enabled, timeout) {
        if ((this.model === "hidock-h1" || this.model === "hidock-h1e") && 
            this.versionNumber < 327714) {
            return { result: false };
        }
        
        return this.send(
            new JensenPacket(COMMAND_CODES.SET_SETTINGS).body([0, 0, 0, 0, 0, 0, 0, enabled ? 1 : 2]),
            timeout
        );
    }

    /**
     * Set notification sound setting
     * @param {boolean} enabled - Enable/disable notification sound
     * @param {number} timeout - Timeout in seconds
     * @returns {Promise} Promise resolving to operation result
     */
    setNotification(enabled, timeout) {
        if ((this.model === "hidock-h1" || this.model === "hidock-h1e") && 
            this.versionNumber < 327714) {
            return { result: false };
        }
        
        return this.send(
            new JensenPacket(COMMAND_CODES.SET_SETTINGS).body([0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, enabled ? 1 : 2]),
            timeout
        );
    }

    /**
     * Set Bluetooth prompt play setting
     * @param {boolean} enabled - Enable/disable Bluetooth prompt play
     * @param {number} timeout - Timeout in seconds
     * @returns {Promise} Promise resolving to operation result
     */
    setBluetoothPromptPlay(enabled, timeout) {
        const isCompatible = (this.model === "hidock-h1e" && this.versionNumber >= 393476) ||
                            (this.model === "hidock-h1" && this.versionNumber >= 327940);
        
        if (!isCompatible) {
            return { result: false };
        }
        
        const bodyBytes = new Array(16).fill(0);
        bodyBytes[15] = enabled ? 2 : 1;
        
        return this.send(
            new JensenPacket(COMMAND_CODES.SET_SETTINGS).body(bodyBytes),
            timeout
        );
    }

    /**
     * Get storage card information
     * @param {number} timeout - Timeout in seconds
     * @returns {Promise} Promise resolving to card info
     */
    getCardInfo(timeout) {
        if ((this.model === "hidock-h1" || this.model === "hidock-h1e") && 
            this.versionNumber < 327733) {
            return null;
        }
        
        return this.send(new JensenPacket(COMMAND_CODES.GET_CARD_INFO), timeout);
    }

    /**
     * Format storage card
     * @param {number} timeout - Timeout in seconds
     * @returns {Promise} Promise resolving to operation result
     */
    formatCard(timeout) {
        if ((this.model === "hidock-h1" || this.model === "hidock-h1e") && 
            this.versionNumber < 327733) {
            return null;
        }
        
        return this.send(
            new JensenPacket(COMMAND_CODES.FORMAT_CARD).body([1, 2, 3, 4]),
            timeout
        );
    }

    /**
     * Factory reset device
     * @param {number} timeout - Timeout in seconds
     * @returns {Promise} Promise resolving to operation result
     */
    async factoryReset(timeout) {
        const isCompatible = (this.model === "hidock-h1" || this.model === "hidock-h1e") &&
                            this.versionNumber >= 327705;
        
        if (!isCompatible) {
            return null;
        }
        
        return this.send(new JensenPacket(COMMAND_CODES.FACTORY_RESET), timeout);
    }

    /**
     * Send meeting schedule information to device
     * @param {Array} schedules - Array of meeting schedule objects
     * @returns {Promise} Promise resolving to operation result
     */
    sendScheduleInfo(schedules) {
        if (Array.isArray(schedules) && schedules.length) {
            let scheduleBytes = [];
            
            for (const schedule of schedules) {
                // Default to empty 34-byte array
                let platformBytes = new Array(34).fill(0);
                
                // Get platform-specific shortcuts if available
                if (MEETING_SHORTCUTS[schedule.platform] && 
                    MEETING_SHORTCUTS[schedule.platform][schedule.os]) {
                    platformBytes = MEETING_SHORTCUTS[schedule.platform][schedule.os];
                }

                // Convert dates to BCD format
                let startDateBytes = new Array(8).fill(0);
                let endDateBytes = new Array(8).fill(0);
                
                if (schedule.startDate && schedule.endDate) {
                    const startBCD = hexStringToBytes(formatDateToBCD(schedule.startDate));
                    const endBCD = hexStringToBytes(formatDateToBCD(schedule.endDate));
                    startDateBytes = [...startBCD, 0];
                    endDateBytes = [...endBCD, 0];
                }

                const reservedBytes = [0, 0];
                scheduleBytes = scheduleBytes.concat([
                    ...startDateBytes,
                    ...endDateBytes, 
                    ...reservedBytes,
                    ...platformBytes
                ]);
            }
            
            return this.send(new JensenPacket(COMMAND_CODES.SEND_MEETING_SCHEDULE).body(scheduleBytes));
        } else {
            // Send empty schedule (clear all)
            const emptySchedule = new Array(52).fill(0);
            return this.send(new JensenPacket(COMMAND_CODES.SEND_MEETING_SCHEDULE).body(emptySchedule));
        }
    }

    // =======================================
    // Bluetooth Operations (P1 model only)
    // =======================================

    /**
     * Scan for Bluetooth devices (P1 model only)
     * @param {number} timeout - Timeout in seconds (default: 20)
     * @returns {Promise} Promise resolving to device list
     */
    async scanDevices(timeout = 20) {
        if (this.model !== "hidock-p1") {
            return null;
        }
        
        return this.send(new JensenPacket(COMMAND_CODES.BLUETOOTH_SCAN), timeout);
    }

    /**
     * Connect to Bluetooth device (P1 model only)
     * @param {string} macAddress - MAC address in format "XX-XX-XX-XX-XX-XX"
     * @param {number} timeout - Timeout in seconds
     * @returns {Promise} Promise resolving to operation result
     */
    async connectBTDevice(macAddress, timeout) {
        if (this.model !== "hidock-p1") {
            return null;
        }

        const macParts = macAddress.split("-");
        if (macParts.length !== 6) {
            throw new Error("Invalid MAC address format");
        }

        const macBytes = [];
        for (const part of macParts) {
            macBytes.push(parseInt(part, 16));
        }

        return this.send(
            new JensenPacket(COMMAND_CODES.BLUETOOTH_CMD).body([0, ...macBytes]),
            timeout
        );
    }

    /**
     * Disconnect Bluetooth device (P1 model only)
     * @param {number} timeout - Timeout in seconds
     * @returns {Promise} Promise resolving to operation result
     */
    async disconnectBTDevice(timeout) {
        if (this.model !== "hidock-p1") {
            return null;
        }
        
        return this.send(
            new JensenPacket(COMMAND_CODES.BLUETOOTH_CMD).body([1]),
            timeout
        );
    }

    /**
     * Get Bluetooth status (P1 model only)
     * @param {number} timeout - Timeout in seconds
     * @returns {Promise} Promise resolving to Bluetooth status
     */
    async getBluetoothStatus(timeout) {
        if (this.model !== "hidock-p1") {
            return null;
        }
        
        return this.send(new JensenPacket(COMMAND_CODES.BLUETOOTH_STATUS), timeout);
    }

    // =======================================
    // Response Handler Registration System
    // =======================================

    /**
     * Initialize command response handlers
     * @private
     */
    _initializeCommandHandlers() {
        // Response handlers are registered here
        this._registerAllHandlers();
    }

    /**
     * Register all response handlers
     * @private
     */
    _registerAllHandlers() {
        // Generic success/failure response handler
        const simpleStatusHandler = (response) => ({
            result: response.body[0] === 0 ? "success" : "failed"
        });

        // Device info response handler
        Jensen.registerHandler(COMMAND_CODES.GET_DEVICE_INFO, (response, jensenInstance) => {
            const versionBytes = [];
            let versionNumber = 0;
            const serialBytes = [];

            // Parse version information (first 4 bytes)
            for (let i = 0; i < 4; i++) {
                const byte = response.body[i] & 0xFF;
                if (i > 0) versionBytes.push(String(byte));
                versionNumber |= byte << (8 * (4 - i - 1));
            }

            // Parse serial number (next 16 bytes)
            for (let i = 0; i < 16; i++) {
                const byte = response.body[i + 4];
                if (byte > 0) {
                    serialBytes.push(String.fromCharCode(byte));
                }
            }

            const versionCode = versionBytes.join(".");
            const serialNumber = serialBytes.join("");

            // Update instance properties
            jensenInstance.versionCode = versionCode;
            jensenInstance.versionNumber = versionNumber;
            jensenInstance.serialNumber = serialNumber;

            return {
                versionCode: versionCode,
                versionNumber: versionNumber,
                sn: serialNumber
            };
        });

        // Device time response handler
        Jensen.registerHandler(COMMAND_CODES.GET_DEVICE_TIME, (response, jensenInstance) => {
            const timeString = jensenInstance.from_bcd(
                response.body[0] & 0xFF, response.body[1] & 0xFF,
                response.body[2] & 0xFF, response.body[3] & 0xFF,
                response.body[4] & 0xFF, response.body[5] & 0xFF,
                response.body[6] & 0xFF
            );

            return {
                time: timeString === "00000000000000" ? "unknown" :
                    timeString.replace(/^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})$/gi, "$1-$2-$3 $4:$5:$6")
            };
        });

        // File count response handler
        Jensen.registerHandler(COMMAND_CODES.GET_FILE_COUNT, (response) => {
            if (response.body.length === 0) {
                return { count: 0 };
            }

            let count = 0;
            for (let i = 0; i < 4; i++) {
                count |= (response.body[i] & 0xFF) << (8 * (4 - i - 1));
            }

            return { count: count };
        });

        // Device settings response handler
        Jensen.registerHandler(COMMAND_CODES.GET_SETTINGS, (response) => {
            const settings = {
                autoRecord: response.body[3] === 1,
                autoPlay: response.body[7] === 1,
                bluetoothTone: response.body[15] !== 1,
            };

            if (response.body.length >= 12) {
                settings.notification = response.body[11] === 1;
            }

            return settings;
        });

        // Delete file response handler
        Jensen.registerHandler(COMMAND_CODES.DELETE_FILE, (response) => {
            let result = "failed";
            
            switch (response.body[0]) {
                case 0: result = "success"; break;
                case 1: result = "not-exists"; break;
                case 2: result = "failed"; break;
            }

            return { result: result };
        });

        // Card info response handler
        Jensen.registerHandler(COMMAND_CODES.GET_CARD_INFO, (response) => {
            let offset = 0;
            
            return {
                used: ((response.body[offset++] & 0xFF) << 24) |
                      ((response.body[offset++] & 0xFF) << 16) |
                      ((response.body[offset++] & 0xFF) << 8) |
                      (response.body[offset++] & 0xFF),
                capacity: ((response.body[offset++] & 0xFF) << 24) |
                         ((response.body[offset++] & 0xFF) << 16) |
                         ((response.body[offset++] & 0xFF) << 8) |
                         (response.body[offset++] & 0xFF),
                status: (((response.body[offset++] & 0xFF) << 24) |
                        ((response.body[offset++] & 0xFF) << 16) |
                        ((response.body[offset++] & 0xFF) << 8) |
                        (response.body[offset++] & 0xFF)).toString(16)
            };
        });

        // Bluetooth scan response handler
        Jensen.registerHandler(COMMAND_CODES.BLUETOOTH_SCAN, (response) => {
            const deviceCount = ((response.body[0] & 0xFF) << 8) | (response.body[1] & 0xFF);
            const devices = [];
            const decoder = new TextDecoder("UTF-8");
            let offset = 2;

            for (let i = 0; i < deviceCount; i++) {
                const nameLength = ((response.body[offset++] & 0xFF) << 8) | (response.body[offset++] & 0xFF);
                const nameBytes = new Uint8Array(nameLength);
                
                for (let j = 0; j < nameLength; j++) {
                    nameBytes[j] = response.body[offset++] & 0xFF;
                }

                const macBytes = [];
                for (let j = 0; j < 6; j++) {
                    const byte = (response.body[offset++] & 0xFF).toString(16).toUpperCase();
                    macBytes.push(byte.length === 1 ? "0" + byte : byte);
                }

                devices.push({
                    name: decoder.decode(nameBytes),
                    mac: macBytes.join("-")
                });
            }

            return devices;
        });

        // Bluetooth status response handler
        Jensen.registerHandler(COMMAND_CODES.BLUETOOTH_STATUS, (response) => {
            if (response.body.length === 0) {
                return { status: "disconnected" };
            }
            
            if (response.body[0] === 1) {
                return { status: "disconnected" };
            }

            const nameLength = ((response.body[1] & 0xFF) << 8) | (response.body[2] & 0xFF);
            const decoder = new TextDecoder("UTF-8");
            const nameBytes = new Uint8Array(nameLength);
            let offset = 3;

            for (let i = 0; offset < response.body.length && i < nameLength; i++, offset++) {
                nameBytes[i] = response.body[offset] & 0xFF;
            }

            const macBytes = [];
            for (let i = 0; offset < response.body.length && i < 6; i++) {
                const byte = response.body[offset++].toString(16).toUpperCase();
                macBytes.push(byte.length === 1 ? "0" + byte : byte);
            }

            return {
                status: "connected",
                mac: macBytes.join("-"),
                name: decoder.decode(nameBytes),
                a2dp: (response.body[offset++] & 0xFF) === 1,
                hfp: (response.body[offset++] & 0xFF) === 1,
                avrcp: (response.body[offset++] & 0xFF) === 1,
                battery: parseInt(((response.body[offset++] & 0xFF) / 255) * 100)
            };
        });

        // Register simple status handlers for various commands
        const statusCommands = [
            COMMAND_CODES.SET_DEVICE_TIME,
            COMMAND_CODES.DEVICE_MSG_TEST,
            COMMAND_CODES.SET_SETTINGS,
            COMMAND_CODES.FACTORY_RESET,
            COMMAND_CODES.RESTORE_FACTORY_SETTINGS,
            COMMAND_CODES.FORMAT_CARD,
            COMMAND_CODES.FIRMWARE_UPLOAD,
            COMMAND_CODES.RECORD_TEST_START,
            COMMAND_CODES.RECORD_TEST_END,
            COMMAND_CODES.GET_FILE_BLOCK,
            COMMAND_CODES.TEST_SN_WRITE,
            COMMAND_CODES.SEND_MEETING_SCHEDULE,
            COMMAND_CODES.BLUETOOTH_CMD,
            COMMAND_CODES.UPDATE_TONE,
            COMMAND_CODES.CONTROL_REALTIME,
        ];

        for (const commandCode of statusCommands) {
            Jensen.registerHandler(commandCode, simpleStatusHandler);
        }
    }

    /**
     * Handle a response from the device
     * @private
     */
    _handleResponse(response, commandId) {
        if (!response) {
            return null;
        }

        const handler = Jensen.handlers[response.id];
        if (handler) {
            return handler(response, this);
        }

        this.logger.debug("jensen", "handleResponse", `No handler for command ${response.id}`);
        return response;
    }

    /**
     * Debug method to dump internal state
     */
    dump() {
        // Implementation for debugging purposes
        console.log("Jensen instance state:", {
            device: this.device,
            model: this.model,
            connected: this.isConnectedFlag,
            versionCode: this.versionCode,
            versionNumber: this.versionNumber,
            serialNumber: this.serialNumber,
            pendingCommands: this.pendingCommands.length,
            currentCommand: this.currentCommand
        });
    }
}

/**
 * Static method to register response handlers
 * @param {number} commandId - Command ID to register handler for
 * @param {Function} handler - Handler function
 */
Jensen.registerHandler = function(commandId, handler) {
    if (Jensen.handlers === undefined) {
        Jensen.handlers = {};
    }
    Jensen.handlers[commandId] = handler;
};

// Export the Jensen class as the main export
export { Jensen as J };

// Export other utilities for advanced use
export { 
    JensenLogger, 
    JensenPacket, 
    JensenResponse, 
    COMMAND_CODES, 
    COMMAND_NAMES, 
    HIDOCK_CONSTANTS,
    formatDateToBCD,
    hexStringToBytes 
};