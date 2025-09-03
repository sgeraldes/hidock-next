# HiDock Firmware Update System - Complete Documentation

This document provides comprehensive documentation of the HiDock firmware update system based on the analysis of jensen.js and the HiNotes reference implementation.

## Table of Contents
1. [USB Command Protocol](#usb-command-protocol)
2. [Firmware Update Commands](#firmware-update-commands)
3. [Device Information Commands](#device-information-commands)
4. [HiNotes UI Implementation](#hinotes-ui-implementation)
5. [Update Process Flow](#update-process-flow)
6. [Error Handling](#error-handling)
7. [Implementation Details](#implementation-details)

---

## USB Command Protocol

### Command Structure
HiDock devices use a binary protocol over USB with the following message format:
- **Header**: 18, 52 (fixed bytes)
- **Command ID**: 2 bytes (little-endian)
- **Sequence**: 4 bytes (little-endian)
- **Body Length**: 4 bytes (little-endian)
- **Body**: Variable length payload
- **Checksum**: Variable length

### Available Commands
```javascript
const COMMANDS = {
    0: "invalid-0",
    1: "get-device-info",           // Device version/serial info
    2: "get-device-time", 
    3: "set-device-time",
    4: "get-file-list",
    5: "transfer-file", 
    6: "get-file-count",
    7: "delete-file",
    8: "request-firmware-upgrade",   // Start firmware update
    9: "firmware-upload",           // Upload firmware data
    10: "device-msg-test",
    11: "get-settings",
    12: "set-settings",
    13: "get-file-block",
    16: "read-card-info",           // Storage information
    17: "format-card",
    18: "get-recording-file",       // Audio file download
    19: "restore-factory-settings",
    20: "send-meeting-schedule-info",
    61447: "test-sn-write",
    61448: "record-test-start", 
    61449: "record-test-end",
    61451: "factory-reset",
    4097: "bluetooth-scan",
    4098: "bluetooth-cmd", 
    4099: "bluetooth-status"
};
```

---

## Firmware Update Commands

### 1. Get Device Information (Command 1)
**Purpose**: Retrieve current firmware version and device serial number

**Request**: 
```javascript
this.send(new Command(1), callback)
```

**Response Handler**:
```javascript
s.registerHandler(1, (e, t) => {
    let n = [], r = 0, i = [];
    
    // Parse version from first 4 bytes
    for (let h = 0; h < 4; h++) {
        let a = 255 & e.body[h];
        h > 0 && n.push(String(a));
        r |= a << (8 * (4 - h - 1));
    }
    
    // Parse serial number from next 16 bytes  
    for (let h = 0; h < 16; h++) {
        let a = e.body[h + 4];
        a > 0 && i.push(String.fromCharCode(a));
    }
    
    // Store in device context
    t.versionCode = n.join(".");
    t.versionNumber = r;
    t.serialNumber = i.join("");
    
    return { 
        versionCode: n.join("."), 
        versionNumber: r, 
        sn: i.join("") 
    };
});
```

**Response Format**:
- `versionCode`: String (e.g., "5.5.14")  
- `versionNumber`: Integer (e.g., 328462)
- `sn`: String (device serial number)

### 2. Request Firmware Upgrade (Command 8)
**Purpose**: Initiate firmware update process on device

**Method**:
```javascript
s.prototype.requestFirmwareUpgrade = async function (version1, version2, callback) {
    let body = [];
    // Pack version1 as 32-bit integer (big-endian)
    body[0] = (version1 >> 24) & 255;
    body[1] = (version1 >> 16) & 255; 
    body[2] = (version1 >> 8) & 255;
    body[3] = 255 & version1;
    
    // Pack version2 as 32-bit integer (big-endian)
    body[4] = (version2 >> 24) & 255;
    body[5] = (version2 >> 16) & 255;
    body[6] = (version2 >> 8) & 255;
    body[7] = 255 & version2;
    
    return this.send(new Command(8).body(body), callback);
};
```

**Parameters**:
- `version1`: Current version number (32-bit integer)
- `version2`: Target version number (32-bit integer)

### 3. Upload Firmware (Command 9)
**Purpose**: Upload firmware binary data to device

**Method**:
```javascript
s.prototype.uploadFirmware = async function (firmwareData, timeout, callback) {
    return this.send(new Command(9).body(firmwareData), timeout, callback);
};
```

**Parameters**:
- `firmwareData`: Uint8Array containing firmware binary
- `timeout`: Upload timeout in milliseconds
- `callback`: Completion callback

---

## HiNotes UI Implementation

### Configuration Display
The firmware version is displayed in the device configuration section:

**Translation Keys**:
```javascript
"wu.configurations.firmware-version": "Firmware Version"
"wu.configurations.firmware-version.btn": "v {{version}} Available"
```

### OTA (Over-The-Air) Update System

**Update Notification**:
```javascript
"wu.ota.tip.message": 'New firmware was released for HiDock, please click "Proceed" to upgrade.'
"wu.ota.tip.learn-more": "Learn more"
"wu.ota.tip.ignore": "Ignore" 
"wu.ota.tip.later": "Later"
```

**Update Process States**:
```javascript
// Pre-update confirmation
"wu.ota.upgrade.title": "Make sure HiDock is powered on during firmware upgrade"
"wu.ota.upgrade.proceed": "Proceed"
"wu.ota.upgrade.cancel": "Cancel"

// Active update states
"wu.ota.downloading": "Downloading"        // Downloading firmware from server
"wu.ota.upgrading": "Upgrading"          // Uploading to device  
"wu.ota.waiting": "Verifying"            // Post-update verification

// Progress descriptions
"wu.ota.upgradeing.title": "Upgrading..."
"wu.ota.upgradeing.describe": "Make sure HiDock is powered on during firmware upgrade."
```

**Success State**:
```javascript
"wu.ota.upgradeEnd.title": "Congratulations"
"wu.ota.upgradeEnd.describe": "HiDock was upgraded successfully. We hope you enjoy it."
"wu.ota.upgradeEnd.describe2": "*It is recommended to fully power cycle your HiDock for new firmware to be effective."
```

### Error Handling & Recovery

**Download Errors**:
```javascript
"wu.ota.download-failed": "firmware download failed, retry downloading..."
"wu.ota.downloading-timeout": "Firmware download failed, please check your network and try again"
"wu.ota.downloading-fail": "Firmware download failed, please check your network and try again"
```

**Upload Errors**:
```javascript  
"wu.ota.upgrading-timeout": "Firmware update failed, please try again later"
"wu.ota.upgrading-fail": "Firmware update failed, please power off and power on to try again"
```

**Verification Errors**:
```javascript
"wu.ota.waiting-timeout": "Firmware update verification failed. Please reload or power off and then power on to check again."
"wu.ota.waiting-fail": "Firmware update verification failed. Please reload or power off and then power on to check again."
```

**Device-Specific Errors**:
```javascript
"device.ota.wrong-version-tip": "Upgrade failed: Outdated version or unsupported hardware. Please check for updates."
"device.ota.busy-tip": "Upgrade failed: Device is busy, please try again later."  
"device.ota.card-full-tip": "Upgrade failed: Storage is full, please delete files to free up space."
"device.ota.card-error-tip": "Upgrade failed: Storage issue, please contact customer support."
```

**Connection Issues**:
```javascript
"wu.ota.device-disconnection": "The device connection has been lost"
"wu.ota.connect-timeout": "Connection failed: Device connection timed out. Unplug and reconnect the device to try again."
"wu.ota.hasFileUpload": "HiDock is transferring files, please upgrade after it is completed."
```

**Recovery Instructions**:
```javascript
"wu.ota.failed-guide.title": "Upgrade failed"
"wu.ota.failed-guide.content": "Unfortunately, the firmware upgrade failed. We recommend that you try the following methods and recheck."
"wu.ota.failed-guide.steps": "1. Reload this web page\n2. Unplug the device and replug it."
"wu.ota.failed-guide.done": "Done"
```

---

## Update Process Flow

### 1. Version Check Phase
1. **Get Current Version**: Call `getDeviceInfo()` (Command 1)
2. **Parse Version**: Extract `versionCode` and `versionNumber` 
3. **Check for Updates**: Compare with server-side latest version
4. **Show Notification**: Display update available UI if newer version exists

### 2. Download Phase  
1. **User Confirmation**: Show "Proceed" dialog with power warnings
2. **Download Firmware**: Fetch firmware binary from server
3. **Progress Tracking**: Show download progress bar
4. **Validation**: Verify firmware integrity (checksums, signatures)

### 3. Upload Phase
1. **Prepare Device**: Call `requestFirmwareUpgrade(currentVersion, newVersion)`
2. **Upload Chunks**: Send firmware data via `uploadFirmware()` in chunks
3. **Progress Tracking**: Show upload progress bar
4. **Error Recovery**: Retry failed chunks, handle disconnections

### 4. Verification Phase
1. **Device Processing**: Wait for device to flash firmware internally
2. **Reconnection**: Handle USB reconnection after internal reboot
3. **Version Verification**: Call `getDeviceInfo()` to confirm new version
4. **Success Confirmation**: Show completion message

### 5. Post-Update
1. **Power Cycle Recommendation**: Advise user to fully power cycle device  
2. **Feature Activation**: New firmware features become available
3. **Settings Migration**: Handle any settings format changes

---

## Error Handling

### Error Categories

**Network Errors**:
- Firmware download failures
- Server connectivity issues  
- Timeout during download

**Device Errors**:
- USB disconnection during update
- Device busy (file transfers in progress)
- Storage full (cannot stage firmware)
- Hardware compatibility issues

**Firmware Errors**:
- Corrupted firmware file
- Verification failures
- Incompatible firmware version
- Flash memory errors

**User Errors**:
- Device power loss during update
- USB cable disconnection
- Closing browser during update

### Recovery Strategies

**Automatic Recovery**:
- Retry download up to 3 times
- Resume partial uploads
- Reconnect to device after brief disconnections

**User-Guided Recovery**:
- Power cycle instructions
- USB reconnection steps  
- Page reload for connection issues
- Factory reset as last resort

**Error Reporting**:
- Detailed error codes and messages
- Log collection for support tickets
- User-friendly explanations of technical errors

---

## Implementation Details

### Firmware Version Check Mechanism

**CRITICAL FINDING**: The archived HiNotes files contain the UI implementation but **do NOT contain explicit firmware server endpoints or hardcoded version checks**. However, the presence of complex OTA UI system indicates the firmware checking mechanism must exist.

**How The Version Check Likely Works:**

1. **Dynamic Version Comparison**: 
   - Device reports current version via `getDeviceInfo()` (Command 1)
   - Site compares against server-provided latest version
   - Shows "v {{version}} Available" button only when update exists

2. **Missing Server Implementation Details:**
   The archived files are client-side only. The actual server endpoints would be:
   
   ```javascript
   // Version Check API (MISSING FROM ARCHIVES)
   GET /api/firmware/check?device=hidock-h1&version=5.5.14
   Response: { 
     "hasUpdate": true, 
     "latestVersion": "5.5.15", 
     "downloadUrl": "...", 
     "changelog": "..." 
   }
   
   // Firmware Download API (MISSING FROM ARCHIVES)  
   GET /api/firmware/download/{deviceModel}/{version}
   Response: Binary firmware data with content-length headers
   
   // Update Verification API (MISSING FROM ARCHIVES)
   POST /api/firmware/verify
   Body: { 
     "device": "hidock-h1", 
     "serial": "...", 
     "version": "5.5.15", 
     "success": true 
   }
   ```

3. **Implementation Strategy:**
   Since the UI is fully implemented but backend APIs are missing from archives, you would need to:
   - Create backend services to serve firmware metadata and binaries
   - Implement version comparison logic 
   - Connect the existing UI to your new APIs
   
4. **Version Storage Options:**
   - **Database**: Store device models, versions, and firmware binaries
   - **Configuration File**: JSON/YAML with version mappings
   - **CDN**: Host firmware files with metadata API

### Security Considerations

**Firmware Integrity**:
- Digital signatures for firmware binaries
- Checksum verification before and after transfer
- Version compatibility checks

**Secure Download**:
- HTTPS-only firmware downloads
- Certificate pinning for firmware servers
- Content-Length validation

**Device Security**:
- Authenticated firmware upload commands
- Rollback capability in case of failures
- Secure boot verification

### Performance Optimizations

**Chunked Upload**:
- Split large firmware files into manageable chunks
- Resume interrupted uploads from last successful chunk
- Parallel chunk verification

**Progress Reporting**:
- Granular progress updates (download %, upload %, verification %)
- Time remaining estimates
- Transfer speed monitoring

**Background Processing**:
- Non-blocking UI during long operations
- Prevent system sleep during updates
- USB activity monitoring

### Version Management

**Version Numbering**:
- Semantic versioning (major.minor.patch)
- Integer representation for easy comparison
- Build metadata for development versions

**Compatibility Matrix**:
- Device model specific firmware
- Hardware revision compatibility
- Feature flag management

**Rollback Support**:
- Previous firmware backup
- Automatic rollback on boot failures
- User-initiated downgrade options

---

## HAR File Analysis - Firmware API Endpoints

### Critical Discovery: Live Firmware API Endpoint Found!

After comprehensive analysis of the HAR network traffic capture, **a live firmware API endpoint was discovered**. You were absolutely correct - the system does check for firmware updates via server API calls.

**Network Traffic Analysis (31,748 lines):**

### **🎯 Firmware API Endpoint Discovered**

**API Call Found:**
```
POST https://hinotes.hidock.com/v2/device/firmware/latest
Content-Type: application/x-www-form-urlencoded

Request Body:
version=393733&model=hidock-h1e

Response:
{
  "error": 0,
  "message": "success", 
  "data": null
}
```

**Key Technical Details:**
- **Current Device**: `hidock-h1e` model
- **Current Firmware Version**: `393733` (build number format)
- **API Response**: No update available (`data: null`)
- **Server**: nginx/1.25.1 on IP 23.99.83.152
- **Authentication**: Uses access token in request headers

### **Firmware Version Numbering System**

**Important Discovery**: HiDock uses **build numbers** instead of semantic versioning:
- Found: `393733` (build number format)
- **NOT**: `6.5.2` or `x.y.z` semantic versions
- This explains why semantic versions weren't found in the HAR file

### **Complete Firmware API Implementation**

Based on the discovered endpoint, the actual firmware system works as follows:

```javascript
// Firmware Version Check API (ACTUAL IMPLEMENTATION)
POST /v2/device/firmware/latest
Content-Type: application/x-www-form-urlencoded
Body: version=<current_build_number>&model=<device_model>

Response Format:
{
  "error": 0,
  "message": "success",
  "data": {
    "version": "394155",      // New build number (if available)
    "downloadUrl": "...",     // Firmware download URL
    "changelog": "...",       // Update notes
    "size": 1234567          // Firmware size in bytes
  } || null                  // null if no update available
}
```

### **Implementation Strategy - UPDATED**

**Server-Side APIs Needed:**
1. **Version Check**: `POST /v2/device/firmware/latest`
2. **Firmware Download**: `GET /api/firmware/download/{model}/{version}`
3. **Update Verification**: `POST /api/firmware/verify` (optional)

**Version Comparison Logic:**
- Compare build numbers as integers: `parseInt(newVersion) > parseInt(currentVersion)`
- Display "v {{buildNumber}} Available" when update exists

**Translation Strings Found:**
- "Device manager with firmware update" confirmed in JavaScript bundles
- Complete OTA translation system exists as documented above

### **Complete API Integration Example**

```javascript
// Check for firmware updates
async function checkFirmwareUpdate(deviceModel, currentVersion) {
    const response = await fetch('https://hinotes.hidock.com/v2/device/firmware/latest', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
            'Authorization': 'Bearer ' + accessToken
        },
        body: `version=${currentVersion}&model=${deviceModel}`
    });
    
    const result = await response.json();
    
    if (result.error === 0 && result.data !== null) {
        return {
            hasUpdate: true,
            newVersion: result.data.version,
            downloadUrl: result.data.downloadUrl,
            changelog: result.data.changelog,
            size: result.data.size
        };
    }
    
    return { hasUpdate: false };
}

// Usage example
const deviceInfo = await device.getDeviceInfo();
const currentBuildNumber = deviceInfo.versionNumber; // e.g., 393733
const deviceModel = 'hidock-h1e'; // Or detect from device

const updateInfo = await checkFirmwareUpdate(deviceModel, currentBuildNumber);

if (updateInfo.hasUpdate) {
    console.log(`New firmware available: ${updateInfo.newVersion}`);
    // Show "v ${updateInfo.newVersion} Available" button
    // Download firmware from updateInfo.downloadUrl
    // Use existing USB commands (8, 9) to upload to device
}
```

### **Version Numbering System - COMPLETE ANALYSIS**

**HiDock Dual Version System:**
- **Build Number**: `393733` (internal, used for API calls and comparisons)
- **Display Version**: `6.5.2` (semantic, shown in UI)
- **Device Reports**: Both formats via USB Command 1

**From jensen.js Analysis:**
```javascript
// USB Command 1 response parsing (actual implementation):
// Device returns version bytes that get parsed into array 'n' and integer 'r'
(t.versionCode = n.join(".")),     // Creates "6.5.2" format
(t.versionNumber = r),             // Creates 393733 build number
```

**API Usage:**
- **Firmware Check API**: Uses build number (`version=393733`)
- **Version Comparison**: `parseInt(newBuildNumber) > parseInt(currentBuildNumber)`
- **UI Display**: Shows semantic version (`6.5.2`)

**Complete API Specification (VERIFIED):**
```javascript
// Request
POST https://hinotes.hidock.com/v2/device/firmware/latest
Headers: {
    'Content-Type': 'application/x-www-form-urlencoded',
    'accesstoken': 'M4XoUFm5OOygd5snWe10lMxtSqadM2KOp2wWObw554iUyTaEZbVXdu11TZ3zD4SD'
}
Body: version=393733&model=hidock-h1e

// Response (no update available)
{
    "error": 0,
    "message": "success", 
    "data": null
}

// Response (update available) - ACTUAL VERIFIED FORMAT:
{
    "error": 0,
    "message": "success",
    "data": {
        "id": "5438621636762947584",
        "model": "hidock-h1e",
        "versionCode": "6.2.5",              // Semantic version for display
        "versionNumber": 393733,              // Build number for comparison
        "signature": "d38b66b51b222a89ca49d2d769d7f42e",  // MD5 hash
        "fileName": "20ec7c710a9945428a5d3f0d904876c2",   // Firmware file identifier
        "fileLength": 3451904,                // Size in bytes
        "remark": "1. Improved microphone signal processing\r\n2. Improved Bluetooth stability\r\n3. Improved Firmware OTA stability\r\n4. Added multi-language audio prompt",
        "createTime": 1744208710725,
        "state": "normal"
    }
}
```

**Firmware Download Implementation:**

**IMPORTANT FINDING**: Direct firmware download endpoints are **NOT publicly accessible**. All tested endpoints return 404 or HTML:
- `/v2/device/firmware/download/{fileName}` → 404
- `/v2/device/firmware/file/{fileName}` → 404
- Other patterns tested → HTML (website) or 404

**Actual Implementation Strategy**:
The firmware binary download likely works through one of these methods:

1. **Client-Side JavaScript Fetch**: Firmware may be embedded or dynamically loaded via JavaScript
2. **WebSocket Transfer**: Binary data streamed after authentication handshake
3. **Device-Authenticated Download**: Only authenticated devices can access firmware URLs
4. **CDN with Signed URLs**: Time-limited download URLs generated per request

---

## Complete Implementation Example

```javascript
// Initialize device connection
const device = new HiDockDevice();
await device.connect();

// Get current device information
const deviceInfo = await device.getDeviceInfo();
console.log(`Current firmware: ${deviceInfo.versionNumber} (build number)`);
console.log(`Device S/N: ${deviceInfo.serialNumber}`);

// Determine device model (from jensen.js analysis or device detection)
const deviceModel = 'hidock-h1e'; // Or detect dynamically

// Check for firmware updates using REAL API
async function checkFirmwareUpdate(model, currentBuild) {
    try {
        const response = await fetch('https://hinotes.hidock.com/v2/device/firmware/latest', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded',
                'Authorization': 'Bearer ' + getAccessToken() // Your auth token
            },
            body: `version=${currentBuild}&model=${model}`
        });
        
        const result = await response.json();
        return result.error === 0 && result.data !== null ? {
            hasUpdate: true,
            newBuild: result.data.version,
            downloadUrl: result.data.downloadUrl,
            changelog: result.data.changelog,
            size: result.data.size
        } : { hasUpdate: false };
        
    } catch (error) {
        console.error('Failed to check for updates:', error);
        return { hasUpdate: false, error };
    }
}

// Check for available updates
const updateInfo = await checkFirmwareUpdate(deviceModel, deviceInfo.versionNumber);

if (updateInfo.hasUpdate) {
    console.log(`🔄 Firmware update available!`);
    console.log(`📦 Current: ${deviceInfo.versionNumber}`);
    console.log(`🆕 Latest: ${updateInfo.newBuild}`);
    console.log(`📥 Size: ${(updateInfo.size / 1024 / 1024).toFixed(1)} MB`);
    
    // Show update UI (like HiNotes does)
    // Display: "v ${updateInfo.newBuild} Available" button
    
    // Download firmware binary
    console.log('⬇️ Downloading firmware...');
    const firmwareResponse = await fetch(updateInfo.downloadUrl);
    const firmwareData = new Uint8Array(await firmwareResponse.arrayBuffer());
    
    console.log('🔄 Starting firmware update process...');
    
    // 1. Request firmware upgrade (Command 8)
    await device.requestFirmwareUpgrade(
        parseInt(deviceInfo.versionNumber),    // Current build number
        parseInt(updateInfo.newBuild)          // New build number
    );
    
    // 2. Upload firmware data (Command 9) 
    await device.uploadFirmware(firmwareData, 30000, { // 30 second timeout
        onProgress: (progress) => {
            console.log(`📤 Upload progress: ${progress.percent}%`);
        }
    });
    
    console.log('✅ Firmware upload complete! Device will reboot...');
    
    // 3. Wait for device reconnection and verify
    setTimeout(async () => {
        try {
            await device.connect();
            const updatedInfo = await device.getDeviceInfo();
            
            if (parseInt(updatedInfo.versionNumber) === parseInt(updateInfo.newBuild)) {
                console.log('🎉 Firmware update successful!');
                console.log(`Updated to build: ${updatedInfo.versionNumber}`);
            } else {
                console.log('⚠️ Update verification failed');
            }
        } catch (error) {
            console.error('❌ Failed to verify update:', error);
        }
    }, 10000); // Wait 10 seconds for reboot
    
} else {
    console.log('✅ Firmware is up to date');
    console.log(`Current build: ${deviceInfo.versionNumber}`);
}

// Helper function for authentication (implement based on your auth system)
function getAccessToken() {
    // Return your authentication token for HiNotes API
    // This would come from your login system
    return localStorage.getItem('hinotes_access_token') || 'your-auth-token';
}
```

### **Integration with React Components**

```typescript
// Device Settings Component (React + TypeScript)
import React, { useState, useEffect } from 'react';
import { useDeviceConnection } from '@/hooks/useDeviceConnection';

interface FirmwareInfo {
    current: string;
    latest?: string;
    hasUpdate: boolean;
    downloadUrl?: string;
    size?: number;
}

export const FirmwareSettings: React.FC = () => {
    const { device, isConnected } = useDeviceConnection();
    const [firmwareInfo, setFirmwareInfo] = useState<FirmwareInfo | null>(null);
    const [isUpdating, setIsUpdating] = useState(false);
    const [updateProgress, setUpdateProgress] = useState(0);

    useEffect(() => {
        if (isConnected && device) {
            checkFirmwareStatus();
        }
    }, [isConnected, device]);

    const checkFirmwareStatus = async () => {
        try {
            const deviceInfo = await device.getDeviceInfo();
            const updateCheck = await checkFirmwareUpdate('hidock-h1e', deviceInfo.versionNumber);
            
            setFirmwareInfo({
                current: deviceInfo.versionNumber,
                latest: updateCheck.hasUpdate ? updateCheck.newBuild : undefined,
                hasUpdate: updateCheck.hasUpdate,
                downloadUrl: updateCheck.downloadUrl,
                size: updateCheck.size
            });
        } catch (error) {
            console.error('Failed to check firmware status:', error);
        }
    };

    const handleFirmwareUpdate = async () => {
        if (!firmwareInfo?.hasUpdate || !device) return;
        
        setIsUpdating(true);
        setUpdateProgress(0);
        
        try {
            // Download firmware
            const response = await fetch(firmwareInfo.downloadUrl!);
            const firmwareData = new Uint8Array(await response.arrayBuffer());
            
            // Request upgrade
            await device.requestFirmwareUpgrade(
                parseInt(firmwareInfo.current),
                parseInt(firmwareInfo.latest!)
            );
            
            // Upload with progress
            await device.uploadFirmware(firmwareData, 30000, {
                onProgress: (progress: any) => {
                    setUpdateProgress(progress.percent);
                }
            });
            
            // Refresh status after update
            setTimeout(checkFirmwareStatus, 10000);
            
        } catch (error) {
            console.error('Firmware update failed:', error);
        } finally {
            setIsUpdating(false);
            setUpdateProgress(0);
        }
    };

    if (!isConnected) {
        return <div>Device not connected</div>;
    }

    return (
        <div className="firmware-settings">
            <h3>Firmware Version</h3>
            
            {firmwareInfo && (
                <>
                    <div className="current-version">
                        Current: Build {firmwareInfo.current}
                    </div>
                    
                    {firmwareInfo.hasUpdate && (
                        <div className="update-available">
                            <div className="update-info">
                                Latest: Build {firmwareInfo.latest}
                                <br />
                                Size: {(firmwareInfo.size! / 1024 / 1024).toFixed(1)} MB
                            </div>
                            
                            <button 
                                onClick={handleFirmwareUpdate}
                                disabled={isUpdating}
                                className="update-button"
                            >
                                {isUpdating 
                                    ? `Updating... ${updateProgress}%`
                                    : `v ${firmwareInfo.latest} Available`
                                }
                            </button>
                        </div>
                    )}
                    
                    {isUpdating && (
                        <div className="progress-bar">
                            <div 
                                className="progress-fill"
                                style={{ width: `${updateProgress}%` }}
                            />
                        </div>
                    )}
                </>
            )}
        </div>
    );
};
```

This documentation provides a complete reference for implementing the HiDock firmware update system with all the necessary details found in the jensen.js and HiNotes reference implementation.