# AI Assistant Operational Rules: Audio Insights Extractor

This document contains the mandatory, non-negotiable rules and procedures for all React TypeScript development on the Audio Insights Extractor. As an AI assistant, you must adhere to these rules without exception. All project configurations are defined in `package.json`, `tsconfig.json`, and `vite.config.ts`.

---

## 1. Core Directives

- **React 19 Modern Standards:** You must use React 19 features including concurrent rendering, automatic batching, and the new compiler optimizations.

- **TypeScript Strict Mode:** All code must pass strict TypeScript checking with zero errors. No `any` types allowed except in specific documented cases.

- **Vite Development Only:** Never use Create React App or other build tools. All development must use Vite with the official React plugin.

- **Google Gemini AI Only:** This application uses Google Gemini as the exclusive AI provider. Never implement other AI services without explicit requirements.

- **Browser-Only Audio Processing:** Use Web Audio API and File API exclusively. Never attempt server-side audio processing.

## 2. Technology Stack Requirements

### Required Dependencies

You must use these exact dependencies as defined in `package.json`:

```json
{
  "dependencies": {
    "react": "^19.0.0",
    "react-dom": "^19.0.0",
    "@google/genai": "^0.2.0"
  },
  "devDependencies": {
    "@types/node": "^20.0.0",
    "@types/react": "^19.0.0",
    "@types/react-dom": "^19.0.0",
    "typescript": "^5.0.0",
    "vite": "^5.0.0",
    "@vitejs/plugin-react": "^4.0.0",
    "eslint": "^8.0.0",
    "@typescript-eslint/parser": "^6.0.0",
    "@typescript-eslint/eslint-plugin": "^6.0.0"
  }
}
```

### Forbidden Dependencies

- **Never install** React Router (this is a single-page prototype)
- **Never install** Redux or Zustand (use React 19 built-in state)
- **Never install** Material-UI or Ant Design (use custom CSS)
- **Never install** Axios (use native fetch API)

## 3. Mandatory Development Workflow

### Step 1: TypeScript Configuration

All TypeScript must follow this exact configuration in `tsconfig.json`:

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "useDefineForClassFields": true,
    "lib": ["ES2022", "DOM", "DOM.Iterable"],
    "allowJs": false,
    "skipLibCheck": true,
    "esModuleInterop": false,
    "allowSyntheticDefaultImports": true,
    "strict": true,
    "forceConsistentCasingInFileNames": true,
    "module": "ESNext",
    "moduleResolution": "Node",
    "resolveJsonModule": true,
    "isolatedModules": true,
    "noEmit": true,
    "jsx": "react-jsx"
  }
}
```

### Step 2: React Component Structure

All React components must follow this exact pattern:

```typescript
import { useState, useCallback, useEffect } from 'react';

interface ComponentProps {
  // All props must be explicitly typed
  onEvent?: (data: string) => void;
  children?: React.ReactNode;
}

export const ComponentName: React.FC<ComponentProps> = ({
  onEvent,
  children
}) => {
  const [state, setState] = useState<string>('');

  const handleEvent = useCallback((data: string) => {
    setState(data);
    onEvent?.(data);
  }, [onEvent]);

  useEffect(() => {
    // Cleanup function is mandatory for effects
    return () => {
      // Cleanup code
    };
  }, []);

  return (
    <div className="component-name">
      {children}
    </div>
  );
};
```

### Step 3: File Upload and Audio Processing

All file handling must follow this exact pattern:

```typescript
interface AudioFile {
  file: File;
  id: string;
  status: 'pending' | 'processing' | 'completed' | 'error';
  transcription?: string;
  insights?: AudioInsights;
}

const SUPPORTED_AUDIO_TYPES = [
  'audio/wav',
  'audio/mpeg',
  'audio/mp4',
  'audio/flac',
  'audio/ogg'
] as const;

const validateAudioFile = (file: File): boolean => {
  return SUPPORTED_AUDIO_TYPES.includes(file.type as any) &&
         file.size <= 100 * 1024 * 1024; // 100MB max
};

