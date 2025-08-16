# API Documentation

This document provides comprehensive API documentation for the HiDock Next project.

## Table of Contents

- [Desktop Application APIs](#desktop-application-apis)
- [Web Application APIs](#web-application-apis)
- [Audio Insights Extractor APIs](#audio-insights-extractor-apis)
- [Device Communication Protocol](#device-communication-protocol)
- [AI Service Interface](#ai-service-interface)

## Desktop Application APIs

### Device Interface API

#### HiDockDevice Class

The main interface for communicating with HiDock hardware devices.

```python
class HiDockDevice:
    def __init__(self, vendor_id=0x1234, product_id=0x5678):
        """Initialize device with USB identifiers"""

    def connect(self) -> bool:
        """Connect to the HiDock device"""

    def disconnect(self) -> bool:
        """Disconnect from the device"""

    def is_connected(self) -> bool:
        """Check if device is connected"""

    def get_device_info(self) -> Dict[str, Any]:
        """Get device information and status"""

    def list_recordings(self) -> List[Recording]:
        """List all recordings on the device"""

    def download_recording(self, recording_id: int) -> bytes:
        """Download a recording from the device"""

    def delete_recording(self, recording_id: int) -> bool:
        """Delete a recording from the device"""

    def format_storage(self) -> bool:
        """Format device storage (WARNING: Deletes all data)"""

    def sync_time(self) -> bool:
        """Synchronize device time with system time"""
```

#### Device Response Format

```python
{
    "device_info": {
        "model": "HiDock H1",
        "firmware_version": "1.2.3",
        "serial_number": "HD123456789",
        "storage_total": 8589934592,  # bytes
        "storage_used": 1073741824,   # bytes
        "battery_level": 85,          # percentage
        "recording_count": 15
    },
    "recordings": [
        {
            "id": 1,
            "filename": "recording_001.hda",
            "size": 5242880,      # bytes
            "duration": 300,      # seconds
            "created_at": "2025-01-29T10:30:00Z",
            "format": "hda"
        }
    ]
}
```

### AI Service API

#### AIService Class

Unified interface for all AI providers.

```python
class AIService:
    def configure_provider(self, provider_name: str, config: Dict[str, Any]) -> bool:
        """Configure an AI provider with API keys and settings"""

    def get_available_providers(self) -> List[str]:
        """Get list of available AI providers"""

    def transcribe_audio(self, audio_file_path: str, provider: str = None, language: str = "auto") -> Dict[str, Any]:
        """Transcribe audio file using specified or default provider"""

    def analyze_text(self, text: str, provider: str = None, analysis_type: str = "insights") -> Dict[str, Any]:
        """Analyze text using specified or default provider"""
```

#### AI Response Format

```python
# Transcription Response
{
    "success": True,
    "transcription": "The full transcribed text content",
    "language": "en-US",
    "confidence": 0.95,
    "provider": "gemini",
    "duration": 2.5,  # processing time in seconds
    "metadata": {
        "audio_duration": 300,
        "file_size": 5242880,
        "sample_rate": 44100
    }
}

# Analysis Response
{
    "success": True,
    "analysis": {
        "summary": "Brief summary of the content",
        "key_points": ["Point 1", "Point 2", "Point 3"],
        "action_items": ["Action 1", "Action 2"],
        "sentiment": "positive",
        "topics": ["meeting", "project", "deadline"],
        "entities": ["John Smith", "Project Alpha", "March 15th"]
    },
    "provider": "openai",
    "confidence": 0.89
}

# Error Response
{
    "success": False,
    "error": "API key not configured for provider 'openai'",
    "error_code": "AUTH_ERROR",
    "provider": "openai"
}
```

### Audio Processing API

#### AudioPlayer Class

```python
class AudioPlayer:
    def load(self, file_path: str) -> bool:
        """Load audio file for playback"""

    def play(self) -> bool:
        """Start audio playback"""

    def pause(self) -> bool:
        """Pause audio playback"""

    def stop(self) -> bool:
        """Stop audio playback"""

    def set_position(self, position: float) -> bool:
        """Set playback position (0.0 to 1.0)"""

    def set_speed(self, speed: float) -> bool:
        """Set playback speed (0.25 to 2.0)"""

    def get_duration(self) -> float:
        """Get audio duration in seconds"""

    def get_position(self) -> float:
        """Get current playback position (0.0 to 1.0)"""
```

## Web Application APIs

### Device Service API

#### WebUSB Device Interface

```typescript
interface DeviceService {
    // Device Management
    requestDevice(): Promise<USBDevice>;
    connectToDevice(device: USBDevice): Promise<ConnectionResult>;
    disconnectDevice(): Promise<void>;

    // Device Operations
    getDeviceInfo(): Promise<DeviceInfo>;
    listRecordings(): Promise<Recording[]>;
    downloadRecording(recordingId: number): Promise<ArrayBuffer>;
    deleteRecording(recordingId: number): Promise<boolean>;

    // Status
    isConnected(): boolean;
    getConnectionStatus(): ConnectionStatus;
}
```

#### Response Types

```typescript
interface ConnectionResult {
    success: boolean;
    device?: DeviceInfo;
    error?: string;
}

interface DeviceInfo {
    model: string;
    firmwareVersion: string;
    serialNumber: string;
    storageTotal: number;
    storageUsed: number;
    batteryLevel: number;
    recordingCount: number;
}

interface Recording {
    id: number;
    filename: string;
    size: number;
    duration: number;
    createdAt: string;
    format: 'hda' | 'hta' | 'wav';
}

enum ConnectionStatus {
    DISCONNECTED = 'disconnected',
    CONNECTING = 'connecting',
    CONNECTED = 'connected',
    ERROR = 'error'
}
```

### Gemini Service API

```typescript
interface GeminiService {
    configure(apiKey: string): void;
    transcribeAudio(audioFile: File): Promise<TranscriptionResult>;
    analyzeText(text: string): Promise<AnalysisResult>;
    isConfigured(): boolean;
}

interface TranscriptionResult {
    success: boolean;
    transcription?: string;
    language?: string;
    confidence?: number;
    error?: string;
}

interface AnalysisResult {
    success: boolean;
    analysis?: {
        summary: string;
        keyPoints: string[];
        actionItems: string[];
        sentiment: 'positive' | 'negative' | 'neutral';
        topics: string[];
    };
    error?: string;
}
```

### Store API (Zustand)

```typescript
interface AppStore {
    // Device State
    device: DeviceInfo | null;
    deviceStatus: ConnectionStatus;
    recordings: Recording[];

    // UI State
    selectedRecording: Recording | null;
    isLoading: boolean;
    error: string | null;

    // Actions
    connectDevice: () => Promise<void>;
    disconnectDevice: () => void;
    loadRecordings: () => Promise<void>;
    selectRecording: (recording: Recording) => void;
    deleteRecording: (recordingId: number) => Promise<void>;

    // Settings
    settings: AppSettings;
    updateSettings: (settings: Partial<AppSettings>) => void;
}

interface AppSettings {
    geminiApiKey: string;
    autoTranscribe: boolean;
    downloadDirectory: string;
    preferredLanguage: string;
}
```

## Audio Insights Extractor APIs

### Audio Processing Interface

```typescript
interface AudioProcessor {
    processFile(file: File): Promise<ProcessingResult>;
    extractInsights(audioData: ArrayBuffer): Promise<InsightsResult>;
    getSupportedFormats(): string[];
    getMaxFileSize(): number;
}

interface ProcessingResult {
    success: boolean;
    audioData?: ArrayBuffer;
    metadata?: AudioMetadata;
    error?: string;
}

interface AudioMetadata {
    duration: number;
    sampleRate: number;
    channels: number;
    format: string;
    size: number;
}

interface InsightsResult {
    transcription: string;
    summary: string;
    keyPoints: string[];
    speakers?: SpeakerInfo[];
    emotions?: EmotionAnalysis[];
    topics: string[];
}
```

## Device Communication Protocol

### USB Communication

#### Command Structure

```
| Byte 0 | Byte 1 | Bytes 2-3 | Bytes 4-63 |
|--------|--------|-----------|-----------|
| CMD    | LEN    | CRC16     | DATA      |
```

#### Command Codes

```python
class Commands:
    GET_DEVICE_INFO = 0x01
    LIST_RECORDINGS = 0x02
    DOWNLOAD_RECORDING = 0x03
    DELETE_RECORDING = 0x04
    FORMAT_STORAGE = 0x05
    SYNC_TIME = 0x06
    GET_STATUS = 0x07
    SET_CONFIG = 0x08
```

#### Response Structure

```
| Byte 0 | Byte 1 | Bytes 2-3 | Bytes 4-63 |
|--------|--------|-----------|-----------|
| STATUS | LEN    | CRC16     | DATA      |
```

#### Status Codes

```python
class StatusCodes:
    SUCCESS = 0x00
    ERROR_INVALID_COMMAND = 0x01
    ERROR_DEVICE_BUSY = 0x02
    ERROR_STORAGE_FULL = 0x03
    ERROR_FILE_NOT_FOUND = 0x04
    ERROR_PERMISSION_DENIED = 0x05
    ERROR_HARDWARE_FAILURE = 0x06
```

### WebUSB Implementation

```typescript
// USB Device Filters
const DEVICE_FILTERS = [
    {
        vendorId: 0x1234,  // HiDock vendor ID
        productId: 0x5678  // HiDock product ID
    }
];

// USB Configuration
const USB_CONFIG = {
    configurationValue: 1,
    interfaceNumber: 0,
    endpointIn: 0x81,    // Bulk IN endpoint
    endpointOut: 0x02,   // Bulk OUT endpoint
    packetSize: 64
};
```

## AI Service Interface

### Provider Abstract Interface

```python
class AIProvider(ABC):
    @abstractmethod
    def configure(self, config: Dict[str, Any]) -> bool:
        """Configure the provider with API keys and settings"""

    @abstractmethod
    def is_available(self) -> bool:
        """Check if provider is available and configured"""

    @abstractmethod
    def transcribe_audio(self, audio_file_path: str, language: str = "auto") -> Dict[str, Any]:
        """Transcribe audio file"""

    @abstractmethod
    def analyze_text(self, text: str, analysis_type: str = "insights") -> Dict[str, Any]:
        """Analyze text content"""

    def _mock_response(self, response_type: str) -> Dict[str, Any]:
        """Generate mock response for testing"""
```

### Provider Configuration

```python
# Provider-specific configurations
PROVIDER_CONFIGS = {
    "gemini": {
        "models": ["gemini-1.5-flash", "gemini-1.5-pro"],
        "api_base": "https://generativelanguage.googleapis.com",
        "max_file_size": 20 * 1024 * 1024,  # 20MB
        "supported_formats": ["wav", "mp3", "flac", "m4a"]
    },
    "openai": {
        "models": ["whisper-1", "gpt-4", "gpt-3.5-turbo"],
        "api_base": "https://api.openai.com/v1",
        "max_file_size": 25 * 1024 * 1024,  # 25MB
        "supported_formats": ["wav", "mp3", "flac", "m4a", "ogg"]
    },
    "anthropic": {
        "models": ["claude-3-sonnet", "claude-3-haiku"],
        "api_base": "https://api.anthropic.com",
        "text_only": True
    }
}
```

## Error Handling

### Standard Error Response

All APIs return consistent error responses:

```python
{
    "success": False,
    "error": "Human readable error message",
    "error_code": "MACHINE_READABLE_CODE",
    "details": {
        "context": "additional_context",
        "suggestion": "how_to_fix"
    },
    "timestamp": "2025-01-29T10:30:00Z"
}
```

### Common Error Codes

```python
class ErrorCodes:
    # Device Errors
    DEVICE_NOT_FOUND = "DEVICE_NOT_FOUND"
    DEVICE_BUSY = "DEVICE_BUSY"
    PERMISSION_DENIED = "PERMISSION_DENIED"

    # AI Errors
    API_KEY_INVALID = "API_KEY_INVALID"
    QUOTA_EXCEEDED = "QUOTA_EXCEEDED"
    UNSUPPORTED_FORMAT = "UNSUPPORTED_FORMAT"
    FILE_TOO_LARGE = "FILE_TOO_LARGE"

    # General Errors
    INVALID_INPUT = "INVALID_INPUT"
    NETWORK_ERROR = "NETWORK_ERROR"
    TIMEOUT = "TIMEOUT"
    INTERNAL_ERROR = "INTERNAL_ERROR"
```

## Rate Limiting

### AI Provider Limits

```python
RATE_LIMITS = {
    "gemini": {
        "requests_per_minute": 60,
        "requests_per_day": 1500,
        "file_size_limit": 20 * 1024 * 1024
    },
    "openai": {
        "requests_per_minute": 50,
        "tokens_per_minute": 40000,
        "file_size_limit": 25 * 1024 * 1024
    }
}
```

## Authentication

### API Key Management

```python
# Desktop Application - Encrypted Storage
from cryptography.fernet import Fernet

class SecureConfig:
    def store_api_key(self, provider: str, api_key: str) -> bool:
        """Store encrypted API key"""

    def get_api_key(self, provider: str) -> str:
        """Retrieve and decrypt API key"""

    def delete_api_key(self, provider: str) -> bool:
        """Delete stored API key"""
```

### Web Application - Local Storage

```typescript
interface SecureStorage {
    setApiKey(provider: string, apiKey: string): void;
    getApiKey(provider: string): string | null;
    deleteApiKey(provider: string): void;
    clearAllKeys(): void;
}
```

## Usage Examples

### Desktop Application

```python
# Connect to device and transcribe recording
device = HiDockDevice()
if device.connect():
    recordings = device.list_recordings()
    if recordings:
        audio_data = device.download_recording(recordings[0].id)

        # Save and transcribe
        with open("recording.hda", "wb") as f:
            f.write(audio_data)

        ai_service = AIService()
        ai_service.configure_provider("gemini", {"api_key": "your_key"})
        result = ai_service.transcribe_audio("recording.hda")

        if result["success"]:
            print(f"Transcription: {result['transcription']}")
```

### Web Application

```typescript
// Connect to device and list recordings
const deviceService = new DeviceService();

try {
    const device = await deviceService.requestDevice();
    const result = await deviceService.connectToDevice(device);

    if (result.success) {
        const recordings = await deviceService.listRecordings();
        console.log(`Found ${recordings.length} recordings`);
    }
} catch (error) {
    console.error('Device connection failed:', error);
}
```

This API documentation provides comprehensive coverage of all interfaces and data structures used throughout the HiDock Next project. For implementation details, refer to the source code and additional documentation files.
