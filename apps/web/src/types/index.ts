// Device Types
export interface HiDockDevice {
  id: string;
  name: string;
  model: string;
  serialNumber: string;
  firmwareVersion: string;
  connected: boolean;
  storageInfo: StorageInfo;
  settings?: DeviceSettings;
}

export interface StorageInfo {
  totalCapacity: number;
  usedSpace: number;
  freeSpace: number;
  fileCount: number;
}

// Audio Recording Types
export interface AudioRecording {
  id: string;
  fileName: string;
  size: number;
  duration: number;
  dateCreated: Date;
  status: RecordingStatus;
  localPath?: string;
  transcription?: string;
  insights?: InsightData;
}

export type RecordingStatus =
  | 'on_device'
  | 'downloading'
  | 'downloaded'
  | 'playing'
  | 'transcribing'
  | 'transcribed'
  | 'analyzing'
  | 'analyzed'
  | 'error';

// Audio Data Types
export type AudioFormat = 'audio/wav' | 'audio/mp3' | 'audio/m4a' | 'audio/ogg' | 'audio/webm';

export interface AudioData {
  fileName: string;
  base64: string;
  mimeType: AudioFormat;
  size: number;
  duration?: number;
}

// AI Transcription Types
export interface TranscriptionResult {
  text: string;
  confidence?: number;
  language?: string;
  timestamp: Date;
}

export interface InsightData {
  summary: string;
  keyPoints: string[];
  sentiment: 'Positive' | 'Negative' | 'Neutral';
  actionItems: string[];
  topics?: string[];
  speakers?: string[];
}

// UI State Types
export interface AppState {
  currentView: 'dashboard' | 'recordings' | 'transcription' | 'settings';
  selectedRecordings: string[];
  isDeviceConnected: boolean;
  isLoading: boolean;
  error: string | null;
}

// Settings Types
export interface AppSettings {
  theme: 'light' | 'dark' | 'system';
  autoConnect: boolean;
  autoDownload: boolean;
  downloadDirectory: string;
  geminiApiKey: string;
  transcriptionLanguage: string;
  audioQuality: 'low' | 'medium' | 'high';
  notifications: boolean;
}

// WebUSB Types
export interface USBDeviceInfo {
  vendorId: number;
  productId: number;
  productName?: string;
  manufacturerName?: string;
  serialNumber?: string;
}

// Device Settings Types
export interface DeviceSettings {
  autoRecord: boolean;
  autoPlay: boolean;
  bluetoothTone: boolean;
  notification?: boolean;
}

// Meeting/Calendar Types
export interface MeetingInfo {
  platform: 'zoom' | 'teams' | 'google-meeting' | 'webex' | 'feishu' | 'lark' | 'wechat' | 'line' | 'whats-app' | 'slack' | 'discord';
  startDate: Date;
  endDate: Date;
  title?: string;
  os?: 'Windows' | 'Mac' | 'Linux';
}

// Bluetooth Types (P1 Device)
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

// Firmware Types
export interface FirmwareResponse {
  result: 'accepted' | 'wrong-version' | 'busy' | 'card-full' | 'card-error';
}

// Recording Info
export interface RecordingInfo {
  recording: string;
  name: string;
  createDate: string;
  createTime: string;
  time: Date | null;
  duration: number;
  length: number;
  signature: string;
}
