# Jensen Protocol Device IDs Analysis (January 2026)

**Date:** 2026-01-15
**Source:** `archive/jensen.8754fe1c.js` extracted from `h1e.filesync.hinotes.hidock.com-20260115.har`
**Analysis:** Reverse engineering of official HiDock HiNotes web application

## Critical Finding: Product ID Mapping

The official jensen.js uses **0xB00x series as PRIMARY** product IDs, contradicting earlier assumptions that 0xAF0x were primary.

### Official Product ID to Model Mapping

From the jensen.js model detection code:
```javascript
M.model = (a = b.productId) == 45068 ? "hidock-h1"
        : a == 45069 ? "hidock-h1e"
        : a == 45070 ? "hidock-p1"
        : a == 45071 ? "hidock-p1:mini"
        : a == 256 ? "hidock-h1"
        : a == 257 ? "hidock-h1e"
        : a == 258 ? "hidock-h1"
        : a == 259 ? "hidock-h1e"
        : a == 8256 ? "hidock-p1"
        : a == 8257 ? "hidock-p1:mini"
        : "unknown"
```

### Complete Product ID Table

| Decimal | Hex    | Model          | Notes |
|---------|--------|----------------|-------|
| 45068   | 0xB00C | hidock-h1      | **PRIMARY** H1 |
| 45069   | 0xB00D | hidock-h1e     | **PRIMARY** H1E |
| 45070   | 0xB00E | hidock-p1      | **PRIMARY** P1 |
| 45071   | 0xB00F | hidock-p1:mini | **PRIMARY** P1 Mini |
| 256     | 0x0100 | hidock-h1      | Alternate H1 |
| 257     | 0x0101 | hidock-h1e     | Alternate H1E |
| 258     | 0x0102 | hidock-h1      | Alternate H1 (variant 2) |
| 259     | 0x0103 | hidock-h1e     | Alternate H1E (variant 2) |
| 8256    | 0x2040 | hidock-p1      | Alternate P1 |
| 8257    | 0x2041 | hidock-p1:mini | Alternate P1 Mini |

### Legacy Product IDs (NOT in current jensen.js)

| Decimal | Hex    | Model     | Notes |
|---------|--------|-----------|-------|
| 44812   | 0xAF0C | H1        | Legacy - may be firmware < v6.x |
| 44813   | 0xAF0D | H1E       | Legacy - may be firmware < v6.x |
| 44814   | 0xAF0E | P1        | Legacy - may be firmware < v1.2.x |
| 44815   | 0xAF0F | P1 Mini   | Legacy - may be firmware < v1.2.x |

## Vendor IDs

The official jensen.js uses **two vendor IDs**:

```javascript
filters: [{vendorId: 4310}, {vendorId: 14471}]
```

| Decimal | Hex    | Manufacturer |
|---------|--------|--------------|
| 4310    | 0x10D6 | Actions Semiconductor |
| 14471   | 0x3887 | HiDock (newer devices) |

## Command IDs (Complete List)

From the official jensen.js:

### Basic Device Commands
| Command | ID | Description |
|---------|----|-----------|
| QUERY_DEVICE_INFO | 1 | Get device information |
| QUERY_DEVICE_TIME | 2 | Get device time |
| SET_DEVICE_TIME | 3 | Set device time |
| QUERY_FILE_LIST | 4 | Get file list |
| TRANSFER_FILE | 5 | Transfer file |
| QUERY_FILE_COUNT | 6 | Get file count |
| DELETE_FILE | 7 | Delete file |
| REQUEST_FIRMWARE_UPGRADE | 8 | Request firmware upgrade |
| FIRMWARE_UPLOAD | 9 | Upload firmware |
| DEVICE_MSG_TEST | 10 | Test message (also BNC_DEMO_TEST) |
| GET_SETTINGS | 11 | Get device settings |
| SET_SETTINGS | 12 | Set device settings |
| GET_FILE_BLOCK | 13 | Get file block |
| READ_CARD_INFO | 16 | Read SD card info |
| FORMAT_CARD | 17 | Format SD card |
| GET_RECORDING_FILE | 18 | Get recording file |
| RESTORE_FACTORY_SETTINGS | 19 | Restore factory settings |
| SEND_MEETING_SCHEDULE_INFO | 20 | Send meeting schedule |
| TRANSFER_FILE_PARTIAL | 21 | **P1 partial file transfer** |
| REQUEST_TONE_UPDATE | 22 | Request tone update |
| TONE_UPDATE | 23 | Upload tone |
| REQUEST_UAC_UPDATE | 24 | Request UAC update |
| UAC_UPDATE | 25 | Upload UAC |

