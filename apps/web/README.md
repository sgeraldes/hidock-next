# HiDock Web Application 🌐

**Browser-Based Transcription Access - The Second Iteration of HiDock Next**

The HiDock Web Application is a **transcription-focused** React TypeScript web app that makes your HiDock recordings accessible and transcribable anywhere through your browser. Part of the HiDock Next suite, this app evolved from the Desktop App to solve a specific need: **making recordings accessible via browser with AI transcription**, no installation required.

## Part of the HiDock Next Ecosystem

This is the **second iteration** in the evolution toward a universal knowledge hub:

1. **Desktop App** - Device management focused (USB, file sync, settings)
2. **Web App** (this app) - **Transcription focused** (browser access, AI transcription)
3. **Audio Insights** - Insights prototype (AI-powered analysis)
4. **Electron App** - Universal knowledge hub (integrates all capabilities, processes ANY knowledge source)

For the fully integrated experience with recordings, PDFs, documents, calendar, email, and more, see the [Electron app](../electron/).

[![React 18](https://img.shields.io/badge/React-18.2.0-blue.svg)](https://reactjs.org/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.2+-blue.svg)](https://www.typescriptlang.org/)
[![Vite](https://img.shields.io/badge/Vite-7.0+-purple.svg)](https://vitejs.dev/)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

## 🌟 Key Features

### 🎯 **Why This App Exists**

This app solves a specific problem: **access your HiDock recordings and transcribe them anywhere, without installing software**. While the Desktop App requires Python installation and the Electron App is the full knowledge hub, this web app lets you:

- Open any browser and access your device
- Transcribe recordings immediately with AI
- Share a URL with team members (no setup required)
- Use on any computer without installation

### 🌐 Browser-Native Device Communication

- **WebUSB API**: Direct HiDock device communication in supported browsers
- **Real-time Connection**: Live device detection and status monitoring
- **HTTPS Required**: Secure connection required for WebUSB functionality
- **Cross-Platform**: Works on Windows, macOS, and Linux in supported browsers
- **No Drivers**: Unlike Desktop App, no USB drivers or Python setup needed

### 🤖 AI-Powered Transcription (Primary Focus)

- **Google Gemini Integration**: Advanced AI transcription and analysis
- **Multi-Provider Support**: OpenAI, Anthropic, and other providers
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

**From the main project directory:**

### **👤 End Users - Just Run the App**
```bash
# Option 1: Run automated setup
python setup.py  # Choose option 1

# Option 2: Manual setup
cd hidock-web-app
npm install
npm run dev
# Open: http://localhost:5173
```

### **👨‍💻 Developers - Full Setup**
```bash
python setup.py  # Choose option 2
```

**Running the Application:**
```bash
cd hidock-web-app
npm run dev
# Open: http://localhost:5173
```

**Requirements:**
- Node.js 18+
- Modern browser with WebUSB support (Chrome, Edge, Opera)
- HTTPS connection (required for WebUSB)

## Prerequisites

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

## Relationship to Other Apps

### How This Fits in the Ecosystem

- **Desktop App** → **Web App** → **Audio Insights** → **Electron App**
- Each iteration built on the previous, solving more problems
- This app (Web) focuses specifically on browser-based transcription access
- The Electron App represents the full vision: a universal knowledge hub

### When to Use Each App

- **Desktop App**: First-time device setup, advanced USB management, offline operation
- **Web App (this)**: Quick transcription access, no installation, sharing with team
- **Audio Insights**: Prototype for testing advanced insights features
- **Electron App**: Full integrated experience with all knowledge sources (recordings, PDFs, documents, calendar, email, etc.)

## Acknowledgments

- Original HiDock Next Python Desktop application
- Google Gemini AI for transcription services
- WebUSB specification contributors
- Open source community

---

**Note**: This is a community-driven project and is not officially affiliated with HiDock or its parent company.

## Evolution Context

This web app emerged from the Desktop App as a way to make recordings accessible anywhere without Python setup. It proved the value of browser-based access and AI transcription, which informed the design of the Electron App as the ultimate universal knowledge hub. This app remains valuable for its simplicity and zero-installation approach to transcription.

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
