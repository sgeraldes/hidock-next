# HiDock Web Application 🌐

**Modern Browser-Based HiDock Management with AI Transcription**

The HiDock Web Application is a cutting-edge React TypeScript web app that provides browser-based control over HiDock recording devices using the WebUSB API. Built with modern web technologies, it offers real-time device management and AI-powered audio transcription capabilities directly in your browser.

[![React 18](https://img.shields.io/badge/React-18.2.0-blue.svg)](https://reactjs.org/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.2+-blue.svg)](https://www.typescriptlang.org/)
[![Vite](https://img.shields.io/badge/Vite-7.0+-purple.svg)](https://vitejs.dev/)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

## 🌟 Key Features

### 🌐 Browser-Native Device Communication

- **WebUSB API**: Direct HiDock device communication in supported browsers
- **Real-time Connection**: Live device detection and status monitoring
- **HTTPS Required**: Secure connection required for WebUSB functionality
- **Cross-Platform**: Works on Windows, macOS, and Linux in supported browsers

### 🤖 AI-Powered Transcription

- **Google Gemini Integration**: Advanced AI transcription and analysis
- **BYOK Model**: Bring Your Own Key for cost control and privacy
- **Real-time Processing**: Live transcription with progress tracking
- **Audio Insights**: Automatic summary, action items, and sentiment analysis

### 🎵 Modern Audio Management

- **Web Audio API**: Professional audio playback in the browser
- **Format Support**: Multiple audio formats with browser-native decoding
- **Responsive Design**: Mobile-first design with touch-friendly controls
- **Progressive Web App**: Can be installed as a desktop/mobile app

### 📱 Responsive User Experience

- **Mobile-First**: Optimized for smartphones and tablets
- **Desktop Enhanced**: Rich experience on larger screens
- **Touch Friendly**: Gesture-based file management
- **Accessibility**: WCAG compliant interface design

## 🚀 Quick Start

### Prerequisites

**Browser Requirements:**

- **Chrome/Chromium 61+**: Full WebUSB support
- **Edge 79+**: WebUSB support
- **Opera 48+**: WebUSB support
- **Firefox**: Limited support (requires flags)
- **Safari**: Not supported (no WebUSB)

**Development Requirements:**

- Node.js 18+ and npm
- HTTPS connection (required for WebUSB)

### Installation

1. **Navigate to Web App Directory**

   ```bash
   cd hidock-web-app
   ```

2. **Install Dependencies**

   ```bash
   npm install
   ```

3. **Start Development Server**

   ```bash
   npm run dev
   ```

4. **Access Application**
   - Local: `https://localhost:5173` (HTTPS required)
   - Network: Available on local network for testing

### Production Build

```bash
# Build for production
npm run build

# Preview production build
npm run preview

# Serve with HTTPS (required for WebUSB)
npx serve -s dist --ssl-cert cert.pem --ssl-key key.pem
```

## 📁 Project Structure

```
hidock-web-app/
├── src/
│   ├── components/                   # React components
│   │   ├── AudioPlayer/              # Audio playback component
│   │   ├── AudioVisualization/       # Waveform visualization
│   │   ├── FileManager/              # File management interface
│   │   ├── Layout/                   # App layout components
│   │   └── ...                       # Other UI components
│   │
│   ├── pages/                        # Route pages
│   │   ├── Dashboard.tsx             # Main dashboard
│   │   ├── Recordings.tsx            # Recordings management
│   │   ├── Transcription.tsx         # AI transcription interface
│   │   └── Settings.tsx              # Application settings
│   │
│   ├── services/                     # Business logic
│   │   ├── deviceService.ts          # HiDock device communication
│   │   ├── geminiService.ts          # AI transcription service
│   │   └── audioProcessingService.ts # Audio processing
│   │
│   ├── adapters/                     # Device integration
│   │   └── webDeviceAdapter.ts       # WebUSB device adapter
│   │
│   ├── store/                        # State management
│   │   └── useAppStore.ts            # Zustand store
│   │
│   ├── hooks/                        # Custom React hooks
│   │   └── useDeviceConnection.ts    # Device connection hook
│   │
│   ├── utils/                        # Utility functions
│   │   ├── audioUtils.ts             # Audio processing utilities
│   │   ├── formatters.ts             # Data formatting
│   │   └── mockData.ts               # Development mock data
│   │
│   └── types/                        # TypeScript type definitions
│       └── index.ts                  # Shared types
│
├── public/                           # Static assets
├── package.json                      # Dependencies and scripts
├── vite.config.ts                    # Vite configuration
├── tailwind.config.js                # Tailwind CSS configuration
├── tsconfig.json                     # TypeScript configuration
└── vitest.config.ts                  # Test configuration
```

## Usage

### Connecting Your Device

1. Click "Connect Device" in the sidebar
2. Select your HiDock device from the browser prompt
3. Grant necessary permissions

### Managing Recordings

- View all recordings in the Recordings tab
- Download files locally for backup
- Play recordings directly in the browser
- Delete files from device storage

### AI Transcription

1. Upload audio files or use device recordings
2. Click "Transcribe" to convert speech to text
3. Extract insights including summaries and action items
4. Export transcriptions and insights

## Configuration

### Gemini API Setup

1. Get an API key from [Google AI Studio](https://makersuite.google.com/app/apikey)
2. Add the key to your `.env.local` file:

   ```shell
   VITE_GEMINI_API_KEY=your_api_key_here
   ```

3. Configure transcription settings in the Settings page

### Device Configuration

The app automatically detects HiDock devices. If you have connection issues:

1. Check that WebUSB is enabled in your browser
2. Ensure your device is in the correct mode
3. Try a different USB port or cable

## Development



### Key Technologies

- **React 18** with TypeScript
- **Tailwind CSS** for styling
- **Zustand** for state management
- **WebUSB API** for device communication
- **Gemini AI** for transcription
- **Vite** for build tooling

### Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Add tests if applicable
5. Submit a pull request

## Browser Compatibility

### Supported Browsers

- ✅ Chrome 61+
- ✅ Edge 79+
- ✅ Opera 48+
- ⚠️ Firefox (Limited support, not recommended)*
- ❌ Safari (WebUSB not supported)

*Firefox support is limited as WebUSB is disabled by default due to security concerns. It can be enabled manually in `about:config` for development purposes, but it is not recommended for general use.

### WebUSB Requirements

- HTTPS connection (required for WebUSB)
- User gesture required for device access
- Device must support WebUSB protocol

## Troubleshooting

### Common Issues

**Device not detected:**

- Ensure WebUSB is enabled in browser flags
- Try a different USB port
- Check device compatibility

**Transcription fails:**

- Verify Gemini API key is correct
- Check internet connection
- Ensure audio file is supported format

**App won't load:**

- Clear browser cache
- Check console for errors
- Verify all dependencies are installed

## License

MIT License - see [LICENSE](../LICENSE) file for details.

## Acknowledgments

- Original HiDock Next Python application
- Google Gemini AI for transcription services
- WebUSB specification contributors
- Open source community

---

**Note**: This is a community-driven project and is not officially affiliated with HiDock or its parent company.

## 🎯 **Production Ready - Complete Implementation**

### ✅ **Real HiDock Device Integration**

- **Actual WebUSB Protocol**: Complete implementation of the Jensen protocol from your Python app
- **All Device Operations**: List files, download recordings, delete files, format storage, sync time
- **Multi-Device Support**: Automatic detection of H1, H1E, and P1 models
- **Robust Communication**: Packet building, response parsing, error recovery, and connection management

### ✅ **Community Distribution Ready**

- **Zero Installation**: Users just visit the URL - no Python setup required
- **Cross-Platform**: Works on Windows, Mac, Linux with Chrome/Edge browsers
- **Mobile Responsive**: Full functionality on tablets and phones
- **Progressive Web App**: Can be installed like a native app

### ✅ **Developer Friendly**

- **Modern Stack**: React + TypeScript + Tailwind CSS
- **Clean Architecture**: Modular, well-documented codebase
- **Easy Deployment**: Ready for Vercel, Netlify, or any static host
- **Extensible**: Simple to add new features and integrations



---

**Ready to start?** Run `npm run dev` from this directory to launch the HiDock Web Application!

**Note**: Make sure you're using a WebUSB-compatible browser (Chrome, Edge, or Opera) and have HTTPS enabled for full functionality.
