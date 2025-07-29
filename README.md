# **HiDock Next** 🎵

**The Ultimate HiDock Management Suite with AI-Powered Transcription**

HiDock Next provides comprehensive local control over your HiDock recordings with advanced AI transcription capabilities. Manage, analyze, and transcribe your audio files using **11 different AI providers** including cloud services and local models - all while maintaining complete data ownership.

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Python 3.8+](https://img.shields.io/badge/python-3.8+-blue.svg)](https://www.python.org/downloads/)
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
- **🏠 Offline Capable:** Full functionality without internet using local AI
- **⚡ Advanced Features:** Speed control, waveform visualization, background processing
- **🎯 Professional UI:** Modern CustomTkinter interface with comprehensive settings

## **🚀 Key Features Overview**

### **🤖 AI-Powered Transcription & Insights**

- **11 AI Provider Support:** Comprehensive ecosystem from cloud to local
- **Smart Analysis:** Automatic summary, action items, sentiment analysis
- **Background Processing:** Non-blocking transcription with progress tracking
- **HTA File Support:** Native conversion of HiDock's proprietary format
- **Secure Storage:** Encrypted API key management with Fernet encryption

### **🎵 Advanced Audio Management**

- **Enhanced Playback:** Variable speed control (0.25x-2.0x) with preset buttons
- **Visual Analysis:** Real-time waveform and spectrum visualization
- **Pin Feature:** Keep waveform visible while working
- **Format Support:** .hda, .wav, .mp3, .flac with automatic conversion

### **🔌 Professional Device Management**

- **Enhanced Detection:** Professional device selector with status indicators
- **USB Protocol:** Direct communication via Python & libusb
- **Real-time Sync:** Live device information and storage monitoring
- **Batch Operations:** Multi-file download, delete, and management

### **⚙️ Comprehensive Configuration**

- **Provider Settings:** Dedicated configuration for each AI service
- **Local Endpoints:** Custom server configuration for Ollama/LM Studio
- **Theme Support:** Light/dark modes with professional styling
- **Persistent State:** All settings and preferences automatically saved

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

## **🛠️ Installation & Setup**

### **Prerequisites**

- **Python:** 3.8+ recommended
- **libusb:** USB communication library
  - **Linux:** `sudo apt-get install libusb-1.0-0-dev`
  - **macOS:** `brew install libusb`
  - **Windows:** libusb-1.0.dll (included) or Zadig driver setup
- **HiDock Device:** H1, H1E, P1 variants supported

### **Quick Start**

```bash
# 1. Clone repository
git clone https://github.com/sgeraldes/hidock-next.git
cd hidock-next

# 2. Create virtual environment
python -m venv venv
source venv/bin/activate  # Windows: venv\Scripts\activate

# 3. Install desktop app dependencies
pip install -r hidock-desktop-app/requirements.txt

# 4. Run desktop application
cd hidock-desktop-app
python main.py
```

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

- **Waveform Display:** Real-time audio visualization
- **Spectrum Analysis:** Frequency domain analysis
- **Playback Position:** Visual progress indicator
- **Pin Functionality:** Keep visualizations visible
- **Theme Support:** Dark/light mode compatibility

### **Speed Control**

- **Variable Speed:** 0.25x to 2.0x playback
- **Preset Buttons:** Quick access to common speeds
- **Smooth Control:** Increment/decrement by 0.25x
- **Reset Function:** Quick return to normal speed

### **Background Processing**

- **Non-blocking:** Continue working during transcription
- **Progress Tracking:** Real-time processing indicators
- **Cancellation:** Stop processing at any time
- **Queue Management:** Handle multiple files

### **Enhanced Device Detection**

- **Status Indicators:** Visual device state representation
- **Device Information:** Detailed capability display
- **Multi-device:** Support for multiple HiDock variants
- **Real-time Updates:** Live device monitoring

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

### **Supported File Formats**

- **Native:** .hda (HiDock proprietary) with automatic conversion
- **Standard:** .wav, .mp3, .flac, .m4a
- **Output:** WAV conversion for AI processing

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

### **Near Term**

- **Model Auto-Discovery:** Detect available local models
- **Custom Prompts:** User-defined analysis templates
- **Export Formats:** PDF, Word, JSON export options
- **Batch Processing:** Multi-file transcription queues

### **Long Term**

- **Plugin System:** Extensible AI provider architecture
- **Custom Models:** Fine-tuned model integration
- **Advanced Analytics:** Deeper audio insights
- **Mobile App:** Companion mobile application

## **🤝 Contributing**

We welcome contributions! Areas for development:

- **New AI Providers:** Expand provider ecosystem
- **UI/UX Improvements:** Enhance user experience
- **Local Model Support:** Additional local AI integrations
- **Documentation:** Guides and tutorials
- **Testing:** Automated test coverage

See `CONTRIBUTING.md` for detailed guidelines.

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