### Realtime Streaming Commands
| Command | ID | Description |
|---------|----|-----------|
| REALTIME_READ_SETTING | 32 | Read realtime settings |
| REALTIME_CONTROL | 33 | Realtime control |
| REALTIME_TRANSFER | 34 | Realtime data transfer |

### Bluetooth Commands (P1 Only)
| Command | ID | Description |
|---------|----|-----------|
| BLUETOOTH_SCAN | 4097 | Start Bluetooth scan |
| BLUETOOTH_CMD | 4098 | Bluetooth command |
| BLUETOOTH_STATUS | 4099 | Bluetooth status |
| GET_BATTERY_STATUS | 4100 | Get battery status |
| BT_GET_PAIRED_DEV_LIST | 4103 | Get paired device list |

### Factory/Debug Commands
| Command | ID | Description |
|---------|----|-----------|
| FACTORY_RESET | 61451 | Factory reset |
| WRITE_WEBUSB_TIMEOUT | 61456 | Set WebUSB write timeout |
| READ_WEBUSB_TIMEOUT | 61457 | Set WebUSB read timeout |

## Model-Specific Behavior

### Device Type Classification (from HiNotes API)
| Device Type | Code Name | Serial Prefix | Firmware Range |
|-------------|-----------|---------------|----------------|
| H1E | "jensen" | HD1E | v5.x - v6.x |
| P1 / P1 Mini | "eason" | hpd1, hd1p | v1.x |

### P1 Devices ("eason")
- **NO version checks** - All features available regardless of firmware version
- Use `TRANSFER_FILE_PARTIAL` (cmd 21) for file transfers
- Support Bluetooth commands (4097-4103)
- Model names include colon: `hidock-p1:mini`
- Firmware: v1.2.x series (e.g., v1.2.8, v1.2.25, v1.2.26)

### H1E Devices ("jensen")
- **Version-gated features** (packed as major<<16 | minor<<8 | patch)
- Firmware: v6.x series (e.g., v6.2.5)
- Use standard `TRANSFER_FILE` (cmd 5)

### H1 Devices
- **Version-gated features** similar to H1E
- Firmware: v5.x series
- Use standard `TRANSFER_FILE` (cmd 5)

## Version Check Details

Version number is parsed from 4 bytes: `versionNumber = byte[0]<<24 | byte[1]<<16 | byte[2]<<8 | byte[3]`

**Critical Finding:** All version checks are gated by model:
```javascript
(this.model=="hidock-h1"||this.model=="hidock-h1e") && this.versionNumber<THRESHOLD
```

This means **P1 devices skip ALL version checks** and have full feature access.

### H1/H1E Version Requirements

| Version Number | Decoded | Features Enabled |
|----------------|---------|------------------|
| 327705 | v5.0.25 | FACTORY_RESET |
| 327714 | v5.0.34 | Auto-record, auto-play settings |
| 327722 | v5.0.42 | File list without count check |
| 327733 | v5.0.53 | Card info, format, recording file |
| 327940 | v5.1.4 | Notification settings (H1) |
| 327944 | v5.1.8 | RESTORE_FACTORY_SETTINGS (H1) |
| 393476 | v6.1.4 | Notification, RESTORE_FACTORY_SETTINGS (H1E) |

