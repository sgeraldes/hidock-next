// Device Types
export interface HiDockDevice {
  id: string;
  name: string;
  model: string;
  serialNumber: string;
  firmwareVersion: string;
  connected: boolean;
  storageInfo: StorageInfo;
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
export interface AudioData {
  fileName: string;
  base64: string;
  mimeType: string;
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