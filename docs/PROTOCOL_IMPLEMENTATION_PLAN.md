# HiDock Protocol Implementation Plan

## Command Implementation Status

### ✅ Already Implemented Commands

| Command ID | Command Name | Current Location | Status |
|------------|-------------|------------------|--------|
| 1 | GET_DEVICE_INFO | `deviceService.getDeviceInfo()` | ✅ Working |
| 2 | GET_DEVICE_TIME | - | ❌ Not implemented |
| 3 | SET_DEVICE_TIME | `deviceService.syncTime()` | ✅ Working |
| 4 | GET_FILE_LIST | `deviceService.getRecordings()` | ✅ Working |
| 5 | TRANSFER_FILE | `deviceService.receiveFileData()` | ⚠️ Private method |
| 6 | GET_FILE_COUNT | `deviceService.getFileCount()` | ⚠️ Private method |
| 7 | DELETE_FILE | `deviceService.deleteRecording()` | ✅ Working |
| 13 | GET_FILE_BLOCK | `deviceService.downloadFileBlocks()` | ✅ Working |
| 16 | GET_CARD_INFO | `deviceService.getStorageInfo()` | ⚠️ Private method |
| 17 | FORMAT_CARD | `deviceService.formatDevice()` | ✅ Working |

### ❌ Missing Command Implementations

| Command ID | Command Name | Jensen.js Method | Priority | Notes |
|------------|-------------|------------------|----------|-------|
| 2 | GET_DEVICE_TIME | `getTime()` | Medium | Get current device time |
| 8 | REQUEST_FIRMWARE_UPGRADE | `requestFirmwareUpgrade()` | Low | Firmware management |
| 9 | FIRMWARE_UPLOAD | `uploadFirmware()` | Low | Firmware management |
| 10 | DEVICE_MSG_TEST/BNC_DEMO | `beginBNC()/endBNC()` | Low | Testing commands |
| 11 | GET_SETTINGS | `getSettings()` | High | Device settings |
| 12 | SET_SETTINGS | `setAutoRecord()/setAutoPlay()/setNotification()` | High | Device settings |
| 18 | GET_RECORDING_FILE | `getRecordingFile()` | Medium | Get current recording |
| 19 | RESTORE_FACTORY_SETTINGS | `restoreFactorySettings()` | Medium | Factory reset |
| 20 | SEND_SCHEDULE_INFO | `sendScheduleInfo()` | High | Calendar integration |
| 4097 | BLUETOOTH_SCAN | `scanDevices()` | Low | P1 device only |
| 4098 | BLUETOOTH_CMD | `connectBTDevice()/disconnectBTDevice()` | Low | P1 device only |
| 4099 | BLUETOOTH_STATUS | `getBluetoothStatus()` | Low | P1 device only |
| 61451 | FACTORY_RESET | `factoryReset()` | Low | Advanced reset |
| 61447 | TEST_SN_WRITE | `writeSerialNumber()` | Low | Manufacturing |
| 61448 | RECORD_TEST_START | `recordTestStart()` | Low | Testing |
| 61449 | RECORD_TEST_END | `recordTestEnd()` | Low | Testing |

## Additional Jensen.js Features Not Mapped

| Feature | Jensen.js Method | Description | Priority |
|---------|------------------|-------------|----------|
| Realtime Audio | `getRealtimeSettings()/startRealtime()/stopRealtime()` | Live audio streaming | Medium |
| File Reading | `readFile()` | Read specific file bytes | Low |
| Tone Updates | `requestToneUpdate()/updateTone()` | Audio tone management | Low |
| UAC Updates | `requestUACUpdate()/updateUAC()` | USB Audio Class updates | Low |

## Implementation Plan

### Phase 1: High Priority (Device Settings & Calendar)
Location: `apps/web/src/services/deviceService.ts`

#### 1.1 Device Settings Commands
```typescript
// GET_SETTINGS (11)
async getSettings(): Promise<DeviceSettings> {
  const seqId = await this.sendCommand(HIDOCK_COMMANDS.GET_SETTINGS);
  const response = await this.receiveResponse(seqId);
  // Parse response: autoRecord, autoPlay, bluetoothTone, notification
  return parseSettings(response.data);
}

// SET_SETTINGS (12) - Multiple methods
async setAutoRecord(enabled: boolean): Promise<void> {
  const body = new Uint8Array([0, 0, 0, enabled ? 1 : 2]);
  const seqId = await this.sendCommand(HIDOCK_COMMANDS.SET_SETTINGS, body);
  await this.receiveResponse(seqId);
}

async setAutoPlay(enabled: boolean): Promise<void> {
  const body = new Uint8Array([0, 0, 0, 0, 0, 0, 0, enabled ? 1 : 2]);
  const seqId = await this.sendCommand(HIDOCK_COMMANDS.SET_SETTINGS, body);
  await this.receiveResponse(seqId);
}

async setNotification(enabled: boolean): Promise<void> {
  const body = new Uint8Array(12);
  body[11] = enabled ? 1 : 2;
  const seqId = await this.sendCommand(HIDOCK_COMMANDS.SET_SETTINGS, body);
  await this.receiveResponse(seqId);
}
```

#### 1.2 Calendar Integration
```typescript
// SEND_SCHEDULE_INFO (20)
async sendScheduleInfo(meetings: MeetingInfo[]): Promise<void> {
  const body = buildScheduleBody(meetings); // Format per jensen.js
  const seqId = await this.sendCommand(HIDOCK_COMMANDS.SEND_SCHEDULE_INFO, body);
  await this.receiveResponse(seqId);
}
```