## Implications for hidock-next

### Issues Identified

1. **Product ID Mapping Error**: Our code uses 0xAF0x as primary, but official uses 0xB00x
2. **Missing Product ID 0xB00C**: H1 devices with 0xB00C not recognized
3. **Model Name Format**: P1 Mini should be `hidock-p1:mini` not `hidock-p1-mini`
4. **P1 File Transfer**: May need `TRANSFER_FILE_PARTIAL` instead of `TRANSFER_FILE`

### Recommended Fixes

1. Update all apps to use 0xB00x as primary product IDs
2. Add support for `TRANSFER_FILE_PARTIAL` (cmd 21) for P1 devices
3. Update model detection to match official jensen.js
4. Test with both vendor IDs (0x10D6 and 0x3887)

## File Transfer Protocol - Complete Analysis

### Official jensen.js File Download API

The Jensen module provides these file download methods (caller must choose which to use):

| Method | Command | Command ID | Body Format | Use Case |
|--------|---------|------------|-------------|----------|
| `getFile()` | TRANSFER_FILE | 5 | `filename` | **H1/H1E full download** |
| `streaming()` | TRANSFER_FILE | 5 | `filename` | **H1/H1E streaming download** |
| `getFilePart()` | GET_FILE_BLOCK | 13 | `length + filename` | Partial read (specific bytes) |
| `getFileBlock()` | GET_FILE_BLOCK | 13 | `length + filename` | Block-based partial read |
| `readFile()` | TRANSFER_FILE_PARTIAL | 21 | `offset + length + filename` | **P1 full download** |

### Key Finding: No Automatic Model Routing

**The Jensen module does NOT automatically route based on device model.** The calling application (hinotes.hidock.com) must decide which method to call:

- **H1/H1E devices**: App calls `getFile()` or `streaming()` → sends TRANSFER_FILE (5)
- **P1 devices**: App calls `readFile()` → sends TRANSFER_FILE_PARTIAL (21)

### Command Body Formats

**TRANSFER_FILE (cmd 5)** - For H1/H1E:
```
[filename bytes as ASCII character codes]
```

**GET_FILE_BLOCK (cmd 13)** - For partial reads:
```
[4 bytes: length (big-endian)] + [filename bytes]
```

**TRANSFER_FILE_PARTIAL (cmd 21)** - For P1:
```
[4 bytes: offset (big-endian)] + [4 bytes: length (big-endian)] + [filename bytes]
```

### Response Handlers

Each command has a registered response handler:
- `TRANSFER_FILE` → Handler receives file data chunks until total bytes >= expected length
- `GET_FILE_BLOCK` → Handler receives partial file data
- `TRANSFER_FILE_PARTIAL` → Handler converts body to Uint8Array

### Current hidock-next Implementation Status

| App | Command Used | Body Format | H1E Status | P1 Status |
|-----|--------------|-------------|------------|-----------|
| **Web** | GET_FILE_BLOCK (13) | `length + filename` | ❌ **WRONG** | ❌ **WRONG** |
| **Desktop** | TRANSFER_FILE (5) | `filename` | ✅ Correct | ❌ **WRONG** |
| **Electron** | TRANSFER_FILE (5) | `filename` | ✅ Correct | ❌ **WRONG** |

### Root Cause of GitHub Issue #19 (P1 Files)

The P1 device expects `TRANSFER_FILE_PARTIAL (21)` but:
- Web app sends `GET_FILE_BLOCK (13)` - wrong command entirely
- Desktop/Electron send `TRANSFER_FILE (5)` - correct for H1E but wrong for P1

### Required Fix: Model-Based Command Routing

All apps need to detect device model and route to correct command:

