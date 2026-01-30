// HiDock Device Constants (matching jensen.js protocol)
// Source: Official HiDock HiNotes jensen.js (December 2025)
export const HIDOCK_DEVICE_CONFIG = {
  VENDOR_ID: 0x10D6, // Actions Semiconductor (default)
  ALTERNATE_VENDOR_ID: 0x3887, // HiDock (newer P1 Mini devices)
  PRODUCT_ID: 0xB00D, // HiDock H1E default
  INTERFACE_NUMBER: 0,
  ENDPOINT_IN: 2,     // Endpoint 2 for IN direction (from jensen.js)
  ENDPOINT_OUT: 1,    // Endpoint 1 for OUT direction (from jensen.js)
} as const;

// All known HiDock Vendor IDs
export const HIDOCK_VENDOR_IDS = [
  0x10D6,  // Actions Semiconductor (older devices)
  0x3887,  // HiDock (newer P1 Mini devices)
] as const;

// Additional HiDock Product IDs
// Source: Official HiDock HiNotes jensen.js (December 2025)
export const HIDOCK_PRODUCT_IDS = {
  // H1 devices
  H1: 0xAF0C,           // 45068 decimal
  H1_ALT_1: 0x0100,     // 256 decimal (alt)
  H1_ALT_2: 0x0102,     // 258 decimal (alt)
  // H1E devices
  H1E: 0xAF0D,          // 45069 decimal (older PID)
  H1E_NEW: 0xB00D,      // newer PID
  H1E_ALT_1: 0x0101,    // 257 decimal (alt)
  H1E_ALT_2: 0x0103,    // 259 decimal (alt)
  // P1 devices
  P1: 0xAF0E,           // 45070 decimal (older PID)
  P1_NEW: 0xB00E,       // newer PID - IMPORTANT: Many P1 devices use this
  P1_ALT: 0x2040,       // 8256 decimal (alt)
  // P1 Mini devices
  P1_MINI: 0xAF0F,      // 45071 decimal
  P1_MINI_ALT: 0x2041,  // 8257 decimal (alt)
  // Default
  DEFAULT: 0xB00D,
} as const;

// All Product IDs as an array for device filtering
export const ALL_HIDOCK_PRODUCT_IDS = [
  HIDOCK_PRODUCT_IDS.H1,
  HIDOCK_PRODUCT_IDS.H1_ALT_1,
  HIDOCK_PRODUCT_IDS.H1_ALT_2,
  HIDOCK_PRODUCT_IDS.H1E,
  HIDOCK_PRODUCT_IDS.H1E_NEW,
  HIDOCK_PRODUCT_IDS.H1E_ALT_1,
  HIDOCK_PRODUCT_IDS.H1E_ALT_2,
  HIDOCK_PRODUCT_IDS.P1,
  HIDOCK_PRODUCT_IDS.P1_NEW,
  HIDOCK_PRODUCT_IDS.P1_ALT,
  HIDOCK_PRODUCT_IDS.P1_MINI,
  HIDOCK_PRODUCT_IDS.P1_MINI_ALT,
] as const;

// HiDock Protocol Commands (complete jensen.js protocol)
export const HIDOCK_COMMANDS = {
  // Basic device commands
  INVALID: 0,
  GET_DEVICE_INFO: 1,
  GET_DEVICE_TIME: 2,
  SET_DEVICE_TIME: 3,
  
  // File management commands
  GET_FILE_LIST: 4,
  TRANSFER_FILE: 5,
  GET_FILE_COUNT: 6,
  DELETE_FILE: 7,
  GET_FILE_BLOCK: 13,
  
  // Firmware commands
  REQUEST_FIRMWARE_UPGRADE: 8,
  FIRMWARE_UPLOAD: 9,
  
  // Testing/Demo commands
  DEVICE_MSG_TEST: 10,
  BNC_DEMO_TEST: 10, // Alias
  
  // Settings commands
  GET_SETTINGS: 11,
  SET_SETTINGS: 12,
  
  // Storage commands
  GET_CARD_INFO: 16,
  FORMAT_CARD: 17,
  GET_RECORDING_FILE: 18,
  RESTORE_FACTORY_SETTINGS: 19,
  
  // Meeting/Calendar integration
  SEND_SCHEDULE_INFO: 20,
  
  // Bluetooth commands (P1 device)
  BLUETOOTH_SCAN: 4097,
  BLUETOOTH_CMD: 4098,
  BLUETOOTH_STATUS: 4099,
  
  // Advanced commands
  FACTORY_RESET: 61451,
  TEST_SN_WRITE: 61447,
  RECORD_TEST_START: 61448,
  RECORD_TEST_END: 61449,
} as const;

// Gemini AI Constants
export const GEMINI_MODELS = {
  TEXT: 'gemini-1.5-flash',
  AUDIO: 'gemini-1.5-flash',
} as const;

// Audio Constants
export const AUDIO_CONFIG = {
  SUPPORTED_FORMATS: ['audio/wav', 'audio/mp3', 'audio/m4a', 'audio/ogg'] as const,
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
  CALENDAR_TOKEN: 'hidock_calendar_token',
  CALENDAR_SETTINGS: 'hidock_calendar_settings',
} as const;

// Calendar Integration Constants (from HAR file analysis)
export const CALENDAR_CONFIG = {
  // API Endpoints (from HAR file)
  ENDPOINTS: {
    STATUS: '/v1/calendar/status',
    EVENT_LIST: '/v1/calendar/event/list',
    EVENT_SYNC: '/v1/calendar/event/sync/device',
    DEVICE_STATE_NOTICE: '/v1/calendar/event/device_state/notice',
  },
  
  // OAuth Configuration
  OAUTH: {
    MICROSOFT: {
      CLIENT_ID: '287048ad-e335-4cbd-8d76-658acb0785d5',
      SCOPES: ['openid', 'offline_access', 'Calendars.ReadWrite'],
      AUTHORITY: 'https://login.microsoftonline.com/common',
    },
  },
  
  // Calendar sync settings
  SYNC: {
    DEFAULT_RANGE_DAYS: 7,
    TIMEZONE_OFFSET_MINUTES: 180, // 3 hours
    SYNC_INTERVAL_MINUTES: 2,
  },
  
  // Meeting platforms (from jensen.js keyboard mappings)
  PLATFORMS: {
    ZOOM: 'zoom',
    TEAMS: 'teams',
    GOOGLE_MEETING: 'google-meeting',
    WEBEX: 'webex',
    FEISHU: 'feishu',
    LARK: 'lark',
    WECHAT: 'wechat',
    LINE: 'line',
    WHATSAPP: 'whats-app',
    SLACK: 'slack',
    DISCORD: 'discord',
  },
} as const;

// Default Settings
export const DEFAULT_SETTINGS = {
  theme: 'dark' as const,
  autoConnect: false, // Disabled by default to avoid USB conflicts
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
