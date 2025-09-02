# Audio Insights Extractor (Prototype)

A standalone React application for extracting meaningful insights from audio files using AI-powered transcription and analysis.

## Overview

The Audio Insights Extractor is a lightweight, browser-based tool that allows users to:

- Upload audio files in various formats (WAV, MP3, M4A, FLAC)
- Transcribe audio to text using Google Gemini AI
- Extract key insights, summaries, and action items
- Analyze sentiment and identify topics
- Export results in multiple formats

This tool is part of the HiDock Next ecosystem but can operate independently for general audio analysis tasks.

## Features

### Core Functionality

- **Audio Upload**: Drag-and-drop or click-to-upload interface
- **Format Support**: WAV, MP3, M4A, FLAC, OGG formats
- **Real-time Processing**: Progress indicators and status updates
- **AI-Powered Analysis**: Leverages Google Gemini for transcription and insights

### Analysis Capabilities

- **Transcription**: Convert speech to text with high accuracy
- **Summarization**: Generate concise summaries of audio content
- **Key Points**: Extract important points and highlights
- **Action Items**: Identify tasks and follow-up actions
- **Sentiment Analysis**: Determine emotional tone
- **Topic Identification**: Categorize content by subject matter
- **Speaker Detection**: Identify different speakers (when supported)

### User Interface

- **Modern Design**: Clean, responsive React 19 interface
- **Real-time Feedback**: Live processing status and error handling
- **Export Options**: Download results as JSON, TXT, or CSV
- **Settings Panel**: Configure AI parameters and preferences

## Getting Started

### Prerequisites

