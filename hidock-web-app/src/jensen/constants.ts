/**
 * @fileoverview
 * This file contains all the constants, magic numbers, and enumerations
 * for the Jensen protocol and HiDock device communication.
 */

/**
 * HiDock Device Constants and Magic Numbers
 */
export const HIDOCK_CONSTANTS = {
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
export const COMMAND_CODES = {
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
export const COMMAND_NAMES: { [key: number]: string } = {
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
export const HID_KEY_CODES: { [key: string]: number } = {
    CUSTOM_1: 1,
    A: 4, B: 5, C: 6, D: 7, E: 8, F: 9, G: 10, H: 11, I: 12, J: 13,
    K: 14, L: 15, M: 16, N: 17, O: 18, P: 19, Q: 20, R: 21, S: 22,
    T: 23, U: 24, V: 25, W: 26, X: 27, Y: 28, Z: 27,
    ENTER: 40,
    ESCAPE: 41,
    SPACE: 44,
};

/**
 * Empty 8-byte array for padding/unused slots in HID reports
 */
export const EMPTY_BYTES = [0, 0, 0, 0, 0, 0, 0, 0];
