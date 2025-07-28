# Development Guide

This guide provides detailed information for developers working on the HiDock Community Platform.

## Architecture Overview

The HiDock Community Platform consists of two main applications:

1. **Desktop Application** (Python/CustomTkinter)
2. **Web Application** (React/TypeScript)

Both applications communicate with HiDock devices using the Jensen protocol over USB.

## Desktop Application Development

### Technology Stack

- **Python 3.8+**
- **CustomTkinter** - Modern GUI framework
- **PyUSB** - USB device communication
- **Pygame** - Audio playback
- **Pillow** - Image processing

### Key Components

#### Device Communication (`hidock_device.py`)

```python
class HiDockJensen:
    """Main class for HiDock device communication."""
    
    def connect(self, target_interface_number, vid, pid):
        """Connect to HiDock device."""
        
    def get_recordings(self):
        """Get list of recordings from device."""
        
    def download_recording(self, filename, timeout_s):
        """Download recording from device."""
```

#### GUI Components (`gui_main_window.py`)

- Main window with file list
- Status bar with device information
- Audio playback controls
- Settings dialog

#### Configuration (`config_and_logger.py`)

- JSON-based configuration storage
- Logging system with colored output
- Settings validation and migration

### Development Workflow

1. **Setup environment:**

   ```bash
   python -m venv .venv
   source .venv/bin/activate
   pip install -r requirements.txt
   ```

2. **Run application:**

   ```bash
   python main.py
   ```

3. **Run tests:**

   ```bash
   pytest tests/ -v
   ```

4. **Code formatting:**

   ```bash
   black .
   flake8 .
   ```

### Testing Strategy

- **Unit tests** for individual functions
- **Integration tests** for component interactions
- **Mock USB devices** for automated testing
- **Hardware tests** for device validation

## Web Application Development

### Technology Stack

- **React 18** with TypeScript
- **Vite** - Build tool and dev server
- **Tailwind CSS** - Styling framework
- **Zustand** - State management
- **WebUSB API** - Device communication

### Key Components

#### Device Service (`src/services/DeviceService.ts`)

```typescript
class DeviceService {
  async requestDevice(): Promise<HiDockDevice | null>
  async connectToDevice(usbDevice: USBDevice): Promise<HiDockDevice>
  async getRecordings(): Promise<AudioRecording[]>
  async downloadRecording(recordingId: string): Promise<ArrayBuffer>
}
```

#### State Management (`src/store/`)

```typescript
interface AppStore {
  device: HiDockDevice | null
  recordings: AudioRecording[]
  settings: AppSettings
  
  setDevice: (device: HiDockDevice | null) => void
  setRecordings: (recordings: AudioRecording[]) => void
}
```

#### Components (`src/components/`)

- Device connection interface
- File management components
- Audio player and recorder
- Transcription interface

### Development Workflow

1. **Setup environment:**

   ```bash
   cd hidock-web-app
   npm install
   ```

2. **Start dev server:**

   ```bash
   npm run dev
   ```

3. **Run tests:**

   ```bash
   npm run test
   npm run test:watch
   ```

4. **Build for production:**

   ```bash
   npm run build
   ```

### Testing Strategy

- **Component tests** with Testing Library
- **Service tests** with mocked APIs
- **Integration tests** for user workflows
- **E2E tests** for critical paths

## Device Communication Protocol

### Jensen Protocol

The Jensen protocol is used for communication with HiDock devices:

#### Packet Structure

```
Header (12 bytes):
- Magic bytes (4): 0x4A, 0x45, 0x4E, 0x53
- Sequence ID (2): Incremental counter
- Command ID (2): Operation identifier
- Body length (4): Size of payload

Body (variable):
- Command-specific data
```

#### Command Set

| Command ID | Name | Description |
|------------|------|-------------|
| 0x0001 | GET_DEVICE_INFO | Get device information |
| 0x0002 | GET_RECORDINGS | List recordings |
| 0x0003 | DOWNLOAD_FILE | Download recording |
| 0x0004 | DELETE_FILE | Delete recording |
| 0x0005 | FORMAT_DEVICE | Format storage |

