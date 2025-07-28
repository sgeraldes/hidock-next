# HiDock Protocol Reference Manual

## Overview

The HiDock Protocol (also known as "Jensen Protocol") is a custom binary communication protocol used for interfacing with HiDock recording devices over USB. This protocol enables comprehensive device management, file operations, settings configuration, and advanced features like Bluetooth connectivity and meeting integrations.

## Table of Contents

- [Device Models](#device-models)
- [Protocol Structure](#protocol-structure)
- [Connection Management](#connection-management)
- [Command Reference](#command-reference)
- [Response Handlers](#response-handlers)
- [Data Formats](#data-formats)
- [Error Handling](#error-handling)
- [Code Examples](#code-examples)

## Device Models

### Supported Models

| Model      | Product ID | USB ID | Hex ID | Description               |
| ---------- | ---------- | ------ | ------ | ------------------------- |
| HiDock H1  | 45068      | 0xB00C | 0xB00C | Basic recording device    |
| HiDock H1E | 45069      | 0xB00D | 0xB00D | Enhanced recording device |
| HiDock P1  | 45070      | 0xB00E | 0xB00E | Pro model with Bluetooth  |

### USB Configuration

- **Vendor ID**: 0x10E6 (4310 decimal)
- **USB Configuration**: 1
- **Interface Number**: 0
- **Alternate Setting**: 0
- **Endpoint OUT**: 1 (for sending data to device)
- **Endpoint IN**: 2 (for receiving data from device)

## Protocol Structure

### Packet Format

All HiDock protocol packets follow this 12+ byte structure:

```
Offset | Size | Field | Description
-------|------|-------|-------------
0-1    | 2    | Sync  | Magic bytes: 0x12, 0x34
2-3    | 2    | CMD   | Command ID (16-bit big-endian)
4-7    | 4    | SEQ   | Sequence ID (32-bit big-endian)
8-11   | 4    | LEN   | Body length (32-bit big-endian)
12+    | N    | BODY  | Command payload (N bytes)
```

### Constants

```javascript
const HIDOCK_CONSTANTS = {
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
```

## Connection Management

### Basic Connection Flow

1. **Initialize WebUSB**: Check browser support and request device access
2. **Device Discovery**: Scan for HiDock devices by vendor ID
3. **USB Setup**: Configure interface and claim exclusive access
4. **Model Detection**: Determine device model from product ID
5. **Communication**: Start command/response cycle

### Connection Methods

#### `async init()`

Initialize WebUSB connection and attempt auto-connect.

#### `async connect()`

Request user permission and connect to selected device.

#### `async tryconnect(silent = false)`

Attempt connection to previously authorized device.

#### `async disconnect()`

Close USB connection and cleanup resources.

#### `isConnected()`

Check current connection status.

## Complete Protocol Specification

### All Command Codes Table

| Command | Hex Code | Description | Request Format | Response Format |
|---------|----------|-------------|----------------|-----------------|
| INVALID | 0x00 | Invalid command | - | - |
| GET_DEVICE_INFO | 0x01 | Get device information | No payload | 20 bytes (version + serial) |
| GET_DEVICE_TIME | 0x02 | Get device time | No payload | 7 bytes BCD |
| SET_DEVICE_TIME | 0x03 | Set device time | 7 bytes BCD | Status byte |
| GET_FILE_LIST | 0x04 | Get file listing | No payload | Multi-packet file data |
| TRANSFER_FILE | 0x05 | Download file | Filename (ASCII) | File data chunks |
| GET_FILE_COUNT | 0x06 | Get file count | No payload | 4 bytes count |
| DELETE_FILE | 0x07 | Delete file | Filename (ASCII) | Status byte |
| REQUEST_FIRMWARE_UPGRADE | 0x08 | Request FW upgrade | 8 bytes (size + version) | Status byte |
| FIRMWARE_UPLOAD | 0x09 | Upload FW chunk | Firmware data | Status byte |
| DEVICE_MSG_TEST | 0x0A | Device message test | Variable | Status byte |
| GET_SETTINGS | 0x0B | Get device settings | No payload | Settings structure |
| SET_SETTINGS | 0x0C | Set device settings | Settings data | Status byte |
| GET_FILE_BLOCK | 0x0D | Get file block | 4 bytes size + filename | File data |
| GET_CARD_INFO | 0x10 | Get storage info | No payload | 12 bytes card info |
| FORMAT_CARD | 0x11 | Format storage | 4 bytes (0x01020304) | Status byte |
| GET_RECORDING_FILE | 0x12 | Get recording info | No payload | Recording filename |
| RESTORE_FACTORY_SETTINGS | 0x13 | Restore factory | 4 bytes (0x01020304) | Status byte |
| SEND_MEETING_SCHEDULE | 0x14 | Send meeting data | Schedule structure | Status byte |
| READ_FILE_PART | 0x15 | Read file part | 8 bytes + filename | File data |
| REQUEST_TONE_UPDATE | 0x16 | Request tone update | Hash + size | Status byte |
| UPDATE_TONE | 0x17 | Upload tone data | Tone data | Status byte |
| REQUEST_UAC_UPDATE | 0x18 | Request UAC update | Hash + size | Status byte |
| UPDATE_UAC | 0x19 | Upload UAC data | UAC data | Status byte |
| GET_REALTIME_SETTINGS | 0x20 | Get realtime settings | No payload | Settings data |
| CONTROL_REALTIME | 0x21 | Control realtime | 8 bytes control | Status byte |
| GET_REALTIME_DATA | 0x22 | Get realtime data | 4 bytes request | Realtime data |
| BLUETOOTH_SCAN | 0x1001 | Scan BT devices | No payload | Device list |
| BLUETOOTH_CMD | 0x1002 | BT connect/disconnect | Command + MAC | Status byte |
| BLUETOOTH_STATUS | 0x1003 | Get BT status | No payload | Connection info |
| GET_REALTIME_SETTINGS | 0x20 | Get realtime settings | No payload | Settings data |
| CONTROL_REALTIME | 0x21 | Control realtime | 8 bytes control | Status byte |
| GET_REALTIME_DATA | 0x22 | Get realtime data | 4 bytes request | Realtime data |
| FACTORY_RESET | 0xF00B | Factory reset | No payload | Status byte |
| TEST_SN_WRITE | 0xF007 | Test SN write | Serial number | Status byte |
| RECORD_TEST_START | 0xF008 | Start record test | Test mode | Status byte |
| RECORD_TEST_END | 0xF009 | End record test | Test mode | Status byte |

### Protocol Magic Numbers and Constants

#### Core Protocol Constants
```javascript
const PROTOCOL_CONSTANTS = {
    // Packet sync bytes - must be present at start of every packet
    SYNC_BYTE_1: 0x12,
    SYNC_BYTE_2: 0x34,
    
    // Packet structure sizes
    HEADER_SIZE: 12,                    // Bytes: sync(2) + cmd(2) + seq(4) + len(4)
    MIN_PACKET_SIZE: 12,               // Minimum valid packet size
    MAX_PACKET_SIZE: 102400,           // 100KB maximum packet size
    MAX_BUFFER_SIZE: 51200,            // 50KB USB transfer buffer
    
    // Protocol timing
    RECEIVE_TIMEOUT: 100,              // 100ms between receive attempts
    FILE_TRANSFER_WAIT: 1000,          // 1000ms wait for file transfers
    COMMAND_WAIT: 10,                  // 10ms wait for regular commands
    
    // USB endpoint addresses
    ENDPOINT_OUT: 1,                   // Host to device endpoint
    ENDPOINT_IN: 2,                    // Device to host endpoint
    
    // Device identification
    USB_VENDOR_ID: 0x10E6,            // HiDock USB Vendor ID (4310 decimal)
    
    // File processing constants
    MAX_LOG_ENTRIES: 15000,           // Maximum log entries in circular buffer
    FILE_LIST_HEADER_SIZE: 6,         // Size of file list header (if present)
    FILE_ENTRY_MIN_SIZE: 23,          // Minimum file entry size
    SIGNATURE_SIZE: 16,               // File signature size in bytes
    
    // Format constants
    BCD_DATETIME_SIZE: 7,             // BCD date/time: YYYYMMDDHHMMSS
    WAV_HEADER_SIZE: 44,              // Standard WAV file header size
    MEETING_SCHEDULE_ENTRY_SIZE: 52,  // Size of single meeting schedule entry
    MEETING_SHORTCUT_SIZE: 34,        // Size of keyboard shortcut data
    MEETING_DATE_SIZE: 8,             // BCD date size with padding
    
    // Factory reset/format magic bytes
    FACTORY_RESET_MAGIC: [0x01, 0x02, 0x03, 0x04], // Magic bytes for destructive operations
};
```

#### Firmware Version Compatibility Constants
```javascript
const VERSION_REQUIREMENTS = {
    // Decimal version numbers for feature compatibility
    SETTINGS_MIN_VERSION: 327714,      // 5.0.0 - Minimum version for settings management
    FACTORY_RESET_MIN_VERSION: 327705, // 5.0.9 - Minimum version for factory reset
    STORAGE_MIN_VERSION: 327733,       // 5.0.21 - Minimum version for storage operations
    BT_PROMPT_H1_MIN: 327940,          // 5.0.244 - H1 Bluetooth prompt minimum version
    BT_PROMPT_H1E_MIN: 393476,         // 6.0.260 - H1E Bluetooth prompt minimum version
    FACTORY_SETTINGS_H1_MIN: 327944,   // 5.0.248 - H1 factory settings minimum
    FACTORY_SETTINGS_H1E_MIN: 393476,  // 6.0.4 - H1E factory settings minimum
    FILE_LIST_VERSION_THRESHOLD: 327722, // Version where file count is required first
};
```

#### HID Key Codes for Meeting Shortcuts
```javascript
const HID_CONSTANTS = {
    // Modifier key bits (bitwise OR together)
    MODIFIER_LEFT_CTRL:  0x01,         // Left Control key
    MODIFIER_LEFT_SHIFT: 0x02,         // Left Shift key
    MODIFIER_LEFT_ALT:   0x04,         // Left Alt key
    MODIFIER_LEFT_GUI:   0x08,         // Left Windows/Cmd key
    
    // Key scan codes (USB HID Usage Table)
    KEY_A: 4,   KEY_B: 5,   KEY_C: 6,   KEY_D: 7,   KEY_E: 8,   KEY_F: 9,
    KEY_G: 10,  KEY_H: 11,  KEY_I: 12,  KEY_J: 13,  KEY_K: 14,  KEY_L: 15,
    KEY_M: 16,  KEY_N: 17,  KEY_O: 18,  KEY_P: 19,  KEY_Q: 20,  KEY_R: 21,
    KEY_S: 22,  KEY_T: 23,  KEY_U: 24,  KEY_V: 25,  KEY_W: 26,  KEY_X: 27,
    KEY_Y: 28,  KEY_Z: 27,  // Note: Z reuses X's scan code in original implementation
    
    KEY_ENTER: 40,
    KEY_ESCAPE: 41,  
    KEY_SPACE: 44,
    
    // HID report structure: [ReportID, Modifiers, Key1, Key2, 0, 0, 0, 0]
    REPORT_SIZE: 8,
    REPORT_ID_KEYBOARD: 3,             // Default keyboard report ID
    REPORT_ID_CUSTOM: 4,               // Custom report ID with modifiers
};
```

#### Device Model Specifications
```javascript
const DEVICE_MODELS = {
    // Product ID mappings
    0xB00C: { 
        model: "hidock-h1",  
        name: "HiDock H1",  
        bluetooth: false,
        description: "Basic recording device"
    },
    0xB00D: { 
        model: "hidock-h1e", 
        name: "HiDock H1E", 
        bluetooth: false,
        description: "Enhanced recording device"
    },
    0xB00E: { 
        model: "hidock-p1",  
        name: "HiDock P1",  
        bluetooth: true,
        description: "Pro model with Bluetooth"
    },
};
```

## Command Reference

### Device Information Commands

#### GET_DEVICE_INFO (0x01)

Retrieve device firmware version and serial number.

**Request**: No payload
**Response**:

- Bytes 0-3: Version number (32-bit)
- Bytes 4-19: Serial number (16 ASCII chars)

```javascript
const info = await jensen.getDeviceInfo(5); // 5 second timeout
// Returns: { versionCode: "1.2.3", versionNumber: 123456, sn: "ABC123..." }
```

#### GET_DEVICE_TIME (0x02)

Get current device time in BCD format.

**Request**: No payload
**Response**: 7 bytes BCD encoded time (YYYYMMDDHHMMSS)

```javascript
const time = await jensen.getTime(3);
// Returns: { time: "2025-01-15 14:30:45" }
```

#### SET_DEVICE_TIME (0x03)

Set device time using Date object.

**Request**: 7 bytes BCD encoded time
**Response**: Status byte (0 = success)

```javascript
const result = await jensen.setTime(new Date(), 3);
// Returns: { result: "success" | "failed" }
```

### File Operations

#### GET_FILE_COUNT (0x06)

Get total number of files on device.

**Request**: No payload
**Response**: 4 bytes file count (32-bit big-endian)

```javascript
const count = await jensen.getFileCount(5);
// Returns: { count: 42 }
```

#### GET_FILE_LIST (0x04)

Retrieve complete file listing with metadata.

**Request**: No payload
**Response**: Complex multi-packet file listing

```javascript
const files = await jensen.listFiles();
// Returns array of file objects:
// [{
//   name: "2025Jan15-143045-Rec01.hda",
//   createDate: "2025/01/15",
//   createTime: "14:30:45",
//   time: Date object,
//   duration: 120.5,  // seconds
//   version: 1,
//   length: 1048576,  // bytes
//   signature: "abc123..."
// }]
```

#### TRANSFER_FILE (0x05)

Stream file data from device.

**Request**: Filename as ASCII bytes
**Response**: File data in chunks

```javascript
const chunks = [];
await jensen.streaming(
  "recording.hda",
  fileLength,
  (data) => chunks.push(data), // Data callback
  (received, total) => {
    // Progress callback
    console.log(`${received}/${total} bytes`);
  }
);
```

#### DELETE_FILE (0x07)

Delete file from device storage.

**Request**: Filename as ASCII bytes
**Response**: Status code

```javascript
const result = await jensen.deleteFile("recording.hda", 10);
// Returns: { result: "success" | "not-exists" | "failed" }
```

### Device Settings

#### GET_SETTINGS (0x0B)

Retrieve current device settings.

**Request**: No payload
**Response**: Settings data structure

```javascript
const settings = await jensen.getSettings(5);
// Returns: {
//   autoRecord: true,
//   autoPlay: false,
//   bluetoothTone: true,
//   notification: false
// }
```

#### SET_SETTINGS (0x0C)

Configure device behavior settings.

**The 4 Device-Specific Behavior Settings:**

1. **Auto Record**: Record phone calls automatically
2. **Recording Notification**: Play "start recording" prompt when recording begins
3. **Auto Transcribe**: Automatically upload and transcribe recording when finished
4. **Bluetooth Audio Prompt**: Enable/disable audio prompt from Bluetooth host

```javascript
// Auto-record phone calls on/off
await jensen.setAutoRecord(true, 5);
// Returns: { result: "success" | "failed" }

// Recording notification ("start recording" prompt) on/off  
await jensen.setNotification(true, 5);
// Returns: { result: "success" | "failed" }

// Auto-transcription upload on/off
// Note: This setting exists but actual transcription may require cloud service
await jensen.setAutoTranscribe(true, 5);
// Returns: { result: "success" | "failed" }

// Bluetooth audio prompt on/off (H1E v6.0.260+, H1 v5.0.248+)
await jensen.setBluetoothPromptPlay(false, 5);
// Returns: { result: "success" | "failed" }

// Legacy auto-play setting (may control playback behavior)
await jensen.setAutoPlay(false, 5);
// Returns: { result: "success" | "failed" }
```

**Settings Response Structure:**
```javascript
// GET_SETTINGS response parsing (from jensen-complete.js):
const settings = {
    autoRecord: response.body[3] === 1,      // Byte 3: Auto-record phone calls
    autoPlay: response.body[7] === 1,        // Byte 7: Auto-play (legacy)
    bluetoothTone: response.body[15] !== 1,   // Byte 15: Bluetooth audio prompt (inverted)
    notification: response.body[11] === 1     // Byte 11: Recording notification (if available)
    // Note: Auto-transcribe setting location not yet identified in protocol
};
```

**Settings Byte Structure (based on protocol analysis):**
```javascript
// SET_SETTINGS command body structure (16 bytes):
const settingsBody = [
    0, 0, 0, autoRecord ? 1 : 2,        // Bytes 0-3: Auto-record phone calls
    0, 0, 0, autoPlay ? 1 : 2,          // Bytes 4-7: Auto-play setting (legacy)
    0, 0, 0, notification ? 1 : 2,      // Bytes 8-11: Recording notification prompt
    autoTranscribe ? 1 : 2,             // Byte 12: Auto-transcription (needs verification)
    0,                                  // Byte 13: Reserved
    0,                                  // Byte 14: Reserved  
    bluetoothPrompt ? 2 : 1             // Byte 15: Bluetooth audio prompt (1=enabled, 2=disabled)
];

// Implementation methods:
jensen.setAutoRecord(enabled, timeout);        // Controls byte 3
jensen.setAutoPlay(enabled, timeout);          // Controls byte 7 (legacy)
jensen.setNotification(enabled, timeout);      // Controls byte 11
jensen.setBluetoothPromptPlay(enabled, timeout); // Controls byte 15
// jensen.setAutoTranscribe(enabled, timeout);  // Not yet implemented - needs byte position verification
```

### Storage Management

#### GET_CARD_INFO (0x10)

Get storage card usage information.

```javascript
const cardInfo = await jensen.getCardInfo(5);
// Returns: {
//   used: 1073741824,      // bytes used
//   capacity: 8589934592,  // total capacity
//   status: "0"            // hex status code
// }
```

#### FORMAT_CARD (0x11)

Format storage card (WARNING: Destroys all data).

```javascript
const result = await jensen.formatCard(30); // 30 sec timeout
// Returns: { result: "success" | "failed" }
```

#### FACTORY_RESET (0xF00B)

Reset device to factory defaults.

```javascript
const result = await jensen.factoryReset(10);
// Returns: { result: "success" | "failed" } or null if unsupported
```

### Bluetooth Operations (P1 Model Only)

#### BLUETOOTH_SCAN (0x1001)

Scan for available Bluetooth devices.

```javascript
const devices = await jensen.scanDevices(20); // 20 sec timeout
// Returns: [{
//   name: "iPhone 15",
//   mac: "AA-BB-CC-DD-EE-FF"
// }]
```

#### BLUETOOTH_CMD (0x1002)

Connect/disconnect Bluetooth devices.

```javascript
// Connect to device
await jensen.connectBTDevice("AA-BB-CC-DD-EE-FF", 10);

// Disconnect current device
await jensen.disconnectBTDevice(5);
```

#### BLUETOOTH_STATUS (0x1003)

Get current Bluetooth connection status.

```javascript
const status = await jensen.getBluetoothStatus(5);
// Returns: {
//   status: "connected" | "disconnected",
//   mac: "AA-BB-CC-DD-EE-FF",
//   name: "Device Name",
//   a2dp: true,    // Audio profile
//   hfp: true,     // Hands-free profile
//   avrcp: true,   // Remote control profile
//   battery: 85    // Battery percentage
// }
```

### Meeting Integration

#### SEND_MEETING_SCHEDULE (0x14)

Configure meeting platform shortcuts.

```javascript
const schedules = [
  {
    platform: "zoom",
    os: "Windows",
    startDate: new Date("2025-01-15T09:00:00"),
    endDate: new Date("2025-01-15T10:00:00"),
  },
  {
    platform: "teams",
    os: "Mac",
    startDate: new Date("2025-01-15T14:00:00"),
    endDate: new Date("2025-01-15T15:00:00"),
  },
];

await jensen.sendScheduleInfo(schedules);
```

#### Supported Meeting Platforms

| Platform       | Windows Shortcuts                | Mac Shortcuts                 | Description           |
| -------------- | -------------------------------- | ----------------------------- | --------------------- |
| zoom           | Alt+Q                            | Cmd+W                         | Zoom meeting controls |
| teams          | Ctrl+Shift+A/H/D/M               | Cmd+Shift+A/H/D/M             | Teams shortcuts       |
| google-meeting | Ctrl+D                           | Cmd+D                         | Google Meet toggle    |
| webex          | Ctrl+Shift+C, Ctrl+L/D/M         | Ctrl+Shift+C, Cmd+L/Shift+D/M | Webex controls        |
| discord        | Ctrl+Enter, Escape, Ctrl+Shift+M | Cmd+Enter/Escape, Cmd+Shift+M | Discord shortcuts     |

### Firmware Operations

#### REQUEST_FIRMWARE_UPGRADE (0x08)

Initiate firmware update process.

```javascript
const result = await jensen.requestFirmwareUpgrade(
  firmwareSize, // Size in bytes
  firmwareVersion // Version number
);
// Returns: { result: "accepted" | "wrong-version" | "busy" | "card-full" | "card-error" }
```

#### FIRMWARE_UPLOAD (0x09)

Upload firmware data chunks.

```javascript
const result = await jensen.uploadFirmware(firmwareChunk, 30);
// Returns: { result: "success" | "failed" }
```

## Response Handlers

### Handler Registration

```javascript
Jensen.registerHandler(commandId, (response, jensenInstance) => {
  // Process response and return parsed data
  return parsedResult;
});
```

### Common Response Patterns

#### Simple Status Response

Many commands return a single status byte:

- 0x00 = Success
- 0x01+ = Various error codes

#### Multi-byte Data Response

Complex data structures with:

- Length prefixes
- Big-endian integers
- ASCII strings
- Binary data chunks

## Data Formats

### BCD (Binary Coded Decimal)

Date/time values use BCD encoding where each decimal digit occupies 4 bits.

```javascript
// Convert string to BCD
const bcdBytes = jensen.to_bcd("20250115143045");
// Result: [0x20, 0x25, 0x01, 0x15, 0x14, 0x30, 0x45]

// Convert BCD to string
const dateString = jensen.from_bcd(0x20, 0x25, 0x01, 0x15, 0x14, 0x30, 0x45);
// Result: "20250115143045"
```

### Audio File Formats and Duration Calculation

HiDock devices use a `Recording Type` identifier (previously referred to as "version") and the filename format to determine the audio encoding and calculate the recording duration. This identifier's sole purpose is to select the correct duration calculation formula. The main application does not use this field for any UI or logic purposes.

The logic, as defined in the reference `jensen.js` implementation, is a two-step process.

#### Step 1: Base Duration Calculation from Filename

The initial duration is calculated based on the filename pattern.

| Filename Pattern | Example | Base Duration Formula |
| --- | --- | --- |
| Legacy `.wav` | `20250115143045REC01.wav` | `fileLength / 32` |
| Modern `.hda` | `2025Jan15-143045-Rec01.hda`| `(fileLength / 32) * 4` |

#### Step 2: Final Duration Adjustment Based on Recording Type

The base duration is then adjusted based on the file's `Recording Type` number, which represents the audio encoding format.

| Recording Type | Audio Format/Encoding | Final Duration Calculation |
| --- | --- | --- |
| 1 | Legacy Compressed Format | `baseDuration * 2` |
| 2 | Phone Call Recording (48kHz) | `(fileLength - 44) / 48 / 2` |
| 3 | Bluetooth Recording (24kHz) | `(fileLength - 44) / 48 / 2 / 2` |
| 5 | Quick Memo/Whispers (12kHz) | `fileLength / 12` |
| Default | Standard MPEG Audio | The `baseDuration` from Step 1 is used. |

**Note:** The divisors `48` and `12` in the formulas from `jensen.js` seem unusually small and might be shorthand for `48000` and `12000` respectively. However, this table reflects the literal implementation.

#### Combined Duration Calculation Logic

The following Javascript function demonstrates the complete logic from `jensen.js`:

```javascript
function calculateDuration(filename, recordingType, fileLength) {
  let duration = 0;

  // Step 1: Calculate base duration from filename
  if (filename.match(/^\d{14}REC\d+\.wav$/gi)) {
    duration = fileLength / 32;
  } else if (filename.match(/^(\d{2})?(\d{2})(\w{3})(\d{2})-(\d{2})(\d{2})(\d{2})-.*\.(hda|wav)$/gi)) {
    duration = (fileLength / 32) * 4;
  }

  // Step 2: Adjust duration based on recording type
  switch (recordingType) {
    case 1:
      duration *= 2;
      break;
    case 2:
      duration = (fileLength - 44) / 48 / 2;
      break;
    case 3:
      duration = (fileLength - 44) / 48 / 2 / 2;
      break;
    case 5:
      duration = fileLength / 12;
      break;
    default:
      // For default type, the base duration is used as is.
      break;
  }

  return duration;
}
```

#### Audio Format Details

**Actual Device Format Analysis (Based on Real Files):**

Your file `2025Jul25-183037-Rec94.hda` shows:
- **Codec**: MPEG Audio Layer 1/2 (mpga)
- **Channels**: Mono (not stereo as documented!)
- **Sample Rate**: 16000 Hz
- **Bit Depth**: 32 bits per sample (not 16-bit!)
- **Bitrate**: 64 kb/s

**PCM Format Specifications (when used):**
- **Bit Depth**: 16-bit signed integer (but devices may use 32-bit)
- **Byte Order**: Little-endian
- **Sample Format**: Linear PCM or MPEG Layer 1/2 compression
- **Header**: Standard WAV header (44 bytes) for types 2 and 3

**Format Variation Factors:**
- **Device Model**: H1/H1E/P1 may have different default formats
- **Firmware Version**: Newer firmware may support more formats
- **User Settings**: Quality settings may affect codec choice
- **Storage Optimization**: Devices may use compression to save space

#### Recording Type Selection and Control

**How Recording Types Are Determined:**

1. **Device Settings**: The recording type/format is typically controlled by device settings accessible via `SET_SETTINGS` commands
2. **Hardware Capabilities**: Some models may only support certain formats
3. **Firmware Features**: Newer firmware versions may unlock additional formats
4. **Storage Constraints**: Device may automatically choose compression based on available space

**Changing Audio Format Settings:**

```javascript
// Get current settings to see available options
const settings = await jensen.getSettings(5);
console.log("Current audio settings:", settings);

// The SET_SETTINGS command controls audio format, but specific byte positions
// for audio format selection are not fully documented. 
// You may need to experiment with different byte values:

// Example: Try setting different audio quality modes
// (These are hypothetical - actual bytes may vary)
await jensen.send(new JensenPacket(COMMAND_CODES.SET_SETTINGS).body([
    0, 0, 0, 0,           // Unknown settings
    0, 0, 0, 0,           // Auto-record/auto-play settings  
    0, 0, 0, 0,           // Notification settings
    0x01,                 // Possible audio format selector (mono=0x01, stereo=0x02?)
    0x02,                 // Possible quality selector (MPEG=0x01, PCM=0x02?)
    0, 0                  // Reserved
]), 10);
```

**Multi-Type File Support:**

- **Single File = Single Type**: Each `.hda` file has one recording type
- **Mixed Collections**: A device can have files with different types stored simultaneously
- **Type Detection**: The recording type is stored in the file's metadata header on the device
- **Parsing Logic**: The `listFiles()` operation reads each file's type from its metadata

**Switching to Stereo Recording:**

Unfortunately, based on your real-world file analysis, **mono** appears to be the standard format for voice recording optimized for storage efficiency. To potentially enable stereo:

1. **Check Device Settings**: Look for audio quality or recording mode settings
2. **Firmware Updates**: Newer firmware might support stereo options
3. **Model Differences**: P1 (Pro model) might have more audio format options than H1/H1E
4. **Manual Override**: Advanced users might need to modify device settings directly

**Recommended Investigation Steps:**

```javascript
// 1. Check what your device currently supports
const deviceInfo = await jensen.getDeviceInfo(5);
console.log("Device model:", jensen.getModel());
console.log("Firmware version:", deviceInfo.versionCode);

// 2. Get current settings
const settings = await jensen.getSettings(5);
console.log("Current settings:", settings);

// 3. Try different SET_SETTINGS configurations
// WARNING: This may change device behavior - backup settings first!
```

### Filename Date Parsing

HiDock uses two filename formats:

1. **Legacy**: `YYYYMMDDHHMMSSREC##.wav`
2. **Current**: `YYYYMmmDD-HHMMSS-Rec##.hda`

## Error Handling

### Protocol Error Codes

#### DELETE_FILE Command (0x07) Response Codes

| Code | Status     | Description                   |
| ---- | ---------- | ----------------------------- |
| 0x00 | success    | File deleted successfully     |
| 0x01 | not-exists | File does not exist on device |
| 0x02 | failed     | Delete operation failed       |

#### REQUEST_FIRMWARE_UPGRADE Command (0x08) Response Codes

| Code | Status        | Description                       |
| ---- | ------------- | --------------------------------- |
| 0x00 | accepted      | Firmware upgrade request accepted |
| 0x01 | wrong-version | Incompatible firmware version     |
| 0x02 | busy          | Device is busy, try again later   |
| 0x03 | card-full     | Storage card is full              |
| 0x04 | card-error    | Storage card error                |

#### FIRMWARE_UPLOAD Command (0x09) Response Codes

| Code  | Status  | Description                          |
| ----- | ------- | ------------------------------------ |
| 0x00  | success | Firmware chunk uploaded successfully |
| 0x01+ | failed  | Upload failed                        |

#### REQUEST_TONE_UPDATE Command (0x16) Response Codes

| Code | Status          | Description                  |
| ---- | --------------- | ---------------------------- |
| 0x00 | success         | Tone update request accepted |
| 0x01 | length-mismatch | Data length mismatch         |
| 0x02 | busy            | Device is busy               |
| 0x03 | card-full       | Storage card is full         |
| 0x04 | card-error      | Storage card error           |

#### REQUEST_UAC_UPDATE Command (0x18) Response Codes

| Code | Status          | Description                 |
| ---- | --------------- | --------------------------- |
| 0x00 | success         | UAC update request accepted |
| 0x01 | length-mismatch | Data length mismatch        |
| 0x02 | busy            | Device is busy              |
| 0x03 | card-full       | Storage card is full        |
| 0x04 | card-error      | Storage card error          |

#### Generic Status Response Commands

Commands that return simple 0x00=success, 0x01+=failed:

- SET_DEVICE_TIME (0x03)
- DEVICE_MSG_TEST (0x0A)
- SET_SETTINGS (0x0C)
- FORMAT_CARD (0x11)
- FACTORY_RESET (0xF00B)
- RESTORE_FACTORY_SETTINGS (0x13)
- UPDATE_TONE (0x17)
- UPDATE_UAC (0x19)
- SEND_MEETING_SCHEDULE (0x14)
- BLUETOOTH_CMD (0x1002)
- CONTROL_REALTIME (0x21)

### Connection Errors

- **WebUSB not supported**: Browser doesn't support WebUSB API
- **Access denied**: User denied device access permission
- **USB communication failure**: Hardware communication error

### Protocol Errors

- **Invalid packet sync bytes**: Packet doesn't start with 0x12, 0x34
- **Packet parsing errors**: Malformed packet structure
- **Command timeout**: Device didn't respond within timeout period
- **Unexpected response**: Response doesn't match expected format

### Device Errors

- **File not found**: Requested file doesn't exist on device
- **Storage full**: Device storage capacity exceeded
- **Firmware version incompatible**: Feature not supported in current firmware
- **Device busy**: Device is performing another operation

## Code Examples

### Complete Connection Example

```javascript
import { Jensen } from "./jensen-complete.js";

async function connectToHiDock() {
  const jensen = new Jensen();

  try {
    // Initialize and connect
    await jensen.init();

    // Get device info
    const info = await jensen.getDeviceInfo(5);
    console.log(`Connected to ${jensen.getModel()}`);
    console.log(`Firmware: ${info.versionCode}`);
    console.log(`Serial: ${info.sn}`);

    // List files
    const files = await jensen.listFiles();
    console.log(`Found ${files.length} recordings`);

    return jensen;
  } catch (error) {
    console.error("Connection failed:", error);
    throw error;
  }
}
```

### File Download Example

```javascript
async function downloadFile(jensen, filename, expectedSize) {
  const chunks = [];
  let receivedBytes = 0;

  await jensen.streaming(
    filename,
    expectedSize,
    (data) => {
      if (data === "fail") {
        throw new Error("Download failed");
      }
      chunks.push(new Uint8Array(data));
      receivedBytes += data.byteLength;
    },
    (bytes) => {
      const progress = (receivedBytes / expectedSize) * 100;
      console.log(`Progress: ${progress.toFixed(1)}%`);
    }
  );

  // Combine chunks into single array
  const totalSize = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
  const result = new Uint8Array(totalSize);
  let offset = 0;

  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.length;
  }

  return result;
}
```

### Settings Management Example

```javascript
async function configureDevice(jensen) {
  // Enable auto-recording
  await jensen.setAutoRecord(true, 5);

  // Disable auto-play
  await jensen.setAutoPlay(false, 5);

  // Enable notifications
  await jensen.setNotification(true, 5);

  // Verify settings
  const settings = await jensen.getSettings(5);
  console.log("Current settings:", settings);
}
```

### Bluetooth Management (P1 Only)

```javascript
async function manageBluetoothP1(jensen) {
  if (jensen.getModel() !== "hidock-p1") {
    console.log("Bluetooth only available on P1 model");
    return;
  }

  // Scan for devices
  const devices = await jensen.scanDevices(20);
  console.log("Available devices:", devices);

  if (devices.length > 0) {
    // Connect to first device
    await jensen.connectBTDevice(devices[0].mac, 10);

    // Check connection status
    const status = await jensen.getBluetoothStatus(5);
    console.log("Connection status:", status);
  }
}
```

## Version Compatibility

### Firmware Requirements

| Feature             | H1 Min Version   | H1E Min Version  | P1 Min Version | Notes |
| ------------------- | ---------------- | ---------------- | -------------- | ----- |
| Basic Operations    | Any              | Any              | Any            | Core USB communication |
| Settings Management | 5.0.0 (327714)   | 5.0.0 (327714)   | Any            | GET_SETTINGS/SET_SETTINGS commands |
| Factory Reset       | 5.0.9 (327705)   | 5.0.9 (327705)   | Any            | FACTORY_RESET command |
| Storage Management  | 5.0.21 (327733)  | 5.0.21 (327733)  | Any            | FORMAT_CARD, GET_CARD_INFO |
| Bluetooth Prompt    | 5.0.244 (327940) | 6.0.260 (393476) | N/A            | Audio prompt control for BT |
| Factory Settings    | 5.0.248 (327944) | 6.0.4 (393476)   | Any            | RESTORE_FACTORY_SETTINGS |
| File List Streaming | Any              | Any              | Any            | Optimized in desktop 2025 |
| Collision Prevention| Any              | Any              | Any            | Desktop implementation 2025 |

### Checking Compatibility

```javascript
function checkFeatureSupport(jensen, feature) {
  const model = jensen.getModel();
  const version = jensen.versionNumber;

  switch (feature) {
    case "settings":
      return !(
        (model === "hidock-h1" || model === "hidock-h1e") &&
        version < 327714
      );
    case "factoryReset":
      return !(
        (model === "hidock-h1" || model === "hidock-h1e") &&
        version < 327705
      );
    case "storageManagement":
      return !(
        (model === "hidock-h1" || model === "hidock-h1e") &&
        version < 327733
      );
    case "bluetooth":
      return model === "hidock-p1";
    default:
      return true;
  }
}
```

## Troubleshooting

### Common Issues

1. **WebUSB Not Supported**

   - Ensure using Chrome/Edge browser
   - Enable experimental web platform features
   - Use HTTPS connection

2. **Device Not Found**

   - Check USB cable connection
   - Try different USB port
   - Verify device is powered on

3. **Connection Timeout**

   - Increase timeout values
   - Check for USB interference
   - Restart device and retry

4. **File Transfer Failures**

   - Verify file exists on device
   - Check available storage space
   - Use appropriate file transfer method

5. **Firmware Compatibility**
   - Check version requirements
   - Update device firmware if needed
   - Use compatible feature subset

---

## Desktop File List Streaming Performance Optimization

### The Problem: Web vs Desktop Performance Gap

A critical performance issue was discovered where the web implementation (`jensen-complete.js`) could retrieve file lists in under 1 second, while the desktop implementation (`hidock_device.py`) took 20+ seconds and often failed to get all files.

**Root Cause Analysis:**
- Desktop used blocking timeout-based approach (6 × 3000ms = 18+ seconds of waiting)
- Device would stop responding after exactly 255 files due to flow control
- Missing newest files due to incomplete streaming
- Command sequence collisions from concurrent operations during streaming

### Web Implementation Success Pattern

The web version uses a **registered handler pattern** that properly handles device flow control:

```javascript
// Web handler registration - EFFICIENT
Jensen.registerHandler(COMMAND_CODES.GET_FILE_LIST, (response, jensenInstance) => {
    if (response.body.length === 0) {
        return []; // Complete - empty response signals end
    }

    // Accumulate this chunk
    jensenInstance[cacheKey].push(response.body);
    
    // Parse accumulated data
    const files = this._parseFileListData(jensenInstance[cacheKey]);
    const expectedCount = fileCountResponse ? fileCountResponse.count : -1;
    
    // Check completion
    if (files.length >= expectedCount) {
        return files.filter(file => !!file.time); // Complete - return files
    }
    
    return undefined; // Continue receiving - CRITICAL for flow control
});
```

**Key Success Factors:**
- **Continuation Signal**: `return undefined` tells device to continue sending
- **Completion Detection**: Return actual data when complete  
- **No Timeouts**: Device communication is immediate, no artificial delays

### Desktop Implementation: Handler-Style Adaptation

The desktop version was redesigned to mimic the web's handler approach:

```python
# Desktop handler-style implementation - OPTIMIZED (hidock_device.py lines ~1254-1290)
def file_list_handler(response_data):
    nonlocal file_list_chunks, expected_file_count
    
    if not response_data or len(response_data) == 0:
        return []  # Complete - empty response signals end
    
    # Accumulate this chunk (like web version)
    file_list_chunks.append(response_data)
    
    # Parse accumulated file data
    files = self._parse_file_list_chunks(file_list_chunks)
    
    # Get expected count from first chunk header if available
    if expected_file_count is None and file_list_chunks:
        first_chunk = file_list_chunks[0]
        if len(first_chunk) >= 6 and first_chunk[0] == 0xFF and first_chunk[1] == 0xFF:
            expected_file_count = struct.unpack(">I", first_chunk[2:6])[0]
            logger.debug(f"Expected file count from header: {expected_file_count}")
    
    # Check completion
    if expected_file_count and len(files) >= expected_file_count:
        logger.debug(f"File list complete: {len(files)}/{expected_file_count} files")
        return files  # Complete - return final file list
    
    logger.debug(f"Continue receiving: {len(files)}/{expected_file_count or '?'} files")
    return None  # Continue receiving (equivalent to web's "undefined")

# Continuous receiving loop with proper timeout handling
final_files = None
while final_files is None:
    response = self._receive_response(seq_id, timeout_ms=1000)  # Reduced timeout
    
    if response and response["id"] == CMD_GET_FILE_LIST:
        result = file_list_handler(response["body"])
        if result is not None:
            final_files = result  # Handler indicates completion
            break
    elif not response:
        logger.warning("No response received, assuming completion")
        # Parse any accumulated data as final result
        final_files = self._parse_file_list_chunks(file_list_chunks)
        break
```

### Command Collision Prevention System

A critical discovery was that multiple operations running during file streaming caused command sequence collisions. The solution implemented a comprehensive collision prevention system:

```python
# Streaming flag management
self._file_list_streaming = True  # Set at start
try:
    # ... file streaming logic ...
finally:
    self._file_list_streaming = False  # Always cleared

def is_file_list_streaming(self):
    return getattr(self, '_file_list_streaming', False)

# All other USB operations check this flag
def get_card_info(self):
    if self.is_file_list_streaming():
        logger.debug("Skipping during file list streaming")
        return None
    # ... proceed with operation ...
```

**Protected Operations (hidock_device.py collision prevention):**
- `get_card_info()` - Storage information requests
- `get_file_count()` - File count queries  
- `get_recording_file()` - Active recording status checks
- `delete_file()` - File deletion operations
- `format_card()` - Storage formatting operations
- `get_device_info()` - Device information queries
- `set_device_time()` - Time synchronization operations

**Implementation Pattern:**
```python
def protected_operation(self):
    if self.is_file_list_streaming():
        logger.debug("Skipping operation during file list streaming")
        return None  # Or appropriate fallback value
    # ... proceed with operation ...
```

**GUI-Level Collision Prevention (gui_main_window.py and gui_actions_device.py):**
```python
# Status update thread collision prevention (gui_main_window.py ~line 1180)
if (hasattr(self.device_manager.device_interface, 'jensen_device') and 
    hasattr(self.device_manager.device_interface.jensen_device, 'is_file_list_streaming') and 
    self.device_manager.device_interface.jensen_device.is_file_list_streaming()):
    card_info = None  # Skip storage info request during streaming
else:
    card_info = self.device_manager.device_interface.get_storage_info()
    
# Recording status check collision prevention (gui_actions_device.py ~line 890)
if (hasattr(self.device_manager.device_interface, 'jensen_device') and 
    hasattr(self.device_manager.device_interface.jensen_device, 'is_file_list_streaming') and 
    self.device_manager.device_interface.jensen_device.is_file_list_streaming()):
    logger.debug("GUI", "_check_recording_status_periodically", "Skipping recording check during file list streaming")
    return
# ... proceed with recording status check ...
```

**Streaming Flag Lifecycle:**
```python
# Flag management in list_files() method (hidock_device.py ~lines 1225-1230, 1340-1342)
self._file_list_streaming = True  # Set at operation start
try:
    # ... file streaming logic ...
finally:
    self._file_list_streaming = False  # Always cleared in finally block

def is_file_list_streaming(self):
    return getattr(self, '_file_list_streaming', False)  # Safe attribute access
```

### Performance Results

| Implementation | Time (348 files) | Success Rate | Files Retrieved | Method | Key Issues |
|----------------|------------------|--------------|-----------------|--------|------------|
| **Original Desktop** | 20-26 seconds | 73% | 255/348 files | Timeout-based loops | Stream interruption at 255 files, BufferError with memoryview |
| **Web Reference** | <1 second | 100% | 348/348 files | Handler-based | Proper flow control, no command collisions |
| **Optimized Desktop** | <2 seconds | 100% | 348/348 files | Handler-based | Web pattern adaptation, collision prevention |

### Key Lessons Learned

1. **Protocol Understanding**: Device communication patterns must be respected, not worked around with timeout fallbacks
2. **Reference Implementation Value**: The web version (`jensen-complete.js`) provided the correct architectural pattern for device flow control
3. **Timeout vs Continuation**: Blocking timeouts (6 × 3000ms) are poor substitutes for proper protocol-driven flow control
4. **Command Collision Impact**: Concurrent operations during streaming cause sequence conflicts and mixed responses
5. **Performance Impact**: Handler-based vs timeout-based approaches show dramatic differences (20+ seconds vs <2 seconds)
6. **BufferError Resolution**: Removing memoryview usage in favor of direct bytearray operations resolved export conflicts
7. **Streaming Flag Importance**: Comprehensive collision prevention across all GUI threads and device operations is critical

### Critical Implementation Details

**BufferError Fix (Essential for Desktop Implementation):**
```python
# BEFORE: BufferError - "Existing exports of data: object cannot be re-sized"
file_list_aggregate_data_view = memoryview(file_list_aggregate_data)  # CAUSED ERROR
if file_list_aggregate_data_view[0] == 0xFF and file_list_aggregate_data_view[1] == 0xFF:

# AFTER: Direct bytearray access
if file_list_aggregate_data[0] == 0xFF and file_list_aggregate_data[1] == 0xFF:  # WORKS
```

**Enhanced Collision Prevention (2025 Update):**
Added comprehensive collision prevention at the desktop adapter level to stop command conflicts at the source:

```python
# Desktop adapter collision prevention (desktop_device_adapter.py)
async def get_storage_info(self) -> StorageInfo:
    if (hasattr(self.jensen_device, 'is_file_list_streaming') and 
        self.jensen_device.is_file_list_streaming()):
        # Return cached/fallback values during streaming to avoid collisions
        return StorageInfo(total_capacity=8*1024*1024*1024, used_space=0, ...)
    # ... proceed with normal operation ...

async def get_current_recording_filename(self) -> Optional[str]:
    if (hasattr(self.jensen_device, 'is_file_list_streaming') and 
        self.jensen_device.is_file_list_streaming()):
        # Return None during streaming to avoid collisions
        return None
    # ... proceed with normal operation ...
```

**Improved Handler Logic (2025 Update):**
Enhanced the file list handler with better logging and timeout handling:

```python
# Enhanced handler with detailed logging (hidock_device.py ~lines 1254-1287)
def file_list_handler(response_data):
    if not response_data or len(response_data) == 0:
        logger.info("Empty response received, completing file list")
        return self._parse_file_list_chunks(file_list_chunks) if file_list_chunks else []
    
    file_list_chunks.append(response_data)
    logger.debug(f"Accumulated chunk {len(file_list_chunks)}, size: {len(response_data)} bytes")
    
    files = self._parse_file_list_chunks(file_list_chunks)
    files_parsed = len(files)
    logger.debug(f"Parsed {files_parsed}/{expected_file_count or '?'} files so far")
    
    if expected_file_count is not None and files_parsed >= expected_file_count:
        logger.info(f"Received all {expected_file_count} files, completing")
        return files
    
    logger.debug(f"Continue receiving: need {(expected_file_count or 0) - files_parsed} more files")
    return None
```

**Timeout Optimization (2025 Update):**
```python
# Increased timeouts and patience for better reliability
max_consecutive_timeouts = 5  # Increased from 3
timeout_ms = 2000  # Increased from 1000ms

# Streaming-aware timeout logging (prevents console noise)
if streaming_cmd_id is not None:
    logger.debug("Expected streaming timeout - device pausing between chunks")
else:
    logger.warning("Unexpected timeout waiting for response")
```

**Handler Return Values (Critical for Flow Control):**
- Web: `return undefined` = continue receiving, `return data` = complete
- Desktop: `return None` = continue receiving, `return data` = complete

This optimization demonstrates the importance of understanding the underlying protocol requirements and implementing appropriate communication patterns rather than relying on timeout-based fallbacks. The 10x performance improvement (20+ seconds to <2 seconds) shows the critical impact of proper protocol implementation.

---

_This reference manual is based on jensen-complete.js and covers the complete HiDock protocol implementation. Desktop performance optimizations were implemented in 2025 based on web reference patterns. For the latest updates and examples, refer to the source code and project documentation._

## In-depth Analysis of jensen.js

This section provides a detailed analysis of the `jensen.js` and `jensen-complete.js` files, focusing on the reverse-engineered details of the HiDock hardware, the `.hda` file format, and the audio duration calculation.

### Hardware and Device Interaction

The `jensen.js` library is designed to communicate with HiDock hardware devices over USB, using the WebHID API. The key findings are:

*   **Device Identification**: The library identifies HiDock devices by their USB Vendor ID (0x10E6) and Product IDs (0xB00C, 0xB00D, 0xB00E).
*   **Communication Protocol**: It uses a custom packet-based protocol with a 12-byte header containing sync words, a command, a sequence number, and the body length.
*   **Commands**: The library implements a rich set of commands for device management, including getting device info, setting time, managing files, updating firmware, and controlling Bluetooth.
*   **Asynchronous Nature**: All communication with the device is asynchronous, using `async/await` and Promises to handle the back-and-forth of commands and responses.

### The `.hda` File Format

The `.hda` file is a custom container format for audio recordings. Here's what the analysis of `jensen.js` reveals about its structure:

*   **Metadata**: The device stores metadata for each file, which is retrieved using the `GET_FILE_LIST` command. This metadata includes the filename, creation date and time, file length, a "version" (which is actually a recording type), and a signature.
*   **File Listing**: The `listFiles` function parses a binary response from the device. It iterates through a buffer, extracting file entries that have a minimum size and a specific signature.
*   **Filename Convention**: The filenames follow a pattern like `2025Jan15-143045-Rec01.hda`, which encodes the date and time of the recording.

### Audio Duration Calculation

The calculation of the audio duration is a multi-step process that depends on the filename and a `recordingType` field from the file's metadata.

1.  **Base Duration from Filename**:
    *   For older `.wav` files (e.g., `20250115143045REC01.wav`), the base duration is `fileLength / 32`.
    *   For modern `.hda` files, the base duration is `(fileLength / 32) * 4`.

2.  **Final Duration from `recordingType`**: The base duration is then adjusted based on the `recordingType`:

| `recordingType` | Description | Duration Calculation |
| :--- | :--- | :--- |
| 1 | Legacy Compressed | `baseDuration * 2` |
| 2 | Phone Call (48kHz) | `(fileLength - 44) / 48 / 2` |
| 3 | Bluetooth (24kHz) | `(fileLength - 44) / 48 / 2 / 2` |
| 5 | Quick Memo (12kHz) | `fileLength / 12` |
| Default | Standard MPEG | `baseDuration` |

**Interpretation of Divisors**:

The small divisors (e.g., 48, 12) in the duration formulas are puzzling. They are likely shorthand or scaled-down representations of the actual sample rates (e.g., 48000, 12000). The `- 44` in some formulas suggests the presence of a 44-byte WAV header. The exact rationale for these specific calculations would require deeper analysis of the device's firmware or more sample files.

### Key Functions in `jensen.js`

*   **`Jensen` class**: The main class that encapsulates all the logic for device communication.
*   **`connect()`**: Establishes a connection with the HiDock device.
*   **`sendCommand()`**: Sends a command to the device and waits for a response.
*   **`listFiles()`**: Retrieves and parses the list of files from the device.
*   **`streaming()`**: Downloads a file from the device in chunks.
*   **`calculateDuration()`**: Implements the logic for calculating the audio duration.

### Summary of Findings

The `jensen.js` library is a sophisticated piece of software that provides a complete interface for interacting with HiDock recording devices. The reverse-engineering process has revealed a custom communication protocol, a proprietary file format, and a complex audio duration calculation method. The existing `REFERENCE_HIDOCK.md` is very thorough, and this additional analysis confirms and expands upon its contents, providing a solid foundation for any further development or integration work with HiDock devices.