# **HiDock Next** 🎵

**The Ultimate HiDock Management Suite with AI-Powered Transcription**

HiDock Next provides comprehensive local control over your HiDock recordings with advanced AI transcription capabilities. Manage, analyze, and transcribe your audio files using **11 different AI providers** including cloud services and local models - all while maintaining complete data ownership.

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Python 3.12+](https://img.shields.io/badge/python-3.12+-blue.svg)](https://www.python.org/downloads/)
[![TypeScript](https://img.shields.io/badge/typescript-5.0+-blue.svg)](https://www.typescriptlang.org/)

## **🌟 Why HiDock Next?**

The HiDock hardware is innovative, but users face challenges with official software:

- **Limited AI Options:** Locked into single transcription service
- **Privacy Concerns:** Data processed in unknown cloud environments
- **High Costs:** Expensive API usage with no alternatives
- **Connectivity Issues:** Unreliable browser-based interface
- **Vendor Lock-in:** No choice in AI providers or local processing

**HiDock Next solves these problems:**

- **🤖 11 AI Providers:** Choose from Gemini, OpenAI, Anthropic, OpenRouter, Amazon, Qwen, DeepSeek, Ollama, LM Studio
- **🔒 Privacy First:** Local models support (Ollama, LM Studio) - zero cloud dependency
- **💰 Cost Control:** BYOK model with competitive pricing options
- **🏠 Offline Capable:** Full functionality without internet using local AI + disconnected mode for cached files
- **⚡ Advanced Features:** Speed control, waveform visualization, background processing, disconnected mode
- **🎯 Professional UI:** Modern CustomTkinter interface with comprehensive settings and offline indicators
- **🔧 Code Quality:** Pre-commit hooks, 585+ comprehensive tests, 80% coverage requirement, 120-char line length standard
- **🛡️ Secure Storage:** Fernet-encrypted API key management with local storage

## **🚀 Key Features Overview**

### **🤖 AI-Powered Transcription & Insights**

- **11 AI Provider Support:** Comprehensive ecosystem from cloud to local with unified interface
- **Smart Analysis:** Automatic summary, action items, sentiment analysis with confidence scoring
- **Background Processing:** Non-blocking transcription with progress tracking and cancellation
- **HTA File Support:** Native conversion of HiDock's proprietary format with error handling
- **Secure Storage:** Fernet-encrypted API key management with per-provider storage
- **Local AI Support:** Complete offline functionality with Ollama and LM Studio integration
- **Provider Validation:** Built-in API key testing and validation for all providers

### **🎵 Advanced Audio Management**

- **Enhanced Playback:** Variable speed control (0.25x-2.0x) with real-time audio processing
- **Visual Analysis:** Real-time waveform and spectrum visualization with background loading
- **Pin Feature:** Keep waveform visible while working with persistent state
- **Performance Optimized:** Background waveform processing with smart cancellation and caching
- **Format Support:** .hda, .wav, .mp3, .flac with automatic conversion and validation
- **Audio Processing:** Normalization, format conversion, and optimization utilities
- **Memory Efficient:** Downsampling to ~2000 points for optimal visualization performance

### **🔌 Professional Device Management**

- **Enhanced Detection:** Professional device selector with status indicators and proper enable/disable functionality
- **USB Protocol:** Direct communication via Python & libusb with retry logic and automatic device reset
- **Connection Recovery:** Automatic device reset functionality eliminates need for physical disconnect/reconnect
- **Disconnected Mode:** Complete offline functionality - view cached files and play downloaded content when device not connected
- **Visual Indicators:** Orange Connect button and disconnected header when device not connected
- **Real-time Sync:** Live device information and storage monitoring with intelligent caching (30s device info, 60s storage)
- **Batch Operations:** Multi-file download, delete, and management with progress tracking
- **Selection Modes:** Toggle between single and multi-selection with persistent preferences and deferred updates
- **Health Monitoring:** Connection statistics and device health checks with automatic recovery
- **Performance Optimized:** 150ms debouncing for file selection to prevent excessive device communication

### **⚙️ Comprehensive Configuration**

- **Provider Settings:** Dedicated configuration for each AI service with validation
- **Local Endpoints:** Custom server configuration for Ollama/LM Studio with connectivity testing
- **Theme Support:** Light/dark modes with professional styling and Font Awesome icons
- **Reliable Persistence:** All settings and preferences automatically saved with fixed key mapping
- **Performance Tuning:** Intelligent caching and background processing optimization
- **Settings Validation:** Comprehensive numeric range checking (temperature: 0.0-2.0, tokens: 1-32000)
- **Encrypted Storage:** Secure API key management with Fernet encryption
- **Device Integration:** Enhanced device selector with proper state management

## **🤖 Supported AI Providers**

### **☁️ Cloud Providers (7)**

| Provider           | Models Available                    | Transcription | Analysis | Strengths                  |
| ------------------ | ----------------------------------- | ------------- | -------- | -------------------------- |
| **Google Gemini**  | 7 models (2.5-flash, 2.5-pro, etc.) | ✅            | ✅       | Latest models, multimodal  |
| **OpenAI**         | 6 models (GPT-4o, Whisper, etc.)    | ✅ Whisper    | ✅       | Best transcription quality |
| **Anthropic**      | 5 models (Claude 3.5 Sonnet, etc.)  | ❌            | ✅       | Superior reasoning         |
| **OpenRouter**     | 8+ models (Multi-provider access)   | Limited       | ✅       | Access to many models      |
| **Amazon Bedrock** | 5+ models (AWS integration)         | ❌            | ✅       | Enterprise features        |
| **Qwen**           | 7 models (Alibaba's multilingual)   | ❌            | ✅       | Multilingual support       |
| **DeepSeek**       | 5 models (Coding specialist)        | ❌            | ✅       | Code analysis              |

### **🏠 Local Providers (2)**

| Provider      | Default Endpoint    | Models                               | Privacy  | Cost    |
| ------------- | ------------------- | ------------------------------------ | -------- | ------- |
| **Ollama**    | `localhost:11434`   | LLaMA 3.2, Mistral, CodeLlama, Phi3+ | 🔒 Local | 💰 Free |
| **LM Studio** | `localhost:1234/v1` | Custom GGUF models                   | 🔒 Local | 💰 Free |

## **📦 Multi-Application Suite**

### **🖥️ Desktop Application (Python)**

**Full-featured professional desktop application**

- **Framework:** CustomTkinter with Font Awesome icons
- **AI Integration:** All 11 providers with unified interface
- **Audio Processing:** Advanced playback and visualization
- **Device Management:** Complete HiDock device control
- **Configuration:** Comprehensive settings with encryption

### **🌐 Web Application (React)**

**Modern browser-based interface** _(Separate application)_

- **Framework:** React 18 + TypeScript + Vite
- **State Management:** Zustand store
- **AI Integration:** Google Gemini API (expandable)
- **WebUSB:** Direct device communication in browser

### **🎯 Audio Insights Extractor (React)**

**Standalone audio analysis tool** _(Separate application)_

- **Purpose:** Dedicated audio insights extraction
- **AI Integration:** Google GenAI processing
- **Framework:** React 19 + TypeScript

## **🚀 Quick Start**

**Choose your setup method:**

### **👤 End Users - Just Use the Apps**

**Want to use HiDock immediately? Pick your platform:**

#### **🪟 Windows (Easiest)**
```cmd
# Double-click this file:
setup-windows.bat
```

#### **🐧🍎 Linux/Mac (One Command)**
```bash
chmod +x setup-unix.sh && ./setup-unix.sh
```

#### **🐍 Any Platform (Interactive)**
```bash
git clone https://github.com/sgeraldes/hidock-next.git
cd hidock-next
python setup.py
# Choose option 1 (End User)
```

### **👨‍💻 Developers - Contribute Code**

```bash
git clone https://github.com/sgeraldes/hidock-next.git
cd hidock-next
python setup.py
# Choose option 2 (Developer)
```

### **📱 After Setup**

**Desktop App:**
```bash
cd hidock-desktop-app
source .venv/bin/activate  # Windows: .venv\Scripts\activate
python main.py
```

**Web App:**
```bash
cd hidock-web-app
npm run dev
# Open: http://localhost:5173
```

> 📖 **Need help?** See [QUICK_START.md](QUICK_START.md) for detailed instructions
> 🛠️ **Developers:** See [CONTRIBUTING.md](CONTRIBUTING.md) for contribution guidelines
> 📚 **Documentation:** [docs/](docs/) folder contains comprehensive guides

### **Optional: Local AI Setup**

```bash
# Install Ollama (for local models)
# Visit: https://ollama.ai
ollama pull llama3.2  # Pull your preferred model

# Or install LM Studio
# Visit: https://lmstudio.ai
# Download and load GGUF models
```

## **🎯 Usage Guide**

### **Basic Workflow**

1. **Connect Device:** USB connection with automatic detection
2. **Browse Files:** View recordings with status indicators
3. **Download & Convert:** Automatic HTA to WAV conversion
4. **AI Processing:** Choose provider and start transcription
5. **Review Results:** Summary, insights, and action items
6. **Manage Files:** Batch operations and organization

### **AI Provider Setup**

1. **Open Settings:** Configure your preferred AI provider
2. **Select Provider:** Choose from 11 available options
3. **Configure API:** Add API keys (cloud) or endpoints (local)
4. **Test Connection:** Validate configuration
5. **Start Processing:** Transcribe and analyze with chosen provider

### **Local AI Setup**

```bash
# Ollama Example
ollama serve  # Start Ollama server
# Set endpoint: http://localhost:11434

# LM Studio Example
# Start LM Studio server with your model
# Set endpoint: http://localhost:1234/v1
```

## **🔧 Advanced Features**

### **Audio Visualization**

- **Waveform Display:** Real-time audio visualization with background loading
- **Spectrum Analysis:** Frequency domain analysis with FFT processing
- **Playback Position:** Visual progress indicator with precise tracking
- **Pin Functionality:** Keep visualizations visible with persistent state
- **Theme Support:** Dark/light mode compatibility with dynamic theming
- **Performance Optimized:** Smart cancellation on selection changes and memory-efficient rendering

### **Speed Control**

- **Variable Speed:** 0.25x to 2.0x playback
- **Preset Buttons:** Quick access to common speeds
- **Smooth Control:** Increment/decrement by 0.25x
- **Reset Function:** Quick return to normal speed

### **Background Processing**

- **Non-blocking:** Continue working during transcription with threading
- **Progress Tracking:** Real-time processing indicators with detailed status
- **Cancellation:** Stop processing at any time with proper cleanup
- **Queue Management:** Handle multiple files with batch processing
- **Smart Caching:** Intelligent caching for device info and storage data
- **Error Recovery:** Automatic retry mechanisms and connection health monitoring

### **Enhanced Device Detection**

- **Status Indicators:** Visual device state representation with color coding
- **Device Information:** Detailed capability display with model-specific features
- **Multi-device:** Support for multiple HiDock variants (H1, H1E, P1)
- **Real-time Updates:** Live device monitoring with health checks
- **Enhanced Selector:** Professional device selector with proper enable/disable functionality
- **Connection Statistics:** Detailed metrics and performance monitoring
- **Auto-recovery:** Automatic reconnection and error handling

## **🔒 Security & Privacy**

### **Data Protection**

- **Local Processing:** Ollama/LM Studio never send data externally
- **Encrypted Storage:** API keys secured with Fernet encryption
- **No Telemetry:** Zero tracking or data collection
- **Offline Capable:** Full functionality without internet

### **API Key Management**

- **Per-Provider Storage:** Separate encrypted keys
- **Secure Configuration:** Keys never stored in plain text
- **Easy Management:** Simple key rotation and updates
- **Validation:** Built-in key testing functionality

## **📊 Performance & Compatibility**

### **Performance Metrics**

- **585+ Comprehensive Tests:** Full test coverage with 80% minimum requirement including offline mode tests
- **Startup Time:** < 3 seconds on modern hardware with cached file display
- **File Selection:** < 10ms response time with 150ms debouncing
- **Memory Usage:** < 100MB during normal operation
- **Background Processing:** Non-blocking with smart cancellation
- **Intelligent Caching:** 30s device info, 60s storage data caching, persistent file metadata cache
- **Offline Performance:** Instant cached file display, seamless connected/disconnected transitions

### **Supported File Formats**

- **Native:** .hda (HiDock proprietary) with automatic conversion and validation
- **Standard:** .wav, .mp3, .flac, .m4a with format detection
- **Output:** WAV conversion for AI processing with optimization
- **Processing:** Real-time format conversion and audio normalization

### **Device Compatibility**

- **HiDock H1:** Full support
- **HiDock H1E:** Full support
- **HiDock P1:** Full support
- **Future Models:** Extensible architecture

### **Platform Support**

- **Windows:** 10/11 with libusb
- **macOS:** 10.14+ with Homebrew libusb
- **Linux:** Ubuntu/Debian with libusb-dev

## **🔮 Roadmap & Future Plans**

### **Recently Completed**

- **✅ Disconnected Mode:** Complete offline functionality - view cached files and play downloaded content when device not connected
- **✅ Visual Indicators:** Orange Connect button and disconnected header when device not connected
- **✅ Critical Bug Fixes:** Fixed NameError crash and startup button state issues in disconnected mode
- **✅ Settings Persistence Fix:** Resolved critical issue where application settings weren't saving/loading properly
- **✅ USB Connection Reliability:** Implemented automatic device reset functionality to eliminate stuck connections
- **✅ Enhanced Error Recovery:** Automatic retry logic with device reset on communication timeouts
- **✅ Comprehensive Testing:** Added test suites for offline mode, settings persistence, and device reset functionality
- **✅ Documentation Enhancement:** Complete project intelligence system with change tracking registry
- **✅ Code Quality:** 585+ comprehensive tests with 80% coverage requirement maintained

### **Near Term**

- **Model Auto-Discovery:** Detect available local models automatically
- **Custom Prompts:** User-defined analysis templates with provider-specific optimization
- **Export Formats:** PDF, Word, JSON export options with formatting
- **Batch Processing:** Multi-file transcription queues with progress tracking
- **Enhanced UI:** Additional CustomTkinter components and accessibility improvements

### **Long Term**

- **Plugin System:** Extensible AI provider architecture
- **Custom Models:** Fine-tuned model integration
- **Advanced Analytics:** Deeper audio insights
- **Mobile App:** Companion mobile application

## **🤝 Contributing**

We welcome contributions! Areas for development:

- **New AI Providers:** Expand provider ecosystem beyond current 11
- **UI/UX Improvements:** Enhance user experience and accessibility
- **Local Model Support:** Additional local AI integrations and optimization
- **Documentation:** Guides and tutorials with real-world examples
- **Testing:** Expand test coverage beyond current 581 tests
- **Performance:** Further optimization of background processing and caching
- **Mobile Support:** WebUSB mobile compatibility improvements

See [CONTRIBUTING.md](CONTRIBUTING.md) for detailed guidelines.

### **Development Setup**

```bash
# Quick developer setup
python setup.py  # Choose option 2 (Developer)

# Pre-commit hooks (installed automatically)
pre-commit install

# Run comprehensive test suite (585+ tests)
cd hidock-desktop-app && python -m pytest  # Runs all tests with coverage
cd hidock-web-app && npm test

# Run specific test categories
pytest -m unit          # Unit tests only
pytest -m integration   # Integration tests
pytest -m device        # Device tests (requires hardware)

# Check code quality
black . && isort . && flake8 . && pylint .
```

## **💡 Use Cases**

### **Professional**

- **Meeting Transcription:** Accurate business meeting records
- **Interview Analysis:** Journalist and researcher workflows
- **Content Creation:** Podcast and video transcription
- **Legal Documentation:** Secure, local legal transcription

### **Personal**

- **Voice Notes:** Personal memo transcription
- **Learning:** Lecture and educational content
- **Creative Projects:** Audio content analysis
- **Accessibility:** Hearing-impaired content access

### **Enterprise**

- **Data Privacy:** Local processing for sensitive content
- **Cost Control:** BYOK model with budget management
- **Custom Integration:** API-based workflow integration
- **Compliance:** Local storage for regulatory requirements

## **📄 License**

This project is licensed under the **MIT License** - see [LICENSE](LICENSE) for details.

## **🙏 Acknowledgements**

- **libusb developers** for USB communication foundation
- **CustomTkinter team** for modern Python GUI framework
- **AI Provider teams** for API access and documentation
- **Open source community** for tools and libraries
- **HiDock users** for feedback and feature requests

## **⚠️ Disclaimer**

HiDock Next is an independent, community-driven project. Not affiliated with HiDock or its parent company. Use at your own risk. Always backup important recordings.

---

**🚀 Ready to transform your HiDock experience? [Get started now!](#installation--setup)**

_For detailed setup guides, visit our [documentation](docs/) folder._
