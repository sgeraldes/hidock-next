// HiDock Device Constants (from Python app)
export const HIDOCK_DEVICE_CONFIG = {
  VENDOR_ID: 0x10D6, // Actions Semiconductor
  PRODUCT_ID: 0xB00D, // HiDock H1E default
  INTERFACE_NUMBER: 0,
  ENDPOINT_IN: 0x82,  // Physical endpoint 0x02, IN direction
  ENDPOINT_OUT: 0x01, // Physical endpoint 0x01, OUT direction
} as const;

// Additional HiDock Product IDs
export const HIDOCK_PRODUCT_IDS = {
  H1: 0xAF0C,
  H1E: 0xAF0D,
  P1: 0xAF0E,
  DEFAULT: 0xB00D,
} as const;

// HiDock Protocol Commands (from Python app)
export const HIDOCK_COMMANDS = {
  GET_DEVICE_INFO: 1,
  GET_DEVICE_TIME: 2,
  SET_DEVICE_TIME: 3,
  GET_FILE_LIST: 4,
  TRANSFER_FILE: 5,
  GET_FILE_COUNT: 6,
  DELETE_FILE: 7,
  GET_FILE_BLOCK: 13,
  GET_SETTINGS: 11,
  SET_SETTINGS: 12,
  GET_CARD_INFO: 16,
  FORMAT_CARD: 17,
  GET_RECORDING_FILE: 18,
} as const;

// Gemini AI Constants
export const GEMINI_MODELS = {
  TEXT: 'gemini-1.5-flash',
  AUDIO: 'gemini-1.5-flash',
} as const;

// Audio Constants
export const AUDIO_CONFIG = {
  SUPPORTED_FORMATS: ['audio/wav', 'audio/mp3', 'audio/m4a', 'audio/ogg'],
  MAX_FILE_SIZE: 25 * 1024 * 1024, // 25MB
  SAMPLE_RATE: 44100,
  CHANNELS: 2,
} as const;

// UI Constants
export const UI_CONFIG = {
  SIDEBAR_WIDTH: 280,
  HEADER_HEIGHT: 64,
  ANIMATION_DURATION: 200,
  DEBOUNCE_DELAY: 300,
} as const;

// Storage Constants
export const STORAGE_KEYS = {
  SETTINGS: 'hidock_settings',
  RECORDINGS: 'hidock_recordings',
  DEVICE_INFO: 'hidock_device_info',
  TRANSCRIPTIONS: 'hidock_transcriptions',
} as const;

// Default Settings
export const DEFAULT_SETTINGS = {
  theme: 'dark' as const,
  autoDownload: false,
  downloadDirectory: 'Downloads/HiDock',
  geminiApiKey: (typeof import.meta !== 'undefined' && import.meta.env?.VITE_GEMINI_API_KEY) || '',
  transcriptionLanguage: 'en',
  audioQuality: 'medium' as const,
  notifications: true,
};

// Error Messages
export const ERROR_MESSAGES = {
  DEVICE_NOT_FOUND: 'HiDock device not found. Please connect your device and try again.',
  CONNECTION_FAILED: 'Failed to connect to HiDock device. Please check the connection.',
  TRANSCRIPTION_FAILED: 'Transcription failed. Please check your API key and try again.',
  FILE_TOO_LARGE: 'File is too large. Maximum size is 25MB.',
  UNSUPPORTED_FORMAT: 'Unsupported audio format. Please use WAV, MP3, M4A, or OGG.',
  API_KEY_MISSING: 'Gemini API key is required for transcription features.',
} as const;