const handleFileUpload = useCallback((files: FileList) => {
  const validFiles = Array.from(files).filter(validateAudioFile);

  if (validFiles.length !== files.length) {
    // Handle invalid files
    console.error('Some files were rejected');
  }

  const audioFiles: AudioFile[] = validFiles.map(file => ({
    file,
    id: crypto.randomUUID(),
    status: 'pending'
  }));

  setAudioFiles(prev => [...prev, ...audioFiles]);
}, []);
```

## 4. Google Gemini Integration Requirements

### API Configuration

You must use this exact Gemini service pattern:

```typescript
import { GoogleGenerativeAI } from '@google/genai';

interface GeminiConfig {
  apiKey: string;
  model: 'gemini-pro' | 'gemini-pro-vision';
}

class GeminiService {
  private genAI: GoogleGenerativeAI;
  private model: any;

  constructor(config: GeminiConfig) {
    if (!config.apiKey) {
      throw new Error('Gemini API key is required');
    }

    this.genAI = new GoogleGenerativeAI(config.apiKey);
    this.model = this.genAI.getGenerativeModel({
      model: config.model,
      generationConfig: {
        temperature: 0.7,
        topP: 0.8,
        topK: 40,
        maxOutputTokens: 2048
      }
    });
  }

  async transcribeAudio(audioFile: File): Promise<string> {
    const base64Audio = await this.fileToBase64(audioFile);

    const prompt = `
      Transcribe this audio file accurately.
      Return only the transcribed text without formatting.
      Audio: ${base64Audio}
    `;

    const result = await this.model.generateContent(prompt);
    return result.response.text();
  }

  async extractInsights(transcript: string): Promise<AudioInsights> {
    const prompt = `
      Analyze this transcript and return JSON with these exact keys:
      {
        "summary": "2-3 sentence summary",
        "keyPoints": ["point1", "point2"],
        "actionItems": ["action1", "action2"],
        "sentiment": {"type": "positive|negative|neutral", "confidence": 0.8},
        "topics": ["topic1", "topic2"]
      }

      Transcript: "${transcript}"
    `;

    const result = await this.model.generateContent(prompt);
    const response = result.response.text();

    try {
      return JSON.parse(response) as AudioInsights;
    } catch (error) {
      throw new Error('Failed to parse AI response as JSON');
    }
  }

  private async fileToBase64(file: File): Promise<string> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        const base64 = (reader.result as string).split(',')[1];
        resolve(base64);
      };
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
  }
}
```

### Required Type Definitions

You must define these exact types:

```typescript
interface AudioInsights {
  summary: string;
  keyPoints: string[];
  actionItems: string[];
  sentiment: {
    type: 'positive' | 'negative' | 'neutral';
    confidence: number;
  };
  topics: string[];
}

interface ProcessingError {
  message: string;
  code: 'UPLOAD_FAILED' | 'TRANSCRIPTION_FAILED' | 'ANALYSIS_FAILED';
  details?: string;
}
```

## 5. Mandatory Testing Patterns

### Component Testing

All components must be tested using this pattern:

```typescript
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { ComponentName } from './ComponentName';

describe('ComponentName', () => {
  it('should render without crashing', () => {
    render(<ComponentName />);
    expect(screen.getByText(/expected text/i)).toBeInTheDocument();
  });

  it('should handle file upload', async () => {
    const mockOnUpload = vi.fn();
    render(<ComponentName onUpload={mockOnUpload} />);

    const file = new File(['audio data'], 'test.wav', { type: 'audio/wav' });
    const input = screen.getByLabelText(/upload/i);

    fireEvent.change(input, { target: { files: [file] } });

    await waitFor(() => {
      expect(mockOnUpload).toHaveBeenCalledWith([file]);
    });
  });
});
```

### Service Testing

All services must be tested with proper mocking:

```typescript
import { describe, it, expect, vi } from 'vitest';
import { GeminiService } from './GeminiService';

describe('GeminiService', () => {
  const mockApiKey = 'test-api-key';

  it('should transcribe audio file', async () => {
    const mockGenerateContent = vi.fn().mockResolvedValue({
      response: { text: () => 'Mock transcription' }
    });

    // Mock implementation
    const service = new GeminiService({ apiKey: mockApiKey, model: 'gemini-pro' });
    const file = new File(['audio'], 'test.wav', { type: 'audio/wav' });

    const result = await service.transcribeAudio(file);

    expect(result).toBe('Mock transcription');
  });
});
```

## 6. Quality Gates for React Application

### Build Requirements

1. **Zero TypeScript Errors:** `tsc --noEmit` must pass with zero errors
2. **ESLint Compliance:** `eslint src --ext .ts,.tsx` must pass with zero errors
3. **Build Success:** `vite build` must complete without errors
4. **File Size Limits:** Built bundle must be under 2MB total

### Runtime Requirements

1. **Performance:** Initial page load must complete within 2 seconds
2. **Memory Usage:** Application must not exceed 100MB RAM
3. **Error Boundaries:** All async operations must have proper error handling
4. **Accessibility:** All interactive elements must be keyboard accessible

## 7. Local Validation Commands

Before committing any React code, run these commands:

```bash
# Type checking
npx tsc --noEmit