### Implementation Differences

#### Desktop (Python)

```python
def send_command(self, command_id, body_bytes, timeout_ms):
    """Send command to device using PyUSB."""
    packet = self.build_packet(command_id, body_bytes)
    self.device.write(self.endpoint_out, packet, timeout_ms)
```

#### Web (TypeScript)

```typescript
async sendCommand(commandId: number, bodyBytes: Uint8Array): Promise<number> {
  const packet = this.buildPacket(commandId, bodyBytes)
  await this.device.transferOut(this.endpointOut, packet)
}
```

## AI Integration

### Gemini API Integration

Both applications support AI-powered transcription using Google's Gemini API:

#### Service Implementation

```typescript
class GeminiService {
  async transcribeAudio(audioBase64: string, mimeType: string): Promise<TranscriptionResult>
  async extractInsights(transcriptionText: string): Promise<InsightData>
}
```

#### Privacy Considerations

- BYOK (Bring Your Own Key) model
- Local storage of API keys
- Optional local-only processing
- Data retention controls

## Build and Deployment

### Desktop Application

#### PyInstaller Configuration

```python
# build.spec
a = Analysis(['main.py'],
             pathex=['.'],
             binaries=[],
             datas=[('icons', 'icons'), ('themes', 'themes')],
             hiddenimports=[],
             hookspath=[],
             runtime_hooks=[],
             excludes=[],
             win_no_prefer_redirects=False,
             win_private_assemblies=False,
             cipher=block_cipher,
             noarchive=False)
```

#### Build Commands

```bash
# Windows
pyinstaller --onefile --windowed main.py

# macOS
pyinstaller --onefile --windowed main.py

# Linux
pyinstaller --onefile main.py
```

### Web Application

#### Vite Configuration

```typescript
export default defineConfig({
  plugins: [react()],
  build: {
    outDir: 'dist',
    sourcemap: true,
    rollupOptions: {
      output: {
        manualChunks: {
          vendor: ['react', 'react-dom'],
          ui: ['@headlessui/react', 'lucide-react']
        }
      }
    }
  }
})
```

#### Deployment Targets

- **Vercel** - Automatic deployment from GitHub
- **Netlify** - Static site hosting
- **Self-hosted** - Docker containers

## Performance Considerations

### Desktop Application

- **Threading** for USB operations
- **Caching** for device information
- **Memory management** for large files
- **Progress tracking** for long operations

### Web Application

- **Code splitting** for faster loading
- **Lazy loading** for components
- **Service workers** for offline support
- **WebUSB optimization** for device communication

## Security Considerations

### API Key Management

- Secure local storage
- Environment variable support
- Key rotation capabilities
- Audit logging

### Device Communication

- Input validation for all commands
- Timeout handling for operations
- Error recovery mechanisms
- Connection state management

## Debugging and Troubleshooting

### Common Issues

#### Desktop Application

1. **USB Permission Issues**
   - Windows: Use Zadig for driver installation
   - Linux: Add user to dialout group
   - macOS: No special setup required

2. **GUI Rendering Issues**
   - Check CustomTkinter version
   - Verify theme files are present
   - Test with different appearance modes

#### Web Application

1. **WebUSB Not Working**
   - Ensure HTTPS is enabled
   - Check browser compatibility
   - Verify device permissions

2. **Build Issues**
   - Clear node_modules and reinstall
   - Check TypeScript configuration
   - Verify import paths

### Debugging Tools

- **VS Code Debugger** for Python and TypeScript
- **Browser DevTools** for web debugging
- **USB Analyzer** for protocol debugging
- **Network Monitor** for API calls

## Contributing Guidelines

See [CONTRIBUTING.md](../CONTRIBUTING.md) for detailed contribution guidelines.

## Additional Resources

- [API Documentation](./API.md)
- [Testing Guide](./TESTING.md)
- [Deployment Guide](./DEPLOYMENT.md)
- [Troubleshooting Guide](./TROUBLESHOOTING.md)