- **Node.js 18+**: [Download Node.js](https://nodejs.org/)
- **Google Gemini API Key**: [Get API Key](https://makersuite.google.com/app/apikey)

### Installation

```bash
# Clone the repository (if not already done)
git clone https://github.com/sgeraldes/hidock-next.git
cd hidock-next/audio-insights-extractor

# Install dependencies
npm install
```

### Configuration

1. **Create environment file:**
   ```bash
   cp .env.example .env.local
   ```

2. **Add your Gemini API key:**
   ```bash
   # .env.local
   VITE_GEMINI_API_KEY=your_gemini_api_key_here
   ```

### Development

```bash
# Start development server
npm run dev

# Open your browser to http://localhost:5173
```

### Production Build

```bash
# Build for production
npm run build

# Preview production build
npm run preview
```

## Usage

### Basic Workflow

1. **Upload Audio File**
   - Click "Upload Audio" or drag and drop a file
   - Supported formats: WAV, MP3, M4A, FLAC, OGG
   - Maximum file size: 25MB

2. **Processing**
   - File is validated and uploaded
   - AI transcription begins automatically
   - Progress is shown in real-time

3. **Review Results**
   - Transcription appears in the main panel
   - Insights are generated and displayed
   - Edit or refine results if needed

4. **Export Data**
   - Download transcription as text file
   - Export insights as JSON
   - Save summary as markdown

### Advanced Features

#### Custom Prompts

Modify the AI analysis behavior by customizing prompts:

```typescript
const customPrompt = {
  transcription: "Transcribe this audio with speaker identification",
  analysis: "Focus on technical terms and provide definitions",
  summary: "Create a bullet-point summary for executives"
};
```

#### Batch Processing

Process multiple files sequentially:

```typescript
const files = [file1, file2, file3];
const results = await processBatch(files, {
  concurrent: false,
  saveIntermediate: true
});
```

## Architecture

### Component Structure

```
src/
├── components/
│   ├── AudioInput.tsx       # File upload component
│   ├── TranscriptionDisplay.tsx  # Text display and editing
│   ├── InsightsDisplay.tsx  # AI analysis results
│   ├── LoadingSpinner.tsx   # Progress indicators
│   ├── ErrorMessage.tsx     # Error handling
│   └── IconComponents.tsx   # UI icons and graphics
├── services/
│   └── geminiService.ts     # AI service integration
├── types.ts                 # TypeScript definitions
├── constants.ts             # Configuration constants
└── App.tsx                  # Main application
```

### Key Dependencies

- **React 19**: Latest React with concurrent features
- **TypeScript**: Type safety and developer experience
- **Vite**: Fast development and build tooling
- **Google Generative AI**: Gemini API integration
- **Tailwind CSS**: Utility-first styling (if used)

### Data Flow

1. **File Upload** → Validation → Base64 encoding
2. **AI Processing** → Gemini API → Response parsing
3. **Result Display** → Format results → User interaction
4. **Export** → Generate files → Download triggers

## Configuration

### Environment Variables

```bash
# Required
VITE_GEMINI_API_KEY=your_api_key

# Optional
VITE_MAX_FILE_SIZE=26214400  # 25MB in bytes
VITE_SUPPORTED_FORMATS=wav,mp3,m4a,flac,ogg
VITE_API_TIMEOUT=30000       # 30 seconds
```

### Application Settings

```typescript
interface AppConfig {
  maxFileSize: number;
  supportedFormats: string[];
  apiTimeout: number;
  autoSave: boolean;
  retryAttempts: number;
}
```

## AI Integration

### Gemini API Configuration

```typescript
const geminiConfig = {
  model: 'gemini-1.5-flash',  // or gemini-1.5-pro
  temperature: 0.7,
  maxTokens: 2048,
  safetySettings: {
    harmBlockThreshold: 'BLOCK_MEDIUM_AND_ABOVE'
  }
};
```

### Custom Analysis Types

```typescript
enum AnalysisType {
  GENERAL = 'general',
  MEETING = 'meeting',
  INTERVIEW = 'interview',
  LECTURE = 'lecture',
  MEDICAL = 'medical',
  LEGAL = 'legal'
}
```

## Testing

### Unit Tests

```bash
# Run all tests
npm test

# Watch mode
npm run test:watch

# Coverage report
npm run test:coverage
```

### Test Structure

```
src/
├── __tests__/
│   ├── components/
│   │   ├── AudioInput.test.tsx
│   │   └── InsightsDisplay.test.tsx
│   ├── services/
│   │   └── geminiService.test.ts
│   └── utils/
│       └── audioProcessing.test.ts
```

### Example Test

```typescript
import { render, screen, fireEvent } from '@testing-library/react';
import { AudioInput } from '../AudioInput';

describe('AudioInput', () => {
  it('accepts valid audio files', () => {
    const mockFile = new File(['audio'], 'test.wav', {
      type: 'audio/wav'
    });

    render(<AudioInput onFileSelect={jest.fn()} />);

    const input = screen.getByLabelText(/upload audio/i);
    fireEvent.change(input, { target: { files: [mockFile] } });

    expect(screen.getByText('test.wav')).toBeInTheDocument();
  });
});
```

## Deployment

### Static Hosting

The application builds to static files and can be deployed to:

- **Vercel**: `vercel deploy`
- **Netlify**: `npm run build` → drag dist folder
- **GitHub Pages**: Use GitHub Actions workflow
- **Firebase**: `firebase deploy`

### Docker Deployment

```dockerfile
FROM node:18-alpine

WORKDIR /app
COPY package*.json ./
RUN npm ci --only=production

COPY . .
RUN npm run build

FROM nginx:alpine
COPY --from=0 /app/dist /usr/share/nginx/html
EXPOSE 80
```

### Environment-Specific Builds

```bash
# Development
npm run build:dev

# Staging
npm run build:staging

# Production
npm run build:prod
```

## Troubleshooting

### Common Issues

#### File Upload Fails
- Check file size (max 25MB)
- Verify supported format
- Clear browser cache

#### API Errors
- Verify Gemini API key is correct
- Check API quota limits
- Ensure internet connectivity

#### Processing Stuck
- Refresh page and retry
- Try smaller file
- Check browser console for errors

### Debug Mode

Enable detailed logging:

```bash
VITE_DEBUG=true npm run dev
```

### Performance Optimization

- Use WebWorkers for large file processing
- Implement file chunking for large uploads
- Cache processed results locally
- Optimize bundle size with tree shaking

## Contributing

### Development Workflow

1. Fork the repository
2. Create feature branch: `git checkout -b feature/audio-enhancement`
3. Make changes and test
4. Submit pull request

### Code Style

- Use TypeScript for all new code
- Follow React best practices
- Write tests for new features
- Document public APIs

### Adding New Features

```typescript
// Example: Adding new analysis type
export interface CustomAnalysis {
  type: 'sentiment' | 'keywords' | 'summary';
  config: AnalysisConfig;
  processor: (text: string) => Promise<AnalysisResult>;
}
```

## Roadmap

### Planned Features

- **Multi-language Support**: Support for 50+ languages
- **Speaker Diarization**: Advanced speaker identification
- **Real-time Processing**: Live audio stream analysis
- **Collaboration**: Share and collaborate on transcriptions
- **Advanced Export**: Word, PDF, and presentation formats
- **API Integration**: RESTful API for programmatic access

### Version History

- **v1.0.0**: Initial release with basic transcription
- **v1.1.0**: Added insights and analysis features
- **v1.2.0**: Improved UI/UX and error handling
- **v2.0.0**: React 19 upgrade and performance improvements

## Support

### Documentation

- [Main Project README](../README.md)
- [API Documentation](../docs/API.md)
- [Troubleshooting Guide](../docs/TROUBLESHOOTING.md)

### Community

- [GitHub Issues](https://github.com/sgeraldes/hidock-next/issues)
- [Discussions](https://github.com/sgeraldes/hidock-next/discussions)
- [Contributing Guide](../CONTRIBUTING.md)

### Commercial Support

For enterprise deployments and custom integrations, contact the HiDock team through the main repository.

## License

This project is licensed under the same terms as the main HiDock Next project. See [LICENSE](../LICENSE) for details.