# Linting
npx eslint src --ext .ts,.tsx

# Testing
npm run test

# Build verification
npm run build

# Development server test
npm run dev
```

## 8. Mandatory Project Structure

All code must follow this exact structure:

```text
audio-insights-extractor/
├── src/
│   ├── main.tsx             # React 19 app entry point
│   ├── App.tsx              # Main application component
│   ├── components/
│   │   ├── FileUpload.tsx   # File upload component
│   │   ├── AudioProcessor.tsx # Audio processing logic
│   │   ├── TranscriptionView.tsx # Display results
│   │   └── ErrorBoundary.tsx # Error handling
│   ├── services/
│   │   ├── gemini.ts        # Gemini AI service
│   │   └── audio.ts         # Audio processing utilities
│   ├── types/
│   │   └── index.ts         # Type definitions
│   ├── hooks/
│   │   ├── useAudioProcessor.ts # Audio processing hook
│   │   └── useGeminiAI.ts   # AI integration hook
│   └── styles/
│       └── global.css       # Global styles
├── public/
│   └── index.html           # Main HTML template
├── package.json             # Dependencies and scripts
├── vite.config.ts           # Vite configuration
├── tsconfig.json            # TypeScript configuration
└── vitest.config.ts         # Testing configuration
```

## 9. Error Handling Requirements

### Custom Error Classes

You must define these error classes:

```typescript
export class AudioProcessingError extends Error {
  constructor(
    message: string,
    public code: string,
    public details?: string
  ) {
    super(message);
    this.name = 'AudioProcessingError';
  }
}

export class GeminiAPIError extends Error {
  constructor(
    message: string,
    public status?: number,
    public details?: string
  ) {
    super(message);
    this.name = 'GeminiAPIError';
  }
}
```

### Mandatory Error Boundary

All async operations must be wrapped in this error boundary:

```typescript
import { Component, ErrorInfo, ReactNode } from 'react';

interface Props {
  children: ReactNode;
  fallback?: ReactNode;
}

interface State {
  hasError: boolean;
  error?: Error;
}

export class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error('Error boundary caught error:', error, errorInfo);
  }

  render() {
    if (this.state.hasError) {
      return this.props.fallback || <div>Something went wrong.</div>;
    }

    return this.props.children;
  }
}
```

## 10. Environment Configuration

### Required Environment Variables

You must use these exact environment variables in `.env.local`:

```bash
VITE_GEMINI_API_KEY=your_api_key_here
VITE_APP_VERSION=0.1.0
VITE_MAX_FILE_SIZE=104857600
VITE_SUPPORTED_FORMATS=audio/wav,audio/mpeg,audio/mp4,audio/flac,audio/ogg
```

### Configuration Access Pattern

```typescript
interface Config {
  geminiApiKey: string;
  appVersion: string;
  maxFileSize: number;
  supportedFormats: string[];
}

export const getConfig = (): Config => {
  const geminiApiKey = import.meta.env.VITE_GEMINI_API_KEY;

  if (!geminiApiKey) {
    throw new Error('VITE_GEMINI_API_KEY environment variable is required');
  }

  return {
    geminiApiKey,
    appVersion: import.meta.env.VITE_APP_VERSION || '0.1.0',
    maxFileSize: Number(import.meta.env.VITE_MAX_FILE_SIZE) || 104857600,
    supportedFormats: (import.meta.env.VITE_SUPPORTED_FORMATS || '').split(',')
  };
};
```

## 11. Performance Requirements

- **Bundle Size:** Total JavaScript bundle must be under 1MB
- **Initial Load:** First Contentful Paint within 1 second
- **File Processing:** Audio files must begin processing within 500ms of upload
- **Memory Efficiency:** No memory leaks during file processing operations

These requirements are non-negotiable and must be maintained across all changes.
