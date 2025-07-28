# HiDock Community Web App

A modern, community-driven web application for HiDock device management and AI-powered audio transcription. This React-based application combines local device control with cloud-based AI transcription services.

## Features

### 🎧 Device Management

- **WebUSB Integration**: Direct browser-based communication with HiDock devices
- **Local File Management**: Download, organize, and manage your recordings
- **Real-time Device Status**: Monitor storage, battery, and connection status
- **Offline Capability**: Core features work without internet connection

### 🤖 AI-Powered Transcription

- **Gemini AI Integration**: High-quality audio transcription
- **Insight Extraction**: Automatic summary, key points, and action items
- **BYOK (Bring Your Own Key)**: Use your own API keys for privacy and control
- **Multiple Language Support**: Transcribe in various languages

### 🌐 Modern Web Experience

- **Progressive Web App**: Install like a native app
- **Responsive Design**: Works on desktop, tablet, and mobile
- **Real-time Updates**: Live status updates and progress tracking
- **Dark/Light Themes**: Customizable appearance

## Quick Start

### Prerequisites

- Node.js 18+ and npm
- Modern web browser with WebUSB support (Chrome, Edge, Opera)
- HiDock device (H1, H1E, or compatible) - _Optional for demo_
- Gemini API key (for transcription features) - _Optional for demo_

### Installation

1. **Clone and install dependencies:**

   ```bash
   cd hidock-web-app
   npm install
   ```

2. **Set up environment variables (Optional):**

   ```bash
   cp .env.example .env.local
   # Edit .env.local and add your Gemini API key for full functionality
   ```

3. **Start development server:**

   ```bash
   npm run dev
   ```

4. **Open in browser:**
   Navigate to `http://localhost:3000`

### Demo Mode

The app includes mock data and works without a physical device or API key for demonstration purposes. You can:

- Browse the dashboard with sample recordings
- Test the audio player with mock files
- Try the transcription interface (requires API key)
- Explore all UI components and navigation

### Real Device Integration

The app now includes **complete WebUSB protocol implementation** based on the original Python application:

- **Actual HiDock device constants** (Vendor ID: 0x10D6, Product IDs: H1, H1E, P1)
- **Full protocol implementation** with packet building, command sending, and response parsing
- **All device operations**: list files, download recordings, delete files, format storage, sync time
- **Multi-device support**: Automatically detects H1, H1E, and P1 models
- **Robust error handling** with connection management and recovery

### Building for Production

```bash
npm run build
npm run preview
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

### Project Structure

```folder
src/
├── components/     # Reusable UI components
├── pages/         # Main application pages
├── services/      # API and device communication
├── store/         # State management (Zustand)
├── types/         # TypeScript type definitions
├── utils/         # Helper functions
└── constants/     # Application constants
```

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
- ❌ Firefox (WebUSB not supported)
- ❌ Safari (WebUSB not supported)

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

**🌟 Your vision of a community-friendly, modern web app for HiDock device management is now complete and ready for the world!**
