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

### Module Structure

The Jensen protocol implementation has been refactored into a modular structure under `src/jensen/`.

- **`index.ts`**: Main entry point, exporting all public APIs.
- **`jensen.ts`**: The core `Jensen` class handling device communication.
- **`constants.ts`**: All protocol constants, command codes, and magic numbers.
- **`types.ts`**: TypeScript type definitions for all data structures.
- **`protocol.ts`**: `JensenPacket` and `JensenResponse` class definitions.
- **`handlers.ts`**: Centralized response handlers for each command.
- **`keyboard.ts`**: Logic for building HID keyboard reports for meeting shortcuts.
- **`logger.ts`**: The `JensenLogger` class.
- **`utils.ts`**: Utility functions for BCD conversion, date formatting, etc.

### Importing the Module

```typescript
import { Jensen, COMMAND_CODES, DeviceInfo } from 'path/to/src/jensen';
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

### Command Reference

All constants and magic numbers are now exported from `src/jensen/constants.ts`.

### Device Information Commands

#### GET_DEVICE_INFO (0x01)

Retrieve device firmware version and serial number.

**Request**: No payload
**Response**:

- Bytes 0-3: Version number (32-bit)
- Bytes 4-19: Serial number (16 ASCII chars)

```typescript
import { Jensen } from 'path/to/src/jensen';
const jensen = new Jensen();
// ... connect ...
const info = await jensen.getDeviceInfo(5); // 5 second timeout
// Returns: { versionCode: "1.2.3", versionNumber: 123456, sn: "ABC123..." }
```

#### GET_DEVICE_TIME (0x02)

Get current device time in BCD format.

**Request**: No payload
**Response**: 7 bytes BCD encoded time (YYYYMMDDHHMMSS)

```typescript
const time = await jensen.getTime(3);
// Returns: { time: "2025-01-15 14:30:45" }
```

#### SET_DEVICE_TIME (0x03)

Set device time using Date object.

**Request**: 7 bytes BCD encoded time
**Response**: Status byte (0 = success)

```typescript
const result = await jensen.setTime(new Date(), 3);
// Returns: { result: "success" | "failed" }
```

### File Operations

#### GET_FILE_COUNT (0x06)

Get total number of files on device.

**Request**: No payload
**Response**: 4 bytes file count (32-bit big-endian)

```typescript
const count = await jensen.getFileCount(5);
// Returns: { count: 42 }
```

#### GET_FILE_LIST (0x04)

Retrieve complete file listing with metadata.

**Request**: No payload
**Response**: Complex multi-packet file listing

```typescript
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

```typescript
const chunks = [];
await jensen.streaming(
  "recording.hda",
  fileLength,
  (data) => {
    if (data !== 'fail') chunks.push(data)
  }, // Data callback
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

```typescript
const result = await jensen.deleteFile("recording.hda", 10);
// Returns: { result: "success" | "not-exists" | "failed" }
```

### Device Settings

#### GET_SETTINGS (0x0B)

Retrieve current device settings.

**Request**: No payload
**Response**: Settings data structure

```typescript
const settings = await jensen.getSettings(5);
// Returns: {
//   autoRecord: true,
//   autoPlay: false,
//   bluetoothTone: true,
//   notification: false
// }
```

#### SET_SETTINGS (0x0C)

Configure device behavior settings. See the source code for `jensen.ts` for the specific methods to set individual settings like `setAutoRecord`.

### Storage Management

#### GET_CARD_INFO (0x10)

Get storage card usage information.

```typescript
const cardInfo = await jensen.getCardInfo(5);
// Returns: {
//   used: 1073741824,      // bytes used
//   capacity: 8589934592,  // total capacity
//   status: "0"            // hex status code
// }
```

#### FORMAT_CARD (0x11)

Format storage card (WARNING: Destroys all data).

```typescript
const result = await jensen.formatCard(30); // 30 sec timeout
// Returns: { result: "success" | "failed" }
```

#### FACTORY_RESET (0xF00B)

Reset device to factory defaults.

```typescript
const result = await jensen.factoryReset(10);
// Returns: { result: "success" | "failed" } or null if unsupported
```

### Bluetooth Operations (P1 Model Only)

#### BLUETOOTH_SCAN (0x1001)

Scan for available Bluetooth devices.

```typescript
const devices = await jensen.scanDevices(20); // 20 sec timeout
// Returns: [{
//   name: "iPhone 15",
//   mac: "AA-BB-CC-DD-EE-FF"
// }]
```

### Meeting Integration

#### SEND_MEETING_SCHEDULE (0x14)

Configure meeting platform shortcuts.

```typescript
import { MeetingSchedule } from 'path/to/src/jensen';

const schedules: MeetingSchedule[] = [
  {
    platform: "zoom",
    os: "Windows",
    startDate: new Date("2025-01-15T09:00:00"),
    endDate: new Date("2025-01-15T10:00:00"),
  },
  // ... other schedules
];

await jensen.sendScheduleInfo(schedules);
```

### Firmware Operations

#### REQUEST_FIRMWARE_UPGRADE (0x08)

Initiate firmware update process.

```typescript
const result = await jensen.requestFirmwareUpgrade(
  firmwareSize, // Size in bytes
  firmwareVersion // Version number
);
// Returns: { result: "accepted" | "wrong-version" | "busy" | "card-full" | "card-error" }
```

## Response Handlers

Response handlers are now managed internally within the `jensen/handlers.ts` module and are not intended for external registration.

## Data Formats

### BCD (Binary Coded Decimal)

Date/time values use BCD encoding. The `Jensen` instance provides utility methods for conversion.

```typescript
// Convert string to BCD
const bcdBytes = jensen.toBcd("20250115143045");
// Result: [32, 37, 1, 21, 20, 48, 69]

// Convert BCD to string
const dateString = jensen.fromBcd([0x20, 0x25, 0x01, 0x15, 0x14, 0x30, 0x45]);
// Result: "2025115143045"
```

## Code Examples

### Complete Connection Example

```typescript
import { Jensen } from "path/to/src/jensen";

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

---

_This reference manual has been updated to reflect the refactored Jensen protocol module. For the latest updates and examples, refer to the source code in `src/jensen` and project documentation._