### Phase 2: Medium Priority (Device Management)
Location: `apps/web/src/services/deviceService.ts`

#### 2.1 Device Time & Info
```typescript
// GET_DEVICE_TIME (2)
async getDeviceTime(): Promise<Date> {
  const seqId = await this.sendCommand(HIDOCK_COMMANDS.GET_DEVICE_TIME);
  const response = await this.receiveResponse(seqId);
  return parseDeviceTime(response.data); // BCD format parsing
}

// GET_RECORDING_FILE (18)
async getCurrentRecording(): Promise<RecordingInfo | null> {
  const seqId = await this.sendCommand(HIDOCK_COMMANDS.GET_RECORDING_FILE);
  const response = await this.receiveResponse(seqId);
  return parseRecordingInfo(response.data);
}
```

#### 2.2 Factory Reset
```typescript
// RESTORE_FACTORY_SETTINGS (19)
async restoreFactorySettings(): Promise<void> {
  const body = new Uint8Array([1, 2, 3, 4]); // Magic bytes
  const seqId = await this.sendCommand(HIDOCK_COMMANDS.RESTORE_FACTORY_SETTINGS, body);
  await this.receiveResponse(seqId);
}
```

### Phase 3: Low Priority (Advanced Features)
Location: `apps/web/src/services/deviceService.ts`

#### 3.1 Bluetooth Support (P1 Device)
```typescript
// BLUETOOTH_SCAN (4097)
async scanBluetoothDevices(timeout: number = 20): Promise<BluetoothDevice[]> {
  if (this.device?.productId !== HIDOCK_PRODUCT_IDS.P1) return [];
  const seqId = await this.sendCommand(HIDOCK_COMMANDS.BLUETOOTH_SCAN);
  const response = await this.receiveResponse(seqId, timeout * 1000);
  return parseBluetoothDevices(response.data);
}

// BLUETOOTH_STATUS (4099)
async getBluetoothStatus(): Promise<BluetoothStatus> {
  if (this.device?.productId !== HIDOCK_PRODUCT_IDS.P1) return null;
  const seqId = await this.sendCommand(HIDOCK_COMMANDS.BLUETOOTH_STATUS);
  const response = await this.receiveResponse(seqId);
  return parseBluetoothStatus(response.data);
}
```

#### 3.2 Firmware Management
```typescript
// REQUEST_FIRMWARE_UPGRADE (8)
async requestFirmwareUpgrade(version: number, size: number): Promise<FirmwareResponse> {
  const body = new Uint8Array(8);
  const view = new DataView(body.buffer);
  view.setUint32(0, version, false);
  view.setUint32(4, size, false);
  const seqId = await this.sendCommand(HIDOCK_COMMANDS.REQUEST_FIRMWARE_UPGRADE, body);
  const response = await this.receiveResponse(seqId);
  return parseFirmwareResponse(response.data);
}
```

## Hook Integration
Location: `apps/web/src/hooks/useDeviceConnection.ts`

Add new methods to the hook return:
```typescript
return {
  // Existing
  device,
  isDeviceConnected,
  connectDevice,
  disconnectDevice,
  refreshRecordings,
  downloadRecording,
  deleteRecording,
  formatDevice,
  syncTime,
  
  // New - Settings
  getSettings,
  setAutoRecord,
  setAutoPlay,
  setNotification,
  
  // New - Calendar
  sendScheduleInfo,
  
  // New - Device Management
  getDeviceTime,
  getCurrentRecording,
  restoreFactorySettings,
  
  // New - Bluetooth (P1 only)
  scanBluetoothDevices,
  getBluetoothStatus,
  connectBluetoothDevice,
  disconnectBluetoothDevice,
};
```

## Type Definitions
Location: `apps/web/src/types/index.ts`

```typescript
export interface DeviceSettings {
  autoRecord: boolean;
  autoPlay: boolean;
  bluetoothTone: boolean;
  notification?: boolean;
}

export interface MeetingInfo {
  platform: string;
  startDate: Date;
  endDate: Date;
  title?: string;
  os?: 'Windows' | 'Mac' | 'Linux';
}

export interface BluetoothDevice {
  name: string;
  mac: string;
}

export interface BluetoothStatus {
  status: 'connected' | 'disconnected';
  mac?: string;
  name?: string;
  a2dp?: boolean;
  hfp?: boolean;
  avrcp?: boolean;
  battery?: number;
}

export interface FirmwareResponse {
  result: 'accepted' | 'wrong-version' | 'busy' | 'card-full' | 'card-error';
}
```

## Testing Requirements

1. **Unit Tests**: Each new method needs unit tests
2. **Device Tests**: Test with actual H1E device
3. **P1 Device Tests**: Bluetooth features need P1 device
4. **Calendar Integration**: Test with real Microsoft account
5. **Settings Persistence**: Verify settings are saved to device

## UI Components Needed

1. **Settings Page Enhancement**: Add device settings controls
2. **Calendar Integration UI**: OAuth flow and meeting sync
3. **Device Info Panel**: Show device time, firmware version
4. **Bluetooth Manager**: P1 device Bluetooth controls
5. **Factory Reset Dialog**: Confirmation for reset operations

## Priority Order for Implementation

1. **Week 1**: Device Settings (GET_SETTINGS, SET_SETTINGS)
2. **Week 2**: Calendar Integration (SEND_SCHEDULE_INFO)
3. **Week 3**: Device Management (GET_DEVICE_TIME, RESTORE_FACTORY_SETTINGS)
4. **Week 4**: Bluetooth Support (if P1 device available)
5. **Future**: Firmware management, testing commands