```typescript
async downloadFile(filename: string, length: number, model: string): Promise<ArrayBuffer> {
    if (model.includes('hidock-p1')) {
        // P1: Use TRANSFER_FILE_PARTIAL (cmd 21)
        // Body: offset (4 bytes) + length (4 bytes) + filename
        const body = new Uint8Array(8 + filename.length);
        const view = new DataView(body.buffer);
        view.setUint32(0, 0, false);        // offset = 0 (start of file)
        view.setUint32(4, length, false);   // length
        for (let i = 0; i < filename.length; i++) {
            body[8 + i] = filename.charCodeAt(i);
        }
        return this.sendCommand(HIDOCK_COMMANDS.TRANSFER_FILE_PARTIAL, body);
    } else {
        // H1/H1E: Use TRANSFER_FILE (cmd 5)
        // Body: just filename
        const body = new Uint8Array(filename.length);
        for (let i = 0; i < filename.length; i++) {
            body[i] = filename.charCodeAt(i);
        }
        return this.sendCommand(HIDOCK_COMMANDS.TRANSFER_FILE, body);
    }
}
```

### Web App Specific Fix Needed

The web app currently uses:
```typescript
// WRONG: Using GET_FILE_BLOCK for full file downloads
const seqId = await this.sendCommand(HIDOCK_COMMANDS.GET_FILE_BLOCK, body);
```

Should be:
```typescript
// CORRECT: Use TRANSFER_FILE for H1E, TRANSFER_FILE_PARTIAL for P1
const command = model.includes('hidock-p1')
    ? HIDOCK_COMMANDS.TRANSFER_FILE_PARTIAL
    : HIDOCK_COMMANDS.TRANSFER_FILE;
const seqId = await this.sendCommand(command, body);
```

## HiNotes API Endpoints (from HAR)

### User & Device Management
- `POST /v1/user/info` - Get user information
- `POST /v1/user/device/list` - List user's devices
- `POST /v1/user/device/status` - Get device status
- `POST /v1/user/setting/get` - Get user settings
- `POST /v1/user/setting/ai_engine/list` - List AI engines
- `POST /v1/user/trial/check` - Check trial status
- `POST /v1/user/country/list` - List countries
- `POST /v1/pricing` - Get pricing info

### Device Operations
- `POST /v2/device/settings` - Get/set device settings
- `POST /v2/device/firmware/latest` - Check for firmware updates
- `POST /v2/device/optimize/check` - Check device optimization
- `POST /v2/device/file/info` - Get file information
- `POST /v2/device/event/info` - Get event information

### Notes & Audio
- `POST /v2/note/list` - List notes
- `POST /v2/note/info` - Get note info
- `POST /v2/note/detail` - Get note details
- `POST /v2/note/latest` - Get latest notes
- `POST /v2/note/audio/resample` - Resample audio
- `GET /v2/note/audio/stream` - Stream audio (supports Range requests)
- `POST /v2/note/transcription/list` - List transcriptions
- `POST /v2/note/speaker/list` - List speakers
- `GET /v2/note/section/event/list` - List section events

### Calendar Integration
- `POST /v1/calendar/status` - Get calendar status
- `GET /v1/calendar/event/list` - List calendar events
- `GET /v1/calendar/event/sync/device` - Sync events to device
- `POST /v1/calendar/event/device_state/notice` - Device state notification

### Organization
- `POST /v1/folder/list` - List folders
- `POST /v2/tag/list` - List tags
- `POST /v2/tag/cluster` - Tag clustering

### Other
- `POST /v1/template/list` - List templates
- `POST /v1/share/create` - Create share link
- `GET /v2/integration/list` - List integrations
- `GET /v1/help/questions` - Help FAQ
- `GET /v1/promotion/setting/get` - Promotion settings
- `POST /v1/entry/info` - Entry information

## References

- Source HAR: `archive/h1e.filesync.hinotes.hidock.com-20260115.har`
- Source JS: `archive/jensen.8754fe1c.js`
- Official site: https://hinotes.hidock.com
